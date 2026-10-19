import { DAY, MAP } from './constants';
import { addItem, guild, log } from './state';
import { chance, pick } from './util';
import { WATER, doorOf, impassable, isRoad, terrainAt, terrainState, villageDist } from './world';
import type { GameState, Npc, P } from './types';

// which regional townsfolk live in the village, refreshed whenever the day or the head count changes
const cache = { key: '', set: new Set<string>() };
export function hasJob(s: GameState, job: string) {
  const key = `${s.village}:${s.day}:${s.npcs.length}`;
  if (cache.key !== key) { cache.key = key; cache.set = new Set(s.npcs.filter((n) => n.role === 'civilian' && n.home != null).map((n) => n.job)); }
  return cache.set.has(job);
}

// dry tiles on the water's edge close to the village, where the fisherman casts his line
let shore: P[] = [], shoreKey = '';
function fishingSpots(s: GameState) {
  const key = `${s.village}:${terrainState.version}`;
  if (shoreKey !== key) {
    shoreKey = key; shore = [];
    for (let y = 1; y < MAP - 1; y++) for (let x = 1; x < MAP - 1; x++) {
      if (impassable(x, y) || villageDist(x, y) > 5) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => terrainAt(x + dx, y + dy) === WATER)) shore.push({ x, y });
    }
  }
  return shore;
}
export const nearWater = (x: number, y: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [x + dx, y + dy]).find(([a, b]) => terrainAt(a, b) === WATER) ?? null;

// streets around the guild square, where the fortune teller sets up and the street performer draws a crowd
function squareSpot(s: GameState): P | null {
  const g = doorOf(guild(s)), out: P[] = [];
  for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) if (isRoad(g.x + dx, g.y + dy) && !impassable(g.x + dx, g.y + dy)) out.push({ x: g.x + dx, y: g.y + dy });
  return out.length ? pick(out) : null;
}

// where a regional townsperson heads next, or null to go about the usual day
export function jobSpot(s: GameState, n: Npc, night: boolean, street: () => P): P | null {
  switch (n.job) {
    case 'fortuneTeller': case 'performer': return night ? null : squareSpot(s);
    case 'fisherman': { const l = fishingSpots(s); return night || !l.length ? null : pick(l); }
    case 'ninja': return night && n.home != null ? street() : null;
    case 'rickshaw': return night ? null : street();
  }
  return null;
}
// how long they stay put once there
export const jobLinger = (job: string) => (job === 'fortuneTeller' || job === 'performer' || job === 'fisherman' ? 8 + Math.random() * 8 : job === 'rickshaw' ? 0.6 : 0);

export function jobsDaily(s: GameState) {
  // the fortune teller reads one adventurer's luck each morning: mostly a good day ahead, now and then a poor one
  if (hasJob(s, 'fortuneTeller')) {
    const fs = s.npcs.filter((n) => n.role === 'fighter' && n.home != null);
    if (fs.length) {
      const f = pick(fs), good = chance(0.75);
      f.luck = s.time + DAY; f.luckK = good ? 1.1 : 0.95;
      if (s.day % 30 === 0) log(s, good ? 'log.fortune' : 'log.fortuneBad', { n: '@name:' + f.name });
    }
  }
  if (hasJob(s, 'fisherman') && s.terrain?.water.length) { addItem(s, 'meat', 2); if (chance(0.3)) addItem(s, 'shell', 1); }
}
