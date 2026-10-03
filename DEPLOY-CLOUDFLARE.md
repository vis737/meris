# Deploying MERIS E-SHOP to Cloudflare

The whole site — storefront, admin panel (`/admin`), REST API, and transactional
email — now runs on **Cloudflare Workers** with **Supabase as the admin
database** and **Resend as the mail service**.

```
Browser ──► Cloudflare Worker (Hono API + static SPA assets)
                │                        │
                ▼                        ▼
        Supabase Postgres          Resend HTTPS API
        (admin database)           (OTP + order email)
```

## 1. Prerequisites

- A Cloudflare account (free plan works — Workers free tier includes 100k requests/day)
- A Supabase project (the existing one works; run the new migration below)
- A [Resend](https://resend.com) account with a verified sending domain
- Node.js 20+

## 2. Install & configure

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in real values
```

`wrangler` will pick you up as the logged-in user on first deploy:

```bash
npx wrangler login
```

## 3. Run the Supabase migration

Open the Supabase SQL Editor and run:

- [supabase_cloudflare_migration.sql](supabase_cloudflare_migration.sql)

This adds the `otp_codes` and `activity_logs` tables plus the
`free_shipping`/`gst_exempt` product flags, customer social-login columns and
Razorpay/PayU order columns used by the Worker. It is idempotent — safe to
re-run. (`supabase_full_migration.sql` should already have been applied; if
not, run that first.)

## 4. Local development

```bash
npm run dev          # Vite dev server on :5173 (SPA hot reload)
npm run dev:worker   # Worker on :8787 (API + built assets)
```

For full-stack local testing, run `npm run build && npm run dev:worker`, then
open http://localhost:8787. API calls from the Vite dev server should be
proxied — add this to `vite.config.ts` `server` block if you need it:

```ts
proxy: { '/api': 'http://localhost:8787', '/uploads': 'http://localhost:8787' }
```

## 5. Production secrets

Every secret is stored as a Cloudflare Workers secret (never in git):

```bash
npx wrangler secret put JWT_SECRET            # node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
npx wrangler secret put SUPABASE_URL          # https://<project>.supabase.co
npx wrangler secret put SUPABASE_KEY          # service_role key
npx wrangler secret put RESEND_API_KEY        # re_xxxxxxxx
npx wrangler secret put RESEND_FROM_EMAIL     # "Meris E-Shop <orders@yourdomain.com>"
npx wrangler secret put ADMIN_NOTIFICATION_EMAIL
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD
# Optional integrations:
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put RAZORPAY_KEY_ID
npx wrangler secret put RAZORPAY_KEY_SECRET
npx wrangler secret put RAZORPAY_WEBHOOK_SECRET
npx wrangler secret put APP_URL               # after first deploy, set to your final URL
```

## 6. Deploy

```bash
npm run deploy        # vite build && wrangler deploy
```

First deploy gives you `https://meris-eshop.<your-subdomain>.workers.dev`.
Add a custom domain in the Cloudflare dashboard (**Workers & Pages →
meris-eshop → Settings → Domains & Routes**) when ready, then
`npx wrangler secret put APP_URL` with that domain.

## 7. Verify the deployment

1. **Storefront** — open the deployed URL; products load from Supabase.
2. **Admin panel** — visit `/admin`, sign in with `ADMIN_USERNAME` /
   `ADMIN_PASSWORD`. Manage products, categories, coupons, campaigns, CMS
   layout, orders and customers — everything persists to Supabase.
3. **Mail** — request an OTP on the login page; the code arrives via Resend.
   Or use **Admin → Security → Test email**. Check Resend → Logs for delivery
   status, and the Supabase `email_logs` table for the audit trail.
4. **Orders** — place a test order with the `test-razorpay-10rs` product or
   Cash on Delivery; the confirmation email fires through Resend.
5. **SEO** — `/sitemap.xml` and `/robots.txt` respond from the Worker.

## Architecture notes

| Concern | Implementation |
| --- | --- |
| API | `worker/index.ts` — Hono router, 40+ endpoints, all `/api/*` |
| Static assets | `dist/` SPA served by the Workers `assets` binding, `not_found_handling: single-page-application` |
| Database | Supabase service-role client in `worker/db.ts`; row mappers for snake_case ↔ camelCase |
| Auth | WebCrypto HS256 JWT in an HttpOnly cookie (`worker/auth.ts`), bcryptjs password hashing |
| Mail | `worker/mailer.ts` — Resend HTTPS API only (no SMTP on Workers) |
| Rate limiting | Per-isolate fixed-window limiter (`worker/utils.ts`) |
| Image uploads | Direct to Supabase Storage via the Worker |
| SEO | `sitemap.xml` and `robots.txt` generated from the live catalog |

The legacy Node/Express server (`server.ts`) and all JSON-file databases are
no longer used by the Cloudflare deployment; they remain in the repo for
reference and local-only testing.
