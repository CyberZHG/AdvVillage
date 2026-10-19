import { DAY, MAP } from '../game/constants';
import { BUILDINGS, CLASSES, MONSTERS, culture, finished, isOpen, villageDef, type Ground } from '../game/data';
import { BUILD_TIME } from '../game/econ';
import { lightHour, maxHp, monsterStats, tod } from '../game/state';
import { BOG, CANYON, CAVE, SPRING, GLACIER, CREVASSE, MANGROVE, PILLAR, covers, landmarks, LAVA, ROCK, STREAM, THICKET, VB, VENT, WATER, isBeach, isLava, isRopeBridge, isSea, terrainState, isFlooded, isFlowers, isFrozen, villageDist, blocked, doorOf, elevation, halfLevel, inMap, inVillage, isGate, isRoad, onRing, placement, rampAt, roadState, terrainAt, zoneOf } from '../game/world';
import { t } from '../i18n';
import { drawAtmosphere, drawEmote, drawWeather, nightAlpha } from './atmosphere';
import { drawFlavor } from './flavor';
import { nearWater } from '../game/jobs';
import { rides } from '../game/sim';
import { along, waterRoute, type Route, findSpots, horizon, lighthouse, fallPools, firecrackerLitter, karst, kite, meteors, pondLife, rainbow, ropeBridges, seaLife, seaTorii, skyLife, volcano, wayside, type Spots, type View } from './scene';
import { currentBoss, festival, observance, season, solarTerm, tsuyu } from '../game/events';
import { villageFest } from '../game/village';
import type { Building, Cat, GameState, Look, Npc } from '../game/types';
import { makeLook } from '../game/looks';
import { hasPerk } from '../game/cat';
import { makeCanvas } from './pixel';
import { FRAME } from './compose';
import {
  TILE_H, edgeSprite, litSpots, monsterFrames, bankSprite, cliffSprite, fallSprite, rampSprite, spriteNamed, buildingLit, buildingSprite, localTreeSprite, sailSprite, terrainSprite, catNeck, propSprite, seasonal, catSprite, draw, humanSprite, lyingSprite, monsterSprite, nodeSprite, tileSprite, type Sprite, type TileKind,
} from './art';

export type Sel = { kind: 'npc' | 'bld' | 'mon' | 'pet' | 'cat'; id: number } | null;
interface Floater { x: number; y: number; text: string; color: string; t: number }
interface Drawable { depth: number; draw: () => void; hit?: { x: number; y: number; w: number; h: number; sel: Sel } }

const GX = MAP * 16;
export const CLASS_COLOR: Record<string, string> = {
  warrior: '#ff5a4a', knight: '#a8c8ff', archer: '#6ae05a', rogue: '#c07aff',
  mage: '#4aa8ff', cleric: '#fff2a0', lancer: '#ffa040', monk: '#ffd84a',
};

export type Crowd = 'all' | 'lite' | 'min' | 'fighters';
// light pools around lamps after dark: [dx, dy from the tile anchor, radius]
const HALO: Record<string, [number, number, number]> = { lamppost: [0, 4, 22], stoneLantern: [0, 7, 14], torii: [0, 8, 10], operaStage: [0, 14, 20], onsen: [12, 14, 16] };

// each village's buildings take on a little of its land's colour: warm adobe in the desert, damp greys in the marsh
const TINT_OF: Record<string, [number, number, number, number]> = { sand: [232, 200, 144, 0.16], marsh: [90, 122, 96, 0.12], rocky: [138, 138, 146, 0.12], snow: [200, 216, 240, 0.1] };
const tintCache = new Map<string, Sprite>();
function groundTint(sp: Sprite, g: string, key: string): Sprite {
  const tn = TINT_OF[g];
  if (!tn) return sp;
  const k = key + ':' + g;
  let out = tintCache.get(k);
  if (!out) {
    const c = makeCanvas(sp.w, sp.h), cx = c.getContext('2d')!;
    cx.drawImage(sp.img, sp.x, sp.y, sp.w, sp.h, 0, 0, sp.w, sp.h);
    const im = cx.getImageData(0, 0, sp.w, sp.h), d = im.data;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3]) { d[i] += (tn[0] - d[i]) * tn[3]; d[i + 1] += (tn[1] - d[i + 1]) * tn[3]; d[i + 2] += (tn[2] - d[i + 2]) * tn[3]; }
    cx.putImageData(im, 0, 0);
    out = { ...sp, img: c, x: 0, y: 0 };
    tintCache.set(k, out);
  }
  return out;
}

// climbing ivy and moss along the lower walls of buildings that have stood a long time
const ivyCache = new Map<string, Sprite>();
function ivy(sp: Sprite, key: string): Sprite {
  let out = ivyCache.get(key);
  if (!out) {
    const c = makeCanvas(sp.w, sp.h), cx = c.getContext('2d')!;
    cx.drawImage(sp.img, sp.x, sp.y, sp.w, sp.h, 0, 0, sp.w, sp.h);
    const im = cx.getImageData(0, 0, sp.w, sp.h), d = im.data;
    for (let x = 0; x < sp.w; x++) {
      let bottom = -1;
      for (let y = sp.h - 1; y >= 0; y--) if (d[(y * sp.w + x) * 4 + 3]) { bottom = y; break; }
      if (bottom < 0) continue;
      const reach = 3 + ((x * 7) % 9);
      for (let y = bottom - 2; y > bottom - reach && y > 0; y--) {
        const i = (y * sp.w + x) * 4;
        if (!d[i + 3] || (x * 13 + y * 7) % 4) continue;
        d[i] = 70; d[i + 1] = 130 + ((x + y) % 3) * 15; d[i + 2] = 60;
      }
    }
    cx.putImageData(im, 0, 0);
    out = { ...sp, img: c, x: 0, y: 0 };
    ivyCache.set(key, out);
  }
  return out;
}

// a building wet with rain: darker all over with streaks running down, drying from its outline inward; stage 4 is
// soaking, 3..1 progressively drier toward the middle
const wetCache = new Map<string, Sprite>();
function wetSprite(sp: Sprite, key: string, stage: number): Sprite {
  key += ':' + stage;
  let out = wetCache.get(key);
  if (!out) {
    const c = makeCanvas(sp.w, sp.h), cx = c.getContext('2d')!;
    cx.drawImage(sp.img, sp.x, sp.y, sp.w, sp.h, 0, 0, sp.w, sp.h);
    const im = cx.getImageData(0, 0, sp.w, sp.h), d = im.data, w = sp.w, h = sp.h;
    // distance of each pixel from the outline, to dry the edges first
    const dist = new Uint8Array(w * h).fill(99);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!d[(y * w + x) * 4 + 3]) dist[y * w + x] = 0;
    for (let pass = 0; pass < 2; pass++) for (let k = 0; k < w * h; k++) {
      const i = pass ? w * h - 1 - k : k, x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h) dist[i] = Math.min(dist[i], dist[ny * w + nx] + 1); else dist[i] = Math.min(dist[i], 1); }
    }
    const dryEdge = stage >= 4 ? 0 : (4 - stage) * 3;
    for (let i = 0; i < w * h; i++) {
      if (!d[i * 4 + 3] || dist[i] <= dryEdge) continue;
      const x = i % w, y = (i / w) | 0, streak = stage >= 4 && (x * 5 + Math.floor(y / 3)) % 9 === 0 && y < h * 0.6;
      const f = streak ? 0.95 : 0.8;
      d[i * 4] = Math.round(d[i * 4] * f); d[i * 4 + 1] = Math.round(d[i * 4 + 1] * f); d[i * 4 + 2] = Math.round(Math.min(255, d[i * 4 + 2] * (f + 0.04)));
    }
    cx.putImageData(im, 0, 0);
    if (wetCache.size > 400) wetCache.clear();
    out = { ...sp, img: c, x: 0, y: 0 };
    wetCache.set(key, out);
  }
  return out;
}
// a white cap along every top edge, for snowy weather and winter
const snowCache = new Map<string, Sprite>();
function snowCap(sp: Sprite, key: string, depth = 1): Sprite {
  key += ':' + depth;
  let out = snowCache.get(key);
  if (!out) {
    const c = makeCanvas(sp.w, sp.h), cx = c.getContext('2d')!;
    cx.drawImage(sp.img, sp.x, sp.y, sp.w, sp.h, 0, 0, sp.w, sp.h);
    const im = cx.getImageData(0, 0, sp.w, sp.h), d = im.data;
    const a = (x: number, y: number) => (y < 0 ? 0 : d[(y * sp.w + x) * 4 + 3]);
    for (let x = 0; x < sp.w; x++) for (let y = sp.h - 1; y >= 0; y--) {
      const i = (y * sp.w + x) * 4;
      if (!d[i + 3]) continue;
      // deeper snow lies thicker: the top one, two or three pixels of every upward surface turn white
      if (!a(x, y - 1) || (depth >= 2 && !a(x, y - 2) && (x + y) % 2 === 0) || (depth >= 3 && !a(x, y - 3) && (x * 3 + y) % 3 !== 0)) { d[i] = 244; d[i + 1] = 248; d[i + 2] = 252; }
      // icicles hang under the eaves: an overhang edge with open air below
      else if (y < sp.h * 0.7 && y + 2 < sp.h && !a(x, y + 1) && (x * 7 + y) % 3 === 0) for (let k = 1; k <= 1 + (x % 2); k++) { const j = ((y + k) * sp.w + x) * 4; d[j] = 200; d[j + 1] = 228; d[j + 2] = 245; d[j + 3] = 255; }
      else if (!a(x, y - 2) && (x + y) % 3) { d[i] = Math.round(d[i] * 0.3 + 170); d[i + 1] = Math.round(d[i + 1] * 0.3 + 174); d[i + 2] = Math.round(d[i + 2] * 0.3 + 178); }
    }
    cx.putImageData(im, 0, 0);
    out = { ...sp, img: c, x: 0, y: 0 };
    snowCache.set(key, out);
  }
  return out;
}
// headroom on the ground sheet for raised tiles
const LIFT_PAD = 24;
const WALL_MAT: Record<string, string> = { meadow: 'wood', marsh: 'wood', rocky: 'stone', snow: 'stone', sand: 'adobe' };

const LANTERN: Record<string, string[]> = { zh: ['#d83a2a'], ja: ['#f4ecd8'], ko: ['#e84a6a', '#3a7ad8', '#f2c84a', '#4ab06a'] };
// about a third of wild trees take the player's regional species
const LOCAL_TREES: Record<string, string[]> = { zh: ['ginkgo', 'peach'], ja: ['sakura', 'momiji'], ko: ['persimmon', 'pine'] };
const localTree = (id: number) => { const l = LOCAL_TREES[culture.lang]; return l && id % 3 === 0 ? l[(id / 3 | 0) % l.length] : null; };
// per season: [colour, pieces] of what drifts down
const LEAF_FALL: Record<string, ([string, number] | null)[]> = {
  ginkgo: [null, null, ['#f2c830', 4], null], peach: [['#f6a8c0', 2], null, null, null],
  sakura: [['#fbc4d8', 5], null, null, null], momiji: [null, null, ['#d8402a', 3], null],
};

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private low = makeCanvas(1, 1);
  private lctx = this.low.getContext('2d')!;
  private ground: HTMLCanvasElement | null = null;
  private groundKey = '';
  private floaters: Floater[] = [];
  private hits: NonNullable<Drawable['hit']>[] = [];
  private ox = 0;
  private oy = 0;
  cam = { x: 0, y: 32 * 16, zoom: 3 };
  hoverTile: { x: number; y: number } | null = null;
  ghost: string | null = null;
  ghostRot = 0;
  labels = false;
  focusFighters = false;
  crowd: Crowd = 'all';
  // at high game speeds the light stays at midday so day and night do not strobe past
  fast = false;
  private wNow: string | null = null;
  private wPrev = 'clear';
  private wAt = -9;
  private lightTod(s: GameState) { return this.fast ? 0.4 : lightHour(s); }
  private lanes = new Map<number, [number, number]>();
  get view() { return this.low; }
  selected: Sel = null;
  follow: number | null = null;
  dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize() {
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(window.innerWidth * this.dpr);
    this.canvas.height = Math.floor(window.innerHeight * this.dpr);
    this.cam.zoom = Math.max(1, Math.min(this.cam.zoom, 12));
  }

  defaultZoom() { return Math.max(2, Math.round((window.innerWidth < 700 ? 1.3 : 2) * this.dpr)); }

  // the camera glides after the followed resident while they are out in the open
  private followTick(s: GameState) {
    if (this.follow == null) return;
    const n = s.npcs.find((o) => o.id === this.follow);
    if (!n) { this.follow = null; return; }
    if (n.inside != null || n.state === 'away') return;
    const tx = (n.x - n.y) * 16, ty = (n.x + n.y) * 8;
    this.cam.x += (tx - this.cam.x) * 0.12;
    this.cam.y += (ty - this.cam.y) * 0.12;
  }

  centerOn(tx: number, ty: number) {
    this.cam.x = (tx - ty) * 16;
    this.cam.y = (tx + ty) * 8;
  }

  zoomBy(d: number) {
    this.cam.zoom = Math.max(1, Math.min(12, this.cam.zoom + d));
  }

  pan(dxPx: number, dyPx: number) {
    this.cam.x -= (dxPx * this.dpr) / this.cam.zoom;
    this.cam.y -= (dyPx * this.dpr) / this.cam.zoom;
    this.cam.x = Math.max(-MAP * 16, Math.min(MAP * 16, this.cam.x));
    this.cam.y = Math.max(0, Math.min(MAP * 16, this.cam.y));
  }

  // client px -> fractional tile coords
  toTile(cx: number, cy: number) {
    const lx = (cx * this.dpr) / this.cam.zoom - this.ox;
    const ly = (cy * this.dpr) / this.cam.zoom - this.oy;
    return { x: (ly / 8 + lx / 16) / 2, y: (ly / 8 - lx / 16) / 2 };
  }

  pick(cx: number, cy: number, s: GameState): Sel {
    const lx = (cx * this.dpr) / this.cam.zoom, ly = (cy * this.dpr) / this.cam.zoom;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (lx >= h.x && ly >= h.y && lx < h.x + h.w && ly < h.y + h.h) return h.sel;
    }
    const t = this.toTile(cx, cy);
    const b = s.buildings.find((b) => {
      const n = BUILDINGS[b.type].size;
      return t.x >= b.x && t.y >= b.y && t.x < b.x + n && t.y < b.y + n;
    });
    return b ? { kind: 'bld', id: b.id } : null;
  }

  private buildGround(s: GameState) {
    const g = villageDef(s.village).ground;
    const se = landSeason(s);
    const key = `${s.village}:${s.vlv}:${roadState.version}:${terrainState.version}:${se}:${culture.lang}:${isFrozen()}:${isFlooded(0, 0)}:${this.thawStage(s)}:${tsuyu(s) || (season(s) === 0 && (s.weather === 'rain' || s.weather === 'storm'))}`;
    const road = villageDef(s.village).road;
    if (this.ground && this.groundKey === key) return;
    this.groundKey = key;
    this.islands = [];
    this.harvest = [];
    const c = makeCanvas(MAP * 32 + 32, MAP * 16 + TILE_H + LIFT_PAD + 24);
    // winter, or the snowfield village: snow drifts over the road edges
    const winter = se === 3 || g === 'snow';
    // early spring: the last of the snow lies in rounded patches out in the wilds, shrinking day by day and gone first
    // beside roads and the village
    const thaw = this.thawStage(s);
    const thawPatch = (x: number, y: number) => {
      if (!thaw || !inMap(x, y) || terrainAt(x, y) || isRoad(x, y) || villageDist(x, y) < 2 || (halfLevel(x, y) & 1)) return false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isRoad(x + dx, y + dy)) return false;
      const cx = Math.floor(x / 6), cy = Math.floor(y / 6);
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const h = hash(cx + ox, cy + oy, 707), px0 = (cx + ox) * 6 + (h % 6), py0 = (cy + oy) * 6 + ((h >> 4) % 6), r = (1 + (h >> 9) % 3) * thaw / 2.2;
        if (h % 3 === 0 && Math.hypot(x - px0, (y - py0) * 1.1) < r) return true;
      }
      return false;
    };
    // rainy weeks fill the hollows with standing water
    const rainy = tsuyu(s) || (season(s) === 0 && (s.weather === 'rain' || s.weather === 'storm'));
    // only the bottoms of the hollows fill: rounded pond-sized patches, not whole valleys
    const rainPool = (x: number, y: number) => rainy && g !== 'sand' && inMap(x, y) && halfLevel(x, y) < 0 && !(halfLevel(x, y) & 1) && !terrainAt(x, y) && !isRoad(x, y)
      && softNoise(x / 3.2, y / 3.2, 41) > (halfLevel(x, y) <= -4 ? 0.48 : 0.6);
    this.pooled = new Set<number>();
    if (rainy) for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) if (rainPool(x, y)) this.pooled.add(y * MAP + x);
    // the desert oasis: a ring of grass and palms round the lake, flooded at its inner edge in spring
    const oasis = (x: number, y: number) => g === 'sand' && inMap(x, y) && !terrainAt(x, y) && !isRoad(x, y) && [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => terrainAt(x + dx, y + dy) === WATER && !isSea(x + dx, y + dy));
    const travPool = (x: number, y: number) => (villageDef(s.village).terrain.terraces ?? []).some(([tx, ty]) => x >= tx && x < tx + 2 && y >= ty && y < ty + 2);
    const oasisFlood = (x: number, y: number) => se === 0 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => terrainAt(x + dx, y + dy) === WATER);
    // the top of the corner peak is a snowfield, or on the volcano a field of ash
    const volcanic = !!villageDef(s.village).terrain.volcano;
    const summit = (x: number, y: number) => g !== 'sand' && inMap(x, y) && x <= 13 && y <= 13 && halfLevel(x, y) >= 6 && !(halfLevel(x, y) & 1) && !terrainAt(x, y);
    const ctx = c.getContext('2d')!;
    for (let d = 0; d < MAP * 2 - 1; d++) {
      for (let i = 0; i < MAP; i++) {
        const j = d - i;
        if (j < 0 || j >= MAP) continue;
        let kind: TileKind;
        const k = terrainAt(i, j);
        if (isRoad(i, j)) {
          if (k === WATER) {
            // the deck runs the way the road does
            const ax = +isRoad(i - 1, j) + +isRoad(i + 1, j), ay = +isRoad(i, j - 1) + +isRoad(i, j + 1);
            kind = (culture.lang === 'zh' ? (ax >= ay ? 'sbridgeX' : 'sbridgeY') : ax >= ay ? 'bridgeX' : 'bridgeY');
          } else if (k === BOG) kind = 'st4';
          else if (inVillage(i, j)) { const st = s.rstyle?.[j * MAP + i] ?? road; kind = st ? (`st${st}` as TileKind) : 'street'; }
          else kind = 'road';
        } else if (isFlooded(i, j) && !k) kind = 'water';
        else if (k === WATER || k === STREAM) kind = isFrozen() && !isSea(i, j) ? 'ice' : isSea(i, j) && [[0, 1], [1, 0], [-1, 0], [1, 1], [-1, 1]].every(([dx, dy]) => !inMap(i + dx, j + dy) || isSea(i + dx, j + dy)) ? 'sea' : 'water';
        else if (k === LAVA) kind = 'lava';
        else if (isBeach(i, j)) kind = 'sand';
        else if (summit(i, j) || thawPatch(i, j)) kind = volcanic && summit(i, j) ? 'ash' : 'snowtop';
        else if (k === CANYON) kind = 'gorge';
        else if (k === VENT) kind = 'vent';
        else if (k === BOG) kind = 'bog';
        else if (k === THICKET) kind = 'litter';
        else if (k === SPRING) kind = travPool(i, j) ? 'trav' : 'spring';
        else if (k === GLACIER || k === CREVASSE) kind = 'glacier';
        else if (k === MANGROVE) kind = 'mud';
        else if (rainPool(i, j)) kind = 'water';
        else if (oasis(i, j)) kind = oasisFlood(i, j) ? 'water' : 'oasis';
        else if (this.paddyAt(i, j)) kind = `paddy${Math.max(0, se)}` as TileKind;
        else if (inVillage(i, j)) kind = 'village';
        else kind = (['wild0', 'wild1', 'wild2'] as const)[Math.max(0, zoneOf(i, j))];
        const v = ((i * 73856093) ^ (j * 19349663)) >>> 0;
        // raised ground sits higher on the sheet; cliff faces fill the drop to any lower tile in front
        const hl = halfLevel(i, j), L = Math.floor(hl / 2), ty = (i + j) * 8 + LIFT_PAD - L * 8, px = GX + (i - j) * 16;
        const front = Math.min(...[[1, 0], [0, 1], [1, 1]].map(([dx, dy]) => (inMap(i + dx, j + dy) ? Math.floor(halfLevel(i + dx, j + dy) / 2) : L)));
        // a rope bridge spans the gorge: under it there is only the dark drop to the gorge floor
        if (isRopeBridge(i, j)) { this.chasm(ctx, g, px, ty, v); continue; }
        // where open water drops a level the face is a waterfall instead of rock
        const falls = k === WATER && !isRoad(i, j) && L > front, lavaFalls = k === LAVA && L > front, iceFace = (k === GLACIER || k === CREVASSE) && L > front, trav = k === SPRING && L > front;
        // the walls of the gorge are banded sandstone, darkening as they go down into it
        const gorgeWall = L > front && [[1, 0], [0, 1], [1, 1]].some(([dx, dy]) => terrainAt(i + dx, j + dy) === CANYON && !isRoad(i + dx, j + dy));
        for (let b = 0; b < L - front; b++) {
          draw(ctx, falls ? fallSprite(g, (v + b) % 3) : iceFace ? spriteNamed(`cliff/${g}/icecliff${(v + b) % 3}`) : trav ? spriteNamed(`cliff/${g}/travfall${(v + b) % 3}`) : lavaFalls ? spriteNamed(`cliff/${g}/lavafall${(v + b) % 3}`) : gorgeWall && g === 'sand' ? spriteNamed(`cliff/${g}/gorge${(v + b) % 3}`) : cliffSprite(g, (v + b) % 3), px, ty + 8 * b);
          if (gorgeWall && b) { ctx.fillStyle = `rgba(30,18,14,${(0.12 * b).toFixed(2)})`; ctx.beginPath(); ctx.moveTo(px, ty + 8 + 8 * b); ctx.lineTo(px + 16, ty + 16 + 8 * b); ctx.lineTo(px + 32, ty + 8 + 8 * b); ctx.lineTo(px + 32, ty + 16 + 8 * b); ctx.lineTo(px + 16, ty + 24 + 8 * b); ctx.lineTo(px, ty + 16 + 8 * b); ctx.fill(); }
        }
        if (falls || trav) this.falls.push({ x: i, y: j, drop: L - front });
        if (iceFace) this.iceFaces.push({ x: i, y: j });
        else if (L > front && !falls && !lavaFalls && !trav && i + j < 34 && !k && L >= 2) this.cliffFaces.push({ x: i, y: j, drop: L - front });
        if (lavaFalls) this.lavaFalls.push({ x: i, y: j, drop: L - front });
        if (hl & 1) draw(ctx, seasonal(rampSprite(g, 'w' + Math.max(0, zoneOf(i, j)), rampAt(i, j)), se, false), px, ty);
        else draw(ctx, seasonal(kind === 'oasis' ? tileSprite('meadow', 'wild0', v) : tileSprite(g, kind, v), se, false), px, ty);
        // a dark band of reflection on the water beside a bridge deck
        if (kind === 'water' && [[-1, 0], [0, -1]].some(([dx, dy]) => isRoad(i + dx, j + dy) && terrainAt(i + dx, j + dy) === WATER)) { ctx.fillStyle = 'rgba(30,40,70,0.25)'; ctx.fillRect(px + 8, ty + 2, 16, 4); }
        // rain pools join each other and the river or lake beside them into one body of water, banked only round its edge
        if (kind === 'water' || kind === 'ice' || kind === 'sea') this.shore(ctx, g, se, i, j, v, ty, rainPool);
        else if (kind === 'sand') this.edges(ctx, g, se, i, j, v, ty, 'edge', (x, y) => isBeach(x, y) || terrainAt(x, y) === WATER);
        else if (kind === 'gorge') this.gorgeEdges(ctx, g, i, j, v, ty);
        else if (kind === 'road' && winter) this.plainEdges(ctx, 'wedge', g, i, j, v, ty, (x, y) => isRoad(x, y) || !!terrainAt(x, y));
        else if (kind === 'road') this.edges(ctx, g, se, i, j, v, ty, 'redge', (x, y) => isRoad(x, y) || !!terrainAt(x, y), true);
        else if (kind.startsWith('paddy')) this.edges(ctx, g, se, i, j, v, ty, 'pedge', (x, y) => this.paddyAt(x, y) && halfLevel(x, y) === halfLevel(i, j));
        else if (kind === 'glacier') { this.plainTagEdges(ctx, 'gledge', g, i, j, v, ty, (x, y) => terrainAt(x, y) === GLACIER || terrainAt(x, y) === CREVASSE); if (k === CREVASSE) this.crevasse(ctx, px, ty, i, j); }
        else if (kind === 'mud') this.plainTagEdges(ctx, 'medge', g, i, j, v, ty, (x, y) => terrainAt(x, y) === MANGROVE || terrainAt(x, y) === WATER || isBeach(x, y));
        else if (kind === 'oasis') this.plainTagEdges(ctx, 'zedge', g, i, j, v, ty, (x, y) => oasis(x, y) || terrainAt(x, y) === WATER || rainPool(x, y));
        else if (kind === 'trav') this.plainEdges(ctx, 'vedge', g, i, j, v, ty, (x, y) => travPool(x, y) && halfLevel(x, y) === halfLevel(i, j));
        else if (kind === 'spring') this.edges(ctx, g, se, i, j, v, ty, 'hedge', (x, y) => terrainAt(x, y) === SPRING || terrainAt(x, y) === VENT);
        else if (kind === 'litter') this.edges(ctx, g, se, i, j, v, ty, 'tedge', (x, y) => terrainAt(x, y) !== 0 || isRoad(x, y));
        else if (kind === 'village' || kind.startsWith('wild')) this.zoneEdges(ctx, g, se, i, j, v, ty, kind);
        else if (kind.startsWith('st') || kind === 'street') this.curbs(ctx, g, i, j, v, ty);
        if (kind !== 'gorge' && !terrainAt(i, j)) this.rim(ctx, g, i, j, v, ty);
        if (kind === 'bog') this.edges(ctx, g, se, i, j, v, ty, 'bedge', (x, y) => terrainAt(x, y) === BOG || terrainAt(x, y) === WATER || isRoad(x, y));
        else if (kind === 'lava') this.edges(ctx, g, se, i, j, v, ty, 'ledge', (x, y) => isLava(x, y));
        else if (kind === 'snowtop' || kind === 'ash') this.edges(ctx, g, se, i, j, v, ty, volcanic ? 'aedge' : 'sedge', (x, y) => summit(x, y) || thawPatch(x, y) || isLava(x, y) || (halfLevel(x, y) & 1) === 1 && Math.floor(halfLevel(x, y) / 2) >= 2);
        else if (kind !== 'water' && kind !== 'ice' && kind !== 'sea' && kind !== 'sand' && kind !== 'gorge') this.tileExtras(ctx, s, se, i, j, L, px, ty, v);
        this.landBake(ctx, s, i, j, L, px, ty, k);
        this.relief(ctx, s, g, i, j, L, px, ty, v, k, kind);
      }
    }
    // scenery is derived from the tile position, so it needs no saving and stays put
    this.scenery = [];
    this.walls = [];
    const wm = WALL_MAT[g];
    const bamboo = culture.lang === 'zh' || culture.lang === 'ja';
    this.crags = [];
    this.falls = [];
    this.lavaFalls = [];
    this.iceFaces = [];
    this.cliffFaces = [];
    this.vents = [];
    this.flutter = [];
    this.waters = [];
    this.bogs = [];
    for (let j = 0; j < MAP; j++) for (let i = 0; i < MAP; i++) {
      const k = terrainAt(i, j), road = isRoad(i, j);
      if ((k === WATER || k === STREAM) && !road) this.waters.push(j * MAP + i);
      if (k === BOG && !road) this.bogs.push(j * MAP + i);
      if (k === PILLAR) this.crags.push({ x: i, y: j, kind: 'pillar', v: hash(i, j, 3) % 3 });
      if (k === MANGROVE && hash(i, j, 4) % 2 === 0) this.crags.push({ x: i, y: j, kind: 'mangrove', v: hash(i, j, 3) % 2 });
      if (g === 'sand' && !k && !road && inMap(i, j) && [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2], [-2, 0], [0, -2]].some(([dx, dy]) => terrainAt(i + dx, j + dy) === WATER) && hash(i, j, 6) % 3 === 0) this.crags.push({ x: i, y: j, kind: 'palm', v: hash(i, j, 3) % 2 });
      if ((k === ROCK || k === THICKET || k === CAVE) && !road) this.crags.push({ x: i, y: j, kind: k === ROCK ? 'rock' : k === CAVE ? 'cave' : bamboo ? 'bamboo' : 'thicket', v: hash(i, j, 3) % 3 });
      if (k === VENT || (k === SPRING && hash(i, j, 5) % 2 === 0)) this.vents.push(j * MAP + i);
      // flower meadows: a dense carpet of blooms and a few butterflies over it
      if (isFlowers(i, j) && !road && !k && se !== 3 && !this.pooled.has(j * MAP + i)) {
        for (let f = 0; f < 4; f++) {
          const hh = hash(i, j, 50 + f), fx = i + 0.2 + ((hh % 60) / 100), fy = j + 0.2 + (((hh >> 8) % 60) / 100);
          draw(ctx, seasonal(propSprite(`flowers${hh % 5}`, g), se, true), GX + Math.round((fx - fy) * 16), Math.round((fx + fy) * 8 - elevation(fx, fy) * 8) + 1 + LIFT_PAD);
        }
        if (hash(i, j, 77) % 5 === 0) this.flutter.push(j * MAP + i);
      } else if (!road && !k && se !== 3 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isFlowers(i + dx, j + dy))) {
        // a few blooms stray beyond the meadow, thinning out toward its neighbours
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!isFlowers(i + dx, j + dy)) continue;
          const hh = hash(i, j, 90 + dx * 3 + dy), fx = i + 0.5 + dx * (0.25 + (hh % 20) / 100) + ((hh >> 6) % 30 - 15) / 100 * (dy ? 1 : 0), fy = j + 0.5 + dy * (0.25 + (hh % 20) / 100) + ((hh >> 6) % 30 - 15) / 100 * (dx ? 1 : 0);
          draw(ctx, seasonal(propSprite(`flowers${hh % 5}`, g), se, true), GX + Math.round((fx - fy) * 16), Math.round((fx + fy) * 8 - elevation(fx, fy) * 8) + 1 + LIFT_PAD);
        }
      }
      if (onRing(i, j) && !(k === WATER || k === ROCK)) {
        const side = i < VB.min ? 'W' : i > VB.max ? 'E' : j < VB.min ? 'N' : 'S';
        const corner = (i < VB.min || i > VB.max) && (j < VB.min || j > VB.max);
        // the two sides facing the viewer stay low so they never hide the village
        const lo = corner ? i > VB.max && j > VB.max : side === 'S' || side === 'E';
        const axis = side === 'N' || side === 'S' ? 0 : 1;
        this.wallGround(ctx, i, j, isGate(i, j));
        this.walls.push({ x: i, y: j, name: corner ? `tower/${wm}/${lo ? 'lo' : 'hi'}` : `${isGate(i, j) ? 'gate' : 'wall'}/${wm}/${axis}/${lo ? 'lo' : 'hi'}` });
        continue;
      }
      const z = zoneOf(i, j);
      if (z < 0 || road || k || this.pooled.has(j * MAP + i)) continue;
      const h = hash(i, j, s.village.length), r = (h % 1000) / 1000, pick = hash(j, i, 7);
      const ox = ((h >> 10) % 9 - 4) / 18, oy = ((h >> 14) % 9 - 4) / 18;
      if (r < 0.22) {
        const pool = SMALL[g].filter((k) => !(se === 3 && k.startsWith('flowers')));
        const name = pool[pick % pool.length];
        const x = i + 0.5 + ox, y = j + 0.5 + oy;
        draw(ctx, seasonal(propSprite(name, g), se, true), GX + Math.round((x - y) * 16), Math.round((x + y) * 8 - elevation(x, y) * 8) + 1 + LIFT_PAD);
      } else if (r < (z === 2 ? 0.4 : 0.28)) {
        const pool = bigPool(g, z);
        this.scenery.push({ x: i + 0.5 + ox, y: j + 0.5 + oy, tx: i, ty: j, name: pool[pick % pool.length] });
      }
    }
    this.spots = findSpots();
    this.route = waterRoute(s);
    this.buildFlow(s);
    const mask = makeCanvas(c.width, c.height), mg = mask.getContext('2d')!;
    mg.fillStyle = '#fff';
    for (let j = 0; j < MAP; j++) for (let i = 0; i < MAP; i++) {
      const k = terrainAt(i, j);
      if ((k !== WATER && k !== STREAM) || isRoad(i, j)) continue;
      const L = Math.floor(halfLevel(i, j) / 2), px = GX + (i - j) * 16, ty = (i + j) * 8 + LIFT_PAD - L * 8;
      mg.beginPath(); mg.moveTo(px + 16, ty); mg.lineTo(px + 32, ty + 8); mg.lineTo(px + 16, ty + 16); mg.lineTo(px, ty + 8); mg.fill();
    }
    this.waterMask = mask;
    this.ground = c;
  }

  // baked terrain looks: the sea deepening offshore, sand along the beach, lava crusts and ash around them,
  // the shadowed gorge floor, and stepping stones through Japanese bamboo groves
  private spots: Spots = findSpots();
  private pooled = new Set<number>();
  private route: Route | null = null;
  private landBake(ctx: CanvasRenderingContext2D, s: GameState, i: number, j: number, L: number, px: number, ty: number, k: number) {
    if (isSea(i, j)) return;
    if (villageDef(s.village).terrain.volcano && !k) {
      const near = this.spots.lava.some((l) => Math.abs((l % MAP) - i) + Math.abs(((l / MAP) | 0) - j) <= 2);
      if (near) for (let n = 0; n < 8; n++) { const h = hash(i, j, 640 + n); ctx.fillStyle = n % 2 ? 'rgba(40,34,32,0.5)' : 'rgba(70,60,56,0.45)'; ctx.fillRect(px + 6 + (h % 20), ty + 3 + ((h >> 5) % 10), 2, 1); }
    }
    // rounded stones set along the rim of a hot spring pool
    if (!k) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (terrainAt(i + dx, j + dy) !== SPRING) continue;
      for (let n = 0; n < 2; n++) {
        const h = hash(i * 3 + dx, j * 3 + dy, 480 + n), u = 0.5 + dx * 0.42 + (dy ? ((h % 60) - 30) / 100 : 0), w = 0.5 + dy * 0.42 + (dx ? ((h % 60) - 30) / 100 : 0);
        const x = px + 16 + Math.round((u - w) * 16), y = ty + Math.round((u + w) * 8), r = 2 + (h >> 7) % 2;
        ctx.fillStyle = '#6a6660'; ctx.fillRect(x - r, y - 1, r * 2 + 1, 3); ctx.fillStyle = '#a8a49c'; ctx.fillRect(x - r + 1, y - 2, r * 2 - 1, 2); ctx.fillStyle = '#c8c4bc'; ctx.fillRect(x - r + 1, y - 2, 2, 1);
      }
    }
    // in Japan the steam vents become hot pools ringed with stones
    if (k === VENT && culture.lang === 'ja') {
      ctx.fillStyle = '#7a7670'; ctx.beginPath(); ctx.ellipse(px + 16, ty + 8, 11, 5.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6ab8d0'; ctx.beginPath(); ctx.ellipse(px + 16, ty + 8, 8, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#a8e0f0'; ctx.fillRect(px + 12, ty + 6, 4, 1);
    }
    if (k === THICKET && culture.lang === 'ja' && hash(i, j, 660) % 4 === 0) {
      for (let n = 0; n < 3; n++) { const sx0 = px + 9 + n * 5, sy0 = ty + 5 + n * 2; ctx.fillStyle = '#8a8680'; ctx.fillRect(sx0, sy0, 5, 2); ctx.fillStyle = '#b8b4ac'; ctx.fillRect(sx0 + 1, sy0, 3, 1); }
    }
    void L;
  }
  // the drop under a rope bridge: dark depths with the far wall's edge catching a little light
  private chasm(ctx: CanvasRenderingContext2D, g: Ground, px: number, ty: number, v: number) {
    // the gorge floor three levels down, and its walls in shadow rising to the bridge's footings
    draw(ctx, tileSprite(g, 'gorge', v), px, ty + 24);
    for (let b = 0; b < 3; b++) {
      draw(ctx, spriteNamed(`cliff/${g}/gorge${(v + b) % 3}`), px, ty + 8 * b);
      ctx.fillStyle = `rgba(24,14,12,${(0.35 + b * 0.15).toFixed(2)})`;
      ctx.beginPath(); ctx.moveTo(px, ty + 8 + 8 * b); ctx.lineTo(px + 16, ty + 16 + 8 * b); ctx.lineTo(px + 32, ty + 8 + 8 * b); ctx.lineTo(px + 32, ty + 16 + 8 * b); ctx.lineTo(px + 16, ty + 24 + 8 * b); ctx.lineTo(px, ty + 16 + 8 * b); ctx.fill();
    }
  }


  // Chinese and Japanese hills are cut into rice terraces: whole fields of flat steps near the village
  private paddyAt = (i: number, j: number) => (culture.lang === 'zh' || culture.lang === 'ja') && inMap(i, j) && halfLevel(i, j) >= 2 && halfLevel(i, j) % 2 === 0 && !terrainAt(i, j) && !isRoad(i, j)
    && !inVillage(i, j) && villageDist(i, j) < 16 && !(i <= 13 && j <= 13 && halfLevel(i, j) >= 6) && hash(i >> 2, j >> 2, 33) % 3 === 0;
  // baked onto the ground: snow on the high peak, terraced paddies (Chinese and Japanese), flood water, summer mud
  private tileExtras(ctx: CanvasRenderingContext2D, s: GameState, se: number, i: number, j: number, _L: number, px: number, ty: number, v: number) {
    const k = terrainAt(i, j), road = isRoad(i, j), paddy = this.paddyAt;
    if (paddy(i, j)) {
      if ((se === 2 || se === 0) && hash(i, j, 35) % 4 === 0) this.harvest.push({ x: i, y: j });
    }
    if (!k && !road && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => terrainAt(i + dx, j + dy) === WATER)) this.islands.push({ x: i, y: j, v });
    // summer: the lakes drop and leave a fringe of drying mud along the shore
    if (se === 1 && !k && villageDef(s.village).terrain.lakes && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => terrainAt(i + dx, j + dy) === WATER))
      for (let n = 0; n < 7; n++) { const h = hash(i, j, 470 + n); ctx.fillStyle = n % 3 ? 'rgba(130,100,64,0.55)' : 'rgba(160,128,84,0.5)'; ctx.fillRect(px + 7 + (h % 18), ty + 4 + ((h >> 5) % 8), 2 + (h % 3), 1); }
  }

  // land creeps over the edges of open water so shores curve instead of stepping tile by tile
  private shore(ctx: CanvasRenderingContext2D, g: Ground, se: number, i: number, j: number, v: number, ty: number, extraWet?: (x: number, y: number) => boolean) {
    const wet = (x: number, y: number) => !inMap(x, y) || terrainAt(x, y) === WATER || terrainAt(x, y) === STREAM || (isFlooded(x, y) && !terrainAt(x, y)) || !!extraWet?.(x, y);
    const tag = (x: number, y: number) => (isBeach(x, y) ? 'sand' : inVillage(x, y) ? 'v' : 'w' + Math.max(0, zoneOf(x, y)));
    const sides: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    // frozen water is ringed with drifted snow instead of a grassy bank
    const at = (d: number, x: number, y: number) => draw(ctx, seasonal(bankSprite(g, isFrozen() && !isSea(i, j) ? 'snowbank' : tag(x, y), d, v), se, false), GX + (i - j) * 16, ty);
    sides.forEach(([dx, dy], d) => { if (!wet(i + dx, j + dy)) at(d, i + dx, j + dy); });
    corners.forEach(([dx, dy], d) => { if (!wet(i + dx, j + dy) && wet(i + dx, j) && wet(i, j + dy)) at(d + 4, i + dx, j + dy); });
  }

  // the same edging with untagged pieces (winter snow drifts over a road)
  private plainEdges(ctx: CanvasRenderingContext2D, name: string, g: Ground, i: number, j: number, v: number, ty: number, same: (x: number, y: number) => boolean) {
    const fill = (x: number, y: number) => !inMap(x, y) || same(x, y);
    const at = (d: number) => draw(ctx, spriteNamed(`${name}/${g}/${d}/${v % 2}`), GX + (i - j) * 16, ty);
    ([[-1, 0], [1, 0], [0, -1], [0, 1]] as const).forEach(([dx, dy], d) => { if (!fill(i + dx, j + dy)) at(d); });
    ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).forEach(([dx, dy], d) => { if (!fill(i + dx, j + dy) && fill(i + dx, j) && fill(i, j + dy)) at(d + 4); });
  }
  // the light village ground and the three ever-darker wild zones run into one another in soft, wandering edges
  // instead of meeting along tile lines: the lighter ground spreads over the darker beside it
  private zoneEdges(ctx: CanvasRenderingContext2D, g: Ground, se: number, i: number, j: number, v: number, ty: number, kind: string) {
    const rank = (x: number, y: number) => (!inMap(x, y) || terrainAt(x, y) || isRoad(x, y) || isBeach(x, y) || this.paddyAt(x, y) || (halfLevel(x, y) & 1) ? -1 : inVillage(x, y) ? 0 : 1 + Math.max(0, zoneOf(x, y)));
    const mine = kind === 'village' ? 0 : 1 + Number(kind.slice(4));
    const tag = (r: number) => (r === 0 ? 'v' : 'w' + (r - 1));
    const at = (d: number, r: number) => draw(ctx, seasonal(edgeSprite(g, 'zedge', tag(r), d, v), se, false), GX + (i - j) * 16, ty);
    ([[-1, 0], [1, 0], [0, -1], [0, 1]] as const).forEach(([dx, dy], d) => { const r = rank(i + dx, j + dy); if (r >= 0 && r < mine && halfLevel(i + dx, j + dy) === halfLevel(i, j)) at(d, r); });
    ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).forEach(([dx, dy], d) => { const r = rank(i + dx, j + dy); if (r >= 0 && r < mine && rank(i + dx, j) >= mine && rank(i, j + dy) >= mine && halfLevel(i + dx, j + dy) === halfLevel(i, j)) at(d + 4, r); });
  }
  // how each village gets about out in the wilds, drawn round the traveller: a camel under the rider in the desert, a
  // dog sled in the snow, a mine cart on the iron town's rails (front parts drawn after the rider)
  private mount(kind: string, px: number, py: number, f: number, time: number, behind: boolean) {
    const ctx = this.lctx, step = Math.floor(time * 6) % 2;
    if (kind === 'sun') {
      if (behind) {
        ctx.fillStyle = '#c8a060'; ctx.fillRect(px - 8, py - 9, 16, 6); ctx.fillRect(px - 4, py - 12, 7, 3);
        ctx.fillStyle = '#a8804a'; for (const lx of [-6, -3, 3, 6]) ctx.fillRect(px + lx, py - 4, 1, 4 - ((lx > 0 ? step : 1 - step))); ctx.fillStyle = '#c83a2a'; ctx.fillRect(px - 3, py - 10, 6, 2);
      } else { ctx.fillStyle = '#c8a060'; ctx.fillRect(px + f * 7, py - 14, 2, 7); ctx.fillRect(px + f * 8 - (f < 0 ? 2 : 0), py - 15, 4, 3); ctx.fillStyle = '#2a2a2a'; ctx.fillRect(px + f * 10, py - 14, 1, 1); }
    } else if (kind === 'frost') {
      if (behind) { ctx.fillStyle = '#8a5a32'; ctx.fillRect(px - 6, py - 2, 12, 2); ctx.fillStyle = '#5a3a22'; ctx.fillRect(px - 7, py, 15, 1); ctx.fillRect(px - f * 6, py - 7, 1, 6); }
      else for (let k = 0; k < 2; k++) { const dx = px + f * (10 + k * 7), dy = py - 1 + (k + step) % 2; ctx.fillStyle = k ? '#e8e4dc' : '#8a8a92'; ctx.fillRect(dx - 2, dy - 3, 5, 3); ctx.fillRect(dx + f * 2, dy - 5, 2, 2); ctx.fillStyle = '#5a5a62'; ctx.fillRect(dx - 2, dy, 1, 1); ctx.fillRect(dx + 2, dy, 1, 1); ctx.strokeStyle = 'rgba(80,60,40,0.8)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px + f * 5, py - 3); ctx.lineTo(dx, dy - 2); ctx.stroke(); }
    } else if (kind === 'iron') {
      if (behind) { ctx.fillStyle = '#4a4a52'; ctx.fillRect(px - 5, py - 6, 10, 5); ctx.fillStyle = '#6a6a72'; ctx.fillRect(px - 5, py - 6, 10, 1); }
      else { ctx.fillStyle = '#5a5a62'; ctx.fillRect(px - 5, py - 4, 10, 3); ctx.fillStyle = '#2a2a2a'; ctx.fillRect(px - 4, py - 1, 2, 2); ctx.fillRect(px + 2, py - 1, 2, 2); ctx.fillStyle = '#c8b090'; ctx.fillRect(px - 4 + step, py, 1, 1); }
    }
  }
  // the life that sets each village apart: its banners on the gates, its roads (rails, boardwalks) and ferries, its nights,
  // its disasters as they strike, and its great work rising stage by stage
  private villageLife(s: GameState, v: View) {
    const ctx = v.ctx, time = v.time, t = this.lightTod(s), night = t >= 0.72 || t < 0.05, vil = s.village, fest = festival(s);
    const off = (px: number, py: number) => px < -60 || py < -80 || px > v.lw + 60 || py > v.lh + 60;
    const tile = (x: number, y: number) => [v.sx(x + 0.5, y + 0.5), v.sy(x + 0.5, y + 0.5)] as const;
    // banners: the village's colours and emblem on a pole at every gate, swapped for festival colours on festival days
    const BAN: Record<string, [string, string, string]> = { maple: ['#c83a2a', '#f2c040', 'leaf'], iron: ['#4a4a5a', '#e8602a', 'anvil'], mist: ['#3a6a5a', '#c8e8d8', 'drop'], frost: ['#3a5ab8', '#f4f8ff', 'flake'], sun: ['#e8a030', '#c83a2a', 'sun'] };
    const [bc, ec, emb] = fest ? ['#d83a6a', '#f2e040', 'star'] : BAN[vil] ?? BAN.maple;
    for (const w of this.walls) {
      if (!w.name.startsWith('gate')) continue;
      const [px, py] = tile(w.x, w.y);
      if (off(px, py)) continue;
      v.push(w.x + w.y + 1.2, () => {
        const ox = px - 12, fl = (k: number) => Math.round(Math.sin(time * 4 - k * 0.7) * (k / 6));
        ctx.fillStyle = '#5a3a22'; ctx.fillRect(ox, py - 30, 1, 30); ctx.fillStyle = '#e8c040'; ctx.fillRect(ox, py - 31, 1, 1);
        for (let k = 0; k < 7; k++) { ctx.fillStyle = bc; ctx.fillRect(ox + 1 + k, py - 29 + fl(k), 1, 9); if (k === 6) { ctx.fillRect(ox + 7, py - 29 + fl(k), 1, 7); } }
        ctx.fillStyle = ec;
        const ex = ox + 3, ey = py - 26 + fl(3);
        if (emb === 'leaf') { ctx.fillRect(ex, ey, 3, 3); ctx.fillRect(ex + 1, ey - 1, 1, 5); }
        else if (emb === 'anvil') { ctx.fillRect(ex - 1, ey, 5, 1); ctx.fillRect(ex, ey + 1, 3, 2); }
        else if (emb === 'drop') { ctx.fillRect(ex + 1, ey - 1, 1, 1); ctx.fillRect(ex, ey, 3, 3); }
        else if (emb === 'flake') { ctx.fillRect(ex + 1, ey - 1, 1, 5); ctx.fillRect(ex - 1, ey + 1, 5, 1); }
        else { ctx.fillRect(ex, ey, 3, 3); ctx.fillRect(ex + 1, ey - 1, 1, 1); ctx.fillRect(ex + 1, ey + 3, 1, 1); ctx.fillRect(ex - 1, ey + 1, 1, 1); ctx.fillRect(ex + 3, ey + 1, 1, 1); }
      });
    }
    // the iron town's rails along its roads out, the marsh's boardwalk planks over them
    if (vil === 'iron' || vil === 'mist') for (const i of s.roads) {
      const x = i % MAP, y = (i / MAP) | 0;
      if (villageDist(x, y) === 0) continue;
      const [px, py] = tile(x, y);
      if (off(px, py)) continue;
      const alongX = isRoad(x - 1, y) || isRoad(x + 1, y), P = (u: number, w: number) => [v.sx(x + u, y + w), v.sy(x + u, y + w)] as const;
      if (vil === 'iron') {
        ctx.fillStyle = '#6a5a4a'; for (let k = 0; k < 4; k++) { const a = alongX ? P(0.12 + k * 0.25, 0.25) : P(0.25, 0.12 + k * 0.25), b = alongX ? P(0.12 + k * 0.25, 0.75) : P(0.75, 0.12 + k * 0.25); ctx.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]) + 1, Math.abs(a[1] - b[1]) + 1); }
        ctx.strokeStyle = '#9aa4b0'; ctx.lineWidth = 1;
        for (const o of [0.35, 0.65]) { const a = alongX ? P(0, o) : P(o, 0), b = alongX ? P(1, o) : P(o, 1); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      } else {
        ctx.strokeStyle = 'rgba(90,60,36,0.55)'; ctx.lineWidth = 1;
        for (let k = 1; k < 6; k++) { const a = alongX ? P(k / 6, 0.15) : P(0.15, k / 6), b = alongX ? P(k / 6, 0.85) : P(0.85, k / 6); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      }
    }
    // ferries carry the maple village's visitors along the river
    if (vil === 'maple' && this.route && !isFrozen()) for (let k = 0; k < 2; k++) {
      const p = along(this.route, time * 0.5 + k * this.route.len * 0.5), px = v.sx(p.x, p.y), py = v.sy(p.x, p.y);
      if (off(px, py)) continue;
      v.push(p.x + p.y + 0.25, () => {
        const bob = Math.round(Math.sin(time * 2 + k));
        ctx.fillStyle = '#7a4a2a'; ctx.fillRect(px - 8, py - 1 + bob, 16, 3); ctx.fillStyle = '#a8743e'; ctx.fillRect(px - 9, py - 2 + bob, 18, 1);
        ctx.fillStyle = '#e8d8b0'; ctx.fillRect(px - 5, py - 7 + bob, 10, 1); ctx.fillStyle = '#6a4a2a'; ctx.fillRect(px - 5, py - 6 + bob, 1, 5); ctx.fillRect(px + 4, py - 6 + bob, 1, 5);
        for (const [ox, c] of [[-2, '#3a6ab8'], [2, '#c8508a']] as const) { ctx.fillStyle = c; ctx.fillRect(px + ox - 1, py - 5 + bob, 3, 3); ctx.fillStyle = '#f0d2ae'; ctx.fillRect(px + ox - 1, py - 7 + bob, 3, 2); }
        ctx.fillStyle = '#5a3a22'; ctx.fillRect(px + 7, py - 8 + bob + (Math.floor(time * 3) % 2), 1, 8);
        ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(px - 12, py + 1, 2, 1);
      });
    }
    // nights: a market of lanterns and stalls in the desert streets, forges glowing all night in the iron town,
    // fireflies over the marsh on summer nights, and on clear frost nights an aurora so bright folk come out to watch
    if (night) {
      if (vil === 'sun') {
        const g0 = s.buildings.find((b) => b.type === 'guild');
        if (g0) for (const i of s.roads.filter((r) => { const x = r % MAP, y = (r / MAP) | 0; return Math.abs(x - g0.x) + Math.abs(y - g0.y) < 8 && hash(x, y, 870) % 3 === 0; }).slice(0, 8)) {
          const [px, py] = tile(i % MAP, (i / MAP) | 0);
          if (off(px, py)) continue;
          v.push((i % MAP) + ((i / MAP) | 0) + 1.3, () => {
            ctx.fillStyle = '#6a4426'; ctx.fillRect(px - 6, py - 7, 1, 7); ctx.fillRect(px + 5, py - 7, 1, 7);
            ctx.fillStyle = ['#c83a2a', '#3a6ab8', '#e8a030'][i % 3]; ctx.fillRect(px - 7, py - 9, 14, 3);
            ctx.fillStyle = '#a8743e'; ctx.fillRect(px - 6, py - 3, 12, 3);
            for (let q = 0; q < 3; q++) { ctx.fillStyle = ['#e8b830', '#c8402a', '#8a5a2a'][q]; ctx.fillRect(px - 4 + q * 3, py - 4, 2, 1); }
            const sw = Math.round(Math.sin(time * 2 + i)); ctx.fillStyle = '#ffd060'; ctx.fillRect(px - 1 + sw, py - 13, 3, 3);
            v.glowAt(px + sw, py - 12, 14);
          });
        }
      }
      if (vil === 'iron') for (const b of s.buildings) {
        if (b.type !== 'forge' && b.type !== 'steelworks' && b.type !== 'greatFurnace') continue;
        const [px, py] = tile(b.x + 1, b.y + 1);
        if (off(px, py)) continue;
        v.glowAt(px + 6, py - 8, 22 + Math.sin(time * 6 + b.id) * 3);
        for (let k = 0; k < 3; k++) { const p = (time * 1.5 + k / 3) % 1; ctx.fillStyle = p < 0.4 ? '#fff0a0' : '#ff8a3a'; ctx.fillRect(Math.round(px + 6 + Math.cos(k * 2) * p * 8), Math.round(py - 10 - p * 14), 1, 1); }
      }
      if (vil === 'mist' && season(s) === 1) for (const i of this.bogs.concat(this.waters).filter((q) => hash(q % MAP, (q / MAP) | 0, 880) % 5 === 0)) {
        const [px, py] = tile(i % MAP, (i / MAP) | 0), h = hash(i, 0, 881);
        if (off(px, py) || Math.sin(time * 2.3 + h) < 0.2) continue;
        const x = Math.round(px + Math.sin(time * 0.6 + h) * 9), y = Math.round(py - 8 + Math.cos(time * 0.5 + h) * 4);
        ctx.fillStyle = 'rgba(220,255,120,0.35)'; ctx.fillRect(x - 1, y - 1, 3, 3); ctx.fillStyle = '#efffa0'; ctx.fillRect(x, y, 1, 1);
      }
    }
    this.disasterFx(s, v);
    this.megaFx(s, v);
  }
  // a disaster as it strikes: the wildfire's flames and smoke where it caught, a sickly haze over a plague-struck marsh,
  // cracked earth through a drought; buried roads are drawn with the heaps
  private disasterFx(s: GameState, v: View) {
    const d = s.disaster;
    if (!d || d.saved || d.until <= s.time) return;
    const ctx = v.ctx, time = v.time;
    if (d.k === 'wildfire') for (let k = 0; k < 14; k++) {
      const h = hash(k, d.x, 890), x = d.x + ((h % 70) - 35) / 10, y = d.y + (((h >> 8) % 70) - 35) / 10, px = v.sx(x, y), py = v.sy(x, y);
      if (px < -20 || py < -40 || px > v.lw + 20 || py > v.lh + 20) continue;
      v.push(x + y + 0.5, () => {
        for (let q = 0; q < 4; q++) { const p = (time * 1.8 + q / 4 + k * 0.13) % 1, fx = Math.round(px - 3 + q * 2 + Math.sin(p * 9 + k) * 1.5), fy = Math.round(py - p * 12); ctx.fillStyle = p < 0.3 ? '#fff0a0' : p < 0.6 ? '#ff9a3a' : '#d8402a'; ctx.fillRect(fx, fy, 2, 2); }
        const p2 = (time * 0.4 + k * 0.07) % 1; ctx.fillStyle = `rgba(60,56,56,${(0.55 * (1 - p2)).toFixed(2)})`; ctx.fillRect(Math.round(px - 3 + p2 * 10), Math.round(py - 14 - p2 * 30), 4 + Math.floor(p2 * 4), 4);
        v.glowAt(px, py - 4, 14);
      });
    }
    if (d.k === 'plague') { ctx.fillStyle = 'rgba(150,170,90,0.08)'; ctx.fillRect(0, 0, v.lw, v.lh); }
    if (d.k === 'drought') for (const b of s.buildings) {
      if (b.type !== 'farmField' && b.type !== 'herbGarden') continue;
      for (let k = 0; k < 6; k++) { const h = hash(b.id, k, 895), x = b.x + (h % 20) / 10, y = b.y + ((h >> 6) % 20) / 10, px = v.sx(x, y), py = v.sy(x, y); ctx.strokeStyle = 'rgba(60,40,24,0.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px - 4, py); ctx.lineTo(px, py - 1); ctx.lineTo(px + 3, py + 1); ctx.lineTo(px + 5, py); ctx.stroke(); }
    }
  }
  // each village's great work, raised stage by stage: the maple stone bridge over the river, the iron tunnel through the
  // ridge, the marsh causeway across the bog, the frost baths over the hot spring, the desert aqueduct to the oasis
  private megaFx(s: GameState, v: View) {
    const k = s.mega ?? 0, ctx = v.ctx, time = v.time;
    if (!k) return;
    const done = k >= 5, frac = k / 5;
    const seg = (pts: [number, number][]) => pts.slice(0, Math.max(1, Math.ceil(pts.length * frac)));
    if (s.village === 'maple') {
      // a great stone bridge of five arches across the river north of the village, an arch added with each stage,
      // lanterns along its parapet once it is finished
      const y0 = 15, cols: number[] = [];
      for (let x = 0; x < MAP; x++) if (terrainAt(x, y0) === WATER) cols.push(x);
      if (cols.length) {
        const xa = cols[0] - 1, xb = cols[cols.length - 1] + 2, built = xa + (xb - xa) * frac;
        for (let x = xa; x < Math.min(xb, built); x++) {
          const px = v.sx(x + 0.5, y0 + 0.5), py = v.sy(x + 0.5, y0 + 0.5) + Math.round(elevation(x + 0.5, y0 + 0.5) * 8);
          v.push(x + y0 + 1.1, () => {
            const top = py - 14;
            ctx.fillStyle = '#a8a49c'; ctx.fillRect(px - 16, top, 32, 10); ctx.fillStyle = '#8a867e'; ctx.fillRect(px - 16, top + 7, 32, 3);
            ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.ellipse(px, top + 10, 11, 7, 0, Math.PI, 0); ctx.fill(); ctx.restore();
            ctx.strokeStyle = '#6a665e'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(px, top + 10, 11, 7, 0, Math.PI, 0); ctx.stroke();
            ctx.fillStyle = '#c8c4bc'; ctx.fillRect(px - 16, top - 3, 32, 3); ctx.fillStyle = '#9a968e'; for (let q = -14; q < 16; q += 6) ctx.fillRect(px + q, top - 6, 2, 3);
            ctx.fillStyle = 'rgba(80,76,70,0.4)'; for (let q = -12; q < 16; q += 8) ctx.fillRect(px + q, top + 2, 1, 4);
            if (done && x % 2 === 0) { ctx.fillStyle = '#5a3a22'; ctx.fillRect(px, top - 10, 1, 4); ctx.fillStyle = '#ffc860'; ctx.fillRect(px - 1, top - 12, 3, 3); if (this.lightTod(s) > 0.7) v.glowAt(px, top - 11, 10); }
          });
        }
      }
    }
    if (s.village === 'iron') {
      // the tunnel mouth cut into the ridge north of the village; scaffold until it is finished, lanterns and carts after
      const x = 47, y = 18, px = v.sx(x, y), py = v.sy(x, y);
      v.push(x + y + 2, () => {
        ctx.fillStyle = '#7a766e'; ctx.beginPath(); ctx.ellipse(px, py - 12, 18, 16, 0, Math.PI, 0); ctx.fill(); ctx.fillRect(px - 18, py - 12, 36, 12);
        ctx.fillStyle = '#1a1820'; ctx.beginPath(); ctx.ellipse(px, py - 4, 9 * frac + 2, 10 * frac + 2, 0, Math.PI, 0); ctx.fill();
        if (done) { ctx.fillStyle = '#a8a49c'; ctx.fillRect(px - 12, py - 16, 24, 2); ctx.fillStyle = '#ffd060'; ctx.fillRect(px - 13, py - 10, 2, 3); ctx.fillRect(px + 11, py - 10, 2, 3); v.glowAt(px - 12, py - 9, 10); v.glowAt(px + 12, py - 9, 10); const c = (time * 0.4) % 1; ctx.fillStyle = '#4a4a52'; ctx.fillRect(Math.round(px - 2 + c * 20), Math.round(py - 2 + c * 10), 6, 3); }
        else { ctx.fillStyle = '#8a5a32'; ctx.fillRect(px - 10, py - 18, 1, 18); ctx.fillRect(px + 9, py - 18, 1, 18); ctx.fillRect(px - 10, py - 18, 20, 1); }
      });
    }
    if (s.village === 'mist') {
      // a raised stone causeway across the bog and river toward the south-west
      const pts: [number, number][] = []; for (let t = 0; t <= 16; t++) pts.push([24 - t, 32 + Math.round(Math.sin(t * 0.4) * 1.2)]);
      for (const [x, y] of seg(pts)) { const px = v.sx(x + 0.5, y + 0.5), py = v.sy(x + 0.5, y + 0.5); v.push(x + y + 0.35, () => { ctx.fillStyle = '#7a766e'; ctx.fillRect(px - 10, py - 2, 20, 4); ctx.fillStyle = '#a8a49c'; ctx.fillRect(px - 10, py - 4, 20, 2); ctx.fillStyle = '#5a564e'; ctx.fillRect(px - 8, py + 2, 2, 3); ctx.fillRect(px + 6, py + 2, 2, 3); }); }
    }
    if (s.village === 'frost') {
      // a timber bath pavilion over the first hot spring, steam rising and bathers in the water once it opens
      const sp = (s.terrain?.spring ?? [])[0];
      if (sp != null) { const x = sp % MAP, y = (sp / MAP) | 0, px = v.sx(x + 1, y + 1), py = v.sy(x + 1, y + 1);
        v.push(x + y + 2.5, () => {
          const h = Math.round(22 * frac);
          ctx.fillStyle = '#6a4426'; for (const ox of [-16, 16]) ctx.fillRect(px + ox, py - h, 2, h);
          if (frac >= 0.6) { ctx.fillStyle = '#5a3a2a'; ctx.beginPath(); ctx.moveTo(px - 22, py - h); ctx.lineTo(px, py - h - 10); ctx.lineTo(px + 22, py - h); ctx.fill(); ctx.fillStyle = '#f4f8fc'; ctx.fillRect(px - 20, py - h - 1, 40, 2); }
          if (done) { for (let q = 0; q < 3; q++) { ctx.fillStyle = '#f0d2ae'; ctx.fillRect(px - 8 + q * 7, py - 3, 3, 3); ctx.fillStyle = '#2a2a2a'; ctx.fillRect(px - 8 + q * 7, py - 4, 3, 1); } ctx.fillStyle = '#c83a3a'; ctx.fillRect(px - 2, py - h - 6, 4, 4); }
        }); }
    }
    if (s.village === 'sun') {
      // one unbroken channel carried on stone piers from the map's edge to the oasis, round arches between the piers,
      // its piers running down into the gorge where it crosses; water flows along the top once it is finished
      const x0 = 62.5, x1 = 42, yA = 26.3, yB = 26.75, H = 26, built = x0 - (x0 - x1) * frac;
      for (let x = Math.floor(x0); x >= Math.ceil(built); x--) {
        const xa = Math.min(x0, x + 1), xb = Math.max(built, x);
        if (xa <= xb) continue;
        v.push(x + 26.5 + 0.95, () => {
          const flatTop = (q: number) => Math.round(v.sy(q, 26.5) + elevation(q, 26.5) * 8 - H - 16);
          const pa = v.sx(xa, yA), pb = v.sx(xb, yA), ta = flatTop(xa), tb = flatTop(xb);
          const gb = v.sy(xb, yB);
          // pier at the far end of this span, down to the ground under it (deep into the gorge)
          const pierX = v.sx(xb, yB), pierTop = tb + 8, pierBase = gb;
          ctx.fillStyle = '#b48a56'; ctx.fillRect(pierX - 3, pierTop, 6, Math.max(2, pierBase - pierTop));
          ctx.fillStyle = '#9a7246'; ctx.fillRect(pierX + 1, pierTop, 2, Math.max(2, pierBase - pierTop));
          for (let yy = pierTop + 3; yy < pierBase; yy += 4) { ctx.fillStyle = 'rgba(80,56,32,0.35)'; ctx.fillRect(pierX - 3, yy, 6, 1); }
          // the span: a solid band with a round arch cut under it
          ctx.fillStyle = '#c8a06a';
          ctx.beginPath(); ctx.moveTo(pa, ta); ctx.lineTo(pb, tb); ctx.lineTo(pb, tb + 12); ctx.lineTo(pa, ta + 12); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#a8804a'; ctx.beginPath(); ctx.moveTo(pa, ta + 8); ctx.lineTo(pb, tb + 8); ctx.lineTo(pb, tb + 12); ctx.lineTo(pa, ta + 12); ctx.closePath(); ctx.fill();
          const mx = (pa + pb) / 2, my = (ta + tb) / 2 + 12, r = Math.abs(pb - pa) / 2 - 3;
          ctx.fillStyle = '#c8a06a'; ctx.fillRect(Math.round(mx - r - 3), Math.round(my), Math.round(r * 2 + 6), 4);
          ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.ellipse(mx, my + 4, Math.max(2, r), 5, 0, Math.PI, 0); ctx.fill(); ctx.restore();
          ctx.strokeStyle = '#8a643a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(mx, my + 4, Math.max(2, r), 5, 0, Math.PI, 0); ctx.stroke();
          // block courses along the face and a coping along the top
          ctx.strokeStyle = 'rgba(110,78,44,0.45)';
          for (const o of [3, 6]) { ctx.beginPath(); ctx.moveTo(pa, ta + o); ctx.lineTo(pb, tb + o); ctx.stroke(); }
          for (let q = 0; q < 4; q++) { const fx = pa + (pb - pa) * (q + (o2(q) ? 0.5 : 0)) / 4, fy = ta + (tb - ta) * (q / 4); ctx.fillStyle = 'rgba(110,78,44,0.45)'; ctx.fillRect(Math.round(fx), Math.round(fy + (q % 2 ? 3 : 0)), 1, 3); }
          ctx.fillStyle = '#e0bc80'; ctx.beginPath(); ctx.moveTo(pa, ta - 2); ctx.lineTo(pb, tb - 2); ctx.lineTo(pb, tb); ctx.lineTo(pa, ta); ctx.closePath(); ctx.fill();
          // the water channel on top, flowing toward the village
          if (done) {
            ctx.fillStyle = '#4aa0d0'; ctx.beginPath(); ctx.moveTo(pa, ta - 1); ctx.lineTo(pb, tb - 1); ctx.lineTo(pb, tb); ctx.lineTo(pa, ta); ctx.closePath(); ctx.fill();
            for (let q = 0; q < 3; q++) { const f = ((time * 0.8 + q / 3 + x * 0.17) % 1), fx = pa + (pb - pa) * f, fy = ta + (tb - ta) * f; ctx.fillStyle = 'rgba(230,248,255,0.9)'; ctx.fillRect(Math.round(fx), Math.round(fy - 1), 2, 1); }
          } else if (xb === built) { ctx.fillStyle = '#8a5a32'; ctx.fillRect(Math.round(pb) - 1, Math.round(tb) - 10, 1, 22); ctx.fillRect(Math.round(pb) - 6, Math.round(tb) - 6, 10, 1); }
        });
      }
    }
  }
  // the wilds' own life: the tide over the mangroves, ice calving off the glacier, falls down the high cliffs (and
  // meltwater in spring), relics and will-o'-wisps on the old battlefield, the hut and the ruined tower, slab
  // bridges over the bamboo stream, and the cave the marsh river comes out of
  private wildSights(s: GameState, v: View, se: number) {
    const ctx = v.ctx, time = v.time, t = this.lightTod(s), night = t >= 0.72 || t < 0.05;
    const tide = 0.5 + 0.5 * Math.sin(tod(s) * Math.PI * 4);
    const tile = (x: number, y: number) => [v.sx(x + 0.5, y + 0.5), v.sy(x + 0.5, y + 0.5)] as const;
    const off = (px: number, py: number) => px < -40 || py < -60 || px > v.lw + 40 || py > v.lh + 40;
    const g = villageDef(s.village).ground;
    for (const c of this.crags) {
      if (c.kind !== 'mangrove') continue;
      const [px, py] = tile(c.x, c.y);
      if (off(px, py)) continue;
      // high water laps over the mud round the roots; at low water crabs scuttle across it
      if (tide > 0.55) { ctx.fillStyle = `rgba(90,150,190,${(0.5 * (tide - 0.55) / 0.45).toFixed(2)})`; ctx.beginPath(); ctx.ellipse(px, py, 15, 7, 0, 0, Math.PI * 2); ctx.fill(); }
      else if (!night) for (let k = 0; k < 2; k++) {
        const h = hash(c.x, c.y, 820 + k), a = time * 0.6 + h, cx = Math.round(px + Math.cos(a) * 9), cy = Math.round(py + 3 + Math.sin(a * 1.3) * 3), leg = Math.floor(time * 8 + k) % 2;
        ctx.fillStyle = '#c8402a'; ctx.fillRect(cx - 1, cy - 1, 3, 2); ctx.fillRect(cx - 2 - leg, cy, 1, 1); ctx.fillRect(cx + 2 + leg, cy, 1, 1);
        ctx.fillStyle = '#2a2a2a'; ctx.fillRect(cx - 1, cy - 2, 1, 1); ctx.fillRect(cx + 1, cy - 2, 1, 1);
      }
    }
    // a slab of ice breaks off the glacier's face now and then and drops with a splash of snow
    for (const f of this.iceFaces) {
      const [px, py] = tile(f.x, f.y);
      if (off(px, py)) continue;
      const cyc = Math.floor(time / 9 + hash(f.x, f.y, 830) % 9), p = (time / 9 + (hash(f.x, f.y, 830) % 9)) % 1;
      if (hash(cyc, f.x + f.y, 831) % 6 || p > 0.25) continue;
      const q = p / 0.25, y = Math.round(py - 6 + q * q * 14);
      ctx.fillStyle = '#d8eef8'; ctx.fillRect(px - 3, y, 6, 4); ctx.fillStyle = '#a8cce4'; ctx.fillRect(px - 3, y + 3, 6, 1);
      if (q > 0.8) for (let k = 0; k < 6; k++) { ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(Math.round(px - 8 + k * 3), Math.round(py + 8 - (q - 0.8) * 30 + (k % 2) * 2), 2, 2); }
    }
    // a run of thin falls side by side down one high cliff; in early spring, meltwater down several more
    const thaw = this.thawStage(s), cluster = g !== 'sand' && !villageDef(s.village).terrain.volcano;
    this.cliffFaces.forEach((f, idx) => {
      const sel = cluster && idx % 7 < 3 && hash(f.x, f.y, 840) % 2 === 0, melt = thaw > 0 && hash(f.x, f.y, 841) % 4 === 0;
      if (!sel && !melt) return;
      const [px, py] = tile(f.x, f.y);
      if (off(px, py)) return;
      const n = sel ? 3 : 1;
      for (let k = 0; k < n; k++) {
        const x = px - 6 + k * 6 + (hash(f.x, f.y, 842 + k) % 3);
        for (let y = 0; y < 8 * f.drop; y++) { const ph = (time * 2.2 + y * 0.11 + k) % 1; ctx.fillStyle = ph < 0.5 ? 'rgba(235,248,255,0.85)' : 'rgba(170,215,240,0.75)'; ctx.fillRect(x, py + 2 + y, 1, 1); }
        const p2 = (time * 0.8 + k / 3) % 1; ctx.fillStyle = `rgba(240,250,255,${(0.6 * (1 - p2)).toFixed(2)})`; ctx.fillRect(Math.round(x - 2 + p2 * 3), Math.round(py + 2 + 8 * f.drop - p2 * 5), 3, 2);
      }
    });
    // the old battlefield: swords stuck in the ground, dented shields and helmets, a torn banner in the wind;
    // at night will-o'-wisps drift among them
    for (const i of s.terrain?.battle ?? []) {
      const x = i % MAP, y = (i / MAP) | 0;
      if (terrainAt(x, y) || isRoad(x, y)) continue;
      const [px, py] = tile(x, y), h = hash(x, y, 850);
      if (off(px, py)) continue;
      if (h % 3 === 0) v.push(x + y + 0.6, () => {
        const kind = (h >> 4) % 4, ox = px - 5 + ((h >> 8) % 10), oy = py - 2 + ((h >> 12) % 5);
        if (kind === 0) { ctx.fillStyle = '#7a6a5a'; ctx.fillRect(ox, oy - 9, 1, 9); ctx.fillStyle = '#a89070'; ctx.fillRect(ox - 2, oy - 7, 5, 1); ctx.fillStyle = '#8a4a2a'; ctx.fillRect(ox, oy - 3, 1, 1); }
        else if (kind === 1) { ctx.fillStyle = '#6a5a4a'; ctx.fillRect(ox - 3, oy - 3, 6, 4); ctx.fillStyle = '#8a3a2a'; ctx.fillRect(ox - 1, oy - 2, 2, 2); ctx.fillStyle = '#9a8a6a'; ctx.fillRect(ox - 3, oy - 3, 6, 1); }
        else if (kind === 2) { ctx.fillStyle = '#8a8478'; ctx.fillRect(ox - 2, oy - 3, 5, 3); ctx.fillStyle = '#5a5650'; ctx.fillRect(ox - 1, oy - 2, 3, 1); }
        else { const fl = Math.round(Math.sin(time * 3 + h) * 1.5); ctx.fillStyle = '#5a3a22'; ctx.fillRect(ox, oy - 14, 1, 14); ctx.fillStyle = '#8a2a2a'; ctx.fillRect(ox + 1, oy - 13 + fl, 5, 3); ctx.fillRect(ox + 1, oy - 10 + fl, 3, 1); }
      });
      if (night && h % 4 === 1) {
        const wx = Math.round(px + Math.sin(time * 0.7 + h) * 8), wy = Math.round(py - 10 + Math.sin(time * 1.1 + h) * 4), on = Math.sin(time * 2 + h) > -0.3;
        if (on) { ctx.fillStyle = 'rgba(140,220,255,0.35)'; ctx.fillRect(wx - 2, wy - 2, 5, 5); ctx.fillStyle = '#c8f4ff'; ctx.fillRect(wx, wy, 1, 2); v.glowAt(wx, wy, 8); }
      }
    }
    // landmarks: the cabin's chimney smokes and its window glows at night; crows circle the ruined tower
    for (const l of landmarks) {
      const px = v.sx(l.x, l.y), py = v.sy(l.x, l.y);
      if (off(px, py)) continue;
      const spr = buildingSprite(l.kind === 'cabin' ? 'cabin' : 'ruinTower');
      v.push(l.x + l.y + 2, () => {
        draw(ctx, spr, px, py);
        if (spr.fx) for (const f of spr.fx) this.effect(f, px, py, time, false);
        if (l.kind === 'cabin' && night) v.glowAt(px + 6, py - 12, 12);
        if (l.kind === 'tower') for (let k = 0; k < 3; k++) { const a = time * 0.7 + k * 2.1, bx = Math.round(px + Math.cos(a) * 16), by = Math.round(py - 40 + Math.sin(a) * 6), fl = Math.floor(time * 6 + k) % 2; ctx.fillStyle = '#1e1e28'; ctx.fillRect(bx, by, 2, 1); ctx.fillRect(bx - 1, by - fl, 1, 1); ctx.fillRect(bx + 2, by - fl, 1, 1); }
      });
    }
    // stone slab bridges across the stream where it runs through bamboo
    for (let i = 0; i < MAP * MAP; i++) {
      if (terrainAt(i % MAP, (i / MAP) | 0) !== STREAM) continue;
      const x = i % MAP, y = (i / MAP) | 0;
      if (!N8.some(([dx, dy]) => terrainAt(x + dx, y + dy) === THICKET) || hash(x, y, 860) % 4) continue;
      const [px, py] = tile(x, y);
      if (off(px, py)) continue;
      v.push(x + y + 0.7, () => { ctx.fillStyle = '#8a867e'; ctx.fillRect(px - 8, py - 2, 16, 4); ctx.fillStyle = '#b8b4ac'; ctx.fillRect(px - 8, py - 3, 16, 1); ctx.fillStyle = '#6a665e'; ctx.fillRect(px - 6, py + 2, 2, 2); ctx.fillRect(px + 4, py + 2, 2, 2); });
    }
    // the marsh river wells out of a cave in a rocky bluff just inside the map's edge, cold mist curling from the mouth
    if (s.village === 'mist' && this.route) {
      const p0 = this.route.pts[Math.min(3, this.route.pts.length - 1)], px = v.sx(p0[0], p0[1]), py = v.sy(p0[0], p0[1]);
      if (!off(px, py)) v.push(p0[0] + p0[1] + 0.2, () => {
        // the bluff the cave opens in, its rocks lit from the left, moss on the top
        for (const [ox, oy, rx, ry, c] of [[-26, -18, 20, 22, '#5e5c56'], [24, -20, 20, 24, '#6a6862'], [0, -30, 34, 20, '#7a7872'], [-12, -36, 18, 12, '#8a8680'], [14, -38, 16, 10, '#8e8a84']] as const) {
          ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(px + ox, py + oy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = '#4a7a3a'; ctx.fillRect(px - 20, py - 50, 16, 3); ctx.fillRect(px + 6, py - 48, 14, 3); ctx.fillStyle = '#6a9a4a'; ctx.fillRect(px - 16, py - 51, 8, 1);
        ctx.fillStyle = '#1a1820'; ctx.beginPath(); ctx.ellipse(px, py - 4, 13, 12, 0, Math.PI, 0); ctx.fill(); ctx.fillRect(px - 13, py - 4, 26, 4);
        ctx.fillStyle = '#4a8ab0'; ctx.fillRect(px - 10, py - 1, 20, 3); ctx.fillStyle = 'rgba(230,245,255,0.7)'; ctx.fillRect(px - 8 + (Math.floor(time * 4) % 4), py, 4, 1);
        for (let k = 0; k < 6; k++) { const q = (time * 0.35 + k / 6) % 1; ctx.fillStyle = `rgba(230,238,244,${(0.6 * (1 - q)).toFixed(2)})`; ctx.fillRect(Math.round(px - 8 + k * 3 + q * 12), Math.round(py - 6 - q * 12), 3 + Math.floor(q * 3), 2); }
      });
    }
    void se;
  }
  // nine-patch edging with the neighbour's ground tag (land creeping onto glacier ice, mud, or the oasis grass)
  private plainTagEdges(ctx: CanvasRenderingContext2D, name: string, g: Ground, i: number, j: number, v: number, ty: number, same: (x: number, y: number) => boolean) {
    const fill = (x: number, y: number) => !inMap(x, y) || same(x, y);
    const tag = (x: number, y: number) => (inVillage(x, y) ? 'v' : 'w' + Math.max(0, zoneOf(x, y)));
    const at = (d: number, x: number, y: number) => draw(ctx, spriteNamed(`${name}/${g}/${tag(x, y)}/${d}/${v % 2}`), GX + (i - j) * 16, ty);
    ([[-1, 0], [1, 0], [0, -1], [0, 1]] as const).forEach(([dx, dy], d) => { if (!fill(i + dx, j + dy)) at(d, i + dx, j + dy); });
    ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).forEach(([dx, dy], d) => { if (!fill(i + dx, j + dy) && fill(i + dx, j) && fill(i, j + dy)) at(d + 4, i + dx, j + dy); });
  }
  // a crevasse: a deep blue split running down the glacier, joining the one in the next tile
  private crevasse(ctx: CanvasRenderingContext2D, px: number, ty: number, i: number, j: number) {
    ctx.fillStyle = '#2a4a6a'; ctx.strokeStyle = '#4a7aa4';
    const w0 = 2 + (hash(i, j, 810) % 3);
    ctx.beginPath(); ctx.moveTo(px + 16 - 8, ty + 4); ctx.lineTo(px + 16 - 8 + w0, ty + 4); ctx.lineTo(px + 16 + 8 + w0, ty + 12); ctx.lineTo(px + 16 + 8, ty + 12); ctx.fill();
    ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px + 8, ty + 4); ctx.lineTo(px + 24, ty + 12); ctx.stroke();
  }
  // the gorge floor darkens toward the foot of its walls on every side that rises out of it
  private gorgeEdges(ctx: CanvasRenderingContext2D, g: Ground, i: number, j: number, v: number, ty: number) {
    const open = (x: number, y: number) => !inMap(x, y) || terrainAt(x, y) === CANYON;
    const at = (name: string) => draw(ctx, spriteNamed(name), GX + (i - j) * 16, ty);
    ([[-1, 0], [1, 0], [0, -1], [0, 1]] as const).forEach(([dx, dy], d) => { if (!open(i + dx, j + dy)) at(`gedge/${g}/${d}/${v % 2}`); });
    ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).forEach(([dx, dy], d) => { if (!open(i + dx, j + dy) && open(i + dx, j) && open(i, j + dy)) at(`gedge/${g}/${d + 4}/${v % 2}`); });
  }
  // a crumbling bright lip along the rim where the ground breaks off into the gorge
  private rim(ctx: CanvasRenderingContext2D, g: Ground, i: number, j: number, v: number, ty: number) {
    ([[-1, 0], [1, 0], [0, -1], [0, 1]] as const).forEach(([dx, dy], d) => { if (terrainAt(i + dx, j + dy) === CANYON && !isRoad(i + dx, j + dy)) draw(ctx, spriteNamed(`lip/${g}/gorge/${d}/${v % 2}`), GX + (i - j) * 16, ty); });
  }
  // paved streets get a stone curb on every side that meets open ground
  private curbs(ctx: CanvasRenderingContext2D, g: Ground, i: number, j: number, v: number, ty: number) {
    const open = (x: number, y: number) => inMap(x, y) && !isRoad(x, y) && inVillage(x, y);
    ([[-1, 0], [1, 0], [0, -1], [0, 1]] as const).forEach(([dx, dy], d) => { if (open(i + dx, j + dy)) draw(ctx, spriteNamed(`lip/${g}/curb/${d}/${v % 2}`), GX + (i - j) * 16, ty); });
    // the curb rounds off into each corner where two streets meet
    ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).forEach(([dx, dy], d) => { if (open(i + dx, j + dy) && !open(i + dx, j) && !open(i, j + dy)) draw(ctx, spriteNamed(`lip/${g}/curb/${d + 4}/${v % 2}`), GX + (i - j) * 16, ty); });
    // a ring of lighter paving marks a junction of three or four streets
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => isRoad(i + dx, j + dy)).length >= 3) {
      const cx = GX + (i - j) * 16 + 16, cy = ty + 8;
      ctx.strokeStyle = 'rgba(240,232,214,0.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(cx, cy, 8, 4, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(120,110,96,0.35)'; ctx.fillRect(cx - 1, cy - 1, 3, 2);
    }
  }
  // the village wall stands in a strip of its own shadow with weeds at its foot; the ground at each gate is trodden bare
  private wallGround(ctx: CanvasRenderingContext2D, i: number, j: number, gate: boolean) {
    const L = Math.floor(halfLevel(i, j) / 2), px = GX + (i - j) * 16, ty = (i + j) * 8 + LIFT_PAD - L * 8;
    if (gate) {
      for (let n = 0; n < 14; n++) { const h = hash(i, j, 720 + n), u = (h % 100) / 100, w = ((h >> 7) % 100) / 100; ctx.fillStyle = n % 3 ? 'rgba(150,120,80,0.55)' : 'rgba(120,96,64,0.5)'; ctx.fillRect(px + 16 + Math.round((u - w) * 16), ty + Math.round((u + w) * 8), 2 + (h % 2), 1); }
      return;
    }
    ctx.fillStyle = 'rgba(20,24,30,0.16)'; ctx.beginPath(); ctx.moveTo(px + 16, ty + 2); ctx.lineTo(px + 30, ty + 9); ctx.lineTo(px + 16, ty + 16); ctx.lineTo(px + 2, ty + 9); ctx.fill();
    for (let n = 0; n < 5; n++) { const h = hash(i, j, 740 + n), x = px + 6 + (h % 20), y = ty + 6 + ((h >> 6) % 6); ctx.fillStyle = n % 2 ? '#4a7a34' : '#6a9a44'; ctx.fillRect(x, y - 2, 1, 2); ctx.fillRect(x + 1, y - 1, 1, 1); }
  }
  private thawStage(s: GameState) {
    const g = villageDef(s.village).ground;
    if (g === 'snow' || g === 'sand' || season(s) !== 0) return 0;
    return Math.max(0, 3 - Math.floor((s.day % 30) / 3));
  }
  // farm fields as one patchwork: furrowed soil on every tile, a raised grassy ridge round the outside of the whole
  // spread, and a trodden path where one plot meets the next
  private fieldsGround(s: GameState, sx: (x: number, y: number) => number, sy: (x: number, y: number) => number, visible: (px: number, py: number) => boolean, se: number) {
    const own = new Map<number, number>();
    for (const b of s.buildings) if (b.type === 'farmField' && finished(b) && (b.ready == null || s.time >= b.ready)) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) own.set((b.y + dy) * MAP + b.x + dx, b.id);
    if (!own.size) return;
    const ctx = this.lctx, soil = se === 3 ? '#8a7a6a' : '#6e4e30', furrow = se === 3 ? '#e8eef4' : '#553a22';
    for (const [i, id] of own) {
      const x = i % MAP, y = (i / MAP) | 0, P = (u: number, w: number): [number, number] => [sx(x + u, y + w), sy(x + u, y + w)];
      const [cx, cy] = P(0.5, 0.5);
      if (!visible(cx, cy)) continue;
      const c = [P(0, 0), P(1, 0), P(1, 1), P(0, 1)];
      ctx.fillStyle = soil; ctx.beginPath(); ctx.moveTo(c[0][0], c[0][1]); for (const q of c.slice(1)) ctx.lineTo(q[0], q[1]); ctx.fill();
      ctx.strokeStyle = furrow; ctx.lineWidth = 1;
      for (const w of [0.2, 0.45, 0.7, 0.92]) { const a = P(0.04, w), b = P(0.96, w); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      // sides: -x from (0,0) to (0,1), +x (1,0)-(1,1), -y (0,0)-(1,0), +y (0,1)-(1,1)
      for (const [dx, dy, a, b] of [[-1, 0, [0, 0], [0, 1]], [1, 0, [1, 0], [1, 1]], [0, -1, [0, 0], [1, 0]], [0, 1, [0, 1], [1, 1]]] as const) {
        const other = own.get((y + dy) * MAP + x + dx);
        if (other === id) continue;
        const A = P(a[0], a[1]), B = P(b[0], b[1]);
        if (other != null) { ctx.strokeStyle = 'rgba(200,170,120,0.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke(); continue; }
        ctx.strokeStyle = '#8a6a44'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(A[0], A[1] - 1); ctx.lineTo(B[0], B[1] - 1); ctx.stroke();
        ctx.strokeStyle = se === 3 ? '#f4f8fc' : '#5a8a3a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(A[0], A[1] - 2); ctx.lineTo(B[0], B[1] - 2); ctx.stroke();
      }
    }
  }
  // a scarecrow in its field, sleeves flapping when the wind is up
  private scarecrow(px: number, py: number, time: number, windy: boolean) {
    const ctx = this.lctx, flap = windy ? Math.round(Math.sin(time * 6)) : Math.sin(time * 1.3) > 0.8 ? 1 : 0;
    ctx.fillStyle = '#5a3a22'; ctx.fillRect(px, py - 14, 1, 14); ctx.fillRect(px - 5, py - 10, 11, 1);
    ctx.fillStyle = '#c84a3a'; ctx.fillRect(px - 2, py - 10, 5, 5); ctx.fillStyle = '#a8743e'; ctx.fillRect(px - 6, py - 10 + flap, 2, 2); ctx.fillRect(px + 5, py - 10 - flap, 2, 2);
    ctx.fillStyle = '#e8d8a0'; ctx.fillRect(px - 1, py - 13, 3, 3); ctx.fillStyle = '#e8c060'; ctx.fillRect(px - 3, py - 14, 7, 1); ctx.fillRect(px - 1, py - 16, 3, 2);
  }
  // relief on the baked ground: a grass lip and loose stones along every raised edge, scree at the foot of tall
  // cliffs, grass fringing the sides of ramps, cracks and thin ice on frozen water, dunes in the desert, and a fan of
  // silt where the river runs into the sea
  private relief(ctx: CanvasRenderingContext2D, s: GameState, g: Ground, i: number, j: number, L: number, px: number, ty: number, v: number, k: number, kind: string) {
    const hl = halfLevel(i, j), tag = inVillage(i, j) ? 'v' : 'w' + Math.max(0, zoneOf(i, j));
    const plain = kind === 'village' || kind.startsWith('wild');
    const sides = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
    if (plain && !(hl & 1)) sides.forEach(([dx, dy], d) => {
      if (!inMap(i + dx, j + dy) || Math.floor(halfLevel(i + dx, j + dy) / 2) >= L || (halfLevel(i + dx, j + dy) & 1)) return;
      draw(ctx, spriteNamed(`lip/${g}/${tag}/${d}/${v % 2}`), px, ty);
      for (let n = 0; n < 2; n++) {
        const h = hash(i * 4 + d, j, 760 + n), t = 0.15 + (h % 70) / 100, u = dx ? (dx > 0 ? 0.92 : 0.08) : t, w = dy ? (dy > 0 ? 0.92 : 0.08) : t;
        const x = px + 16 + Math.round((u - w) * 16), y = ty + Math.round((u + w) * 8);
        ctx.fillStyle = '#8a867e'; ctx.fillRect(x, y, 2, 1); ctx.fillStyle = '#b4b0a6'; ctx.fillRect(x, y - 1, 1, 1);
      }
    });
    // scree heaped at the foot of a cliff two or more levels high
    if (plain) for (const [dx, dy] of [[-1, 0], [0, -1]] as const) {
      if (!inMap(i + dx, j + dy) || Math.floor(halfLevel(i + dx, j + dy) / 2) < L + 2) continue;
      for (let n = 0; n < 7; n++) {
        const h = hash(i * 3 + dx, j * 3 + dy, 780 + n), t = (h % 90) / 100 + 0.05, depth = ((h >> 8) % 30) / 100;
        const u = dx ? depth : t, w = dy ? depth : t, x = px + 16 + Math.round((u - w) * 16), y = ty + Math.round((u + w) * 8);
        ctx.fillStyle = ['#7a766e', '#9a968e', '#6a5e52'][n % 3]; ctx.fillRect(x, y, 2 + (h % 2), 2); ctx.fillStyle = '#c0bcb2'; ctx.fillRect(x, y, 1, 1);
      }
    }
    // grass fringes the two open sides of a ramp
    if (hl & 1) {
      const d = rampAt(i, j), lateral = d < 2 ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
      for (const [dx, dy] of lateral) {
        if (inMap(i + dx, j + dy) && halfLevel(i + dx, j + dy) === hl) continue;
        for (let n = 0; n <= 8; n++) {
          const t = n / 8, u = dx ? (dx > 0 ? 0.95 : 0.05) : t, w = dy ? (dy > 0 ? 0.95 : 0.05) : t;
          const f = d === 0 ? u : d === 1 ? 1 - u : d === 2 ? w : 1 - w;
          const x = px + 16 + Math.round((u - w) * 16), y = ty + Math.round((u + w) * 8 + 8 - f * 8);
          ctx.fillStyle = n % 2 ? '#5a8a3a' : '#7aaa4a'; ctx.fillRect(x, y - 1, 1, 2);
        }
      }
    }
    if (kind === 'ice') {
      // cracks run from edge to edge, matching where they meet the neighbouring tile
      // where a crack crosses an edge is shared by the two tiles either side, so it carries on unbroken
      const along = (dx: number, dy: number) => 0.2 + (hash(Math.min(j * MAP + i, (j + dy) * MAP + i + dx), Math.max(j * MAP + i, (j + dy) * MAP + i + dx), 793) % 60) / 100;
      const mid = (dx: number, dy: number) => { const t = along(dx, dy), u = dx ? (dx > 0 ? 1 : 0) : t, w = dy ? (dy > 0 ? 1 : 0) : t; return [px + 16 + (u - w) * 16, ty + (u + w) * 8]; };
      const cut = (a: number, b: number) => hash(Math.min(a, b), Math.max(a, b), 790) % 4 === 0;
      const me = j * MAP + i, ends = sides.filter(([dx, dy]) => cut(me, (j + dy) * MAP + i + dx));
      if (ends.length === 1 && hash(i, j, 794) % 2) ends.length = 0;
      if (ends.length) {
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1; ctx.beginPath();
        const c = [px + 16 + ((hash(i, j, 791) % 9) - 4), ty + 8 + ((hash(i, j, 792) % 5) - 2)];
        for (const [dx, dy] of ends) { const [ex, ey] = mid(dx, dy); ctx.moveTo(c[0], c[1]); ctx.lineTo(Math.round((c[0] + ex) / 2) + 1, Math.round((c[1] + ey) / 2)); ctx.lineTo(ex, ey); }
        ctx.stroke();
      }
      sides.forEach(([dx, dy], d) => { const kk = terrainAt(i + dx, j + dy); if (inMap(i + dx, j + dy) && kk !== WATER && kk !== STREAM) draw(ctx, spriteNamed(`lip/${g}/thinice/${d}/${v % 2}`), px, ty); });
    }
    // desert dunes: long crests running across the land, a lit windward face and a shaded lee behind each one
    if (g === 'sand' && plain && !inVillage(i, j)) {
      for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) {
        const wx = i + a / 16, wy = j + b / 16, ph = (wx * 0.42 + wy * 0.18 + Math.sin(wy * 0.5 + wx * 0.1) * 0.8) % 1;
        if (ph > 0.12) continue;
        const x = px + 16 + Math.round((a - b) / 16 * 16), y = ty + Math.round((a + b) / 16 * 8);
        ctx.fillStyle = ph < 0.04 ? 'rgba(250,236,200,0.55)' : 'rgba(150,110,60,0.22)'; ctx.fillRect(x, y, 1, 1);
      }
    }
    // the river's silt fans out into the sea where it runs in
    if (isSea(i, j)) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const x = i + dx, y = j + dy;
      if (!inMap(x, y) || isSea(x, y) || terrainAt(x, y) !== WATER) continue;
      const d = Math.hypot(dx, dy);
      if (d > 3.2) continue;
      for (let n = 0; n < 5; n++) { const h = hash(i, j, 800 + n), u = (h % 100) / 100, w = ((h >> 7) % 100) / 100; ctx.fillStyle = `rgba(150,124,80,${(0.22 * (1 - d / 3.4)).toFixed(2)})`; ctx.fillRect(px + 16 + Math.round((u - w) * 16) - 2, ty + Math.round((u + w) * 8), 5, 2); }
      return;
    }
    void s; void k;
  }

  // nine-patch edging for a fill tile: wherever a side (or a corner, with both sides beside it the same fill) borders
  // other ground, that ground's edge piece is laid over this tile from that side
  private edges(ctx: CanvasRenderingContext2D, g: Ground, se: number, i: number, j: number, v: number, ty: number, kind: 'edge' | 'ledge' | 'sedge' | 'aedge' | 'bedge' | 'redge' | 'tedge' | 'zedge' | 'pedge' | 'hedge', same: (x: number, y: number) => boolean, openCorners = false) {
    const fill = (x: number, y: number) => !inMap(x, y) || same(x, y);
    const tag = (x: number, y: number) => (inVillage(x, y) ? 'v' : 'w' + Math.max(0, zoneOf(x, y)));
    const at = (d: number, x: number, y: number) => draw(ctx, seasonal(edgeSprite(g, kind, tag(x, y), d, v), se, false), GX + (i - j) * 16, ty);
    ([[-1, 0], [1, 0], [0, -1], [0, 1]] as const).forEach(([dx, dy], d) => { if (!fill(i + dx, j + dy)) at(d, i + dx, j + dy); });
    // where roads cross, the inner corners are left worn open instead of grassed over
    if (!openCorners) ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).forEach(([dx, dy], d) => { if (!fill(i + dx, j + dy) && fill(i + dx, j) && fill(i, j + dy)) at(d + 4, i + dx, j + dy); });
  }

  private scenery: { x: number; y: number; tx: number; ty: number; name: string }[] = [];
  private crags: { x: number; y: number; kind: 'rock' | 'thicket' | 'cave' | 'bamboo' | 'pillar' | 'mangrove' | 'palm'; v: number }[] = [];
  private islands: { x: number; y: number; v: number }[] = [];
  private harvest: { x: number; y: number }[] = [];
  private falls: { x: number; y: number; drop: number }[] = [];
  private lavaFalls: { x: number; y: number; drop: number }[] = [];
  private iceFaces: { x: number; y: number }[] = [];
  private cliffFaces: { x: number; y: number; drop: number }[] = [];
  private vents: number[] = [];
  private flutter: number[] = [];

  // falling streaks and spray at waterfalls, steam from vents, butterflies over flower meadows
  private landLife(sx: (x: number, y: number) => number, sy: (x: number, y: number) => number, lw: number, lh: number, time: number) {
    const ctx = this.lctx, off = (px: number, py: number) => px < -30 || py < -40 || px > lw + 30 || py > lh + 40;
    for (const f of this.falls) {
      const px = sx(f.x + 0.5, f.y + 0.5), py = sy(f.x + 0.5, f.y + 0.5);
      if (off(px, py)) continue;
      for (let k = 0; k < 6; k++) {
        const p = (time * 1.6 + k / 6) % 1, x = px - 12 + k * 5, y = py + 4 + Math.round(p * 8 * f.drop) - Math.abs(k * 5 - 12) / 2;
        ctx.fillStyle = 'rgba(240,250,255,0.85)'; ctx.fillRect(x, y, 1, 2);
      }
      for (let k = 0; k < 4; k++) {
        const p = (time * 0.9 + k / 4) % 1;
        ctx.fillStyle = `rgba(235,245,255,${(0.6 * (1 - p)).toFixed(2)})`;
        ctx.fillRect(Math.round(px - 8 + k * 5 + p * 3), Math.round(py + 10 + 8 * f.drop - p * 6), 2, 2);
      }
    }
    // molten drips running down each lava fall, sparks and a little smoke where it lands, a glow after dark
    for (const f of this.lavaFalls) {
      const px = sx(f.x + 0.5, f.y + 0.5), py = sy(f.x + 0.5, f.y + 0.5);
      if (off(px, py)) continue;
      for (let k = 0; k < 6; k++) {
        const p = (time * 0.9 + k / 6) % 1, x = px - 12 + k * 5, y = py + 4 + Math.round(p * 8 * f.drop) - Math.abs(k * 5 - 12) / 2;
        ctx.fillStyle = p < 0.5 ? '#fff0a0' : '#ffb040'; ctx.fillRect(x, y, 1, 2);
      }
      for (let k = 0; k < 3; k++) {
        const p = (time * 0.6 + k / 3) % 1;
        ctx.fillStyle = `rgba(80,70,70,${(0.5 * (1 - p)).toFixed(2)})`; ctx.fillRect(Math.round(px - 6 + k * 6 + p * 3), Math.round(py + 8 * f.drop - p * 12), 3, 3);
        if (p < 0.3) { ctx.fillStyle = '#ffd060'; ctx.fillRect(Math.round(px - 4 + k * 5 + p * 10), Math.round(py + 6 + 8 * f.drop - p * 14), 1, 1); }
      }
      this.glowAt(px, py + 4 * f.drop, 16 + 4 * f.drop);
    }
    for (const i of this.vents) {
      const x = i % MAP, y = (i / MAP) | 0, px = sx(x + 0.5, y + 0.5), py = sy(x + 0.5, y + 0.5);
      if (off(px, py)) continue;
      for (let k = 0; k < 4; k++) {
        const p = (time * 0.4 + k / 4 + hash(x, y, 2) % 7 / 7) % 1, rr = 1 + Math.floor(p * 3);
        ctx.fillStyle = `rgba(245,245,245,${(0.55 * (1 - p)).toFixed(2)})`;
        ctx.fillRect(Math.round(px - 2 + Math.sin(p * 6 + k) * 3), Math.round(py - 2 - p * 22), rr, rr);
      }
    }
    for (const i of this.flutter) {
      const x = i % MAP, y = (i / MAP) | 0, hh = hash(x, y, 9), px = sx(x + 0.5, y + 0.5), py = sy(x + 0.5, y + 0.5);
      if (off(px, py)) continue;
      const bx = Math.round(px + Math.sin(time * 0.8 + hh) * 10), by = Math.round(py - 8 + Math.sin(time * 1.7 + hh) * 4), wing = Math.floor(time * 10 + hh) % 2;
      ctx.fillStyle = ['#f4f0e0', '#f2c830', '#c8a0e8'][hh % 3];
      ctx.fillRect(bx - 1, by - wing, 1, 1); ctx.fillRect(bx + 1, by - wing, 1, 1); ctx.fillStyle = '#3a2a2a'; ctx.fillRect(bx, by, 1, 1);
    }
  }
  private walls: { x: number; y: number; name: string }[] = [];
  private waters: number[] = [];
  private bogs: number[] = [];

  // spring sprouts and autumn leaf drifts on the grass; rain rings on the water; warm light on the water at dawn and dusk
  private seasonGround(s: GameState, sx: (x: number, y: number) => number, sy: (x: number, y: number) => number, lw: number, lh: number, time: number) {
    const ctx = this.lctx, se = landSeason(s), tt = this.lightTod(s);
    const step = 3;
    if (se === 0 || se === 2) for (let y = 0; y < MAP; y += 1) for (let x = (y % step); x < MAP; x += step) {
      if (terrainAt(x, y) || isRoad(x, y) || hash(x, y, 81) % 4) continue;
      const px = sx(x + 0.5, y + 0.5), py = sy(x + 0.5, y + 0.5);
      if (px < -10 || py < -10 || px > lw + 10 || py > lh + 10) continue;
      const hh = hash(x, y, 83), ox = (hh % 13) - 6, oy = ((hh >> 4) % 7) - 3;
      if (se === 0) { const grow = Math.sin(time * 0.3 + hh) > 0 ? 1 : 0; ctx.fillStyle = '#8ad84a'; ctx.fillRect(px + ox, py + oy - grow, 1, 1 + grow); ctx.fillRect(px + ox + 1, py + oy - 1 - grow, 1, 1); }
      else { ctx.fillStyle = ['#e8902a', '#c8602a', '#e8c040'][hh % 3]; ctx.fillRect(px + ox, py + oy, 2, 1); ctx.fillRect(px + ox + 2, py + oy + 1, 2, 1); ctx.fillRect(px + ox - 1, py + oy + 1, 1, 1); }
    }
    const wet = s.weather === 'rain' || s.weather === 'storm';
    const warm = (tt > 0.04 && tt < 0.12) || (tt > 0.64 && tt < 0.75);
    if ((wet || warm) && !isFrozen()) for (const i of this.waters) {
      const x = i % MAP, y = (i / MAP) | 0, px = sx(x + 0.5, y + 0.5), py = sy(x + 0.5, y + 0.5);
      if (px < -20 || py < -20 || px > lw + 20 || py > lh + 20) continue;
      if (warm) { ctx.fillStyle = 'rgba(255,170,90,0.18)'; ctx.fillRect(px - 8, py - 2, 16, 4); }
      if (wet) { const hh = hash(x, y, 91), p = (time * 1.4 + (hh % 10) / 10) % 1, rr = Math.round(p * 4); ctx.fillStyle = `rgba(230,245,255,${(0.7 * (1 - p)).toFixed(2)})`; ctx.fillRect(px + (hh % 9) - 4 - rr, py + ((hh >> 4) % 5) - 2, rr * 2 + 1, 1); }
    }
  }

  // puddles ripple on the streets in the rain; fish leap from open water now and then; foam laps the shore
  private weatherGround(s: GameState, sx: (x: number, y: number) => number, sy: (x: number, y: number) => number, lw: number, lh: number, time: number) {
    const ctx = this.lctx, wet = s.weather === 'rain' || s.weather === 'storm';
    if (wet) for (const i of s.roads) {
      const x = i % MAP, y = (i / MAP) | 0, hh = hash(x, y, 21);
      if (hh % 3) continue;
      const px = sx(x + 0.5, y + 0.5) + ((hh >> 4) % 9) - 4, py = sy(x + 0.5, y + 0.5) + ((hh >> 8) % 5) - 2;
      if (px < -10 || py < -10 || px > lw + 10 || py > lh + 10) continue;
      // a rounded puddle with a darker rim and a pale highlight, flattened to the ground's angle
      const rw = 4 + (hh >> 12) % 4, rh = Math.max(1.5, rw * 0.45);
      ctx.fillStyle = 'rgba(50,70,100,0.35)'; ctx.beginPath(); ctx.ellipse(px + 0.5, py + 1, rw + 1, rh + 0.8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(90,125,170,0.55)'; ctx.beginPath(); ctx.ellipse(px + 0.5, py + 1, rw, rh, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(200,225,250,0.45)'; ctx.fillRect(px - Math.round(rw / 2), py, Math.round(rw * 0.6), 1);
      const p = (time * 1.2 + (hh % 10) / 10) % 1, rr = Math.round(p * 4);
      ctx.fillStyle = `rgba(210,230,255,${(0.7 * (1 - p)).toFixed(2)})`; ctx.fillRect(px - rr, py, rr * 2 + 1, 1);
    }
    for (const i of isFrozen() ? [] : this.waters) {
      const x = i % MAP, y = (i / MAP) | 0;
      const shore = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inMap(x + dx, y + dy) && terrainAt(x + dx, y + dy) !== WATER);
      if (!shore) continue;
      const px = sx(x + 0.5, y + 0.5), py = sy(x + 0.5, y + 0.5);
      if (px < -20 || py < -20 || px > lw + 20 || py > lh + 20) continue;
      const hh = hash(x, y, 31);
      if (Math.sin(time * 2 + hh) > 0.3) { ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(px + ((hh >> 3) % 15) - 7, py + ((hh >> 7) % 7) - 3, 2, 1); }
    }
    // one fish at a time, chosen by the clock so it needs no state
    if (this.waters.length && !isFrozen()) {
      const cyc = Math.floor(time / 2.6), p = (time / 2.6) % 1;
      const i = this.waters[hash(cyc, 7, 5) % this.waters.length];
      if (p < 0.35) {
        const x = i % MAP, y = (i / MAP) | 0, px = sx(x + 0.5, y + 0.5), py = sy(x + 0.5, y + 0.5), f = p / 0.35;
        const fx = Math.round(px - 4 + f * 8), fy = Math.round(py - Math.sin(f * Math.PI) * 7);
        ctx.fillStyle = '#c8d8e8'; ctx.fillRect(fx, fy, 2, 1); ctx.fillStyle = '#8aa0b8'; ctx.fillRect(fx + (f < 0.5 ? -1 : 2), fy + (f < 0.5 ? 1 : -1), 1, 1);
        if (f > 0.85 || f < 0.12) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(fx - 1, py, 4, 1); }
      }
    }
  }

  // the river boat drifting through the maple village, ice fishers on frozen water, sand heaped on buried streets
  private villageSights(s: GameState, list: Drawable[], sx: (x: number, y: number) => number, sy: (x: number, y: number) => number, visible: (px: number, py: number) => boolean, time: number) {
    const ctx = this.lctx;
    const route = this.route;
    if (s.boatUntil && s.boatUntil > s.time && route) {
      const f = 1 - (s.boatUntil - s.time) / DAY, p = along(route, f * route.len), x = p.x, y = p.y, px = sx(x, y), py = sy(x, y);
      if (visible(px, py)) list.push({ depth: x + y + 0.2, draw: () => {
        ctx.fillStyle = '#6a4426'; ctx.fillRect(px - 9, py - 1, 18, 3); ctx.fillStyle = '#8a5a32'; ctx.fillRect(px - 10, py - 2, 20, 1);
        ctx.fillStyle = '#a8743e'; ctx.fillRect(px - 5, py - 5, 4, 3); ctx.fillRect(px + 1, py - 4, 3, 2);
        ctx.fillStyle = '#5a3a22'; ctx.fillRect(px + 6, py - 14, 1, 13);
        ctx.fillStyle = '#f4ecd8'; ctx.fillRect(px + 1, py - 13, 5, 7); ctx.fillRect(px + 2, py - 6, 4, 1);
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(px - 12 - (Math.floor(time * 4) % 3), py + 1, 2, 1);
      } });
    }
    // ducks paddle slowly along open water
    if (!isFrozen() && route) for (let k = 0; k < 3; k++) {
      const p = along(route, time * 0.18 + (k * route.len) / 3), x = p.x + (k - 1) * 0.15, y = p.y, px = sx(x, y), py = sy(x, y);
      if (!visible(px, py)) continue;
      list.push({ depth: x + y + 0.1, draw: () => {
        const bob = Math.sin(time * 3 + k) > 0 ? 1 : 0;
        ctx.fillStyle = '#f4f0e8'; ctx.fillRect(px - 2, py - 2 + bob, 4, 2); ctx.fillStyle = k ? '#3a7a3a' : '#f4f0e8'; ctx.fillRect(px + 1, py - 4 + bob, 2, 2);
        ctx.fillStyle = '#e8a030'; ctx.fillRect(px + 3, py - 3 + bob, 1, 1); ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(px - 4, py + bob, 2, 1);
      } });
    }
    if (isFrozen()) {
      const spots = this.waters.filter((i) => hash(i % MAP, (i / MAP) | 0, 61) % 23 === 0).slice(0, 5);
      for (const i of spots) {
        const x = i % MAP + 0.5, y = ((i / MAP) | 0) + 0.5, px = sx(x, y), py = sy(x, y);
        if (!visible(px, py)) continue;
        list.push({ depth: x + y, draw: () => {
          ctx.fillStyle = '#2a4a6a'; ctx.fillRect(px + 3, py, 3, 1);
          ctx.fillStyle = '#8a3a2a'; ctx.fillRect(px - 2, py - 6, 4, 5); ctx.fillStyle = '#f2d2ae'; ctx.fillRect(px - 1, py - 8, 3, 2);
          ctx.fillStyle = '#3a3a5a'; ctx.fillRect(px - 2, py - 9, 4, 1);
          ctx.fillStyle = '#5a3a22'; for (let k = 0; k < 5; k++) ctx.fillRect(px + 2 + k, py - 6 + Math.round(k * 0.6), 1, 1);
          ctx.fillStyle = '#e8e0d0'; ctx.fillRect(px + 6, py - 2 + (Math.sin(time * 2 + i) > 0.8 ? 1 : 0), 1, 3);
        } });
      }
    }
    for (const b of s.buried ?? []) {
      const x = b.i % MAP + 0.5, y = ((b.i / MAP) | 0) + 0.5, px = sx(x, y), py = sy(x, y);
      if (!visible(px, py)) continue;
      // sand drifts in the desert, fallen boulders after a rockslide, heaped snow after an avalanche
      const heap = s.village === 'iron' ? ['#8a8478', '#a8a296', '#6a665e'] : s.village === 'frost' ? ['#eef3f8', '#ffffff', '#c8d4e2'] : ['#d8b878', '#e8cc90', '#b8945a'];
      list.push({ depth: x + y - 0.4, draw: () => {
        if (s.village === 'iron') { for (const [ox, oy, r] of [[-6, 0, 4], [3, -1, 5], [8, 2, 3], [-1, 3, 3]]) { ctx.fillStyle = heap[2]; ctx.fillRect(px + ox - r, py + oy - r + 1, r * 2, r); ctx.fillStyle = heap[0]; ctx.fillRect(px + ox - r + 1, py + oy - r, r * 2 - 2, r); ctx.fillStyle = heap[1]; ctx.fillRect(px + ox - r + 1, py + oy - r, r - 1, 1); } return; }
        ctx.fillStyle = heap[0]; ctx.fillRect(px - 10, py - 1, 20, 3); ctx.fillRect(px - 7, py - 3, 14, 2); ctx.fillRect(px - 3, py - 4, 7, 1);
        ctx.fillStyle = heap[1]; ctx.fillRect(px - 6, py - 3, 6, 1); ctx.fillStyle = heap[2]; ctx.fillRect(px - 9, py + 1, 18, 1);
      } });
    }
  }

  // smaller regional scenes: temple fair and lion dance, storyteller, dolls, carp streamers, river lanterns,
  // the oni chased off at Setsubun, teru teru bozu in the rain and snowmen in winter
  private localSights(s: GameState, list: Drawable[], sx: (x: number, y: number) => number, sy: (x: number, y: number) => number, visible: (px: number, py: number) => boolean, time: number) {
    const ctx = this.lctx, lang = culture.lang, fest = festival(s), obs = observance(s), term = solarTerm(s);
    const at = (x: number, y: number, depth: number, fn: (px: number, py: number) => void) => { const px = sx(x, y), py = sy(x, y); if (visible(px, py)) list.push({ depth, draw: () => fn(px, py) }); };
    const doorPt = (b: { id: number; rot: number } & Parameters<typeof doorOf>[0]) => { const d = doorOf(b); return b.rot ? { x: d.x + 0.5, y: d.y } : { x: d.x, y: d.y + 0.5 }; };
    const plazaB = s.buildings.find((b) => b.type === 'guild');
    if (lang === 'zh' && fest === 'lantern' && plazaB) {
      // a lion dance troupe parading along the streets
      const streets = s.roads.filter((i) => inVillage(i % MAP, (i / MAP) | 0));
      if (streets.length > 4) {
        const pos = (time * 1.5) % streets.length, a = streets[Math.floor(pos)], x = a % MAP + 0.5, y = ((a / MAP) | 0) + 0.5;
        at(x, y, x + y + 0.3, (px, py) => {
          const b = Math.floor(time * 6) % 2;
          ctx.fillStyle = '#d83a2a'; ctx.fillRect(px - 7, py - 7 - b, 12, 5); ctx.fillStyle = '#f2c84a'; ctx.fillRect(px - 7, py - 8 - b, 12, 1); ctx.fillRect(px + 3, py - 10 - b, 5, 5);
          ctx.fillStyle = '#ffffff'; ctx.fillRect(px + 5, py - 9 - b, 1, 1); ctx.fillStyle = '#d83a2a'; ctx.fillRect(px + 4, py - 7 - b, 3, 1);
          ctx.fillStyle = '#2a2a3a'; for (const lx of [-6, -3, 1, 4]) ctx.fillRect(px + lx, py - 2 + ((lx + b) % 2), 1, 2);
        });
      }
      // temple fair stalls around the guild square
      const g = plazaB, spots = [[g.x - 1.5, g.y + 0.5], [g.x + 0.5, g.y - 1.5], [g.x + 3.5, g.y + 1], [g.x + 1, g.y + 3.5]];
      spots.forEach(([x, y], k) => at(x, y, x + y, (px, py) => {
        ctx.fillStyle = '#6a4426'; ctx.fillRect(px - 5, py - 6, 1, 6); ctx.fillRect(px + 4, py - 6, 1, 6);
        ctx.fillStyle = '#a8743e'; ctx.fillRect(px - 5, py - 3, 10, 3);
        ctx.fillStyle = '#d83a2a'; ctx.fillRect(px - 6, py - 9, 12, 3); ctx.fillStyle = '#f2c84a'; ctx.fillRect(px - 6, py - 9, 12, 1);
        const goods = ['#e83a3a', '#f2c84a', '#8ad0f0', '#e8a0c0'][k];
        for (let i = 0; i < 3; i++) { ctx.fillStyle = goods; ctx.fillRect(px - 3 + i * 3, py - 5 - (i % 2), 2, 2); }
      }));
    }
    if (lang === 'zh') for (const b of s.buildings) {
      if (b.type !== 'teahouse' && b.type !== 'teaRoom') continue;
      const d = doorPt(b);
      at(d.x + 0.4, d.y + 0.4, d.x + d.y + 0.8, (px, py) => {
        ctx.fillStyle = '#5a4a8a'; ctx.fillRect(px - 2, py - 7, 4, 6); ctx.fillStyle = '#f0d8c0'; ctx.fillRect(px - 1, py - 10, 3, 3); ctx.fillStyle = '#2a2a2a'; ctx.fillRect(px - 1, py - 11, 3, 1);
        if (Math.sin(time * 4) > 0.6) { ctx.fillStyle = '#8a5a32'; ctx.fillRect(px + 2, py - 5, 2, 1); }
        if (Math.floor(time) % 4 === 0) drawEmote(ctx, 'win', px + 6, py - 6);
      });
    }
    if (lang === 'ja' && obs === 'setsubun' && plazaB) {
      const a = time * 1.2, x = plazaB.x + 1 + Math.cos(a) * 3, y = plazaB.y + 1 + Math.sin(a) * 3;
      at(x, y, x + y, (px, py) => {
        ctx.fillStyle = '#d83a2a'; ctx.fillRect(px - 2, py - 8, 5, 7); ctx.fillStyle = '#f4ecd8'; ctx.fillRect(px - 2, py - 10, 1, 2); ctx.fillRect(px + 2, py - 10, 1, 2);
        ctx.fillStyle = '#f2c84a'; ctx.fillRect(px - 2, py - 3, 5, 1);
        for (let i = 0; i < 4; i++) { const p = (time * 2 + i / 4) % 1; ctx.fillStyle = '#e8d8a0'; ctx.fillRect(Math.round(px - 10 + p * 9), Math.round(py - 6 - Math.sin(p * Math.PI) * 5), 1, 1); }
      });
    }
    for (const b of s.buildings) {
      const kind = BUILDINGS[b.type].kind, d = doorPt(b);
      if (lang === 'ja' && obs === 'hina' && (kind === 'shop' || kind === 'souvenir' || kind === 'food')) at(d.x + 0.5, d.y - 0.3, d.x + d.y + 0.5, (px, py) => {
        ctx.fillStyle = '#c83a3a'; ctx.fillRect(px - 4, py - 3, 8, 1); ctx.fillRect(px - 3, py - 5, 6, 1); ctx.fillRect(px - 2, py - 7, 4, 1);
        for (const [x, y, c] of [[-3, -4, '#2a3a8a'], [-1, -6, '#c83a5a'], [1, -6, '#2a2a3a'], [1, -4, '#e8b830'], [-1, -2, '#f4e8d8']] as const) { ctx.fillStyle = c; ctx.fillRect(px + x, py + y, 1, 1); }
      });
      if (lang === 'ja' && obs === 'koinobori' && kind === 'house') at(b.x + 0.2, b.y + 0.2, b.x + b.y + 1.1, (px, py) => {
        ctx.fillStyle = '#6a4426'; ctx.fillRect(px, py - 26, 1, 26);
        ['#2a3a8a', '#c83a3a', '#e88a3a'].forEach((c, k) => { for (let i = 0; i < 6; i++) { ctx.fillStyle = c; ctx.fillRect(px + 1 + i, py - 24 + k * 4 + Math.round(Math.sin(time * 4 - i * 0.8 + k) * (i / 6)), 1, 3); } ctx.fillStyle = '#ffffff'; ctx.fillRect(px + 2, py - 23 + k * 4, 1, 1); });
      });
      if (lang === 'ja' && kind === 'house' && (s.weather === 'rain' || tsuyu(s)) && b.id % 2 === 0) at(d.x, d.y, d.x + d.y + 0.6, (px, py) => {
        const swing = Math.round(Math.sin(time * 2 + b.id));
        ctx.fillStyle = '#e8e8e8'; ctx.fillRect(px - 1 + swing, py - 14, 1, 2); ctx.fillStyle = '#ffffff'; ctx.fillRect(px - 2 + swing, py - 12, 3, 3); ctx.fillRect(px - 2 + swing, py - 9, 3, 2);
        ctx.fillStyle = '#2a2a2a'; ctx.fillRect(px - 1 + swing, py - 11, 1, 1); ctx.fillRect(px + swing, py - 11, 1, 1);
      });
      if ((season(s) === 3 || villageDef(s.village).ground === 'snow') && kind === 'house' && b.id % 3 === 0) at(d.x + (b.rot ? 0.6 : 0.4), d.y + (b.rot ? 0.4 : 0.6), d.x + d.y + 1, (px, py) => {
        ctx.fillStyle = '#f4f8fc'; ctx.fillRect(px - 2, py - 4, 5, 4); ctx.fillRect(px - 1, py - 7, 3, 3);
        ctx.fillStyle = '#2a2a2a'; ctx.fillRect(px - 1, py - 6, 1, 1); ctx.fillRect(px + 1, py - 6, 1, 1); ctx.fillStyle = '#e8803a'; ctx.fillRect(px, py - 5, 1, 1);
        ctx.fillStyle = '#c83a3a'; ctx.fillRect(px - 1, py - 4, 3, 1);
      });
      if (term === 21 && kind === 'house') this.smoke(sx(b.x + 0.5, b.y + 0.5), sy(b.x + 0.5, b.y + 0.5) - 20, time + b.id);
    }
    // village festivals: lanterns on the river, a forging contest, ice sculptures, a camel bazaar
    const vf = villageFest(s);
    if (vf === 'forging') for (const b of s.buildings.filter((o) => o.type === 'forge')) { const d = doorPt(b); at(d.x, d.y, d.x + d.y + 0.5, (px, py) => { for (let i = 0; i < 10; i++) { const p = (time * 2 + i / 10) % 1; ctx.fillStyle = p < 0.3 ? '#fff4a0' : '#ff8a3a'; ctx.fillRect(Math.round(px + Math.cos(i * 2.1) * p * 14), Math.round(py - 6 - Math.sin(1 + i) * p * 12 + p * p * 16), 1, 1); } }); }
    if (vf === 'iceSculpture' && plazaB) [[plazaB.x - 1.5, plazaB.y + 1], [plazaB.x + 1, plazaB.y - 1.5], [plazaB.x + 3.5, plazaB.y + 1.5]].forEach(([x, y], k) => at(x, y, x + y, (px, py) => {
      ctx.fillStyle = 'rgba(200,230,250,0.9)'; ctx.fillRect(px - 3, py - 3, 7, 3);
      if (k === 0) { ctx.fillRect(px - 2, py - 10, 5, 7); ctx.fillRect(px - 1, py - 13, 3, 3); }
      else if (k === 1) { ctx.fillRect(px - 4, py - 8, 9, 5); ctx.fillRect(px + 3, py - 12, 2, 4); }
      else { for (let i = 0; i < 4; i++) ctx.fillRect(px - 1 + (i % 2), py - 6 - i * 3, 3, 3); }
      ctx.fillStyle = '#ffffff'; ctx.fillRect(px - 1, py - 9 + (Math.floor(time * 2 + k) % 3), 1, 1);
    }));
    if (vf === 'bazaar' && plazaB) [[plazaB.x - 2, plazaB.y + 1], [plazaB.x + 1, plazaB.y + 3.5]].forEach(([x, y], k) => at(x, y, x + y, (px, py) => {
      const b = Math.floor(time * 2 + k) % 2;
      ctx.fillStyle = '#c8a060'; ctx.fillRect(px - 6, py - 8 - b, 10, 4); ctx.fillRect(px - 4, py - 11 - b, 4, 3); ctx.fillRect(px + 3, py - 12 - b, 2, 6); ctx.fillRect(px + 4, py - 13 - b, 3, 2);
      ctx.fillStyle = '#a8804a'; for (const lx of [-5, -3, 1, 3]) ctx.fillRect(px + lx, py - 4, 1, 4);
      ctx.fillStyle = '#c83a2a'; ctx.fillRect(px - 5, py - 9 - b, 6, 1);
    }));
    const route = this.route;
    if (vf === 'riverLanterns' && route && (this.lightTod(s) > 0.7 || this.lightTod(s) < 0.05)) for (let k = 0; k < 8; k++) {
      const p = along(route, time * 0.35 + (k * route.len) / 8, 'wrap'), x = p.x, y = p.y;
      if (p.edge < 0.3) continue;
      at(x, y, x + y + 0.1, (px, py) => { ctx.fillStyle = 'rgba(255,190,90,0.4)'; ctx.fillRect(px - 2, py - 3, 5, 5); ctx.fillStyle = '#ffd88a'; ctx.fillRect(px - 1, py - 2, 3, 2); });
    }
    // Obon: little lanterns drift along open water after dark
    if (lang === 'ja' && obs === 'obon' && route && (this.lightTod(s) > 0.7 || this.lightTod(s) < 0.05)) for (let k = 0; k < 6; k++) {
      const p = along(route, time * 0.4 + (k * route.len) / 6, 'wrap'), x = p.x, y = p.y;
      if (p.edge < 0.3) continue;
      at(x, y, x + y + 0.1, (px, py) => { ctx.fillStyle = 'rgba(255,190,90,0.4)'; ctx.fillRect(px - 2, py - 3, 5, 5); ctx.fillStyle = '#ffd88a'; ctx.fillRect(px - 1, py - 2, 3, 2); ctx.fillStyle = '#c8a060'; ctx.fillRect(px - 1, py, 3, 1); });
    }
  }

  // regional festival trimmings in the world: dragon boats, firecrackers and couplets, picnic mats, food stalls, kadomatsu
  private festivalDecor(s: GameState, fest: string | null, list: Drawable[], sx: (x: number, y: number) => number, sy: (x: number, y: number) => number, visible: (px: number, py: number) => boolean, time: number) {
    if (!fest) return;
    const lang = culture.lang, ctx = this.lctx;
    // dragon boats race the length of the river and turn at its ends, side by side in two lanes
    const route = this.route;
    if (lang === 'zh' && fest === 'fireworks' && route) {
      for (let k = 0; k < 2; k++) {
        const p = along(route, time * 1.4 + k * 1.2), x = p.x + (k ? 0.3 : -0.3) * (Math.abs(p.dy) > Math.abs(p.dx) ? 1 : 0), y = p.y + (k ? 0.3 : -0.3) * (Math.abs(p.dx) >= Math.abs(p.dy) ? 1 : 0);
        const px = sx(x, y), py = sy(x, y), f = p.dx - p.dy >= 0 ? 1 : -1;
        if (!visible(px, py)) continue;
        list.push({ depth: x + y + 0.2, draw: () => {
          ctx.fillStyle = '#b8302a'; ctx.fillRect(px - 8, py - 1, 16, 2); ctx.fillRect(px - 7, py + 1, 14, 1);
          ctx.fillStyle = '#e8b830'; ctx.fillRect(px - 8, py - 1, 16, 1); ctx.fillRect(px + f * 8 - (f < 0 ? 1 : 0), py - 4, 2, 3); ctx.fillRect(px - f * 9 - 1, py - 2, 2, 2);
          for (let r = 0; r < 4; r++) { ctx.fillStyle = r % 2 ? '#2a3a6a' : '#c83a2a'; ctx.fillRect(px - 6 + r * 4, py - 4 + (Math.floor(time * 6 + r) % 2), 2, 3); }
          ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(px - f * (9 + (Math.floor(time * 4) % 3)), py + 1, 2, 1);
        } });
      }
    }
    const doors = (every: number) => s.buildings.filter((b) => b.id % every === 0 && BUILDINGS[b.type].kind !== 'decor').map((b) => {
      const d = doorOf(b), rot = b.rot ?? 0;
      return { b, x: rot ? d.x + 0.5 : d.x, y: rot ? d.y : d.y + 0.5 };
    });
    if (lang === 'zh' && fest === 'lantern') {
      for (const { b, x, y } of doors(1)) {
        const px = sx(x, y), py = sy(x, y);
        if (!visible(px, py)) continue;
        list.push({ depth: x + y + 0.1, draw: () => {
          ctx.fillStyle = '#d0302a'; ctx.fillRect(px - 5, py - 11, 2, 7); ctx.fillRect(px + 4, py - 11, 2, 7);
          ctx.fillStyle = '#f2c84a'; ctx.fillRect(px - 5, py - 9, 1, 1); ctx.fillRect(px + 4, py - 8, 1, 1);
          // firecrackers pop by day at a few doors
          const p = (time * 0.8 + b.id * 0.31) % 1;
          if (b.id % 3 === 0 && p < 0.25 && tod(s) < 0.7) for (let i = 0; i < 6; i++) {
            const a = i + b.id, rr = p * 30;
            ctx.fillStyle = i % 2 ? '#ff5a3a' : '#ffd34a'; ctx.fillRect(Math.round(px + 8 + Math.cos(a) * rr), Math.round(py - 4 + Math.sin(a) * rr * 0.6), 1, 1);
            ctx.fillStyle = 'rgba(220,220,220,0.5)'; ctx.fillRect(Math.round(px + 8 + Math.cos(a + 1) * rr * 0.5), Math.round(py - 6 - rr * 0.4), 2, 2);
          }
        } });
      }
    }
    if (lang === 'ja' && fest === 'lantern') {
      for (const { x, y } of doors(1)) {
        const px = sx(x, y), py = sy(x, y);
        if (!visible(px, py)) continue;
        list.push({ depth: x + y + 0.1, draw: () => {
          for (const ox of [-6, 5]) {
            ctx.fillStyle = '#3a8a3a'; ctx.fillRect(px + ox, py - 8, 1, 7); ctx.fillRect(px + ox + 1, py - 6, 1, 5); ctx.fillStyle = '#7ac85a'; ctx.fillRect(px + ox, py - 8, 1, 1);
            ctx.fillStyle = '#c8a060'; ctx.fillRect(px + ox - 1, py - 2, 4, 2);
          }
        } });
      }
    }
    if (lang === 'ja' && fest === 'flower') {
      for (const nd of s.nodes) {
        if (nd.kind !== 'tree' || nd.id % 6 !== 0) continue;
        const x = nd.x + 0.5, y = nd.y + 1.3, px = sx(x, y), py = sy(x, y);
        if (!visible(px, py)) continue;
        list.push({ depth: x + y - 0.6, draw: () => {
          ctx.fillStyle = nd.id % 12 ? '#c83a3a' : '#3a6ab8'; ctx.fillRect(px - 6, py - 2, 12, 4);
          ctx.fillStyle = 'rgba(255,255,255,0.4)'; for (let k = -6; k < 6; k += 3) ctx.fillRect(px + k, py - 2, 1, 4);
          ctx.fillStyle = '#f4ecd8'; ctx.fillRect(px - 2, py - 1, 3, 2);
        } });
        // hanami: friends on the mat drinking, a song now and then, one already asleep with a red face
        if (tod(s) > 0.15 && tod(s) < 0.72) list.push({ depth: x + y - 0.5, draw: () => {
          for (let k = 0; k < 3; k++) {
            const id = nd.id * 3 + k, look = this.picnicLook(id), fx = px - 5 + k * 5, fy = py + (k === 1 ? 1 : 0);
            if (k === 2 && nd.id % 2 === 0) { const ls = lyingSprite('civilian', 'warrior', look); draw(ctx, ls, fx + 2, fy + 2); ctx.fillStyle = '#e86a6a'; ctx.fillRect(fx + 1, fy - 3, 2, 1); this.zzz(fx + 4, fy - 8, time + k); continue; }
            const toast = Math.sin(time * 1.3 + id) > 0.75;
            draw(ctx, humanSprite('civilian', 'warrior', look, toast ? FRAME.up : FRAME.sit, k === 0), fx, fy);
            if (toast) { ctx.fillStyle = '#f4f0e8'; ctx.fillRect(fx + (k === 0 ? -4 : 4), fy - 22, 1, 2); }
            if (k === 1 && Math.floor(time / 3 + nd.id) % 3 === 0) drawEmote(ctx, 'note', fx, fy - 22);
          }
          ctx.fillStyle = '#f4f0e4'; ctx.fillRect(px + 1, py - 3, 1, 2); ctx.fillStyle = '#2a4a8a'; ctx.fillRect(px + 1, py - 4, 1, 1);
        } });
      }
    }
    if (lang === 'ja' && fest === 'fireworks') {
      const g = s.buildings.find((b) => b.type === 'guild');
      if (!g) return;
      const spots = s.roads.filter((i) => { const x = i % MAP, y = (i / MAP) | 0; return Math.abs(x - g.x) + Math.abs(y - g.y) < 9 && hash(x, y, 41) % 4 === 0; }).slice(0, 6);
      for (const i of spots) {
        const x = i % MAP + 0.5, y = ((i / MAP) | 0) + 0.5, px = sx(x, y), py = sy(x, y);
        if (!visible(px, py)) continue;
        list.push({ depth: x + y + 0.3, draw: () => {
          ctx.fillStyle = '#6a4426'; ctx.fillRect(px - 6, py - 4, 1, 6); ctx.fillRect(px + 5, py - 4, 1, 6);
          ctx.fillStyle = '#a8743e'; ctx.fillRect(px - 6, py - 2, 12, 3);
          for (let k = 0; k < 12; k++) { ctx.fillStyle = k % 4 < 2 ? '#d83a2a' : '#f4ecd8'; ctx.fillRect(px - 7 + k, py - 8, 1, 3); }
          ctx.fillStyle = '#f4ecd8'; ctx.fillRect(px - 3, py - 5, 6, 1);
          if (Math.sin(time * 3 + i) > 0) { ctx.fillStyle = 'rgba(230,230,230,0.6)'; ctx.fillRect(px - 1, py - 11 - (Math.floor(time * 3) % 3), 2, 2); }
        } });
      }
    }
  }

  // water glints drift along, bog bubbles swell and pop; both sit on the ground layer under everything else
  // which way the river runs through each of its tiles, and where it swirls at the bends
  private flowDir = new Map<number, [number, number]>();
  private eddies: [number, number][] = [];
  private buildFlow(s: GameState) {
    this.flowDir.clear(); this.eddies = [];
    const r = villageDef(s.village).terrain.river;
    if (!r) return;
    // downstream runs toward the front of the map, except where the river meets the sea behind
    const toSea = !!villageDef(s.village).terrain.sea, dir = toSea ? -1 : 1;
    for (const i of this.waters) {
      const x = i % MAP, y = (i / MAP) | 0;
      if (isSea(x, y) || terrainAt(x, y) !== WATER) continue;
      this.flowDir.set(i, r.along === 'y' ? [0, dir] : [dir, 0]);
    }
    const route = this.route;
    if (route) for (let k = 2; k < route.pts.length - 2; k++) {
      const a = route.pts[k - 2], b = route.pts[k], c = route.pts[k + 2];
      const turn = Math.abs(Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]));
      if (turn > 0.35 && turn < 3) this.eddies.push([b[0] + (c[1] - a[1]) * 0.25, b[1] - (c[0] - a[0]) * 0.25]);
    }
  }
  private groundLife(sx: (x: number, y: number) => number, sy: (x: number, y: number) => number, lw: number, lh: number, time: number) {
    const ctx = this.lctx;
    if (!isFrozen()) for (const [ex, ey] of this.eddies) {
      const px = sx(ex, ey), py = sy(ex, ey);
      if (px < -20 || py < -20 || px > lw + 20 || py > lh + 20) continue;
      for (let k = 0; k < 4; k++) { const a = time * 2 + (k * Math.PI) / 2; ctx.fillStyle = k % 2 ? 'rgba(235,248,255,0.8)' : 'rgba(200,230,250,0.6)'; ctx.fillRect(Math.round(px + Math.cos(a) * 4), Math.round(py + Math.sin(a) * 2), 2, 1); }
    }
    // on a river the glints are carried downstream along its course; still water just shimmers in place
    const flow = this.flowDir;
    for (const i of isFrozen() ? [] : this.waters) {
      const x = i % MAP, y = (i / MAP) | 0, px = sx(x + 0.5, y + 0.5), py = sy(x + 0.5, y + 0.5);
      if (px < -20 || py < -20 || px > lw + 20 || py > lh + 20) continue;
      const h = hash(x, y, 9), p = (time * 0.45 + (h % 100) / 100) % 1;
      if (p > 0.5) continue;
      const f = flow.get(i), fx = f ? (f[0] - f[1]) * 16 : 8, fy = f ? (f[0] + f[1]) * 8 : 2;
      const ox = ((h >> 7) % 13) - 6 + Math.round(p * fx), oy = ((h >> 11) % 5) - 2 + Math.round(p * fy);
      ctx.fillStyle = p < 0.1 || p > 0.4 ? 'rgba(220,240,255,0.45)' : 'rgba(235,248,255,0.85)';
      ctx.fillRect(px + ox, py + oy, p > 0.15 && p < 0.35 ? 3 : 2, 1);
    }
    for (const i of this.bogs) {
      const x = i % MAP, y = (i / MAP) | 0, px = sx(x + 0.5, y + 0.5), py = sy(x + 0.5, y + 0.5);
      if (px < -20 || py < -20 || px > lw + 20 || py > lh + 20) continue;
      const h = hash(x, y, 13), p = (time * 0.3 + (h % 100) / 100) % 1;
      if (p > 0.22) continue;
      const bx = px + ((h >> 6) % 11) - 5, by = py + ((h >> 10) % 5) - 2;
      ctx.fillStyle = 'rgba(160,190,130,0.8)';
      if (p < 0.12) ctx.fillRect(bx, by, 1 + Math.floor(p * 16), 1 + Math.floor(p * 8));
      else { ctx.fillRect(bx - 1, by - 1, 1, 1); ctx.fillRect(bx + 2, by - 1, 1, 1); ctx.fillRect(bx, by - 2, 1, 1); }
    }
  }
  private emotes = new Map<number, { k: string; t: number }>();
  private lastTime = 0;
  // what a few buildings do on their own: the lighthouse sweeps the sea, the drum tower beats the hours, a donkey
  // walks the mill, the fish market auctions at dawn, tea drinkers sit at the stall; eaves drip after rain;
  // and a wonder that has just risen a stage drops its veil in a flurry of doves
  private stages = new Map<number, { k: number; t: number }>();
  private bldExtras(s: GameState, b: Building, sp: Sprite, px: number, py: number, time: number, dripping: boolean) {
    const ctx = this.lctx, t = this.lightTod(s);
    if (b.type === 'drumTower' && ((t > 0.03 && t < 0.07) || (t > 0.68 && t < 0.72))) {
      const p = (time * 1.2) % 1;
      for (let r = 0; r < 2; r++) { const rr = Math.round(4 + ((p + r * 0.5) % 1) * 14); ctx.fillStyle = `rgba(255,240,200,${(0.5 * (1 - ((p + r * 0.5) % 1))).toFixed(2)})`; ctx.fillRect(px - rr, py - 22, 1, 2); ctx.fillRect(px + rr, py - 22, 1, 2); }
      if (Math.floor(time * 2.4) % 2) { ctx.fillStyle = '#5a3a22'; ctx.fillRect(px + 3, py - 25, 3, 1); }
    }
    if (b.type === 'stoneMill' && t > 0.05 && t < 0.7) {
      const a = time * 0.8, dx = Math.round(Math.cos(a) * 9), dy = Math.round(Math.sin(a) * 4.5), face = Math.sin(a) > 0 ? -1 : 1;
      ctx.fillStyle = '#5a3a22'; ctx.fillRect(px, py + 3, dx, 1);
      const x = px + dx, y = py + 6 + dy, step = Math.floor(time * 6) % 2;
      ctx.fillStyle = '#8a8288'; ctx.fillRect(x - 3, y - 6, 7, 3); ctx.fillRect(x + face * 3, y - 8, 2, 3);
      ctx.fillStyle = '#6a6268'; ctx.fillRect(x + face * 4, y - 10, 1, 2); ctx.fillRect(x - 3, y - 3, 1, 2 + step); ctx.fillRect(x + 3, y - 3, 1, 3 - step);
    }
    const dry = s.weather !== 'rain' && s.weather !== 'storm' && s.weather !== 'snow';
    // herbs drying on bamboo trays outside the pharmacy
    if (b.type === 'pharmacy' && b.door && t > 0.08 && t < 0.62 && dry) {
      const dx = this.sxF(b.door.x + 0.5, b.door.y + 0.5), dy = this.syF(b.door.x + 0.5, b.door.y + 0.5);
      for (let k = 0; k < 2; k++) {
        const x = dx + (k ? 7 : -7), y = dy + (k ? 2 : -1);
        ctx.fillStyle = '#6a4426'; ctx.fillRect(x - 1, y - 2, 1, 3); ctx.fillRect(x + 6, y - 2, 1, 3);
        ctx.fillStyle = '#c8a860'; ctx.fillRect(x - 2, y - 4, 10, 2); ctx.fillStyle = '#a8884a'; ctx.fillRect(x - 2, y - 3, 10, 1);
        for (let q = 0; q < 4; q++) { ctx.fillStyle = ['#6a8a3a', '#a85a3a', '#8a7a4a', '#5a7a3a'][(q + k) % 4]; ctx.fillRect(x - 1 + q * 2, y - 5, 2, 1); }
      }
    }
    // a farmer hoes the field by day
    if (b.type === 'farmField' && t > 0.06 && t < 0.62 && dry && this.lastSeason !== 3) {
      const swing = Math.sin(time * 3 + b.id) > 0.2, look = this.picnicLook(-b.id - 1, 'farmer');
      draw(ctx, humanSprite('civilian', 'warrior', look, swing ? FRAME.strike : FRAME.stand, b.id % 2 === 0), px + 4, py + 14);
      if (swing && Math.sin(time * 3 + b.id) > 0.9) { ctx.fillStyle = '#8a6a44'; ctx.fillRect(px + 12, py + 12, 1, 1); ctx.fillRect(px + 14, py + 11, 1, 1); }
    }
    // an angler sits at the end of the fishing dock
    if (b.type === 'fishingDock' && t > 0.05 && t < 0.66 && dry) {
      const look = this.picnicLook(-b.id - 7, 'fisherman'), x = px + 6, y = py + 10, bob = Math.round(Math.sin(time * 2 + b.id));
      draw(ctx, humanSprite('civilian', 'warrior', look, FRAME.sit, false), x, y);
      ctx.strokeStyle = 'rgba(240,240,240,0.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 6, y - 16); ctx.quadraticCurveTo(x + 14, y - 10, x + 16, y + 4 + bob); ctx.stroke();
      ctx.fillStyle = '#d83a2a'; ctx.fillRect(x + 16, y + 3 + bob, 1, 1);
      const c = (time / 8 + b.id * 0.3) % 1;
      if (c > 0.9) { const q = (c - 0.9) / 0.1; ctx.fillStyle = '#c8d8e8'; ctx.fillRect(Math.round(x + 16 - q * 8), Math.round(y + 3 - Math.sin(q * Math.PI) * 10), 3, 1); }
    }
    if (b.type === 'fishMarket' && t < 0.22) for (let k = 0; k < 5; k++) {
      const x = px - 10 + k * 5, y = py + 14 + (k % 2) * 3, up = Math.sin(time * 4 + k * 1.7) > 0.5;
      ctx.fillStyle = ['#3a5a8a', '#8a3a2a', '#4a4a5a', '#6a7a3a', '#3a3a6a'][k]; ctx.fillRect(x - 1, y - 5, 3, 4);
      ctx.fillStyle = '#f0d2ae'; ctx.fillRect(x - 1, y - 7, 3, 2);
      if (up) { ctx.fillRect(x + 2, y - 9, 1, 3); }
    }
    if ((b.type === 'chaya' || b.type === 'yatai') && (b.type === 'yatai' ? t > 0.55 || t < 0.04 : t > 0.2 && t < 0.65)) for (let k = 0; k < 2; k++) {
      if ((b.id + k) % 3 === 2) continue;
      const x = px + 8 + k * 6, y = py + 10 + k * 3, sip = Math.sin(time * 1.5 + k * 2) > 0.7;
      ctx.fillStyle = ['#4a6a9a', '#9a4a6a'][k]; ctx.fillRect(x - 2, y - 6, 4, 4);
      ctx.fillStyle = '#f0d2ae'; ctx.fillRect(x - 1, y - 8, 3, 2); ctx.fillStyle = '#2a2a2a'; ctx.fillRect(x - 1, y - 9, 3, 1);
      if (sip) { ctx.fillStyle = '#e8e0c8'; ctx.fillRect(x + 2, y - 7, 1, 1); }
    }
    if (dripping && sp.w > 20) for (const ex of [-sp.ax + 3, sp.w - sp.ax - 4]) {
      const p = (time * 1.6 + (ex > 0 ? 0.5 : 0) + b.id * 0.13) % 1, top = py - Math.round(sp.ay * 0.38);
      ctx.fillStyle = 'rgba(200,225,250,0.85)'; ctx.fillRect(px + ex, top + Math.round(p * p * 14), 1, 2);
      if (p > 0.9) { ctx.fillStyle = 'rgba(220,240,255,0.7)'; ctx.fillRect(px + ex - 1, top + 15, 3, 1); }
    }
    if (b.stage != null) {
      const st = this.stages.get(b.id);
      if (!st || b.stage !== st.k) this.stages.set(b.id, { k: b.stage, t: st && b.stage > st.k ? time : st?.t ?? -9 });
      const f = time - (this.stages.get(b.id)?.t ?? -9);
      if (f < 3) {
        // the scaffold's cloth slides down and the doves burst up from it
        const drop = Math.min(1, f / 0.8), top = py - sp.ay + 10, bottom = py + 6;
        if (drop < 1) { ctx.fillStyle = 'rgba(232,224,204,0.9)'; ctx.fillRect(px - sp.ax + 8, Math.round(top + (bottom - top) * drop), sp.w - 16, Math.round((bottom - top) * (1 - drop))); }
        for (let k = 0; k < 10; k++) {
          const a = k * 0.63 + 0.3, r = f * 30, flap = Math.floor(time * 10 + k) % 2;
          const x = Math.round(px + Math.cos(a) * r * 1.4), y = Math.round(py - sp.ay * 0.6 - f * 22 - Math.sin(a) * r * 0.4);
          ctx.fillStyle = `rgba(250,250,250,${(1 - f / 3).toFixed(2)})`; ctx.fillRect(x, y, 2, 1); ctx.fillRect(x - 1, y - flap, 1, 1); ctx.fillRect(x + 2, y - flap, 1, 1);
        }
        if (f < 2) this.confetti(px, py - sp.ay * 0.5, f);
      }
    }
  }
  private shakeAt = -9;
  private dryAt = -99;
  private kites: [number, number, number][] = [];
  // the baked ground with a wet or snowy cast laid over the land only (not the sky around it)
  private tintCache = new Map<string, HTMLCanvasElement>();
  private tinted(wetQ: number, snowQ: number): HTMLCanvasElement {
    if (!wetQ && !snowQ) return this.ground!;
    const key = `${this.groundKey}:${wetQ}:${snowQ}`;
    let c = this.tintCache.get(key);
    if (!c) {
      if (this.tintCache.size > 4) this.tintCache.clear();
      const src = this.ground!;
      c = makeCanvas(src.width, src.height);
      const g = c.getContext('2d')!;
      g.drawImage(src, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      if (snowQ) { g.fillStyle = `rgba(240,246,252,${(0.13 * snowQ).toFixed(2)})`; g.fillRect(0, 0, c.width, c.height); }
      if (wetQ) { g.fillStyle = `rgba(25,35,60,${(0.09 * wetQ).toFixed(2)})`; g.fillRect(0, 0, c.width, c.height); }
      this.tintCache.set(key, c);
    }
    return c;
  }
  // a faint colour cast for each season, easing into the next over the last days of the old one
  private grade(s: GameState, ctx: CanvasRenderingContext2D, lw: number, lh: number) {
    const COL = ['255,196,220', '255,232,160', '255,160,80', '160,190,240'];
    const doy = (s.day % 120) + (s.time / 20 - Math.floor(s.time / 20)), se = Math.floor(doy / 30) % 4, into = doy % 30;
    const blend = into > 25 ? (into - 25) / 5 : 0;
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = `rgba(${COL[se]},${(0.1 * (1 - blend)).toFixed(3)})`; ctx.fillRect(0, 0, lw, lh);
    if (blend) { ctx.fillStyle = `rgba(${COL[(se + 1) % 4]},${(0.1 * blend).toFixed(3)})`; ctx.fillRect(0, 0, lw, lh); }
    ctx.globalCompositeOperation = 'source-over';
  }
  // with a building selected, the rest of the scene dims a little around it
  private focusDim(s: GameState, ctx: CanvasRenderingContext2D, lw: number, lh: number, sx: (x: number, y: number) => number, sy: (x: number, y: number) => number) {
    if (this.selected?.kind !== 'bld') return;
    const id = this.selected.id, b = s.buildings.find((o) => o.id === id);
    if (!b) return;
    const n = BUILDINGS[b.type].size, cx = sx(b.x + n / 2, b.y + n / 2), cy = sy(b.x + n / 2, b.y + n / 2) - 10 * n, r = 22 * n;
    const gr = ctx.createRadialGradient(cx, cy, r, cx, cy, r * 2.6);
    gr.addColorStop(0, 'rgba(10,12,30,0)'); gr.addColorStop(1, 'rgba(10,12,30,0.32)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, lw, lh);
  }

  private clockT = 0;
  private lastSeason = 0;
  render(s: GameState, time: number) {
    this.lastTime = time;
    this.clockT = tod(s);
    this.lastSeason = season(s);
    this.followTick(s);
    if (this.emotes.size > 400) this.emotes.clear();
    this.buildGround(s);
    const z = this.cam.zoom;
    const lw = Math.ceil(this.canvas.width / z), lh = Math.ceil(this.canvas.height / z);
    if (this.low.width !== lw || this.low.height !== lh) { this.low.width = lw; this.low.height = lh; }
    const ctx = this.lctx;
    ctx.imageSmoothingEnabled = false;
    // a slain boss shakes the ground a little, briefly
    const shake = time - this.shakeAt < 0.4 ? Math.round(Math.sin(time * 60) * (1 - (time - this.shakeAt) / 0.4) * 1.5) : 0;
    this.ox = Math.floor(lw / 2 - this.cam.x) + shake;
    this.oy = Math.floor(lh / 2 - this.cam.y);
    const ox = this.ox, oy = this.oy;
    // the sky around the land follows the hour: lilac at dawn, blue by day, orange at dusk, deep blue at night
    const st = this.lightTod(s), sky = st < 0.08 ? ['#3a3a6a', '#c8a0c8'] : st < 0.62 ? ['#5a8ac8', '#a8d0f0'] : st < 0.76 ? ['#5a4a8a', '#f0a070'] : ['#141c38', '#2a3a6a'];
    const grad = ctx.createLinearGradient(0, 0, 0, lh); grad.addColorStop(0, sky[0]); grad.addColorStop(1, sky[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, lw, lh);
    horizon(ctx, ox, oy, st);
    karst(ctx, ox, oy, st, landSeason(s) >= 0 ? landSeason(s) : villageDef(s.village).ground === 'snow' ? 3 : 1, villageDef(s.village).ground);
    // the land darkens while it is wet and whitens as snow piles up
    if (s.weather !== this.wNow && (this.wNow === 'rain' || this.wNow === 'storm')) this.dryAt = time;
    const raining = s.weather === 'rain' || s.weather === 'storm';
    const wetQ = raining ? 2 : time - this.dryAt < 25 ? 1 : 0;
    const snowQ = villageDef(s.village).ground === 'snow' ? 0 : Math.min(3, s.snow ?? 0);
    ctx.drawImage(this.tinted(wetQ, snowQ), ox - GX - 16, oy - LIFT_PAD);
    // aerial depth: the far back of the land lies under a faint haze that clears toward the front
    {
      const hz = ctx.createLinearGradient(0, oy - 20, 0, oy + MAP * 7), hc = st >= 0.74 || st < 0.04 ? '40,50,90' : '220,230,240';
      hz.addColorStop(0, `rgba(${hc},0.2)`); hz.addColorStop(0.45, `rgba(${hc},0.06)`); hz.addColorStop(1, `rgba(${hc},0)`);
      ctx.save(); ctx.beginPath(); ctx.moveTo(ox, oy - 40); ctx.lineTo(ox + MAP * 16, oy + MAP * 8); ctx.lineTo(ox, oy + MAP * 16); ctx.lineTo(ox - MAP * 16, oy + MAP * 8); ctx.closePath(); ctx.clip();
      ctx.fillStyle = hz; ctx.fillRect(ox - MAP * 16, oy - 60, MAP * 32, MAP * 16 + 60); ctx.restore();
    }

    const sx = (x: number, y: number) => Math.round(ox + (x - y) * 16);
    const sy = (x: number, y: number) => Math.round(oy + (x + y) * 8 - elevation(x, y) * 8);
    const visible = (px: number, py: number) => px > -80 && py > -80 && px < lw + 80 && py < lh + 120;
    this.sxF = sx; this.syF = sy;
    const g = villageDef(s.village).ground;
    const landSe = landSeason(s);
    const fest = festival(s);
    const list: Drawable[] = [];
    const blit = (sp: Sprite, px: number, py: number) => draw(ctx, sp, px, py);
    const night = nightAlpha(this.lightTod(s));
    const gctx = night > 0 ? this.glowCtx(lw, lh) : null;
    this.glowLive = !!gctx;
    const snowy = landSe === 3 || s.weather === 'snow' || g === 'snow' || (s.snow ?? 0) > 0;
    const snowDepth = Math.max(1, Math.min(3, s.snow ?? 1));
    const view: View = { ctx, sx, sy, lw, lh, time, visible, push: (depth, fn) => list.push({ depth, draw: fn }), glowAt: (px, py, r) => this.glowAt(px, py, r), glow: gctx };
    // shadows lean away from the sun through the day
    const tt = this.lightTod(s);
    this.sunDx = tt > 0.04 && tt < 0.75 ? Math.round((tt - 0.4) * 9) : 0;

    // rain darkens the buildings; afterwards they dry from the edges inward in three steps
    const wetStage = raining ? 4 : time - this.dryAt < 24 ? 3 - Math.floor((time - this.dryAt) / 8) : 0;
    // hedges and flowerbeds side by side grow together into one continuous row or bed
    const joinable = new Map<number, string>();
    for (const b of s.buildings) if ((b.type === 'hedge' || b.type === 'flowerbed') && finished(b)) joinable.set(b.y * MAP + b.x, b.type);
    for (const b of s.buildings) {
      const n = BUILDINGS[b.type].size;
      const px = sx(b.x, b.y), py = sy(b.x, b.y);
      if (!visible(px, py)) continue;
      const flip = b.rot === 1;
      if (joinable.has(b.y * MAP + b.x)) for (const [dx, dy] of [[1, 0], [0, 1]]) {
        if (joinable.get((b.y + dy) * MAP + b.x + dx) !== b.type) continue;
        const mx = b.x + dx / 2, my = b.y + dy / 2, spr = buildingSprite(b.type), mpx = sx(mx, my), mpy = sy(mx, my);
        list.push({ depth: mx + my + 1, draw: () => blit(snowy ? snowCap(spr, b.type, snowDepth) : spr, mpx, mpy) });
      }
      // farm fields are laid on the ground as one patchwork (fieldsGround); only the scarecrow stands up
      const field = b.type === 'farmField' && finished(b) && (b.ready == null || s.time >= b.ready);
      // houses rotate through four looks by id
      const look = houseLook(b, g);
      const raw = finished(b) ? buildingSprite(look, flip) : buildingSprite(`${b.type}/s${b.stage ?? 0}`, flip);
      const tinted = groundTint(raw, g, `${look}:${b.stage ?? ''}:${flip}`);
      const aged = b.level >= 8 && finished(b) ? ivy(tinted, `${look}:${flip}:${g}`) : tinted;
      const capped = snowy ? snowCap(aged, `${look}:${b.stage ?? ''}:${flip}:${b.level >= 8}:${g}`, snowDepth) : aged;
      const sp = wetStage ? wetSprite(capped, `${look}:${b.stage ?? ''}:${flip}:${b.level >= 8}:${snowy}`, wetStage) : capped;
      // still going up: only the lower part stands, inside a scaffold
      const building = b.ready != null && s.time < b.ready ? 1 - (b.ready - s.time) / BUILD_TIME : null;
      const justDone = b.ready != null && s.time >= b.ready && s.time - b.ready < 2;
      // a building that just levelled up hops and throws off stars
      const lv = this.bldLevels.get(b.id);
      if (lv == null || b.level !== lv.lv) this.bldLevels.set(b.id, { lv: b.level, t: lv != null && b.level > lv.lv ? time : lv?.t ?? -9 });
      const since = time - (this.bldLevels.get(b.id)?.t ?? -9), hop = since < 0.4 ? Math.round(Math.sin((since / 0.4) * Math.PI) * 3) : 0;
      const kind = BUILDINGS[b.type].kind, closed = BUILDINGS[b.type].price > 0 && !isOpen(b.type, tod(s)) && kind !== 'house';
      const doorAt = this.doorOpen.get(b.id), doorOpen = doorAt != null && time - doorAt < 0.6;
      const sail = b.type === 'windmill' ? sailSprite(Math.floor(time * 2.5 + b.id), flip) : null;
      const lit = gctx ? buildingLit(look, flip) : null;
      const laundry = b.type === 'house' && b.id % 2 === 0 && !gctx && s.weather !== 'rain' && s.weather !== 'storm' && s.weather !== 'snow';
      const sel = this.selected?.kind === 'bld' && this.selected.id === b.id;
      list.push({
        depth: b.x + b.y + n,
        draw: () => {
          if (building != null) { this.underConstruction(sp, px, py, building, time + b.id); return; }
          if (field) this.scarecrow(sx(b.x + 1.75, b.y + 1.75), sy(b.x + 1.75, b.y + 1.75), time + b.id, s.weather === 'storm' || s.village === 'iron');
          else blit(sp, px, py - hop);
          if (hop || since < 0.8) this.stars(px, py - sp.ay * 0.6, since);
          if (justDone) this.confetti(px, py - sp.ay * 0.5, s.time - b.ready!);
          if (b.door && (doorOpen || closed)) this.doorway(sx(b.door.x + (b.rot ? 0.5 : 0), b.door.y + (b.rot ? 0 : 0.5)), sy(b.door.x + (b.rot ? 0.5 : 0), b.door.y + (b.rot ? 0 : 0.5)), doorOpen, closed);
          if (sail) blit(sail, px, py);
          if (laundry) this.laundry(px, py, time + b.id);
          if (kind === 'house' && b.id % 3 === 1 && !gctx) this.chickens(px, py, time, b.id);
          if (b.type === 'farmField') this.crops(px, py, landSe, time + b.id);
          if (b.id % 5 === 2 && !gctx) this.roofBird(s, b, px, py - sp.ay + 6, time);
          if (fest && n > 1) this.bunting(px, py, n, Math.max(10, Math.min(22, sp.ay - 18)), fest, time + b.id);
          if (sp.fx) for (const f of sp.fx) this.effect(f, px, py, time + b.id * 0.37, flip);
          this.bldExtras(s, b, sp, px, py, time, raining || time - this.dryAt < 12);
          if (gctx) this.windows(gctx, s, b, sp, sail, lit, px, py, time);
          if (sel) this.diamond(px, py, n, '#ffe066');
        },
      });
      if (this.labels) this.labelQueue.push({ x: px, y: py - sp.ay + 2, text: t('b.' + b.type) + ' ' + b.level });
    }
    this.fieldsGround(s, sx, sy, visible, landSe);
    this.groundLife(sx, sy, lw, lh, time);
    seaLife(view, s, this.spots);
    lighthouse(view, s, this.spots);
    volcano(view, s, this.spots);
    pondLife(view, s, this.spots, isFrozen());
    fallPools(view, s, this.falls);
    firecrackerLitter(view, s);
    ropeBridges(view, this.spots);
    wayside(view, s, this.spots);
    seaTorii(view, this.spots);
    this.wildSights(s, view, landSe);
    this.villageLife(s, view);
    this.playBossFx(view, time);
    this.landLife(sx, sy, lw, lh, time);
    for (const isl of this.islands) {
      const px = sx(isl.x + 0.5, isl.y + 0.5), py = sy(isl.x + 0.5, isl.y + 0.5) + 2;
      if (!visible(px, py)) continue;
      const sp = seasonal(nodeSprite('tree', isl.v, g), landSe, true);
      list.push({ depth: isl.x + isl.y + 1, draw: () => blit(sp, px, py) });
    }
    for (const hv of this.harvest) {
      const px = sx(hv.x + 0.5, hv.y + 0.5), py = sy(hv.x + 0.5, hv.y + 0.5);
      if (!visible(px, py)) continue;
      list.push({ depth: hv.x + hv.y + 0.5, draw: () => {
        const bend = Math.sin(time * 3 + hv.x) > 0 ? 1 : 0;
        // spring: a planter bent over the flooded paddy, setting out seedlings in rows
        if (landSe === 0) {
          ctx.fillStyle = '#e8d8a0'; ctx.fillRect(px - 3, py - 8 + bend, 7, 2); ctx.fillRect(px - 2, py - 9 + bend, 5, 1);
          ctx.fillStyle = '#4a6a8a'; ctx.fillRect(px - 2, py - 6 + bend, 4, 3); ctx.fillStyle = '#f0d2ae'; ctx.fillRect(px + 2, py - 4 + bend, 1, 2);
          ctx.fillStyle = '#7ac84a'; for (let k = 0; k < 4; k++) ctx.fillRect(px - 8 + k * 3, py + 2 - (k % 2), 1, 2);
          return;
        }
        ctx.fillStyle = '#e8d8a0'; ctx.fillRect(px - 3, py - 10 + bend, 7, 2); ctx.fillRect(px - 2, py - 11 + bend, 5, 1);
        ctx.fillStyle = '#4a6a8a'; ctx.fillRect(px - 1, py - 7 + bend, 3, 4); ctx.fillStyle = '#f0d2ae'; ctx.fillRect(px, py - 8 + bend, 1, 1);
        ctx.fillStyle = '#c8c8d0'; ctx.fillRect(px + 2, py - 4, 2, 1);
      } });
    }
    this.weatherGround(s, sx, sy, lw, lh, time);
    const tt2 = this.lightTod(s);
    if (tt2 > 0.06 && tt2 < 0.7 && s.weather !== 'storm' && s.weather !== 'rain' && s.weather !== 'fog') for (const b of s.buildings) {
      const px = sx(b.x, b.y), py = sy(b.x, b.y);
      if (!visible(px, py) || BUILDINGS[b.type].size < 1) continue;
      const look = houseLook(b, g), flip = b.rot === 1;
      const sp = finished(b) ? buildingSprite(look, flip) : buildingSprite(`${b.type}/s${b.stage ?? 0}`, flip);
      this.castShadow(sp, `${look}:${b.stage ?? ''}:${flip}`, px, py, tt2);
    }
    const mirrored: { sp: Sprite; px: number; base: number }[] = [];
    const byWater = (x: number, y: number, r: number) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const k = terrainAt(x + dx, y + dy); if ((k === WATER || k === STREAM) && !isRoad(x + dx, y + dy)) return true; } return false; };
    for (const b of s.buildings) {
      const n = BUILDINGS[b.type].size, px = sx(b.x, b.y), py = sy(b.x, b.y);
      if (!visible(px, py) || !byWater(b.x + (n >> 1), b.y + (n >> 1), Math.ceil(n / 2) + 1)) continue;
      const look = houseLook(b, g), sp = finished(b) ? buildingSprite(look, b.rot === 1) : buildingSprite(`${b.type}/s${b.stage ?? 0}`, b.rot === 1);
      mirrored.push({ sp, px, base: py - sp.ay + sp.h - 1 });
    }
    for (const nd of s.nodes) {
      if (nd.kind !== 'tree' || !byWater(nd.x, nd.y, 1)) continue;
      const px = sx(nd.x + 0.5, nd.y + 0.5), py = sy(nd.x + 0.5, nd.y + 0.5) + 2;
      if (visible(px, py)) mirrored.push({ sp: seasonal(nodeSprite('tree', nd.v, g), landSe, true), px, base: py });
    }
    for (const n of s.npcs) {
      if (n.inside != null || n.state === 'away' || !byWater(Math.floor(n.x), Math.floor(n.y), 1)) continue;
      const px = sx(n.x, n.y), py = sy(n.x, n.y);
      if (visible(px, py)) mirrored.push({ sp: humanSprite(n.role, n.cls, n.look, 0, n.facing < 0), px, base: py });
    }
    this.reflections(mirrored, ox, oy, lw, lh);
    if (culture.lang === 'ja') this.moss(s, sx, sy, visible);
    this.seasonGround(s, sx, sy, lw, lh, time);
    this.festivalDecor(s, fest, list, sx, sy, visible, time);
    this.villageSights(s, list, sx, sy, visible, time);
    this.localSights(s, list, sx, sy, visible, time);
    for (const w of this.walls) {
      const px = sx(w.x, w.y), py = sy(w.x, w.y);
      if (!visible(px, py)) continue;
      const sp = snowy ? snowCap(spriteNamed(w.name), w.name, snowDepth) : spriteNamed(w.name);
      list.push({ depth: w.x + w.y + 1, draw: () => blit(sp, px, py) });
    }
    const windNow = s.weather === 'storm' ? 2 : s.weather === 'rain' || s.weather === 'snow' || s.village === 'iron' ? 1 : 0;
    for (const c of this.crags) {
      const px = sx(c.x + 0.5, c.y + 0.5), py = sy(c.x + 0.5, c.y + 0.5) + 3;
      if (!visible(px, py)) continue;
      // a stepping-stone path winds through some of the Japanese bamboo
      if (c.kind === 'bamboo' && culture.lang === 'ja' && hash(c.x, c.y, 660) % 4 === 0) continue;
      if (c.kind === 'pillar' || c.kind === 'mangrove' || c.kind === 'palm') {
        if (s.buildings.some((b) => covers(b, c.x, c.y))) continue;
        // mangrove crowns and palm fronds rock between two frames in the wind
        const fr = Math.floor(time * (windNow ? 2.4 : 0.9) + c.x * 0.7 + c.y) % 2;
        const spr = spriteNamed(c.kind === 'pillar' ? `ter/pillar/${c.v}` : `ter/${c.kind}/${c.v}/${fr}`);
        list.push({ depth: c.x + c.y + 1, draw: () => blit(spr, px, py) });
        continue;
      }
      const sp = seasonal(terrainSprite(c.kind, c.v, g), landSe, true);
      const sway = c.kind === 'thicket' || c.kind === 'bamboo' ? this.sway(windNow, time, c.x * 7 + c.y) : 0;
      list.push({ depth: c.x + c.y + 1, draw: () => (sway ? this.swayed(sp, px, py, sway) : blit(sp, px, py)) });
    }
    const taken = new Set(s.nodes.map((nd) => nd.y * MAP + nd.x));
    for (const p of this.scenery) {
      if (taken.has(p.ty * MAP + p.tx)) continue;
      const px = sx(p.x, p.y), py = sy(p.x, p.y);
      if (!visible(px, py)) continue;
      const sp = seasonal(propSprite(p.name, g), landSe, true);
      list.push({ depth: p.x + p.y, draw: () => blit(sp, px, py) });
    }
    const worked = new Set(s.npcs.filter((n) => n.state === 'gather').map((n) => n.goalId));
    // the mountain village always has a wind blowing
    const wind = s.weather === 'storm' ? 2 : s.weather === 'rain' || s.weather === 'snow' || s.village === 'iron' ? 1 : 0;
    for (const nd of s.nodes) {
      const px = sx(nd.x + 0.5, nd.y + 0.5), py = sy(nd.x + 0.5, nd.y + 0.5) + 2;
      if (!visible(px, py)) continue;
      if (volcanicTop(s, nd.x, nd.y) || this.pooled.has(nd.y * MAP + nd.x)) continue;
      const local = nd.kind === 'tree' ? localTree(nd.id) : null;
      const sp = local ? localTreeSprite(local, landSe < 0 ? (g === 'snow' ? 3 : 1) : landSe) : seasonal(nodeSprite(nd.kind, nd.v, g), landSe, true);
      const age = nd.born == null ? 9 : s.time - nd.born;
      // each chop or swing knocks the node a pixel aside
      const shake = worked.has(nd.id) && Math.sin(time * 18 + nd.id) > 0.55 ? 1 : 0;
      const sway = nd.kind === 'tree' ? this.sway(wind, time, nd.id) : 0;
      list.push({
        depth: nd.x + nd.y + 1,
        draw: () => {
          if (age < GROW_TIME) this.growing(sp, px, py, age, nd.kind);
          else if (sway) this.swayed(sp, px + shake, py, sway);
          else blit(sp, px + shake, py);
          if (local && age >= GROW_TIME) this.leaves(local, landSe, px, py, time, nd.id);
        },
      });
    }
    // puffs where monsters vanish (defeated or gone) and where new ones appear
    const alive = new Map<number, [number, number, string, number, number]>();
    for (const m of s.monsters) {
      alive.set(m.id, [m.x, m.y, m.type, m.facing, m.boss != null ? 2 : 1]);
      if (!this.lastMon.has(m.id) && this.lastMon.size) this.puffs.push({ x: m.x, y: m.y, t: time, k: 0 });
    }
    for (const [id, [x, y, type, facing, k]] of this.lastMon) if (!alive.has(id)) {
      this.puffs.push({ x, y, t: time, k: 1 });
      this.dissolves.push({ x, y, t: time, type, facing, k });
      if (k > 1) this.shakeAt = time;
    }
    this.lastMon = alive;
    this.dissolves = this.dissolves.filter((d) => time - d.t < 0.8);
    for (const d of this.dissolves) {
      const px = sx(d.x, d.y), py = sy(d.x, d.y);
      if (visible(px, py)) list.push({ depth: d.x + d.y + 0.1, draw: () => this.dissolve(monsterSprite(d.type, 0, d.facing < 0), px, py, (time - d.t) / 0.8, d.k) });
    }
    this.puffs = this.puffs.filter((p) => time - p.t < 0.6);
    for (const p of this.puffs) {
      const px = sx(p.x, p.y), py = sy(p.x, p.y);
      if (!visible(px, py)) continue;
      list.push({ depth: p.x + p.y + 0.5, draw: () => this.puff(px, py, (time - p.t) / 0.6, p.k) });
    }
    for (const m of s.monsters) {
      const px = sx(m.x, m.y), py = sy(m.x, m.y);
      if (!visible(px, py)) continue;
      const nf = monsterFrames(m.type);
      // champions loop six frames as they move and hold two casting frames while a skill goes off
      const frame = nf === 8 ? (m.castT != null && s.time - m.castT < 0.8 ? 6 + (Math.floor(time * 6) % 2) : Math.floor(time * 8 + m.id) % 6) : Math.floor(time * (nf === 4 ? 6 : 3) + m.id) % nf;
      const base = monsterSprite(m.type, frame, m.facing < 0);
      // champions are struck constantly; they only blink white now and then so their art stays readable
      const hurt = this.hurt(m.id, m.hp, time) && (!m.champ || Math.floor(time * 3 + m.id) % 8 === 0);
      const sp = hurt ? flashSprite(base, `${m.type}:${frame}:${m.facing}`) : m.shiny ? shinySprite(base, `${m.type}:${frame}:${m.facing}`) : base;
      const legend = m.boss === 7, champ = !!m.champ, k = champ ? 1 : legend ? 3 : m.boss != null ? 2 : 1;
      const sel = this.selected?.kind === 'mon' && this.selected.id === m.id;
      // left to themselves, monsters show their nature: slimes wobble, flyers bob, beasts howl, snakes taste the air
      const fam = MONSTERS[m.type]?.fam, idleM = m.target == null && m.wait > 0, ph = time * 2 + m.id;
      const sq = idleM && fam === 'slime' ? Math.sin(ph * 1.6) : 0, kx = 1 + sq * 0.08, ky = 1 - sq * 0.1;
      const lift = idleM && (fam === 'flyer' || fam === 'wisp' || fam === 'ghost') ? Math.round(Math.sin(ph * 1.3) * 2) : 0;
      const top = py - Math.round(sp.ay * k * ky) + lift;
      list.push({
        depth: m.x + m.y,
        draw: () => {
          if (champ) this.champAura(m.type, px, py, sp.w, time);
          if (legend) this.legendAura(px, py, time);
          if (k > 1) this.ring(px, py, legend ? '#ffd34a' : '#ff4a3a');
          else if (!champ) this.shadow(px, py);
          // newcomers shimmer into view in a few steps
          if (m.born != null && s.time - m.born < 1) ctx.globalAlpha = 0.25 + 0.25 * Math.floor((s.time - m.born) * 4);
          // a lean forward just before it attacks, a two-pixel recoil when struck
          const lean = m.target != null && m.cd > 0 && m.cd < 0.2 ? m.facing : 0;
          ctx.drawImage(sp.img, sp.x, sp.y, sp.w, sp.h, Math.round(px - sp.ax * k * kx) + (hurt ? -m.facing * 2 : lean), top, Math.round(sp.w * k * kx), Math.round(sp.h * k * ky));
          if (idleM) this.monsterHabit(fam, px, top, sp.w * k, m.facing, time, m.id);
          if (m.boss != null) { const at = this.bossSeenAt.get(m.id) ?? (this.bossSeenAt.set(m.id, time), time), f = time - at; if (f < 3) this.bossAura(px, py, f); }
          ctx.globalAlpha = 1;
          if (m.shiny) this.sparkle(px, top, sp.w * k, time + m.id);
          const maxHp = Math.max(1, monsterStats(s, m.type, m).maxHp);
          if (champ) this.labelQueue.push({ x: px, y: top - 4, text: `${t('champ.' + m.champ)} Lv.${m.lv}`, color: m.champ === 'final' ? '#e8a0ff' : '#ffd060' });
          else if (k > 1) {
            this.hpBar(px, top - 4, m.hp / maxHp, '#e04a3a', 30);
            this.labelQueue.push({ x: px, y: top - 6, text: `${t('boss.' + m.boss)}${t('m.' + m.type)} Lv.${m.lv}`, color: '#ff8a7a' });
          } else if (m.target != null || sel) this.hpBar(px, top - 3, m.hp / maxHp, '#e04a3a');
          if (sel) this.marker(px, top - 6);
        },
        hit: { x: px - sp.ax * k, y: top, w: sp.w * k, h: sp.h * k, sel: { kind: 'mon', id: m.id } },
      });
    }
    for (const p of s.pets) {
      const px = sx(p.x, p.y), py = sy(p.x, p.y);
      if (!visible(px, py)) continue;
      const moving = p.wait <= 0;
      const sp = monsterSprite(p.type, moving ? Math.floor(time * 4 + p.id) % 2 : 0, p.facing < 0);
      const sel = this.selected?.kind === 'pet' && this.selected.id === p.id;
      list.push({
        depth: p.x + p.y,
        draw: () => {
          this.shadow(px, py);
          blit(sp, px, py);
          this.heart(px, py - sp.ay - 3, Math.sin(time * 2 + p.id) > 0.2);
          if (sel) this.marker(px, py - sp.ay - 7);
        },
        hit: { x: px - sp.ax, y: py - sp.ay, w: sp.w, h: sp.h, sel: { kind: 'pet', id: p.id } },
      });
    }
    if (s.cat) {
      const c = s.cat, px = sx(c.x, c.y), py = sy(c.x, c.y);
      if (visible(px, py)) {
        const fr = catFrame(c, time);
        const sp = catSprite(c.coat ?? 'orange', fr, c.facing < 0);
        const sel = this.selected?.kind === 'cat';
        list.push({
          depth: c.x + c.y,
          draw: () => {
            const onRoof = c.act === 'sit' && c.at != null && Math.floor(s.time / 30) % 4 === 1 ? s.buildings.find((b) => b.id === c.at) : undefined;
            const ry = onRoof ? -Math.max(10, buildingSprite(onRoof.type).ay - 12) : 0;
            if (!onRoof) this.shadow(px, py);
            blit(sp, px, py + ry);
            this.collar(s, sp, fr, c.facing < 0, px, py + ry);
            if (c.act === 'walk' && Math.floor(s.time / 20) % 3 === 0) { const bx = Math.round(px + (c.facing < 0 ? -8 : 8) + Math.sin(time * 3) * 2), by = Math.round(py - 9 + Math.sin(time * 5) * 2), w = Math.floor(time * 10) % 2; ctx.fillStyle = '#f2c84a'; ctx.fillRect(bx - 1, by - w, 1, 1); ctx.fillRect(bx + 1, by - w, 1, 1); ctx.fillStyle = '#3a2a2a'; ctx.fillRect(bx, by, 1, 1); }
            if (c.act === 'sit' && !onRoof && Math.floor(s.time / 40) % 3 === 0) { ctx.fillStyle = '#c8a070'; ctx.fillRect(px - 6, py - 5, 12, 5); ctx.fillStyle = '#a8804a'; ctx.fillRect(px - 6, py - 5, 12, 1); ctx.fillRect(px - 7, py - 6, 3, 1); ctx.fillRect(px + 4, py - 6, 3, 1); }
            if (c.act === 'lie' && s.weather === 'clear' && this.lightTod(s) < 0.7) { ctx.fillStyle = '#fff4a0'; ctx.fillRect(px - 2 + (Math.floor(time * 2) % 3), py - sp.ay - 3, 1, 1); }
            if (c.act === 'sleep') this.zzz(px + 4, py - sp.ay, time);
            if (c.act === 'happy') drawEmote(ctx, 'heart', px, py - sp.ay - 1);
            if (sel) this.marker(px, py - sp.ay - 6);
          },
          hit: { x: px - sp.ax - 2, y: py - sp.ay - 2, w: sp.w + 4, h: sp.h + 4, sel: { kind: 'cat', id: 0 } },
        });
      }
    }
    if (this.lanes.size > 600) this.lanes.clear();
    for (const n of s.npcs) {
      const was = this.wasInside.get(n.id);
      if (was !== undefined && was !== n.inside) this.doorOpen.set((n.inside ?? was)!, time);
      this.wasInside.set(n.id, n.inside);
    }
    if (this.wasInside.size > 800) this.wasInside.clear();
    for (const n of s.npcs) {
      if (n.inside != null || n.state === 'away' || n.state === 'carried') continue;
      if (this.hidden(n)) continue;
      const [lx, ly] = this.lane(n, sx, sy);
      const px = sx(n.x, n.y) + lx, py = sy(n.x, n.y) + ly;
      if (!visible(px, py)) continue;
      list.push(this.npcDrawable(s, n, px, py, time));
    }
    this.kites = [];
    list.sort((a, b) => a.depth - b.depth);
    this.hits = [];
    for (const d of list) {
      d.draw();
      if (d.hit) this.hits.push(d.hit);
    }
    if (this.hoverTile && this.ghost) this.drawGhost(s, sx, sy);

    // the marsh's dawn fog lies in every morning whatever the weather
    if (s.weather === 'fog' || (s.village === 'mist' && this.lightTod(s) < 0.15)) this.lowFog(ctx, lw, lh, time, sx, sy);
    // weather changes cross-fade over a few seconds
    if (s.weather !== this.wNow) { this.wAt = this.wNow == null ? -9 : time; this.wPrev = this.wNow ?? s.weather; this.wNow = s.weather; }
    const mix = Math.min(1, (time - this.wAt) / 4);
    drawAtmosphere(ctx, s, lw, lh, time, this.lightTod(s), sx, sy, s.weather, mix);
    if (mix < 1 && this.wPrev !== s.weather) drawWeather(ctx, s, this.wPrev, lw, lh, time, 1 - mix);
    drawFlavor(ctx, s, lw, lh, time, this.lightTod(s));
    for (const k of this.kites) kite(ctx, k[0], k[1], time, k[2]);
    skyLife(ctx, s, lw, lh, time);
    // a rainbow once the rain stops on a day that clears,
    // only now and then, on about one clearing in five
    const rb = (this.wPrev === 'rain' || this.wPrev === 'storm') && s.weather === 'clear' && this.lightTod(s) > 0.08 && this.lightTod(s) < 0.65 && hash(s.day, 7, 77) % 5 === 0 ? time - this.wAt : 99;
    if (rb < 40) rainbow(ctx, lw, lh, Math.min(1, rb / 4) * Math.min(1, (40 - rb) / 10));
    this.grade(s, ctx, lw, lh);
    this.sceneTouches(s, ctx, lw, lh, time, sx, sy);
    if (night > 0) {
      ctx.fillStyle = `rgba(12,18,52,${night})`;
      ctx.fillRect(0, 0, lw, lh);
      ctx.globalAlpha = Math.min(1, night * 2.4);
      ctx.drawImage(this.glow, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = night * 0.45;
      ctx.drawImage(this.glow, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    // a brief red glow at the screen's edges when a boss first appears, fading over three seconds
    const boss = currentBoss(s);
    if (boss && boss.id !== this.bossSeen) { this.bossSeen = boss.id; this.bossAt = time; }
    if (!boss) this.bossSeen = null;
    const bf = time - this.bossAt;
    if (bf < 3) {
      const a = 0.35 * (1 - bf / 3);
      for (let k = 0; k < 6; k++) {
        ctx.fillStyle = `rgba(220,40,30,${(a * (1 - k / 6)).toFixed(3)})`;
        ctx.fillRect(0, k * 2, lw, 2); ctx.fillRect(0, lh - k * 2 - 2, lw, 2); ctx.fillRect(k * 2, 0, 2, lh); ctx.fillRect(lw - k * 2 - 2, 0, 2, lh);
      }
    }
    meteors(ctx, s, lw, lh, time);
    this.focusDim(s, ctx, lw, lh, sx, sy);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.low, 0, 0, lw * z, lh * z);
    this.drawFloaters(s, sx, sy);
    this.drawLabels();
    this.bigBossBar(s);
  }

  private labelQueue: { x: number; y: number; text: string; color?: string }[] = [];
  private drawLabels() {
    const ctx = this.ctx, z = this.cam.zoom;
    ctx.font = `${Math.round(Math.max(11, 4 * z))}px "DotGothic16", monospace`;
    ctx.textAlign = 'center';
    for (const l of this.labelQueue) {
      const w = ctx.measureText(l.text).width + 8;
      ctx.fillStyle = 'rgba(20,24,52,0.78)';
      ctx.fillRect(l.x * z - w / 2, l.y * z - 4 * z - 12, w, Math.max(14, 4 * z) + 4);
      ctx.fillStyle = l.color ?? '#fbf6e6';
      ctx.fillText(l.text, l.x * z, l.y * z - 4 * z + 2);
    }
    this.labelQueue = [];
  }

  private glow = makeCanvas(1, 1);
  private glowLive = false;
  // a pool of warm light on the night layer
  private glowAt(px: number, py: number, rr: number) {
    if (!this.glowLive) return;
    const g = this.glow.getContext('2d')!, gr = g.createRadialGradient(px, py, 1, px, py, rr);
    gr.addColorStop(0, 'rgba(255,200,120,0.8)'); gr.addColorStop(1, 'rgba(255,180,100,0)');
    g.fillStyle = gr; g.fillRect(px - rr, py - rr, rr * 2, rr * 2);
  }
  private glowCtx(w: number, h: number) {
    if (this.glow.width !== w || this.glow.height !== h) { this.glow.width = w; this.glow.height = h; }
    const g = this.glow.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    return g;
  }
  // lit windows go on a separate layer drawn over the night tint; nearer buildings erase what they hide.
  // homes go dark one by one late at night, and a few windows flicker like candles
  private windows(g: CanvasRenderingContext2D, s: GameState, b: { id: number; type: string }, sp: Sprite, sail: Sprite | null, lit: Sprite | null, px: number, py: number, time: number) {
    g.globalCompositeOperation = 'destination-out';
    draw(g, sp, px, py);
    if (sail) draw(g, sail, px, py);
    g.globalCompositeOperation = 'source-over';
    const halo = HALO[b.type];
    if (halo) {
      const [hx, hy, rr] = halo, gr = g.createRadialGradient(px + hx, py + hy, 1, px + hx, py + hy, rr);
      gr.addColorStop(0, 'rgba(255,214,140,0.85)'); gr.addColorStop(1, 'rgba(255,190,110,0)');
      g.fillStyle = gr; g.fillRect(px + hx - rr, py + hy - rr, rr * 2, rr * 2);
    }
    if (!lit) return;
    const tt = this.lightTod(s), late = tt > 0.9 || tt < 0.04;
    if (BUILDINGS[b.type].kind === 'house' && late && (b.id * 7) % 3 !== 0) return;
    g.globalAlpha = Math.sin(time * 9 + b.id * 2.3) > 0.85 ? 0.7 : 1;
    draw(g, lit, px, py);
    g.globalAlpha = 1;
    const spots = litSpots(lit);
    if (!spots.length) return;
    // lamplight spills onto the ground below the windows
    const bottom = py - lit.ay + lit.h - 4;
    for (const [wx] of spots.slice(0, 2)) {
      const x = px - lit.ax + wx, gr = g.createRadialGradient(x, bottom, 1, x, bottom, 12);
      gr.addColorStop(0, 'rgba(255,205,130,0.38)'); gr.addColorStop(1, 'rgba(255,190,110,0)');
      g.fillStyle = gr; g.fillRect(x - 12, bottom - 12, 24, 24);
    }
    // now and then someone walks past a lit window, a dark shape against the light
    const cyc = Math.floor(time / 6 + b.id * 0.37), p = (time / 6 + b.id * 0.37) % 1;
    if (hashN(cyc, b.id) % 3 === 0 && p < 0.6) {
      const [wx, wy] = spots[hashN(cyc, b.id + 1) % spots.length], x = Math.round(px - lit.ax + wx - 2 + (p / 0.6) * 4), y = py - lit.ay + wy;
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = 'rgba(0,0,0,0.8)'; g.fillRect(x, y - 1, 2, 4); g.fillRect(x, y - 2, 1, 1);
      g.globalCompositeOperation = 'source-over';
    }
  }

  // fog pools in the hollows and along the water, thins on the slopes and leaves the peaks standing clear above it
  private fogPuff: HTMLCanvasElement | null = null;
  private lowFog(ctx: CanvasRenderingContext2D, lw: number, lh: number, time: number, sx: (x: number, y: number) => number, sy: (x: number, y: number) => number) {
    if (!this.fogPuff) {
      const c = makeCanvas(96, 40), g = c.getContext('2d')!;
      g.translate(48, 20); g.scale(1, 0.42);
      const gr = g.createRadialGradient(0, 0, 2, 0, 0, 46); gr.addColorStop(0, 'rgba(236,240,244,1)'); gr.addColorStop(0.55, 'rgba(236,240,244,0.55)'); gr.addColorStop(1, 'rgba(236,240,244,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 46, 0, Math.PI * 2); g.fill();
      this.fogPuff = c;
    }
    const puff = this.fogPuff;
    for (let y = 0; y < MAP; y += 2) for (let x = 0; x < MAP; x += 2) {
      const L = Math.floor(halfLevel(x, y) / 2), wetLow = terrainAt(x, y) === WATER || terrainAt(x, y) === BOG;
      const a = L >= 2 ? 0 : L === 1 ? 0.12 : L === 0 ? (wetLow ? 0.42 : 0.3) : 0.5;
      if (!a) continue;
      const drift = Math.sin(time * 0.12 + x * 0.7 + y * 0.3) * 8, px = sx(x + 1, y + 1) + drift, py = sy(x + 1, y + 1);
      if (px < -60 || py < -30 || px > lw + 60 || py > lh + 30) continue;
      ctx.globalAlpha = a;
      ctx.drawImage(puff, Math.round(px - 48), Math.round(py - 22));
    }
    ctx.globalAlpha = 1;
  }
  // soft moss grows on the ground around Japanese shrines, gardens and lanterns
  private moss(s: GameState, sx: (x: number, y: number) => number, sy: (x: number, y: number) => number, visible: (px: number, py: number) => boolean) {
    const ctx = this.lctx, MOSSY = ['zenGarden', 'shrine', 'inariShrine', 'torii', 'stoneLantern', 'senbonTorii', 'teaRoom', 'chaya', 'koiPond'];
    for (const b of s.buildings) {
      if (!MOSSY.includes(b.type)) continue;
      const n = BUILDINGS[b.type].size;
      for (let y = b.y - 1; y <= b.y + n; y++) for (let x = b.x - 1; x <= b.x + n; x++) {
        if (isRoad(x, y) || terrainAt(x, y) || !inVillage(x, y)) continue;
        const px = sx(x + 0.5, y + 0.5), py = sy(x + 0.5, y + 0.5);
        if (!visible(px, py)) continue;
        for (let k = 0; k < 9; k++) {
          const h = hash(x, y, 700 + k), u = (h % 100) / 100 - 0.5, v = ((h >> 7) % 100) / 100 - 0.5;
          ctx.fillStyle = k % 3 === 0 ? 'rgba(90,140,60,0.55)' : 'rgba(70,120,50,0.5)';
          ctx.fillRect(Math.round(px + (u - v) * 14), Math.round(py + (u + v) * 7), 3, 1);
        }
      }
    }
  }
  // shadows of the buildings lie away from the sun: long and slanting at morning and evening, short at noon
  private silCache = new Map<string, HTMLCanvasElement>();
  private castShadow(sp: Sprite, key: string, px: number, py: number, tt: number) {
    let sil = this.silCache.get(key);
    if (!sil) {
      sil = makeCanvas(sp.w, sp.h);
      const g = sil.getContext('2d')!;
      g.drawImage(sp.img, sp.x, sp.y, sp.w, sp.h, 0, 0, sp.w, sp.h);
      g.globalCompositeOperation = 'source-in'; g.fillStyle = '#141826'; g.fillRect(0, 0, sp.w, sp.h);
      if (this.silCache.size > 300) this.silCache.clear();
      this.silCache.set(key, sil);
    }
    const ctx = this.lctx, k = -(tt - 0.4) * 2.2, sc = 0.28 + Math.abs(tt - 0.4) * 0.9, base = py - sp.ay + sp.h - 2;
    ctx.save();
    ctx.globalAlpha = 0.17;
    ctx.setTransform(1, 0, k, sc, px, base);
    ctx.drawImage(sil, -sp.ax, -sp.h);
    ctx.restore();
  }
  // things beside water are mirrored in it, clipped to the water's surface
  private refl = makeCanvas(1, 1);
  private waterMask: HTMLCanvasElement | null = null;
  private reflections(items: { sp: Sprite; px: number; base: number }[], ox: number, oy: number, lw: number, lh: number) {
    if (!items.length || !this.waterMask || isFrozen()) return;
    if (this.refl.width !== lw || this.refl.height !== lh) { this.refl.width = lw; this.refl.height = lh; }
    const g = this.refl.getContext('2d')!;
    g.clearRect(0, 0, lw, lh);
    g.imageSmoothingEnabled = false;
    for (const { sp, px, base } of items) {
      g.save(); g.translate(px, base); g.scale(1, -1);
      g.drawImage(sp.img, sp.x, sp.y, sp.w, sp.h, -sp.ax, -sp.h, sp.w, sp.h);
      g.restore();
    }
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(this.waterMask, ox - GX - 16, oy - LIFT_PAD);
    g.globalCompositeOperation = 'source-over';
    const ctx = this.lctx;
    ctx.globalAlpha = 0.3; ctx.drawImage(this.refl, 0, 0); ctx.globalAlpha = 1;
  }

  // building effect points: [dx, dy] smoke, or [dx, dy, kind, value] for flags, fountain spray and water glints
  private effect(f: number[], px: number, py: number, time: number, flip: boolean) {
    const [dx, dy, k = 0, v = 0] = f;
    const x = px + dx, y = py + dy, ctx = this.lctx;
    if (k === 0) return this.smoke(x, y, time, v);
    if (k === 11) {
      // a hanging sign rocking on its bracket
      const sw = Math.sin(time * 1.8) * (Math.sin(time * 0.37) > 0.6 ? 2 : 1), col = '#' + v.toString(16).padStart(6, '0');
      ctx.fillStyle = '#3a2a1a'; ctx.fillRect(x, y, 1, 2); ctx.fillRect(x + 4, y, 1, 2);
      const ox = Math.round(sw);
      ctx.fillStyle = col; ctx.fillRect(x - 1 + ox, y + 2, 7, 5);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x - 1 + ox, y + 2, 7, 1);
      ctx.fillStyle = '#5a3a1a'; ctx.fillRect(x + 1 + ox, y + 4, 3, 2);
      return;
    }
    if (k === 12) {
      // firelight in the forge mouth breathes brighter and dimmer
      const f = 0.5 + 0.3 * Math.sin(time * 7) + 0.2 * Math.sin(time * 13.3);
      ctx.fillStyle = `rgba(255,${Math.round(150 + 60 * f)},60,${(0.25 + 0.3 * f).toFixed(2)})`;
      ctx.fillRect(x - v, y - v, v * 2, v * 2);
      ctx.fillStyle = `rgba(255,240,170,${(0.3 * f).toFixed(2)})`; ctx.fillRect(x - 1, y - 2, 3, 3);
      if (this.glowLive) this.glowAt(x, y, 10 + v * 2);
      return;
    }
    if (k === 13) {
      // the clock keeps the game's hours: the hour hand goes round once a day, the minute hand hourly
      const r = Math.floor(v / 10), left = (v % 10) === 1, s0 = this.clockT;
      const hour = ((s0 * 24 + 6) % 12) / 12 * Math.PI * 2, min = ((s0 * 24) % 1) * Math.PI * 2;
      const pt = (len: number, a: number): [number, number] => {
        const u = Math.sin(a) * len, w = Math.cos(a) * len;
        return left ? [x + u, y + u * 0.5 - w] : [x - u, y + u * 0.5 - w];
      };
      ctx.fillStyle = '#2a2a34';
      for (const [len, a] of [[r * 0.6, hour], [r * 0.95, min]] as const) for (let i = 1; i <= Math.ceil(len); i++) { const [qx, qy] = pt(i, a); ctx.fillRect(Math.round(qx), Math.round(qy), 1, 1); }
      return;
    }
    if (k === 1) {
      const col = '#' + v.toString(16).padStart(6, '0'), dir = flip ? -1 : 1;
      for (let i = 0; i < 7; i++) {
        const off = Math.round(Math.sin(time * 6 - i * 0.9) * (i / 6) * 1.2);
        ctx.fillStyle = col;
        ctx.fillRect(x + dir * (i + 1), y + off, 1, 4);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(x + dir * (i + 1), y + off, 1, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(x + dir * (i + 1), y + off + 3, 1, 1);
      }
      return;
    }
    if (k === 2) {
      ctx.fillStyle = '#e8f8ff';
      ctx.fillRect(x, y - 2 - (Math.floor(time * 8) % 2), 1, 3);
      for (let i = 0; i < 6; i++) {
        const p = (time * 1.3 + i / 6) % 1, side = i % 2 ? 1 : -1, spread = 2 + (i % 3) * 1.5;
        ctx.fillStyle = p < 0.5 ? '#e8f8ff' : '#9ad8ff';
        ctx.fillRect(Math.round(x + side * p * spread), Math.round(y - 2 - Math.sin(Math.PI * p) * 3 + p * 4), 1, 1);
      }
      return;
    }
    if (k === 8 || k === 9) {
      // pigeons or cranes wheeling around a tower top
      for (let i = 0; i < (k === 9 ? 2 : 4); i++) {
        const a = time * (k === 9 ? 0.35 : 0.8) + (i * Math.PI * 2) / (k === 9 ? 2 : 4), flap = Math.floor(time * (k === 9 ? 3 : 8) + i) % 2;
        const bx = Math.round(x + Math.cos(a) * v * (flip ? -1 : 1)), by = Math.round(y + Math.sin(a) * v * 0.4 + Math.sin(time * 1.3 + i) * 2);
        ctx.fillStyle = k === 9 ? '#f4f4f0' : '#c8ccd4';
        if (k === 9) { ctx.fillRect(bx - 1, by, 3, 1); ctx.fillRect(bx - 3, by - 1 + flap * 2, 2, 1); ctx.fillRect(bx + 2, by - 1 + flap * 2, 2, 1); ctx.fillStyle = '#d83a2a'; ctx.fillRect(bx + 2, by, 1, 1); }
        else { ctx.fillRect(bx, by, 1, 1); ctx.fillRect(bx - 1, by - flap, 1, 1); ctx.fillRect(bx + 1, by - flap, 1, 1); }
      }
      return;
    }
    if (k === 10) {
      // glints that come and go over gilded surfaces
      for (let i = 0; i < 3; i++) {
        const tt = time * 0.8 + i * 0.41, cyc = Math.floor(tt), p = tt - cyc;
        if (p > 0.3) continue;
        const h1 = Math.sin(cyc * 12.9898 + i * 7.1 + x) * 43758.5, h2 = Math.sin(cyc * 78.233 + i * 3.3 + y) * 24634.6;
        const gx = Math.round(x + ((h1 - Math.floor(h1)) * 2 - 1) * v), gy = Math.round(y + ((h2 - Math.floor(h2)) * 2 - 1) * v * 0.6);
        ctx.fillStyle = '#fffbe0'; ctx.fillRect(gx, gy, 1, 1);
        if (p > 0.08 && p < 0.22) { ctx.fillRect(gx - 1, gy, 3, 1); ctx.fillRect(gx, gy - 1, 1, 3); }
      }
      return;
    }
    if (k === 7) {
      // koi circling the pond
      for (let i = 0; i < 3; i++) {
        const a = time * (0.5 + i * 0.13) + i * 2.1, rr = v * (0.4 + i * 0.18);
        const kx = Math.round(x + Math.cos(a) * rr), ky = Math.round(y + Math.sin(a) * rr * 0.5);
        ctx.fillStyle = i === 1 ? '#f4f0e8' : '#f0802a'; ctx.fillRect(kx, ky, 2, 1);
        ctx.fillStyle = i === 2 ? '#f4f0e8' : '#d84a2a'; ctx.fillRect(kx - Math.round(Math.cos(a + 1.6)), ky - Math.round(Math.sin(a + 1.6) * 0.5), 1, 1);
      }
      return;
    }
    if (k === 5) {
      // sparks fly from the anvil while the forge works
      for (let i = 0; i < 4; i++) {
        const p = (time * 2.5 + i / 4) % 1;
        if (p > 0.5) continue;
        ctx.fillStyle = p < 0.2 ? '#fff4a0' : '#ff9a3a';
        ctx.fillRect(Math.round(x + Math.cos(i * 1.9) * p * 10), Math.round(y - Math.sin(1 + i) * p * 8 + p * p * 14), 1, 1);
      }
      return;
    }
    if (k === 6) {
      for (let i = 0; i < 3; i++) {
        const p = (time * 0.7 + i / 3) % 1;
        ctx.fillStyle = `rgba(190,175,150,${(0.6 * (1 - p)).toFixed(2)})`;
        const rr = 1 + Math.floor(p * 3);
        ctx.fillRect(Math.round(x - 3 + i * 3 + p * 4), Math.round(y - p * 6), rr, rr);
      }
      if (Math.sin(time * 1.3) > 0.9) { ctx.fillStyle = '#8a8680'; ctx.fillRect(x + 2, Math.round(y + ((time * 20) % 6)), 1, 1); }
      return;
    }
    if (k === 4) {
      // a paddle wheel turning in the plane of the +a wall; mirrored buildings face the other way
      const dir = flip ? 1 : -1, rot = time * 1.6;
      const pt = (r: number, th: number): [number, number] => [Math.round(x + dir * r * Math.cos(th)), Math.round(y + (r * Math.cos(th)) / 2 - r * Math.sin(th))];
      ctx.fillStyle = '#4a3020';
      for (let i = 0; i < 32; i++) { const [qx, qy] = pt(v, (i / 32) * Math.PI * 2); ctx.fillRect(qx, qy, 1, 1); }
      for (let i = 0; i < 4; i++) for (let r = 1; r < v; r++) { const [qx, qy] = pt(r, rot + (i * Math.PI) / 4 * 2); ctx.fillRect(qx, qy, 1, 1); }
      ctx.fillStyle = '#8a5a32';
      for (let i = 0; i < 8; i++) { const [qx, qy] = pt(v, rot + (i * Math.PI) / 4); ctx.fillRect(qx - 1, qy - 1, 2, 2); }
      ctx.fillStyle = 'rgba(220,240,255,0.85)';
      for (let i = 0; i < 3; i++) { const p = (time * 1.8 + i / 3) % 1; ctx.fillRect(Math.round(x + dir * (2 - p * 4)), Math.round(y + v - p * 3 + p * p * 6), 1, 1); }
      return;
    }
    if (k === 3) {
      for (let i = 0; i < 3; i++) {
        const tt = time * 0.9 + i * 0.37, cyc = Math.floor(tt), p = tt - cyc;
        if (p > 0.6) continue;
        const h1 = Math.sin(cyc * 12.9898 + i * 78.233) * 43758.5, h2 = Math.sin(cyc * 39.346 + i * 11.135) * 24634.6;
        const a = (h1 - Math.floor(h1)) * Math.PI * 2, rr = Math.sqrt(h2 - Math.floor(h2)) * v * 0.85;
        const gx = Math.round(x + Math.cos(a) * rr), gy = Math.round(y + Math.sin(a) * rr * 0.5);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillRect(gx, gy, 1, 1);
        if (p > 0.2 && p < 0.4) { ctx.fillStyle = 'rgba(220,245,255,0.7)'; ctx.fillRect(gx - 1, gy, 3, 1); }
      }
    }
  }

  private mhp = new Map<number, { hp: number; t: number }>();
  // a monster that just lost health flashes white for a moment
  private hurt(id: number, hp: number, time: number) {
    const o = this.mhp.get(id);
    if (!o) { this.mhp.set(id, { hp, t: -9 }); return false; }
    if (hp < o.hp) o.t = time;
    o.hp = hp;
    if (this.mhp.size > 500) this.mhp.clear();
    return time - o.t < 0.12;
  }

  // crowns lean with the weather: an occasional gust when calm, a steady rock in rain, hard swings in a storm
  private sway(wind: number, time: number, id: number) {
    const ph = id * 1.7;
    if (wind === 0) return Math.sin(time * 0.6 + ph) > 0.93 ? 1 : 0;
    const v = Math.sin(time * (wind === 2 ? 5 : 2.2) + ph);
    return wind === 2 ? Math.round(v * 1.6) : v > 0.3 ? 1 : 0;
  }
  private swayed(sp: Sprite, px: number, py: number, dx: number) {
    const ctx = this.lctx, cut = Math.max(0, sp.h - 9);
    ctx.drawImage(sp.img, sp.x, sp.y + cut, sp.w, sp.h - cut, px - sp.ax, py - sp.ay + cut, sp.w, sp.h - cut);
    ctx.drawImage(sp.img, sp.x, sp.y, sp.w, cut, px - sp.ax + dx, py - sp.ay, sp.w, cut);
  }

  // townsfolk and tourists can be thinned out on screen; the simulation is untouched
  private hidden(n: Npc) {
    if (this.crowd === 'all' || n.role === 'fighter') return false;
    if (this.follow === n.id || (this.selected?.kind === 'npc' && this.selected.id === n.id)) return false;
    // adventurers only: gatherers, townsfolk, tourists and visiting notables all go
    if (this.crowd === 'fighters') return true;
    if (n.role === 'gatherer' || n.vip) return false;
    return this.crowd === 'min' || n.id % 2 === 1;
  }

  // walkers keep to the right of their direction so oncoming traffic passes side by side; party members fan out a little
  private lane(n: Npc, sx: (x: number, y: number) => number, sy: (x: number, y: number) => number): [number, number] {
    let tx = 0, ty = 0;
    const p = n.path[0];
    if (n.state === 'walk' && p) {
      const dx = sx(p.x, p.y) - sx(n.x, n.y), dy = sy(p.x, p.y) - sy(n.x, n.y);
      const d = Math.hypot(dx, dy);
      if (d > 0.01) { tx = (-dy / d) * 2.5; ty = (dx / d) * 2.5; }
    }
    if (n.lead != null) { const k = (n.id % 3) - 1; tx += k * 3; ty += ((n.id >> 2) % 2) * 2 - 1; }
    const cur = this.lanes.get(n.id) ?? [tx, ty];
    cur[0] += (tx - cur[0]) * 0.15; cur[1] += (ty - cur[1]) * 0.15;
    this.lanes.set(n.id, cur);
    return [Math.round(cur[0]), Math.round(cur[1])];
  }

  // chimney smoke: grey wisps; round warm puffs from ovens; dark soot from forges; broad white steam from baths
  private smoke(px: number, py: number, time: number, style = 0) {
    const ctx = this.lctx, n = style === 3 ? 5 : style === 1 ? 4 : 3;
    for (let k = 0; k < n; k++) {
      const f = (time * (style === 2 ? 0.45 : 0.35) + k / n) % 1;
      const r = (style === 1 ? 2 : 1) + Math.floor(f * (style === 3 ? 4 : 2.5));
      const a = (style === 3 ? 0.55 : 0.75) * (1 - f);
      ctx.fillStyle = style === 2 ? `rgba(70,62,62,${a.toFixed(2)})` : style === 1 ? `rgba(240,232,220,${a.toFixed(2)})` : `rgba(225,225,230,${a.toFixed(2)})`;
      const x = Math.round(px + f * (style === 3 ? 3 : 5) + Math.sin(f * 6 + k) * (style === 3 ? 3 : 1) - r / 2), y = Math.round(py - 2 - f * (style === 3 ? 12 : 16));
      ctx.fillRect(x, y, r, r);
      if (style === 1 && r > 2) { ctx.fillRect(x - 1, y + 1, r + 2, r - 2); }
      if (style === 2 && f < 0.25 && k === 0) { ctx.fillStyle = '#ff9a3a'; ctx.fillRect(x + 1, y + 2, 1, 1); }
    }
  }

  // in Chinese and Japanese villages some visitors wear hanfu or yukata, and more townsfolk dress up for festivals
  private dress(s: GameState, n: Npc) {
    const robe = culture.lang === 'zh' ? 'hanfu' : culture.lang === 'ja' ? 'yukata' : null;
    if (n.role === 'fighter' || n.role === 'gatherer') return n.look;
    if (!robe) return season(s) === 3 && n.role === 'civilian' ? { ...n.look, outfit: 'coat' } : n.look;
    const fest = festival(s) != null;
    const wears = n.role === 'tourist' ? (fest ? n.id % 3 !== 2 : n.id % 3 === 0) : fest && n.id % 2 === 0;
    if (wears) return { ...n.look, outfit: robe };
    // padded coats in winter
    return season(s) === 3 && n.role === 'civilian' && n.look.outfit !== 'coat' ? { ...n.look, outfit: 'coat' } : n.look;
  }

  private umbrella(px: number, py: number, col: string) {
    const ctx = this.lctx;
    ctx.fillStyle = '#5a3a22'; ctx.fillRect(px + 1, py - 1, 1, 5);
    ctx.fillStyle = col; ctx.fillRect(px - 4, py - 3, 11, 2); ctx.fillRect(px - 2, py - 5, 7, 2); ctx.fillRect(px, py - 6, 3, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(px - 2, py - 5, 2, 1);
  }
  private handLantern(px: number, py: number, time: number) {
    const ctx = this.lctx, sw = Math.round(Math.sin(time * 3));
    ctx.fillStyle = 'rgba(255,190,90,0.35)'; ctx.fillRect(px - 3 + sw, py - 2, 7, 7);
    ctx.fillStyle = '#5a3a22'; ctx.fillRect(px + sw, py - 3, 1, 2); ctx.fillStyle = '#ffd88a'; ctx.fillRect(px - 1 + sw, py - 1, 3, 3);
  }

  // cloud shadows sliding over the land, a midsummer heat shimmer, footprints in the snow, worn paths, and a soft vignette
  private steps = new Map<number, number>();
  private skates: { x: number; y: number; t: number; dx: number }[] = [];
  private wear = new Float32Array(MAP * MAP);
  private sceneTouches(s: GameState, ctx: CanvasRenderingContext2D, lw: number, lh: number, time: number, sx: (x: number, y: number) => number, sy: (x: number, y: number) => number) {
    const tt = this.lightTod(s), day = tt > 0.06 && tt < 0.72;
    if (day && (s.weather === 'clear' || s.weather === 'fog')) {
      // cloud shadows fall on the land only, never on the sky around it
      ctx.save();
      ctx.beginPath(); ctx.moveTo(this.ox, this.oy); ctx.lineTo(this.ox + MAP * 16, this.oy + MAP * 8); ctx.lineTo(this.ox, this.oy + MAP * 16); ctx.lineTo(this.ox - MAP * 16, this.oy + MAP * 8); ctx.closePath(); ctx.clip();
      for (let k = 0; k < 3; k++) {
        const x = ((time * 6 + k * 400) % (lw + 300)) - 150, y = ((k * 211 + time * 2) % (lh + 120)) - 60;
        ctx.fillStyle = 'rgba(20,30,50,0.07)'; ctx.beginPath(); ctx.ellipse(x, y, 90, 34, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(x + 50, y + 10, 60, 24, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    if (day && season(s) === 1 && tt > 0.3 && tt < 0.55 && s.weather === 'clear') for (let k = 0; k < 6; k++) {
      const y = Math.round(((k * 97 + time * 8) % lh)); ctx.fillStyle = 'rgba(255,240,210,0.05)'; ctx.fillRect(Math.round(Math.sin(time * 2 + k) * 2), y, lw, 2);
    }
    // snow keeps a trail of footprints that slowly fills back in
    const snowy = villageDef(s.village).ground === 'snow' || season(s) === 3;
    if (snowy && Math.floor(time * 3) !== Math.floor((time - 1 / 60) * 3)) for (const n of s.npcs) if (n.inside == null && (n.state === 'walk' || n.state === 'hunt')) this.steps.set(Math.round(n.x * 4) * 4096 + Math.round(n.y * 4), time);
    if (this.steps.size) {
      ctx.fillStyle = 'rgba(120,140,170,0.5)';
      for (const [k, at] of this.steps) {
        if (time - at > 20 || !snowy) { this.steps.delete(k); continue; }
        const x = Math.floor(k / 4096) / 4, y = (k % 4096) / 4, px = sx(x, y), py = sy(x, y);
        if (px < 0 || py < 0 || px > lw || py > lh) continue;
        ctx.globalAlpha = 1 - (time - at) / 20; ctx.fillRect(px, py, 1, 1); ctx.fillRect(px + 2, py + 1, 1, 1);
      }
      ctx.globalAlpha = 1;
    }
    // skates and boots scratch pale lines across frozen water, slowly fading
    if (isFrozen() && Math.floor(time * 4) !== Math.floor((time - 1 / 60) * 4)) for (const n of s.npcs) {
      if (n.inside != null || n.state !== 'walk' || terrainAt(Math.floor(n.x), Math.floor(n.y)) !== WATER) continue;
      this.skates.push({ x: n.x, y: n.y, t: time, dx: n.facing });
    }
    if (this.skates.length) {
      this.skates = this.skates.filter((k) => time - k.t < 30 && isFrozen());
      for (const k of this.skates) { const px = sx(k.x, k.y), py = sy(k.x, k.y); ctx.fillStyle = `rgba(255,255,255,${(0.6 * (1 - (time - k.t) / 30)).toFixed(2)})`; ctx.fillRect(px - 2, py, 4, 1); }
    }
    // in the desert wind, sand streams off the dune crests
    if (villageDef(s.village).ground === 'sand' && (s.weather === 'sandstorm' || Math.sin(time * 0.05) > 0.3)) for (let k = 0; k < 24; k++) {
      const h = hash(k, 5, 55), x = (h % MAP), y = ((h >> 8) % MAP);
      if (inVillage(x, y) || terrainAt(x, y)) continue;
      const p = (time * 0.7 + (h % 100) / 100) % 1, px = sx(x + 0.5, y + 0.5) - p * 26, py = sy(x + 0.5, y + 0.5) - 3 - Math.sin(p * Math.PI) * 4;
      if (px < 0 || py < 0 || px > lw || py > lh) continue;
      for (let q = 0; q < 3; q++) { ctx.fillStyle = `rgba(240,220,170,${(0.6 * (1 - p)).toFixed(2)})`; ctx.fillRect(Math.round(px + q * 3), Math.round(py + q), 2, 1); }
    }
    // worn grass where people keep walking off the road
    if (Math.floor(time * 2) !== Math.floor((time - 1 / 60) * 2)) {
      for (const n of s.npcs) { if (n.inside != null) continue; const i = Math.floor(n.y) * MAP + Math.floor(n.x); if (i >= 0 && i < MAP * MAP && !isRoad(Math.floor(n.x), Math.floor(n.y))) this.wear[i] = Math.min(60, this.wear[i] + 1); }
      for (let i = 0; i < MAP * MAP; i++) if (this.wear[i] > 0) this.wear[i] -= 0.02;
    }
    // a trodden trail: bare soil specks and flattened tufts scattered across the tile, thicker where it is worn most,
    // with a few specks reaching toward worn neighbours so the patches join into a path
    for (let i = 0; i < MAP * MAP; i++) {
      if (this.wear[i] < 25) continue;
      const x = i % MAP, y = (i / MAP) | 0, px = sx(x + 0.5, y + 0.5), py = sy(x + 0.5, y + 0.5);
      if (px < -20 || py < -20 || px > lw + 20 || py > lh + 20) continue;
      const k = Math.min(1, (this.wear[i] - 25) / 35), n = 3 + Math.round(k * 7);
      for (let j = 0; j < n; j++) {
        const hh = hash(x, y, 300 + j), u = ((hh % 100) / 100 - 0.5) * 1.3, v = (((hh >> 7) % 100) / 100 - 0.5) * 1.3;
        const qx = Math.round(px + (u - v) * 9), qy = Math.round(py + (u + v) * 4.5), w = 1 + ((hh >> 14) % 3);
        ctx.fillStyle = j % 3 === 2 ? `rgba(110,90,60,${(0.25 * k + 0.1).toFixed(2)})` : `rgba(165,135,90,${(0.3 * k + 0.12).toFixed(2)})`;
        ctx.fillRect(qx, qy, w, 1);
        if (w > 1 && k > 0.5) ctx.fillRect(qx + 1, qy + 1, w - 1, 1);
      }
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const ni = (y + dy) * MAP + x + dx;
        if (ni < 0 || ni >= MAP * MAP || this.wear[ni] < 25) continue;
        const ex = sx(x + dx + 0.5, y + dy + 0.5), ey = sy(x + dx + 0.5, y + dy + 0.5);
        for (let j = 1; j < 4; j++) {
          const hh = hash(x * 3 + dx, y * 3 + dy, j);
          ctx.fillStyle = `rgba(160,130,88,${(0.22 * k + 0.1).toFixed(2)})`;
          ctx.fillRect(Math.round(px + ((ex - px) * j) / 4) + (hh % 3) - 1, Math.round(py + ((ey - py) * j) / 4) + ((hh >> 3) % 3) - 1, 2, 1);
        }
      }
    }
    const vg = ctx.createRadialGradient(lw / 2, lh / 2, Math.min(lw, lh) * 0.45, lw / 2, lh / 2, Math.max(lw, lh) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(10,12,30,0.28)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, lw, lh);
  }

  private sxF: (x: number, y: number) => number = () => 0;
  private syF: (x: number, y: number) => number = () => 0;
  private bossSeenAt = new Map<number, number>();
  private birdGone = new Map<number, number>();
  private bldLevels = new Map<number, { lv: number; t: number }>();
  // class flourishes when an adventurer strikes
  private flourish(s: GameState, n: Npc, sp: Sprite, px: number, py: number, time: number) {
    const ctx = this.lctx, iv = CLASSES[n.cls].interval, p = Math.max(0, Math.min(1, (iv - n.cd) / 0.22));
    if (n.cls === 'mage') {
      for (let i = 0; i < 12; i++) { const a = time * 4 + (i / 12) * Math.PI * 2; ctx.fillStyle = i % 2 ? '#c07aff' : '#7ad8ff'; ctx.fillRect(Math.round(px + Math.cos(a) * 7), Math.round(py + Math.sin(a) * 3), 1, 1); }
    } else if (n.cls === 'cleric') {
      ctx.fillStyle = 'rgba(255,240,160,0.35)'; ctx.fillRect(px - 3, py - sp.ay - 10, 7, sp.ay + 10);
      ctx.fillStyle = '#fff6c0'; ctx.fillRect(px - 1, py - sp.ay - 12 + Math.round(p * 6), 1, 2); ctx.fillRect(px + 2, py - sp.ay - 8 + Math.round(p * 4), 1, 1);
    } else if (n.cls === 'archer') {
      const m = s.monsters.find((o) => o.id === n.goalId);
      if (m) { const mx = this.sxF(m.x, m.y), my = this.syF(m.x, m.y) - 6, x = Math.round(px + (mx - px) * p), y = Math.round(py - 10 + (my - py + 10) * p); ctx.fillStyle = '#6a4426'; ctx.fillRect(x - 2, y, 3, 1); ctx.fillStyle = '#e8eef4'; ctx.fillRect(x + 1, y, 1, 1); }
    } else if (n.cls === 'lancer') {
      ctx.globalAlpha = 0.3; draw(ctx, sp, px - n.facing * 5, py); ctx.globalAlpha = 0.15; draw(ctx, sp, px - n.facing * 9, py); ctx.globalAlpha = 1;
    } else if (n.cls === 'monk' && p < 0.6) {
      ctx.fillStyle = '#ffe680'; const fx = px + n.facing * 8; ctx.fillRect(fx - 1, py - 9, 3, 1); ctx.fillRect(fx, py - 10, 1, 3);
    }
  }
  // chickens pecking by a house
  private chickens(px: number, py: number, time: number, id: number) {
    const ctx = this.lctx;
    for (let k = 0; k < 2; k++) {
      const a = time * 0.4 + id + k * 3, x = Math.round(px + Math.cos(a) * 9 + k * 4), y = Math.round(py + 4 + Math.sin(a * 1.3) * 3), peck = Math.sin(time * 6 + k + id) > 0.6 ? 1 : 0;
      ctx.fillStyle = '#f4f0e8'; ctx.fillRect(x - 1, y - 3, 3, 2); ctx.fillRect(x + 1, y - 4 + peck, 1, 1);
      ctx.fillStyle = '#d83a2a'; ctx.fillRect(x + 1, y - 5 + peck, 1, 1); ctx.fillStyle = '#e8a030'; ctx.fillRect(x + 2, y - 4 + peck, 1, 1); ctx.fillRect(x, y - 1, 1, 1);
    }
  }
  private doorOpen = new Map<number, number>();
  private wasInside = new Map<number, number | null>();
  // the part of the building already raised, poles and planks around it and a worker's hammer sparks
  private underConstruction(sp: Sprite, px: number, py: number, f: number, time: number) {
    const ctx = this.lctx, keep = Math.max(4, Math.round(sp.h * (0.25 + 0.75 * f))), cut = sp.h - keep;
    ctx.drawImage(sp.img, sp.x, sp.y + cut, sp.w, keep, px - sp.ax, py - sp.ay + cut, sp.w, keep);
    const top = py - sp.ay + cut - 3;
    ctx.fillStyle = '#8a5a32';
    for (const dx of [-sp.ax + 2, sp.w - sp.ax - 3, 0]) ctx.fillRect(px + dx, top, 1, py - top);
    ctx.fillStyle = '#b8844a'; for (let y = top + 3; y < py; y += 7) ctx.fillRect(px - sp.ax + 2, y, sp.w - 4, 1);
    if (Math.sin(time * 8) > 0.5) { ctx.fillStyle = '#fff4a0'; ctx.fillRect(px + 3, top + 2, 1, 1); ctx.fillRect(px + 5, top + 1, 1, 1); }
    ctx.fillStyle = '#c84a3a'; ctx.fillRect(px + 2, top - 3, 3, 2); ctx.fillStyle = '#f2d2ae'; ctx.fillRect(px + 3, top - 1, 1, 1);
  }
  private confetti(px: number, py: number, t: number) {
    const ctx = this.lctx, f = t / 2;
    for (let i = 0; i < 14; i++) { const a = i * 2.4; ctx.fillStyle = ['#ff6a6a', '#ffd34a', '#7dd6ff', '#7dff8a', '#c07aff'][i % 5]; ctx.fillRect(Math.round(px + Math.cos(a) * (6 + f * 14)), Math.round(py - 10 + f * 28 * f - Math.sin(a) * 6), 1, 2); }
  }
  private stars(px: number, py: number, t: number) {
    const ctx = this.lctx;
    for (let i = 0; i < 5; i++) { const a = i * 1.26, r = 4 + t * 14; ctx.fillStyle = t > 0.5 ? 'rgba(255,230,120,0.6)' : '#ffe680'; ctx.fillRect(Math.round(px + Math.cos(a) * r), Math.round(py - Math.sin(a) * r * 0.6 - t * 6), 1, 1); }
  }
  // a dark open doorway as someone passes through, or a 'closed' curtain outside opening hours
  private doorway(px: number, py: number, open: boolean, closed: boolean) {
    const ctx = this.lctx;
    if (open) { ctx.fillStyle = '#2a1e1a'; ctx.fillRect(px - 1, py - 7, 3, 6); }
    else if (closed) { ctx.fillStyle = '#3a5a8a'; ctx.fillRect(px - 2, py - 8, 5, 3); ctx.fillStyle = '#f4f0e4'; ctx.fillRect(px, py - 7, 1, 1); }
  }

  private levels = new Map<number, { lv: number; t: number }>();
  private lastMon = new Map<number, [number, number, string, number, number]>();
  private puffs: { x: number; y: number; t: number; k: number }[] = [];
  private bossSeen: number | null = null;
  private bossAt = -9;
  // k 0: a shimmer of arrival, k 1: smoke and sparks as one falls
  // a boss arrives in rings of dark red light and smoke
  private bossAura(px: number, py: number, f: number) {
    const ctx = this.lctx;
    for (let r = 0; r < 3; r++) { const rr = ((f * 14 + r * 6) % 18) + 4; ctx.fillStyle = `rgba(200,40,40,${(0.6 * (1 - rr / 22)).toFixed(2)})`; for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2; ctx.fillRect(Math.round(px + Math.cos(a) * rr), Math.round(py + Math.sin(a) * rr * 0.45), 1, 1); } }
    for (let i = 0; i < 6; i++) { const p = (f * 0.8 + i / 6) % 1; ctx.fillStyle = `rgba(40,20,30,${(0.5 * (1 - p)).toFixed(2)})`; ctx.fillRect(Math.round(px - 8 + i * 3), Math.round(py - p * 24), 2, 2); }
  }
  // a champion's presence: a wide shadow, a slow ring of its element under it and motes rising round it
  private champAura(type: string, px: number, py: number, w: number, time: number) {
    const ctx = this.lctx, col = ({ crimsonStag: '255,120,60', magmaColossus: '255,150,40', serpentQueen: '120,230,170', frostWyrm: '160,220,255', duneDjinn: '240,210,120', worldEater: '200,120,255' } as Record<string, string>)[type] ?? '255,220,120';
    const rx = Math.round(w * 0.38);
    ctx.fillStyle = 'rgba(10,8,20,0.35)'; ctx.beginPath(); ctx.ellipse(px, py, rx, rx * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    for (let k = 0; k < 24; k++) { const a = time * 0.6 + (k / 24) * Math.PI * 2; ctx.fillStyle = `rgba(${col},${(0.4 + 0.3 * Math.sin(time * 3 + k)).toFixed(2)})`; ctx.fillRect(Math.round(px + Math.cos(a) * rx * 1.1), Math.round(py + Math.sin(a) * rx * 0.33), 2, 1); }
    for (let k = 0; k < 8; k++) { const p = (time * 0.5 + k / 8) % 1; ctx.fillStyle = `rgba(${col},${(0.8 * (1 - p)).toFixed(2)})`; ctx.fillRect(Math.round(px - rx + ((k * 37) % (rx * 2))), Math.round(py - p * w * 0.6), 1, 2); }
    this.glowAt(px, py - w * 0.3, w * 0.5);
  }
  // champion and final-boss skills playing out frame by frame: projectiles, whirlwinds, eruptions, beams and rings
  private bossFx: { k: string; x: number; y: number; tx: number; ty: number; t0: number; mx: number; my: number }[] = [];
  private playBossFx(v: View, time: number) {
    const ctx = v.ctx;
    const DUR: Record<string, number> = { fireball: 1.1, meteor: 1.1, icicle: 0.9, voidorb: 1.2, leafstorm: 1.8, sandstorm: 1.8, roots: 1, poison: 2, waterspout: 1, sunbeam: 0.9, portal: 1, explosion: 0.6, quake: 0.9, charge: 0.6, breath: 1.1, blizzard: 1.6, voidbeam: 0.9, roar: 1.2 };
    this.bossFx = this.bossFx.filter((e) => time - e.t0 < (DUR[e.k] ?? 1));
    const frameOf = (k: string, f: number) => spriteNamed(`fx/${k}/${f}`);
    const at = (k: string, n: number, t: number, x: number, y: number, depth: number, loop = false, lift = 0) => {
      const f = loop ? Math.floor(t * 10) % n : Math.min(n - 1, Math.floor(t * n)), px = v.sx(x, y), py = v.sy(x, y) - lift;
      v.push(depth, () => draw(ctx, frameOf(k, f), px, py));
    };
    for (const e of this.bossFx) {
      const t = time - e.t0, d = DUR[e.k] ?? 1, u = t / d;
      const ox = v.sx(e.x, e.y), oy = v.sy(e.x, e.y), tx = v.sx(e.tx, e.ty), ty = v.sy(e.tx, e.ty);
      const deep = e.tx + e.ty + 0.6;
      if (e.k === 'fireball' || e.k === 'voidorb') {
        // flies in an arc from the boss, then bursts
        if (u < 0.55) { const q = u / 0.55, x = ox + e.mx + (tx - ox - e.mx) * q, y = oy + e.my + (ty - oy - e.my) * q - Math.sin(q * Math.PI) * 20; v.push(deep + 1, () => draw(ctx, frameOf(e.k, Math.floor(t * 12) % (e.k === 'fireball' ? 4 : 6)), Math.round(x), Math.round(y))); }
        else at('explosion', 6, (u - 0.55) / 0.45, e.tx, e.ty, deep, false, 8);
      } else if (e.k === 'meteor' || e.k === 'icicle') {
        // falls from high above onto its mark, then shatters or explodes
        if (u < 0.5) { const q = u / 0.5; v.push(deep + 1, () => draw(ctx, frameOf(e.k, Math.floor(t * 12) % 4), Math.round(tx - (1 - q) * (e.k === 'meteor' ? 40 : 0)), Math.round(ty - (1 - q) * 90))); }
        else at(e.k === 'meteor' ? 'explosion' : 'shatter', 6, (u - 0.5) / 0.5, e.tx, e.ty, deep, false, e.k === 'meteor' ? 8 : 4);
      } else if (e.k === 'leafstorm' || e.k === 'sandstorm') {
        const drift = Math.sin(t * 2) * 0.6;
        v.push(deep, () => { ctx.globalAlpha = Math.min(1, (1 - u) * 4, u * 6); draw(ctx, frameOf(e.k, Math.floor(t * 12) % 6), Math.round(tx + drift * 10), ty - 20); ctx.globalAlpha = 1; });
      } else if (e.k === 'poison') {
        v.push(deep, () => { ctx.globalAlpha = Math.min(1, (1 - u) * 3); draw(ctx, frameOf('poison', Math.floor(t * 8) % 6), tx, ty - 6); ctx.globalAlpha = 1; });
      } else if (e.k === 'sunbeam') at('sunbeam', 6, u, e.tx, e.ty, deep, false, 34);
      else if (e.k === 'waterspout') at('waterspout', 6, u, e.tx, e.ty, deep, false, 18);
      else if (e.k === 'roots') at('roots', 6, u, e.tx, e.ty, deep, false, 8);
      else if (e.k === 'portal') at('portal', 6, u, e.tx, e.ty, deep - 0.5, false, 0);
      else if (e.k === 'explosion') { at('explosion', 6, u, e.tx, e.ty, deep, false, 8); for (let q = 0; q < 6; q++) { const a = q * 1.05, r = u * 18; v.push(deep, () => { ctx.fillStyle = '#ff8a2a'; ctx.fillRect(Math.round(tx + Math.cos(a) * r), Math.round(ty - Math.sin(a) * r * 0.5 - u * 10 + u * u * 20), 2, 2); }); } }
      else if (e.k === 'quake' || e.k === 'roar' || e.k === 'blizzard') {
        // rings rolling out from the boss across the ground, with debris, snow or a dark wave
        v.push(e.x + e.y + 0.4, () => {
          const col = e.k === 'quake' ? '160,110,70' : e.k === 'roar' ? '190,110,255' : '230,245,255';
          for (let r0 = 0; r0 < 3; r0++) { const r = ((u + r0 * 0.25) % 1) * (e.k === 'quake' ? 70 : 120); ctx.strokeStyle = `rgba(${col},${(0.8 * (1 - r / 120)).toFixed(2)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(ox, oy, r, r * 0.45, 0, 0, Math.PI * 2); ctx.stroke(); }
          for (let q = 0; q < 14; q++) { const a = q * 0.45 + (e.k === 'blizzard' ? t * 3 : 0), r = 10 + u * (e.k === 'blizzard' ? 100 : 60); ctx.fillStyle = e.k === 'quake' ? '#8a6a4a' : e.k === 'roar' ? '#c890ff' : '#ffffff'; ctx.fillRect(Math.round(ox + Math.cos(a) * r), Math.round(oy + Math.sin(a) * r * 0.45 - (e.k === 'quake' ? Math.sin(u * Math.PI) * 10 : 0)), 2, 2); }
        });
      } else if (e.k === 'charge') {
        v.push(deep, () => { for (let q = 0; q < 10; q++) { const p = q / 10; if (p > u + 0.2) continue; ctx.fillStyle = `rgba(255,170,90,${(0.7 * (1 - Math.abs(p - u))).toFixed(2)})`; ctx.fillRect(Math.round(ox + (tx - ox) * p), Math.round(oy + (ty - oy) * p - 4), 4, 3); ctx.fillStyle = 'rgba(200,180,140,0.6)'; ctx.fillRect(Math.round(ox + (tx - ox) * p), Math.round(oy + (ty - oy) * p + 2), 3, 2); } });
      } else if (e.k === 'breath') {
        // a widening cone of frost from the jaws
        v.push(deep + 1, () => { for (let q = 0; q < 40; q++) { const p = ((q * 0.137 + t * 1.5) % 1), spread = (q % 7 - 3) / 3 * p * 18; if (p > u * 1.4) continue; const x = ox + e.mx + (tx - ox - e.mx) * p - spread * 0.5, y = oy + e.my + (ty - oy - e.my) * p + spread; ctx.fillStyle = p < 0.4 ? '#ffffff' : 'rgba(170,220,255,0.8)'; ctx.fillRect(Math.round(x), Math.round(y), 2, 2); } });
      } else if (e.k === 'voidbeam') {
        // a beam of void from the jaws to the far end of the line, flickering
        v.push(deep + 1, () => { const w0 = 3 + Math.sin(t * 40) * 1.5; ctx.strokeStyle = 'rgba(160,80,255,0.6)'; ctx.lineWidth = w0 + 4; ctx.beginPath(); ctx.moveTo(ox + e.mx, oy + e.my); ctx.lineTo(tx, ty - 4); ctx.stroke(); ctx.strokeStyle = '#f0d8ff'; ctx.lineWidth = w0; ctx.beginPath(); ctx.moveTo(ox + e.mx, oy + e.my); ctx.lineTo(tx, ty - 4); ctx.stroke(); ctx.lineWidth = 1; });
      }
    }
  }
  // the long fight: a big health bar across the top of the screen for each champion or final boss on the map
  private bigBossBar(s: GameState) {
    const bosses = s.monsters.filter((m) => m.champ);
    if (!bosses.length) return;
    const ctx = this.ctx, W = this.canvas.width, dp = this.dpr;
    bosses.slice(0, 2).forEach((m, i) => {
      const max = Math.max(1, monsterStats(s, m.type, m).maxHp), f = Math.max(0, m.hp / max);
      const w = Math.min(W * 0.6, 640 * dp), h = 10 * dp, x = (W - w) / 2, y = (96 + i * 34) * dp;
      ctx.fillStyle = 'rgba(14,10,28,0.8)'; ctx.fillRect(x - 3 * dp, y - 18 * dp, w + 6 * dp, h + 22 * dp);
      ctx.fillStyle = '#3a1a2a'; ctx.fillRect(x, y, w, h);
      const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, m.champ === 'final' ? '#a040ff' : '#c83020'); g.addColorStop(1, m.champ === 'final' ? '#ff80f0' : '#ffb040');
      ctx.fillStyle = g; ctx.fillRect(x, y, w * f, h);
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x, y, w * f, h / 3);
      ctx.font = `${Math.round(12 * dp)}px "DotGothic16", monospace`; ctx.textAlign = 'left'; ctx.fillStyle = '#fbf6e6';
      ctx.fillText(`${t('champ.' + m.champ)}  Lv.${m.lv}${m.champ === 'final' ? '  ' + t('ui.sharedHp') : ''}`, x, y - 5 * dp);
      ctx.textAlign = 'right'; ctx.fillText(`${Math.ceil(m.hp).toLocaleString()} / ${max.toLocaleString()}`, x + w, y - 5 * dp);
    });
  }
  // the legendary beast walks in a slow golden swirl of motes
  private legendAura(px: number, py: number, time: number) {
    const ctx = this.lctx;
    for (let k = 0; k < 10; k++) { const a = time * 0.9 + (k / 10) * Math.PI * 2, r = 16 + Math.sin(time * 2 + k) * 3; ctx.fillStyle = k % 2 ? 'rgba(255,220,100,0.8)' : 'rgba(255,250,200,0.7)'; ctx.fillRect(Math.round(px + Math.cos(a) * r), Math.round(py - 10 + Math.sin(a) * r * 0.4 - (k % 3) * 6), 1, 2); }
    this.glowAt(px, py - 10, 30);
  }
  private puff(px: number, py: number, f: number, k: number) {
    const ctx = this.lctx, rr = 2 + f * 8;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + k;
      ctx.fillStyle = k ? `rgba(220,214,206,${(0.85 * (1 - f)).toFixed(2)})` : `rgba(200,180,255,${(0.8 * (1 - f)).toFixed(2)})`;
      const sz = k && i % 2 ? 2 : 1;
      ctx.fillRect(Math.round(px + Math.cos(a) * rr), Math.round(py - 5 + Math.sin(a) * rr * 0.6 - f * 4), sz, sz);
    }
    if (k && f < 0.4) { ctx.fillStyle = '#ffd34a'; ctx.fillRect(px - 1, py - 7 - Math.round(f * 10), 1, 1); ctx.fillRect(px + 2, py - 5 - Math.round(f * 8), 1, 1); }
  }
  private looks = new Map<number, Look>();
  private picnicLook(id: number, job = ''): Look {
    let l = this.looks.get(id);
    if (!l) { l = makeLook('civilian', 'warrior', job || 'traveler'); if (!job) l.outfit = id % 2 ? 'yukata' : 'tunic'; this.looks.set(id, l); }
    return l;
  }
  private dissolves: { x: number; y: number; t: number; type: string; facing: number; k: number }[] = [];
  // a fallen monster comes apart in drifting strips of pixels
  private dissolve(sp: Sprite, px: number, py: number, f: number, k: number) {
    const ctx = this.lctx, h = sp.h, w = sp.w;
    for (let r = 0; r < h; r += 2) {
      const n = hash(r, sp.x, 17), a = 1 - f * (1.3 + (n % 10) / 15);
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      const dx = Math.round(((n % 7) - 3) * f * 4), dy = Math.round(-f * (6 + (r / h) * 10));
      ctx.drawImage(sp.img, sp.x, sp.y + r, w, 2, px - sp.ax * k + dx, py - sp.ay * k + r * k + dy, w * k, 2 * k);
    }
    ctx.globalAlpha = 1;
  }
  private monsterHabit(fam: string | undefined, px: number, top: number, w: number, facing: number, time: number, id: number) {
    const ctx = this.lctx, cyc = (time / 7 + id * 0.29) % 1, hx = Math.round(px + facing * w * 0.35);
    if (fam === 'beast' || fam === 'bear') {
      if (cyc < 0.15) for (let k = 1; k <= 2; k++) { const r = k * 3 + Math.floor(cyc * 30) % 3; ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(hx + facing * r, top - 2 - r, 1, 2); ctx.fillRect(hx + facing * (r + 1), top - r, 1, 2); }
    } else if (fam === 'snake') {
      if (Math.sin(time * 5 + id) > 0.6) { ctx.fillStyle = '#d83a3a'; ctx.fillRect(hx + facing * 2, top + 4, 2, 1); ctx.fillRect(hx + facing * 4, top + 3 + (Math.floor(time * 12) % 2), 1, 1); }
    } else if (fam === 'frog') {
      if (Math.sin(time * 4 + id) > 0.5) { ctx.fillStyle = '#e8e0a0'; ctx.fillRect(hx - 1, top + 8, 3, 2); }
    } else if (fam === 'bird') {
      if (cyc > 0.5 && cyc < 0.6) { ctx.fillStyle = '#8a7a5a'; ctx.fillRect(hx + facing * 2, top + 12, 1, 1); }
    } else if (fam === 'mushroom' || fam === 'plant') {
      if (cyc < 0.2) for (let k = 0; k < 3; k++) { const q = (cyc * 5 + k / 3) % 1; ctx.fillStyle = `rgba(220,200,240,${(0.7 * (1 - q)).toFixed(2)})`; ctx.fillRect(Math.round(px - 4 + k * 4), Math.round(top - q * 8), 1, 1); }
    }
  }
  private dizzy(px: number, py: number, time: number) {
    const ctx = this.lctx;
    for (let k = 0; k < 3; k++) {
      const a = time * 4 + (k * Math.PI * 2) / 3;
      ctx.fillStyle = k === 1 ? '#ffffff' : '#ffd34a';
      ctx.fillRect(Math.round(px + Math.cos(a) * 5), Math.round(py + Math.sin(a) * 2), 1, 1);
    }
  }
  private broom(px: number, py: number, time: number) {
    const ctx = this.lctx, sw = Math.sin(time * 6) > 0 ? 1 : -1;
    ctx.fillStyle = '#8a5a32';
    for (let k = 0; k < 6; k++) ctx.fillRect(px + 4 + Math.round(k * 0.5 * sw), py - 8 + k, 1, 1);
    ctx.fillStyle = '#e8c870'; ctx.fillRect(px + 3 + 3 * sw, py - 2, 3, 2);
    if (Math.sin(time * 6 + 1) > 0.6) { ctx.fillStyle = 'rgba(200,180,140,0.6)'; ctx.fillRect(px + 7 + 3 * sw, py - 1, 2, 1); }
  }

  private npcDrawable(s: GameState, n: Npc, px: number, py: number, time: number): Drawable {
    const ctx = this.lctx;
    const moving = n.state === 'walk' || n.state === 'hunt';
    const striking = (n.state === 'fight' && n.cd > CLASSES[n.cls].interval - 0.22) || (n.state === 'gather' && Math.sin(time * 18 + n.goalId) > 0.55);
    // pick a pose: walking cycles four frames; standing folk blink, stretch, sit or cheer now and then
    const camping = n.state === 'wait' && n.goal === 'camp';
    const resting = n.state === 'wait' && n.goal === 'visit';
    const cheering = n.state === 'wait' && n.goal === 'fest';
    let frame: number = FRAME.stand;
    if (striking) frame = FRAME.strike;
    else if (moving) frame = FRAME.walk[Math.floor(time * 8 + n.id) % 4];
    else if (camping || resting) frame = FRAME.sit;
    else if (cheering && Math.sin(time * 5 + n.id) > 0.2) frame = FRAME.up;
    else if ((time * 0.06 + n.id * 0.173) % 1 < 0.02 && n.role !== 'fighter') frame = FRAME.stretch;
    else if ((time * 0.35 + n.id * 0.37) % 1 < 0.05) frame = FRAME.blink;
    // little habits while standing about: a scratch of the head (or wiping sweat in summer), rubbing cold hands, kicking a pebble
    const se0 = season(s), habitCyc = Math.floor(time * 0.18 + n.id * 0.41), habitP = (time * 0.18 + n.id * 0.41) % 1;
    const idle = (n.state === 'wait' || n.state === 'idle') && !camping && !resting && !cheering && !striking;
    const habit = idle && habitP < 0.22 ? ['head', 'kick', se0 === 3 || s.weather === 'snow' ? 'rub' : 'head', '', ''][hashN(habitCyc, n.id) % 5] : '';
    if (habit === 'head') frame = FRAME.head;
    else if (habit === 'rub') frame = FRAME.rub;
    else if (habit === 'kick') frame = habitP < 0.08 ? FRAME.kick : FRAME.stand;
    const sel = this.selected?.kind === 'npc' && this.selected.id === n.id;
    let sp: Sprite;
    if (n.state === 'down') sp = lyingSprite(n.role, n.cls, n.look);
    else sp = humanSprite(n.role, n.cls, this.dress(s, n), frame, n.facing < 0);
    // struck: a white flash and a step back
    const hit = n.role === 'fighter' && this.hurt(n.id, n.hp, time);
    if (hit && n.state !== 'down') sp = flashSprite(sp, `npc:${n.id}:${frame}:${n.facing}`);
    const lunge = n.state === 'fight' && n.cd > 0.8 ? n.facing : hit ? -n.facing * 2 : 0;
    // the fisherman fishes from a little boat just off the bank
    const boat = n.job === 'fisherman' && n.state === 'wait' ? nearWater(Math.floor(n.x), Math.floor(n.y)) : null;
    if (boat) { px = Math.round((px + this.sxF(boat[0] + 0.5, boat[1] + 0.5)) / 2); py = Math.round((py + this.syF(boat[0] + 0.5, boat[1] + 0.5)) / 2) + 2; }
    // the ninja crosses the village in long bounds after dark
    // the ninja crosses the village along the rooftops after dark, bounding from one roof to the next
    if (n.job === 'ninja' && moving && this.lightTod(s) >= 0.72) {
      const roof = s.buildings.find((b) => { const m = BUILDINGS[b.type].size; return n.x > b.x - 0.6 && n.x < b.x + m + 0.6 && n.y > b.y - 0.6 && n.y < b.y + m + 0.6 && BUILDINGS[b.type].kind !== 'decor'; });
      py -= (roof ? Math.round(buildingSprite(roof.type).ay * 0.55) : 0) + Math.round(Math.abs(Math.sin(time * 5 + n.id)) * 7);
    }
    // a little jump on levelling up
    const lv = this.levels.get(n.id);
    if (lv && n.level > lv.lv) lv.t = time;
    if (!lv || n.level !== lv.lv) this.levels.set(n.id, { lv: n.level, t: lv && n.level > lv.lv ? time : lv?.t ?? -9 });
    const since = time - (this.levels.get(n.id)?.t ?? -9);
    const hop = since < 0.5 ? Math.round(Math.sin((since / 0.5) * Math.PI) * 5) : 0;
    const levelShow = since < 1.6 ? since : -1;
    py -= hop;
    // townsfolk idling by day sweep the street in front of them
    const sweeping = n.role === 'civilian' && n.state === 'wait' && n.id % 3 === 0 && tod(s) > 0.1 && tod(s) < 0.65;
    // umbrellas in the rain; in Japanese summers a few carry paper parasols against the sun
    const townsfolk = n.role === 'civilian' || n.role === 'tourist';
    const wet = s.weather === 'rain' || s.weather === 'storm';
    const umbrella = townsfolk && moving && wet ? ['#3a6ab8', '#c83a3a', '#e8b830', '#4a9a5a'][n.id % 4] : townsfolk && culture.lang === 'ja' && season(s) === 1 && s.weather === 'clear' && n.id % 4 === 0 ? '#d84a3a' : null;
    const night = this.lightTod(s) >= 0.75 || this.lightTod(s) < 0.04;
    const carried = n.carry != null ? s.npcs.find((o) => o.id === n.carry) : undefined;
    const fighter = n.role === 'fighter';
    const faded = this.focusFighters && !fighter;
    return {
      depth: n.x + n.y,
      draw: () => {
        if (levelShow >= 0) this.levelBeam(px, py + hop, levelShow, CLASS_COLOR[n.cls] ?? '#ffe680', true);
        if (boat) this.rowboat(px, py, time + n.id);
        else if (fighter && n.state !== 'down') this.ring(px, py, CLASS_COLOR[n.cls]);
        else this.shadow(px, py);
        if (n.job === 'rickshaw' && moving) this.rickshaw(s, px, py, n, time);
        const fx0 = Math.floor(n.x), fy0 = Math.floor(n.y);
        const ride = moving && rides(s.village, n, isRoad(fx0, fy0), villageDist(fx0, fy0) > 0) ? s.village : '';
        if (ride) this.mount(ride, px, py, n.facing, time + n.id, true);
        if (n.job === 'ninja' && moving && this.lightTod(s) >= 0.72) { ctx.globalAlpha = 0.25; draw(ctx, sp, px - n.facing * 6, py + 3); ctx.globalAlpha = 1; }
        if (faded) ctx.globalAlpha = 0.35;
        draw(ctx, sp, px + lunge, py - (ride === 'sun' ? 7 : ride === 'iron' ? 3 : 0));
        if (ride) this.mount(ride, px, py, n.facing, time + n.id, false);
        ctx.globalAlpha = 1;
        if (levelShow >= 0) this.levelBeam(px, py + hop, levelShow, CLASS_COLOR[n.cls] ?? '#ffe680', false);
        if (habit) this.habitFx(habit, habitP, px, py, n.facing, time);
        if (n.state === 'gather') this.workFx(s, n, px, py, time);
        if (n.state === 'wait' && n.goal === 'patrol') this.jobFx(s, n, px, py, time, !!boat);
        if (townsfolk && n.state === 'wait' && n.id % 5 === 0 && season(s) === 0 && s.weather === 'clear' && this.lightTod(s) > 0.1 && this.lightTod(s) < 0.6 && !isRoad(Math.floor(n.x), Math.floor(n.y))) this.kites.push([px + 3, py - 12, n.id]);
        if (carried) {
          const ls = lyingSprite(carried.role, carried.cls, carried.look);
          draw(ctx, ls, px, py - sp.ay + ls.ay - ls.h + 6);
        }
        if (fighter && n.state !== 'down') {
          const by = py - sp.ay - 3;
          this.hpBar(px + 2, by, n.hp / maxHp(s, n), '#4ad06a');
          this.badge(px - 7, by + 1, CLASS_COLOR[n.cls]);
        }
        if (n.state === 'down') this.dizzy(px, py - 10, time + n.id);
        if (striking && n.state === 'fight') this.flourish(s, n, sp, px, py, time);
        if (resting && (time * 0.15 + n.id * 0.3) % 1 < 0.12) drawEmote(ctx, 'food', px, py - sp.ay - 1);
        if (umbrella) this.umbrella(px, py - sp.ay - 1, umbrella);
        if ((n.job === 'watchman' || (n.role === 'fighter' && moving && !inVillage(Math.floor(n.x), Math.floor(n.y)))) && night) { this.handLantern(px + 5, py - 8, time + n.id); this.glowAt(px + 5, py - 7, 14); }
        if (camping && night) this.glowAt(px + 8, py - 2, 18);
        if (sweeping) this.broom(px, py, time + n.id);
        if (n.vip) this.vipMark(px, py - sp.ay - (fighter ? 7 : 3), time);
        if (this.follow === n.id) this.followMark(px, py);
        if (camping) { this.campfire(px + 8, py, time); if (this.lightTod(s) >= 0.75 || this.lightTod(s) < 0.04) this.zzz(px + 2, py - sp.ay + 2, time + n.id); }
        const em = this.emotes.get(n.id);
        if (em && time - em.t < 2.2) drawEmote(ctx, em.k, px, py - sp.ay - (fighter ? 6 : 1));
        if (sel) this.marker(px, py - sp.ay - 6);
      },
      hit: { x: px - 7, y: py - 19, w: 14, h: 20, sel: { kind: 'npc', id: n.id } },
    };
  }

  // a column of light and the class badge circling up through it when an adventurer levels up
  private levelBeam(px: number, py: number, t: number, col: string, behind: boolean) {
    const ctx = this.lctx, a = t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 1.3;
    if (behind) {
      ctx.fillStyle = `rgba(255,245,200,${(0.35 * a).toFixed(2)})`; ctx.fillRect(px - 4, py - 40, 9, 40);
      ctx.fillStyle = `rgba(255,255,255,${(0.45 * a).toFixed(2)})`; ctx.fillRect(px - 1, py - 44, 3, 44);
      return;
    }
    for (let k = 0; k < 3; k++) {
      const ang = t * 7 + (k * Math.PI * 2) / 3, x = Math.round(px + Math.cos(ang) * 7), y = Math.round(py - 6 - t * 18 + Math.sin(ang) * 2);
      if (Math.sin(ang) < 0 && k) continue;
      ctx.fillStyle = col; ctx.fillRect(x - 1, y - 1, 3, 3); ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y - 1, 1, 1);
    }
    for (let k = 0; k < 6; k++) { const p = (t * 1.5 + k / 6) % 1; ctx.fillStyle = `rgba(255,240,150,${(a * (1 - p)).toFixed(2)})`; ctx.fillRect(Math.round(px - 5 + k * 2), Math.round(py - p * 30), 1, 2); }
  }
  // the small effects of idle habits: a bead of sweat, a puff of breath on cold hands, a pebble skittering off
  private habitFx(habit: string, p: number, px: number, py: number, facing: number, time: number) {
    const ctx = this.lctx, f = p / 0.22;
    if (habit === 'head' && this.lastSeason === 1) { ctx.fillStyle = '#9ad8ff'; ctx.fillRect(px - 4 * facing, py - 17 + Math.round(f * 5), 1, 2); }
    else if (habit === 'head' && Math.sin(time * 14) > 0) { ctx.fillStyle = '#f4f0e4'; ctx.fillRect(px + 4 * facing, py - 22, 1, 1); }
    if (habit === 'rub') for (let k = 0; k < 2; k++) { const q = (f * 2 + k * 0.5) % 1; ctx.fillStyle = `rgba(255,255,255,${(0.7 * (1 - q)).toFixed(2)})`; ctx.fillRect(Math.round(px + facing * (2 + q * 3)), Math.round(py - 12 - q * 6), 2, 2); }
    if (habit === 'kick' && f > 0.3) { const q = (f - 0.3) / 0.7; ctx.fillStyle = '#8a8680'; ctx.fillRect(Math.round(px + facing * (4 + q * 16)), Math.round(py - 1 - Math.sin(q * Math.PI) * 6), 2, 1); }
  }
  // chips fly from a felled tree, sparks from a struck rock, leaves from a picked bush
  private workFx(s: GameState, n: Npc, px: number, py: number, time: number) {
    const nd = s.nodes.find((o) => o.id === n.goalId);
    if (!nd || Math.sin(time * 18 + n.goalId) < 0.4) return;
    const ctx = this.lctx, tx = this.sxF(nd.x + 0.5, nd.y + 0.5), ty = this.syF(nd.x + 0.5, nd.y + 0.5) - 6;
    const cols = nd.kind === 'tree' ? ['#d8b878', '#a8743e'] : nd.kind === 'rock' ? ['#fff4a0', '#ffb040'] : ['#5ab04a', '#8ad050'];
    for (let k = 0; k < 4; k++) {
      const p = ((time * 3 + k / 4) % 1), a = k * 1.7 + n.id;
      ctx.fillStyle = cols[k % 2];
      ctx.fillRect(Math.round(tx + Math.cos(a) * p * 9), Math.round(ty - Math.abs(Math.sin(a)) * p * 8 + p * p * 10), nd.kind === 'rock' ? 1 : 2, 1);
    }
    void px; void py;
  }
  // regional trades at work: the fortune teller's table and banner, the performer's fire and spinning plates,
  // the fisherman's line, the geisha's fan
  private jobFx(s: GameState, n: Npc, px: number, py: number, time: number, boat: boolean) {
    const ctx = this.lctx, f = n.facing;
    if (n.job === 'fortuneTeller') {
      ctx.fillStyle = '#6a4426'; ctx.fillRect(px + f * 6 - 4, py - 5, 9, 1); ctx.fillRect(px + f * 6 - 3, py - 4, 1, 4); ctx.fillRect(px + f * 6 + 3, py - 4, 1, 4);
      ctx.fillStyle = '#c83a2a'; ctx.fillRect(px + f * 6 - 4, py - 6, 9, 1);
      ctx.fillStyle = '#5a3a22'; ctx.fillRect(px - f * 6, py - 22, 1, 22);
      ctx.fillStyle = '#f4ecd8'; ctx.fillRect(px - f * 6 + (f > 0 ? -5 : 1), py - 21, 5, 9); ctx.fillStyle = '#2a2a34'; ctx.fillRect(px - f * 6 + (f > 0 ? -4 : 2), py - 19, 3, 1); ctx.fillRect(px - f * 6 + (f > 0 ? -3 : 3), py - 17, 1, 3);
      if (Math.floor(time * 0.5 + n.id) % 4 === 0) { ctx.fillStyle = '#e8c870'; ctx.fillRect(px + f * 4, py - 8 - (Math.floor(time * 6) % 2), 1, 3); }
    }
    if (n.job === 'performer') {
      const act = Math.floor(time / 4 + n.id) % 3, p = (time / 4) % 1;
      if (act === 2) { const a = time * 9; ctx.fillStyle = '#7a4a22'; for (let k = -6; k <= 6; k++) ctx.fillRect(Math.round(px + Math.cos(a) * k), Math.round(py - 14 + Math.sin(a) * k * 0.5), 1, 1); ctx.fillStyle = '#e4ecf6'; ctx.fillRect(Math.round(px + Math.cos(a) * 7), Math.round(py - 14 + Math.sin(a) * 3.5), 2, 1); }
      if (act === 0 && p < 0.35) for (let k = 0; k < 8; k++) { const q = (p / 0.35 + k / 8) % 1; ctx.fillStyle = q < 0.3 ? '#fff4a0' : q < 0.7 ? '#ff9a3a' : 'rgba(200,60,30,0.6)'; ctx.fillRect(Math.round(px + f * (3 + q * 14)), Math.round(py - 14 - Math.sin(q * 3 + k) * 2 - q * 3), 2, 2); }
      if (act === 1) for (let k = 0; k < 2; k++) { const x = px + (k ? 6 : -6), y = py - 22 - k * 2, w = Math.abs(Math.round(Math.cos(time * 9 + k) * 3)); ctx.fillStyle = '#5a3a22'; ctx.fillRect(x, y + 1, 1, 8); ctx.fillStyle = '#f4f0e8'; ctx.fillRect(x - w, y, w * 2 + 1, 1); ctx.fillStyle = '#3a6ab8'; ctx.fillRect(x, y, 1, 1); }
    }
    if (n.job === 'fisherman' && boat) {
      const bob = Math.round(Math.sin(time * 2 + n.id)), lx = px + f * 14, ly = py + 4 + bob;
      ctx.strokeStyle = 'rgba(240,240,240,0.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px + f * 9, py - 15); ctx.quadraticCurveTo(px + f * 14, py - 8, lx, ly); ctx.stroke();
      ctx.fillStyle = '#d83a2a'; ctx.fillRect(lx, ly - 1, 1, 1); ctx.fillStyle = '#f4f0e8'; ctx.fillRect(lx, ly, 1, 1);
      const cyc = (time / 7 + n.id * 0.3) % 1;
      if (cyc > 0.9) { const q = (cyc - 0.9) / 0.1; ctx.fillStyle = '#c8d8e8'; ctx.fillRect(Math.round(lx - f * q * 8), Math.round(ly - Math.sin(q * Math.PI) * 10), 3, 1); }
    }
    if (n.job === 'geisha' && Math.sin(time * 3 + n.id) > 0) { ctx.fillStyle = '#d83a4a'; ctx.fillRect(px + f * 5 - 1, py - 14, 3, 2); ctx.fillStyle = '#e8c040'; ctx.fillRect(px + f * 5, py - 14, 1, 1); }
    void s;
  }
  private rowboat(px: number, py: number, time: number) {
    const ctx = this.lctx, bob = Math.round(Math.sin(time * 2));
    ctx.fillStyle = '#6a4426'; ctx.fillRect(px - 9, py - 1 + bob, 18, 3); ctx.fillStyle = '#8a5a32'; ctx.fillRect(px - 10, py - 2 + bob, 20, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(px - 12, py + 2, 3, 1); ctx.fillRect(px + 10, py + 2, 2, 1);
  }
  // the rickshaw: two big wheels and a hooded seat with a passenger, pulled along behind its runner
  private rickshaw(s: GameState, px: number, py: number, n: Npc, time: number) {
    const ctx = this.lctx, b = -n.facing, cx = px + b * 10, spin = Math.floor(time * 10) % 2;
    ctx.fillStyle = '#5a3a22'; ctx.fillRect(Math.min(px, cx), py - 6, Math.abs(cx - px), 1);
    ctx.fillStyle = '#2a2a34'; for (let k = -3; k <= 3; k++) ctx.fillRect(cx + Math.round(Math.cos(k / 3 + spin) * 1) , py - 4 + k, 1, 1);
    ctx.fillStyle = '#3a2a2a'; ctx.fillRect(cx - 4, py - 4, 1, 4); ctx.fillRect(cx + 3, py - 4, 1, 4); ctx.fillRect(cx - 3, py - 7, 7, 1); ctx.fillRect(cx - 3, py, 7, 1);
    ctx.fillStyle = '#a8302a'; ctx.fillRect(cx - 4, py - 10, 8, 4);
    const passenger = ((n.id * 7 + Math.floor(time / 20)) % 3) !== 0;
    if (passenger) { ctx.fillStyle = ['#3a6ab8', '#c8508a', '#4a9a5a'][n.id % 3]; ctx.fillRect(cx - 2, py - 13, 4, 3); ctx.fillStyle = '#f0d2ae'; ctx.fillRect(cx - 1, py - 16, 3, 3); }
    ctx.fillStyle = '#2a2a34'; ctx.fillRect(cx - 5, py - 17, 10, 2); ctx.fillRect(cx + b * 4, py - 15, 1, 5);
    void s;
  }

  // pixel ellipse under adventurers, coloured by class
  private ring(px: number, py: number, color: string) {
    const ctx = this.lctx;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(px - 4, py, 8, 1);
    ctx.fillStyle = color;
    ctx.fillRect(px - 3, py - 2, 6, 1);
    ctx.fillRect(px - 3, py + 2, 6, 1);
    ctx.fillRect(px - 5, py - 1, 2, 1);
    ctx.fillRect(px + 3, py - 1, 2, 1);
    ctx.fillRect(px - 5, py + 1, 2, 1);
    ctx.fillRect(px + 3, py + 1, 2, 1);
    ctx.fillRect(px - 6, py, 1, 1);
    ctx.fillRect(px + 5, py, 1, 1);
  }

  private heart(px: number, py: number, on: boolean) {
    if (!on) return;
    const ctx = this.lctx;
    ctx.fillStyle = '#ff6a8a';
    ctx.fillRect(px - 2, py, 2, 1); ctx.fillRect(px + 1, py, 2, 1); ctx.fillRect(px - 2, py + 1, 5, 1); ctx.fillRect(px - 1, py + 2, 3, 1); ctx.fillRect(px, py + 3, 1, 1);
  }

  // ribbon from affection Lv.7, a gold bell at Lv.10
  private collar(s: GameState, sp: Sprite, frame: string, flip: boolean, px: number, py: number) {
    if (!hasPerk(s, 'ribbon')) return;
    const [nx0, ny] = catNeck(frame);
    const nx = flip ? sp.w - 1 - nx0 : nx0;
    const x = px - sp.ax + nx, y = py - sp.ay + ny;
    const ctx = this.lctx;
    ctx.fillStyle = '#e03a5a';
    ctx.fillRect(x - 2, y, 5, 1);
    ctx.fillRect(x - 2, y - 1, 1, 3); ctx.fillRect(x + 2, y - 1, 1, 3);
    if (hasPerk(s, 'bell')) { ctx.fillStyle = '#ffd84a'; ctx.fillRect(x, y + 1, 1, 2); }
  }

  // festival pennants strung along the two front eaves of a building
  // blossom and leaf fall from the regional trees in their season
  private leaves(kind: string, se: number, px: number, py: number, time: number, id: number) {
    const fall = LEAF_FALL[kind]?.[se];
    if (!fall) return;
    const [color, n] = fall, ctx = this.lctx;
    for (let i = 0; i < n; i++) {
      const p = (time * 0.35 + i / n + id * 0.137) % 1;
      const x = Math.round(px - 8 + ((id * 7 + i * 5) % 16) + Math.sin(p * 9 + i) * 2 + p * 4);
      const y = Math.round(py - 22 + p * 24);
      ctx.fillStyle = p > 0.85 ? color + '88' : color;
      ctx.fillRect(x, y, Math.sin(p * 14 + i) > 0 ? 2 : 1, 1);
    }
  }

  private bunting(px: number, py: number, n: number, H: number, fest: string, time: number) {
    const ctx = this.lctx;
    const colors = BUNTING[fest] ?? BUNTING.harvest;
    const W = 16 * n;
    const segs: [number, number, number, number][] = [[px - W, py + 8 * n - H, px, py + 16 * n - H], [px, py + 16 * n - H, px + W, py + 8 * n - H]];
    let k = 0;
    for (const [x0, y0, x1, y1] of segs) {
      const steps = Math.floor(Math.abs(x1 - x0));
      for (let i = 1; i < steps; i++) {
        const f = i / steps;
        const x = Math.round(x0 + (x1 - x0) * f), y = Math.round(y0 + (y1 - y0) * f + Math.sin(f * Math.PI) * 4);
        ctx.fillStyle = '#5a4030';
        ctx.fillRect(x, y, 1, 1);
        const lan = LANTERN[culture.lang];
        if (lan) {
          // a string of lanterns instead of pennants: red in China, paper in Japan, lotus colours in Korea
          if (i % 7 !== 3) continue;
          const sw = Math.round(Math.sin(time * 2 + k) * 0.6);
          const body = lan[k++ % lan.length];
          ctx.fillStyle = '#5a4030'; ctx.fillRect(x, y + 1, 1, 1);
          ctx.fillStyle = body; ctx.fillRect(x - 1 + sw, y + 2, 3, 4); ctx.fillRect(x - 2 + sw, y + 3, 5, 2);
          ctx.fillStyle = culture.lang === 'ja' ? '#c83a3a' : '#f2c84a';
          ctx.fillRect(x - 1 + sw, y + 2, 3, 1); ctx.fillRect(x - 1 + sw, y + 5, 3, 1);
          if (culture.lang !== 'ja') ctx.fillRect(x + sw, y + 6, 1, 1);
          continue;
        }
        if (i % 4 !== 2) continue;
        const flap = Math.sin(time * 3 + k) > 0.7 ? 1 : 0;
        ctx.fillStyle = colors[k++ % colors.length];
        ctx.fillRect(x - 1, y + 1, 3, 1);
        ctx.fillRect(x - 1 + flap, y + 2, 2, 1);
        ctx.fillRect(x + flap, y + 3, 1, 1);
      }
    }
  }

  // a new tree, rock or bush rises out of the ground in four steps, fading in with a little dust
  private growing(sp: Sprite, px: number, py: number, age: number, kind: string) {
    const ctx = this.lctx;
    const step = Math.min(3, Math.floor((age / GROW_TIME) * 4));
    const f = (step + 1) / 4;
    const rise = Math.round(sp.h * (1 - f) * (kind === 'tree' ? 0.8 : 0.6));
    ctx.save();
    ctx.beginPath();
    ctx.rect(px - sp.ax - 2, py - sp.ay - 2, sp.w + 4, sp.ay + 2);
    ctx.clip();
    ctx.globalAlpha = 0.35 + 0.65 * f;
    draw(ctx, sp, px, py + rise);
    ctx.restore();
    ctx.fillStyle = kind === 'rock' ? '#b8ab94' : '#c9e88a';
    for (let i = 0; i < 6 - step * 2; i++) {
      const a = (i / 6) * Math.PI * 2 + step;
      ctx.fillRect(Math.round(px + Math.cos(a) * (4 + step * 2)), Math.round(py - 1 + Math.sin(a) * 1.5 - step), 1, 1);
    }
  }

  private zzz(px: number, py: number, time: number) {
    const ctx = this.lctx;
    ctx.fillStyle = '#e8f0ff';
    for (let k = 0; k < 2; k++) {
      const f = (time * 0.5 + k / 2) % 1;
      const x = Math.round(px + f * 5), y = Math.round(py - 2 - f * 8), n = k ? 2 : 3;
      ctx.globalAlpha = 1 - f;
      ctx.fillRect(x, y, n, 1); ctx.fillRect(x + n - 2, y + 1, 1, 1); ctx.fillRect(x, y + 2, n, 1);
    }
    ctx.globalAlpha = 1;
  }

  private vipMark(px: number, py: number, time: number) {
    const ctx = this.lctx;
    const y = Math.round(py - 2 + Math.sin(time * 3) * 1);
    ctx.fillStyle = '#5a3a10';
    ctx.fillRect(px - 2, y - 1, 5, 3); ctx.fillRect(px - 1, y - 2, 3, 5);
    ctx.fillStyle = '#ffd34a';
    ctx.fillRect(px - 1, y, 3, 1); ctx.fillRect(px, y - 1, 1, 3);
  }

  private followMark(px: number, py: number) {
    const ctx = this.lctx;
    ctx.fillStyle = '#ffffff';
    for (const [dx, dy] of [[-6, -1], [6, -1], [-6, 1], [6, 1]]) ctx.fillRect(px + dx - (dx < 0 ? 0 : 1), py + dy, 2, 1);
  }

  private badge(px: number, py: number, color: string) {
    const ctx = this.lctx;
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(px - 1, py - 2, 3, 5);
    ctx.fillRect(px - 2, py - 1, 5, 3);
    ctx.fillStyle = color;
    ctx.fillRect(px, py - 1, 1, 3);
    ctx.fillRect(px - 1, py, 3, 1);
  }

  // a washing line by the house, the clothes stirring in the breeze
  private laundry(px: number, py: number, time: number) {
    const ctx = this.lctx, x0 = px - 15, y0 = py + 3, x1 = px - 5, y1 = py - 2;
    ctx.fillStyle = '#6a4426'; ctx.fillRect(x0, y0 - 8, 1, 9); ctx.fillRect(x1, y1 - 8, 1, 9);
    ctx.fillStyle = '#e8e0d0';
    for (let k = 0; k <= 10; k++) ctx.fillRect(x0 + k, Math.round(y0 - 8 + ((y1 - y0) * k) / 10 + Math.sin((k / 10) * Math.PI)), 1, 1);
    const cloth = ['#e8eef4', '#d86a5a', '#5a8ad8'];
    for (let k = 0; k < 3; k++) {
      const cx = x0 + 2 + k * 3, cy = Math.round(y0 - 7 + ((y1 - y0) * (cx - x0)) / 10 + 1), sway = Math.sin(time * 3 + k) > 0.3 ? 1 : 0;
      ctx.fillStyle = cloth[k]; ctx.fillRect(cx, cy, 2, 3); ctx.fillRect(cx + sway, cy + 3, 2, 1);
    }
  }

  // a little bird on the roof takes off when someone comes near and comes back a while later
  private roofBird(s: GameState, b: { id: number; x: number; y: number }, px: number, py: number, time: number) {
    const ctx = this.lctx, near = s.npcs.some((n) => n.inside == null && Math.abs(n.x - b.x - 1) < 2 && Math.abs(n.y - b.y - 1) < 2);
    let gone = this.birdGone.get(b.id);
    if (near && (gone == null || time - gone > 8)) { gone = time; this.birdGone.set(b.id, time); }
    const f = gone == null ? 9 : time - gone;
    if (f < 1.5) { const x = Math.round(px + f * 30), y = Math.round(py - f * 26), flap = Math.floor(time * 10) % 2; ctx.fillStyle = '#3a3a4a'; ctx.fillRect(x, y, 2, 1); ctx.fillRect(x - 1, y - flap, 1, 1); ctx.fillRect(x + 2, y - flap, 1, 1); return; }
    if (f < 8) return;
    const hopB = Math.sin(time * 2 + b.id) > 0.9 ? 1 : 0;
    ctx.fillStyle = '#5a4a3a'; ctx.fillRect(px, py - 2 - hopB, 2, 2); ctx.fillStyle = '#e8a030'; ctx.fillRect(px + 2, py - 2 - hopB, 1, 1);
  }

  // rows on a farm field: shoots in spring, tall green in summer, gold heads in autumn, bare in winter
  private crops(px: number, py: number, se: number, time: number) {
    if (se === 3) return;
    const ctx = this.lctx, col = se === 0 ? '#8ad050' : se === 1 ? '#3f8a34' : '#e8b830', hgt = se === 0 ? 1 : se === 1 ? 3 : 3;
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
      const x = px - 2 + (c - r) * 4, y = py + 4 + (c + r) * 2, sway = se > 0 && Math.sin(time * 2 + r + c) > 0.6 ? 1 : 0;
      ctx.fillStyle = col; ctx.fillRect(x + sway, y - hgt, 1, hgt);
      if (se === 2) { ctx.fillStyle = '#f2d060'; ctx.fillRect(x + sway, y - hgt - 1, 1, 1); }
    }
  }

  private sunDx = 0;
  private shadow(px: number, py: number) {
    const d = this.sunDx;
    this.lctx.fillStyle = 'rgba(0,0,0,0.25)';
    this.lctx.fillRect(px - 4 + d, py, 8 + Math.abs(d) - (d < 0 ? 0 : 0), 1);
    this.lctx.fillRect(px - 3 + d, py + 1, 6 + Math.abs(d >> 1), 1);
  }

  private hpBar(px: number, py: number, f: number, color: string, w = 14) {
    const ctx = this.lctx;
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(px - w / 2, py, w, 3);
    ctx.fillStyle = color;
    ctx.fillRect(px - w / 2 + 1, py + 1, Math.max(0, Math.round((w - 2) * Math.min(1, f))), 1);
  }

  private sparkle(px: number, top: number, w: number, time: number) {
    const ctx = this.lctx;
    for (let i = 0; i < 3; i++) {
      const p = (time * 1.5 + i / 3) % 1;
      if (p > 0.5) continue;
      const x = Math.round(px - w / 2 + ((i * 37 + Math.floor(time * 1.5)) % Math.max(1, w)));
      const y = Math.round(top + ((i * 11 + Math.floor(time * 1.5) * 5) % 10));
      ctx.fillStyle = '#fff6b0';
      ctx.fillRect(x, y - 1, 1, 3);
      ctx.fillRect(x - 1, y, 3, 1);
    }
  }

  private marker(px: number, py: number) {
    const ctx = this.lctx;
    ctx.fillStyle = '#ffe066';
    ctx.fillRect(px - 2, py - 2, 5, 1);
    ctx.fillRect(px - 1, py - 1, 3, 1);
    ctx.fillRect(px, py, 1, 1);
  }

  private campfire(px: number, py: number, time: number) {
    const ctx = this.lctx;
    ctx.fillStyle = '#6c4a2c';
    ctx.fillRect(px - 3, py, 7, 1);
    const f = Math.floor(time * 8) % 2;
    ctx.fillStyle = '#f08a2a';
    ctx.fillRect(px - 1, py - 3, 3, 3);
    ctx.fillStyle = '#ffe066';
    ctx.fillRect(px - f, py - 4 - f, 1, 2);
  }

  private diamond(px: number, py: number, n: number, color: string) {
    const ctx = this.lctx;
    ctx.fillStyle = color;
    const W = 16 * n;
    for (let i = 0; i < W; i += 2) {
      const h = i >> 1;
      ctx.fillRect(px - i - 1, py + h, 2, 1);
      ctx.fillRect(px + i - 1, py + h, 2, 1);
      ctx.fillRect(px - i - 1, py + 16 * n - h - 1, 2, 1);
      ctx.fillRect(px + i - 1, py + 16 * n - h - 1, 2, 1);
    }
  }

  private drawGhost(s: GameState, sx: (x: number, y: number) => number, sy: (x: number, y: number) => number) {
    const type = this.ghost!;
    const tx = Math.floor(this.hoverTile!.x), ty = Math.floor(this.hoverTile!.y);
    const ctx = this.lctx;
    const px = sx(tx, ty), py = sy(tx, ty);
    if (type === 'clear') {
      const k = terrainAt(tx, ty);
      this.diamond(px, py, 1, k === THICKET || k === BOG || k === ROCK ? '#7dff8a' : '#ff5a5a');
      return;
    }
    if (type === 'road' || type === 'unroad') {
      const ok = inVillage(tx, ty) && (type === 'road' ? !isRoad(tx, ty) && !blocked(s, tx, ty) : isRoad(tx, ty));
      this.diamond(px, py, 1, ok ? (type === 'road' ? '#7dff8a' : '#ffb84a') : '#ff5a5a');
      return;
    }
    const n = BUILDINGS[type].size;
    const pl = placement(s, type, tx, ty, this.ghostRot);
    const sp = buildingSprite(type, (pl ? pl.rot : this.ghostRot) === 1);
    ctx.globalAlpha = 0.7;
    draw(ctx, sp, px, py);
    ctx.globalAlpha = 1;
    this.diamond(px, py, n, pl ? '#7dff8a' : '#ff5a5a');
    if (pl?.door) this.diamond(sx(pl.door.x, pl.door.y), sy(pl.door.x, pl.door.y), 1, '#ffe066');
  }

  private drawFloaters(s: GameState, sx: (x: number, y: number) => number, sy: (x: number, y: number) => number) {
    for (const f of s.fx) {
      if (f.kind === 'score') continue;
      if (f.kind === 'boss') { if (this.bossFx.length < 60) { const [mx, my] = MOUTH[f.m ?? ''] ?? [0, -30]; this.bossFx.push({ k: String(f.v), x: f.x, y: f.y, tx: f.tx ?? f.x, ty: f.ty ?? f.y, t0: this.lastTime, mx: mx * (f.f ?? 1), my }); } continue; }
      if (f.kind === 'emote') { const [id, k] = String(f.v).split(':'); this.emotes.set(Number(id), { k, t: this.lastTime }); continue; }
      if (this.floaters.length > 120) break;
      const text = f.kind === 'coin' ? `+${f.v}G` : f.kind === 'lvl' ? `Lv.${f.v}` : f.kind === 'item' ? `+${f.v}` : f.kind === 'skill' ? t('sk.' + f.v) : String(f.v);
      const color = f.kind === 'coin' ? '#ffd34a' : f.kind === 'lvl' ? '#7dffef' : f.kind === 'item' ? '#b6ff7a' : f.kind === 'skill' ? '#ff9ae8' : '#ffffff';
      this.floaters.push({ x: f.x, y: f.y, text, color, t: 0 });
    }
    s.fx.length = 0;
    const ctx = this.ctx, z = this.cam.zoom;
    const size = Math.round(Math.max(13, 5.5 * z));
    ctx.font = `${size}px "DotGothic16", monospace`;
    ctx.textAlign = 'center';
    ctx.lineWidth = Math.max(2, z / 1.5);
    ctx.strokeStyle = '#1a1424';
    const now = performance.now();
    this.floaters = this.floaters.filter((f) => {
      if (!f.t) f.t = now;
      const age = (now - f.t) / 1000;
      if (age > 1.2) return false;
      const px = sx(f.x, f.y) * z, py = (sy(f.x, f.y) - 20 - age * 14) * z;
      ctx.globalAlpha = Math.min(1, 2 * (1.2 - age));
      ctx.strokeText(f.text, px, py);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, px, py);
      ctx.globalAlpha = 1;
      return true;
    });
  }
}


const GROW_TIME = 1.6;

const hashN = (a: number, b: number) => hash(a, b, 991);
// where each champion's breath, beam or thrown fire leaves its body, from its feet, when it faces right
const MOUTH: Record<string, [number, number]> = { worldEater: [57, -76], frostWyrm: [32, -49], crimsonStag: [32, -50], magmaColossus: [6, -78], serpentQueen: [12, -60], duneDjinn: [18, -66] };
// smooth value noise for soft patch shapes
const softNoise = (x: number, y: number, seed: number) => {
  const gx = Math.floor(x), gy = Math.floor(y), fx = x - gx, fy = y - gy, n = (a: number, b: number) => (hash(a, b, seed) % 1000) / 1000, sm = (t: number) => t * t * (3 - 2 * t);
  const a0 = n(gx, gy) + (n(gx + 1, gy) - n(gx, gy)) * sm(fx), a1 = n(gx, gy + 1) + (n(gx + 1, gy + 1) - n(gx, gy + 1)) * sm(fx);
  return a0 + (a1 - a0) * sm(fy);
};
const o2 = (q: number) => q % 2 === 1;
// houses take the village's own building style: adobe in the desert, stone and steep roofs in the snow, stilts in the
// marsh; elsewhere four looks by id
const houseLook = (b: { type: string; id: number }, g: string) => b.type !== 'house' ? b.type : g === 'sand' || g === 'snow' || g === 'marsh' ? `house_${g}${b.id % 2}` : b.id % 4 ? `house_${b.id % 4}` : 'house';
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
// nothing grows on the volcano's ash summit
const volcanicTop = (s: GameState, x: number, y: number) => x <= 13 && y <= 13 && halfLevel(x, y) >= 6 && !!villageDef(s.village).terrain.volcano;
const hash = (i: number, j: number, k: number) => {
  let h = (i * 374761393 + j * 668265263 + k * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) & 0x7fffffff;
};
const SMALL: Record<string, string[]> = {
  meadow: ['flowers0', 'flowers1', 'flowers2', 'flowers3', 'flowers4', 'flowers0', 'flowers2', 'tuft', 'tuft', 'tuft', 'pebbles', 'mushrooms'],
  rocky: ['pebbles', 'pebbles', 'tuft', 'flowers0', 'flowers1', 'tuft'],
  marsh: ['tuft', 'tuft', 'mushrooms', 'flowers3', 'flowers4', 'pebbles'],
  snow: ['pebbles', 'tuft', 'pebbles', 'flowers3'],
  sand: ['pebbles', 'bones', 'tuft', 'pebbles'],
};
// nearer the village the land looks lived-in; farther out it grows wild and old
function bigPool(g: string, z: number): string[] {
  const base = [['stump', 'fence', 'boulder', 'fern', 'stump', 'fern', 'boulder', 'fence', 'stump', 'sign'], ['log', 'boulder', 'fern', 'stump', 'log'], ['pillar', 'deadTree', 'crystal', 'boulder', 'log', 'deadTree']][z];
  const swap: Record<string, Record<string, string>> = {
    sand: { fern: 'cactus', stump: 'cactus', log: 'bones', fence: 'cactus' },
    marsh: { fern: 'reeds', fence: 'reeds' },
    snow: { fern: 'boulder' },
  };
  return base.map((k) => swap[g]?.[k] ?? k);
}

const BUNTING: Record<string, string[]> = {
  flower: ['#ff9ac0', '#ffffff', '#ffd0e0', '#b8e890'],
  fireworks: ['#ff5a5a', '#4aa8ff', '#ffd34a', '#ffffff'],
  harvest: ['#f08a2a', '#ffd34a', '#7ac850', '#d8502a'],
  lantern: ['#e83a3a', '#ffd34a', '#ffffff', '#e83a3a'],
};

const shinyCache = new Map<string, Sprite>();
const flashCache = new Map<string, Sprite>();
function flashSprite(sp: Sprite, key: string): Sprite {
  let out = flashCache.get(key);
  if (!out) {
    const c = makeCanvas(sp.w, sp.h);
    const cx = c.getContext('2d')!;
    cx.drawImage(sp.img, sp.x, sp.y, sp.w, sp.h, 0, 0, sp.w, sp.h);
    cx.globalCompositeOperation = 'source-atop';
    cx.fillStyle = 'rgba(255,255,255,0.85)';
    cx.fillRect(0, 0, sp.w, sp.h);
    out = { ...sp, img: c, x: 0, y: 0 };
    flashCache.set(key, out);
  }
  return out;
}

function shinySprite(sp: Sprite, key: string): Sprite {
  let out = shinyCache.get(key);
  if (!out) {
    const c = makeCanvas(sp.w, sp.h);
    const cx = c.getContext('2d')!;
    cx.drawImage(sp.img, sp.x, sp.y, sp.w, sp.h, 0, 0, sp.w, sp.h);
    cx.globalCompositeOperation = 'source-atop';
    cx.fillStyle = 'rgba(255,214,90,0.5)';
    cx.fillRect(0, 0, sp.w, sp.h);
    out = { ...sp, img: c, x: 0, y: 0 };
    shinyCache.set(key, out);
  }
  return out;
}

// picks the animation frame for what the cat is doing
function catFrame(c: Cat, time: number): string {
  switch (c.act) {
    case 'walk': case 'follow': return c.path.length ? `walk${Math.floor(time * 8) % 4}` : 'sit0';
    case 'sleep': return `sleep${Math.floor(time * 0.8) % 2}`;
    case 'groom': return `groom${Math.floor(time * 2.5) % 2}`;
    case 'stretch': return 'stretch';
    case 'lie': return 'lie';
    case 'happy': return 'happy';
    default: return time % 4 < 0.15 ? 'blink' : Math.floor(time * 1.2) % 3 === 0 ? 'sit1' : 'sit0';
  }
}

// the snowfield village is white all year, so only greener grounds change with the seasons
function landSeason(s: GameState) {
  const g = villageDef(s.village).ground;
  return g === 'snow' || g === 'sand' ? -1 : season(s);
}
