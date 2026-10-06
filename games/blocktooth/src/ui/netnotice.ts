// BLOCKTOOTH ONLINE VS — in-match network notices + overlays (lane O-LOBBY).
//
//   notices   a small stack under the phase strip: "HOST LEFT — YOU ARE NOW RUNNING THE CLOCK", "A BOT TOOK YOUR SEAT",
//             "YOU TOOK OVER A BOT — MOLO", "HIGH PING 240 MS …" (same key replaces its line)
//   chip      LAGGING while late frames pile up
//   overlays  CONNECTION LOST (reconnecting), CONNECTION PROBLEM (the game fell out of step: a bot has the seat, LEAVE),
//             CATCHING UP (a replay join / a tab that was hidden), LEAVE THE MATCH? (the match does NOT pause behind it)
//
// Pure DOM, driven by the app (online.ts hooks). The sim is never touched.

import './lobby.css';
import { VS as STR_VS } from '../data/strings_vs.ts';
import type { Connection, Notice } from '../online.ts';
import { clearEl, div, el, keyChip, onTap } from './dom.ts';

const N = STR_VS.notice;
const MAX_LINES = 4;

interface Line { key: string; node: HTMLElement; until: number }

export class NetNotices {
  /** LEAVE pressed in an overlay / the leave confirm */
  onLeave: (() => void) | null = null;
  private readonly layer: HTMLDivElement;
  private readonly stack: HTMLDivElement;
  private readonly chip: HTMLDivElement;
  private readonly lost: HTMLDivElement;
  private readonly desync: HTMLDivElement;
  private readonly catchup: HTMLDivElement;
  private readonly catchBar: HTMLElement;
  private readonly leaveBox: HTMLDivElement;
  private lines: Line[] = [];
  private shown = false;
  private leaveOpen = false;

  constructor(root: HTMLElement) {
    const L = this.layer = div('bt-layer bt-vsnet bt-hidden', root);
    L.dataset.v2 = 'vs-net';
    this.stack = div('bt-vsnet-stack', L);
    this.chip = div('bt-vsnet-chip bt-hidden', L, 'LAGGING');

    this.lost = div('bt-vsnet-ovl lost bt-hidden', L);
    const lb = div('bt-vsnet-card', this.lost);
    lb.appendChild(el('b', '', N.reconnecting));
    lb.appendChild(this.btn(STR_VS.online.leave, 'ESC', () => this.leaveNow(), 'bt-btn-ghost'));

    this.desync = div('bt-vsnet-ovl desync bt-hidden', L);
    const db = div('bt-vsnet-card bad', this.desync);
    db.appendChild(el('b', '', N.desyncTitle));
    db.appendChild(el('span', '', N.desyncSub));
    db.appendChild(this.btn(STR_VS.online.leave, 'ESC', () => this.leaveNow(), 'bt-btn-coral'));

    this.catchup = div('bt-vsnet-ovl catchup bt-hidden', L);
    const cb = div('bt-vsnet-card', this.catchup);
    cb.appendChild(el('b', '', N.catchingUp));
    const bar = div('bt-vsnet-bar', cb);
    this.catchBar = el('i');
    bar.appendChild(this.catchBar);

    this.leaveBox = div('bt-vsnet-ovl leave bt-hidden', L);
    const kb = div('bt-vsnet-card', this.leaveBox);
    kb.appendChild(el('b', '', N.leaveTitle));
    kb.appendChild(el('span', '', N.leaveSub));
    const row = div('bt-vsnet-row', kb);
    row.appendChild(this.btn(N.leaveNo, 'ESC', () => this.closeLeave(), 'bt-btn-ghost'));
    row.appendChild(this.btn(N.leaveYes, 'ENTER', () => this.leaveNow(), 'bt-btn-coral'));
    kb.appendChild(el('small', '', N.leaveHint));
  }

  private btn(label: string, key: string, fn: () => void, cls: string): HTMLButtonElement {
    const b = el('button', 'bt-btn ' + cls);
    b.type = 'button'; b.tabIndex = -1;
    b.appendChild(el('span', '', label));
    b.appendChild(keyChip(key, cls.includes('coral') ? 'dark' : ''));
    onTap(b, fn);
    return b;
  }

  show(on: boolean): void {
    this.shown = on;
    this.layer.classList.toggle('bt-hidden', !on);
    if (!on) this.clear();
  }

  clear(): void {
    this.lines = [];
    clearEl(this.stack);
    this.chip.classList.add('bt-hidden');
    this.lost.classList.add('bt-hidden');
    this.desync.classList.add('bt-hidden');
    this.catchup.classList.add('bt-hidden');
    this.leaveBox.classList.add('bt-hidden');
    this.leaveOpen = false;
  }

  push(n: Notice): void {
    if (!this.shown) return;
    const now = performance.now();
    let line = this.lines.find((l) => l.key === n.key);
    if (!line) {
      const node = div('bt-vsnet-line ' + n.tone, this.stack);
      line = { key: n.key, node, until: 0 };
      this.lines.push(line);
      while (this.lines.length > MAX_LINES) { const o = this.lines.shift(); if (o) o.node.remove(); }
    }
    line.node.className = 'bt-vsnet-line ' + n.tone;
    line.node.textContent = n.text;
    line.until = now + n.ttlMs;
    line.node.dataset.key = n.key;
  }

  /** the lines expire */
  update(): void {
    if (!this.lines.length) return;
    const now = performance.now();
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      if (now > l.until) { l.node.remove(); this.lines.splice(i, 1); }
      else if (now > l.until - 500) l.node.classList.add('fade');
    }
  }

  setConnection(c: Connection): void {
    this.chip.classList.toggle('bt-hidden', c !== 'lagging');
    this.lost.classList.toggle('bt-hidden', c !== 'lost');
    this.desync.classList.toggle('bt-hidden', c !== 'desynced');
    this.catchup.classList.toggle('bt-hidden', c !== 'catchup');
  }

  setCatchup(frac: number): void {
    this.catchBar.style.transform = 'scaleX(' + Math.max(0.02, Math.min(1, frac)).toFixed(3) + ')';
  }

  get leaveAsked(): boolean { return this.leaveOpen; }

  askLeave(): void {
    if (!this.shown) return;
    this.leaveOpen = true;
    this.leaveBox.classList.remove('bt-hidden');
  }

  closeLeave(): void {
    this.leaveOpen = false;
    this.leaveBox.classList.add('bt-hidden');
  }

  private leaveNow(): void {
    this.leaveOpen = false;
    this.leaveBox.classList.add('bt-hidden');
    if (this.onLeave) this.onLeave();
  }
}
