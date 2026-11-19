// VALE input — the match controller (CONTRACT §10 "Input"). Real keys and mouse buttons become
// Commands on MatchClient.send; nothing here touches the sim. It needs only the renderer's picking and
// camera seam (structural `InputRenderer`, the RENDER lane's createRenderer implements all of it) and
// the HUD's hooks for the things that are not commands (shop, scoreboard, ping wheel, markers).
//
//   right-click ground      move (an attack-move click when controls.attackMoveOnClick); held and dragged =
//                           keeps steering toward the cursor (only real pointer motion re-steers: a still mouse
//                           over a following camera never walks the hero on by itself); held still = the last
//                           point is re-sent every 500 ms while the hero stands short of it (a give-up retries)
//   right-click enemy       attack it (chases). Forgiving: enemies only (you and allies in front never steal
//                           the click), a near miss within PICK_SLOP_PX on an enemy minion or fighter still
//                           counts (never onto a monster or a structure: a ground click beside a camp or tower stays a move)
//   Shift + right-click     attack-move click (ruling 33): the enemy under the cursor, else the enemy nearest
//   A then left-click       the click point within CLICK_RADIUS_M, is attacked (chased, like right-click on it);
//                           on open ground: walk there, stop for the first enemy in range, never chase
//   Shift + left-click      attack in place (ruling 39; the attackInPlace bind, default Shift): the hero stops, faces the
//                           click and attacks the enemy the click means if it is in range (the same pick as attack-move),
//                           else throws its attack toward the click (a ranged shot along the aim line, a melee swing);
//                           it never walks. Held, it keeps attacking toward the cursor at attack speed (re-aimed every
//                           SHOOT_RESEND_MS); letting go of the button or the modifier stops it. While the modifier is
//                           held an aim line the attack's reach long (and its range ring) follows the cursor
//   fightersOnly (hold)     every click and attack-move above considers enemy fighters only (wider radius)
//   left-click              confirm an aimed ability, finish A attack-move, otherwise select a unit to inspect
//   S stop · B recall · P shop · Tab scoreboard (hold)
//   toggleAutoAttack        flips controls.autoAttack (unbound by default); the setting reaches the sim as Command
//                           'autoAttack' (ruling 61): off, your fighter attacks only when ordered
//   hover                   the outline shows exactly what a click would attack (the attack-move target
//                           while Shift is held or A is armed)
//   Q W E R D F 1–6         cast, by the slot's cast mode (controls.castModes, ruling 54): normal = aim first (the
//                           renderer draws your indicator), then left-click or the key again; quick = at the cursor on
//                           the press; quick with indicator = the indicator shows while the key is held and the cast
//                           goes on its release (a unit ability with no valid unit under the cursor keeps aiming, as
//                           normal). Right-click / Esc cancels; the self-cast modifier casts unit abilities on you. A
//                           press while the fighter is busy (windup, dash) is held by the sim for 0.4 s (ruling 54)
//   levelUpMod + Q W E R    level the ability up (default Ctrl)
//   showRange (hold)        your attack-range ring (range + body radius); it also shows while attack-move is armed
//                           (controls.rangeOnAttackMove) and, with the aim line, while attack in place is held
//   viewAlly1–4 (hold)      the camera watches that ally (default F2–F5); letting go returns it
//   G (hold)                ping wheel at the cursor; a tap pings "Look here"; Alt + left-click pings too
//   Y                       camera lock · Space (hold) centre on your fighter · wheel zoom · middle-drag
//                           pans (unlocks the camera) · edge pan through the renderer's camera rig
// Keys typed into a field (shop search) never reach the game. While a modal is open nothing is sent.

import { signal } from '@preact/signals';
import type { SlotT } from '../contracts/catalog.ts';
import type { MatchClient, Settings } from '../contracts/session.ts';
import type { EntityId, EntityView, PingKind, PlayerView } from '../contracts/sim.ts';
import { AbilityIndex, aimSpec, canSelfCast, clampToRange, reachOf, unitMatches, type AbilityCore, type AimSpecLike } from './abilities.ts';
import { Keymap, LEVEL_SLOTS, mouseCode, slotOfAction, VIEW_ALLY, type Action } from './keymap.ts';
import { castModeOf, type ControlSettings } from '../session/settings.ts';

export interface CameraLike {
  setMode(m: 'locked' | 'semi' | 'free'): void;
  readonly mode: 'locked' | 'semi' | 'free';
  scout(on: boolean): void;
  setPointer(x: number, y: number, inside: boolean): void;
  setKeyPan(x: number, z: number): void;
  zoomBy(steps: number): void;
  focusOn(x: number, y: number): void;
  centerOnSelf(): void;
}
/** renderer pick options (render/renderer.ts PickOptions): keep only units a command can use; accept near misses (px) */
export interface PickOpts { filter?: (v: EntityView) => boolean; slop?: number }
/** what input uses of the renderer (render/renderer.ts Renderer; every member optional so the client
 *  still runs without a renderer, ?render=0) */
export interface InputRenderer {
  pickGround?(x: number, y: number): { x: number; y: number } | null;
  pickEntity?(x: number, y: number, opts?: PickOpts): EntityId | null;
  worldToScreen?(x: number, y: number, height?: number): { x: number; y: number; visible: boolean };
  setAim?(aim: AimSpecLike | null): void;
  /** your attack-range ring (W2-D: the telegraph layer's dashed range ring), null hides it */
  setRangeRing?(ring: { x: number; y: number; radius: number } | null): void;
  setHover?(id: EntityId | null): void;
  setTarget?(id: EntityId | null): void;
  /** where a unit is drawn now (the interpolated actor the pick boxes use), in sim x/y */
  unitPos?(id: EntityId): { x: number; y: number } | null;
  camera?: CameraLike;
}

/** why a press was refused. 'cc': you cannot act (stun, airborne, sleep, taunt, fear: the sim's canCast
 *  refuses every slot under them), refused at the press, before any aim starts */
export type DenyReason = 'cooldown' | 'resource' | 'rank' | 'dead' | 'target' | 'empty' | 'silenced' | 'cc' | 'no_active' | 'ping_limit' | 'ping_fray';
/** statuses under which the sim refuses every cast (sim status.ts canCast: hard CC, taunt, fear) —
 *  status kinds are the catalog's code vocabulary, not content ids */
const CAST_LOCK: ReadonlySet<string> = new Set(['stun', 'airborne', 'sleep', 'taunt', 'fear']);
export interface Marker { x: number; y: number; kind: 'move' | 'attackMove' | 'attack'; target?: EntityId }
export interface WheelState { x: number; y: number; gx: number; gy: number; target?: EntityId; sel: PingKind | null }

export interface InputHooks {
  toggleShop(): void;
  closeShop(): boolean;
  scoreboard(on: boolean): void;
  denied(slot: SlotT | 'ping', why: DenyReason): void;
  marker(m: Marker): void;
  setCameraLock(locked: boolean): void;
  /** a modal or the in-match menu is open: send nothing */
  blocked(): boolean;
  /** FRAY: nobody shares your side */
  pingsDisabled(): boolean;
  /** casts and pings for the HUD's own feedback (slot press flash, ping log) */
  cast?(slot: SlotT): void;
  /** the toggleAutoAttack key: flip controls.autoAttack (the HUD saves it and says so; ruling 61) */
  toggleAutoAttack?(): void;
}

/** clockwise from 12 o'clock (client_hud §5) */
export const PING_ORDER: readonly PingKind[] = ['alert', 'danger', 'onMyWay', 'missing', 'assist', 'push', 'vision', 'objective', 'retreat'];
const PING_LIMIT = 5, PING_WINDOW_MS = 4000;
const WHEEL_DEADZONE = 26;
const HOLD_MOVE_MS = 140;
/** hold-steer re-issues only after the pointer itself moved this far (CSS px) since the last order */
const HOLD_MIN_PX = 8;
/** while the button is held, the last point is re-sent this often (ms) when the hero stands more than HOLD_RETRY_NEAR m
 *  short of it (a walk that gave up in a packed wave tries again; ruling 38) */
const HOLD_RETRY_MS = 500;
const HOLD_RETRY_NEAR = 2;
/** a click this close (CSS px) to an enemy's hit box still counts as on it: attack clicks and plain right-clicks
 *  alike (ruling 36 supersedes ruling 35's 8 px for plain clicks: genre forgiveness, "hard to target minions") */
const PICK_SLOP_PX = 14;
/** what a plain right-click's near miss may land on: enemy minions and fighters (live r3: a ground click by a wall
 *  14 px from an enemy tower walked the hero 30 m into it) */
const slopKind = (v: EntityView): boolean => v.kind === 'minion' || v.kind === 'fighter';
/** attack-move click: the enemy whose edge is nearest the click point within this (m) is the target */
const CLICK_RADIUS_M = 2;
/** the auto attack switch is re-sent this often (ms) while the sim's seat value still differs from the setting */
const AUTO_RESEND_MS = 400;
/** … with fightersOnly held (fighters only, so the radius can be wider) */
const FIGHTER_CLICK_RADIUS_M = 3;
const HOVER_MS = 50;
/** a held attack-in-place re-sends at the cursor this often (ms): the sim attacks at attack speed, re-aimed each swing */
const SHOOT_RESEND_MS = 100;
/** width (m) of the attack-in-place aim line */
const SHOOT_LINE_W = 0.25;
/** the pointer's cached hit-test target is trusted this long before the browser hit-tests again */
const HUD_RETEST_MS = 250;

const isField = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
};

export class InputController {
  readonly keymap: Keymap;
  readonly index: AbilityIndex;
  /** the slot being aimed (normal cast; `hold`: quick cast with indicator, cast on the key's release) */
  readonly aiming = signal<{ slot: SlotT; def: AbilityCore; hold?: boolean } | null>(null);
  /** attack-move armed (next left-click) */
  readonly attackMove = signal(false);
  readonly wheel = signal<WheelState | null>(null);
  /** what the cursor is over: drives the CSS cursor */
  readonly cursor = signal<'default' | 'attack' | 'ally' | 'aim' | 'attackMove' | 'shoot'>('default');
  readonly held = new Set<string>();

  private client: MatchClient;
  private r: InputRenderer;
  private hooks: InputHooks;
  private surface: HTMLElement;
  private settings: Settings;
  private ptr = { x: -1, y: -1, inside: false };
  private rightHeld = false;
  private rightHeldAttack = false;
  /** the left button is held after an attack-in-place click (re-sent while the modifier stays held) */
  private leftShoot = false;
  private lastShoot = 0;
  /** attack-in-place orders sent by the current press (a hold re-sends; a single click sends one) and its last point */
  private shootSends = 0;
  private shootAt = { x: 0, y: 0 };
  /** the attack-in-place aim line is drawn (setAim is ours to clear) */
  private shootAim = false;
  private lastHoldMove = 0;
  private lastMoveTo: { x: number; y: number } | null = null;
  /** pointer position (CSS px) when the held right button last issued an order */
  private holdPx = { x: -1, y: -1 };
  /** Shift as the last pointer event saw it (key events land in `held`) */
  private ptrShift = false;
  /** the mouse button mask as the last pointer event reported it (chorded presses and releases) */
  private buttons = 0;
  /** middle-drag pan; scouting = it began on a locked camera, so release returns to your fighter */
  private middle: { gx: number; gy: number; scouting: boolean } | null = null;
  private hoverAt = 0;
  private hoverId: EntityId | null = null;
  /** what the browser hit-tested under the pointer on its last move (free: no forced layout) */
  private ptrTarget: EventTarget | null = null;
  private hudAt = -1e9;
  private hudHit = false;
  private centring: { prev: 'locked' | 'semi' | 'free' } | null = null;
  /** a viewAlly key is held: which ally (0-3), and how to give the camera back (a locked camera peeks; an unlocked one
   *  returns to the ground it was on) */
  private viewing: { ally: number; action: Action; scouting: boolean; back: { x: number; y: number } | null } | null = null;
  /** the attack-range ring as last sent (null hidden) */
  private ringOn = false;
  private pingTimes: number[] = [];
  /** when the auto attack switch was last sent to the sim (ruling 61; re-sent while the sim's seat value differs) */
  private autoSentAt = -1e9;
  private wheelAt = 0;
  private off: (() => void)[] = [];

  constructor(o: { client: MatchClient; renderer: InputRenderer | null; index: AbilityIndex; settings: Settings; hooks: InputHooks; surface: HTMLElement }) {
    this.client = o.client;
    this.r = o.renderer ?? {};
    this.index = o.index;
    this.hooks = o.hooks;
    this.surface = o.surface;
    this.settings = o.settings;
    this.keymap = new Keymap(o.settings.controls);
  }

  setSettings(s: Settings): void { this.settings = s; this.keymap.set(s.controls); }
  /** the element that receives world clicks (set before attach()) */
  setSurface(el: HTMLElement): void { this.surface = el; }

  // ── views ──────────────────────────────────────────────────────────────────────────────────────
  private get me(): PlayerView | undefined { return this.client.view.players[this.client.you]; }
  private get body(): EntityView | undefined { const p = this.me; return p ? this.client.view.entity(p.entity) : undefined; }
  private get team(): number { return this.me?.team ?? 0; }
  private ground(x = this.ptr.x, y = this.ptr.y): { x: number; y: number } | null {
    if (x < 0) return null;
    return this.r.pickGround?.(x, y) ?? null;
  }
  private entityAt(x = this.ptr.x, y = this.ptr.y, opts?: PickOpts): EntityView | null {
    if (x < 0) return null;
    const id = opts ? this.r.pickEntity?.(x, y, opts) : this.r.pickEntity?.(x, y);
    return id === null || id === undefined ? null : this.client.view.entity(id) ?? null;
  }
  /** is the bound fightersOnly key (or mouse button) held */
  private fightersOnly(): boolean {
    const c = this.keymap.code('fightersOnly');
    return !!c && this.held.has(c);
  }
  private shiftHeld(): boolean { return this.ptrShift || this.held.has('ShiftLeft') || this.held.has('ShiftRight'); }
  /** is the attack-in-place modifier held (default Shift; a Shift bind also reads the pointer event's shiftKey) */
  private inPlaceHeld(): boolean {
    const c = this.keymap.code('attackInPlace');
    if (!c) return false;
    if (/^Shift(Left|Right)$/.test(c) && this.ptrShift) return true;
    return this.keymap.isHeld('attackInPlace', this.held);
  }
  /** an enemy this click may attack (fighters only while fightersOnly is held) */
  private foe(e: EntityView | null): boolean { return this.enemy(e) && (e!.kind === 'fighter' || !this.fightersOnly()); }
  /** the enemy under the cursor for an attack click: enemies only, near misses forgiven */
  private enemyAt(): EntityView | null {
    const t = this.entityAt(this.ptr.x, this.ptr.y, { filter: (v) => this.foe(v), slop: PICK_SLOP_PX });
    return t && this.foe(t) ? t : null;
  }
  /** the enemy a plain right-click attacks: one under the cursor, else a near miss within PICK_SLOP_PX that is
   *  an enemy minion or fighter (never a neutral monster or a structure: a ground click beside a camp or a tower must
   *  stay a move, not start a chase into it); anything else stays a move */
  private moveClickEnemy(): EntityView | null {
    const t = this.entityAt(this.ptr.x, this.ptr.y, { filter: (v) => this.foe(v) });
    if (t && this.foe(t)) return t;
    const n = this.entityAt(this.ptr.x, this.ptr.y, { filter: (v) => this.foe(v) && slopKind(v), slop: PICK_SLOP_PX });
    return n && this.foe(n) && slopKind(n) ? n : null;
  }
  /**
   * the enemy an attack-move click means: the one under the cursor, else the visible enemy whose edge is
   * nearest the click point `g` within CLICK_RADIUS_M (ties: lower id), else none (a ground attack-move).
   * Presentation-side and from the visible view only; the sim receives an explicit target id.
   */
  private attackMoveTarget(g: { x: number; y: number } | null): EntityView | null {
    const t = this.enemyAt();
    if (t || !g) return t;
    const R = this.fightersOnly() ? FIGHTER_CLICK_RADIUS_M : CLICK_RADIUS_M;
    let best: EntityView | null = null, bestD = Infinity;
    for (const e of this.client.view.entities) {
      if (!this.foe(e)) continue;
      // measured where the unit is drawn (the pick boxes' positions), so hover and click agree on a moving unit
      const at = this.r.unitPos?.(e.id) ?? e;
      const d = Math.hypot(at.x - g.x, at.y - g.y) - e.radius;
      if (d > R) continue;
      if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && best !== null && e.id < best.id)) { bestD = d; best = e; }
    }
    return best;
  }
  private enemy(e: EntityView | null): boolean {
    return !!e && e.alive && e.targetable && e.team !== this.team && (e.visibleMask & (1 << this.team)) !== 0 && e.kind !== 'pickup' && e.kind !== 'projectile' && e.kind !== 'zone';
  }
  get pointer(): { x: number; y: number; inside: boolean } { return this.ptr; }

  // ── lifecycle ──────────────────────────────────────────────────────────────────────────────────
  attach(): () => void {
    const s = this.surface;
    const on = <K extends keyof WindowEventMap>(t: Window, k: K, f: (e: WindowEventMap[K]) => void, opt?: AddEventListenerOptions): void => {
      t.addEventListener(k, f as EventListener, opt); this.off.push(() => t.removeEventListener(k, f as EventListener, opt));
    };
    const onEl = <K extends keyof HTMLElementEventMap>(k: K, f: (e: HTMLElementEventMap[K]) => void, opt?: AddEventListenerOptions): void => {
      s.addEventListener(k, f as EventListener, opt); this.off.push(() => s.removeEventListener(k, f as EventListener, opt));
    };
    // capture phase: the match answers its keys (Esc cancels an aim, closes the shop) before the app's
    // bubbling handlers open the in-match menu
    on(window, 'keydown', (e) => this.onKeyDown(e), { capture: true });
    on(window, 'keyup', (e) => this.onKeyUp(e), { capture: true });
    on(window, 'pointermove', (e) => this.onMove(e), { passive: true });
    on(window, 'pointerup', (e) => this.onUp(e));
    on(window, 'blur', () => this.releaseAll());
    onEl('pointerdown', (e) => this.onDown(e));
    onEl('contextmenu', (e) => e.preventDefault());
    onEl('wheel', (e) => { e.preventDefault(); this.r.camera?.zoomBy(Math.sign(e.deltaY)); }, { passive: false });
    onEl('auxclick', (e) => e.preventDefault());
    document.documentElement.addEventListener('pointerleave', this.leave);
    this.off.push(() => document.documentElement.removeEventListener('pointerleave', this.leave));
    return () => this.detach();
  }
  detach(): void {
    for (const f of this.off.splice(0)) f();
    this.releaseAll();
    this.r.setAim?.(null);
    this.r.setHover?.(null);
    this.r.camera?.setPointer(0, 0, false);
  }
  private leave = (): void => { this.ptr.inside = false; this.r.camera?.setPointer(this.ptr.x, this.ptr.y, false); };

  private releaseAll(): void {
    this.held.clear();
    this.rightHeld = false;
    this.endShoot();
    this.ptrShift = false;
    this.buttons = 0;
    if (this.middle?.scouting) this.r.camera?.scout(false);
    this.middle = null;
    if (this.wheel.value) this.wheel.value = null;
    this.hooks.scoreboard(false);
    if (this.centring) this.endCentre();
    if (this.viewing) this.endView();
    // a held quick-cast-with-indicator key never sends its release now: the aim is dropped
    if (this.aiming.value?.hold) this.cancelAim();
  }

  // ── per frame (the HUD's rAF): aim indicator, hover, held move, centring ────────────────────────
  frame(now: number): void {
    this.syncAutoAttack(now);
    const aim = this.aiming.value;
    const body = this.body;
    if (aim && (!body || !body.alive)) this.cancelAim();
    else if (aim && body) {
      const g = this.ground();
      if (g) {
        const valid = this.aimUnitAt(aim.def, body);
        this.r.setAim?.(aimSpec(aim.def, body, g, valid));
      }
    }
    // attack in place: the aim line follows the cursor while the modifier is held; a held left button keeps attacking
    const shooting = !aim && !!body && body.alive && this.inPlaceHeld() && !this.attackMove.value;
    if (shooting && this.ptr.inside && this.ptr.x >= 0) {
      const g = this.ground();
      if (g) { this.r.setAim?.(this.shootSpec(body!, g)); this.shootAim = true; }
    } else if (this.shootAim) { this.shootAim = false; if (!aim) this.r.setAim?.(null); }
    if (this.leftShoot && (!shooting || (this.buttons & 1) === 0)) this.endShoot();
    if (this.leftShoot && now - this.lastShoot >= SHOOT_RESEND_MS) { this.lastShoot = now; this.shoot(false); }
    if (now - this.hoverAt > HOVER_MS && this.ptr.inside) {
      this.hoverAt = now;
      const over = this.ptr.x >= 0 && !this.overHud(now);
      // the outline shows what a click does: the attack target (the attack-move target while Shift is held or A
      // is armed), else any other unit but you (left-click selects it); enemies and neutrals in HARM, allies in their colour
      const armed = this.attackMove.value || this.shiftHeld();
      let id: EntityId | null = null;
      let cur: 'default' | 'attack' | 'ally' | 'aim' | 'attackMove' | 'shoot';
      if (aim) {
        const e = over ? this.aimUnitAt(aim.def, body) ?? this.entityAt() : null;
        id = e && e.id !== body?.id ? e.id : null;
        cur = 'aim';
      } else {
        const foe = over ? (armed || this.settings.controls.attackMoveOnClick ? this.attackMoveTarget(this.ground()) : this.moveClickEnemy()) : null;
        const e = foe ?? (over ? this.entityAt() : null);
        id = e && e.id !== body?.id ? e.id : null;
        cur = armed ? 'attackMove' : shooting ? 'shoot' : foe ? 'attack' : e && e.team === this.team && e.id !== body?.id ? 'ally' : 'default';
      }
      if (id !== this.hoverId) { this.hoverId = id; this.r.setHover?.(id); }
      this.cursor.value = cur;
    }
    // hold-to-steer: only real pointer motion re-steers (a locked camera following the hero moves the ground
    // under a still cursor; that alone must never keep the hero walking)
    if (this.rightHeld && !aim && now - this.lastHoldMove > HOLD_MOVE_MS && Math.hypot(this.ptr.x - this.holdPx.x, this.ptr.y - this.holdPx.y) >= HOLD_MIN_PX) {
      const g = this.ground();
      if (g && (!this.lastMoveTo || Math.hypot(g.x - this.lastMoveTo.x, g.y - this.lastMoveTo.y) > 0.6)) {
        this.lastHoldMove = now;
        this.holdPx = { x: this.ptr.x, y: this.ptr.y };
        this.moveTo(g, this.rightHeldAttack, false);
      }
    }
    // a held button keeps its order alive (genre: holding the button keeps re-issuing the move): every HOLD_RETRY_MS the
    // last point is re-sent while the hero stands more than HOLD_RETRY_NEAR m short of it. The sim ignores the same
    // point while that order is still being walked and restarts it after the walk gave up (a packed wave, ruling 38).
    // Always the point last sent, never the cursor's ground under a following camera (ruling 33)
    if (this.rightHeld && !aim && this.lastMoveTo && now - this.lastHoldMove > HOLD_RETRY_MS) {
      const b = this.body;
      if (b && b.alive && Math.hypot(b.x - this.lastMoveTo.x, b.y - this.lastMoveTo.y) > HOLD_RETRY_NEAR) {
        this.lastHoldMove = now;
        this.moveTo(this.lastMoveTo, this.rightHeldAttack, false);
      }
    }
    // the attack-range ring: held showRange, or attack-move armed (controls.rangeOnAttackMove); attack in place draws its own
    const ring = !!body && body.alive && !this.shootAim && (this.keymap.isHeld('showRange', this.held) || (this.attackMove.value && (this.settings.controls as ControlSettings).rangeOnAttackMove !== false));
    if (ring) { const at = this.r.unitPos?.(body!.id) ?? body!; this.r.setRangeRing?.({ x: at.x, y: at.y, radius: this.attackReach(body!) }); this.ringOn = true; }
    else if (this.ringOn) { this.ringOn = false; this.r.setRangeRing?.(null); }
    if (this.centring) this.r.camera?.centerOnSelf();
    else if (this.viewing) { const a = this.allyBody(this.viewing.ally); if (a) this.r.camera?.focusOn(a.x, a.y); }
  }
  /**
   * the auto attack switch (controls.autoAttack, ruling 61) reaches the sim as Command 'autoAttack': whenever the seat's
   * value in the view differs from the setting it is sent (at most every AUTO_RESEND_MS while the command is in flight).
   * A player who never turns it off sends nothing, so default matches keep their command streams and digests.
   */
  private syncAutoAttack(now: number): void {
    const me = this.me;
    if (!me) return;
    const want = (this.settings.controls as ControlSettings).autoAttack !== false;
    if ((me.autoAttack !== false) === want || now - this.autoSentAt < AUTO_RESEND_MS) return;
    this.autoSentAt = now;
    this.client.send({ type: 'autoAttack', on: want });
  }
  /** your basic attack's reach from your centre: stats.range + body radius (the ring and the attack-in-place line) */
  attackReach(b: EntityView): number { return Math.max(0.5, (this.me?.stats?.range ?? 0) + b.radius); }

  /**
   * is the pointer over HUD chrome? The last pointermove's own hit-test target answers for free, but only for
   * HUD_RETEST_MS: a panel can open (or close) under a pointer that never moves, so the browser hit-test
   * (elementFromPoint) re-runs on that cadence and on any frame without a usable target (no move since attach,
   * a synthetic pointer, a target that left the DOM). Hover, attack cursor and outline then stop at the panel
   * within 250 ms.
   */
  private overHud(now: number): boolean {
    let el = this.ptrTarget as Element | null;
    const stale = now - this.hudAt >= HUD_RETEST_MS;
    if (!el || !el.isConnected || stale) {
      if (!stale) return this.hudHit;
      this.hudAt = now;
      el = document.elementFromPoint(this.ptr.x, this.ptr.y);
      this.ptrTarget = el;
    }
    this.hudHit = !!el && el !== this.surface && !this.surface.contains(el) && !!(el as HTMLElement).closest?.('.hud');
    return this.hudHit;
  }

  // ── keys ───────────────────────────────────────────────────────────────────────────────────────
  private onKeyDown(e: KeyboardEvent): void {
    if (e.defaultPrevented || isField(e.target)) return;
    const acts = this.keymap.actions(e.code);
    if (e.code === 'Escape') {
      if (this.hooks.blocked()) return;
      if (this.aiming.value || this.attackMove.value || this.wheel.value) { e.preventDefault(); e.stopImmediatePropagation(); this.cancelAim(); this.attackMove.value = false; this.wheel.value = null; return; }
      if (this.hooks.closeShop()) { e.preventDefault(); e.stopImmediatePropagation(); }
      return;
    }
    if (!acts.length) { this.held.add(e.code); return; }
    // bound keys never do their browser default (Tab focus walk, Space scroll, F-key shortcuts)
    e.preventDefault();
    if (this.hooks.blocked()) return;
    const repeat = e.repeat || this.held.has(e.code);
    this.held.add(e.code);
    const lvl = this.levelModHeld(e);
    for (const a of acts) this.action(a, true, repeat, lvl);
  }
  private onKeyUp(e: KeyboardEvent): void {
    this.held.delete(e.code);
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.ptrShift = false;
    const acts = this.keymap.actions(e.code);
    for (const a of acts) this.action(a, false, false, false);
  }

  /** is the level-up modifier held (levelUpMod, default Ctrl; either side of a modifier pair, or the key event's own flag) */
  private levelModHeld(e?: { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; shiftKey?: boolean }): boolean {
    const c = this.keymap.code('levelUpMod');
    if (!c) return false;
    if (this.keymap.isHeld('levelUpMod', this.held)) return true;
    const m = /^(Control|Alt|Meta|Shift)(Left|Right)$/.exec(c);
    if (!m || !e) return false;
    return m[1] === 'Control' ? !!e.ctrlKey : m[1] === 'Alt' ? !!e.altKey : m[1] === 'Meta' ? !!e.metaKey : !!e.shiftKey;
  }

  /** an action pressed (down) or released (up) — keys and bound mouse buttons alike. `lvl`: the level-up modifier is held */
  action(a: Action, down: boolean, repeat = false, lvl = false): void {
    if (!down) {
      if (a === 'scoreboard') this.hooks.scoreboard(false);
      else if (a === 'ping') this.releaseWheel();
      else if (a === 'centerCamera') this.endCentre();
      else if (this.viewing?.action === a) this.endView();
      else { const s = slotOfAction(a); if (s) this.releaseSlot(s); }
      return;
    }
    if (a === 'scoreboard') { this.hooks.scoreboard(true); return; }
    if (repeat) return;
    if (lvl && (LEVEL_SLOTS as readonly string[]).includes(a)) { this.levelUp(a as (typeof LEVEL_SLOTS)[number]); return; }
    const slot = slotOfAction(a);
    if (slot) { this.press(slot, true); return; }
    const ally = VIEW_ALLY.indexOf(a);
    if (ally >= 0) { this.startView(ally, a); return; }
    switch (a) {
      case 'attackMove': this.cancelAim(); this.attackMove.value = true; this.cursor.value = 'attackMove'; break;
      case 'stop': this.cancelAim(); this.attackMove.value = false; this.client.send({ type: 'stop' }); break;
      case 'recall': this.cancelAim(); this.client.send({ type: 'recall' }); break;
      case 'shop': this.hooks.toggleShop(); break;
      case 'ping': this.openWheel(); break;
      case 'cameraLock': this.hooks.setCameraLock(this.r.camera?.mode !== 'locked'); break;
      case 'centerCamera': this.startCentre(); break;
      case 'toggleAutoAttack': this.hooks.toggleAutoAttack?.(); break;
      default: break;
    }
  }

  levelUp(slot: (typeof LEVEL_SLOTS)[number]): void {
    const av = this.me?.abilities.find((x) => x.slot === slot);
    if (!av?.canLevel) { this.hooks.denied(slot, 'rank'); return; }
    this.client.send({ type: 'levelUp', slot });
  }

  // ── casting ────────────────────────────────────────────────────────────────────────────────────
  /** the ability record and readiness of a slot (abilities, spells, item actives) */
  slotInfo(slot: SlotT): { def: AbilityCore | undefined; ready: boolean; why?: DenyReason } {
    const me = this.me;
    if (!me) return { def: undefined, ready: false, why: 'dead' };
    const locked = this.castLocked();
    if (slot.startsWith('item')) {
      const i = Number(slot.slice(4)) - 1;
      const item = me.items[i];
      if (!item) return { def: undefined, ready: false, why: 'empty' };
      const av = me.abilities.find((x) => x.slot === slot);
      const def = this.index.get(av?.id) ?? this.index.itemActive(item);
      if (!def) return { def: undefined, ready: false, why: 'no_active' };
      if (locked) return { def, ready: false, why: 'cc' };
      const cd = av ? av.cooldown : me.itemCooldowns[i] ?? 0;
      if (cd > 0 && !(av?.recastWindow && av.recastWindow > 0)) return { def, ready: false, why: 'cooldown' };
      return { def, ready: true };
    }
    const av = me.abilities.find((x) => x.slot === slot);
    const def = this.index.get(av?.id);
    if (!av || !def) return { def, ready: false, why: 'empty' };
    if (av.rank <= 0) return { def, ready: false, why: 'rank' };
    // you cannot act: refuse at the press (no aim starts), whatever else the slot is waiting on
    if (locked) return { def, ready: false, why: 'cc' };
    if (av.ready) return { def, ready: true };
    const recast = (av.recastWindow ?? 0) > 0;
    if (av.cooldown > 0 && !recast && !(av.maxCharges && (av.charges ?? 0) > 0)) return { def, ready: false, why: 'cooldown' };
    const body = this.body;
    if (def.costKind === 'res' && body && av.cost > body.res + 1e-6) return { def, ready: false, why: 'resource' };
    if (body?.statuses.some((s) => s.kind === 'silence') && slot !== 'spell1' && slot !== 'spell2') return { def, ready: false, why: 'silenced' };
    // not ready for a reason the view does not name (mid-cast, mid-dash): send it, the sim decides
    return { def, ready: true };
  }
  /** you cannot cast anything right now (stun, airborne, sleep, taunt, fear) */
  private castLocked(): boolean {
    const b = this.body;
    if (!b) return false;
    for (const s of b.statuses) if (s.remaining > 0 && CAST_LOCK.has(s.kind)) return true;
    return false;
  }

  /** a cast key (`key`) or a HUD slot click was pressed */
  press(slot: SlotT, key = false): void {
    const body = this.body;
    if (!body || !body.alive) { this.hooks.denied(slot, 'dead'); return; }
    const info = this.slotInfo(slot);
    if (!info.def || !info.ready) { this.hooks.denied(slot, info.why ?? 'cooldown'); return; }
    const def = info.def;
    const kind = def.targeting.kind;
    this.attackMove.value = false;
    if (kind === 'none' || kind === 'self') { this.cancelAim(); this.sendCast(slot, {}); return; }
    if (kind === 'unit' && canSelfCast(def) && this.keymap.selfCastHeld(this.held)) { this.cancelAim(); this.sendCast(slot, { target: body.id }); return; }
    const cur = this.aiming.value;
    if (cur && cur.slot === slot) { this.confirmAim(); return; }        // the key again casts at the cursor
    const mode = castModeOf(this.settings.controls, slot);
    // quick cast with indicator: aim while the key is held, cast on its release (a HUD click has no release: it aims)
    if (mode === 'quickIndicator') { this.startAim(slot, def, key); return; }
    if (mode === 'quick') {
      if (kind === 'unit') {
        const t = this.aimUnitAt(def, body);
        if (t && unitMatches(def.targeting.filter, body, t, this.team)) { this.cancelAim(); this.sendCast(slot, { target: t.id }); }
        else this.startAim(slot, def);        // nothing valid under the cursor: aim instead of wasting the press
        return;
      }
      const g = this.ground();
      if (g) { this.cancelAim(); this.sendCast(slot, this.pointFor(def, body, g)); return; }
    }
    this.startAim(slot, def);
  }

  /** a valid target of a unit-targeted ability under the cursor (only valid units compete, near misses forgiven) */
  private aimUnitAt(def: AbilityCore, body: EntityView | undefined): EntityView | null {
    if (!body || def.targeting.kind !== 'unit') return null;
    const ok = (v: EntityView): boolean => unitMatches(def.targeting.filter, body, v, this.team);
    const t = this.entityAt(this.ptr.x, this.ptr.y, { filter: ok, slop: PICK_SLOP_PX });
    return t && ok(t) ? t : null;
  }

  private pointFor(def: AbilityCore, body: EntityView, g: { x: number; y: number }): { x: number; y: number } {
    return def.targeting.kind === 'point' ? clampToRange(body, g, reachOf(def)) : g;
  }

  private startAim(slot: SlotT, def: AbilityCore, hold = false): void {
    this.aiming.value = hold ? { slot, def, hold } : { slot, def };
    this.cursor.value = 'aim';
    this.frame(performance.now());
  }
  cancelAim(): void {
    if (!this.aiming.value) return;
    this.aiming.value = null;
    this.r.setAim?.(null);
    this.cursor.value = 'default';
  }
  /**
   * a cast key went up: a quick-cast-with-indicator aim of that slot casts now, on the release (ruling 54). A unit ability
   * with no valid unit under the cursor, or a fighter that cannot act, keeps aiming as a normal cast (left-click or the
   * key again); a modal opened meanwhile drops the aim
   */
  private releaseSlot(slot: SlotT): void {
    const aim = this.aiming.value;
    if (!aim || aim.slot !== slot || !aim.hold) return;
    if (this.hooks.blocked()) { this.cancelAim(); return; }
    const body = this.body;
    if (aim.def.targeting.kind === 'unit' && body) {
      const t = this.aimUnitAt(aim.def, body);
      if (!t || !unitMatches(aim.def.targeting.filter, body, t, this.team) || this.castLocked()) { this.aiming.value = { slot, def: aim.def }; return; }
    }
    if (!this.confirmAim() && this.aiming.value) this.aiming.value = { slot, def: aim.def };
  }

  /** cast the aimed slot at the cursor; false when the cursor holds no valid target */
  private confirmAim(): boolean {
    const aim = this.aiming.value, body = this.body;
    if (!aim || !body) return false;
    // aimed before the loss of control landed: refuse now (the aim stays, ready for when it ends)
    if (this.castLocked()) { this.hooks.denied(aim.slot, 'cc'); return false; }
    if (aim.def.targeting.kind === 'unit') {
      const t = this.aimUnitAt(aim.def, body);
      if (!t || !unitMatches(aim.def.targeting.filter, body, t, this.team)) { this.hooks.denied(aim.slot, 'target'); return false; }
      this.cancelAim();
      this.sendCast(aim.slot, { target: t.id });
      return true;
    }
    const g = this.ground();
    if (!g) return false;
    this.cancelAim();
    this.sendCast(aim.slot, this.pointFor(aim.def, body, g));
    return true;
  }
  private sendCast(slot: SlotT, o: { x?: number; y?: number; target?: EntityId }): void {
    this.client.send({ type: 'cast', slot, ...o });
    this.hooks.cast?.(slot);
  }

  // ── pointer ────────────────────────────────────────────────────────────────────────────────────
  private onMove(e: PointerEvent): void {
    this.ptr.x = e.clientX; this.ptr.y = e.clientY; this.ptr.inside = true;
    this.ptrTarget = e.target;
    this.hudAt = performance.now();
    this.ptrShift = e.shiftKey;
    this.r.camera?.setPointer(e.clientX, e.clientY, true);
    // chorded buttons (Pointer Events): pressing or releasing a button while another is down fires no
    // pointerdown/pointerup, only a pointermove. The button mask is the truth: act on its changes only
    if (e.pointerType === 'mouse' || e.pointerType === '') {
      const prev = this.buttons;
      this.buttons = e.buttons;
      if (this.rightHeld && (e.buttons & 2) === 0) this.releaseRight();
      if ((e.buttons & 1) === 0) this.endShoot();
      const pressed = e.buttons & ~prev;
      if (pressed & 3) {
        const onSurface = e.target === this.surface || (typeof Node !== 'undefined' && e.target instanceof Node && this.surface.contains(e.target));
        if (onSurface && !this.hooks.blocked()) {
          if (pressed & 1) this.leftDown(e);
          if (pressed & 2) this.rightDown(e.shiftKey);
        }
      }
    }
    const w = this.wheel.value;
    if (w) {
      const dx = e.clientX - w.x, dy = e.clientY - w.y;
      const sel = Math.hypot(dx, dy) < WHEEL_DEADZONE ? null : PING_ORDER[Math.round(((Math.atan2(dx, -dy) / (Math.PI * 2)) * PING_ORDER.length + PING_ORDER.length)) % PING_ORDER.length];
      if (sel !== w.sel) this.wheel.value = { ...w, sel };
    }
    if (this.middle) {
      const cam = this.r.camera;
      const g = this.ground();
      const c = this.ground(innerWidth / 2, innerHeight / 2);
      if (cam && g && c) cam.focusOn(c.x + (this.middle.gx - g.x), c.y + (this.middle.gy - g.y));
    }
  }

  private onDown(e: PointerEvent): void {
    this.ptr.x = e.clientX; this.ptr.y = e.clientY; this.ptr.inside = true;
    this.ptrShift = e.shiftKey;
    this.buttons = e.buttons;
    if (this.hooks.blocked()) return;
    const bound = this.keymap.actions(mouseCode(e.button)).filter((a) => a !== 'selfCastMod');
    if (e.button > 2 && bound.length) { e.preventDefault(); this.held.add(mouseCode(e.button)); for (const a of bound) this.action(a, true); return; }
    if (e.button === 1) {
      e.preventDefault();
      const g = this.ground();
      const cam = this.r.camera;
      if (g && cam) {
        // a locked camera only peeks while the button is held; an unlocked one stays where you drag it
        const scouting = cam.mode === 'locked';
        if (scouting) cam.scout(true); else if (cam.mode !== 'free') cam.setMode('free');
        this.middle = { gx: g.x, gy: g.y, scouting };
      }
      return;
    }
    if (e.button === 0) this.leftDown(e);
    else if (e.button === 2) this.rightDown(e.shiftKey);
  }
  private onUp(e: PointerEvent): void {
    this.ptr.x = e.clientX; this.ptr.y = e.clientY;
    this.buttons = e.buttons;
    if (e.button === 0) this.endShoot();
    if (e.button === 2) this.releaseRight();
    else if (this.rightHeld && (e.buttons & 2) === 0) this.rightHeld = false;   // right went up first (chorded)
    if (e.button === 1) { if (this.middle?.scouting) this.r.camera?.scout(false); this.middle = null; }
    if (e.button > 2) this.held.delete(mouseCode(e.button));
    const bound = e.button > 2 ? this.keymap.actions(mouseCode(e.button)) : [];
    for (const a of bound) this.action(a, false);
  }
  /** the right button went up: a steer that the pointer moved since the last order ends at the cursor itself */
  private releaseRight(): void {
    if (!this.rightHeld) return;
    this.rightHeld = false;
    if (this.aiming.value || this.hooks.blocked() || Math.hypot(this.ptr.x - this.holdPx.x, this.ptr.y - this.holdPx.y) < HOLD_MIN_PX) return;
    const g = this.ground();
    if (g && (!this.lastMoveTo || Math.hypot(g.x - this.lastMoveTo.x, g.y - this.lastMoveTo.y) > 0.3)) this.moveTo(g, this.rightHeldAttack, false);
  }
  private armHold(attack: boolean): void {
    this.rightHeld = true; this.rightHeldAttack = attack;
    this.lastHoldMove = performance.now();
    this.holdPx = { x: this.ptr.x, y: this.ptr.y };
  }
  private attackUnit(t: EntityView): void {
    this.client.send({ type: 'attack', target: t.id });
    this.hooks.marker({ x: t.x, y: t.y, kind: 'attack', target: t.id });
  }
  /**
   * an attack-move click (Shift + right-click, A + left-click, right-click with attackMoveOnClick): attack the
   * enemy it means (attackMoveTarget), else attack-move to the ground point; `hold` arms steering for a ground
   * click with the right button (never for a unit: a steer would replace the attack with a ground order)
   */
  private attackMoveClick(hold: boolean): void {
    const g = this.ground();
    const t = this.attackMoveTarget(g);
    if (t) { this.attackUnit(t); return; }
    if (!g) return;
    this.moveTo(g, true, true);
    if (hold) this.armHold(true);
  }

  private leftDown(e: PointerEvent): void {
    if (this.wheel.value) return;
    if (this.aiming.value) { this.confirmAim(); return; }
    const g = this.ground();
    if (this.attackMove.value) {
      this.attackMove.value = false;
      this.cursor.value = 'default';
      this.attackMoveClick(false);
      return;
    }
    if (e.altKey && g) { this.sendPing('alert', g.x, g.y, this.entityAt()?.id); return; }
    if (this.inPlaceHeld()) {
      const b = this.body;
      if (b && b.alive && this.shoot(true)) { this.leftShoot = true; this.lastShoot = performance.now(); }
      return;
    }
    const t = this.entityAt();
    this.r.setTarget?.(t ? t.id : null);
  }

  /**
   * attack in place toward the cursor (ruling 39): the enemy the click means (attackMoveTarget: under the cursor, else
   * nearest the click point) rides along as `target`; the sim attacks it if it is in range, else the meant enemy in
   * range nearest the point, else throws the attack toward the point. Never a move. `marker`: the first click of a hold
   */
  private shoot(marker: boolean): boolean {
    if (this.hooks.blocked()) return false;
    const g = this.ground();
    if (!g) return false;
    const t = this.attackMoveTarget(g);
    this.client.send({ type: 'attackAt', x: g.x, y: g.y, ...(t ? { target: t.id } : {}), ...(this.fightersOnly() ? { fighters: true } : {}), ...(marker ? {} : { held: true }) });
    this.shootSends = marker ? 1 : this.shootSends + 1;
    this.shootAt = { x: g.x, y: g.y };
    if (marker && t) this.hooks.marker({ x: t.x, y: t.y, kind: 'attack', target: t.id });
    return true;
  }
  /** the held attack-in-place press ends (button or modifier let go): a hold that re-sent tells the sim to stop now, so
   *  no owed attack goes off after the release (orch1 r2); a single click keeps its one attack */
  private endShoot(): void {
    if (!this.leftShoot) return;
    this.leftShoot = false;
    if (this.shootSends >= 2) this.client.send({ type: 'attackAt', x: this.shootAt.x, y: this.shootAt.y, end: true });
    this.shootSends = 0;
  }
  /** the attack-in-place aim line: from the hero toward the cursor, its attack reach (range + body) long, the reach ring */
  private shootSpec(b: EntityView, g: { x: number; y: number }): AimSpecLike {
    const reach = this.attackReach(b);
    return { shape: 'line', x: b.x, y: b.y, dir: Math.atan2(g.y - b.y, g.x - b.x), length: reach, width: SHOOT_LINE_W, range: reach, casterX: b.x, casterY: b.y };
  }

  private rightDown(shift: boolean): void {
    if (this.wheel.value) { this.wheel.value = null; return; }
    this.cancelAim();
    if (this.attackMove.value) { this.attackMove.value = false; this.cursor.value = 'default'; }
    const body = this.body;
    if (!body || !body.alive) return;
    if (shift || this.settings.controls.attackMoveOnClick) { this.attackMoveClick(true); return; }
    const t = this.moveClickEnemy();
    if (t) { this.attackUnit(t); return; }
    const g = this.ground();
    if (!g) return;
    this.moveTo(g, false, true);
    this.armHold(false);
  }

  /** move (or attack-move) to a ground point; minimap right-clicks come through here too */
  moveTo(g: { x: number; y: number }, attackMove: boolean, marker: boolean, prefer?: EntityId): void {
    if (this.hooks.blocked()) return;
    this.client.send(attackMove ? { type: 'move', x: g.x, y: g.y, attackMove: true, ...(prefer === undefined ? {} : { prefer }) } : { type: 'move', x: g.x, y: g.y });
    this.lastMoveTo = g;
    if (marker) this.hooks.marker({ x: g.x, y: g.y, kind: attackMove ? 'attackMove' : 'move' });
  }

  // ── pings ──────────────────────────────────────────────────────────────────────────────────────
  private openWheel(): void {
    if (this.hooks.pingsDisabled()) { this.hooks.denied('ping', 'ping_fray'); return; }
    if (!this.ptr.inside || this.ptr.x < 0) return;
    const g = this.ground();
    if (!g) return;
    const t = this.entityAt();
    this.wheelAt = performance.now();
    this.wheel.value = { x: this.ptr.x, y: this.ptr.y, gx: g.x, gy: g.y, target: t?.id, sel: null };
  }
  private releaseWheel(): void {
    const w = this.wheel.value;
    if (!w) return;
    this.wheel.value = null;
    this.sendPing(w.sel ?? 'alert', w.gx, w.gy, w.sel === 'missing' || w.sel === 'danger' || w.sel === 'objective' ? w.target : undefined);
  }
  /** a ping at a sim point (the wheel, Alt-click, the minimap) */
  sendPing(kind: PingKind, x: number, y: number, target?: EntityId): void {
    if (this.hooks.pingsDisabled()) { this.hooks.denied('ping', 'ping_fray'); return; }
    const now = performance.now();
    this.pingTimes = this.pingTimes.filter((t) => now - t < PING_WINDOW_MS);
    if (this.pingTimes.length >= PING_LIMIT) { this.hooks.denied('ping', 'ping_limit'); return; }
    this.pingTimes.push(now);
    this.client.send(target !== undefined ? { type: 'ping', kind, x, y, target } : { type: 'ping', kind, x, y });
  }
  get wheelOpenedAt(): number { return this.wheelAt; }

  // ── camera ─────────────────────────────────────────────────────────────────────────────────────
  private startCentre(): void {
    const cam = this.r.camera;
    if (!cam || this.centring) return;
    this.centring = { prev: cam.mode };
    cam.centerOnSelf();
  }
  /** your allies' fighters in seat order (viewAlly1 = the first) */
  private allyBody(i: number): EntityView | undefined {
    const allies = this.client.view.players.filter((p) => p && p.team === this.team && p.player !== this.client.you).sort((a, b) => a.player - b.player);
    const p = allies[i];
    return p ? this.client.view.entity(p.entity) : undefined;
  }
  private startView(ally: number, action: Action): void {
    const cam = this.r.camera;
    if (!cam || this.viewing || this.centring || !this.allyBody(ally)) return;
    const scouting = cam.mode === 'locked';
    const back = scouting ? null : this.ground(innerWidth / 2, innerHeight / 2);
    if (scouting) cam.scout(true);
    this.viewing = { ally, action, scouting, back };
    const a = this.allyBody(ally);
    if (a) cam.focusOn(a.x, a.y);
  }
  private endView(): void {
    const v = this.viewing;
    this.viewing = null;
    const cam = this.r.camera;
    if (!v || !cam) return;
    if (v.scouting) cam.scout(false);
    else if (v.back) cam.focusOn(v.back.x, v.back.y);
  }
  private endCentre(): void {
    const c = this.centring;
    this.centring = null;
    const cam = this.r.camera;
    if (!c || !cam) return;
    // centring re-leashes a camera the player had unlocked
    if (c.prev === 'free') cam.setMode('semi');
  }
}
