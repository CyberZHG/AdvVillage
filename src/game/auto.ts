import { forgeCost, forgeUpgrade, forgeable, hasCost, upgrade, upgradeCost } from './econ';
import { RESEARCH, canResearch, researchCost, startResearch } from './research';
import type { GameState } from './types';

export const AUTO_KEYS = ['research', 'forge', 'upgrade'] as const;
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
  if (a.upgrade) {
    const b = s.buildings.map((b) => ({ b, c: upgradeCost(s, b) }))
      .filter(({ c }) => c.money <= spare() && hasCost(s, c))
      .sort((x, y) => x.c.money - y.c.money)[0];
    if (b) upgrade(s, b.b);
  }
}
