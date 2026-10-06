// BLOCKTOOTH ONLINE VS — the front-page END CARD + REMATCH (lane B-VIEW; vs_design.md §9, §11).
//
// "ZONING DISPUTE · FINAL EDITION": the headline ("MOLO WINS ZONING DISPUTE IN 9:12"), the freeze-frame photo, the
// standings 1st..4th (portrait, name, peak Size, the VS SCORE and its line items), what the local player
// did, and two buttons: REMATCH (ENTER / R) and LEAVE (ESC). REMATCH opens the 10 s TITAN SWAP window (pick an applicant
// with ← →, ENTER locks in; the timer locks the current pick) and resolves { kind: 'rematch', titan }; the app starts the
// next match (new seed, the biome rotated GRID-EAST → WHITE STACKS → LOCKWATER, every other seat refills).
// Online (B-NET) the same screen shows the 15 s vote (`voteS`); offline VS PRACTICE has no vote timer.
//
// Standings come from the sim: PlayerVs.place (1..4 once decided), else World.vs.winner + the reversed elimination
// order + VS SCORE (vs_design.md §9). Reads the world, never writes it.

import './vs.css';
import type { TitanId, World } from '../core/types.ts';
import { TITAN_IDS } from '../core/types.ts';
import { VS as STR_VS, fmtMatchClock, titanTag, vsFmt } from '../data/strings_vs.ts';
import { VS } from '../core/config.ts';
import type { Input } from '../core/input.ts';
import { type ModalSession, type UiPress, clearEl, div, el, fmtInt, keyChip, onTap, roman, runModal, flashesReduced } from './dom.ts';
import type { VsGoalLine, VsMatchInfo } from './vstypes.ts';
import { buildBug } from './menus.ts';

export type VsEndChoice = { kind: 'rematch'; titan: TitanId } | { kind: 'leave' };

export interface VsEndData {
  w: World;
  info: VsMatchInfo;
  /** the freeze-frame photo (data URL; '' = none) */
  photo: string;
  portraits: Partial<Record<TitanId, string>>;
  /** online: the rematch vote length (s); null offline (no timer, no timeout) */
  voteS: number | null;
  /** the vsEnd event (placements / scores) when the app saw it */
  end?: { winner: number; placements: number[]; scores: number[] } | null;
}

export interface VsRow {
  slot: number; place: number; score: number; name: string; sign: string; bot: boolean; titan: TitanId; color: string;
  peak: number; evict: number; assist: number; pvp: number; tons: number; bids: number; out: boolean;
  /** times this seat was knocked out (EVICTED) / the match clock (s) it was eliminated at (-1 = still standing) */
  outs: number; outT: number;
}

/** placements 1..n for a decided match (exported for the probe) */
export function vsStandings(w: World, info: VsMatchInfo, end?: VsEndData['end']): VsRow[] {
  const ps = w.players, V = w.vs;
  const n = ps.length;
  const place: number[] = new Array<number>(n).fill(0);
  let ok = true;
  for (let i = 0; i < n; i++) { place[i] = ps[i].vs.place | 0; if (place[i] < 1) ok = false; }
  if (!ok) {
    // winner first, then reverse elimination order, then whoever is left by score
    const list: number[] = [];
    const winner = V && V.winner >= 0 ? V.winner : end && end.winner >= 0 ? end.winner : -1;
    if (winner >= 0) list.push(winner);
    if (V) for (let k = V.order.length - 1; k >= 0; k--) if (!list.includes(V.order[k])) list.push(V.order[k]);
    const rest: number[] = [];
    for (let i = 0; i < n; i++) if (!list.includes(i)) rest.push(i);
    rest.sort((a, b) => (ps[b].vs.score - ps[a].vs.score) || (a - b));
    for (const r of rest) list.push(r);
    for (let p = 0; p < list.length; p++) place[list[p]] = p + 1;
  }
  const rows: VsRow[] = [];
  for (let i = 0; i < n; i++) {
    const P = ps[i], s = info.seats[i];
    const sc = P.vs.score > 0 ? P.vs.score : end && end.scores && Number.isFinite(end.scores[i]) ? end.scores[i] : 0;
    rows.push({
      slot: i, place: place[i], score: Math.round(sc), name: s ? s.name : 'SEAT ' + (i + 1), sign: s ? s.sign : '', bot: !!(s && s.bot),
      titan: s ? s.titan : P.titanId, color: s ? s.color : VS.seatColors[i] ?? '#ffffff',
      peak: Math.max(P.vs.peakRank, P.run.peakRank, P.titan.rank), evict: P.vs.evictions, assist: P.vs.assists, pvp: Math.round(P.vs.pvpDealt * 100) / 100,
      tons: P.run.tonnage, bids: P.vs.tenderBids, out: P.vs.eliminated,
      outs: P.vs.koCount, outT: P.vs.eliminated && P.vs.elimT >= 0 && V ? Math.max(0, P.vs.elimT - V.startT) : -1,
    });
  }
  rows.sort((a, b) => a.place - b.place || a.slot - b.slot);
  return rows;
}

export class VsEndScreen {
  private readonly input: Input;
  /** the goals earned this match (set by the app when the report is filed: it can land before OR after the card opens) */
  private goals: VsGoalLine[] = [];
  private goalsEl: HTMLDivElement | null = null;
  private readonly layer: HTMLDivElement;
  private paper: HTMLDivElement;
  private session: ModalSession<VsEndChoice> | null = null;
  private voteTimer = 0;
  private swapTimer = 0;

  constructor(root: HTMLElement, input: Input) {
    this.input = input;
    const L = this.layer = div('bt-layer bt-screen bt-vsend bt-hidden', root);
    L.setAttribute('role', 'dialog');
    L.setAttribute('aria-label', STR_VS.end.kicker);
    L.dataset.v2 = 'vs-end';
    div('bt-vsend-bg', L);
    div('bt-halftone soft', L);
    div('bt-scanlines', L);
    this.paper = div('bt-vsend-paper', L);
  }

  /** build + show the end card; resolves with REMATCH (+ the swapped titan) or LEAVE */
  open(d: VsEndData): Promise<VsEndChoice> {
    if (this.session && !this.session.done) this.session.abort();
    window.clearInterval(this.voteTimer); window.clearInterval(this.swapTimer);
    const rows = vsStandings(d.w, d.info, d.end);
    const me = rows.find((r) => r.slot === d.info.local) ?? rows[0];
    const winner = rows[0];
    const V = d.w.vs;
    const dur = V && V.endT >= 0 ? V.endT - V.startT : d.w.t - (V ? V.startT : 0);
    const bell = dur >= VS.phase.hardEndS - 1.5;
    clearEl(this.paper);
    const P = this.paper;
    const mast = div('bt-vsend-mast', P);
    mast.appendChild(el('span', '', 'WARD-7 · THE FRONT PAGE'));
    mast.appendChild(el('small', '', STR_VS.end.kicker));
    const head = div('bt-vsend-head', P);
    const hlName = titanTag(winner.titan);
    div('bt-vsend-hl', head, vsFmt(bell ? STR_VS.end.timeout : STR_VS.end.win, { name: hlName, t: fmtMatchClock(dur) }));
    div('bt-vsend-sub', head, STR_VS.end.winSub + ' · ' + (me.place === 1 ? STR_VS.end.you1 : vsFmt(STR_VS.end.youN, { place: STR_VS.place[Math.min(3, me.place - 1)] })));

    const body = div('bt-vsend-body', P);
    const photo = div('bt-vsend-photo', body);
    if (d.photo) photo.style.backgroundImage = 'url(' + d.photo + ')';
    const table = div('bt-vsend-table', body);
    for (const r of rows) {
      const row = div('bt-vsend-row' + (r.place === 1 ? ' first' : '') + (r.slot === d.info.local ? ' you' : ''), table);
      row.style.setProperty('--seat', r.color);
      row.dataset.v2 = 'vs-row';
      div('bt-vsend-place', row, STR_VS.place[Math.min(3, Math.max(0, r.place - 1))]);
      const ph = el('img', 'bt-vsend-ph');
      ph.alt = '';
      const url = d.portraits[r.titan];
      if (url) ph.src = url;
      row.appendChild(ph);
      const who = div('bt-vsend-who', row);
      // every rival shows titan + NAME (GUEST-xxxx / account / player handle), no chip; your own row keeps YOU
      const nm = el('b', '', (r.slot === d.info.local ? STR_VS.you + ' · ' : '') + titanTag(r.titan) + (r.slot !== d.info.local && r.name && r.name !== 'YOU' ? ' · ' + r.name : ''));
      who.appendChild(nm);
      // KOs = knock-outs scored · OUT xN = times knocked out (same words as the seat cards) · when the seat went out (the placing rule)
      who.appendChild(el('span', '', [
        'SIZE ' + roman(r.peak),
        vsFmt(STR_VS.kos, { n: r.evict }), r.outs > 0 ? vsFmt(STR_VS.outTimes, { n: r.outs }) : '',
        r.assist + ' AST', r.pvp > 0 ? Math.round(r.pvp) + '% PVP' : '', Math.round(r.tons / 100) / 10 + 'K T',
        r.bids > 0 ? r.bids + ' BIDS' : '',
      ].filter(Boolean).join(' · ')));
      // the placing line: WHY this seat is where it is (elimination time, or last standing)
      const why = r.out ? (r.outT >= 0 ? vsFmt(STR_VS.end.outAt, { t: fmtMatchClock(r.outT) }) : STR_VS.end.leftTheMatch)
        : r.place === 1 ? (bell ? STR_VS.end.standing : STR_VS.end.lastStanding) : STR_VS.end.standing;
      who.appendChild(el('span', 'bt-vsend-why' + (r.out ? ' out' : ' in'), why));
      const sc = div('bt-vsend-score', row);
      sc.appendChild(el('b', '', fmtInt(r.score)));
      sc.appendChild(el('small', '', STR_VS.end.score));
    }

    // GOALS MET: the VS goals this match earned (the old GOAL MET toasts were dropped with the toast queue on every exit from the card)
    this.goalsEl = div('bt-vsend-goals bt-hidden', P);
    this.goalsEl.dataset.v2 = 'vs-goals';
    this.renderGoals();

    // the placing rule, in words (score never decides the winner)
    const rule = div('bt-vsend-rule', P);
    rule.appendChild(el('b', '', STR_VS.end.rule));
    rule.appendChild(el('span', '', bell ? STR_VS.end.ruleBell : STR_VS.end.ruleSub));

    const foot = div('bt-vsend-foot', P);
    div('bt-vsend-you', foot, me.place === 1 ? STR_VS.end.you1 : vsFmt(STR_VS.end.youN, { place: STR_VS.place[Math.min(3, me.place - 1)] }));
    const vote = div('bt-vsend-vote', foot);
    const btns = div('bt-vsend-btns', foot);
    const mk = (cls: string, label: string, key: string, fn: () => void): HTMLButtonElement => {
      const b = el('button', 'bt-btn ' + cls);
      b.type = 'button'; b.tabIndex = -1;
      b.appendChild(el('span', '', label));
      b.appendChild(keyChip(key, cls.includes('coral') ? 'dark' : ''));
      onTap(b, fn);
      btns.appendChild(b);
      return b;
    };
    mk('bt-btn-ghost', STR_VS.end.leave, 'ESC', () => this.finish({ kind: 'leave' }));
    mk('bt-btn-coral', STR_VS.end.rematch, 'ENTER', () => this.openSwap(d, rows));

    // the TITAN SWAP overlay (hidden until REMATCH)
    const swap = div('bt-vsend-swap', this.layer);
    swap.dataset.v2 = 'vs-swap';
    this.swapEl?.remove();
    this.swapEl = swap;

    const { promise, session } = runModal<VsEndChoice>(this.layer, this.input, (p) => this.onPress(p, d, rows), {
      armMs: 900,
      onClose: () => { this.layer.classList.add('bt-hidden'); this.session = null; window.clearInterval(this.voteTimer); window.clearInterval(this.swapTimer); },
    });
    this.session = session;
    this.layer.classList.remove('bt-hidden');
    this.swapOn = false;
    if (d.voteS !== null && d.voteS > 0) {
      const t0 = performance.now();
      const tick = (): void => {
        const left = Math.max(0, Math.ceil(d.voteS! - (performance.now() - t0) / 1000));
        vote.textContent = vsFmt(STR_VS.end.voteIn, { n: left });
        // the vote is a window for the REMATCH room, not a timeout: the card stays until the player acts (REMATCH still works after it:
        // it joins a room that already started or opens a fresh one)
        if (left <= 0) { vote.textContent = STR_VS.end.voteClosed; window.clearInterval(this.voteTimer); }
      };
      tick();
      this.voteTimer = window.setInterval(tick, 250);
    }
    return promise;
  }

  /** the GOALS MET strip: callable at any time (the report is filed once the other peers' RESULT hashes are in, which can be after the card opened) */
  setGoals(list: readonly VsGoalLine[]): void {
    this.goals = list.slice();
    this.renderGoals();
  }

  private renderGoals(): void {
    const g = this.goalsEl;
    if (!g) return;
    clearEl(g);
    g.classList.toggle('bt-hidden', this.goals.length === 0);
    if (!this.goals.length) return;
    const k = div('bt-vsend-goalk', g);
    k.appendChild(el('b', '', STR_VS.end.goalsKicker));
    k.appendChild(el('small', '', STR_VS.end.goalsSub));
    const list = div('bt-vsend-goallist', g);
    for (const x of this.goals) {
      const c = div('bt-vsend-goal', list);
      c.dataset.id = x.id;
      c.appendChild(el('b', '', x.name));
      c.appendChild(el('span', '', x.desc.toUpperCase()));
    }
  }

  private swapEl: HTMLDivElement | null = null;
  private swapOn = false;
  private swapSel = 0;

  private onPress(p: UiPress, d: VsEndData, rows: VsRow[]): void {
    if (this.swapOn) {
      const n = TITAN_IDS.length;
      if (p.act === 'left') this.swapPick((this.swapSel + n - 1) % n);
      else if (p.act === 'right') this.swapPick((this.swapSel + 1) % n);
      else if (p.act === 'pick1' || p.act === 'pick2' || p.act === 'pick3') this.swapPick(p.act === 'pick1' ? 0 : p.act === 'pick2' ? 1 : 2);
      else if (p.act === 'confirm' || p.act === 'alt') this.lockSwap();
      else if (p.act === 'back') this.finish({ kind: 'leave' });
      return;
    }
    if (p.act === 'confirm' || p.act === 'alt' || p.act === 'reroll') this.openSwap(d, rows);
    else if (p.act === 'back') this.finish({ kind: 'leave' });
  }

  private openSwap(d: VsEndData, rows: VsRow[]): void {
    const s = this.session, sw = this.swapEl;
    if (!s || s.done || !sw || this.swapOn) return;
    void rows;
    this.swapOn = true;
    window.clearInterval(this.voteTimer);
    clearEl(sw);
    sw.classList.add('on');
    sw.appendChild(el('h2', '', STR_VS.end.swapTitle));
    sw.appendChild(el('p', '', STR_VS.end.swapSub));
    const cards = div('bt-vsend-swapcards', sw);
    this.swapSel = Math.max(0, TITAN_IDS.indexOf(d.info.seats[d.info.local] ? d.info.seats[d.info.local].titan : TITAN_IDS[0]));
    TITAN_IDS.forEach((t, i) => {
      const c = el('div', 'bt-vsend-swapcard' + (i === this.swapSel ? ' sel' : ''));
      c.dataset.titan = t;
      const im = el('img');
      im.alt = '';
      const url = d.portraits[t];
      if (url) im.src = url;
      c.appendChild(im);
      c.appendChild(el('span', '', titanTag(t)));
      onTap(c, () => { if (this.swapSel === i) this.lockSwap(); else this.swapPick(i); });
      cards.appendChild(c);
    });
    const go = el('button', 'bt-btn bt-btn-coral');
    go.type = 'button'; go.tabIndex = -1;
    go.appendChild(el('span', '', STR_VS.end.swapGo));
    go.appendChild(keyChip('ENTER', 'dark'));
    onTap(go, () => this.lockSwap());
    sw.appendChild(go);
    const tm = div('bt-vsend-swapin', sw);
    const t0 = performance.now();
    const total = VS.rematch.swapS;
    const tick = (): void => {
      const left = Math.max(0, Math.ceil(total - (performance.now() - t0) / 1000));
      tm.textContent = vsFmt(STR_VS.end.swapIn, { n: left });
      if (left <= 0) this.lockSwap();
    };
    tick();
    this.swapTimer = window.setInterval(tick, 250);
  }

  private swapPick(i: number): void {
    this.swapSel = i;
    const sw = this.swapEl;
    if (!sw) return;
    sw.querySelectorAll<HTMLElement>('.bt-vsend-swapcard').forEach((c, k) => c.classList.toggle('sel', k === i));
  }

  private lockSwap(): void {
    if (!this.swapOn) return;
    window.clearInterval(this.swapTimer);
    this.finish({ kind: 'rematch', titan: TITAN_IDS[this.swapSel] ?? TITAN_IDS[0] });
  }

  private finish(c: VsEndChoice): void {
    const s = this.session;
    if (!s || s.done) return;
    window.clearInterval(this.voteTimer); window.clearInterval(this.swapTimer);
    s.finish(c, flashesReduced() ? 60 : 220);
  }

  /** abandon without resolving (a forced transition) */
  clear(): void {
    this.goals = [];
    this.renderGoals();
    if (this.session && !this.session.done) this.session.abort();
    window.clearInterval(this.voteTimer); window.clearInterval(this.swapTimer);
    this.layer.classList.add('bt-hidden');
  }

  /** a bug line for the menus (kept so the screen can show the station bug when it needs one) */
  static bug(parent: HTMLElement): HTMLElement { return buildBug(parent, ''); }
}
