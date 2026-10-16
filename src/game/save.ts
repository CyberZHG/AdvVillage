import { baseRoads, doorOf, syncBounds, syncRoads } from './world';
import { MAP } from './constants';
import { BUILDINGS, MONSTERS, VILLAGES, villageMods } from './data';
import { decode, encode } from './codec';
import { makeLook, randomJob } from './looks';
import { emptyYear } from './state';
import type { GameState } from './types';

const KEY = 'advvillage.save.';
const META = 'advvillage.meta';

export interface Meta { unlocked: number; best: Record<string, number>; lang?: string; ach: Record<string, number> }

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

const serialize = (s: GameState) => JSON.stringify({ ...s, fx: [] });

export function saveGame(s: GameState) {
  try { storage()?.setItem(KEY + s.village, encode(serialize(s))); } catch { /* quota or private mode */ }
}

export function loadGame(village: string): GameState | null {
  try {
    const raw = storage()?.getItem(KEY + village);
    return raw ? restore(JSON.parse(decode(raw)) as GameState) : null;
  } catch { return null; }
}

function restore(s: GameState): GameState {
  s.fx = [];
  s.stats.quests ??= 0;
  s.stats.rescues ??= 0;
  s.stats.expeditions ??= 0;
  s.stats.expLocs ??= [];
  s.comboSeen ??= []; s.weather ??= 'clear'; s.effects ??= []; s.bonds ??= {}; s.couples ??= []; s.reports ??= [];
  s.ys ??= emptyYear(); s.shinySeen ??= []; s.merchant ??= null; s.nextBoss ??= s.day + 30;
  s.vlv ??= 0;
  syncBounds(s);
  if (!s.roads) migrateRoads(s);
  migrateMonstersAndLooks(s);
  return s;
}

export const hasSave = (village: string) => { try { return !!storage()?.getItem(KEY + village); } catch { return false; } };
export const deleteSave = (village: string) => { try { storage()?.removeItem(KEY + village); } catch { /* ignore */ } };

export function loadMeta(): Meta {
  const base: Meta = { unlocked: 0, best: {}, ach: {} };
  try {
    const raw = storage()?.getItem(META);
    return raw ? { ...base, ...JSON.parse(decode(raw)) } : base;
  } catch { return base; }
}

export function saveMeta(m: Meta) {
  try { storage()?.setItem(META, encode(JSON.stringify(m))); } catch { /* ignore */ }
}

// a backup bundles every village save with the shared progress (unlocks, best scores, achievements)
export function exportAll(meta: Meta, current: GameState | null): string {
  const saves: Record<string, unknown> = {};
  for (const v of VILLAGES) {
    if (current?.village === v.key) { saves[v.key] = JSON.parse(serialize(current)); continue; }
    const raw = storage()?.getItem(KEY + v.key);
    if (raw) try { saves[v.key] = JSON.parse(decode(raw)); } catch { /* skip broken slot */ }
  }
  return encode(JSON.stringify({ kind: 'advvillage-backup', v: 1, at: Date.now(), meta, saves }));
}

export function importAll(text: string): Meta {
  const data = JSON.parse(decode(text));
  if (data?.kind !== 'advvillage-backup') throw new Error('not a backup');
  for (const [k, save] of Object.entries(data.saves ?? {})) {
    if (!VILLAGES.some((v) => v.key === k)) continue;
    storage()?.setItem(KEY + k, encode(JSON.stringify(save)));
  }
  const meta: Meta = { unlocked: 0, best: {}, ach: {}, ...data.meta };
  saveMeta(meta);
  return meta;
}

// v1 saves had no roads: lay the main streets and connect every existing door
function migrateRoads(s: GameState) {
  for (const b of s.buildings) b.rot ??= 0;
  const set = new Set(baseRoads());
  const covered = new Set<number>();
  for (const b of s.buildings) {
    const n = BUILDINGS[b.type].size;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) covered.add((b.y + j) * MAP + b.x + i);
  }
  for (const i of [...set]) if (covered.has(i)) set.delete(i);
  for (const b of s.buildings) { const d = doorOf(b); set.add(d.y * MAP + d.x); }
  s.roads = [...set];
  syncRoads(s);
}

// v2 saves predate the larger roster and layered looks
function migrateMonstersAndLooks(s: GameState) {
  const m = villageMods(s.village);
  for (const [k, d] of Object.entries(MONSTERS)) s.mlv[k] ??= { level: d.base + m.monsterLevel, exp: 0 };
  s.monsters = s.monsters.filter((x) => MONSTERS[x.type]);
  for (const n of s.npcs) {
    if (n.look.outfit !== undefined) continue;
    n.job = n.role === 'fighter' ? '' : randomJob(n.role);
    n.look = makeLook(n.role, n.cls, n.job);
  }
  for (const p of s.profiles) {
    if (p.look.outfit !== undefined) continue;
    p.job = randomJob('tourist');
    p.look = makeLook('tourist', 'warrior', p.job);
  }
  for (const n of s.npcs) if (n.role === 'tourist' && s.profiles[n.profile]) { n.look = s.profiles[n.profile].look; n.job = s.profiles[n.profile].job; }
}
