import type { GameState } from '../game/types';
import { BUILDINGS, culture, villageDef } from '../game/data';
import { festival, hasEffect, season } from '../game/events';

// deterministic 0..1 noise so particles need no per-frame state
const h = (n: number) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };

export function nightAlpha(t: number): number {
  const max = 0.22;
  if (t >= 0.7 && t < 0.8) return ((t - 0.7) / 0.1) * max;
  if (t >= 0.8) return max;
  if (t < 0.06) return max * (1 - t / 0.06);
  return 0;
}

const TINT = ['rgba(255,190,220,0.04)', '', 'rgba(230,150,60,0.05)', 'rgba(235,245,255,0.16)'];

function fall(w: number, hgt: number, time: number, n: number, vx: number, vy: number, draw: (x: number, y: number, i: number) => void) {
  for (let i = 0; i < n; i++) {
    const x = (((h(i) * w + time * vx * (0.7 + h(i + 99) * 0.6)) % w) + w) % w;
    const y = (((h(i + 7) * hgt + time * vy * (0.7 + h(i + 51) * 0.6)) % hgt) + hgt) % hgt;
    draw(Math.round(x), Math.round(y), i);
  }
}

export function drawAtmosphere(ctx: CanvasRenderingContext2D, s: GameState, w: number, hgt: number, time: number, tod: number,
  sx: (x: number, y: number) => number, sy: (x: number, y: number) => number, weather = s.weather, fade = 1) {
  const se = season(s);
  const snowGround = villageDef(s.village).ground === 'snow';
  const tint = TINT[se];
  if (tint && !(se === 3 && snowGround)) { ctx.fillStyle = tint; ctx.fillRect(0, 0, w, hgt); }
  const area = (w * hgt) / 4000;
  const fest = festival(s);
  const dark = tod >= 0.72 || tod < 0.04;

  drawWeather(ctx, s, weather, w, hgt, time, fade);

  if (fest === 'harvest') fall(w, hgt, time, area * 0.8, 6, 20, (x, y, i) => { ctx.fillStyle = ['#ff6a6a', '#ffd34a', '#7dff8a', '#7dd6ff'][i % 4]; ctx.fillRect(x, y, 1, 2); });
  if (fest === 'lantern' && dark) {
    for (const b of s.buildings) {
      const n = BUILDINGS[b.type].size;
      const px = sx(b.x + n, b.y + n / 2), py = sy(b.x + n, b.y + n / 2) - 8;
      const f = 0.6 + 0.4 * Math.sin(time * 3 + b.id);
      ctx.fillStyle = `rgba(255,170,60,${0.25 * f})`;
      ctx.fillRect(px - 3, py - 3, 7, 7);
      ctx.fillStyle = '#ffb84a';
      ctx.fillRect(px - 1, py - 1, 3, 3);
    }
  }
  // the Dragon Boat Festival has boats on the water instead of fireworks
  if (fest === 'fireworks' && dark && culture.lang !== 'zh') {
    for (let k = 0; k < 3; k++) {
      const cycle = Math.floor(time / 2.2 + k * 0.37);
      const t = (time / 2.2 + k * 0.37) % 1;
      const cx = h(cycle * 3 + k) * w, cy = hgt * (0.12 + h(cycle * 5 + k) * 0.3);
      const color = ['#ff6a6a', '#ffd34a', '#7dd6ff', '#c07aff', '#7dff8a'][cycle % 5];
      ctx.fillStyle = color;
      ctx.globalAlpha = 1 - t;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        ctx.fillRect(Math.round(cx + Math.cos(a) * t * 22), Math.round(cy + Math.sin(a) * t * 22 + t * t * 6), 1, 1);
      }
      ctx.globalAlpha = 1;
    }
  }
  if (hasEffect(s, 'meteor') && dark) {
    const t = (time * 0.7) % 1, i = Math.floor(time * 0.7);
    const x0 = h(i) * w, y0 = h(i + 3) * hgt * 0.3;
    ctx.fillStyle = '#fff4b0';
    for (let k = 0; k < 8; k++) ctx.fillRect(Math.round(x0 + (t * 60) - k * 2), Math.round(y0 + t * 30 - k), 1, 1);
  }
}

const EMOTE: Record<string, [string, string[]]> = {
  star: ['#ffd34a', ['..#..', '.###.', '#####', '.#.#.', '#...#']],
  heart: ['#ff5a7a', ['.#.#.', '#####', '#####', '.###.', '..#..']],
  food: ['#e8903a', ['..##.', '.####', '.###.', '#.#..', '.....']],
  note: ['#4aa8ff', ['..##.', '..#.#', '..#..', '###..', '##...']],
  hurt: ['#4a8aff', ['..#..', '.###.', '#####', '#####', '.###.']],
  win: ['#ff6a3a', ['..#..', '..#..', '..#..', '.....', '..#..']],
  wave: ['#e8a070', ['#.#.#', '#.#.#', '#####', '.####', '..##.']],
};

export function drawEmote(ctx: CanvasRenderingContext2D, kind: string, px: number, py: number) {
  const e = EMOTE[kind];
  if (!e) return;
  ctx.fillStyle = '#2a1d26';
  ctx.fillRect(px - 5, py - 9, 11, 8);
  ctx.fillRect(px - 1, py - 1, 2, 2);
  ctx.fillStyle = '#fbf6e6';
  ctx.fillRect(px - 4, py - 8, 9, 6);
  ctx.fillRect(px, py - 2, 1, 1);
  ctx.fillStyle = e[0];
  e[1].forEach((row, y) => { for (let x = 0; x < 5; x++) if (row[x] === '#') ctx.fillRect(px - 2 + x, py - 8 + y, 1, 1); });
}

// rain, snow and the falling petals or leaves of fair weather; 'fade' lets two kinds of weather cross over
export function drawWeather(ctx: CanvasRenderingContext2D, s: GameState, weather: string, w: number, hgt: number, time: number, fade: number) {
  if (fade <= 0) return;
  const se = season(s), fest = festival(s), area = (w * hgt) / 4000;
  ctx.save();
  ctx.globalAlpha = fade;
  if (weather === 'rain' || weather === 'storm') {
    ctx.fillStyle = weather === 'storm' ? 'rgba(30,40,70,0.18)' : 'rgba(40,60,90,0.1)';
    ctx.fillRect(0, 0, w, hgt);
    ctx.fillStyle = 'rgba(190,215,255,0.55)';
    fall(w, hgt, time, area * (weather === 'storm' ? 3 : 2), -30, 220, (x, y) => { ctx.fillRect(x, y, 1, 3); });
  } else if (weather === 'snow') {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    fall(w, hgt, time, area * 1.5, 8, 18, (x, y, i) => ctx.fillRect(x + Math.round(Math.sin(time + i) * 2), y, i % 3 ? 1 : 2, i % 3 ? 1 : 2));
  } else if (se === 0) {
    fall(w, hgt, time, area * (fest ? 0.9 : 0.35), 14, 10, (x, y, i) => { ctx.fillStyle = i % 2 ? '#ffc8dc' : '#ffe2ee'; ctx.fillRect(x, y, 2, 1); });
  } else if (se === 2) {
    fall(w, hgt, time, area * 0.35, 10, 12, (x, y, i) => { ctx.fillStyle = ['#e8902a', '#d8602a', '#e8c040'][i % 3]; ctx.fillRect(x, y, 2, 2); });
  }

  if (weather === 'fog') {
    ctx.fillStyle = 'rgba(225,230,235,0.28)'; ctx.fillRect(0, 0, w, hgt);
    for (let k = 0; k < 6; k++) {
      const y = Math.round(((h(k) * hgt + time * 3) % (hgt + 40)) - 20), x = Math.round(((time * (6 + k) + h(k + 3) * w) % (w + 200)) - 200);
      ctx.fillStyle = 'rgba(240,244,248,0.22)'; ctx.fillRect(x, y, 200, 10 + (k % 3) * 6);
    }
  }
  // a forked bolt now and then in a storm: one every ten seconds or so, with only a faint flash
  if (weather === 'storm') {
    const cyc = Math.floor(time / 6), t = (time / 6) % 1;
    if (h(cyc) > 0.4 && t < 0.025) {
      let x = Math.round(h(cyc + 1) * w), y = 0;
      ctx.fillStyle = '#fffbe0';
      while (y < hgt * 0.6) { ctx.fillRect(x, y, 1, 3); y += 3; x += Math.round((h(y + cyc) - 0.5) * 4); }
      ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(0, 0, w, hgt);
    }
  }
  if (weather === 'sandstorm') {
    ctx.fillStyle = 'rgba(214,176,108,0.32)'; ctx.fillRect(0, 0, w, hgt);
    ctx.fillStyle = 'rgba(240,214,160,0.7)';
    fall(w, hgt, time, area * 2, 260, 30, (x, y, i) => ctx.fillRect(x, y, 3 + (i % 3) * 2, 1));
  }
  ctx.restore();
}
