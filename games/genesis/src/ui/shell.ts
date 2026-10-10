// GENESIS — the UI shell (CONTRACT.md §16): builds every panel and routes every input to the right one.
//
//   keyboard  → keybinds (rebindable) → actions; held camera keys → the camera's own key codes each frame
//   mouse     → a gesture (middle button / G held) · the armed tool · the hand (grab, throw, stroke, slap) · the camera
//   gamepad   → the virtual cursor (left stick) acts as the mouse; RT is the left button, LT draws gestures, the right
//               stick turns the camera or points the radial; buttons map to actions through the same registry
//
// Windows stack: opening one closes the game menu and draws over whatever is open (Panel's z-order). While a veiled
// window is open the world takes no acts — no palette, no "do this", no casting — only the window keys and time.
// Esc (or B) closes the innermost thing: a popover, the aim of a throw, the radial, a gesture, the palette, the "do
// this" field, a tool's second pick, the armed tool, a window, the selection — and with nothing left, opens the game
// menu, but never within 0.4 s of having closed something (pressing Esc twice to be sure nothing is armed must not land
// in the menu).
//
// Every frame the shell lays out what shares the bottom of the screen (toasts sit above the dock and the tool card;
// the ticker stops short of the dock), marks the world layer busy while a tool, a gesture or the hand owns the pointer
// (settlement names and markers then let presses through to the world), and hushes names and markers while the
// radial, the palette or a gesture card is up.

import type { IUniform } from 'three';
import type { InputState } from '../render/camera/common.ts';
import type { EntityRef } from '../sim/types.ts';
import type { UiHost, InspectRef, GroundHit } from './host.ts';
import type { Power } from './powers.ts';
import { Hud } from './hud.ts';
import { Inspector } from './inspector.ts';
import { Palette } from './palette.ts';
import { Radial } from './radial.ts';
import { Freeform } from './freeform.ts';
import { Tools, type BrushPreview } from './tools.ts';
import { HandInput, type PtrSample } from './handinput.ts';
import { Gestures } from './gestures.ts';
import { Overlays } from './overlays.ts';
import { Chronicle } from './chronicle.ts';
import { Settings } from './settings.ts';
import { Saves } from './saves.ts';
import { Help } from './help.ts';
import { Menu } from './menu.ts';
import { Gamepad } from './gamepad.ts';
import { Catalog } from './catalog.ts';
import { CreatureMarks } from './creatures.ts';
import { Opening } from './opening.ts';
import { ACTION_BY_ID, comboLabel, splitCombo } from './keybinds.ts';
import { isTyping } from './dom.ts';
import { humanize } from './words.ts';

export interface ShellDeps {
  host: UiHost;
  input: InputState;
  /** the camera's mode (the fly camera reads other keys) */
  cameraMode(): string;
  camera: { system(): void; fly(): void; home(): void; follow(): void; look(): void };
  /** a plain left click on the world (select / inspect / recentre / fly to a world) */
  click(x: number, y: number): void;
  setUi(v: boolean): void;
  uiVisible(): boolean;
  setBrush(b: BrushPreview | null): void;
  uniformsOf(planet: number): Record<string, IUniform> | null;
  /** thin the cloud shell while a map overlay is on (0 = as the weather has it, 1 = gone) */
  cloudFade(k: number): void;
  /** the opening's camera: 'star' (the system from the dark), 'world' (the home world turning into view) */
  openingCamera?(shot: 'star' | 'world'): void;
  save(): Promise<ArrayBuffer | null>;
  load(bytes: ArrayBuffer): Promise<{ ok: boolean; msg?: string }>;
  thumb(): Promise<string | null>;
  scenario: string;
  seed: number;
  audioReady(): boolean;
  /** the dev overlay */
  dev: boolean;
  /** HUD per-frame inputs the shell cannot know (render stats, projections) */
  hudFrame(): Omit<import('./hud.ts').HudFrame, 'open' | 'labels' | 'ticker'>;
}

/** camera action → the key code the camera controllers read (orbit / fly) */
const CAM_KEYS: Record<string, [string, string]> = {
  'cam.forward': ['KeyW', 'KeyW'], 'cam.back': ['KeyS', 'KeyS'], 'cam.left': ['KeyA', 'KeyA'], 'cam.right': ['KeyD', 'KeyD'],
  'cam.turnLeft': ['KeyQ', 'KeyQ'], 'cam.turnRight': ['KeyE', 'KeyE'], 'cam.tiltUp': ['KeyR', 'Space'], 'cam.tiltDown': ['KeyF', 'KeyC'],
};

/** what still works while a veiled window (settings, saves, the controls card, the menu) is open */
const MODAL_OK = new Set(['ui.settings', 'ui.saves', 'ui.help', 'ui.menu', 'ui.quicksave', 'ui.quickload', 'ui.chronicle', 'ui.hide', 'tool.cancel',
  'time.pause', 'time.speed1', 'time.speed10', 'time.speed100', 'time.speed1000', 'time.faster', 'time.slower', 'time.stepTick', 'time.stepHour', 'time.stepDay']);

type PressKind = 'none' | 'tool' | 'hand' | 'camera' | 'gesture' | 'right';

export class Shell {
  readonly hud: Hud;
  readonly inspector: Inspector;
  readonly palette: Palette;
  readonly radial: Radial;
  readonly freeform: Freeform;
  readonly tools: Tools;
  readonly hand: HandInput;
  readonly gestures: Gestures;
  readonly overlays: Overlays;
  readonly chronicle: Chronicle;
  readonly settings: Settings;
  readonly saves: Saves;
  readonly help: Help;
  readonly menu: Menu;
  readonly pad: Gamepad;
  readonly catalog: Catalog;
  readonly creatures: CreatureMarks;
  readonly opening: Opening;
  private deps: ShellDeps;
  private host: UiHost;
  /** the mouse's last position (CSS px), null when it left the canvas */
  pointer: [number, number] | null = null;
  private press: PressKind = 'none';
  /** a press that began on a settlement's name: a plain click there selects that settlement */
  private pressLabel: { planet: number; id: number } | null = null;
  private downX = 0;
  private downY = 0;
  private rightDownAt = 0;
  private rightMoved = 0;
  /** held hold-actions from the keyboard and the pad */
  private heldKeys = new Set<string>();
  private heldPad = new Set<string>();
  private gestureByKey = false;
  private padPrimary = false;
  private padGesture = false;
  /** the pad button whose press went to the interface (its release is the interface's too) */
  private padUiHeld: string | null = null;
  private lastPadPointer: [number, number] | null = null;
  /** when Esc (or a panel's own close) last dismissed something */
  private dismissedAt = -1e9;
  /** the key code of the action being run from the keyboard (an aimed throw waits for its release) */
  private actionKey: string | null = null;
  private aimCode: string | null = null;
  private layoutAt = 0;
  private layoutKey = '';

  constructor(parent: HTMLElement, deps: ShellDeps) {
    this.deps = deps;
    const host = (this.host = deps.host);
    this.catalog = new Catalog(host);
    this.hud = new Hud(parent, {
      setSpeed: (x) => host.setSpeed(x),
      step: (t) => { void host.step(t); },
      flyTo: (id) => host.flyTo(id),
      lookAt: (planet, pos) => host.lookAt(planet, pos),
      selectSettlement: (planet, id) => host.select({ kind: 'settlement', id, planet }),
      action: (id) => this.action(id),
      hint: (id) => host.keybinds.hint(id),
    }, deps.dev);
    const root = this.hud.root, world = this.hud.world;
    this.hud.toasts.actions.select = (ref: EntityRef) => host.select(ref);
    this.hud.toasts.words = (text, planet) => {
      const p = planet ?? host.primary();
      return humanize(host.view, p, text, { dayHours: host.view.planet(p)?.params.dayHours });
    };
    this.tools = new Tools(root, world, { host, setBrush: (b) => deps.setBrush(b) });
    this.inspector = new Inspector(root, {
      query: (q, args) => host.query(q, args),
      cmd: (c) => host.cmd(c),
      date: (planet, tick) => host.date(planet, tick),
      select: (ref) => host.select(ref),
      lookAt: (ref) => host.lookAtEntity(ref),
      follow: (ref) => host.follow(ref),
      isFollowing: (ref) => host.isFollowing(ref),
      powers: host.powers,
      arm: (p, preset) => this.arm(p, preset),
      live: (ref) => this.live(ref),
      planetName: (id) => host.view.planet(id)?.name ?? 'the world',
      dayHours: (id) => host.view.planet(id)?.params.dayHours ?? 24,
      hint: (id) => host.keybinds.hint(id),
    });
    this.palette = new Palette(root, world, host, {
      arm: (p) => this.arm(p),
      castNow: (p, here) => void this.tools.castOnce(p, here),
      openLaw: (path) => this.openLaws(path),
      freeform: (text) => this.openFreeform(text),
      goTo: (ref, select) => this.goTo(ref, select),
      catalog: this.catalog,
    });
    this.palette.onClose = () => this.noteDismiss();
    // the radial is drawn over the panels (a card or the inspector never hides its slots); it is not scaled
    this.radial = new Radial(root, host, (p) => this.arm(p), (cat) => this.openPalette(`!${cat.toLowerCase()} `));
    this.freeform = new Freeform(root, world, host, { arm: (p) => this.arm(p), openLaw: (path) => this.openLaws(path), catalog: this.catalog });
    this.freeform.onClose = () => this.noteDismiss();
    this.catalog.onLaws = () => { if (this.palette.isOpen) this.palette.refresh(); };
    this.hand = new HandInput(world, host, this.catalog);
    this.hand.slapMod = (e) => host.keybinds.modifierDown('hand.slapMod', e);
    this.hand.modName = () => comboLabel(host.keybinds.keysOf('hand.slapMod')[0] ?? 'Alt');
    this.hand.throwKey = () => host.keybinds.hint('hand.throw') || '⇧ E';
    this.hand.onLongPress = (x, y) => { this.press = 'none'; this.radial.open(x, y, 'click'); };
    this.gestures = new Gestures(root, world, {
      host,
      cast: (p, hit, radius) => void this.tools.castWith(p, hit, radius),
    });
    this.overlays = new Overlays(root, world, { host, uniformsOf: (id) => deps.uniformsOf(id), palette: () => host.prefs.value.ui.palette, cloudFade: (k) => deps.cloudFade(k) });
    this.chronicle = new Chronicle(root, host);
    this.pad = new Gamepad(world);
    this.settings = new Settings(root, { host, nextPadButton: (s) => this.pad.nextButton(s), audioReady: () => deps.audioReady() });
    this.saves = new Saves(root, { host, save: () => deps.save(), load: (b) => deps.load(b), thumb: () => deps.thumb(), scenario: deps.scenario, seed: deps.seed, dev: deps.dev });
    this.help = new Help(root, host);
    this.menu = new Menu(root, host);
    this.creatures = new CreatureMarks(world, host);
    this.opening = new Opening(root, world, {
      host,
      action: (id) => this.action(id),
      openFreeform: (text) => this.openFreeform(text),
      openPalette: (q) => this.openPalette(q),
      openRadialAt: (cat) => this.radial.openCategory(cat),
      newWorld: (scenario) => this.saves.newWorld(scenario, deps.seed),
      openSaves: () => this.openWindow('saves'),
      camera: (shot) => deps.openingCamera?.(shot),
    });
    this.pad.onButton = (name, down) => this.padButton(name, down);
    // preferences that are the interface's own
    host.prefs.onChange((p, what) => { if (what.startsWith('ui') || what.startsWith('pad') || what === '*') this.applyUiPrefs(); });
    this.applyUiPrefs();
    window.addEventListener('resize', () => this.applyUiPrefs());
    // labels built from bindings follow a rebinding
    host.keybinds.listen(() => { this.hud.setHint(host.prefs.value.ui.hints); this.hud.refreshKeys(); this.tools.refreshKeys(); });
    // the portal's pause button opens the game menu
    (window as unknown as { __PAUSE__?: { toggle(): void; pause(): void } }).__PAUSE__ = { toggle: () => this.action('ui.menu'), pause: () => { if (!this.menu.isOpen) this.openWindow('menu'); } };
  }

  /**
   * The interface scale: "auto" follows the window (×1 at 820 px tall, up to ×2 — readable at 1080p–4K), a chosen one
   * holds; and the palette, motion, hints, toast time
   */
  private applyUiPrefs(): void {
    const u = this.host.prefs.value.ui;
    document.documentElement.style.setProperty('--gn-ui-scale', String(this.uiScale()));
    document.body.dataset.cvd = u.palette;
    document.body.classList.toggle('gn-reduce-motion', u.reduceMotion);
    this.hud.setHint(u.hints);
    this.hud.toasts.life = Math.max(this.hud.toasts.life > 60000 ? this.hud.toasts.life : 0, u.toastSeconds * 1000);
    const p = this.host.prefs.value.pad;
    this.pad.enabled = p.enabled;
    this.pad.deadzone = p.deadzone;
    this.pad.speed = p.cursorSpeed;
  }

  /** the interface scale now (the auto one from the window, or the player's) */
  uiScale(): number {
    const u = this.host.prefs.value.ui;
    return u.autoScale ? autoScale() : u.scale;
  }

  // ───────────────────────────── doors ─────────────────────────────

  arm(p: Power, preset: Record<string, unknown> = {}): void {
    if (this.modal()) return;
    this.palette.close();
    this.radial.close();
    this.tools.arm(p, preset);
    this.host.sound('ui.arm');
  }

  openFreeform(text = ''): void {
    if (this.modal()) return;
    this.palette.close();
    this.radial.close();
    this.freeform.open(text, this.host.cursorGround() ?? this.host.focusGround());
  }

  openPalette(query = ''): void {
    if (this.modal()) return;
    this.radial.close();
    this.freeform.close();
    const here: GroundHit | null = this.host.cursorGround() ?? this.host.focusGround();
    this.palette.open(query, { pointer: this.pointer, here });
  }

  openLaws(path?: string): void {
    const pid = this.host.primary();
    this.host.select({ kind: 'planet', id: pid, planet: pid });
    if (path) this.inspector.open({ kind: 'planet', id: pid, planet: pid }, path);
  }

  /** a place or a being chosen from a list: fly there (and select it) */
  goTo(ref: EntityRef, select: boolean): void {
    if (ref.kind === 'planet') { this.host.flyTo(ref.id); if (select) this.host.select(ref); return; }
    if (select) this.host.select(ref);
    this.host.lookAtEntity(ref);
  }

  /** open a veiled window: the game menu gives way to it, the transient pickers close, it draws on top */
  openWindow(which: 'settings' | 'saves' | 'help' | 'menu'): void {
    const p = which === 'settings' ? this.settings : which === 'saves' ? this.saves : which === 'help' ? this.help : this.menu;
    if (which !== 'menu' && this.menu.isOpen) this.menu.close();
    this.palette.close(); this.radial.close(); this.freeform.close();
    if (this.gestures.active || this.gestures.armed) this.gestures.cancel();
    this.hand.cancelAim();
    this.hud.closePopovers();
    if (p.isOpen) p.panel.raise(); else p.open();
  }

  /** the mirror's live view of a disaster / weather / creature / ship (the inspector's "now") */
  private live(ref: InspectRef): Record<string, unknown> | null {
    const v = this.host.view;
    if (ref.kind === 'disaster' || ref.kind === 'weather') {
      for (const pv of v.planets) {
        const l = ref.kind === 'disaster' ? pv.disasters : pv.weather;
        const x = (l as { id: number }[]).find((q) => q.id === ref.id);
        if (x) return { ...(x as unknown as Record<string, unknown>), planet: pv.id };
      }
      return null;
    }
    if (ref.kind === 'creature') return (v.creatures.find((c) => c.id === ref.id) as unknown as Record<string, unknown>) ?? null;
    if (ref.kind === 'ship') return (v.ships.find((s) => s.id === ref.id) as unknown as Record<string, unknown>) ?? null;
    return null;
  }

  /** run an action by id (keys, the pad, the palette, the dock, the menu) */
  action(id: string): void {
    const host = this.host;
    const cur = this.cursor();
    // a veiled window is up: the world waits (time and the window keys still work)
    if (this.modal() && !MODAL_OK.has(id)) { host.sound('ui.error'); return; }
    if (id.startsWith('ui.radial@')) { const [x, y] = id.slice(10).split(',').map(Number); this.radial.open(x, Math.max(300, y), 'click'); return; }
    switch (id) {
      case 'cam.system': this.deps.camera.system(); return;
      case 'cam.fly': this.deps.camera.fly(); return;
      case 'cam.home': this.deps.camera.home(); return;
      case 'cam.follow': this.deps.camera.follow(); return;
      case 'cam.look': this.deps.camera.look(); return;
      case 'time.pause': host.setSpeed(host.view.speed === 0 ? (this.lastSpeed || 1) : (this.lastSpeed = host.view.speed, 0)); return;
      case 'time.speed1': host.setSpeed(1); return;
      case 'time.speed10': host.setSpeed(10); return;
      case 'time.speed100': host.setSpeed(100); return;
      case 'time.speed1000': host.setSpeed(1000); return;
      case 'time.faster': case 'time.slower': {
        const presets = [0, 1, 10, 100, 1000];
        const i = presets.indexOf(host.view.speed);
        host.setSpeed(presets[Math.max(0, Math.min(presets.length - 1, (i < 0 ? 1 : i) + (id === 'time.faster' ? 1 : -1)))]);
        return;
      }
      case 'time.stepTick': void host.step(1); return;
      case 'time.stepHour': void host.step(60); return;
      case 'time.stepDay': void host.step(Math.round((host.view.planet(host.primary())?.params.dayHours ?? 24) * 60)); return;
      case 'time.rewindHour': void host.cmd({ k: 'time.rewind', hoursAgo: 1, planet: host.primary() }); return;
      case 'ui.palette': if (this.palette.isOpen) this.palette.close(); else this.openPalette(); return;
      case 'ui.freeform': if (this.freeform.isOpen) this.freeform.close(); else this.openFreeform(); return;
      case 'ui.radial': { const p = cur ?? [window.innerWidth / 2, window.innerHeight / 2]; if (this.radial.isOpen) this.radial.close(); else this.radial.open(p[0], p[1], 'click'); return; }
      case 'ui.gesture':
        // from the dock, the palette or the menu: the next left drag on the world draws the shape
        if (this.gestures.active) { this.gestures.end(); this.gestureByKey = false; return; }
        this.gestures.arm(!this.gestures.armed);
        if (this.gestures.armed) host.toast({ text: 'Draw a shape on the world (drag).', kind: 'info', ms: 2500 });
        return;
      case 'tool.apply': {
        if (this.tools.armed) void this.tools.castHere();
        else if (cur) this.deps.click(cur[0], cur[1]);
        return;
      }
      case 'tool.repeat': void this.tools.repeat(); return;
      case 'tool.cancel': this.cancel(); return;
      case 'tool.bigger': this.tools.resize(1.25); return;
      case 'tool.smaller': this.tools.resize(1 / 1.25); return;
      case 'tool.stronger': this.tools.strengthen(1); return;
      case 'tool.weaker': this.tools.strengthen(-1); return;
      case 'hand.take': void this.hand.take(cur); return;
      case 'hand.throw':
        // from the keyboard: aim while the key is held, throw on its release; from anything else: throw now
        if (this.actionKey) { if (this.hand.beginAim()) this.aimCode = this.actionKey; }
        else void this.hand.throwAt(cur);
        return;
      case 'hand.slap': void this.hand.keyAct(true, cur); return;
      case 'hand.stroke': void this.hand.keyAct(false, cur); return;
      case 'ui.chronicle': this.chronicle.toggle(); if (this.chronicle.isOpen) this.chronicle.panel.raise(); return;
      case 'ui.overlayNext': this.overlays.cycle(1); return;
      case 'ui.overlayPrev': this.overlays.cycle(-1); return;
      case 'ui.overlayOff': this.overlays.set(null); return;
      case 'ui.inspect': {
        if (!cur) return;
        const ent = host.entityAt(cur[0], cur[1]);
        if (ent) { host.select(ent); return; }
        const g = host.groundAt(cur[0], cur[1]);
        if (g) host.select({ kind: 'cell', id: g.cell, planet: g.planet });
        return;
      }
      case 'ui.laws': { const s = host.selected(); if (s?.kind === 'planet') host.select(null); else this.openLaws(); return; }
      case 'ui.settings': if (this.settings.isOpen) this.settings.close(); else this.openWindow('settings'); return;
      case 'ui.saves': if (this.saves.isOpen) this.saves.close(); else this.openWindow('saves'); return;
      case 'ui.quicksave': void this.saves.quicksave(); return;
      case 'ui.quickload': void this.saves.quickload(); return;
      case 'ui.help': if (this.help.isOpen) this.help.close(); else this.openWindow('help'); return;
      case 'ui.menu': if (this.menu.isOpen) this.menu.close(); else this.openWindow('menu'); return;
      case 'ui.hide': this.deps.setUi(!this.deps.uiVisible()); return;
    }
  }
  private lastSpeed = 1;

  /** something was just closed by Esc or by a panel's own Esc */
  noteDismiss(): void { this.dismissedAt = performance.now(); }

  /** Esc / B: close the innermost thing */
  cancel(): void {
    if (this.settings.isOpen && this.settingsCapturing()) return;
    const done = (): void => { this.noteDismiss(); };
    if (this.opening.cancel()) return done();
    if (this.hud.closePopovers()) return done();
    if (this.hand.isAiming) { this.hand.cancelAim(); return done(); }
    if (this.radial.isOpen) { this.radial.back(); return done(); }
    if (this.gestures.active || this.gestures.armed) { this.gestures.cancel(); this.gestureByKey = false; return done(); }
    if (this.palette.isOpen) { this.palette.close(); return done(); }
    if (this.freeform.isOpen) { this.freeform.close(); return done(); }
    // the newest open window first
    const wins = [this.settings, this.saves, this.help, this.menu, this.chronicle].filter((p) => p.isOpen)
      .sort((a, b) => Number(b.panel.root.style.zIndex || 0) - Number(a.panel.root.style.zIndex || 0));
    if (wins.length) { wins[0].close(); return done(); }
    if (this.tools.cancelStep()) return done();
    if (this.tools.isArmed) { this.tools.disarm(); return done(); }
    if (this.host.selected()) { this.host.select(null); return done(); }
    if (!this.deps.uiVisible()) { this.deps.setUi(true); return done(); }
    if (performance.now() - this.dismissedAt < 400) return;
    this.openWindow('menu');
  }

  private settingsCapturing(): boolean {
    return !!this.settings.panel.root.querySelector('.gn-capturing');
  }

  /** a modal window (veiled) is open: world input pauses */
  modal(): boolean {
    return this.settings.isOpen || this.saves.isOpen || this.help.isOpen || this.menu.isOpen || this.opening.modal;
  }

  // ───────────────────────────── keyboard ─────────────────────────────

  keyDown(e: KeyboardEvent): void {
    if (isTyping(e)) return;
    const kb = this.host.keybinds;
    if (this.radial.isOpen) {
      const was = this.radial.isOpen;
      if (this.radial.key(e)) { if (was && !this.radial.isOpen) this.noteDismiss(); return; }
    }
    if (e.code === 'Escape') { e.preventDefault(); if (!e.repeat) this.cancel(); return; }
    kb.down.add(e.code);
    if (e.repeat) { if (this.holdAllowed(e)) e.preventDefault(); return; }
    // hold actions start
    for (const id of kb.holdActions(e)) {
      if (this.heldKeys.has(id)) continue;
      this.heldKeys.add(id);
      if (id === 'ui.radial' && !this.modal()) { const p = this.cursor() ?? [window.innerWidth / 2, window.innerHeight / 2]; this.radial.open(p[0], p[1], 'hold'); e.preventDefault(); }
      if (id === 'ui.gesture' && !this.modal() && !this.gestures.active) { const p = this.cursor(); this.gestures.begin(p?.[0], p?.[1]); this.gestureByKey = true; e.preventDefault(); }
    }
    const press = kb.pressActions(e);
    if (press.length) {
      e.preventDefault();
      this.actionKey = e.code;
      try { this.action(press[0]); } finally { this.actionKey = null; }
    } else if (this.holdAllowed(e)) e.preventDefault();
  }

  /** the browser's own use of a key the game holds (Space scrolls, arrows scroll) is suppressed */
  private holdAllowed(e: KeyboardEvent): boolean {
    return this.host.keybinds.holdActions(e).length > 0;
  }

  keyUp(e: KeyboardEvent): void {
    const kb = this.host.keybinds;
    kb.down.delete(e.code);
    // the aimed throw's key was let go: throw
    if (this.aimCode && e.code === this.aimCode) {
      this.aimCode = null;
      if (this.hand.isAiming) void this.hand.releaseAim(this.cursor());
    }
    for (const id of [...this.heldKeys]) {
      if (kb.held(id)) continue;
      this.heldKeys.delete(id);
      if (id === 'ui.radial') this.radial.release();
      if (id === 'ui.gesture' && this.gestureByKey) { this.gestureByKey = false; this.gestures.end(); }
    }
  }

  blur(): void {
    this.host.keybinds.down.clear();
    for (const id of this.heldKeys) { if (id === 'ui.radial') this.radial.release(); if (id === 'ui.gesture' && this.gestures.active) this.gestures.cancel(); }
    this.heldKeys.clear();
    this.hand.cancel();
    this.aimCode = null;
    this.press = 'none';
  }

  /** the code part of the aimed throw's bound key (for tests / hints) */
  throwCode(): string { return splitCombo(this.host.keybinds.keysOf('hand.throw')[0] ?? 'Shift+KeyE').code; }

  // ───────────────────────────── pointer ─────────────────────────────

  /** the point that acts as the cursor: the gamepad's when it is in use, else the mouse */
  cursor(): [number, number] | null {
    return this.pad.pointer() ?? this.pointer;
  }

  /**
   * a press on the world (`t` is the event's own time; `label` the settlement whose name the press began on, if any —
   * names do not swallow presses: with a tool armed or the hand at work they pass through, else a click selects)
   */
  pointerDown(x: number, y: number, button: number, mods: { altKey: boolean; ctrlKey: boolean; shiftKey: boolean; metaKey: boolean }, t = performance.now(), label: { planet: number; id: number } | null = null): void {
    this.pointer = [x, y];
    this.downX = x; this.downY = y;
    this.pressLabel = label;
    if (this.radial.isOpen) return;
    if (this.modal()) return;
    if (button === 1) {
      // the middle button draws a gesture
      this.press = 'gesture';
      this.gestures.begin(x, y);
      return;
    }
    if (button === 2) { this.press = 'right'; this.rightDownAt = t; this.rightMoved = 0; return; }
    if (button !== 0) return;
    if (this.gestures.armed) { this.press = 'gesture'; this.gestures.begin(x, y); return; }
    if (this.gestures.active) { this.press = 'gesture'; this.gestures.point(x, y); return; }
    if (this.tools.isArmed && this.tools.down(x, y)) { this.press = 'tool'; return; }
    this.press = this.hand.down(x, y, mods as PointerEvent, t) === 'hand' ? 'hand' : 'camera';
  }

  pointerMove(x: number, y: number, dx: number, dy: number, buttons: number, t = performance.now(), pts: PtrSample[] | null = null): void {
    this.pointer = [x, y];
    const input = this.deps.input;
    if (this.gestures.active) { if (pts) for (const q of pts) this.gestures.point(q.x, q.y); else this.gestures.point(x, y); }
    switch (this.press) {
      case 'tool':
        this.tools.move(x, y);
        // a tool that does not paint lets the drag turn the world
        if (!this.tools.wantsDrag()) { input.dragL[0] += dx; input.dragL[1] += dy; }
        break;
      case 'hand': this.hand.move(x, y, t, pts); break;
      case 'camera': this.hand.move(x, y, t, pts); input.dragL[0] += dx; input.dragL[1] += dy; break;
      case 'right': this.rightMoved += Math.abs(dx) + Math.abs(dy); break;
    }
    if (buttons & 2) { input.dragR[0] += dx; input.dragR[1] += dy; }
  }

  pointerUp(x: number, y: number, button: number, t = performance.now()): void {
    this.pointer = [x, y];
    const kind = this.press;
    const label = this.pressLabel;
    this.press = 'none';
    this.pressLabel = null;
    if (button === 1 || kind === 'gesture') { if (!this.gestureByKey && !this.padGesture) this.gestures.end(); return; }
    if (button === 2 || kind === 'right') {
      // a right click (no drag) puts the armed tool away
      if (kind === 'right' && this.rightMoved < 6 && t - this.rightDownAt < 600) {
        if (this.hand.isAiming) this.hand.cancelAim();
        else if (this.tools.isArmed) this.tools.disarm();
        else if (this.host.selected()) this.host.select(null);
      }
      return;
    }
    if (kind === 'tool') { this.tools.up(x, y); return; }
    if (kind === 'hand' || kind === 'camera') {
      const r = this.hand.up(x, y, t);
      if (r === 'click') {
        if (label) this.host.select({ kind: 'settlement', id: label.id, planet: label.planet });
        else this.deps.click(x, y);
      }
    }
  }

  pointerLeave(): void { this.pointer = null; }

  /** wheel over the world: zoom; Ctrl: brush size; Alt: brush strength */
  wheel(dy: number, mods: { ctrlKey: boolean; altKey: boolean }): void {
    if (this.modal()) return;
    if (mods.ctrlKey && this.tools.isArmed) { this.tools.resize(dy > 0 ? 1 / 1.12 : 1.12); return; }
    if (mods.altKey && this.tools.isArmed) { this.tools.strengthen(dy > 0 ? -1 : 1); return; }
    this.deps.input.wheel += dy;
  }

  // ───────────────────────────── gamepad ─────────────────────────────

  private padButton(name: string, down: boolean): void {
    const kb = this.host.keybinds;
    const ids = kb.padActions(name);
    const p = this.pad.pointer() ?? [this.pad.x, this.pad.y];
    // menus first: the radial, the palette, panels
    if (down && this.radial.isOpen) {
      if (name === 'A' || name === 'RS') { this.radial.confirm(); return; }
      if (name === 'B') { this.radial.back(); if (!this.radial.isOpen) this.noteDismiss(); return; }
    }
    if (down && this.palette.isOpen) {
      if (name === 'Down' || name === 'Right') { this.palette.move(1); return; }
      if (name === 'Up' || name === 'Left') { this.palette.move(-1); return; }
      if (name === 'A') { this.palette.accept(false); return; }
      if (name === 'X') { this.palette.accept(true); return; }
      if (name === 'B' || name === 'Y') { this.palette.close(); return; }
    }
    // A / RT with the virtual cursor over the interface: press what is under it (a dock button, a card's control, an
    // inspector action) as a mouse click would; a control that takes values (a slider, a list) is focused so the D-pad
    // sets it
    if (name === 'A' || name === 'RT') {
      const t = down && this.pad.active ? this.padUiTarget(p) : null;
      if (t) { this.padPress(t); this.padUiHeld = name; return; }
      if (!down && this.padUiHeld === name) { this.padUiHeld = null; return; }
    }
    const focus = this.focusedPanel();
    if (down && (this.modal() || this.chronicle.isOpen || this.freeform.isOpen || focus) && this.panelNav(name, focus)) return;
    // pressing on the world takes the focus away from a panel
    if (down && focus && (name === 'A' || name === 'RT')) (document.activeElement as HTMLElement | null)?.blur();
    for (const id of ids) {
      const a = ACTION_BY_ID.get(id);
      if (!a) continue;
      if (a.hold) {
        if (down) this.heldPad.add(id); else this.heldPad.delete(id);
        if (this.modal()) continue;
        if (id === 'hand.primary') this.padPrimaryButton(down, p);
        if (id === 'ui.gesture') {
          if (down && !this.gestures.active) { this.padGesture = true; this.gestures.begin(p[0], p[1]); }
          if (!down && this.padGesture) { this.padGesture = false; this.gestures.end(); }
        }
        if (id === 'ui.radial' && down) { if (this.radial.isOpen) this.radial.confirm(); else this.radial.open(p[0], p[1], 'click'); }
        continue;
      }
      if (down) this.action(id);
    }
  }

  /** RT: the left button at the virtual cursor */
  private padPrimaryButton(down: boolean, p: [number, number]): void {
    if (down && !this.padPrimary) { this.padPrimary = true; this.lastPadPointer = [p[0], p[1]]; this.pointerDown(p[0], p[1], 0, { altKey: false, ctrlKey: false, shiftKey: false, metaKey: false }); }
    else if (!down && this.padPrimary) { this.padPrimary = false; this.pointerUp(p[0], p[1], 0); }
  }

  /** the interface element under the virtual cursor that a press would work, or null over the world */
  private padUiTarget(p: [number, number]): HTMLElement | null {
    const el = document.elementFromPoint(p[0], p[1]) as HTMLElement | null;
    if (!el || el.tagName === 'CANVAS' || !el.closest('.gn-ui, .gn-world-layer')) return null;
    return el.closest<HTMLElement>('button, a, input, select, textarea, [role="button"], [tabindex], .gn-pal-row, .gn-slabel-name, .gn-marker, .gn-crea') ?? (el.closest('.gn-panel') ? el : null);
  }

  /** a gamepad press on an interface element */
  private padPress(t: HTMLElement): void {
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) { t.focus(); return; }
    if (t.matches('button, a, [role="button"], [tabindex], .gn-pal-row, .gn-slabel-name, .gn-marker, .gn-crea')) {
      if (t.tabIndex >= 0 || t instanceof HTMLButtonElement) t.focus({ preventScroll: true });
      t.click();
    }
  }

  /** a panel holding the keyboard focus (the gamepad pressed into it): the D-pad works there */
  private focusedPanel(): HTMLElement | null {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body) return null;
    return a.closest<HTMLElement>('.gn-panel');
  }

  /** D-pad / A / B inside panels: move focus between controls, press the focused one, set a focused slider or list */
  private panelNav(name: string, focused: HTMLElement | null = null): boolean {
    const open = [this.settings, this.saves, this.help, this.menu, this.chronicle].filter((x) => x.isOpen)
      .sort((a, b) => Number(b.panel.root.style.zIndex || 0) - Number(a.panel.root.style.zIndex || 0));
    const panel = (this.opening.modal ? this.opening.root : null) ?? open[0]?.panel.root ?? (this.freeform.isOpen ? this.freeform.root : null) ?? focused;
    if (!panel) return false;
    const items = Array.from(panel.querySelectorAll<HTMLElement>('button, select, input, [tabindex]')).filter((x) => x.offsetParent !== null && !(x as HTMLButtonElement).disabled);
    if (!items.length) return false;
    const cur = document.activeElement as HTMLElement | null;
    const i = cur ? items.indexOf(cur) : -1;
    if (name === 'B') { cur?.blur(); this.cancel(); return true; }
    // a focused slider or list: left / right set it
    if (cur && i >= 0 && (name === 'Left' || name === 'Right')) {
      const d = name === 'Right' ? 1 : -1;
      if (cur instanceof HTMLInputElement && cur.type === 'range') {
        const lo = Number(cur.min), hi = Number(cur.max);
        const st = cur.step === 'any' || !Number(cur.step) ? (hi - lo) / 40 : Math.max(Number(cur.step), (hi - lo) / 40);
        cur.value = String(Math.min(hi, Math.max(lo, Number(cur.value) + d * st)));
        cur.dispatchEvent(new Event('input', { bubbles: true }));
        cur.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      if (cur instanceof HTMLSelectElement) {
        cur.selectedIndex = Math.min(cur.options.length - 1, Math.max(0, cur.selectedIndex + d));
        cur.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    if (name === 'A') {
      // over the world with only a non-modal panel focused, A is the world's again
      if (focused && panel === focused && !(cur && i >= 0)) return false;
      const t = cur && i >= 0 ? cur : items[0];
      if (t instanceof HTMLInputElement && t.type !== 'range' && t.type !== 'checkbox') t.focus(); else t.click();
      return true;
    }
    const dir = name === 'Down' || name === 'Right' ? 1 : name === 'Up' || name === 'Left' ? -1 : 0;
    if (!dir) return false;
    items[(i + dir + items.length) % items.length].focus();
    return true;
  }

  // ───────────────────────────── per frame ─────────────────────────────

  /** before the camera runs: held keys and the pad into the camera's input */
  preFrame(dt: number): void {
    const input = this.deps.input;
    const pf = this.pad.poll(dt);
    const kb = this.host.keybinds;
    input.keys.clear();
    input.shift = kb.down.has('ShiftLeft') || kb.down.has('ShiftRight');
    const fly = this.deps.cameraMode() === 'fly';
    const typing = isTyping({ target: document.activeElement } as unknown as Event);
    const held = (id: string) => !typing && !this.modal() && (this.heldKeys.has(id) && kb.held(id) || this.heldPad.has(id));
    for (const [id, codes] of Object.entries(CAM_KEYS)) if (held(id)) input.keys.add(fly ? codes[1] : codes[0]);
    if (held('cam.zoomIn')) input.wheel -= dt * 600;
    if (held('cam.zoomOut')) input.wheel += dt * 600;
    if (pf.connected) {
      const look = this.host.prefs.value.pad.lookSpeed;
      const inv = this.host.prefs.value.pad.invertY ? -1 : 1;
      if (this.radial.isOpen) this.radial.stick(pf.rx || pf.lx, pf.ry || pf.ly);
      else if ((pf.rx || pf.ry) && !this.modal()) { input.dragR[0] += pf.rx * 520 * dt * look; input.dragR[1] += pf.ry * 360 * dt * look * inv; }
      // the virtual cursor drives hover, the hand, tools and gestures like the mouse
      const p = this.pad.pointer();
      if (p) {
        const l = this.lastPadPointer;
        if (!l || l[0] !== p[0] || l[1] !== p[1]) {
          const dx = l ? p[0] - l[0] : 0, dy = l ? p[1] - l[1] : 0;
          this.lastPadPointer = [p[0], p[1]];
          if (!this.radial.isOpen) this.pointerMove(p[0], p[1], dx, dy, 0);
        }
        // edge pan
        if (this.host.prefs.value.game.edgePan && !this.radial.isOpen && !this.palette.isOpen && !this.modal()) {
          const W = window.innerWidth, H = window.innerHeight, m = 0.035;
          if (p[0] < W * m) input.keys.add('KeyA');
          if (p[0] > W * (1 - m)) input.keys.add('KeyD');
          if (p[1] < H * m) input.keys.add('KeyW');
          if (p[1] > H * (1 - m)) input.keys.add('KeyS');
        }
      }
    }
    // a sculpting brush held still keeps working
    const c = this.cursor();
    if (this.press === 'tool' && c) this.tools.hold(c[0], c[1]);
  }

  /** after the frame is rendered: everything that follows the world on screen */
  postFrame(dt = 0): void {
    const c = this.cursor();
    const host = this.host;
    this.tools.frame(this.tools.isArmed ? host.cursorGround() : null, c);
    if (!this.tools.isArmed) this.deps.setBrush(null);
    const pointerOwned = this.tools.isArmed || this.gestures.armed || this.gestures.active || this.press === 'tool' || this.press === 'gesture';
    this.hand.frame(this.press === 'none' || this.press === 'hand' || this.press === 'camera' ? c : null, pointerOwned);
    this.gestures.frame();
    this.overlays.frame();
    this.chronicle.frame();
    this.freeform.frame();
    this.palette.frame();
    this.saves.frame();
    this.inspector.tick(performance.now());
    // the world layer: busy (names and markers let presses through), hushed (names and markers hidden)
    const busy = pointerOwned || this.hand.busy || this.press !== 'none';
    const hush = this.radial.isOpen || this.palette.isOpen || this.gestures.active || this.gestures.armed || this.opening.hush;
    this.hud.setWorldMode(busy, hush);
    this.creatures.frame(hush);
    this.opening.frame(dt);
    const f = this.deps.hudFrame();
    this.hud.update({
      ...f,
      labels: host.prefs.value.ui.labels,
      ticker: host.prefs.value.ui.ticker,
      showFps: this.deps.dev || host.prefs.value.ui.showFps,
      open: {
        palette: this.palette.isOpen, radial: this.radial.isOpen, freeform: this.freeform.isOpen, gesture: this.gestures.active || this.gestures.armed,
        overlay: this.overlays.mode, chronicle: this.chronicle.isOpen, tool: this.tools.isArmed,
      },
    });
    this.hud.toasts.pump(host.view, performance.now(), host.primary());
    this.layout();
  }

  /**
   * What shares the bottom of the screen: the toasts sit above the dock and, when it reaches into their column, the
   * tool card (with the card and the inspector both up and little room left, they move to the top centre); the ticker
   * stops short of the dock. Measured at most ~8 times a second, written only when it changed.
   */
  private layout(): void {
    const now = performance.now();
    if (now - this.layoutAt < 120) return;
    this.layoutAt = now;
    const H = window.innerHeight;
    const s = this.uiScale();
    const dock = this.hud.dock.getBoundingClientRect();
    const card = this.tools.card.hidden ? null : this.tools.card.getBoundingClientRect();
    const toastW = Math.min(440, window.innerWidth * 0.4) * s + 18;
    let bottom = H - dock.top + 10;
    // the controls hint line over the dock, while it shows
    const hint = this.hud.hintRect();
    if (hint && hint.left < toastW) bottom = Math.max(bottom, H - hint.top + 8);
    let top = false;
    if (card && card.left < toastW) {
      bottom = Math.max(bottom, H - card.top + 10);
      // too little room above the card for the column: the toasts go to the top centre
      if (card.top < H * 0.42) top = true;
    }
    const tickerMax = Math.max(160, (dock.left - 36 - 18) / s);
    const key = `${Math.round(bottom)}|${top}|${Math.round(tickerMax)}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    this.hud.layout({ toastBottom: bottom, toastTop: top, tickerMax });
  }

  /** the selection changed (App.select): the inspector follows */
  selected(ref: InspectRef | null): void {
    this.inspector.open(ref);
  }

  /** test surface: what the UI shows */
  state(): Record<string, unknown> {
    return {
      palette: this.palette.isOpen, paletteSel: this.palette.isOpen ? this.palette.selected : null, radial: this.radial.state(), freeform: this.freeform.isOpen ? this.freeform.text : null,
      freeformPreview: this.freeform.isOpen ? this.freeform.previewText() : null,
      tool: this.tools.state(), hand: this.hand.stateName(), held: this.hand.held(), cursor: this.hand.cursor, gesture: this.gestures.last,
      overlay: this.overlays.state(), chronicle: this.chronicle.state(), settings: this.settings.isOpen, saves: this.saves.isOpen,
      help: this.help.isOpen, menu: this.menu.isOpen, inspector: this.inspector.selected, pad: this.pad.active, modal: this.modal(),
      opening: this.opening.state(), uiScale: this.uiScale(),
    };
  }
}

/** the interface scale that keeps text readable on this window: ×1 at 820 px tall and below, up to ×2 */
export function autoScale(): number {
  return Math.max(1, Math.min(2, Math.round((window.innerHeight / 820) * 20) / 20));
}
