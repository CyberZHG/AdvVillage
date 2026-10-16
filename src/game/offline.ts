import { DAY, DAYS_PER_MONTH } from './constants';
import { MONSTERS, villageDef, zoneMonsters } from './data';
import { expNeed, gainExp } from './level';
import { addItem, mods } from './state';
import { pick, weighted } from './util';
import type { GameState } from './types';

export interface OfflineReport { sec: number; money: number; levels: number; items: [string, number][] }

const CAP = 8 * 3600;
// an hour away is worth about nine game days of normal running, up to forty
const EFFICIENCY = 0.05;
const MAX_DAYS = 40;

// time away is settled as a lump sum at reduced efficiency; the calendar itself does not move
export function settleOffline(s: GameState): OfflineReport | null {
  if (!s.savedAt) return null;
  const sec = Math.min(CAP, (Date.now() - s.savedAt) / 1000);
  const days = Math.min(MAX_DAYS, (sec / DAY) * EFFICIENCY);
  if (sec < 120 || days < 0.5) return null;
  const perDay = (s.stats.lastIncome || s.stats.income) / DAYS_PER_MONTH;
  const money = Math.round(perDay * days);
  s.money += money;
  s.stats.earned += money;
  let levels = 0;
  const fighters = s.npcs.filter((n) => n.role === 'fighter');
  for (const n of fighters) levels += gainExp(n, (expNeed(n.level) * days) / 40);
  const got = new Map<string, number>();
  const add = (k: string, v: number) => { if (v <= 0) return; addItem(s, k, v); got.set(k, (got.get(k) ?? 0) + v); };
  const gatherers = s.npcs.filter((n) => n.role === 'gatherer').length;
  for (const k of ['wood', 'stone', 'fruit']) add(k, Math.round(gatherers * days * 6));
  const ground = villageDef(s.village).ground;
  const pool = [0, 1, 2].flatMap((z) => zoneMonsters(z, ground));
  const kills = Math.min(3000, Math.round(fighters.length * days * 2));
  for (let i = 0; i < kills && pool.length; i++) {
    const item = weighted(MONSTERS[pick(pool)].drops, (d) => d[1])![0];
    add(item, Math.max(1, Math.round(mods(s).drops)));
  }
  const items = [...got.entries()].sort((a, b) => b[1] - a[1]);
  return { sec, money, levels, items };
}
