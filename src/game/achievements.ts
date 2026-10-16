import { CLASS_KEYS, EQUIP, EXPEDITIONS, MONSTERS, VILLAGES } from './data';
import { EXPANSIONS } from './constants';
import { residents } from './state';
import { COMBOS } from './combos';
import { festival } from './events';
import { fameRank } from './fame';
import { BUILDINGS, ITEMS } from './data';
import type { GameState } from './types';
import type { Meta } from './save';

type Check = (s: GameState, m: Meta) => boolean;

const maxFighter = (s: GameState) => Math.max(0, ...s.npcs.filter((n) => n.role === 'fighter').map((n) => n.level));
const maxBld = (s: GameState) => Math.max(0, ...s.buildings.map((b) => b.level));
const maxForge = (s: GameState) => Math.max(0, ...Object.values(s.wlv));
const has = (s: GameState, type: string) => s.buildings.some((b) => b.type === type);

export const ACHIEVEMENTS: [string, Check][] = [
  ['firstBuild', (s) => s.buildings.length >= 3],
  ['town30', (s) => s.buildings.length >= 30],
  ['city80', (s) => s.buildings.length >= 80],
  ['pop20', (s) => residents(s).length >= 20],
  ['pop60', (s) => residents(s).length >= 60],
  ['pop150', (s) => residents(s).length >= 150],
  ['lv10', (s) => maxFighter(s) >= 10],
  ['lv50', (s) => maxFighter(s) >= 50],
  ['lv100', (s) => maxFighter(s) >= 100],
  ['lv200', (s) => maxFighter(s) >= 200],
  ['kill100', (s) => s.stats.kills >= 100],
  ['kill1000', (s) => s.stats.kills >= 1000],
  ['kill10000', (s) => s.stats.kills >= 10000],
  ['rich10k', (s) => s.money >= 10000],
  ['rich100k', (s) => s.money >= 100000],
  ['rich1m', (s) => s.money >= 1000000],
  ['quest1', (s) => s.stats.quests >= 1],
  ['quest30', (s) => s.stats.quests >= 30],
  ['rescue10', (s) => s.stats.rescues >= 10],
  ['exp1', (s) => s.stats.expeditions >= 1],
  ['expAll', (s) => EXPEDITIONS.every((e) => s.stats.expLocs.includes(e.key))],
  ['dex10', (s) => s.seen.length >= 10],
  ['dex50', (s) => s.seen.length >= 50],
  ['dex100', (s) => s.seen.length >= Object.keys(MONSTERS).length],
  ['regular', (s) => s.profiles.some((p) => p.level >= 10)],
  ['tourist1000', (s) => s.stats.tourists >= 1000],
  ['bld50', (s) => maxBld(s) >= 50],
  ['bld200', (s) => maxBld(s) >= 200],
  ['forge10', (s) => maxForge(s) >= 10],
  ['forge50', (s) => maxForge(s) >= 50],
  ['expandMax', (s) => s.vlv >= EXPANSIONS.length],
  ['allClasses', (s) => CLASS_KEYS.every((c) => s.npcs.some((n) => n.role === 'fighter' && n.cls === c))],
  ['leisure', (s) => has(s, 'spa') && has(s, 'theater') && has(s, 'arena')],
  ['year16', (s) => s.scored],
  ['rankA', (s) => !!s.score && (s.score.rank === 'A' || s.score.rank === 'S')],
  ['rankS', (s) => s.score?.rank === 'S'],
  ['allVillages', (_s, m) => m.unlocked >= VILLAGES.length - 1],
  ['bossSlayer', (s) => s.npcs.some((n) => (n.bosses ?? 0) > 0)],
  ['bossHunter5', (s) => s.npcs.reduce((a, n) => a + (n.bosses ?? 0), 0) >= 15],
  ['shiny', (s) => s.shinySeen.length >= 1],
  ['shiny10', (s) => s.shinySeen.length >= 10],
  ['partners', (s) => s.npcs.some((n) => n.partner != null)],
  ['wedding', (s) => s.couples.length >= 1],
  ['family', (s) => s.couples.some((c) => c.kids > 0)],
  ['titled', (s) => s.npcs.some((n) => (n.titles?.length ?? 0) >= 3)],
  ['combo1', (s) => s.comboSeen.length >= 1],
  ['comboAll', (s) => COMBOS.every((c) => s.comboSeen.includes(c.key))],
  ['festival', (s) => festival(s) !== null],
  ['newspaper', (s) => s.reports.length >= 1],
  ['commission1', (s) => s.stats.commissions >= 1],
  ['commission30', (s) => s.stats.commissions >= 30],
  ['fame3', (s) => fameRank(s.fame) >= 3],
  ['fame6', (s) => fameRank(s.fame) >= 6],
  ['fameMax', (s) => fameRank(s.fame) >= 9],
  ['royalVisit', (s) => s.vips.includes('royal')],
  ['heroJoined', (s) => s.vips.includes('hero')],
  ['rivals', (s) => s.rivals.length >= 1],
  ['forgeAll', (s) => (['weapon', 'armor', 'accessory'] as const).every((slot) => EQUIP[slot].some((e) => (s.wlv[e.key] ?? 0) >= 10))],
  ['goods500', (s) => s.stats.goods >= 500],
  ['decor15', (s) => s.buildings.filter((b) => BUILDINGS[b.type].kind === 'decor').length >= 15],
  ['items40', (s) => s.disc.filter((k) => ITEMS[k]).length >= 40],
  ['catFriend', (s) => (s.cat?.lv ?? 0) >= 5],
  ['catBest', (s) => (s.cat?.lv ?? 0) >= 10],
  ['tamer', (s) => s.pets.length >= 1],
  ['promoted', (s) => s.npcs.some((n) => n.promoted)],
  ['research10', (s) => Object.values(s.research).reduce((a, b) => a + b, 0) >= 10],
  ['deep10', (s) => Object.values(s.depth).some((d) => d >= 9)],
];

export function checkAchievements(s: GameState, m: Meta): string[] {
  const fresh: string[] = [];
  for (const [id, check] of ACHIEVEMENTS) {
    if (m.ach[id] || !check(s, m)) continue;
    m.ach[id] = Date.now();
    fresh.push(id);
  }
  return fresh;
}
