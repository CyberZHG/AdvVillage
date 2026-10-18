import { DAY, MAP } from '../game/constants';
import { BUILDINGS, CLASSES, culture, finished, villageDef, type Ground } from '../game/data';
import { maxHp, monsterStats, tod } from '../game/state';
import { BOG, CAVE, ROCK, THICKET, VB, VENT, WATER, isFlowers, isFrozen, blocked, doorOf, elevation, halfLevel, inMap, inVillage, isGate, isRoad, onRing, placement, rampAt, roadState, terrainAt, zoneOf } from '../game/world';
import { t } from '../i18n';
import { drawAtmosphere, drawEmote, drawWeather, nightAlpha } from './atmosphere';
import { drawFlavor } from './flavor';
import { currentBoss, festival, season } from '../game/events';
import type { Cat, GameState, Npc } from '../game/types';
import { hasPerk } from '../game/cat';
import { makeCanvas } from './pixel';
import {
  TILE_H, bankSprite, cliffSprite, fallSprite, rampSprite, spriteNamed, buildingLit, buildingSprite, localTreeSprite, sailSprite, terrainSprite, catNeck, propSprite, seasonal, catSprite, draw, humanSprite, lyingSprite, monsterSprite, nodeSprite, tileSprite, type Sprite, type TileKind,
} from './art';

export type Sel = { kind: 'npc' | 'bld' | 'mon' | 'pet' | 'cat'; id: number } | null;
interface Floater { x: number; y: number; text: string; color: string; t: number }
interface Drawable { depth: number; draw: () => void; hit?: { x: number; y: number; w: number; h: number; sel: Sel } }

const GX = MAP * 16;
export const CLASS_COLOR: Record<string, string> = {
  warrior: '#ff5a4a', knight: '#a8c8ff', archer: '#6ae05a', rogue: '#c07aff',
  mage: '#4aa8ff', cleric: '#fff2a0', lancer: '#ffa040', monk: '#ffd84a',
};

export type Crowd = 'all' | 'lite' | 'min';
// light pools around lamps after dark: [dx, dy from the tile anchor, radius]
const HALO: Record<string, [number, number, number]> = { lamppost: [0, 4, 22], stoneLantern: [0, 7, 14], torii: [0, 8, 10], operaStage: [0, 14, 20], onsen: [12, 14, 16] };

// a white cap along every top edge, for snowy weather and winter
const snowCache = new Map<string, Sprite>();
function snowCap(sp: Sprite, key: string): Sprite {
  let out = snowCache.get(key);
  if (!out) {
    const c = makeCanvas(sp.w, sp.h), cx = c.getContext('2d')!;
    cx.drawImage(sp.img, sp.x, sp.y, sp.w, sp.h, 0, 0, sp.w, sp.h);
    const im = cx.getImageData(0, 0, sp.w, sp.h), d = im.data;
    const a = (x: number, y: number) => (y < 0 ? 0 : d[(y * sp.w + x) * 4 + 3]);
    for (let x = 0; x < sp.w; x++) for (let y = sp.h - 1; y >= 0; y--) {
      const i = (y * sp.w + x) * 4;
      if (!d[i + 3]) continue;
      if (!a(x, y - 1)) { d[i] = 244; d[i + 1] = 248; d[i + 2] = 252; }
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
  private lightTod(s: GameState) { return this.fast ? 0.4 : tod(s); }
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
    const key = `${s.village}:${s.vlv}:${roadState.version}:${se}:${culture.lang}:${isFrozen()}`;
    const road = villageDef(s.village).road;
    if (this.ground && this.groundKey === key) return;
    this.groundKey = key;
    const c = makeCanvas(MAP * 32 + 32, MAP * 16 + TILE_H + LIFT_PAD + 24);
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
        } else if (k === WATER) kind = isFrozen() ? 'ice' : 'water';
        else if (k === VENT) kind = 'vent';
        else if (k === BOG) kind = 'bog';
        else if (inVillage(i, j)) kind = 'village';
        else kind = (['wild0', 'wild1', 'wild2'] as const)[Math.max(0, zoneOf(i, j))];
        const v = ((i * 73856093) ^ (j * 19349663)) >>> 0;
        // raised ground sits higher on the sheet; cliff faces fill the drop to any lower tile in front
        const hl = halfLevel(i, j), L = Math.floor(hl / 2), ty = (i + j) * 8 + LIFT_PAD - L * 8, px = GX + (i - j) * 16;
        const front = Math.min(...[[1, 0], [0, 1], [1, 1]].map(([dx, dy]) => (inMap(i + dx, j + dy) ? Math.floor(halfLevel(i + dx, j + dy) / 2) : L)));
        // where open water drops a level the face is a waterfall instead of rock
        const falls = k === WATER && !isRoad(i, j) && L > front;
        for (let b = 0; b < L - front; b++) draw(ctx, falls ? fallSprite(g, (v + b) % 3) : cliffSprite(g, (v + b) % 3), px, ty + 8 * b);
        if (falls) this.falls.push({ x: i, y: j, drop: L - front });
        if (hl & 1) draw(ctx, seasonal(rampSprite(g, 'w' + Math.max(0, zoneOf(i, j)), rampAt(i, j)), se, false), px, ty);
        else draw(ctx, seasonal(tileSprite(g, kind, v), se, false), px, ty);
        if (kind === 'water' || kind === 'ice') this.shore(ctx, g, se, i, j, v, ty);
      }
    }
    // scenery is derived from the tile position, so it needs no saving and stays put
    this.scenery = [];
    this.walls = [];
    const wm = WALL_MAT[g];
    const bamboo = culture.lang === 'zh' || culture.lang === 'ja';
    this.crags = [];
    this.falls = [];
    this.vents = [];
    this.flutter = [];
    this.waters = [];
    this.bogs = [];
    for (let j = 0; j < MAP; j++) for (let i = 0; i < MAP; i++) {
      const k = terrainAt(i, j), road = isRoad(i, j);
      if (k === WATER && !road) this.waters.push(j * MAP + i);
      if (k === BOG && !road) this.bogs.push(j * MAP + i);
      if ((k === ROCK || k === THICKET || k === CAVE) && !road) this.crags.push({ x: i, y: j, kind: k === ROCK ? 'rock' : k === CAVE ? 'cave' : bamboo ? 'bamboo' : 'thicket', v: hash(i, j, 3) % 3 });
      if (k === VENT) this.vents.push(j * MAP + i);
      // flower meadows: a dense carpet of blooms and a few butterflies over it
      if (isFlowers(i, j) && !road && !k && se !== 3) {
        for (let f = 0; f < 4; f++) {
          const hh = hash(i, j, 50 + f), fx = i + 0.2 + ((hh % 60) / 100), fy = j + 0.2 + (((hh >> 8) % 60) / 100);
          draw(ctx, seasonal(propSprite(`flowers${hh % 5}`, g), se, true), GX + Math.round((fx - fy) * 16), Math.round((fx + fy) * 8 - elevation(fx, fy) * 8) + 1 + LIFT_PAD);
        }
        if (hash(i, j, 77) % 5 === 0) this.flutter.push(j * MAP + i);
      }
      if (onRing(i, j) && !(k === WATER || k === ROCK)) {
        const side = i < VB.min ? 'W' : i > VB.max ? 'E' : j < VB.min ? 'N' : 'S';
        const corner = (i < VB.min || i > VB.max) && (j < VB.min || j > VB.max);
        // the two sides facing the viewer stay low so they never hide the village
        const lo = corner ? i > VB.max && j > VB.max : side === 'S' || side === 'E';
        const axis = side === 'N' || side === 'S' ? 0 : 1;
        this.walls.push({ x: i, y: j, name: corner ? `tower/${wm}/${lo ? 'lo' : 'hi'}` : `${isGate(i, j) ? 'gate' : 'wall'}/${wm}/${axis}/${lo ? 'lo' : 'hi'}` });
        continue;
      }
      const z = zoneOf(i, j);
      if (z < 0 || road || k) continue;
      const h = hash(i, j, s.village.length), r = (h % 1000) / 1000, pick = hash(j, i, 7);
      const ox = ((h >> 10) % 9 - 4) / 18, oy = ((h >> 14) % 9 - 4) / 18;
      if (r < 0.22) {
        const pool = SMALL[g].filter((k) => !(se === 3 && k.startsWith('flowers')));
        const name = pool[pick % pool.length];
        const x = i + 0.5 + ox, y = j + 0.5 + oy;
        draw(ctx, seasonal(propSprite(name, g), se, true), GX + Math.round((x - y) * 16), Math.round((x + y) * 8 - elevation(x, y) * 8) + 1 + LIFT_PAD);
      } else if (r < 0.28) {
        const pool = bigPool(g, z);
        this.scenery.push({ x: i + 0.5 + ox, y: j + 0.5 + oy, tx: i, ty: j, name: pool[pick % pool.length] });
      }
    }
    this.ground = c;
  }

  // land creeps over the edges of open water so shores curve instead of stepping tile by tile
  private shore(ctx: CanvasRenderingContext2D, g: Ground, se: number, i: number, j: number, v: number, ty: number) {
    const wet = (x: number, y: number) => !inMap(x, y) || terrainAt(x, y) === WATER;
    const tag = (x: number, y: number) => (inVillage(x, y) ? 'v' : 'w' + Math.max(0, zoneOf(x, y)));
    const sides: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const at = (d: number, x: number, y: number) => draw(ctx, seasonal(bankSprite(g, tag(x, y), d, v), se, false), GX + (i - j) * 16, ty);
    sides.forEach(([dx, dy], d) => { if (!wet(i + dx, j + dy)) at(d, i + dx, j + dy); });
    corners.forEach(([dx, dy], d) => { if (!wet(i + dx, j + dy) && wet(i + dx, j) && wet(i, j + dy)) at(d + 4, i + dx, j + dy); });
  }

  private scenery: { x: number; y: number; tx: number; ty: number; name: string }[] = [];
  private crags: { x: number; y: number; kind: 'rock' | 'thicket' | 'cave' | 'bamboo'; v: number }[] = [];
  private falls: { x: number; y: number; drop: number }[] = [];
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

  // puddles ripple on the streets in the rain; fish leap from open water now and then; foam laps the shore
  private weatherGround(s: GameState, sx: (x: number, y: number) => number, sy: (x: number, y: number) => number, lw: number, lh: number, time: number) {
    const ctx = this.lctx, wet = s.weather === 'rain' || s.weather === 'storm';
    if (wet) for (const i of s.roads) {
      const x = i % MAP, y = (i / MAP) | 0, hh = hash(x, y, 21);
      if (hh % 3) continue;
      const px = sx(x + 0.5, y + 0.5) + ((hh >> 4) % 9) - 4, py = sy(x + 0.5, y + 0.5) + ((hh >> 8) % 5) - 2;
      if (px < -10 || py < -10 || px > lw + 10 || py > lh + 10) continue;
      ctx.fillStyle = 'rgba(70,100,140,0.45)'; ctx.fillRect(px - 3, py, 7, 2); ctx.fillRect(px - 2, py - 1, 5, 4);
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
    if (s.boatUntil && s.boatUntil > s.time && this.waters.length) {
      const f = 1 - (s.boatUntil - s.time) / DAY, n = this.waters.length, pos = f * (n - 1);
      const a = this.waters[Math.floor(pos)], x = a % MAP + 0.5, y = ((a / MAP) | 0) + 0.5, px = sx(x, y), py = sy(x, y);
      if (visible(px, py)) list.push({ depth: x + y + 0.2, draw: () => {
        ctx.fillStyle = '#6a4426'; ctx.fillRect(px - 9, py - 1, 18, 3); ctx.fillStyle = '#8a5a32'; ctx.fillRect(px - 10, py - 2, 20, 1);
        ctx.fillStyle = '#a8743e'; ctx.fillRect(px - 5, py - 5, 4, 3); ctx.fillRect(px + 1, py - 4, 3, 2);
        ctx.fillStyle = '#5a3a22'; ctx.fillRect(px + 6, py - 14, 1, 13);
        ctx.fillStyle = '#f4ecd8'; ctx.fillRect(px + 1, py - 13, 5, 7); ctx.fillRect(px + 2, py - 6, 4, 1);
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(px - 12 - (Math.floor(time * 4) % 3), py + 1, 2, 1);
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
      list.push({ depth: x + y - 0.4, draw: () => {
        ctx.fillStyle = '#d8b878'; ctx.fillRect(px - 10, py - 1, 20, 3); ctx.fillRect(px - 7, py - 3, 14, 2); ctx.fillRect(px - 3, py - 4, 7, 1);
        ctx.fillStyle = '#e8cc90'; ctx.fillRect(px - 6, py - 3, 6, 1); ctx.fillStyle = '#b8945a'; ctx.fillRect(px - 9, py + 1, 18, 1);
      } });
    }
  }

  // regional festival trimmings in the world: dragon boats, firecrackers and couplets, picnic mats, food stalls, kadomatsu
  private festivalDecor(s: GameState, fest: string | null, list: Drawable[], sx: (x: number, y: number) => number, sy: (x: number, y: number) => number, visible: (px: number, py: number) => boolean, time: number) {
    if (!fest) return;
    const lang = culture.lang, ctx = this.lctx;
    if (lang === 'zh' && fest === 'fireworks' && this.waters.length > 8) {
      for (let k = 0; k < 2; k++) {
        const path = this.waters, n = path.length, pos = (time * 2.2 + k * n * 0.5) % n;
        const a = path[Math.floor(pos)], b = path[(Math.floor(pos) + 1) % n], f = pos - Math.floor(pos);
        const ax = a % MAP, ay = (a / MAP) | 0, bx = b % MAP, by = (b / MAP) | 0;
        const near = Math.abs(ax - bx) + Math.abs(ay - by) <= 2;
        const x = (near ? ax + (bx - ax) * f : ax) + 0.5, y = (near ? ay + (by - ay) * f : ay) + 0.5, px = sx(x, y), py = sy(x, y);
        if (!visible(px, py)) continue;
        list.push({ depth: x + y + 0.2, draw: () => {
          ctx.fillStyle = '#b8302a'; ctx.fillRect(px - 8, py - 1, 16, 2); ctx.fillRect(px - 7, py + 1, 14, 1);
          ctx.fillStyle = '#e8b830'; ctx.fillRect(px - 8, py - 1, 16, 1); ctx.fillRect(px + 8, py - 4, 2, 3); ctx.fillRect(px - 10, py - 2, 2, 2);
          for (let r = 0; r < 4; r++) { ctx.fillStyle = r % 2 ? '#2a3a6a' : '#c83a2a'; ctx.fillRect(px - 6 + r * 4, py - 4 + (Math.floor(time * 6 + r) % 2), 2, 3); }
          ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(px - 9 - (Math.floor(time * 4) % 3), py + 1, 2, 1);
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
  private groundLife(sx: (x: number, y: number) => number, sy: (x: number, y: number) => number, lw: number, lh: number, time: number) {
    const ctx = this.lctx;
    for (const i of isFrozen() ? [] : this.waters) {
      const x = i % MAP, y = (i / MAP) | 0, px = sx(x + 0.5, y + 0.5), py = sy(x + 0.5, y + 0.5);
      if (px < -20 || py < -20 || px > lw + 20 || py > lh + 20) continue;
      const h = hash(x, y, 9), p = (time * 0.45 + (h % 100) / 100) % 1;
      if (p > 0.5) continue;
      const ox = ((h >> 7) % 13) - 6 + Math.round(p * 8), oy = ((h >> 11) % 5) - 2 + Math.round(p * 2);
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

  render(s: GameState, time: number) {
    this.lastTime = time;
    this.followTick(s);
    if (this.emotes.size > 400) this.emotes.clear();
    this.buildGround(s);
    const z = this.cam.zoom;
    const lw = Math.ceil(this.canvas.width / z), lh = Math.ceil(this.canvas.height / z);
    if (this.low.width !== lw || this.low.height !== lh) { this.low.width = lw; this.low.height = lh; }
    const ctx = this.lctx;
    ctx.imageSmoothingEnabled = false;
    this.ox = Math.floor(lw / 2 - this.cam.x);
    this.oy = Math.floor(lh / 2 - this.cam.y);
    const ox = this.ox, oy = this.oy;
    ctx.fillStyle = '#1b2333';
    ctx.fillRect(0, 0, lw, lh);
    ctx.drawImage(this.ground!, ox - GX - 16, oy - LIFT_PAD);

    const sx = (x: number, y: number) => Math.round(ox + (x - y) * 16);
    const sy = (x: number, y: number) => Math.round(oy + (x + y) * 8 - elevation(x, y) * 8);
    const visible = (px: number, py: number) => px > -80 && py > -80 && px < lw + 80 && py < lh + 120;
    const g = villageDef(s.village).ground;
    const landSe = landSeason(s);
    const fest = festival(s);
    const list: Drawable[] = [];
    const blit = (sp: Sprite, px: number, py: number) => draw(ctx, sp, px, py);
    const night = nightAlpha(this.lightTod(s));
    const gctx = night > 0 ? this.glowCtx(lw, lh) : null;
    const snowy = landSe === 3 || s.weather === 'snow' || g === 'snow';
    // shadows lean away from the sun through the day
    const tt = this.lightTod(s);
    this.sunDx = tt > 0.04 && tt < 0.75 ? Math.round((tt - 0.4) * 9) : 0;

    for (const b of s.buildings) {
      const n = BUILDINGS[b.type].size;
      const px = sx(b.x, b.y), py = sy(b.x, b.y);
      if (!visible(px, py)) continue;
      const flip = b.rot === 1;
      const raw = finished(b) ? buildingSprite(b.type, flip) : buildingSprite(`${b.type}/s${b.stage ?? 0}`, flip);
      const sp = snowy ? snowCap(raw, `${b.type}:${flip}`) : raw;
      const sail = b.type === 'windmill' ? sailSprite(Math.floor(time * 2.5 + b.id), flip) : null;
      const lit = gctx ? buildingLit(b.type, flip) : null;
      const laundry = b.type === 'house' && b.id % 2 === 0 && !gctx && s.weather !== 'rain' && s.weather !== 'storm' && s.weather !== 'snow';
      const sel = this.selected?.kind === 'bld' && this.selected.id === b.id;
      list.push({
        depth: b.x + b.y + n,
        draw: () => {
          blit(sp, px, py);
          if (sail) blit(sail, px, py);
          if (laundry) this.laundry(px, py, time + b.id);
          if (fest && n > 1) this.bunting(px, py, n, Math.max(10, Math.min(22, sp.ay - 18)), fest, time + b.id);
          if (sp.fx) for (const f of sp.fx) this.effect(f, px, py, time + b.id * 0.37, flip);
          if (gctx) this.windows(gctx, s, b, sp, sail, lit, px, py, time);
          if (sel) this.diamond(px, py, n, '#ffe066');
        },
      });
      if (this.labels) this.labelQueue.push({ x: px, y: py - sp.ay + 2, text: t('b.' + b.type) + ' ' + b.level });
    }
    this.groundLife(sx, sy, lw, lh, time);
    this.landLife(sx, sy, lw, lh, time);
    this.weatherGround(s, sx, sy, lw, lh, time);
    this.festivalDecor(s, fest, list, sx, sy, visible, time);
    this.villageSights(s, list, sx, sy, visible, time);
    for (const w of this.walls) {
      const px = sx(w.x, w.y), py = sy(w.x, w.y);
      if (!visible(px, py)) continue;
      const sp = snowy ? snowCap(spriteNamed(w.name), w.name) : spriteNamed(w.name);
      list.push({ depth: w.x + w.y + 1, draw: () => blit(sp, px, py) });
    }
    const windNow = s.weather === 'storm' ? 2 : s.weather === 'rain' || s.weather === 'snow' ? 1 : 0;
    for (const c of this.crags) {
      const px = sx(c.x + 0.5, c.y + 0.5), py = sy(c.x + 0.5, c.y + 0.5) + 3;
      if (!visible(px, py)) continue;
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
    const wind = s.weather === 'storm' ? 2 : s.weather === 'rain' || s.weather === 'snow' ? 1 : 0;
    for (const nd of s.nodes) {
      const px = sx(nd.x + 0.5, nd.y + 0.5), py = sy(nd.x + 0.5, nd.y + 0.5) + 2;
      if (!visible(px, py)) continue;
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
    const alive = new Map<number, [number, number]>();
    for (const m of s.monsters) {
      alive.set(m.id, [m.x, m.y]);
      if (!this.lastMon.has(m.id) && this.lastMon.size) this.puffs.push({ x: m.x, y: m.y, t: time, k: 0 });
    }
    for (const [id, [x, y]] of this.lastMon) if (!alive.has(id)) this.puffs.push({ x, y, t: time, k: 1 });
    this.lastMon = alive;
    this.puffs = this.puffs.filter((p) => time - p.t < 0.6);
    for (const p of this.puffs) {
      const px = sx(p.x, p.y), py = sy(p.x, p.y);
      if (!visible(px, py)) continue;
      list.push({ depth: p.x + p.y + 0.5, draw: () => this.puff(px, py, (time - p.t) / 0.6, p.k) });
    }
    for (const m of s.monsters) {
      const px = sx(m.x, m.y), py = sy(m.x, m.y);
      if (!visible(px, py)) continue;
      const frame = Math.floor(time * 3 + m.id) % 2;
      const base = monsterSprite(m.type, frame, m.facing < 0);
      const hurt = this.hurt(m.id, m.hp, time);
      const sp = hurt ? flashSprite(base, `${m.type}:${frame}:${m.facing}`) : m.shiny ? shinySprite(base, `${m.type}:${frame}:${m.facing}`) : base;
      const k = m.boss != null ? 2 : 1;
      const sel = this.selected?.kind === 'mon' && this.selected.id === m.id;
      const top = py - sp.ay * k;
      list.push({
        depth: m.x + m.y,
        draw: () => {
          if (k > 1) this.ring(px, py, '#ff4a3a');
          else this.shadow(px, py);
          // newcomers shimmer into view in a few steps
          if (m.born != null && s.time - m.born < 1) ctx.globalAlpha = 0.25 + 0.25 * Math.floor((s.time - m.born) * 4);
          ctx.drawImage(sp.img, sp.x, sp.y, sp.w, sp.h, px - sp.ax * k + (hurt ? -m.facing : 0), top, sp.w * k, sp.h * k);
          ctx.globalAlpha = 1;
          if (m.shiny) this.sparkle(px, top, sp.w * k, time + m.id);
          const maxHp = Math.max(1, monsterStats(s, m.type, m).maxHp);
          if (k > 1) {
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
            this.shadow(px, py);
            blit(sp, px, py);
            this.collar(s, sp, fr, c.facing < 0, px, py);
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
      if (n.inside != null || n.state === 'away' || n.state === 'carried') continue;
      if (this.hidden(n)) continue;
      const [lx, ly] = this.lane(n, sx, sy);
      const px = sx(n.x, n.y) + lx, py = sy(n.x, n.y) + ly;
      if (!visible(px, py)) continue;
      list.push(this.npcDrawable(s, n, px, py, time));
    }
    list.sort((a, b) => a.depth - b.depth);
    this.hits = [];
    for (const d of list) {
      d.draw();
      if (d.hit) this.hits.push(d.hit);
    }
    if (this.hoverTile && this.ghost) this.drawGhost(s, sx, sy);

    // weather changes cross-fade over a few seconds
    if (s.weather !== this.wNow) { this.wAt = this.wNow == null ? -9 : time; this.wPrev = this.wNow ?? s.weather; this.wNow = s.weather; }
    const mix = Math.min(1, (time - this.wAt) / 4);
    drawAtmosphere(ctx, s, lw, lh, time, this.lightTod(s), sx, sy, s.weather, mix);
    if (mix < 1 && this.wPrev !== s.weather) drawWeather(ctx, s, this.wPrev, lw, lh, time, 1 - mix);
    drawFlavor(ctx, s, lw, lh, time, this.lightTod(s));
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
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.low, 0, 0, lw * z, lh * z);
    this.drawFloaters(s, sx, sy);
    this.drawLabels();
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
  }

  // building effect points: [dx, dy] smoke, or [dx, dy, kind, value] for flags, fountain spray and water glints
  private effect(f: number[], px: number, py: number, time: number, flip: boolean) {
    const [dx, dy, k = 0, v = 0] = f;
    const x = px + dx, y = py + dy, ctx = this.lctx;
    if (k === 0) return this.smoke(x, y, time);
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
    if (this.crowd === 'all' || n.role === 'fighter' || n.role === 'gatherer' || n.vip) return false;
    if (this.follow === n.id || (this.selected?.kind === 'npc' && this.selected.id === n.id)) return false;
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

  private smoke(px: number, py: number, time: number) {
    const ctx = this.lctx;
    for (let k = 0; k < 3; k++) {
      const f = (time * 0.35 + k / 3) % 1;
      const r = 1 + Math.floor(f * 2.5);
      ctx.fillStyle = `rgba(225,225,230,${0.75 * (1 - f)})`;
      ctx.fillRect(Math.round(px + f * 5 + Math.sin(f * 6 + k) - r / 2), Math.round(py - 2 - f * 16), r, r);
    }
  }

  // in Chinese and Japanese villages some visitors wear hanfu or yukata, and more townsfolk dress up for festivals
  private dress(s: GameState, n: Npc) {
    const robe = culture.lang === 'zh' ? 'hanfu' : culture.lang === 'ja' ? 'yukata' : null;
    if (!robe || n.role === 'fighter' || n.role === 'gatherer') return n.look;
    const fest = festival(s) != null;
    const wears = n.role === 'tourist' ? (fest ? n.id % 3 !== 2 : n.id % 3 === 0) : fest && n.id % 2 === 0;
    return wears ? { ...n.look, outfit: robe } : n.look;
  }

  private levels = new Map<number, { lv: number; t: number }>();
  private lastMon = new Map<number, [number, number]>();
  private puffs: { x: number; y: number; t: number; k: number }[] = [];
  private bossSeen: number | null = null;
  private bossAt = -9;
  // k 0: a shimmer of arrival, k 1: smoke and sparks as one falls
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
    const frame = striking ? 2 : moving ? Math.floor(time * 6 + n.id) % 2 : 0;
    const sel = this.selected?.kind === 'npc' && this.selected.id === n.id;
    let sp: Sprite;
    if (n.state === 'down') sp = lyingSprite(n.role, n.cls, n.look);
    else sp = humanSprite(n.role, n.cls, this.dress(s, n), frame, n.facing < 0);
    const lunge = n.state === 'fight' && n.cd > 0.8 ? n.facing : 0;
    // a little jump on levelling up
    const lv = this.levels.get(n.id);
    if (lv && n.level > lv.lv) lv.t = time;
    if (!lv || n.level !== lv.lv) this.levels.set(n.id, { lv: n.level, t: lv && n.level > lv.lv ? time : lv?.t ?? -9 });
    const since = time - (this.levels.get(n.id)?.t ?? -9);
    const hop = since < 0.5 ? Math.round(Math.sin((since / 0.5) * Math.PI) * 5) : 0;
    py -= hop;
    // townsfolk idling by day sweep the street in front of them
    const sweeping = n.role === 'civilian' && n.state === 'wait' && n.id % 3 === 0 && tod(s) > 0.1 && tod(s) < 0.65;
    const carried = n.carry != null ? s.npcs.find((o) => o.id === n.carry) : undefined;
    const fighter = n.role === 'fighter';
    const faded = this.focusFighters && !fighter;
    return {
      depth: n.x + n.y,
      draw: () => {
        if (fighter && n.state !== 'down') this.ring(px, py, CLASS_COLOR[n.cls]);
        else this.shadow(px, py);
        if (faded) ctx.globalAlpha = 0.35;
        draw(ctx, sp, px + lunge, py);
        ctx.globalAlpha = 1;
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
        if (sweeping) this.broom(px, py, time + n.id);
        if (n.vip) this.vipMark(px, py - sp.ay - (fighter ? 7 : 3), time);
        if (this.follow === n.id) this.followMark(px, py);
        if (n.state === 'wait' && n.goal === 'camp') this.campfire(px + 8, py, time);
        const em = this.emotes.get(n.id);
        if (em && time - em.t < 2.2) drawEmote(ctx, em.k, px, py - sp.ay - (fighter ? 6 : 1));
        if (sel) this.marker(px, py - sp.ay - 6);
      },
      hit: { x: px - 7, y: py - 19, w: 14, h: 20, sel: { kind: 'npc', id: n.id } },
    };
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
      if (f.kind === 'emote') { const [id, k] = String(f.v).split(':'); this.emotes.set(Number(id), { k, t: this.lastTime }); continue; }
      if (this.floaters.length > 120) break;
      const text = f.kind === 'coin' ? `+${f.v}G` : f.kind === 'lvl' ? 'LV UP' : f.kind === 'item' ? `+${f.v}` : f.kind === 'skill' ? t('sk.' + f.v) : String(f.v);
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

const hash = (i: number, j: number, k: number) => {
  let h = (i * 374761393 + j * 668265263 + k * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
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
