import { baseRoads, doorOf, syncBounds, syncRoads } from './world';
import { MAP } from './constants';
import { BUILDINGS } from './data';
import type { GameState } from './types';

const KEY = 'advvillage.save.';
const META = 'advvillage.meta';

export interface Meta { unlocked: number; best: Record<string, number>; lang?: string }

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function saveGame(s: GameState) {
  try { storage()?.setItem(KEY + s.village, JSON.stringify({ ...s, fx: [] })); } catch { /* quota or private mode */ }
}

export function loadGame(village: string): GameState | null {
  try {
    const raw = storage()?.getItem(KEY + village);
    if (!raw) return null;
    const s = JSON.parse(raw) as GameState;
    s.fx = [];
    s.vlv ??= 0;
    syncBounds(s);
    if (!s.roads) migrateRoads(s);
    return s;
  } catch { return null; }
}

export const hasSave = (village: string) => { try { return !!storage()?.getItem(KEY + village); } catch { return false; } };
export const deleteSave = (village: string) => { try { storage()?.removeItem(KEY + village); } catch { /* ignore */ } };

export function loadMeta(): Meta {
  try { return { unlocked: 0, best: {}, ...JSON.parse(storage()?.getItem(META) ?? '{}') }; } catch { return { unlocked: 0, best: {} }; }
}

export function saveMeta(m: Meta) {
  try { storage()?.setItem(META, JSON.stringify(m)); } catch { /* ignore */ }
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
