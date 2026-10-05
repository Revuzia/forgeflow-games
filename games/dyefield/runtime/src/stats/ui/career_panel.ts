// DYEFIELD — the CAREER screen body (_spec/CONTRACT_STATS.md §S8.1). A standalone DOM module: Menus supplies the screen,
// the scrim, the header with BACK, and ESC / pad B (§S10.3); this is the scrolling body under that header.
//
// One scroll column of cards (two columns from 700 px up): account line · tiles · modes · records · totals · kits · arenas ·
// online · achievements · recent. The structure is built once (all 29 achievements, every row) and refresh() only rewrites
// text and classes, so nothing shifts when the account's data arrives. Every section header is a focusable [data-nav]
// element that scrolls itself into view on focus (arrows / d-pad scroll the panel); touch scrolls natively.

import './stats.css';
import type { DisplayCareer, PortalState, WLD } from '../types.ts';
import { ACHIEVEMENTS } from '../achievements.ts';
import { KIT_IDS, MAP_IDS, MODE_KEYS } from '../career.ts';
import { KIT_ICONS, MAP_THUMBS } from '../../ui/icons.ts';
import { MAPS, WEAPONS } from '../../core/data.ts';
import { TIER_COLORS } from './toast.ts';

/** what the panel reads (StatsCore satisfies it) */
export interface CareerSource {
  display(): DisplayCareer;
  readonly portal: PortalState;
  readonly readOk: boolean;
  readonly enabled: boolean;
  careerOpened(): void;
}

/** el / refresh() / summary() = the Menus option (§S10.3: refresh() runs when the screen opens — it also re-probes the
 *  portal while the account is unresolved); update() = a plain redraw (the facade calls it when data changes) */
export interface CareerPanel { el: HTMLElement; refresh(): void; summary(): string; update(): void }

export const ACCOUNT_LINES: Readonly<Record<string, string>> = {
  account: 'Saved to your ForgeFlow account',
  guest: 'Playing as a guest — sign in on forgeflowgames.com to save your career and earn XP',
  standalone: 'Saved on this device — play on forgeflowgames.com and sign in to keep it on your account',
  probing: 'Connecting to your account…',
};

const MODE_LABEL: Record<string, string> = {
  teams_turf: 'TEAMS · TURF', teams_washout: 'TEAMS · WASHOUT', ffa_turf: 'FFA · TURF', ffa_washout: 'FFA · WASHOUT',
};
const n = (v: number): string => Math.round(v).toLocaleString('en-US');
const wldText = (x: WLD | undefined): string => `${n(x?.w ?? 0)}–${n(x?.l ?? 0)}–${n(x?.d ?? 0)}`;
const kitName = (id: string): string => WEAPONS.kits.find((k) => k.id === id)?.name ?? id.toUpperCase();
const mapName = (id: string): string => MAPS.find((m) => m.id === id)?.name ?? id.toUpperCase();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function timePlayed(s: number): string {
  const m = Math.floor(Math.max(0, s) / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h.toLocaleString('en-US')}h ${m % 60}m` : `${m}m`;
}

export function careerSummary(d: DisplayCareer): string {
  const c = d.c;
  if (!c.matches) return 'No matches yet';
  return `${n(c.wins)} W · ${n(c.matches)} match${c.matches === 1 ? '' : 'es'}`;
}

export function createCareerPanel(src: CareerSource): CareerPanel {
  const root = el('div', 'dfc-panel');
  root.id = 'dfc-career';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Career');
  const grid = el('div', 'dfc-grid');
  root.append(grid);

  const section = (key: string, title: string, wide = false): { card: HTMLElement; head: HTMLElement } => {
    const card = el('section', `dfc-card dfc-${key}${wide ? ' wide' : ''}`);
    const head = el('h3', 'dfc-sec', title);
    head.tabIndex = 0;
    head.setAttribute('data-nav', '');
    head.addEventListener('focus', () => { try { head.scrollIntoView({ block: 'nearest' }); } catch { /* old engines */ } });
    card.append(head);
    grid.append(card);
    return { card, head };
  };

  // 1. account line
  const acct = el('p', 'dfc-acct');
  acct.id = 'dfc-acct';
  grid.append(acct);

  // 2. tiles
  const tiles = el('div', 'dfc-tiles wide');
  const tile = (label: string): HTMLElement => {
    const t = el('div', 'dfc-tile');
    const v = el('b', '', '0');
    t.append(v, el('small', '', label));
    tiles.append(t);
    return v;
  };
  const tMatches = tile('MATCHES'), tWins = tile('WINS'), tRate = tile('WIN RATE'), tBest = tile('BEST SCORE');
  grid.append(tiles);

  // 3. modes
  const modes = section('modes', 'MODES');
  const modeGrid = el('div', 'dfc-modegrid');
  const modeVals: Record<string, HTMLElement> = {};
  for (const k of MODE_KEYS) {
    const cell = el('div', 'dfc-mode');
    const v = el('b', '', '0–0–0');
    cell.append(el('small', '', MODE_LABEL[k]), v);
    modeGrid.append(cell);
    modeVals[k] = v;
  }
  modes.card.append(modeGrid, el('p', 'dfc-foot', 'Wins – losses – draws'));

  // 4. records / 5. totals
  const rows = (key: string, title: string, labels: string[]): HTMLElement[] => {
    const s = section(key, title);
    const dl = el('dl', 'dfc-rows');
    const out: HTMLElement[] = [];
    for (const l of labels) {
      const dt = el('dt', '', l), dd = el('dd', '', '0');
      dl.append(dt, dd);
      out.push(dd);
    }
    s.card.append(dl);
    return out;
  };
  const rec = rows('records', 'RECORDS', ['Best score', 'Best crew turf (TEAMS)', 'Best turf (FFA)', 'Most washes', 'Best streak', 'Most painted']);
  const tot = rows('totals', 'TOTALS', ['Washes', 'Times washed', 'Painted', 'Specials', 'Subs', 'Splashdowns', 'Time played']);

  // 6. kits + arenas
  const listOf = (key: string, title: string, ids: readonly string[], img: Readonly<Record<string, string>>, name: (id: string) => string): Record<string, HTMLElement> => {
    const s = section(key, title);
    const ul = el('ul', 'dfc-list');
    const vals: Record<string, HTMLElement> = {};
    for (const id of ids) {
      const li = el('li');
      const im = el('img', key === 'kits' ? 'kit' : 'map');
      im.src = img[id] ?? '';
      im.alt = '';
      im.decoding = 'async';
      const v = el('b', '', '0 / 0');
      li.append(im, el('span', 'nm', name(id)), v);
      ul.append(li);
      vals[id] = v;
    }
    s.card.append(ul, el('p', 'dfc-foot', 'Wins / matches'));
    return vals;
  };
  const kitVals = listOf('kits', 'KITS', KIT_IDS, KIT_ICONS, kitName);
  const mapVals = listOf('arenas', 'ARENAS', MAP_IDS, MAP_THUMBS, mapName);

  // 7. online
  const onl = section('online', 'ONLINE');
  const onlineLine = el('p', 'dfc-online', '');
  onl.card.append(onlineLine);

  // 8. achievements
  const ach = section('achievements', 'ACHIEVEMENTS', true);           // card class dfc-achievements (dfc-ach = one item)
  const achSum = el('span', 'dfc-achsum', '');
  ach.head.append(achSum);
  const achGrid = el('ul', 'dfc-achgrid');
  const achItems = new Map<string, HTMLElement>();
  for (const a of ACHIEVEMENTS) {
    const li = el('li', 'dfc-ach locked');
    li.dataset.slug = a.slug;
    li.style.setProperty('--tier', TIER_COLORS[a.tier] ?? TIER_COLORS.bronze);
    const chip = el('span', 'chip', a.tier === 'gold' ? '★' : a.tier === 'silver' ? '◆' : '●');
    chip.setAttribute('aria-hidden', 'true');
    const txt = el('span', 'txt');
    txt.append(el('b', '', a.name), el('small', '', a.description));
    li.append(chip, txt, el('span', 'xp', `${a.points} XP`));
    achGrid.append(li);
    achItems.set(a.slug, li);
  }
  ach.card.append(achGrid);

  // 9. recent
  const rcn = section('recent', 'RECENT', true);
  const recentList = el('ol', 'dfc-recent');
  const recentEmpty = el('p', 'dfc-foot', 'Finish a match to see it here.');
  rcn.card.append(recentList, recentEmpty);

  const refresh = (): void => {
    let d: DisplayCareer;
    try { d = src.display(); } catch { return; }
    const c = d.c;
    const key = src.readOk ? 'account' : src.portal;
    acct.textContent = ACCOUNT_LINES[key] ?? ACCOUNT_LINES.standalone;
    acct.dataset.state = key;
    tMatches.textContent = n(c.matches);
    tWins.textContent = n(c.wins);
    tRate.textContent = c.matches ? `${Math.round((c.wins / c.matches) * 100)} %` : '—';
    tBest.textContent = n(d.best.score);
    for (const k of MODE_KEYS) modeVals[k].textContent = wldText(c.byMode[k]);
    const b = d.best;
    const recVals = [n(b.score), `${b.turfPctTeams.toFixed(1)} %`, `${b.turfPctFfa.toFixed(1)} %`, n(b.washes), n(b.streak), `${n(b.paintedM2)} m²`];
    rec.forEach((e, i) => { e.textContent = recVals[i]; });
    const totVals = [n(c.washes), n(c.washed), `${n(c.paintedM2)} m²`, n(c.specials), n(c.subs), n(c.splashdowns), timePlayed(c.liveS)];
    tot.forEach((e, i) => { e.textContent = totVals[i]; });
    for (const id of KIT_IDS) kitVals[id].textContent = `${n(c.byKit[id]?.w ?? 0)} / ${n(c.byKit[id]?.m ?? 0)}`;
    for (const id of MAP_IDS) mapVals[id].textContent = `${n(c.byMap[id]?.w ?? 0)} / ${n(c.byMap[id]?.m ?? 0)}`;
    const o = c.online;
    onlineLine.textContent = o.m || o.void ? `${wldText(o)} · ${n(o.void)} voided` : 'Play online to start your record.';
    let got = 0, xp = 0;
    for (const a of ACHIEVEMENTS) {
      const on = a.slug in d.ach;
      achItems.get(a.slug)!.classList.toggle('locked', !on);
      if (on) { got++; xp += a.points; }
    }
    achSum.textContent = `${got} / ${ACHIEVEMENTS.length} · ${n(xp)} XP`;
    recentList.replaceChildren();
    for (const r of d.recent.slice(0, 10)) {
      const li = el('li', `dfc-rec ${r.result}`);
      const im = el('img', 'kit');
      im.src = KIT_ICONS[r.kit] ?? '';
      im.alt = '';
      const what = r.rule === 'turf' ? `${(Number(r.turfPct) || 0).toFixed(1)} %` : `${n(Number(r.washes) || 0)} washes`;
      li.append(
        el('span', 'md', `${r.mode === 'ffa' ? 'FFA' : 'TEAMS'} · ${r.rule === 'turf' ? 'TURF' : 'WASHOUT'}${r.online ? ' · ONLINE' : ''}`),
        el('span', 'ar', mapName(r.map)), im,
        el('b', 'res', r.result === 'win' ? 'WIN' : r.result === 'loss' ? 'LOSS' : 'DRAW'),
        el('span', 'st', what), el('span', 'sc', n(Number(r.score) || 0)),
      );
      recentList.append(li);
    }
    recentEmpty.hidden = d.recent.length > 0;
  };

  // the panel draws data that came from the cloud (another device, an older client): a bad value must never throw into
  // the menus that host it
  const safeRefresh = (): void => { try { refresh(); } catch (e) { try { console.warn('[dyefield stats] career panel:', e); } catch { /* none */ } } };
  safeRefresh();
  return {
    el: root,
    refresh: () => { try { src.careerOpened(); } catch { /* re-probe is best effort */ } safeRefresh(); },
    summary: () => { try { return careerSummary(src.display()); } catch { return 'No matches yet'; } },
    update: safeRefresh,
  };
}
