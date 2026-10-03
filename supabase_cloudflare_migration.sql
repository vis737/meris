-- =============================================================================
-- MERIS E-SHOP — Complete Cloudflare Workers Migration
-- =============================================================================
-- Safe to re-run. Run once in the Supabase SQL Editor:
--   https://supabase.com/dashboard/project/YOUR_PROJECT/sql/new
--
-- Extends supabase_full_migration.sql with:
--   * otp_codes table (email OTP login state, replaces the old in-memory store)
--   * free_shipping / gst_exempt / free_shipping_ columns on products
--   * clerk_id / phone / image_url / auth_provider / last_sign_in_at on customers
--   * razorpay / payu / cod columns on orders
--   * activity_logs table (admin audit trail)
-- =============================================================================

-- 1. PRODUCTS — missing commerce flags ---------------------------------------
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS free_shipping BOOLEAN DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS gst_exempt BOOLEAN DEFAULT false;

-- 2. CUSTOMERS — social login + profile columns ------------------------------
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS clerk_id TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT '';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS auth_provider TEXT DEFAULT 'email';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS last_sign_in_at TIMESTAMPTZ;

-- 3. ORDERS — gateway + COD + vendor notification columns ---------------------
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS razorpay_signature TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS razorpay_status TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payu_txn_id TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payu_payment_id TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payu_hash TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payu_status TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cod_status TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS vendor_notified BOOLEAN DEFAULT false;

-- 4. OTP CODES (replaces the worker's in-memory OTP store) --------------------
CREATE TABLE IF NOT EXISTS public.otp_codes (
  email TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verify_attempts INTEGER DEFAULT 0,
  send_count INTEGER DEFAULT 0,
  window_start_at TIMESTAMPTZ DEFAULT NOW(),
  last_sent_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_codes_expires ON public.otp_codes(expires_at);

-- 5. ACTIVITY LOGS (admin audit trail) ----------------------------------------
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  details TEXT,
  user_name TEXT DEFAULT 'admin',
  risk_level TEXT DEFAULT 'low',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON public.activity_logs(created_at DESC);

-- 6. ROW LEVEL SECURITY + PERMISSIVE POLICIES (service-role key bypasses RLS,
--    but policies keep the tables accessible from any future anon integration).
--    Idempotent DO block, safe to re-run. --------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'otp_codes' AND policyname = 'Allow all otp_codes') THEN
    CREATE POLICY "Allow all otp_codes" ON public.otp_codes FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'activity_logs' AND policyname = 'Allow all activity_logs') THEN
    CREATE POLICY "Allow all activity_logs" ON public.activity_logs FOR ALL USING (true) WITH CHECK (true);
  END IF;
END
$$;

ALTER TABLE public.otp_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
