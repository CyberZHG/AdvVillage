// Headless balance run: a naive auto-builder plays 16+ years.
import { newGame } from '../src/game/state';
import { step } from '../src/game/sim';
import { build, canBuild, upgrade, upgradeCost, hasCost, forgeableWeapons, forgeUpgrade, launchExpedition, computeScore } from '../src/game/econ';
import { canPlaceAt } from '../src/game/world';
import { EXPEDITIONS } from '../src/game/data';
import { TICK, DAY, DAYS_PER_YEAR } from '../src/game/constants';
import { VB } from '../src/game/world';
import { expand, expansionCost, placeRoad } from '../src/game/econ';
import { residents, year } from '../src/game/state';

const village = process.argv[2] ?? 'maple';
const years = Number(process.argv[3] ?? 16);
const s = newGame(village);
const order = ['restaurant', 'house', 'weaponShop', 'breakfastShop', 'house', 'armorShop', 'flowerbed', 'tavern', 'house', 'clinic', 'accessoryShop',
  'forge', 'cafe', 'house', 'inn', 'fountain', 'souvenirShop', 'house', 'bathhouse', 'bakery', 'house', 'teahouse', 'restaurant', 'house',
  'spa', 'flowerbed', 'house', 'theater', 'tavern', 'arena', 'statue'];
let oi = 0;

function layRoads() {
  for (let y = VB.min; y <= VB.max; y++) for (let x = VB.min; x <= VB.max; x++) {
    if (((x - 32) % 4 === 0 || (y - 32) % 4 === 0) && s.money > 2000) placeRoad(s, x, y);
  }
}

function tryPlace(type: string) {
  for (let y = VB.min; y <= VB.max; y += 1) for (let x = VB.min; x <= VB.max; x += 1) {
    if (canPlaceAt(s, type, x, y)) return build(s, type, x, y);
  }
  return false;
}

const t0 = Date.now();
const total = years * DAYS_PER_YEAR * DAY;
let lastDay = -1;
while (s.time < total) {
  step(s, TICK);
  s.fx.length = 0;
  if (s.day !== lastDay) {
    lastDay = s.day;
    const type = order[oi % order.length];
    const ec = expansionCost(s);
    if (ec && s.money > ec.money * 1.1) expand(s);
    if (s.day % 10 === 0) layRoads();
    if (type === 'forge' && s.buildings.some((b) => b.type === 'forge')) oi++;
    else if (canBuild(s, type) && tryPlace(type)) oi++;
    else if (oi >= order.length) {
      const b = s.buildings.filter((b) => b.type !== 'house').sort((a, b) => a.level - b.level)[0];
      if (b && hasCost(s, upgradeCost(b)) && s.money > upgradeCost(b).money * 2) upgrade(s, b);
    }
    for (const w of forgeableWeapons(s)) if (s.money > 60000) forgeUpgrade(s, w, 'village');
    if (!s.exp) { const ex = EXPEDITIONS.filter((e) => year(s) >= e.unlockYear).pop(); if (ex && s.day % 15 === 0) launchExpedition(s, ex.key); }
    if (s.day % DAYS_PER_YEAR === 0) {
      const f = s.npcs.filter((n) => n.role === 'fighter');
      const lv = f.map((n) => n.level).sort((a, b) => b - a);
      console.log(`Y${year(s)} vlv=${s.vlv} money=${Math.round(s.money)} res=${residents(s).length} f=${f.length} g=${s.npcs.filter(n=>n.role==='gatherer').length} c=${s.npcs.filter(n=>n.role==='civilian').length} t=${s.npcs.filter(n=>n.role==='tourist').length} prof=${s.profiles.length} bld=${s.buildings.length} mons=${s.monsters.length} fLv=[${lv.slice(0, 6).join(',')}] mLv=${Object.entries(s.mlv).filter(([k])=>['slime','wolf','skeleton','golem','treant','drake'].includes(k)).map(([k, v]) => k + v.level).join(' ')} kills=${s.stats.kills} items=${JSON.stringify(s.items)} wlv=${JSON.stringify(s.wlv)}`);
    }
  }
}
console.log('score', computeScore(s));
console.log('elapsed', (Date.now() - t0) / 1000, 's');
const states: Record<string, number> = {};
for (const n of s.npcs) states[n.role + ':' + n.state + ':' + (n.goal ?? '')] = (states[n.role + ':' + n.state + ':' + (n.goal ?? '')] ?? 0) + 1;
console.log(states);
console.log(s.log.slice(-25).map((l) => l.k + ' ' + JSON.stringify(l.p ?? {})).join('\n'));
const eqd: Record<string, number> = {};
for (const n of s.npcs.filter((n) => n.role === 'fighter')) for (const k of [n.weapon, n.armor, n.accessory]) eqd[k ?? 'none'] = (eqd[k ?? 'none'] ?? 0) + 1;
console.log(eqd);
console.log('hungry', s.npcs.filter((n) => n.role !== 'tourist' && n.hunger < 20).length, 'homeless', s.npcs.filter((n) => n.role !== 'tourist' && n.home == null).length);
console.log(s.buildings.map((b) => b.type + b.level).join(' '));
console.log(JSON.stringify(s.mlv));
import { bldExpNeed } from '../src/game/level';
const inc: Record<string, number> = {};
for (const b of s.buildings) { let e = b.exp; for (let l = 1; l < b.level; l++) e += bldExpNeed(l); inc[b.type] = Math.round((inc[b.type] ?? 0) + e); }
console.log('income by type', inc);
