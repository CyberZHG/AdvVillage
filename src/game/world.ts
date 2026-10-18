import { MAP, V_BASE_MAX, V_BASE_MIN, SOUTH_EXIT, EAST_EXIT } from './constants';
import { BUILDINGS, villageDef } from './data';
import type { Building, GameState, P, Terrain } from './types';

// village bounds depend on expansion level; one active game at a time, synced on load/expand
export const VB = { min: V_BASE_MIN, max: V_BASE_MAX };
export function syncBounds(s: GameState) {
  VB.min = V_BASE_MIN - 2 * (s.vlv ?? 0);
  VB.max = V_BASE_MAX + 2 * (s.vlv ?? 0);
  grid = null;
  ter.fill(0);
  const tr = s.terrain;
  if (tr) for (const [k, list] of [[WATER, tr.water], [ROCK, tr.rock], [BOG, tr.bog], [THICKET, tr.thicket], [VENT, tr.vent ?? []], [CAVE, tr.cave ?? []]] as const) for (const i of list) ter[i] = k;
  flowerSet = new Set(tr?.flowers ?? []);
  if (heightKey !== s.village) { heightKey = s.village; makeHeights(); }
  syncRoads(s);
}

// ---------- elevation ----------
// heights are in half levels: even values are flat ground, odd values are ramps between two levels.
// The village and its widest bounds, the banks of water and the roads out stay at level 0. Ground that sits
// in front of the village on screen only ever dips, so hills never hide the village behind them.
const FLAT_MIN = 15, FLAT_MAX = 48;
const hgt = new Int8Array(MAP * MAP);
const rampDir = new Int8Array(MAP * MAP);
let heightKey = '';
export const RAMP_DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const halfLevel = (x: number, y: number) => (inMap(x, y) ? hgt[y * MAP + x] : 0);
export const rampAt = (x: number, y: number) => (inMap(x, y) && hgt[y * MAP + x] & 1 ? rampDir[y * MAP + x] : -1);
// one can walk between tiles less than a level apart; flat tiles a level apart are a cliff
export const canStep = (ax: number, ay: number, bx: number, by: number) => Math.abs(halfLevel(ax, ay) - halfLevel(bx, by)) <= 1;

// height of the ground in levels at a point, sliding up a ramp toward its high side
export function elevation(x: number, y: number): number {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (!inMap(tx, ty)) return 0;
  const h = hgt[ty * MAP + tx];
  if (!(h & 1)) return h / 2;
  const fx = x - tx, fy = y - ty, d = rampDir[ty * MAP + tx];
  const f = d === 0 ? fx : d === 1 ? 1 - fx : d === 2 ? fy : 1 - fy;
  return (h - 1) / 2 + f;
}

function smoothNoise(x: number, y: number, cell: number, seed: number) {
  const gx = Math.floor(x / cell), gy = Math.floor(y / cell), fx = x / cell - gx, fy = y / cell - gy;
  const n = (a: number, b: number) => { const v = Math.sin(a * 127.1 + b * 311.7 + seed * 74.7) * 43758.5453; return v - Math.floor(v); };
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = n(gx, gy) + (n(gx + 1, gy) - n(gx, gy)) * s(fx), b = n(gx, gy + 1) + (n(gx + 1, gy + 1) - n(gx, gy + 1)) * s(fx);
  return a + (b - a) * s(fy);
}

function makeHeights() {
  const seed = heightKey.length * 13 + heightKey.charCodeAt(0);
  const lvl = new Int8Array(MAP * MAP);
  // distance to ground that must stay level, so hills rise gradually away from it
  const fixed = new Uint8Array(MAP * MAP);
  for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
    const i = y * MAP + x;
    const flat = (x >= FLAT_MIN && x <= FLAT_MAX && y >= FLAT_MIN && y <= FLAT_MAX) || x === SOUTH_EXIT.x || y === EAST_EXIT.y;
    if (flat) fixed[i] = 1;
  }
  for (let i = 0; i < MAP * MAP; i++) if (ter[i] === WATER) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = (i % MAP) + dx, y = ((i / MAP) | 0) + dy;
    if (inMap(x, y)) fixed[y * MAP + x] = 1;
  }
  const dist = new Float32Array(MAP * MAP).fill(99);
  for (let i = 0; i < MAP * MAP; i++) if (fixed[i]) dist[i] = 0;
  for (let pass = 0; pass < 2; pass++) for (let k = 0; k < MAP * MAP; k++) {
    const i = pass ? MAP * MAP - 1 - k : k, x = i % MAP, y = (i / MAP) | 0;
    for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy; if (inMap(nx, ny)) dist[i] = Math.min(dist[i], dist[ny * MAP + nx] + 1); }
  }
  for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
    const i = y * MAP + x;
    const f = smoothNoise(x, y, 11, seed) * 0.7 + smoothNoise(x, y, 5, seed + 3) * 0.3;
    let L = Math.round((f - 0.38) * 5);
    // in front of the village (lower on screen, overlapping its columns) the land may only dip
    const front = x + y > 66 && Math.abs(x - y) < 34;
    L = front ? Math.min(0, -Math.abs(L)) : Math.max(0, L);
    const cap = Math.floor(dist[i] / 3);
    lvl[i] = Math.max(-Math.min(2, cap), Math.min(Math.min(2, cap), L));
  }
  // neighbours never differ by more than a level
  for (let it = 0; it < 4; it++) for (let i = 0; i < MAP * MAP; i++) {
    const x = i % MAP, y = (i / MAP) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!inMap(nx, ny)) continue;
      const o = lvl[ny * MAP + nx];
      if (lvl[i] > o + 1) lvl[i] = o + 1;
      if (lvl[i] < o - 1) lvl[i] = o - 1;
    }
  }
  // a river leaving the level ground climbs onto the hills behind or drops into the hollows in front,
  // spilling over a waterfall where the level changes; lakes stay level
  const def = villageDef(heightKey).terrain;
  if (def.river) {
    const lake = (x: number, y: number) => (def.lakes ?? []).some(([cx, cy, rx, ry]) => ((x - cx) / (rx + 2)) ** 2 + ((y - cy) / (ry + 2)) ** 2 < 1);
    const want = new Int8Array(MAP * MAP).fill(99);
    for (let i = 0; i < MAP * MAP; i++) {
      const x = i % MAP, y = (i / MAP) | 0;
      if (ter[i] !== WATER || lake(x, y)) continue;
      const out = Math.max(FLAT_MIN - x, x - FLAT_MAX, FLAT_MIN - y, y - FLAT_MAX);
      if (out < 3) continue;
      // upstream behind the village sits a level up, downstream in front a level down, so the river only ever falls
      const L = x + y > 63 ? -1 : 1;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (inMap(x + dx, y + dy)) want[(y + dy) * MAP + x + dx] = L;
    }
    for (let i = 0; i < MAP * MAP; i++) if (want[i] !== 99) lvl[i] = want[i];
    for (let it = 0; it < 3; it++) for (let i = 0; i < MAP * MAP; i++) {
      if (want[i] !== 99) continue;
      const x = i % MAP, y = (i / MAP) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!inMap(nx, ny)) continue;
        const o = lvl[ny * MAP + nx];
        if (lvl[i] > o + 1) lvl[i] = o + 1;
        if (lvl[i] < o - 1) lvl[i] = o - 1;
      }
    }
  }
  for (let i = 0; i < MAP * MAP; i++) { hgt[i] = lvl[i] * 2; rampDir[i] = -1; }
  // ramps: a low tile at the foot of a cliff turns into a slope, every few tiles along each cliff
  for (let y = 1; y < MAP - 1; y++) for (let x = 1; x < MAP - 1; x++) {
    const i = y * MAP + x, L = lvl[i];
    if (ter[i] === WATER || ter[i] === ROCK) continue;
    for (let d = 0; d < 4; d++) {
      const [dx, dy] = RAMP_DIRS[d];
      if (lvl[(y + dy) * MAP + x + dx] !== L + 1 || lvl[(y - dy) * MAP + x - dx] !== L) continue;
      if (((x * 7 + y * 13 + seed) % 5) !== 0) continue;
      let near = false;
      for (let j = -2; j <= 2; j++) for (let k = -2; k <= 2; k++) if (inMap(x + k, y + j) && hgt[(y + j) * MAP + x + k] & 1) near = true;
      if (near) continue;
      hgt[i] = L * 2 + 1; rampDir[i] = d;
      break;
    }
  }
}

// ---------- walls ----------
// a wall rings the village one tile outside its bounds; gates stand where roads leave and at the middle of each side
export const onRing = (x: number, y: number) => villageDist(x, y) === 1 && !(x < VB.min - 1 || x > VB.max + 1 || y < VB.min - 1 || y > VB.max + 1);
export const isGate = (x: number, y: number) => onRing(x, y) && (isRoad(x, y) || x === 32 || y === 32);
export const isWall = (x: number, y: number) => onRing(x, y) && !isGate(x, y) && ter[y * MAP + x] !== WATER && ter[y * MAP + x] !== ROCK;

// ---------- terrain ----------
// water and rock block walking; nothing can be built on any terrain. Roads may cross bog and thicket
// (boardwalks, cleared trails) and narrow water (bridges); a lake is too wide to span.
export const WATER = 1, ROCK = 2, BOG = 3, THICKET = 4, VENT = 5, CAVE = 6;
let flowerSet = new Set<number>();
export const isFlowers = (x: number, y: number) => flowerSet.has(y * MAP + x);
const ter = new Uint8Array(MAP * MAP);
export const terrainAt = (x: number, y: number) => (inMap(x, y) ? ter[y * MAP + x] : 0);
export const isWater = (x: number, y: number) => terrainAt(x, y) === WATER;
export const isBridge = (x: number, y: number) => isWater(x, y) && isRoad(x, y);
export const slowAt = (x: number, y: number) => { const k = terrainAt(x, y); return (k === BOG || k === THICKET) && !isRoad(x, y); };
const solidAt = (k: number) => k === ROCK || k === VENT || k === CAVE;
export const BRIDGE_MAX = 4;
const NEAR_KIND: Record<string, number> = { water: WATER, rock: ROCK, bog: BOG, thicket: THICKET, vent: VENT, cave: CAVE };
export const impassable = (x: number, y: number) => { const k = terrainAt(x, y); return (k === WATER && !isRoad(x, y) && !frozen) || solidAt(k) || isWall(x, y); };
// winter ice on the frost village's water can be walked on
let frozen = false;
export const isFrozen = () => frozen;
export function setFrozen(on: boolean) { if (on !== frozen) { frozen = on; grid = null; roadState.version++; } }
// sand drifts that cover a road for a while: it still guides walkers but loses its speed
const buried = new Set<number>();
export function syncBuried(list: { i: number }[] | undefined) { buried.clear(); for (const b of list ?? []) buried.add(b.i); roadState.version++; }
export const isBuried = (x: number, y: number) => buried.has(y * MAP + x);

// length of open water through a tile along one axis
export function waterRun(x: number, y: number, dx: number, dy: number) {
  let n = 1;
  for (let k = 1; isWater(x + dx * k, y + dy * k); k++) n++;
  for (let k = 1; isWater(x - dx * k, y - dy * k); k++) n++;
  return n;
}
export const bridgeable = (x: number, y: number) => Math.min(waterRun(x, y, 1, 0), waterRun(x, y, 0, 1)) <= BRIDGE_MAX;

const noise = (x: number, y: number, s: number) => { const v = Math.sin(x * 12.9898 + y * 78.233 + s * 37.719) * 43758.5453; return v - Math.floor(v); };

export function makeTerrain(village: string): Terrain {
  const d = villageDef(village).terrain;
  const out = { water: new Set<number>(), rock: new Set<number>(), bog: new Set<number>(), thicket: new Set<number>() };
  const put = (set: Set<number>, x: number, y: number) => { if (inMap(x, y)) set.add(y * MAP + x); };
  const r = d.river;
  if (r) {
    let prev: number | null = null;
    for (let t = 0; t < MAP; t++) {
      const c = r.at + r.amp * Math.sin(t * 0.17 + r.seed * 2.1) + 0.9 * Math.sin(t * 0.43 + r.seed * 5.3);
      const lo = Math.round(c - r.w / 2), hi = lo + r.w - 1;
      // fill the gap when the bend moves more than a tile so the river stays one piece
      const a = prev == null ? lo : Math.min(lo, prev), b = prev == null ? hi : Math.max(hi, prev + r.w - 1);
      for (let k = a; k <= b; k++) r.along === 'y' ? put(out.water, k, t) : put(out.water, t, k);
      prev = lo;
    }
  }
  const blob = (set: Set<number>, cx: number, cy: number, rx: number, ry: number, seed: number) => {
    for (let y = Math.floor(cy - ry - 2); y <= cy + ry + 2; y++) for (let x = Math.floor(cx - rx - 2); x <= cx + rx + 2; x++) {
      const dd = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
      if (dd < 0.75 + noise(x, y, seed) * 0.5) put(set, x, y);
    }
  };
  (d.lakes ?? []).forEach(([x, y, rx, ry], k) => blob(out.water, x, y, rx, ry, 10 + k));
  (d.rocks ?? []).forEach(([x, y, rr], k) => blob(out.rock, x, y, rr, rr, 20 + k));
  (d.bog ?? []).forEach(([x, y, rr], k) => blob(out.bog, x, y, rr, rr * 0.8, 30 + k));
  (d.thicket ?? []).forEach(([x, y, rr], k) => blob(out.thicket, x, y, rr, rr * 0.85, 40 + k));
  // ridges: a ragged rock line with a pass every so often
  (d.ridges ?? []).forEach(([ax, ay, bx, by], k) => {
    const n = Math.ceil(Math.hypot(bx - ax, by - ay));
    for (let i = 0; i <= n; i++) {
      if ((i + k * 3) % 9 === 4 || (i + k * 3) % 9 === 5) continue;
      const x = Math.round(ax + ((bx - ax) * i) / n), y = Math.round(ay + ((by - ay) * i) / n);
      put(out.rock, x, y);
      if (noise(x, y, 50 + k) > 0.45) put(out.rock, x + (noise(y, x, k) > 0.5 ? 1 : 0), y + 1);
    }
  });
  // the guild square and the exits' roads stay open; water there is left for trimRoads to bridge
  const keep = (i: number) => {
    const x = i % MAP, y = (i / MAP) | 0;
    return !(x >= 29 && x <= 32 && y >= 29 && y <= 34);
  };
  const onBase = (i: number) => i % MAP === SOUTH_EXIT.x || ((i / MAP) | 0) === EAST_EXIT.y;
  const water = [...out.water].filter(keep);
  const taken = new Set(water);
  const spots = (list: [number, number][] | undefined) => (list ?? []).map(([x, y]) => y * MAP + x).filter((i) => keep(i) && !onBase(i) && !taken.has(i) && (taken.add(i), true));
  const vent = spots(d.vents), cave = spots(d.caves);
  const rest = (set: Set<number>, base: boolean) => [...set].filter((i) => keep(i) && !taken.has(i) && (base || !onBase(i)) && (taken.add(i), true));
  const fl = new Set<number>();
  (d.flowers ?? []).forEach(([x, y, rr], k) => blob(fl, x, y, rr, rr * 0.8, 60 + k));
  const terr = { water, rock: rest(out.rock, false), bog: rest(out.bog, true), thicket: rest(out.thicket, true), vent, cave };
  return { ...terr, flowers: [...fl].filter((i) => !taken.has(i)) };
}

// starting roads may only cross water between an exit and the guild; the stub beyond the river is dropped
export function trimRoads(s: GameState, guildAt: P) {
  const drop = new Set<number>();
  const south = s.roads.filter((i) => i % MAP === SOUTH_EXIT.x).sort((a, b) => b - a);
  const east = s.roads.filter((i) => ((i / MAP) | 0) === EAST_EXIT.y && i % MAP !== SOUTH_EXIT.x).sort((a, b) => (b % MAP) - (a % MAP));
  for (const [line, past] of [[south, (i: number) => ((i / MAP) | 0) < guildAt.y], [east, (i: number) => i % MAP < guildAt.x]] as const) {
    let cut = false;
    for (const i of line) {
      if (!cut && past(i) && ter[i] === WATER) cut = true;
      if (cut) drop.add(i);
    }
  }
  s.roads = s.roads.filter((i) => !drop.has(i));
}

export const ROAD_SPEED = 1.6;
const roads = new Uint8Array(MAP * MAP);
let villageRoads: number[] = [];
export const roadState = { version: 0 };

export function syncRoads(s: GameState) {
  grid = null;
  roads.fill(0);
  for (const i of s.roads) roads[i] = 1;
  villageRoads = s.roads.filter((i) => inVillage(i % MAP, (i / MAP) | 0));
  roadState.version++;
}

export function baseRoads(): number[] {
  const out: number[] = [];
  for (let y = VB.min; y < MAP; y++) out.push(y * MAP + SOUTH_EXIT.x);
  for (let x = VB.min; x < MAP; x++) if (x !== SOUTH_EXIT.x) out.push(EAST_EXIT.y * MAP + x);
  return out;
}

export function setRoad(s: GameState, x: number, y: number, on: boolean): boolean {
  if (!inVillage(x, y) || roads[y * MAP + x] === (on ? 1 : 0)) return false;
  if (on && (solidAt(terrainAt(x, y)) || (blocked(s, x, y) && !isWater(x, y)) || (isWater(x, y) && !bridgeable(x, y)))) return false;
  if (!on && s.buildings.some((b) => { const d = doorOf(b); return d.x === x && d.y === y; })) return false;
  const i = y * MAP + x;
  s.roads = on ? [...s.roads, i] : s.roads.filter((r) => r !== i);
  syncRoads(s);
  return true;
}

export const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP && y < MAP;
export const inVillage = (x: number, y: number) => x >= VB.min && x <= VB.max && y >= VB.min && y <= VB.max;
export const villageDist = (x: number, y: number) =>
  Math.max(0, VB.min - x, x - VB.max, VB.min - y, y - VB.max);

export function zoneOf(x: number, y: number): number {
  const d = villageDist(Math.floor(x), Math.floor(y));
  if (d === 0) return -1;
  if (d <= 7) return 0;
  if (d <= 14) return 1;
  return 2;
}

export const isRoad = (x: number, y: number) => inMap(x, y) && roads[y * MAP + x] === 1;

export const bsize = (b: Building) => BUILDINGS[b.type].size;
// rot 0: door on the +x (lower-right) face, rot 1: door on the +y (lower-left) face
export const doorAt = (x: number, y: number, n: number, rot: number): P =>
  rot ? { x: x + n - 1, y: y + n } : { x: x + n, y: y + n - 1 };
export const doorOf = (b: Building): P => b.door ?? doorAt(b.x, b.y, bsize(b), b.rot ?? 0);
export const covers = (b: Building, x: number, y: number) =>
  x >= b.x && y >= b.y && x < b.x + bsize(b) && y < b.y + bsize(b);

let grid: Uint8Array | null = null;
let gridOwner: GameState | null = null;

export function invalidateGrid() { grid = null; }

function getGrid(s: GameState): Uint8Array {
  if (grid && gridOwner === s) return grid;
  grid = new Uint8Array(MAP * MAP);
  gridOwner = s;
  for (const b of s.buildings) {
    const n = bsize(b);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) grid[(b.y + j) * MAP + b.x + i] = 1;
  }
  for (let i = 0; i < MAP * MAP; i++) if ((ter[i] === WATER && !roads[i] && !frozen) || solidAt(ter[i]) || isWall(i % MAP, (i / MAP) | 0)) grid[i] = 1;
  return grid;
}

export const blocked = (s: GameState, x: number, y: number) => !inMap(x, y) || getGrid(s)[y * MAP + x] === 1;

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// A* over 8-neighborhood with corner cutting disabled; start tile may be blocked (agent leaving a building)
export function findPath(s: GameState, sx: number, sy: number, tx: number, ty: number): P[] {
  sx = Math.max(0, Math.min(MAP - 1, sx)); sy = Math.max(0, Math.min(MAP - 1, sy));
  if (sx === tx && sy === ty) return [{ x: tx + 0.5, y: ty + 0.5 }];
  const g = getGrid(s);
  const N = MAP * MAP;
  const cost = new Float32Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap: number[] = [];
  const f = new Float32Array(N);
  const push = (i: number) => {
    heap.push(i);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (f[heap[p]] <= f[heap[k]]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l;
        if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  const h = (x: number, y: number) => {
    const dx = Math.abs(x - tx), dy = Math.abs(y - ty);
    return (Math.max(dx, dy) + 0.414 * Math.min(dx, dy)) / ROAD_SPEED;
  };
  const start = sy * MAP + sx, goal = ty * MAP + tx;
  cost[start] = 0; f[start] = h(sx, sy); push(start);
  let found = false;
  while (heap.length) {
    const cur = pop();
    if (closed[cur]) continue;
    if (cur === goal) { found = true; break; }
    closed[cur] = 1;
    const cx = cur % MAP, cy = (cur / MAP) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!inMap(nx, ny)) continue;
      const ni = ny * MAP + nx;
      if (g[ni] && ni !== goal) continue;
      if (dx && dy && (g[cy * MAP + nx] || g[ny * MAP + cx])) continue;
      if (!canStep(cx, cy, nx, ny) || (dx && dy && (!canStep(cx, cy, nx, cy) || !canStep(cx, cy, cx, ny)))) continue;
      const nc = cost[cur] + (dx && dy ? 1.414 : 1) * (roads[ni] ? 1 / ROAD_SPEED : ter[ni] >= BOG ? 1.6 : 1);
      if (nc < cost[ni]) {
        cost[ni] = nc; from[ni] = cur; f[ni] = nc + h(nx, ny);
        push(ni);
      }
    }
  }
  if (!found) return [{ x: tx + 0.5, y: ty + 0.5 }];
  const out: P[] = [];
  for (let i = goal; i !== start && i >= 0; i = from[i]) out.push({ x: (i % MAP) + 0.5, y: ((i / MAP) | 0) + 0.5 });
  return out.reverse();
}

function footprintFree(s: GameState, n: number, x: number, y: number, bog = false): boolean {
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const k = terrainAt(x + i, y + j);
    if (!inVillage(x + i, y + j) || blocked(s, x + i, y + j) || isRoad(x + i, y + j) || (k && !(bog && k === BOG))) return false;
  }
  return true;
}

export interface Placement { rot: number; door: P | null }

// any tile in the ring around the footprint (corners included) has this terrain
function touches(x: number, y: number, n: number, k: number) {
  for (let j = -1; j <= n; j++) for (let i = -1; i <= n; i++) {
    if (i >= 0 && j >= 0 && i < n && j < n) continue;
    if (terrainAt(x + i, y + j) === k) return true;
  }
  return false;
}

// any road touching a side of the footprint can serve as the entrance; the two front faces are
// tried first (they show the door), the back faces after (the sprite keeps its door on that side)
export function placement(s: GameState, type: string, x: number, y: number, pref = 0): Placement | null {
  const d = BUILDINGS[type];
  const n = d.size;
  if (!footprintFree(s, n, x, y, d.onBog)) return null;
  if (d.near && !touches(x, y, n, NEAR_KIND[d.near])) return null;
  if (d.kind === 'decor') return { rot: pref, door: null };
  const side = (k: number) => {
    const out: { p: P; rot: number }[] = [];
    for (let i = n - 1; i >= 0; i--) {
      if (k === 0) out.push({ p: { x: x + n, y: y + i }, rot: 0 });
      if (k === 1) out.push({ p: { x: x + i, y: y + n }, rot: 1 });
      if (k === 2) out.push({ p: { x: x + i, y: y - 1 }, rot: 0 });
      if (k === 3) out.push({ p: { x: x - 1, y: y + i }, rot: 1 });
    }
    return out;
  };
  const order = pref ? [1, 0, 3, 2] : [0, 1, 2, 3];
  for (const k of order) for (const c of side(k)) {
    if (isRoad(c.p.x, c.p.y) && !blocked(s, c.p.x, c.p.y) && !isWater(c.p.x, c.p.y)) return { rot: c.rot, door: c.p };
  }
  return null;
}

export const canPlaceAt = (s: GameState, type: string, x: number, y: number) => placement(s, type, x, y) !== null;

export function randomStreetTile(s: GameState): P {
  if (!villageRoads.length) return randomVillageTile(s);
  const i = villageRoads[Math.floor(Math.random() * villageRoads.length)];
  return { x: i % MAP, y: (i / MAP) | 0 };
}

export function randomVillageTile(s: GameState): P {
  for (let k = 0; k < 30; k++) {
    const x = VB.min + Math.floor(Math.random() * (VB.max - VB.min + 1));
    const y = VB.min + Math.floor(Math.random() * (VB.max - VB.min + 1));
    if (!blocked(s, x, y) && !terrainAt(x, y)) return { x, y };
  }
  return { x: VB.min, y: VB.min };
}

export function randomZoneTile(zone: number): P {
  for (let k = 0; k < 60; k++) {
    const x = Math.floor(Math.random() * MAP), y = Math.floor(Math.random() * MAP);
    if (zoneOf(x, y) === zone && !isRoad(x, y) && terrainAt(x, y) !== WATER && terrainAt(x, y) !== ROCK && villageDist(x, y) >= 2) return { x, y };
  }
  return { x: 2, y: 2 };
}

export function dryLine(ax: number, ay: number, bx: number, by: number): boolean {
  const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 2) + 1;
  for (let k = 0; k <= n; k++) {
    const x = Math.floor(ax + ((bx - ax) * k) / n), y = Math.floor(ay + ((by - ay) * k) / n);
    if (impassable(x, y)) return false;
    const px = Math.floor(ax + ((bx - ax) * Math.max(0, k - 1)) / n), py = Math.floor(ay + ((by - ay) * Math.max(0, k - 1)) / n);
    if (!canStep(px, py, x, y)) return false;
  }
  return true;
}

export function segmentAvoidsVillage(ax: number, ay: number, bx: number, by: number): boolean {
  for (let t = 0; t <= 1; t += 0.1) {
    const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
    if (villageDist(Math.floor(x), Math.floor(y)) < 1) return false;
  }
  return true;
}

// a point on the map's rim, and a spot in the given zone along the way from there toward the village
export function edgeEntry(zone: number): { from: P; to: P } {
  const t = Math.random() * (MAP - 1), side = Math.floor(Math.random() * 4);
  const from = side === 0 ? { x: t, y: 0.5 } : side === 1 ? { x: MAP - 1.5, y: t } : side === 2 ? { x: t, y: MAP - 1.5 } : { x: 0.5, y: t };
  const cx = (VB.min + VB.max + 1) / 2, cy = cx;
  const hits: P[] = [];
  for (let k = 0; k <= 60; k++) {
    const x = from.x + ((cx - from.x) * k) / 60, y = from.y + ((cy - from.y) * k) / 60;
    if (zoneOf(x, y) === zone && villageDist(Math.floor(x), Math.floor(y)) >= 2) hits.push({ x, y });
  }
  const dry = hits.filter((h) => { const k = terrainAt(Math.floor(h.x), Math.floor(h.y)); return k !== WATER && k !== ROCK; });
  const p = dry.length ? dry[Math.floor(Math.random() * dry.length)] : from;
  return { from, to: { x: Math.max(0.5, Math.min(MAP - 1.5, p.x + Math.random() * 3 - 1.5)), y: Math.max(0.5, Math.min(MAP - 1.5, p.y + Math.random() * 3 - 1.5)) } };
}
