import { t, fmt, npcName, LANGS, getLang } from '../i18n';
import {
  BUILDINGS, CATEGORIES, EQUIP, EXPEDITIONS, ITEMS, MONSTERS, ROAD_COST, SHOP_TIER_LEVELS, VILLAGES, shopTier, equipByKey,
  type Category, type Cost,
} from '../game/data';
import { DAY, DAYS_PER_MONTH, DAYS_PER_YEAR, HOUSE_CAP, SCORE_YEAR } from '../game/constants';
import { bldExpNeed, expNeed, famExpNeed, forgeMult, lvMult } from '../game/level';
import {
  attraction, bld, debuffs, fighterStats, housed, maxHp, monsterStats, npcById, residents, tod, year,
} from '../game/state';
import {
  buildCost, canBuild, computeScore, expansionCost, forgeCost, forgeableWeapons, hasCost, upgradeCost,
} from '../game/econ';
import { buildingIcon, humanIcon, itemIcon, monsterIcon } from '../render/art';
import type { Building, GameState, Npc } from '../game/types';
import type { Meta } from '../game/save';

export type Tab = 'build' | 'facilities' | 'residents' | 'guild' | 'forge' | 'storage' | 'tourists' | 'village' | 'settings';

export interface Ctl {
  s: GameState;
  meta: Meta;
  speed: number;
  placing: string | null;
  selected: { kind: 'npc' | 'bld' | 'mon'; id: number } | null;
  labels: boolean;
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

const roleLabel = (n: Npc) => (n.role === 'fighter' ? t('cls.' + n.cls) : t('role.' + n.role));

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

const TABS: Tab[] = ['build', 'facilities', 'residents', 'guild', 'forge', 'storage', 'tourists', 'village', 'settings'];

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
  setHtml('t-tod', tt >= 0.75 || tt < 0.04 ? '☾' : '☀');
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
  setHtml('t-speed', btn('labels', t('ui.labels'), { cls: c.labels ? 'on' : '' }) + [0, 1, 2, 4, 8].map((v) => btn('speed:' + v, v ? '×' + v : '❚❚', { cls: c.speed === v ? 'on' : '' })).join(''));
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
    return cats + roads + `<div class="grid">${Object.keys(BUILDINGS).filter((k) => BUILDINGS[k].buildable !== false && BUILDINGS[k].cat === buildCat).map((k) => {
      const d = BUILDINGS[k];
      const built = s.buildings.filter((b) => b.type === k).length;
      const done = !!d.unique && built > 0;
      const ok = canBuild(s, k);
      return `<div class="card ${ok ? '' : 'dim'}">
        <div class="card-img">${img(buildingIcon(k), 'bimg')}</div>
        <div class="card-main"><b>${t('b.' + k)}</b> <small>${t('ui.owned', { n: built })}</small>
        <div class="desc">${t('bd.' + k)}</div>
        <div>${done ? t('ui.uniqueBuilt') : costHtml(s, buildCost(s, k))}</div>
        <div class="meta">${t('ui.size', { n: d.size })} · ${t('ui.attraction')} ${d.attraction}${d.price ? ` · ${t('ui.price')} ${d.price}` : ''}${hoursText(k)}</div></div>
        ${done ? '' : btn('place:' + k, t('ui.build'), { disabled: !ok })}
      </div>`;
    }).join('')}</div>`;
  },

  facilities(c) {
    const s = c.s;
    const rows = [...s.buildings].sort((a, b) => a.type.localeCompare(b.type) || b.level - a.level).map((b) => `
      <div class="row click" data-act="select:bld:${b.id}">${img(buildingIcon(b.type), 'bimg sm')}
        <span class="grow"><b>${t('b.' + b.type)}</b> ${t('ui.lv', { lv: b.level })}<br>${bar(b.exp / bldExpNeed(b.level))}</span>
        ${BUILDINGS[b.type].kind === 'house' ? `<span>${housed(s, b)}/${HOUSE_CAP}</span>` : ''}
      </div>`);
    return rows.join('') || `<p>${t('ui.none')}</p>`;
  },

  residents(c) {
    const s = c.s;
    const order = { fighter: 0, gatherer: 1, civilian: 2, tourist: 3 };
    const list = residents(s).sort((a, b) => order[a.role] - order[b.role] || b.level - a.level);
    const counts = (['fighter', 'gatherer', 'civilian'] as const).map((r) => `${t('role.' + r)} ${list.filter((n) => n.role === r).length}`).join(' · ');
    return `<p class="meta">${counts}</p>` + list.map((n) => `
      <div class="row click" data-act="select:npc:${n.id}">${img(humanIcon(n.role, n.cls, n.look), 'pimg')}
        <span class="grow"><b>${esc(npcName(n.name))}</b> <small>${roleLabel(n)}</small> ${n.role !== 'civilian' ? t('ui.lv', { lv: n.level }) : ''}
        <br><small>${t(statusKey(n))}${debuffs(n).map((d) => ` <span class="bad">${t('debuff.' + d)}</span>`).join('')}</small></span>
        ${n.role === 'fighter' ? bar(n.hp / maxHp(n), 'hp') : ''}
      </div>`).join('');
  },

  guild(c) {
    const s = c.s;
    let h = `<h3>${t('ui.quests')}</h3>`;
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
      return `<div class="card ${locked ? 'dim' : ''}"><div class="card-main"><b>${t('ex.' + d.key)}</b> <small>${t('ui.days', { n: d.days })}</small>
        <div class="desc">${t('exd.' + d.key)}</div>
        <div>${t('ui.monsters')}: ${mons}</div><div>${t('ui.drops')}: ${drops}</div>
        ${locked ? `<div class="meta">${t('ui.unlockYear', { y: d.unlockYear })}</div>` : ''}</div>
        ${locked ? '' : btn('expedition:' + d.key, t('ui.recruit'), { disabled: !!s.exp })}</div>`;
    }).join('');
    return h;
  },

  forge(c) {
    const s = c.s;
    if (!s.buildings.some((b) => b.type === 'forge')) return `<p>${t('ui.needForge')}</p>`;
    return `<p class="meta">${t('ui.forgeHint')}</p>` + forgeableWeapons(s).map((k) => {
      const w = EQUIP.weapon.find((e) => e.key === k)!;
      const L = s.wlv[k] ?? 0;
      const fc = forgeCost(s, k);
      const have = s.items[fc.mat] ?? 0;
      const ok = s.money >= fc.money && have >= fc.count;
      const users = s.npcs.filter((n) => n.weapon === k).length;
      return `<div class="row"><span class="grow"><b>${t('eq.' + k)}</b> +${L}
        <br><small>${t('ui.atk')} ${w.atk} → ${(w.atk * forgeMult(L)).toFixed(1)} · ${t('ui.users', { n: users })}</small>
        <br>${money(fc.money, s.money >= fc.money)} <span class="cost ${have >= fc.count ? '' : 'bad'}">${img(itemIcon(fc.mat))}${t('item.' + fc.mat)} ${fmt(have)}/${fmt(fc.count)}</span></span>
        ${btn('forge:' + k, t('ui.forge'), { disabled: !ok })}</div>`;
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
    h += `<div class="kv"><span>${t('ui.attraction')}</span><b>${fmt(attraction(s))}</b>
      <span>${t('ui.population')}</span><b>${res.length}</b>
      <span>${t('ui.lastIncome')}</span><b>${fmt(s.stats.lastIncome)}</b>
      <span>${t('ui.kills')}</span><b>${fmt(s.stats.kills)}</b>
      <span>${t('ui.touristTotal')}</span><b>${fmt(s.stats.tourists)}</b></div>`;
    h += `<h3>${t('ui.expand')}</h3>`;
    h += ec ? `<div class="row"><span class="grow">${t('ui.expandDesc', { lv: s.vlv + 1 })}<br>${costHtml(s, ec)}</span>${btn('expand', t('ui.expand'), { disabled: !hasCost(s, ec) })}</div>`
      : `<p class="meta">${t('ui.expandMax')}</p>`;
    h += `<h3>${t('ui.monsterLevels')}</h3><div class="tags">${Object.keys(MONSTERS).filter((k) => MONSTERS[k].zone >= 0 || s.seen.includes(k))
      .map((k) => `<span class="tag">${img(monsterIcon(k), 'mimg sm')}${t('m.' + k)} ${t('ui.lv', { lv: s.mlv[k].level })}</span>`).join('')}</div>`;
    h += `<h3>${s.score ? t('ui.finalScore') : t('ui.projectedScore')}</h3>${scoreTable(sc)}`;
    if (!s.score) h += `<p class="meta">${t('ui.scoreHint', { y: SCORE_YEAR })}</p>`;
    return h;
  },

  settings(c) {
    const langs = Object.entries(LANGS).map(([k, p]) => btn('lang:' + k, p.label, { cls: getLang() === k ? 'on' : '' })).join('');
    return `<h3>${t('ui.language')}</h3><div class="btns">${langs}</div>
      <h3>${t('ui.data')}</h3><div class="btns">${btn('save', t('ui.saveNow'))}${btn('title', t('ui.backTitle'))}</div>
      <p class="meta">${t('ui.autosave')}</p>
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
  const head = (icon: string, title: string, sub: string) =>
    `<div class="win-title">${icon}<span class="grow"><b>${title}</b> <small>${sub}</small></span>${btn('deselect', '✕', { cls: 'x' })}</div>`;
  if (sel.kind === 'bld') {
    const b = bld(s, sel.id);
    if (!b) return '';
    return head(img(buildingIcon(b.type), 'bimg sm'), t('b.' + b.type), t('ui.lv', { lv: b.level })) + buildingBody(c, b);
  }
  if (sel.kind === 'mon') {
    const m = s.monsters.find((o) => o.id === sel.id);
    if (!m) return '';
    const st = monsterStats(s, m.type);
    const drops = MONSTERS[m.type].drops.map(([it]) => (s.disc.includes(it) ? `<span class="tag">${img(itemIcon(it))}${t('item.' + it)}</span>` : `<span class="tag">${t('ui.unknown')}</span>`)).join('');
    return head(img(monsterIcon(m.type), 'mimg'), t('m.' + m.type), t('ui.lv', { lv: st.level })) + `<div class="win-body">
      <div class="kv"><span>HP</span><b>${fmt(Math.max(0, m.hp))}/${fmt(st.maxHp)}</b><span>${t('ui.atk')}</span><b>${fmt(st.atk)}</b><span>${t('ui.def')}</span><b>${fmt(st.def)}</b></div>
      <div>${t('ui.drops')}: ${drops}</div><p class="meta">${t('ui.sharedLevel')}</p></div>`;
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
        body += `<span>${t('slot.' + slot)}</span><b>${e ? t('eq.' + e.key) + (slot === 'weapon' && s.wlv[e.key] ? ` +${s.wlv[e.key]}` : '') : '-'}</b>`;
      }
      const q = s.quests.find((q) => q.id === n.quest);
      if (q) body += `<span>${t('ui.quest')}</span><b>${t('ui.questText', { c: q.need, m: '@m.' + q.type })}</b>`;
      body += `<span>${t('ui.kills')}</span><b>${fmt(n.kills)}</b>`;
    }
    const bag = Object.entries(n.bag).filter(([, v]) => v > 0);
    if (bag.length) body += `<span>${t('ui.bag')}</span><b>${bag.map(([k, v]) => `${img(itemIcon(k))}${v}`).join(' ')}</b>`;
    body += '</div>';
    const db = debuffs(n);
    if (db.length) body += `<div>${db.map((d) => `<span class="tag bad">${t('debuff.' + d)}: ${t('debuffd.' + d)}</span>`).join('')}</div>`;
  }
  const sub = `${roleLabel(n)}${n.role !== 'civilian' && n.role !== 'tourist' ? ' ' + t('ui.lv', { lv: n.level }) : ''}`;
  return head(img(humanIcon(n.role, n.cls, n.look), 'pimg'), esc(npcName(n.name)), sub) + `<div class="win-body">${body}</div>`;
}

function buildingBody(c: Ctl, b: Building): string {
  const s = c.s;
  const d = BUILDINGS[b.type];
  let h = `<div class="desc">${t('bd.' + b.type)}</div>`;
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
  if (d.kind === 'guild') h += `<div class="btns">${btn('tab:guild', t('tab.guild'))}</div>`;
  if (d.kind === 'forge') h += `<div class="btns">${btn('tab:forge', t('tab.forge'))}</div>`;
  const uc = upgradeCost(b);
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
    <div class="btns center">${langs}</div><div class="villages">${cards}</div></div>`;
}

export function scoreModalHtml(s: GameState, unlocked: string | null): string {
  return `<div class="win modal-box"><div class="win-title"><b>${t('ui.scoreTitle', { y: SCORE_YEAR })}</b></div><div class="win-body">
    ${scoreTable(s.score!)}
    ${unlocked ? `<p class="good">${t('ui.unlocked', { v: '@village.' + unlocked + '.name' })}</p>` : ''}
    <p class="meta">${t('ui.keepPlaying')}</p>
    <div class="btns center">${btn('closeModal', t('ui.continuePlay'), { cls: 'primary' })}</div></div></div>`;
}

export function confirmHtml(text: string, yes: string): string {
  return `<div class="win modal-box"><div class="win-body"><p>${text}</p>
    <div class="btns center">${btn(yes, t('ui.yes'), { cls: 'danger' })}${btn('closeModal', t('ui.cancel'))}</div></div></div>`;
}
