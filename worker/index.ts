/**
 * MERIS E-SHOP — Hono API for Cloudflare Workers.
 *
 * The complete REST surface of the original Express server (server.ts), ported
 * to Hono with Workers-native primitives:
 *   - Supabase (PostgreSQL) is the single source of truth ("admin database").
 *   - All transactional email goes through the Resend mail service (mailer.ts).
 *   - Static SPA assets are served via the ASSETS binding (wrangler.jsonc).
 */
import { Hono } from 'hono';
import type { Env } from './env';
import { parseCookies } from './env';
import {
  getSupabase,
  isSupabaseConfigured,
  mapProductRow,
  mapCategoryRow,
  categoryToRow,
  mapCouponRow,
  mapOrderRow,
  mapCustomerRow,
  orderToRow,
  parseProductWeightKg,
  seedSupabaseDatabase,
} from './db';
import {
  signJwt,
  verifyJwt,
  hashAdminPassword,
  verifyAdminPassword,
  verifyCustomerPassword,
  hashCustomerPassword,
  getAdminSession,
  loadAdminCredentials,
} from './auth';
import {
  sanitizeString,
  sanitizeEmail,
  sanitizeAiPrompt,
  isConfigured,
  checkRateLimit,
  validatePassword,
  normalizePhone,
  escapeHtml,
} from './utils';
import {
  sendOtpEmail,
  sendBookingEmail,
  sendAdminVendorNotificationEmail,
  sendPaymentEmail,
  sendWelcomeEmail,
  sendTestEmail,
  sendEmail,
} from './mailer';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Variables = { env: Env; admin: Record<string, any> | null };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/* ---------------------------------------------------------------------------
 * Boot: seed an empty Supabase project (idempotent, runs once per isolate)
 * ------------------------------------------------------------------------- */

let seeded = false;
async function ensureSeeded(env: Env): Promise<void> {
  if (seeded) return;
  seeded = true;
  await seedSupabaseDatabase(env);
}

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function getPublicAppUrl(env: Env, request: Request): string {
  if (isConfigured(env.APP_URL)) return env.APP_URL!.replace(/\/$/, '');
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

/** Session cookie options — HttpOnly, Secure, SameSite=Lax. */
function adminCookie(token: string): string {
  return `admin_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${2 * 60 * 60}`;
}

function clearedAdminCookie(): string {
  return 'admin_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
}

/* ---------------------------------------------------------------------------
 * Security headers + CORS + seed on every API request
 * ------------------------------------------------------------------------- */

app.use('/api/*', async (c, next) => {
  await ensureSeeded(c.env);

  const origin = c.req.header('Origin');
  const allowedOrigin = isConfigured(c.env.APP_URL) ? c.env.APP_URL! : origin || '*';
  c.header('Access-Control-Allow-Origin', origin === allowedOrigin || !origin ? (origin || '*') : allowedOrigin);
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  c.header('Access-Control-Allow-Credentials', 'true');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-Frame-Options', 'DENY');

  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});

/* ---------------------------------------------------------------------------
 * Health
 * ------------------------------------------------------------------------- */

app.get('/health', (c) => c.text('OK'));
app.get('/api/health', (c) => c.json({
  status: 'ok',
  timestamp: new Date().toISOString(),
  database: isSupabaseConfigured(c.env) ? 'supabase' : 'not-configured',
  mail: isConfigured(c.env.RESEND_API_KEY) ? 'resend' : 'not-configured',
  api_key_configured: isConfigured(c.env.GEMINI_API_KEY),
}));

/* ---------------------------------------------------------------------------
 * Products catalog
 * ------------------------------------------------------------------------- */

app.get('/api/catalog/products', async (c) => {
  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured. Set SUPABASE_URL and SUPABASE_KEY.', 503);

  const { data, error } = await supabase.from('products').select('*');
  if (error) {
    console.error('[Catalog] Products fetch failed:', error.message);
    return jsonError('Failed to load products catalog.', 500);
  }
  return c.json((data || []).map(mapProductRow));
});

app.post('/api/catalog/products', async (c) => {
  const admin = await getAdminSession(c.req.raw, c.env);
  if (!admin) return jsonError('Unauthenticated administrative request.', 401);

  const productsList = await c.req.json().catch(() => null);
  if (!Array.isArray(productsList)) return jsonError('Body must be an array of products.');
  if (productsList.length > 500) return jsonError('Too many products in a single request (max 500).');

  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const mapped = productsList.map((p: any) => ({
    id: p.id,
    sku: p.sku || `SKU-${p.id}`,
    name: p.name || 'Handcrafted Product',
    category: p.category || 'Handbags',
    category_slug: p.categorySlug || p.category?.toLowerCase().replace(/\s+/g, '-') || 'handbags',
    price: p.price,
    discount_price: p.discountPrice || null,
    stock: p.stock !== undefined ? p.stock : 10,
    rating: p.rating || 5,
    rating_count: p.ratingCount || 1,
    images: p.images || [],
    short_description: p.shortDescription || p.name || '',
    description: p.description || p.name || '',
    specifications: { ...(p.specifications || {}), Weight: parseProductWeightKg(p) ? `${parseProductWeightKg(p)} kg` : p.specifications?.Weight },
    reviews: p.reviews || [],
    is_new: p.isNew || false,
    is_bestseller: p.isBestseller || false,
    brand: p.brand || 'MERIS',
    availability: p.availability || 'in-stock',
    vendor_id: p.vendorId || null,
    free_shipping: Boolean(p.freeShipping),
    gst_exempt: Boolean(p.gstExempt),
  }));

  const { error: upsertErr } = await supabase.from('products').upsert(mapped);
  if (upsertErr) {
    console.error('[Catalog] Products upsert failed:', upsertErr.message);
    return jsonError('Supabase products upsert failed. Catalog was not durably saved.', 500);
  }

  // Clean up deleted products so removed rows do not reappear.
  const currentIds = productsList.map((p: any) => p.id).filter(Boolean);
  if (currentIds.length > 0) {
    const { error: delErr } = await supabase.from('products').delete().not('id', 'in', `(${currentIds.join(',')})`);
    if (delErr) console.warn('[Catalog] Product cleanup notice:', delErr.message);
  }

  return c.json({ success: true, message: 'Products catalog synchronized successfully.' });
});

/* ---------------------------------------------------------------------------
 * Categories
 * ------------------------------------------------------------------------- */

app.get('/api/catalog/categories', async (c) => {
  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const { data, error } = await supabase.from('categories').select('*').order('name');
  if (error) return jsonError('Failed to load categories.', 500);
  return c.json((data || []).map(mapCategoryRow));
});

app.post('/api/catalog/categories', async (c) => {
  const admin = await getAdminSession(c.req.raw, c.env);
  if (!admin) return jsonError('Unauthenticated administrative request.', 401);

  const body = await c.req.json().catch(() => null);
  if (!Array.isArray(body) || body.length > 100) return jsonError('Body must be a list of up to 100 categories.');

  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const categories = body.map(mapCategoryRow);
  const ids = new Set<string>();
  for (const category of categories) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category.id) || !category.name || !category.imageUrl) {
      return jsonError('Every category needs a valid slug, name, and image.');
    }
    if (ids.has(category.id)) return jsonError(`Duplicate category slug: ${category.id}`);
    ids.add(category.id);
  }

  // The live table uses a uuid PK with a unique `slug` column; older schemas
  // used a text id. Detect the shape once and reuse it.
  const { data: existingRows } = await supabase.from('categories').select('*');
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const uuidSchema = (existingRows || []).some((r: any) => typeof r.id === 'string' && uuidRe.test(r.id));

  if (uuidSchema) {
    const existingBySlug = new Map((existingRows || []).map((r: any) => [String(r.slug || ''), r]));
    const existingByUuid = new Map((existingRows || []).map((r: any) => [String(r.id), r]));

    for (const category of categories) {
      const existing = existingBySlug.get(category.id) || existingByUuid.get(category.id);
      const row = categoryToRow(category, existing?.id);
      const { error } = await supabase.from('categories').upsert(row);
      if (error) {
        console.error('[Catalog] Category upsert failed:', error.message);
        return jsonError('Category database sync failed.', 500);
      }
      // Keep product labels in sync with renames.
      if (existing && existing.name !== category.name) {
        await supabase.from('products')
          .update({ category: category.name, category_slug: category.id })
          .eq('category_slug', category.id);
      }
    }

    // Delete categories whose slug is no longer present.
    const keepIds = categories
      .map((category) => (existingBySlug.get(category.id) || existingByUuid.get(category.id))?.id)
      .filter(Boolean);
    const deleteIds = (existingRows || []).map((r: any) => r.id).filter((id: string) => !keepIds.includes(id));
    for (const id of deleteIds) {
      await supabase.from('categories').delete().eq('id', id);
    }
  } else {
    // Legacy text-id schema.
    const rows = categories.map((category) => ({
      id: category.id,
      name: category.name,
      description: category.description,
      image_url: category.imageUrl,
      enabled: category.enabled !== false,
    }));
    const { error: upsertError } = await supabase.from('categories').upsert(rows);
    if (upsertError) {
      console.error('[Catalog] Categories upsert failed:', upsertError.message);
      return jsonError('Category database sync failed.', 500);
    }
    const categoryIds = categories.map((category) => category.id);
    if (categoryIds.length > 0) {
      await supabase.from('categories').delete().not('id', 'in', `(${categoryIds.join(',')})`);
    }
  }

  return c.json({ success: true, categories });
});

/* ---------------------------------------------------------------------------
 * Product reviews (public)
 * ------------------------------------------------------------------------- */

app.post('/api/products/:productId/reviews', async (c) => {
  const { productId } = c.req.param();
  const newReview = await c.req.json().catch(() => null);
  if (!newReview || !newReview.author || !newReview.comment) {
    return jsonError('Review author and comment are required.');
  }

  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const { data: product } = await supabase.from('products').select('*').eq('id', productId).single();
  if (!product) return jsonError('Product not found.', 404);

  const revs = [newReview, ...(product.reviews || [])];
  const totalRating = revs.reduce((acc: number, r: any) => acc + (Number(r.rating) || 5), 0);
  const newRating = revs.length > 0 ? Number((totalRating / revs.length).toFixed(1)) : 5;

  const { data: updated, error } = await supabase.from('products')
    .update({ reviews: revs, rating: newRating, rating_count: revs.length })
    .eq('id', productId)
    .select()
    .single();

  if (error) return jsonError('Failed to record review.', 500);
  return c.json({ success: true, message: 'Review recorded successfully.', product: mapProductRow(updated) });
});

/* ---------------------------------------------------------------------------
 * Coupons
 * ------------------------------------------------------------------------- */

app.get('/api/catalog/coupons', async (c) => {
  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const { data, error } = await supabase.from('coupons').select('*');
  if (error) return jsonError('Failed to load coupons.', 500);
  return c.json((data || []).map(mapCouponRow));
});

app.post('/api/catalog/coupons', async (c) => {
  const admin = await getAdminSession(c.req.raw, c.env);
  if (!admin) return jsonError('Unauthenticated administrative request.', 401);

  const couponsList = await c.req.json().catch(() => null);
  if (!Array.isArray(couponsList)) return jsonError('Body must be an array of coupons.');

  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const mapped = couponsList.map((cpn: any) => ({
    code: cpn.code,
    type: cpn.type,
    value: cpn.value,
    expiry_date: cpn.expiryDate,
    usage_limit: cpn.usageLimit,
    usage_count: cpn.usageCount,
    minimum_cart_value: cpn.minimumCartValue,
    description: cpn.description,
    active: cpn.active,
  }));

  const { error } = await supabase.from('coupons').upsert(mapped);
  if (error) return jsonError('Supabase coupons upsert failed', 500);
  return c.json({ success: true, message: 'Coupons synchronized.' });
});

app.post('/api/catalog/coupons/bulk-delete', async (c) => {
  const admin = await getAdminSession(c.req.raw, c.env);
  if (!admin) return jsonError('Unauthenticated administrative request.', 401);

  const { codes } = await c.req.json().catch(() => ({}));
  if (!Array.isArray(codes)) return jsonError('Body must contain an array of coupon codes.');

  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const { error } = await supabase.from('coupons').delete().in('code', codes);
  if (error) return jsonError('Supabase coupons bulk delete failed', 500);
  return c.json({ success: true, message: `Deleted ${codes.length} coupons.` });
});

app.delete('/api/catalog/coupons', async (c) => {
  const admin = await getAdminSession(c.req.raw, c.env);
  if (!admin) return jsonError('Unauthenticated administrative request.', 401);

  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const { error } = await supabase.from('coupons').delete().neq('code', 'IMPOSSIBLE_VALUE_TO_DELETE_ALL');
  if (error) return jsonError('Supabase coupons wipe failed', 500);
  return c.json({ success: true, message: 'All coupons permanently deleted.' });
});

/* ---------------------------------------------------------------------------
 * Campaigns (homepage banners)
 * ------------------------------------------------------------------------- */

app.get('/api/catalog/campaigns', async (c) => {
  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const { data, error } = await supabase.from('campaigns').select('*');
  if (error) return jsonError('Failed to load campaigns.', 500);
  const mapped = (data || []).map((cpn: any) => ({
    id: cpn.id,
    imageUrl: cpn.image_url || '',
    title: cpn.title,
    description: cpn.description,
    ctaText: cpn.cta_text,
    linkCategory: cpn.link_category,
    active: cpn.active,
  }));
  return c.json(mapped.some((cpn: any) => cpn.imageUrl) ? mapped : mapped);
});

app.post('/api/catalog/campaigns', async (c) => {
  const admin = await getAdminSession(c.req.raw, c.env);
  if (!admin) return jsonError('Unauthenticated administrative request.', 401);

  const campaignsList = await c.req.json().catch(() => null);
  if (!Array.isArray(campaignsList)) return jsonError('Body must be an array.');

  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const mapped = campaignsList.map((cpn: any) => ({
    id: cpn.id,
    image_url: cpn.image_url || cpn.imageUrl,
    title: cpn.title,
    description: cpn.description,
    cta_text: cpn.ctaText || cpn.cta_text,
    link_category: cpn.linkCategory || cpn.link_category,
    active: cpn.active,
  }));

  const { error } = await supabase.from('campaigns').upsert(mapped);
  if (error) return jsonError('Failed to sync campaigns', 500);
  return c.json({ success: true });
});

/* ---------------------------------------------------------------------------
 * CMS layout config
 * ------------------------------------------------------------------------- */

app.get('/api/catalog/cms', async (c) => {
  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const { data, error } = await supabase.from('cms_config').select('value').eq('key', 'main').single();
  if (error || !data) return jsonError('CMS configuration not found.', 404);
  return c.json(data.value);
});

app.post('/api/catalog/cms', async (c) => {
  const admin = await getAdminSession(c.req.raw, c.env);
  if (!admin) return jsonError('Unauthenticated administrative request.', 401);

  const cmsConfig = await c.req.json().catch(() => null);
  if (!cmsConfig) return jsonError('Invalid CMS payload.');

  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const { error } = await supabase.from('cms_config').upsert({ key: 'main', value: cmsConfig });
  if (error) return jsonError('Failed to sync CMS layout', 500);
  return c.json({ success: true });
});

/* ---------------------------------------------------------------------------
 * ST Courier delivery rate proxy
 * ------------------------------------------------------------------------- */

const ST_COURIER_RATE_URL = 'https://stcourier.com/tools/do_getrate';

interface StCourierQuote {
  cost: number | null;
  provider: string;
  source: 'st-courier' | 'unavailable';
  checkedAt: string;
  message?: string;
}

const stCourierQuoteCache = new Map<string, { quote: StCourierQuote; expiresAt: number }>();
const ST_COURIER_CACHE_TTL_MS = 10 * 60 * 1000;

async function fetchStCourierRate(env: Env, pincode: string, weightGrams: number, dimensions: { lengthCm: number; widthCm: number; heightCm: number }): Promise<StCourierQuote | null> {
  try {
    const pickup = (env.ST_COURIER_PICKUP_PINCODE || '629401').replace(/\D/g, '').slice(0, 6);
    const form = new FormData();
    form.append('org_pincode', pickup);
    form.append('dest_pincode', pincode);
    form.append('dest_country', '');
    form.append('doc_type', 'N');
    form.append('act_weight', String(Math.min(Math.max(Math.round(weightGrams), 1), 10000)));
    form.append('weight_label', 'gram');
    form.append('d_act_weight', 'gram');
    form.append('length', String(dimensions.lengthCm));
    form.append('width', String(dimensions.widthCm));
    form.append('height', String(dimensions.heightCm));
    form.append('q_type', 'DM');

    const response = await fetch(ST_COURIER_RATE_URL, {
      method: 'POST',
      body: form,
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://stcourier.com/rate-calculator',
        'User-Agent': 'MerisEshop/1.0 (+delivery rate proxy)',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) return null;
    const json: any = await response.json().catch(() => null);
    const rate = Number(json?.res?.rate);
    if (json?.code !== 200 || !Number.isFinite(rate) || rate <= 0) return null;

    return {
      cost: Math.round(rate),
      provider: String(json.res.name || 'ST Courier'),
      source: 'st-courier',
      checkedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    console.warn('[ST Courier] Rate lookup failed:', err?.message || err);
    return null;
  }
}

app.post('/api/shipping/stcourier-rate', async (c) => {
  const limit = checkRateLimit(c.req.raw, '/api/shipping/stcourier-rate', 40, 15 * 60 * 1000);
  if (!limit.ok) {
    c.header('Retry-After', String(limit.retryAfterSec));
    return jsonError(`Too many requests. Please try again in ${limit.retryAfterSec} seconds.`, 429);
  }

  const body = await c.req.json().catch(() => ({}));
  const pincode = String(body?.pincode || '').replace(/\D/g, '');
  const weightGrams = Math.round(Number(body?.weightGrams));
  const dimensions = {
    lengthCm: Math.ceil(Number(body?.lengthCm)),
    widthCm: Math.ceil(Number(body?.widthCm)),
    heightCm: Math.ceil(Number(body?.heightCm)),
  };
  const validDimensions = Object.values(dimensions).every((value) => Number.isFinite(value) && value >= 1 && value <= 200);
  if (pincode.length !== 6 || !Number.isFinite(weightGrams) || weightGrams <= 0 || !validDimensions) {
    return jsonError('Provide a 6-digit destination pincode, a positive weightGrams value, and parcel dimensions from 1 to 200 cm.');
  }

  const grams = Math.min(Math.max(weightGrams, 1), 10000);
  const cacheKey = `${pincode}:${grams}:${dimensions.lengthCm}x${dimensions.widthCm}x${dimensions.heightCm}`;
  const cached = stCourierQuoteCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return c.json({ ...cached.quote, cached: true });
  }

  const liveQuote = await fetchStCourierRate(c.env, pincode, grams, dimensions);
  if (liveQuote) {
    stCourierQuoteCache.set(cacheKey, { quote: liveQuote, expiresAt: Date.now() + ST_COURIER_CACHE_TTL_MS });
    return c.json(liveQuote);
  }

  return c.json({
    cost: null,
    provider: 'ST Courier',
    source: 'unavailable',
    checkedAt: new Date().toISOString(),
    message: 'ST Courier has not published a rate for this lane yet. Delivery charges are not available for checkout.',
  } satisfies StCourierQuote);
});

/* ---------------------------------------------------------------------------
 * Customer account: OTP login, password login, registration, Clerk sync
 * ------------------------------------------------------------------------- */

const OTP_EXPIRY_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_SENDS_PER_HOUR = 5;
const OTP_MAX_VERIFY_ATTEMPTS = 5;

interface OtpRecord {
  code: string;
  expiresAt: number;
  verifyAttempts: number;
  sendCount: number;
  lastSentAt: number;
  windowStartAt: number;
}

function mapOtpRow(row: any): OtpRecord {
  return {
    code: row.code,
    expiresAt: new Date(row.expires_at).getTime(),
    verifyAttempts: row.verify_attempts || 0,
    sendCount: row.send_count || 0,
    lastSentAt: new Date(row.last_sent_at).getTime(),
    windowStartAt: new Date(row.window_start_at).getTime(),
  };
}

function otpToRow(email: string, record: OtpRecord) {
  return {
    email,
    code: record.code,
    expires_at: new Date(record.expiresAt).toISOString(),
    verify_attempts: record.verifyAttempts,
    send_count: record.sendCount,
    last_sent_at: new Date(record.lastSentAt).toISOString(),
    window_start_at: new Date(record.windowStartAt).toISOString(),
  };
}

app.post('/api/send-otp', async (c) => {
  const limit = checkRateLimit(c.req.raw, '/api/send-otp', 30, 15 * 60 * 1000);
  if (!limit.ok) {
    c.header('Retry-After', String(limit.retryAfterSec));
    return jsonError(`Too many requests. Please try again in ${limit.retryAfterSec} seconds.`, 429);
  }

  const body = await c.req.json().catch(() => ({}));
  const email = sanitizeEmail(body?.email);
  if (!email) return jsonError('A valid email address is required.');

  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const now = Date.now();
  const { data: existingRow } = await supabase.from('otp_codes').select('*').eq('email', email).maybeSingle();
  const existing: OtpRecord | null = existingRow ? mapOtpRow(existingRow) : null;

  if (existing && existing.expiresAt > now) {
    const windowElapsed = now - existing.windowStartAt;
    if (windowElapsed < 60 * 60 * 1000 && existing.sendCount >= OTP_MAX_SENDS_PER_HOUR) {
      const retryAfterSec = Math.ceil((60 * 60 * 1000 - windowElapsed) / 1000);
      return jsonError(`Too many OTP requests. Please try again in ${Math.ceil(retryAfterSec / 60)} minutes.`, 429);
    }
    if (now - existing.lastSentAt < OTP_RESEND_COOLDOWN_MS) {
      const retryAfterSec = Math.ceil((OTP_RESEND_COOLDOWN_MS - (now - existing.lastSentAt)) / 1000);
      return jsonError(`Please wait ${retryAfterSec} seconds before requesting another code.`, 429);
    }
  }

  const code = Math.floor(1000 + Math.random() * 9000).toString();
  const record: OtpRecord = {
    code,
    expiresAt: now + OTP_EXPIRY_MS,
    verifyAttempts: 0,
    sendCount: (existing && now - existing.windowStartAt < 60 * 60 * 1000 ? existing.sendCount : 0) + 1,
    lastSentAt: now,
    windowStartAt: existing && now - existing.windowStartAt < 60 * 60 * 1000 ? existing.windowStartAt : now,
  };

  await supabase.from('otp_codes').upsert(otpToRow(email, record));

  // Dispatch via Resend (awaited so the UI only asks for the code once it is sent).
  const sent = await sendOtpEmail(c.env, email, code);
  if (!sent && !c.env.RESEND_API_KEY) {
    return jsonError('Email service is not configured. Set RESEND_API_KEY.', 503);
  }

  return c.json({
    success: true,
    requiresOtp: true,
    message: sent
      ? `Passcode sent to ${email}. Please check your inbox.`
      : `Passcode generated for ${email}, but delivery is delayed. Please wait a moment.`,
    emailMode: 'live',
    expiresInSec: OTP_EXPIRY_MS / 1000,
  });
});

app.post('/api/verify-otp', async (c) => {
  const limit = checkRateLimit(c.req.raw, '/api/verify-otp', 30, 15 * 60 * 1000);
  if (!limit.ok) {
    c.header('Retry-After', String(limit.retryAfterSec));
    return jsonError(`Too many requests. Please try again in ${limit.retryAfterSec} seconds.`, 429);
  }

  const body = await c.req.json().catch(() => ({}));
  const email = sanitizeEmail(body?.email);
  const code = sanitizeString(body?.code, 8).replace(/\s/g, '');
  if (!email || !code) return jsonError('Email address and code are required.');
  if (!/^\d{4,8}$/.test(code)) return jsonError('Invalid OTP format.');

  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const { data: row } = await supabase.from('otp_codes').select('*').eq('email', email).maybeSingle();
  if (!row) return jsonError('OTP expired or not found. Please request a new code.');
  const record = mapOtpRow(row);

  if (record.expiresAt <= Date.now()) {
    await supabase.from('otp_codes').delete().eq('email', email);
    return jsonError('OTP expired or not found. Please request a new code.');
  }
  if (record.verifyAttempts >= OTP_MAX_VERIFY_ATTEMPTS) {
    await supabase.from('otp_codes').delete().eq('email', email);
    return jsonError('Too many failed attempts. Please request a new OTP.', 429);
  }
  if (record.code !== code) {
    record.verifyAttempts += 1;
    await supabase.from('otp_codes').update({ verify_attempts: record.verifyAttempts }).eq('email', email);
    const remaining = OTP_MAX_VERIFY_ATTEMPTS - record.verifyAttempts;
    return jsonError(
      remaining > 0
        ? `Invalid verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
        : 'Invalid verification code.',
    );
  }

  await supabase.from('otp_codes').delete().eq('email', email);

  // Auto-ensure the customer record exists.
  const customerName = email.split('@')[0];
  const { data: existingCustomer } = await supabase.from('customers').select('id, email, name').eq('email', email).maybeSingle();
  if (!existingCustomer) {
    await supabase.from('customers').upsert({
      id: `cust_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      email,
      name: customerName,
      auth_provider: 'otp',
      last_sign_in_at: new Date().toISOString(),
    });
  }

  return c.json({
    success: true,
    message: 'OTP verified successfully.',
    email,
    name: existingCustomer?.name || customerName,
    verifiedAt: new Date().toISOString(),
  });
});

app.post('/api/login-customer', async (c) => {
  const limit = checkRateLimit(c.req.raw, '/api/login-customer', 60, 15 * 60 * 1000);
  if (!limit.ok) {
    c.header('Retry-After', String(limit.retryAfterSec));
    return jsonError(`Too many requests. Please try again in ${limit.retryAfterSec} seconds.`, 429);
  }

  const body = await c.req.json().catch(() => ({}));
  const email = sanitizeEmail(body?.email);
  const password = typeof body?.password === 'string' ? body.password.slice(0, 256) : '';
  if (!email || !password) return jsonError('Email and password are required.');

  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const { data: row } = await supabase.from('customers').select('*').eq('email', email).maybeSingle();
  if (!row) return jsonError('No account found with this email. Please check spelling or click "Sign Up".', 401);
  if (!row.password_hash) {
    return jsonError('This account was registered via OTP. Please sign in using OTP code.', 401);
  }

  const isValid = await verifyCustomerPassword(password, row.password_hash);
  if (!isValid) return jsonError('Incorrect password. Please try again.', 401);

  // Touch last sign-in timestamp.
  await supabase.from('customers').update({ last_sign_in_at: new Date().toISOString() }).eq('email', email);

  return c.json({ success: true, customer: { id: row.id, email: row.email, name: row.name } });
});

app.post('/api/register-customer', async (c) => {
  const limit = checkRateLimit(c.req.raw, '/api/register-customer', 30, 15 * 60 * 1000);
  if (!limit.ok) {
    c.header('Retry-After', String(limit.retryAfterSec));
    return jsonError(`Too many requests. Please try again in ${limit.retryAfterSec} seconds.`, 429);
  }

  const body = await c.req.json().catch(() => ({}));
  const email = sanitizeEmail(body?.email);
  const name = sanitizeString(body?.name, 100);
  const password = typeof body?.password === 'string' ? body.password.slice(0, 256) : '';
  if (!email || !name || !password) return jsonError('Name, email, and password are required.');

  const validation = validatePassword(password);
  if (!validation.valid) return jsonError(validation.errors[0] || 'Password does not meet security criteria.');

  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const { data: existing } = await supabase.from('customers').select('id').eq('email', email).maybeSingle();
  if (existing) return jsonError('An account with this email already exists.');

  const passwordHash = await hashCustomerPassword(password);
  const newCustomer = {
    id: `cust_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    email,
    name,
    password_hash: passwordHash,
    created_at: new Date().toISOString(),
    auth_provider: 'email',
  };

  const { error } = await supabase.from('customers').upsert(newCustomer, { onConflict: 'email' });
  if (error) return jsonError('Failed to complete registration.', 500);

  // Welcome email via Resend (non-blocking response, errors only logged).
  sendWelcomeEmail(c.env, email, name).catch((err) => console.error('[Registration] Welcome email failed:', err));

  return c.json({ success: true, message: 'Account registered successfully.' });
});

app.post('/api/auth/clerk-sync', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { clerkId, email, name, phone, imageUrl, authProvider } = body || {};
  const sanitizedEmail = sanitizeEmail(email);
  if (!sanitizedEmail) return jsonError('Valid email is required for Clerk user sync.');

  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const customerObj = {
    id: clerkId ? `clerk_${clerkId}` : `cust_${Date.now()}`,
    clerk_id: clerkId || null,
    email: sanitizedEmail,
    name: sanitizeString(name || sanitizedEmail.split('@')[0], 100),
    phone: sanitizeString(phone || '', 30),
    image_url: typeof imageUrl === 'string' ? imageUrl : '',
    auth_provider: authProvider || 'clerk',
    last_sign_in_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('customers').upsert(customerObj, { onConflict: 'email' });
  if (error) return jsonError('Failed to sync Clerk user.', 500);
  return c.json({ success: true, customer: customerObj });
});

/* ---------------------------------------------------------------------------
 * Customers (public aggregate for account panel; admin list is auth-guarded)
 * ------------------------------------------------------------------------- */

async function fetchOrdersRaw(supabase: any): Promise<any[]> {
  const { data } = await supabase.from('orders').select('*');
  return data || [];
}

app.get('/api/customers', async (c) => {
  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const ordersList = await fetchOrdersRaw(supabase);
  const { data, error } = await supabase.from('customers').select('*').order('created_at', { ascending: false });
  if (error) return jsonError('Failed to fetch customer list', 500);

  const customerList = (data || []).map(mapCustomerRow);

  // Calculate customer metrics from orders.
  const emailToOrdersMap = new Map<string, any[]>();
  ordersList.forEach((order: any) => {
    const email = String(order.account_email || order.customer_info?.email || '').toLowerCase().trim();
    if (!email) return;
    if (!emailToOrdersMap.has(email)) emailToOrdersMap.set(email, []);
    emailToOrdersMap.get(email)!.push(order);
  });

  const enrichedCustomers = customerList.map((cust) => {
    const userOrders = emailToOrdersMap.get(cust.email.toLowerCase()) || [];
    const ordersCount = userOrders.length;
    const totalSpent = userOrders.reduce((sum: number, o: any) => sum + Number(o.total || 0), 0);
    const sortedDates = userOrders.map((o: any) => o.date || o.created_at).filter(Boolean).sort().reverse();
    const lastOrderDate = sortedDates[0] || null;

    let tier: 'Platinum' | 'Gold' | 'Silver' | 'Bronze' = 'Bronze';
    if (ordersCount >= 8 || totalSpent >= 10000) tier = 'Platinum';
    else if (ordersCount >= 4 || totalSpent >= 4000) tier = 'Gold';
    else if (ordersCount >= 1) tier = 'Silver';

    return { ...cust, ordersCount, totalSpent, lastOrderDate, tier };
  });

  return c.json(enrichedCustomers);
});

/* ---------------------------------------------------------------------------
 * Email log (admin)
 * ------------------------------------------------------------------------- */

app.get('/api/emails', async (c) => {
  const admin = await getAdminSession(c.req.raw, c.env);
  if (!admin) return jsonError('Unauthenticated administrative request.', 401);

  const supabase = getSupabase(c.env);
  if (!supabase) return c.json([]);

  let query = supabase
    .from('email_logs')
    .select('id, recipient, subject, sent_at, order_number, status, date_text')
    .order('created_at', { ascending: false })
    .limit(500);

  const recipient = c.req.query('recipient');
  if (recipient) query = query.eq('recipient', recipient.toLowerCase());

  const { data, error } = await query;
  if (error || !data) return c.json([]);
  return c.json(data.map((e: any) => ({
    id: e.id,
    recipient: e.recipient,
    subject: e.subject,
    sentAt: e.sent_at,
    orderNumber: e.order_number,
    status: e.status,
    dateText: e.date_text,
  })));
});

/* ---------------------------------------------------------------------------
 * Orders
 * ------------------------------------------------------------------------- */

app.get('/api/orders', async (c) => {
  const admin = await getAdminSession(c.req.raw, c.env);
  if (!admin) return jsonError('Unauthenticated administrative request.', 401);

  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
  if (error) return jsonError('Failed to read orders database', 500);
  return c.json((data || []).map(mapOrderRow));
});

// Secure order lookup — requires the account email to prevent PII enumeration.
app.get('/api/orders/:orderNumber', async (c) => {
  const limit = checkRateLimit(c.req.raw, '/api/orders/lookup', 20, 15 * 60 * 1000);
  if (!limit.ok) {
    c.header('Retry-After', String(limit.retryAfterSec));
    return jsonError(`Too many requests. Please try again in ${limit.retryAfterSec} seconds.`, 429);
  }

  const orderNum = sanitizeString(c.req.param('orderNumber'), 30).toUpperCase();
  if (!orderNum || !/^[A-Z0-9\-_]+$/.test(orderNum)) return jsonError('Invalid order number format.');

  const emailParam = sanitizeEmail(c.req.query('email'));
  if (!emailParam) return jsonError('Your account email is required to look up an order. Provide ?email=your@email.com');

  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const { data } = await supabase.from('orders').select('*').or(`order_number.eq.${orderNum},id.eq.${orderNum}`).limit(1);
  const row = (data || [])[0];
  if (!row) return jsonError(`Order ${orderNum} was not found.`, 404);

  const orderEmail = String(row.account_email || row.customer_info?.email || '').toLowerCase().trim();
  if (orderEmail !== emailParam) return jsonError(`Order ${orderNum} was not found.`, 404);

  return c.json(mapOrderRow(row));
});

app.post('/api/orders', async (c) => {
  const limit = checkRateLimit(c.req.raw, '/api/orders', 10, 15 * 60 * 1000);
  if (!limit.ok) {
    c.header('Retry-After', String(limit.retryAfterSec));
    return jsonError(`Too many requests. Please try again in ${limit.retryAfterSec} seconds.`, 429);
  }

  const newOrder = await c.req.json().catch(() => null);
  if (!newOrder || !newOrder.orderNumber) return jsonError('Invalid order data.');

  newOrder.orderNumber = sanitizeString(newOrder.orderNumber, 30);

  const accountEmail = sanitizeEmail(newOrder.account?.email || newOrder.accountEmail);
  const customerEmail = sanitizeEmail(newOrder.customerInfo?.email);
  if (!accountEmail) return jsonError('Login is required before placing an order.', 401);
  if (!customerEmail || customerEmail !== accountEmail) {
    return jsonError('Checkout email must match the signed-in account.', 403);
  }
  if (!Array.isArray(newOrder.items) || newOrder.items.length === 0) {
    return jsonError('Cannot place an empty order.');
  }

  newOrder.accountEmail = accountEmail;
  newOrder.accountName = newOrder.account?.name || newOrder.accountName || newOrder.customerInfo?.name || '';
  delete newOrder.account;

  const isCodOrder = newOrder.paymentMethod?.toLowerCase().includes('cash on delivery') ||
    newOrder.paymentMethod?.toUpperCase() === 'COD';
  if (isCodOrder) {
    newOrder.paymentMethod = 'Cash on Delivery';
    newOrder.paymentStatus = newOrder.paymentStatus || 'unpaid';
    newOrder.codStatus = newOrder.codStatus || 'pending';
  }

  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const { error: upsertErr } = await supabase.from('orders').upsert(orderToRow(newOrder));
  if (upsertErr) {
    console.error('[Orders] Upsert failed:', upsertErr.message);
    return jsonError('Failed to save order to database', 500);
  }
  console.log(`[Orders] Registered new secure order: ${newOrder.orderNumber} (Method: ${newOrder.paymentMethod})`);

  // Dispatch confirmation emails via Resend (non-blocking).
  sendBookingEmail(c.env, newOrder).catch((err) => console.error('[Orders] Booking email failed:', err));
  sendAdminVendorNotificationEmail(c.env, newOrder).catch((err) => console.error('[Orders] Admin email failed:', err));

  return c.json({ success: true, order: newOrder }, 201);
});

app.post('/api/orders/:orderNumber/status', async (c) => {
  const admin = await getAdminSession(c.req.raw, c.env);
  if (!admin) return jsonError('Unauthenticated administrative request.', 401);

  const orderNum = c.req.param('orderNumber').trim().toUpperCase();
  const { status, codStatus, paymentStatus } = await c.req.json().catch(() => ({}));
  if (!status && !codStatus && !paymentStatus) return jsonError('Status, COD status, or payment status is required.');

  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const { data } = await supabase.from('orders').select('*').or(`order_number.eq.${orderNum},id.eq.${orderNum}`).limit(1);
  const row = (data || [])[0];
  if (!row) return jsonError(`Order ${orderNum} not found.`, 404);

  const updates: any = {};
  if (status) updates.status = status;
  if (codStatus) updates.cod_status = codStatus;
  if (paymentStatus) updates.payment_status = paymentStatus;

  const { data: updated, error } = await supabase.from('orders').update(updates).eq('id', row.id).select().single();
  if (error) return jsonError('Failed to update order status', 500);
  return c.json({ success: true, order: mapOrderRow(updated) });
});

app.put('/api/orders/:orderNumber', async (c) => {
  const admin = await getAdminSession(c.req.raw, c.env);
  if (!admin) return jsonError('Unauthenticated administrative request.', 401);

  const orderNum = c.req.param('orderNumber').trim().toUpperCase();
  const updatedOrder = await c.req.json().catch(() => null);
  if (!updatedOrder) return jsonError('Invalid order payload.');

  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const { data } = await supabase.from('orders').select('*').or(`order_number.eq.${orderNum},id.eq.${orderNum}`).limit(1);
  const row = (data || [])[0];
  if (!row) return jsonError(`Order ${orderNum} not found.`, 404);

  const oldPaymentStatus = row.payment_status;
  const newPaymentStatus = updatedOrder.paymentStatus;

  const merged = { ...mapOrderRow(row), ...updatedOrder };
  const { data: updated, error } = await supabase.from('orders').update(orderToRow(merged)).eq('id', row.id).select().single();
  if (error) {
    console.error('[Orders] Update failed:', error.message);
    return jsonError('Failed to update order', 500);
  }

  // Payment-status transition emails via Resend.
  if (oldPaymentStatus === 'pending' && newPaymentStatus === 'paid') {
    try {
      await sendBookingEmail(c.env, merged);
      await sendAdminVendorNotificationEmail(c.env, merged);
    } catch (emailErr) {
      console.error('[Orders] Confirmation email failed:', emailErr);
    }
  } else if (oldPaymentStatus === 'pending' && newPaymentStatus === 'rejected') {
    try {
      await sendPaymentEmail(c.env, merged, 'rejected', merged.upiRejectionReason);
    } catch (emailErr) {
      console.error('[Orders] Rejection email failed:', emailErr);
    }
  }

  return c.json({ success: true, order: mapOrderRow(updated) });
});

app.delete('/api/orders/:orderNumber', async (c) => {
  const admin = await getAdminSession(c.req.raw, c.env);
  if (!admin) return jsonError('Unauthenticated administrative request.', 401);

  const orderNum = c.req.param('orderNumber').trim().toUpperCase();
  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const { error } = await supabase.from('orders').delete().or(`order_number.eq.${orderNum},id.eq.${orderNum}`);
  if (error) return jsonError('Failed to delete order from database', 500);
  return c.json({ success: true, message: `Order ${orderNum} deleted.` });
});

/* ---------------------------------------------------------------------------
 * Admin authentication
 * ------------------------------------------------------------------------- */

app.post('/api/admin/login', async (c) => {
  const limit = checkRateLimit(c.req.raw, '/api/admin/login', 5, 15 * 60 * 1000);
  if (!limit.ok) {
    c.header('Retry-After', String(limit.retryAfterSec));
    return jsonError(`Too many attempts. Please try again in ${limit.retryAfterSec} seconds.`, 429);
  }

  const body = await c.req.json().catch(() => ({}));
  const username = sanitizeString(body?.username, 100);
  const password = typeof body?.password === 'string' ? body.password.slice(0, 256) : '';
  if (!username || !password) return jsonError('Username and password fields are required.');

  const config = await loadAdminCredentials(c.env, username);
  if (!config) return jsonError('Administrative credentials are not provisioned yet.', 503);

  const usernameMatch = username.length === config.username.length &&
    username === config.username;
  if (usernameMatch && verifyAdminPassword(password, config.password)) {
    const token = await signJwt({ username, role: 'admin' }, c.env.JWT_SECRET, 2 * 60 * 60);
    c.header('Set-Cookie', adminCookie(token));
    return c.json({ success: true, username });
  }
  return jsonError('Invalid administrative credentials.', 401);
});

app.get('/api/admin/session', async (c) => {
  const admin = await getAdminSession(c.req.raw, c.env);
  if (!admin) return jsonError('Administrative session expired or invalid.', 401);
  return c.json({ authenticated: true, username: admin.username });
});

app.post('/api/admin/logout', (c) => {
  c.header('Set-Cookie', clearedAdminCookie());
  return c.json({ success: true, message: 'Admin session cleared.' });
});

app.post('/api/admin/change-password', async (c) => {
  const admin = await getAdminSession(c.req.raw, c.env);
  if (!admin) return jsonError('Unauthenticated administrative request.', 401);

  const body = await c.req.json().catch(() => ({}));
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword.slice(0, 256) : '';
  if (!newPassword) return jsonError('New password is required.');
  if (newPassword.length < 8) return jsonError('Password must be at least 8 characters long.');

  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const hashed = hashAdminPassword(newPassword);
  const { error } = await supabase.from('admin_config').upsert({
    username: admin.username,
    password: hashed,
  });
  if (error) return jsonError('Failed to change password', 500);
  return c.json({ success: true, message: 'Administrative credentials updated successfully.' });
});

app.post('/api/admin/config', async (c) => {
  const admin = await getAdminSession(c.req.raw, c.env);
  if (!admin) return jsonError('Unauthenticated administrative request.', 401);

  const body = await c.req.json().catch(() => ({}));
  const username = sanitizeString(body?.username, 100);
  const password = typeof body?.password === 'string' ? body.password.slice(0, 256) : '';
  if (!username || !password) return jsonError('Username and password fields are required.');

  const validation = validatePassword(password);
  if (!validation.valid) {
    return jsonError(validation.errors[0] || 'Admin password does not meet strength requirements.');
  }

  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const hashed = hashAdminPassword(password);
  const { error } = await supabase.from('admin_config').upsert({ username, password: hashed });
  if (error) return jsonError('Failed to save admin credentials', 500);
  return c.json({ success: true, message: 'Administrative credentials updated successfully.' });
});

app.get('/api/admin/customers', async (c) => {
  const admin = await getAdminSession(c.req.raw, c.env);
  if (!admin) return jsonError('Unauthenticated administrative request.', 401);

  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const { data, error } = await supabase
    .from('customers')
    .select('id, email, name, created_at')
    .order('created_at', { ascending: false });
  if (error) return jsonError('Failed to fetch customer credentials list', 500);
  return c.json((data || []).map((cust: any) => ({
    id: cust.id,
    email: cust.email,
    name: cust.name,
    createdAt: cust.created_at,
  })));
});

app.get('/api/admin/live-activity', async (c) => {
  const admin = await getAdminSession(c.req.raw, c.env);
  if (!admin) return jsonError('Unauthenticated administrative request.', 401);

  // Live session tracking is per-isolate ephemeral state on Workers.
  return c.json({
    sessions: [
      { ip: '—', type: 'info', activePage: 'Sessions are tracked per Cloudflare edge location', cartTotal: 0, durationSeconds: 0, lastActive: Date.now() },
    ],
    alerts: [],
    stats: {
      activeVisitors: 0,
      todayVisitors: 0,
      todayOrders: 0,
      avgSessionMinutes: 0,
      abandonedCount: 0,
      newUsers: 0,
      returningUsers: 0,
    },
    liveRevenue: 0,
  });
});

app.get('/api/admin/security-stats', async (c) => {
  const admin = await getAdminSession(c.req.raw, c.env);
  if (!admin) return jsonError('Unauthenticated administrative request.', 401);

  return c.json({
    stats: {
      securityScore: 98,
      failedAttempts: 0,
      blockedIps: 0,
      activeAdminSessions: 1,
      expiredTokens: 0,
      lastScanDate: new Date().toLocaleTimeString(),
      dbEncryption: 'AES-256 Active (Supabase)',
      sslStatus: 'Active (Cloudflare Edge)',
      wafStatus: 'Active (Cloudflare WAF + Rate-Limits)',
    },
    threatLogs: [],
  });
});

app.post('/api/admin/test-email', async (c) => {
  const admin = await getAdminSession(c.req.raw, c.env);
  if (!admin) return jsonError('Unauthenticated administrative request.', 401);

  const body = await c.req.json().catch(() => ({}));
  const targetEmail = sanitizeEmail(body?.email || body?.to);
  if (!targetEmail) return jsonError('Valid target email address is required.');

  const sent = await sendTestEmail(c.env, targetEmail);
  if (sent) return c.json({ success: true, message: `Test email successfully delivered to ${targetEmail}!` });
  return jsonError('Failed to dispatch test email. Check RESEND_API_KEY and the verified sender domain.', 500);
});

/* ---------------------------------------------------------------------------
 * Payments — Razorpay
 * ------------------------------------------------------------------------- */

function getRazorpayAuth(env: Env) {
  const keyId = env.RAZORPAY_KEY_ID;
  const keySecret = env.RAZORPAY_KEY_SECRET;
  if (!isConfigured(keyId) || !isConfigured(keySecret)) return null;
  return { keyId: keyId!.trim(), keySecret: keySecret!.trim() };
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function razorpaySignatureIsValid(rawSecret: string, payload: string, receivedSignature: string): Promise<boolean> {
  const expected = await hmacSha256Hex(rawSecret, payload);
  const received = String(receivedSignature || '');
  if (expected.length !== received.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  return mismatch === 0;
}

async function applyRazorpayResult(env: Env, params: {
  orderNumber?: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  paid: boolean;
  gatewayStatus?: string;
}) {
  const orderNumber = sanitizeString(params.orderNumber || '', 30);
  const razorpayOrderId = sanitizeString(params.razorpayOrderId || '', 80);
  if (!orderNumber && !razorpayOrderId) return null;

  const supabase = getSupabase(env);
  if (!supabase) return null;

  let query = supabase.from('orders').select('*');
  if (orderNumber && razorpayOrderId) {
    query = query.or(`order_number.eq.${orderNumber.toUpperCase()},razorpay_order_id.eq.${razorpayOrderId}`);
  } else if (orderNumber) {
    query = query.eq('order_number', orderNumber.toUpperCase());
  } else {
    query = query.eq('razorpay_order_id', razorpayOrderId);
  }
  const { data } = await query.limit(1);
  const row = (data || [])[0];
  if (!row) return null;

  const previousPaymentStatus = row.payment_status;
  const updates: any = {
    payment_method: 'Razorpay Secure Online Payment',
    payment_status: params.paid ? 'paid' : 'rejected',
    status: params.paid ? 'processing' : row.status,
    razorpay_order_id: params.razorpayOrderId || row.razorpay_order_id,
    razorpay_payment_id: params.razorpayPaymentId || row.razorpay_payment_id,
    razorpay_signature: params.razorpaySignature || row.razorpay_signature,
    razorpay_status: params.gatewayStatus || (params.paid ? 'captured' : 'failed'),
  };

  const { data: updated, error } = await supabase.from('orders').update(updates).eq('id', row.id).select().single();
  if (error) return null;

  if (previousPaymentStatus !== 'paid' && params.paid) {
    const order = mapOrderRow(updated);
    try {
      await sendBookingEmail(env, order);
      await sendAdminVendorNotificationEmail(env, order);
    } catch (notifyErr) {
      console.error('[Razorpay] Confirmation notifications failed:', notifyErr);
    }
  }
  return mapOrderRow(updated);
}

app.post('/api/razorpay/create-order', async (c) => {
  const limit = checkRateLimit(c.req.raw, '/api/razorpay/create-order', 20, 15 * 60 * 1000);
  if (!limit.ok) {
    c.header('Retry-After', String(limit.retryAfterSec));
    return jsonError(`Too many requests. Please try again in ${limit.retryAfterSec} seconds.`, 429);
  }

  const auth = getRazorpayAuth(c.env);
  if (!auth) return jsonError('Razorpay is not configured yet. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET secrets before accepting online payments.', 503);

  const body = await c.req.json().catch(() => ({}));
  const orderNumber = sanitizeString(body?.orderNumber, 30);
  const amount = Math.round(Number(body?.amount) * 100) / 100;
  if (!orderNumber || !Number.isFinite(amount) || amount <= 0) return jsonError('Missing order number or a positive amount.');

  const razorpayOrder = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + btoa(`${auth.keyId}:${auth.keySecret}`),
    },
    body: JSON.stringify({
      amount: Math.round(amount * 100),
      currency: 'INR',
      receipt: orderNumber,
      notes: {
        orderNumber,
        customer: sanitizeString(body?.customerName || '', 80),
        email: sanitizeEmail(body?.email) || '',
      },
    }),
  });

  const rzpJson: any = await razorpayOrder.json().catch(() => ({}));
  if (!razorpayOrder.ok || !rzpJson?.id) {
    console.error('[Razorpay] Order creation failed:', rzpJson);
    return jsonError(rzpJson?.error?.description || 'Razorpay order creation failed.', 502);
  }

  return c.json({
    keyId: auth.keyId,
    amount: rzpJson.amount,
    currency: rzpJson.currency || 'INR',
    razorpayOrderId: rzpJson.id,
    orderNumber,
  });
});

app.post('/api/razorpay/verify', async (c) => {
  const limit = checkRateLimit(c.req.raw, '/api/razorpay/verify', 40, 15 * 60 * 1000);
  if (!limit.ok) {
    c.header('Retry-After', String(limit.retryAfterSec));
    return jsonError(`Too many requests. Please try again in ${limit.retryAfterSec} seconds.`, 429);
  }

  const auth = getRazorpayAuth(c.env);
  if (!auth) return jsonError('Razorpay is not configured on the server.', 503);

  const body = await c.req.json().catch(() => ({}));
  const razorpayOrderId = sanitizeString(body?.razorpay_order_id, 80);
  const razorpayPaymentId = sanitizeString(body?.razorpay_payment_id, 80);
  const razorpaySignature = String(body?.razorpay_signature || '');
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return jsonError('Missing Razorpay verification parameters.');
  }

  const valid = await razorpaySignatureIsValid(auth.keySecret, `${razorpayOrderId}|${razorpayPaymentId}`, razorpaySignature);
  if (!valid) return jsonError('Payment signature verification failed.', 400);

  await applyRazorpayResult(c.env, {
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
    paid: true,
    gatewayStatus: 'captured',
  });

  return c.json({ verified: true, razorpayOrderId, razorpayPaymentId });
});

app.post('/api/razorpay/webhook', async (c) => {
  const rawBody = await c.req.text();
  const webhookSecret = c.env.RAZORPAY_WEBHOOK_SECRET;
  if (!isConfigured(webhookSecret)) return jsonError('Razorpay webhook secret is not configured.', 503);

  const signature = c.req.header('x-razorpay-signature') || '';
  const valid = await razorpaySignatureIsValid(webhookSecret!.trim(), rawBody, signature);
  if (!valid) return jsonError('Invalid webhook signature.', 400);

  const parsed = JSON.parse(rawBody || '{}');
  const event = parsed?.event || '';
  const payment = parsed?.payload?.payment?.entity || {};
  const orderNumber = sanitizeString(payment.notes?.orderNumber, 30);

  if (event === 'payment.captured' || event === 'payment.authorized') {
    await applyRazorpayResult(c.env, {
      orderNumber,
      razorpayOrderId: payment.order_id,
      razorpayPaymentId: payment.id,
      paid: true,
      gatewayStatus: event === 'payment.captured' ? 'captured' : 'authorized',
    });
  } else if (event === 'payment.failed') {
    await applyRazorpayResult(c.env, {
      orderNumber,
      razorpayOrderId: payment.order_id,
      razorpayPaymentId: payment.id,
      paid: false,
      gatewayStatus: 'failed',
    });
  }

  return c.json({ ok: true });
});

/* ---------------------------------------------------------------------------
 * Payments — PayU (legacy)
 * ------------------------------------------------------------------------- */

function buildPayURequestHashString(params: Record<string, any>, merchantKey: string, merchantSalt: string): string {
  const amount = Number(params.amount).toFixed(2);
  return [
    merchantKey.trim(),
    String(params.txnid || '').trim(),
    amount,
    String(params.productinfo || '').trim(),
    String(params.firstname || '').trim(),
    String(params.email || '').trim(),
    String(params.udf1 || ''),
    String(params.udf2 || ''),
    String(params.udf3 || ''),
    String(params.udf4 || ''),
    String(params.udf5 || ''),
    '', '', '', '', '',
    merchantSalt.trim(),
  ].join('|');
}

function buildPayUResponseHashString(payload: Record<string, any>, merchantSalt: string): string {
  const amount = Number(payload.amount || 0).toFixed(2);
  return [
    merchantSalt.trim(),
    String(payload.status || '').trim(),
    '', '', '', '', '',
    String(payload.udf5 || '').trim(),
    String(payload.udf4 || '').trim(),
    String(payload.udf3 || '').trim(),
    String(payload.udf2 || '').trim(),
    String(payload.udf1 || '').trim(),
    String(payload.email || '').trim(),
    String(payload.firstname || '').trim(),
    String(payload.productinfo || '').trim(),
    amount,
    String(payload.txnid || '').trim(),
    String(payload.key || '').trim(),
  ].join('|');
}

async function sha512Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-512', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPayUResponse(env: Env, payload: Record<string, any>): Promise<{ verified: boolean; calculatedHash: string; error?: string }> {
  const merchantSalt = env.PAYU_MERCHANT_SALT;
  if (!isConfigured(merchantSalt)) {
    return { verified: false, calculatedHash: '', error: 'PayU salt is not configured.' };
  }
  const calculatedHash = await sha512Hex(buildPayUResponseHashString(payload, merchantSalt!));
  const receivedHash = String(payload.hash || '').toLowerCase();
  return {
    verified: Boolean(receivedHash) && calculatedHash.toLowerCase() === receivedHash,
    calculatedHash,
  };
}

async function applyPayUResult(env: Env, payload: Record<string, any>, fallbackStatus: 'success' | 'failure') {
  const txnid = sanitizeString(payload.txnid || payload.udf1, 60);
  if (!txnid) return null;

  const supabase = getSupabase(env);
  if (!supabase) return null;

  const { data } = await supabase.from('orders').select('*').or(`order_number.eq.${txnid.toUpperCase()},payu_txn_id.eq.${txnid.toUpperCase()}`).limit(1);
  const row = (data || [])[0];
  if (!row) return null;

  const previousPaymentStatus = row.payment_status;
  const gatewayStatus = String(payload.status || fallbackStatus).toLowerCase();
  const paid = gatewayStatus === 'success';

  const updates: any = {
    payment_method: 'PayU Secure Online Payment',
    payment_status: paid ? 'paid' : 'rejected',
    status: paid ? 'processing' : row.status,
    payu_txn_id: txnid,
    payu_payment_id: payload.mihpayid || payload.payuMoneyId || payload.bank_ref_num || row.payu_payment_id,
    payu_hash: payload.hash || row.payu_hash,
    payu_status: gatewayStatus,
  };

  const { data: updated, error } = await supabase.from('orders').update(updates).eq('id', row.id).select().single();
  if (error) return null;

  if (previousPaymentStatus === 'pending' && paid) {
    const order = mapOrderRow(updated);
    try {
      await sendBookingEmail(env, order);
      await sendAdminVendorNotificationEmail(env, order);
    } catch (notifyErr) {
      console.error('[PayU] Confirmation notifications failed:', notifyErr);
    }
  }
  return mapOrderRow(updated);
}

app.post('/api/payu/hash', async (c) => {
  const limit = checkRateLimit(c.req.raw, '/api/payu/hash', 20, 15 * 60 * 1000);
  if (!limit.ok) {
    c.header('Retry-After', String(limit.retryAfterSec));
    return jsonError(`Too many requests. Please try again in ${limit.retryAfterSec} seconds.`, 429);
  }

  const merchantKey = c.env.PAYU_MERCHANT_KEY;
  const merchantSalt = c.env.PAYU_MERCHANT_SALT;
  if (!isConfigured(merchantKey) || !isConfigured(merchantSalt)) {
    return jsonError('PayU is not configured yet. Set PAYU_MERCHANT_KEY and PAYU_MERCHANT_SALT secrets before accepting online payments.', 503);
  }

  const body = await c.req.json().catch(() => ({}));
  const txnid = sanitizeString(body?.txnid, 60);
  const amount = Number(body?.amount);
  const productinfo = sanitizeString(body?.productinfo, 120);
  const firstname = sanitizeString(body?.firstname, 80);
  const email = sanitizeEmail(body?.email);
  if (!txnid || !Number.isFinite(amount) || amount <= 0 || !productinfo || !firstname || !email) {
    return jsonError('Missing required PayU parameters.');
  }

  const payload = {
    txnid,
    amount: amount.toFixed(2),
    productinfo,
    firstname,
    email,
    udf1: sanitizeString(body?.udf1 || txnid, 60),
    udf2: sanitizeString(body?.udf2 || '', 60),
    udf3: sanitizeString(body?.udf3 || '', 60),
    udf4: sanitizeString(body?.udf4 || '', 60),
    udf5: sanitizeString(body?.udf5 || '', 60),
  };

  const hash = await sha512Hex(buildPayURequestHashString(payload, merchantKey!, merchantSalt!));
  const appUrl = getPublicAppUrl(c.env, c.req.raw);

  return c.json({
    success: true,
    key: merchantKey,
    ...payload,
    hash,
    environment: c.env.PAYU_ENV === 'production' ? 'production' : 'test',
    actionUrl: c.env.PAYU_ENV === 'production' ? 'https://secure.payu.in/_payment' : 'https://test.payu.in/_payment',
    surl: c.env.PAYU_SUCCESS_URL || `${appUrl}/api/payu/success`,
    furl: c.env.PAYU_FAILURE_URL || `${appUrl}/api/payu/failure`,
  });
});

app.post('/api/payu/verify', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const verification = await verifyPayUResponse(c.env, body || {});
  const order = verification.verified
    ? await applyPayUResult(c.env, body, body?.status === 'success' ? 'success' : 'failure')
    : null;
  return c.json({
    success: verification.verified,
    verified: verification.verified,
    status: body?.status,
    txnid: body?.txnid,
    payuMoneyId: body?.mihpayid,
    order,
  });
});

async function payuRedirectEndpoint(c: any, fallback: 'success' | 'failure') {
  let payload: Record<string, any> = {};
  const contentType = c.req.header('Content-Type') || '';
  if (contentType.includes('application/json')) {
    payload = await c.req.json().catch(() => ({}));
  } else if (contentType.includes('form')) {
    const form = await c.req.parseBody().catch(() => ({}));
    for (const [key, value] of Object.entries(form)) {
      if (typeof value === 'string') payload[key] = value;
    }
  }
  for (const [key, value] of Object.entries(c.req.query())) payload[key] = value;

  const verification = await verifyPayUResponse(c.env, payload);
  if (verification.verified) await applyPayUResult(c.env, payload, fallback);

  const appUrl = getPublicAppUrl(c.env, c.req.raw);
  const order = encodeURIComponent(String(payload.txnid || payload.udf1 || ''));
  const resultParam = fallback === 'success'
    ? (verification.verified ? 'success' : 'verification_failed')
    : 'failure';
  return c.redirect(`${appUrl}/?payu=${resultParam}&order=${order}`, 302);
}

app.all('/api/payu/success', (c) => payuRedirectEndpoint(c, 'success'));
app.all('/api/payu/failure', (c) => payuRedirectEndpoint(c, 'failure'));

app.post('/api/payu/webhook', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const verification = await verifyPayUResponse(c.env, body || {});
  if (!verification.verified) return jsonError('Invalid PayU hash.', 400);
  const order = await applyPayUResult(c.env, body, body?.status === 'success' ? 'success' : 'failure');
  return c.json({ success: true, order });
});

/* ---------------------------------------------------------------------------
 * Gemini AI endpoints
 * ------------------------------------------------------------------------- */

const API_CACHE_TTL = 1000 * 60 * 60;
const apiCache = new Map<string, { data: any; timestamp: number }>();

function getCached(key: string): any | null {
  const cached = apiCache.get(key);
  if (cached && Date.now() - cached.timestamp < API_CACHE_TTL) return cached.data;
  return null;
}

function setCached(key: string, data: any) {
  apiCache.set(key, { data, timestamp: Date.now() });
}

function getGeminiModelsUrl(env: Env, method: 'generateContent' = 'generateContent'): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:${method}?key=${env.GEMINI_API_KEY}`;
}

async function callGeminiJson(env: Env, systemPrompt: string, userPrompt: string): Promise<any | null> {
  if (!isConfigured(env.GEMINI_API_KEY)) return null;
  try {
    const response = await fetch(getGeminiModelsUrl(env), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      console.warn('[Gemini] HTTP', response.status);
      return null;
    }
    const data: any = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return JSON.parse(text);
  } catch (err: any) {
    console.warn('[Gemini] Call failed:', err?.message || err);
    return null;
  }
}

app.post('/api/gemini/recommendations', async (c) => {
  const limit = checkRateLimit(c.req.raw, '/api/gemini/recommendations', 20, 60 * 1000);
  if (!limit.ok) {
    c.header('Retry-After', String(limit.retryAfterSec));
    return jsonError(`Too many requests. Please try again in ${limit.retryAfterSec} seconds.`, 429);
  }

  const { cartItems, recentlyViewedIds, allProducts } = await c.req.json().catch(() => ({}));

  const cartKeyToken = cartItems?.map((item: any) => `${item.product.id}:${item.quantity}`).join(',') || '';
  const viewedKeyToken = recentlyViewedIds?.join(',') || '';
  const cacheKey = `recs_${cartKeyToken}_viewed_${viewedKeyToken}`;
  const cachedResult = getCached(cacheKey);
  if (cachedResult) return c.json(cachedResult);

  const fallbacks = {
    conciergeCommentary: 'We noticed your fine interest in our handcrafted selections. To complement your lifestyle, our personal concierge highly suggests looking at our signature hand-foliaged journals and carved rosewood storage solutions, both reflecting the highest standards of our 2025 heritage roots.',
    recommendedProductIds: ['stat-1', 'wood-1', 'home-1'].filter((id: string) => !recentlyViewedIds?.includes(id)),
  };

  const cartContext = cartItems?.map((item: any) => `${item.product.name} (Qty: ${item.quantity})`).join(', ') || 'Empty Cart';
  const viewedContext = allProducts?.filter((p: any) => recentlyViewedIds?.includes(p.id))?.map((p: any) => p.name).join(', ') || 'None';
  const catalogSummary = allProducts?.map((p: any) => `ID: ${p.id}, Sku: ${p.sku}, Name: ${p.name}, Price: ₹${p.price}, Category: ${p.category}`).join('\n') || '';

  const systemPrompt = `You are the Virtual Boutique Concierge at "MERIS E-SHOP", an ultra-premium, family-friendly e-commerce store sharing handcrafted gifts, toys, stencils, and leather bags.
Analyze user's shopping context and recommend EXACTLY 3 complementary products from the store catalogue. Write a luxurious, friendly, high-society commentary (1-2 sentences) about why these are perfect additions, matching their style.

Strict Requirements:
1. ONLY recommend products that exist in the provided catalogue list.
2. Output your response as a strict JSON matching this schema:
{"conciergeCommentary": "commentary string", "recommendedProductIds": ["id1", "id2", "id3"]}`;

  const userPrompt = `USER CONTEXT:
Items currently in cart: [${cartContext}]
Items recently browsed: [${viewedContext}]

STORE CATALOGUE AVAILABLE:
${catalogSummary}

Generate the recommendations JSON strictly adhering to the schema.`;

  const parsed = await callGeminiJson(c.env, systemPrompt, userPrompt);
  if (parsed && parsed.conciergeCommentary && Array.isArray(parsed.recommendedProductIds)) {
    setCached(cacheKey, parsed);
    return c.json(parsed);
  }
  return c.json(fallbacks);
});

app.post('/api/ai/listing', async (c) => {
  const limit = checkRateLimit(c.req.raw, '/api/ai/listing', 10, 60 * 1000);
  if (!limit.ok) {
    c.header('Retry-After', String(limit.retryAfterSec));
    return jsonError(`Too many requests. Please try again in ${limit.retryAfterSec} seconds.`, 429);
  }

  const { prompt } = await c.req.json().catch(() => ({}));
  if (!isConfigured(c.env.GEMINI_API_KEY)) {
    return c.json({ success: false, error: 'AI listing requires a Gemini API key.' });
  }

  const aiPrompt = `You are a creative product listing assistant for a Indian handmade gift e-commerce store (MERIS E-SHOP).
Your task:
1. Suggest a warm, human-sounding product name (max 6 words, in English) based on the listing prompt.
2. Suggest a short product description (max 4 sentences) describing the item, its materials, and its use. Keep the tone warm and personal (not robotic).
3. Suggest the best matching category from this list: Kids Toys, Wood Crafted Gifts, Handbags & Clutches, Learning Stuff, Home Organizers, Kolam Stencils, Novelty Stationeries, Entertainment & Novelties, Return Gift Bottles.

Respond ONLY as a clean JSON object with exactly these keys: {"name": "...", "description": "...", "category": "..."}.
Do not add any other text, explanations, or markdown formatting.

Listing prompt: ${sanitizeAiPrompt(prompt, 300)}`;

  const parsed = await callGeminiJson(c.env, 'You output only clean JSON product listings.', aiPrompt);
  if (parsed && parsed.name && parsed.description && parsed.category) {
    return c.json({ success: true, data: parsed });
  }
  return c.json({ success: false, error: 'Failed to generate AI listing. Please try again.' });
});

app.post('/api/gemini/search', async (c) => {
  const limit = checkRateLimit(c.req.raw, '/api/gemini/search', 20, 60 * 1000);
  if (!limit.ok) {
    c.header('Retry-After', String(limit.retryAfterSec));
    return jsonError(`Too many requests. Please try again in ${limit.retryAfterSec} seconds.`, 429);
  }

  const body = await c.req.json().catch(() => ({}));
  const rawQuery = body?.query;
  const query = sanitizeAiPrompt(rawQuery, 200);
  const allCategories = body?.allCategories;

  const getLocalSearchFallback = () => {
    const qLower = query?.toLowerCase() || '';
    let slug = '';
    let responseText = `We are searching our premium vaults for "${query}".`;
    if (qLower.includes('toy') || qLower.includes('kid') || qLower.includes('child')) {
      slug = 'toys';
      responseText = 'We recommend exploring our Kids Toys section; our handcrafted stacking toys make magnificent presents.';
    } else if (qLower.includes('wood') || qLower.includes('box') || qLower.includes('gift')) {
      slug = 'wood-gifts';
      responseText = 'Discover our carved Wood Crafts section, fully loaded with antique rosewood lockboxes and honeycomb bookshelves.';
    } else if (qLower.includes('bag') || qLower.includes('purse') || qLower.includes('tote')) {
      slug = 'handbags';
      responseText = 'Browse sustainable, top-tier handbags, vintage wrist bags, and handwoven luxury pouches.';
    } else if (qLower.includes('kolam') || qLower.includes('stencil') || qLower.includes('rangoli') || qLower.includes('festive')) {
      slug = 'kolam';
      responseText = 'Prepare for festive celebrations with our laser-cut acrylic Kolam stencils and mandala templates.';
    }
    return {
      suggestedCategorySlug: slug,
      aiSuggestions: ['wooden stacking', 'crochet bunny', 'rosewood box', 'gold notebook'].filter((x) => x.includes(qLower) || qLower.length <= 2).slice(0, 3),
      smartQueryResponse: responseText,
    };
  };

  const cacheKey = `search_${(query || '').toLowerCase().trim()}`;
  const cachedResult = getCached(cacheKey);
  if (cachedResult) return c.json(cachedResult);

  if (!isConfigured(c.env.GEMINI_API_KEY)) return c.json(getLocalSearchFallback());

  const categoriesContext = allCategories?.map((cat: any) => `${cat.name} (slug: ${cat.id})`).join(', ') || '';
  const systemPrompt = `You are the smart search dispatcher for MERIS E-SHOP.
Users search for items using casual phrases (e.g. "gift for my nephew" or "laser designs for holi" or "something to carry cosmetics").
Your goal is to parse their intention and return:
1. suggestedCategorySlug: The matched category slug from our list that best fits (or empty string if none).
2. aiSuggestions: Array of 2-3 precise short search term recommendations.
3. smartQueryResponse: A conversational greeting explaining why you targeted this direction with high elegance.

Available Category categories and slugs:
[${categoriesContext}]

Output in strict JSON format matching the schema:
{"suggestedCategorySlug": "string representing the slug, or empty", "aiSuggestions": ["string1", "string2"], "smartQueryResponse": "Brief luxury human explanation"}`;

  const parsed = await callGeminiJson(c.env, systemPrompt, `Search query inputted by user: "${query}"`);
  if (parsed && 'suggestedCategorySlug' in parsed) {
    setCached(cacheKey, parsed);
    return c.json(parsed);
  }
  return c.json(getLocalSearchFallback());
});

app.post('/api/gemini/invoice', async (c) => {
  const { order } = await c.req.json().catch(() => ({}));

  const customerName = order?.customerInfo?.name || 'Customer';
  const itemNames = order?.items?.map((it: any) => `${it.product.name} (x${it.quantity})`).join(', ') || 'Items';

  const getLocalInvoiceFallback = () => {
    const delivery = order?.shippingMethod === 'express' ? '3 days via BlueDart express' : '5-7 business days';
    return {
      greetingText: `Dear ${customerName}, we are absolutely thrilled to secure your order representing India's brilliant cottage craftsmen! Our local woodturners and master artisans are hand-inspecting and packing your ${itemNames} right now inside our Tamil Nadu workshop. Your support fuels genuine livelihoods.`,
      invoiceVerificationCode: `MERIS-CRN-${Math.floor(100000 + Math.random() * 900000)}`,
      estimatedDeliveryDate: `Approx. delivery in ${delivery}`,
    };
  };

  const cacheKey = `invoice_${order?.id || JSON.stringify(order?.customerInfo || {})}`;
  const cachedResult = getCached(cacheKey);
  if (cachedResult) return c.json(cachedResult);

  if (!isConfigured(c.env.GEMINI_API_KEY)) return c.json(getLocalInvoiceFallback());

  const prompt = `Write a premium, heartwarming customer confirmation letter from the founders of MERIS E-SHOP.
Customer Name: ${sanitizeString(customerName, 100)}
Purchased Items: ${sanitizeString(itemNames, 300)}
Total Cart Amount: ₹${Number(order?.total || 0)}
Shipping Mode: ${sanitizeString(order?.shippingMethod || 'standard', 30)}

Tone: Grateful, extremely warm, storytelling-focused, emphasizing local craftsmanship, hand-finished quality control, and standard delivery timelines.
Also, generate a 12-character unique e-receipt serial verification hash starting with 'MERIS-'.
Finally, approximate an elegant delivery date estimate.

JSON Output Schema:
{"greetingText": "The founders appreciation story letter text", "invoiceVerificationCode": "MERIS-XXXXX", "estimatedDeliveryDate": "Elegant text format of delivery"}`;

  const parsed = await callGeminiJson(c.env, 'You output only clean JSON invoice greetings.', prompt);
  if (parsed && parsed.greetingText) {
    setCached(cacheKey, parsed);
    return c.json(parsed);
  }
  return c.json(getLocalInvoiceFallback());
});

/* ---------------------------------------------------------------------------
 * Newsletter
 * ------------------------------------------------------------------------- */

app.post('/api/newsletter', async (c) => {
  const limit = checkRateLimit(c.req.raw, '/api/newsletter', 3, 60 * 60 * 1000);
  if (!limit.ok) {
    c.header('Retry-After', String(limit.retryAfterSec));
    return jsonError(`Too many requests. Please try again in ${limit.retryAfterSec} seconds.`, 429);
  }

  const body = await c.req.json().catch(() => ({}));
  const normalizedEmail = sanitizeEmail(body?.email);
  if (!normalizedEmail) return jsonError('Valid email address is required.');

  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const { data: existing } = await supabase.from('newsletter').select('id').eq('email', normalizedEmail).maybeSingle();
  if (existing) return jsonError('This email is already subscribed.', 409);

  const { error: insertError } = await supabase.from('newsletter').insert({
    id: `sub_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    email: normalizedEmail,
    subscribed_at: new Date().toISOString(),
    status: 'active',
    source: 'footer_newsletter',
  });

  if (insertError) {
    if (insertError.code === '23505') return jsonError('This email is already subscribed.', 409);
    console.error('[Newsletter] Insert failed:', insertError.message);
    return jsonError('Failed to subscribe. Please try again.', 500);
  }

  return c.json({ success: true, message: 'Successfully subscribed to newsletter!' });
});

app.get('/api/newsletter', async (c) => {
  const admin = await getAdminSession(c.req.raw, c.env);
  if (!admin) return jsonError('Unauthenticated administrative request.', 401);

  const supabase = getSupabase(c.env);
  if (!supabase) return c.json([]);

  const { data, error } = await supabase
    .from('newsletter')
    .select('id, email, subscribed_at, status, source')
    .order('subscribed_at', { ascending: false });
  if (error || !data) return c.json([]);
  return c.json(data.map((s: any) => ({
    id: s.id,
    email: s.email,
    subscribedAt: s.subscribed_at,
    status: s.status,
    source: s.source,
  })));
});

/* ---------------------------------------------------------------------------
 * SEO endpoints
 * ------------------------------------------------------------------------- */

app.get('/sitemap.xml', async (c) => {
  const supabase = getSupabase(c.env);
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://meriseshop.com/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://meriseshop.com/category/toys</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://meriseshop.com/category/wood-gifts</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;
  if (supabase) {
    const { data: products } = await supabase.from('products').select('id');
    (products || []).forEach((p: any) => {
      xml += `
  <url>
    <loc>https://meriseshop.com/product/${escapeHtml(p.id)}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`;
    });
  }
  xml += `
</urlset>`;
  return c.body(xml, 200, { 'Content-Type': 'application/xml' });
});

app.get('/robots.txt', (c) => c.text(`User-agent: *
Allow: /
Disallow: /api/admin/
Sitemap: https://meriseshop.com/sitemap.xml
`, 200, { 'Content-Type': 'text/plain' }));

/* ---------------------------------------------------------------------------
 * Image upload → Supabase Storage (admin)
 * ------------------------------------------------------------------------- */

const PRODUCT_IMAGE_BUCKET_DEFAULT = 'product-images';
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

app.post('/api/upload-image', async (c) => {
  const admin = await getAdminSession(c.req.raw, c.env);
  if (!admin) return jsonError('Unauthenticated administrative request.', 401);

  const supabase = getSupabase(c.env);
  if (!supabase) return jsonError('Supabase is not configured.', 503);

  const form = await c.req.parseBody().catch(() => null);
  const fileEntry = form?.image;
  if (!fileEntry || typeof fileEntry === 'string') return jsonError('No image file received.');

  const file = fileEntry as File;
  const ext = ALLOWED_IMAGE_TYPES[file.type];
  if (!ext) return jsonError('Only image files (JPEG, PNG, WebP, GIF, AVIF) are allowed.');
  if (file.size > 10 * 1024 * 1024) return jsonError('Image exceeds the 10 MB size limit.');

  const bucket = c.env.SUPABASE_STORAGE_BUCKET || PRODUCT_IMAGE_BUCKET_DEFAULT;
  const objectPath = `products/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${ext}`;
  const buffer = await file.arrayBuffer();

  const { error } = await supabase.storage.from(bucket).upload(objectPath, buffer, {
    contentType: file.type,
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) {
    console.error('[Upload] Supabase Storage upload failed:', error.message);
    return jsonError('Product image upload failed. Check the Supabase Storage bucket and service role key.', 500);
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
  return c.json({
    url: data.publicUrl,
    filename: objectPath.split('/').pop(),
    storagePath: objectPath,
    storageBucket: bucket,
  });
});

/* ---------------------------------------------------------------------------
 * 404 fallback for unknown API routes
 * ------------------------------------------------------------------------- */

app.all('/api/*', (c) => jsonError('API route not found.', 404));

export default app;
