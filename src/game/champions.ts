import { CLASSES, MONSTERS } from './data';
import { DAYS_PER_YEAR, SCORE_YEAR } from './constants';
import { CHAMPION, CHAMPION_BASE, FINAL, FINAL_MUL, legacy } from './legacy';
import { addItem, log, maxHp, monsterStats, newId } from './state';
import { pick } from './util';
import { randomZoneTile, villageDist } from './world';
import type { GameState, Monster, Npc } from './types';

// ---------- spawning ----------
// after the sixteenth year each village's champion comes out of the wilds and stays until it is beaten; once every
// village has beaten its champion, the final enemy appears in all of them at once, sharing one pool of health
export const CHAMP_TITLE = 8;
const topLevel = (s: GameState) => {
  const fs = s.npcs.filter((n) => n.role === 'fighter').map((n) => n.level).sort((a, b) => b - a).slice(0, 8);
  return fs.length ? fs.reduce((a, b) => a + b, 0) / fs.length : 10;
};
function place(s: GameState, type: string, champ: string, hpMul: number, lv: number): Monster {
  let p = randomZoneTile(1);
  for (let k = 0; k < 30 && villageDist(p.x, p.y) > 8; k++) p = randomZoneTile(1);
  const m: Monster = { id: newId(s), type, x: p.x + 0.5, y: p.y + 0.5, hp: 0, tx: p.x + 0.5, ty: p.y + 0.5, target: null, cd: 0, facing: 1, zone: 1, wait: 3, boss: CHAMP_TITLE, lv, champ, hpMul, skillCd: 8 };
  m.hp = monsterStats(s, type, m).maxHp;
  s.monsters.push(m);
  if (!s.seen.includes(type)) s.seen.push(type);
  return m;
}
export function championsDaily(s: GameState) {
  const present = s.monsters.find((m) => m.champ && m.champ !== 'final');
  const type = CHAMPION[s.village];
  if (type && !present && s.day >= SCORE_YEAR * DAYS_PER_YEAR && !legacy.champs.includes(s.village)) {
    // a thousand times an ordinary boss, doubling for every champion already beaten in any village
    const mul = CHAMPION_BASE * 2 ** legacy.champs.length;
    const m = place(s, type, s.village, mul, Math.max(60, Math.round(topLevel(s))));
    log(s, 'ev.champ', { m: '@champ.' + s.village, x: mul });
    void m;
  }
  const fin = s.monsters.find((m) => m.champ === 'final');
  if (legacy.finalDown && fin) s.monsters = s.monsters.filter((m) => m !== fin);
  if (!fin && !legacy.finalDown && Object.keys(CHAMPION).every((v) => legacy.champs.includes(v))) {
    const m = place(s, FINAL, 'final', FINAL_MUL, Math.max(90, Math.round(topLevel(s) * 1.25)));
    if (legacy.finalHp >= 0) m.hp = Math.min(m.hp, legacy.finalHp);
    log(s, 'ev.final');
  }
}
// the final boss's health is one pool across the villages: whatever is lost here is lost everywhere
export function syncFinal(s: GameState) {
  const fin = s.monsters.find((m) => m.champ === 'final');
  if (!fin) return;
  if (legacy.finalHp >= 0 && legacy.finalHp < fin.hp) fin.hp = legacy.finalHp;
  else legacy.finalHp = fin.hp;
}

// ---------- skills ----------
// each skill hits fighters for a share of their health and sends an effect for the renderer to play
type Hit = (s: GameState, f: Npc, share: number) => void;
interface SkillCtx { s: GameState; m: Monster; foes: Npc[]; hit: Hit; fx: (k: string, x: number, y: number, tx?: number, ty?: number) => void }
type Skill = (c: SkillCtx) => void;
const near = (foes: Npc[], x: number, y: number, r: number) => foes.filter((f) => Math.hypot(f.x - x, f.y - y) <= r);
const stun = (f: Npc, sec: number) => { f.cd = Math.max(f.cd, CLASSES[f.cls].interval + sec); };
// an area blow at one fighter's feet
const blast = (k: string, r: number, share: number): Skill => (c) => { const t = pick(c.foes); c.fx(k, c.m.x, c.m.y, t.x, t.y); for (const f of near(c.foes, t.x, t.y, r)) c.hit(c.s, f, share); };
// several blows, each at a different fighter
const volley = (k: string, n: number, r: number, share: number): Skill => (c) => { for (let i = 0; i < n; i++) { const t = pick(c.foes); const ox = (Math.random() - 0.5) * 1.5, oy = (Math.random() - 0.5) * 1.5; c.fx(k, c.m.x, c.m.y, t.x + ox, t.y + oy); for (const f of near(c.foes, t.x + ox, t.y + oy, r)) c.hit(c.s, f, share); } };
// everything round the boss
const ring = (k: string, r: number, share: number, stunSec = 0): Skill => (c) => { c.fx(k, c.m.x, c.m.y); for (const f of near(c.foes, c.m.x, c.m.y, r)) { c.hit(c.s, f, share); if (stunSec) stun(f, stunSec); } };
// a line from the boss through its target
const line = (k: string, len: number, share: number, dash = false): Skill => (c) => {
  const t = pick(c.foes), d = Math.hypot(t.x - c.m.x, t.y - c.m.y) || 1, ux = (t.x - c.m.x) / d, uy = (t.y - c.m.y) / d;
  c.fx(k, c.m.x, c.m.y, c.m.x + ux * len, c.m.y + uy * len);
  for (const f of c.foes) { const along = (f.x - c.m.x) * ux + (f.y - c.m.y) * uy, off = Math.abs((f.x - c.m.x) * uy - (f.y - c.m.y) * ux); if (along > 0 && along < len && off < 1.2) c.hit(c.s, f, share); }
  if (dash) { c.m.x += ux * Math.min(len, d); c.m.y += uy * Math.min(len, d); }
};
// a cone breathed toward the target
const cone = (k: string, len: number, share: number): Skill => (c) => {
  const t = pick(c.foes), a0 = Math.atan2(t.y - c.m.y, t.x - c.m.x);
  c.fx(k, c.m.x, c.m.y, t.x, t.y);
  for (const f of c.foes) { const d = Math.hypot(f.x - c.m.x, f.y - c.m.y), a = Math.atan2(f.y - c.m.y, f.x - c.m.x); if (d < len && Math.abs(((a - a0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.6) c.hit(c.s, f, share); }
};
// a portal and a few minions from it
const summon = (k: string, type: string, n: number): Skill => (c) => {
  if (!MONSTERS[type] || c.s.monsters.length > 120) return;
  for (let i = 0; i < n; i++) {
    const x = c.m.x + Math.cos(i * 2.1) * 2, y = c.m.y + Math.sin(i * 2.1) * 2;
    c.fx(k, x, y);
    const mm: Monster = { id: newId(c.s), type, x, y, hp: 0, tx: x, ty: y, target: null, cd: 1, facing: 1, zone: c.m.zone, wait: 1, lv: Math.round((c.m.lv ?? 50) * 0.6), born: c.s.time };
    mm.hp = monsterStats(c.s, type, mm).maxHp;
    c.s.monsters.push(mm);
  }
};
// rooted in place
const bind = (k: string, n: number, share: number, sec: number): Skill => (c) => { for (let i = 0; i < n; i++) { const t = pick(c.foes); c.fx(k, t.x, t.y); c.hit(c.s, t, share); stun(t, sec); } };

export const SKILLS: Record<string, [string, Skill][]> = {
  crimsonStag: [['leafstorm', blast('leafstorm', 2.2, 0.25)], ['antlerCharge', line('charge', 5, 0.22, true)], ['rootBind', bind('roots', 3, 0.15, 3)]],
  magmaColossus: [['fireball', volley('fireball', 3, 1.2, 0.25)], ['quake', ring('quake', 4, 0.2, 1)], ['lavaBurst', blast('explosion', 2, 0.3)]],
  serpentQueen: [['poison', blast('poison', 2.5, 0.2)], ['waterspout', volley('waterspout', 2, 1, 0.25)], ['summonWisps', summon('portal', 'bogLantern', 3)]],
  frostWyrm: [['frostBreath', cone('breath', 6, 0.25)], ['icicleRain', volley('icicle', 5, 1, 0.15)], ['blizzard', ring('blizzard', 8, 0.1, 2)]],
  duneDjinn: [['sandstorm', blast('sandstorm', 2.2, 0.25)], ['sunbeam', blast('sunbeam', 1, 0.4)], ['summonScarabs', summon('portal', 'scarab', 4)]],
  worldEater: [['meteorRain', volley('meteor', 6, 1.5, 0.25)], ['voidBeam', line('voidbeam', 9, 0.35)], ['voidOrbs', volley('voidorb', 4, 1.2, 0.25)], ['summonShades', summon('portal', 'shadowBeast', 2)], ['roar', ring('roar', 9, 0.08, 2)]],
};

export function championTick(s: GameState, m: Monster, dt: number, down: (f: Npc) => void) {
  m.skillCd = (m.skillCd ?? 6) - dt;
  if (m.skillCd > 0) return;
  const foes = s.npcs.filter((n) => n.role === 'fighter' && n.inside == null && n.state !== 'down' && n.state !== 'away' && n.state !== 'carried' && Math.hypot(n.x - m.x, n.y - m.y) < 9);
  m.skillCd = m.champ === 'final' ? 4 : 6;
  if (!foes.length) return;
  const list = SKILLS[m.type];
  if (!list) return;
  const [key, run] = pick(list);
  m.castT = s.time;
  const hit: Hit = (ss, f, share) => { const dmg = Math.round(maxHp(ss, f) * share * 0.7); f.hp -= dmg; ss.fx.push({ kind: 'dmg', x: f.x, y: f.y, v: dmg }); if (f.hp <= 0) down(f); };
  // the boss turns to face what it is aiming at, so a breath or beam comes from its jaws
  run({ s, m, foes, hit, fx: (k, x, y, tx, ty) => {
    if (tx != null && ty != null && x === m.x && y === m.y && Math.abs(tx - ty - (m.x - m.y)) > 0.1) m.facing = tx - ty > m.x - m.y ? 1 : -1;
    s.fx.push({ kind: 'boss', x, y, v: k, tx, ty, m: m.type, f: m.facing });
  } });
  s.fx.push({ kind: 'skill', x: m.x, y: m.y, v: 'boss.' + key });
}

// ---------- defeat ----------
export function championDown(s: GameState, m: Monster) {
  const L = m.lv ?? 60;
  if (m.champ === 'final') {
    legacy.finalDown = true; legacy.finalHp = 0;
    (s.vstat ??= {}).finalDown = 1;
    s.money += 50000 * L;
    for (const it of ['voidShard', 'soulGem', 'dragonFang', 'starDust']) addItem(s, it, 20);
    log(s, 'ev.finalDown');
    return;
  }
  if (!legacy.champs.includes(s.village)) legacy.champs.push(s.village);
  (s.vstat ??= {}).champDown = 1;
  s.money += 5000 * L;
  for (const it of ['gem', 'mithril', 'soulGem']) addItem(s, it, 10);
  log(s, 'ev.champDown', { m: '@champ.' + s.village, b: '@boon.' + s.village });
}
