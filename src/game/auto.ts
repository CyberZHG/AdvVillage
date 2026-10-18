import { MAP } from './constants';
import { BUILDINGS, finished, wonderCost } from './data';
import { advanceWonder, build, buildCost, canBuild, clearTerrain, expand, expansionCost, forgeCost, forgeUpgrade, forgeable, hasCost, placeRoad, roadCost, upgrade, upgradeCost } from './econ';
import { freeBeds, log, residents } from './state';
import { BOG, BRIDGE_MAX, ROCK, THICKET, VB, blocked, inVillage, isBridge, isRoad, isWater, placement, terrainAt } from './world';
import { RESEARCH, canResearch, researchCost, startResearch } from './research';
import type { GameState } from './types';

export const AUTO_KEYS = ['research', 'forge', 'upgrade', 'build'] as const;
export type AutoKey = typeof AUTO_KEYS[number];

// automation only spends what is left after keeping about a month's income in reserve
export const autoReserve = (s: GameState) => Math.max(3000, s.stats.lastIncome);

// once a day, each enabled helper makes at most one purchase, always the cheapest one available
export function autoDaily(s: GameState) {
  const a = s.auto;
  if (!a) return;
  const spare = () => s.money - autoReserve(s);
  if (a.research && !s.researching && !s.rqueue.length) {
    const k = RESEARCH.map((r) => r.key).filter((k) => canResearch(s, k) && researchCost(s, k).money <= spare())
      .sort((x, y) => researchCost(s, x).money - researchCost(s, y).money)[0];
    if (k) startResearch(s, k);
  }
  if (a.forge && s.buildings.some((b) => b.type === 'forge')) {
    const worn = new Set(s.npcs.flatMap((n) => [n.weapon, n.armor, n.accessory]));
    const k = (['weapon', 'armor', 'accessory'] as const).flatMap((slot) => forgeable(s, slot)).filter((k) => worn.has(k))
      .map((k) => ({ k, c: forgeCost(s, k) }))
      .filter(({ c }) => c.money <= spare() && (s.items[c.mat] ?? 0) >= c.count)
      .sort((x, y) => x.c.money - y.c.money)[0];
    if (k) forgeUpgrade(s, k.k, 'village');
  }
  if (a.build) { autoWonder(s, spare); autoBuild(s, spare); }
  if (a.upgrade) {
    const b = s.buildings.map((b) => ({ b, c: upgradeCost(s, b) }))
      .filter(({ c }) => c.money <= spare() && hasCost(s, c))
      .sort((x, y) => x.c.money - y.c.money)[0];
    if (b) upgrade(s, b.b);
  }
}

// ---------- auto build ----------
// every kind of building once, businesses first and cheapest first within each group, plus another house whenever workers have nowhere to sleep.
// when no lot is free the builder extends the street grid, bridging a river only where no bridge is near
const CENTER = 31.5;
const BRIDGE_GAP = 8;
// businesses that earn come before decorations, each group cheapest first
// wonders: carry on whichever is under way, otherwise lay the footing of the next one as high up the screen as
// it will fit (smallest x + y) so it never stands in front of the village
function autoWonder(s: GameState, spare: () => number) {
  const site = s.buildings.find((b) => BUILDINGS[b.type].wonder && !finished(b));
  if (site) { if (wonderCost(site.type, (site.stage ?? 0) + 1).money <= spare()) advanceWonder(s, site); return; }
  const next = Object.keys(BUILDINGS).find((k) => BUILDINGS[k].wonder && canBuild(s, k) && buildCost(s, k).money <= spare());
  if (!next) return;
  let best: { x: number; y: number } | null = null, bd = Infinity;
  for (let y = VB.min; y <= VB.max - 2; y++) for (let x = VB.min; x <= VB.max - 2; x++) {
    if (x + y < bd && placement(s, next, x, y)) { bd = x + y; best = { x, y }; }
  }
  if (best) build(s, next, best.x, best.y);
}

const once = () => Object.keys(BUILDINGS).filter((k) => BUILDINGS[k].buildable !== false && k !== 'guild' && BUILDINGS[k].kind !== 'house' && !BUILDINGS[k].wonder)
  .sort((a, b) => +(BUILDINGS[a].kind === 'decor') - +(BUILDINGS[b].kind === 'decor') || BUILDINGS[a].cost.money - BUILDINGS[b].cost.money);

function autoBuild(s: GameState, spare: () => number) {
  const homeless = residents(s).some((n) => (n.role === 'fighter' || n.role === 'gatherer') && n.home == null);
  const want = homeless && freeBeds(s) <= 0 ? ['house'] : once().filter((k) => !s.buildings.some((b) => b.type === k));
  const types = want.filter((k) => canBuild(s, k) && buildCost(s, k).money <= spare());
  if (!types.length) return;
  // a terrain building with no free lot beside its terrain waits; the next kind on the list goes ahead
  for (const type of types.slice(0, 4)) {
    const spot = bestSpot(s, type);
    if (spot) { build(s, type, spot.x, spot.y); return; }
  }
  if (types.every((k) => BUILDINGS[k].near)) return;
  let laid = false;
  for (let k = 0; k < 3 && spare() > 0; k++) { if (!extendRoads(s, spare)) break; laid = true; }
  // nowhere left to build or pave: widen the village once it can be afforded
  if (laid) return;
  // clear a few tiles of thicket or bog beside the streets before widening the village
  let cleared = 0;
  for (let y = VB.min; y <= VB.max && cleared < 4; y++) for (let x = VB.min; x <= VB.max && cleared < 4; x++) {
    const k = terrainAt(x, y);
    if ((k === THICKET || k === BOG) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isRoad(x + dx, y + dy)) && spare() > 200 && clearTerrain(s, x, y)) cleared++;
  }
  if (cleared) return;
  const c = expansionCost(s);
  if (c && c.money <= spare()) expand(s);
}

function bestSpot(s: GameState, type: string) {
  let best: { x: number; y: number } | null = null, bd = Infinity;
  const n = BUILDINGS[type].size;
  for (let y = VB.min; y <= VB.max; y++) for (let x = VB.min; x <= VB.max; x++) {
    const d = Math.hypot(x + n / 2 - CENTER, y + n / 2 - CENTER);
    if (d < bd && placement(s, type, x, y)) { bd = d; best = { x, y }; }
  }
  return best;
}

const onGrid = (v: number) => (((v - 32) % 4) + 4) % 4 === 0;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function bridgeNear(x: number, y: number) {
  for (let j = -BRIDGE_GAP; j <= BRIDGE_GAP; j++) for (let i = -BRIDGE_GAP; i <= BRIDGE_GAP; i++) if (isBridge(x + i, y + j)) return true;
  return false;
}

// one straight run of street, continuing a grid line out of the existing network
function extendRoads(s: GameState, spare: () => number): boolean {
  const cands: { x: number; y: number; dx: number; dy: number; d: number }[] = [];
  for (const i of s.roads) {
    const rx = i % MAP, ry = (i / MAP) | 0;
    if (!inVillage(rx, ry)) continue;
    for (const [dx, dy] of DIRS) {
      const x = rx + dx, y = ry + dy;
      if (!inVillage(x, y) || isRoad(x, y) || !(dx ? onGrid(y) : onGrid(x))) continue;
      cands.push({ x, y, dx, dy, d: Math.hypot(x - CENTER, y - CENTER) });
    }
  }
  cands.sort((a, b) => a.d - b.d);
  for (const c of cands) {
    const plan: [number, number][] = [];
    let x = c.x, y = c.y;
    while (plan.length < 8 && inVillage(x, y) && !isRoad(x, y)) {
      if (terrainAt(x, y) === ROCK || (blocked(s, x, y) && !isWater(x, y))) break;
      if (isWater(x, y)) {
        const span: [number, number][] = [];
        let wx = x, wy = y;
        while (isWater(wx, wy) && span.length <= BRIDGE_MAX) { span.push([wx, wy]); wx += c.dx; wy += c.dy; }
        const landing = inVillage(wx, wy) && !isWater(wx, wy) && terrainAt(wx, wy) !== ROCK && (!blocked(s, wx, wy) || isRoad(wx, wy));
        if (span.length > BRIDGE_MAX || !landing || span.some(([bx, by]) => bridgeNear(bx, by))) break;
        plan.push(...span);
        x = wx; y = wy;
        continue;
      }
      plan.push([x, y]);
      x += c.dx; y += c.dy;
    }
    // a bridge must reach the far bank, so drop a run that ends on the water
    while (plan.length && isWater(...plan[plan.length - 1])) plan.pop();
    if (!plan.length) continue;
    const cost = plan.reduce((a, [px, py]) => a + roadCost(px, py).money, 0);
    if (cost > spare() || !hasCost(s, { money: cost, wood: plan.reduce((a, [px, py]) => a + (roadCost(px, py).wood ?? 0), 0) })) return false;
    const bridged = plan.some(([px, py]) => isWater(px, py));
    for (const [px, py] of plan) placeRoad(s, px, py);
    if (bridged) log(s, 'log.autoBridge', {});
    return true;
  }
  return false;
}
