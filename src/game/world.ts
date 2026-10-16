import { MAP, V_BASE_MAX, V_BASE_MIN, SOUTH_EXIT, EAST_EXIT } from './constants';
import { BUILDINGS } from './data';
import type { Building, GameState, P } from './types';

// village bounds depend on expansion level; one active game at a time, synced on load/expand
export const VB = { min: V_BASE_MIN, max: V_BASE_MAX };
export function syncBounds(s: GameState) {
  VB.min = V_BASE_MIN - 2 * (s.vlv ?? 0);
  VB.max = V_BASE_MAX + 2 * (s.vlv ?? 0);
  grid = null;
  syncRoads(s);
}

export const ROAD_SPEED = 1.6;
const roads = new Uint8Array(MAP * MAP);
let villageRoads: number[] = [];
export const roadState = { version: 0 };

export function syncRoads(s: GameState) {
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
  if (on && blocked(s, x, y)) return false;
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
      const nc = cost[cur] + (dx && dy ? 1.414 : 1) * (roads[ni] ? 1 / ROAD_SPEED : 1);
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

function footprintFree(s: GameState, n: number, x: number, y: number): boolean {
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (!inVillage(x + i, y + j) || blocked(s, x + i, y + j) || isRoad(x + i, y + j)) return false;
  }
  return true;
}

export interface Placement { rot: number; door: P | null }

// any road touching a side of the footprint can serve as the entrance; the two front faces are
// tried first (they show the door), the back faces after (the sprite keeps its door on that side)
export function placement(s: GameState, type: string, x: number, y: number, pref = 0): Placement | null {
  const d = BUILDINGS[type];
  const n = d.size;
  if (!footprintFree(s, n, x, y)) return null;
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
    if (isRoad(c.p.x, c.p.y) && !blocked(s, c.p.x, c.p.y)) return { rot: c.rot, door: c.p };
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
    if (!blocked(s, x, y)) return { x, y };
  }
  return { x: VB.min, y: VB.min };
}

export function randomZoneTile(zone: number): P {
  for (let k = 0; k < 60; k++) {
    const x = Math.floor(Math.random() * MAP), y = Math.floor(Math.random() * MAP);
    if (zoneOf(x, y) === zone && !isRoad(x, y) && villageDist(x, y) >= 2) return { x, y };
  }
  return { x: 2, y: 2 };
}

export function segmentAvoidsVillage(ax: number, ay: number, bx: number, by: number): boolean {
  for (let t = 0; t <= 1; t += 0.1) {
    const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
    if (villageDist(Math.floor(x), Math.floor(y)) < 1) return false;
  }
  return true;
}
