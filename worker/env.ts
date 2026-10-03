/**
 * MERIS E-SHOP — Cloudflare Worker environment bindings.
 * All secrets are configured via `wrangler secret put` (or .dev.vars locally).
 */

export interface Env {
  // Cloudflare static-assets binding (serves the Vite SPA from /dist)
  ASSETS: Fetcher;

  // Public app URL — email links, PayU callbacks
  APP_URL?: string;
  APP_NAME?: string;

  // Security
  JWT_SECRET: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;

  // Supabase admin database
  SUPABASE_URL?: string;
  SUPABASE_KEY?: string;
  SUPABASE_STORAGE_BUCKET?: string;

  // Resend mail service
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  ADMIN_NOTIFICATION_EMAIL?: string;

  // Gemini AI
  GEMINI_API_KEY?: string;

  // Razorpay payments
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;

  // PayU payments (legacy)
  PAYU_MERCHANT_KEY?: string;
  PAYU_MERCHANT_SALT?: string;
  PAYU_ENV?: string;
  PAYU_SUCCESS_URL?: string;
  PAYU_FAILURE_URL?: string;

  // ST Courier delivery rate proxy
  ST_COURIER_PICKUP_PINCODE?: string;
}

/** Parse a Hono context cookie header into a plain object. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}
