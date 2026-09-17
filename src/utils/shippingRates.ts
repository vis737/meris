import { CartItem } from '../types';
import { getCartShipmentWeightKg } from './premiumData';

// ---------------------------------------------------------------------------
// Live delivery-rate quotes from ST Courier (https://stcourier.com/rate-calculator)
//
// The checkout asks our server, which queries ST Courier's rate calculator with
// the store pickup pincode (629401), the customer's destination pincode and the
// cart weight. When ST Courier has not published a rate for that lane, the
// response falls back to source 'estimate' and the UI shows the internal zone
// estimate instead — the checkout never blocks or fails because of this.
// ---------------------------------------------------------------------------

export interface StCourierRateResult {
  cost: number | null;
  provider: string;
  source: 'st-courier' | 'estimate';
  checkedAt: string;
  message?: string;
  cached?: boolean;
}

export interface LiveShippingInfo {
  pincode: string;
  shippingMethod: 'standard' | 'express';
  billableWeightKg: number;
  cost: number | null;
  source: 'st-courier' | 'estimate' | 'none';
  provider?: string;
  message?: string;
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
    const hasNonFreeShippingItem = cartItems.some(item => !item.product.freeShipping);
    return hasNonFreeShippingItem ? 500 : 0;
  }
  return grams;
}

function cacheKey(pincode: string, method: 'standard' | 'express', grams: number): string {
  return `${pincode}:${method}:${grams}`;
}

export async function fetchStCourierRate(
  pincode: string,
  shippingMethod: 'standard' | 'express',
  cartItems: CartItem[]
): Promise<LiveShippingInfo> {
  const normalized = (pincode || '').replace(/\D/g, '').slice(0, 6);
  const grams = getCartWeightGrams(cartItems);
  const billableWeightKg = grams === 0 ? 0 : Math.max(0.5, Math.ceil(grams / 500) / 2);

  const placeholder: LiveShippingInfo = {
    pincode: normalized,
    shippingMethod,
    billableWeightKg,
    cost: null,
    source: 'none'
  };

  // All items are freeShipping — no courier lookup needed, shipping is free.
  if (grams === 0) return { ...placeholder, cost: 0, source: 'estimate' };

  if (normalized.length !== 6) return placeholder;

  const key = cacheKey(normalized, shippingMethod, grams);
  const cached = stCourierRateCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.info;
  }

  try {
    const res = await fetch('/api/shipping/stcourier-rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pincode: normalized, weightGrams: grams })
    });
    if (!res.ok) throw new Error(`Rate service returned ${res.status}`);
    const data: StCourierRateResult = await res.json();

    let finalCost: number | null = null;
    let source: LiveShippingInfo['source'] = 'estimate';

    if (data.source === 'st-courier' && typeof data.cost === 'number' && data.cost > 0) {
      finalCost = data.cost;
      source = 'st-courier';
      // Express rides on the same ST Courier base rate with the same uplift the
      // internal calculator uses; labelled 'estimate' because ST Courier does
      // not publish an express product for this lane.
      if (shippingMethod === 'express') {
        finalCost = Math.round(finalCost * 1.45 + 40);
        source = 'estimate';
      }
    }

    const info: LiveShippingInfo = {
      pincode: normalized,
      shippingMethod,
      billableWeightKg,
      cost: finalCost,
      source,
      provider: data.provider,
      message: data.message
    };

    stCourierRateCache.set(key, { info, expiresAt: Date.now() + RATE_CACHE_TTL_MS });
    return info;
  } catch {
    // Network/backend failure: show the internal estimate, never block checkout.
    return { ...placeholder, source: 'estimate' };
  }
}

