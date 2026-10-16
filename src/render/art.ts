import type { Ground, NodeKind } from '../game/data';
import type { Cls, Look, Role } from '../game/types';
import { makeCanvas } from './pixel';
import { PAX, PAY, PH, PW, compose, layerNames, lookColors, type Layer } from './compose';

export interface Frame { x: number; y: number; w: number; h: number; ax: number; ay: number; fx?: number[][]; tint?: string }
export interface Sprite extends Frame { img: CanvasImageSource }

export type TileKind = 'wild0' | 'wild1' | 'wild2' | 'village' | 'road' | 'street';
export const TILE_H = 22;

let sheet: HTMLImageElement;
let flippedSheet: HTMLCanvasElement;
let frames: Record<string, Frame> = {};
let sheetW = 0;

export async function loadArt(base = './assets/') {
  const [img, json] = await Promise.all([
    new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = fail;
      i.src = base + 'sprites.png';
    }),
    fetch(base + 'sprites.json').then((r) => r.json()),
  ]);
  sheet = img;
  frames = json.frames;
  sheetW = json.w;
  const raw = makeCanvas(img.width, img.height);
  const rctx = raw.getContext('2d', { willReadFrequently: true })!;
  rctx.drawImage(img, 0, 0);
  sheetPixels = rctx.getImageData(0, 0, img.width, img.height).data;
  flippedSheet = makeCanvas(img.width, img.height);
  const ctx = flippedSheet.getContext('2d')!;
  ctx.scale(-1, 1);
  ctx.drawImage(img, -img.width, 0);
}

const MISSING: Frame = { x: 0, y: 0, w: 1, h: 1, ax: 0, ay: 0 };

function get(name: string, flip = false): Sprite {
  const f = frames[name] ?? MISSING;
  if (!flip) return { img: sheet, ...f };
  // odd widths anchor on a pixel centre, even widths on the boundary between two pixels
  return { img: flippedSheet, x: sheetW - f.x - f.w, y: f.y, w: f.w, h: f.h, ax: f.w - f.ax - (f.w % 2), ay: f.ay, fx: f.fx?.map(([dx, dy]) => [-dx, dy]) };
}

export function draw(ctx: CanvasRenderingContext2D, s: Sprite, px: number, py: number) {
  ctx.drawImage(s.img, s.x, s.y, s.w, s.h, px - s.ax, py - s.ay, s.w, s.h);
}

export const tileSprite = (g: Ground, kind: TileKind, v: number) => get(`tile/${g}/${kind}/${v % 6}`);
export const buildingSprite = (type: string, flip = false) => get(`bld/${type}`, flip);
export const nodeSprite = (kind: NodeKind, v: number, g: Ground) => get(`node/${kind}/${v % (kind === 'tree' ? 4 : 2)}/${g}`);
export const monsterSprite = (type: string, frame: number, flip: boolean) => get(`m/${type}/${frame}`, flip);

let sheetPixels: Uint8ClampedArray | null = null;
const layerCache = new Map<string, Layer | null>();

function layer(name: string): Layer | null {
  if (layerCache.has(name)) return layerCache.get(name)!;
  const f = frames[name];
  let l: Layer | null = null;
  if (f && sheetPixels) {
    const data = new Uint8ClampedArray(PW * PH * 4);
    for (let y = 0; y < PH; y++) {
      const src = ((f.y + y) * sheetW + f.x) * 4;
      data.set(sheetPixels.subarray(src, src + PW * 4), y * PW * 4);
    }
    l = { data, tint: (f.tint as Layer['tint']) ?? '' };
  }
  layerCache.set(name, l);
  return l;
}

const humanCache = new Map<string, Sprite>();
const lookKey = (l: Look, frame: number) =>
  `${l.skin},${l.hair},${l.style},${l.cloth},${l.cloth2},${l.pants},${l.outfit},${l.head},${l.beard},${l.item},${frame}`;

function humanCanvas(look: Look, frame: number): HTMLCanvasElement {
  const layers = layerNames(look, frame).map(layer).filter((l): l is Layer => !!l);
  const c = makeCanvas(PW, PH);
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(compose(layers, lookColors(look))), PW, PH), 0, 0);
  return c;
}

export function humanSprite(_role: Role, _cls: Cls, look: Look, frame: number, flip: boolean): Sprite {
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
const humanIcons = new Map<string, string>();
export function humanIcon(role: Role, cls: Cls, look: Look): string {
  const key = lookKey(look, 0);
  let url = humanIcons.get(key);
  if (!url) { url = (humanSprite(role, cls, look, 0, false).img as HTMLCanvasElement).toDataURL(); humanIcons.set(key, url); }
  return url;
}
