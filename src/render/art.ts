import type { Ground, NodeKind } from '../game/data';
import type { Cls, Look, Role } from '../game/types';
import { makeCanvas } from './pixel';

export interface Frame { x: number; y: number; w: number; h: number; ax: number; ay: number; fx?: number[][] }
export interface Sprite extends Frame { img: CanvasImageSource }

export type TileKind = 'wild0' | 'wild1' | 'wild2' | 'village' | 'road' | 'street';
export const TILE_H = 22;
export const LOOK_COUNTS = { skin: 3, hair: 6, cloth: 4 };

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

const roleKey = (role: Role, cls: Cls) => (role === 'fighter' ? cls : role);
const lookKey = (l: Look) => `${l.skin % LOOK_COUNTS.skin}${l.hair % LOOK_COUNTS.hair}${l.cloth % LOOK_COUNTS.cloth}`;
export const humanSprite = (role: Role, cls: Cls, look: Look, frame: number, flip: boolean) =>
  get(`h/${roleKey(role, cls)}/${lookKey(look)}/${frame}`, flip);

const rotCache = new Map<string, Sprite>();
export function lyingSprite(role: Role, cls: Cls, look: Look): Sprite {
  const key = roleKey(role, cls) + lookKey(look);
  let s = rotCache.get(key);
  if (!s) {
    const src = humanSprite(role, cls, look, 0, false);
    const c = makeCanvas(src.h, src.w);
    const ctx = c.getContext('2d')!;
    ctx.translate(src.h, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(src.img, src.x, src.y, src.w, src.h, 0, 0, src.w, src.h);
    s = { img: c, x: 0, y: 0, w: src.h, h: src.w, ax: Math.floor(src.h / 2), ay: src.w - 4 };
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
export const humanIcon = (role: Role, cls: Cls, look: Look) => iconOf(`h/${roleKey(role, cls)}/${lookKey(look)}/0`);
