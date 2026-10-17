import { EXPEDITIONS } from '../game/data';
import { DAY } from '../game/constants';
import { npcById } from '../game/state';
import type { GameState } from '../game/types';
import { draw, humanSprite, monsterSprite } from './art';

export const EXP_W = 220, EXP_H = 36;
const X0 = 16, X1 = 204, BASE = 31;
const FIGHT = 0.4 * DAY;

// sky, ground, ground shade, flag, far silhouette
const PAL: Record<string, string[]> = {
  woods: ['#5a86a8', '#4f8a3c', '#3b6b2e', '#9be36a', '#2f5a3a'], mine: ['#4a4450', '#7a6a58', '#5a4c40', '#c0c8d8', '#6a5e66'],
  marsh: ['#4a6468', '#4a6a4a', '#34503c', '#7ad0b0', '#33504a'], ruins: ['#6a6a80', '#8c8670', '#6c6656', '#e0d090', '#4e4e60'],
  tomb: ['#c8905a', '#d4b070', '#b08c50', '#f0e0a0', '#a87448'], frozen: ['#6a84aa', '#e8f0f8', '#b8c8dc', '#8ad0ff', '#c8d8ec'],
  volcano: ['#4a2420', '#5a3a30', '#e05a20', '#ff9a40', '#2a1414'], sky: ['#6a9ad8', '#e8eef8', '#c0cce0', '#ffe070', '#a8c4ec'],
  ridge: ['#5a5a7a', '#7a7060', '#5a5246', '#e06050', '#3e3e56'], abyss: ['#1a1028', '#3a2a4a', '#6a3a8a', '#c070ff', '#2c1c40'],
};
// how the far skyline is shaped: rolling hills, jagged peaks, or a forest edge
const SKYLINE: Record<string, 'hill' | 'peak' | 'trees'> = {
  woods: 'trees', marsh: 'trees', mine: 'peak', frozen: 'peak', volcano: 'peak', ridge: 'peak', abyss: 'peak',
};

function skyline(ctx: CanvasRenderingContext2D, loc: string, color: string) {
  const kind = SKYLINE[loc] ?? 'hill';
  ctx.fillStyle = color;
  for (let x = 0; x < EXP_W; x++) {
    let h = kind === 'peak' ? 15 - Math.abs((x % 46) - 23) * 0.55 + Math.sin(x * 0.05) * 2
      : 5 + Math.sin(x * 0.07) * 3 + Math.sin(x * 0.19 + 1) * 1.5;
    if (kind === 'trees') h += Math.abs((x % 6) - 3) * -1.2 + 4;
    ctx.fillRect(x, Math.round(BASE - 3 - h), 1, Math.ceil(h));
  }
  if (loc === 'volcano') { ctx.fillStyle = '#e05a20'; ctx.fillRect(22, BASE - 18, 3, 2); ctx.fillRect(114, BASE - 18, 2, 1); }
  if (loc === 'frozen' || loc === 'ridge') {
    ctx.fillStyle = '#f4f8ff';
    for (let x = 0; x < EXP_W; x += 46) ctx.fillRect(x + 22, BASE - 18, 3, 2);
  }
}

export function drawExpBar(cv: HTMLCanvasElement, s: GameState, time: number) {
  const e = s.exp;
  if (!e) return;
  const ctx = cv.getContext('2d')!;
  const [sky, ground, shade, flag] = PAL[e.loc] ?? PAL.woods;
  ctx.clearRect(0, 0, EXP_W, EXP_H);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, EXP_W, BASE - 3);
  skyline(ctx, e.loc, PAL[e.loc]?.[4] ?? '#2f5a3a');
  ctx.fillStyle = ground;
  ctx.fillRect(0, BASE - 3, EXP_W, EXP_H - BASE + 3);
  ctx.fillStyle = shade;
  for (let i = 0; i < 40; i++) ctx.fillRect((i * 53) % EXP_W, BASE - 2 + ((i * 7) % 6), 1 + (i % 2), 1);

  const def = EXPEDITIONS.find((d) => d.key === e.loc)!;
  for (let d = 1; d < def.days; d++) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(Math.round(X0 + ((X1 - X0) * d) / def.days), BASE - 1, 1, 4);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let x = X0; x < X1; x += 4) ctx.fillRect(x, BASE + 1, 2, 1);

  // the village on the left, the destination flag on the right
  ctx.fillStyle = '#c84a3a'; ctx.fillRect(3, BASE - 12, 11, 3); ctx.fillRect(5, BASE - 14, 7, 2);
  ctx.fillStyle = '#e8d8b0'; ctx.fillRect(4, BASE - 9, 9, 8);
  ctx.fillStyle = '#6a4a30'; ctx.fillRect(7, BASE - 6, 3, 5);
  ctx.fillStyle = '#d8d8d8'; ctx.fillRect(X1 + 6, BASE - 18, 1, 18);
  ctx.fillStyle = flag; ctx.fillRect(X1 + 7, BASE - 18 + (Math.floor(time * 3) % 2), 7, 5);

  const p = e.state === 'away' && e.start != null ? Math.min(1, (s.time - e.start) / Math.max(1, e.until - e.start)) : 0;
  const ms = e.members.map((id) => npcById(s, id)).filter((n) => !!n).slice(0, 5);
  const start = X0 + 4 + 11 * Math.max(0, ms.length - 1);
  const head = start + (X1 - 4 - start) * p;
  const fighting = e.state === 'away' && e.foe && e.foeT != null && s.time - e.foeT < FIGHT;
  const walking = e.state !== 'recruit' && !fighting;
  ms.forEach((n, k) => {
    const x = e.state === 'recruit' ? X0 + 4 + k * 11 : head - k * 11;
    const frame = walking ? Math.floor(time * 6 + k) % 2 : 0;
    const lunge = fighting && Math.floor(time * 5 + k) % 3 === 0 ? 1 : 0;
    draw(ctx, humanSprite(n!.role, n!.cls, n!.look, frame, false), Math.round(x + lunge), BASE);
  });

  if (fighting) {
    const f = (s.time - e.foeT!) / FIGHT;
    const sp = monsterSprite(e.foe!, Math.floor(time * 4) % 2, true);
    const k = Math.min(1, 24 / sp.h);
    const mx = Math.round(head + 18);
    ctx.globalAlpha = e.foeWin && f > 0.6 ? Math.max(0, 1 - (f - 0.6) / 0.3) : 1;
    ctx.drawImage(sp.img, sp.x, sp.y, sp.w, sp.h, Math.round(mx - sp.ax * k), Math.round(BASE - sp.ay * k), Math.round(sp.w * k), Math.round(sp.h * k));
    ctx.globalAlpha = 1;
    if (f < 0.75) {
      ctx.fillStyle = '#fff6b0';
      for (let i = 0; i < 3; i++) {
        const a = time * 9 + i * 2.1;
        ctx.fillRect(Math.round(head + 9 + Math.cos(a) * 3), Math.round(BASE - 12 + Math.sin(a) * 4), 1, 1);
      }
    }
  }
}
