// VALE input — the match controller (CONTRACT §10 "Input"). Real keys and mouse buttons become
// Commands on MatchClient.send; nothing here touches the sim. It needs only the renderer's picking and
// camera seam (structural `InputRenderer`, the RENDER lane's createRenderer implements all of it) and
// the HUD's hooks for the things that are not commands (shop, scoreboard, ping wheel, markers).
//
//   right-click ground      move (attack-move when controls.attackMoveOnClick); held = keeps steering
//   right-click enemy       attack it
//   A then left-click       attack-move · S stop · B recall · P shop · Tab scoreboard (hold)
//   Q W E R D F 1–6         cast: quick cast (controls.quickCast) at the cursor, or normal cast = aim
//                           first (the renderer draws your indicator), then left-click or the key again;
//                           right-click / Esc cancels; the self-cast modifier casts unit abilities on you
//   Ctrl + Q W E R          level the ability up
//   G (hold)                ping wheel at the cursor; a tap pings "Look here"; Alt + left-click pings too
//   Y                       camera lock · Space (hold) centre on your fighter · wheel zoom · middle-drag
//                           pans (unlocks the camera) · edge pan through the renderer's camera rig
// Keys typed into a field (shop search) never reach the game. While a modal is open nothing is sent.

import { signal } from '@preact/signals';
import type { SlotT } from '../contracts/catalog.ts';
import type { MatchClient, Settings } from '../contracts/session.ts';
import type { EntityId, EntityView, PingKind, PlayerView } from '../contracts/sim.ts';
import { AbilityIndex, aimSpec, canSelfCast, clampToRange, reachOf, unitMatches, type AbilityCore, type AimSpecLike } from './abilities.ts';
import { Keymap, LEVEL_SLOTS, mouseCode, slotOfAction, type Action } from './keymap.ts';

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
/** what input uses of the renderer (render/renderer.ts Renderer; every member optional so the client
 *  still runs without a renderer, ?render=0) */
export interface InputRenderer {
  pickGround?(x: number, y: number): { x: number; y: number } | null;
  pickEntity?(x: number, y: number): EntityId | null;
  worldToScreen?(x: number, y: number, height?: number): { x: number; y: number; visible: boolean };
  setAim?(aim: AimSpecLike | null): void;
  setHover?(id: EntityId | null): void;
  setTarget?(id: EntityId | null): void;
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
}

/** clockwise from 12 o'clock (client_hud §5) */
export const PING_ORDER: readonly PingKind[] = ['alert', 'danger', 'onMyWay', 'missing', 'assist', 'push', 'vision', 'objective', 'retreat'];
const PING_LIMIT = 5, PING_WINDOW_MS = 4000;
const WHEEL_DEADZONE = 26;
const HOLD_MOVE_MS = 140;
const HOVER_MS = 50;
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
  /** the slot being aimed (normal cast) */
  readonly aiming = signal<{ slot: SlotT; def: AbilityCore } | null>(null);
  /** attack-move armed (next left-click) */
  readonly attackMove = signal(false);
  readonly wheel = signal<WheelState | null>(null);
  /** what the cursor is over: drives the CSS cursor */
  readonly cursor = signal<'default' | 'attack' | 'ally' | 'aim' | 'attackMove'>('default');
  readonly held = new Set<string>();

  private client: MatchClient;
  private r: InputRenderer;
  private hooks: InputHooks;
  private surface: HTMLElement;
  private settings: Settings;
  private ptr = { x: -1, y: -1, inside: false };
  private rightHeld = false;
  private lastHoldMove = 0;
  private lastMoveTo: { x: number; y: number } | null = null;
  private middle: { gx: number; gy: number } | null = null;
  private hoverAt = 0;
  private hoverId: EntityId | null = null;
  /** what the browser hit-tested under the pointer on its last move (free: no forced layout) */
  private ptrTarget: EventTarget | null = null;
  private hudAt = -1e9;
  private hudHit = false;
  private centring: { prev: 'locked' | 'semi' | 'free' } | null = null;
  private pingTimes: number[] = [];
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
  private entityAt(x = this.ptr.x, y = this.ptr.y): EntityView | null {
    if (x < 0) return null;
    const id = this.r.pickEntity?.(x, y);
    return id === null || id === undefined ? null : this.client.view.entity(id) ?? null;
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
    this.middle = null;
    if (this.wheel.value) this.wheel.value = null;
    this.hooks.scoreboard(false);
    if (this.centring) this.endCentre();
  }

  // ── per frame (the HUD's rAF): aim indicator, hover, held move, centring ────────────────────────
  frame(now: number): void {
    const aim = this.aiming.value;
    const body = this.body;
    if (aim && (!body || !body.alive)) this.cancelAim();
    else if (aim && body) {
      const g = this.ground();
      if (g) {
        const hov = aim.def.targeting.kind === 'unit' ? this.entityAt() : null;
        const valid = hov && unitMatches(aim.def.targeting.filter, body, hov, this.team) ? hov : null;
        this.r.setAim?.(aimSpec(aim.def, body, g, valid));
      }
    }
    if (now - this.hoverAt > HOVER_MS && this.ptr.inside) {
      this.hoverAt = now;
      const e = this.ptr.x >= 0 && !this.overHud(now) ? this.entityAt() : null;
      const id = e && e.id !== body?.id ? e.id : null;
      // every hovered unit but you: the renderer outlines enemies and neutrals in HARM, allies in their colour
      if (id !== this.hoverId) { this.hoverId = id; this.r.setHover?.(id); }
      this.cursor.value = aim ? 'aim' : this.attackMove.value ? 'attackMove' : e && this.enemy(e) ? 'attack' : e && e.team === this.team && e.id !== body?.id ? 'ally' : 'default';
    }
    if (this.rightHeld && !aim && now - this.lastHoldMove > HOLD_MOVE_MS) {
      this.lastHoldMove = now;
      const g = this.ground();
      if (g && (!this.lastMoveTo || Math.hypot(g.x - this.lastMoveTo.x, g.y - this.lastMoveTo.y) > 0.6)) this.moveTo(g, false, false);
    }
    if (this.centring) this.r.camera?.centerOnSelf();
  }

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
    for (const a of acts) this.action(a, true, repeat, e.ctrlKey);
  }
  private onKeyUp(e: KeyboardEvent): void {
    this.held.delete(e.code);
    const acts = this.keymap.actions(e.code);
    for (const a of acts) this.action(a, false, false, false);
  }

  /** an action pressed (down) or released (up) — keys and bound mouse buttons alike */
  action(a: Action, down: boolean, repeat = false, ctrl = false): void {
    if (!down) {
      if (a === 'scoreboard') this.hooks.scoreboard(false);
      else if (a === 'ping') this.releaseWheel();
      else if (a === 'centerCamera') this.endCentre();
      return;
    }
    if (a === 'scoreboard') { this.hooks.scoreboard(true); return; }
    if (repeat) return;
    if (ctrl && (LEVEL_SLOTS as readonly string[]).includes(a)) { this.levelUp(a as (typeof LEVEL_SLOTS)[number]); return; }
    const slot = slotOfAction(a);
    if (slot) { this.press(slot); return; }
    switch (a) {
      case 'attackMove': this.cancelAim(); this.attackMove.value = true; this.cursor.value = 'attackMove'; break;
      case 'stop': this.cancelAim(); this.attackMove.value = false; this.client.send({ type: 'stop' }); break;
      case 'recall': this.cancelAim(); this.client.send({ type: 'recall' }); break;
      case 'shop': this.hooks.toggleShop(); break;
      case 'ping': this.openWheel(); break;
      case 'cameraLock': this.hooks.setCameraLock(this.r.camera?.mode !== 'locked'); break;
      case 'centerCamera': this.startCentre(); break;
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

  /** a cast key (or a HUD slot click) was pressed */
  press(slot: SlotT): void {
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
    if (this.settings.controls.quickCast) {
      if (kind === 'unit') {
        const t = this.entityAt();
        if (t && unitMatches(def.targeting.filter, body, t, this.team)) { this.cancelAim(); this.sendCast(slot, { target: t.id }); }
        else this.startAim(slot, def);        // nothing valid under the cursor: aim instead of wasting the press
        return;
      }
      const g = this.ground();
      if (g) { this.cancelAim(); this.sendCast(slot, this.pointFor(def, body, g)); return; }
    }
    this.startAim(slot, def);
  }

  private pointFor(def: AbilityCore, body: EntityView, g: { x: number; y: number }): { x: number; y: number } {
    return def.targeting.kind === 'point' ? clampToRange(body, g, reachOf(def)) : g;
  }

  private startAim(slot: SlotT, def: AbilityCore): void {
    this.aiming.value = { slot, def };
    this.cursor.value = 'aim';
    this.frame(performance.now());
  }
  cancelAim(): void {
    if (!this.aiming.value) return;
    this.aiming.value = null;
    this.r.setAim?.(null);
    this.cursor.value = 'default';
  }
  /** cast the aimed slot at the cursor; false when the cursor holds no valid target */
  private confirmAim(): boolean {
    const aim = this.aiming.value, body = this.body;
    if (!aim || !body) return false;
    // aimed before the loss of control landed: refuse now (the aim stays, ready for when it ends)
    if (this.castLocked()) { this.hooks.denied(aim.slot, 'cc'); return false; }
    if (aim.def.targeting.kind === 'unit') {
      const t = this.entityAt();
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
    this.r.camera?.setPointer(e.clientX, e.clientY, true);
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
    if (this.hooks.blocked()) return;
    const bound = this.keymap.actions(mouseCode(e.button)).filter((a) => a !== 'selfCastMod');
    if (e.button > 2 && bound.length) { e.preventDefault(); for (const a of bound) this.action(a, true); return; }
    if (e.button === 1) {
      e.preventDefault();
      const g = this.ground();
      if (g && this.r.camera) { if (this.r.camera.mode !== 'free') this.r.camera.setMode('free'); this.middle = { gx: g.x, gy: g.y }; }
      return;
    }
    if (e.button === 0) this.leftDown(e);
    else if (e.button === 2) this.rightDown();
  }
  private onUp(e: PointerEvent): void {
    if (e.button === 2) this.rightHeld = false;
    if (e.button === 1) this.middle = null;
    const bound = e.button > 2 ? this.keymap.actions(mouseCode(e.button)) : [];
    for (const a of bound) this.action(a, false);
  }

  private leftDown(e: PointerEvent): void {
    if (this.wheel.value) return;
    if (this.aiming.value) { this.confirmAim(); return; }
    const g = this.ground();
    if (this.attackMove.value) {
      this.attackMove.value = false;
      this.cursor.value = 'default';
      const t = this.entityAt();
      if (t && this.enemy(t)) { this.client.send({ type: 'attack', target: t.id }); this.hooks.marker({ x: t.x, y: t.y, kind: 'attack', target: t.id }); return; }
      if (g) this.moveTo(g, true, true);
      return;
    }
    if (e.altKey && g) { this.sendPing('alert', g.x, g.y, this.entityAt()?.id); return; }
    const t = this.entityAt();
    this.r.setTarget?.(t ? t.id : null);
  }

  private rightDown(): void {
    if (this.wheel.value) { this.wheel.value = null; return; }
    this.cancelAim();
    if (this.attackMove.value) { this.attackMove.value = false; this.cursor.value = 'default'; }
    const body = this.body;
    if (!body || !body.alive) return;
    const t = this.entityAt();
    if (t && this.enemy(t)) {
      this.client.send({ type: 'attack', target: t.id });
      this.hooks.marker({ x: t.x, y: t.y, kind: 'attack', target: t.id });
      return;
    }
    const g = this.ground();
    if (!g) return;
    this.moveTo(g, this.settings.controls.attackMoveOnClick, true);
    this.rightHeld = true;
    this.lastHoldMove = performance.now();
  }

  /** move (or attack-move) to a ground point; minimap right-clicks come through here too */
  moveTo(g: { x: number; y: number }, attackMove: boolean, marker: boolean): void {
    if (this.hooks.blocked()) return;
    this.client.send(attackMove ? { type: 'move', x: g.x, y: g.y, attackMove: true } : { type: 'move', x: g.x, y: g.y });
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
  private endCentre(): void {
    const c = this.centring;
    this.centring = null;
    const cam = this.r.camera;
    if (!c || !cam) return;
    // centring re-leashes a camera the player had unlocked
    if (c.prev === 'free') cam.setMode('semi');
  }
}
