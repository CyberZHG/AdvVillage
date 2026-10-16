import { MONSTERS, type Fam } from './data';
import { log, newId, note, year } from './state';
import { chance, rand } from './util';
import { randomStreetTile } from './world';
import type { GameState, Monster } from './types';

// a tamed monster helps in a way that suits its kind
export const PET_ROLE: Partial<Record<Fam, string>> = {
  slime: 'mascot', frog: 'mascot', mushroom: 'mascot', plant: 'mascot', mimic: 'mascot',
  beast: 'hauler', boar: 'hauler', bear: 'hauler', golem: 'hauler', crab: 'hauler', beetle: 'hauler',
  bird: 'scout', flyer: 'scout', wisp: 'scout', ghost: 'scout', snake: 'scout', spider: 'scout', scorpion: 'scout',
};
export const PET_BONUS: Record<string, number> = { mascot: 0.03, hauler: 0.04, scout: 0.03 };
const TAME_RATE = 1 / 300;

export const petCap = (s: GameState) => Math.min(8, 2 + Math.floor(year(s) / 3));
export const petRole = (type: string) => PET_ROLE[MONSTERS[type].fam];
export const petBonus = (s: GameState, role: string) => s.pets.filter((p) => petRole(p.type) === role).length * PET_BONUS[role];

export function tryTame(s: GameState, m: Monster, by: number) {
  const d = MONSTERS[m.type];
  if (m.boss != null || d.zone < 0 || d.zone > 1 || !petRole(m.type) || !chance(TAME_RATE)) return;
  if (s.pets.length >= petCap(s) || s.pets.some((p) => p.type === m.type)) return;
  const p = randomStreetTile(s);
  s.pets.push({ id: newId(s), type: m.type, x: m.x, y: m.y, tx: p.x + 0.5, ty: p.y + 0.5, wait: 0, facing: 1, since: s.day });
  log(s, 'log.tamed', { n: '@name:' + by, m: '@m.' + m.type });
  note(s, 'log.tamed', { n: '@name:' + by, m: '@m.' + m.type });
}

export function petsTick(s: GameState, dt: number) {
  for (const p of s.pets) {
    if (p.wait > 0) { p.wait -= dt; continue; }
    const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
    if (d < 0.1) {
      const t = randomStreetTile(s);
      p.tx = t.x + 0.5; p.ty = t.y + 0.5; p.wait = rand(2, 6);
      continue;
    }
    const sp = Math.min(d, 1.1 * dt);
    if (Math.abs(dx - dy) > 0.01) p.facing = dx - dy > 0 ? 1 : -1;
    p.x += (dx / d) * sp; p.y += (dy / d) * sp;
  }
}

export function releasePet(s: GameState, id: number) {
  const p = s.pets.find((o) => o.id === id);
  if (!p) return;
  s.pets = s.pets.filter((o) => o !== p);
  log(s, 'log.released', { m: '@m.' + p.type });
}
