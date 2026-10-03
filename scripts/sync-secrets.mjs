#!/usr/bin/env node
/**
 * Re-bind the worker's secrets to Supabase (and the other services) from .env.
 *
 * Non-secret values — SUPABASE_URL, SUPABASE_STORAGE_BUCKET, APP_URL — live in
 * wrangler.jsonc `vars` and are therefore restored by every `wrangler deploy`.
 * The values that must never be committed are pushed here instead, so the
 * Supabase link survives a worker being deleted or recreated.
 *
 * Run automatically by `npm run deploy`, or directly:
 *   node scripts/sync-secrets.mjs            # push secrets to the configured worker
 *   node scripts/sync-secrets.mjs --check    # only validate .env, push nothing
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const checkOnly = process.argv.includes('--check');

/** Values that must be present for the worker to talk to Supabase. */
const REQUIRED = ['SUPABASE_URL', 'SUPABASE_KEY'];

/**
 * Sensitive values pushed as Worker secrets. SUPABASE_URL and
 * SUPABASE_STORAGE_BUCKET are intentionally absent — they are non-secret and
 * live in wrangler.jsonc `vars`, because a var and a secret cannot share a name.
 */
const SECRET_KEYS = [
  'SUPABASE_KEY',
  'JWT_SECRET',
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD',
  'ADMIN_NOTIFICATION_EMAIL',
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
  'GEMINI_API_KEY',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
];

function loadEnv() {
  const env = {};
  for (const file of ['.env', '.dev.vars']) {
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      env[m[1]] = v;
    }
  }
  return env;
}

function wranglerBin() {
  const p = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  if (!fs.existsSync(p)) {
    console.error('wrangler is not installed. Run `npm install` first.');
    process.exit(1);
  }
  return p;
}

function workerName() {
  // wrangler.jsonc is JSONC and carries comments, so read the single field we
  // need with a regex rather than JSON.parse.
  const m = fs.readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8').match(/"name"\s*:\s*"([^"]+)"/);
  if (!m) {
    console.error('Could not read the worker name from wrangler.jsonc.');
    process.exit(1);
  }
  return m[1];
}

function main() {
  const env = loadEnv();
  const missingRequired = REQUIRED.filter((k) => !env[k]);
  if (missingRequired.length) {
    console.error(`\nCannot bind secrets — ${missingRequired.join(', ')} missing from .env.`);
    console.error('The worker would deploy without a Supabase connection and every API call would 503.\n');
    process.exit(1);
  }

  const secrets = {};
  const absent = [];
  for (const key of SECRET_KEYS) {
    if (env[key]) secrets[key] = env[key];
    else absent.push(key);
  }

  console.log(`supabase:  ${env.SUPABASE_URL}`);
  console.log(`worker:    ${workerName()}`);
  console.log(`secrets:   ${Object.keys(secrets).length} to bind`);
  if (absent.length) console.log(`not in .env (skipped): ${absent.join(', ')}`);

  if (checkOnly) {
    console.log('\n--check only — nothing was pushed.');
    return;
  }

  // Write the secrets outside the repo, push them, then delete the file.
  const tmp = path.join(os.tmpdir(), `meris-secrets-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify(secrets, null, 2));
  try {
    // Call wrangler's entry point directly. Shelling out to npx needs a shell on
    // Windows for its .cmd shim, which Node blocks without extra escaping.
    execFileSync(process.execPath, [wranglerBin(), 'secret', 'bulk', tmp], {
      cwd: ROOT,
      stdio: 'inherit',
    });
  } finally {
    fs.rmSync(tmp, { force: true });
    console.log('temp secrets file deleted');
  }
}

main();