/**
 * MERIS E-SHOP — Supabase data-access layer for Cloudflare Workers.
 *
 * Supabase is the single source of truth (the "admin database"): products,
 * categories, coupons, campaigns, CMS config, admin credentials, orders,
 * customers, email logs, newsletter, OTP codes and activity logs all live in
 * PostgreSQL. The old Express server's local JSON-file fallbacks are dropped —
 * Workers have no writable filesystem — and the seed data (mockData.ts) is used
 * only to initialise an empty database on first boot.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './env';
import {
  INITIAL_PRODUCTS,
  INITIAL_COUPONS,
  INITIAL_CAMPAIGNS,
  INITIAL_CMS,
  CATEGORIES,
} from '../src/utils/mockData';

let cachedClient: SupabaseClient | null = null;

export function isSupabaseConfigured(env: Env): boolean {
  const url = env.SUPABASE_URL || '';
  const key = env.SUPABASE_KEY || '';
  return (
    url.trim() !== '' &&
    key.trim() !== '' &&
    !url.includes('YOUR_SUPABASE_') &&
    !key.includes('YOUR_SUPABASE_')
  );
}

export function getSupabase(env: Env): SupabaseClient | null {
  if (!isSupabaseConfigured(env)) return null;
  if (cachedClient) return cachedClient;
  cachedClient = createClient(env.SUPABASE_URL!.trim(), env.SUPABASE_KEY!.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Client-Info': 'meris-eshop-worker' } },
  });
  return cachedClient;
}

export function parseProductWeightKg(product: any): number | undefined {
  if (product?.freeShipping) return 0;
  if (typeof product?.weightKg === 'number' && product.weightKg === 0) return 0;
  if (typeof product?.weightKg === 'number' && Number.isFinite(product.weightKg) && product.weightKg > 0) {
    return product.weightKg;
  }
  const rawWeight = String(product?.specifications?.Weight || '').toLowerCase().replace(/\s+/g, '');
  const match = rawWeight.match(/(\d+(?:\.\d+)?)(kg|kgs|kilogram|kilograms|g|gm|grams)?/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const unit = match[2] || '';
  return unit === 'g' || unit === 'gm' || unit === 'grams' ? amount / 1000 : amount;
}

const PLACEHOLDER_IMAGE = 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=600&auto=format&fit=crop';

export function mapProductRow(p: any) {
  const isTest = p.id === 'test-razorpay-10rs' || p.sku === 'TEST-RZP-10' || p.category_slug === 'test';
  return {
    id: p.id,
    sku: p.sku || `SKU-${p.id}`,
    name: p.name || 'Handcrafted Product',
    category: p.category || 'Handbags',
    categorySlug: p.category_slug || 'handbags',
    price: Number(p.price || 999),
    discountPrice: p.discount_price ? Number(p.discount_price) : undefined,
    stock: p.stock !== undefined ? Number(p.stock) : 10,
    rating: p.rating ? Number(p.rating) : 4.8,
    ratingCount: p.rating_count ? Number(p.rating_count) : 50,
    images: (Array.isArray(p.images) && p.images.length > 0) ? p.images : [PLACEHOLDER_IMAGE],
    shortDescription: p.short_description || '',
    description: p.description || '',
    specifications: p.specifications || {},
    weightKg: isTest ? 0 : parseProductWeightKg(p),
    reviews: Array.isArray(p.reviews) ? p.reviews : [],
    isNew: Boolean(p.is_new),
    isBestseller: Boolean(p.is_bestseller),
    brand: p.brand || 'Meris Couture',
    availability: p.availability || 'in-stock',
    vendorId: p.vendor_id || null,
    freeShipping: Boolean(p.free_shipping || isTest),
    gstExempt: Boolean(p.gst_exempt || isTest),
  };
}

/**
 * Map a categories row. The live schema uses a uuid `id` PK (the storefront
 * slug lives in `slug`); older migrations used text id. Handle both.
 */
export function mapCategoryRow(category: any) {
  const slug = String(category.slug || category.id || '');
  return {
    id: slug,
    name: String(category.name || ''),
    description: String(category.description || ''),
    imageUrl: String(category.image_url || category.imageUrl || ''),
    enabled: category.enabled !== false,
  };
}

/** Convert a slug-keyed category payload to a row for the uuid-id schema. */
export function categoryToRow(category: any, existingId?: string) {
  return {
    ...(existingId ? { id: existingId } : {}),
    slug: category.id,
    name: category.name,
    description: category.description || '',
    image_url: category.imageUrl,
    ...(existingId ? {} : { enabled: category.enabled !== false }),
  };
}

export function mapCouponRow(c: any) {
  return {
    code: c.code,
    type: c.type,
    value: c.value,
    expiryDate: c.expiry_date,
    usageLimit: c.usage_limit,
    usageCount: c.usage_count,
    minimumCartValue: c.minimum_cart_value,
    description: c.description,
    active: c.active,
  };
}

export function mapOrderRow(o: any) {
  return {
    id: o.id,
    orderNumber: o.order_number,
    customerInfo: o.customer_info,
    items: o.items,
    shippingMethod: o.shipping_method,
    shippingCost: o.shipping_cost,
    tax: o.tax,
    discount: o.discount,
    subtotal: o.subtotal,
    total: o.total,
    status: o.status,
    couponCode: o.coupon_code,
    date: o.date,
    paymentMethod: o.payment_method,
    paymentStatus: o.payment_status,
    codStatus: o.cod_status,
    upiTxnId: o.upi_txn_id,
    upiSenderName: o.upi_sender_name,
    upiScreenshot: o.upi_screenshot,
    upiNotes: o.upi_notes,
    upiRejectionReason: o.upi_rejection_reason,
    giftWrappingRequested: o.gift_wrapping_requested,
    giftWrappingType: o.gift_wrapping_type,
    giftMessage: o.gift_message,
    giftSenderName: o.gift_sender_name,
    giftHidePrice: o.gift_hide_price,
    accountEmail: o.account_email,
    accountName: o.account_name,
    razorpayOrderId: o.razorpay_order_id,
    razorpayPaymentId: o.razorpay_payment_id,
    razorpayStatus: o.razorpay_status,
    payuTxnId: o.payu_txn_id,
    payuPaymentId: o.payu_payment_id,
    payuStatus: o.payu_status,
  };
}

export function mapCustomerRow(c: any) {
  return {
    id: c.id,
    clerkId: c.clerk_id || null,
    email: (c.email || '').toLowerCase(),
    name: c.name,
    phone: c.phone || '',
    imageUrl: c.image_url || '',
    authProvider: c.auth_provider || 'email',
    createdAt: c.created_at,
    lastSignInAt: c.last_sign_in_at || c.created_at,
  };
}

export function orderToRow(o: any) {
  return {
    id: o.id,
    order_number: o.orderNumber,
    customer_info: o.customerInfo || {},
    items: o.items || [],
    shipping_method: o.shippingMethod,
    shipping_cost: o.shippingCost,
    tax: o.tax,
    discount: o.discount,
    subtotal: o.subtotal,
    total: o.total,
    status: o.status,
    coupon_code: o.couponCode || null,
    date: o.date,
    payment_method: o.paymentMethod || 'Razorpay',
    payment_status: o.paymentStatus || 'unpaid',
    cod_status: o.codStatus || null,
    upi_txn_id: o.upiTxnId || null,
    upi_sender_name: o.upiSenderName || null,
    upi_screenshot: o.upiScreenshot || null,
    upi_notes: o.upiNotes || null,
    upi_rejection_reason: o.upiRejectionReason || null,
    gift_wrapping_requested: o.giftWrappingRequested || false,
    gift_wrapping_type: o.giftWrappingType || null,
    gift_message: o.giftMessage || null,
    gift_sender_name: o.giftSenderName || null,
    gift_hide_price: o.giftHidePrice || false,
    account_email: o.accountEmail || null,
    account_name: o.accountName || null,
    razorpay_order_id: o.razorpayOrderId || null,
    razorpay_payment_id: o.razorpayPaymentId || null,
    razorpay_signature: o.razorpaySignature || null,
    razorpay_status: o.razorpayStatus || null,
    payu_txn_id: o.payuTxnId || null,
    payu_payment_id: o.payuPaymentId || null,
    payu_hash: o.payuHash || null,
    payu_status: o.payuStatus || null,
    vendor_notified: o.vendorNotified || false,
  };
}

/**
 * Seed an empty Supabase project with the storefront's initial catalog,
 * coupons, campaigns, CMS config and admin credentials. Idempotent.
 */
export async function seedSupabaseDatabase(env: Env): Promise<void> {
  const supabase = getSupabase(env);
  if (!supabase) return;

  try {
    // 1. Products
    const { data: prods } = await supabase.from('products').select('id').limit(1);
    if (!prods || prods.length === 0) {
      console.log('[Seed] Seeding products to Supabase...');
      const mapped = INITIAL_PRODUCTS.map((p: any) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category,
        category_slug: p.categorySlug,
        price: p.price,
        discount_price: p.discountPrice || null,
        stock: p.stock,
        rating: p.rating,
        rating_count: p.ratingCount,
        images: p.images,
        short_description: p.shortDescription,
        description: p.description,
        reviews: p.reviews || [],
        is_new: p.isNew || false,
        is_bestseller: p.isBestseller || false,
        brand: p.brand,
        availability: p.availability,
        vendor_id: p.vendorId || null,
        specifications: { ...(p.specifications || {}), Weight: parseProductWeightKg(p) ? `${parseProductWeightKg(p)} kg` : p.specifications?.Weight },
        free_shipping: Boolean(p.freeShipping),
        gst_exempt: Boolean(p.gstExempt),
      }));
      await supabase.from('products').insert(mapped);
    }

    // 2. Coupons
    const { data: coups } = await supabase.from('coupons').select('code').limit(1);
    if (!coups || coups.length === 0) {
      console.log('[Seed] Seeding coupons to Supabase...');
      const mapped = INITIAL_COUPONS.map((c: any) => ({
        code: c.code,
        type: c.type,
        value: c.value,
        expiry_date: c.expiryDate,
        usage_limit: c.usageLimit,
        usage_count: c.usageCount,
        minimum_cart_value: c.minimumCartValue,
        description: c.description,
        active: c.active,
      }));
      await supabase.from('coupons').insert(mapped);
    }

    // 3. Categories — the live table uses a uuid PK + slug column; detect the
    //    shape so seeds work on both schemas.
    const { data: categoryRows } = await supabase.from('categories').select('*').limit(1);
    if (!categoryRows || categoryRows.length === 0) {
      console.log('[Seed] Seeding categories to Supabase...');
      // Probe whether the table accepts the legacy text-id shape.
      const probe = await supabase.from('categories').insert({
        id: CATEGORIES[0].id,
        name: CATEGORIES[0].name,
        description: CATEGORIES[0].description,
        image_url: CATEGORIES[0].imageUrl,
        enabled: true,
      }).select();
      if (!probe.error) {
        // Legacy text-id schema — insert the rest and finish.
        await supabase.from('categories').insert(CATEGORIES.slice(1).map((category: any) => ({
          id: category.id,
          name: category.name,
          description: category.description,
          image_url: category.imageUrl,
          enabled: true,
        })));
      } else {
        // uuid-id schema with slug column.
        await supabase.from('categories').insert(CATEGORIES.map((category: any) => ({
          slug: category.id,
          name: category.name,
          description: category.description,
          image_url: category.imageUrl,
        })));
      }
    }

    // 4. Campaigns
    const { data: camps } = await supabase.from('campaigns').select('id').limit(1);
    if (!camps || camps.length === 0) {
      console.log('[Seed] Seeding campaigns to Supabase...');
      const mapped = INITIAL_CAMPAIGNS.map((c: any) => ({
        id: c.id,
        image_url: c.imageUrl,
        title: c.title,
        description: c.description,
        cta_text: c.ctaText,
        link_category: c.linkCategory,
        active: c.active,
      }));
      await supabase.from('campaigns').insert(mapped);
    }

    // 5. CMS
    const { data: cmsConf } = await supabase.from('cms_config').select('key').limit(1);
    if (!cmsConf || cmsConf.length === 0) {
      console.log('[Seed] Seeding CMS to Supabase...');
      await supabase.from('cms_config').insert({ key: 'main', value: INITIAL_CMS });
    }

    // 6. Admin credentials
    const { data: adminConf } = await supabase.from('admin_config').select('username').limit(1);
    if (!adminConf || adminConf.length === 0) {
      const targetPass = env.ADMIN_PASSWORD;
      if (targetPass) {
        console.log('[Seed] Seeding admin credentials to Supabase...');
        const { hashAdminPassword } = await import('./auth');
        await supabase.from('admin_config').insert({
          username: env.ADMIN_USERNAME || 'admin',
          password: hashAdminPassword(targetPass),
        });
      } else {
        console.warn('[Seed] ADMIN_PASSWORD not set — skipping admin seeding.');
      }
    }
  } catch (err) {
    console.error('[Seed] Failed to seed Supabase database:', err);
  }
}
