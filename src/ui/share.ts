import { t, fmt, npcName } from '../i18n';
import { ACHIEVEMENTS } from '../game/achievements';
import { computeScore } from '../game/econ';
import { residents } from '../game/state';
import { makeCanvas } from '../render/pixel';
import type { GameState } from '../game/types';
import type { Meta } from '../game/save';
import { dateText } from './ui';

const W = 1200, H = 630;
const FONT = '"DotGothic16", "PingFang SC", "Microsoft YaHei", "Hiragino Sans", "Apple SD Gothic Neo", "Malgun Gothic", monospace';

export const shareUrl = () => location.origin + location.pathname;

export async function makeShareImage(s: GameState, meta: Meta, view: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  await document.fonts?.ready;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const k = Math.max(1, Math.ceil(Math.max(W / view.width, H / view.height)));
  const sw = W / k, sh = H / k;
  ctx.drawImage(view, (view.width - sw) / 2, (view.height - sh) / 2, sw, sh, 0, 0, W, H);

  const band = ctx.createLinearGradient(0, H - 230, 0, H);
  band.addColorStop(0, 'rgba(14,19,48,0)');
  band.addColorStop(0.35, 'rgba(14,19,48,0.88)');
  band.addColorStop(1, 'rgba(14,19,48,0.96)');
  ctx.fillStyle = band;
  ctx.fillRect(0, H - 230, W, 230);

  const score = s.score ?? computeScore(s);
  const unlocked = ACHIEVEMENTS.filter(([id]) => meta.ach[id]).length;
  const best = s.npcs.filter((n) => n.role === 'fighter').sort((a, b) => b.level - a.level)[0];

  const text = (str: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left') => {
    ctx.font = `${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.lineWidth = Math.max(3, size / 6);
    ctx.strokeStyle = '#0e1330';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  };

  text(t('game.title'), 40, 70, 52, '#ffd34a');
  text(`${t(`village.${s.village}.name`)} · ${dateText(s)}`, 40, 112, 26, '#fbf6e6');

  const stats: [string, string][] = [
    [s.score ? t('ui.finalScore') : t('ui.projectedScore'), `${fmt(score.total)}  ${score.rank}`],
    [t('tab.achievements'), `${unlocked} / ${ACHIEVEMENTS.length}`],
    [t('ui.population'), fmt(residents(s).length)],
    [t('score.buildings'), fmt(s.buildings.length)],
  ];
  stats.forEach(([label, value], i) => {
    const x = 40 + i * 280;
    text(label, x, H - 112, 22, '#b9c0dc');
    text(value, x, H - 72, i === 0 ? 40 : 36, i === 0 ? '#ffd34a' : '#fbf6e6');
  });
  if (best) text(t('ui.shareBest', { n: npcName(best.name), c: '@cls.' + best.cls, lv: best.level }), 40, H - 26, 20, '#b9c0dc');
  text(shareUrl(), W - 40, H - 26, 22, '#7dd6ff', 'right');

  ctx.strokeStyle = '#f3e7c5';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, W - 6, H - 6);
  ctx.strokeStyle = '#0e1330';
  ctx.lineWidth = 3;
  ctx.strokeRect(8, 8, W - 16, H - 16);
  return c;
}

export const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('toBlob'))), 'image/png'));

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function shareImage(blob: Blob, text: string): Promise<boolean> {
  const file = new File([blob], 'adventurer-village.png', { type: 'image/png' });
  if (!navigator.canShare?.({ files: [file] })) return false;
  try { await navigator.share({ files: [file], text, url: shareUrl() }); } catch { /* user cancelled */ }
  return true;
}

export async function makeReportImage(s: GameState, i: number): Promise<HTMLCanvasElement> {
  await document.fonts?.ready;
  const r = s.reports[i];
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f2e8d0';
  ctx.fillRect(0, 0, W, H);
  for (let k = 0; k < 900; k++) { ctx.fillStyle = `rgba(120,90,50,${Math.random() * 0.06})`; ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
  const text = (str: string, x: number, y: number, size: number, color = '#3a2a1a', align: CanvasTextAlign = 'left') => {
    ctx.font = `${size}px ${FONT}`; ctx.textAlign = align; ctx.fillStyle = color; ctx.fillText(str, x, y);
  };
  text(t('ui.paperName', { v: `@village.${s.village}.name` }), W / 2, 74, 54, '#2a1a10', 'center');
  ctx.fillStyle = '#3a2a1a'; ctx.fillRect(40, 92, W - 80, 4); ctx.fillRect(40, 100, W - 80, 1);
  text(t('ui.reportTitle', { y: r.year, v: `@village.${s.village}.name` }), W / 2, 134, 26, '#8a3a2a', 'center');
  const stats: [string, string][] = [
    [t('ui.rIncome'), fmt(r.income)], [t('ui.kills'), fmt(r.kills)], [t('ui.touristTotal'), fmt(r.tourists)],
    [t('ui.population'), fmt(r.residents)], [t('score.buildings'), fmt(r.buildings)], [t('ui.rBosses'), fmt(r.bosses)],
  ];
  stats.forEach(([k, v], j) => { const x = 60 + (j % 3) * 370, y = 190 + Math.floor(j / 3) * 70; text(k, x, y, 22, '#7a6a50'); text(v, x, y + 34, 34); });
  let y = 360;
  if (r.star) { text('⭐ ' + t('ui.rStar', { n: npcName(r.star.name), c: '@cls.' + r.star.cls, k: r.star.kills, lv: r.star.level }), 60, y, 24); y += 40; }
  if (r.shop) { text('🏆 ' + t('ui.rShop', { b: '@b.' + r.shop.type, v: r.shop.income }), 60, y, 24); y += 40; }
  for (const e of r.events.slice(-4)) { text('・' + t(e.k, e.p), 60, y, 20, '#5a4a30'); y += 32; }
  text(shareUrl(), W - 40, H - 30, 22, '#3a6a9a', 'right');
  ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 4; ctx.strokeRect(14, 14, W - 28, H - 28);
  return c;
}
