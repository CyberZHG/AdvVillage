import { DAYS_PER_YEAR, HOUSE_CAP, PROMOTE_LEVEL, SOUTH_EXIT } from './constants';
import { bio, bld, fx, housed, log, makeNpc, note, npcById } from './state';
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
    bio(s, n, 'bio.title', { t: `@title.${k}` });
    log(s, 'log.title', { n: '@name:' + n.name, t: `@title.${k}` });
  }
}

// reaching Lv.100 earns an advanced class, a cape and a small lasting boost
export function checkPromotion(s: GameState, n: Npc) {
  if (n.role !== 'fighter' || n.promoted || n.level < PROMOTE_LEVEL) return;
  n.promoted = true;
  n.look = { ...n.look, cape: true };
  emote(s, n, 'star');
  const p = { n: '@name:' + n.name, a: '@cls.' + n.cls, b: '@cls2.' + n.cls };
  bio(s, n, 'bio.promoted', { b: '@cls2.' + n.cls });
  log(s, 'log.promoted', p);
  note(s, 'log.promoted', p);
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
      bio(s, a, 'bio.partner', { n: '@name:' + b.name }); bio(s, b, 'bio.partner', { n: '@name:' + a.name });
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
  bio(s, a, 'bio.married', { n: '@name:' + b.name }); bio(s, b, 'bio.married', { n: '@name:' + a.name });
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
    kid.bio = [{ t: s.day, k: 'bio.born', p: { a: '@name:' + a.name, b: '@name:' + b.name } }];
    s.npcs.push(kid);
    c.kids++;
    bio(s, a, 'bio.child', { n: '@name:' + kid.name }); bio(s, b, 'bio.child', { n: '@name:' + kid.name });
    log(s, 'log.child', { a: '@name:' + a.name, b: '@name:' + b.name, n: '@name:' + kid.name, c: '@cls.' + kid.cls });
  }
}

export function partnerOf(s: GameState, n: Npc) {
  return n.partner != null ? npcById(s, n.partner) : undefined;
}

// fighters of the same class and similar strength keep an eye on each other
export function rivalsMonthly(s: GameState) {
  s.rivals = s.rivals.filter((r) => npcById(s, r.a) && npcById(s, r.b));
  const linked = new Set(s.rivals.flatMap((r) => [r.a, r.b]));
  for (const n of s.npcs) if (n.rival != null && !linked.has(n.id)) n.rival = null;
  const all = s.npcs.filter((n) => n.role === 'fighter');
  if (s.rivals.length >= Math.floor(all.length / 6)) return;
  const free = all.filter((n) => n.rival == null && n.level >= 5);
  for (const a of free) {
    if (a.rival != null || !chance(0.3)) continue;
    const b = free.find((o) => o !== a && o.rival == null && o.cls === a.cls && o.id !== a.partner && o.level / a.level > 0.8 && o.level / a.level < 1.25);
    if (!b) continue;
    a.rival = b.id; b.rival = a.id;
    s.rivals.push({ a: a.id, b: b.id, since: s.day, lead: a.level >= b.level ? a.id : b.id });
    bio(s, a, 'bio.rival', { n: '@name:' + b.name }); bio(s, b, 'bio.rival', { n: '@name:' + a.name });
    log(s, 'log.rival', { a: '@name:' + a.name, b: '@name:' + b.name, c: '@cls.' + a.cls });
    return;
  }
}

export function rivalsDaily(s: GameState) {
  for (const r of s.rivals) {
    const a = npcById(s, r.a), b = npcById(s, r.b);
    if (!a || !b || a.level === b.level) continue;
    const top = a.level > b.level ? a : b, other = top === a ? b : a;
    if (top.id === r.lead) continue;
    r.lead = top.id;
    bio(s, top, 'bio.overtook', { n: '@name:' + other.name, lv: top.level });
    log(s, 'log.overtook', { a: '@name:' + top.name, b: '@name:' + other.name, lv: top.level });
  }
}
