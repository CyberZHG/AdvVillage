import './ui/style.css';
import { detectLang, setLang, t } from './i18n';
import { loadArt } from './render/art';
import { Renderer } from './render/renderer';
import { newGame } from './game/state';
import { step } from './game/sim';
import { TICK } from './game/constants';
import { VILLAGES } from './game/data';
import { deleteSave, hasSave, loadGame, loadMeta, saveGame, saveMeta } from './game/save';
import { build, canBuild, demolish, expand, forgeUpgrade, launchExpedition, placeRoad, removeRoad, upgrade } from './game/econ';
import { bld } from './game/state';
import {
  confirmHtml, mountHud, pendingDemolish, resetHtmlCache, scoreModalHtml, setBuildCat, setPendingDemolish, titleHtml, updateHud,
  type Ctl, type Tab,
} from './ui/ui';
import type { GameState } from './game/types';

const $ = (id: string) => document.getElementById(id)!;
const meta = loadMeta();
setLang(detectLang(meta.lang));

const renderer = new Renderer($('game') as HTMLCanvasElement);
let s: GameState | null = null;
let speed = 1;
let tab: Tab | null = null;
let hudHeld = false;

const ctl: Ctl = {
  get s() { return s!; },
  meta,
  get speed() { return speed; },
  get placing() { return renderer.ghost; },
  get selected() { return renderer.selected; },
  get labels() { return renderer.labels; },
  act: (a: string, arg: string) => act(a + (arg ? ':' + arg : '')),
};

function toast(text: string) {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout((toast as unknown as { h: number }).h);
  (toast as unknown as { h: number }).h = window.setTimeout(() => el.classList.add('hidden'), 1800);
}

function showModal(html: string | null) {
  $('modal').innerHTML = html ?? '';
  $('modal').classList.toggle('hidden', !html);
}

function showTitle() {
  s = null;
  tab = null;
  renderer.ghost = null;
  renderer.selected = null;
  $('hud').classList.add('hidden');
  $('title').classList.remove('hidden');
  $('title').innerHTML = titleHtml(meta, hasSave);
}

function startGame(village: string, fresh: boolean) {
  s = (!fresh && loadGame(village)) || newGame(village);
  saveGame(s);
  $('title').classList.add('hidden');
  $('hud').classList.remove('hidden');
  resetHtmlCache();
  renderer.cam.zoom = renderer.defaultZoom();
  renderer.centerOn(32, 32);
  speed = 1;
  last = performance.now();
  refresh();
}

function onScored() {
  if (!s?.score) return;
  const idx = VILLAGES.findIndex((v) => v.key === s!.village);
  meta.best[s.village] = Math.max(meta.best[s.village] ?? 0, s.score.total);
  let unlocked: string | null = null;
  if (idx + 1 < VILLAGES.length && meta.unlocked < idx + 1) { meta.unlocked = idx + 1; unlocked = VILLAGES[idx + 1].key; }
  saveMeta(meta);
  showModal(scoreModalHtml(s, unlocked));
}

function act(a: string) {
  const [cmd, x, y] = a.split(':');
  if (cmd !== 'demolish') setPendingDemolish(null);
  switch (cmd) {
    case 'tab': tab = tab === x ? null : (x as Tab); break;
    case 'close': tab = null; break;
    case 'speed': speed = Number(x); break;
    case 'place':
      renderer.ghost = x;
      renderer.selected = null;
      if (window.innerWidth < 900) tab = null;
      break;
    case 'cancelPlace': renderer.ghost = null; break;
    case 'rotate': renderer.ghostRot = 1 - renderer.ghostRot; break;
    case 'labels': renderer.labels = !renderer.labels; break;
    case 'cat': setBuildCat(x); break;
    case 'select': {
      renderer.selected = { kind: x as 'npc' | 'bld' | 'mon', id: Number(y) };
      const id = Number(y);
      if (x === 'bld') { const b = bld(s!, id); if (b) renderer.centerOn(b.x + 1, b.y + 1); }
      if (x === 'npc') { const n = s!.npcs.find((o) => o.id === id); if (n && n.inside == null && n.state !== 'away') renderer.centerOn(n.x, n.y); }
      if (window.innerWidth < 900) tab = null;
      break;
    }
    case 'deselect': renderer.selected = null; break;
    case 'upgrade': { const b = bld(s!, Number(x)); if (b && !upgrade(s!, b)) toast(t('ui.notEnough')); break; }
    case 'demolish': {
      const b = bld(s!, Number(x));
      if (!b) break;
      if (pendingDemolish === b.id) { demolish(s!, b); renderer.selected = null; setPendingDemolish(null); }
      else setPendingDemolish(b.id);
      break;
    }
    case 'forge': if (!forgeUpgrade(s!, x, 'village')) toast(t('ui.notEnough')); break;
    case 'expedition': if (launchExpedition(s!, x)) toast(t('log.expRecruit', { loc: '@ex.' + x })); break;
    case 'expand': if (!expand(s!)) toast(t('ui.notEnough')); break;
    case 'lang':
      setLang(x);
      meta.lang = x;
      saveMeta(meta);
      resetHtmlCache();
      if (!s) $('title').innerHTML = titleHtml(meta, hasSave);
      break;
    case 'save': if (s) { saveGame(s); toast(t('ui.saved')); } break;
    case 'title': if (s) saveGame(s); showTitle(); return;
    case 'start':
      if (y === 'new' && hasSave(x)) showModal(confirmHtml(t('ui.confirmNew', { v: '@village.' + x + '.name' }), 'confirmNew:' + x));
      else startGame(x, y === 'new');
      return;
    case 'confirmNew': deleteSave(x); showModal(null); startGame(x, true); return;
    case 'closeModal': showModal(null); break;
    case 'zoomIn': renderer.zoomBy(1); break;
    case 'zoomOut': renderer.zoomBy(-1); break;
  }
  refresh();
}

function refresh() {
  if (s) updateHud(ctl, tab);
}

document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (el && !(el as HTMLButtonElement).disabled) act(el.dataset.act!);
});
$('hud').addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement).closest('.win,#toolbar,#top,#placing')) hudHeld = true; });
window.addEventListener('pointerup', () => { hudHeld = false; });

// ---------- map input ----------
const canvas = renderer.canvas;
const pointers = new Map<number, { x: number; y: number }>();
let downAt: { x: number; y: number } | null = null;
let dragging = false;
let pinchDist = 0;
let paintFrom: { x: number; y: number } | null = null;

const isRoadTool = () => renderer.ghost === 'road' || renderer.ghost === 'unroad';

// paints every tile on the line between the previous and current pointer tile so fast drags leave no gaps
function paintTo(cx: number, cy: number) {
  if (!s) return;
  const t0 = renderer.toTile(cx, cy);
  const to = { x: Math.floor(t0.x), y: Math.floor(t0.y) };
  const from = paintFrom ?? to;
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  let poor = false;
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(from.x + ((to.x - from.x) * i) / Math.max(1, steps));
    const y = Math.round(from.y + ((to.y - from.y) * i) / Math.max(1, steps));
    if (renderer.ghost === 'road') { if (!placeRoad(s, x, y) && s.money < 10) poor = true; }
    else removeRoad(s, x, y);
  }
  if (poor) toast(t('ui.notEnough'));
  paintFrom = to;
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  downAt = { x: e.clientX, y: e.clientY };
  dragging = false;
  if (isRoadTool() && e.button === 0 && pointers.size === 1) { paintFrom = null; paintTo(e.clientX, e.clientY); }
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (s) renderer.hoverTile = renderer.toTile(e.clientX, e.clientY);
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  if (pointers.size === 2) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (Math.abs(d - pinchDist) > 50) { renderer.zoomBy(d > pinchDist ? 1 : -1); pinchDist = d; }
    dragging = true;
    return;
  }
  if (paintFrom) { paintTo(e.clientX, e.clientY); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); return; }
  if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) dragging = true;
  if (dragging) renderer.pan(e.clientX - prev.x, e.clientY - prev.y);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
});
canvas.addEventListener('pointerup', (e) => {
  pointers.delete(e.pointerId);
  if (paintFrom) { paintFrom = null; refresh(); return; }
  if (dragging || !s || e.button === 2) { if (!pointers.size) dragging = false; return; }
  if (renderer.ghost) {
    const tile = renderer.toTile(e.clientX, e.clientY);
    const type = renderer.ghost;
    if (build(s, type, Math.floor(tile.x), Math.floor(tile.y), renderer.ghostRot)) {
      if (!canBuild(s, type)) renderer.ghost = null;
    } else toast(canBuild(s, type) ? t('ui.cantPlace') : t('ui.notEnough'));
  } else {
    renderer.selected = renderer.pick(e.clientX, e.clientY, s);
  }
  refresh();
});
canvas.addEventListener('pointercancel', (e) => pointers.delete(e.pointerId));
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  renderer.ghost = null;
  renderer.selected = null;
  refresh();
});
canvas.addEventListener('wheel', (e) => { e.preventDefault(); renderer.zoomBy(e.deltaY < 0 ? 1 : -1); }, { passive: false });
window.addEventListener('keydown', (e) => {
  if (!s) return;
  if (e.key === 'Escape') { renderer.ghost = null; renderer.selected = null; tab = null; }
  else if (e.key === ' ') { speed = speed ? 0 : 1; e.preventDefault(); }
  else if (['1', '2', '3', '4'].includes(e.key)) speed = [1, 2, 4, 8][Number(e.key) - 1];
  else if (e.key === 'r' || e.key === 'R') renderer.ghostRot = 1 - renderer.ghostRot;
  refresh();
});
window.addEventListener('resize', () => renderer.resize());

// ---------- loop ----------
let last = performance.now();
let acc = 0;
const MAX_STEPS = 8000;

// runs from both rAF and a timer so the village keeps living in background tabs
function advance() {
  const now = performance.now();
  const dt = Math.min(60, (now - last) / 1000);
  last = now;
  if (!s || !speed) return;
  acc += dt * speed;
  const day = s.day, scored = s.scored;
  let n = 0;
  while (acc >= TICK && n < MAX_STEPS) { step(s, TICK); acc -= TICK; n++; }
  if (n >= MAX_STEPS) acc = 0;
  if (s.day !== day) saveGame(s);
  if (!scored && s.scored) onScored();
}

let uiTimer = 0;
function frame(time: number) {
  advance();
  if (s) {
    renderer.render(s, time / 1000);
    if (time - uiTimer > 250 && !hudHeld) { uiTimer = time; refresh(); }
  }
  requestAnimationFrame(frame);
}

setInterval(() => { if (document.hidden) advance(); }, 1000);
document.addEventListener('visibilitychange', () => { if (document.hidden && s) saveGame(s); });
window.addEventListener('beforeunload', () => { if (s) saveGame(s); });

mountHud();
loadArt(import.meta.env.BASE_URL + 'assets/').then(() => {
  showTitle();
  requestAnimationFrame(frame);
}).catch(() => { $('title').classList.remove('hidden'); $('title').textContent = 'Failed to load assets.'; });
