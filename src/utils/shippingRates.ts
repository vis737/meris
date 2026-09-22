import { CartItem } from '../types';
import { calculateCartTotals, getCartShipmentWeightKg, isProductFreeShipping } from './premiumData';

// ---------------------------------------------------------------------------
// Live delivery-rate quotes from ST Courier (https://stcourier.com/rate-calculator)
//
// The checkout asks our server, which queries ST Courier's rate calculator with
// the store pickup pincode (629401), the customer's destination pincode and the
// cart weight. When ST Courier has not published a rate for that lane, the
// checkout falls back to the supplied domestic rate card in premiumData.
// ---------------------------------------------------------------------------

export interface StCourierRateResult {
  cost: number | null;
  provider: string;
  source: 'st-courier' | 'unavailable';
  checkedAt: string;
  message?: string;
  cached?: boolean;
}

export interface LiveShippingInfo {
  pincode: string;
  shippingMethod: 'standard' | 'express';
  billableWeightKg: number;
  cost: number | null;
  source: 'st-courier' | 'rate-card' | 'unavailable' | 'none';
  provider?: string;
  message?: string;
}

export interface PackageDimensionsCm {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

interface StCourierRateCacheEntry {
  info: LiveShippingInfo;
  expiresAt: number;
}

const stCourierRateCache = new Map<string, StCourierRateCacheEntry>();
const RATE_CACHE_TTL_MS = 10 * 60 * 1000;

export function getCartWeightGrams(cartItems: CartItem[]): number {
  const kg = getCartShipmentWeightKg(cartItems);
  const grams = Math.round(kg * 1000);
  // Return 0 when all items are freeShipping (genuinely zero weight).
  // The 500g sensible default only kicks in for normal products with missing weight data.
  if (grams === 0) {
    const hasNonFreeShippingItem = cartItems.some(item => !isProductFreeShipping(item.product));
    return hasNonFreeShippingItem ? 500 : 0;
  }
  return grams;
}

function getProductDimensionsCm(cartItem: CartItem): PackageDimensionsCm {
  const dimensionEntry = Object.entries(cartItem.product.specifications || {}).find(([key, value]) =>
    /dimension|size/i.test(key) && /\d/.test(String(value))
  );
  const dimensionText = dimensionEntry ? String(dimensionEntry[1]) : '';
  const rawMeasurements = dimensionText.match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
  const multiplier = /\b(?:inch|inches|in)\b|\"/i.test(dimensionText)
    ? 2.54
    : (/\b(?:mm|millimet(?:er|re)s?)\b/i.test(dimensionText) ? 0.1 : 1);
  const measurements = rawMeasurements
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(0, 3)
    .map((value) => value * multiplier);

  // The ST form requires all three dimensions. If a catalog listing provides
  // only L × W, use a 1 cm product depth; if it provides none, use the small
  // protective carton used for lightweight catalogue items. Actual weight still
  // wins whenever it is higher than the volumetric weight.
  return {
    lengthCm: measurements[0] || 10,
    widthCm: measurements[1] || 10,
    heightCm: measurements[2] || 1
  };
}

export function getCartPackageDimensionsCm(cartItems: CartItem[]): PackageDimensionsCm {
  const shippableItems = cartItems.filter((item) => !isProductFreeShipping(item.product));
  if (shippableItems.length === 0) return { lengthCm: 0, widthCm: 0, heightCm: 0 };

  // Pack products in one parcel: preserve the largest footprint and stack the
  // item heights for quantities. This supplies the required ST Courier fields
  // while keeping its own actual-vs-volumetric calculation authoritative.
  const packageDimensions = shippableItems.reduce((result, item) => {
    const dimensions = getProductDimensionsCm(item);
    return {
      lengthCm: Math.max(result.lengthCm, dimensions.lengthCm),
      widthCm: Math.max(result.widthCm, dimensions.widthCm),
      heightCm: result.heightCm + (dimensions.heightCm * item.quantity)
    };
  }, { lengthCm: 1, widthCm: 1, heightCm: 0 });

  return {
    lengthCm: Math.min(200, Math.max(1, Math.ceil(packageDimensions.lengthCm))),
    widthCm: Math.min(200, Math.max(1, Math.ceil(packageDimensions.widthCm))),
    heightCm: Math.min(200, Math.max(1, Math.ceil(packageDimensions.heightCm)))
  };
}

function cacheKey(pincode: string, method: 'standard' | 'express', grams: number, dimensions: PackageDimensionsCm): string {
  return `${pincode}:${method}:${grams}:${dimensions.lengthCm}x${dimensions.widthCm}x${dimensions.heightCm}`;
}

export async function fetchStCourierRate(
  pincode: string,
  shippingMethod: 'standard' | 'express',
  cartItems: CartItem[]
): Promise<LiveShippingInfo> {
  const normalized = (pincode || '').replace(/\D/g, '').slice(0, 6);
  const grams = getCartWeightGrams(cartItems);
  const dimensions = getCartPackageDimensionsCm(cartItems);
  const billableWeightKg = grams === 0 ? 0 : Math.max(0.5, Math.ceil(grams / 500) / 2);

  const placeholder: LiveShippingInfo = {
    pincode: normalized,
    shippingMethod,
    billableWeightKg,
    cost: null,
    source: 'none'
  };

  // All items are freeShipping — no courier lookup needed, shipping is free.
  if (grams === 0) return { ...placeholder, cost: 0, source: 'unavailable' };

  if (normalized.length !== 6) return placeholder;

  // The supplied ST Courier domestic rate card is the automatic fallback for
  // a valid delivery location. It uses the same pincode and weight rules as
  // the final checkout total, so the amount shown and charged always match.
  const rateCardFallback = (): LiveShippingInfo => {
    const rateCardTotals = calculateCartTotals(cartItems, null, shippingMethod, false, normalized);
    return {
      pincode: normalized,
      shippingMethod,
      billableWeightKg: rateCardTotals.billableWeightKg,
      cost: rateCardTotals.shippingCost,
      source: 'rate-card',
      provider: 'ST Courier domestic rate card',
      message: 'Estimated from the ST Courier domestic rate card for this location.'
    };
  };

  const key = cacheKey(normalized, shippingMethod, grams, dimensions);
  const cached = stCourierRateCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.info;
  }

  try {
    const res = await fetch('/api/shipping/stcourier-rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pincode: normalized, weightGrams: grams, ...dimensions })
    });
    if (!res.ok) throw new Error(`Rate service returned ${res.status}`);
    const data: StCourierRateResult = await res.json();

    if (data.source === 'st-courier' && typeof data.cost === 'number' && data.cost > 0) {
      // ST Courier returns one official domestic price; the site must not add
      // an unverified "express" uplift to that quote.
      const info: LiveShippingInfo = {
        pincode: normalized,
        shippingMethod,
        billableWeightKg,
        cost: data.cost,
        source: 'st-courier',
        provider: data.provider,
        message: data.message
      };
      stCourierRateCache.set(key, { info, expiresAt: Date.now() + RATE_CACHE_TTL_MS });
      return info;
    }

    const info = rateCardFallback();
    stCourierRateCache.set(key, { info, expiresAt: Date.now() + RATE_CACHE_TTL_MS });
    return info;
  } catch {
    // The checkout uses its supplied ST Courier domestic rate card when the
    // live lookup cannot return a lane-specific quote.
    const info = rateCardFallback();
    stCourierRateCache.set(key, { info, expiresAt: Date.now() + RATE_CACHE_TTL_MS });
    return info;
  }
}
