import {
  BUILDINGS, EQUIP, EXPEDITIONS, EXPEDITION_PARTY, FOODS, ITEMS, MONSTERS, NODE_ITEM, villageDef, zoneMonsters, spawnWeight,
  shopTier, equipByKey, isOpen, isPeak, type EquipDef, type NodeKind,
} from './data';
import { DAY, DAYS_PER_MONTH, DAYS_PER_YEAR, EAST_EXIT, SCORE_YEAR, SOUTH_EXIT } from './constants';
import { dropCount, expReward, famExpNeed, gainExp, lvMult } from './level';
import {
  addItem, assignHousing, attraction, bio, bld, fighterStats, freeBeds, fx, guild, isNight, log, makeNpc,
  maxHp, monsterStats, mods, newId, npcById, ofKind, spawnNode, tod, year, freshName, type Stats,
} from './state';
import { canForge, computeScore, earn, forgeUpgrade, goodsItem, goodsPrice, priceAt } from './econ';
import { rbonus, researchTick } from './research';
import { catDaily, catTick, catTouristBonus } from './cat';
import { petBonus, petsTick, tryTame } from './pets';
import { commissionsDaily } from './commissions';
import { addFame, fameTouristMult, vipDaily, vipLeave, vipSpend, vipVisit } from './fame';
import { makeLook, randomJob } from './looks';
import { currentBoss, eventsDaily, festival, hasEffect, hotNow, monsterMult, spendMult, touristMult } from './events';
import { bondFight, checkPromotion, checkTitles, emote, familyDaily, partnerOf, rivalsDaily, rivalsMonthly } from './social';
import { closeYear } from './report';
import { chance, dist, pick, rand, randi, weighted } from './util';
import { ROAD_SPEED, doorOf, findPath, isRoad, randomStreetTile, randomVillageTile, randomZoneTile, segmentAvoidsVillage, villageDist, zoneOf } from './world';
import type { Building, Expedition, GameState, Goal, Monster, Npc, Profile } from './types';

const JOB_NODE: Record<string, NodeKind> = { woodcutter: 'tree', miner: 'rock', forager: 'bush' };
// occasional finds while gathering: [item, chance per swing]
const GATHER_FINDS: Record<NodeKind, [string, number][]> = {
  tree: [['honey', 0.05], ['amber', 0.025]], rock: [['silverOre', 0.04], ['iron', 0.05]], bush: [['herb', 0.15], ['egg', 0.04]],
};
const SLOTS = ['weapon', 'armor', 'accessory'] as const;
const SPEED = { fighter: 2.8, gatherer: 2.4, civilian: 1.5, tourist: 1.5 };
const HUNGER_RATE = 100 / (6 * DAY);
const MOOD_RATE = 100 / (6 * DAY);
const MONSTER_INTERVAL = 1.2;
const SHINY_RATE = 1 / 150;
const DEPTH_LEVELS = 4;

export function step(s: GameState, dt: number) {
  s.time += dt;
  const d = Math.floor(s.time / DAY);
  if (d !== s.day) { s.day = d; daily(s); }
  const t = s.timers;
  t.spawn += dt;
  if (t.spawn >= 1) { t.spawn = 0; spawnMonster(s); }
  t.node += dt;
  if (t.node >= 1.5) { t.node = 0; spawnNodeTick(s); }
  t.rescue += dt;
  if (t.rescue >= 1) { t.rescue = 0; assignRescues(s); }
  touristSpawn(s, dt);
  for (const n of [...s.npcs]) updateNpc(s, n, dt);
  for (const m of [...s.monsters]) updateMonster(s, m, dt);
  expeditionTick(s);
  catTick(s, dt);
  petsTick(s, dt);
  researchTick(s);
}

// ---------- movement helpers ----------

function goTo(s: GameState, n: Npc, tx: number, ty: number, goal: Goal, goalId = 0) {
  n.path = findPath(s, Math.floor(n.x), Math.floor(n.y), tx, ty);
  n.state = 'walk'; n.goal = goal; n.goalId = goalId;
}

function goBuilding(s: GameState, n: Npc, b: Building, goal: Goal) {
  const d = doorOf(b);
  goTo(s, n, d.x, d.y, goal, b.id);
}

function enter(n: Npc, b: Building, timer: number, goal?: Goal) {
  n.inside = b.id; n.state = 'inside'; n.timer = timer; n.path = [];
  if (goal) n.goal = goal;
}

function leave(s: GameState, n: Npc) {
  const b = bld(s, n.inside);
  if (b) { const d = doorOf(b); n.x = d.x + 0.5; n.y = d.y + 0.5; }
  n.inside = null; n.state = 'idle'; n.goal = null;
}

function wait(n: Npc, t: number) { n.state = 'wait'; n.timer = t; n.path = []; }

const speedOf = (n: Npc) =>
  SPEED[n.role] * (n.role === 'gatherer' ? 1 + 0.05 * Math.sqrt(n.level - 1) : 1) * (n.carry != null ? 0.75 : 1);

function move(n: Npc, dt: number): boolean {
  let budget = speedOf(n) * dt * (isRoad(Math.floor(n.x), Math.floor(n.y)) ? ROAD_SPEED : 1);
  while (budget > 0 && n.path.length) {
    const p = n.path[0];
    const dx = p.x - n.x, dy = p.y - n.y, d = Math.hypot(dx, dy);
    if (Math.abs(dx - dy) > 0.01) n.facing = dx - dy > 0 ? 1 : -1;
    if (d <= budget) { n.x = p.x; n.y = p.y; n.path.shift(); budget -= d; }
    else { n.x += (dx / d) * budget; n.y += (dy / d) * budget; budget = 0; }
  }
  return n.path.length === 0;
}

function nearest(n: Npc, list: Building[]): Building | undefined {
  let best: Building | undefined, bd = Infinity;
  for (const b of list) {
    const d = doorOf(b), dd = dist(n.x, n.y, d.x, d.y);
    if (dd < bd) { bd = dd; best = b; }
  }
  return best;
}


// charges a customer, adding the building's specialty when it is in stock and they can afford it
function sell(s: GameState, n: Npc, b: Building, price: number) {
  const item = goodsItem(s, b);
  if (item && n.money >= price + goodsPrice(item)) {
    s.items[item]--; s.stats.goods++;
    price += goodsPrice(item);
  }
  n.money -= price;
  earn(s, b, price);
}
const bagCount = (n: Npc) => Object.values(n.bag).reduce((a, b) => a + b, 0);
const bagCap = (n: Npc) => 10 + Math.floor(Math.sqrt(n.level));
const homeOrGuild = (s: GameState, n: Npc) => bld(s, n.home) ?? guild(s);

const BIO_LEVELS = new Set([10, 25, 50, 100, 150, 200, 300, 500, 1000, 2000, 5000, 10000]);

function gainNpcExp(s: GameState, n: Npc, amount: number) {
  const before = n.level;
  const boost = n.role === 'fighter' ? (hasEffect(s, 'sage') ? 1.5 : 1) * (1 + rbonus(s, 'training')) : 1;
  const ups = gainExp(n, amount * boost);
  if (!ups) return;
  checkPromotion(s, n);
  for (let L = before + 1; L <= n.level; L++) if (BIO_LEVELS.has(L)) bio(s, n, 'bio.level', { lv: L });
  fx(s, 'lvl', n.x, n.y, n.level);
  emote(s, n, 'star');
  if (n.role === 'fighter') n.hp = maxHp(s, n);
  if (n.level % 10 === 0) log(s, 'log.npcLevel', { n: '@name:' + n.name, lv: n.level });
}

function gainMonsterExp(s: GameState, type: string, amount: number) {
  const ml = s.mlv[type];
  if (gainExp(ml, amount) && ml.level % 5 === 0) log(s, 'log.monsterLevel', { m: '@m.' + type, lv: ml.level });
}

// ---------- npc update ----------

function updateNpc(s: GameState, n: Npc, dt: number) {
  if (n.state !== 'away' && n.state !== 'down' && n.state !== 'carried') {
    n.hunger = Math.max(0, n.hunger - HUNGER_RATE * mods(s).hunger * dt);
    n.mood = Math.max(0, n.mood - MOOD_RATE * dt);
    if (n.role === 'fighter' && n.state !== 'fight' && n.state !== 'inside') n.hp = Math.min(maxHp(s, n), n.hp + maxHp(s, n) * 0.003 * dt);
  }
  switch (n.state) {
    case 'idle': decide(s, n); break;
    case 'walk': if (move(n, dt)) arrive(s, n); break;
    case 'wait':
      n.timer -= dt;
      if (n.goal === 'camp' ? !isNight(s) : n.timer <= 0) { n.state = 'idle'; n.goal = null; }
      break;
    case 'inside': insideTick(s, n, dt); break;
    case 'hunt': huntTick(s, n, dt); break;
    case 'fight': fightTick(s, n, dt); break;
    case 'gather': gatherTick(s, n, dt); break;
    case 'down': downTick(s, n); break;
    case 'carried': {
      const g = npcById(s, n.rescuer);
      if (!g || g.carry !== n.id) { n.state = 'down'; n.rescuer = null; }
      else { n.x = g.x; n.y = g.y; n.facing = g.facing; }
      break;
    }
  }
}

function decide(s: GameState, n: Npc) {
  if (n.role === 'fighter') decideFighter(s, n);
  else if (n.role === 'gatherer') decideGatherer(s, n);
  else decideVisitor(s, n);
}

function goRest(s: GameState, n: Npc) {
  const clinic = nearest(n, ofKind(s, 'clinic'));
  const b = clinic && n.money >= priceAt(s, clinic) ? clinic : homeOrGuild(s, n);
  goBuilding(s, n, b, 'rest');
}

const openNow = (s: GameState, list: Building[]) => list.filter((b) => isOpen(b.type, tod(s)));

function tryEat(s: GameState, n: Npc): boolean {
  const r = nearest(n, openNow(s, ofKind(s, 'food')));
  if (!r || s.time < n.noFood) return false;
  goBuilding(s, n, r, 'eat');
  return true;
}

function tryFun(s: GameState, n: Npc): boolean {
  const list = openNow(s, ofKind(s, 'fun')).filter((b) => n.money >= priceAt(s, b));
  if (!list.length) return false;
  goBuilding(s, n, weighted(list, (b) => visitWeight(s, b))!, 'fun');
  return true;
}

function bestItem(n: Npc, b: Building): EquipDef | null {
  const slot = BUILDINGS[b.type].slot!;
  const tier = shopTier(b.level);
  const cur = equipByKey(n[slot])?.tier ?? 0;
  let best: EquipDef | null = null;
  for (const e of EQUIP[slot]) if (e.tier <= tier && e.tier > cur && e.price <= n.money) best = e;
  return best;
}

function tryShop(s: GameState, n: Npc): boolean {
  for (const b of ofKind(s, 'shop')) {
    if (bestItem(n, b)) { goBuilding(s, n, b, 'shop'); return true; }
  }
  return false;
}

function duelRatio(st: Stats, hp: number, s: GameState, m: Monster): number {
  const ms = monsterStats(s, m.type, m);
  const fT = (m.hp / Math.max(1, st.atk - ms.def * 0.5)) * st.interval;
  const mT = (hp / Math.max(1, ms.atk - st.def * 0.5)) * MONSTER_INTERVAL;
  return mT / fT;
}

function pickTarget(s: GameState, n: Npc, st: Stats): Monster | null {
  const q = n.quest != null ? s.quests.find((q) => q.id === n.quest) : undefined;
  const targeted = new Map<number, number>();
  for (const o of s.npcs) if (o.role === 'fighter' && (o.state === 'hunt' || o.state === 'fight')) targeted.set(o.goalId, (targeted.get(o.goalId) ?? 0) + 1);
  const boss = currentBoss(s);
  if (boss && n.level >= (boss.lv ?? 1) * 0.5 && n.hp > st.maxHp * 0.7) return boss;
  const mate = partnerOf(s, n);
  const mateTarget = mate && (mate.state === 'hunt' || mate.state === 'fight') ? mate.goalId : -1;
  let best: Monster | null = null, bs = -Infinity;
  for (const m of s.monsters) {
    if (m.boss != null) continue;
    const ratio = duelRatio(st, n.hp, s, m);
    const d = dist(n.x, n.y, m.x, m.y);
    let score: number;
    if (q && q.type === m.type && ratio > 0.8) score = 1e6 - d;
    else if (m.id === mateTarget && ratio > 1) score = 1e5 - d;
    else if (ratio >= 1.6 && (targeted.get(m.id) ?? 0) < 2) score = expReward(s.mlv[m.type].level) / (25 + d);
    else continue;
    if (score > bs) { bs = score; best = m; }
  }
  return best;
}

function decideFighter(s: GameState, n: Npc) {
  const st = fighterStats(s, n);
  if (n.hp < st.maxHp * 0.5) return goRest(s, n);
  if (isNight(s)) {
    if (villageDist(Math.floor(n.x), Math.floor(n.y)) > 6) { wait(n, 0); n.goal = 'camp'; return; }
    return goBuilding(s, n, homeOrGuild(s, n), 'sleep');
  }
  if (bagCount(n) >= 12) return goBuilding(s, n, guild(s), 'deposit');
  if (n.hunger < 40 && tryEat(s, n)) return;
  if (tryShop(s, n)) return;
  if (n.mood < 35 && tryFun(s, n)) return;
  const forge = s.buildings.find((b) => b.type === 'forge');
  // fighters reuse the visitor plan list to remember which piece of gear they came to forge
  const slot = pick([0, 0, 1, 2]), gear = n[SLOTS[slot]];
  if (forge && gear && chance(0.15) && canForge(s, gear, n.money / 2)) { n.plan = [slot]; return goBuilding(s, n, forge, 'forge'); }
  const e = s.exp;
  if (e && e.state === 'recruit' && e.members.length < EXPEDITION_PARTY && n.quest == null && chance(0.4))
    return goBuilding(s, n, guild(s), 'expedition');
  if (n.quest == null && s.quests.some((q) => q.members.length < 6) && chance(0.5)) return goBuilding(s, n, guild(s), 'quest');
  const m = pickTarget(s, n, st);
  if (m) { n.state = 'hunt'; n.goalId = m.id; n.path = []; n.repath = 0; return; }
  if (bagCount(n) > 0) return goBuilding(s, n, guild(s), 'deposit');
  const p = randomZoneTile(0);
  goTo(s, n, p.x, p.y, 'patrol');
}

function decideGatherer(s: GameState, n: Npc) {
  if (isNight(s)) return goBuilding(s, n, homeOrGuild(s, n), 'sleep');
  if (n.hunger < 40 && tryEat(s, n)) return;
  if (n.mood < 35 && tryFun(s, n)) return;
  if (bagCount(n) >= bagCap(n)) return goBuilding(s, n, guild(s), 'deposit');
  const taken = new Set(s.npcs.filter((o) => o !== n && o.role === 'gatherer' && (o.goal === 'gatherNode' || o.state === 'gather')).map((o) => o.goalId));
  let best = null, bs = Infinity;
  for (const node of s.nodes) {
    if (taken.has(node.id)) continue;
    const pref = JOB_NODE[n.job] === node.kind ? 0.5 : 1;
    const score = (dist(n.x, n.y, node.x, node.y) + (s.items[NODE_ITEM[node.kind]] ?? 0) / 8) * pref;
    if (score < bs) { bs = score; best = node; }
  }
  if (best) return goTo(s, n, best.x, best.y, 'gatherNode', best.id);
  if (bagCount(n) > 0) return goBuilding(s, n, guild(s), 'deposit');
  const p = randomVillageTile(s);
  goTo(s, n, p.x, p.y, 'patrol');
}

const visitable = (b: Building, tourist: boolean) => {
  const k = BUILDINGS[b.type].kind;
  return k === 'food' || k === 'shop' || k === 'fun' || k === 'decor' || k === 'guild' || (tourist && k === 'souvenir');
};
function visitWeight(s: GameState, b: Building) {
  const t = tod(s);
  if (!isOpen(b.type, t)) return 0;
  const d = BUILDINGS[b.type];
  return (d.attraction * lvMult(b.level) + (d.price > 0 ? 1 : 0.3)) * (isPeak(b.type, t) ? 3 : 1) * (hotNow(s, b.type) ? 2.5 : 1);
}

function goLeave(s: GameState, n: Npc) { goTo(s, n, SOUTH_EXIT.x, SOUTH_EXIT.y, 'leave'); }

function decideVisitor(s: GameState, n: Npc) {
  if (n.role === 'tourist') {
    if (isNight(s)) {
      const inn = nearest(n, ofKind(s, 'inn').filter((b) => n.money >= priceAt(s, b) * mods(s).touristSpend));
      return inn ? goBuilding(s, n, inn, 'visit') : goLeave(s, n);
    }
    let b: Building | undefined;
    while (n.plan.length && !(b = bld(s, n.plan.shift()!)));
    if (b && !isOpen(b.type, tod(s))) b = weighted(s.buildings.filter((o) => visitable(o, true)), (o) => visitWeight(s, o)) ?? undefined;
    return b ? goBuilding(s, n, b, 'visit') : goLeave(s, n);
  }
  if (isNight(s)) {
    const h = bld(s, n.home);
    return h ? goBuilding(s, n, h, 'sleep') : goLeave(s, n);
  }
  if (n.hunger < 40 && tryEat(s, n)) return;
  const home = bld(s, n.home);
  if (home && chance(0.35)) return goBuilding(s, n, home, 'homeStay');
  if (chance(0.6)) {
    const b = weighted(s.buildings.filter((b) => visitable(b, false)), (b) => visitWeight(s, b));
    if (b) return goBuilding(s, n, b, 'visit');
  }
  const p = randomStreetTile(s);
  goTo(s, n, p.x, p.y, 'patrol');
}

// ---------- arrival ----------

function arrive(s: GameState, n: Npc) {
  const goal = n.goal;
  const b = bld(s, n.goalId);
  switch (goal) {
    case 'patrol': return wait(n, rand(1.5, 3.5));
    case 'leave': return removeVisitor(s, n);
    case 'exitExp': n.state = 'away'; return;
    case 'gatherNode': {
      if (s.nodes.some((o) => o.id === n.goalId)) { n.state = 'gather'; n.timer = 0; } else n.state = 'idle';
      return;
    }
    case 'rescue': return pickUp(s, n);
    case 'dropoff': return dropOff(s, n, b);
  }
  if (!b) { n.state = 'idle'; n.goal = null; return; }
  switch (goal) {
    case 'eat': {
      const food = FOODS.find((f) => (s.items[f] ?? 0) > 0);
      if (!food) { n.noFood = s.time + DAY; return enter(n, b, 1); }
      s.items[food]--;
      const price = Math.min(n.money, priceAt(s, b));
      if (price > 0) sell(s, n, b, price);
      n.hunger = 100; n.mood = Math.min(100, n.mood + 5);
      emote(s, n, 'food');
      return enter(n, b, 3);
    }
    case 'shop': {
      const e = bestItem(n, b);
      if (e) {
        const slot = BUILDINGS[b.type].slot!;
        n.money -= e.price; n[slot] = e.key;
        earn(s, b, e.price);
        n.hp = Math.min(n.hp, maxHp(s, n));
        log(s, 'log.bought', { n: '@name:' + n.name, e: '@eq.' + e.key });
        if (e.tier >= 3) bio(s, n, 'bio.gear', { e: '@eq.' + e.key });
      }
      return enter(n, b, 3);
    }
    case 'forge': {
      const key = n[SLOTS[n.plan[0] ?? 0]];
      n.plan = [];
      if (key && canForge(s, key, n.money / 2)) forgeUpgrade(s, key, n);
      return enter(n, b, 4);
    }
    case 'fun': {
      const price = priceAt(s, b);
      if (n.money >= price) {
        sell(s, n, b, price); n.mood = 100;
        emote(s, n, 'note');
        if (b.type === 'arena' && n.role === 'fighter') gainNpcExp(s, n, expReward(n.level) * 2);
      }
      return enter(n, b, 5);
    }
    case 'rest': {
      if (BUILDINGS[b.type].kind === 'clinic') payClinic(s, n, b);
      return enter(n, b, 0, 'rest');
    }
    case 'sleep': return enter(n, b, 0, 'sleep');
    case 'homeStay': return enter(n, b, rand(6, 16));
    case 'deposit': {
      let pay = 0;
      for (const [k, c] of Object.entries(n.bag)) { addItem(s, k, c); pay += ITEMS[k].value * c; }
      n.money += Math.round(pay * (n.role === 'gatherer' ? 0.4 : 0.6));
      n.bag = {};
      return enter(n, b, 2);
    }
    case 'quest': {
      const q = s.quests.find((q) => q.members.length < 6 && !q.members.includes(n.id));
      if (q && n.quest == null) { q.members.push(n.id); n.quest = q.id; }
      return enter(n, b, 1.5);
    }
    case 'expedition': {
      const e = s.exp;
      if (e && e.state === 'recruit' && e.members.length < EXPEDITION_PARTY && !e.members.includes(n.id)) {
        e.members.push(n.id);
        log(s, 'log.expJoin', { n: '@name:' + n.name, loc: '@ex.' + e.loc });
        return enter(n, b, 0, 'expWait');
      }
      return enter(n, b, 1);
    }
    case 'visit': return visit(s, n, b);
  }
  n.state = 'idle';
}

function payClinic(s: GameState, n: Npc, b: Building) {
  const fee = priceAt(s, b);
  if (n.money >= fee) sell(s, n, b, fee);
}

function insideTick(s: GameState, n: Npc, dt: number) {
  const b = bld(s, n.inside);
  if (!b) { n.inside = null; n.state = 'idle'; n.goal = null; return; }
  if (n.goal === 'rest' || n.goal === 'sleep') {
    if (n.role === 'fighter') {
      const kind = BUILDINGS[b.type].kind;
      const rate = (kind === 'clinic' ? 0.05 : kind === 'house' ? 0.025 : 0.012) * (n.home == null ? 0.5 : 1) * (1 + rbonus(s, 'medicine'));
      n.hp = Math.min(maxHp(s, n), n.hp + maxHp(s, n) * rate * dt);
    }
    const done = n.goal === 'rest' ? n.hp >= maxHp(s, n) * 0.95 : !isNight(s);
    if (done) leave(s, n);
    return;
  }
  if (n.goal === 'expWait') {
    const e = s.exp;
    if (!e || e.state !== 'recruit' || !e.members.includes(n.id)) leave(s, n);
    return;
  }
  n.timer -= dt;
  if (n.timer <= 0) leave(s, n);
}

// ---------- combat ----------

const hit = (atk: number, def: number) => Math.max(1, Math.round(atk * rand(0.85, 1.15) - def * 0.5));

function huntTick(s: GameState, n: Npc, dt: number) {
  const m = s.monsters.find((o) => o.id === n.goalId);
  if (!m) { n.state = 'idle'; return; }
  if (isNight(s) && m.target !== n.id) { n.state = 'idle'; return; }
  const st = fighterStats(s, n);
  const d = dist(n.x, n.y, m.x, m.y);
  if (d <= st.range) { n.state = 'fight'; n.cd = 0.3; n.path = []; return; }
  n.repath -= dt;
  if (d < 6 && zoneOf(n.x, n.y) >= 0) n.path = [{ x: m.x, y: m.y }];
  else if (n.repath <= 0 || !n.path.length) {
    n.repath = 1.5;
    n.path = findPath(s, Math.floor(n.x), Math.floor(n.y), Math.floor(m.x), Math.floor(m.y));
  }
  move(n, dt);
}

function fightTick(s: GameState, n: Npc, dt: number) {
  const m = s.monsters.find((o) => o.id === n.goalId);
  if (!m) { n.state = 'idle'; return; }
  const st = fighterStats(s, n);
  if (dist(n.x, n.y, m.x, m.y) > st.range + 0.6) { n.state = 'hunt'; return; }
  n.facing = m.x - m.y - (n.x - n.y) >= 0 ? 1 : -1;
  n.cd -= dt;
  if (n.cd > 0) return;
  n.cd = st.interval;
  const dmg = hit(st.atk, monsterStats(s, m.type, m).def);
  m.hp -= dmg;
  fx(s, 'dmg', m.x, m.y, dmg);
  if (n.cls === 'cleric') healAllies(s, n);
  if (m.target == null) m.target = n.id;
  if (m.hp <= 0) killMonster(s, m, n);
}

// clerics mend the most wounded fighter close by with every swing
function healAllies(s: GameState, n: Npc) {
  let best: Npc | undefined, worst = 0.9;
  for (const o of s.npcs) {
    if (o.role !== 'fighter' || o.state === 'down' || o.inside != null || dist(o.x, o.y, n.x, n.y) > 4) continue;
    const f = o.hp / maxHp(s, o);
    if (f < worst) { worst = f; best = o; }
  }
  if (best) best.hp = Math.min(maxHp(s, best), best.hp + maxHp(s, best) * 0.08);
}

function killMonster(s: GameState, m: Monster, killer: Npc) {
  const L = m.lv ?? s.mlv[m.type].level;
  const parts = s.npcs.filter((o) => o.role === 'fighter' && (o.state === 'fight' || o.state === 'hunt') && o.goalId === m.id);
  if (!parts.includes(killer)) parts.push(killer);
  const bonus = m.boss != null ? 5 : m.shiny ? 2 : 1;
  const fam = MONSTERS[m.type].fam;
  for (const f of parts) {
    gainNpcExp(s, f, expReward(L) * bonus);
    f.state = 'idle'; f.kills++; f.yk = (f.yk ?? 0) + 1;
    (f.fk ??= {})[fam] = (f.fk[fam] ?? 0) + 1;
    if (f.kills === 1) bio(s, f, 'bio.firstKill', { m: '@m.' + m.type });
    if (m.boss != null) { f.bosses = (f.bosses ?? 0) + 1; emote(s, f, 'win'); bio(s, f, 'bio.boss', { m: '@m.' + m.type, lv: L }); }
    if (m.shiny && f === killer) bio(s, f, 'bio.shiny', { m: '@m.' + m.type });
    checkTitles(s, f);
  }
  bondFight(s, parts);
  s.ys.kills++;
  s.stats.fk[fam] = (s.stats.fk[fam] ?? 0) + 1;
  const avg = parts.reduce((a, f) => a + f.level, 0) / parts.length;
  gainMonsterExp(s, m.type, expReward(avg) * 0.05);
  if (m.boss != null) {
    const reward = 300 * L;
    for (const f of parts) f.money += Math.round(reward / parts.length);
    s.money += 50 * L;
    s.ys.bosses++;
    addFame(s, 10);
    log(s, 'log.bossDown', { t: `@boss.${m.boss}`, m: '@m.' + m.type, n: parts.length, r: reward });
  }
  if (m.shiny) {
    if (!s.shinySeen.includes(m.type)) s.shinySeen.push(m.type);
    s.ys.shinies++;
    log(s, 'log.shiny', { n: '@name:' + killer.name, m: '@m.' + m.type });
  }
  const count = Math.max(1, Math.round(dropCount(L) * mods(s).drops * (m.boss != null ? 10 : m.shiny ? 3 : 1) * (1 + rbonus(s, 'logistics') + petBonus(s, 'scout'))));
  const drops = MONSTERS[m.type].drops;
  for (let i = 0; i < count; i++) {
    const item = weighted(drops, (d) => d[1])![0];
    const f = pick(parts);
    f.bag[item] = (f.bag[item] ?? 0) + 1;
    if (!s.disc.includes(item)) s.disc.push(item);
  }
  if (m.boss != null) for (const it of ['soulGem', 'gem', 'mithril']) { const f = pick(parts); f.bag[it] = (f.bag[it] ?? 0) + 1 + Math.floor(L / 40); if (!s.disc.includes(it)) s.disc.push(it); }
  fx(s, 'item', m.x, m.y, count);
  if (!s.seen.includes(m.type)) s.seen.push(m.type);
  for (const q of s.quests) {
    if (q.type === m.type && parts.some((p) => q.members.includes(p.id))) {
      q.done++;
      if (q.done >= q.need) completeQuest(s, q.id);
    }
  }
  s.stats.kills++;
  tryTame(s, m, killer.name);
  s.monsters = s.monsters.filter((o) => o !== m);
}

function downFighter(s: GameState, f: Npc, m: Monster) {
  const L = m.lv ?? s.mlv[m.type].level;
  f.hp = 0; f.state = 'down'; f.downT = s.time; f.path = []; f.rescuer = null; f.goal = null;
  f.downs = (f.downs ?? 0) + 1;
  if (f.downs === 1) bio(s, f, 'bio.firstDown', { m: '@m.' + m.type });
  emote(s, f, 'hurt');
  checkTitles(s, f);
  if (m.boss == null) gainMonsterExp(s, m.type, expReward(f.level));
  gainNpcExp(s, f, expReward(L) * 0.05);
  m.target = null;
  log(s, 'log.down', { n: '@name:' + f.name, m: '@m.' + m.type, lv: L });
}

function downTick(s: GameState, f: Npc) {
  if (f.rescuer != null) {
    const g = npcById(s, f.rescuer);
    if (!g || g.goal !== 'rescue' || g.goalId !== f.id) f.rescuer = null;
  }
  if (f.rescuer == null && s.time - f.downT > 2 * DAY) { f.hp = maxHp(s, f) * 0.2; f.state = 'idle'; }
}

const targetable = (n: Npc) =>
  n.role === 'fighter' && n.inside == null && zoneOf(n.x, n.y) >= 0 &&
  (n.state === 'hunt' || n.state === 'fight' || (n.state === 'wait' && n.goal !== 'camp') || n.state === 'idle' ||
    (n.state === 'walk' && n.goal !== 'rest' && n.goal !== 'exitExp' && n.goal !== 'sleep'));

function updateMonster(s: GameState, m: Monster, dt: number) {
  let f = npcById(s, m.target);
  if (f && !targetable(f)) { m.target = null; f = undefined; }
  if (!f) {
    for (const n of s.npcs) {
      if (targetable(n) && dist(n.x, n.y, m.x, m.y) < 2.5) {
        f = n; m.target = n.id;
        if (n.state !== 'fight') { n.state = 'hunt'; n.goalId = m.id; n.path = []; }
        break;
      }
    }
  }
  if (f) {
    const d = dist(f.x, f.y, m.x, m.y);
    if (d > 0.9) {
      const sp = 2 * dt;
      const nx = m.x + ((f.x - m.x) / d) * sp, ny = m.y + ((f.y - m.y) / d) * sp;
      if (villageDist(Math.floor(nx), Math.floor(ny)) < 1) { m.target = null; return; }
      m.facing = f.x - f.y - (m.x - m.y) >= 0 ? 1 : -1;
      m.x = nx; m.y = ny;
    } else {
      m.cd -= dt;
      if (m.cd <= 0) {
        m.cd = MONSTER_INTERVAL;
        const dmg = hit(monsterStats(s, m.type, m).atk, fighterStats(s, f).def);
        f.hp -= dmg;
        fx(s, 'dmg', f.x, f.y, dmg);
        if (f.hp <= 0) downFighter(s, f, m);
      }
    }
    return;
  }
  if (m.wait > 0) { m.wait -= dt; return; }
  const dx = m.tx - m.x, dy = m.ty - m.y, d = Math.hypot(dx, dy);
  if (d < 0.1) {
    m.wait = rand(1, 4);
    for (let k = 0; k < 6; k++) {
      const tx = m.x + rand(-5, 5), ty = m.y + rand(-5, 5);
      if (zoneOf(tx, ty) === m.zone && segmentAvoidsVillage(m.x, m.y, tx, ty)) { m.tx = tx; m.ty = ty; break; }
    }
    return;
  }
  const sp = Math.min(d, 0.8 * dt);
  if (Math.abs(dx - dy) > 0.01) m.facing = dx - dy > 0 ? 1 : -1;
  m.x += (dx / d) * sp; m.y += (dy / d) * sp;
}

export const zoneCap = (s: GameState, z: number) =>
  Math.min(40, Math.round(([6, 4, 3][z] + (year(s) - 1) * [1, 0.8, 0.6][z]) * mods(s).monsterRate * monsterMult(s)));
export const monsterCap = (s: GameState) => [0, 1, 2].reduce((a, z) => a + zoneCap(s, z), 0);

// per-zone caps keep weak monsters respawning even when strong ones linger
function spawnMonster(s: GameState) {
  const open = [0, 1, 2].filter((z) => s.monsters.filter((m) => m.zone === z && m.boss == null).length < zoneCap(s, z));
  if (!open.length) return;
  const zone = pick(open);
  const list = zoneMonsters(zone, villageDef(s.village).ground);
  if (!list.length) return;
  const type = weighted(list, (k) => spawnWeight(MONSTERS[k]))!;
  const p = randomZoneTile(zone);
  s.monsters.push({
    id: newId(s), type, x: p.x + 0.5, y: p.y + 0.5, hp: 0, shiny: chance(SHINY_RATE),
    tx: p.x + 0.5, ty: p.y + 0.5, target: null, cd: 0, facing: 1, zone, wait: rand(0, 3),
  });
  const m = s.monsters[s.monsters.length - 1];
  m.hp = monsterStats(s, type, m).maxHp;
}

// ---------- gathering & rescue ----------

function spawnNodeTick(s: GameState) {
  const m = mods(s);
  const caps: Record<NodeKind, number> = { tree: 18 * m.wood, rock: 10 * m.stone, bush: 14 * m.fruit };
  const open = (Object.keys(caps) as NodeKind[]).filter((k) => s.nodes.filter((n) => n.kind === k).length < Math.max(3, caps[k]));
  if (open.length) spawnNode(s, pick(open));
}

function gatherTick(s: GameState, n: Npc, dt: number) {
  const node = s.nodes.find((o) => o.id === n.goalId);
  if (!node || isNight(s)) { n.state = 'idle'; return; }
  n.timer += dt;
  const interval = 0.6 / (1 + 0.1 * Math.sqrt(n.level - 1)) / (1 + rbonus(s, 'gathering') + petBonus(s, 'hauler'));
  if (n.timer < interval) return;
  n.timer -= interval;
  const item = NODE_ITEM[node.kind];
  node.amount--;
  n.bag[item] = (n.bag[item] ?? 0) + (node.kind === 'bush' ? 2 : 1);
  const extra = weighted(GATHER_FINDS[node.kind], (x) => x[1]);
  if (extra && chance(extra[1])) { n.bag[extra[0]] = (n.bag[extra[0]] ?? 0) + 1; if (!s.disc.includes(extra[0])) s.disc.push(extra[0]); }
  gainNpcExp(s, n, 2);
  if (node.amount <= 0) { s.nodes = s.nodes.filter((o) => o !== node); n.state = 'idle'; }
  else if (bagCount(n) >= bagCap(n)) n.state = 'idle';
}

function assignRescues(s: GameState) {
  for (const f of s.npcs) {
    if (f.state !== 'down' || f.rescuer != null) continue;
    let best: Npc | undefined, bd = Infinity;
    for (const g of s.npcs) {
      if (g.role !== 'gatherer' || g.carry != null || g.goal === 'rescue' || g.goal === 'dropoff') continue;
      if (g.state !== 'idle' && g.state !== 'walk' && g.state !== 'wait' && g.state !== 'gather') continue;
      const d = dist(g.x, g.y, f.x, f.y);
      if (d < bd) { bd = d; best = g; }
    }
    if (!best) return;
    f.rescuer = best.id;
    goTo(s, best, Math.floor(f.x), Math.floor(f.y), 'rescue', f.id);
  }
}

function pickUp(s: GameState, g: Npc) {
  const f = npcById(s, g.goalId);
  if (!f || f.state !== 'down' || f.rescuer !== g.id) { g.state = 'idle'; g.goal = null; return; }
  f.state = 'carried';
  g.carry = f.id;
  const dest = nearest(g, ofKind(s, 'clinic')) ?? bld(s, f.home) ?? guild(s);
  goBuilding(s, g, dest, 'dropoff');
}

function dropOff(s: GameState, g: Npc, b: Building | undefined) {
  const f = npcById(s, g.carry);
  g.carry = null; g.state = 'idle'; g.goal = null;
  if (!f) return;
  f.rescuer = null;
  if (!b) { f.state = 'idle'; f.hp = Math.max(f.hp, 1); return; }
  if (BUILDINGS[b.type].kind === 'clinic') payClinic(s, f, b);
  f.hp = Math.max(f.hp, 1);
  enter(f, b, 0, 'rest');
  s.stats.rescues++;
  if ((f.downs ?? 0) <= 3) bio(s, f, 'bio.rescued', { n: '@name:' + g.name });
  log(s, 'log.rescued', { g: '@name:' + g.name, n: '@name:' + f.name, b: '@b.' + b.type });
}

// ---------- visitors ----------

function familiarity(s: GameState, n: Npc, amount: number) {
  if (n.role !== 'tourist') return;
  const p = s.profiles[n.profile];
  if (!p) return;
  const before = p.level;
  gainExp(p, amount, famExpNeed);
  for (let L = before + 1; L <= p.level; L++) if (L === 2 || L === 5 || L % 10 === 0) gift(s, p, L);
}

function gift(s: GameState, p: Profile, L: number) {
  const name = '@name:' + p.name;
  const r = randi(0, 2);
  if (r === 0) {
    const v = 60 * L;
    s.money += v;
    log(s, 'log.giftMoney', { n: name, v });
  } else if (r === 1) {
    const v = 5 * L;
    addItem(s, 'wood', v); addItem(s, 'stone', v);
    log(s, 'log.giftRes', { n: name, v });
  } else {
    const rare = Object.keys(ITEMS).filter((k) => !['wood', 'stone', 'fruit', 'meat'].includes(k));
    const item = pick(rare.slice(0, Math.min(rare.length, 3 + Math.floor(L / 5))));
    const v = Math.min(100, 1 + Math.floor(L / 3));
    addItem(s, item, v);
    log(s, 'log.giftItem', { n: name, item: '@item.' + item, v });
  }
}

function visit(s: GameState, n: Npc, b: Building) {
  const def = BUILDINGS[b.type];
  const price = priceAt(s, b) * (n.role === 'tourist' ? mods(s).touristSpend : 1) * spendMult(s) * vipSpend(n);
  const sat = lvMult(b.level);
  if (price > 0 && n.money >= price) {
    sell(s, n, b, price);
    familiarity(s, n, (price / 4) * sat);
  } else familiarity(s, n, 2 * sat);
  vipVisit(s, n, b);
  if (def.kind === 'food') n.hunger = 100;
  if (def.kind === 'fun') n.mood = 100;
  if (def.kind === 'inn') return enter(n, b, 0, 'sleep');
  if (def.kind === 'decor') return wait(n, rand(2, 3.5));
  enter(n, b, rand(2, 4));
}

function removeVisitor(s: GameState, n: Npc) {
  if (n.role === 'tourist') {
    const p = s.profiles[n.profile];
    if (p) { p.visits++; familiarity(s, n, 10); }
    vipLeave(s, n);
  } else if (n.role === 'civilian') log(s, 'log.civLeft', { n: '@name:' + n.name });
  s.npcs = s.npcs.filter((o) => o !== n);
}

function touristSpawn(s: GameState, dt: number) {
  if (isNight(s) || tod(s) > 0.6) return;
  const visiting = new Set(s.npcs.filter((n) => n.role === 'tourist').map((n) => n.profile));
  if (visiting.size >= 30) return;
  const perDay = Math.min(10, 0.3 + Math.sqrt(attraction(s)) / 2) * mods(s).touristRate * touristMult(s) * fameTouristMult(s)
    * (1 + rbonus(s, 'tourism') + catTouristBonus(s) + petBonus(s, 'mascot'));
  if (!chance((perDay * dt) / (DAY * 0.56))) return;
  let idx = -1;
  const returning = s.profiles.map((_, i) => i).filter((i) => !visiting.has(i));
  const wantNew = s.profiles.length < 12 || (s.profiles.length < 40 + year(s) * 5 && chance(0.3));
  if (returning.length && !wantNew) idx = pick(returning);
  else {
    const job = randomJob('tourist');
    s.profiles.push({ name: freshName(s), job, look: makeLook('tourist', 'warrior', job), level: 1, exp: 0, visits: 0 });
    idx = s.profiles.length - 1;
  }
  const p = s.profiles[idx];
  const n = makeNpc(s, 'tourist', SOUTH_EXIT.x, SOUTH_EXIT.y);
  n.profile = idx; n.name = p.name; n.look = p.look; n.job = p.job;
  n.money = Math.round(rand(40, 100) * (1 + 0.1 * Math.sqrt(p.level - 1)));
  const pool = s.buildings.filter((b) => visitable(b, true));
  const k = randi(2, 4);
  for (let i = 0; i < k && pool.length; i++) {
    const b = weighted(pool, (o) => visitWeight(s, o) + 0.1)!;
    n.plan.push(b.id);
    pool.splice(pool.indexOf(b), 1);
  }
  s.npcs.push(n);
  s.stats.tourists++;
  s.ys.tourists++;
}

// ---------- daily / quests / arrivals ----------

function daily(s: GameState) {
  if (s.day % DAYS_PER_YEAR === 0 && s.day > 0) closeYear(s);
  eventsDaily(s);
  if (festival(s) && s.day % DAYS_PER_MONTH === 4) addFame(s, 6);
  familyDaily(s);
  commissionsDaily(s);
  vipDaily(s);
  catDaily(s);
  rivalsDaily(s);
  for (const n of s.npcs) if (n.role === 'fighter') checkTitles(s, n);
  assignHousing(s);
  arrivals(s);
  questsDaily(s);
  for (const n of s.npcs) if (n.role === 'civilian') n.money += 4;
  if (s.day % DAYS_PER_MONTH === 0) monthly(s);
  if (s.day % DAYS_PER_YEAR === 0) log(s, 'log.newYear', { y: year(s) });
  if (!s.scored && s.day >= SCORE_YEAR * DAYS_PER_YEAR) {
    s.scored = true;
    s.score = computeScore(s);
    log(s, 'log.score', { v: s.score.total, r: s.score.rank });
    fx(s, 'score', 0, 0, s.score.total);
  }
}

// the wilds keep pace with the village: map monsters drift toward a share of the adventurers' strength
function monsterDrift(s: GameState) {
  const top = s.npcs.filter((n) => n.role === 'fighter').map((n) => n.level).sort((a, b) => b - a).slice(0, 6);
  if (!top.length) return;
  const avg = top.reduce((a, b) => a + b, 0) / top.length;
  for (const [k, d] of Object.entries(MONSTERS)) {
    const target = avg * (d.zone < 0 ? 0.8 : [0.25, 0.45, 0.65][d.zone]);
    const ml = s.mlv[k];
    if (ml.level < target) ml.level += Math.max(1, Math.round((target - ml.level) * 0.08));
  }
}

function monthly(s: GameState) {
  rivalsMonthly(s);
  monsterDrift(s);
  const b = s.histBase;
  s.hist.push({ e: s.stats.earned - b.e, t: s.stats.tourists - b.t, k: s.stats.kills - b.k });
  if (s.hist.length > 240) s.hist.shift();
  s.histBase = { e: s.stats.earned, t: s.stats.tourists, k: s.stats.kills };
  for (const n of s.npcs) {
    const h = bld(s, n.home);
    if (!h) continue;
    const rent = Math.round(8 * lvMult(h.level));
    if (n.money >= rent) { n.money -= rent; earn(s, h, rent); }
  }
  s.stats.lastIncome = s.stats.income;
  s.stats.income = 0;
}

function arrivals(s: GameState) {
  const fighters = s.npcs.filter((n) => n.role === 'fighter');
  const gatherers = s.npcs.filter((n) => n.role === 'gatherer').length;
  const homeless = s.npcs.filter((n) => n.role !== 'tourist' && n.home == null).length;
  const att = attraction(s);
  const room = freeBeds(s) > 0 || homeless < 1;
  const civs = s.npcs.filter((n) => n.role === 'civilian').length;
  if (room && gatherers < 1 + Math.floor(fighters.length / 3) + Math.floor(civs / 8) && chance(0.5)) {
    const n = makeNpc(s, 'gatherer', SOUTH_EXIT.x, SOUTH_EXIT.y);
    s.npcs.push(n);
    log(s, 'log.arriveGatherer', { n: '@name:' + n.name });
  } else if (room && fighters.length < monsterCap(s) * 1.3 && chance(Math.min(0.5, 0.12 + att / 400))) {
    const avg = fighters.length ? fighters.reduce((a, f) => a + f.level, 0) / fighters.length : 1;
    const n = makeNpc(s, 'fighter', SOUTH_EXIT.x, SOUTH_EXIT.y, Math.max(1, Math.round(avg * rand(0.3, 0.8))));
    n.money = 60 + n.level * 20;
    s.npcs.push(n);
    log(s, 'log.arriveFighter', { n: '@name:' + n.name, c: '@cls.' + n.cls });
  }
  assignHousing(s);
  const stillHomeless = s.npcs.some((n) => n.role !== 'tourist' && n.home == null);
  if (!stillHomeless && freeBeds(s) > 0 && civs < att / 3 && chance(Math.min(0.6, 0.15 + att / 200))) {
    const n = makeNpc(s, 'civilian', SOUTH_EXIT.x, SOUTH_EXIT.y);
    n.money = 50;
    s.npcs.push(n);
    assignHousing(s);
    log(s, 'log.arriveCivilian', { n: '@name:' + n.name });
  }
}

function questsDaily(s: GameState) {
  s.quests = s.quests.filter((q) => {
    if (s.time <= q.until) return true;
    for (const n of s.npcs) if (n.quest === q.id) n.quest = null;
    log(s, 'log.questExpired', { m: '@m.' + q.type });
    return false;
  });
  if (s.quests.length >= 3) return;
  if (s.monsters.length < monsterCap(s) * 0.6) return;
  const counts = new Map<string, number>();
  for (const m of s.monsters) counts.set(m.type, (counts.get(m.type) ?? 0) + 1);
  for (const [type, c] of counts) {
    if (c < 3 || s.quests.some((q) => q.type === type) || !chance(0.5)) continue;
    const need = Math.min(c, 3 + Math.floor(year(s) / 2));
    const reward = need * (20 + 8 * s.mlv[type].level);
    s.quests.push({ id: newId(s), type, need, done: 0, reward, until: s.time + 15 * DAY, members: [] });
    log(s, 'log.questPosted', { m: '@m.' + type, c: need, r: reward });
    if (s.quests.length >= 3) break;
  }
}

function completeQuest(s: GameState, id: number) {
  const q = s.quests.find((o) => o.id === id);
  if (!q) return;
  const members = q.members.map((m) => npcById(s, m)).filter((n): n is Npc => !!n);
  const share = Math.floor(q.reward / Math.max(1, members.length));
  for (const n of members) { n.money += share; n.quest = null; gainNpcExp(s, n, expReward(s.mlv[q.type].level)); }
  const g = guild(s);
  earn(s, g, q.reward * 0.1);
  log(s, 'log.questDone', { m: '@m.' + q.type, r: q.reward });
  addFame(s, 2);
  s.stats.quests++;
  s.ys.quests++;
  s.quests = s.quests.filter((o) => o !== q);
}

// ---------- expeditions ----------

function expeditionTick(s: GameState) {
  const e = s.exp;
  if (!e) return;
  const members = () => e.members.map((id) => npcById(s, id)).filter((n): n is Npc => !!n);
  if (e.state === 'recruit') {
    e.members = members().filter((n) => n.state === 'inside' && n.goal === 'expWait').map((n) => n.id);
    if (s.time < e.until) return;
    if (!e.members.length) { log(s, 'log.expCancel', { loc: '@ex.' + e.loc }); s.exp = null; return; }
    e.state = 'depart';
    for (const n of members()) { leave(s, n); goTo(s, n, EAST_EXIT.x, EAST_EXIT.y, 'exitExp'); }
    log(s, 'log.expDepart', { loc: '@ex.' + e.loc, c: e.members.length });
    return;
  }
  if (e.state === 'depart') {
    e.members = members().filter((n) => n.state === 'away' || (n.state === 'walk' && n.goal === 'exitExp')).map((n) => n.id);
    if (!e.members.length) { s.exp = null; return; }
    if (members().every((n) => n.state === 'away')) {
      const def = EXPEDITIONS.find((x) => x.key === e.loc)!;
      e.state = 'away'; e.until = s.time + def.days * DAY; e.nextDay = s.time + DAY;
    }
    return;
  }
  if (s.time >= e.nextDay && s.time < e.until) { e.nextDay += DAY; expeditionDay(s, e, members()); }
  if (s.time >= e.until) {
    const ms = members();
    const items = Object.entries(e.loot);
    let i = 0;
    for (const [k, c] of items) for (let j = 0; j < c; j++) { const n = ms[i++ % ms.length]; n.bag[k] = (n.bag[k] ?? 0) + 1; }
    for (const n of ms) {
      n.x = EAST_EXIT.x + 0.5; n.y = EAST_EXIT.y + 0.5; n.hunger = 60;
      n.hp = Math.max(n.hp, 1);
      goBuilding(s, n, guild(s), 'deposit');
    }
    s.stats.expeditions++;
    s.ys.expeditions++;
    for (const n of ms) { n.exps = (n.exps ?? 0) + 1; checkTitles(s, n); bio(s, n, 'bio.expedition', { loc: '@ex.' + e.loc, w: e.wins }); }
    addFame(s, 5 + Math.floor(e.wins / 3));
    if (!s.stats.expLocs.includes(e.loc)) s.stats.expLocs.push(e.loc);
    // a clean run lets the next party push one floor deeper
    if (e.wins > e.losses * 2) {
      s.depth[e.loc] = (s.depth[e.loc] ?? 0) + 1;
      log(s, 'log.deeper', { loc: '@ex.' + e.loc, d: s.depth[e.loc] + 1 });
    }
    log(s, 'log.expReturn', { loc: '@ex.' + e.loc, w: e.wins, l: e.losses, c: items.reduce((a, [, c]) => a + c, 0) });
    s.exp = null;
  }
}

function expeditionDay(s: GameState, e: Expedition, ms: Npc[]) {
  const def = EXPEDITIONS.find((x) => x.key === e.loc)!;
  const battles = 2 + ms.length;
  for (let b = 0; b < battles; b++) {
    const type = pick(def.monsters);
    if (!s.seen.includes(type)) s.seen.push(type);
    const depth = s.depth[e.loc] ?? 0;
    const mst = monsterStats(s, type, { lv: s.mlv[type].level + depth * DEPTH_LEVELS } as Monster);
    const g = randi(1, 3);
    const sts = ms.map((n) => fighterStats(s, n));
    const partyDps = sts.reduce((a, st) => a + Math.max(1, st.atk - mst.def * 0.5) / st.interval, 0);
    const partyHp = ms.reduce((a, n) => a + n.hp, 0);
    const partyDef = sts.reduce((a, st) => a + st.def, 0) / sts.length;
    const ttkM = (g * mst.maxHp) / partyDps;
    const ttkP = partyHp / ((g * Math.max(1, mst.atk - partyDef * 0.5)) / MONSTER_INTERVAL);
    const avgL = ms.reduce((a, n) => a + n.level, 0) / ms.length;
    if (ttkM < ttkP * rand(0.7, 1.3)) {
      e.wins++;
      const frac = Math.min(0.8, (ttkM / ttkP) * 0.5);
      for (const n of ms) { n.hp = Math.max(1, n.hp - maxHp(s, n) * frac * rand(0.5, 1)); gainNpcExp(s, n, expReward(mst.level) * g); }
      gainMonsterExp(s, type, expReward(avgL) * 0.05 * g);
      const count = Math.max(1, Math.round(dropCount(mst.level) * g * mods(s).drops * (1 + 0.15 * depth)));
      for (let i = 0; i < count; i++) {
        const item = weighted(MONSTERS[type].drops, (d) => d[1])![0];
        e.loot[item] = (e.loot[item] ?? 0) + 1;
        if (!s.disc.includes(item)) s.disc.push(item);
      }
    } else {
      e.losses++;
      for (const n of ms) { n.hp = Math.max(1, n.hp * 0.5); gainNpcExp(s, n, expReward(mst.level) * 0.05); }
      gainMonsterExp(s, type, expReward(avgL));
    }
    if (ms.every((n) => n.hp < maxHp(s, n) * 0.2)) { e.until = s.time; break; }
  }
  for (const n of ms) n.hp = Math.min(maxHp(s, n), n.hp + maxHp(s, n) * 0.1);
}
