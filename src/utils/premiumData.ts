import { Vendor, BundleOffer, BulkOrderInquiry, Product } from '../types';

export const INITIAL_VENDORS: Vendor[] = [
  {
    id: 'vendor-1',
    name: 'Bharath Nair',
    email: 'bharath@kanyakumariwood.in',
    phone: '+91 94432 10455',
    storeName: 'Kanyakumari Wood Craftsmen Studios',
    description: 'Generational teakwood and sheesham furniture carvers supplying chemical-free solid-wood goods.',
    approved: true,
    commissionRate: 12,
    status: 'active',
    revenue: 48950,
    logoUrl: 'https://images.unsplash.com/photo-1590486803833-1c5dc8ddd4c8?w=150&auto=format&fit=crop'
  },
  {
    id: 'vendor-2',
    name: 'Meera Devi',
    email: 'meera@azhagappapuralooms.org',
    phone: '+91 93421 88402',
    storeName: 'Azhagappapuram Female Loom Cooperatives',
    description: 'Weaving hand-spun cotton yarns, organic jute slings, and vintage wool knit blankets to empower women artisans.',
    approved: true,
    commissionRate: 8,
    status: 'active',
    revenue: 29400,
    logoUrl: 'https://images.unsplash.com/photo-1559251606-c623743a6d76?w=150&auto=format&fit=crop'
  },
  {
    id: 'vendor-3',
    name: 'Thangavel Pandian',
    email: 'tpandian@rangoliacrylics.co.in',
    phone: '+91 98944 65633',
    storeName: 'Pandian Precision Laser Engravings',
    description: 'Laser-cutting acrylics and brass casting for Kolam boards, mandala trackers, and holy entrance panels.',
    approved: false, // For testing pending lists
    commissionRate: 15,
    status: 'pending',
    revenue: 0,
    logoUrl: 'https://images.unsplash.com/photo-1605001011156-cbf0b0f67a51?w=150&auto=format&fit=crop'
  }
];

export const INITIAL_BUNDLES: BundleOffer[] = [
  {
    id: 'bundle-toys',
    name: 'Artisanal Toy Jamboree',
    bundleType: 'category-qty',
    primaryTarget: 'Kids Toys',
    quantityRequired: 2,
    discountType: 'percentage',
    discountValue: 10,
    description: 'Purchase any 2 or more of our handcrafted sensory Kids Toys and enjoy 10% off automatically on those items!',
    active: true
  },
  {
    id: 'bundle-combo-leather',
    name: 'Boutique Carry & Keep Combo',
    bundleType: 'combo-fixed',
    primaryTarget: 'bag-1,wood-1', // bag-1 (Saddle Tote) + wood-1 (Keepsake Box)
    discountType: 'flat',
    discountValue: 100,
    description: 'Pair the luxury Serena Vegan Saddle Tote with our Royal Carved Wood Keepsake Box for a flat Rs.100 combo reward!',
    active: true
  }
];

// Seasonal Promo pages configs
export interface SeasonalDeal {
  title: string;
  subtitle: string;
  bannerImage: string;
  themeColor: string;
  glowColor: string;
  badge: string;
  discountSummary: string;
  productsToShow: string[]; // ids
  customGreeting: string;
}

export const SEASONAL_LANDINGS: Record<string, SeasonalDeal> = {
  diwali: {
    title: 'Divine Joy of Deepavali Curation',
    subtitle: 'Illuminate your hallways with organic hand-fired brass and traditional motif tracers.',
    bannerImage: 'https://images.unsplash.com/photo-1605001011156-cbf0b0f67a51?w=1200&auto=format&fit=crop&q=80',
    themeColor: 'from-orange-600 via-amber-500 to-yellow-500',
    glowColor: 'rgba(217, 119, 6, 0.4)',
    badge: 'Festival of Lights Special',
    discountSummary: 'Flat Rs.150 OFF + Premium Gift Wrapping Free on all Kolam Stencils & Brass products.',
    productsToShow: ['kolam-1', 'wood-1', 'home-1'],
    customGreeting: 'As you light oil deepams to welcome Lakshmi, let traditional artisanal stencils spread auspicious alignments across your threshold.'
  },
  christmas: {
    title: 'Merry Forest Cabin Solstice',
    subtitle: 'Share snuggly hand-knit crochet buddies and warm candle-glow memories.',
    bannerImage: 'https://images.unsplash.com/photo-1544816155-12df9643f363?w=1200&auto=format&fit=crop&q=80',
    themeColor: 'from-red-700 via-emerald-800 to-emerald-950',
    glowColor: 'rgba(16, 185, 129, 0.4)',
    badge: 'Yuletide Winter Warmth',
    discountSummary: 'Free Pine-wood Keepsake Card + 10% Off on Snuggle Crochet Toys and Pine-wood Bookshelves.',
    productsToShow: ['toy-2', 'wood-2', 'home-1'],
    customGreeting: 'Gather under cozy light. This winter, support rural women weavers by sending organic-cotton companions to nieces and nephews.'
  },
  newyear: {
    title: 'New Horizons Creative Planners',
    subtitle: 'Embrace clear visions for the calendar with archival gold-gilded flax liners.',
    bannerImage: 'https://images.unsplash.com/photo-1531346878377-a5be20888e57?w=1200&auto=format&fit=crop&q=80',
    themeColor: 'from-slate-900 via-zinc-800 to-yellow-600',
    glowColor: 'rgba(234, 179, 8, 0.3)',
    badge: 'Year 2027 Awakening',
    discountSummary: 'Buy selected Linens and receive custom initials hot-pressed in real gold leaf foil.',
    productsToShow: ['stat-1', 'wood-1'],
    customGreeting: 'A pristine page holds endless possibilities. Document daily goals on stout acid-proof sheets that endure generation to generation.'
  },
  raksha: {
    title: 'Sacred Bond Rakhri Keepsakes',
    subtitle: 'Secure bonds with handloom bracelets and elegant lockboxes.',
    bannerImage: 'https://images.unsplash.com/photo-1590486803833-1c5dc8ddd4c8?w=1200&auto=format&fit=crop&q=80',
    themeColor: 'from-pink-600 via-indigo-600 to-purple-800',
    glowColor: 'rgba(168, 85, 247, 0.4)',
    badge: 'Raksha Bandhan Curation',
    discountSummary: 'Complimentary handcrafted silk threads and wooden kumkum box with every Rosewood Chest.',
    productsToShow: ['wood-1', 'toy-2'],
    customGreeting: 'A promise of shield. Honor sibling memories by encasing keepsakes and protection threads inside genuine aromatherapy rosewood.'
  },
  childrens: {
    title: 'Curious Minds Childrens Day Joy',
    subtitle: 'Nurture motor precision with non-toxic herbal wooden stackers.',
    bannerImage: 'https://images.unsplash.com/photo-1515488042361-404e9250afef?w=1200&auto=format&fit=crop&q=80',
    themeColor: 'from-blue-600 via-cyan-500 to-teal-400',
    glowColor: 'rgba(6, 182, 212, 0.4)',
    badge: 'Nurture & Play Special',
    discountSummary: 'Buy Stacking Rings and get Abacus sliders for 20% off combined bundle discount.',
    productsToShow: ['toy-1', 'learn-1', 'toy-2'],
    customGreeting: 'Children deserve touchpoints that support creative discovery, fully free of harsh synthetic plastic coatings.'
  }
};

// Precise and automated Bundle and Coupon calculator for CART & CHECKOUT
export interface CartTotals {
  subtotal: number;
  bundleDiscount: number;
  bundleAppliedNames: string[];
  couponDiscount: number;
  tax: number;
  shippingCost: number;
  shippingWeightKg: number;
  billableWeightKg: number;
  shippingZone: string;
  giftWrappingCost: number;
  grandTotal: number;
}

const PRODUCT_WEIGHT_FALLBACKS_KG: Record<string, number> = {
  handbags: 0.8,
  toys: 0.7,
  learning: 0.75,
  stationeries: 0.35,
  entertainment: 1.2,
  home: 0.65,
  kolam: 0.45,
  'wood-gifts': 1,
  bottles: 0.9
};

function parseWeightValueToKg(value?: string | number): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (!value) return null;

  const normalized = value.toLowerCase().replace(/\s+/g, '');
  const match = normalized.match(/(\d+(?:\.\d+)?)(kg|kgs|kilogram|kilograms|g|gm|grams)?/);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = match[2] || '';
  return unit === 'g' || unit === 'gm' || unit === 'grams' ? amount / 1000 : amount;
}

export function isProductFreeShipping(product?: Product | null): boolean {
  if (!product) return false;
  if (product.freeShipping) return true;
  if (product.id === 'test-razorpay-10rs' || product.sku === 'TEST-RZP-10' || product.categorySlug === 'test') return true;
  if (typeof product.weightKg === 'number' && product.weightKg === 0) return true;
  return false;
}

export function isProductGstExempt(product?: Product | null): boolean {
  if (!product) return false;
  if (product.gstExempt) return true;
  if (product.id === 'test-razorpay-10rs' || product.sku === 'TEST-RZP-10' || product.categorySlug === 'test') return true;
  return false;
}

export function getProductWeightKg(product: Product): number {
  // freeShipping products have zero billable weight regardless of specs
  if (isProductFreeShipping(product)) return 0;

  // Explicit numeric weightKg=0 means the seller declared it weightless (digital/freeShipping)
  if (typeof product.weightKg === 'number' && product.weightKg === 0) return 0;

  const explicitWeight = parseWeightValueToKg(product.weightKg);
  if (explicitWeight) return explicitWeight;

  const specWeight = parseWeightValueToKg(product.specifications?.Weight);
  if (specWeight) return specWeight;

  return PRODUCT_WEIGHT_FALLBACKS_KG[product.categorySlug] || 0.5;
}

export function getCartShipmentWeightKg(cartItems: { product: Product; quantity: number }[]): number {
  const total = cartItems.reduce((sum, item) => {
    // freeShipping products contribute zero weight to shipping calculations
    if (isProductFreeShipping(item.product)) return sum;
    return sum + getProductWeightKg(item.product) * item.quantity;
  }, 0);

  return Math.round(total * 100) / 100;
}

// Estimated ST Courier domestic rate card supplied for parcels up to 1 kg.
// When the carrier's live calculator has no published lane rate, checkout uses
// the entry price from the appropriate card range. The displayed range keeps
// the estimate transparent to the customer.
interface StCourierRateCardTier {
  zone: string;
  standard: readonly [number, number];
  priority: readonly [number, number];
}

const ST_COURIER_RATE_CARD: Record<'local' | 'same-state' | 'south-india' | 'rest-of-india', StCourierRateCardTier> = {
  local: {
    zone: 'Local / Intra-city',
    standard: [30, 50],
    priority: [70, 90]
  },
  'same-state': {
    zone: 'Same State (Tamil Nadu)',
    standard: [40, 60],
    priority: [90, 120]
  },
  'south-india': {
    zone: 'South India (Neighboring States)',
    standard: [60, 90],
    priority: [120, 160]
  },
  'rest-of-india': {
    zone: 'North India & Rest of India',
    standard: [90, 150],
    priority: [180, 250]
  }
};

function getStCourierRateCardTier(pincode: string): StCourierRateCardTier {
  const prefix2 = Number(pincode.slice(0, 2));
  const prefix3 = Number(pincode.slice(0, 3));

  // Shipments originate from 629401 in Kanyakumari, Tamil Nadu.
  if (prefix3 === 629) return ST_COURIER_RATE_CARD.local;
  if (prefix2 >= 60 && prefix2 <= 64) return ST_COURIER_RATE_CARD['same-state'];
  if (
    (prefix2 >= 50 && prefix2 <= 53) || // Andhra Pradesh and Telangana
    (prefix2 >= 56 && prefix2 <= 59) || // Karnataka
    (prefix2 >= 67 && prefix2 <= 69)    // Kerala
  ) {
    return ST_COURIER_RATE_CARD['south-india'];
  }
  return ST_COURIER_RATE_CARD['rest-of-india'];
}

function calculateStCourierRateCardCost(
  totalWeightKg: number,
  destinationPincode: string | undefined,
  shippingMethod: 'standard' | 'express',
  subtotal: number
): { cost: number; billableWeightKg: number; zone: string } {
  if (subtotal <= 0 || totalWeightKg <= 0) {
    return { cost: 0, billableWeightKg: 0, zone: 'Free Delivery' };
  }

  const pin = (destinationPincode || '').replace(/\D/g, '');
  const billableWeightKg = Math.max(0.5, Math.ceil(totalWeightKg * 2) / 2);
  if (pin.length !== 6) {
    return { cost: 0, billableWeightKg, zone: 'Enter pincode for delivery estimate' };
  }

  const rateCardTier = getStCourierRateCardTier(pin);
  const rateRange = shippingMethod === 'express' ? rateCardTier.priority : rateCardTier.standard;
  const shipmentSlabs = Math.max(1, Math.ceil(billableWeightKg));
  const serviceName = shippingMethod === 'express' ? 'Priority' : 'Standard';
  const cost = rateRange[0] * shipmentSlabs;

  return {
    cost,
    billableWeightKg,
    zone: `${rateCardTier.zone} — ${serviceName} ₹${rateRange[0]}–₹${rateRange[1]} per kg`
  };
}

export function calculateCartTotals(
  cartItems: { product: Product; quantity: number }[],
  activeCoupon: { code: string; type: 'percentage' | 'flat'; value: number; minimumCartValue: number } | null,
  shippingMethod: 'standard' | 'express',
  giftWrappingRequested?: boolean,
  destinationPincode?: string
): CartTotals {
  let subtotal = 0;
  let bundleDiscount = 0;
  const bundleAppliedNames: string[] = [];

  // 1. Calculate normal subtotal
  cartItems.forEach(item => {
    const price = item.product.discountPrice || item.product.price;
    subtotal += price * item.quantity;
  });

  // 2. Evaluate "Buy 2 Toys -> 10% Off" bundle
  const toyItems = cartItems.filter(item => item.product.categorySlug === 'toys' || item.product.category === 'Kids Toys');
  const toyCount = toyItems.reduce((acc, it) => acc + it.quantity, 0);
  if (toyCount >= 2) {
    let toySavings = 0;
    toyItems.forEach(item => {
      const price = item.product.discountPrice || item.product.price;
      toySavings += Math.round(price * item.quantity * 0.10);
    });
    bundleDiscount += toySavings;
    bundleAppliedNames.push('Artisanal Toy Jamboree (10% Off)');
  }

  // 3. Evaluate "Handbag + Gift Item -> Rs.100 Off" bundle
  const hasHandbag = cartItems.some(item => item.product.categorySlug === 'handbags' || item.product.category === 'Handbags');
  const hasGiftItem = cartItems.some(
    item => item.product.categorySlug === 'wood-gifts' || 
            item.product.category === 'Wood Crafted Gifts' ||
            item.product.categorySlug === 'home' ||
            item.product.category === 'Home Gifts'
  );

  if (hasHandbag && hasGiftItem) {
    bundleDiscount += 100;
    bundleAppliedNames.push('Boutique Carry & Keep Combo (Rs.100 Reward)');
  }

  // Adjusted subtotal prior to coupon
  const adjustedSubtotal = Math.max(0, subtotal - bundleDiscount);

  // 4. Evaluate coupon
  let couponDiscount = 0;
  if (activeCoupon && adjustedSubtotal >= activeCoupon.minimumCartValue) {
    if (activeCoupon.type === 'percentage') {
      couponDiscount = Math.round((adjustedSubtotal * activeCoupon.value) / 100);
    } else {
      couponDiscount = activeCoupon.value;
    }
  }

  // 5. Optional handcrafted gift wrapping
  const giftWrappingCost = giftWrappingRequested ? 70 : 0;

  // 6. Tax (5% GST) — gstExempt products are excluded from the taxable base
  const gstExemptAmount = cartItems.reduce((sum, item) => {
    if (!isProductGstExempt(item.product)) return sum;
    const price = item.product.discountPrice || item.product.price;
    return sum + price * item.quantity;
  }, 0);
  const taxableAmount = Math.max(0, adjustedSubtotal - couponDiscount - gstExemptAmount);
  const tax = Math.round(taxableAmount * 0.05);

  // 7. ST Courier rate-card shipping — freeShipping products contribute 0 weight
  const shippingWeightKg = cartItems.reduce((sum, item) => {
    if (isProductFreeShipping(item.product)) return sum;
    return sum + getProductWeightKg(item.product) * item.quantity;
  }, 0);
  const allFreeShipping = cartItems.length > 0 && cartItems.every(item => isProductFreeShipping(item.product));
  const shippingQuote = allFreeShipping
    ? { cost: 0, billableWeightKg: 0, zone: 'Free Delivery' }
    : calculateStCourierRateCardCost(shippingWeightKg, destinationPincode, shippingMethod, subtotal);
  const shippingCost = allFreeShipping ? 0 : shippingQuote.cost;

  // 8. Grand total payable
  const grandTotal = Math.max(0, taxableAmount + tax + shippingCost + giftWrappingCost);

  return {
    subtotal,
    bundleDiscount,
    bundleAppliedNames,
    couponDiscount,
    tax,
    shippingCost,
    shippingWeightKg,
    billableWeightKg: shippingQuote.billableWeightKg,
    shippingZone: shippingQuote.zone,
    giftWrappingCost,
    grandTotal
  };
}


