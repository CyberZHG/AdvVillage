import { DAY } from './constants';
import { log, note } from './state';
import type { GameState } from './types';

export interface ResearchDef { key: string; mats: string[]; max: number; per: number }

// per = effect gained per level; costs climb steeply so late-game money has somewhere to go.
// each line accepts several materials so every village can progress whatever its monsters drop
export const RESEARCH: ResearchDef[] = [
  { key: 'commerce', mats: ['oldCoin', 'pearl', 'gem'], max: 15, per: 0.03 },
  { key: 'cuisine', mats: ['herb', 'honey', 'spore'], max: 15, per: 0.04 },
  { key: 'tourism', mats: ['feather', 'wing', 'silk'], max: 15, per: 0.04 },
  { key: 'gathering', mats: ['amber', 'hardwood', 'pelt'], max: 15, per: 0.06 },
  { key: 'training', mats: ['claw', 'fang', 'horn'], max: 15, per: 0.04 },
  { key: 'tactics', mats: ['stinger', 'venom', 'scale'], max: 15, per: 0.03 },
  { key: 'medicine', mats: ['slimeCore', 'gel', 'ecto'], max: 15, per: 0.1 },
  { key: 'logistics', mats: ['snakeskin', 'cloth', 'bone'], max: 15, per: 0.04 },
  { key: 'smithing', mats: ['silverOre', 'iron', 'goldOre'], max: 10, per: 0.05 },
  { key: 'architecture', mats: ['golemCore', 'crystal', 'dust'], max: 10, per: 0.04 },
];
export const QUEUE_MAX = 3;

const def = (k: string) => RESEARCH.find((r) => r.key === k)!;
export const rlv = (s: GameState, k: string) => s.research?.[k] ?? 0;
export const rbonus = (s: GameState, k: string) => rlv(s, k) * def(k).per;

export function researchCost(s: GameState, k: string) {
  const L = rlv(s, k);
  const mat = def(k).mats.reduce((a, b) => ((s.items[b] ?? 0) > (s.items[a] ?? 0) ? b : a));
  return { money: Math.round(2500 * (L + 1) ** 1.8), mat, count: Math.round(5 * (L + 1) ** 1.5), days: 3 + 2 * L };
}

export function canResearch(s: GameState, k: string) {
  const d = RESEARCH.find((r) => r.key === k);
  if (!d || s.researching || rlv(s, k) >= d.max) return false;
  const c = researchCost(s, k);
  return s.money >= c.money && (s.items[c.mat] ?? 0) >= c.count;
}

export const canQueue = (s: GameState, k: string) =>
  !!s.researching && s.researching.k !== k && !s.rqueue.includes(k) && s.rqueue.length < QUEUE_MAX && rlv(s, k) < def(k).max;

function begin(s: GameState, k: string) {
  const c = researchCost(s, k);
  s.money -= c.money;
  s.items[c.mat] -= c.count;
  s.researching = { k, until: s.time + c.days * DAY };
  log(s, 'log.researchStart', { r: `@rs.${k}`, d: c.days });
}

export function startResearch(s: GameState, k: string): boolean {
  if (!canResearch(s, k)) return false;
  begin(s, k);
  return true;
}

// queued projects are paid for when they actually begin
export function queueResearch(s: GameState, k: string): boolean {
  if (!canQueue(s, k)) return false;
  s.rqueue.push(k);
  return true;
}

export function unqueueResearch(s: GameState, k: string) { s.rqueue = s.rqueue.filter((q) => q !== k); }

export function researchTick(s: GameState) {
  const r = s.researching;
  if (r && s.time >= r.until) {
    s.research[r.k] = rlv(s, r.k) + 1;
    s.researching = null;
    const p = { r: `@rs.${r.k}`, lv: s.research[r.k] };
    log(s, 'log.researchDone', p);
    note(s, 'log.researchDone', p);
  }
  if (!s.researching && s.rqueue.length) {
    const k = s.rqueue[0];
    if (rlv(s, k) >= def(k).max) s.rqueue.shift();
    else if (canResearch(s, k)) { s.rqueue.shift(); begin(s, k); }
  }
}

// time away counts toward the current project and any queued ones that can be afforded
export function researchSkip(s: GameState, sec: number): string[] {
  const done: string[] = [];
  while (s.researching && sec > 0) {
    const r = s.researching;
    const left = Math.max(0, r.until - s.time);
    if (left > sec) { r.until -= sec; break; }
    sec -= left;
    r.until = s.time;
    researchTick(s);
    done.push(r.k);
  }
  return done;
}
