import { emptyYear, log, residents } from './state';
import type { GameState, Report } from './types';

// compiled silently at year end; the player opens it from the village panel whenever they like
export function closeYear(s: GameState) {
  const ys = s.ys;
  const year = Math.floor((s.day - 1) / 120) + 1;
  const star = s.npcs.filter((n) => n.role === 'fighter').sort((a, b) => (b.yk ?? 0) - (a.yk ?? 0))[0];
  const shop = [...s.buildings].sort((a, b) => (b.yi ?? 0) - (a.yi ?? 0))[0];
  const r: Report = {
    year, income: ys.income, kills: ys.kills, tourists: ys.tourists, quests: ys.quests, expeditions: ys.expeditions,
    bosses: ys.bosses, residents: residents(s).length, buildings: s.buildings.length, events: ys.events.slice(-10),
  };
  if (star && (star.yk ?? 0) > 0) r.star = { name: star.name, cls: star.cls, kills: star.yk ?? 0, level: star.level };
  if (shop && (shop.yi ?? 0) > 0) r.shop = { type: shop.type, income: shop.yi ?? 0 };
  s.reports.push(r);
  if (s.reports.length > 20) s.reports.shift();
  s.ys = emptyYear();
  for (const n of s.npcs) n.yk = 0;
  for (const b of s.buildings) b.yi = 0;
  log(s, 'log.report', { y: year });
}
