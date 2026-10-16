import { DAY } from './constants';
import { log, note } from './state';
import type { GameState } from './types';

export interface ResearchDef { key: string; mat: string; max: number; per: number }

// per = effect gained per level; costs climb steeply so late-game money has somewhere to go
export const RESEARCH: ResearchDef[] = [
  { key: 'commerce', mat: 'oldCoin', max: 15, per: 0.03 },
  { key: 'cuisine', mat: 'herb', max: 15, per: 0.04 },
  { key: 'tourism', mat: 'feather', max: 15, per: 0.04 },
  { key: 'gathering', mat: 'amber', max: 15, per: 0.06 },
  { key: 'training', mat: 'claw', max: 15, per: 0.04 },
  { key: 'tactics', mat: 'stinger', max: 15, per: 0.02 },
  { key: 'medicine', mat: 'slimeCore', max: 15, per: 0.08 },
  { key: 'logistics', mat: 'snakeskin', max: 15, per: 0.04 },
  { key: 'smithing', mat: 'silverOre', max: 10, per: 0.04 },
  { key: 'architecture', mat: 'golemCore', max: 10, per: 0.03 },
];

export const rlv = (s: GameState, k: string) => s.research?.[k] ?? 0;
export const rbonus = (s: GameState, k: string) => rlv(s, k) * RESEARCH.find((r) => r.key === k)!.per;

export function researchCost(s: GameState, k: string) {
  const L = rlv(s, k);
  const d = RESEARCH.find((r) => r.key === k)!;
  return { money: Math.round(2500 * (L + 1) ** 1.8), mat: d.mat, count: Math.round(5 * (L + 1) ** 1.5), days: 3 + 2 * L };
}

export function canResearch(s: GameState, k: string) {
  const d = RESEARCH.find((r) => r.key === k);
  if (!d || s.researching || rlv(s, k) >= d.max) return false;
  const c = researchCost(s, k);
  return s.money >= c.money && (s.items[c.mat] ?? 0) >= c.count;
}

export function startResearch(s: GameState, k: string): boolean {
  if (!canResearch(s, k)) return false;
  const c = researchCost(s, k);
  s.money -= c.money;
  s.items[c.mat] -= c.count;
  s.researching = { k, until: s.time + c.days * DAY };
  log(s, 'log.researchStart', { r: `@rs.${k}`, d: c.days });
  return true;
}

export function researchTick(s: GameState) {
  const r = s.researching;
  if (!r || s.time < r.until) return;
  s.research[r.k] = rlv(s, r.k) + 1;
  s.researching = null;
  const p = { r: `@rs.${r.k}`, lv: s.research[r.k] };
  log(s, 'log.researchDone', p);
  note(s, 'log.researchDone', p);
}
