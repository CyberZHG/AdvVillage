import { DAY, EXPANSIONS } from './constants';
import { comboIncome, discoverCombos } from './combos';
import { ROAD_COST, BUILDINGS, EQUIP, EXPEDITIONS, shopTier, type Cost } from './data';
import { bldExpNeed, gainExp } from './level';
import { assignHousing, fx, log, mods, newId, ofKind, residents, year } from './state';
import { doorOf, invalidateGrid, covers, placement, setRoad, syncBounds, villageDist } from './world';
import type { Building, GameState, Score } from './types';

export function earn(s: GameState, b: Building, amount: number) {
  amount = Math.max(1, Math.round(amount * comboIncome(s, b)));
  s.money += amount;
  s.stats.income += amount;
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
  const k = 1 + 0.35 * count;
  return { money: Math.round(base.money * k), wood: Math.round((base.wood ?? 0) * k), stone: Math.round((base.stone ?? 0) * k) };
}

export function canBuild(s: GameState, type: string): boolean {
  const d = BUILDINGS[type];
  if (d.buildable === false) return false;
  if (d.unique && s.buildings.some((b) => b.type === type)) return false;
  return hasCost(s, buildCost(s, type));
}

export function build(s: GameState, type: string, x: number, y: number, pref = 0): boolean {
  const pl = placement(s, type, x, y, pref);
  if (!canBuild(s, type) || !pl) return false;
  payCost(s, buildCost(s, type));
  const b: Building = { id: newId(s), type, x, y, rot: pl.rot, door: pl.door, level: 1, exp: 0 };
  s.buildings.push(b);
  s.nodes = s.nodes.filter((n) => !covers(b, n.x, n.y));
  invalidateGrid();
  assignHousing(s);
  log(s, 'log.built', { b: '@b.' + type });
  for (const c of discoverCombos(s)) log(s, 'log.combo', { c: `@combo.${c}` });
  return true;
}

export function placeRoad(s: GameState, x: number, y: number): boolean {
  if (s.money < ROAD_COST || !setRoad(s, x, y, true)) return false;
  s.money -= ROAD_COST;
  s.nodes = s.nodes.filter((n) => n.x !== x || n.y !== y);
  return true;
}

export const removeRoad = (s: GameState, x: number, y: number) => setRoad(s, x, y, false);

export function upgradeCost(b: Building): Cost {
  const base = BUILDINGS[b.type].cost;
  const L = b.level;
  return {
    money: Math.round(Math.max(100, base.money) * 0.4 * L),
    wood: Math.round(5 + 2 * L),
    stone: Math.round(3 + 1.5 * L),
  };
}

export function upgrade(s: GameState, b: Building): boolean {
  const c = upgradeCost(b);
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
  const w = EQUIP.weapon.find((e) => e.key === key)!;
  const L = s.wlv[key] ?? 0;
  const m = mods(s).forgeCost;
  return { money: Math.round(w.price * 0.3 * (1 + L) * m), mat: w.mat!, count: Math.round((2 + 2 * Math.floor(Math.sqrt(L))) * m) || 1 };
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

export function forgeableWeapons(s: GameState): string[] {
  const tier = Math.max(0, ...ofKind(s, 'shop').filter((b) => BUILDINGS[b.type].slot === 'weapon').map((b) => shopTier(b.level)));
  const owned = new Set(s.npcs.map((n) => n.weapon));
  return EQUIP.weapon.filter((w) => w.tier <= tier || owned.has(w.key)).map((w) => w.key);
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
