// Character sprites are stacks of same-sized layers. Pure grey pixels (r = g = b) are recoloured
// with the layer's tint channel; everything else is drawn as-is. Kept DOM-free so the offline
// art tool can build humanoid monsters with the exact same code.

export type Channel = 'skin' | 'hair' | 'cloth' | 'cloth2' | 'pants';
export type RGB = [number, number, number];
export interface Layer { data: Uint8ClampedArray | Uint8Array; tint?: Channel | '' }

export const PW = 21;
export const PH = 24;
export const PAX = 10;
export const PAY = 21;
export const GRAY_BASE = 196;

export const PALETTE = {
  skin: ['#f6d2ae', '#ecbf94', '#d9a173', '#b07a52', '#7a5034'],
  hair: ['#6a4026', '#2e2a30', '#d8b048', '#b24a2a', '#e4dcd0', '#4a5ab0', '#3a2418', '#a4a4ae', '#d87aa0', '#4a8a5a'],
  cloth: ['#b83a3a', '#c0602a', '#d8b040', '#5a9a3a', '#2a7a6a', '#3a6ab8', '#4a4ab8', '#7a3aa8', '#a83a7a', '#8a6a3a', '#e8e0d0', '#4a4a5a', '#d87a8a', '#6ab0d8'],
  pants: ['#4a4a6a', '#5a4a30', '#3a3a3a', '#6a5a4a', '#2a3a5a', '#7a6a5a'],
};

export const rgb = (h: string): RGB => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const COOL: RGB = [40, 30, 70], WARM: RGB = [255, 240, 190];

// shadows drift toward cool purple and highlights toward warm yellow, like hand-picked ramps
export function shadeRGB(c: RGB, f: number): RGB {
  if (f < 1) return mixc(c.map((v) => v * f) as RGB, COOL, (1 - f) * 0.35);
  if (f > 1) return mixc(c.map((v) => Math.min(255, v * f)) as RGB, WARM, (f - 1) * 0.6);
  return c;
}

export function compose(layers: Layer[], colors: Record<Channel, RGB>, w = PW, h = PH): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (const l of layers) {
    const d = l.data;
    for (let i = 0; i < w * h * 4; i += 4) {
      if (d[i + 3] < 128) continue;
      let r = d[i], g = d[i + 1], b = d[i + 2];
      if (l.tint && r === g && g === b) [r, g, b] = shadeRGB(colors[l.tint], r / GRAY_BASE);
      out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255;
    }
  }
  finish(out, w, h);
  return out;
}

// light from the top-left, then a selective outline tinted from the pixel it wraps
export function finish(px: Uint8ClampedArray, w: number, h: number, hi = 1.12, lo = 0.82, outF = 0.35) {
  const src = px.slice();
  const has = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && src[(y * w + x) * 4 + 3] > 0;
  const get = (x: number, y: number): RGB => { const i = (y * w + x) * 4; return [src[i], src[i + 1], src[i + 2]]; };
  const put = (x: number, y: number, c: RGB) => { const i = (y * w + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!has(x, y)) continue;
    const tl = !has(x - 1, y) || !has(x, y - 1);
    const br = !has(x + 1, y) || !has(x, y + 1);
    if (br && !tl) put(x, y, shadeRGB(get(x, y), lo));
    else if (tl && !br) put(x, y, shadeRGB(get(x, y), hi));
  }
  const shaded = px.slice();
  const hasS = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && shaded[(y * w + x) * 4 + 3] > 0;
  const getS = (x: number, y: number): RGB => { const i = (y * w + x) * 4; return [shaded[i], shaded[i + 1], shaded[i + 2]]; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (hasS(x, y)) continue;
    const n = hasS(x, y + 1) ? getS(x, y + 1) : hasS(x - 1, y) ? getS(x - 1, y) : hasS(x + 1, y) ? getS(x + 1, y) : hasS(x, y - 1) ? getS(x, y - 1) : null;
    if (n) put(x, y, shadeRGB(n, outF));
  }
}

export interface LookColors { skin: number; hair: number; cloth: number; cloth2: number; pants: number }
export const lookColors = (l: LookColors): Record<Channel, RGB> => ({
  skin: rgb(PALETTE.skin[l.skin % PALETTE.skin.length]),
  hair: rgb(PALETTE.hair[l.hair % PALETTE.hair.length]),
  cloth: rgb(PALETTE.cloth[l.cloth % PALETTE.cloth.length]),
  cloth2: rgb(PALETTE.cloth[l.cloth2 % PALETTE.cloth.length]),
  pants: rgb(PALETTE.pants[l.pants % PALETTE.pants.length]),
});

export const HAIR_STYLES = 8;

// draw order of the layer groups
export function layerNames(o: { outfit: string; head: string; beard: string; item: string; style: number; ears?: boolean; face?: string }, frame: number): string[] {
  const names = [`p/back/${o.item}`, `p/legs/${frame}`, `p/outfit/${o.outfit}`, `p/outfitA/${o.outfit}`, `p/skin/${o.face ?? 'human'}`];
  if (o.ears) names.push('p/ears/x');
  if (o.beard) names.push(`p/beard/${o.beard}`);
  if (!['knightHelm', 'hood', 'mitre'].includes(o.head) || o.style === 2) names.push(`p/hair/${o.style}`);
  if (o.head) names.push(`p/head/${o.head}`);
  names.push(`p/item/${o.item}`);
  return names;
}
