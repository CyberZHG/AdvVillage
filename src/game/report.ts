import { emptyYear, log, npcById, residents } from './state';
import { fameRank } from './fame';
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
  r.commissions = ys.commissions ?? 0; r.fame = ys.fame ?? 0; r.rank = fameRank(s.fame);
  const pairs = s.rivals.map((x) => [npcById(s, x.a), npcById(s, x.b)] as const).filter(([a, b]) => a && b);
  const top = pairs.sort(([a, b], [c, d]) => c!.kills + d!.kills - a!.kills - b!.kills)[0];
  if (top) { const [a, b] = top as [NonNullable<typeof top[0]>, NonNullable<typeof top[1]>]; r.rival = { a: a.name, b: b.name, ak: a.kills, bk: b.kills, al: a.level, bl: b.level }; }
  s.reports.push(r);
  if (s.reports.length > 20) s.reports.shift();
  s.ys = emptyYear();
  for (const n of s.npcs) n.yk = 0;
  for (const b of s.buildings) b.yi = 0;
  log(s, 'log.report', { y: year });
}
