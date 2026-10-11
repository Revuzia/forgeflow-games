// GENESIS — the opening (CONTRACT.md §16.1; the first minutes of a new game on the barren world). It teaches by
// suggestion, never by a box: every power works from the first frame, and the whispers are words on the dark, not
// windows.
//   1. Black. The name, and the line under it. A star ignites: the low roar builds (the 'ignition' cue), the light swells
//      out of the dark through a bloom that floods and settles. (Before the page may play sound, the dark waits for the
//      first key or click — "touch the dark" — and lights itself after a while anyway.)
//   2. The airless world turns into view: the camera falls from the star to the grey rock and the world keeps turning
//      under it for a few breaths. The interface fades in.
//   3. Whispers that suggest the next act — breathe (air), water, soil and a seed, someone to see it — each with one
//      quiet way to do it in place and, only after a while with nothing done, another way (a gesture, words, a key).
//      They follow the sim's 'milestone' events (air, first-rain, first-sea, first-green, first-people, first-fire,
//      first-night, first-settlement, first-discovery) and adapt to what the player did first: water poured on a rock
//      with no air, a people set down before anything grows, green before rain — each is answered before the next
//      suggestion.
//   4. The first night: with fire their hearths glow and the whisper says so; without it they huddle cold in the dark,
//      the whisper notes it — and offers fire. When fire comes after a cold night, it is noticed.
//   5. "Leave them. Come back in a hundred years." Then the opening ends.
// Esc opens the scenario menu (stay here, or another world, or a saved one); "hush" ends the whispers for good.

import type { PlanetView } from '../client/worldview.ts';
import type { Command, SimEvent } from '../sim/types.ts';
import type { UiHost } from './host.ts';
import type { Power } from './powers.ts';
import { h, clear } from './dom.ts';

export interface OpeningDeps {
  host: UiHost;
  openFreeform(text: string): void;
  openPalette(query: string): void;
  /** the scenario menu, opened from the opening (its barren card means "stay") */
  openMenu(): void;
  /** is the scenario menu (or another window) up: the opening waits */
  menuOpen(): boolean;
  /** the camera's part: 'star' (the star from close, in the dark), 'world' (fall to the home world), 'turn' (let the
   * world turn under the camera for a few breaths), 'done' (the system as it is) */
  camera?(shot: 'star' | 'world' | 'turn' | 'done'): void;
  /** the light of the opening: exposure (stops, added) and a bloom multiplier */
  light?(ev: number, bloom: number): void;
  /** is the page allowed to play sound yet (else the dark waits for a touch) */
  audioRunning?(): boolean;
  /** the interface: hidden in the dark, faded in as the world turns into view */
  setUi(v: boolean): void;
  /** arm a power as the tool (the people's drop) */
  arm(p: Power, preset?: Record<string, unknown>): void;
}

type Beat = 'air' | 'water' | 'green' | 'people' | 'wait' | 'night' | 'fire' | 'rest';
type Stage = 'off' | 'dark' | 'ignite' | 'fall' | 'whisper';

interface Whisper {
  beat: Beat;
  /** an answer to what just happened (small, above) */
  ack?: string;
  /** the suggestion (large) */
  line: string;
  /** one way to do it here, in a word */
  act?: { label: string; run(): void };
  /** the way to do it otherwise, shown after a while with nothing done */
  later?: string;
}

/** seconds of the cinematic: the dark, the ignition (its crack lands at 2.5 s, with the sound), the fall to the world */
const IGNITE_CRACK = 2.5;
const FALL_AT = 5.2;
const FALL_SECONDS = 6.4;
const IDLE_LATER = 20000;

export class Opening {
  readonly root: HTMLDivElement;
  private deps: OpeningDeps;
  private host: UiHost;
  private veil: HTMLDivElement;
  private touch: HTMLDivElement;
  private card: HTMLDivElement;
  private stage: Stage = 'off';
  private t0 = 0;
  private stageAt = 0;
  private planet = -1;
  /** beats the world has met (from the sim's milestones, and what the mirror shows) */
  private met = new Set<string>();
  /** the order the player made them happen in */
  private order: string[] = [];
  private cur: Whisper | null = null;
  private curAt = 0;
  private laterShown = false;
  private pendingAck: string | null = null;
  private nightSaid = false;
  private coldNight = false;
  private fireSaid = false;
  private lastCheck = 0;
  private hushed = false;
  private gestureListener: ((e: Event) => void) | null = null;
  /** the opening's clock (real time; a test can hold it and step it, a software-rendered frame takes seconds) */
  now: () => number = () => performance.now();

  constructor(parent: HTMLElement, world: HTMLElement, deps: OpeningDeps) {
    this.deps = deps;
    this.host = deps.host;
    this.veil = h('div', { class: 'gn-open-veil' },
      h('div', { class: 'gn-open-title', text: 'GENESIS' }),
      h('div', { class: 'gn-open-sub', text: 'You poured water on a dead rock. Now they have a word for you.' }));
    this.touch = h('div', { class: 'gn-open-touch', text: 'touch the dark — a key, or a click' });
    this.veil.append(this.touch);
    this.veil.hidden = true;
    world.appendChild(this.veil);
    this.card = h('div', { class: 'gn-whisper', role: 'status', aria: { live: 'polite' } });
    this.card.hidden = true;
    parent.appendChild(this.card);
    this.root = this.card;
  }

  get isActive(): boolean { return this.stage !== 'off'; }
  /** the dark and the fall: names and markers stay hidden */
  get hush(): boolean { return this.stage === 'dark' || this.stage === 'ignite' || this.stage === 'fall'; }
  /** the opening never blocks the world: it is never modal (the scenario menu is its own window) */
  get modal(): boolean { return false; }

  /** begin: black, the name, the star */
  start(): void {
    this.stage = 'dark';
    this.t0 = this.stageAt = this.now();
    this.planet = this.host.primary();
    this.met.clear();
    this.order = [];
    this.cur = null;
    this.hushed = false;
    this.uiShown = false;
    this.nightSaid = this.coldNight = this.fireSaid = false;
    this.pendingAck = null;
    this.veil.hidden = false;
    this.veil.style.opacity = '1';
    this.veil.classList.remove('gn-lit');
    this.touch.classList.remove('gn-on');
    this.deps.setUi(false);
    this.deps.camera?.('star');
    this.deps.light?.(-14, 1);
    // the first key or click (anywhere) lights the star: it is also the gesture that lets the page play its sound
    // (the touch is only that: a key or a click in the dark does nothing else — Esc still opens the scenario menu)
    this.gestureListener = (e: Event) => {
      if (this.stage !== 'dark') return;
      if (e instanceof KeyboardEvent && (e.code === 'Escape' || e.repeat)) return;
      // (other listeners on the window still hear it — the sound engine unlocks on this very touch — but the world
      // does not: no pause, no drag)
      e.stopPropagation();
      if (e instanceof KeyboardEvent) e.preventDefault();
      this.ignite();
    };
    window.addEventListener('keydown', this.gestureListener, true);
    window.addEventListener('pointerdown', this.gestureListener, true);
  }

  private dropGesture(): void {
    if (!this.gestureListener) return;
    window.removeEventListener('keydown', this.gestureListener, true);
    window.removeEventListener('pointerdown', this.gestureListener, true);
    this.gestureListener = null;
  }

  private ignite(): void {
    if (this.stage !== 'dark') return;
    this.dropGesture();
    this.stage = 'ignite';
    this.stageAt = this.now();
    this.veil.classList.add('gn-lit');
    // the roar plays once the page may sound (this very key or click unlocks it, a moment later)
    this.soundPending = true;
  }
  private soundPending = false;

  /** Esc: the scenario menu; true when the opening took the key */
  cancel(): boolean {
    if (this.stage === 'off') return false;
    // the cinematic gives way at once: the world is where it would have been
    if (this.stage !== 'whisper') this.skipCinematic();
    this.deps.openMenu();
    return true;
  }

  private skipCinematic(): void {
    this.dropGesture();
    this.veil.hidden = true;
    this.deps.light?.(0, 1);
    this.deps.camera?.('world');
    this.deps.camera?.('done');
    this.deps.setUi(true);
    this.stage = 'whisper';
    this.stageAt = this.now();
    this.check(true);
  }

  /** end the opening for good (the world stays as it is) */
  end(): void {
    if (this.stage === 'off') return;
    this.dropGesture();
    if (this.stage !== 'whisper') { this.deps.light?.(0, 1); this.deps.camera?.('done'); this.deps.setUi(true); }
    this.stage = 'off';
    this.card.classList.remove('gn-on');
    this.card.hidden = true;
    this.veil.hidden = true;
    this.cur = null;
  }

  // ───────────────────────────── per frame ─────────────────────────────

  frame(): void {
    if (this.stage === 'off') return;
    const now = this.now();
    const t = (now - this.stageAt) / 1000;
    switch (this.stage) {
      case 'dark': {
        // the name fades in on the black; the invitation to touch comes after it (only while sound waits for one)
        const waited = (now - this.t0) / 1000;
        if (waited > 1.6 && !this.deps.audioRunning?.()) this.touch.classList.add('gn-on');
        // sound may already play (the page was played before): the star lights by itself; it never waits forever
        if ((waited > 2.6 && this.deps.audioRunning?.()) || waited > 14) this.ignite();
        return;
      }
      case 'ignite': {
        // the sound and the light keep time: when the roar can start within a breath, the light starts again with it
        // (its crack lands with the sound's); without sound the light goes on alone
        if (this.soundPending) {
          if (this.deps.audioRunning?.()) { this.soundPending = false; this.host.sound('ignition'); this.stageAt = now; return; }
          if (t > 1.2) this.soundPending = false;
        }
        // the light: a glimmer grows in the dark, the crack floods it (bloom swell), then it settles
        let ev: number, bloom: number;
        if (t < IGNITE_CRACK) { const k = t / IGNITE_CRACK; ev = -14 + 8 * k * k; bloom = 1 + 2 * k; }
        else {
          const k = Math.min(1, (t - IGNITE_CRACK) / (FALL_AT - IGNITE_CRACK));
          const e = 1 - (1 - k) * (1 - k);
          ev = 2.4 * (1 - e) + 0 * e;
          bloom = 1 + 9 * Math.exp(-(t - IGNITE_CRACK) * 1.6);
        }
        this.deps.light?.(ev, bloom);
        // the name dissolves into the light
        this.veil.style.opacity = String(Math.max(0, 1 - t / 1.4));
        if (t > 1.4) this.veil.hidden = true;
        if (t >= FALL_AT) {
          this.deps.light?.(0, 1);
          this.stage = 'fall';
          this.stageAt = now;
          this.deps.camera?.('world');
        }
        return;
      }
      case 'fall': {
        if (t >= FALL_SECONDS - 0.6 && !this.uiShown) { this.uiShown = true; this.deps.setUi(true); }
        if (t >= FALL_SECONDS) {
          this.deps.camera?.('turn');
          this.stage = 'whisper';
          this.stageAt = now;
          this.check(true);
        }
        return;
      }
      case 'whisper': {
        this.hear();
        if (now - this.lastCheck > 600) { this.lastCheck = now; this.check(false); }
        if (this.cur && !this.laterShown && this.cur.later && now - this.curAt > IDLE_LATER) { this.laterShown = true; this.render(); }
        // the whispers step back while a window or a list is up
        this.card.classList.toggle('gn-away', this.deps.menuOpen() || document.querySelector('.gn-pal:not([hidden]), .gn-rad:not([hidden]), .gn-win:not([hidden])') !== null);
        // the last words, then the end
        if (this.cur?.beat === 'rest' && now - this.curAt > 16000) this.end();
        return;
      }
    }
  }
  private uiShown = false;

  // ───────────────────────────── what the world has met ─────────────────────────────

  /** the sim's milestones, read (not taken) before the toasts drain them */
  private hear(): void {
    const evs = this.host.view.pendingEvents;
    for (const e of evs) if (e.t === 'milestone') this.meet(e);
  }

  private meet(e: SimEvent): void {
    const kind = String((e.data as { kind?: string } | undefined)?.kind ?? '');
    if (!kind || (e.planet !== undefined && e.planet !== this.planet)) return;
    this.note(kind);
  }

  private note(kind: string): void {
    if (this.met.has(kind)) return;
    this.met.add(kind);
    this.order.push(kind);
    this.pendingAck = this.ackFor(kind);
    this.lastCheck = 0;
  }

  /** what the mirror shows now (milestones come hourly; the eye sees at once) */
  private look(pv: PlanetView): void {
    if (pv.params.atmosphere.pressure > 0.05) this.note('air');
    if (fraction(pv, 'water', 0.5) > 0.015) this.note(this.met.has('air') ? 'first-sea' : 'water-on-rock');
    if (mean(pv, 'grass') + mean(pv, 'tree') + mean(pv, 'shrub') > 0.02) this.note('first-green');
    const live = pv.settlements.filter((s) => !(s.flags & 2) && s.population > 0);
    if (live.length) this.note('first-people');
    if (live.some((s) => s.nightLight > 0.02)) this.note('first-fire');
  }

  /** the answer to a beat met, shaped by what came before it */
  private ackFor(kind: string): string | null {
    const has = (k: string) => this.met.has(k);
    switch (kind) {
      case 'air': return has('water-on-rock') ? 'Air at last: the water you poured can stay.' : 'Breath. The sky begins.';
      case 'water-on-rock': return has('air') ? null : 'Water on a rock with no air: it freezes, or boils away.';
      case 'first-rain': return 'The first rain.';
      case 'first-sea': return 'Water gathers in the low places.';
      case 'first-green': return has('first-sea') || has('first-rain') ? 'Green, where water and warmth allow.' : 'Green on dry rock: it will not last without water.';
      case 'first-people':
        if (!has('air')) return 'They cannot breathe here.';
        if (!has('first-green')) return 'Someone stands on bare rock. They will find nothing to eat.';
        return 'Someone is there to see it.';
      case 'first-fire': return this.coldNight ? 'They have fire now. They will not be cold again.' : 'They have fire.';
      case 'first-settlement': return 'They have settled. A place has a name.';
      case 'first-discovery': return 'They worked something out that nobody showed them.';
      default: return null;
    }
  }

  private check(force: boolean): void {
    if (this.hushed) return;
    const v = this.host.view;
    const pv = v.planet(this.planet) ?? v.planet(this.host.primary());
    if (!pv) return;
    this.look(pv);
    const has = (k: string) => this.met.has(k);
    const live = pv.settlements.filter((s) => !(s.flags & 2) && s.population > 0);
    const fire = has('first-fire') || live.some((s) => s.nightLight > 0.02);
    const night = live.length > 0 && isNight(pv, live[0].pos);
    const sid = live[0]?.id ?? -1;
    const now = this.now();
    const cur = this.cur?.beat ?? null;
    // the order a dead rock meets them in; what the player did out of order is answered (ackFor) before the next
    let next: Beat;
    if (!has('air')) next = 'air';
    else if (!has('first-rain') && !has('first-sea')) next = 'water';
    else if (!has('first-green')) next = 'green';
    else if (!has('first-people') && !live.length) next = 'people';
    else if (!this.nightSaid && !this.fireSaid) {
      // their first night: with fire the hearths glow; without it they are cold in the dark
      if (night) next = fire ? 'fire' : 'night';
      else if (fire && has('first-night')) next = 'fire';
      else next = 'wait';
    } else if (this.coldNight && fire && !this.fireSaid) next = 'fire';
    else if (cur === 'night' && !fire && (night || now - this.curAt < 30000)) next = 'night';
    else if (cur === 'fire' && now - this.curAt < 9000) next = 'fire';
    else next = 'rest';
    if (!force && cur === next && !this.pendingAck) return;
    if (next === 'night') { this.nightSaid = true; this.coldNight = true; }
    if (next === 'fire') this.fireSaid = true;
    this.cur = this.whisper(next, pv, sid, night);
    if (this.pendingAck) this.cur.ack = this.pendingAck;
    this.pendingAck = null;
    this.curAt = this.now();
    this.laterShown = false;
    this.host.sound('whisper');
    this.render();
  }

  private cmd(...cs: Command[]): void {
    void (async () => { for (const c of cs) await this.host.cmd(c); })();
  }

  private whisper(beat: Beat, pv: PlanetView, sid: number, night: boolean): Whisper {
    const planet = pv.id;
    const kb = this.host.keybinds;
    const k = (id: string, d: string) => kb.hint(id) || d;
    const here = () => this.host.focusGround()?.dir ?? [0, 0, 1];
    switch (beat) {
      case 'air': return {
        beat, line: this.met.has('first-people') ? 'They cannot breathe. Breathe on it — now?' : 'It is quiet. Breathe on it?',
        act: { label: 'breathe', run: () => this.cmd({ k: 'planet.add-air', planet, amount: 1 }) },
        later: `Or press ${k('ui.freeform', 'Enter')} and say it: “breathe air onto the world”.`,
      };
      case 'water': return {
        beat, line: this.met.has('air') ? 'Water?' : 'Water — though it will not stay without air.',
        act: { label: 'let it rain', run: () => this.cmd({ k: 'weather.global', planet, kind: 'storm' }, { k: 'water.sea-level', planet, value: -40 }) },
        later: `The air warms the rock slowly; rain on frozen ground lies as snow. Let time run (${k('time.speed100', '3')}), or hold ${k('ui.gesture', 'G')} and draw a spiral for water where you point.`,
      };
      case 'green': return {
        beat, line: 'Soil, and a seed.',
        act: {
          label: 'sow', run: () => this.cmd(
            { k: 'weather.global', planet, kind: 'none' },
            { k: 'life.plant', planet, species: 'meadow-grass', pos: here(), radius: 12000, density: 0.8 },
            { k: 'life.plant', planet, species: 'berry-bush', pos: here(), radius: 1800, density: 0.5 },
            { k: 'life.forest', planet, pos: here(), radius: 1400 }),
        },
        later: `Green spreads only where water and warmth allow. Hold ${k('ui.gesture', 'G')} and draw a wave for a forest.`,
      };
      case 'people': return {
        beat, line: 'Someone to see it?',
        act: { label: 'set them down', run: () => this.dropPeople(planet) },
        later: `Click where they should stand, on green ground near water — or press ${k('ui.palette', '/')} and search “people”.`,
      };
      case 'night': return {
        beat, line: night ? 'Night. They have no fire. They huddle in the dark, cold.' : 'Their first night was cold: they have no fire.',
        act: sid >= 0 ? { label: 'give them fire', run: () => this.cmd({ k: 'idea.teach', planet, knowledge: 'fire-keeping', settlement: sid }, { k: 'idea.teach', planet, knowledge: 'fire-making', settlement: sid }) } : undefined,
        later: `A lightning strike might teach them. Hold ${k('ui.gesture', 'G')} and draw a triangle: fire from the sky.`,
      };
      case 'fire': return {
        beat, line: night ? 'Night. Their fire glows.' : 'When night comes, their fire will glow.',
      };
      case 'wait': return {
        beat, line: 'Watch them. Their first night is coming.',
        act: { label: 'let the day pass', run: () => this.host.setSpeed(10) },
        later: `Time runs faster with ${k('time.speed10', '2')} and ${k('time.speed100', '3')}; ${k('time.pause', 'Space')} stops it.`,
      };
      case 'rest': return {
        beat, line: 'Leave them. Come back in a hundred years.',
        act: { label: 'let a century run', run: () => this.host.setSpeed(100) },
      };
    }
  }

  /** the people's whisper: the hand holds a band of plains folk — the next click on the ground sets them down */
  private dropPeople(planet: number): void {
    const p = this.host.powers.get('people');
    if (p) { this.deps.arm(p, { species: 'plains-folk', count: 30 }); return; }
    const poi = this.host.poi?.('homestead');
    const pos = poi?.pos ?? this.host.focusGround()?.dir;
    void this.host.cmd({ k: 'life.spawn-people', planet, species: 'plains-folk', count: 30, ...(pos ? { pos } : {}) }).then((r) => {
      const made = r.created?.find((e) => e.kind === 'settlement');
      if (made) this.host.lookAtEntity({ ...made, planet });
    });
  }

  private render(): void {
    const w = this.cur;
    if (!w) { this.card.classList.remove('gn-on'); return; }
    clear(this.card);
    // each whisper fades in afresh
    this.card.classList.remove('gn-on');
    this.card.hidden = false;
    if (w.ack) this.card.append(h('div', { class: 'gn-wh-ack', text: w.ack }));
    this.card.append(h('div', { class: 'gn-wh-line', text: w.line }));
    const ways = h('div', { class: 'gn-wh-ways' });
    if (w.act) {
      const a = w.act;
      const b = h('button', { class: 'gn-wh-act', text: a.label });
      b.addEventListener('click', () => { a.run(); b.disabled = true; this.host.sound('ui.confirm'); });
      ways.append(b);
    }
    if (this.laterShown && w.later) ways.append(h('div', { class: 'gn-wh-later', text: w.later }));
    const hush = h('button', { class: 'gn-wh-hush', text: 'hush', title: 'No more whispers' });
    hush.addEventListener('click', () => { this.hushed = true; this.end(); });
    ways.append(hush);
    this.card.append(ways);
    void this.card.offsetWidth;
    this.card.classList.add('gn-on');
  }

  /** test surface */
  state(): { active: boolean; stage: Stage; step: string | null; line: string | null; ack: string | null; later: boolean; met: string[]; order: string[] } {
    return { active: this.stage !== 'off', stage: this.stage, step: this.cur?.beat ?? null, line: this.cur?.line ?? null, ack: this.cur?.ack ?? null, later: this.laterShown, met: [...this.met], order: [...this.order] };
  }
  /** test surface: light the star now (as the first touch would) */
  touchDark(): void { this.ignite(); }
}

function mean(pv: PlanetView, f: Parameters<PlanetView['fields']['get']>[0]): number {
  const a = pv.fields.get(f);
  if (!a || !a.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i += 7) s += a[i];
  return s / Math.ceil(a.length / 7);
}

function fraction(pv: PlanetView, f: Parameters<PlanetView['fields']['get']>[0], over: number): number {
  const a = pv.fields.get(f);
  if (!a || !a.length) return 0;
  let n = 0, m = 0;
  for (let i = 0; i < a.length; i += 7) { m++; if (a[i] > over) n++; }
  return n / Math.max(1, m);
}

/** is it night at a point of a world (the sun below its horizon) */
function isNight(pv: PlanetView, u: ArrayLike<number>): boolean {
  const q = pv.quat, s = pv.sunDir;
  const x = s[0], y = s[1], z = s[2], qx = -q[0], qy = -q[1], qz = -q[2], qw = q[3];
  const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
  const bx = ix * qw + iw * -qx + iy * -qz - iz * -qy, by = iy * qw + iw * -qy + iz * -qx - ix * -qz, bz = iz * qw + iw * -qz + ix * -qy - iy * -qx;
  return bx * u[0] + by * u[1] + bz * u[2] < -0.04;
}
