// DYEFIELD — full-screen match slates (CONTRACT §11 HUD): the 3 · 2 · 1 countdown, the death slate
// `WASHED BY {name}` with a 3 s ring, and the victory slate `THE HARBOR CHOSE A COLOR.` with both
// crews' percentages, the winning crew's mark and PLAY AGAIN. Only the brief's strings are shown
// (DESIGN §1); names come from the roster, crew names / marks from data/teams.json.

import { teamById } from '../core/data.ts';
import type { TeamId } from '../core/types.ts';

export const DEATH_PREFIX = 'WASHED BY';
export const SEA_NAME = 'the sea';
export const VICTORY_LINE = 'THE HARBOR CHOSE A COLOR.';
export const PLAY_AGAIN = 'PLAY AGAIN';

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
  // victory
  private readonly victory: HTMLElement;
  private readonly vicMark: HTMLElement;
  private readonly vicSun: HTMLElement;
  private readonly vicGulf: HTMLElement;
  private readonly vicSunBox: HTMLElement;
  private readonly vicGulfBox: HTMLElement;
  private readonly vicBtn: HTMLButtonElement;
  private onAgain: (() => void) | null = null;
  victoryShown = false;

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
    const legend = el('div', 'df-count-keys');
    for (const [k, v] of [['WASD', 'move'], ['LMB', 'fire'], ['SHIFT', 'slick'], ['SPACE', 'jump']]) {
      const pill = el('span', 'k');
      pill.append(el('b', '', k), el('span', '', v));
      legend.append(pill);
    }
    this.count.append(row, legend);

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
    const title = el('h2', 'df-victory-title', VICTORY_LINE);
    this.vicMark = el('div', 'df-victory-mark');
    this.vicMark.setAttribute('aria-hidden', 'true');
    const scores = el('div', 'df-victory-scores');
    const sun = teamById(1), gulf = teamById(2);
    const box = (key: 'sun' | 'gulf', mark: string, name: string): [HTMLElement, HTMLElement] => {
      const b = el('div', `score ${key}`);
      const m = el('i', '', mark); m.setAttribute('aria-hidden', 'true');
      const v = el('b', '', '0.0%');
      b.append(m, v, el('span', '', name));
      return [b, v];
    };
    [this.vicSunBox, this.vicSun] = box('sun', sun.markGlyph, sun.name);
    [this.vicGulfBox, this.vicGulf] = box('gulf', gulf.markGlyph, gulf.name);
    scores.append(this.vicSunBox, this.vicGulfBox);
    this.vicBtn = el('button', 'df-btn df-again', PLAY_AGAIN);
    this.vicBtn.type = 'button';
    this.vicBtn.id = 'df-again';
    this.vicBtn.addEventListener('click', (e) => { e.stopPropagation(); this.onAgain?.(); });
    vc.append(this.vicMark, title, scores, this.vicBtn);
    this.victory.append(vc);

    this.root.append(this.count, this.death, this.victory);
    host.append(this.root);
  }

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

  showVictory(v: VictoryInfo, onAgain: () => void): void {
    this.onAgain = onAgain;
    this.victoryShown = true;
    this.vicSun.textContent = pct(v.sun);
    this.vicGulf.textContent = pct(v.gulf);
    this.vicSunBox.classList.toggle('win', v.winner === 1);
    this.vicGulfBox.classList.toggle('win', v.winner === 2);
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

  hideVictory(): void {
    this.victoryShown = false;
    this.victory.hidden = true;
  }

  /** text content of the visible slates (harness read-back) */
  text(): { countdown: string | null; death: string | null; victory: string | null } {
    return {
      countdown: this.count.hidden ? null : (this.count.querySelector('.df-count-row')?.textContent ?? null),
      death: this.death.hidden ? null : `${DEATH_PREFIX} ${this.deathName.textContent ?? ''}`,
      victory: this.victory.hidden ? null : (this.victory.textContent ?? ''),
    };
  }
}
