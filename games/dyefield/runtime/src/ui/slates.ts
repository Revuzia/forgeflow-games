// DYEFIELD — full-screen match slates (CONTRACT §11 HUD): the 3 · 2 · 1 countdown (with a control legend
// from the live bindings), the death slate `WASHED BY {name}` with a 3 s ring, and the victory slate
// `THE HARBOR CHOSE A COLOR.` with both crews' percentages, the winning crew's mark, PLAY AGAIN and LOBBY.
// Phase 9 (CONTRACT_P6_11 §20/§21): the victory slate runs a coverage TALLY — both crew bars fill while the
// numbers count up (0.35–1.65 s; the bigger share fills its track, the other in proportion; the numbers are the
// absolute weighted coverage), then the winner's mark STAMPS (1.75 s); the buttons are live from the start
// (a click skips the show). The final percentages are always in the slate's text (a visually hidden line),
// so a read-back mid-count still sees them. Only the brief's strings are shown (DESIGN §1); names come from
// the roster, crew names / marks from data/teams.json.
// CONTRACT_FFA F3 (FREE-FOR-ALL): the same slate element carries an FFA body — the winner (name + colour + mark;
// every tied crew on a draw), a top-3 podium and the full standings with %. Its tally raises the podium steps and
// fills the standings bars while the numbers count up (the same timeline), then the winner's mark stamps. The
// death slate takes the washer's FFA colour + mark. crewLook() is the one palette resolver the HUD, the slates and
// the menus share: teams mode → teams.json `teams` (+ its colorblind block), FFA → teams.json `ffa`.

import { FFA_CREWS, TEAMS_RAW, teamById } from '../core/data.ts';
import type { MatchMode, TeamId } from '../core/types.ts';
import { SVG } from './icons.ts';

/**
 * CONTRACT_MOBILE M4 platform prompts: the touch buttons' glyphs (24 × 24, currentColor + ink), shared by the HUD's
 * badges, the countdown legend, the pause card's legend, HOW TO PLAY and the SETTINGS preview.
 */
export type TouchGlyph = 'stick' | 'aim' | 'fire' | 'slick' | 'jump' | 'sub' | 'special' | 'pause';
const GLYPHS: Record<TouchGlyph, string> = {
  stick: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="2.4"/>'
    + '<circle cx="12" cy="12" r="4.6" fill="currentColor" stroke="#14203a" stroke-width="1.4"/></svg>',
  aim: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.4" fill="none" stroke="currentColor" stroke-width="2.4"/>'
    + '<path d="M5.4 8.2 1.8 12l3.6 3.8M18.6 8.2l3.6 3.8-3.6 3.8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  fire: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l1.9 5 4.6-2.4-1.8 4.9 5.1 1.3-4.6 2.5 2.9 4.4-5.2-.9-.6 5.2L12 18.3l-2.3 4.3-.6-5.2-5.2.9 2.9-4.4-4.6-2.5 5.1-1.3-1.8-4.9 4.6 2.4z" fill="currentColor" stroke="#14203a" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  slick: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2c3 4 5.6 7.2 5.6 10.4a5.6 5.6 0 0 1-11.2 0C6.4 10.4 9 7.2 12 3.2z" fill="currentColor" stroke="#14203a" stroke-width="1.6" stroke-linejoin="round"/>'
    + '<path d="M3 20.4c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  jump: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 14.5 12 7.5l7 7" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>'
    + '<path d="M7 19.5h10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
  sub: SVG['jelly-charge'] ?? '<svg viewBox="0 0 24 24" aria-hidden="true"></svg>',
  special: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8c.9 4.6 2.6 6.3 7.2 7.2-4.6.9-6.3 2.6-7.2 7.2-.9-4.6-2.6-6.3-7.2-7.2 4.6-.9 6.3-2.6 7.2-7.2z" fill="currentColor" stroke="#14203a" stroke-width="1.4" stroke-linejoin="round"/>'
    + '<circle cx="18.6" cy="18.4" r="2.2" fill="currentColor" stroke="#14203a" stroke-width="1.2"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4.2" height="14" rx="1.6" fill="currentColor"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.6" fill="currentColor"/></svg>',
};
export function touchGlyph(g: TouchGlyph): string { return GLYPHS[g]; }
/** the countdown legend in touch mode: [glyph, label] pills (the keyboard rows come from menus.legend()) */
const TOUCH_COUNT_LEGEND: ReadonlyArray<readonly [TouchGlyph, string]> = [['stick', 'move'], ['aim', 'aim'], ['fire', 'fire'], ['slick', 'slick'], ['jump', 'jump']];

/** CONTRACT_FFA F1: the match mode (core/types.ts MatchMode) */
export type UiMode = MatchMode;

/** a crew's UI palette entry (teams.json `teams[]` or `ffa[]` fields) */
export interface CrewLook {
  id: number; key: string;
  /** teams: the crew name (SUNCREW) · FFA: the colour label for UI chips (an FFA crew's NAME is its runner's) */
  label: string;
  dye: string; dyeDeep: string; dyeGloss: string; ui: string; uiInk: string; markGlyph: string;
}

let ffaCache: CrewLook[] | null = null;
/** the 8 FFA crews (ids 1..8, ascending) — core/data.ts FFA_CREWS (teams.json → ffa) */
export function ffaCrews(): CrewLook[] {
  if (ffaCache) return ffaCache;
  ffaCache = FFA_CREWS.map((c) => ({
    id: c.id, key: c.key, label: c.name.toUpperCase(), dye: c.dye, dyeDeep: c.dyeDeep, dyeGloss: c.dyeGloss, ui: c.ui, uiInk: c.uiInk,
    markGlyph: c.markGlyph,
  }));
  return ffaCache;
}

/** the palette entry of crew `team` in `mode` (teams: the colorblind swap when `colorblind`) */
export function crewLook(team: number, mode: UiMode, colorblind = false): CrewLook {
  if (mode === 'ffa') {
    const all = ffaCrews();
    return all.find((c) => c.id === team) ?? all[Math.max(0, Math.min(7, (team | 0) - 1))];
  }
  const t = teamById((team === 2 ? 2 : 1) as TeamId);
  const cb = colorblind ? (TEAMS_RAW.colorblind as Record<string, { dye?: string; ui?: string }> | undefined)?.[t.key] : undefined;
  return { id: t.id, key: t.key, label: t.name, dye: cb?.dye ?? t.dye, dyeDeep: t.dyeDeep, dyeGloss: t.dyeGloss, ui: cb?.ui ?? t.ui, uiInk: t.uiInk, markGlyph: t.markGlyph };
}

/** one crew on the FFA victory slate / leaderboard */
export interface FfaStanding { team: number; name: string; share: number; you: boolean }
/** the FFA result for the slate: standings sorted best first; `winners` = the crews tied for first (1 = a clear win) */
export interface FfaVictory { standings: FfaStanding[]; winners: number[]; neutral: number }

export const DEATH_PREFIX = 'WASHED BY';
export const SEA_NAME = 'the sea';
export const VICTORY_LINE = 'THE HARBOR CHOSE A COLOR.';
export const PLAY_AGAIN = 'PLAY AGAIN';
export const LOBBY = 'LOBBY';
/** tally timeline (s after the slate shows) */
export const TALLY = { fillFrom: 0.35, fillTo: 1.65, stamp: 1.75, buttons: 0.9 } as const;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** the wave icon used for sea deaths (kill feed + death slate) */
export function waveIcon(cls = 'df-wave'): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 32 20');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M2 13c3.2 0 3.8-4.5 7-4.5s3.8 4.5 7 4.5 3.8-4.5 7-4.5 3.8 4.5 7 4.5M2 18c3.2 0 3.8-3 7-3s3.8 3 7 3 3.8-3 7-3 3.8 3 7 3');
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '2.6');
  p.setAttribute('stroke-linecap', 'round');
  const c = document.createElementNS(ns, 'path');
  c.setAttribute('d', 'M9 8.5c1.5-4.5 6-6.5 10-5-3 .6-4.6 2.8-4.6 5');
  c.setAttribute('fill', 'none');
  c.setAttribute('stroke', 'currentColor');
  c.setAttribute('stroke-width', '2.6');
  c.setAttribute('stroke-linecap', 'round');
  svg.append(c, p);
  return svg;
}

export interface VictoryInfo { sun: number; gulf: number; neutral: number; winner: TeamId; /** CONTRACT_FFA F3: the FFA slate */ ffa?: FfaVictory }

const pct = (f: number): string => `${(Math.max(0, f) * 100).toFixed(1)}%`;

export class Slates {
  readonly root: HTMLElement;
  // countdown
  private readonly count: HTMLElement;
  private readonly countDigits: HTMLElement[] = [];
  private countShown = -1;
  // death
  private readonly death: HTMLElement;
  private readonly deathName: HTMLElement;
  private readonly deathIcon: HTMLElement;
  private readonly deathRing: SVGCircleElement;
  private readonly deathNum: HTMLElement;
  private readonly deathSplat: HTMLElement;
  private deathTotal = 3;
  private deathOn = false;
  private deathLastNum = -1;
  // countdown legend (keyboard rows from main.ts; touch rows built in)
  private readonly legend: HTMLElement;
  private keyRows: ReadonlyArray<readonly [string, string]> = [];
  private touch = false;
  // victory
  private readonly victory: HTMLElement;
  private readonly victoryCard: HTMLElement;
  private readonly vicMark: HTMLElement;
  private readonly vicSun: HTMLElement;
  private readonly vicGulf: HTMLElement;
  private readonly vicSunBox: HTMLElement;
  private readonly vicGulfBox: HTMLElement;
  private readonly vicSunBar: HTMLElement;
  private readonly vicGulfBar: HTMLElement;
  private readonly vicFinal: HTMLElement;
  private readonly vicBtns: HTMLElement;
  private readonly vicBtn: HTMLButtonElement;
  private readonly lobbyBtn: HTMLButtonElement;
  private onAgain: (() => void) | null = null;
  private onLobby: (() => void) | null = null;
  victoryShown = false;
  /** seconds since the victory slate showed (the tally clock) */
  tallyT = -1;
  private tally: { sun: number; gulf: number; winner: TeamId; stamped: boolean; ready: boolean } | null = null;
  // FFA (CONTRACT_FFA F3)
  /** the crews' palette mode (the HUD sets it for its session) */
  mode: UiMode = 'teams';
  private readonly scores: HTMLElement;
  private readonly ffaBody: HTMLElement;
  private readonly ffaWinner: HTMLElement;
  private readonly podium: HTMLElement;
  private readonly standings: HTMLElement;
  private ffaRows: Array<{ row: HTMLElement; fill: HTMLElement; pct: HTMLElement; share: number }> = [];
  private ffaSteps: Array<{ step: HTMLElement; pct: HTMLElement; share: number; h: number }> = [];
  private ffaTally: FfaVictory | null = null;

  constructor(host: HTMLElement) {
    this.root = el('div', 'df-slates');

    // ── countdown 3 · 2 · 1
    this.count = el('div', 'df-count');
    this.count.hidden = true;
    const row = el('div', 'df-count-row');
    [3, 2, 1].forEach((n, i) => {
      if (i > 0) { const dot = el('span', 'dot', '·'); dot.setAttribute('aria-hidden', 'true'); row.append(dot); }
      const d = el('span', 'n', String(n));
      this.countDigits.push(d);
      row.append(d);
    });
    this.legend = el('div', 'df-count-keys');
    this.setLegend([['WASD', 'move'], ['LMB', 'fire'], ['SHIFT', 'slick'], ['SPACE', 'jump']]);
    this.count.append(row, this.legend);

    // ── death slate
    this.death = el('div', 'df-death');
    this.death.hidden = true;
    this.deathSplat = el('div', 'df-death-splat');
    const card = el('div', 'df-death-card');
    const line = el('div', 'df-death-line');
    const by = el('span', 'by', DEATH_PREFIX);
    this.deathIcon = el('span', 'icon');
    this.deathName = el('span', 'name', '');
    line.append(by, this.deathIcon, this.deathName);
    const ring = el('div', 'df-death-ring');
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 80 80');
    svg.setAttribute('aria-hidden', 'true');
    const bg = document.createElementNS(ns, 'circle');
    bg.setAttribute('cx', '40'); bg.setAttribute('cy', '40'); bg.setAttribute('r', '34');
    bg.setAttribute('class', 'bg');
    this.deathRing = document.createElementNS(ns, 'circle');
    this.deathRing.setAttribute('cx', '40'); this.deathRing.setAttribute('cy', '40'); this.deathRing.setAttribute('r', '34');
    this.deathRing.setAttribute('class', 'fg');
    this.deathRing.setAttribute('pathLength', '100');
    svg.append(bg, this.deathRing);
    this.deathNum = el('span', 'num', '3');
    ring.append(svg, this.deathNum);
    card.append(line, ring);
    this.death.append(this.deathSplat, card);

    // ── victory slate
    this.victory = el('div', 'df-victory');
    this.victory.hidden = true;
    const vc = el('div', 'df-victory-card');
    this.victoryCard = vc;
    const title = el('h2', 'df-victory-title', VICTORY_LINE);
    this.vicMark = el('div', 'df-victory-mark');
    this.vicMark.setAttribute('aria-hidden', 'true');
    const scores = el('div', 'df-tally');
    this.scores = scores;
    const sun = teamById(1), gulf = teamById(2);
    const box = (key: 'sun' | 'gulf', mark: string, name: string): [HTMLElement, HTMLElement, HTMLElement] => {
      const b = el('div', `row ${key}`);
      const m = el('i', 'mk', mark); m.setAttribute('aria-hidden', 'true');
      const track = el('div', 'track');
      const fill = el('b', 'fill');
      track.append(fill);
      const v = el('b', 'pct', '0.0%');
      v.setAttribute('aria-hidden', 'true');
      b.append(m, el('span', 'nm', name), track, v);
      return [b, v, fill];
    };
    [this.vicSunBox, this.vicSun, this.vicSunBar] = box('sun', sun.markGlyph, sun.name);
    [this.vicGulfBox, this.vicGulf, this.vicGulfBar] = box('gulf', gulf.markGlyph, gulf.name);
    this.vicFinal = el('p', 'df-sr', '');
    scores.append(this.vicSunBox, this.vicGulfBox);
    this.vicBtns = el('div', 'df-victory-btns');
    this.vicBtn = el('button', 'df-btn df-again', PLAY_AGAIN);
    this.vicBtn.type = 'button';
    this.vicBtn.id = 'df-again';
    this.vicBtn.dataset.nav = '';
    this.vicBtn.addEventListener('click', (e) => { e.stopPropagation(); this.onAgain?.(); });
    this.lobbyBtn = el('button', 'df-btn df-lobby', LOBBY);
    this.lobbyBtn.type = 'button';
    this.lobbyBtn.id = 'df-lobby';
    this.lobbyBtn.dataset.nav = '';
    this.lobbyBtn.addEventListener('click', (e) => { e.stopPropagation(); this.onLobby?.(); });
    this.vicBtns.append(this.vicBtn, this.lobbyBtn);
    // FFA body: the winner line, the top-3 podium and the full standings (filled by showVictory)
    this.ffaBody = el('div', 'df-ffa');
    this.ffaBody.hidden = true;
    this.ffaWinner = el('div', 'df-ffa-winner');
    const cols = el('div', 'df-ffa-cols');
    this.podium = el('div', 'df-podium');
    this.podium.setAttribute('aria-hidden', 'true');
    this.standings = el('ol', 'df-standings');
    cols.append(this.podium, this.standings);
    this.ffaBody.append(this.ffaWinner, cols);
    vc.append(this.vicMark, title, scores, this.ffaBody, this.vicFinal, this.vicBtns);
    this.victory.append(vc);

    this.root.append(this.count, this.death, this.victory);
    host.append(this.root);
  }

  /** the countdown's control legend: [keycap, label] pills (main.ts passes the live bindings) */
  setLegend(rows: ReadonlyArray<readonly [string, string]>): void {
    this.keyRows = rows.map((r) => [r[0], r[1]] as const);
    this.renderLegend();
  }

  /** CONTRACT_MOBILE M4: touch mode → the countdown legend shows the touch buttons' glyphs instead of the keys */
  setTouchMode(on: boolean): void {
    if (this.touch === on) return;
    this.touch = on;
    this.renderLegend();
  }

  private renderLegend(): void {
    this.legend.replaceChildren();
    this.legend.classList.toggle('touch', this.touch);
    if (this.touch) {
      for (const [g, v] of TOUCH_COUNT_LEGEND) {
        const pill = el('span', 'k');
        const i = el('i', 'tg');
        i.innerHTML = GLYPHS[g];
        pill.append(i, el('span', '', v));
        this.legend.append(pill);
      }
      return;
    }
    for (const [k, v] of this.keyRows) {
      const pill = el('span', 'k');
      pill.append(el('b', '', k), el('span', '', v));
      this.legend.append(pill);
    }
  }

  /** the victory slate (the menus' focus scope while it shows) */
  get victoryEl(): HTMLElement { return this.victory; }
  /** the victory card (title + tally + buttons; the winner mark overhangs its top): juice keeps confetti off it */
  get victoryCardEl(): HTMLElement { return this.victoryCard; }

  /** n = ceil(seconds left) while counting down; 0 / negative hides it */
  countdown(n: number): void {
    if (n === this.countShown) return;
    this.countShown = n;
    const on = n >= 1 && n <= 3;
    this.count.hidden = !on;
    if (!on) return;
    [3, 2, 1].forEach((v, i) => {
      const d = this.countDigits[i];
      d.classList.toggle('now', v === n);
      d.classList.toggle('done', v > n);
      if (v === n) { d.classList.remove('pop'); void d.offsetWidth; d.classList.add('pop'); }
    });
  }

  /** WASHED BY {name} (null name = the sea) with a `seconds` countdown ring */
  showDeath(name: string | null, team: TeamId | null, seconds: number): void {
    this.deathTotal = Math.max(0.1, seconds);
    this.deathOn = true;
    this.deathLastNum = -1;
    this.death.hidden = false;
    this.death.classList.remove('in'); void this.death.offsetWidth; this.death.classList.add('in');
    this.death.classList.toggle('sea', name === null);
    const ffa = this.mode === 'ffa' && name !== null && team !== null && team > 0 ? crewLook(team, 'ffa') : null;
    this.death.dataset.team = ffa ? 'ffa' : team === 2 ? 'gulf' : team === 1 ? 'sun' : 'sea';
    if (ffa) this.death.style.setProperty('--splat', ffa.dye); else this.death.style.removeProperty('--splat');
    this.deathIcon.replaceChildren();
    if (name === null) {
      this.deathIcon.append(waveIcon('df-wave big'));
      this.deathName.textContent = SEA_NAME;
    } else {
      const g = el('i', '', ffa ? ffa.markGlyph : teamById(team === 2 ? 2 : 1).markGlyph);
      g.setAttribute('aria-hidden', 'true');
      // FFA: the washer's mark as a crew chip (crew-colour disc, ink ring, cream mark — the crests' look). A bare glyph
      // in the crew colour vanished on its own crew's splat (lime ■ on the lime splat), and the gold name read as SUNFLOWER.
      if (ffa) { g.className = 'chip'; g.style.setProperty('--cu', ffa.ui); }
      this.deathIcon.append(g);
      this.deathName.textContent = name;
    }
    this.updateDeath(seconds);
  }

  updateDeath(left: number): void {
    if (!this.deathOn) return;
    const f = Math.max(0, Math.min(1, left / this.deathTotal));
    this.deathRing.style.strokeDashoffset = String((100 * (1 - f)).toFixed(2));
    const n = Math.max(0, Math.ceil(left - 1e-3));
    if (n !== this.deathLastNum) { this.deathLastNum = n; this.deathNum.textContent = String(n); }
  }

  hideDeath(): void {
    if (!this.deathOn) return;
    this.deathOn = false;
    this.death.hidden = true;
  }

  get deathVisible(): boolean { return this.deathOn; }

  showVictory(v: VictoryInfo, onAgain: () => void, onLobby?: () => void): void {
    this.onAgain = onAgain;
    this.onLobby = onLobby ?? null;
    this.lobbyBtn.hidden = !onLobby;
    this.victoryShown = true;
    this.tallyT = 0;
    const isFfa = !!v.ffa;
    this.scores.hidden = isFfa;
    this.ffaBody.hidden = !isFfa;
    this.victoryCard.classList.toggle('ffa', isFfa);
    this.victory.classList.toggle('ffa', isFfa);
    this.ffaTally = null;
    if (v.ffa) { this.showFfa(v, v.ffa); return; }
    this.tally = { sun: Math.max(0, v.sun), gulf: Math.max(0, v.gulf), winner: v.winner, stamped: false, ready: false };
    this.vicSun.textContent = pct(0);
    this.vicGulf.textContent = pct(0);
    this.vicSunBar.style.width = '0%';
    this.vicGulfBar.style.width = '0%';
    this.vicFinal.textContent = `${teamById(1).name} ${pct(v.sun)} · ${teamById(2).name} ${pct(v.gulf)}`;
    this.vicSunBox.classList.remove('win');
    this.vicGulfBox.classList.remove('win');
    this.vicMark.classList.remove('stamped');
    this.vicBtns.classList.remove('ready');
    this.vicMark.replaceChildren();
    const marks: TeamId[] = v.winner === 1 ? [1] : v.winner === 2 ? [2] : [1, 2];
    for (const t of marks) {
      const m = el('span', t === 1 ? 'sun' : 'gulf', teamById(t).markGlyph);
      this.vicMark.append(m);
    }
    this.victory.dataset.winner = v.winner === 1 ? 'sun' : v.winner === 2 ? 'gulf' : 'draw';
    this.victory.hidden = false;
    this.victory.classList.remove('in'); void this.victory.offsetWidth; this.victory.classList.add('in');
    this.vicBtn.focus({ preventScroll: true });
  }

  /** the tally clock (Hud.update drives it with the frame dt) */
  update(dt: number): void {
    const t = this.tally;
    if (!t || !this.victoryShown) return;
    this.tallyT += Math.max(0, Math.min(0.1, dt));
    if (this.ffaTally) { this.updateFfa(t); return; }
    const u = Math.max(0, Math.min(1, (this.tallyT - TALLY.fillFrom) / (TALLY.fillTo - TALLY.fillFrom)));
    const k = 1 - Math.pow(1 - u, 3);
    // bars compare the crews: the bigger share fills the track, the other is in proportion (numbers are absolute)
    const top = Math.max(t.sun, t.gulf, 1e-6);
    this.vicSunBar.style.width = `${((t.sun / top) * k * 100).toFixed(2)}%`;
    this.vicGulfBar.style.width = `${((t.gulf / top) * k * 100).toFixed(2)}%`;
    this.vicSun.textContent = pct(u >= 1 ? t.sun : t.sun * k);
    this.vicGulf.textContent = pct(u >= 1 ? t.gulf : t.gulf * k);
    if (!t.ready && this.tallyT >= TALLY.buttons) { t.ready = true; this.vicBtns.classList.add('ready'); }
    if (!t.stamped && this.tallyT >= TALLY.stamp) {
      t.stamped = true;
      this.vicSunBox.classList.toggle('win', t.winner === 1);
      this.vicGulfBox.classList.toggle('win', t.winner === 2);
      this.vicMark.classList.add('stamped');
    }
  }

  hideVictory(): void {
    this.victoryShown = false;
    this.victory.hidden = true;
    this.tally = null;
    this.ffaTally = null;
    this.podium.classList.remove('stamped');
    this.tallyT = -1;
  }

  /** text content of the visible slates (harness read-back) */
  text(): { countdown: string | null; death: string | null; victory: string | null; tally: Record<string, unknown> | null } {
    return {
      countdown: this.count.hidden ? null : (this.count.querySelector('.df-count-row')?.textContent ?? null),
      death: this.death.hidden ? null : `${DEATH_PREFIX} ${this.deathName.textContent ?? ''}`,
      // the card's visible parts (the idle mode's body — FFA or teams tally — is hidden and not read back)
      victory: this.victory.hidden ? null : [...this.victoryCard.children].filter((e) => !(e as HTMLElement).hidden).map((e) => e.textContent ?? '').join(''),
      tally: this.victory.hidden ? null : { t: Math.round(this.tallyT * 100) / 100, stamped: this.vicMark.classList.contains('stamped'),
        sun: this.vicSun.textContent, gulf: this.vicGulf.textContent,
        ...(this.ffaTally ? {
          mode: 'ffa', winner: this.ffaWinner.textContent,
          podium: this.ffaSteps.map((s) => s.pct.textContent),
          standings: this.ffaRows.map((r) => ({ text: r.row.textContent, pct: r.pct.textContent, win: r.row.classList.contains('win') })),
        } : {}) },
    };
  }

  // ───────────────────────────── FFA victory (CONTRACT_FFA F3) ─────────────────────────────
  private showFfa(v: VictoryInfo, f: FfaVictory): void {
    const rows = f.standings;
    this.tally = { sun: 0, gulf: 0, winner: v.winner, stamped: false, ready: false };
    this.ffaTally = f;
    const winners = f.winners.length ? f.winners : rows.length ? [rows[0].team] : [];
    const draw = winners.length > 1;
    // the winner line: name + colour chip + mark (every tied crew on a draw)
    this.ffaWinner.replaceChildren();
    winners.forEach((w, i) => {
      const r = rows.find((x) => x.team === w);
      const c = crewLook(w, 'ffa');
      if (i > 0) this.ffaWinner.append(el('span', 'amp', '&'));
      const who = el('span', 'who');
      const mk = el('i', 'mk', c.markGlyph);
      mk.style.background = c.dye;
      mk.setAttribute('aria-hidden', 'true');
      const nm = el('b', '', r?.name ?? c.label);
      who.append(mk, nm, el('span', 'col', c.label));
      this.ffaWinner.append(who);
    });
    this.ffaWinner.classList.toggle('draw', draw);
    this.ffaBody.classList.remove('stamped');
    // the podium: 2nd · 1st · 3rd
    this.podium.replaceChildren();
    this.podium.classList.remove('stamped');
    this.ffaSteps = [];
    for (const rank of [1, 0, 2]) {
      const r = rows[rank];
      const col = el('div', `step-col r${rank + 1}`);
      if (!r) { col.classList.add('empty'); this.podium.append(col); continue; }
      const c = crewLook(r.team, 'ffa');
      const mk = el('i', 'mk', c.markGlyph);
      mk.style.background = c.dye;
      const nm = el('b', `nm${r.you ? ' you' : ''}`, r.name);
      const pctE = el('span', 'pct', pct(0));
      const step = el('div', 'step');
      step.style.setProperty('--c', c.dye);
      step.style.setProperty('--cg', c.dyeGloss);
      step.append(el('span', 'rk', String(rank + 1)));
      col.append(mk, nm, pctE, step);
      this.podium.append(col);
      this.ffaSteps.push({ step, pct: pctE, share: Math.max(0, r.share), h: rank === 0 ? 1 : rank === 1 ? 0.7 : 0.48 });
    }
    // the full standings
    this.standings.replaceChildren();
    this.ffaRows = [];
    rows.forEach((r, i) => {
      const c = crewLook(r.team, 'ffa');
      const li = el('li', `srow${r.you ? ' you' : ''}`);
      li.style.setProperty('--c', c.dye);
      li.style.setProperty('--cg', c.dyeGloss);
      // the winner's % sits on a pill of the crew's UI colour in its ink (≥ 5.8:1 for all 8 crews); crew-coloured text
      // on the cream card was 1.2–3.1:1 (sunflower / lime / jade unreadable)
      li.style.setProperty('--cu', c.ui);
      li.style.setProperty('--ci', c.uiInk);
      li.dataset.team = String(r.team);
      const mk = el('i', 'mk', c.markGlyph);
      mk.setAttribute('aria-hidden', 'true');
      const track = el('div', 'track');
      const fill = el('b', 'fill');
      track.append(fill);
      const pctE = el('b', 'pct', pct(0));
      li.append(el('span', 'rk', String(i + 1)), mk, el('span', 'nm', r.name), track, pctE);
      this.standings.append(li);
      this.ffaRows.push({ row: li, fill, pct: pctE, share: Math.max(0, r.share) });
    });
    this.vicFinal.textContent = rows.map((r, i) => `${i + 1}. ${r.name} ${pct(r.share)}`).join(' · ');
    this.vicMark.classList.remove('stamped');
    this.vicBtns.classList.remove('ready');
    this.vicMark.replaceChildren();
    for (const w of winners.slice(0, 3)) {
      const c = crewLook(w, 'ffa');
      const m = el('span', 'ffa', c.markGlyph);
      m.style.background = c.dye;
      this.vicMark.append(m);
    }
    this.victory.dataset.winner = draw ? 'draw' : 'ffa';
    this.victory.style.setProperty('--win', crewLook(winners[0] ?? 1, 'ffa').dye);
    this.updateFfa(this.tally);
    this.victory.hidden = false;
    this.victory.classList.remove('in'); void this.victory.offsetWidth; this.victory.classList.add('in');
    this.vicBtn.focus({ preventScroll: true });
  }

  private updateFfa(t: { stamped: boolean; ready: boolean }): void {
    const f = this.ffaTally;
    if (!f) return;
    const u = Math.max(0, Math.min(1, (this.tallyT - TALLY.fillFrom) / (TALLY.fillTo - TALLY.fillFrom)));
    const k = 1 - Math.pow(1 - u, 3);
    let top = 1e-6;
    for (const r of this.ffaRows) top = Math.max(top, r.share);
    for (const r of this.ffaRows) {
      r.fill.style.width = `${((r.share / top) * k * 100).toFixed(2)}%`;
      r.pct.textContent = pct(u >= 1 ? r.share : r.share * k);
    }
    for (const s of this.ffaSteps) {
      s.step.style.setProperty('--h', (s.h * k).toFixed(3));
      s.pct.textContent = pct(u >= 1 ? s.share : s.share * k);
    }
    if (!t.ready && this.tallyT >= TALLY.buttons) { t.ready = true; this.vicBtns.classList.add('ready'); }
    if (!t.stamped && this.tallyT >= TALLY.stamp) {
      t.stamped = true;
      const win = new Set(f.winners);
      for (const r of this.ffaRows) r.row.classList.toggle('win', win.has(Number(r.row.dataset.team)));
      this.podium.classList.add('stamped');
      this.ffaBody.classList.add('stamped');
      this.vicMark.classList.add('stamped');
    }
  }
}
