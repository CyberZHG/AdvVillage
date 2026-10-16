import { t, fmt, npcName, param, LANGS, getLang } from '../i18n';
import {
  BUILDINGS, CATEGORIES, CLASS_KEYS, DECOR_MAX, DECOR_RADIUS, DECOR_STEP, EQUIP, EXPEDITIONS, ITEMS, MONSTERS, mapZone, ROAD_COST,
  SHOP_TIER_LEVELS, VILLAGES, shopTier, equipByKey, type Category, type Cost, type Slot,
} from '../game/data';
import { DAY, DAYS_PER_MONTH, DAYS_PER_YEAR, HOUSE_CAP, SCORE_YEAR } from '../game/constants';
import { bldExpNeed, expNeed, famExpNeed, forgeMult, lvMult } from '../game/level';
import {
  attraction, bld, debuffs, fighterStats, housed, maxHp, monsterStats, npcById, residents, tod, year,
} from '../game/state';
import {
  buildCost, canBuild, computeScore, expansionCost, forgeCost, forgeable, goodsItem, goodsPrice, hasCost, upgradeCost,
} from '../game/econ';
import { commissionText, progress, seasonEnds } from '../game/commissions';
import { FAME_RANKS, VIPS, fameRank } from '../game/fame';
import { ACHIEVEMENTS } from '../game/achievements';
import { COMBOS, COMBO_RADIUS, activeCombos, combosOf, decorBonus } from '../game/combos';
import { SEASONS, currentBoss, festival, season } from '../game/events';
import { titleBonus } from '../game/social';
import { buildingIcon, catIcon, humanIcon, itemIcon, monsterIcon } from '../render/art';
import { CLASS_COLOR, type Sel } from '../render/renderer';
import { RESEARCH, canResearch, researchCost, rlv } from '../game/research';
import { CAT_MAX, CAT_PERKS, catNeed } from '../game/cat';
import { PET_BONUS, petCap, petRole } from '../game/pets';
import { SEASON_HOT, hotNow } from '../game/events';
import type { OfflineReport } from '../game/offline';
import type { Building, GameState, Npc } from '../game/types';
import type { Meta } from '../game/save';

export type Tab = 'build' | 'facilities' | 'residents' | 'guild' | 'bestiary' | 'achievements' | 'forge' | 'research' | 'storage' | 'tourists' | 'village' | 'settings';

export interface Ctl {
  s: GameState;
  meta: Meta;
  speed: number;
  placing: string | null;
  selected: Sel;
  labels: boolean;
  focus: boolean;
  follow: number | null;
  act(action: string, arg: string): void;
}

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const img = (src: string, cls = 'ic') => `<img class="${cls}" src="${src}" alt="">`;
const btn = (act: string, label: string, opts: { disabled?: boolean; cls?: string } = {}) =>
  `<button class="btn ${opts.cls ?? ''}" data-act="${act}" ${opts.disabled ? 'disabled' : ''}>${label}</button>`;
const bar = (f: number, cls = '') => `<span class="bar ${cls}"><span style="width:${Math.max(0, Math.min(100, f * 100)).toFixed(1)}%"></span></span>`;
const money = (v: number, ok = true) => `<span class="cost ${ok ? '' : 'bad'}">${img(itemIcon('money'))}${fmt(v)}</span>`;

function costHtml(s: GameState, c: Cost) {
  const parts = [money(c.money, s.money >= c.money)];
  if (c.wood) parts.push(`<span class="cost ${(s.items.wood ?? 0) >= c.wood ? '' : 'bad'}">${img(itemIcon('wood'))}${fmt(c.wood)}</span>`);
  if (c.stone) parts.push(`<span class="cost ${(s.items.stone ?? 0) >= c.stone ? '' : 'bad'}">${img(itemIcon('stone'))}${fmt(c.stone)}</span>`);
  return parts.join(' ');
}

export function dateText(s: GameState) {
  const y = Math.floor(s.day / DAYS_PER_YEAR) + 1;
  const m = Math.floor((s.day % DAYS_PER_YEAR) / DAYS_PER_MONTH) + 1;
  const d = (s.day % DAYS_PER_MONTH) + 1;
  return t('ui.date', { y, m, d });
}

function statusKey(n: Npc): string {
  if (['hunt', 'fight', 'down', 'carried', 'away', 'gather'].includes(n.state)) return 'st.' + n.state;
  if (n.goal) return 'st.' + n.goal;
  return 'st.idle';
}

export const nameOf = (n: Npc) => (n.title ? t('ui.titled', { n: npcName(n.name), t: `@title.${n.title}` }) : npcName(n.name));
const SEASON_ICON = ['🌸', '☀️', '🍂', '❄️'];
const WEATHER_ICON: Record<string, string> = { clear: '', rain: '☔', snow: '🌨', storm: '⛈' };
const roleLabel = (n: Npc) => (n.role === 'fighter' ? t((n.promoted ? 'cls2.' : 'cls.') + n.cls) : n.job ? t('job.' + n.job) : t('role.' + n.role));

// ---------------- skeleton ----------------

export function mountHud() {
  $('hud').innerHTML = `
    <div id="top">
      <div class="tb-date"><b id="t-village"></b><span id="t-date"></span><span id="t-tod"></span></div>
      <div class="tb-res" id="t-res"></div>
      <div class="tb-speed" id="t-speed"></div>
    </div>
    <div id="log"></div>
    <div id="info" class="win hidden"></div>
    <div id="panel" class="win hidden"><div class="win-title"><span id="panel-title"></span>${btn('close', '✕', { cls: 'x' })}</div><div class="win-body" id="panel-body"></div></div>
    <div id="placing" class="hidden"></div>
    <div id="zoom">${btn('zoomIn', '+')}${btn('zoomOut', '−')}</div>
    <div id="toolbar"></div>`;
}

const TABS: Tab[] = ['build', 'facilities', 'residents', 'guild', 'bestiary', 'achievements', 'forge', 'research', 'storage', 'tourists', 'village', 'settings'];

let lastHtml: Record<string, string> = {};
function setHtml(id: string, html: string) {
  if (lastHtml[id] === html) return;
  lastHtml[id] = html;
  $(id).innerHTML = html;
}
export function resetHtmlCache() { lastHtml = {}; }

export function updateHud(c: Ctl, tab: Tab | null) {
  const s = c.s;
  setHtml('t-village', esc(t(`village.${s.village}.name`)));
  setHtml('t-date', dateText(s));
  const tt = tod(s);
  const fest = festival(s);
  setHtml('t-tod', `<span title="${t('season.' + SEASONS[season(s)])}">${SEASON_ICON[season(s)]}</span>${tt >= 0.75 || tt < 0.04 ? '☾' : ''}<span title="${t('weather.' + s.weather)}">${WEATHER_ICON[s.weather] ?? ''}</span>${fest ? `<span class="fest">${t('fest.' + fest)}</span>` : ''}${currentBoss(s) ? `<span class="bossbadge" data-act="tab:guild">${t('ui.bossAlert')}</span>` : ''}`);
  const food = (s.items.fruit ?? 0) + (s.items.meat ?? 0);
  const res = residents(s).length;
  const tourists = s.npcs.length - res;
  setHtml('t-res', [
    `<span title="${t('item.money')}">${img(itemIcon('money'))}${fmt(s.money)}</span>`,
    `<span title="${t('item.wood')}">${img(itemIcon('wood'))}${fmt(s.items.wood ?? 0)}</span>`,
    `<span title="${t('item.stone')}">${img(itemIcon('stone'))}${fmt(s.items.stone ?? 0)}</span>`,
    `<span title="${t('ui.food')}">${img(itemIcon('meat'))}${fmt(food)}</span>`,
    `<span title="${t('ui.population')}">👥${fmt(res)}</span>`,
    `<span title="${t('ui.tourists')}">🎒${fmt(tourists)}</span>`,
  ].join(''));
  setHtml('t-speed', btn('focus', t('ui.focus'), { cls: c.focus ? 'on' : '' }) + btn('labels', t('ui.labels'), { cls: c.labels ? 'on' : '' }) + [0, 1, 2, 4, 8].map((v) => btn('speed:' + v, v ? '×' + v : '❚❚', { cls: c.speed === v ? 'on' : '' })).join(''));
  setHtml('toolbar', TABS.map((k) => btn('tab:' + k, t('tab.' + k), { cls: tab === k ? 'on' : '' })).join(''));
  setHtml('log', s.log.slice(-6).map((l, i, a) => `<div class="log-line" style="opacity:${0.45 + (0.55 * (i + 1)) / a.length}"><span class="log-date">${t('ui.dayShort', { y: Math.floor(l.t / DAYS_PER_YEAR) + 1, m: Math.floor((l.t % DAYS_PER_YEAR) / DAYS_PER_MONTH) + 1 })}</span> ${esc(t(l.k, l.p))}</div>`).join(''));

  const placing = $('placing');
  placing.classList.toggle('hidden', !c.placing);
  if (c.placing === 'road' || c.placing === 'unroad') setHtml('placing', `${t(c.placing === 'road' ? 'ui.paintingRoad' : 'ui.removingRoad')} ${c.placing === 'road' ? money(ROAD_COST) : ''} ${btn('cancelPlace', t('ui.done'))}`);
  else if (c.placing) setHtml('placing', `${t('ui.placing', { b: t('b.' + c.placing) })} ${costHtml(s, buildCost(s, c.placing))} ${BUILDINGS[c.placing].kind !== 'decor' ? btn('rotate', t('ui.rotate')) : ''} ${btn('cancelPlace', t('ui.cancel'))}`);

  const panel = $('panel');
  panel.classList.toggle('hidden', !tab);
  if (tab) {
    setHtml('panel-title', t('tab.' + tab));
    setHtml('panel-body', PANELS[tab](c));
  }
  const info = $('info');
  const infoHtml = c.selected ? infoCard(c) : '';
  info.classList.toggle('hidden', !infoHtml);
  if (infoHtml) setHtml('info', infoHtml);
}

// ---------------- panels ----------------

const PANELS: Record<Tab, (c: Ctl) => string> = {
  build(c) {
    const s = c.s;
    const cats = `<div class="btns">${CATEGORIES.map((k) => btn('cat:' + k, t('cat.' + k), { cls: buildCat === k ? 'on' : '' })).join('')}</div>`;
    const roads = `<div class="card"><div class="card-img">${img(itemIcon('stone'), 'ic big')}</div><div class="card-main"><b>${t('ui.road')}</b>
      <div class="desc">${t('ui.roadDesc')}</div>${money(ROAD_COST, s.money >= ROAD_COST)} <small>${t('ui.perTile')}</small></div>
      <div class="btns">${btn('place:road', t('ui.paint'))}${btn('place:unroad', t('ui.remove'))}</div></div>`;
    const note = buildCat === 'decor' ? `<p class="meta">${t('ui.decorNote', { p: Math.round(DECOR_STEP * 100), r: DECOR_RADIUS, m: Math.round(DECOR_MAX * 100) })}</p>` : '';
    return cats + note + roads + `<div class="grid">${Object.keys(BUILDINGS).filter((k) => BUILDINGS[k].buildable !== false && BUILDINGS[k].cat === buildCat).map((k) => {
      const d = BUILDINGS[k];
      const built = s.buildings.filter((b) => b.type === k).length;
      const done = !!d.unique && built > 0;
      const ok = canBuild(s, k);
      return `<div class="card ${ok ? '' : 'dim'}">
        <div class="card-img">${img(buildingIcon(k), 'bimg')}</div>
        <div class="card-main"><b>${t('b.' + k)}</b> <small>${t('ui.owned', { n: built })}</small>${hotNow(s, k) ? ` <span class="tag good">${t('ui.hot')}</span>` : ''}
        <div class="desc">${t('bd.' + k)}</div>${comboTags(s, k)}${goodsTags(s, k)}
        <div>${done ? t('ui.uniqueBuilt') : costHtml(s, buildCost(s, k))}</div>
        <div class="meta">${t('ui.size', { n: d.size })} · ${t('ui.attraction')} ${d.attraction}${d.price ? ` · ${t('ui.price')} ${d.price}` : ''}${hoursText(k)}</div></div>
        ${done ? '' : btn('place:' + k, t('ui.build'), { disabled: !ok })}
      </div>`;
    }).join('')}</div>`;
  },

  facilities(c) {
    const s = c.s;
    const active = activeCombos(s);
    const combos = COMBOS.map((d) => {
      const seen = s.comboSeen.includes(d.key);
      const n = active.filter((a) => a.key === d.key).length;
      const members = d.members.map((m) => img(buildingIcon(m), 'bimg xs')).join('');
      return `<div class="row ${n ? '' : 'dim'}"><span class="grow"><b>${seen ? t('combo.' + d.key) : t('ui.unknown')}</b>${n ? ` <small class="good">×${n}</small>` : ''}
        <br>${seen ? members : `<small>${t('ui.comboHidden', { n: d.members.length })}</small>`}</span>
        <small>${seen ? t('ui.comboBonus', { i: Math.round(d.income * 100), a: d.appeal }) : ''}</small></div>`;
    }).join('');
    const comboBox = `<h3>${t('ui.combos')}</h3><p class="meta">${t('ui.comboHint', { r: COMBO_RADIUS })}</p>${combos}<h3>${t('tab.facilities')}</h3>`;
    const rows = [...s.buildings].sort((a, b) => a.type.localeCompare(b.type) || b.level - a.level).map((b) => `
      <div class="row click" data-act="select:bld:${b.id}">${img(buildingIcon(b.type), 'bimg sm')}
        <span class="grow"><b>${t('b.' + b.type)}</b> ${t('ui.lv', { lv: b.level })}<br>${bar(b.exp / bldExpNeed(b.level))}</span>
        ${BUILDINGS[b.type].kind === 'house' ? `<span>${housed(s, b)}/${HOUSE_CAP}</span>` : ''}
      </div>`);
    return comboBox + (rows.join('') || `<p>${t('ui.none')}</p>`);
  },

  residents(c) {
    const s = c.s;
    const order = { fighter: 0, gatherer: 1, civilian: 2, tourist: 3 };
    const list = residents(s).sort((a, b) => order[a.role] - order[b.role] || b.level - a.level);
    const counts = (['fighter', 'gatherer', 'civilian'] as const).map((r) => `${t('role.' + r)} ${list.filter((n) => n.role === r).length}`).join(' · ');
    const legend = CLASS_KEYS.map((k) => `<span class="tag"><span class="dot" style="background:${CLASS_COLOR[k]}"></span>${t('cls.' + k)}</span>`).join('');
    return companionsHtml(s) + `<p class="meta">${counts}</p><div class="tags">${legend}</div><p class="meta">${t('ui.ringHint')}</p>` + list.map((n) => `
      <div class="row click" data-act="select:npc:${n.id}">${img(humanIcon(n.role, n.cls, n.look), 'pimg')}
        <span class="grow"><b>${esc(nameOf(n))}</b> <small>${roleLabel(n)}</small> ${n.role !== 'civilian' ? t('ui.lv', { lv: n.level }) : ''}
        <br><small>${t(statusKey(n))}${debuffs(n).map((d) => ` <span class="bad">${t('debuff.' + d)}</span>`).join('')}</small></span>
        ${n.role === 'fighter' ? bar(n.hp / maxHp(s, n), 'hp') : ''}
      </div>`).join('');
  },

  guild(c) {
    const s = c.s;
    let h = commissionsHtml(s);
    const boss = currentBoss(s);
    if (boss) {
      const st = monsterStats(s, boss.type, boss);
      const rally = s.npcs.filter((n) => n.role === 'fighter' && n.goalId === boss.id && (n.state === 'hunt' || n.state === 'fight')).length;
      h += `<h3 class="bad">${t('ui.boss')}</h3><div class="row click" data-act="select:mon:${boss.id}">${img(monsterIcon(boss.type), 'mimg')}
        <span class="grow"><b>${t('boss.' + boss.boss)}${t('m.' + boss.type)}</b> ${t('ui.lv', { lv: boss.lv })}<br>${bar(boss.hp / st.maxHp, 'hp')}
        <small>${t('ui.bossInfo', { n: rally, d: Math.max(0, Math.ceil(((boss.until ?? 0) - s.time) / DAY)) })}</small></span></div>`;
    }
    if (s.merchant) {
      h += `<h3>${t(s.merchant.foreign ? 'ui.caravan' : 'ui.merchant')}</h3><p class="meta">${t('ui.merchantHint', { d: Math.max(0, Math.ceil((s.merchant.until - s.time) / DAY)) })}</p>`;
      h += s.merchant.offers.map((o, i) => `<div class="row ${o.sold ? 'dim' : ''}">${img(itemIcon(o.item), 'ic big')}<span class="grow">${t('item.' + o.item)} ×${o.count}</span>
        ${o.sold ? `<small>${t('ui.sold')}</small>` : `${money(o.price, s.money >= o.price)} ${btn('buy:' + i, t('ui.buy'), { disabled: s.money < o.price })}`}</div>`).join('');
    }
    h += `<h3>${t('ui.quests')}</h3>`;
    h += s.quests.length ? s.quests.map((q) => `<div class="row">${img(monsterIcon(q.type), 'mimg')}
      <span class="grow"><b>${t('ui.questText', { c: q.need, m: '@m.' + q.type })}</b> ${t('ui.lv', { lv: s.mlv[q.type].level })}<br>
      ${bar(q.done / q.need)} ${q.done}/${q.need} · ${t('ui.members', { n: q.members.length })}</span>${money(q.reward)}</div>`).join('')
      : `<p class="meta">${t('ui.noQuests')}</p>`;
    h += `<h3>${t('ui.expeditions')}</h3>`;
    const e = s.exp;
    if (e) {
      const def = EXPEDITIONS.find((x) => x.key === e.loc)!;
      const names = e.members.map((id) => npcById(s, id)).filter(Boolean).map((n) => esc(npcName(n!.name))).join(', ') || '-';
      const left = Math.max(0, Math.ceil((e.until - s.time) / DAY));
      h += `<div class="box"><b>${t('ex.' + def.key)}</b> — ${t('exs.' + e.state)}${e.state !== 'depart' ? ` (${t('ui.daysLeft', { n: left })})` : ''}
        <br>${t('ui.party')}: ${names}${e.state === 'away' ? `<br>${t('ui.record', { w: e.wins, l: e.losses })}` : ''}</div>`;
    }
    h += EXPEDITIONS.map((d) => {
      const locked = year(s) < d.unlockYear;
      const mons = d.monsters.map((m) => s.seen.includes(m)
        ? `<span class="tag">${img(monsterIcon(m), 'mimg sm')}${t('m.' + m)} ${t('ui.lv', { lv: s.mlv[m].level })}</span>`
        : `<span class="tag">${t('ui.unknown')}</span>`).join('');
      const drops = [...new Set(d.monsters.flatMap((m) => MONSTERS[m].drops.map((x) => x[0])))].map((it) => s.disc.includes(it)
        ? `<span class="tag">${img(itemIcon(it))}${t('item.' + it)}</span>` : `<span class="tag">${t('ui.unknown')}</span>`).join('');
      const depth = s.depth[d.key] ?? 0;
      return `<div class="card ${locked ? 'dim' : ''}"><div class="card-main"><b>${t('ex.' + d.key)}</b> <small>${t('ui.days', { n: d.days })}</small>${depth ? ` <span class="tag">${t('ui.depth', { d: depth + 1 })}</span>` : ''}
        <div class="desc">${t('exd.' + d.key)}</div>${depth ? `<div class="meta">${t('ui.depthHint', { l: depth * 4, p: depth * 15 })}</div>` : ''}
        <div>${t('ui.monsters')}: ${mons}</div><div>${t('ui.drops')}: ${drops}</div>
        ${locked ? `<div class="meta">${t('ui.unlockYear', { y: d.unlockYear })}</div>` : ''}</div>
        ${locked ? '' : btn('expedition:' + d.key, t('ui.recruit'), { disabled: !!s.exp })}</div>`;
    }).join('');
    return h;
  },

  bestiary(c) {
    const s = c.s;
    const keys = Object.keys(MONSTERS);
    const seen = keys.filter((k) => s.seen.includes(k)).length;
    const groups: [string, string[]][] = [0, 1, 2].map((z) => [t('ui.zone' + z), keys.filter((k) => MONSTERS[k].zone === z)]);
    for (const e of EXPEDITIONS) groups.push([t('ex.' + e.key), e.monsters]);
    const row = (k: string) => {
      const d = MONSTERS[k];
      if (!s.seen.includes(k)) return `<div class="row dim"><span class="mimg q">?</span><span class="grow">${t('ui.unknown')}${d.biomes ? ` <small>${d.biomes.map((g) => t('ground.' + g)).join(' / ')}</small>` : ''}</span></div>`;
      const drops = [...new Set(d.drops.map((x) => x[0]))].map((it) => (s.disc.includes(it) ? img(itemIcon(it)) : '?')).join('');
      return `<div class="row">${img(monsterIcon(k), 'mimg')}<span class="grow"><b>${t('m.' + k)}</b>${s.shinySeen.includes(k) ? ` <span class="shiny" title="${t('ui.shinySeen')}">✦</span>` : ''} ${t('ui.lv', { lv: s.mlv[k].level })}${d.zone < 0 ? ` <small>${t('ui.rareWild', { z: '@ui.zone' + mapZone(d) })}</small>` : ''}
        ${d.biomes ? ` <small>${d.biomes.map((g) => t('ground.' + g)).join(' / ')}</small>` : ''}<br><small>${t('ui.drops')}:</small> ${drops}</span></div>`;
    };
    return `<p class="meta">${t('ui.bestiaryHint')} ${t('ui.found', { n: seen, t: keys.length })}</p>` +
      groups.map(([title, list]) => `<h3>${title}</h3>${list.map(row).join('')}`).join('');
  },

  achievements(c) {
    const done = ACHIEVEMENTS.filter(([id]) => c.meta.ach[id]).length;
    return `<p class="meta">${t('ui.achHint')} ${t('ui.achCount', { n: done, t: ACHIEVEMENTS.length })}</p>
      <div class="btns">${btn('share', t('ui.share'), { cls: 'primary' })}</div>` + ACHIEVEMENTS.map(([id]) => {
      const at = c.meta.ach[id];
      return `<div class="row ${at ? '' : 'dim'}"><span class="ach ${at ? 'got' : ''}">${at ? '★' : '☆'}</span><span class="grow"><b>${t(`ach.${id}.name`)}</b>
        <br><small>${t(`ach.${id}.desc`)}</small></span>${at ? `<small>${new Date(at).toLocaleDateString()}</small>` : ''}</div>`;
    }).join('');
  },

  forge(c) {
    const s = c.s;
    if (!s.buildings.some((b) => b.type === 'forge')) return `<p>${t('ui.needForge')}</p>`;
    const slots: Slot[] = ['weapon', 'armor', 'accessory'];
    const stat = (k: string, L: number) => {
      const e = equipByKey(k)!, f = forgeMult(L), parts: string[] = [];
      if (e.atk) parts.push(`${t('ui.atk')} ${e.atk} → ${(e.atk * f).toFixed(1)}`);
      if (e.def) parts.push(`${t('ui.def')} ${e.def} → ${(e.def * f).toFixed(1)}`);
      if (e.hp) parts.push(`HP ${e.hp} → ${Math.round(e.hp * f)}`);
      return parts.join(' · ');
    };
    return `<p class="meta">${t('ui.forgeHint')}</p>${effectTag(s, 'smith')}<div class="btns">${slots.map((k) => btn('forgeSlot:' + k, t('slot.' + k), { cls: forgeSlot === k ? 'on' : '' })).join('')}</div>` +
      (forgeable(s, forgeSlot).map((k) => {
        const L = s.wlv[k] ?? 0;
        const fc = forgeCost(s, k);
        const have = s.items[fc.mat] ?? 0;
        const ok = s.money >= fc.money && have >= fc.count;
        const users = s.npcs.filter((n) => n[forgeSlot] === k).length;
        return `<div class="row"><span class="grow"><b>${t('eq.' + k)}</b> +${L}
          <br><small>${stat(k, L)} · ${t('ui.users', { n: users })}</small>
          <br>${money(fc.money, s.money >= fc.money)} <span class="cost ${have >= fc.count ? '' : 'bad'}">${img(itemIcon(fc.mat))}${s.disc.includes(fc.mat) ? t('item.' + fc.mat) : t('ui.unknown')} ${fmt(have)}/${fmt(fc.count)}</span></span>
          ${btn('forge:' + k, t('ui.forge'), { disabled: !ok })}</div>`;
      }).join('') || `<p class="meta">${t('ui.forgeNone')}</p>`);
  },

  research(c) {
    const s = c.s;
    let h = `<p class="meta">${t('ui.researchHint')}</p>`;
    const r = s.researching;
    if (r) h += `<div class="box"><b>${t('rs.' + r.k)}</b> ${t('ui.lv', { lv: rlv(s, r.k) + 1 })} — ${t('ui.researching')} (${t('ui.daysLeft', { n: Math.max(0, Math.ceil((r.until - s.time) / DAY)) })})</div>`;
    return h + RESEARCH.map((d) => {
      const L = rlv(s, d.key), max = L >= d.max;
      const rc = researchCost(s, d.key), have = s.items[rc.mat] ?? 0;
      const eff = t('rse.' + d.key, { p: Math.round(d.per * 100 * L * 10) / 10, n: Math.round(d.per * 100 * (L + 1) * 10) / 10 });
      return `<div class="row ${r?.k === d.key ? 'on' : ''}"><span class="grow"><b>${t('rs.' + d.key)}</b> ${t('ui.lv', { lv: L })}/${d.max}
        <br><small>${eff}</small>
        ${max ? '' : `<br>${money(rc.money, s.money >= rc.money)} <span class="cost ${have >= rc.count ? '' : 'bad'}">${img(itemIcon(rc.mat))}${s.disc.includes(rc.mat) ? t('item.' + rc.mat) : t('ui.unknown')} ${fmt(have)}/${fmt(rc.count)}</span> <small>${t('ui.days', { n: rc.days })}</small>`}</span>
        ${max ? `<small>${t('ui.maxed')}</small>` : btn('research:' + d.key, t('ui.research'), { disabled: !canResearch(s, d.key) })}</div>`;
    }).join('');
  },

  storage(c) {
    const s = c.s;
    return `<div class="items">${Object.keys(ITEMS).map((k) => s.disc.includes(k)
      ? `<div class="item">${img(itemIcon(k), 'ic big')}<span>${t('item.' + k)}</span><b>${fmt(s.items[k] ?? 0)}</b></div>`
      : `<div class="item dim"><span class="ic big q">?</span><span>${t('ui.unknown')}</span><b>-</b></div>`).join('')}</div>`;
  },

  tourists(c) {
    const s = c.s;
    const visiting = new Set(s.npcs.filter((n) => n.role === 'tourist').map((n) => n.profile));
    const list = s.profiles.map((p, i) => ({ p, i })).sort((a, b) => b.p.level - a.p.level || b.p.visits - a.p.visits).slice(0, 80);
    return `<p class="meta">${t('ui.giftHint')}</p>` + (list.map(({ p, i }) => `
      <div class="row">${img(humanIcon('tourist', 'warrior', p.look), 'pimg')}
        <span class="grow"><b>${esc(npcName(p.name))}</b> ${t('ui.fam', { lv: p.level })} ${visiting.has(i) ? `<small class="good">${t('ui.visitingNow')}</small>` : ''}
        <br>${bar(p.exp / famExpNeed(p.level), 'fam')} <small>${t('ui.visits', { n: p.visits })}</small></span></div>`).join('') || `<p>${t('ui.none')}</p>`);
  },

  village(c) {
    const s = c.s;
    const res = residents(s);
    const sc = s.score ?? computeScore(s);
    const ec = expansionCost(s);
    let h = `<div class="box"><b>${t(`village.${s.village}.name`)}</b><div class="desc">${t(`village.${s.village}.desc`)}</div></div>`;
    h += fameHtml(s);
    h += `<div class="kv"><span>${t('ui.attraction')}</span><b>${fmt(attraction(s))}</b>
      <span>${t('ui.population')}</span><b>${res.length}</b>
      <span>${t('ui.lastIncome')}</span><b>${fmt(s.stats.lastIncome)}</b>
      <span>${t('ui.kills')}</span><b>${fmt(s.stats.kills)}</b>
      <span>${t('ui.touristTotal')}</span><b>${fmt(s.stats.tourists)}</b></div>`;
    const fest = festival(s);
    const effects = s.effects.filter((e) => e.until > s.time).map((e) => `<span class="tag">${t('eff.' + e.k)}</span>`).join('');
    h += `<div class="kv"><span>${t('ui.season')}</span><b>${SEASON_ICON[season(s)]} ${t('season.' + SEASONS[season(s)])}${fest ? ` · <span class="fest">${t('fest.' + fest)}</span>` : ''}</b>
      <span>${t('ui.weather')}</span><b>${WEATHER_ICON[s.weather] ?? ''} ${t('weather.' + s.weather)}</b>${effects ? `<span>${t('ui.effects')}</span><b>${effects}</b>` : ''}
      <span>${t('ui.hotNow')}</span><b>${SEASON_HOT[season(s)].map((k) => `<span class="tag good">${t('b.' + k)}</span>`).join('')}</b></div>`;
    h += chartHtml(s);
    h += `<h3>${t('ui.reports')}</h3>`;
    h += s.reports.length ? `<div class="btns">${[...s.reports].reverse().map((r, i) => btn('report:' + (s.reports.length - 1 - i), t('ui.reportBtn', { y: r.year }))).join('')}</div>` : `<p class="meta">${t('ui.noReports')}</p>`;
    h += `<h3>${t('ui.expand')}</h3>`;
    h += ec ? `<div class="row"><span class="grow">${t('ui.expandDesc', { lv: s.vlv + 1 })}<br>${costHtml(s, ec)}</span>${btn('expand', t('ui.expand'), { disabled: !hasCost(s, ec) })}</div>`
      : `<p class="meta">${t('ui.expandMax')}</p>`;
    h += `<h3>${s.score ? t('ui.finalScore') : t('ui.projectedScore')}</h3>${scoreTable(sc)}<div class="btns">${btn('share', t('ui.shareImage'), { cls: 'primary' })}</div>`;
    if (!s.score) h += `<p class="meta">${t('ui.scoreHint', { y: SCORE_YEAR })}</p>`;
    return h;
  },

  settings(c) {
    const langs = Object.entries(LANGS).map(([k, p]) => btn('lang:' + k, p.label, { cls: getLang() === k ? 'on' : '' })).join('');
    return `<h3>${t('ui.language')}</h3><div class="btns">${langs}</div>
      <h3>${t('ui.data')}</h3><div class="btns">${btn('save', t('ui.saveNow'))}${btn('title', t('ui.backTitle'))}</div>
      <p class="meta">${t('ui.autosave')}</p>
      <h3>${t('ui.backup')}</h3><div class="btns">${btn('export', t('ui.exportFile'))}${btn('exportCopy', t('ui.exportCopy'))}${btn('importOpen', t('ui.import'))}</div>
      <p class="meta">${t('ui.backupHint')}</p>
      <h3>${t('ui.share')}</h3><div class="btns">${btn('share', t('ui.shareImage'), { cls: 'primary' })}</div>
      <h3>${t('ui.help')}</h3><div class="desc">${t('ui.helpText')}</div>
      <p class="meta">${t('ui.villageBest', { v: fmt(c.meta.best[c.s.village] ?? 0) })}</p>`;
  },
};

export function scoreTable(sc: NonNullable<GameState['score']>) {
  return `<div class="kv"><span>${t('score.npcs')}</span><b>${sc.npcs}</b>
    <span>${t('score.buildings')}</span><b>${sc.buildings}</b>
    <span>${t('score.npcLevels')}</span><b>${fmt(sc.npcLevels)}</b>
    <span>${t('score.bldLevels')}</span><b>${fmt(sc.bldLevels)}</b>
    <span>${t('score.fame')}</span><b>${fmt(sc.fame)}</b>
    <span>${t('score.total')}</span><b class="big">${fmt(sc.total)}</b>
    <span>${t('score.rank')}</span><b class="rank r${sc.rank}">${sc.rank}</b></div>`;
}

// ---------------- info card ----------------

function infoCard(c: Ctl): string {
  const s = c.s, sel = c.selected!;
  const head = (icon: string, title: string, sub: string, extra = '') =>
    `<div class="win-title">${icon}<span class="grow"><b>${title}</b> <small>${sub}</small></span>${extra}${btn('deselect', '✕', { cls: 'x' })}</div>`;
  if (sel.kind === 'bld') {
    const b = bld(s, sel.id);
    if (!b) return '';
    return head(img(buildingIcon(b.type), 'bimg sm'), t('b.' + b.type), t('ui.lv', { lv: b.level })) + buildingBody(c, b);
  }
  if (sel.kind === 'mon') {
    const m = s.monsters.find((o) => o.id === sel.id);
    if (!m) return '';
    const st = monsterStats(s, m.type, m);
    const drops = MONSTERS[m.type].drops.map(([it]) => (s.disc.includes(it) ? `<span class="tag">${img(itemIcon(it))}${t('item.' + it)}</span>` : `<span class="tag">${t('ui.unknown')}</span>`)).join('');
    const title = (m.boss != null ? t('boss.' + m.boss) : '') + t('m.' + m.type) + (m.shiny ? ' ✦' : '');
    return head(img(monsterIcon(m.type), 'mimg'), title, t('ui.lv', { lv: st.level })) + `<div class="win-body">
      <div class="kv"><span>HP</span><b>${fmt(Math.max(0, m.hp))}/${fmt(st.maxHp)}</b><span>${t('ui.atk')}</span><b>${fmt(st.atk)}</b><span>${t('ui.def')}</span><b>${fmt(st.def)}</b></div>
      <div>${t('ui.drops')}: ${drops}</div><p class="meta">${t('ui.sharedLevel')}</p></div>`;
  }
  if (sel.kind === 'cat') return catCard(c);
  if (sel.kind === 'pet') {
    const p = s.pets.find((o) => o.id === sel.id);
    if (!p) return '';
    const role = petRole(p.type)!;
    return head(img(monsterIcon(p.type), 'mimg'), t('m.' + p.type), t('pet.' + role)) + `<div class="win-body">
      <div class="desc">${t('petd.' + role, { p: Math.round(PET_BONUS[role] * 100) })}</div>
      <p class="meta">${t('ui.petSince', { d: dayText(p.since) })}</p>
      <div class="btns right">${btn('release:' + p.id, pendingDemolish === -p.id ? t('ui.confirmRelease') : t('ui.release'), { cls: 'danger' })}</div></div>`;
  }
  const n = npcById(s, sel.id);
  if (!n) return '';
  let body = `<div class="kv"><span>${t('ui.status')}</span><b>${t(statusKey(n))}</b>`;
  if (n.role === 'tourist') {
    const p = s.profiles[n.profile];
    body += `<span>${t('ui.familiarity')}</span><b>${t('ui.fam', { lv: p?.level ?? 1 })}</b><span>${t('ui.visitsLabel')}</span><b>${p?.visits ?? 0}</b><span>${t('ui.wallet')}</span><b>${fmt(n.money)}</b></div>`;
    if (p) body += bar(p.exp / famExpNeed(p.level), 'fam');
  } else {
    if (n.role !== 'civilian') body += `<span>${t('ui.exp')}</span><b>${bar(n.exp / expNeed(n.level))}</b>`;
    if (n.role === 'fighter') {
      const st = fighterStats(s, n);
      body += `<span>HP</span><b>${fmt(n.hp)}/${fmt(st.maxHp)}</b><span>${t('ui.atk')}</span><b>${fmt(st.atk)}</b><span>${t('ui.def')}</span><b>${fmt(st.def)}</b>`;
    }
    body += `<span>${t('ui.hunger')}</span><b>${bar(n.hunger / 100, 'food')}</b><span>${t('ui.mood')}</span><b>${bar(n.mood / 100, 'mood')}</b>`;
    body += `<span>${t('ui.money')}</span><b>${fmt(n.money)}</b><span>${t('ui.home')}</span><b>${n.home != null ? t('b.house') + ' #' + n.home : `<span class="bad">${t('debuff.homeless')}</span>`}</b>`;
    if (n.role === 'fighter') {
      for (const slot of ['weapon', 'armor', 'accessory'] as const) {
        const e = equipByKey(n[slot]);
        body += `<span>${t('slot.' + slot)}</span><b>${e ? t('eq.' + e.key) + (s.wlv[e.key] ? ` +${s.wlv[e.key]}` : '') : '-'}</b>`;
      }
      const q = s.quests.find((q) => q.id === n.quest);
      if (q) body += `<span>${t('ui.quest')}</span><b>${t('ui.questText', { c: q.need, m: '@m.' + q.type })}</b>`;
      body += `<span>${t('ui.kills')}</span><b>${fmt(n.kills)}</b>`;
      const mate = npcById(s, n.spouse ?? n.partner ?? null);
      if (mate) body += `<span>${t(n.spouse != null ? 'ui.spouse' : 'ui.partner')}</span><b><a data-act="select:npc:${mate.id}">${esc(npcName(mate.name))}</a></b>`;
      const rival = npcById(s, n.rival ?? null);
      if (rival) body += `<span>${t('ui.rival')}</span><b><a data-act="select:npc:${rival.id}">${esc(npcName(rival.name))}</a> <small>${t('ui.lv', { lv: rival.level })} · ${t('ui.rivalKills', { a: n.kills, b: rival.kills })}</small></b>`;
      if (n.titles?.length) {
        const tb = titleBonus(n);
        body += `<span>${t('ui.titles')}</span><b>${n.titles.map((k) => t('title.' + k)).join('、')}<br><small>${t('ui.titleBonus', { a: Math.round((tb.atk - 1) * 100), d: Math.round((tb.def - 1) * 100), h: Math.round((tb.hp - 1) * 100) })}</small></b>`;
      }
    }
    const bag = Object.entries(n.bag).filter(([, v]) => v > 0);
    if (bag.length) body += `<span>${t('ui.bag')}</span><b>${bag.map(([k, v]) => `${img(itemIcon(k))}${v}`).join(' ')}</b>`;
    body += '</div>';
    const db = debuffs(n);
    if (db.length) body += `<div>${db.map((d) => `<span class="tag bad">${t('debuff.' + d)}: ${t('debuffd.' + d)}</span>`).join('')}</div>`;
    if (n.bio?.length) body += `<h3>${t('ui.story')}</h3><ul class="bio">${[...n.bio].reverse().map((e) => `<li><span class="log-date">${t('ui.dayShort', { y: Math.floor(e.t / DAYS_PER_YEAR) + 1, m: Math.floor((e.t % DAYS_PER_YEAR) / DAYS_PER_MONTH) + 1 })}</span> ${esc(t(e.k, e.p))}</li>`).join('')}</ul>`;
  }
  if (n.vip) body += `<p class="meta">${t('vipd.' + n.vip)}</p>`;
  const following = c.follow === n.id;
  const followBtn = btn('follow:' + n.id, following ? t('ui.unfollow') : t('ui.follow'), { cls: 'sm ' + (following ? 'on' : '') });
  const sub = `${roleLabel(n)}${n.role !== 'civilian' && n.role !== 'tourist' ? ' ' + t('ui.lv', { lv: n.level }) : ''}`;
  return head(img(humanIcon(n.role, n.cls, n.look), 'pimg'), esc(nameOf(n)), sub, followBtn) + `<div class="win-body">${body}</div>`;
}

function buildingBody(c: Ctl, b: Building): string {
  const s = c.s;
  const d = BUILDINGS[b.type];
  let h = `<div class="desc">${t('bd.' + b.type)}</div>${hotNow(s, b.type) ? `<p class="good">${t('ui.hotDesc')}</p>` : ''}`;
  h += `<div class="kv"><span>${t('ui.exp')}</span><b>${bar(b.exp / bldExpNeed(b.level))}</b>
    <span>${t('ui.attraction')}</span><b>${(d.attraction * lvMult(b.level)).toFixed(1)}</b>`;
  if (d.price > 0) h += `<span>${t('ui.price')}</span><b>${fmt(d.price * lvMult(b.level))}</b>`;
  h += `<span>${t('ui.bonus')}</span><b>×${lvMult(b.level).toFixed(2)}</b></div>`;
  if (d.kind === 'house') {
    const ppl = s.npcs.filter((n) => n.home === b.id);
    h += `<div>${t('ui.residentsOf', { n: ppl.length, c: HOUSE_CAP })}: ${ppl.map((n) => `<a data-act="select:npc:${n.id}">${esc(npcName(n.name))}</a>`).join(', ') || '-'}</div>`;
  }
  if (d.slot) {
    const tier = shopTier(b.level);
    h += `<div>${t('ui.stock')}: ${EQUIP[d.slot].filter((e) => e.tier <= tier).map((e) => `<span class="tag">${t('eq.' + e.key)} ${fmt(e.price)}</span>`).join('')}</div>`;
    const next = EQUIP[d.slot].find((e) => e.tier === tier + 1);
    if (next) h += `<p class="meta">${t('ui.nextStock', { e: '@eq.' + next.key, lv: SHOP_TIER_LEVELS[tier] })}</p>`;
  }
  const cs = combosOf(s, b);
  const db = decorBonus(s, b);
  if (cs.length || db) h += `<div>${cs.map((x) => `<span class="tag good">${t('combo.' + x.key)} +${Math.round(x.income * 100)}%</span>`).join('')}${db ? `<span class="tag good">${t('ui.decorBonus', { p: Math.round(db * 100) })}</span>` : ''}</div>`;
  if (d.goods) {
    const cur = goodsItem(s, b);
    const list = d.goods.map((i) => s.disc.includes(i)
      ? `<span class="tag ${cur === i ? 'good' : ''}">${img(itemIcon(i))}${t('item.' + i)} ${fmt(s.items[i] ?? 0)} <small>+${goodsPrice(i)}</small></span>`
      : `<span class="tag">${t('ui.unknown')}</span>`).join('');
    h += `<h3>${t('ui.goods')}</h3><div>${list}</div><p class="meta">${t(b.goodsOff ? 'ui.goodsOff' : cur ? 'ui.goodsOn' : 'ui.goodsEmpty')}</p>
      <div class="btns">${btn('goods:' + b.id, b.goodsOff ? t('ui.goodsEnable') : t('ui.goodsDisable'))}</div>`;
  }
  if (d.kind === 'guild') h += `<div class="btns">${btn('tab:guild', t('tab.guild'))}</div>`;
  if (d.kind === 'forge') h += `<div class="btns">${btn('tab:forge', t('tab.forge'))}</div>`;
  const uc = upgradeCost(s, b);
  h += `<div class="row"><span class="grow">${t('ui.upgradeTo', { lv: b.level + 1 })}<br>${costHtml(s, uc)}</span>${btn('upgrade:' + b.id, t('ui.upgrade'), { disabled: !hasCost(s, uc) })}</div>`;
  if (b.type !== 'guild') h += `<div class="btns right">${btn('demolish:' + b.id, pendingDemolish === b.id ? t('ui.confirmDemolish') : t('ui.demolish'), { cls: 'danger' })}</div>`;
  return `<div class="win-body">${h}</div>`;
}

let buildCat: Category = 'housing';
export const setBuildCat = (c: string) => { buildCat = c as Category; };

function hoursText(type: string): string {
  const d = BUILDINGS[type];
  const parts: string[] = [];
  if (d.peak) parts.push(t('ui.busy', { h: `${clock(d.peak[0])}–${clock(d.peak[1])}` }));
  if (d.closed) parts.push(t('ui.closed', { h: `${clock(d.closed[0])}–${clock(d.closed[1])}` }));
  return parts.length ? ' · ' + parts.join(' · ') : '';
}
// a game day starts at 6:00
const clock = (f: number) => `${Math.floor((6 + f * 24) % 24)}:00`;

export let pendingDemolish: number | null = null;
export const setPendingDemolish = (id: number | null) => { pendingDemolish = id; };

// ---------------- title & modal ----------------

export function titleHtml(meta: Meta, hasSave: (k: string) => boolean): string {
  const langs = Object.entries(LANGS).map(([k, p]) => btn('lang:' + k, p.label, { cls: getLang() === k ? 'on' : '' })).join('');
  const cards = VILLAGES.map((v, i) => {
    const locked = i > meta.unlocked;
    const saved = hasSave(v.key);
    const mods = Object.entries(v.mods).map(([k, val]) => `<span class="tag">${t('mod.' + k, { v: typeof val === 'number' && k !== 'monsterLevel' ? '×' + val : '+' + val })}</span>`).join('');
    return `<div class="card village ${locked ? 'dim' : ''}"><div class="card-main">
      <b>${locked ? t('ui.lockedVillage') : t(`village.${v.key}.name`)}</b>
      ${locked ? `<div class="desc">${t('ui.unlockHint')}</div>` : `<div class="desc">${t(`village.${v.key}.desc`)}</div><div class="tags">${mods || `<span class="tag">${t('mod.none')}</span>`}</div>
      <div class="meta">${t('ui.best')}: ${fmt(meta.best[v.key] ?? 0)}</div>`}</div>
      ${locked ? '' : `<div class="btns">${saved ? btn(`start:${v.key}:continue`, t('ui.continue'), { cls: 'primary' }) : ''}${btn(`start:${v.key}:new`, t('ui.newGame'))}</div>`}
    </div>`;
  }).join('');
  return `<div class="title-box"><h1>${t('game.title')}</h1><p class="sub">${t('game.subtitle')}</p>
    <div class="btns center">${langs}${btn('importOpen', t('ui.import'))}</div><div class="villages">${cards}</div></div>`;
}

export function scoreModalHtml(s: GameState, unlocked: string | null): string {
  return `<div class="win modal-box"><div class="win-title"><b>${t('ui.scoreTitle', { y: SCORE_YEAR })}</b></div><div class="win-body">
    ${scoreTable(s.score!)}
    ${unlocked ? `<p class="good">${t('ui.unlocked', { v: '@village.' + unlocked + '.name' })}</p>` : ''}
    <p class="meta">${t('ui.keepPlaying')}</p>
    <div class="btns center">${btn('share', t('ui.shareImage'))}${btn('closeModal', t('ui.continuePlay'), { cls: 'primary' })}</div></div></div>`;
}

export function confirmHtml(text: string, yes: string): string {
  return `<div class="win modal-box"><div class="win-body"><p>${text}</p>
    <div class="btns center">${btn(yes, t('ui.yes'), { cls: 'danger' })}${btn('closeModal', t('ui.cancel'))}</div></div></div>`;
}

export function shareModalHtml(url: string, canShare: boolean): string {
  return `<div class="win modal-box wide"><div class="win-title"><b>${t('ui.shareImage')}</b>${btn('closeModal', '✕', { cls: 'x' })}</div><div class="win-body">
    <img class="share-img" src="${url}" alt="">
    <div class="btns center">${btn('shareDownload', t('ui.download'), { cls: 'primary' })}${canShare ? btn('shareNative', t('ui.shareTo')) : ''}${btn('closeModal', t('ui.close'))}</div></div></div>`;
}

export function importModalHtml(): string {
  return `<div class="win modal-box wide"><div class="win-title"><b>${t('ui.import')}</b>${btn('closeModal', '✕', { cls: 'x' })}</div><div class="win-body">
    <p class="meta">${t('ui.importHint')}</p>
    <input type="file" id="import-file" accept=".sav,.txt,text/plain">
    <textarea id="import-text" rows="6" placeholder="AV1..."></textarea>
    <p class="bad">${t('ui.importWarn')}</p>
    <div class="btns center">${btn('importDo', t('ui.import'), { cls: 'danger' })}${btn('closeModal', t('ui.cancel'))}</div></div></div>`;
}

export function reportHtml(s: GameState, i: number): string {
  const r = s.reports[i];
  if (!r) return '';
  const row = (k: string, v: string) => `<span>${t(k)}</span><b>${v}</b>`;
  const events = r.events.map((e) => `<li>${esc(t(e.k, e.p))}</li>`).join('');
  return `<div class="win modal-box wide paper"><div class="win-title"><b>${t('ui.reportTitle', { y: r.year, v: `@village.${s.village}.name` })}</b>${btn('closeModal', '✕', { cls: 'x' })}</div><div class="win-body">
    <div class="kv">${row('ui.rIncome', fmt(r.income))}${row('ui.kills', fmt(r.kills))}${row('ui.touristTotal', fmt(r.tourists))}
    ${row('ui.population', fmt(r.residents))}${row('score.buildings', fmt(r.buildings))}${row('ui.rBosses', fmt(r.bosses))}${row('ui.rExpeditions', fmt(r.expeditions))}</div>
    ${r.star ? `<p>⭐ ${t('ui.rStar', { n: npcName(r.star.name), c: '@cls.' + r.star.cls, k: r.star.kills, lv: r.star.level })}</p>` : ''}
    ${r.shop ? `<p>🏆 ${t('ui.rShop', { b: '@b.' + r.shop.type, v: r.shop.income })}</p>` : ''}
    ${r.rank != null ? `<p>📜 ${t('ui.rFame', { r: `@fame.${r.rank}`, v: r.fame ?? 0, c: r.commissions ?? 0 })}</p>` : ''}
    ${r.rival ? `<p>⚔ ${t('ui.rRival', { a: npcName(r.rival.a), b: npcName(r.rival.b), ak: r.rival.ak, bk: r.rival.bk, al: r.rival.al, bl: r.rival.bl })}</p>` : ''}
    ${events ? `<h3>${t('ui.rEvents')}</h3><ul class="news">${events}</ul>` : ''}
    <div class="btns center">${btn('reportShare:' + i, t('ui.shareImage'), { cls: 'primary' })}${btn('closeModal', t('ui.close'))}</div></div></div>`;
}

function comboTags(s: GameState, type: string): string {
  const list = COMBOS.filter((c) => c.members.includes(type));
  if (!list.length) return '';
  return `<div>${list.map((c) => `<span class="tag">${s.comboSeen.includes(c.key) ? t('combo.' + c.key) : t('ui.unknown')}</span>`).join('')}</div>`;
}

let forgeSlot: Slot = 'weapon';
export const setForgeSlot = (k: string) => { forgeSlot = k as Slot; };

function effectTag(s: GameState, k: string): string {
  const e = s.effects.find((x) => x.k === k && x.until > s.time);
  return e ? `<p class="good">${t('eff.' + k)} · ${t('ui.daysLeft', { n: Math.ceil((e.until - s.time) / DAY) })}</p>` : '';
}

function goodsTags(s: GameState, type: string): string {
  const g = BUILDINGS[type].goods;
  if (!g) return '';
  return `<div class="meta">${t('ui.goods')}: ${g.map((i) => (s.disc.includes(i) ? img(itemIcon(i)) : '?')).join('')}</div>`;
}

function commissionsHtml(s: GameState): string {
  const left = Math.max(0, seasonEnds(s) - s.day);
  const rows = s.commissions.map((c) => {
    const p = Math.min(c.need, progress(s, c));
    const reward = [money(c.money), c.item ? `<span class="cost">${img(itemIcon(c.item))}${s.disc.includes(c.item) ? t('item.' + c.item) : t('ui.unknown')} ×${c.count}</span>` : '', `<span class="cost">${t('ui.fameShort', { v: c.fame })}</span>`].join(' ');
    return `<div class="row ${c.done ? 'dim' : ''}"><span class="grow"><b>${param(commissionText(c))}</b>${c.done ? ` <small class="good">${t('ui.done')}</small>` : ''}
      <br>${bar(p / c.need)} ${fmt(p)}/${fmt(c.need)}<br><small>${t('ui.reward')}:</small> ${reward}</span></div>`;
  }).join('');
  return `<h3>${t('ui.commissions')}</h3><p class="meta">${t('ui.commissionHint', { d: left })}</p>${rows || `<p class="meta">${t('ui.none')}</p>`}`;
}

function fameHtml(s: GameState): string {
  const r = fameRank(s.fame);
  const next = FAME_RANKS[r + 1];
  const f = next ? (s.fame - FAME_RANKS[r]) / (next - FAME_RANKS[r]) : 1;
  const vips = VIPS.map(([k, need]) => r >= need
    ? `<span class="tag ${s.vips.includes(k) ? 'good' : ''}" title="${t('vipd.' + k)}">${t('vipn.' + k)}</span>`
    : `<span class="tag dim">${t('ui.fameUnlock', { r: `@fame.${need}` })}</span>`).join('');
  return `<h3>${t('ui.fame')}</h3><div class="kv"><span>${t('ui.fameRank')}</span><b>${t('fame.' + r)}</b>
    <span>${t('ui.fame')}</span><b>${fmt(s.fame)}${next ? ` / ${fmt(next)}` : ''}<br>${bar(f, 'fam')}</b>
    <span>${t('ui.famePerk')}</span><b>${t('ui.famePerkText', { p: Math.round(6 * r) })}</b></div>
    <p class="meta">${t('ui.fameHint')}</p><div class="tags">${vips}</div>${effectTag(s, 'sage')}${effectTag(s, 'smith')}`;
}

const dayText = (d: number) => t('ui.dayShort', { y: Math.floor(d / DAYS_PER_YEAR) + 1, m: Math.floor((d % DAYS_PER_YEAR) / DAYS_PER_MONTH) + 1 });

function companionsHtml(s: GameState): string {
  let h = `<h3>${t('ui.companions')}</h3>`;
  if (s.cat) h += `<div class="row click" data-act="select:cat:0">${img(catIcon(), 'mimg')}<span class="grow"><b>${t('cat.name')}</b> ${t('ui.catLv', { lv: s.cat.lv })}
    <br>${bar(s.cat.lv >= CAT_MAX ? 1 : s.cat.exp / catNeed(s.cat.lv), 'fam')} <small>${t('cata.' + s.cat.act)}</small></span></div>`;
  h += s.pets.map((p) => `<div class="row click" data-act="select:pet:${p.id}">${img(monsterIcon(p.type), 'mimg')}<span class="grow"><b>${t('m.' + p.type)}</b>
    <br><small>${t('pet.' + petRole(p.type))}</small></span></div>`).join('');
  return h + `<p class="meta">${t('ui.petHint', { n: s.pets.length, c: petCap(s) })}</p><h3>${t('tab.residents')}</h3>`;
}

function catCard(c: Ctl): string {
  const s = c.s, cat = s.cat;
  if (!cat) return '';
  const perks = CAT_PERKS.map(([k, lv]) => `<li class="${cat.lv >= lv ? 'good' : 'dim'}">${t('ui.catLv', { lv })} · ${t('catp.' + k, { p: cat.lv })}</li>`).join('');
  const ready = s.time - cat.petT >= 3;
  return `<div class="win-title">${img(catIcon(), 'mimg')}<span class="grow"><b>${t('cat.name')}</b> <small>${t('ui.catLv', { lv: cat.lv })}</small></span>${btn('deselect', '✕', { cls: 'x' })}</div>
    <div class="win-body"><div class="kv"><span>${t('ui.status')}</span><b>${t('cata.' + cat.act)}</b>
    <span>${t('ui.affection')}</span><b>${bar(cat.lv >= CAT_MAX ? 1 : cat.exp / catNeed(cat.lv), 'fam')}</b>
    <span>${t('ui.catSince')}</span><b>${dayText(cat.since)}</b></div>
    <div class="btns">${btn('petCat', t('ui.petCat'), { cls: 'primary', disabled: !ready })}</div>
    <p class="meta">${t('ui.catHint')}</p><ul class="bio">${perks}</ul></div>`;
}

let chartKind: 'e' | 't' | 'k' = 'e';
export const setChartKind = (k: string) => { chartKind = k as typeof chartKind; };

// last four years of monthly figures as a bar chart
function chartHtml(s: GameState): string {
  const data = s.hist.slice(-48).map((m) => m[chartKind]);
  const tabs = (['e', 't', 'k'] as const).map((k) => btn('chart:' + k, t('chart.' + k), { cls: chartKind === k ? 'on' : '' })).join('');
  if (!data.length) return `<h3>${t('ui.stats')}</h3><p class="meta">${t('ui.statsEmpty')}</p>`;
  const max = Math.max(1, ...data), W = 240, H = 70, bw = W / 48;
  const bars = data.map((v, i) => `<rect x="${(i + 48 - data.length) * bw + 0.5}" y="${H - (v / max) * H}" width="${bw - 1}" height="${(v / max) * H}" />`).join('');
  return `<h3>${t('ui.stats')}</h3><div class="btns">${tabs}</div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}</svg>
    <p class="meta">${t('ui.statsHint', { max: fmt(max), last: fmt(data[data.length - 1]) })}</p>`;
}

export function offlineHtml(r: OfflineReport): string {
  const h = Math.floor(r.sec / 3600), m = Math.floor((r.sec % 3600) / 60);
  const items = r.items.slice(0, 8).map(([k, v]) => `<span class="tag">${img(itemIcon(k))}${t('item.' + k)} ×${fmt(v)}</span>`).join('');
  return `<div class="win modal-box"><div class="win-title"><b>${t('ui.offlineTitle')}</b></div><div class="win-body">
    <p>${t('ui.offlineAway', { h, m })}</p>
    <div class="kv"><span>${t('item.money')}</span><b>${money(r.money)}</b><span>${t('ui.offlineLevels')}</span><b>${fmt(r.levels)}</b></div>
    ${items ? `<div class="tags">${items}</div>` : ''}<p class="meta">${t('ui.offlineHint')}</p>
    <div class="btns center">${btn('closeModal', t('ui.continuePlay'), { cls: 'primary' })}</div></div></div>`;
}
