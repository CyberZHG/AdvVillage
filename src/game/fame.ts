import { DAY, SOUTH_EXIT } from './constants';
import { BUILDINGS, EQUIP } from './data';
import { bldExpNeed, gainExp, lvMult } from './level';
import { assignHousing, log, makeNpc, note, year } from './state';
import { makeLook } from './looks';
import { newMerchant } from './events';
import { pick, randi } from './util';
import type { Building, GameState, Npc } from './types';

export const FAME_RANKS = [0, 60, 180, 400, 800, 1500, 2600, 4200, 6500, 10000];
export const fameRank = (fame: number) => FAME_RANKS.filter((v) => fame >= v).length - 1;
export const fameTouristMult = (s: GameState) => 1 + 0.06 * fameRank(s.fame);

// special guests and the fame rank that brings them
export const VIPS: [string, number][] = [['critic', 1], ['caravan', 2], ['royal', 3], ['smith', 4], ['hero', 5], ['sage', 6]];

export function addFame(s: GameState, v: number) {
  const before = fameRank(s.fame);
  s.fame += v;
  s.ys.fame = (s.ys.fame ?? 0) + v;
  const after = fameRank(s.fame);
  if (after > before) {
    log(s, 'log.fameRank', { r: `@fame.${after}` });
    note(s, 'log.fameRank', { r: `@fame.${after}` });
  }
}

const VISIT_KINDS = ['food', 'shop', 'fun', 'souvenir', 'inn', 'decor'];
const byAppeal = (s: GameState, kinds: string[]) => s.buildings
  .filter((b) => kinds.includes(BUILDINGS[b.type].kind))
  .sort((a, b) => BUILDINGS[b.type].attraction * lvMult(b.level) - BUILDINGS[a.type].attraction * lvMult(a.level));

function guest(s: GameState, job: string, vip: string, money: number, plan: Building[]) {
  const n = makeNpc(s, 'tourist', SOUTH_EXIT.x, SOUTH_EXIT.y);
  n.job = job; n.vip = vip; n.look = makeLook('tourist', 'warrior', job);
  n.money = money;
  n.plan = plan.map((b) => b.id);
  s.npcs.push(n);
}

function arrive(s: GameState, k: string) {
  const y = year(s);
  switch (k) {
    case 'critic': guest(s, 'critic', k, 400 + 120 * y, byAppeal(s, ['food', 'fun']).slice(0, 3)); break;
    case 'royal': guest(s, 'royal', k, 2500 * y, byAppeal(s, VISIT_KINDS).slice(0, 5)); break;
    case 'caravan': newMerchant(s, true); break;
    case 'smith': s.effects.push({ k: 'smith', until: s.time + 10 * DAY }); break;
    case 'sage': s.effects.push({ k: 'sage', until: s.time + 10 * DAY }); break;
    case 'hero': {
      const fighters = s.npcs.filter((n) => n.role === 'fighter').map((n) => n.level);
      const lv = Math.max(10, ...fighters);
      const n = makeNpc(s, 'fighter', SOUTH_EXIT.x, SOUTH_EXIT.y, lv);
      const tier = Math.min(EQUIP.weapon.length, 2 + Math.floor(Math.sqrt(lv) / 2));
      n.weapon = EQUIP.weapon[tier - 1].key; n.armor = EQUIP.armor[tier - 1].key; n.accessory = EQUIP.accessory[tier - 2]?.key ?? null;
      n.money = 200 * lv; n.vip = 'hero';
      n.bio = [{ t: s.day, k: 'bio.hero' }];
      s.npcs.push(n);
      assignHousing(s);
      log(s, 'vip.hero', { n: '@name:' + n.name, c: '@cls.' + n.cls, lv });
      note(s, 'vip.hero', { n: '@name:' + n.name, c: '@cls.' + n.cls, lv });
      if (!s.vips.includes(k)) s.vips.push(k);
      return;
    }
  }
  if (!s.vips.includes(k)) s.vips.push(k);
  log(s, 'vip.' + k);
  note(s, 'vip.' + k);
}

export function vipDaily(s: GameState) {
  if (s.day < s.nextVip) return;
  s.nextVip = s.day + randi(25, 40);
  const r = fameRank(s.fame);
  const pool = VIPS.filter(([, need]) => r >= need);
  if (pool.length) arrive(s, pick(pool)[0]);
}

export const vipSpend = (n: Npc) => (n.vip === 'royal' ? 5 : n.vip === 'critic' ? 2 : 1);

// the critic's praise speeds the place's growth; a royal visit is remembered when they leave
export function vipVisit(s: GameState, n: Npc, b: Building) {
  if (n.vip !== 'critic') return;
  const kind = BUILDINGS[b.type].kind;
  if (kind !== 'food' && kind !== 'fun') return;
  gainExp(b, bldExpNeed(b.level) * 0.6, bldExpNeed);
  addFame(s, 4);
  log(s, 'vip.praise', { b: '@b.' + b.type });
}

export function vipLeave(s: GameState, n: Npc) {
  if (n.vip === 'royal') { addFame(s, 25); log(s, 'vip.royalLeft'); }
  if (n.vip === 'critic') log(s, 'vip.criticLeft');
}
