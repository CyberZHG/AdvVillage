import { ITEMS } from './data';
import { MAX_LEVEL } from './constants';
import { expNeed } from './level';
import { gainNpcExp } from './sim';
import { log } from './state';
import type { GameState, Npc } from './types';

// special training: the village pays gold and a pile of monster materials to raise an adventurer one level.
// the material asked for changes with every level, drawn from what the village has discovered at about the
// adventurer's standing, so each step calls for something different
const COMMON = new Set(['wood', 'stone', 'fruit', 'meat']);
// village products and legendary relics have their own uses and are never asked for
const KEEP = new Set(['mapleSyrup', 'steel', 'remedy', 'furCoat', 'spice', 'heartwood', 'magmaHeart', 'mistPearl', 'everIce', 'sunStone']);

export interface TrainCost { money: number; mat: string; count: number }

export function trainCost(s: GameState, n: Npc): TrainCost | null {
  const L = n.level;
  const mats = s.disc.filter((k) => ITEMS[k] && !COMMON.has(k) && !KEEP.has(k));
  if (!mats.length) return null;
  const hi = 8 + 4 * Math.sqrt(L);
  // materials worth between a quarter and the whole of what suits this level, else the dearest ones below it
  let pool = mats.filter((k) => ITEMS[k].value <= hi && ITEMS[k].value >= hi / 4);
  if (!pool.length) pool = mats.filter((k) => ITEMS[k].value <= hi).sort((a, b) => ITEMS[b].value - ITEMS[a].value).slice(0, 3);
  if (!pool.length) pool = mats;
  pool.sort();
  const h = (Math.imul(n.id, 2654435761) ^ Math.imul(L, 40503)) >>> 0;
  const mat = pool[h % pool.length];
  const count = Math.max(1, Math.round(Math.sqrt(L) * 60 / ITEMS[mat].value + 3));
  return { money: Math.round(60 * (L + 1) ** 1.4), mat, count };
}

export function canTrain(s: GameState, n: Npc) {
  if (n.role !== 'fighter' || n.level >= MAX_LEVEL) return false;
  const c = trainCost(s, n);
  return !!c && s.money >= c.money && (s.items[c.mat] ?? 0) >= c.count;
}

export function train(s: GameState, n: Npc): boolean {
  if (!canTrain(s, n)) return false;
  const c = trainCost(s, n)!;
  s.money -= c.money;
  s.items[c.mat] -= c.count;
  gainNpcExp(s, n, expNeed(n.level) - n.exp, true);
  log(s, 'log.trained', { n: '@name:' + n.name, lv: n.level });
  return true;
}
