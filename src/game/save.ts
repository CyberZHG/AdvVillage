import { baseRoads, doorOf, makeTerrain, syncBounds, syncBuried, syncRoads } from './world';
import { MAP } from './constants';
import { BUILDINGS, MONSTERS, VILLAGES, villageMods } from './data';
import { decode, encode } from './codec';
import { makeLook, randomJob, recolor } from './looks';
import { emptyYear } from './state';
import type { GameState } from './types';
import { PROMOTE_LEVEL } from './constants';

const KEY = 'advvillage.save.';
const META = 'advvillage.meta';

export interface Meta { unlocked: number; best: Record<string, number>; lang?: string; ach: Record<string, number>; crowd?: string; legacy?: { champs: string[]; finalHp: number; finalDown: boolean } }

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

const serialize = (s: GameState) => JSON.stringify({ ...s, fx: [], notes: [] });

export function saveGame(s: GameState) {
  s.savedAt = Date.now();
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
  s.fame ??= 0; s.commissions ??= []; s.cseason ??= -1; s.rivals ??= []; s.nextVip ??= s.day + 30; s.vips ??= []; s.notes = [];
  s.research ??= {}; s.researching ??= null; s.rqueue ??= []; s.auto ??= { research: false, forge: false, upgrade: false }; s.depth ??= {}; s.pets ??= []; s.cat ??= null; s.hist ??= [];
  s.histBase ??= { e: s.stats.earned ?? 0, t: s.stats.tourists, k: s.stats.kills };
  for (const n of s.npcs) if (n.role === 'fighter' && n.level >= PROMOTE_LEVEL && !n.promoted) { n.promoted = true; n.look.cape = true; }
  s.stats.earned ??= 0; s.stats.commissions ??= 0; s.stats.goods ??= 0; s.stats.fk ??= {};
  if (!s.terrain) {
    // older villages get their terrain too, minus any tiles already built on; roads keep crossing it as bridges and trails
    const covered = new Set(s.buildings.flatMap((b) => { const n = BUILDINGS[b.type].size, o: number[] = []; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) o.push((b.y + j) * MAP + b.x + i); return o; }));
    const roads = new Set(s.roads ?? []);
    const tr = makeTerrain(s.village);
    s.terrain = { water: tr.water.filter((i) => !covered.has(i)), rock: tr.rock.filter((i) => !covered.has(i) && !roads.has(i)), bog: tr.bog.filter((i) => !covered.has(i)), thicket: tr.thicket.filter((i) => !covered.has(i)) };
    const solid = new Set([...s.terrain.water, ...s.terrain.rock]);
    s.nodes = s.nodes.filter((n) => !solid.has(n.y * MAP + n.x));
  }
  if (!s.terrain.vent) {
    // vents, caves and flower meadows arrived later; add them where nothing stands
    const tr = makeTerrain(s.village), busy = new Set([...(s.roads ?? []), ...s.buildings.map((b) => b.y * MAP + b.x)]);
    s.terrain.vent = (tr.vent ?? []).filter((i) => !busy.has(i));
    s.terrain.cave = (tr.cave ?? []).filter((i) => !busy.has(i));
    s.terrain.flowers = tr.flowers ?? [];
  }
  if (!s.terrain.stream) { const busy = new Set([...(s.roads ?? []), ...s.buildings.map((b) => b.y * MAP + b.x)]); s.terrain.stream = (makeTerrain(s.village).stream ?? []).filter((i) => !busy.has(i)); }
  if (!s.terrain.sea) {
    // streams now join edge to edge; the coast, the gorge and the volcano's hot springs came later still
    const tr = makeTerrain(s.village), busy = new Set([...(s.roads ?? []), ...s.buildings.map((b) => b.y * MAP + b.x)]);
    s.terrain.stream = (tr.stream ?? []).filter((i) => !busy.has(i));
    s.terrain.sea = tr.sea ?? []; s.terrain.beach = tr.beach ?? []; s.terrain.canyon = tr.canyon ?? [];
    const water = new Set(s.terrain.water), rock = new Set(s.terrain.rock), vent = new Set(s.terrain.vent ?? []);
    for (const i of s.terrain.sea) if (tr.water.includes(i)) water.add(i); else if (tr.rock.includes(i)) rock.add(i);
    for (const i of tr.vent ?? []) if (!busy.has(i)) vent.add(i);
    s.terrain.water = [...water]; s.terrain.rock = [...rock]; s.terrain.vent = [...vent];
    const gone = new Set([...s.terrain.sea, ...s.terrain.canyon, ...vent]);
    s.nodes = s.nodes.filter((n) => !gone.has(n.y * MAP + n.x));
  }
  if (!s.terrain.spring) {
    // hot spring pools came later; they fill in wherever nothing stands
    const busy = new Set([...(s.roads ?? []), ...s.buildings.flatMap((b) => { const n = BUILDINGS[b.type].size, o: number[] = []; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) o.push((b.y + j) * MAP + b.x + i); return o; })]);
    s.terrain.spring = (makeTerrain(s.village).spring ?? []).filter((i) => !busy.has(i));
    const gone = new Set(s.terrain.spring);
    for (const k of ['rock', 'bog', 'thicket'] as const) s.terrain[k] = s.terrain[k].filter((i) => !gone.has(i));
    s.nodes = s.nodes.filter((n) => !gone.has(n.y * MAP + n.x));
  }
  if (!s.terrain.battle) {
    // mangroves, the stone forest, travertine terraces, the glacier, sinkholes, battlefields and the new bamboo
    // stream came later; they settle wherever nothing stands
    const busy = new Set([...(s.roads ?? []), ...s.buildings.flatMap((b) => { const n = BUILDINGS[b.type].size, o: number[] = []; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) o.push((b.y + j) * MAP + b.x + i); return o; })]);
    const tr = makeTerrain(s.village), free = (l: number[] | undefined) => (l ?? []).filter((i) => !busy.has(i));
    const added = [...free(tr.mangrove), ...free(tr.pillar), ...free(tr.glacier), ...free(tr.crevasse)];
    s.terrain.mangrove = free(tr.mangrove); s.terrain.pillar = free(tr.pillar); s.terrain.glacier = free(tr.glacier); s.terrain.crevasse = free(tr.crevasse);
    s.terrain.battle = tr.battle ?? [];
    s.terrain.spring = [...new Set([...(s.terrain.spring ?? []), ...free(tr.spring)])];
    s.terrain.stream = [...new Set([...(s.terrain.stream ?? []), ...free(tr.stream)])];
    const gone = new Set([...added, ...s.terrain.spring, ...s.terrain.stream]);
    for (const k of ['water', 'rock', 'bog', 'thicket'] as const) s.terrain[k] = s.terrain[k].filter((i) => !gone.has(i) || (k === 'water' && !added.includes(i) && !s.terrain!.spring!.includes(i)));
    s.nodes = s.nodes.filter((n) => !gone.has(n.y * MAP + n.x));
  }
  {
    // caves added to a village's definition later (the iron village's one inside its walls, without which the mine
    // shaft could never be built) are dug where defined, or on the nearest open tile if something stands there
    const busy = new Set([...(s.roads ?? []), ...s.buildings.flatMap((b) => { const n = BUILDINGS[b.type].size, o: number[] = []; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) o.push((b.y + j) * MAP + b.x + i); return o; })]);
    const t = s.terrain as unknown as Record<string, number[] | undefined>;
    const used = new Set(Object.values(t).flatMap((l) => l ?? []));
    const open = (i: number) => !busy.has(i) && !used.has(i) && i % MAP !== 32 && ((i / MAP) | 0) !== 32;
    s.terrain.cave ??= [];
    for (const c of makeTerrain(s.village).cave ?? []) {
      if (s.terrain.cave.includes(c)) continue;
      const cx = c % MAP, cy = (c / MAP) | 0;
      let at = -1;
      for (let r = 0; r < 8 && at < 0; r++) for (let dy = -r; dy <= r && at < 0; dy++) for (let dx = -r; dx <= r && at < 0; dx++) {
        const i = (cy + dy) * MAP + cx + dx;
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r && open(i)) at = i;
      }
      if (at < 0) continue;
      s.terrain.cave.push(at); used.add(at);
      s.nodes = s.nodes.filter((n) => n.y * MAP + n.x !== at);
    }
  }
  // the gorge follows its definition, whatever an older save recorded
  const wantCanyon = makeTerrain(s.village).canyon ?? [];
  if (s.terrain.canyon?.length || wantCanyon.length) { s.terrain.canyon = wantCanyon; const gone = new Set(s.terrain.canyon); s.nodes = s.nodes.filter((n) => !gone.has(n.y * MAP + n.x)); }
  syncBounds(s);
  if (!s.roads) migrateRoads(s);
  syncBuried(s.buried);
  migrateMonstersAndLooks(s);
  if ((s.v ?? 1) < 3) {
    for (const n of s.npcs) if (n.role !== 'tourist') recolor(n.look, n.role, n.cls);
    for (const p of s.profiles) recolor(p.look, 'tourist', 'warrior');
    for (const n of s.npcs) if (n.role === 'tourist' && s.profiles[n.profile]) n.look = s.profiles[n.profile].look;
    s.v = 3;
  }
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
  // the maid is no longer a trade: anyone who was one takes up another and dresses for it
  for (const n of s.npcs) if (n.job === 'maid') { n.job = randomJob('civilian'); n.look = makeLook(n.role, n.cls, n.job); }
  for (const p of s.profiles) {
    if (p.look.outfit !== undefined) continue;
    p.job = randomJob('tourist');
    p.look = makeLook('tourist', 'warrior', p.job);
  }
  for (const n of s.npcs) if (n.role === 'tourist' && s.profiles[n.profile]) { n.look = s.profiles[n.profile].look; n.job = s.profiles[n.profile].job; }
}
