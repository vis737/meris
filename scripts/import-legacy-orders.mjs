#!/usr/bin/env node
/**
 * Import legacy JSON-datastore orders into Supabase.
 *
 * The storefront used to persist orders in `orders_db.json` on the Express
 * server (Render/Railway/Vercel). Since the move to Cloudflare Workers +
 * Supabase, every read and write goes through Supabase, so those historical
 * orders were never carried over. This script reads them back out of git
 * history and inserts them.
 *
 * It only ever INSERTs order numbers that are not already in Supabase, so it
 * is safe to run repeatedly.
 *
 *   node scripts/import-legacy-orders.mjs                      # dry run
 *   node scripts/import-legacy-orders.mjs --apply              # write
 *   node scripts/import-legacy-orders.mjs --from <file.json>   # import a JSON file instead of git
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const DEFAULT_GIT_REF = 'e6a470b:orders_db.json';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const fromIdx = args.indexOf('--from');
const fromFile = fromIdx !== -1 ? args[fromIdx + 1] : null;

/** Minimal .env loader so the script has no extra dependency. */
function loadEnv() {
  for (const file of ['.env', '.dev.vars']) {
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  }
}

function loadLegacyOrders() {
  let raw;
  if (fromFile) {
    raw = fs.readFileSync(path.resolve(ROOT, fromFile), 'utf8');
    console.log(`source: ${fromFile}`);
  } else {
    raw = execFileSync('git', ['show', DEFAULT_GIT_REF], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    console.log(`source: git ${DEFAULT_GIT_REF}`);
  }
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : (parsed.items || parsed.orders || []);
}

/**
 * camelCase storefront order -> Supabase `orders` row.
 * Mirrors `orderToRow` in worker/db.ts so imported rows are shaped exactly
 * like rows the worker writes today.
 */
function toRow(order) {
  return {
    id: order.id,
    order_number: order.orderNumber,
    customer_info: order.customerInfo ?? null,
    items: order.items ?? [],
    shipping_method: order.shippingMethod ?? 'standard',
    shipping_cost: order.shippingCost ?? 0,
    tax: order.tax ?? 0,
    discount: order.discount ?? 0,
    subtotal: order.subtotal ?? 0,
    total: order.total ?? 0,
    status: order.status ?? 'pending',
    coupon_code: order.couponCode ?? null,
    date: order.date,
    payment_method: order.paymentMethod ?? 'Unknown',
    payment_status: order.paymentStatus ?? 'pending',
    upi_txn_id: order.upiTxnId ?? null,
    upi_sender_name: order.upiSenderName ?? null,
    upi_screenshot: order.upiScreenshot ?? null,
    upi_notes: order.upiNotes ?? null,
    gift_wrapping_requested: order.giftWrappingRequested ?? false,
    gift_wrapping_type: order.giftWrappingType ?? 'Generic',
    gift_message: order.giftMessage ?? null,
    gift_sender_name: order.giftSenderName ?? null,
    gift_hide_price: order.giftHidePrice ?? false,
    account_email: order.accountEmail ?? order.customerInfo?.email ?? null,
    account_name: order.accountName ?? order.customerInfo?.name ?? null,
    // Keep the historical date so these sort below newer orders
    // (the worker orders by created_at desc).
    created_at: `${order.date}T12:00:00+00:00`,
  };
}

async function main() {
  loadEnv();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL / SUPABASE_KEY are not set (looked in .env and .dev.vars).');
    process.exit(1);
  }

  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const legacy = loadLegacyOrders();
  console.log(`legacy orders found: ${legacy.length}\n`);

  const existingRes = await fetch(`${url}/rest/v1/orders?select=order_number`, { headers });
  if (!existingRes.ok) {
    console.error(`Could not read existing orders: ${existingRes.status} ${await existingRes.text()}`);
    process.exit(1);
  }
  const existing = new Set((await existingRes.json()).map((o) => o.order_number));

  const toInsert = legacy.filter((o) => o.orderNumber && !existing.has(o.orderNumber));
  const skipped = legacy.filter((o) => existing.has(o.orderNumber));

  console.log('order number        date         total    method            status');
  console.log('------------------- ------------ -------- ------------------ -----------');
  for (const o of toInsert) {
    console.log(
      `${o.orderNumber.padEnd(20)} ${String(o.date).padEnd(12)} ${String(o.total).padEnd(8)} ${String(o.paymentMethod).slice(0, 16).padEnd(17)} ${o.status}`
    );
  }
  if (skipped.length) {
    console.log(`\nalready in Supabase (skipped ${skipped.length}): ${skipped.map((o) => o.orderNumber).join(', ')}`);
  }
  console.log(`\nto insert: ${toInsert.length}`);

  if (!apply) {
    console.log('\nDry run — nothing was written. Re-run with --apply to insert.');
    return;
  }
  if (!toInsert.length) {
    console.log('\nNothing to do.');
    return;
  }

  const rows = toInsert.map(toRow);
  const res = await fetch(`${url}/rest/v1/orders`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    console.error(`\nInsert failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }

  const verifyRes = await fetch(`${url}/rest/v1/orders?select=order_number`, { headers });
  const total = (await verifyRes.json()).length;
  console.log(`\nInserted ${rows.length} orders. orders table now holds ${total} rows.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});