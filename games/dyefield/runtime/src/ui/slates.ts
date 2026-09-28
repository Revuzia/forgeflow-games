// DYEFIELD — full-screen match slates (CONTRACT §11 HUD): the 3 · 2 · 1 countdown (with a control legend
// from the live bindings), the death slate `WASHED BY {name}` with a 3 s ring, and the victory slate
// `THE HARBOR CHOSE A COLOR.` with both crews' percentages, the winning crew's mark, PLAY AGAIN and LOBBY.
// Phase 9 (CONTRACT_P6_11 §20/§21): the victory slate runs a coverage TALLY — both crew bars fill while the
// numbers count up (0.35–1.65 s; the bigger share fills its track, the other in proportion; the numbers are the
// absolute weighted coverage), then the winner's mark STAMPS (1.75 s); the buttons are live from the start
// (a click skips the show). The final percentages are always in the slate's text (a visually hidden line),
// so a read-back mid-count still sees them. Only the brief's strings are shown (DESIGN §1); names come from
// the roster, crew names / marks from data/teams.json.

import { teamById } from '../core/data.ts';
import type { TeamId } from '../core/types.ts';

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

export interface VictoryInfo { sun: number; gulf: number; neutral: number; winner: TeamId }

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
  // countdown legend
  private readonly legend: HTMLElement;
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
    vc.append(this.vicMark, title, scores, this.vicFinal, this.vicBtns);
    this.victory.append(vc);

    this.root.append(this.count, this.death, this.victory);
    host.append(this.root);
  }

  /** the countdown's control legend: [keycap, label] pills (main.ts passes the live bindings) */
  setLegend(rows: ReadonlyArray<readonly [string, string]>): void {
    this.legend.replaceChildren();
    for (const [k, v] of rows) {
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
    this.death.dataset.team = team === 2 ? 'gulf' : team === 1 ? 'sun' : 'sea';
    this.deathIcon.replaceChildren();
    if (name === null) {
      this.deathIcon.append(waveIcon('df-wave big'));
      this.deathName.textContent = SEA_NAME;
    } else {
      const g = el('i', '', teamById(team === 2 ? 2 : 1).markGlyph);
      g.setAttribute('aria-hidden', 'true');
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
    this.tallyT = -1;
  }

  /** text content of the visible slates (harness read-back) */
  text(): { countdown: string | null; death: string | null; victory: string | null; tally: Record<string, unknown> | null } {
    return {
      countdown: this.count.hidden ? null : (this.count.querySelector('.df-count-row')?.textContent ?? null),
      death: this.death.hidden ? null : `${DEATH_PREFIX} ${this.deathName.textContent ?? ''}`,
      victory: this.victory.hidden ? null : (this.victory.textContent ?? ''),
      tally: this.victory.hidden ? null : { t: Math.round(this.tallyT * 100) / 100, stamped: this.vicMark.classList.contains('stamped'),
        sun: this.vicSun.textContent, gulf: this.vicGulf.textContent },
    };
  }
}
