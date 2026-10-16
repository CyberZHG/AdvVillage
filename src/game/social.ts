import { DAYS_PER_YEAR, HOUSE_CAP, SOUTH_EXIT } from './constants';
import { bld, fx, housed, log, makeNpc, npcById } from './state';
import { chance } from './util';
import type { GameState, Npc } from './types';

interface Bonus { atk?: number; def?: number; hp?: number }
type TitleDef = [string, (n: Npc) => boolean, Bonus];

const fam = (n: Npc, ...k: string[]) => k.reduce((a, f) => a + (n.fk?.[f] ?? 0), 0);

// small, stacking bonuses: every earned title counts, the newest one is shown
export const TITLES: TitleDef[] = [
  ['slimeBane', (n) => fam(n, 'slime') >= 60, { atk: 0.03 }],
  ['beastHunter', (n) => fam(n, 'beast', 'boar', 'bear') >= 80, { atk: 0.03 }],
  ['bugCrusher', (n) => fam(n, 'spider', 'scorpion', 'beetle') >= 40, { def: 0.03 }],
  ['exorcist', (n) => fam(n, 'ghost', 'wisp') >= 30, { atk: 0.03 }],
  ['giantSlayer', (n) => fam(n, 'golem', 'bear') >= 40, { def: 0.03 }],
  ['dragonSlayer', (n) => fam(n, 'dragon') >= 1, { atk: 0.05 }],
  ['veteran', (n) => n.kills >= 500, { def: 0.04 }],
  ['bossHunter', (n) => (n.bosses ?? 0) >= 1, { atk: 0.05 }],
  ['explorer', (n) => (n.exps ?? 0) >= 5, { hp: 0.05 }],
  ['survivor', (n) => (n.downs ?? 0) >= 10, { def: 0.05 }],
  ['wealthy', (n) => n.money >= 50000, { hp: 0.03 }],
  ['legend', (n) => n.level >= 200, { atk: 0.05, hp: 0.05 }],
];
const TITLE_BONUS = new Map(TITLES.map(([k, , b]) => [k, b]));

export function titleBonus(n: Npc): Required<Bonus> {
  const out = { atk: 1, def: 1, hp: 1 };
  for (const k of n.titles ?? []) {
    const b = TITLE_BONUS.get(k);
    if (!b) continue;
    out.atk += b.atk ?? 0; out.def += b.def ?? 0; out.hp += b.hp ?? 0;
  }
  return out;
}

export function emote(s: GameState, n: Npc, kind: string) {
  fx(s, 'emote', n.x, n.y, `${n.id}:${kind}`);
}

export function checkTitles(s: GameState, n: Npc) {
  if (n.role !== 'fighter') return;
  for (const [k, ok] of TITLES) {
    if (n.titles?.includes(k) || !ok(n)) continue;
    (n.titles ??= []).push(k);
    n.title = k;
    emote(s, n, 'star');
    log(s, 'log.title', { n: '@name:' + n.name, t: `@title.${k}` });
  }
}

const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

export function bondFight(s: GameState, team: Npc[]) {
  if (team.length < 2) return;
  for (let i = 0; i < team.length; i++) for (let j = i + 1; j < team.length; j++) {
    const a = team[i], b = team[j], k = pairKey(a.id, b.id);
    const v = (s.bonds[k] = (s.bonds[k] ?? 0) + 1);
    if (v >= 60 && a.partner == null && b.partner == null) {
      a.partner = b.id; b.partner = a.id;
      emote(s, a, 'heart'); emote(s, b, 'heart');
      log(s, 'log.partner', { a: '@name:' + a.name, b: '@name:' + b.name });
    }
    if (v >= 200 && a.partner === b.id && a.spouse == null && b.spouse == null && chance(0.02)) marry(s, a, b);
  }
}

function marry(s: GameState, a: Npc, b: Npc) {
  a.spouse = b.id; b.spouse = a.id;
  s.couples.push({ a: a.id, b: b.id, since: s.day, kids: 0 });
  const home = bld(s, a.home);
  if (home && housed(s, home) < HOUSE_CAP) b.home = home.id;
  emote(s, a, 'heart'); emote(s, b, 'heart');
  log(s, 'log.married', { a: '@name:' + a.name, b: '@name:' + b.name });
}

// a married couple may raise a child who later joins the adventurers
export function familyDaily(s: GameState) {
  s.couples = s.couples.filter((c) => npcById(s, c.a) && npcById(s, c.b));
  for (const c of s.couples) {
    if (c.kids >= 1 || s.day - c.since < DAYS_PER_YEAR || !chance(1 / 240)) continue;
    const a = npcById(s, c.a)!, b = npcById(s, c.b)!;
    const kid = makeNpc(s, 'fighter', SOUTH_EXIT.x, SOUTH_EXIT.y);
    kid.look = { ...kid.look, skin: chance(0.5) ? a.look.skin : b.look.skin, hair: chance(0.5) ? a.look.hair : b.look.hair };
    kid.home = a.home;
    s.npcs.push(kid);
    c.kids++;
    log(s, 'log.child', { a: '@name:' + a.name, b: '@name:' + b.name, n: '@name:' + kid.name, c: '@cls.' + kid.cls });
  }
}

export function partnerOf(s: GameState, n: Npc) {
  return n.partner != null ? npcById(s, n.partner) : undefined;
}
