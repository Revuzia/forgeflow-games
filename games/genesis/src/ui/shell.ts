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
// menu (while the opening's whispers speak: its scenario menu, "Another world?"), but never within 0.4 s of having
// closed something (pressing Esc twice to be sure nothing is armed must not land in the menu). Only the opening's star
// and fall take Esc first (the scenario menu at once: there is nothing else on screen to close).
// H hides the whole interface (never while a window is open: a hidden window would still hold the world); a note says
// how to bring it back. The key strip over the dock forgets each control once it has been used (and stays away while
// the opening speaks).
//
// Every frame the shell lays out what shares the bottom of the screen (toasts sit above the dock and the tool card;
// the ticker stops short of the dock), marks the world layer busy while a tool, a gesture or the hand owns the pointer
// (settlement names and markers then let presses through to the world), and hushes names and markers while the
// radial, the palette or a gesture card is up.

import type { IUniform } from 'three';
import type { InputState } from '../render/camera/common.ts';
import type { CommandResult, EntityRef } from '../sim/types.ts';
import { SPEED_PRESETS } from '../sim/types.ts';
import type { ContentPack } from '../sim/content.ts';
import type { UiHost, InspectRef, GroundHit } from './host.ts';
import type { Power } from './powers.ts';
import { categoryLabel } from './powers.ts';
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
import { Opening } from './opening.ts';
import { NewWorld } from './newworld.ts';
import { Mods, type ModLibrary, type BootProblem } from './mods.ts';
import { Photo } from './photo.ts';
import { CameraUi } from './cammodes.ts';
import type { LoadOutcome } from './saves.ts';
import { ACTION_BY_ID, LAYER_HOLD_CODES, SPEED_KEYS, comboLabel, splitCombo, type Context } from './keybinds.ts';
import { isTyping } from './dom.ts';
import { TimeGuard, installDownloadFallback } from './embed.ts';
import { Title } from './title.ts';
import { Credits } from './credits.ts';
import { GodPanel, SignPicker, type GodRow, type SacredPlaceRow } from './living.ts';
import { Invent } from './invent.ts';
import { humanize } from './words.ts';

export interface ShellDeps {
  host: UiHost;
  input: InputState;
  /** the camera's mode (the fly camera reads other keys) */
  cameraMode(): string;
  camera: { system(): void; fly(): void; home(): void; follow(): void; look(): void };
  /** a plain left click on the world (select / inspect / recentre / fly to a world) */
  click(x: number, y: number): void;
  /** the interface shown or hidden; `clean` (default: when hidden) also hides the site's bar — a clean frame */
  setUi(v: boolean, clean?: boolean): void;
  uiVisible(): boolean;
  setBrush(b: BrushPreview | null): void;
  uniformsOf(planet: number): Record<string, IUniform> | null;
  /** thin the cloud shell while a map overlay is on (0 = as the weather has it, 1 = gone) */
  cloudFade(k: number): void;
  /** the opening's camera: 'star' (the star from close, in the dark), 'world' (fall to the home world), 'turn' (the
   * world turning under the camera), 'done' */
  openingCamera?(shot: 'star' | 'world' | 'turn' | 'hold' | 'done'): void;
  /** the opening's light: exposure (stops, added) and a bloom multiplier */
  openingLight?(ev: number, bloom: number): void;
  /** is the camera still blending toward where it was sent (the opening's fall waits for it) */
  cameraBusy?(): boolean;
  /** may the page play sound yet */
  audioRunning?(): boolean;
  save(): Promise<ArrayBuffer | null>;
  /** open a save here, the packs it needs sent first */
  load(bytes: ArrayBuffer, packs: ContentPack[]): Promise<LoadOutcome>;
  thumb(): Promise<string | null>;
  /** the world now (a loaded save changes it) */
  world(): { scenario: string; seed: number };
  /** the content packs this world has beyond the base, the library they are kept in, and sending one to the world */
  packs(): ContentPack[];
  library: ModLibrary;
  addPack(pack: ContentPack): Promise<CommandResult>;
  bootProblems(): BootProblem[];
  /** reload into a saved slot (a fresh simulation with exactly its packs) / into a new world (an address) */
  reloadInto(slotId: string): void;
  leaveFor(url: string): Promise<void>;
  /** the game's canvas (photo mode previews its filter there) */
  canvas: HTMLCanvasElement;
  /** the sun's hour at the camera and setting it (photo mode) */
  localHour(): number;
  setLocalHour(h: number): void;
  audioReady(): boolean;
  /** the dev overlay */
  dev: boolean;
  /** HUD per-frame inputs the shell cannot know (render stats, projections) */
  hudFrame(): Omit<import('./hud.ts').HudFrame, 'open' | 'labels' | 'ticker'>;
  /** the title's camera: a slow turn round the world behind it (on), or the player's camera again (off) */
  titleCamera?(on: boolean): void;
}

/** camera action → the key code the camera controllers read (orbit / fly) */
const CAM_KEYS: Record<string, [string, string]> = {
  'cam.forward': ['KeyW', 'KeyW'], 'cam.back': ['KeyS', 'KeyS'], 'cam.left': ['KeyA', 'KeyA'], 'cam.right': ['KeyD', 'KeyD'],
  'cam.turnLeft': ['KeyQ', 'KeyQ'], 'cam.turnRight': ['KeyE', 'KeyE'], 'cam.tiltUp': ['KeyR', 'Space'], 'cam.tiltDown': ['KeyF', 'KeyC'],
};

/** what still works while a veiled window (settings, saves, the controls card, the menu) is open */
const MODAL_OK = new Set(['ui.settings', 'ui.saves', 'ui.help', 'ui.menu', 'ui.newWorld', 'ui.mods', 'ui.credits', 'ui.quicksave', 'ui.quickload', 'ui.chronicle', 'tool.cancel',
  'time.pause', ...SPEED_KEYS.map(([x]) => `time.speed${x}`), 'time.faster', 'time.slower', 'time.stepTick', 'time.stepHour', 'time.stepDay']);

/** the scenery world behind a cold load's title turns at this speed (its day passes in a few minutes) */
const TITLE_SPEED = 10;

/** what does nothing on the title (its world is only scenery: keeping it would overwrite the player's own) */
const TITLE_NO = new Set(['ui.menu', 'ui.chronicle', 'ui.mods', 'ui.quicksave', 'ui.title', 'ui.god', 'ui.signs', 'god.answer']);

type PressKind = 'none' | 'tool' | 'hand' | 'camera' | 'gesture' | 'right' | 'photo';

/** what still works in photo mode besides its own layer: time, the windows that explain it, cancel */
const PHOTO_OK = new Set(['tool.cancel', 'ui.help', 'cam.photo', 'time.pause', ...SPEED_KEYS.map(([x]) => `time.speed${x}`), 'time.faster', 'time.slower', 'time.stepTick', 'time.stepHour', 'time.stepDay']);

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
  readonly opening: Opening;
  readonly newWorld: NewWorld;
  readonly mods: Mods;
  readonly photo: Photo;
  readonly cam: CameraUi;
  /** the site's pause and the hidden page's (src/ui/embed.ts) */
  readonly time: TimeGuard;
  /** the front door (src/ui/title.ts) and the credits */
  readonly title: Title;
  readonly credits: Credits;
  /** the people and their god (src/ui/living.ts): the god's window, the sign picker; the invent forms */
  readonly god: GodPanel;
  readonly signs: SignPicker;
  readonly invent: Invent;
  /** the gods of the worlds (query 'gods': the rivals' epithets), asked now and then */
  private gods: GodRow[] = [];
  private godsAt = -1e9;
  /** the sacred places (query 'sacred'), for the place card */
  private sacred: SacredPlaceRow[] = [];
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
  /** "Interface hidden — H or Esc brings it back" (beside the panels: it shows while they are hidden) */
  private hiddenNote: HTMLDivElement;
  private hiddenNoteAt = 0;

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
    this.hud.toasts.actions.cmd = (c) => { void host.cmd(c); };
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
      dolly: (ref) => host.cam?.dolly(ref),
      walk: (ref) => host.cam?.walk(ref),
      powers: host.powers,
      arm: (p, preset) => this.arm(p, preset),
      live: (ref) => this.live(ref),
      openSigns: (t) => this.signs.open(t),
      sacredAt: (planet, cell) => this.sacred.find((p) => p.planet === planet && p.cell === cell) ?? null,
      tick: () => host.view.renderTick,
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
    this.radial = new Radial(root, host, (p) => this.arm(p), (cat) => this.openPalette(`!${categoryLabel(cat).toLowerCase()} `));
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
    this.saves = new Saves(root, {
      host, library: deps.library, save: () => deps.save(), load: (b, packs) => deps.load(b, packs), thumb: () => deps.thumb(), world: () => deps.world(),
      packs: () => deps.packs(), reloadInto: (id) => deps.reloadInto(id), openMods: () => this.openWindow('mods'), openNewWorld: () => this.openWindow('newWorld'),
      loaded: () => { this.opening.end(); this.newWorld.close(); this.title.close('load'); },
      // (the title's world is scenery: never kept as the autosave, nor saved from the title)
      keepable: () => !this.title.isOpen,
    });
    this.newWorld = new NewWorld(root, {
      host, library: deps.library, dev: deps.dev, world: () => deps.world(), keepable: () => !this.title.isOpen,
      openSaves: () => this.openWindow('saves'),
      begin: async (url) => {
        // the world being left is kept as the autosave first (when autosave is on and there is a living world)
        if (host.source === 'worker' && host.prefs.value.game.autosaveMinutes > 0 && !this.opening.isActive && !this.title.isOpen) await this.saves.autosave().catch(() => false);
        await deps.leaveFor(url);
      },
    });
    this.mods = new Mods(root, {
      host, library: deps.library, packs: () => deps.packs(), addToWorld: (p) => deps.addPack(p), bootProblems: () => deps.bootProblems(),
      openNewWorld: () => this.openWindow('newWorld'),
    });
    this.help = new Help(root, host);
    this.menu = new Menu(root, host, { quitToTitle: () => void this.quitToTitle() });
    this.credits = new Credits(root);
    this.signs = new SignPicker(root, {
      view: () => host.view, primary: () => host.primary(), query: (q, a) => host.query(q, a), cmd: (c) => host.cmd(c),
      arm: (id, preset) => this.armId(id, preset), target: () => this.townMeant(),
    });
    this.god = new GodPanel(root, {
      view: () => host.view, primary: () => host.primary(), query: (q, a) => host.query(q, a), cmd: (c) => host.cmd(c),
      select: (ref) => host.select(ref), lookAt: (planet, pos) => host.lookAt(planet, pos), arm: (id, preset) => this.armId(id, preset),
      openSigns: (t) => this.signs.open(t), gods: () => this.gods, hint: (id) => host.keybinds.hint(id),
    });
    this.invent = new Invent(root, {
      view: () => host.view, primary: () => host.primary(), cmd: (c) => host.cmd(c),
      here: () => { const g = host.focusGround(); return g ? { planet: g.planet, dir: [g.dir[0], g.dir[1], g.dir[2]] } : null; },
      town: () => this.townMeant(),
      plants: () => host.powers.enumOf('content.plant', 'like') ?? [],
    });
    this.title = new Title(root, {
      host,
      list: () => this.saves.list(),
      load: (id) => this.saves.loadSlot(id),
      openWindow: (w) => this.openWindow(w),
      camera: (on) => deps.titleCamera?.(on),
      setHud: (titled) => this.titled(titled),
    });
    this.title.onClose = (how) => this.titleClosed(how);
    // photo mode and the camera's chip live beside the panels, not in them: they stay while the interface is hidden
    this.photo = new Photo(parent, { host, canvas: deps.canvas, hour: () => deps.localHour(), dayHours: () => host.view.planet(host.primary())?.params.dayHours ?? 24, setHour: (hh) => deps.setLocalHour(hh) });
    this.cam = new CameraUi(parent, { host, nameOf: (ref) => this.catalog.nameOf(ref as EntityRef), uiVisible: () => deps.uiVisible(), action: (id) => this.action(id) });
    // (the opening's dark covers everything, the interface's own hiding included: it hangs from the page's UI root)
    this.opening = new Opening(root, parent, {
      host,
      openFreeform: (text) => this.openFreeform(text),
      openPalette: (q) => this.openPalette(q),
      openMenu: () => { this.newWorld.open({ fromOpening: true }); },
      menuOpen: () => this.modal() || this.cam.menuOpen,
      camera: (shot) => deps.openingCamera?.(shot),
      light: (ev, bloom) => deps.openingLight?.(ev, bloom),
      cameraBusy: () => deps.cameraBusy?.() ?? false,
      audioRunning: () => deps.audioRunning?.() ?? false,
      // (the opening's dark is not a clean frame: the site's bar stays over it)
      setUi: (v) => deps.setUi(v, false),
      arm: (p, preset) => this.arm(p, preset),
      disarm: () => { if (this.tools.state().armed === 'people') this.tools.disarm(); },
      hudQuiet: (q) => this.hud.setQuiet(q),
      armed: () => this.tools.armed?.id ?? null,
    });
    this.hiddenNote = document.createElement('div');
    this.hiddenNote.className = 'gn-hidden-note';
    this.hiddenNote.setAttribute('role', 'status');
    this.hiddenNote.hidden = true;
    parent.appendChild(this.hiddenNote);
    this.pad.onButton = (name, down) => this.padButton(name, down);
    // preferences that are the interface's own
    host.prefs.onChange((p, what) => { if (what.startsWith('ui') || what.startsWith('pad') || what === '*') this.applyUiPrefs(); });
    this.applyUiPrefs();
    window.addEventListener('resize', () => this.applyUiPrefs());
    // labels built from bindings follow a rebinding
    host.keybinds.listen(() => { this.hud.setHint(host.prefs.value.ui.hints); this.hud.refreshKeys(); this.tools.refreshKeys(); });
    // the site bar's Pause really pauses (and a hidden page stops time where the setting says so): src/ui/embed.ts
    this.time = new TimeGuard({
      speed: () => host.view.speed,
      setSpeed: (x) => host.setSpeed(x),
      openMenu: () => this.openWindow('menu'),
      closeWindows: () => { for (const w of [this.settings, this.saves, this.help, this.menu, this.newWorld, this.mods, this.credits]) if (w.isOpen) w.close(); },
      windowOpen: () => this.windowUp(),
      titleOpen: () => this.titleOpen(),
      hiddenPref: () => host.prefs.value.game.pauseHidden,
      toast: (t) => host.toast(t),
    });
    // a file the site's frame will not download is offered in a new tab instead
    installDownloadFallback((t) => host.toast(t));
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
    // inventing a material or a plant is a few choices that read together: its form, not a bare tool card
    if (p.command === 'content.material' || p.command === 'content.plant') {
      this.invent.open(p.command === 'content.material' ? 'material' : 'plant', typeof preset.name === 'string' ? preset.name : '');
      this.host.sound('ui.open');
      return;
    }
    this.tools.arm(p, preset);
    this.host.sound('ui.arm');
  }

  /** arm a power by its id (the god's window, the sign picker); false when no such power is known */
  armId(id: string, preset: Record<string, unknown> = {}): boolean {
    const p = this.host.powers.get(id);
    if (!p) return false;
    this.arm(p, preset);
    return true;
  }

  /** the settlement the player means now: the selected one (or the one of a selected person), else the nearest to where the camera looks */
  townMeant(): { planet: number; id: number } | null {
    const host = this.host;
    const sel = host.selected();
    if (sel?.kind === 'settlement') return { planet: sel.planet ?? host.primary(), id: sel.id };
    const pv = host.view.planet(host.primary());
    if (sel?.kind === 'agent' && pv?.agents) {
      const A = pv.agents;
      for (let i = 0; i < A.count; i++) if (A.id[i] === sel.id && A.group[i] >= 0) return { planet: pv.id, id: A.group[i] };
    }
    const f = host.focusGround();
    let best: number | null = null, bd = Infinity;
    if (pv && f) for (const st of pv.settlements) {
      if (st.flags & 2) continue;
      const d = 1 - (st.pos[0] * f.dir[0] + st.pos[1] * f.dir[1] + st.pos[2] * f.dir[2]);
      if (d < bd) { bd = d; best = st.id; }
    }
    return best !== null && pv ? { planet: pv.id, id: best } : null;
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
  openWindow(which: 'settings' | 'saves' | 'help' | 'menu' | 'newWorld' | 'mods' | 'credits'): void {
    const p = which === 'settings' ? this.settings : which === 'saves' ? this.saves : which === 'help' ? this.help : which === 'newWorld' ? this.newWorld : which === 'mods' ? this.mods : which === 'credits' ? this.credits : this.menu;
    // (photo mode is left first: the interface it hides is where windows live)
    if (this.photo.isActive) this.host.cam?.photo(false);
    this.cam.closeMenu();
    if (which !== 'menu' && this.menu.isOpen) this.menu.close();
    this.palette.close(); this.radial.close(); this.freeform.close();
    if (this.gestures.active || this.gestures.armed) this.gestures.cancel();
    this.hand.cancelAim();
    this.hud.closePopovers();
    if (p.isOpen) p.panel.raise(); else p.open();
  }

  /** the mirror's live view of a disaster / weather / ship (the inspector's "now") */
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
    if (ref.kind === 'ship') return (v.ships.find((s) => s.id === ref.id) as unknown as Record<string, unknown>) ?? null;
    // a settlement's view (its regard, prayers, prophet, what it keeps holy, its age, its livelihood)
    if (ref.kind === 'settlement') {
      const s = v.planet(ref.planet ?? this.host.primary())?.settlements.find((q) => q.id === ref.id);
      return s ? (s as unknown as Record<string, unknown>) : null;
    }
    // a person's flags as the movers carry them (prophet, the Called, sheltering, on pilgrimage)
    if (ref.kind === 'agent') {
      const A = v.planet(ref.planet ?? this.host.primary())?.agents;
      if (A) for (let i = 0; i < A.count; i++) if (A.id[i] === ref.id) return { flags: A.flags[i], flags2: A.flags2?.[i] ?? 0, group: A.group[i] };
      return null;
    }
    return null;
  }

  /** run an action by id (keys, the pad, the palette, the dock, the menu) */
  action(id: string): void {
    const host = this.host;
    const cur = this.cursor();
    // the opening's star and fall give way to any power or window (time keys and Esc keep their own meaning there)
    if (this.opening.cinematic && id !== 'tool.cancel' && !id.startsWith('time.')) this.opening.skip();
    // a veiled window is up: the world waits (time and the window keys still work)
    if (this.modal() && !MODAL_OK.has(id)) { host.sound('ui.error'); return; }
    // the title's world is scenery: no game menu, chronicle, mods or quicksave of it from there
    if (this.title.isOpen && TITLE_NO.has(id)) { host.sound('ui.error'); return; }
    // photo mode: its own keys, time, and the way out
    if (id.startsWith('photo.')) { this.photo.action(id); return; }
    if (this.photo.isActive && !PHOTO_OK.has(id)) return;
    if (id.startsWith('ui.god@')) { this.god.open(id.slice(7) as never); return; }
    if (id.startsWith('ui.radial@')) { const [x, y] = id.slice(10).split(',').map(Number); this.radial.open(x, Math.max(300, y), 'click'); this.hud.used('ui.radial'); return; }
    this.hud.used(id);
    // the speed presets (every one of SPEED_PRESETS has its action: time.speed1 … time.speed3000)
    if (/^time\.speed\d+$/.test(id)) {
      const x = Number(id.slice(10));
      if (this.time.sitePaused) this.time.sitePaused = false;
      host.setSpeed(x);
      return;
    }
    switch (id) {
      case 'cam.system': this.deps.camera.system(); return;
      case 'cam.fly': this.deps.camera.fly(); return;
      case 'cam.home': this.deps.camera.home(); return;
      case 'cam.follow': if (host.cam?.mode() === 'follow' && !host.selected()) host.follow(null); else this.deps.camera.follow(); return;
      case 'cam.look': this.deps.camera.look(); return;
      case 'cam.dolly': this.cinematic(); return;
      case 'cam.walk': case 'walk.exit': {
        const cam = host.cam;
        if (!cam) return;
        if (cam.mode() === 'walk') { cam.walk(null, true); return; }
        if (id === 'walk.exit') return;
        const s = host.selected();
        cam.walk(s && s.kind !== 'species' && s.kind !== 'planet' ? s as EntityRef : null);
        return;
      }
      case 'cam.photo': host.cam?.photo(!this.photo.isActive); return;
      case 'cam.menu': this.cam.toggleMenu(); return;
      case 'ui.newWorld': if (this.newWorld.isOpen) this.newWorld.close(); else { this.openWindow('newWorld'); } return;
      case 'ui.mods': if (this.mods.isOpen) this.mods.close(); else this.openWindow('mods'); return;
      case 'time.pause':
        // time stopped by the site's Pause comes back at its own speed
        if (this.time.sitePaused && host.view.speed === 0) { this.time.resume(); return; }
        host.setSpeed(host.view.speed === 0 ? (this.lastSpeed || 1) : (this.lastSpeed = host.view.speed, 0));
        return;
      case 'time.faster': case 'time.slower': {
        const presets: readonly number[] = SPEED_PRESETS;
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
      case 'ui.credits': if (this.credits.isOpen) this.credits.close(); else this.openWindow('credits'); return;
      case 'ui.god': this.god.toggle(); return;
      case 'ui.signs': if (this.signs.isOpen) this.signs.close(); else this.signs.open(); return;
      case 'god.answer': this.answerMostPressing(); return;
      case 'ui.title': if (!this.title.isOpen) void this.quitToTitle(); return;
      case 'ui.menu': if (this.menu.isOpen) this.menu.close(); else this.openWindow('menu'); return;
      case 'ui.hide': this.hideUi(this.deps.uiVisible()); return;
    }
  }

  /** the most pressing open prayer of this world, answered (the key; the god's card names it) */
  private answerMostPressing(): void {
    const host = this.host;
    const pv = host.view.planet(host.primary());
    let best: { s: number; id: number; u: number } | null = null;
    for (const s of pv?.settlements ?? []) for (const p of s.prayers ?? []) if (!(s.flags & 2) && (!best || p.urgency > best.u)) best = { s: s.id, id: p.id, u: p.urgency };
    if (!best || !pv) { host.toast({ text: 'No one is praying to you now.', kind: 'info', ms: 2600 }); return; }
    void host.cmd({ k: 'prayer.answer', settlement: best.s, prayer: best.id, planet: pv.id });
  }

  /** H: the interface away (with a note saying how it comes back) or back */
  private hideUi(hide: boolean): void {
    this.deps.setUi(!hide);
    if (!hide) { this.hiddenNote.hidden = true; return; }
    const k = this.host.keybinds.hint('ui.hide') || 'H';
    this.hiddenNote.textContent = `Interface hidden — ${k} or Esc brings it back`;
    this.hiddenNote.hidden = false;
    this.hiddenNote.classList.remove('gn-on');
    void this.hiddenNote.offsetWidth;
    this.hiddenNote.classList.add('gn-on');
    this.hiddenNoteAt = performance.now();
  }
  private lastSpeed = 1;

  /** something was just closed by Esc or by a panel's own Esc */
  noteDismiss(): void { this.dismissedAt = performance.now(); }

  /** Esc / B: close the innermost thing */
  cancel(): void {
    if (this.settings.isOpen && this.settingsCapturing()) return;
    const done = (): void => { this.noteDismiss(); };
    if (this.cam.menuOpen) { this.cam.closeMenu(); return done(); }
    if (this.photo.isActive) { this.host.cam?.photo(false); return done(); }
    // the cinematic hides the interface: Esc ends the film first (not an unseen deselect)
    if (this.host.cam?.mode() === 'dolly') { this.host.cam.dolly(null); return done(); }
    // the opening's star and fall: nothing else is on screen yet — the scenario menu at once
    if (!this.modal() && this.opening.hush && this.opening.cancel()) return done();
    if (this.hud.closePopovers()) return done();
    if (this.hand.isAiming) { this.hand.cancelAim(); return done(); }
    if (this.radial.isOpen) { this.radial.back(); return done(); }
    if (this.gestures.active || this.gestures.armed) { this.gestures.cancel(); this.gestureByKey = false; return done(); }
    if (this.palette.isOpen) { this.palette.close(); return done(); }
    if (this.freeform.isOpen) { this.freeform.close(); return done(); }
    // the newest open window first
    const wins = [this.settings, this.saves, this.help, this.menu, this.chronicle, this.newWorld, this.mods, this.credits, this.god, this.signs, this.invent].filter((p) => p.isOpen)
      .sort((a, b) => Number(b.panel.root.style.zIndex || 0) - Number(a.panel.root.style.zIndex || 0));
    if (wins.length) { wins[0].close(); return done(); }
    if (this.tools.cancelStep()) return done();
    if (this.tools.isArmed) { this.tools.disarm(); return done(); }
    if (this.host.selected()) { this.host.select(null); return done(); }
    // the camera's modes: walking rises, the cinematic and following stop
    const cm = this.host.cam?.mode();
    if (cm === 'walk') { this.host.cam!.walk(null, true); return done(); }
    if (cm === 'dolly') { this.host.cam!.dolly(null); return done(); }
    if (cm === 'follow') { this.host.follow(null); return done(); }
    if (!this.deps.uiVisible()) { this.hideUi(false); return done(); }
    if (performance.now() - this.dismissedAt < 400) return;
    // the title has nothing behind it to go back to: Esc stays on it
    if (this.title.isOpen) return;
    // nothing left to close: while the opening's whispers speak, its scenario menu ("Another world?"); else the game menu
    if (this.opening.isActive && this.opening.cancel()) return done();
    this.openWindow('menu');
  }

  private settingsCapturing(): boolean {
    return !!this.settings.panel.root.querySelector('.gn-capturing');
  }

  /** a modal window (veiled) is open: world input pauses */
  modal(): boolean {
    return this.settings.isOpen || this.saves.isOpen || this.help.isOpen || this.menu.isOpen || this.newWorld.isOpen || this.mods.isOpen || this.credits.isOpen || this.invent.isOpen || this.opening.modal || this.title.isOpen;
  }

  /** a window (not the title itself) is up */
  windowUp(): boolean {
    return this.settings.isOpen || this.saves.isOpen || this.help.isOpen || this.menu.isOpen || this.newWorld.isOpen || this.mods.isOpen || this.credits.isOpen || this.invent.isOpen;
  }

  titleOpen(): boolean { return this.title.isOpen; }

  /** the interface behind the title steps aside (the site's bar stays: it is not a clean frame) */
  private titled(on: boolean): void {
    this.hud.root.classList.toggle('gn-titled', on);
    this.hud.world.classList.toggle('gn-titled', on);
    // the cold load's world is scenery: it turns a little faster behind the title (a world quit to stands still)
    if (on && this.titleSpeed < 0 && this.host.source === 'worker') this.host.setSpeed(TITLE_SPEED);
    if (on) {
      this.palette.close(); this.radial.close(); this.freeform.close();
      this.god.close(); this.signs.close(); this.invent.close();
      if (this.gestures.active || this.gestures.armed) this.gestures.cancel();
      if (this.tools.isArmed) this.tools.disarm();
      if (this.host.selected()) this.host.select(null);
      if (this.photo.isActive) this.host.cam?.photo(false);
      this.opening.end();
    }
  }

  /** the speed the world had when the player quit to the title (Continue gives it back) */
  private titleSpeed = -1;

  /** the game menu's "Quit to title": the world is kept as the autosave, time stops, the title comes up over it */
  async quitToTitle(): Promise<void> {
    const host = this.host;
    if (host.source === 'worker') await this.saves.autosave().catch(() => false);
    this.titleSpeed = host.view.speed;
    if (host.view.speed > 0) host.setSpeed(0);
    this.title.open({ fromGame: true });
  }

  /** the title went away: after "Quit to title" and Continue, the world's own speed again; else the plain 1× */
  private titleClosed(how: string): void {
    if (this.titleSpeed >= 0 && how === 'continue') { if (this.host.view.speed === 0) this.host.setSpeed(this.titleSpeed); }
    else if (this.host.source === 'worker') this.host.setSpeed(1);
    this.titleSpeed = -1;
  }

  /** the camera mode's key layer, if one is live */
  private layer(): Context | undefined {
    const m = this.host.cam?.mode();
    return m === 'photo' ? 'photo' : m === 'walk' ? 'walk' : undefined;
  }

  /** the cinematic: around the selected settlement, else the one nearest the camera's point, else the selection */
  private cinematic(): void {
    const host = this.host;
    const cam = host.cam;
    if (!cam) return;
    if (cam.mode() === 'dolly') { cam.dolly(null); return; }
    const sel = host.selected();
    if (sel && (sel.kind === 'settlement' || sel.kind === 'building' || sel.kind === 'agent')) { cam.dolly(sel as EntityRef); return; }
    const pv = host.view.planet(host.primary());
    const f = host.focusGround();
    let best: number | null = null, bd = Infinity;
    if (pv && f) for (const st of pv.settlements) {
      if (st.flags & 2) continue;
      const d = 1 - (st.pos[0] * f.dir[0] + st.pos[1] * f.dir[1] + st.pos[2] * f.dir[2]);
      if (d < bd) { bd = d; best = st.id; }
    }
    if (best === null || !pv) { host.toast({ text: 'There is no settlement on this world yet for a cinematic: select something to circle.', kind: 'info' }); return; }
    cam.dolly({ kind: 'settlement', id: best, planet: pv.id });
  }

  // ───────────────────────────── keyboard ─────────────────────────────

  keyDown(e: KeyboardEvent): void {
    // the key that lit the opening's star was only that
    if (this.opening.tookTouch(e)) return;
    if (isTyping(e)) {
      // Esc in a window's field leaves the field and closes the window (the "do this" field and the palette handle
      // their own Esc)
      if (e.code === 'Escape' && (e.target as HTMLElement).closest('.gn-win')) { e.preventDefault(); (e.target as HTMLElement).blur(); this.cancel(); }
      return;
    }
    // Enter on a control reached by the keyboard (the title's doors, a window's buttons, the inspector's) presses it, as
    // anywhere on the web; a control merely clicked with the mouse keeps Enter for "do this"
    const fe = document.activeElement as HTMLElement | null;
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && fe && fe !== document.body && fe.matches(':focus-visible')
      && fe.matches('button, summary, a[href], [role="button"], [role="menuitem"]')) return;
    // the arrows on a slider reached by the keyboard move it (the wrath, a setting, a brush); after a drag with the mouse
    // they are the camera's again
    if (/^(Arrow(Left|Right|Up|Down)|Home|End|PageUp|PageDown)$/.test(e.code) && fe instanceof HTMLInputElement && fe.type === 'range' && fe.matches(':focus-visible')) return;
    const kb = this.host.keybinds;
    // the opening's star and fall (the interface still hidden): a key gives way to the world at once — a power or a
    // window key then acts; a time key (Space among them) only skips: it meant "go on", not "pause" (Esc: the menu)
    if (this.opening.cinematic && e.code !== 'Escape') {
      this.opening.skip();
      const ids = kb.pressActions(e);
      if (!ids.length || ids[0].startsWith('time.')) { e.preventDefault(); return; }
    }
    // the camera modes menu takes the arrows, Enter and Esc while it is up
    if (this.cam.menuOpen) {
      if (e.code === 'ArrowDown' || e.code === 'ArrowUp') { e.preventDefault(); this.cam.move(e.code === 'ArrowDown' ? 1 : -1); return; }
      if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') { e.preventDefault(); if (!e.repeat) this.cam.accept(); return; }
      if (e.code === 'Escape') { e.preventDefault(); this.cam.closeMenu(); this.noteDismiss(); return; }
    }
    // a camera mode's own keys come first (photo: Space takes the picture; walking: the rise key)
    const layer = this.layer();
    if (layer && !this.modal()) {
      const own = kb.pressActions(e, layer);
      if (own.length) { e.preventDefault(); if (!e.repeat) this.action(own[0]); return; }
    }
    if (this.radial.isOpen) {
      const was = this.radial.isOpen;
      if (this.radial.key(e)) { if (was && !this.radial.isOpen) this.noteDismiss(); return; }
    }
    if (e.code === 'Escape') { e.preventDefault(); if (!e.repeat) this.cancel(); return; }
    kb.down.add(e.code);
    if (e.repeat) { if (this.holdAllowed(e)) e.preventDefault(); return; }
    // hold actions start (a camera mode's own hold keys — walking's float, photo mode's rise — among them)
    const live = layer && !this.modal() ? layer : undefined;
    let layerHold = false;
    for (const id of kb.holdActions(e, live)) {
      if (ACTION_BY_ID.get(id)?.context) layerHold = true;
      if (this.heldKeys.has(id)) continue;
      this.heldKeys.add(id);
      // (in photo mode the hand, the radial and gestures wait)
      if (this.photo.isActive) continue;
      if (id === 'ui.radial' && !this.modal()) { const p = this.cursor() ?? [window.innerWidth / 2, window.innerHeight / 2]; this.radial.open(p[0], p[1], 'hold'); this.hud.used(id); e.preventDefault(); }
      if (id === 'ui.gesture' && !this.modal() && !this.gestures.active) { const p = this.cursor(); this.gestures.begin(p?.[0], p?.[1]); this.gestureByKey = true; this.hud.used(id); e.preventDefault(); }
    }
    // a camera mode's hold key shadows whatever the world presses with it
    if (layerHold) { e.preventDefault(); return; }
    const press = kb.pressActions(e);
    if (press.length) {
      e.preventDefault();
      this.actionKey = e.code;
      try { this.action(press[0]); } finally { this.actionKey = null; }
    } else if (this.holdAllowed(e)) e.preventDefault();
  }

  /** the browser's own use of a key the game holds (Space scrolls, arrows scroll) is suppressed */
  private holdAllowed(e: KeyboardEvent): boolean {
    return this.host.keybinds.holdActions(e, this.modal() ? undefined : this.layer()).length > 0;
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
    // the click that lit the opening's star was only that
    if (mods instanceof Event && this.opening.tookTouch(mods)) return;
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
    // photo mode: a drag looks, a click focuses (the hand and the powers wait)
    if (this.photo.isActive) { this.press = 'photo'; return; }
    // the cinematic: a press takes the camera back (it does not grab what is under it)
    if (this.host.cam?.mode() === 'dolly') { this.host.cam.dolly(null); this.press = 'camera'; return; }
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
      case 'camera': this.hand.move(x, y, t, pts); input.dragL[0] += dx; input.dragL[1] += dy; if (Math.abs(x - this.downX) + Math.abs(y - this.downY) > 24) this.hud.used('drag'); break;
      case 'right': this.rightMoved += Math.abs(dx) + Math.abs(dy); break;
      case 'photo': input.dragL[0] += dx; input.dragL[1] += dy; break;
    }
    this.cam.pointerMoved();
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
    if (kind === 'photo') { if (Math.hypot(x - this.downX, y - this.downY) < 6) this.photo.focusAt(x, y); return; }
    if (kind === 'hand' || kind === 'camera') {
      const r = this.hand.up(x, y, t);
      if (r === 'click') {
        this.hud.used('click');
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
    this.hud.used('wheel');
  }

  // ───────────────────────────── gamepad ─────────────────────────────

  private padButton(name: string, down: boolean): void {
    const kb = this.host.keybinds;
    const p = this.pad.pointer() ?? [this.pad.x, this.pad.y];
    // the camera modes menu: the D-pad moves, A picks, B (or View again) closes
    if (down && this.cam.menuOpen) {
      if (name === 'Down' || name === 'Right') { this.cam.move(1); return; }
      if (name === 'Up' || name === 'Left') { this.cam.move(-1); return; }
      if (name === 'A') { this.cam.accept(); return; }
      if (name === 'B') { this.cam.closeMenu(); this.noteDismiss(); return; }
    }
    // a camera mode's own buttons come first (photo: A takes the picture, B leaves, the triggers rise and sink;
    // walking: B rises, the D-pad floats up and comes down)
    const layer = this.layer();
    if (layer && !this.modal()) {
      const own = kb.padActions(name, layer);
      if (own.length) {
        const a = ACTION_BY_ID.get(own[0]);
        if (a?.hold) { if (down) this.heldPad.add(a.id); else this.heldPad.delete(a.id); }
        else if (down) this.action(own[0]);
        return;
      }
    }
    const ids = kb.padActions(name);
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
    if (down && (this.modal() || this.chronicle.isOpen || this.god.isOpen || this.signs.isOpen || this.freeform.isOpen || focus) && this.panelNav(name, focus)) return;
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
    const open = [this.settings, this.saves, this.help, this.menu, this.chronicle, this.newWorld, this.mods, this.credits, this.god, this.signs, this.invent].filter((x) => x.isOpen)
      .sort((a, b) => Number(b.panel.root.style.zIndex || 0) - Number(a.panel.root.style.zIndex || 0));
    const panel = (this.opening.modal ? this.opening.root : null) ?? open[0]?.panel.root ?? (this.title.isOpen ? this.title.root : null) ?? (this.freeform.isOpen ? this.freeform.root : null) ?? focused;
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
    // walking and photo mode: the left stick moves the body / the camera, not the cursor (it stays in the middle); the
    // mode's own hold keys (float, sink, rise) become the keys its camera reads
    const layer = this.layer();
    for (const [id, code] of Object.entries(LAYER_HOLD_CODES)) {
      if (!layer) { this.heldPad.delete(id); continue; }
      if (ACTION_BY_ID.get(id)?.context === layer && held(id)) input.keys.add(code);
    }
    this.pad.locked = !!layer && !this.modal() && !this.radial.isOpen && !this.palette.isOpen;
    this.host.cam?.stick(layer === 'walk' && this.pad.locked ? pf.lx : 0, layer === 'walk' && this.pad.locked ? pf.ly : 0);
    if (layer === 'photo' && this.pad.locked) {
      if (pf.ly < -0.3) input.keys.add('KeyW');
      if (pf.ly > 0.3) input.keys.add('KeyS');
      if (pf.lx < -0.3) input.keys.add('KeyA');
      if (pf.lx > 0.3) input.keys.add('KeyD');
    }
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
    const photo = this.photo.isActive;
    const pointerOwned = photo || this.tools.isArmed || this.gestures.armed || this.gestures.active || this.press === 'tool' || this.press === 'gesture';
    this.hand.frame(!photo && (this.press === 'none' || this.press === 'hand' || this.press === 'camera') ? c : null, pointerOwned);
    this.gestures.frame();
    this.overlays.frame();
    this.chronicle.frame();
    this.freeform.frame();
    this.palette.frame();
    this.saves.frame();
    this.inspector.tick(performance.now());
    // the people and their god: the wrath a harmful cast falls with, the god's window, the rivals' names now and then
    host.powers.wrathLaw = host.view.wrath ?? host.powers.wrathLaw;
    this.god.frame();
    this.pollGods();
    // the world layer: busy (names and markers let presses through), hushed (names and markers hidden)
    const busy = pointerOwned || this.hand.busy || this.press !== 'none';
    const hush = this.radial.isOpen || this.palette.isOpen || this.gestures.active || this.gestures.armed || this.opening.hush;
    this.hud.setWorldMode(busy, hush);
    // (before the toasts drain the events: the opening reads the sim's milestones)
    this.opening.frame();
    this.hud.keepOut = this.opening.speaking();
    this.hud.toasts.muteMilestones = this.opening.isActive;
    // (the title's world is scenery: its news is not the player's)
    this.hud.toasts.muteNews = this.title.isOpen;
    this.cam.frame(this.pad.active);
    this.photo.frame();
    this.time.frame();
    // (the note says it for six seconds, then fades; it goes at once when the interface comes back)
    if (!this.hiddenNote.hidden) {
      const age = performance.now() - this.hiddenNoteAt;
      if (this.deps.uiVisible() || age > 6800) { this.hiddenNote.hidden = true; this.hiddenNote.classList.remove('gn-on'); }
      else if (age > 6000) this.hiddenNote.classList.remove('gn-on');
    }
    void dt;
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

  /** the gods (their epithets for the HUD and the god's window) and the sacred places (the place card), every ~6 s */
  private pollGods(): void {
    const now = performance.now();
    if (now - this.godsAt < 6000 || this.host.source !== 'worker' || this.title.isOpen) return;
    this.godsAt = now;
    const planet = this.host.primary();
    void this.host.query('gods', {}).then((g) => {
      if (!Array.isArray(g)) return;
      this.gods = g as GodRow[];
      this.hud.setGods(this.gods);
    }).catch(() => { /* the names wait */ });
    void this.host.query('sacred', { planet }).then((r) => {
      const places = (r as { places?: unknown } | null)?.places;
      if (Array.isArray(places)) this.sacred = places as SacredPlaceRow[];
    }).catch(() => { /* the list waits */ });
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
    // (a short window — the site's 888 × 500 frame — holds two toasts between the time panel and the dock)
    this.hud.toasts.maxShown = H < 600 ? 2 : H < 760 ? 3 : 4;
    const tickerMax = Math.max(160, (dock.left - 36 - 18) / s);
    // a window open on the left (the chronicle, The god) would cover the toasts: they stand beside it (to the right of
    // it, short of the inspector when that is open)
    let toastLeft: number | undefined, toastMaxW: number | undefined;
    let leftEdge = 0;
    for (const w of [this.chronicle, this.god]) if (w.isOpen) leftEdge = Math.max(leftEdge, w.panel.root.getBoundingClientRect().right);
    if (leftEdge > 0) {
      const insp = this.inspector.isOpen ? this.inspector.root.getBoundingClientRect().left : window.innerWidth;
      toastLeft = leftEdge + 12;
      toastMaxW = Math.max(200, (insp - 14 - toastLeft) / s);
    }
    const key = `${Math.round(bottom)}|${top}|${Math.round(tickerMax)}|${Math.round(toastLeft ?? -1)}|${Math.round(toastMaxW ?? -1)}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    this.hud.layout({ toastBottom: bottom, toastTop: top, tickerMax, toastLeft, toastMaxW });
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
      newWorld: this.newWorld.isOpen ? this.newWorld.state() : null, mods: this.mods.isOpen, modsLast: this.mods.last,
      photo: this.photo.state(), cam: this.cam.state(), saveLast: this.saves.last,
      title: this.title.state(), credits: this.credits.isOpen, sitePaused: this.time.sitePaused, hiddenPaused: this.time.hiddenPaused,
      god: this.god.state(), signs: this.signs.state(), invent: this.invent.state(), prayerMarks: this.hud.prayerMarks.marked(),
    };
  }
}

/** the interface scale that keeps text readable on this window: ×1 at 820 px tall and below, up to ×2 */
export function autoScale(): number {
  return Math.max(1, Math.min(2, Math.round((window.innerHeight / 820) * 20) / 20));
}
