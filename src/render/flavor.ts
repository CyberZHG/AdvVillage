import type { GameState } from '../game/types';
import { culture } from '../game/data';
import { festival, season } from '../game/events';

// screen-space touches: regional wildlife, the festival moon, fog, lightning and the warm light of dawn and dusk
const h = (n: number) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };

export function drawFlavor(ctx: CanvasRenderingContext2D, s: GameState, w: number, hgt: number, time: number, tod: number) {
  const se = season(s), lang = culture.lang, day = tod > 0.08 && tod < 0.7, night = tod >= 0.75 || tod < 0.04;
  const calm = s.weather === 'clear';
  // swallows skim past on spring and summer days; willow catkins drift in spring
  if (lang === 'zh' && day && calm && se <= 1) {
    for (let k = 0; k < 3; k++) {
      const t = (time * 0.09 + k * 0.33) % 1, row = h(Math.floor(time * 0.09 + k * 0.33) * 7 + k);
      const x = Math.round(-20 + t * (w + 40)), y = Math.round(hgt * (0.15 + row * 0.4) + Math.sin(t * 20 + k) * 6);
      const flap = Math.floor(time * 8 + k) % 2;
      ctx.fillStyle = '#1e2030';
      ctx.fillRect(x, y, 1, 1); ctx.fillRect(x - 1, y - 1 + flap, 1, 1); ctx.fillRect(x + 1, y - 1 + flap, 1, 1);
      ctx.fillRect(x - 2, y - 1 + flap * 2, 1, 1); ctx.fillRect(x + 2, y - 1 + flap * 2, 1, 1);
    }
    if (se === 0) for (let i = 0; i < (w * hgt) / 9000; i++) {
      const x = ((h(i) * w + time * 9 * (0.6 + h(i + 5))) % w), y = ((h(i + 2) * hgt + time * 5 + Math.sin(time + i) * 4) % hgt);
      ctx.fillStyle = 'rgba(255,255,250,0.8)'; ctx.fillRect(Math.round(x), Math.round(y), 2, 1);
    }
  }
  // fireflies on summer nights; red dragonflies on autumn days
  if (lang === 'ja' && se === 1 && night && calm) {
    for (let i = 0; i < (w * hgt) / 5000; i++) {
      const on = Math.sin(time * 2.3 + i * 1.7) > 0.4;
      if (!on) continue;
      const x = Math.round(h(i) * w + Math.sin(time * 0.6 + i) * 10), y = Math.round(hgt * (0.35 + h(i + 9) * 0.6) + Math.cos(time * 0.5 + i) * 6);
      ctx.fillStyle = 'rgba(220,255,120,0.35)'; ctx.fillRect(x - 1, y - 1, 3, 3);
      ctx.fillStyle = '#efffa0'; ctx.fillRect(x, y, 1, 1);
    }
  }
  if (lang === 'ja' && se === 2 && day && calm) {
    for (let k = 0; k < 5; k++) {
      const hop = Math.floor(time * 0.7 + k * 0.21), t = (time * 0.7 + k * 0.21) % 1;
      const x0 = h(hop * 3 + k) * w, y0 = hgt * (0.2 + h(hop * 5 + k) * 0.6), x1 = h(hop * 3 + k + 1) * w, y1 = hgt * (0.2 + h(hop * 5 + k + 1) * 0.6);
      const e = t < 0.7 ? 0 : (t - 0.7) / 0.3;
      const x = Math.round(x0 + (x1 - x0) * e * 0.15), y = Math.round(y0 + (y1 - y0) * e * 0.15);
      ctx.fillStyle = '#d8402a'; ctx.fillRect(x, y, 3, 1); ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(x + 1, y - 1, 1, 1); ctx.fillRect(x + 1, y + 1, 1, 1);
    }
  }
  // the mid-autumn / moon-viewing festival hangs a large moon in the night sky
  if ((lang === 'zh' || lang === 'ja') && festival(s) === 'harvest' && night) {
    const cx = Math.round(w * 0.82), cy = Math.round(hgt * 0.16), r = 14;
    ctx.fillStyle = 'rgba(255,240,190,0.12)'; ctx.beginPath(); ctx.arc(cx, cy, r + 8, 0, Math.PI * 2); ctx.fill();
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const d = x * x + y * y;
      if (d > r * r) continue;
      ctx.fillStyle = (x * 3 + y * 5) % 13 === 0 || (Math.hypot(x + 4, y - 3) < 3) ? '#e8d8a0' : '#fff4c8';
      ctx.fillRect(cx + x, cy + y, 1, 1);
    }
  }
  // warm light at sunrise and sunset
  const warm = tod > 0.045 && tod < 0.1 ? 1 - Math.abs(tod - 0.0725) / 0.0275 : tod > 0.67 && tod < 0.74 ? 1 - Math.abs(tod - 0.705) / 0.035 : 0;
  if (warm > 0) { ctx.fillStyle = `rgba(255,170,90,${(0.06 * warm).toFixed(3)})`; ctx.fillRect(0, 0, w, hgt); }
}
