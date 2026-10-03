<div align="center">

# Meris E-Shop

</div>

Premium e-commerce platform for handcrafted kids toys, wood gifts, luxury
handbags, and festive Kolam stencils.

**Now deployable to Cloudflare Workers** with Supabase as the admin database
and Resend as the mail service.

## Architecture

| Layer | Technology |
| :--- | :--- |
| Frontend | React 19 + Vite SPA (Tailwind CSS, dark luxury theme) |
| API | Hono on Cloudflare Workers (`worker/index.ts`) |
| Static hosting | Cloudflare Workers Assets (`dist/`, SPA fallback) |
| Database | Supabase PostgreSQL (products, categories, coupons, campaigns, CMS, orders, customers, admin config, email logs, newsletter, OTP codes) |
| Mail | Resend HTTPS API (`worker/mailer.ts`) — OTP, order confirmation, admin/vendor alerts, payment notices, welcome |
| Payments | Razorpay, UPI/COD |
| AI | Google Gemini (smart search, recommendations, invoice greeting) |

## Quick start (Cloudflare)

```bash
npm install
cp .dev.vars.example .dev.vars    # fill in Supabase + Resend + admin credentials
npm run deploy
```

Full setup steps, secrets list and verification checklist:
**[DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md)**

## Local development

```bash
npm run dev          # Vite SPA on :5173
npm run dev:worker   # Cloudflare Worker on :8787 (needs .dev.vars)
npm run build && npm run dev:worker   # full-stack test on :8787
```

## Useful commands

```bash
npm run lint        # typecheck web + worker
npm run build       # production SPA build to dist/
npm run deploy      # build + wrangler deploy
npx wrangler tail   # stream live Worker logs
```

## Legacy Node server

The original Express server (`server.ts`) remains in the repo for reference.
The Cloudflare deployment does not use it — all backend logic lives in
`worker/` and persists exclusively to Supabase.
