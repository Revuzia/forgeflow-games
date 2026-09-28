// DYEFIELD — juice: screen-space feel (CONTRACT_P6_11 §21). DOM + one lazy 2D canvas; THREE-free.
//
// ONE integration surface for game.ts (FRONTEND wires it):
//   const juice = createJuice(uiRoot, { reduceMotion });          // once, after the HUD exists
//   juice.onEvents(events, ctx);    // every frame, with the SimEvents drained this frame
//   juice.update(dt, ctx);          // every rendered frame (fades, low-HP breathing, confetti)
//   juice.victory(winner, card);    // when the victory slate appears (confetti in the winner's colour, clipped
//                                   // off `card` — the slate's title + tally + buttons stay clean)
//   juice.trauma(amount, cap);      // extra shake sources without a SimEvent (spring pads)
//   juice.setReduceMotion(on) / setColorblind(on) / reset() / dispose() / readback()
// `ctx` is ONE object the caller keeps and refreshes (no per-frame allocation): the viewer id, the sim
// runners and the FollowCamera (anything with addTrauma / yaw / reduceMotion).
//
// What it does:
//   * camera shake (trauma, capped per source; the camera applies reduce-motion):
//       own firing small (per kit) · hits taken medium (by damage) · slams / jelly pops / washes within
//       6 m big (falloff with distance) · own hard landing / special start small–medium;
//   * hit markers on damage dealt: four ticks round the reticle, coloured by the hit's damage
//       (chip cream < 20 · solid yellow < 45 · heavy coral ≥ 45); a wash adds a longer X + a ring pop;
//   * damage vignette in the enemy colour (both crews' gradients prebuilt; opacity only) + an arc at the
//     screen edge pointing to where the hit came from; low HP keeps a faint breathing vignette;
//   * victory confetti: a two-cannon burst + a curtain in the winner's colours (both for a draw), never drawn
//     over the victory card (an even-odd clip round its box: the pieces pass behind it).
// Everything else in §21 lives in the view (fx.ts / players.ts / camera.ts) and needs no wiring:
// bouncing splat droplets, landing puffs, slick crowns, the tide-spout column, body dye drips.

import { TEAMS_RAW, teamById, WEAPONS } from '../core/data.ts';
import type { SimEvent } from '../core/match/events.ts';
import type { TeamId } from '../core/types.ts';

/** the slice of core/runner.ts Runner juice reads */
export interface JuiceRunner {
  readonly team: TeamId;
  x: number; y: number; z: number;
  alive: boolean; hp: number;
  kit?: string;
  rolling?: boolean;
}

/** the slice of view/camera.ts FollowCamera juice drives */
export interface JuiceCamera {
  yaw: number;
  addTrauma?: (amount: number, cap?: number) => void;
  /** legacy shake field (used when addTrauma is absent) */
  shake?: number;
  reduceMotion?: boolean;
}

export interface JuiceCtx {
  /** the viewer's runner id (the human: 0) */
  me: number;
  runners: ReadonlyArray<JuiceRunner>;
  cam?: JuiceCamera | null;
}

export interface JuiceOptions {
  /** start with reduce-motion on (default: the OS `prefers-reduced-motion`) */
  reduceMotion?: boolean;
  colorblind?: boolean;
  /** draw the hit markers (false when the HUD keeps its own) */
  markers?: boolean;
  /** draw the damage vignette + direction arc (false when the HUD keeps its own) */
  vignette?: boolean;
}

export interface JuiceReadback {
  reduceMotion: boolean;
  markers: number; kills: number; lastDmg: number; lastTier: string; markerOpacity: number;
  hurts: number; vignette: number; vignetteTeam: string; arc: number; arcDeg: number;
  confetti: number; bursts: number;
  /** the confetti keep-out box (CSS px: x0, y0, x1, y1) or null */
  confettiClip: number[] | null;
  shakes: number; traumaAdded: number;
}

export interface Juice {
  onEvents(events: readonly SimEvent[], ctx: JuiceCtx): void;
  update(dt: number, ctx: JuiceCtx): void;
  /** `avoid`: an element confetti must never cover (the victory card; its children's boxes count too) */
  victory(winner: TeamId | 0, avoid?: HTMLElement | null): void;
  trauma(amount: number, cap?: number): void;
  setReduceMotion(on: boolean): void;
  setColorblind(on: boolean): void;
  reset(): void;
  readback(): JuiceReadback;
  dispose(): void;
}

// ───────────────────────────── tuning ─────────────────────────────
/** trauma (amount, cap) per source — camera.ts maps trauma^1.5 to degrees */
export const TRAUMA = {
  fire: { stream: [0.22, 0.24], roll: [0.26, 0.34], burst: [0.32, 0.42] } as Record<string, [number, number]>,
  beam: { base: 0.12, perCharge: 0.28, cap: 0.3, capPerCharge: 0.3 },
  rolling: { perSecond: 0.8, cap: 0.15 },
  hitTaken: { base: 0.3, perDmg: 0.2 / 50, cap: 0.65 },
  washedMe: [1, 1] as [number, number],
  /** big sources within NEAR m: amount × (1 − 0.55·d/NEAR) */
  near: 6,
  slam: [1, 1] as [number, number], slamOwn: [0.9, 1] as [number, number],
  pop: [0.9, 0.9] as [number, number],
  burst: [0.45, 0.55] as [number, number],
  washNear: [0.85, 0.9] as [number, number],
  landHard: [0.28, 0.45] as [number, number],
  special: { cloudburst: [0.18, 0.3], wellspring: [0.25, 0.4] } as Record<string, [number, number]>,
};
/** hit-marker tiers by damage (colours contrast both crews: never orange / violet) */
const TIERS = [
  { name: 'chip', max: 20, color: '#fff8ec', scale: 0.9 },
  { name: 'solid', max: 45, color: '#ffd23f', scale: 1 },
  { name: 'heavy', max: Infinity, color: '#ff4d5e', scale: 1.12 },
] as const;
const MARK_LIFE = 0.26;
const KILL_LIFE = 0.5;
const ARC_LIFE = 0.9;
const CONFETTI = 240;

const INK = '#14203a';

const CSS = `
.dfj-under, .dfj-over { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.dfj-vig { position: absolute; inset: 0; opacity: 0; will-change: opacity; }
.dfj-arcbox { position: absolute; left: 50%; top: 50%; width: 0; height: 0; will-change: transform; }
.dfj-arc { position: absolute; left: calc(min(58vh, 480px) / -2); top: calc(min(58vh, 480px) / -2);
  width: min(58vh, 480px); height: min(58vh, 480px); box-sizing: border-box; border-radius: 50%;
  border: 12px solid transparent; border-top-color: var(--c, #5b4bf0); opacity: 0; will-change: opacity;
  filter: drop-shadow(0 0 1.5px ${INK}) drop-shadow(0 0 8px var(--c, #5b4bf0)); }
.dfj-mark { position: absolute; left: 50%; top: 50%; width: 0; height: 0; opacity: 0; will-change: transform, opacity; --c: #ffd23f; }
.dfj-mark i { position: absolute; left: -2.5px; top: -6px; width: 5px; height: 12px; border-radius: 3px; background: var(--c);
  box-shadow: 0 0 0 1.6px ${INK}; }
.dfj-mark i:nth-child(1) { transform: rotate(45deg) translateY(-20px); }
.dfj-mark i:nth-child(2) { transform: rotate(135deg) translateY(-20px); }
.dfj-mark i:nth-child(3) { transform: rotate(225deg) translateY(-20px); }
.dfj-mark i:nth-child(4) { transform: rotate(315deg) translateY(-20px); }
.dfj-mark.kill i { top: -9px; height: 18px; }
.dfj-mark.kill i:nth-child(1) { transform: rotate(45deg) translateY(-22px); }
.dfj-mark.kill i:nth-child(2) { transform: rotate(135deg) translateY(-22px); }
.dfj-mark.kill i:nth-child(3) { transform: rotate(225deg) translateY(-22px); }
.dfj-mark.kill i:nth-child(4) { transform: rotate(315deg) translateY(-22px); }
.dfj-ring { position: absolute; left: -26px; top: -26px; width: 52px; height: 52px; box-sizing: border-box; border-radius: 50%;
  border: 3px solid var(--c); box-shadow: 0 0 0 1.5px ${INK}, inset 0 0 0 1.5px ${INK}; opacity: 0; will-change: transform, opacity; }
.dfj-confetti { position: absolute; inset: 0; width: 100%; height: 100%; }
`;

interface TeamPal { dye: string; deep: string; gloss: string; ui: string; rgbDye: [number, number, number]; rgbDeep: [number, number, number] }

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function palette(team: TeamId, colorblind: boolean): TeamPal {
  const t = teamById(team) as unknown as { dye: string; dyeDeep?: string; dyeGloss?: string; ui?: string };
  let dye = t.dye, ui = t.ui ?? t.dye;
  if (colorblind) {
    try {
      const cb = (teamsColorblind() as Record<string, { dye?: string; ui?: string }>)[team === 1 ? 'sun' : 'gulf'];
      if (cb?.dye) dye = cb.dye;
      if (cb?.ui) ui = cb.ui;
    } catch { /* keep the normal palette */ }
  }
  const deep = colorblind ? dye : (t.dyeDeep ?? dye);
  const gloss = t.dyeGloss ?? ui;
  return { dye, deep, gloss, ui, rgbDye: hexRgb(dye), rgbDeep: hexRgb(deep) };
}

/** teams.json `colorblind` block (Settings → Colorblind marks) */
function teamsColorblind(): Record<string, unknown> {
  const cb = TEAMS_RAW.colorblind;
  return cb && typeof cb === 'object' ? cb as Record<string, unknown> : {};
}

function vignetteCss(p: TeamPal): string {
  const [r, g, b] = p.rgbDye, [R, G, B] = p.rgbDeep;
  return `radial-gradient(ellipse 74% 66% at 50% 50%, rgba(${r},${g},${b},0) 52%, rgba(${r},${g},${b},.42) 80%, rgba(${R},${G},${B},.8) 100%)`;
}

/** kit id → fire type, from weapons.json (cached; unknown = stream) */
const FIRE_TYPE = new Map<string, string>();
function fireTypeOf(kit: string | undefined): string {
  if (!kit) return 'stream';
  let t = FIRE_TYPE.get(kit);
  if (t === undefined) {
    const row = WEAPONS.kits.find((k) => k.id === kit) as { fire?: { type?: string } } | undefined;
    t = row?.fire?.type ?? 'stream';
    FIRE_TYPE.set(kit, t);
  }
  return t;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const r2 = (v: number): number => Math.round(v * 100) / 100;

class JuiceImpl implements Juice {
  private readonly under: HTMLElement;
  private readonly over: HTMLElement;
  private readonly style: HTMLStyleElement | null;
  private readonly vig: Record<number, HTMLElement>;
  private readonly arcBox: HTMLElement;
  private readonly arc: HTMLElement;
  private readonly mark: HTMLElement;
  private readonly ring: HTMLElement;
  private canvas: HTMLCanvasElement | null = null;
  private g2: CanvasRenderingContext2D | null = null;
  private reduce: boolean;
  private colorblind: boolean;
  private readonly showMarkers: boolean;
  private readonly showVignette: boolean;
  private pal: Record<number, TeamPal>;
  // state
  private markT = 99; private markLife = MARK_LIFE; private markDmg = 0; private markKill = false; private markTier = -1;
  private hurt = 0; private hurtTeam: TeamId = 2; private lowHp = 0; private breathe = 0;
  private arcT = 99; private arcDeg = 0; private arcTeam: TeamId = 2;
  private lastVig: [number, number] = [-1, -1];
  private lastArc = -1; private lastArcDeg = NaN; private lastMark = -1; private lastMarkS = -1; private lastRing = -1;
  private pendingTrauma = 0; private pendingCap = 0;
  private readonly stats = { markers: 0, kills: 0, hurts: 0, bursts: 0, shakes: 0, traumaAdded: 0 };
  // confetti (struct of arrays; fixed pool)
  private readonly cx = new Float32Array(CONFETTI); private readonly cy = new Float32Array(CONFETTI);
  private readonly cvx = new Float32Array(CONFETTI); private readonly cvy = new Float32Array(CONFETTI);
  private readonly crot = new Float32Array(CONFETTI); private readonly cvr = new Float32Array(CONFETTI);
  private readonly cw = new Float32Array(CONFETTI); private readonly ch = new Float32Array(CONFETTI);
  private readonly cflip = new Float32Array(CONFETTI); private readonly cvf = new Float32Array(CONFETTI);
  private readonly cage = new Float32Array(CONFETTI); private readonly clife = new Float32Array(CONFETTI);
  private readonly cdelay = new Float32Array(CONFETTI);
  private readonly ccol = new Uint8Array(CONFETTI); private readonly cshape = new Uint8Array(CONFETTI);
  private confettiN = 0;
  private confettiLive = 0;
  private confettiCols: string[] = ['#fff8ec'];
  /** the confetti keep-out: an element (the victory card) and its box in the over layer's CSS px */
  private avoidEl: HTMLElement | null = null;
  private avoidBox: [number, number, number, number] | null = null;
  private avoidT = 0;
  private cssW = 0; private cssH = 0; private dpr = 1;

  constructor(host: HTMLElement, o: JuiceOptions) {
    const doc = host.ownerDocument;
    this.reduce = o.reduceMotion ?? prefersReducedMotion();
    this.colorblind = !!o.colorblind;
    this.showMarkers = o.markers !== false;
    this.showVignette = o.vignette !== false;
    this.pal = { 1: palette(1, this.colorblind), 2: palette(2, this.colorblind) };
    if (!doc.getElementById('dfj-css')) {
      this.style = doc.createElement('style');
      this.style.id = 'dfj-css';
      this.style.textContent = CSS;
      doc.head.append(this.style);
    } else this.style = null;
    // under the HUD: the vignettes + the direction arc (the HUD's own chips stay readable on top)
    this.under = doc.createElement('div');
    this.under.className = 'dfj-under';
    this.under.setAttribute('aria-hidden', 'true');
    this.vig = { 1: doc.createElement('div'), 2: doc.createElement('div') };
    for (const t of [1, 2] as const) {
      this.vig[t].className = 'dfj-vig';
      this.vig[t].style.background = vignetteCss(this.pal[t]);
      this.under.append(this.vig[t]);
    }
    this.arcBox = doc.createElement('div');
    this.arcBox.className = 'dfj-arcbox';
    this.arc = doc.createElement('div');
    this.arc.className = 'dfj-arc';
    this.arcBox.append(this.arc);
    this.under.append(this.arcBox);
    host.prepend(this.under);
    // over everything: the hit marker + the confetti canvas
    this.over = doc.createElement('div');
    this.over.className = 'dfj-over';
    this.over.setAttribute('aria-hidden', 'true');
    this.mark = doc.createElement('div');
    this.mark.className = 'dfj-mark';
    for (let i = 0; i < 4; i++) this.mark.append(doc.createElement('i'));
    this.ring = doc.createElement('b');
    this.ring.className = 'dfj-ring';
    this.mark.append(this.ring);
    this.over.append(this.mark);
    host.append(this.over);
  }

  // ───────────────────────────── events ─────────────────────────────
  onEvents(events: readonly SimEvent[], ctx: JuiceCtx): void {
    const rs = ctx.runners;
    const me = rs[ctx.me];
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.t) {
        case 'shot': {
          if (e.pid !== ctx.me) break;
          const ft = fireTypeOf(me?.kit);
          if (ft === 'charge') break;                              // the 'beam' event carries the release
          const t = TRAUMA.fire[ft] ?? TRAUMA.fire.stream;
          this.addTrauma(ctx, t[0], t[1]);
          break;
        }
        case 'beam':
          if (e.pid === ctx.me) {
            const c = clamp01(e.charge);
            this.addTrauma(ctx, TRAUMA.beam.base + TRAUMA.beam.perCharge * c, TRAUMA.beam.cap + TRAUMA.beam.capPerCharge * c);
          }
          break;
        case 'hit': {
          if (e.victim === ctx.me) {
            const by = e.by >= 0 ? rs[e.by] : undefined;
            const team: TeamId = by ? by.team : (me && me.team === 1 ? 2 : 1);
            this.hurtBy(ctx, team, e.dmg, by ? by.x : e.x, by ? by.z : e.z, !!by);
            this.addTrauma(ctx, TRAUMA.hitTaken.base + TRAUMA.hitTaken.perDmg * Math.min(50, Math.max(0, e.dmg)), TRAUMA.hitTaken.cap);
          } else if (e.by === ctx.me) this.hitMarker(e.dmg, false);
          break;
        }
        case 'washed': {
          if (e.victim === ctx.me) {
            this.addTrauma(ctx, TRAUMA.washedMe[0], TRAUMA.washedMe[1]);
            this.hurt = 0; this.arcT = 99;                         // the death slate takes over
          } else {
            if (e.by === ctx.me) this.hitMarker(100, true);
            const v = rs[e.victim];
            if (v && me && e.cause !== 'sea') this.near(ctx, me, v.x, v.z, TRAUMA.washNear);
          }
          break;
        }
        case 'ring':
          if (e.pid === ctx.me) this.addTrauma(ctx, TRAUMA.slamOwn[0], TRAUMA.slamOwn[1]);
          else if (me) this.near(ctx, me, e.x, e.z, TRAUMA.slam);
          break;
        case 'sub':
          if (e.phase === 'pop' && me) this.near(ctx, me, e.x, e.z, TRAUMA.pop);
          break;
        case 'burst':
          if (me) this.near(ctx, me, e.x, e.z, TRAUMA.burst);
          break;
        case 'land':
          if (e.pid === ctx.me && e.hard) this.addTrauma(ctx, TRAUMA.landHard[0], TRAUMA.landHard[1]);
          break;
        case 'special':
          if (e.pid === ctx.me && e.phase === 'start') {
            const t = TRAUMA.special[e.id];
            if (t) this.addTrauma(ctx, t[0], t[1]);
          }
          break;
        case 'respawn':
          if (e.pid === ctx.me) { this.hurt = 0; this.arcT = 99; }
          break;
        default:
          break;
      }
    }
  }

  trauma(amount: number, cap = 1): void {
    // no ctx here: applied on the next update() (same frame when called before it)
    this.pendingTrauma += Math.max(0, amount);
    this.pendingCap = Math.max(this.pendingCap, Math.min(1, cap));
  }

  private addTrauma(ctx: JuiceCtx, amount: number, cap: number): void {
    const cam = ctx.cam;
    if (!cam || !(amount > 0)) return;
    this.stats.shakes++;
    this.stats.traumaAdded += amount;
    if (typeof cam.addTrauma === 'function') cam.addTrauma(amount, cap);
    else if (typeof cam.shake === 'number' && cam.shake < cap) cam.shake = Math.min(cap, cam.shake + amount);
  }

  /** a big source at (x, z): full inside ~0 m, 45 % at TRAUMA.near m, nothing beyond */
  private near(ctx: JuiceCtx, me: JuiceRunner, x: number, z: number, t: [number, number]): void {
    if (!me.alive) return;
    const d = Math.hypot(me.x - x, me.z - z);
    if (!(d < TRAUMA.near)) return;
    const k = 1 - 0.55 * (d / TRAUMA.near);
    this.addTrauma(ctx, t[0] * k, t[1]);
  }

  private hitMarker(dmg: number, kill: boolean): void {
    this.stats.markers++;
    if (kill) this.stats.kills++;
    // several hits inside one marker window keep the heaviest colour
    const live = this.markT < this.markLife * 0.7;
    this.markDmg = live ? Math.max(this.markDmg, dmg) : dmg;
    this.markKill = kill || (live && this.markKill);
    this.markT = 0;
    this.markLife = this.markKill ? KILL_LIFE : MARK_LIFE;
  }

  private hurtBy(ctx: JuiceCtx, team: TeamId, dmg: number, ax: number, az: number, located: boolean): void {
    this.stats.hurts++;
    this.hurtTeam = team;
    this.hurt = Math.min(1, Math.max(this.hurt, 0.55 + 0.45 * clamp01(dmg / 50)));
    const me = ctx.runners[ctx.me];
    const cam = ctx.cam;
    if (!located || !me || !cam) return;
    const dx = ax - me.x, dz = az - me.z;
    if (dx * dx + dz * dz < 0.25) return;                      // point blank: the vignette says enough
    // world bearing → screen: yaw 0 looks +Z and yaw grows to the LEFT (mouse-right decreases yaw)
    let rel = Math.atan2(dx, dz) - cam.yaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    this.arcDeg = (-rel * 180) / Math.PI;
    this.arcTeam = team;
    this.arcT = 0;
  }

  // ───────────────────────────── per frame ─────────────────────────────
  update(dt: number, ctx: JuiceCtx): void {
    const sdt = dt > 0 ? Math.min(dt, 0.1) : 0;
    const cam = ctx.cam;
    if (cam) {
      if (cam.reduceMotion !== undefined && cam.reduceMotion !== this.reduce) cam.reduceMotion = this.reduce;
      if (this.pendingTrauma > 0) { this.addTrauma(ctx, this.pendingTrauma, this.pendingCap || 1); this.pendingTrauma = 0; this.pendingCap = 0; }
      const me = ctx.runners[ctx.me];
      if (me && me.rolling && me.alive && sdt > 0) this.addTrauma(ctx, TRAUMA.rolling.perSecond * sdt, TRAUMA.rolling.cap);
    }
    const me = ctx.runners[ctx.me];

    // ── damage vignette (enemy colour) + low HP
    if (this.showVignette) {
      this.hurt = Math.max(0, this.hurt - sdt * 2.3);
      const low = me && me.alive ? clamp01((70 - me.hp) / 70) : 0;
      this.lowHp += (low - this.lowHp) * (1 - Math.exp(-sdt * 6));
      this.breathe += sdt;
      const br = this.reduce ? 1 : 0.8 + 0.2 * Math.sin(this.breathe * 4.2);
      const v = me && me.alive ? Math.min(1, Math.max(this.hurt * 0.9, this.lowHp * 0.5 * br)) : 0;
      const vs = this.hurtTeam === 1 ? 1 : 2;
      const a1 = vs === 1 ? r2(v) : 0, a2 = vs === 2 ? r2(v) : 0;
      if (a1 !== this.lastVig[0]) { this.lastVig[0] = a1; this.vig[1].style.opacity = String(a1); }
      if (a2 !== this.lastVig[1]) { this.lastVig[1] = a2; this.vig[2].style.opacity = String(a2); }
      // the direction arc
      this.arcT += sdt;
      const ak = this.arcT < ARC_LIFE ? 1 - this.arcT / ARC_LIFE : 0;
      const aa = r2(ak * ak * 0.95);
      if (aa > 0 && (this.arcDeg !== this.lastArcDeg)) {
        this.lastArcDeg = this.arcDeg;
        this.arcBox.style.transform = `rotate(${this.arcDeg.toFixed(1)}deg)`;
        this.arc.style.setProperty('--c', this.pal[this.arcTeam].dye);
      }
      if (aa !== this.lastArc) { this.lastArc = aa; this.arc.style.opacity = String(aa); }
    }

    // ── hit marker
    if (this.showMarkers) {
      this.markT += sdt;
      const life = this.markLife;
      let op = 0, sc = 1;
      if (this.markT < life) {
        const k = this.markT / life;
        const tier = this.markKill ? 2 : (this.markDmg < TIERS[0].max ? 0 : this.markDmg < TIERS[1].max ? 1 : 2);
        if (tier !== this.markTier || this.mark.classList.contains('kill') !== this.markKill) {
          this.markTier = tier;
          this.mark.style.setProperty('--c', TIERS[tier].color);
          this.mark.classList.toggle('kill', this.markKill);
        }
        const pop = this.reduce ? 0 : Math.max(0, 1 - this.markT / 0.09);
        sc = TIERS[tier].scale * (1 + 0.38 * pop * pop) * (this.markKill ? 1.1 : 1);
        op = k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45;
      }
      const o2 = r2(op), s2 = Math.round(sc * 1000) / 1000;
      if (o2 !== this.lastMark) { this.lastMark = o2; this.mark.style.opacity = String(o2); }
      if (o2 > 0 && s2 !== this.lastMarkS) { this.lastMarkS = s2; this.mark.style.transform = `scale(${s2})`; }
      // the wash ring pop
      const rk = this.markKill && this.markT < KILL_LIFE ? this.markT / KILL_LIFE : 1;
      const ro = rk < 1 ? r2((1 - rk) * (1 - rk)) : 0;
      if (ro !== this.lastRing) {
        this.lastRing = ro;
        this.ring.style.opacity = String(ro);
        if (ro > 0) this.ring.style.transform = `scale(${(0.6 + 0.9 * Math.sqrt(rk)).toFixed(3)})`;
      }
    }

    // ── confetti
    if (this.confettiLive > 0) this.stepConfetti(sdt);
  }

  // ───────────────────────────── confetti ─────────────────────────────
  victory(winner: TeamId | 0, avoid?: HTMLElement | null): void {
    this.stats.bursts++;
    this.avoidEl = avoid ?? null;
    this.avoidBox = null;
    this.avoidT = 0;
    const cols: string[] = [];
    const teams: TeamId[] = winner === 1 ? [1] : winner === 2 ? [2] : [1, 2];
    for (const t of teams) { const p = this.pal[t]; cols.push(p.dye, p.gloss, p.ui, p.dye); }
    cols.push('#fff8ec', '#ffd23f');
    this.confettiCols = cols;
    if (!this.ensureCanvas()) return;
    const W = this.cssW, H = this.cssH;
    const n = this.reduce ? Math.round(CONFETTI * 0.35) : CONFETTI;
    const u = Math.min(W, H) / 900;                              // speeds scale with the view
    for (let i = 0; i < n; i++) {
      const side = i % 3;                                        // 0 left cannon · 1 right cannon · 2 curtain
      let x: number, y: number, vx: number, vy: number, delay: number;
      if (side < 2 && !this.reduce) {
        const dir = side === 0 ? 1 : -1;
        const a = (52 + Math.random() * 20) * Math.PI / 180;     // elevation: aimed in over the slate
        const sp = (1700 + Math.random() * 900) * u;
        x = side === 0 ? -10 : W + 10;
        y = H * (0.82 + Math.random() * 0.1);
        vx = dir * Math.cos(a) * sp;
        vy = -Math.sin(a) * sp;
        delay = Math.random() * 0.12 + (i % 2) * 0.03;
      } else {
        x = Math.random() * W;
        y = -20 - Math.random() * H * 0.25;
        vx = (Math.random() - 0.5) * 160 * u;
        vy = (80 + Math.random() * 140) * u;
        delay = 0.15 + Math.random() * 0.5;
      }
      this.cx[i] = x; this.cy[i] = y; this.cvx[i] = vx; this.cvy[i] = vy;
      this.crot[i] = Math.random() * Math.PI * 2;
      this.cvr[i] = (Math.random() - 0.5) * (this.reduce ? 3 : 12);
      const big = Math.random() < 0.25;
      this.cw[i] = (big ? 18 : 11 + Math.random() * 5) * Math.max(0.75, u);
      this.ch[i] = (big ? 9 : 6 + Math.random() * 3) * Math.max(0.75, u);
      this.cflip[i] = Math.random() * Math.PI * 2;
      this.cvf[i] = (this.reduce ? 3 : 7) + Math.random() * 7;
      this.cage[i] = 0;
      this.clife[i] = 3.0 + Math.random() * 1.3;
      this.cdelay[i] = delay;
      this.ccol[i] = Math.floor(Math.random() * cols.length);
      this.cshape[i] = Math.random() < 0.22 ? 1 : 0;              // 0 ribbon (flips) · 1 dot
    }
    this.confettiN = n;
    this.confettiLive = n;
    if (this.canvas) this.canvas.hidden = false;
  }

  private ensureCanvas(): boolean {
    const doc = this.over.ownerDocument;
    if (!this.canvas) {
      this.canvas = doc.createElement('canvas');
      this.canvas.className = 'dfj-confetti';
      this.over.append(this.canvas);
      this.g2 = this.canvas.getContext('2d');
    }
    if (!this.g2) return false;
    const w = Math.max(1, this.over.clientWidth || (doc.defaultView?.innerWidth ?? 1280));
    const h = Math.max(1, this.over.clientHeight || (doc.defaultView?.innerHeight ?? 720));
    const dpr = Math.min(1.5, doc.defaultView?.devicePixelRatio || 1);
    if (w !== this.cssW || h !== this.cssH || dpr !== this.dpr) {
      this.cssW = w; this.cssH = h; this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    return true;
  }

  private stepConfetti(dt: number): void {
    const g = this.g2;
    if (!g || !this.canvas) { this.confettiLive = 0; return; }
    const W = this.cssW, H = this.cssH;
    const u = Math.min(W, H) / 900;
    const grav = 1400 * u, drag = 1.5, term = 480 * u;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // keep-out: the card's box, re-measured every 0.15 s (it slams in with a scale animation)
    this.avoidT -= dt;
    if (this.avoidT <= 0) { this.avoidT = 0.15; this.measureAvoid(); }
    const box = this.avoidBox;
    g.save();
    if (box) {
      const d = this.dpr;
      g.beginPath();
      g.rect(0, 0, this.canvas.width, this.canvas.height);
      g.rect(box[0] * d, box[1] * d, (box[2] - box[0]) * d, (box[3] - box[1]) * d);
      g.clip('evenodd');
    }
    let live = 0;
    const cols = this.confettiCols;
    // one fillStyle per colour: loop colours outside, pieces inside (≤ 10 colours × N pieces)
    for (let c = 0; c < cols.length; c++) {
      g.fillStyle = cols[c];
      for (let i = 0; i < this.confettiN; i++) {
        if (this.ccol[i] !== c) continue;
        let age = this.cage[i];
        if (age >= this.clife[i] + this.cdelay[i]) continue;
        // each piece has one colour, so it is integrated exactly once per frame (in its colour pass)
        age += dt;
        this.cage[i] = age;
        const t = age - this.cdelay[i];
        if (t < 0) { live++; continue; }
        const k = Math.exp(-drag * dt);
        this.cvx[i] *= k;
        this.cvy[i] = this.cvy[i] * k + grav * dt;
        if (this.cvy[i] > term) this.cvy[i] = term;
        this.cx[i] += (this.cvx[i] + Math.sin(this.cflip[i] * 0.5) * 40 * u) * dt;
        this.cy[i] += this.cvy[i] * dt;
        this.crot[i] += this.cvr[i] * dt;
        this.cflip[i] += this.cvf[i] * dt;
        const life = this.clife[i];
        if (t >= life || this.cy[i] > H + 40) { this.cage[i] = life + this.cdelay[i]; continue; }
        live++;
        const fade = t > life - 0.6 ? (life - t) / 0.6 : 1;
        g.globalAlpha = fade;
        const cr = Math.cos(this.crot[i]), sr = Math.sin(this.crot[i]);
        const d = this.dpr;
        g.setTransform(cr * d, sr * d, -sr * d, cr * d, this.cx[i] * d, this.cy[i] * d);
        if (this.cshape[i] === 1) {
          const r = this.ch[i] * 0.7;
          g.fillRect(-r, -r, r * 2, r * 2);
        } else {
          const fy = Math.cos(this.cflip[i]);
          const w = this.cw[i], h = this.ch[i] * (Math.abs(fy) < 0.12 ? 0.12 : Math.abs(fy));
          g.fillRect(-w / 2, -h / 2, w, h);
        }
      }
    }
    g.restore();
    g.globalAlpha = 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.confettiLive = live;
    if (live === 0) {
      g.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.canvas.hidden = true;
    }
  }

  /** the keep-out box: the avoid element's box ∪ its children's (the winner mark overhangs the card), + 8 px */
  private measureAvoid(): void {
    const el = this.avoidEl;
    this.avoidBox = null;
    if (!el || !el.isConnected) return;
    const r = el.getBoundingClientRect();
    if (!(r.width > 4 && r.height > 4)) return;
    let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
    for (const c of Array.from(el.children)) {
      const q = c.getBoundingClientRect();
      if (!(q.width > 0 && q.height > 0)) continue;
      x0 = Math.min(x0, q.left); y0 = Math.min(y0, q.top); x1 = Math.max(x1, q.right); y1 = Math.max(y1, q.bottom);
    }
    const o = this.over.getBoundingClientRect();
    const pad = 8;
    this.avoidBox = [x0 - o.left - pad, y0 - o.top - pad, x1 - o.left + pad, y1 - o.top + pad];
  }

  // ───────────────────────────── settings / lifecycle ─────────────────────────────
  setReduceMotion(on: boolean): void { this.reduce = !!on; }

  setColorblind(on: boolean): void {
    this.colorblind = !!on;
    this.pal = { 1: palette(1, this.colorblind), 2: palette(2, this.colorblind) };
    for (const t of [1, 2] as const) this.vig[t].style.background = vignetteCss(this.pal[t]);
    this.lastArcDeg = NaN;
  }

  reset(): void {
    this.markT = 99; this.markKill = false; this.markDmg = 0;
    this.hurt = 0; this.lowHp = 0; this.arcT = 99;
    this.pendingTrauma = 0; this.pendingCap = 0;
    this.confettiLive = 0; this.confettiN = 0;
    this.avoidEl = null; this.avoidBox = null;
    if (this.canvas && this.g2) { this.g2.setTransform(1, 0, 0, 1, 0, 0); this.g2.clearRect(0, 0, this.canvas.width, this.canvas.height); this.canvas.hidden = true; }
    this.lastVig[0] = this.lastVig[1] = -1; this.lastArc = -1; this.lastMark = -1; this.lastRing = -1;
    for (const el of [this.vig[1], this.vig[2], this.arc, this.mark, this.ring]) el.style.opacity = '0';
  }

  readback(): JuiceReadback {
    const tier = this.markKill ? 2 : (this.markDmg < TIERS[0].max ? 0 : this.markDmg < TIERS[1].max ? 1 : 2);
    return {
      reduceMotion: this.reduce,
      markers: this.stats.markers, kills: this.stats.kills, lastDmg: this.markDmg, lastTier: this.stats.markers ? (this.markKill ? 'kill' : TIERS[tier].name) : '',
      markerOpacity: Math.max(0, this.lastMark),
      hurts: this.stats.hurts, vignette: Math.max(this.lastVig[0], this.lastVig[1], 0), vignetteTeam: this.hurtTeam === 1 ? 'sun' : 'gulf',
      arc: Math.max(0, this.lastArc), arcDeg: Math.round(this.arcDeg),
      confetti: this.confettiLive, bursts: this.stats.bursts, confettiClip: this.avoidBox ? this.avoidBox.map((v) => Math.round(v)) : null,
      shakes: this.stats.shakes, traumaAdded: Math.round(this.stats.traumaAdded * 100) / 100,
    };
  }

  dispose(): void {
    this.under.remove();
    this.over.remove();
    this.style?.remove();
    this.canvas = null; this.g2 = null;
  }
}

function prefersReducedMotion(): boolean {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** create the juice layer inside `host` (the #ui root). */
export function createJuice(host: HTMLElement, o: JuiceOptions = {}): Juice {
  return new JuiceImpl(host, o);
}
