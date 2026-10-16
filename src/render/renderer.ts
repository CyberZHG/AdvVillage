import { MAP } from '../game/constants';
import { BUILDINGS, villageDef } from '../game/data';
import { maxHp, monsterStats, tod } from '../game/state';
import { blocked, inVillage, isRoad, placement, roadState, zoneOf } from '../game/world';
import { t } from '../i18n';
import { drawAtmosphere, drawEmote, nightAlpha } from './atmosphere';
import type { Cat, GameState, Npc } from '../game/types';
import { hasPerk } from '../game/cat';
import { makeCanvas } from './pixel';
import {
  TILE_H, buildingSprite, catNeck, catSprite, draw, humanSprite, lyingSprite, monsterSprite, nodeSprite, tileSprite, type Sprite, type TileKind,
} from './art';

export type Sel = { kind: 'npc' | 'bld' | 'mon' | 'pet' | 'cat'; id: number } | null;
interface Floater { x: number; y: number; text: string; color: string; t: number }
interface Drawable { depth: number; draw: () => void; hit?: { x: number; y: number; w: number; h: number; sel: Sel } }

const GX = MAP * 16;
export const CLASS_COLOR: Record<string, string> = {
  warrior: '#ff5a4a', knight: '#a8c8ff', archer: '#6ae05a', rogue: '#c07aff',
  mage: '#4aa8ff', cleric: '#fff2a0', lancer: '#ffa040', monk: '#ffd84a',
};

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private low = makeCanvas(1, 1);
  private lctx = this.low.getContext('2d')!;
  private ground: HTMLCanvasElement | null = null;
  private groundKey = '';
  private floaters: Floater[] = [];
  private hits: NonNullable<Drawable['hit']>[] = [];
  private ox = 0;
  private oy = 0;
  cam = { x: 0, y: 32 * 16, zoom: 3 };
  hoverTile: { x: number; y: number } | null = null;
  ghost: string | null = null;
  ghostRot = 0;
  labels = false;
  focusFighters = false;
  get view() { return this.low; }
  selected: Sel = null;
  follow: number | null = null;
  dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize() {
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(window.innerWidth * this.dpr);
    this.canvas.height = Math.floor(window.innerHeight * this.dpr);
    this.cam.zoom = Math.max(1, Math.min(this.cam.zoom, 12));
  }

  defaultZoom() { return Math.max(2, Math.round((window.innerWidth < 700 ? 1.3 : 2) * this.dpr)); }

  // the camera glides after the followed resident while they are out in the open
  private followTick(s: GameState) {
    if (this.follow == null) return;
    const n = s.npcs.find((o) => o.id === this.follow);
    if (!n) { this.follow = null; return; }
    if (n.inside != null || n.state === 'away') return;
    const tx = (n.x - n.y) * 16, ty = (n.x + n.y) * 8;
    this.cam.x += (tx - this.cam.x) * 0.12;
    this.cam.y += (ty - this.cam.y) * 0.12;
  }

  centerOn(tx: number, ty: number) {
    this.cam.x = (tx - ty) * 16;
    this.cam.y = (tx + ty) * 8;
  }

  zoomBy(d: number) {
    this.cam.zoom = Math.max(1, Math.min(12, this.cam.zoom + d));
  }

  pan(dxPx: number, dyPx: number) {
    this.cam.x -= (dxPx * this.dpr) / this.cam.zoom;
    this.cam.y -= (dyPx * this.dpr) / this.cam.zoom;
    this.cam.x = Math.max(-MAP * 16, Math.min(MAP * 16, this.cam.x));
    this.cam.y = Math.max(0, Math.min(MAP * 16, this.cam.y));
  }

  // client px -> fractional tile coords
  toTile(cx: number, cy: number) {
    const lx = (cx * this.dpr) / this.cam.zoom - this.ox;
    const ly = (cy * this.dpr) / this.cam.zoom - this.oy;
    return { x: (ly / 8 + lx / 16) / 2, y: (ly / 8 - lx / 16) / 2 };
  }

  pick(cx: number, cy: number, s: GameState): Sel {
    const lx = (cx * this.dpr) / this.cam.zoom, ly = (cy * this.dpr) / this.cam.zoom;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (lx >= h.x && ly >= h.y && lx < h.x + h.w && ly < h.y + h.h) return h.sel;
    }
    const t = this.toTile(cx, cy);
    const b = s.buildings.find((b) => {
      const n = BUILDINGS[b.type].size;
      return t.x >= b.x && t.y >= b.y && t.x < b.x + n && t.y < b.y + n;
    });
    return b ? { kind: 'bld', id: b.id } : null;
  }

  private buildGround(s: GameState) {
    const g = villageDef(s.village).ground;
    const key = `${s.village}:${s.vlv}:${roadState.version}`;
    if (this.ground && this.groundKey === key) return;
    this.groundKey = key;
    const c = makeCanvas(MAP * 32 + 32, MAP * 16 + TILE_H);
    const ctx = c.getContext('2d')!;
    for (let d = 0; d < MAP * 2 - 1; d++) {
      for (let i = 0; i < MAP; i++) {
        const j = d - i;
        if (j < 0 || j >= MAP) continue;
        let kind: TileKind;
        if (isRoad(i, j)) kind = inVillage(i, j) ? 'street' : 'road';
        else if (inVillage(i, j)) kind = 'village';
        else kind = (['wild0', 'wild1', 'wild2'] as const)[Math.max(0, zoneOf(i, j))];
        const v = ((i * 73856093) ^ (j * 19349663)) >>> 0;
        draw(ctx, tileSprite(g, kind, v), GX + (i - j) * 16, (i + j) * 8);
      }
    }
    this.ground = c;
  }

  private emotes = new Map<number, { k: string; t: number }>();
  private lastTime = 0;

  render(s: GameState, time: number) {
    this.lastTime = time;
    this.followTick(s);
    if (this.emotes.size > 400) this.emotes.clear();
    this.buildGround(s);
    const z = this.cam.zoom;
    const lw = Math.ceil(this.canvas.width / z), lh = Math.ceil(this.canvas.height / z);
    if (this.low.width !== lw || this.low.height !== lh) { this.low.width = lw; this.low.height = lh; }
    const ctx = this.lctx;
    ctx.imageSmoothingEnabled = false;
    this.ox = Math.floor(lw / 2 - this.cam.x);
    this.oy = Math.floor(lh / 2 - this.cam.y);
    const ox = this.ox, oy = this.oy;
    ctx.fillStyle = '#1b2333';
    ctx.fillRect(0, 0, lw, lh);
    ctx.drawImage(this.ground!, ox - GX - 16, oy);

    const sx = (x: number, y: number) => Math.round(ox + (x - y) * 16);
    const sy = (x: number, y: number) => Math.round(oy + (x + y) * 8);
    const visible = (px: number, py: number) => px > -80 && py > -80 && px < lw + 80 && py < lh + 120;
    const g = villageDef(s.village).ground;
    const list: Drawable[] = [];
    const blit = (sp: Sprite, px: number, py: number) => draw(ctx, sp, px, py);

    for (const b of s.buildings) {
      const n = BUILDINGS[b.type].size;
      const px = sx(b.x, b.y), py = sy(b.x, b.y);
      if (!visible(px, py)) continue;
      const sp = buildingSprite(b.type, b.rot === 1);
      const sel = this.selected?.kind === 'bld' && this.selected.id === b.id;
      list.push({
        depth: b.x + b.y + n,
        draw: () => {
          blit(sp, px, py);
          if (sp.fx) for (const [dx, dy] of sp.fx) this.smoke(px + dx, py + dy, time + b.id * 0.37);
          if (sel) this.diamond(px, py, n, '#ffe066');
        },
      });
      if (this.labels) this.labelQueue.push({ x: px, y: py - sp.ay + 2, text: t('b.' + b.type) + ' ' + b.level });
    }
    for (const nd of s.nodes) {
      const px = sx(nd.x + 0.5, nd.y + 0.5), py = sy(nd.x + 0.5, nd.y + 0.5) + 2;
      if (!visible(px, py)) continue;
      const sp = nodeSprite(nd.kind, nd.v, g);
      list.push({ depth: nd.x + nd.y + 1, draw: () => blit(sp, px, py) });
    }
    for (const m of s.monsters) {
      const px = sx(m.x, m.y), py = sy(m.x, m.y);
      if (!visible(px, py)) continue;
      const frame = Math.floor(time * 3 + m.id) % 2;
      const base = monsterSprite(m.type, frame, m.facing < 0);
      const sp = m.shiny ? shinySprite(base, `${m.type}:${frame}:${m.facing}`) : base;
      const k = m.boss != null ? 2 : 1;
      const sel = this.selected?.kind === 'mon' && this.selected.id === m.id;
      const top = py - sp.ay * k;
      list.push({
        depth: m.x + m.y,
        draw: () => {
          if (k > 1) this.ring(px, py, '#ff4a3a');
          else this.shadow(px, py);
          ctx.drawImage(sp.img, sp.x, sp.y, sp.w, sp.h, px - sp.ax * k, top, sp.w * k, sp.h * k);
          if (m.shiny) this.sparkle(px, top, sp.w * k, time + m.id);
          const maxHp = Math.max(1, monsterStats(s, m.type, m).maxHp);
          if (k > 1) {
            this.hpBar(px, top - 4, m.hp / maxHp, '#e04a3a', 30);
            this.labelQueue.push({ x: px, y: top - 6, text: `${t('boss.' + m.boss)}${t('m.' + m.type)} Lv.${m.lv}`, color: '#ff8a7a' });
          } else if (m.target != null || sel) this.hpBar(px, top - 3, m.hp / maxHp, '#e04a3a');
          if (sel) this.marker(px, top - 6);
        },
        hit: { x: px - sp.ax * k, y: top, w: sp.w * k, h: sp.h * k, sel: { kind: 'mon', id: m.id } },
      });
    }
    for (const p of s.pets) {
      const px = sx(p.x, p.y), py = sy(p.x, p.y);
      if (!visible(px, py)) continue;
      const moving = p.wait <= 0;
      const sp = monsterSprite(p.type, moving ? Math.floor(time * 4 + p.id) % 2 : 0, p.facing < 0);
      const sel = this.selected?.kind === 'pet' && this.selected.id === p.id;
      list.push({
        depth: p.x + p.y,
        draw: () => {
          this.shadow(px, py);
          blit(sp, px, py);
          this.heart(px, py - sp.ay - 3, Math.sin(time * 2 + p.id) > 0.2);
          if (sel) this.marker(px, py - sp.ay - 7);
        },
        hit: { x: px - sp.ax, y: py - sp.ay, w: sp.w, h: sp.h, sel: { kind: 'pet', id: p.id } },
      });
    }
    if (s.cat) {
      const c = s.cat, px = sx(c.x, c.y), py = sy(c.x, c.y);
      if (visible(px, py)) {
        const fr = catFrame(c, time);
        const sp = catSprite(fr, c.facing < 0);
        const sel = this.selected?.kind === 'cat';
        list.push({
          depth: c.x + c.y,
          draw: () => {
            this.shadow(px, py);
            blit(sp, px, py);
            this.collar(s, sp, fr, c.facing < 0, px, py);
            if (c.act === 'sleep') this.zzz(px + 4, py - sp.ay, time);
            if (c.act === 'happy') drawEmote(ctx, 'heart', px, py - sp.ay - 1);
            if (sel) this.marker(px, py - sp.ay - 6);
          },
          hit: { x: px - sp.ax - 2, y: py - sp.ay - 2, w: sp.w + 4, h: sp.h + 4, sel: { kind: 'cat', id: 0 } },
        });
      }
    }
    for (const n of s.npcs) {
      if (n.inside != null || n.state === 'away' || n.state === 'carried') continue;
      const px = sx(n.x, n.y), py = sy(n.x, n.y);
      if (!visible(px, py)) continue;
      list.push(this.npcDrawable(s, n, px, py, time));
    }
    list.sort((a, b) => a.depth - b.depth);
    this.hits = [];
    for (const d of list) {
      d.draw();
      if (d.hit) this.hits.push(d.hit);
    }
    if (this.hoverTile && this.ghost) this.drawGhost(s, sx, sy);

    drawAtmosphere(ctx, s, lw, lh, time, tod(s), sx, sy);
    const night = nightAlpha(tod(s));
    if (night > 0) {
      ctx.fillStyle = `rgba(12,18,52,${night})`;
      ctx.fillRect(0, 0, lw, lh);
    }

    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.low, 0, 0, lw * z, lh * z);
    this.drawFloaters(s, sx, sy);
    this.drawLabels();
  }

  private labelQueue: { x: number; y: number; text: string; color?: string }[] = [];
  private drawLabels() {
    const ctx = this.ctx, z = this.cam.zoom;
    ctx.font = `${Math.round(Math.max(11, 4 * z))}px "DotGothic16", monospace`;
    ctx.textAlign = 'center';
    for (const l of this.labelQueue) {
      const w = ctx.measureText(l.text).width + 8;
      ctx.fillStyle = 'rgba(20,24,52,0.78)';
      ctx.fillRect(l.x * z - w / 2, l.y * z - 4 * z - 12, w, Math.max(14, 4 * z) + 4);
      ctx.fillStyle = l.color ?? '#fbf6e6';
      ctx.fillText(l.text, l.x * z, l.y * z - 4 * z + 2);
    }
    this.labelQueue = [];
  }

  private smoke(px: number, py: number, time: number) {
    const ctx = this.lctx;
    for (let k = 0; k < 3; k++) {
      const f = (time * 0.35 + k / 3) % 1;
      const r = 1 + Math.floor(f * 2.5);
      ctx.fillStyle = `rgba(225,225,230,${0.75 * (1 - f)})`;
      ctx.fillRect(Math.round(px + f * 5 + Math.sin(f * 6 + k) - r / 2), Math.round(py - 2 - f * 16), r, r);
    }
  }

  private npcDrawable(s: GameState, n: Npc, px: number, py: number, time: number): Drawable {
    const ctx = this.lctx;
    const moving = n.state === 'walk' || n.state === 'hunt';
    const frame = moving ? Math.floor(time * 6 + n.id) % 2 : 0;
    const sel = this.selected?.kind === 'npc' && this.selected.id === n.id;
    let sp: Sprite;
    if (n.state === 'down') sp = lyingSprite(n.role, n.cls, n.look);
    else sp = humanSprite(n.role, n.cls, n.look, frame, n.facing < 0);
    const lunge = n.state === 'fight' && n.cd > 0.8 ? n.facing : 0;
    const carried = n.carry != null ? s.npcs.find((o) => o.id === n.carry) : undefined;
    const fighter = n.role === 'fighter';
    const faded = this.focusFighters && !fighter;
    return {
      depth: n.x + n.y,
      draw: () => {
        if (fighter && n.state !== 'down') this.ring(px, py, CLASS_COLOR[n.cls]);
        else this.shadow(px, py);
        if (faded) ctx.globalAlpha = 0.35;
        draw(ctx, sp, px + lunge, py);
        ctx.globalAlpha = 1;
        if (carried) {
          const ls = lyingSprite(carried.role, carried.cls, carried.look);
          draw(ctx, ls, px, py - sp.ay + ls.ay - ls.h + 6);
        }
        if (fighter && n.state !== 'down') {
          const by = py - sp.ay - 3;
          this.hpBar(px + 2, by, n.hp / maxHp(s, n), '#4ad06a');
          this.badge(px - 7, by + 1, CLASS_COLOR[n.cls]);
        }
        if (n.vip) this.vipMark(px, py - sp.ay - (fighter ? 7 : 3), time);
        if (this.follow === n.id) this.followMark(px, py);
        if (n.state === 'wait' && n.goal === 'camp') this.campfire(px + 8, py, time);
        const em = this.emotes.get(n.id);
        if (em && time - em.t < 2.2) drawEmote(ctx, em.k, px, py - sp.ay - (fighter ? 6 : 1));
        if (sel) this.marker(px, py - sp.ay - 6);
      },
      hit: { x: px - 7, y: py - 19, w: 14, h: 20, sel: { kind: 'npc', id: n.id } },
    };
  }

  // pixel ellipse under adventurers, coloured by class
  private ring(px: number, py: number, color: string) {
    const ctx = this.lctx;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(px - 4, py, 8, 1);
    ctx.fillStyle = color;
    ctx.fillRect(px - 3, py - 2, 6, 1);
    ctx.fillRect(px - 3, py + 2, 6, 1);
    ctx.fillRect(px - 5, py - 1, 2, 1);
    ctx.fillRect(px + 3, py - 1, 2, 1);
    ctx.fillRect(px - 5, py + 1, 2, 1);
    ctx.fillRect(px + 3, py + 1, 2, 1);
    ctx.fillRect(px - 6, py, 1, 1);
    ctx.fillRect(px + 5, py, 1, 1);
  }

  private heart(px: number, py: number, on: boolean) {
    if (!on) return;
    const ctx = this.lctx;
    ctx.fillStyle = '#ff6a8a';
    ctx.fillRect(px - 2, py, 2, 1); ctx.fillRect(px + 1, py, 2, 1); ctx.fillRect(px - 2, py + 1, 5, 1); ctx.fillRect(px - 1, py + 2, 3, 1); ctx.fillRect(px, py + 3, 1, 1);
  }

  // ribbon from affection Lv.7, a gold bell at Lv.10
  private collar(s: GameState, sp: Sprite, frame: string, flip: boolean, px: number, py: number) {
    if (!hasPerk(s, 'ribbon')) return;
    const [nx0, ny] = catNeck(frame);
    const nx = flip ? sp.w - 1 - nx0 : nx0;
    const x = px - sp.ax + nx, y = py - sp.ay + ny;
    const ctx = this.lctx;
    ctx.fillStyle = '#e03a5a';
    ctx.fillRect(x - 2, y, 5, 1);
    ctx.fillRect(x - 2, y - 1, 1, 3); ctx.fillRect(x + 2, y - 1, 1, 3);
    if (hasPerk(s, 'bell')) { ctx.fillStyle = '#ffd84a'; ctx.fillRect(x, y + 1, 1, 2); }
  }

  private zzz(px: number, py: number, time: number) {
    const ctx = this.lctx;
    ctx.fillStyle = '#e8f0ff';
    for (let k = 0; k < 2; k++) {
      const f = (time * 0.5 + k / 2) % 1;
      const x = Math.round(px + f * 5), y = Math.round(py - 2 - f * 8), n = k ? 2 : 3;
      ctx.globalAlpha = 1 - f;
      ctx.fillRect(x, y, n, 1); ctx.fillRect(x + n - 2, y + 1, 1, 1); ctx.fillRect(x, y + 2, n, 1);
    }
    ctx.globalAlpha = 1;
  }

  private vipMark(px: number, py: number, time: number) {
    const ctx = this.lctx;
    const y = Math.round(py - 2 + Math.sin(time * 3) * 1);
    ctx.fillStyle = '#5a3a10';
    ctx.fillRect(px - 2, y - 1, 5, 3); ctx.fillRect(px - 1, y - 2, 3, 5);
    ctx.fillStyle = '#ffd34a';
    ctx.fillRect(px - 1, y, 3, 1); ctx.fillRect(px, y - 1, 1, 3);
  }

  private followMark(px: number, py: number) {
    const ctx = this.lctx;
    ctx.fillStyle = '#ffffff';
    for (const [dx, dy] of [[-6, -1], [6, -1], [-6, 1], [6, 1]]) ctx.fillRect(px + dx - (dx < 0 ? 0 : 1), py + dy, 2, 1);
  }

  private badge(px: number, py: number, color: string) {
    const ctx = this.lctx;
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(px - 1, py - 2, 3, 5);
    ctx.fillRect(px - 2, py - 1, 5, 3);
    ctx.fillStyle = color;
    ctx.fillRect(px, py - 1, 1, 3);
    ctx.fillRect(px - 1, py, 3, 1);
  }

  private shadow(px: number, py: number) {
    this.lctx.fillStyle = 'rgba(0,0,0,0.25)';
    this.lctx.fillRect(px - 4, py, 8, 1);
    this.lctx.fillRect(px - 3, py + 1, 6, 1);
  }

  private hpBar(px: number, py: number, f: number, color: string, w = 14) {
    const ctx = this.lctx;
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(px - w / 2, py, w, 3);
    ctx.fillStyle = color;
    ctx.fillRect(px - w / 2 + 1, py + 1, Math.max(0, Math.round((w - 2) * Math.min(1, f))), 1);
  }

  private sparkle(px: number, top: number, w: number, time: number) {
    const ctx = this.lctx;
    for (let i = 0; i < 3; i++) {
      const p = (time * 1.5 + i / 3) % 1;
      if (p > 0.5) continue;
      const x = Math.round(px - w / 2 + ((i * 37 + Math.floor(time * 1.5)) % Math.max(1, w)));
      const y = Math.round(top + ((i * 11 + Math.floor(time * 1.5) * 5) % 10));
      ctx.fillStyle = '#fff6b0';
      ctx.fillRect(x, y - 1, 1, 3);
      ctx.fillRect(x - 1, y, 3, 1);
    }
  }

  private marker(px: number, py: number) {
    const ctx = this.lctx;
    ctx.fillStyle = '#ffe066';
    ctx.fillRect(px - 2, py - 2, 5, 1);
    ctx.fillRect(px - 1, py - 1, 3, 1);
    ctx.fillRect(px, py, 1, 1);
  }

  private campfire(px: number, py: number, time: number) {
    const ctx = this.lctx;
    ctx.fillStyle = '#6c4a2c';
    ctx.fillRect(px - 3, py, 7, 1);
    const f = Math.floor(time * 8) % 2;
    ctx.fillStyle = '#f08a2a';
    ctx.fillRect(px - 1, py - 3, 3, 3);
    ctx.fillStyle = '#ffe066';
    ctx.fillRect(px - f, py - 4 - f, 1, 2);
  }

  private diamond(px: number, py: number, n: number, color: string) {
    const ctx = this.lctx;
    ctx.fillStyle = color;
    const W = 16 * n;
    for (let i = 0; i < W; i += 2) {
      const h = i >> 1;
      ctx.fillRect(px - i - 1, py + h, 2, 1);
      ctx.fillRect(px + i - 1, py + h, 2, 1);
      ctx.fillRect(px - i - 1, py + 16 * n - h - 1, 2, 1);
      ctx.fillRect(px + i - 1, py + 16 * n - h - 1, 2, 1);
    }
  }

  private drawGhost(s: GameState, sx: (x: number, y: number) => number, sy: (x: number, y: number) => number) {
    const type = this.ghost!;
    const tx = Math.floor(this.hoverTile!.x), ty = Math.floor(this.hoverTile!.y);
    const ctx = this.lctx;
    const px = sx(tx, ty), py = sy(tx, ty);
    if (type === 'road' || type === 'unroad') {
      const ok = inVillage(tx, ty) && (type === 'road' ? !isRoad(tx, ty) && !blocked(s, tx, ty) : isRoad(tx, ty));
      this.diamond(px, py, 1, ok ? (type === 'road' ? '#7dff8a' : '#ffb84a') : '#ff5a5a');
      return;
    }
    const n = BUILDINGS[type].size;
    const pl = placement(s, type, tx, ty, this.ghostRot);
    const sp = buildingSprite(type, (pl ? pl.rot : this.ghostRot) === 1);
    ctx.globalAlpha = 0.7;
    draw(ctx, sp, px, py);
    ctx.globalAlpha = 1;
    this.diamond(px, py, n, pl ? '#7dff8a' : '#ff5a5a');
    if (pl?.door) this.diamond(sx(pl.door.x, pl.door.y), sy(pl.door.x, pl.door.y), 1, '#ffe066');
  }

  private drawFloaters(s: GameState, sx: (x: number, y: number) => number, sy: (x: number, y: number) => number) {
    for (const f of s.fx) {
      if (f.kind === 'score') continue;
      if (f.kind === 'emote') { const [id, k] = String(f.v).split(':'); this.emotes.set(Number(id), { k, t: this.lastTime }); continue; }
      if (this.floaters.length > 120) break;
      const text = f.kind === 'coin' ? `+${f.v}G` : f.kind === 'lvl' ? 'LV UP' : f.kind === 'item' ? `+${f.v}` : String(f.v);
      const color = f.kind === 'coin' ? '#ffd34a' : f.kind === 'lvl' ? '#7dffef' : f.kind === 'item' ? '#b6ff7a' : '#ffffff';
      this.floaters.push({ x: f.x, y: f.y, text, color, t: 0 });
    }
    s.fx.length = 0;
    const ctx = this.ctx, z = this.cam.zoom;
    const size = Math.round(Math.max(13, 5.5 * z));
    ctx.font = `${size}px "DotGothic16", monospace`;
    ctx.textAlign = 'center';
    ctx.lineWidth = Math.max(2, z / 1.5);
    ctx.strokeStyle = '#1a1424';
    const now = performance.now();
    this.floaters = this.floaters.filter((f) => {
      if (!f.t) f.t = now;
      const age = (now - f.t) / 1000;
      if (age > 1.2) return false;
      const px = sx(f.x, f.y) * z, py = (sy(f.x, f.y) - 20 - age * 14) * z;
      ctx.globalAlpha = Math.min(1, 2 * (1.2 - age));
      ctx.strokeText(f.text, px, py);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, px, py);
      ctx.globalAlpha = 1;
      return true;
    });
  }
}


const shinyCache = new Map<string, Sprite>();
function shinySprite(sp: Sprite, key: string): Sprite {
  let out = shinyCache.get(key);
  if (!out) {
    const c = makeCanvas(sp.w, sp.h);
    const cx = c.getContext('2d')!;
    cx.drawImage(sp.img, sp.x, sp.y, sp.w, sp.h, 0, 0, sp.w, sp.h);
    cx.globalCompositeOperation = 'source-atop';
    cx.fillStyle = 'rgba(255,214,90,0.5)';
    cx.fillRect(0, 0, sp.w, sp.h);
    out = { ...sp, img: c, x: 0, y: 0 };
    shinyCache.set(key, out);
  }
  return out;
}

// picks the animation frame for what the cat is doing
function catFrame(c: Cat, time: number): string {
  switch (c.act) {
    case 'walk': case 'follow': return c.path.length || c.act === 'follow' ? `walk${Math.floor(time * 8) % 4}` : 'sit0';
    case 'sleep': return `sleep${Math.floor(time * 0.8) % 2}`;
    case 'groom': return `groom${Math.floor(time * 2.5) % 2}`;
    case 'stretch': return 'stretch';
    case 'lie': return 'lie';
    case 'happy': return 'happy';
    default: return time % 4 < 0.15 ? 'blink' : Math.floor(time * 1.2) % 3 === 0 ? 'sit1' : 'sit0';
  }
}
