import { BUILDINGS } from './data';
import type { Building, GameState } from './types';

export interface ComboDef { key: string; members: string[]; income: number; appeal: number }

// buildings listed with repeats need that many of the type
export const COMBOS: ComboDef[] = [
  { key: 'morningMarket', members: ['breakfastShop', 'bakery', 'cafe'], income: 0.3, appeal: 6 },
  { key: 'nightlife', members: ['tavern', 'theater'], income: 0.25, appeal: 8 },
  { key: 'armory', members: ['weaponShop', 'armorShop', 'forge'], income: 0.25, appeal: 4 },
  { key: 'resort', members: ['spa', 'inn'], income: 0.3, appeal: 10 },
  { key: 'gourmet', members: ['restaurant', 'bakery', 'teahouse'], income: 0.25, appeal: 6 },
  { key: 'shopping', members: ['accessoryShop', 'souvenirShop', 'cafe'], income: 0.25, appeal: 5 },
  { key: 'healing', members: ['clinic', 'bathhouse'], income: 0.2, appeal: 4 },
  { key: 'park', members: ['flowerbed', 'fountain', 'statue'], income: 0, appeal: 12 },
  { key: 'teaGarden', members: ['teahouse', 'flowerbed', 'flowerbed'], income: 0.2, appeal: 6 },
  { key: 'adventurersRow', members: ['guild', 'tavern', 'inn'], income: 0.2, appeal: 6 },
  { key: 'colosseum', members: ['arena', 'restaurant', 'tavern'], income: 0.25, appeal: 8 },
  { key: 'residential', members: ['house', 'house', 'house', 'fountain'], income: 0.3, appeal: 3 },
];
export const COMBO_RADIUS = 5;

const center = (b: Building) => { const n = BUILDINGS[b.type].size; return { x: b.x + n / 2, y: b.y + n / 2 }; };
const near = (a: Building, b: Building) => {
  const p = center(a), q = center(b);
  return Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y)) <= COMBO_RADIUS;
};

export interface ActiveCombo { key: string; ids: number[] }

let cacheKey = '';
let cache: ActiveCombo[] = [];
const memberOf = new Map<number, ComboDef[]>();

// a building can belong to several combos but only to one instance of each
export function activeCombos(s: GameState): ActiveCombo[] {
  const key = s.buildings.map((b) => b.id).join(',');
  if (key === cacheKey) return cache;
  cacheKey = key;
  cache = [];
  memberOf.clear();
  for (const c of COMBOS) {
    const used = new Set<number>();
    for (const anchor of s.buildings.filter((b) => b.type === c.members[0])) {
      if (used.has(anchor.id)) continue;
      const group = [anchor];
      for (const type of c.members.slice(1)) {
        const pick = s.buildings.find((b) => b.type === type && !used.has(b.id) && !group.includes(b) && group.every((g) => near(g, b)));
        if (!pick) break;
        group.push(pick);
      }
      if (group.length !== c.members.length) continue;
      for (const b of group) { used.add(b.id); memberOf.set(b.id, [...(memberOf.get(b.id) ?? []), c]); }
      cache.push({ key: c.key, ids: group.map((b) => b.id) });
    }
  }
  return cache;
}

export function combosOf(s: GameState, b: Building): ComboDef[] {
  activeCombos(s);
  return memberOf.get(b.id) ?? [];
}

export const comboIncome = (s: GameState, b: Building) => 1 + combosOf(s, b).reduce((a, c) => a + c.income, 0);
export const comboAppeal = (s: GameState) => activeCombos(s).reduce((a, c) => a + COMBOS.find((d) => d.key === c.key)!.appeal, 0);

export function discoverCombos(s: GameState): string[] {
  const fresh: string[] = [];
  for (const c of activeCombos(s)) if (!s.comboSeen.includes(c.key)) { s.comboSeen.push(c.key); fresh.push(c.key); }
  return fresh;
}
