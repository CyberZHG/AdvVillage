import { DAY, DAYS_PER_MONTH, DAYS_PER_YEAR } from './constants';
import { BUILDINGS, MONSTERS } from './data';
import { addItem, assignHousing, freeBeds, log, makeNpc, monsterStats, newId, residents, year } from './state';
import { pick } from './util';
import { VB, isLava, randomZoneTile, syncBounds, syncBuried, villageDist } from './world';
import { MAP } from './constants';
import { villageDef } from './data';
import type { GameState, Monster } from './types';

// one festival of its own for each village, on a fixed day of the year: [month, day]
export const VILLAGE_FEST: Record<string, [string, number, number]> = {
  maple: ['riverLanterns', 5, 8], iron: ['forging', 6, 2], mist: ['fireflies', 5, 5], frost: ['iceSculpture', 10, 8], sun: ['bazaar', 3, 8],
};
export function villageFest(s: GameState): string | null {
  const f = VILLAGE_FEST[s.village];
  if (!f) return null;
  const month = Math.floor((s.day % DAYS_PER_YEAR) / DAYS_PER_MONTH), d = s.day % DAYS_PER_MONTH;
  return f[1] === month && f[2] === d ? f[0] : null;
}

// a local character each village grows: boatman, mine foreman, herb gatherer, hunter, camel driver
export const VILLAGE_JOB: Record<string, string> = { maple: 'boatman', iron: 'foreman', mist: 'herbalist', frost: 'hunter', sun: 'cameleer' };
export const hasLocal = (s: GameState) => s.npcs.some((n) => n.job === VILLAGE_JOB[s.village]);

// each village's storyline: four steps, each checked every day
type Step = [string, (s: GameState) => boolean];
const has = (s: GameState, t: string, n = 1) => s.buildings.filter((b) => b.type === t).length >= n;
const STEPS: Record<string, Step[]> = {
  maple: [['riverPort', (s) => has(s, 'riverPort')], ['boats', (s) => (s.vstat?.boats ?? 0) >= 3], ['waterMill', (s) => has(s, 'waterMill')], ['pop100', (s) => residents(s).length >= 100]],
  iron: [['mineShaft', (s) => has(s, 'mineShaft')], ['quarry', (s) => has(s, 'quarry')], ['forge10', (s) => s.buildings.some((b) => b.type === 'forge' && b.level >= 10)], ['forged', (s) => Object.values(s.wlv).reduce((a, b) => a + b, 0) >= 30]],
  mist: [['stilts', (s) => has(s, 'stiltHouse')], ['herbGarden', (s) => has(s, 'herbGarden')], ['fog', (s) => (s.vstat?.fogKills ?? 0) >= 200], ['mudBath', (s) => has(s, 'mudBath')]],
  frost: [['snowLodge', (s) => has(s, 'snowLodge')], ['fishingDock', (s) => has(s, 'fishingDock')], ['ice', (s) => (s.vstat?.iceFish ?? 0) >= 10], ['bosses', (s) => s.ys.bosses >= 3 || s.stats.kills >= 2000]],
  sun: [['caravanserai', (s) => has(s, 'caravanserai')], ['dug', (s) => (s.vstat?.dug ?? 0) >= 30], ['waterMill', (s) => has(s, 'waterMill')], ['rich', (s) => s.stats.earned >= 1_000_000]],
};
export const questSteps = (s: GameState) => STEPS[s.village] ?? [];

// trade: every village has a specialty it can send to the others
export const SPECIALTY: Record<string, string> = { maple: 'pearl', iron: 'silverOre', mist: 'herb', frost: 'pelt', sun: 'amber' };
export const TRADE_OUT = 20, TRADE_IN = 15, TRADE_DAYS = 5;
export function sendTrade(s: GameState, to: string): boolean {
  const out = SPECIALTY[s.village], into = SPECIALTY[to];
  if (!out || !into || to === s.village || (s.items[out] ?? 0) < TRADE_OUT || (s.trades?.length ?? 0) >= 2) return false;
  s.items[out] -= TRADE_OUT;
  (s.trades ??= []).push({ to, until: s.time + TRADE_DAYS * DAY, item: into, count: TRADE_IN });
  log(s, 'log.tradeSent', { v: `@village.${to}.name`, i: `@item.${out}` });
  return true;
}

function spawnNear(s: GameState, type: string, n: number) {
  if (!MONSTERS[type]) return;
  for (let k = 0; k < n; k++) {
    let p = randomZoneTile(0);
    for (let j = 0; j < 20 && villageDist(p.x, p.y) > 4; j++) p = randomZoneTile(0);
    const m: Monster = { id: newId(s), type, x: p.x + 0.5, y: p.y + 0.5, hp: 0, tx: p.x + 0.5, ty: p.y + 0.5, target: null, cd: 0, facing: 1, zone: 0, wait: 1, lv: s.mlv[type].level + 2 };
    m.hp = monsterStats(s, type, m).maxHp;
    s.monsters.push(m);
  }
}

export function villageDailyExtras(s: GameState) {
  // the volcano's lava finds a new way down each new year, burying whatever grew in its path
  if (s.day % DAYS_PER_YEAR === 0 && s.day > 0 && villageDef(s.village).terrain.volcano) {
    syncBounds(s);
    s.nodes = s.nodes.filter((n) => !isLava(n.x, n.y));
    log(s, 'log.lavaShift');
  }
  // snow piles up over snowy days and melts away after; the snowfield never quite loses its cover
  const floor = villageDef(s.village).ground === 'snow' ? 1 : 0;
  s.snow = Math.max(floor, Math.min(3, (s.snow ?? floor) + (s.weather === 'snow' ? 1 : -1)));
  disasterDaily(s);
  legendDaily(s);
  // on a clear winter night now and then the frost village holds its aurora festival
  if (s.village === 'frost' && Math.floor((s.day % DAYS_PER_YEAR) / 30) === 3 && s.day % 10 === 5 && s.weather === 'clear') { log(s, 'log.aurora'); s.fame = (s.fame ?? 0) + 5; }
  const f = villageFest(s);
  if (f) log(s, 'log.vfest', { f: `@vfest.${f}` });
  // storyline
  const steps = questSteps(s);
  const k = s.vquest ?? 0;
  if (k < steps.length && steps[k][1](s)) {
    s.vquest = k + 1;
    const reward = 1500 * (k + 1) * Math.max(1, year(s));
    s.money += reward;
    log(s, 'log.vquest', { q: `@vq.${s.village}.${steps[k][0]}`, v: reward });
  }
  // a local character turns up once the village has room
  if (!hasLocal(s) && year(s) >= 2 && residents(s).length >= 20 && freeBeds(s) > 0) {
    const n = makeNpc(s, 'civilian', VB.max, (VB.min + VB.max) >> 1);
    n.job = VILLAGE_JOB[s.village]; n.money = 100;
    s.npcs.push(n);
    assignHousing(s);
    log(s, 'log.vjob', { j: `@job.${n.job}` });
  }
  // the local character's daily help
  if (hasLocal(s)) {
    if (s.village === 'mist') addItem(s, 'herb', 2);
    if (s.village === 'frost') { addItem(s, 'meat', 2); addItem(s, 'pelt', 1); }
    if (s.village === 'iron' && s.vein != null) s.vein = Math.min(1, s.vein + 0.005);
  }
  // trade caravans arriving home
  if (s.trades?.length) {
    const back = s.trades.filter((t) => t.until <= s.time);
    for (const t of back) { addItem(s, t.item, t.count); log(s, 'log.tradeBack', { v: `@village.${t.to}.name`, i: `@item.${t.item}`, n: t.count }); }
    s.trades = s.trades.filter((t) => t.until > s.time);
  }
  // each village's own trouble
  if (s.village === 'mist' && s.day % 40 === 17) { spawnNear(s, pick(['swampSlime', 'bogToad', 'bogLantern']), 6); log(s, 'log.threat.mist'); }
  if (s.village === 'frost' && s.weather === 'snow' && Math.random() < 0.3) { spawnNear(s, pick(['frostWolf', 'frostFox', 'yeti']), 3); log(s, 'log.threat.frost'); }
  if (s.village === 'sun' && s.weather === 'sandstorm') { spawnNear(s, 'sandWorm', 2); log(s, 'log.threat.sun'); }
  if (s.village === 'iron' && s.day % 30 === 11 && s.terrain?.cave?.length) { spawnNear(s, 'caveBat', 5); log(s, 'log.threat.iron'); }
}

// ---------- disasters ----------
// each village has a trouble of its own, and a building that guards against it
export const DISASTER: Record<string, { k: string; perk: string; days: number }> = {
  maple: { k: 'wildfire', perk: 'fireWatch', days: 2 }, iron: { k: 'rockslide', perk: 'rockGuard', days: 3 }, mist: { k: 'plague', perk: 'plagueWard', days: 5 },
  frost: { k: 'avalanche', perk: 'avalancheGuard', days: 3 }, sun: { k: 'drought', perk: 'droughtGuard', days: 6 },
};
function disasterDaily(s: GameState) {
  const d = DISASTER[s.village], se = Math.floor((s.day % DAYS_PER_YEAR) / DAYS_PER_MONTH / 3);
  if (!d) return;
  if (s.disaster && s.disaster.until <= s.time) { if (!s.disaster.saved) log(s, `dis.${s.disaster.k}.end`); s.disaster = null; }
  if (s.disaster || year(s) < 2) return;
  const odds = d.k === 'wildfire' ? (se === 1 && s.weather === 'clear' ? 0.04 : 0) : d.k === 'avalanche' ? (s.weather === 'snow' ? 0.025 : 0) : d.k === 'drought' ? (se === 1 ? 0.03 : 0) : d.k === 'plague' ? (s.weather === 'fog' || s.weather === 'rain' ? 0.025 : 0.005) : 0.015;
  if (Math.random() >= odds) return;
  // the sun village's aqueduct ends drought for good
  const saved = s.buildings.some((b) => BUILDINGS[b.type].perk === d.perk) || (d.k === 'drought' && megaDone(s));
  const p = randomZoneTile(d.k === 'avalanche' || d.k === 'rockslide' ? 1 : 0);
  s.disaster = { k: d.k, until: s.time + (saved ? 1 : d.days) * DAY, x: p.x, y: p.y, saved };
  if (saved) { log(s, `dis.${d.k}.saved`); return; }
  log(s, `dis.${d.k}`);
  if (d.k === 'wildfire') {
    // the fire takes the trees around where it starts and the village spends to put it out
    const burnt = s.nodes.filter((n) => n.kind === 'tree' && Math.hypot(n.x - p.x, n.y - p.y) < 5);
    s.nodes = s.nodes.filter((n) => !burnt.includes(n));
    s.money = Math.max(0, s.money - 300 * year(s));
  }
  if (d.k === 'rockslide' || d.k === 'avalanche') {
    // rock or snow buries a stretch of the roads out of the village for a few days
    const out = s.roads.filter((i) => villageDist(i % MAP, (i / MAP) | 0) > 0 && villageDist(i % MAP, (i / MAP) | 0) < 12);
    for (let k = 0; k < 4 && out.length; k++) (s.buried ??= []).push({ i: out.splice(Math.floor(Math.random() * out.length), 1)[0], until: s.time + d.days * DAY });
    syncBuried(s.buried);
  }
}

// ---------- legendary beasts ----------
// once a year, on its own day, each village's legendary beast comes out of the wilds: a giant of its local creature
export const LEGEND: Record<string, { type: string; day: number; relic: string }> = {
  maple: { type: 'mossTurtle', day: 75, relic: 'heartwood' }, iron: { type: 'rockMole', day: 55, relic: 'magmaHeart' }, mist: { type: 'bogLantern', day: 95, relic: 'mistPearl' },
  frost: { type: 'frostFox', day: 105, relic: 'everIce' }, sun: { type: 'dustDevil', day: 65, relic: 'sunStone' },
};
export const LEGEND_TITLE = 7;
function legendDaily(s: GameState) {
  const L = LEGEND[s.village];
  if (!L || s.day % DAYS_PER_YEAR !== L.day || year(s) < 2 || !MONSTERS[L.type]) return;
  if (s.monsters.filter((m) => m.boss != null).length >= 3) return;
  const fs = s.npcs.filter((n) => n.role === 'fighter').map((n) => n.level).sort((a, b) => b - a).slice(0, 6);
  const top = fs.length ? fs.reduce((a, b) => a + b, 0) / fs.length : 5;
  let p = randomZoneTile(1);
  for (let k = 0; k < 20 && villageDist(p.x, p.y) > 6; k++) p = randomZoneTile(1);
  const m: Monster = { id: newId(s), type: L.type, x: p.x + 0.5, y: p.y + 0.5, hp: 0, tx: p.x + 0.5, ty: p.y + 0.5, target: null, cd: 0, facing: 1, zone: 1, wait: 2, boss: LEGEND_TITLE, lv: Math.max(12, Math.round(top * 1.3)) };
  m.hp = monsterStats(s, L.type, m).maxHp * 3;
  s.monsters.push(m);
  log(s, 'ev.legend', { m: '@m.' + L.type, lv: m.lv! });
}

// ---------- megaprojects ----------
// a great work each village can raise over the years, five stages, each changing the map a little more
export const MEGA: Record<string, string> = { maple: 'bridge', iron: 'tunnel', mist: 'causeway', frost: 'baths', sun: 'aqueduct' };
export const MEGA_STAGES = 5;
const PRODUCT: Record<string, string> = { maple: 'mapleSyrup', iron: 'steel', mist: 'remedy', frost: 'furCoat', sun: 'spice' };
export function megaCost(s: GameState) {
  const k = (s.mega ?? 0) + 1;
  return { money: 6000 * k, wood: 150 * k, stone: 200 * k, mat: PRODUCT[s.village], count: 4 * k };
}
export const megaDone = (s: GameState) => (s.mega ?? 0) >= MEGA_STAGES;
export function canMega(s: GameState) {
  if (!MEGA[s.village] || megaDone(s) || year(s) < 3) return false;
  const c = megaCost(s);
  return s.money >= c.money && (s.items.wood ?? 0) >= c.wood && (s.items.stone ?? 0) >= c.stone && (s.items[c.mat] ?? 0) >= c.count;
}
export function advanceMega(s: GameState): boolean {
  if (!canMega(s)) return false;
  const c = megaCost(s);
  s.money -= c.money; s.items.wood -= c.wood; s.items.stone -= c.stone; s.items[c.mat] -= c.count;
  s.mega = (s.mega ?? 0) + 1;
  log(s, megaDone(s) ? 'log.megaDone' : 'log.megaStage', { p: `@mega.${MEGA[s.village]}`, k: s.mega, n: MEGA_STAGES });
  return true;
}
