import { BUILDINGS, ITEMS, BASE_ITEMS } from './data';
import { addItem, guild, isNight, log, note } from './state';
import { emote } from './social';
import { chance, dist, pick, rand, weighted } from './util';
import { doorOf, findPath, randomStreetTile } from './world';
import type { Cat, GameState } from './types';

export const CAT_MAX = 10;
export const catNeed = (lv: number) => Math.floor(6 * lv ** 1.5);
export const catTouristBonus = (s: GameState) => (s.cat ? 0.01 * s.cat.lv : 0);
// level at which each perk starts
export const CAT_PERKS: [string, number][] = [['visitors', 1], ['gifts', 3], ['lucky', 5], ['ribbon', 7], ['bell', 10]];
export const hasPerk = (s: GameState, k: string) => !!s.cat && s.cat.lv >= CAT_PERKS.find((p) => p[0] === k)![1];
export const LUCKY_BONUS = 0.15;

const SPEED = 1.3;

export function catGain(s: GameState, v: number) {
  const c = s.cat;
  if (!c || c.lv >= CAT_MAX) return;
  c.exp += v;
  while (c.lv < CAT_MAX && c.exp >= catNeed(c.lv)) {
    c.exp -= catNeed(c.lv);
    c.lv++;
    log(s, 'log.catLevel', { lv: c.lv });
    note(s, 'log.catLevel', { lv: c.lv });
  }
}

function setAct(c: Cat, act: string, t: number) { c.act = act; c.timer = t; c.path = []; }

function walkTo(s: GameState, c: Cat, x: number, y: number, then = 'sit') {
  c.path = findPath(s, Math.floor(c.x), Math.floor(c.y), x, y);
  c.act = 'walk';
  c.timer = 0;
  c.at = null;
  c.target = then === 'follow' ? c.target : null;
  c.next = then;
}

// the guild cat wanders the streets by day, naps at a doorstep and curls up by the guild at night
function decide(s: GameState, c: Cat) {
  if (isNight(s)) {
    const d = doorOf(guild(s));
    if (dist(c.x, c.y, d.x + 0.5, d.y + 0.5) > 1.5) return walkTo(s, c, d.x, d.y, 'sleep');
    return setAct(c, 'sleep', 30);
  }
  if (c.act === 'sleep') return setAct(c, 'stretch', 2);
  const wet = s.weather !== 'clear';
  const shops = s.buildings.filter((b) => BUILDINGS[b.type].price > 0);
  const choice = weighted([
    ['walk', 30], ['door', wet ? 40 : 20], ['sit', 15], ['groom', 10], ['lie', wet ? 0 : 10], ['follow', 10], ['nap', 5],
  ] as [string, number][], (x) => x[1])![0];
  switch (choice) {
    case 'walk': { const p = randomStreetTile(s); return walkTo(s, c, p.x, p.y, 'sit'); }
    case 'door': {
      if (!shops.length) return setAct(c, 'sit', rand(3, 6));
      const b = pick(shops), d = doorOf(b);
      walkTo(s, c, d.x, d.y, 'door');
      c.at = b.id;
      return;
    }
    case 'follow': {
      const near = s.npcs.filter((n) => n.inside == null && n.state !== 'away' && dist(n.x, n.y, c.x, c.y) < 8);
      if (!near.length) return setAct(c, 'sit', rand(3, 6));
      c.target = pick(near).id;
      c.act = 'follow';
      c.timer = rand(8, 14);
      return;
    }
    case 'nap': return setAct(c, 'sleep', rand(10, 20));
    default: return setAct(c, choice, rand(3, 7));
  }
}

function step(c: Cat, dt: number): boolean {
  let budget = SPEED * dt;
  while (budget > 0 && c.path.length) {
    const p = c.path[0];
    const dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy);
    if (Math.abs(dx - dy) > 0.01) c.facing = dx - dy > 0 ? 1 : -1;
    if (d <= budget) { c.x = p.x; c.y = p.y; c.path.shift(); budget -= d; }
    else { c.x += (dx / d) * budget; c.y += (dy / d) * budget; budget = 0; }
  }
  return !c.path.length;
}

let npcPetTimer = 0;

export function catTick(s: GameState, dt: number) {
  const c = s.cat;
  if (!c) return;
  c.timer -= dt;
  if (c.act === 'walk') {
    if (step(c, dt)) {
      const next = c.next ?? 'sit';
      if (next === 'sleep') setAct(c, 'sleep', 30);
      else if (next === 'door') { c.act = 'sit'; c.timer = rand(8, 16); }
      else setAct(c, Math.random() < 0.3 ? 'groom' : 'sit', rand(3, 6));
    }
    return;
  }
  if (c.act === 'follow') {
    const n = s.npcs.find((o) => o.id === c.target);
    if (!n || n.inside != null || c.timer <= 0) { c.target = null; setAct(c, 'sit', rand(2, 4)); return; }
    const d = dist(n.x, n.y, c.x, c.y);
    if (d > 1.2) {
      const k = Math.min(1, (SPEED * 1.2 * dt) / d);
      if (Math.abs(n.x - c.x - (n.y - c.y)) > 0.01) c.facing = n.x - c.x - (n.y - c.y) > 0 ? 1 : -1;
      c.x += (n.x - c.x) * k; c.y += (n.y - c.y) * k;
    }
    return;
  }
  if (c.act === 'sleep' && isNight(s)) { c.timer = Math.max(c.timer, 1); return; }
  npcPetTimer += dt;
  if (npcPetTimer > 3 && (c.act === 'sit' || c.act === 'lie')) {
    npcPetTimer = 0;
    const n = s.npcs.find((o) => o.inside == null && o.role !== 'fighter' && dist(o.x, o.y, c.x, c.y) < 1.3);
    if (n && chance(0.25)) { emote(s, n, 'heart'); catGain(s, 0.5); setAct(c, 'happy', 2); return; }
  }
  if (c.timer <= 0) decide(s, c);
}

export function petCat(s: GameState): boolean {
  const c = s.cat;
  if (!c || s.time - c.petT < 3) return false;
  c.petT = s.time;
  catGain(s, 2);
  setAct(c, 'happy', 2.5);
  return true;
}

// arrives on day 3; eats a little stored food each morning and, once fond of the village, brings presents
export function catDaily(s: GameState) {
  if (!s.cat) {
    if (s.day < 3) return;
    const d = doorOf(guild(s));
    s.cat = { x: d.x + 0.5, y: d.y + 0.5, path: [], act: 'sit', timer: 5, facing: 1, lv: 1, exp: 0, fed: -1, petT: -99, at: null, target: null, since: s.day };
    log(s, 'log.catArrive');
    note(s, 'log.catArrive');
    return;
  }
  const c = s.cat;
  const food = (s.items.meat ?? 0) > 0 ? 'meat' : (s.items.fruit ?? 0) > 0 ? 'fruit' : null;
  if (food && c.fed !== s.day) { s.items[food]--; c.fed = s.day; catGain(s, 1); }
  if (hasPerk(s, 'gifts') && chance(0.15)) {
    const pool = s.disc.filter((k) => ITEMS[k] && !BASE_ITEMS.includes(k));
    const rare = hasPerk(s, 'bell') && chance(0.3);
    const item = rare ? pick(['gem', 'pearl', 'moonstone', 'amber']) : pool.length ? pick(pool) : 'fruit';
    const n = rare ? 1 : 1 + Math.floor(c.lv / 3);
    addItem(s, item, n);
    log(s, 'log.catGift', { item: '@item.' + item, v: n });
  }
}

export const luckyAt = (s: GameState, id: number) => hasPerk(s, 'lucky') && s.cat?.at === id && s.cat.act !== 'walk';
