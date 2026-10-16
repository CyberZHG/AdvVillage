import { MAX_LEVEL } from './constants';

export interface Leveled { level: number; exp: number }

export const expNeed = (l: number) => Math.floor(10 + 5 * l ** 1.35);
export const expReward = (l: number) => 4 + 3 * l;
export const bldExpNeed = (l: number) => Math.floor(40 * l ** 1.25);
export const famExpNeed = (l: number) => Math.floor(20 + 12 * l ** 1.2);
export const lvMult = (l: number) => 1 + 0.1 * Math.sqrt(Math.max(0, l - 1));
export const dropCount = (l: number) => Math.max(1, Math.min(100, Math.floor(Math.sqrt(l))));
export const forgeMult = (l: number) => 1 + 0.25 * Math.sqrt(l);

export function gainExp(o: Leveled, amount: number, need: (l: number) => number = expNeed): number {
  if (o.level >= MAX_LEVEL) return 0;
  o.exp += amount;
  let ups = 0;
  while (o.level < MAX_LEVEL && o.exp >= need(o.level)) {
    o.exp -= need(o.level);
    o.level++;
    ups++;
  }
  if (o.level >= MAX_LEVEL) o.exp = 0;
  return ups;
}
