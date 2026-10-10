// GENESIS — the god hand under the mouse (CONTRACT.md §11.4, §1.4 "a visible hand that grabs, throws, slaps,
// strokes"). No tool armed, the left button IS the hand:
//   press on someone and drag (or hold still ~0.4 s)     → grab: they come with the hand; let go with a flick to
//                                                          THROW (velocity from the mouse's motion over the ground),
//                                                          or slowly to set them down there
//   press on someone and rub back and forth             → STROKE (comfort, heal, reward the creature)
//   slap modifier (Alt, rebindable) + click on someone  → SLAP (punish); on the held thing while it is held
//   press on bare ground and drag                        → the camera (grab the land and turn it)
//   long press on bare ground                            → the radial menu
//   quick click                                          → select / inspect (the App)
// Keys: E takes what is under the cursor / sets the held thing down; ⇧E AIMS: the hand stops where it is, an arc runs
// from it to the cursor, and letting go of E throws along it (a click throws at the click, Esc puts the aim away);
// B slaps, N strokes.
//
// Timing is read from the events themselves (PointerEvent.timeStamp, and the coalesced samples between frames), never
// from when a handler happened to run: on a machine that hitches, a flick still throws, a rub still strokes, and a
// slow click on a person still opens the inspector.
//
// Until the hand has a body in the world (the render lane's hand.ts), the interface shows it: the cursor takes the
// hand's pose (open over someone it can take, closed while carrying, a pointing hand with a power armed, a crosshair
// while aiming), a badge at the pointer names what it carries and how high ("Kek ↑ 9 m"), and the hint over someone
// names them ("Kek, child — drag: grab …"). The hand's place in the world follows the cursor (hand.move: often while
// carrying, sparingly otherwise — every hand move is a logged command).

import type { EntityRef, UnitVec } from '../sim/types.ts';
import type { GroundHit, UiHost } from './host.ts';
import type { Catalog } from './catalog.ts';
import { h } from './dom.ts';

export type PressOwner = 'hand' | 'camera';

interface Sample { t: number; dir: UnitVec; planet: number }

/** one pointer sample: position and its event time */
export interface PtrSample { x: number; y: number; t: number }

const GRAB_KINDS = new Set(['agent', 'animal', 'building', 'creature', 'item']);
/** hold still this long on someone to pick them up (a slower click than this is a click) */
const HOLD_MS = 400;
/** a release this soon after the last motion is a flick */
const FLICK_MS = 120;

/** the cursor's pose (body[data-hand]; styles.css draws a hand for each) */
export type HandCursor = 'none' | 'open' | 'carry' | 'press' | 'tool' | 'aim' | 'slap';

export class HandInput {
  private host: UiHost;
  private catalog: Catalog;
  private state: 'idle' | 'press' | 'carry' | 'rub' | 'ground' = 'idle';
  private target: EntityRef | null = null;
  private downX = 0;
  private downY = 0;
  private downT = 0;
  private path = 0;
  private lastX = 0;
  private lastY = 0;
  private trail: PtrSample[] = [];
  private samples: Sample[] = [];
  private lastMoveSent = 0;
  private lastMoveDir: UnitVec | null = null;
  private lastStroke = 0;
  private slapping = false;
  private longPressFired = false;
  /** ⇧E: aiming a throw (the hand holds still; the arc runs to the cursor) */
  private aiming = false;
  /** what the pointer rests on (a person, a herd…): the hint names it, the App rings it */
  hoverRef: EntityRef | null = null;
  /** a long press on bare ground: open the radial there */
  onLongPress: ((x: number, y: number) => void) | null = null;
  /** tells whether the slap modifier is held in a pointer event */
  slapMod: (e: PointerEvent | MouseEvent) => boolean = (e) => e.altKey;
  readonly hint: HTMLDivElement;
  readonly badge: HTMLDivElement;
  private arc: SVGSVGElement;
  private arcPath: SVGPathElement;
  private arcEnd: SVGCircleElement;
  private cursorPose: HandCursor = 'none';

  constructor(worldLayer: HTMLElement, host: UiHost, catalog: Catalog) {
    this.host = host;
    this.catalog = catalog;
    this.hint = h('div', { class: 'gn-handhint' });
    this.hint.hidden = true;
    this.badge = h('div', { class: 'gn-handbadge' });
    this.badge.hidden = true;
    const ns = 'http://www.w3.org/2000/svg';
    this.arc = document.createElementNS(ns, 'svg') as SVGSVGElement;
    this.arc.setAttribute('class', 'gn-aim-svg');
    this.arcPath = document.createElementNS(ns, 'path') as SVGPathElement;
    this.arcEnd = document.createElementNS(ns, 'circle') as SVGCircleElement;
    this.arcEnd.setAttribute('r', '7');
    this.arc.append(this.arcPath, this.arcEnd);
    this.arc.style.display = 'none';
    worldLayer.append(this.arc, this.hint, this.badge);
  }

  /** what the hand holds now (the sim's word) */
  held(): EntityRef | null { return this.host.view.hand?.held ?? null; }

  get busy(): boolean { return this.state === 'carry' || this.state === 'rub' || this.state === 'press' || this.aiming; }
  get isAiming(): boolean { return this.aiming; }

  /** a left press with no tool armed: does the hand take it, or the camera? */
  down(x: number, y: number, e: PointerEvent | { altKey: boolean; ctrlKey: boolean; shiftKey: boolean; metaKey: boolean }, t = performance.now()): PressOwner {
    if (this.aiming) { void this.releaseAim([x, y]); this.state = 'idle'; return 'hand'; }
    this.downX = this.lastX = x; this.downY = this.lastY = y; this.downT = t;
    this.path = 0;
    this.trail = [{ x, y, t }];
    this.samples = [];
    this.longPressFired = false;
    this.slapping = this.slapMod(e as PointerEvent);
    const held = this.held();
    if (held) {
      // the hand is full: a flick throws it, a click sets it down, the slap modifier slaps it
      this.state = this.slapping ? 'press' : 'carry';
      this.target = held;
      this.sample(x, y, t);
      return 'hand';
    }
    const ent = this.host.entityAt(x, y);
    if (ent && GRAB_KINDS.has(ent.kind)) {
      this.state = 'press';
      this.target = ent;
      return 'hand';
    }
    this.state = 'ground';
    this.target = null;
    return 'camera';
  }

  /** the pointer moved; `pts` are the coalesced samples since the last move (each with its event time) */
  move(x: number, y: number, t = performance.now(), pts: PtrSample[] | null = null): void {
    const list = pts && pts.length ? pts : [{ x, y, t }];
    for (const q of list) {
      this.path += Math.hypot(q.x - this.lastX, q.y - this.lastY);
      this.lastX = q.x; this.lastY = q.y;
      this.trail.push(q);
      if (this.state === 'carry') this.sample(q.x, q.y, q.t);
    }
    const now = list[list.length - 1].t;
    while (this.trail.length > 2 && now - this.trail[0].t > 800) this.trail.shift();
    if (this.state === 'press' && !this.slapping) {
      const disp = Math.hypot(x - this.downX, y - this.downY);
      // rubbing: lots of motion that stays put
      if (this.isRub()) { this.state = 'rub'; this.lastStroke = now; void this.stroke(this.target); return; }
      if (disp > 26 && this.path < disp * 1.9) void this.grab(x, y);
    } else if (this.state === 'rub') {
      if (this.isRub() && now - this.lastStroke > 900) { this.lastStroke = now; void this.stroke(this.target); }
    }
    if (this.state === 'carry') this.sendMove(x, y, true);
  }

  private isRub(): boolean {
    const tr = this.trail;
    if (tr.length < 6) return false;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, len = 0;
    for (let i = 0; i < tr.length; i++) {
      x0 = Math.min(x0, tr[i].x); y0 = Math.min(y0, tr[i].y); x1 = Math.max(x1, tr[i].x); y1 = Math.max(y1, tr[i].y);
      if (i) len += Math.hypot(tr[i].x - tr[i - 1].x, tr[i].y - tr[i - 1].y);
    }
    const box = Math.hypot(x1 - x0, y1 - y0);
    // back and forth: the path is several times the span, the span stays small (on the person)
    return len > 110 && box < 80 && len > box * 2.6;
  }

  /**
   * Per frame: hold still on someone to pick them up; long press on the ground for the radial; the hand follows; the
   * cursor, the badge, the aim arc. (Input events are dispatched before the frame, so a release that happened is known
   * here; the hold is measured from the press's own event time.)
   */
  frame(pointer: [number, number] | null, toolArmed = false): void {
    const now = performance.now();
    if (this.state === 'press' && !this.slapping && this.path < 10 && now - this.downT > HOLD_MS) void this.grab(this.lastX, this.lastY);
    if (this.state === 'ground' && !this.longPressFired && this.path < 8 && now - this.downT > 620 && this.onLongPress) {
      this.longPressFired = true;
      this.onLongPress(this.downX, this.downY);
    }
    if (this.state === 'idle' && pointer && !this.aiming && !toolArmed) this.sendMove(pointer[0], pointer[1], !!this.held());
    this.updateHint(pointer, toolArmed);
    this.updateBadge(pointer);
    this.updateAim(pointer);
    this.setCursor(this.aiming ? 'aim' : toolArmed ? 'tool' : this.state === 'carry' || (this.held() && this.state !== 'press') ? 'carry'
      : this.state === 'press' || this.state === 'rub' ? (this.slapping ? 'slap' : 'press') : this.hoverRef ? 'open' : 'none');
  }

  /** the press ended; returns 'click' when it was a plain click the App should treat as select / inspect */
  up(x: number, y: number, t = performance.now()): 'click' | 'done' | 'longpress' {
    const st = this.state, tgt = this.target;
    this.state = 'idle';
    this.target = null;
    if (st === 'ground') return this.longPressFired ? 'longpress' : this.path < 6 ? 'click' : 'done';
    if (st === 'press') {
      if (this.slapping && tgt) { void this.slap(tgt); return 'done'; }
      return 'click';
    }
    if (st === 'rub') return 'done';
    if (st === 'carry') { void this.letGo(x, y, t); return 'done'; }
    return 'done';
  }

  /** the press was taken away (Escape, focus loss) */
  cancel(): void { this.state = 'idle'; this.target = null; this.cancelAim(); }

  private sample(x: number, y: number, t: number): void {
    const g = this.host.groundAt(x, y);
    if (!g) return;
    this.samples.push({ t, dir: g.dir, planet: g.planet });
    while (this.samples.length > 2 && t - this.samples[0].t > 400) this.samples.shift();
  }

  private sendMove(x: number, y: number, carrying: boolean): void {
    const now = performance.now();
    if (now - this.lastMoveSent < (carrying ? 90 : 400)) return;
    const g = this.host.groundAt(x, y);
    if (!g) return;
    const pv = this.host.view.planet(g.planet);
    const R = pv?.params.radius ?? 3000;
    const l = this.lastMoveDir;
    const moved = l ? Math.acos(Math.min(1, l[0] * g.dir[0] + l[1] * g.dir[1] + l[2] * g.dir[2])) * R : Infinity;
    if (moved < (carrying ? 0.5 : 12)) return;
    this.lastMoveSent = now;
    this.lastMoveDir = g.dir;
    void this.host.cmd({ k: 'hand.move', planet: g.planet, pos: g.dir, alt: carrying ? 9 : 6 }, { quiet: true });
  }

  // ───────────────────────────── acts ─────────────────────────────

  private async grab(x: number, y: number): Promise<void> {
    const t = this.target;
    if (!t || this.state === 'carry') return;
    this.state = 'carry';
    const g = this.host.groundAt(this.downX, this.downY) ?? this.host.groundAt(x, y);
    const planet = t.planet ?? g?.planet ?? this.host.primary();
    const r = await this.host.cmd({ k: 'hand.grab', planet, target: { kind: t.kind, id: t.id }, ...(g ? { pos: g.dir } : {}) });
    if (!r.ok) { this.state = this.state === 'carry' ? 'ground' : this.state; return; }
    this.sample(x, y, performance.now());
  }

  /** let go at the end of a carry: a flick throws, a slow release sets down (times are the events' own) */
  private async letGo(x: number, y: number, tUp: number): Promise<void> {
    const g = this.host.groundAt(x, y);
    const s = this.samples;
    let i = s.length - 1;
    const b = s[s.length - 1];
    while (i > 0 && b && b.t - s[i - 1].t < 140) i--;
    const a = s[i];
    let vel: [number, number, number] | null = null;
    if (a && b && b !== a && a.planet === b.planet) {
      const pv = this.host.view.planet(b.planet);
      const R = pv?.params.radius ?? 3000;
      const dt = Math.max(0.03, (b.t - a.t) / 1000);
      // tangent motion at the release point, metres per second of the hand
      const d = [b.dir[0] - a.dir[0], b.dir[1] - a.dir[1], b.dir[2] - a.dir[2]];
      const up = b.dir;
      const dn = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
      const tx = (d[0] - up[0] * dn) * R / dt, ty = (d[1] - up[1] * dn) * R / dt, tz = (d[2] - up[2] * dn) * R / dt;
      const sp = Math.hypot(tx, ty, tz);
      // the god's arm: a quarter of the hand's speed over the ground, up to 90 m/s (a hard flick lands a few hundred
      // metres off, never near escape speed even on the smallest worlds), thrown upward at ~27°
      const speed = Math.min(90, sp * 0.25);
      // a quick, real flick throws (the release came right after the motion, by the events' clock); a slow drift sets down
      if (speed > 6 && tUp - b.t < FLICK_MS) {
        const k = speed / sp;
        vel = [tx * k + up[0] * speed * 0.5, ty * k + up[1] * speed * 0.5, tz * k + up[2] * speed * 0.5];
      }
    }
    const planet = b?.planet ?? g?.planet ?? this.host.primary();
    if (vel) await this.host.cmd({ k: 'hand.release', planet, vel });
    else await this.host.cmd({ k: 'hand.place', planet, ...(g ? { pos: g.dir } : {}) });
  }

  async stroke(t: EntityRef | null): Promise<void> {
    const g = this.host.groundAt(this.lastX, this.lastY);
    const planet = t?.planet ?? g?.planet ?? this.host.primary();
    await this.host.cmd({ k: 'hand.stroke', planet, ...(t ? { target: { kind: t.kind, id: t.id } } : {}), ...(g ? { pos: g.dir } : {}) });
  }

  async slap(t: EntityRef | null): Promise<void> {
    const g = this.host.groundAt(this.lastX, this.lastY);
    const planet = t?.planet ?? g?.planet ?? this.host.primary();
    await this.host.cmd({ k: 'hand.slap', planet, ...(t ? { target: { kind: t.kind, id: t.id } } : {}), ...(g ? { pos: g.dir } : {}) });
  }

  // ───────────────────────────── keys ─────────────────────────────

  /** E: take what is under the cursor, or set the held thing down there */
  async take(pointer: [number, number] | null): Promise<void> {
    if (this.aiming) { this.cancelAim(); }
    const g = pointer ? this.host.groundAt(pointer[0], pointer[1]) : this.host.focusGround();
    const planet = g?.planet ?? this.host.primary();
    if (this.held()) { await this.host.cmd({ k: 'hand.place', planet, ...(g ? { pos: g.dir } : {}) }); return; }
    const ent = pointer ? this.host.entityAt(pointer[0], pointer[1]) : null;
    if (ent && GRAB_KINDS.has(ent.kind)) await this.host.cmd({ k: 'hand.grab', planet: ent.planet ?? planet, target: { kind: ent.kind, id: ent.id }, ...(g ? { pos: g.dir } : {}) });
    else await this.host.cmd({ k: 'hand.grab', planet, ...(g ? { pos: g.dir } : {}), radius: 80 });
  }

  /** ⇧E pressed: hold the hand where it is and aim (the throw happens when E is let go, or at a click) */
  beginAim(): boolean {
    if (!this.held()) { this.host.toast({ text: 'The hand holds nothing to throw (E takes what is under it).', kind: 'info' }); return false; }
    this.aiming = true;
    return true;
  }

  /** E let go while aiming (or a click): throw toward the cursor's ground from where the hand holds still */
  async releaseAim(pointer: [number, number] | null): Promise<void> {
    if (!this.aiming) return;
    this.aiming = false;
    this.arc.style.display = 'none';
    const hand = this.host.view.hand;
    const g = pointer ? this.host.groundAt(pointer[0], pointer[1]) : this.host.focusGround();
    if (!hand || !this.held()) return;
    const planet = hand.planet;
    const R = this.host.view.planet(planet)?.params.radius ?? 3000;
    const far = g && g.planet === planet ? Math.acos(Math.min(1, g.dir[0] * hand.pos[0] + g.dir[1] * hand.pos[1] + g.dir[2] * hand.pos[2])) * R : 0;
    // aimed at the hand's own spot: a toss straight ahead of the camera instead of a drop
    if (!g || far < 3) { await this.host.cmd({ k: 'hand.throw', planet, speed: 25 }); return; }
    await this.host.cmd({ k: 'hand.throw', planet, toward: g.dir });
  }

  cancelAim(): void {
    if (!this.aiming) return;
    this.aiming = false;
    this.arc.style.display = 'none';
  }

  /** ⇧E with no key-up to come (the pad, the palette): throw toward the cursor now, from where the hand is */
  async throwAt(pointer: [number, number] | null): Promise<void> {
    if (!this.beginAim()) return;
    await this.releaseAim(pointer);
  }

  /** B / N: slap or stroke what is held, else what is under the cursor */
  async keyAct(slap: boolean, pointer: [number, number] | null): Promise<void> {
    const held = this.held();
    const ent = held ?? (pointer ? this.host.entityAt(pointer[0], pointer[1]) : null);
    if (pointer) { this.lastX = pointer[0]; this.lastY = pointer[1]; }
    if (slap) await this.slap(ent); else await this.stroke(ent);
  }

  // ───────────────────────────── what shows ─────────────────────────────

  private setCursor(c: HandCursor): void {
    if (c === this.cursorPose) return;
    this.cursorPose = c;
    document.body.dataset.hand = c;
  }

  /** the arc of an aimed throw: from the hand (held still) to the cursor */
  private updateAim(pointer: [number, number] | null): void {
    const hand = this.host.view.hand;
    if (!this.aiming || !pointer || !hand) { if (this.arc.style.display !== 'none') this.arc.style.display = 'none'; return; }
    if (!this.held()) { this.cancelAim(); return; }
    const a = this.host.screenOf(hand.planet, hand.pos, hand.alt);
    if (!a) { this.arc.style.display = 'none'; return; }
    const b = pointer;
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 - Math.min(220, 40 + dist * 0.45);
    this.arc.style.display = '';
    this.arcPath.setAttribute('d', `M${a[0].toFixed(1)} ${a[1].toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`);
    this.arcEnd.setAttribute('cx', b[0].toFixed(1));
    this.arcEnd.setAttribute('cy', b[1].toFixed(1));
  }

  /** what the hand carries, at the pointer: "Kek ↑ 9 m" */
  private updateBadge(pointer: [number, number] | null): void {
    const held = this.held();
    const hand = this.host.view.hand;
    if (!held || !hand) { if (!this.badge.hidden) this.badge.hidden = true; return; }
    const name = this.catalog.nameOf(held) ?? (held.kind === 'agent' ? 'someone' : held.kind === 'animal' ? 'an animal' : `a ${held.kind}`);
    const text = `${name} ↑ ${Math.max(0, Math.round(hand.alt))} m${this.aiming ? ' · let go of the key to throw' : ''}`;
    if (this.badge.textContent !== text) this.badge.textContent = text;
    // at the pointer while it is on the world; else where the hand is
    let at = pointer;
    if (!at) at = this.host.screenOf(hand.planet, hand.pos, hand.alt);
    if (!at) { this.badge.hidden = true; return; }
    this.badge.hidden = false;
    this.badge.style.transform = `translate(${(at[0] + 16).toFixed(1)}px, ${(at[1] - 30).toFixed(1)}px)`;
  }

  private hintAt = 0;
  private updateHint(pointer: [number, number] | null, toolArmed: boolean): void {
    const now = performance.now();
    if (now - this.hintAt < 120) return;
    this.hintAt = now;
    const held = this.held();
    if (!pointer || toolArmed || this.state === 'carry' || this.state === 'rub' || this.aiming) { this.hoverRef = null; this.hint.hidden = true; return; }
    const ent = held ? null : this.host.entityAt(pointer[0], pointer[1]);
    this.hoverRef = ent && GRAB_KINDS.has(ent.kind) ? ent : null;
    if (!this.host.prefs.value.ui.hints) { this.hint.hidden = true; return; }
    let text = '';
    if (held) text = `click: set down · flick: throw · ${this.throwKey()}: aim a throw · ${this.modName()}+click: slap`;
    else if (this.hoverRef) {
      const who = this.catalog.label(this.hoverRef);
      text = `${who ? `${who} — ` : ''}drag: grab · rub: stroke · ${this.modName()}+click: slap · click: inspect`;
    }
    if (!text) { this.hint.hidden = true; return; }
    this.hint.hidden = false;
    if (this.hint.textContent !== text) this.hint.textContent = text;
    this.hint.style.transform = `translate(${pointer[0] + 18}px, ${pointer[1] + 16}px)`;
  }

  /** the slap modifier's name for hints */
  modName: () => string = () => 'Alt';
  /** the aimed throw's key for hints */
  throwKey: () => string = () => '⇧ E';

  /** test surface */
  stateName(): string { return this.aiming ? 'aim' : this.state; }
  groundOf(x: number, y: number): GroundHit | null { return this.host.groundAt(x, y); }
  get cursor(): HandCursor { return this.cursorPose; }
}
