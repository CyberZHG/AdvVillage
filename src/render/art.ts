import { culture } from '../game/data';
import type { Ground, NodeKind } from '../game/data';
import type { Cls, Look, Role } from '../game/types';
import { makeCanvas } from './pixel';
import { BOB_FRAMES, PAX, PAY, PH, PW, bob, compose, layerNames, lookColors, type Layer } from './compose';

export interface Frame { x: number; y: number; w: number; h: number; ax: number; ay: number; fx?: number[][]; tint?: string }
export interface Sprite extends Frame { img: CanvasImageSource }

export type TileKind = 'wild0' | 'wild1' | 'wild2' | 'village' | 'road' | 'street' | 'st1' | 'st2' | 'st3' | 'st4' | 'st5' | 'water' | 'ice' | 'bog' | 'bridgeX' | 'bridgeY' | 'sbridgeX' | 'sbridgeY' | 'vent' | 'sand' | 'sea' | 'lava' | 'snowtop' | 'ash' | 'gorge' | 'litter' | 'paddy0' | 'paddy1' | 'paddy2' | 'paddy3' | 'spring' | 'glacier' | 'mud' | 'oasis' | 'trav';
export const TILE_H = 22;

// sprites live on several sheets by purpose; each keeps its pixels for recolouring and a mirrored copy for flips
interface Sheet { img: HTMLImageElement; flipped: HTMLCanvasElement; pixels: Uint8ClampedArray; w: number }
let sheets: Sheet[] = [];
let frames: Record<string, Frame & { s: number }> = {};

const loadImage = (src: string) => new Promise<HTMLImageElement>((ok, fail) => {
  const i = new Image();
  i.onload = () => ok(i);
  i.onerror = fail;
  i.src = src;
});

export async function loadArt(base = './assets/') {
  const index: { sheets: { name: string }[]; frames: typeof frames } = await fetch(base + 'sprites.json').then((r) => r.json());
  const imgs = await Promise.all(index.sheets.map((sh) => loadImage(`${base}sprites/${sh.name}.png`)));
  frames = index.frames;
  sheets = imgs.map((img) => {
    const raw = makeCanvas(img.width, img.height);
    const rctx = raw.getContext('2d', { willReadFrequently: true })!;
    rctx.drawImage(img, 0, 0);
    const flipped = makeCanvas(img.width, img.height);
    const ctx = flipped.getContext('2d')!;
    ctx.scale(-1, 1);
    ctx.drawImage(img, -img.width, 0);
    return { img, flipped, pixels: rctx.getImageData(0, 0, img.width, img.height).data, w: img.width };
  });
}

// centres of the lit-window clusters in a glow sprite, found once from its pixels
const spotCache = new Map<string, [number, number][]>();
export function litSpots(sp: Sprite): [number, number][] {
  const key = `${sp.x},${sp.y},${sp.w},${sp.h},${sheets.findIndex((sh) => sh.flipped === sp.img)}`;
  let out = spotCache.get(key);
  if (out) return out;
  const c = makeCanvas(sp.w, sp.h), g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(sp.img, sp.x, sp.y, sp.w, sp.h, 0, 0, sp.w, sp.h);
  const d = g.getImageData(0, 0, sp.w, sp.h).data, cells = new Map<number, [number, number, number]>();
  for (let y = 0; y < sp.h; y++) for (let x = 0; x < sp.w; x++) {
    if (d[(y * sp.w + x) * 4 + 3] < 128) continue;
    const k = Math.floor(y / 6) * 1000 + Math.floor(x / 6), e = cells.get(k) ?? [0, 0, 0];
    e[0] += x; e[1] += y; e[2]++; cells.set(k, e);
  }
  out = [...cells.values()].filter((e) => e[2] >= 4).map((e) => [Math.round(e[0] / e[2]), Math.round(e[1] / e[2])] as [number, number]);
  spotCache.set(key, out);
  return out;
}

const MISSING: Frame & { s: number } = { x: 0, y: 0, w: 1, h: 1, ax: 0, ay: 0, s: 0 };

function get(name: string, flip = false): Sprite {
  const { s, ...f } = frames[name] ?? MISSING, sh = sheets[s];
  if (!flip) return { img: sh.img, ...f };
  // odd widths anchor on a pixel centre, even widths on the boundary between two pixels
  return { img: sh.flipped, x: sh.w - f.x - f.w, y: f.y, w: f.w, h: f.h, ax: f.w - f.ax - (f.w % 2), ay: f.ay, fx: f.fx?.map(([dx, ...rest]) => [-dx, ...rest]) };
}

export function draw(ctx: CanvasRenderingContext2D, s: Sprite, px: number, py: number) {
  ctx.drawImage(s.img, s.x, s.y, s.w, s.h, px - s.ax, py - s.ay, s.w, s.h);
}

export const tileSprite = (g: Ground, kind: TileKind, v: number) => get(`tile/${g}/${kind}/${v % 6}`);
export const buildingSprite = (type: string, flip = false) => get(`bld/${type}`, flip);
export const buildingLit = (type: string, flip = false) => (frames[`bld/${type}/lit`] ? get(`bld/${type}/lit`, flip) : null);
export const sailSprite = (f: number, flip = false) => get(`bld/windmill/sail/${f % 4}`, flip);
export const nodeSprite = (kind: NodeKind, v: number, g: Ground) => get(`node/${kind}/${v % (kind === 'tree' ? 4 : 2)}/${g}`);
export const propSprite = (name: string, g: Ground) => get(`prop/${name}/${g}`);
export const localTreeSprite = (kind: string, se: number) => get(`tree/${kind}/${se}`);
export const bankSprite = (g: Ground, tag: string, d: number, v: number) => get(`bank/${g}/${tag}/${d}/${v % 2}`);
// nine-patch edges: grass over beach sand, ground over a lava flow
export const edgeSprite = (g: Ground, kind: 'edge' | 'ledge' | 'sedge' | 'aedge' | 'bedge' | 'redge' | 'tedge' | 'zedge' | 'pedge' | 'hedge', tag: string, d: number, v: number) => get(`${kind}/${g}/${tag}/${d}/${v % 2}`);
export const rampSprite = (g: Ground, tag: string, d: number) => get(`ramp/${g}/${tag}/${d}`);
export const cliffSprite = (g: Ground, v: number) => get(`cliff/${g}/${v}`);
export const fallSprite = (g: Ground, v: number) => get(`cliff/${g}/fall${v}`);
export const spriteNamed = (name: string) => get(name);
export const terrainSprite = (kind: 'rock' | 'thicket' | 'cave' | 'bamboo', v: number, g: Ground) => get(`ter/${kind}/${v % 3}/${g}`);
export const catSprite = (coat: string, frame: string, flip: boolean) => get(`cat/${coat}/${frame}`, flip);
export const catNeck = (frame: string): [number, number] => (frames[`cat/orange/${frame}`] as Frame & { neck?: [number, number] })?.neck ?? [8, 9];
export const catIcon = (coat = 'orange') => iconOf(`cat/${coat}/sit0`);
export const monsterSprite = (type: string, frame: number, flip: boolean) => get(`m/${type}/${frame}`, flip);
// the newer detailed creatures have four frames, the classic ones two
export const monsterFrames = (type: string) => (frames[`m/${type}/7`] ? 8 : frames[`m/${type}/3`] ? 4 : 2);

const layerCache = new Map<string, Layer | null>();

function layer(name: string): Layer | null {
  if (layerCache.has(name)) return layerCache.get(name)!;
  const f = frames[name];
  let l: Layer | null = null;
  if (f) {
    const { pixels, w } = sheets[f.s], data = new Uint8ClampedArray(PW * PH * 4);
    for (let y = 0; y < PH; y++) {
      const src = ((f.y + y) * w + f.x) * 4;
      data.set(pixels.subarray(src, src + PW * 4), y * PW * 4);
    }
    l = { data, tint: (f.tint as Layer['tint']) ?? '' };
  }
  layerCache.set(name, l);
  return l;
}

const humanCache = new Map<string, Sprite>();
const lookKey = (l: Look, frame: number) =>
  `${l.skin},${l.hair},${l.style},${l.cloth},${l.cloth2},${l.pants},${l.outfit},${l.head},${l.beard},${l.item},${l.cape ? 1 : 0},${frame}`;

function humanCanvas(look: Look, frame: number): HTMLCanvasElement {
  const layers = layerNames(look, frame).map(layer).filter((l): l is Layer => !!l);
  const c = makeCanvas(PW, PH);
  const px = new Uint8ClampedArray(compose(layers, lookColors(look)));
  if (BOB_FRAMES.includes(frame)) bob(px);
  c.getContext('2d')!.putImageData(new ImageData(px, PW, PH), 0, 0);
  return c;
}

export const EAST_ASIAN_SKIN = 5;
// adventurers share one cool East Asian complexion when the game is in Chinese, Japanese or Korean
const asian = () => culture.lang === 'zh' || culture.lang === 'ja' || culture.lang === 'ko';
export function humanSprite(role: Role, _cls: Cls, look: Look, frame: number, flip: boolean): Sprite {
  if (role === 'fighter' && asian() && look.skin !== EAST_ASIAN_SKIN) look = { ...look, skin: EAST_ASIAN_SKIN };
  const key = lookKey(look, frame) + (flip ? 'f' : '');
  let sp = humanCache.get(key);
  if (!sp) {
    let img = humanCanvas(look, frame);
    if (flip) {
      const f = makeCanvas(PW, PH);
      const ctx = f.getContext('2d')!;
      ctx.scale(-1, 1);
      ctx.drawImage(img, -PW, 0);
      img = f;
    }
    sp = { img, x: 0, y: 0, w: PW, h: PH, ax: flip ? PW - 1 - PAX : PAX, ay: PAY };
    humanCache.set(key, sp);
  }
  return sp;
}

const rotCache = new Map<string, Sprite>();
export function lyingSprite(role: Role, cls: Cls, look: Look): Sprite {
  const key = lookKey(look, 0);
  let s = rotCache.get(key);
  if (!s) {
    const src = humanSprite(role, cls, look, 0, false);
    const c = makeCanvas(src.h, src.w);
    const ctx = c.getContext('2d')!;
    ctx.translate(src.h, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(src.img, 0, 0);
    s = { img: c, x: 0, y: 0, w: src.h, h: src.w, ax: Math.floor(src.h / 2), ay: src.w - 6 };
    rotCache.set(key, s);
  }
  return s;
}

const iconCache = new Map<string, string>();
function iconOf(name: string, flip = false): string {
  let url = iconCache.get(name);
  if (!url) {
    const s = get(name, flip);
    const c = makeCanvas(s.w, s.h);
    c.getContext('2d')!.drawImage(s.img, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);
    url = c.toDataURL();
    iconCache.set(name, url);
  }
  return url;
}

export const itemIcon = (item: string) => iconOf(`i/${item}`);
export const monsterIcon = (type: string) => iconOf(`m/${type}/0`);
export const buildingIcon = (type: string) => iconOf(`bld/${type}`);
export const uiIcon = (name: string) => iconOf(`ui/${name}`);
export const uiSprite = (name: string) => get(`ui/${name}`);
export const tileIcon = (g: string, style: number) => iconOf(`tile/${g}/${style ? 'st' + style : 'street'}/0`);
const humanIcons = new Map<string, string>();
export function humanIcon(role: Role, cls: Cls, look: Look): string {
  if (role === 'fighter' && asian()) look = { ...look, skin: EAST_ASIAN_SKIN };
  const key = lookKey(look, 0);
  let url = humanIcons.get(key);
  if (!url) { url = (humanSprite(role, cls, look, 0, false).img as HTMLCanvasElement).toDataURL(); humanIcons.set(key, url); }
  return url;
}

// ---------- seasons ----------

function hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function rgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const LEAF_HUES = [26, 10, 42, 18];
const clamp = (v: number) => Math.max(0, Math.min(1, v));

// only greens are touched: autumn turns grass golden and leaves to reds and ambers, winter lays snow over both
function recolor(r: number, g: number, b: number, se: number, leaf: boolean, tone: number): [number, number, number] | null {
  const [h, s, l] = hsl(r, g, b);
  if (h < 55 || h > 175 || s < 0.12 || l < 0.06) return null;
  if (se === 2) {
    if (leaf) return rgb(LEAF_HUES[tone % 4], clamp(Math.max(s, 0.55) * 1.05), clamp(l * 1.04));
    return rgb(44 + (h - 100) * 0.08, s * 0.8, clamp(l * 1.03));
  }
  if (leaf) return l > 0.36 ? rgb(212, 0.3, clamp(0.84 + (l - 0.36) * 0.3)) : rgb(160, s * 0.45, l * 0.9);
  return rgb(212, 0.32, clamp(0.72 + l * 0.32));
}

const seasonCache = new Map<string, Sprite>();
export function seasonal(sp: Sprite, se: number, leaf: boolean): Sprite {
  if (se !== 2 && se !== 3) return sp;
  const sheet = sheets.find((sh) => sh.img === sp.img);
  if (!sheet) return sp;
  const sheetPixels = sheet.pixels;
  const key = `${sp.x},${sp.y},${sp.w},${sp.h},${se},${leaf ? 1 : 0}`;
  let out = seasonCache.get(key);
  if (!out) {
    const c = makeCanvas(sp.w, sp.h);
    const cx = c.getContext('2d')!;
    const id = cx.createImageData(sp.w, sp.h);
    const tone = (sp.x * 7 + sp.y * 13) >> 3;
    for (let y = 0; y < sp.h; y++) {
      for (let x = 0; x < sp.w; x++) {
        const i = ((sp.y + y) * sheet.w + sp.x + x) * 4, o = (y * sp.w + x) * 4;
        const a = sheetPixels[i + 3];
        if (!a) continue;
        const v = recolor(sheetPixels[i], sheetPixels[i + 1], sheetPixels[i + 2], se, leaf, tone);
        id.data[o] = v ? v[0] : sheetPixels[i];
        id.data[o + 1] = v ? v[1] : sheetPixels[i + 1];
        id.data[o + 2] = v ? v[2] : sheetPixels[i + 2];
        id.data[o + 3] = a;
      }
    }
    cx.putImageData(id, 0, 0);
    out = { ...sp, img: c, x: 0, y: 0 };
    seasonCache.set(key, out);
  }
  return out;
}
