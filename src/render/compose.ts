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
  // the last entry is a cool-toned East Asian complexion used for adventurers in Chinese, Japanese and Korean
  skin: ['#f6d2ae', '#ecbf94', '#d9a173', '#b07a52', '#7a5034', '#f2d6c6'],
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

// lift everything above the legs by one pixel (passing frames of the walk), keeping the waist joined
export function bob(px: Uint8ClampedArray, w = PW, cut = 18) {
  for (let y = 0; y < cut - 1; y++) px.copyWithin(y * w * 4, (y + 1) * w * 4, (y + 2) * w * 4);
}

// draw order of the layer groups
// frames: 0 stand, 1 3 4 5 walk cycle, 2 strike, 6 blink, 7 sit, 8 arms up (cast or cheer), 9 stretch,
// 10 hand to head, 11 hands rubbed together, 12 a kick
export const FRAME = { stand: 0, strike: 2, blink: 6, sit: 7, up: 8, stretch: 9, head: 10, rub: 11, kick: 12, walk: [1, 3, 4, 5] };
// passing frames of the walk lift the body by a pixel
export const BOB_FRAMES = [3, 5];
const LEGS: Record<number, string> = { 0: '0', 1: 'w0', 2: '2', 3: 'w1', 4: 'w2', 5: 'w3', 6: '0', 7: 'sit', 8: '0', 9: '0', 10: '0', 11: '0', 12: 'kick' };
const ARM: Record<number, string> = { 0: 'down', 1: 'fwd', 2: 'reach', 3: 'down', 4: 'back', 5: 'down', 6: 'down', 7: 'lap', 8: 'up', 9: 'up', 10: 'head', 11: 'rub', 12: 'back' };

export function layerNames(o: { outfit: string; head: string; beard: string; item: string; style: number; ears?: boolean; face?: string; cape?: boolean }, frame: number): string[] {
  const cape = o.cape ? ['p/cape/x'] : [], clasp = o.cape ? ['p/capeA/x'] : [];
  const blink = frame === 6 || frame === 9;
  const face = o.face ?? 'human';
  const names = [...cape, `p/back/${o.item}`, `p/legs/${LEGS[frame] ?? frame}`, `p/outfit/${o.outfit}`, `p/outfitA/${o.outfit}`, `p/arm/${ARM[frame] ?? 'down'}`, ...clasp, `p/hand/${ARM[frame] ?? 'down'}`, blink && (face === 'human' || face === 'orc') ? `p/blink/${face}` : `p/skin/${face}`];
  if (o.ears) names.push('p/ears/x');
  if (o.beard) names.push(`p/beard/${o.beard}`);
  if (!['knightHelm', 'hood', 'mitre', 'ninjaHood'].includes(o.head) || o.style === 2) names.push(`p/hair/${o.style}`);
  if (o.head) names.push(`p/head/${o.head}`);
  names.push(frame === 2 ? `p/itemA/${o.item}` : `p/item/${o.item}`);
  return names;
}
