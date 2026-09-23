import { jsPDF } from 'jspdf';
import { Order } from '../types';

const NAVY: [number, number, number] = [10, 25, 47];
const NAVY_DEEP: [number, number, number] = [15, 23, 42]; // #0F172A - seal rim (site logo)
const NAVY_CORE: [number, number, number] = [30, 41, 59]; // #1E293B - seal centre (site logo)
const GOLD: [number, number, number] = [197, 160, 33];
const GOLD_BRIGHT: [number, number, number] = [251, 191, 36]; // #FBBF24 - site logo gold
const GOLD_DEEP: [number, number, number] = [180, 83, 9];
const GREEN: [number, number, number] = [22, 125, 80];
const RED: [number, number, number] = [185, 28, 28];
const INK: [number, number, number] = [35, 47, 67];
const MUTED: [number, number, number] = [105, 120, 143];
const PAPER: [number, number, number] = [248, 250, 252];
const BORDER: [number, number, number] = [221, 227, 236];
const WHITE: [number, number, number] = [255, 255, 255];

type RGB = [number, number, number];

// Pre-blend a foreground colour onto a background at the given alpha so we
// never need PDF transparency groups (keeps the file simple and portable).
const blend = (fg: RGB, bg: RGB, alpha: number): RGB => [
  Math.round(fg[0] * alpha + bg[0] * (1 - alpha)),
  Math.round(fg[1] * alpha + bg[1] * (1 - alpha)),
  Math.round(fg[2] * alpha + bg[2] * (1 - alpha)),
];

// Built-in PDF fonts do not contain emoji or the Rupee symbol. This prevents
// corrupted characters in the generated invoice.
const text = (value: unknown) => String(value ?? '')
  .replace(/[\r\n]+/g, ', ')
  .replace(/[^\x20-\x7E]/g, '')
  .replace(/\s{2,}/g, ' ')
  .trim();

const amount = (value: number) => `Rs. ${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/* ------------------------------------------------------------------ */
/* Indian-numbering amount in words                                    */
/* ------------------------------------------------------------------ */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', 'Ten', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : '');
}

function numberInWords(num: number): string {
  num = Math.floor(Math.abs(num));
  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thousand = Math.floor(num / 1000); num %= 1000;
  const hundred = Math.floor(num / 100); num %= 100;
  const parts: string[] = [];
  if (crore) parts.push(`${twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(`${twoDigits(hundred)} Hundred`);
  if (num) parts.push(`${parts.length ? 'and ' : ''}${twoDigits(num)}`);
  return parts.join(' ') || 'Zero';
}

function amountInWords(value: number): string {
  const n = Number(value) || 0;
  const rupees = Math.floor(n);
  const paise = Math.round((n - rupees) * 100);
  let words = `Rupees ${numberInWords(rupees)}`;
  if (paise > 0) words += ` and ${twoDigits(paise)} Paise`;
  return `${words} Only`;
}

/* ------------------------------------------------------------------ */
/* The MERIS E-SHOP seal, redrawn as pure vector from the site logo    */
/* (Navbar.tsx SVG): navy radial disc, gold glitter rings, sparkles,   */
/* gold flakes and the MERIS E-SHOP / EST 2025 typography.             */
/* ------------------------------------------------------------------ */

const SEAL_FLAKES: Array<[number, number, number]> = [
  [100, 22, 1.5], [145, 30, 1.2], [155, 42, 1.8], [172, 65, 1.0], [178, 85, 1.5],
  [174, 120, 1.2], [165, 142, 1.6], [142, 165, 1.4], [118, 174, 1.8], [82, 174, 1.3],
  [58, 165, 1.5], [35, 142, 1.2], [26, 120, 1.6], [22, 85, 1.0], [28, 65, 1.4],
  [45, 30, 1.8], [55, 22, 1.2],
];

const SEAL_SPARKLES: Array<[number, number]> = [
  [100, 13], [100, 187], [190, 100], [10, 100],
  [164.5, 39.5], [35.5, 39.5], [164.5, 160.5], [35.5, 160.5],
];

function sparkle(doc: jsPDF, cx: number, cy: number, s: number, color: RGB) {
  const R = 5 * s;
  const w = 1.9 * s;
  const pts: Array<[number, number]> = [
    [cx, cy - R], [cx + w, cy - w], [cx + R, cy], [cx + w, cy + w],
    [cx, cy + R], [cx - w, cy + w], [cx - R, cy], [cx - w, cy - w],
  ];
  const deltas: Array<[number, number]> = [];
  for (let i = 1; i < pts.length; i++) deltas.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
  doc.setFillColor(...color);
  doc.lines(deltas, pts[0][0], pts[0][1], [1, 1], 'F', true);
}

/**
 * Draws the website logo. `d` is the seal diameter in mm; all inner metrics
 * derive from the 200x200 viewBox of the site's SVG, so the seal stays
 * pixel-faithful at any size (vector, no rasterisation).
 */
function drawSeal(doc: jsPDF, cx: number, cy: number, d: number, opts?: { withText?: boolean; tint?: RGB }) {
  const withText = opts?.withText !== false;

  // At small sizes the glitter dash patterns fall below renderer resolution and
  // collapse into a muddy blob - use a bold simplified crest instead.
  if (d < 20) return drawSealSmall(doc, cx, cy, d);
  const tint = opts?.tint ?? NAVY_DEEP; // colour the seals sits on (for pre-blending)
  const s = d / 200;
  const X = (ux: number) => cx + (ux - 100) * s;
  const Y = (uy: number) => cy + (uy - 100) * s;
  const mm = (units: number) => units * s;
  const pt = (units: number) => (units * s) / 0.352778; // svg units -> PDF points

  // Disc: dark rim + lighter core approximating the site's radial gradient.
  doc.setFillColor(...NAVY_DEEP);
  doc.circle(cx, cy, mm(96), 'F');
  doc.setFillColor(...NAVY_CORE);
  doc.circle(cx, cy, mm(70), 'F');

  // Gold rim.
  doc.setDrawColor(...blend(GOLD, tint, 0.95));
  doc.setLineWidth(mm(1.2));
  doc.circle(cx, cy, mm(96), 'S');

  // Glitter wreath rings (dashes & weights lifted from the site SVG).
  const ring = (r: number, w: number, dash: number[], color: RGB) => {
    doc.setDrawColor(...color);
    doc.setLineWidth(mm(w));
    doc.setLineDashPattern(dash.map((v) => v * s), 0);
    doc.circle(cx, cy, mm(r), 'S');
    doc.setLineDashPattern([], 0);
  };
  ring(86, 4.5, [3, 6, 1, 4, 8, 3], blend(GOLD_BRIGHT, NAVY_DEEP, 0.8));
  ring(89, 2.5, [1, 5, 12, 4], blend([255, 236, 180], NAVY_DEEP, 0.85));
  ring(82, 1.5, [6, 2, 3, 5, 1, 3], blend(GOLD, NAVY_DEEP, 0.9));
  ring(92, 1, [1, 8, 2, 12], blend(WHITE, NAVY_DEEP, 0.45));

  // Wreath sparkles + organic flakes.
  SEAL_SPARKLES.forEach(([ux, uy]) => sparkle(doc, X(ux), Y(uy), s, blend(GOLD_BRIGHT, NAVY_DEEP, 0.95)));
  doc.setFillColor(...blend(GOLD_BRIGHT, NAVY_DEEP, 0.9));
  SEAL_FLAKES.forEach(([ux, uy, r]) => doc.circle(X(ux), Y(uy), mm(r), 'F'));

  if (!withText) return;

  // Inner typography (baselines from the site SVG).
  doc.setFont('times', 'bold');
  doc.setFontSize(pt(24));
  doc.setTextColor(...blend(GOLD_BRIGHT, NAVY_CORE, 0.95));
  doc.text('MERIS', X(100), Y(75), { align: 'center' });
  doc.text('E-SHOP', X(100), Y(108), { align: 'center' });

  doc.setDrawColor(...blend(GOLD, NAVY_CORE, 0.7));
  doc.setLineWidth(mm(1));
  doc.line(X(55), Y(118), X(145), Y(118));

  doc.setFont('courier', 'bold');
  doc.setFontSize(pt(10));
  doc.setTextColor(...blend(WHITE, NAVY_CORE, 0.9));
  doc.text('EST 2025', X(100), Y(134), { align: 'center' });

  if (d >= 50) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(pt(7.5));
    doc.setTextColor(...blend([148, 163, 184], NAVY_CORE, 0.8));
    doc.text('- Kids Toys - Gifts -', X(100), Y(151), { align: 'center' });
    doc.text('- Stationeries -', X(100), Y(163), { align: 'center' });
  }
}

/** Bold mini crest for tiny renders: solid gold rims + gold M monogram. */
function drawSealSmall(doc: jsPDF, cx: number, cy: number, d: number) {
  const r = d / 2;
  doc.setFillColor(...NAVY_DEEP);
  doc.circle(cx, cy, r, 'F');
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(d * 0.09);
  doc.circle(cx, cy, r - d * 0.055, 'S');
  doc.setLineWidth(d * 0.025);
  doc.circle(cx, cy, r - d * 0.14, 'S');
  doc.setFont('times', 'bold');
  doc.setFontSize((d * 0.62) / 0.352778);
  doc.setTextColor(...GOLD_BRIGHT);
  doc.text('M', cx, cy + d * 0.21, { align: 'center' });
}

// Very faint centred seal behind the ledger - a premium watermark.
function drawWatermark(doc: jsPDF) {
  const cx = 105;
  const cy = 158;
  const d = 112;
  const s = d / 200;
  const pale = (c: RGB, a: number) => blend(c, WHITE, a);
  const ring = (r: number, w: number, dash: number[], color: RGB) => {
    doc.setDrawColor(...color);
    doc.setLineWidth(w * s);
    doc.setLineDashPattern(dash.map((v) => v * s), 0);
    doc.circle(cx, cy, r * s, 'S');
    doc.setLineDashPattern([], 0);
  };
  ring(96, 1.2, [], pale(GOLD, 0.14));
  ring(86, 4.5, [3, 6, 1, 4, 8, 3], pale(GOLD_BRIGHT, 0.11));
  ring(82, 1.5, [6, 2, 3, 5, 1, 3], pale(GOLD, 0.12));
  ring(92, 1, [1, 8, 2, 12], pale([100, 116, 139], 0.12));
  SEAL_SPARKLES.forEach(([ux, uy]) => sparkle(doc, cx + (ux - 100) * s, cy + (uy - 100) * s, s, pale(GOLD_BRIGHT, 0.15)));
  doc.setFillColor(...pale(GOLD, 0.12));
  SEAL_FLAKES.forEach(([ux, uy, r]) => doc.circle(cx + (ux - 100) * s, cy + (uy - 100) * s, r * s, 'F'));
  doc.setFont('times', 'bold');
  doc.setFontSize((24 * s) / 0.352778);
  doc.setTextColor(...pale(GOLD, 0.14));
  doc.text('MERIS', cx, cy - (25 * s), { align: 'center' });
  doc.text('E-SHOP', cx, cy + (8 * s), { align: 'center' });
}

function label(doc: jsPDF, value: string, x: number, y: number) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(...MUTED);
  doc.text(value.toUpperCase(), x, y);
}

const prettifyMethod = (raw: string) => text(raw)
  .replace(/[_-]+/g, ' ')
  .toUpperCase()
  .trim() || 'PREPAID';

export function createMerisInvoiceDocument(order: Order) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const margin = 15;
  const width = 180;
  const orderSlug = text(order.orderNumber).split('-')[1] || text(order.id).slice(0, 8).toUpperCase();
  const invoiceNumber = `MERIS-INV-${orderSlug}`;
  const paid = order.paymentStatus === 'paid';

  // Faint brand watermark behind everything.
  drawWatermark(doc);

  // ------------------------------------------------------------------
  // Header: website seal + brand block + invoice meta
  // ------------------------------------------------------------------
  doc.setFillColor(...NAVY);
  doc.roundedRect(margin, 14, width, 43, 4, 4, 'F');
  doc.setFillColor(...GOLD);
  doc.roundedRect(margin, 14, 4, 43, 4, 4, 'F');

  drawSeal(doc, 31.5, 35.5, 26);

  doc.setFont('times', 'bold');
  doc.setFontSize(19);
  doc.setTextColor(...WHITE);
  doc.text('MERIS E-SHOP', 48, 31);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(...GOLD_BRIGHT);
  doc.text('PREMIUM SELECTIONS & HANDMADE GIFTS', 48, 36.2);
  doc.setTextColor(205, 216, 232);
  doc.text('Kanyakumari, Tamil Nadu 629401  |  @meriseshop.2025', 48, 41.3);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...WHITE);
  doc.text('TAX INVOICE', 190, 26, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(205, 216, 232);
  doc.text(invoiceNumber, 190, 32, { align: 'right' });
  doc.text(`Issued ${text(order.date)}`, 190, 37, { align: 'right' });

  // Payment reference line (Razorpay / PayU / UPI / COD).
  const methodName = prettifyMethod(order.paymentMethod);
  let paymentRef = '';
  if (order.razorpayPaymentId) paymentRef = text(order.razorpayPaymentId);
  else if (order.payuPaymentId) paymentRef = text(order.payuPaymentId);
  else if (order.upiTxnId) paymentRef = text(order.upiTxnId);
  const refSuffix = paymentRef ? `  |  Ref: ${paymentRef.slice(0, 26)}${paymentRef.length > 26 ? '...' : ''}` : '';
  doc.setFontSize(7);
  doc.setTextColor(...GOLD_BRIGHT);
  doc.text(`Payment: ${methodName}${refSuffix}`, 190, 42.5, { align: 'right' });

  // Status badge.
  doc.setFillColor(255, 248, 225);
  doc.roundedRect(163, 45.5, 27, 8, 3, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...(paid ? GREEN : GOLD_DEEP));
  doc.text(paid ? 'PAID' : text(order.paymentStatus || 'PENDING').toUpperCase(), 176.5, 50.7, { align: 'center' });

  // ------------------------------------------------------------------
  // Recipient and sender cards
  // ------------------------------------------------------------------
  const cardTop = 65;
  doc.setFillColor(...PAPER);
  doc.roundedRect(margin, cardTop, 85, 49, 3, 3, 'F');
  doc.roundedRect(110, cardTop, 85, 49, 3, 3, 'F');
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, cardTop, 85, 49, 3, 3, 'S');
  doc.roundedRect(110, cardTop, 85, 49, 3, 3, 'S');
  label(doc, 'Billed to', 20, 73);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...NAVY);
  doc.text(text(order.customerInfo.name) || 'Customer', 20, 80);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.setTextColor(...INK);
  const customerLines = [
    ...doc.splitTextToSize(text(order.customerInfo.address), 72),
    `PIN: ${text(order.customerInfo.pincode)}`,
    `Phone: ${text(order.customerInfo.phone)}`,
    text(order.customerInfo.email),
  ].filter(Boolean);
  doc.text(customerLines, 20, 86, { lineHeightFactor: 1.35 });
  label(doc, 'Sold & dispatched by', 115, 73);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...NAVY);
  doc.text('MERIS E-SHOP', 115, 80);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.setTextColor(...INK);
  doc.text([
    '5/339, Fathima Road, Azhagappapuram',
    'Kanyakumari District, Tamil Nadu 629401',
    'support@meris.com',
    'instagram.com/meriseshop.2025',
  ], 115, 86, { lineHeightFactor: 1.35 });

  // ------------------------------------------------------------------
  // Item ledger
  // ------------------------------------------------------------------
  let y = 125;
  doc.setFillColor(...NAVY);
  doc.roundedRect(margin, y, width, 9, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...WHITE);
  doc.text('ITEM DESCRIPTION', 20, y + 5.8);
  doc.text('RATE', 137, y + 5.8, { align: 'right' });
  doc.text('QTY', 153, y + 5.8, { align: 'right' });
  doc.text('AMOUNT', 190, y + 5.8, { align: 'right' });
  y += 9;
  order.items.forEach((item, index) => {
    const nameLines = doc.splitTextToSize(text(item.product.name) || 'Meris product', 95).slice(0, 2);
    const mrp = Number(item.product.price || 0);
    const rate = Number(item.product.discountPrice || mrp || 0);
    const struck = mrp > rate && rate > 0;
    const rowHeight = Math.max(12, 6 + nameLines.length * 4.2 + (struck ? 3.6 : 0));
    if (index % 2 === 0) {
      doc.setFillColor(...PAPER);
      doc.rect(margin, y, width, rowHeight, 'F');
    }
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.25);
    doc.line(margin, y + rowHeight, 195, y + rowHeight);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...INK);
    doc.text(nameLines, 20, y + 5.3, { lineHeightFactor: 1.2 });
    if (struck) {
      // Original price crossed out above the discounted rate.
      const original = amount(mrp);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.4);
      doc.setTextColor(...MUTED);
      doc.text(original, 137, y + 4.4, { align: 'right' });
      const w = doc.getTextWidth(original);
      doc.setDrawColor(150, 158, 170);
      doc.setLineWidth(0.28);
      doc.line(137 - w, y + 4.4 - 1.25, 137, y + 4.4 - 1.25);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.2);
      doc.setTextColor(...GOLD_DEEP);
      doc.text(amount(rate), 137, y + 9, { align: 'right' });
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.2);
      doc.setTextColor(...INK);
      doc.text(amount(rate), 137, y + 6, { align: 'right' });
    }
    doc.setFont('helvetica', 'normal');
    doc.text(String(item.quantity), 153, y + 6, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.text(amount(rate * item.quantity), 190, y + 6, { align: 'right' });
    y += rowHeight;
  });

  // Dispatch meta line under the ledger.
  const dispatchBits = [
    order.shippingProvider ? text(order.shippingProvider) : '',
    order.shippingWeightKg ? `${Number(order.shippingWeightKg)} kg` : '',
    text(order.shippingMethod || '').toUpperCase(),
  ].filter(Boolean);
  if (dispatchBits.length) {
    label(doc, `Dispatch: ${dispatchBits.join('  •  ')}`, margin + 1, y + 4.6);
    y += 7;
  }

  // ------------------------------------------------------------------
  // Financial summary
  // ------------------------------------------------------------------
  y += 6;
  const totalX = 112;
  const rows: Array<[string, string, boolean?]> = [
    ['Subtotal', amount(order.subtotal)],
    ['GST', amount(order.tax)],
    [`Delivery (${text(order.shippingMethod || 'standard').toUpperCase()})`, amount(order.shippingCost)],
  ];
  if (Number(order.discount) > 0) {
    rows.push([`Discount${order.couponCode ? ` (${text(order.couponCode)})` : ''}`, `- ${amount(order.discount)}`, true]);
  }
  const totalHeight = 17 + rows.length * 6.2;
  doc.setFillColor(...PAPER);
  doc.roundedRect(totalX, y, 83, totalHeight, 3, 3, 'F');
  doc.setDrawColor(...BORDER);
  doc.roundedRect(totalX, y, 83, totalHeight, 3, 3, 'S');
  let summaryY = y + 7;
  rows.forEach(([rowLabel, rowAmount, discount]) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.3);
    doc.setTextColor(...(discount ? RED : INK));
    doc.text(rowLabel, totalX + 5, summaryY);
    doc.text(rowAmount, 190, summaryY, { align: 'right' });
    summaryY += 6.2;
  });
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.55);
  doc.line(totalX + 5, summaryY - 2.3, 190, summaryY - 2.3);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...NAVY);
  doc.text('TOTAL PAID', totalX + 5, summaryY + 4.5);
  doc.text(amount(order.total), 190, summaryY + 4.5, { align: 'right' });

  // Amount in words (statutory-style, wrapped so it never leaves the page).
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.6);
  doc.setTextColor(...MUTED);
  const wordsLines = doc.splitTextToSize(`Amount in words: ${text(amountInWords(order.total))}`, 80).slice(0, 2);
  doc.text(wordsLines, totalX, summaryY + 11, { lineHeightFactor: 1.3 });

  if (order.giftWrappingRequested || order.giftMessage) {
    const giftY = Math.max(summaryY + 16, 205);
    doc.setFillColor(255, 248, 225);
    doc.roundedRect(margin, giftY, width, 17, 3, 3, 'F');
    doc.setDrawColor(...GOLD);
    doc.roundedRect(margin, giftY, width, 17, 3, 3, 'S');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...NAVY);
    doc.text('HANDCRAFTED GIFT WRAP', 20, giftY + 6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.7);
    doc.setTextColor(...INK);
    const message = order.giftMessage ? `Gift message: ${text(order.giftMessage)}` : 'Your order includes Meris handcrafted gift wrapping.';
    doc.text(doc.splitTextToSize(message, 170), 20, giftY + 11);
  }

  // ------------------------------------------------------------------
  // Footer with the site seal
  // ------------------------------------------------------------------
  const footerY = 263;
  doc.setFillColor(...NAVY);
  doc.roundedRect(margin, footerY, width, 19, 3, 3, 'F');
  drawSeal(doc, 28.5, footerY + 9.5, 15, { withText: false });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...WHITE);
  doc.text('Thank you for choosing MERIS E-SHOP.', 40, footerY + 7.8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(205, 216, 232);
  doc.text('Handpicked gifts, toys and lifestyle finds - packed with care in Tamil Nadu.', 40, footerY + 12.2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.8);
  doc.setTextColor(...GOLD_BRIGHT);
  doc.text(invoiceNumber, 190, footerY + 9.5, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(205, 216, 232);
  doc.text('Digitally generated invoice - no signature required', 190, footerY + 13.7, { align: 'right' });
  return doc;
}

export function generateMerisInvoicePDF(order: Order) {
  const doc = createMerisInvoiceDocument(order);
  const orderSlug = text(order.orderNumber).split('-')[1] || text(order.id).slice(0, 8).toUpperCase();
  doc.save(`Invoice-MERIS-INV-${orderSlug}.pdf`);
}
