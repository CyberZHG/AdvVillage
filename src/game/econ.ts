import { DAY, EXPANSIONS } from './constants';
import { comboIncome, discoverCombos } from './combos';
import { ROAD_COST, BUILDINGS, WONDER_STAGES, bldAvailable, finished, villageDef, wonderCost, EQUIP, EXPEDITIONS, ITEMS, equipByKey, shopTier, type Cost, type Slot } from './data';
import { hasEffect, hotNow } from './events';
import { rbonus } from './research';
import { LUCKY_BONUS, luckyAt } from './cat';
import { lvMult } from './level';
import { bldExpNeed, gainExp } from './level';
import { assignHousing, fx, log, mods, newId, note, ofKind, residents, year } from './state';
import { addFame } from './fame';
import { BOG, ROCK, THICKET, WATER, doorOf, invalidateGrid, covers, isRoad, placement, roadState, setRoad, syncBounds, terrainAt, villageDist } from './world';
import { MAP } from './constants';
import type { Building, GameState, Score } from './types';

export function earn(s: GameState, b: Building, amount: number) {
  amount = Math.max(1, Math.round(amount * comboIncome(s, b) * (luckyAt(s, b.id) ? 1 + LUCKY_BONUS : 1)));
  s.money += amount;
  s.stats.income += amount;
  s.stats.earned += amount;
  s.ys.income += amount;
  b.yi = (b.yi ?? 0) + amount;
  const before = b.level;
  gainExp(b, amount, bldExpNeed);
  if (b.level !== before && (b.level <= 5 || b.level % 5 === 0)) {
    log(s, 'log.bldLevel', { b: '@b.' + b.type, lv: b.level });
  }
  const d = doorOf(b);
  fx(s, 'coin', d.x - 0.5, d.y - 0.5, amount);
}

// the specialty a sale would use right now, if the building has one in stock
export function goodsItem(s: GameState, b: Building): string | null {
  const g = BUILDINGS[b.type].goods;
  if (!g || b.goodsOff) return null;
  return g.find((i) => (s.items[i] ?? 0) > 0) ?? null;
}
export const goodsPrice = (item: string) => ITEMS[item].value * 2;

export const hasCost = (s: GameState, c: Cost) =>
  s.money >= c.money && (s.items.wood ?? 0) >= (c.wood ?? 0) && (s.items.stone ?? 0) >= (c.stone ?? 0);

function payCost(s: GameState, c: Cost) {
  s.money -= c.money;
  s.items.wood = (s.items.wood ?? 0) - (c.wood ?? 0);
  s.items.stone = (s.items.stone ?? 0) - (c.stone ?? 0);
}

export function buildCost(s: GameState, type: string): Cost {
  const base = BUILDINGS[type].cost;
  const count = s.buildings.filter((b) => b.type === type).length;
  const k = (1 + 0.35 * count) * (1 - rbonus(s, 'architecture'));
  return { money: Math.round(base.money * k), wood: Math.round((base.wood ?? 0) * k), stone: Math.round((base.stone ?? 0) * k) };
}

export function canBuild(s: GameState, type: string): boolean {
  const d = BUILDINGS[type];
  if (d.buildable === false) return false;
  if (d.unique && s.buildings.some((b) => b.type === type)) return false;
  if (!bldAvailable(s, type)) return false;
  // wonders open up once the village has been widened as far as it goes
  if (d.wonder && (s.vlv ?? 0) < EXPANSIONS.length) return false;
  return hasCost(s, buildCost(s, type));
}

export function build(s: GameState, type: string, x: number, y: number, pref = 0): boolean {
  const pl = placement(s, type, x, y, pref);
  if (!canBuild(s, type) || !pl) return false;
  payCost(s, buildCost(s, type));
  const b: Building = { id: newId(s), type, x, y, rot: pl.rot, door: pl.door, level: 1, exp: 0 };
  if (BUILDINGS[type].wonder) b.stage = 0;
  s.buildings.push(b);
  s.nodes = s.nodes.filter((n) => !covers(b, n.x, n.y));
  invalidateGrid();
  assignHousing(s);
  log(s, 'log.built', { b: '@b.' + type });
  for (const c of discoverCombos(s)) log(s, 'log.combo', { c: `@combo.${c}` });
  return true;
}

// bridges take timber and coin; boardwalks over bog and trails through thicket cost a little more than paving
export function roadCost(x: number, y: number): Cost {
  const k = terrainAt(x, y);
  return k === WATER ? { money: ROAD_COST * 8, wood: 12 } : k ? { money: ROAD_COST * 3, wood: 2 } : { money: ROAD_COST };
}

// painting over an existing street only changes its paving
export function canAdvance(s: GameState, b: Building) {
  if (finished(b)) return false;
  const c = wonderCost(b.type, (b.stage ?? 0) + 1);
  return hasCost(s, c) && (s.items[c.mat] ?? 0) >= c.count;
}

// raise a wonder one stage; the last one completes it
export function advanceWonder(s: GameState, b: Building): boolean {
  if (!canAdvance(s, b)) return false;
  const c = wonderCost(b.type, (b.stage ?? 0) + 1);
  payCost(s, c);
  s.items[c.mat] -= c.count;
  b.stage = (b.stage ?? 0) + 1;
  if (finished(b)) {
    addFame(s, 40);
    log(s, 'log.wonderDone', { b: '@b.' + b.type });
    note(s, 'log.wonderDone', { b: '@b.' + b.type });
  } else log(s, 'log.wonderStage', { b: '@b.' + b.type, k: b.stage, n: WONDER_STAGES });
  return true;
}

export function placeRoad(s: GameState, x: number, y: number, style = villageDef(s.village).road): boolean {
  const i = y * MAP + x;
  s.rstyle ??= {};
  if (isRoad(x, y)) {
    if ((s.rstyle[i] ?? villageDef(s.village).road) === style || s.money < ROAD_COST) return false;
    s.money -= ROAD_COST;
    s.rstyle[i] = style;
    roadState.version++;
    return true;
  }
  const c = roadCost(x, y);
  if (!hasCost(s, c) || !setRoad(s, x, y, true)) return false;
  payCost(s, c);
  s.rstyle[i] = style;
  s.nodes = s.nodes.filter((n) => n.x !== x || n.y !== y);
  return true;
}

// clearing land: cut back thicket for timber, fill a bog with stone, blast rock apart for stone
export const CLEAR_COST: Record<number, { cost: Cost; gain?: [string, number] }> = {
  [THICKET]: { cost: { money: 60 }, gain: ['wood', 8] },
  [BOG]: { cost: { money: 80, stone: 10 } },
  [ROCK]: { cost: { money: 150 }, gain: ['stone', 12] },
};
export function clearTerrain(s: GameState, x: number, y: number): boolean {
  const k = terrainAt(x, y), c = CLEAR_COST[k];
  if (!c || !s.terrain || !hasCost(s, c.cost) || s.buildings.some((b) => covers(b, x, y))) return false;
  payCost(s, c.cost);
  const i = y * MAP + x, key = k === THICKET ? 'thicket' : k === BOG ? 'bog' : 'rock';
  s.terrain[key] = s.terrain[key].filter((j) => j !== i);
  if (c.gain) s.items[c.gain[0]] = (s.items[c.gain[0]] ?? 0) + c.gain[1];
  syncBounds(s);
  roadState.version++;
  return true;
}

export function removeRoad(s: GameState, x: number, y: number) {
  if (!setRoad(s, x, y, false)) return false;
  if (s.rstyle) delete s.rstyle[y * MAP + x];
  return true;
}

export function upgradeCost(s: GameState, b: Building): Cost {
  const base = BUILDINGS[b.type].cost;
  const L = b.level, k = 1 - rbonus(s, 'architecture');
  return {
    money: Math.round(Math.max(100, base.money) * 0.4 * L * k),
    wood: Math.round((5 + 2 * L) * k),
    stone: Math.round((3 + 1.5 * L) * k),
  };
}

// list price after level, research and the season's favourites
export function priceAt(s: GameState, b: Building): number {
  const d = BUILDINGS[b.type];
  let p = d.price * lvMult(b.level) * (1 + rbonus(s, 'commerce'));
  if (d.kind === 'food') p *= 1 + rbonus(s, 'cuisine');
  if (hotNow(s, b.type)) p *= 1.25;
  return p;
}

export function upgrade(s: GameState, b: Building): boolean {
  const c = upgradeCost(s, b);
  if (!hasCost(s, c)) return false;
  payCost(s, c);
  b.level++;
  log(s, 'log.bldUpgrade', { b: '@b.' + b.type, lv: b.level });
  return true;
}

export function demolish(s: GameState, b: Building) {
  if (b.type === 'guild') return;
  const c = BUILDINGS[b.type].cost;
  s.money += Math.round(c.money * 0.3);
  s.buildings = s.buildings.filter((o) => o !== b);
  for (const n of s.npcs) {
    if (n.home === b.id) n.home = null;
    if (n.inside === b.id) {
      const d = doorOf(b);
      n.inside = null; n.x = d.x + 0.5; n.y = d.y + 0.5;
      if (n.state === 'inside') { n.state = 'idle'; n.goal = null; }
    }
  }
  invalidateGrid();
  assignHousing(s);
}

export const expansionCost = (s: GameState): Cost | null => EXPANSIONS[s.vlv] ?? null;

export function expand(s: GameState): boolean {
  const c = expansionCost(s);
  if (!c || !hasCost(s, c)) return false;
  payCost(s, c);
  s.vlv++;
  syncBounds(s);
  s.monsters = s.monsters.filter((m) => villageDist(Math.floor(m.x), Math.floor(m.y)) >= 2);
  s.nodes = s.nodes.filter((n) => villageDist(n.x, n.y) > 0 || n.kind === 'tree');
  log(s, 'log.expanded', { lv: s.vlv });
  return true;
}

export function forgeCost(s: GameState, key: string) {
  const e = equipByKey(key)!;
  const L = s.wlv[key] ?? 0;
  const m = mods(s).forgeCost * (hasEffect(s, 'smith') ? 0.5 : 1) * (1 - rbonus(s, 'smithing'));
  return { money: Math.round(e.price * 0.3 * (1 + L) * m), mat: e.mat, count: Math.max(1, Math.round((2 + 2 * Math.floor(Math.sqrt(L))) * m)) };
}

export const canForge = (s: GameState, key: string, money: number) => {
  if (!s.buildings.some((b) => b.type === 'forge')) return false;
  const c = forgeCost(s, key);
  return money >= c.money && (s.items[c.mat] ?? 0) >= c.count;
};

export function forgeUpgrade(s: GameState, key: string, payer: 'village' | { money: number }): boolean {
  const c = forgeCost(s, key);
  const forge = s.buildings.find((b) => b.type === 'forge');
  if (!forge || !canForge(s, key, payer === 'village' ? s.money : payer.money)) return false;
  s.items[c.mat] -= c.count;
  if (payer === 'village') s.money -= c.money;
  else { payer.money -= c.money; earn(s, forge, c.money); }
  s.wlv[key] = (s.wlv[key] ?? 0) + 1;
  log(s, 'log.forged', { w: '@eq.' + key, lv: s.wlv[key] });
  return true;
}

// gear the shops can sell today, plus anything a resident already wears
export function forgeable(s: GameState, slot: Slot): string[] {
  const tier = Math.max(0, ...ofKind(s, 'shop').filter((b) => BUILDINGS[b.type].slot === slot).map((b) => shopTier(b.level)));
  const owned = new Set(s.npcs.map((n) => n[slot]));
  return EQUIP[slot].filter((e) => e.tier <= tier || owned.has(e.key)).map((e) => e.key);
}

export function expeditionAvailable(s: GameState, key: string) {
  const d = EXPEDITIONS.find((e) => e.key === key);
  return !!d && year(s) >= d.unlockYear && !s.exp;
}

export function launchExpedition(s: GameState, key: string): boolean {
  if (!expeditionAvailable(s, key)) return false;
  s.exp = { loc: key, state: 'recruit', members: [], until: s.time + 2 * DAY, wins: 0, losses: 0, loot: {}, nextDay: 0 };
  log(s, 'log.expRecruit', { loc: '@ex.' + key });
  return true;
}

export function computeScore(s: GameState): Score {
  const res = residents(s);
  const npcs = res.length;
  const buildings = s.buildings.length;
  const npcLevels = res.filter((n) => n.role === 'fighter' || n.role === 'gatherer').reduce((a, n) => a + n.level, 0);
  const bldLevels = s.buildings.reduce((a, b) => a + b.level, 0);
  const fame = s.profiles.reduce((a, p) => a + p.level, 0);
  const total = npcs * 150 + buildings * 100 + npcLevels * 10 + bldLevels * 30 + fame * 2;
  const rank = total >= 180000 ? 'S' : total >= 100000 ? 'A' : total >= 50000 ? 'B' : total >= 20000 ? 'C' : 'D';
  return { npcs, buildings, npcLevels, bldLevels, fame, total, rank };
}
