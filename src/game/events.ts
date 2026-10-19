import { DAY, DAYS_PER_MONTH, DAYS_PER_YEAR, SOUTH_EXIT } from './constants';
import { ITEMS, MONSTERS, culture, villageDef, zoneMonsters } from './data';
import { addItem, assignHousing, freeBeds, log, makeNpc, monsterStats, newId, year } from './state';
import { chance, pick, randi, weighted } from './util';
import { hasJob } from './jobs';
import { randomZoneTile, villageDist } from './world';
import type { GameState, Monster } from './types';

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export const season = (s: GameState) => Math.floor((s.day % DAYS_PER_YEAR) / DAYS_PER_MONTH / 3);
const dayOfMonth = (s: GameState) => s.day % DAYS_PER_MONTH;

export const FESTIVALS = ['flower', 'fireworks', 'harvest', 'lantern'];
// [festival, month (0-based), first day (0-based)]; each lasts three days. The default puts one in the middle
// month of every season; Chinese and Japanese calendars hold their new year on the first days of spring instead
const CALENDAR: Record<string, [string, number, number][]> = {
  en: [['flower', 1, 4], ['fireworks', 4, 4], ['harvest', 7, 4], ['lantern', 10, 4]],
  zh: [['flower', 1, 4], ['fireworks', 4, 4], ['harvest', 7, 4]],
  ja: [['lantern', 0, 0], ['flower', 1, 4], ['fireworks', 4, 4], ['harvest', 7, 4]],
};
// the Spring Festival moves like the lunar new year: some day in the first or second month, fixed per year
export function springFestival(s: GameState): [number, number] {
  const y = Math.floor(s.day / DAYS_PER_YEAR), v = Math.sin((y + 1) * 91.37 + s.village.length * 7.3) * 43758.5453, h = Math.floor((v - Math.floor(v)) * 1000);
  return [h % 2, (h >> 1) % 8];
}
const festivalAt = (s: GameState) => {
  const month = Math.floor((s.day % DAYS_PER_YEAR) / DAYS_PER_MONTH), d = dayOfMonth(s);
  const list = [...(CALENDAR[culture.lang] ?? CALENDAR.en)];
  if (culture.lang === 'zh') list.unshift(['lantern', ...springFestival(s)]);
  return list.find(([, m, from]) => m === month && d >= from && d < from + 3) ?? null;
};
export const festival = (s: GameState): string | null => festivalAt(s)?.[0] ?? null;

// smaller observances, one day each, keyed by [month, day] per language
const OBSERVANCES: Record<string, [string, number, number][]> = {
  zh: [['qixi', 6, 6], ['chongyang', 8, 8]],
  ja: [['setsubun', 0, 3], ['hina', 1, 2], ['koinobori', 4, 4], ['obon', 6, 6], ['shichigosan', 10, 4]],
};
export function observance(s: GameState): string | null {
  const month = Math.floor((s.day % DAYS_PER_YEAR) / DAYS_PER_MONTH), d = dayOfMonth(s);
  const hit = (OBSERVANCES[culture.lang] ?? []).find(([, m, dd]) => m === month && dd === d);
  if (hit) return hit[0];
  // the Lantern Festival closes the Spring Festival on its last night
  if (culture.lang === 'zh') { const [m, dd] = springFestival(s); if (m === month && d === dd + 2) return 'yuanxiao'; }
  return null;
}
// twenty-four solar terms, two a month starting with the Beginning of Spring
export function solarTerm(s: GameState): number | null {
  if (culture.lang !== 'zh') return null;
  const month = Math.floor((s.day % DAYS_PER_YEAR) / DAYS_PER_MONTH), d = dayOfMonth(s);
  return d === 0 ? month * 2 : d === 5 ? month * 2 + 1 : null;
}
// the Japanese rainy season fills the start of summer
export const tsuyu = (s: GameState) => culture.lang === 'ja' && Math.floor((s.day % DAYS_PER_YEAR) / DAYS_PER_MONTH) === 3;
// true on the festival's opening day
export const festivalStarts = (s: GameState) => { const f = festivalAt(s); return !!f && dayOfMonth(s) === f[2]; };

// what people want changes with the weather: these places draw bigger crowds and pay more in their season
export const SEASON_HOT: string[][] = [
  ['teahouse', 'cafe', 'bakery'], ['tavern', 'souvenirShop', 'cafe'], ['restaurant', 'bakery', 'theater'], ['bathhouse', 'spa', 'inn', 'teahouse'],
];
export const hotNow = (s: GameState, type: string) => SEASON_HOT[season(s)].includes(type);

export const hasEffect = (s: GameState, k: string) => s.effects.some((e) => e.k === k && e.until > s.time);

export function touristMult(s: GameState) {
  let m = 1;
  if (festival(s)) m *= 2;
  if (hasEffect(s, 'bard')) m *= 1.4;
  if (s.weather === 'rain') m *= 0.7;
  if (s.weather === 'storm') m *= 0.4;
  if (s.weather === 'fog') m *= 0.85;
  if (s.weather === 'sandstorm') m *= 0.4;
  if (s.village === 'sun' && s.day % DAYS_PER_YEAR === 38) m *= 1.5;
  // the desert's midday heat keeps visitors in the shade
  if (s.village === 'sun' && (s.time % DAY) / DAY > 0.3 && (s.time % DAY) / DAY < 0.5) m *= 0.6;
  // a plague keeps visitors away; the marsh causeway and the frost baths draw more
  if (s.disaster?.k === 'plague' && !s.disaster.saved && s.disaster.until > s.time) m *= 0.6;
  if ((s.mega ?? 0) >= 5 && (s.village === 'mist' || (s.village === 'frost' && season(s) === 3))) m *= 1.2;
  return m;
}
// street performers loosen purses; geisha at a festival even more so
export const spendMult = (s: GameState) => (festival(s) ? 1.2 * (hasJob(s, 'geisha') ? 1.1 : 1) : 1) * (hasJob(s, 'performer') ? 1.05 : 1);
// in the marsh village fog draws more monsters out
export const monsterMult = (s: GameState) => (hasEffect(s, 'frenzy') ? 1.6 : 1) * (s.village === 'mist' && s.weather === 'fog' ? 1.5 : 1);

function rollWeather(s: GameState) {
  const g = villageDef(s.village).ground, se = season(s);
  if (tsuyu(s) && g !== 'sand' && g !== 'snow' && Math.random() < 0.65) return 'rain';
  const term = solarTerm(s);
  if (term === 2) return 'storm';
  if (term === 4) return 'rain';
  const snowy = g === 'snow' || se === 3;
  const r = Math.random();
  if (snowy && r < (g === 'snow' ? 0.4 : 0.3)) return 'snow';
  if (g === 'sand') return r < 0.07 ? 'sandstorm' : 'clear';
  if (r < 0.04 + (se === 1 ? 0.04 : 0)) return 'storm';
  if (r < (g === 'marsh' ? 0.35 : 0.2)) return 'rain';
  // fog rolls in on damp mornings; the marsh is wrapped in it often
  if (r < (g === 'marsh' ? 0.6 : se === 0 || se === 2 ? 0.27 : 0.22)) return 'fog';
  return 'clear';
}

type EventFn = (s: GameState) => boolean;
const EVENTS: [string, number, EventFn][] = [
  ['harvest', 3, (s) => { const v = 30 + year(s) * 20; addItem(s, 'fruit', v); log(s, 'ev.harvest', { v }); return true; }],
  ['meteor', 2, (s) => { const v = 1 + Math.floor(year(s) / 3); addItem(s, 'starDust', v); s.effects.push({ k: 'meteor', until: s.time + DAY }); log(s, 'ev.meteor', { v }); return true; }],
  ['bard', 2, (s) => { s.effects.push({ k: 'bard', until: s.time + 5 * DAY }); log(s, 'ev.bard'); return true; }],
  ['frenzy', 2, (s) => { s.effects.push({ k: 'frenzy', until: s.time + 3 * DAY }); log(s, 'ev.frenzy'); return true; }],
  ['caravan', 2, (s) => { const v = 400 * year(s); s.money += v; log(s, 'ev.caravan', { v }); return true; }],
  ['treasure', 1, (s) => { const v = randi(1, 3); addItem(s, 'gem', v); const m = 200 * year(s); s.money += m; log(s, 'ev.treasure', { v, m }); return true; }],
  // a thief in the night: the watchman or a ninja catches him, otherwise a little of the treasury goes missing
  ['thief', 2, (s) => {
    if (hasJob(s, 'ninja') || hasJob(s, 'watchman')) { const v = 120 * year(s); s.money += v; log(s, 'ev.thiefCaught', { j: `@job.${hasJob(s, 'ninja') ? 'ninja' : 'watchman'}`, v }); return true; }
    const v = Math.min(Math.round(s.money * 0.03), 600 * year(s));
    if (v <= 0) return false;
    s.money -= v; log(s, 'ev.thief', { v }); return true;
  }],
  ['lost', 2, (s) => {
    if (freeBeds(s) <= 0) return false;
    const n = makeNpc(s, 'civilian', SOUTH_EXIT.x, SOUTH_EXIT.y);
    n.money = 80;
    s.npcs.push(n);
    assignHousing(s);
    log(s, 'ev.lost', { n: '@name:' + n.name });
    return true;
  }],
];

// a foreign caravan brings more and rarer goods at a kinder price
export function newMerchant(s: GameState, foreign = false) {
  const rare = Object.keys(ITEMS).filter((k) => !['wood', 'stone', 'fruit', 'meat', 'gel'].includes(k));
  const pool = rare.filter((k) => ITEMS[k].value <= 30 + year(s) * (foreign ? 16 : 8));
  const offers = Array.from({ length: foreign ? 5 : 3 }, () => {
    const item = pick(pool.length ? pool : rare);
    const count = randi(3, 8) + year(s);
    return { item, count, price: Math.round(ITEMS[item].value * count * (foreign ? 1.6 : 2.5)) };
  });
  s.merchant = { until: s.time + (foreign ? 6 : 4) * DAY, offers, foreign };
  if (!foreign) log(s, 'ev.merchant');
}

export function buyOffer(s: GameState, i: number): boolean {
  const o = s.merchant?.offers[i];
  if (!o || o.sold || s.money < o.price) return false;
  s.money -= o.price;
  addItem(s, o.item, o.count);
  o.sold = true;
  return true;
}

const BOSS_TITLES = 6;

// on the first day of the Spring Festival the Nian beast comes for the village
export function spawnNian(s: GameState) {
  const fighters = s.npcs.filter((n) => n.role === 'fighter').map((n) => n.level).sort((a, b) => b - a).slice(0, 6);
  const top = fighters.length ? fighters.reduce((a, b) => a + b, 0) / fighters.length : 5;
  const lv = Math.max(8, Math.round(top));
  let p = randomZoneTile(1);
  for (let k = 0; k < 20 && villageDist(p.x, p.y) > 5; k++) p = randomZoneTile(1);
  const m: Monster = {
    id: newId(s), type: 'nian', x: p.x + 0.5, y: p.y + 0.5, hp: 0, tx: p.x + 0.5, ty: p.y + 0.5,
    target: null, cd: 0, facing: 1, zone: 1, wait: 2, boss: NIAN_TITLE, lv,
  };
  m.hp = monsterStats(s, 'nian', m).maxHp;
  s.monsters.push(m);
  if (!s.seen.includes('nian')) s.seen.push('nian');
  log(s, 'ev.nian', { lv });
}
export const NIAN_TITLE = 6;

function spawnBoss(s: GameState) {
  const g = villageDef(s.village).ground;
  const zone = year(s) >= 3 ? 2 : 1;
  const list = zoneMonsters(zone, g, s.village).filter((k) => MONSTERS[k].zone >= 0);
  if (!list.length) return;
  const type = pick(list);
  const fighters = s.npcs.filter((n) => n.role === 'fighter').map((n) => n.level).sort((a, b) => b - a).slice(0, 6);
  const top = fighters.length ? fighters.reduce((a, b) => a + b, 0) / fighters.length : 5;
  const lv = Math.max(s.mlv[type].level + 5, Math.round(top * 1.1));
  let p = randomZoneTile(1);
  for (let k = 0; k < 20 && villageDist(p.x, p.y) > 6; k++) p = randomZoneTile(1);
  const m: Monster = {
    id: newId(s), type, x: p.x + 0.5, y: p.y + 0.5, hp: 0, tx: p.x + 0.5, ty: p.y + 0.5,
    target: null, cd: 0, facing: 1, zone: 1, wait: 2, boss: randi(0, BOSS_TITLES - 1), lv,
  };
  m.hp = monsterStats(s, type, m).maxHp;
  s.monsters.push(m);
  log(s, 'ev.boss', { t: `@boss.${m.boss}`, m: '@m.' + type, lv });
}

export const currentBoss = (s: GameState) => s.monsters.find((m) => m.boss != null);
// bosses stay until they are beaten, so only so many may be abroad at once; ordinary bosses leave room for the
// festival and legendary ones
export const MAX_BOSSES = 3;
export const bossCount = (s: GameState) => s.monsters.filter((m) => m.boss != null).length;
// while bosses roam the wilds the gatherers work warily: each one out cuts their yield, down to half
export const gatherMult = (s: GameState) => [1, 0.75, 0.6][bossCount(s)] ?? 0.5;

export function eventsDaily(s: GameState) {
  s.weather = rollWeather(s);
  s.effects = s.effects.filter((e) => e.until > s.time);
  const f = festival(s);
  if (f && festivalStarts(s)) log(s, 'ev.festival', { f: `@fest.${f}` });
  // the Nian leaves a brand-new village alone its first year
  if (f === 'lantern' && culture.lang === 'zh' && festivalStarts(s) && bossCount(s) < MAX_BOSSES && s.day >= DAYS_PER_YEAR) spawnNian(s);
  const term = solarTerm(s);
  if (term != null) log(s, 'log.term', { t: `@term.${term}` });
  const obs = observance(s);
  if (obs) log(s, 'log.observance', { o: `@obs.${obs}` });
  if (s.merchant && s.time > s.merchant.until) { s.merchant = null; log(s, 'ev.merchantLeft'); }
  if (!s.merchant && s.day > 20 && chance(1 / 30)) newMerchant(s);
  if (!f && s.day > 10 && chance(0.06)) {
    for (let k = 0; k < 3; k++) {
      const e = weighted(EVENTS, (x) => x[1])!;
      if (e[2](s)) break;
    }
  }
  if (s.day >= s.nextBoss && bossCount(s) < MAX_BOSSES - 1) {
    spawnBoss(s);
    s.nextBoss = s.day + randi(25, 45);
  }
}
