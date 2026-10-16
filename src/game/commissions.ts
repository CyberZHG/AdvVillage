import { DAYS_PER_MONTH } from './constants';
import { BUILDINGS, EQUIP, ITEMS, MONSTERS, BASE_ITEMS, shopTier, type Slot } from './data';
import { buildCost } from './econ';
import { addFame } from './fame';
import { addItem, log, newId, note, ofKind, residents, year } from './state';
import { chance, clamp, pick, rand, weighted } from './util';
import type { Commission, GameState } from './types';

const SEASON_DAYS = DAYS_PER_MONTH * 3;
const PER_SEASON = 3;
export const seasonIndex = (s: GameState) => Math.floor(s.day / SEASON_DAYS);
export const seasonEnds = (s: GameState) => (seasonIndex(s) + 1) * SEASON_DAYS;

// counted from the moment the commission is posted; the rest compare against the village as it stands
const DELTA = new Set(['tourists', 'kills', 'fam', 'earn', 'quests', 'expedition', 'goods']);

function value(s: GameState, c: Commission): number {
  switch (c.k) {
    case 'tourists': return s.stats.tourists;
    case 'kills': return s.stats.kills;
    case 'fam': return s.stats.fk[c.target!] ?? 0;
    case 'earn': return s.stats.earned;
    case 'quests': return s.stats.quests;
    case 'expedition': return s.stats.expeditions;
    case 'goods': return s.stats.goods;
    case 'build': return s.buildings.filter((b) => b.type === c.target).length;
    case 'bldLevel': return Math.max(0, ...s.buildings.filter((b) => b.type === c.target).map((b) => b.level));
    case 'fighterLevel': return Math.max(0, ...s.npcs.filter((n) => n.role === 'fighter').map((n) => n.level));
    case 'deliver': return s.items[c.target!] ?? 0;
    case 'residents': return residents(s).length;
    case 'forge': return s.wlv[c.target!] ?? 0;
  }
  return 0;
}

export const progress = (s: GameState, c: Commission) => Math.max(0, value(s, c) - (DELTA.has(c.k) ? c.base : 0));

const nice = (v: number) => {
  const step = v >= 10000 ? 1000 : v >= 1000 ? 100 : v >= 100 ? 10 : 5;
  return Math.max(step, Math.round(v / step) * step);
};

type Draft = { k: string; target?: string; need: number; diff: number };
type Gen = (s: GameState) => Draft | null;

const fighters = (s: GameState) => s.npcs.filter((n) => n.role === 'fighter');

const GENS: [string, number, Gen][] = [
  ['tourists', 3, (s) => ({ k: 'tourists', need: nice(Math.max(15, s.stats.tourists / Math.max(1, s.day) * SEASON_DAYS * 0.8)), diff: 1 })],
  ['kills', 3, (s) => ({ k: 'kills', need: nice(Math.max(15, fighters(s).length * 14)), diff: 1 })],
  ['fam', 3, (s) => {
    const m = s.monsters.filter((x) => x.boss == null);
    if (!m.length) return null;
    return { k: 'fam', target: MONSTERS[pick(m).type].fam, need: nice(8 + 2 * year(s)), diff: 1 };
  }],
  ['earn', 2, (s) => ({ k: 'earn', need: nice(Math.max(1500, s.stats.lastIncome * 2.4)), diff: 2 })],
  ['quests', 1, (s) => (s.stats.quests > 0 ? { k: 'quests', need: 2, diff: 1 } : null)],
  ['expedition', 1, (s) => (s.stats.expeditions > 0 || year(s) >= 2 ? { k: 'expedition', need: 1, diff: 2 } : null)],
  ['build', 3, (s) => {
    const budget = Math.max(3000, s.money * 1.5 + s.stats.lastIncome * 2);
    const list = Object.keys(BUILDINGS).filter((k) => {
      const d = BUILDINGS[k];
      return d.buildable !== false && !s.buildings.some((b) => b.type === k) && buildCost(s, k).money <= budget;
    });
    return list.length ? { k: 'build', target: pick(list), need: 1, diff: 1 } : null;
  }],
  ['bldLevel', 2, (s) => {
    const list = s.buildings.filter((b) => BUILDINGS[b.type].price > 0);
    if (!list.length) return null;
    const b = pick(list);
    const top = Math.max(...s.buildings.filter((o) => o.type === b.type).map((o) => o.level));
    return { k: 'bldLevel', target: b.type, need: top + 2 + Math.floor(year(s) / 3), diff: 2 };
  }],
  ['fighterLevel', 2, (s) => {
    const top = Math.max(0, ...fighters(s).map((n) => n.level));
    return top ? { k: 'fighterLevel', need: top + Math.max(3, Math.round(top * 0.12)), diff: 2 } : null;
  }],
  ['deliver', 3, (s) => {
    const list = s.disc.filter((k) => !BASE_ITEMS.includes(k) && ITEMS[k]);
    if (!list.length) return null;
    const item = pick(list);
    return { k: 'deliver', target: item, need: clamp(nice((s.items[item] ?? 0) + 6 + 2 * year(s)), 5, 500), diff: 1 };
  }],
  ['residents', 1, (s) => ({ k: 'residents', need: residents(s).length + 3 + Math.floor(year(s) / 2), diff: 2 })],
  ['forge', 2, (s) => {
    if (!s.buildings.some((b) => b.type === 'forge')) return null;
    const worn = [...new Set(fighters(s).flatMap((n) => [n.weapon, n.armor, n.accessory]).filter((k): k is string => !!k))];
    if (!worn.length) return null;
    const key = pick(worn);
    return { k: 'forge', target: key, need: (s.wlv[key] ?? 0) + 1, diff: 1 };
  }],
  ['goods', 2, (s) => (s.buildings.some((b) => BUILDINGS[b.type].goods) ? { k: 'goods', need: nice(20 + 10 * year(s)), diff: 1 } : null)],
];

// a material for gear the village can already buy, or the next tier up
function rewardItem(s: GameState): string {
  const slot = pick(Object.keys(EQUIP) as Slot[]);
  const tier = Math.max(1, ...ofKind(s, 'shop').filter((b) => BUILDINGS[b.type].slot === slot).map((b) => shopTier(b.level)));
  return pick(EQUIP[slot].filter((e) => e.tier <= tier + 1)).mat;
}

function post(s: GameState) {
  const used = new Set<string>();
  const list: Commission[] = [];
  for (let tries = 0; list.length < PER_SEASON && tries < 30; tries++) {
    const g = weighted(GENS.filter(([k]) => !used.has(k)), (x) => x[1]);
    if (!g) break;
    used.add(g[0]);
    const d = g[2](s);
    if (!d) continue;
    const y = year(s);
    const c: Commission = {
      id: newId(s), k: d.k, target: d.target, need: d.need, base: 0,
      money: nice((300 + 220 * y) * d.diff * rand(0.9, 1.15)), fame: 6 * d.diff + Math.min(20, y),
    };
    c.base = DELTA.has(c.k) ? value(s, c) : 0;
    if (chance(0.45)) { c.item = rewardItem(s); c.count = 2 + Math.floor(y / 2); }
    list.push(c);
  }
  s.commissions = list;
}

function complete(s: GameState, c: Commission) {
  if (c.k === 'deliver') s.items[c.target!] -= c.need;
  c.done = true;
  s.money += c.money;
  if (c.item) addItem(s, c.item, c.count ?? 1);
  addFame(s, c.fame);
  s.stats.commissions++;
  s.ys.commissions = (s.ys.commissions ?? 0) + 1;
  const p = { c: commissionText(c), v: c.money };
  log(s, 'log.commission', p);
  note(s, 'log.commission', p);
}

const TARGET_NS: Record<string, string> = { fam: 'fam', build: 'b', bldLevel: 'b', deliver: 'item', forge: 'eq' };

// stored as a translatable reference ("@key|n|@target") so log lines follow language changes
export function commissionText(c: Commission): string {
  const ns = TARGET_NS[c.k];
  return `@cm.${c.k}|${c.need}|${ns ? `@${ns}.${c.target}` : ''}`;
}

export function commissionsDaily(s: GameState) {
  const si = seasonIndex(s);
  if (si !== s.cseason) { s.cseason = si; post(s); }
  for (const c of s.commissions) if (!c.done && progress(s, c) >= c.need) complete(s, c);
}
