// GENESIS — the opening (CONTRACT.md §16.1; the first minutes of a new game on the barren world). It teaches by
// suggestion, never by a box: every power works from the first frame, and the whispers are words on the dark, not
// windows.
//   1. Black. The name, and the line under it. A star ignites: the low roar builds (the 'ignition' cue), the light swells
//      out of the dark through a bloom that floods and settles. (Before the page may play sound, the dark waits for the
//      first key or click — "touch the dark" — and lights itself after a while anyway.)
//   2. The airless world turns into view: the camera falls from the star to the grey rock and the world keeps turning
//      under it for a few breaths. The interface fades in.
//   3. Whispers that suggest the next act — breathe (air), water, soil and a seed, someone to see it — each with one
//      quiet way to do it in place and, only after a while with nothing done, another way (a sigil, words, a key).
//      They follow the sim's 'milestone' events (air, first-rain, first-sea, first-green, first-people, first-fire,
//      first-night, first-settlement, first-discovery) and adapt to what the player did first: water poured on a rock
//      with no air, a people set down before anything grows, green before rain — each is answered before the next
//      suggestion.
//   4. The first night: with fire their hearths glow and the whisper says so; without it they huddle cold in the dark,
//      the whisper notes it — and offers fire, and keeps offering it (by day: "their night was cold, they still have no
//      fire") until they have fire or are gone. When fire comes after a cold night, it is noticed; when they die, it is
//      said, and someone may be set down again.
//   5. "Leave them. Come back in a hundred years." — only once they have fire. Then the opening ends.
// The opening's own acts stay gentle: its storm passes once a sea has gathered (or after two days of the world), and
// the people are set down at a ringed spot on the morning side that is green, near water and warm enough. While it
// speaks the interface is quiet (the HUD's few speeds, no key strip), and the camera keeps the lit face of the world
// toward the eye (src/app.ts openingCamera 'turn') until the player turns it.
// Esc during the star and the fall opens the scenario menu (stay here, or another world, or a saved one); while the
// whispers speak, Esc first puts away whatever is open or armed (src/ui/shell.ts cancel) and only then offers the menu.
// "hush" ends the whispers for good.

import type { PlanetView } from '../client/worldview.ts';
import type { Command, CommandResult, SimEvent } from '../sim/types.ts';
import { findPoi } from '../client/poi.ts';
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
  /** the camera's part: 'star' (the star from close, in the dark), 'world' (fall to the home world), 'turn' (arrived:
   * the whispers begin — the world turns under the camera, its lit face held toward the eye; a fall a slow machine has
   * not finished is cut short), 'hold' (a new whisper: the lit face again, if the player has let the camera be), 'done'
   * (the camera is the player's) */
  camera?(shot: 'star' | 'world' | 'turn' | 'hold' | 'done'): void;
  /** the light of the opening: exposure (stops, added) and a bloom multiplier */
  light?(ev: number, bloom: number): void;
  /** is the camera still on its way (the fall is a blend the renderer runs on its own clock: on a slow machine it can
   * outlast the opening's real seconds — the whispers wait for the world to be in view) */
  cameraBusy?(): boolean;
  /** is the page allowed to play sound yet (else the dark waits for a touch) */
  audioRunning?(): boolean;
  /** the interface: hidden in the dark, faded in as the world turns into view */
  setUi(v: boolean): void;
  /** arm a power as the tool (the people's drop), and put it away once they stand there */
  arm(p: Power, preset?: Record<string, unknown>): void;
  disarm?(): void;
  /** the power armed now (its id), if any */
  armed?(): string | null;
  /** the HUD while the whispers speak: quiet (a few speeds, no key strip) or whole again */
  hudQuiet?(quiet: boolean): void;
}

type Beat = 'air' | 'water' | 'green' | 'people' | 'gone' | 'wait' | 'night' | 'kindle' | 'fire' | 'rest';
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
/** after fire was given, the days of their own world before the whisper adds another way to bring fire */
const KINDLE_DAYS = 3;
/** the opening's storm ("let it rain") passes after this many days of the world if no sea has gathered by then */
const STORM_DAYS = 2;
/** water (or ice) deeper than this on a cell of an airless rock is "water poured on the rock" */
const ROCK_WATER = 0.2;
/*
 * The speeds the whispers set. A preset is ticks per real second (1x is TICKS_PER_SECOND_1X: one tick, one game minute,
 * a second; LIVING §1.1). The people's drop and both "let the day pass" acts were all 10x when 1x was ten ticks a second,
 * and that 10x was 100 ticks a second (a 24-hour day in 14 s). At the new pace each beat gets the step that does what it
 * needs. The figures are for Cinder, the opening's world (30-hour days of 1 800 ticks; people walk 2 m a tick). All
 * three are steps the quiet HUD keeps (hud.ts QUIET_SPEEDS: pause, 1x, 10x, 100x, 1000x), so its lit button shows where
 * time stands.
 */
/**
 * The people are set down and time that was racing slows to this so their first day can be watched: at 10x they cross
 * the ground at 20 m/s (the old 10x showed 25), and the 7 to 14 hours of daylight left on the morning side play out over
 * 40 to 85 s. At 100x they would streak at 200 m/s through a day over in 4 to 8 s.
 */
const WATCH_SPEED = 10;
/**
 * "Let the day pass" (the first night coming, the first hearth awaited): 100x, a Cinder day in 18 s, the pace the old
 * 10x had. The first night comes 4 to 8 s after the band is set down. Once fire is given, the first hearth glows some 14
 * to 16 s later (0.8 to 0.9 of a day, measured on the barren path over three seeds), and the KINDLE_DAYS offer of
 * Kindling comes after 54 s. At 10x those were 1 to 1.5 min to nightfall, 2.5 min to the hearth and 9 min to the offer.
 */
const DAY_SPEED = 100;
/** "Let a century run": 1000x, the time-lapse. A year takes about 17 s and a century about half an hour (100x: 4.8 hours) */
const CENTURY_SPEED = 1000;

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
  /** the world's tick when the whisper's 'give them fire' was taken (−1: not given), and the night the kindling line
   * was said at (it changes with the night) */
  private fireGivenAt = -1;
  private curNight = false;
  /** when the whisper on screen was last (re)worded */
  private renderedAt = 0;
  private lastCheck = 0;
  private hushed = false;
  /** the world's tick when the opening's storm began (−1: none of the opening's own) */
  private stormAt = -1;
  /** cells of the airless rock already wet or icy when the opening began (a poured sea is counted beyond them) */
  private rockWet0 = -1;
  /** where the whisper suggests setting the people down (the morning side: green, near water, warm enough) */
  private spot: { planet: number; pos: [number, number, number] } | null = null;
  private ring: HTMLDivElement;
  private ringLabel!: HTMLDivElement;
  /** where the ring's label was last fitted (it is re-fitted when the ring moves, and a few times a second) */
  private ringFit = { x: -1e9, y: -1e9, at: 0 };
  private quiet = false;
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
    // the spot the people's whisper points at, ringed on the ground (it never takes a click: the ground under it does)
    this.ringLabel = h('div', { class: 'gn-open-ring-l', text: 'Here: green, near water, warm enough' });
    this.ring = h('div', { class: 'gn-open-ring', aria: { hidden: 'true' } }, h('div', { class: 'gn-open-ring-o' }), this.ringLabel);
    this.ring.hidden = true;
    world.appendChild(this.ring);
  }

  get isActive(): boolean { return this.stage !== 'off'; }
  /** the cinematic is on screen (the star igniting, the fall to the world): the interface is still hidden */
  get cinematic(): boolean { return this.stage === 'ignite' || this.stage === 'fall'; }
  /**
   * a power or a window was asked for during the cinematic: it gives way at once — the world where it would have been,
   * the interface up — so every power works from the first frame (the whispers go on from there)
   */
  skip(): void { if (this.cinematic) this.skipCinematic(); }
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
    this.fireGivenAt = -1;
    this.stormAt = -1;
    this.rockWet0 = -1;
    this.spot = null;
    this.ring.hidden = true;
    this.pendingAck = null;
    this.setQuiet(true);
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
      // a power or a window key (/, Enter, F1, Q …) in the dark is the touch AND the way straight to the world: the
      // star gives way at once and the key does what it says (time keys only light the star: they meant "go on")
      if (e instanceof KeyboardEvent) {
        const ids = this.host.keybinds.pressActions(e).concat(this.host.keybinds.holdActions(e));
        if (ids.some((id) => !id.startsWith('time.') && !id.startsWith('cam.') && id !== 'tool.cancel')) { this.ignite(); this.skipCinematic(); return; }
      }
      // (other listeners on the window still hear it — the sound engine unlocks on this very touch — but the world
      // does not: no pause, no drag, no skipping the star it just lit: the shell asks tookTouch)
      e.stopPropagation();
      if (e instanceof KeyboardEvent) e.preventDefault();
      this.touchEvent = e;
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
  private armedPeople = false;
  /** the event that lit the star (it is the touch, nothing else) */
  private touchEvent: Event | null = null;
  /** was this event the touch that lit the star (the shell then ignores it) */
  tookTouch(e: Event): boolean { return e === this.touchEvent; }

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
    // (the whispers begin at once: the camera keeps the lit face of the world toward the eye while they speak)
    this.deps.camera?.('turn');
    this.deps.setUi(true);
    this.stage = 'whisper';
    this.stageAt = this.now();
    this.check(true);
  }

  /** end the opening for good (the world stays as it is) */
  end(): void {
    if (this.stage === 'off') return;
    this.dropGesture();
    if (this.stage !== 'whisper') { this.deps.light?.(0, 1); this.deps.setUi(true); }
    // (the camera is the player's again: the lit-face hold lets go)
    this.deps.camera?.('done');
    this.stage = 'off';
    this.card.classList.remove('gn-on');
    this.card.hidden = true;
    this.veil.hidden = true;
    this.ring.hidden = true;
    this.cur = null;
    this.setQuiet(false);
  }

  /** the HUD quiets while the whispers speak (a few speeds, no key strip) and is whole again for the farewell */
  private setQuiet(q: boolean): void {
    if (this.quiet === q) return;
    this.quiet = q;
    this.deps.hudQuiet?.(q);
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
        // (the fall ends when the camera has arrived — never later than half a minute, whatever the machine)
        const arrived = !this.deps.cameraBusy?.() || t > 30;
        if (t >= FALL_SECONDS - 0.6 && arrived && !this.uiShown) { this.uiShown = true; this.deps.setUi(true); }
        if (t >= FALL_SECONDS && arrived) {
          this.deps.camera?.('turn');
          this.stage = 'whisper';
          this.stageAt = now;
          this.check(true);
        }
        return;
      }
      case 'whisper': {
        this.hear();
        // (the band put back — Esc, a right click, another power — the whisper comes back)
        if (this.armedPeople && this.deps.armed && this.deps.armed() !== 'people') this.armedPeople = false;
        if (now - this.lastCheck > 600) { this.lastCheck = now; this.check(false); }
        if (this.cur && !this.laterShown && this.cur.later && now - this.curAt > IDLE_LATER) { this.laterShown = true; this.render(); }
        // the whispers step back while a window, a list or a menu is up (the camera modes, the step menu too)
        // — and while the band it put in the Touch waits to be set down: the ring and the tool's card say what to do, the
        // words would only cover the ground being chosen
        this.card.classList.toggle('gn-away', this.armedPeople || this.deps.menuOpen() || document.querySelector('.gn-pal:not([hidden]), .gn-rad:not([hidden]), .gn-win:not([hidden]), .gn-cam-menu:not([hidden]), .gn-stepmenu:not([hidden])') !== null);
        this.placeRing();
        // the last words, then the end (the farewell is only ever said once they have fire)
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
    // the band the whisper put in the Touch is down: the Touch is empty again
    if (kind === 'first-people' && this.armedPeople) { this.armedPeople = false; this.deps.disarm?.(); }
    this.met.add(kind);
    this.order.push(kind);
    this.pendingAck = this.ackFor(kind);
    this.lastCheck = 0;
  }

  /** what the mirror shows now (milestones come hourly; the eye sees at once) */
  private look(pv: PlanetView): void {
    const airless = pv.params.atmosphere.pressure <= 0.05;
    if (!airless) this.note('air');
    // water poured on the airless rock: any cell holding some (or its ice), beyond what the rock already had when the
    // opening began — a 250 m pour on a 3 km world wets a fraction of a percent of it, so this is a count, not a share
    if (airless && !this.met.has('air')) {
      const wet = wetCells(pv, ROCK_WATER);
      if (this.rockWet0 < 0) this.rockWet0 = wet;
      else if (wet > this.rockWet0) this.note('water-on-rock');
    }
    if (fraction(pv, 'water', 0.5) > 0.015 && this.met.has('air')) this.note('first-sea');
    if (mean(pv, 'grass') + mean(pv, 'tree') + mean(pv, 'shrub') > 0.02) this.note('first-green');
    const live = pv.settlements.filter((s) => !(s.flags & 2) && s.population > 0);
    if (live.length) this.note('first-people');
    if (live.some((s) => s.nightLight > 0.02)) this.note('first-fire');
  }

  /**
   * an act of the player's (every command, src/app.ts cmd): water poured, a flood or a spring on the airless rock is
   * answered at once, before the next suggestion (the field shows it a moment later, the act is known now)
   */
  heard(c: Command, r: CommandResult): void {
    if (this.stage !== 'whisper' || !r.ok || this.met.has('air') || this.met.has('water-on-rock')) return;
    const pv = this.host.view.planet(this.planet);
    if (!pv || pv.params.atmosphere.pressure > 0.05) return;
    if (typeof c.planet === 'number' && c.planet !== this.planet) return;
    if (/^water\.|^miracle\.(water|flood|rain)|spring|tsunami|flood/.test(c.k) && !/(remove|drain|sea-level)/.test(c.k)) this.note('water-on-rock');
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
    if (this.armedPeople && live.length) { this.armedPeople = false; this.deps.disarm?.(); }
    this.stormCheck(pv);
    const cur = this.cur?.beat ?? null;
    // the order a dead rock meets them in; what the player did out of order is answered (ackFor) before the next
    let next: Beat;
    if (!has('air')) next = 'air';
    else if (!has('first-rain') && !has('first-sea')) next = 'water';
    else if (!has('first-green')) next = 'green';
    else if (!has('first-people') && !live.length) next = 'people';
    // they died (the cold, thirst, hunger on a world still too young): it is said, and someone may be set down again
    else if (!live.length && !pv.population.some((n) => n > 0)) next = 'gone';
    else if (!fire) {
      // no fire of their own: the whispers stay with them until they have it (or are gone) — never the farewell
      if (this.fireGivenAt >= 0) next = 'kindle'; // they know of fire; the first hearth is still to be built and lit
      else if (night || has('first-night') || this.coldNight) next = 'night'; // cold in the dark, or still cold by day
      else next = 'wait'; // their first night is coming
    } else if (!this.fireSaid) next = night || has('first-night') || this.coldNight ? 'fire' : 'wait';
    else if (cur === 'fire' && now - this.curAt < 9000) next = 'fire';
    else next = 'rest';
    // (a night / day turn re-words the cold and the kindling whispers — not more often than every few seconds: at
    // 1000× a day passes in a breath)
    const turned = (next === 'kindle' || next === 'night') && night !== this.curNight && now - this.renderedAt > 8000;
    const kindleLate = next === 'kindle' && cur === 'kindle' && !this.laterShown && this.kindleLate(pv);
    if (!force && cur === next && !this.pendingAck && !turned && !kindleLate) return;
    if (next === 'gone') { this.nightSaid = this.fireSaid = this.coldNight = false; this.fireGivenAt = -1; }
    if (next === 'night') { this.nightSaid = true; if (night || has('first-night')) this.coldNight = true; }
    if (next === 'fire') this.fireSaid = true;
    const same = cur === next;
    this.cur = this.whisper(next, pv, sid, night);
    this.curNight = night;
    if (this.pendingAck) this.cur.ack = this.pendingAck;
    this.pendingAck = null;
    // (a re-worded whisper of the same beat keeps its clock: its other way still comes after a while with nothing done)
    if (!same) this.curAt = this.now();
    this.renderedAt = this.now();
    this.laterShown = kindleLate || (same && this.laterShown);
    if (next === 'people' || next === 'gone') this.spot ??= this.findSpot(pv);
    else this.spot = null;
    if (next === 'rest') this.setQuiet(false);
    // (the camera eases back to the lit face if the player has let it be)
    if (!same) this.deps.camera?.('hold');
    this.host.sound('whisper');
    this.render();
  }

  /** fire given, and still no hearth after a few of their days: the whisper offers another way */
  private kindleLate(pv: PlanetView): boolean {
    return this.fireGivenAt >= 0 && this.host.view.renderTick - this.fireGivenAt > KINDLE_DAYS * pv.params.dayHours * 60;
  }

  /** the opening's own storm passes once a sea has gathered, or after a couple of days of the world */
  private stormCheck(pv: PlanetView): void {
    if (this.stormAt < 0) return;
    const sea = this.met.has('first-sea');
    const long = this.host.view.renderTick - this.stormAt > STORM_DAYS * pv.params.dayHours * 60;
    if (!sea && !long) return;
    this.stormAt = -1;
    // (only if the planet-wide weather is still the storm it began: the player may have chosen another since)
    if (pv.params.globalWeather !== 'storm') return;
    this.cmd({ k: 'weather.global', planet: pv.id, kind: 'none' });
    if (!sea && !this.met.has('first-rain')) this.pendingAck = 'The storm passes. The rock is still too cold to hold a sea.';
    else if (!sea) this.pendingAck = 'The storm passes.';
  }

  /**
   * where the people's whisper suggests setting them down: the best homestead (src/client/poi.ts — fresh water, food,
   * wood, a mild climate, room) on the morning side of the world, where the sun stands well up, so their first day is
   * long; anywhere if the morning side has none
   */
  private findSpot(pv: PlanetView): { planet: number; pos: [number, number, number] } | null {
    const temp = pv.fields.get('temperature');
    const P = pv.grid.pos;
    let poi = null;
    if (temp) {
      const sun = bodySun(pv);
      const t = new Float32Array(temp.length);
      for (let c = 0; c < t.length; c++) {
        const el = P[c * 3] * sun[0] + P[c * 3 + 1] * sun[1] + P[c * 3 + 2] * sun[2];
        // (the morning side: the sun up, and its way across the sky still ahead — east of the subsolar meridian)
        // (east of the sun's meridian is afternoon: longitude grows eastward with the local hour)
        const eastOfSun = P[c * 3] * sun[2] - P[c * 3 + 2] * sun[0];
        t[c] = el > 0.25 && eastOfSun < 0.15 ? temp[c] : -99;
      }
      const masked = { ...pv, fields: new Map(pv.fields).set('temperature', t) } as PlanetView;
      poi = findPoi(masked, 'homestead');
    }
    poi ??= findPoi(pv, 'homestead');
    if (!poi) return null;
    return { planet: pv.id, pos: [P[poi.cell * 3], P[poi.cell * 3 + 1], P[poi.cell * 3 + 2]] };
  }

  /** the ring on the suggested spot, while the people's whisper speaks and the spot is in view */
  private placeRing(): void {
    const sp = this.spot;
    const beat = this.cur?.beat;
    // (the card steps aside while the people are held in the Touch — that is exactly when the ring must guide the drop)
    const p = sp && (beat === 'people' || beat === 'gone') && (this.armedPeople || !this.card.classList.contains('gn-away')) ? this.host.screenOf(sp.planet, sp.pos, 2) : null;
    if (!p) { this.ring.hidden = true; return; }
    this.ring.hidden = false;
    this.ring.style.transform = `translate(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px)`;
    const now = performance.now(), f = this.ringFit;
    if (Math.abs(p[0] - f.x) > 3 || Math.abs(p[1] - f.y) > 3 || now - f.at > 300) { f.x = p[0]; f.y = p[1]; f.at = now; this.fitRingLabel(p[0], p[1]); }
  }

  /**
   * The ring's label never lies over the whisper's words or the power's card (in the site's small frame both can sit
   * over the spot), nor over the HUD's panels: under the ring, else over it, else beside it (right, then left), else the
   * ring alone — its words are the whisper's too.
   */
  private fitRingLabel(x: number, y: number): void {
    const l = this.ringLabel;
    const w = l.offsetWidth, ht = l.offsetHeight;
    // (a fixed-position card has no offsetParent: a zero rect is what says it is not shown)
    const shown = (e: Element | null): e is HTMLElement => !!e && !(e as HTMLElement).hidden && !e.classList.contains('gn-away');
    const blocks = [this.card, ...['.gn-tool', '.gn-time', '.gn-topright', '.gn-dock'].map((s) => document.querySelector(s))].filter(shown)
      .map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    const fits = (x0: number, y0: number): boolean => {
      const x1 = x0 + w, y1 = y0 + ht;
      if (x0 < 4 || x1 > innerWidth - 4 || y0 < 4 || y1 > innerHeight - 4) return false;
      return !blocks.some((r) => x0 < r.right + 8 && x1 > r.left - 8 && y0 < r.bottom + 6 && y1 > r.top - 6);
    };
    const spots: [string, number, number][] = [['below', x - w / 2, y + 44], ['above', x - w / 2, y - 44 - ht], ['right', x + 44, y - ht / 2], ['left', x - 44 - w, y - ht / 2]];
    const where = spots.find(([, x0, y0]) => fits(x0, y0))?.[0] ?? 'none';
    l.classList.toggle('gn-up', where === 'above');
    l.classList.toggle('gn-right', where === 'right');
    l.classList.toggle('gn-left', where === 'left');
    l.classList.toggle('gn-off', where === 'none');
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
        beat, line: this.met.has('first-people') ? 'They cannot breathe. Breathe on it — now?' : this.met.has('water-on-rock') ? 'Breathe on it, and the water can stay?' : 'It is quiet. Breathe on it?',
        act: { label: 'breathe', run: () => this.cmd({ k: 'planet.add-air', planet, amount: 1 }) },
        later: `Or press ${k('ui.freeform', 'Enter')} and say it: “breathe air onto the world”.`,
      };
      case 'water': return {
        beat, line: this.met.has('air') ? 'Water?' : 'Water — though it will not stay without air.',
        // (the opening's storm passes by itself once a sea has gathered — stormCheck — so it never snows the world under)
        act: { label: 'let it rain', run: () => { this.stormAt = this.host.view.renderTick; this.cmd({ k: 'weather.global', planet, kind: 'storm' }, { k: 'water.sea-level', planet, value: -40 }); } },
        later: `The air warms the rock slowly; rain on frozen ground lies as snow. Let time run (${k('time.speed1000', '9')}), or hold ${k('ui.gesture', 'G')} and draw the drop — a hook falling into a small loop — for rain where you point.`,
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
        later: `Green spreads only where water and warmth allow. Hold ${k('ui.gesture', 'G')} and draw the sprout — a stem with a leaf to each side — for a grove.`,
      };
      case 'people': return {
        beat, line: 'Someone to see it?',
        act: { label: 'set them down', run: () => this.dropPeople(planet) },
        later: `Click where they should stand: green ground near water, warm enough — the ring is one such place. Or press ${k('ui.palette', '/')} and search “people”.`,
      };
      case 'night': return {
        beat, line: night ? 'Night. They have no fire. They huddle in the dark, cold.' : this.coldNight ? 'Their night was cold. They still have no fire.' : 'Night is coming, and they have no fire.',
        act: sid >= 0 ? { label: 'give them fire', run: () => { this.fireGivenAt = this.host.view.renderTick; this.lastCheck = 0; this.cmd({ k: 'idea.teach', planet, knowledge: 'fire-keeping', settlement: sid }, { k: 'idea.teach', planet, knowledge: 'fire-making', settlement: sid }); } } : undefined,
        later: `A lightning strike might teach them. Hold ${k('ui.gesture', 'G')} and draw the fork — down, back up, down again — for fire from the sky.`,
      };
      case 'kindle': {
        // (fire is in their heads; a hearth has to be built and fed before it glows — the whisper waits with them as
        // long as it takes, and after a few of their days offers the miracle that lights it)
        const late = this.kindleLate(pv);
        return {
          beat, ack: late ? undefined : 'They know of fire now.',
          line: late ? 'Still no hearth. They know of fire, but none burns yet.' : night ? 'Night. Their first hearth is not lit yet.' : 'Watch for their first hearth.',
          act: this.host.view.speed < DAY_SPEED ? { label: 'let the day pass', run: () => this.host.setSpeed(DAY_SPEED) } : undefined,
          later: late
            ? `Hold ${k('ui.gesture', 'G')} over them and draw the flame sigil: Kindling lights their hearths — or press ${k('ui.palette', '/')} and search “kindling”.`
            : `Time runs faster with ${k('time.speed10', '5')} and ${k('time.speed100', '7')}.`,
        };
      }
      case 'fire': return {
        beat, line: night ? 'Night. Their fire glows.' : 'When night comes, their fire will glow.',
      };
      case 'gone': return {
        beat, ack: 'They are gone. The world was too hard for them.', line: 'Someone to see it, again?',
        act: { label: 'set them down', run: () => this.dropPeople(planet) },
        later: 'Set them where it is green and warm, near water — and give them fire before the night.',
      };
      case 'wait': return {
        beat, line: 'Watch them. Their first night is coming.',
        act: { label: 'let the day pass', run: () => this.host.setSpeed(DAY_SPEED) },
        // (the Touch, suggested once there is someone to lift)
        later: `Time runs faster with ${k('time.speed10', '5')} and ${k('time.speed100', '7')}; ${k('time.pause', 'Space')} stops it. Or come close and lift one with the Touch — drag them, and set them down gently.`,
      };
      case 'rest': return {
        beat, line: 'Leave them. Come back in a hundred years.',
        // (CENTURY_SPEED, 1000×: the time-lapse, a year in ~17 s and a century in ~half an hour — the old 100× it was
        // written for; presets are ticks a second since the living-world pace, LIVING §1.1, and 100× now takes a century
        // 4.8 hours)
        act: { label: 'let a century run', run: () => this.host.setSpeed(CENTURY_SPEED) },
      };
    }
  }

  /**
   * the people's whisper: the Touch holds a band of plains folk — the next click on the ground sets them down. The camera
   * goes down to the ringed spot (green, near water, warm enough, the morning side), and time that was racing slows to
   * WATCH_SPEED (10×) so their first day can be watched: the band at a brisk walk on screen and their daylight in about
   * a minute. The 'wait' whisper's "let the day pass" (DAY_SPEED, 100×) then brings the night on in seconds. (It slowed to
   * 10× before too, but that was 100 ticks a second, the same pace "let the day pass" asked for, so the button did
   * nothing.)
   */
  private dropPeople(planet: number): void {
    const pv = this.host.view.planet(planet);
    if (pv) this.spot ??= this.findSpot(pv);
    const sp = this.spot;
    if (sp) this.host.lookAt(sp.planet, sp.pos, 520);
    if (this.host.view.speed > WATCH_SPEED) this.host.setSpeed(WATCH_SPEED);
    const p = this.host.powers.get('people');
    if (p) { this.deps.arm(p, { species: 'plains-folk', count: 30 }); this.armedPeople = true; return; }
    const poi = this.host.poi?.('homestead');
    const pos = sp?.pos ?? poi?.pos ?? this.host.focusGround()?.dir;
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
  /** where the whisper is on screen while it speaks (names over the world keep out of it), else null */
  speaking(): DOMRect | null {
    if (this.stage !== 'whisper' || this.card.hidden || !this.card.classList.contains('gn-on') || this.card.classList.contains('gn-away')) return null;
    const r = this.card.getBoundingClientRect();
    return r.width > 0 ? r : null;
  }

  /** test surface: light the star now (as the first touch would) */
  touchDark(): void { this.ignite(); }
  /** test surface: the stage's clock begins again now (after the opening's clock was swapped for a held one) */
  restartStageClock(): void { this.stageAt = this.now(); if (this.stage === 'dark') this.t0 = this.stageAt; }
}

function mean(pv: PlanetView, f: Parameters<PlanetView['fields']['get']>[0]): number {
  const a = pv.fields.get(f);
  if (!a || !a.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i += 7) s += a[i];
  return s / Math.ceil(a.length / 7);
}

/** cells holding water or ice deeper than `over` (every cell: a poured pool is small) */
function wetCells(pv: PlanetView, over: number): number {
  const w = pv.fields.get('water'), ice = pv.fields.get('ice');
  let n = 0;
  const N = Math.max(w?.length ?? 0, ice?.length ?? 0);
  for (let i = 0; i < N; i++) if ((w ? w[i] : 0) > over || (ice ? ice[i] : 0) > over) n++;
  return n;
}

function fraction(pv: PlanetView, f: Parameters<PlanetView['fields']['get']>[0], over: number): number {
  const a = pv.fields.get(f);
  if (!a || !a.length) return 0;
  let n = 0, m = 0;
  for (let i = 0; i < a.length; i += 7) { m++; if (a[i] > over) n++; }
  return n / Math.max(1, m);
}

/** the direction of the sun in a world's body frame (unit) */
function bodySun(pv: PlanetView): [number, number, number] {
  const q = pv.quat, s = pv.sunDir;
  const x = s[0], y = s[1], z = s[2], qx = -q[0], qy = -q[1], qz = -q[2], qw = q[3];
  const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
}

/** is it night at a point of a world (the sun below its horizon) */
function isNight(pv: PlanetView, u: ArrayLike<number>): boolean {
  const b = bodySun(pv);
  return b[0] * u[0] + b[1] * u[1] + b[2] * u[2] < -0.04;
}
