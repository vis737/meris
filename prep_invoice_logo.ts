/**
 * One-time asset prep: extracts the MERIS seal from the logo photograph and
 * produces transparent PNGs used by the invoice designer.
 *
 * Outputs (public/):
 *   invoice-logo.png        - full-intensity circular seal
 *   invoice-logo-water.png  - faded variant for the page watermark
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

const SRC = 'logo_source.jpeg';
const OUT_SIZE = 480; // plenty for a 26mm print at >400 dpi

const img = jpeg.decode(readFileSync(SRC), { useTArray: true, maxMemoryUsageInMB: 1024 });
const { width: W, height: H, data } = img;

// --- 1. Locate the seal: gold pixels are strong, the background is dark blue-grey.
const isGold = (r: number, g: number, b: number) => r > 90 && g > 70 && r > b + 40 && g > b + 20;
let minX = W, minY = H, maxX = 0, maxY = 0, goldCount = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (isGold(data[i], data[i + 1], data[i + 2])) {
      goldCount++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
}
if (!goldCount) throw new Error('No gold seal found in source image');
// Degenerate-seed guard: expand box while extremely tight (safety no-op normally).
const bw = maxX - minX, bh = maxY - minY;
console.log(`gold bbox: ${minX},${minY} -> ${maxX},${maxY} (${bw}x${bh}), ${goldCount} px`);
const cx0 = (minX + maxX) / 2;
const cy0 = (minY + maxY) / 2;
const radius = Math.max(bw, bh) / 2;

// --- 2. Sample the background colour just outside the seal (for the watermark tint).
const bgSample = (x: number, y: number) => {
  const i = (Math.max(0, Math.min(H - 1, Math.round(y))) * W + Math.max(0, Math.min(W - 1, Math.round(x)))) * 4;
  return [data[i], data[i + 1], data[i + 2]] as [number, number, number];
};
const bg = bgSample(cx0 - radius - 20, cy0);
console.log('background colour:', bg.join(','));

// --- 3. Render a circular crop with a 2px-per-destination-px soft edge.
function render(size: number, darken: number, fade: number | null): Buffer {
  const png = new PNG({ width: size, height: size });
  const feather = 2.2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx = (px + 0.5) / size - 0.5;
      const dy = (py + 0.5) / size - 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy) * 2; // 0 center -> 1 at edge
      const i = (py * size + px) * 4;
      if (dist >= 1) { png.data[i + 3] = 0; continue; }
      const sx = Math.round(cx0 + (dx * 2 * radius));
      const sy = Math.round(cy0 + (dy * 2 * radius));
      const si = (Math.max(0, Math.min(H - 1, sy)) * W + Math.max(0, Math.min(W - 1, sx))) * 4;
      let r = data[si], g = data[si + 1], b = data[si + 2];
      // Neutralise the photo's background so only the seal shows: blend dark
      // non-gold pixels toward the navy the invoice sits on.
      const goldish = isGold(r, g, b);
      if (!goldish) {
        const t = 0.82;
        r = Math.round(r * (1 - t) + 15 * t);
        g = Math.round(g * (1 - t) + 23 * t);
        b = Math.round(b * (1 - t) + 42 * t);
      }
      if (darken !== 1) { r = Math.round(r * darken); g = Math.round(g * darken); b = Math.round(b * darken); }
      let alpha = dist > 1 - feather / size ? Math.round(255 * (1 - dist) * size / feather) : 255;
      if (fade !== null) alpha = Math.round(alpha * fade);
      png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = alpha;
    }
  }
  return PNG.sync.write(png);
}

mkdirSync('src/assets', { recursive: true });
const logoPng = render(OUT_SIZE, 1, null);
const waterPng = render(OUT_SIZE, 1, 0.16);
writeFileSync('src/assets/invoice-logo.png', logoPng);
writeFileSync('src/assets/invoice-logo-water.png', waterPng);

// Emit base64 TS modules so the logo also loads in plain Node (tsx) scripts,
// where Vite's asset-import pipeline is unavailable.
const b64 = (buf: Buffer) => buf.toString('base64');
writeFileSync('src/assets/invoiceLogo.ts',
  `// Auto-generated from logo_source.jpeg by prep_invoice_logo.ts - do not edit.\n` +
  `// Circular-cropped MERIS seal with transparency, as a PNG data URI.\n` +
  `export const invoiceLogoDataUrl: string = 'data:image/png;base64,${b64(logoPng)}';\n`);
writeFileSync('src/assets/invoiceLogoWater.ts',
  `// Auto-generated from logo_source.jpeg by prep_invoice_logo.ts - do not edit.\n` +
  `// Faded seal variant used as the invoice watermark, as a PNG data URI.\n` +
  `export const invoiceLogoWaterDataUrl: string = 'data:image/png;base64,${b64(waterPng)}';\n`);
console.log('written src/assets/invoice-logo(.png|.water.png) + base64 TS modules');
