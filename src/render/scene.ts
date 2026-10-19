import { DAYS_PER_MONTH, DAYS_PER_YEAR, MAP, SOUTH_EXIT, EAST_EXIT } from '../game/constants';
import { culture, villageDef } from '../game/data';
import { season, springFestival, tsuyu } from '../game/events';
import { tod } from '../game/state';
import { WATER, impassable, inMap, inVillage, isBeach, isRoad, isRopeBridge, isSea, lavaList, terrainAt, villageDist } from '../game/world';
import type { GameState } from '../game/types';
import { buildingSprite, draw } from './art';

// scenery that belongs to particular lands and seasons: the coast and its tides, the volcano, the rope bridge
// over the gorge, pools under waterfalls, lotus and frogs, wayside shrines, hydrangeas, kites and birds

export const hash = (i: number, j: number, k: number) => {
  let h = (i * 374761393 + j * 668265263 + k * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) & 0x7fffffff;
};
type XY = (x: number, y: number) => number;
export interface View {
  ctx: CanvasRenderingContext2D; sx: XY; sy: XY; lw: number; lh: number; time: number;
  visible: (px: number, py: number) => boolean; push: (depth: number, fn: () => void) => void;
  glowAt: (px: number, py: number, r: number) => void;
  glow: CanvasRenderingContext2D | null;
}
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const wet = (x: number, y: number) => terrainAt(x, y) === WATER;

// where things stand, worked out once per ground bake
export interface Spots {
  sea: number[]; beach: { i: number; row: number }[]; lava: number[]; ropes: number[]; lotus: number[]; basking: number[];
  wayside: { x: number; y: number; kind: number }[]; hydrangea: { x: number; y: number }[]; seaTorii: number | null; lighthouse: number | null;
}
export function findSpots(): Spots {
  const sea: number[] = [], beach: { i: number; row: number }[] = [], ropes: number[] = [], lotus: number[] = [], basking: number[] = [];
  const wayside: Spots['wayside'] = [], hydrangea: Spots['hydrangea'] = [];
  let seaTorii: number | null = null, best = 1e9;
  for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
    const i = y * MAP + x;
    if (isSea(x, y)) sea.push(i);
    if (isBeach(x, y)) beach.push({ i, row: isSea(x, y - 1) ? 0 : 1 });
    if (isRopeBridge(x, y)) ropes.push(i);
    const k = terrainAt(x, y);
    if (k === WATER && !isSea(x, y) && !isRoad(x, y)) {
      const shore = N4.filter(([dx, dy]) => inMap(x + dx, y + dy) && !wet(x + dx, y + dy)).length;
      if (shore && hash(x, y, 501) % 3 === 0) lotus.push(i);
      // a torii standing out in the water, on the open water nearest the village
      const open = N4.every(([dx, dy]) => wet(x + dx, y + dy));
      const d = villageDist(x, y) + (isSea(x, y) ? -3 : 0);
      if (open && d >= 2 && d < best) { best = d; seaTorii = i; }
    }
    if (!k && !isRoad(x, y) && !inVillage(x, y) && N4.some(([dx, dy]) => wet(x + dx, y + dy) && !isSea(x + dx, y + dy)) && hash(x, y, 503) % 4 === 0) basking.push(i);
    // wayside jizo and stone lanterns along the roads out of the village, and hydrangeas lining them near it
    const onRoadOut = x === SOUTH_EXIT.x || y === EAST_EXIT.y;
    if (onRoadOut && isRoad(x, y) && !inVillage(x, y)) {
      const along = x === SOUTH_EXIT.x ? y : x, side = x === SOUTH_EXIT.x ? [1, 0] : [0, 1];
      for (const sgn of [1, -1]) {
        const wx = x + side[0] * sgn, wy = y + side[1] * sgn;
        if (impassable(wx, wy) || isRoad(wx, wy) || terrainAt(wx, wy)) continue;
        const vd = villageDist(wx, wy);
        if (vd >= 3 && (along + (sgn > 0 ? 0 : 4)) % 8 === 0) wayside.push({ x: wx, y: wy, kind: (along >> 3) % 2 });
        if (vd >= 2 && vd <= 8 && along % 2 === (sgn > 0 ? 0 : 1)) hydrangea.push({ x: wx, y: wy });
      }
    }
  }
  // the lighthouse stands on the beach toward the far end of the coast
  const lighthouse = beach.filter((b) => b.row === 1 && b.i % MAP < MAP - 4).sort((a, b) => (b.i % MAP) - (a.i % MAP))[0]?.i ?? null;
  return { sea, beach, lava: lavaList(), ropes, lotus, basking, wayside, hydrangea, seaTorii, lighthouse };
}

// a course along open water for boats, ducks and floating lanterns: the river's centre line from end to end, or a
// loop around the largest lake; never across land
export interface Route { pts: [number, number][]; loop: boolean; len: number; cum: number[] }
export function waterRoute(s: GameState): Route | null {
  const def = villageDef(s.village).terrain, open = (x: number, y: number) => terrainAt(x, y) === WATER && !isSea(x, y);
  let pts: [number, number][] = [], loop = false;
  if (def.river) {
    let cur: [number, number][] = [];
    const segs: [number, number][][] = [];
    for (let t = 0; t < MAP; t++) {
      const across: number[] = [];
      for (let k = 0; k < MAP; k++) if (def.river.along === 'y' ? open(k, t) : open(t, k)) across.push(k);
      // the main channel: the run of water closest to the river's mean line
      const near = across.filter((k) => Math.abs(k - def.river!.at) < def.river!.w + 4);
      if (!near.length) { if (cur.length) segs.push(cur); cur = []; continue; }
      const c = near.reduce((a, b) => a + b, 0) / near.length + 0.5;
      cur.push(def.river.along === 'y' ? [c, t + 0.5] : [t + 0.5, c]);
    }
    if (cur.length) segs.push(cur);
    pts = segs.sort((a, b) => b.length - a.length)[0] ?? [];
  } else {
    const water: [number, number][] = [];
    for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) if (open(x, y)) water.push([x, y]);
    if (water.length < 6) return null;
    // the lake nearest the village, circled a little inside its shore
    const seed = water.sort((a, b) => villageDist(a[0], a[1]) - villageDist(b[0], b[1]))[0];
    const lake: [number, number][] = [], seen = new Set<number>([seed[1] * MAP + seed[0]]), q = [seed];
    while (q.length) { const [x, y] = q.pop()!; lake.push([x, y]); for (const [dx, dy] of N4) { const i = (y + dy) * MAP + x + dx; if (!seen.has(i) && open(x + dx, y + dy)) { seen.add(i); q.push([x + dx, y + dy]); } } }
    const cx = lake.reduce((a, p) => a + p[0], 0) / lake.length + 0.5, cy = lake.reduce((a, p) => a + p[1], 0) / lake.length + 0.5;
    const r = Math.sqrt(lake.length / Math.PI) * 0.62;
    for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.85]); }
    loop = true;
  }
  if (pts.length < 4) return null;
  // ease the corners
  pts = pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; return [(a[0] + p[0] * 2 + b[0]) / 4, (a[1] + p[1] * 2 + b[1]) / 4] as [number, number]; });
  if (loop) pts.push(pts[0]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, loop, len: cum[cum.length - 1], cum };
}
// a point some distance along the course; open courses are travelled out and back ('bounce') or start over ('wrap')
export function along(r: Route, d: number, mode: 'bounce' | 'wrap' = 'bounce') {
  let u = ((d % (r.loop || mode === 'wrap' ? r.len : 2 * r.len)) + 2 * r.len) % (r.loop || mode === 'wrap' ? r.len : 2 * r.len), dir = 1;
  if (!r.loop && mode === 'bounce' && u > r.len) { u = 2 * r.len - u; dir = -1; }
  let i = 1;
  while (i < r.cum.length - 1 && r.cum[i] < u) i++;
  const f = (u - r.cum[i - 1]) / Math.max(1e-6, r.cum[i] - r.cum[i - 1]), a = r.pts[i - 1], b = r.pts[i];
  // fades in and out at the ends of a wrapping course instead of jumping back
  const edge = !r.loop && mode === 'wrap' ? Math.min(1, u / 2, (r.len - u) / 2) : 1;
  return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, dx: (b[0] - a[0]) * dir, dy: (b[1] - a[1]) * dir, edge };
}

const tileAt = (v: View, i: number) => { const x = i % MAP + 0.5, y = ((i / MAP) | 0) + 0.5; return [v.sx(x, y), v.sy(x, y), x, y] as const; };
const off = (v: View, px: number, py: number) => px < -30 || py < -30 || px > v.lw + 30 || py > v.lh + 30;

// the sea: crests rolling in toward the beach, the tide creeping up and back twice a day, a sail on the horizon
export function seaLife(v: View, s: GameState, sp: Spots) {
  if (!sp.sea.length) return;
  const ctx = v.ctx, tide = 0.5 + 0.5 * Math.sin(tod(s) * Math.PI * 4);
  // the tide: along every sand edge that faces the sea, a line of foam runs parallel to the edge, creeping up over
  // the sand with a thin wash of water behind it, then drawing back past the edge again
  for (const { i } of sp.beach) {
    const x = i % MAP, y = (i / MAP) | 0;
    for (const [dx, dy] of N4) {
      if (!isSea(x + dx, y + dy)) continue;
      const ph = hash(i, dx + 2, dy + 2) % 100 / 100, swash = Math.sin(v.time * 0.8 + ph * 2) * 0.06;
      const reach = -0.38 * tide + 0.12 + swash;
      // a point on the line parallel to this side, 'off' tiles out toward the sea (negative: up the sand)
      const P = (t: number, o: number): [number, number] => {
        const wx = dx ? (dx > 0 ? x + 1 : x) + dx * o : x + t, wy = dy ? (dy > 0 ? y + 1 : y) + dy * o : y + t;
        return [v.sx(wx, wy), v.sy(wx, wy)];
      };
      const [cx, cy] = P(0.5, 0);
      if (off(v, cx, cy)) continue;
      if (reach < 0) {
        const a0 = P(0, 0), a1 = P(1, 0), b1 = P(1, reach), b0 = P(0, reach);
        ctx.fillStyle = 'rgba(110,175,215,0.38)'; ctx.beginPath(); ctx.moveTo(a0[0], a0[1]); ctx.lineTo(a1[0], a1[1]); ctx.lineTo(b1[0], b1[1]); ctx.lineTo(b0[0], b0[1]); ctx.fill();
      }
      for (let k = 0; k <= 16; k++) {
        const t = k / 16, wob = Math.sin(t * 9 + v.time * 2 + ph * 6) * 0.03, [qx, qy] = P(t, reach + wob);
        if ((k + Math.floor(v.time * 4)) % 5 === 4) continue;
        ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(Math.round(qx), Math.round(qy), 2, 1);
        const [rx, ry] = P(t, reach + 0.16 + wob);
        if (k % 2 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(Math.round(rx), Math.round(ry), 1, 1); }
      }
    }
  }
  for (const i of sp.sea) {
    const [px, py] = tileAt(v, i);
    if (off(v, px, py)) continue;
    const h = hash(i, 3, 11), p = (v.time * 0.28 + (h % 100) / 100) % 1;
    if (p > 0.45) continue;
    const a = p < 0.1 ? p / 0.1 : 1 - (p - 0.1) / 0.35;
    ctx.fillStyle = `rgba(240,250,255,${(0.75 * a).toFixed(2)})`;
    const w = 3 + (h % 4);
    ctx.fillRect(Math.round(px - 6 + ((h >> 4) % 9) - p * 6), Math.round(py - 3 + ((h >> 8) % 5) + p * 3), w, 1);
  }
  // a sailing boat crossing along the horizon
  const bx = ((v.time * 0.12) % (MAP + 16)) - 8;
  if (isSea(Math.floor(Math.max(0, Math.min(MAP - 1, bx))), 1)) {
    const px = v.sx(bx, 1.2), py = v.sy(bx, 1.2), bob = Math.round(Math.sin(v.time * 1.5));
    if (!off(v, px, py)) {
      ctx.fillStyle = '#6a4426'; ctx.fillRect(px - 6, py - 1 + bob, 12, 2); ctx.fillRect(px - 5, py + 1 + bob, 10, 1);
      ctx.fillStyle = '#5a3a22'; ctx.fillRect(px, py - 12 + bob, 1, 11);
      ctx.fillStyle = '#f4f0e4'; ctx.fillRect(px + 1, py - 11 + bob, 5, 8); ctx.fillRect(px - 4, py - 9 + bob, 4, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(px - 9, py + 1, 2, 1);
    }
  }
}

// the lighthouse on the shore; after dark its lamp sweeps two beams across the water
export function lighthouse(v: View, s: GameState, sp: Spots) {
  if (sp.lighthouse == null) return;
  const i = sp.lighthouse, x = i % MAP, y = (i / MAP) | 0, px = v.sx(x, y), py = v.sy(x, y);
  if (!v.visible(px, py - 40)) return;
  const spr = buildingSprite('lighthouse'), t = tod(s), dark = t >= 0.7 || t < 0.06;
  v.push(x + y + 1, () => {
    draw(v.ctx, spr, px, py);
    if (!dark || !v.glow) return;
    const g = v.glow, lx = px, ly = py - 27, a = v.time * 0.9;
    for (const side of [0, Math.PI]) {
      const ang = a + side, ex = lx + Math.cos(ang) * 110, ey = ly + Math.sin(ang) * 40;
      const gr = g.createLinearGradient(lx, ly, ex, ey); gr.addColorStop(0, 'rgba(255,240,180,0.55)'); gr.addColorStop(1, 'rgba(255,240,180,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(lx, ly); g.lineTo(ex - Math.sin(ang) * 12, ey + Math.cos(ang) * 7); g.lineTo(ex + Math.sin(ang) * 12, ey - Math.cos(ang) * 7); g.fill();
    }
    v.glowAt(lx, ly, 10);
  });
}

// lava creeps and glows along its channels; the crater smokes and, after dark, lights the mountain
export function volcano(v: View, s: GameState, sp: Spots) {
  if (!villageDef(s.village).terrain.volcano) return;
  const ctx = v.ctx, night = tod(s) >= 0.7 || tod(s) < 0.06;
  for (const i of sp.lava) {
    const [px, py] = tileAt(v, i);
    if (off(v, px, py)) continue;
    for (let k = 0; k < 4; k++) {
      const h = hash(i, k, 21), p = (v.time * 0.35 + (h % 100) / 100) % 1;
      const x = Math.round(px - 9 + (h % 18) + p * 4), y = Math.round(py - 3 + ((h >> 6) % 6) + p * 2);
      ctx.fillStyle = p < 0.5 ? '#ffd860' : '#ff8a2a'; ctx.fillRect(x, y, 2 + (k % 2), 1);
    }
    if (night && hash(i, 9, 3) % 2 === 0) v.glowAt(px, py, 18);
  }
  const cx = v.sx(3.5, 3.5), cy = v.sy(3.5, 3.5) - 4;
  if (off(v, cx, cy)) return;
  v.push(7.2, () => {
    ctx.fillStyle = '#2a2220'; ctx.fillRect(cx - 7, cy - 1, 14, 3); ctx.fillStyle = night ? '#ff7a2a' : '#c8502a'; ctx.fillRect(cx - 5, cy, 10, 1);
    // a column of dark smoke billowing up and leaning off with the wind
    for (let k = 0; k < 10; k++) {
      const p = (v.time * 0.1 + k / 10) % 1, r = 3 + Math.floor(p * 12), x = Math.round(cx + p * 30 + Math.sin(p * 5 + k) * 3), y = Math.round(cy - 6 - p * 70);
      ctx.fillStyle = `rgba(${night ? 60 : 70},${night ? 52 : 64},${night ? 56 : 62},${(0.8 * (1 - p)).toFixed(2)})`;
      ctx.fillRect(x - r, y - (r >> 1), r * 2, r); ctx.fillRect(x - r + 2, y - (r >> 1) - 2, r * 2 - 4, r + 4);
      ctx.fillStyle = `rgba(${night ? 90 : 110},${night ? 80 : 104},${night ? 84 : 100},${(0.5 * (1 - p)).toFixed(2)})`; ctx.fillRect(x - r + 2, y - (r >> 1), r - 1, 2);
    }
    for (let k = 0; k < 3; k++) {
      const p = (v.time * 0.9 + k / 3) % 1;
      if (p > 0.6) continue;
      ctx.fillStyle = '#ffb040'; ctx.fillRect(Math.round(cx + Math.cos(k * 2.2) * p * 10), Math.round(cy - 3 - Math.sin(1 + k) * p * 14 + p * p * 18), 1, 1);
    }
    if (night) v.glowAt(cx, cy, 26);
  });
}

// planks slung on two ropes across the gorge, swaying a little and sagging toward the middle
export function ropeBridges(v: View, sp: Spots) {
  const ctx = v.ctx;
  for (const i of sp.ropes) {
    const x = i % MAP, y = (i / MAP) | 0, alongX = isRoad(x - 1, y) || isRoad(x + 1, y);
    const px = v.sx(x + 0.5, y + 0.5), py = v.sy(x + 0.5, y + 0.5);
    if (!v.visible(px, py)) continue;
    v.push(x + y + 0.9, () => {
      const sway = Math.sin(v.time * 1.3 + x) * 0.8;
      const P = (t: number, side: number) => {
        const ax = alongX ? x + t : x + 0.5 + side * 0.38, ay = alongX ? y + 0.5 + side * 0.38 : y + t;
        return [v.sx(ax, ay) + sway * Math.sin(t * Math.PI), v.sy(ax, ay) + Math.sin(t * Math.PI) * 3] as const;
      };
      for (let k = 0; k <= 8; k++) {
        const [ax, ay] = P(k / 8, -1), [bx, by] = P(k / 8, 1);
        ctx.strokeStyle = k % 2 ? '#8a5a32' : '#a8743e'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(Math.round(ax), Math.round(ay)); ctx.lineTo(Math.round(bx), Math.round(by)); ctx.stroke();
      }
      ctx.lineWidth = 1; ctx.strokeStyle = '#5a3a22';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        for (let k = 0; k <= 8; k++) { const [qx, qy] = P(k / 8, side); if (k) ctx.lineTo(qx, qy - 5); else ctx.moveTo(qx, qy - 6); }
        ctx.stroke();
        for (const t of [0, 1]) { const [qx, qy] = P(t, side); ctx.fillStyle = '#5a3a22'; ctx.fillRect(Math.round(qx), Math.round(qy) - 7, 1, 7); }
      }
    });
  }
}

// a churning pool at the foot of each waterfall, drifting spray, and a small rainbow in the sun
export function fallPools(v: View, s: GameState, falls: { x: number; y: number; drop: number }[]) {
  const ctx = v.ctx, t = tod(s), sunny = s.weather === 'clear' && t > 0.1 && t < 0.3 && hash(s.day, 5, 13) % 4 === 0;
  for (const f of falls) {
    const px = v.sx(f.x + 0.5, f.y + 0.5), py = v.sy(f.x + 0.5, f.y + 0.5) + 8 * f.drop + 6;
    if (off(v, px, py)) continue;
    for (let k = 0; k < 3; k++) {
      const p = (v.time * 0.8 + k / 3) % 1, r = Math.round(3 + p * 9);
      ctx.fillStyle = `rgba(235,248,255,${(0.6 * (1 - p)).toFixed(2)})`;
      ctx.fillRect(px - r, py + Math.round(r * 0.3), r * 2, 1); ctx.fillRect(px - r + 1, py - Math.round(r * 0.3), r * 2 - 2, 1);
    }
    for (let k = 0; k < 5; k++) {
      const p = (v.time * 0.5 + k / 5) % 1;
      ctx.fillStyle = `rgba(240,248,255,${(0.35 * (1 - p)).toFixed(2)})`;
      ctx.fillRect(Math.round(px - 10 + k * 5 + Math.sin(p * 4 + k) * 2), Math.round(py - 2 - p * 14), 3, 3);
    }
    if (sunny) {
      const cols = ['rgba(255,90,90,0.22)', 'rgba(255,200,80,0.22)', 'rgba(120,220,120,0.22)', 'rgba(90,150,255,0.22)', 'rgba(170,110,230,0.22)'];
      cols.forEach((c, k) => { ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(px + 4, py + 2, 12 - k, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); });
    }
  }
}

// lily pads along the shore (lotus in Chinese villages), with frogs that hop off now and then, and turtles basking
export function pondLife(v: View, s: GameState, sp: Spots, frozen: boolean) {
  if (frozen) return;
  const ctx = v.ctx, se = season(s), lotusBloom = culture.lang === 'zh' && se === 1, wither = se === 2, day = tod(s) > 0.06 && tod(s) < 0.7;
  if (se === 3) return;
  for (const i of sp.lotus) {
    const [px, py] = tileAt(v, i);
    if (off(v, px, py)) continue;
    const h = hash(i, 4, 5);
    for (let k = 0; k < 3; k++) {
      const x = px - 8 + ((h >> (k * 4)) % 14), y = py - 3 + ((h >> (k * 3 + 2)) % 6);
      ctx.fillStyle = wither ? '#8a7a3a' : k % 2 ? '#3a8a3a' : '#4aa04a';
      ctx.fillRect(x - 2, y, 5, 2); ctx.fillRect(x - 1, y - 1, 3, 1);
      if (!wither) { ctx.fillStyle = '#2a6a2a'; ctx.fillRect(x, y, 1, 1); }
      if (lotusBloom && k === 1) { ctx.fillStyle = '#f4a0c0'; ctx.fillRect(x, y - 3, 2, 2); ctx.fillStyle = '#fff0f4'; ctx.fillRect(x, y - 4, 1, 1); ctx.fillStyle = '#e8708a'; ctx.fillRect(x + 1, y - 2, 1, 1); }
      if (wither && k === 0) { ctx.fillStyle = '#6a5a2a'; ctx.fillRect(x + 1, y - 5, 1, 5); ctx.fillRect(x, y - 6, 3, 1); }
    }
    // a frog sits on a pad; every so often it leaps off and swims back
    if (day && !wither && h % 3 === 0) {
      const p = (v.time / 6 + (h % 7) / 7) % 1, x = px - 6 + (h % 14), y = py - 4 + ((h >> 3) % 6);
      if (p < 0.85) {
        const puff = Math.sin(v.time * 6 + h) > 0.7;
        ctx.fillStyle = '#5aa83a'; ctx.fillRect(x - 1, y - 2, 3, 2); ctx.fillStyle = '#2a2a2a'; ctx.fillRect(x - 1, y - 3, 1, 1); ctx.fillRect(x + 1, y - 3, 1, 1);
        if (puff) { ctx.fillStyle = '#e8e0a0'; ctx.fillRect(x, y - 1, 2, 1); }
      } else {
        const f = (p - 0.85) / 0.15, jx = Math.round(x + f * 8), jy = Math.round(y - 2 - Math.sin(f * Math.PI) * 6);
        ctx.fillStyle = '#5aa83a'; ctx.fillRect(jx, jy, 3, 1); ctx.fillRect(jx - 1, jy + 1, 1, 1); ctx.fillRect(jx + 3, jy + 1, 1, 1);
      }
    }
  }
  if (!day || se === 2) return;
  for (const i of sp.basking) {
    const [px, py] = tileAt(v, i);
    if (off(v, px, py) || hash(i, 6, 2) % 2) continue;
    const p = (v.time / 9 + (hash(i, 7, 2) % 9) / 9) % 1, x = (i % MAP), y = (i / MAP) | 0;
    const toward = N4.find(([dx, dy]) => wet(x + dx, y + dy))!;
    const slide = p > 0.8 ? (p - 0.8) / 0.2 : 0;
    const tx = Math.round(px + (v.sx(x + toward[0] + 0.5, y + toward[1] + 0.5) - px) * slide * 0.5), ty = Math.round(py + (v.sy(x + toward[0] + 0.5, y + toward[1] + 0.5) - py) * slide * 0.5);
    ctx.fillStyle = '#4a6a3a'; ctx.fillRect(tx - 2, ty - 3, 5, 2); ctx.fillRect(tx - 1, ty - 4, 3, 1);
    ctx.fillStyle = '#8aa05a'; ctx.fillRect(tx - 1, ty - 3, 1, 1); ctx.fillRect(tx + 1, ty - 4, 1, 1);
    ctx.fillStyle = '#7a8a4a'; ctx.fillRect(tx + 3, ty - 2 - (Math.sin(v.time * 0.8 + i) > 0.6 ? 1 : 0), 2, 1);
  }
}

// Japanese roadsides: stone jizo in red bibs (red caps in winter) and stone lanterns; hydrangeas in the rainy season
export function wayside(v: View, s: GameState, sp: Spots) {
  if (culture.lang !== 'ja') return;
  const ctx = v.ctx, winter = season(s) === 3 || villageDef(s.village).ground === 'snow';
  for (const w of sp.wayside) {
    const px = v.sx(w.x + 0.5, w.y + 0.5), py = v.sy(w.x + 0.5, w.y + 0.5);
    if (!v.visible(px, py)) continue;
    if (w.kind === 1) { const lan = buildingSprite('stoneLantern'); v.push(w.x + w.y + 1, () => draw(ctx, lan, px - 16, py - 8)); continue; }
    v.push(w.x + w.y + 1, () => {
      for (const ox of [-3, 3]) {
        ctx.fillStyle = '#8a8680'; ctx.fillRect(px + ox - 2, py - 7, 4, 7); ctx.fillStyle = '#a8a49c'; ctx.fillRect(px + ox - 2, py - 10, 4, 3); ctx.fillRect(px + ox - 1, py - 11, 2, 1);
        ctx.fillStyle = '#d83a3a'; ctx.fillRect(px + ox - 2, py - 7, 4, 2); ctx.fillRect(px + ox - 1, py - 5, 2, 1);
        if (winter) { ctx.fillStyle = '#c82a2a'; ctx.fillRect(px + ox - 2, py - 12, 4, 2); ctx.fillStyle = '#f4f0e8'; ctx.fillRect(px + ox - 1, py - 13, 1, 1); }
        ctx.fillStyle = '#5a5650'; ctx.fillRect(px + ox - 1, py - 9, 1, 1); ctx.fillRect(px + ox + 1, py - 9, 1, 1);
      }
      if (hash(w.x, w.y, Math.floor(s.day / 3)) % 2 === 0) { ctx.fillStyle = '#e88a2a'; ctx.fillRect(px - 1, py - 1, 2, 2); ctx.fillStyle = '#f4f0e8'; ctx.fillRect(px + 1, py - 1, 1, 1); }
    });
  }
  if (!tsuyu(s)) return;
  // the blooms open blue and turn purple as the rains go on
  const f = (s.day % DAYS_PER_MONTH) / (DAYS_PER_MONTH - 1);
  const blue = [100 + f * 70, 130 - f * 40, 230 - f * 30].map(Math.round), lite = blue.map((c) => Math.min(255, c + 50));
  for (const h of sp.hydrangea) {
    const px = v.sx(h.x + 0.5, h.y + 0.5), py = v.sy(h.x + 0.5, h.y + 0.5);
    if (!v.visible(px, py)) continue;
    v.push(h.x + h.y + 0.8, () => {
      ctx.fillStyle = '#3a7a3a'; ctx.fillRect(px - 6, py - 5, 12, 5); ctx.fillStyle = '#2a5a2a'; ctx.fillRect(px - 5, py - 1, 10, 1);
      for (let k = 0; k < 3; k++) {
        const hh = hash(h.x, h.y, k), x = px - 5 + k * 4 + (hh % 2), y = py - 8 + ((hh >> 3) % 2);
        ctx.fillStyle = `rgb(${blue.join(',')})`; ctx.fillRect(x, y, 4, 3); ctx.fillRect(x + 1, y - 1, 2, 1);
        ctx.fillStyle = `rgb(${lite.join(',')})`; ctx.fillRect(x + 1, y, 1, 1); ctx.fillRect(x + 2, y + 1, 1, 1);
      }
    });
  }
}

// a vermilion torii standing out in the water, in Japanese villages with a lake or the sea
export function seaTorii(v: View, sp: Spots) {
  if (culture.lang !== 'ja' || sp.seaTorii == null) return;
  const i = sp.seaTorii, x = i % MAP, y = (i / MAP) | 0, px = v.sx(x, y), py = v.sy(x, y);
  if (!v.visible(px, py)) return;
  const tor = buildingSprite('torii'), ctx = v.ctx;
  v.push(x + y + 1, () => {
    ctx.globalAlpha = 0.3; ctx.save(); ctx.translate(0, py * 2 + 16); ctx.scale(1, -1); draw(ctx, tor, px, py); ctx.restore(); ctx.globalAlpha = 1;
    draw(ctx, tor, px, py);
    const p = (v.time * 0.6) % 1, r = Math.round(4 + p * 8);
    ctx.fillStyle = `rgba(235,248,255,${(0.6 * (1 - p)).toFixed(2)})`; ctx.fillRect(px - r, py + 8, r * 2, 1);
  });
}

// red paper from the firecrackers lies on the streets for a few days after the Spring Festival, slowly swept away
export function firecrackerLitter(v: View, s: GameState) {
  if (culture.lang !== 'zh') return;
  const [m, d] = springFestival(s), end = m * DAYS_PER_MONTH + d + 3, since = (s.day % DAYS_PER_YEAR) - end + (s.time / 20 - Math.floor(s.time / 20));
  if (since < 0 || since >= 3) return;
  const ctx = v.ctx, keep = 1 - since / 3;
  for (const i of s.roads) {
    const x = i % MAP, y = (i / MAP) | 0;
    if (!inVillage(x, y)) continue;
    const h = hash(x, y, 77);
    if (h % 3 !== 0 || (h % 100) / 100 > keep) continue;
    const px = v.sx(x + 0.5, y + 0.5), py = v.sy(x + 0.5, y + 0.5);
    if (off(v, px, py)) continue;
    for (let k = 0; k < 4; k++) {
      const hh = hash(x, y, 80 + k);
      ctx.fillStyle = k % 3 === 2 ? '#e8b830' : k % 2 ? '#b8302a' : '#d83a2a';
      ctx.fillRect(px - 9 + (hh % 18), py - 3 + ((hh >> 5) % 7), 2, 1);
    }
  }
}

// karst ranges beyond the map in Chinese villages: unbroken lines of steep rounded towers in three ranks, each one
// paler with distance. The towers are clothed in clumped tree canopy with a ragged treeline along the ridge, and
// bare rock shows in banded cliffs and fissures. The canopy follows the season: fresh green with blossom in spring,
// deep green in summer, red and gold in autumn, snow on the summits and ledges in winter. Dawn, dusk and night tint
// the whole range, and a little pagoda and a thread of waterfall sit on the nearest towers.
const FOLIAGE: string[][] = [['#a4cc74', '#80ac5c', '#5e8c4a'], ['#6c9c52', '#507e42', '#3a6234'], ['#8e9c52', '#728042', '#56643a'], ['#687a68', '#546658', '#425248']];
const AUTUMN = ['#d8902a', '#c85a2a', '#e8c040', '#b8442a'];
const ROCK = ['#aca89e', '#8e8a80', '#706c66', '#56524e'];
const TINT: Record<string, [number[], number]> = { day: [[255, 255, 255], 0], dusk: [[230, 140, 120], 0.3], night: [[30, 44, 86], 0.68] };
const MIST: Record<string, number[]> = { day: [208, 226, 234], dusk: [236, 196, 180], night: [36, 50, 84] };
const mixRGB = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
const hexRGB = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const vnoise = (x: number, y: number, seed: number) => {
  const gx = Math.floor(x), gy = Math.floor(y), fx = x - gx, fy = y - gy;
  const n = (a: number, b: number) => (hash(a, b, seed) % 1000) / 1000, sm = (t: number) => t * t * (3 - 2 * t);
  const a0 = n(gx, gy) + (n(gx + 1, gy) - n(gx, gy)) * sm(fx), a1 = n(gx, gy + 1) + (n(gx + 1, gy + 1) - n(gx, gy + 1)) * sm(fx);
  return a0 + (a1 - a0) * sm(fy);
};
const rangeCache = new Map<string, HTMLCanvasElement>();
// rank 0 farthest, 2 nearest
// how each end of a range finishes: 'sink' lowers it to nothing at the very end, 'blend' keeps its height but fades it
// out to cross another range
type RangeEnd = 'sink' | 'blend';
const CORNER = 140;
// the far land matches the village's own: green karst towers by meadow and marsh, grey crags beyond the mining
// town, and flat-topped sandstone mesas around the desert
type RangeStyle = 'karst' | 'crag' | 'mesa';
const MESA = ['#c87a44', '#b4683c', '#d8965c', '#a85e38', '#e0a46a'].map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
const CRAG = ['#8a867e', '#6e6a64', '#504c48', '#3e5a3a'].map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
function karstRange(seed: number, W: number, rank: number, se: number, key: string, ends: [RangeEnd, RangeEnd], style: RangeStyle = 'karst'): HTMLCanvasElement {
  const ck = `${key}:${se}:${seed}:${rank}:${ends.join()}:${style}`;
  let c = rangeCache.get(ck);
  if (c) return c;
  if (rangeCache.size > 24) rangeCache.clear();
  const H = [170, 150, 116][rank], step = [26, 20, 15][rank], minH = [46, 38, 26][rank], tall = [[80, 70], [70, 62], [42, 48]][rank];
  const hg = new Float32Array(W).fill(minH), tower = new Int32Array(W).fill(-1);
  const peaks: { cx: number; ph: number }[] = [];
  for (let k = -2, cx = -10; cx < W + 20; k++) {
    const h = hash(k, seed, 31), w = step * (0.75 + (h % 60) / 100), ph = tall[0] + ((h >>> 8) % tall[1]);
    peaks.push({ cx, ph });
    for (let x = Math.max(0, Math.floor(cx - w)); x < Math.min(W, cx + w); x++) {
      const t = Math.abs(x - cx) / w, v = style === 'mesa' ? ph * 0.75 * Math.min(1, (1 - t) * 3.4) : style === 'crag' ? ph * 0.95 * (1 - t ** 1.9) * (0.85 + vnoise(x / 6, 0, seed + 5) * 0.3) : ph * (1 - t ** 3);
      if (v > hg[x]) { hg[x] = v; tower[x] = k; }
    }
    cx += step * (0.7 + ((h >>> 16) % 60) / 100);
  }
  // a ragged treeline: small crowns along every ridge; both ends sink away so a range never stops in a wall
  for (let x = 0; x < W; x++) {
    hg[x] += vnoise(x / 2.2, 0, seed + 7) * 3 - 1;
    const dA = ends[0] === 'sink' ? x : 1e9, dB = ends[1] === 'sink' ? W - 1 - x : 1e9;
    const e = Math.max(0, Math.min(dA, dB)) / 140, k = e >= 1 ? 1 : e * e * (3 - 2 * e);
    hg[x] = hg[x] * k;
  }
  c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!, img = g.createImageData(W, H), d = img.data;
  const fol = FOLIAGE[se].map(hexRGB), rock = ROCK.map(hexRGB), aut = AUTUMN.map(hexRGB), snow = [240, 244, 248], blossom = [[246, 200, 216], [255, 246, 250]];
  const [tint, ta] = TINT[key], mist = style === 'mesa' && key === 'day' ? [232, 212, 178] : MIST[key], fogBase = [0.5, 0.26, 0.04][rank];
  for (let x = 0; x < W; x++) {
    const top = Math.max(0, Math.round(H - hg[x])), slope = (hg[Math.min(W - 1, x + 3)] - hg[Math.max(0, x - 3)]) / 6;
    // light falls from the left: rising ground faces it, falling ground turns away, shaded smoothly in between
    const lit = Math.max(-1, Math.min(1, slope / 1.4));
    for (let y = top; y < H; y++) {
      const depth = y - top;
      const sheer = Math.abs(slope) > 2.4 && depth > 3 && vnoise(x / 5, y / 14, seed + 2) > 0.35;
      const scar = vnoise(x / 7, y / 10, seed + 3) > 0.78 && depth > 6;
      let col: number[];
      if (style === 'mesa') {
        // bands of red and orange sandstone, a pale cap on the flat tops, the odd scrub bush
        const band = Math.floor((y + vnoise(x / 20, 0, seed) * 4) / 3) % 5;
        col = depth < 2 && Math.abs(slope) < 0.5 ? MESA[4] : MESA[band === 4 ? 2 : band];
        col = col.map((v) => v * (lit >= 0 ? 1 + lit * 0.12 : 1 + lit * 0.28));
        if (depth > 3 && Math.abs(slope) < 0.6 && hash(x, y, seed + 13) % 47 === 0) col = [96, 104, 56];
      } else if (style === 'crag') {
        // bare grey rock, cracked across, with dark pines low down and snow on the peaks in winter
        col = lit >= 0 ? mixRGB(CRAG[1], CRAG[0], lit) : mixRGB(CRAG[1], CRAG[2], -lit);
        if ((y + Math.round(vnoise(x / 5, 0, seed) * 3)) % 6 === 0) col = col.map((v) => v * 0.84);
        if (y > H - 40 && vnoise(x / 3, y / 3, seed + 2) > 0.62) col = CRAG[3];
        if (se === 3 && depth < 10 + vnoise(x / 8, 0, seed) * 14) col = lit >= 0 ? snow : [210, 220, 232];
      } else if (sheer || scar) {
        // bare cliff in horizontal bands, lit or shaded with the slope
        col = lit >= 0 ? mixRGB(rock[1], rock[0], lit) : mixRGB(rock[1], rock[2], -lit);
        if ((y + Math.round(vnoise(x / 6, 0, seed) * 3)) % 5 === 0) col = col.map((v) => v * 0.82);
      } else {
        col = lit >= 0 ? mixRGB(fol[1], fol[0], lit) : mixRGB(fol[1], fol[2], -lit);
        // the canopy's crowns: gentle light and shade, never a change of colour
        const n = vnoise(x / 2.6, y / 2.2, seed) - 0.5;
        col = col.map((v) => v * (1 + n * 0.22));
        // autumn colours whole hillsides in a soft wash from gold to red
        if (se === 2) { const w = vnoise(x / 18, y / 14, seed + 9); col = mixRGB(col, mixRGB(aut[2], aut[1], w), 0.5 + vnoise(x / 30, y / 30, seed + 4) * 0.25); }
        if (se === 0 && hash(x, y, seed + 11) % 41 === 0) col = blossom[(x + y) % 2];
      }
      if (depth === 0) col = col.map((v) => v * 0.8);
      // winter: snow mantles each summit and runs down the slopes in smooth tongues, bluer on the shaded side
      if (style === 'karst' && se === 3) {
        const reach = 14 + vnoise(x / 11, 0, seed + 6) * 26 + (Math.abs(slope) < 0.8 ? 10 : 0) - (sheer ? 12 : 0);
        if (depth < reach) col = lit >= 0 ? mixRGB([226, 234, 242], snow, lit) : mixRGB([226, 234, 242], [200, 212, 228], -lit);
        else if (depth < reach + 2 && (x + y) % 2) col = mixRGB(col, [226, 234, 242], 0.6);
      }
      const fog = Math.min(0.92, fogBase + Math.max(0, (y - (H - 36)) / 36) * 0.85);
      const tc = col.map((v, i) => v + (tint[i] - v) * ta);
      const i = (y * W + x) * 4;
      d[i] = tc[0] + (mist[0] - tc[0]) * fog; d[i + 1] = tc[1] + (mist[1] - tc[1]) * fog; d[i + 2] = tc[2] + (mist[2] - tc[2]) * fog;
      // a blended end thins out across the corner so the two ranges dissolve into each other
      // and its misty foot goes first, so no straight lower edge shows across the other range
      const fa = ends[0] === 'blend' ? x / (CORNER * 2) : 1, fb = ends[1] === 'blend' ? (W - 1 - x) / (CORNER * 2) : 1, f = Math.max(0, Math.min(1, fa, fb));
      d[i + 3] = Math.round(255 * (f >= 1 ? 1 : f ** 1.4 * Math.min(1, (H - 1 - y) / 60 + f * 0.3)));
    }
  }
  g.putImageData(img, 0, 0);
  if (rank === 2 && style === 'karst') {
    // a small pagoda on the tallest tower, and a waterfall thread down one cliff
    const top = peaks.filter((p) => p.cx > 30 && p.cx < W - 30).sort((a, b) => b.ph - a.ph)[0];
    if (top) {
      const px = Math.round(top.cx), py = Math.round(H - hg[px]);
      const dk = key === 'night' ? '#1e2434' : '#3a3036', rf = key === 'night' ? '#2a3040' : '#5a4038';
      for (let k = 0; k < 3; k++) { g.fillStyle = rf; g.fillRect(px - 4 + k, py - 3 - k * 3, 9 - k * 2, 1); g.fillStyle = dk; g.fillRect(px - 2 + k, py - 2 - k * 3, 5 - k * 2, 2); }
      g.fillStyle = dk; g.fillRect(px, py - 12, 1, 3);
    }
    const fallX = peaks.length > 6 ? Math.round(peaks[Math.floor(peaks.length / 2)].cx + 6) : -1;
    if (fallX > 0 && fallX < W && se !== 3) {
      const y0 = Math.round(H - hg[fallX]) + 8;
      for (let y = y0; y < H - 16; y++) { g.fillStyle = (y % 4) ? 'rgba(236,246,252,0.85)' : 'rgba(200,226,240,0.8)'; g.fillRect(fallX, y, 1, 1); }
    }
  }
  rangeCache.set(ck, c);
  return c;
}
export function karst(ctx: CanvasRenderingContext2D, ox: number, oy: number, t: number, se: number, ground = 'meadow') {
  const style: RangeStyle = ground === 'sand' ? 'mesa' : ground === 'rocky' ? 'crag' : 'karst';
  if (culture.lang !== 'zh') return;
  const key = t >= 0.74 || t < 0.04 ? 'night' : t < 0.1 || t > 0.62 ? 'dusk' : 'day';
  const len = MAP * 16 + 300;
  let seaL = 0, seaR = 0;
  for (let k = 0; k < MAP; k++) { if (isSea(0, k)) seaL++; if (isSea(k, 0)) seaR++; }
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  const left = seaL < MAP * 0.3, right = seaR < MAP * 0.3;
  for (const [rank, lift] of [[0, -44], [1, -20], [2, 2]] as const) {
    // the left back edge runs from beyond the left corner to beyond the top one, the right edge from beyond the top
    // corner to beyond the right one; where both have a range they cross-fade at the top corner
    if (left) {
      const r = karstRange(11 + rank * 2, len, rank, se, key, ['sink', right ? 'blend' : 'sink'], style);
      ctx.setTransform(1, -0.5, 0, 1, ox - MAP * 16 - 160, oy + MAP * 8 + 80 + lift); ctx.drawImage(r, 0, -r.height + 10);
    }
    if (right) {
      const r = karstRange(17 + rank * 2, len, rank, se, key, [left ? 'blend' : 'sink', 'sink'], style);
      ctx.setTransform(1, 0.5, 0, 1, ox - 140, oy - 70 + lift); ctx.drawImage(r, 0, -r.height + 10);
    }
  }
  ctx.restore();
}

// beyond a sea edge the water runs on to the horizon, paling into haze where it meets the sky
export function horizon(ctx: CanvasRenderingContext2D, ox: number, oy: number, t: number) {
  let seaR = 0;
  for (let k = 0; k < MAP; k++) if (isSea(k, 0)) seaR++;
  if (seaR < MAP * 0.3) return;
  const night = t >= 0.74 || t < 0.04, dusk = !night && (t < 0.1 || t > 0.62);
  const deep = night ? '#1a2a4a' : dusk ? '#4a5a8a' : '#2f6fb0', haze = night ? '#2a3a5e' : dusk ? '#e8b8a0' : '#a8d0ea';
  ctx.save();
  ctx.setTransform(1, 0.5, 0, 1, ox - 40, oy);
  const gr = ctx.createLinearGradient(0, -70, 0, 0); gr.addColorStop(0, haze); gr.addColorStop(0.35, deep); gr.addColorStop(1, deep);
  ctx.fillStyle = gr; ctx.fillRect(0, -70, MAP * 16 + 100, 76);
  ctx.fillStyle = night ? 'rgba(200,210,255,0.25)' : 'rgba(255,255,255,0.35)';
  for (let k = 0; k < 40; k++) { const h = hash(k, 3, 3); ctx.fillRect(h % (MAP * 16), -8 - ((h >>> 10) % 50), 3 + (h % 5), 1); }
  ctx.restore();
}

// birds in the sky: geese in a V on autumn days
export function skyLife(ctx: CanvasRenderingContext2D, s: GameState, w: number, h: number, time: number) {
  const t = tod(s), day = t > 0.08 && t < 0.68, se = season(s), calm = s.weather === 'clear' || s.weather === 'fog';
  if (day && calm && se === 2) {
    const cyc = Math.floor(time / 40), p = (time / 40) % 1;
    if (p < 0.6) {
      const f = p / 0.6, x0 = w + 20 - f * (w + 80), y0 = h * (0.12 + (hash(cyc, 1, 3) % 30) / 100) + f * 20;
      ctx.fillStyle = '#2a2a38';
      for (let k = 0; k < 9; k++) {
        const row = Math.ceil(k / 2), side = k % 2 ? -1 : 1, flap = Math.floor(time * 4 + k) % 2;
        const x = Math.round(x0 + row * 5), y = Math.round(y0 + row * 3 * side);
        ctx.fillRect(x, y, 2, 1); ctx.fillRect(x - 1, y - flap, 1, 1); ctx.fillRect(x + 2, y - flap, 1, 1);
      }
    }
  }
}
// shooting stars on clear summer nights, drawn over the night tint so they stay bright
export function meteors(ctx: CanvasRenderingContext2D, s: GameState, w: number, h: number, time: number) {
  const t = tod(s);
  if (!(t >= 0.76 || t < 0.03) || season(s) !== 1 || s.weather !== 'clear') return;
  const cyc = Math.floor(time / 5), p = (time / 5) % 1;
  if (p > 0.18 || hash(cyc, 3, 5) % 2) return;
  const f = p / 0.18, x0 = (hash(cyc, 1, 5) % 100) / 100 * w, y0 = (hash(cyc, 2, 5) % 30) / 100 * h;
  for (let k = 0; k < 10; k++) {
    ctx.fillStyle = `rgba(255,250,220,${((1 - k / 10) * (1 - f)).toFixed(2)})`;
    ctx.fillRect(Math.round(x0 + f * 60 - k * 2), Math.round(y0 + f * 30 - k), 1, 1);
  }
}
// a rainbow arching over the land once the rain has passed
export function rainbow(ctx: CanvasRenderingContext2D, w: number, h: number, a: number) {
  if (a <= 0) return;
  const cols = ['255,90,90', '255,170,70', '255,230,90', '120,210,110', '90,150,250', '150,110,230'];
  cols.forEach((c, k) => { ctx.strokeStyle = `rgba(${c},${(0.22 * a).toFixed(3)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(w * 0.62, h * 0.95, h * 0.62 - k * 2, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke(); });
}
// a kite on its string above whoever is flying it, rising and dipping with the breeze
export function kite(ctx: CanvasRenderingContext2D, hx: number, hy: number, time: number, id: number) {
  const kx = Math.round(hx + 18 + Math.sin(time * 0.7 + id) * 6), ky = Math.round(hy - 46 + Math.sin(time * 1.1 + id * 2) * 4);
  ctx.strokeStyle = 'rgba(240,240,240,0.7)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(hx, hy); ctx.quadraticCurveTo(hx + 14, hy - 10, kx, ky + 4); ctx.stroke();
  const c = ['#d83a3a', '#3a6ab8', '#e8b830', '#4a9a5a'][id % 4];
  ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(kx, ky - 5); ctx.lineTo(kx + 4, ky); ctx.lineTo(kx, ky + 5); ctx.lineTo(kx - 4, ky); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(kx - 1, ky - 3, 1, 3);
  for (let k = 1; k <= 4; k++) { ctx.fillStyle = k % 2 ? c : '#f4f0e4'; ctx.fillRect(Math.round(kx + Math.sin(time * 3 + k) * k * 0.6), ky + 4 + k * 2, 1, 2); }
}
