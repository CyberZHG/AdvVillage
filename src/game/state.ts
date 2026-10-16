import { CLASSES, CLASS_KEYS, EQUIP, MONSTERS, BUILDINGS, villageMods, equipByKey, type NodeKind } from './data';
import { HOUSE_CAP, DAY, NIGHT_START, MORNING } from './constants';
import { forgeMult, lvMult } from './level';
import { pick, randi, weighted } from './util';
import { baseRoads, inVillage, isRoad, randomZoneTile, syncBounds, syncRoads, villageDist, VB } from './world';
import { makeLook, randomJob } from './looks';
import { comboAppeal } from './combos';
import { titleBonus } from './social';
import { rbonus } from './research';
import type { Building, Cls, GameState, LogParam, Monster, Npc, ResNode, Role } from './types';

export const NAME_POOL = 128;

export const newId = (s: GameState) => s.nextId++;
export const emptyYear = (): GameState['ys'] => ({ income: 0, kills: 0, tourists: 0, quests: 0, expeditions: 0, bosses: 0, shinies: 0, commissions: 0, fame: 0, events: [] });
export const mods = (s: GameState) => villageMods(s.village);
export const bld = (s: GameState, id: number | null) => (id == null ? undefined : s.buildings.find((b) => b.id === id));
export const npcById = (s: GameState, id: number | null) => (id == null ? undefined : s.npcs.find((n) => n.id === id));
export const ofKind = (s: GameState, kind: string) => s.buildings.filter((b) => BUILDINGS[b.type].kind === kind);
export const guild = (s: GameState) => s.buildings.find((b) => b.type === 'guild')!;
export const tod = (s: GameState) => (s.time % DAY) / DAY;
export const isNight = (s: GameState) => tod(s) >= NIGHT_START || tod(s) < MORNING;
export const year = (s: GameState) => Math.floor(s.day / 120) + 1;
export const residents = (s: GameState) => s.npcs.filter((n) => n.role !== 'tourist');

const NOTABLE = /^(ev\.(?!merchantLeft)|vip\.|log\.(bossDown|shiny|married|child|combo|expanded|achievement|title|expReturn|score|commission|fameRank|rival|overtook))/;

export function log(s: GameState, k: string, p?: Record<string, LogParam>) {
  s.log.push({ t: s.day, k, p });
  if (s.ys && NOTABLE.test(k)) { s.ys.events.push({ t: s.day, k, p }); if (s.ys.events.length > 30) s.ys.events.shift(); }
  if (s.log.length > 120) s.log.splice(0, s.log.length - 120);
}

// a short line for the toast; the main loop shows the newest one and drops the rest
export function note(s: GameState, k: string, p?: Record<string, LogParam>) {
  s.notes.push({ t: s.day, k, p });
  if (s.notes.length > 5) s.notes.shift();
}

const BIO_CAP = 30;
// personal history shown on the resident card; the first entry (arrival) is always kept
export function bio(s: GameState, n: Npc, k: string, p?: Record<string, LogParam>) {
  if (n.role === 'tourist') return;
  const b = (n.bio ??= []);
  b.push({ t: s.day, k, p });
  if (b.length > BIO_CAP) b.splice(1, 1);
}

export function fx(s: GameState, kind: GameState['fx'][number]['kind'], x: number, y: number, v: string | number) {
  if (s.fx.length < 300) s.fx.push({ kind, x, y, v });
}

// prefer plain names; numbered variants ("Alden II") only once every base name is taken
export function freshName(s: GameState): number {
  const used = new Set([...s.npcs.map((n) => n.name), ...s.profiles.map((p) => p.name)]);
  for (let gen = 0; gen < 8; gen++) {
    const free = [];
    for (let i = gen * NAME_POOL; i < (gen + 1) * NAME_POOL; i++) if (!used.has(i)) free.push(i);
    if (free.length) return pick(free);
  }
  return randi(0, NAME_POOL * 8);
}


export function makeNpc(s: GameState, role: Role, x: number, y: number, level = 1, cls?: Cls, job?: string): Npc {
  const c = cls ?? pick(CLASS_KEYS);
  const j = job ?? randomJob(role);
  const n: Npc = {
    id: newId(s), role, cls: c, job: j, name: freshName(s),
    look: makeLook(role, c, j), level, exp: 0, hp: 1, hunger: 80, mood: 70, money: role === 'fighter' ? 60 : 30,
    home: null, x: x + 0.5, y: y + 0.5, path: [], state: 'idle', goal: null, goalId: 0, inside: null,
    timer: 0, cd: 0, facing: 1, weapon: null, armor: null, accessory: null, bag: {}, quest: null,
    carry: null, rescuer: null, downT: 0, repath: 0, profile: -1, plan: [], noFood: 0, kills: 0,
  };
  if (role !== 'tourist') n.bio = [{ t: s.day, k: 'bio.joined' }];
  if (role === 'fighter') { n.weapon = EQUIP.weapon[0].key; n.armor = EQUIP.armor[0].key; }
  n.hp = maxHp(s, n);
  return n;
}

const forged = (s: GameState, key: string | null) => forgeMult(key ? s.wlv[key] ?? 0 : 0);

export function maxHp(s: GameState, n: Npc): number {
  if (n.role !== 'fighter') return 40 + 5 * n.level;
  const c = CLASSES[n.cls];
  let hp = c.hp + c.hpG * n.level;
  hp += (equipByKey(n.armor)?.hp ?? 0) * forged(s, n.armor);
  hp += (equipByKey(n.accessory)?.hp ?? 0) * forged(s, n.accessory);
  hp *= titleBonus(n).hp * (n.promoted ? PROMOTE_BONUS : 1);
  return Math.round(hp);
}

export const PROMOTE_BONUS = 1.1;

export interface Stats { maxHp: number; atk: number; def: number; range: number; interval: number }

export function fighterStats(s: GameState, n: Npc): Stats {
  const c = CLASSES[n.cls];
  let atk = c.atk + c.atkG * n.level, def = c.def + c.defG * n.level;
  atk += (equipByKey(n.weapon)?.atk ?? 0) * forged(s, n.weapon);
  atk += (equipByKey(n.accessory)?.atk ?? 0) * forged(s, n.accessory);
  def += (equipByKey(n.armor)?.def ?? 0) * forged(s, n.armor);
  let m = 1;
  if (n.home == null) m *= 0.85;
  if (n.hunger < 20) m *= 0.75;
  if (n.mood > 70) m *= 1.05;
  if (rivalNear(s, n)) m *= 1.1;
  m *= (1 + rbonus(s, 'tactics')) * (n.promoted ? PROMOTE_BONUS : 1);
  const tb = titleBonus(n);
  return { maxHp: maxHp(s, n), atk: atk * m * tb.atk, def: def * m * tb.def, range: c.range, interval: c.interval };
}

// a rival fighting close by spurs both of them on
export function rivalNear(s: GameState, n: Npc): boolean {
  if (n.rival == null || (n.state !== 'fight' && n.state !== 'hunt')) return false;
  const r = npcById(s, n.rival);
  return !!r && (r.state === 'fight' || r.state === 'hunt') && Math.abs(r.x - n.x) + Math.abs(r.y - n.y) < 8;
}

// bosses carry their own level and a much larger health pool
export function monsterStats(s: GameState, type: string, m?: Monster) {
  const d = MONSTERS[type], L = m?.lv ?? s.mlv[type].level;
  const g = 1 + 0.25 * (L - 1);
  const hp = d.hp * g * (m?.boss != null ? 8 : 1) * (m?.shiny ? 1.5 : 1);
  const atk = d.atk * g * (m?.boss != null ? 1.4 : 1);
  return { maxHp: Math.round(hp), atk, def: d.def * (1 + 0.2 * (L - 1)) * (m?.boss != null ? 1.2 : 1), level: L };
}

export function debuffs(n: Npc): string[] {
  const out: string[] = [];
  if (n.role === 'tourist') return out;
  if (n.home == null) out.push('homeless');
  if (n.hunger < 20) out.push('hungry');
  return out;
}

export const housed = (s: GameState, b: Building) => s.npcs.filter((n) => n.home === b.id).length;
export const freeBeds = (s: GameState) =>
  ofKind(s, 'house').reduce((a, b) => a + HOUSE_CAP - housed(s, b), 0);

export function assignHousing(s: GameState) {
  const houses = ofKind(s, 'house');
  const order = (r: Role) => (r === 'civilian' ? 1 : 0);
  const homeless = s.npcs.filter((n) => n.home == null && n.role !== 'tourist').sort((a, b) => order(a.role) - order(b.role));
  for (const n of homeless) {
    const h = houses.find((b) => housed(s, b) < HOUSE_CAP);
    if (!h) break;
    n.home = h.id;
  }
}

export function attraction(s: GameState): number {
  return s.buildings.reduce((a, b) => a + BUILDINGS[b.type].attraction * lvMult(b.level), 0) + comboAppeal(s);
}

export function addItem(s: GameState, item: string, n: number) {
  s.items[item] = (s.items[item] ?? 0) + n;
  if (!s.disc.includes(item)) s.disc.push(item);
}

export function spawnNode(s: GameState, kind?: NodeKind, near = false) {
  const m = mods(s);
  const k = kind ?? weighted(['tree', 'rock', 'bush'] as NodeKind[], (t) => (t === 'tree' ? 4 * m.wood : t === 'rock' ? 2.5 * m.stone : 2.5 * m.fruit))!;
  const p = randomZoneTile(near || Math.random() < 0.7 ? 0 : 1);
  if (s.nodes.some((o) => o.x === p.x && o.y === p.y)) return;
  const node: ResNode = { id: newId(s), kind: k, x: p.x, y: p.y, amount: randi(6, 14), v: randi(0, 3) };
  s.nodes.push(node);
}

export function newGame(village: string): GameState {
  const s: GameState = {
    v: 3, village, vlv: 0, roads: [], time: DAY * 0.05, day: 0, money: 4000,
    items: { wood: 40, stone: 30, fruit: 30, meat: 0 },
    buildings: [], nodes: [], monsters: [], npcs: [], profiles: [], quests: [], exp: null,
    mlv: {}, wlv: {}, disc: ['wood', 'stone', 'fruit'], seen: [], nextId: 1, log: [], scored: false, score: null,
    timers: { spawn: 0, node: 0, rescue: 0 },
    stats: { income: 0, lastIncome: 0, kills: 0, tourists: 0, quests: 0, rescues: 0, expeditions: 0, expLocs: [], earned: 0, commissions: 0, goods: 0, fk: {} },
    comboSeen: [], weather: 'clear', effects: [], bonds: {}, couples: [], reports: [], ys: emptyYear(), shinySeen: [],
    merchant: null, nextBoss: 40, fx: [],
    fame: 0, commissions: [], cseason: -1, rivals: [], nextVip: 45, vips: [], notes: [],
    research: {}, researching: null, depth: {}, pets: [], cat: null, hist: [], histBase: { e: 0, t: 0, k: 0 },
  };
  const m = villageMods(village);
  for (const [k, d] of Object.entries(MONSTERS)) s.mlv[k] = { level: d.base + m.monsterLevel, exp: 0 };
  syncBounds(s);
  s.roads = baseRoads();
  syncRoads(s);
  s.buildings.push({ id: newId(s), type: 'guild', x: 30, y: 30, rot: 0, level: 1, exp: 0 });
  s.buildings.push({ id: newId(s), type: 'house', x: 30, y: 33, rot: 0, level: 1, exp: 0 });
  syncBounds(s);
  for (let i = 0; i < 55; i++) spawnNode(s, undefined, i < 30);
  for (let i = 0; i < 8; i++) {
    const x = VB.min + randi(0, VB.max - VB.min), y = VB.min + randi(0, VB.max - VB.min);
    if (inVillage(x, y) && villageDist(x, y) === 0 && (x < 27 || x > 36 || y < 27 || y > 36) && !isRoad(x, y))
      s.nodes.push({ id: newId(s), kind: 'tree', x, y, amount: randi(6, 10), v: randi(0, 3) });
  }
  const g = guild(s);
  for (const cls of ['warrior', 'archer', 'mage'] as Cls[]) s.npcs.push(makeNpc(s, 'fighter', g.x + 2, g.y + 1, 1, cls));
  s.npcs.push(makeNpc(s, 'gatherer', g.x + 2, g.y + 1, 1, undefined, 'forager'));
  assignHousing(s);
  log(s, 'log.welcome', { village: '@village.' + village + '.name' });
  return s;
}
