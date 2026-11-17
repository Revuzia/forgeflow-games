// BodyView: everything the stage draws for ONE body: the fine jelly mesh, core, face, FX, the two table decals and the
// rarity FX. The stage holds a list of these (multi-body: two parents and a result during a ceremony). Each view reads a
// BodyProxy (offset + puppet) instead of the raw body, owns its GPU objects and disposes them all in dispose().
// Shared across views: the environment (EnvHub), the unit decal quad, and the compiled shader programs (same cache keys).
import * as THREE from 'three';
import type { FxKind, PieceInfo, SoftBodyLike, TierName, V3 } from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import { BodyProxy } from './bodyproxy.ts';
import { Core } from './core.ts';
import { Decals, type Footprint } from './decals.ts';
import type { EnvHub } from './env.ts';
import { Face } from './face.ts';
import { Fx } from './fx.ts';
import { FrameHold } from './framing.ts';
import { JellyView } from './jelly.ts';
import { LOD_TUNING } from './lod.ts';
import { isCutPiece } from './pieceBuild.ts';
import { buildPieceEyes } from './pieceEyes.ts';
import { wholeRefFor } from './wholeRef.ts';
import { JellyMaterials } from './material.ts';
import { renderPalette, type JellyPalette } from './oklch.ts';
import type { TierSpec } from './quality.ts';
import { RarityFx, TIER_STYLES, type TierStyle } from './rarity.ts';
import { TackStrands } from './strands.ts';
import { RenderPose } from './pose.ts';
import { TIERS } from './quality.ts';

type TipSphere = { x: number; y: number; z: number; r: number; depth: number };
/** Calm effects: the cut seam's strength on top of the stage's calm halving (see update). */
const CALM_SEAM = 0.45;
/** CUT3 small-piece look (lod 1): the share of the ember a piece must hold to draw the ember's blob (a sliver draws none; the jelly's own glow still carries it). */
const LOD_MIN_KEPT = 0.06;
/** Round 5 (B1): a sleeping view whose drawn centre moved more than this (m, per axis) since its last fine-mesh evaluation is evaluated again. A
 *  frozen sleeper's centre does not move at all, so RD-05's "a sleeper does 0 fine updates" holds; half a millimetre is far under a pixel. */
const FINE_MOVE_M = 5e-4;

export class BodyView {
  readonly id: number;
  readonly proxy: BodyProxy;
  readonly genome: Genome;
  readonly palette: JellyPalette;
  readonly group = new THREE.Group();
  readonly scale: number;
  /** Horizontal reach of the rest silhouette from the body centre (world units, >= restRadius): what the camera must fit. */
  readonly restHalfW: number;
  /** Height of the rest silhouette above the table (world units): what the camera must fit vertically (x growth). */
  readonly restH: number;
  /** PLAYGROUND: the centre's rest height above the table (world units). */
  readonly restCy: number;
  /** The stage steps owned bodies itself (ceremony bodies); the shell steps the others. */
  owned: boolean;
  tier: TierName;
  style: TierStyle;
  mats: JellyMaterials;
  jelly: JellyView;
  core: Core;
  face: Face;
  fx: Fx;
  decals: Decals;
  rarity: RarityFx;
  readonly fp: Footprint = { cx: 0, cz: 0, rx: 0.5, rz: 0.5, lowY: 0, compression: 0, stretch: 0 };
  /**
   * World half-width the frame shows at this body's depth (along the camera's right axis) minus where the body stands in it: how far its table light (pool, shock ring)
   * and its tier's aura and dome may reach before they leave the frame's sides. Infinity until the first frame with a camera.
   */
  frameRoom = Infinity;
  /** Extra pool light (capsule tell, merge charge) 0..1 added by the ceremonies. */
  extraPool = 0;
  /** 0..1: how far that extra pool light leans toward the TIER colour (a ceremony burst lights the table in the tell, not the body's own pool hue). */
  extraPoolTell = 0;
  private poolTellNow = 0;
  private readonly poolBase: [number, number, number] = [0, 0, 0];
  /**
   * The view's OWN clock (seconds since it was created). Every time-phased idle effect (blink, breathing, core pulse, aurora,
   * thin-film drift, orbiting motes / satellites, glitter twinkle, pool caustics) reads this, never the stage's global time, so
   * a body's look is a function of its own age: a ceremony skip() can fast-forward the result to EXACTLY the frame the natural
   * ending reaches, and two bodies on the table do not breathe in lockstep. Advanced by the stage every frame (hidden views too).
   */
  clock = 0;
  /** Hide the eyes (a merge parent pressed in BEHIND another one: its eyes would show through the front jelly as stray extra eyes). */
  faceHidden = false;
  /**
   * CUT (AddBodyOpts.chunk): an eyeless piece of a cut squishy. Same jelly material, colour, pattern and core glow, sized by its own body;
   * no face, and the squishy's world-space tier FX (aura, dome, pillar, motes, stars) stay with the face piece.
   */
  readonly chunk: boolean;
  /**
   * CUT2 (_spec/CUT2.md 8): this body is a REAL part of a squishy (body.piece with at least one cut plane): its fine mesh is a subdivision of its sim triangles with the cut face as its own
   * class, its size follows the WHOLE (scale, no setFrac growth), it draws just the eyes it holds (pieceEyes.ts; a Face with none has no mesh) and the part of the ember it holds (Core.setPiece).
   * A body without `piece` takes today's code path unchanged; `chunk` is honoured only then.
   */
  readonly isPiece: boolean;
  /** SR2: this body's held extent for the band framing (framing.ts). */
  readonly hold = new FrameHold();
  /**
   * CUT3 (lod.ts, _spec/CUT3.md 3): 0 = everything; 1 = one of the MANY small pieces (the stage keeps the LOD_TUNING.fullViews largest views at 0, set every frame): its table shadow and
   * light pool fade out (and stop drawing), it has no tier FX / glitter / bubbles / aura, and a mini among many draws no ember (a piece's ember: the stage lets the two that hold the most draw it). Its jelly and its
   * eyes are drawn as always; a finger on it still strings.
   */
  private lodNow = 0;
  get lod(): number { return this.lodNow; }
  setLod(l: 0 | 1): void {
    if (l === this.lodNow) return;
    this.lodNow = l;
    this.decals.wanted = l === 0;
    this.fx.group.visible = l === 0;
    this.rarity.group.visible = l === 0 && !this.chunk;
    this.core.minKept = l === 0 ? 0.002 : LOD_MIN_KEPT;
    this.core.setHidden(l === 1 && !this.isPiece);   // (a small mini among many: no ember blob / halo; a true piece draws the ember it really holds)
  }
  /** 0..1, set by the stage every frame: every CUT glow on this body is held down by it (calm effects, a recent ceremony flash). */
  glowK = 1;
  // CUT seam (setCutSeam): the plane in the BODY's world space (the render offset is added per frame), eased strength
  private readonly seamN = new THREE.Vector3(0, 1, 0);
  private seamD = 0;
  private seamTarget = 0;
  private seamAmt = 0;
  /** The body's volume fraction when the view was built (SoftBodyLike.frac, CUT; 1 when absent): its size follows frac from there. */
  private readonly frac0: number;
  /** Squared camera distance of the body centre (the stage's back-to-front ordering of the translucent jellies). */
  sortDepth = 0;
  /** Tack strands (stage B6): built only when this body first strings. */
  readonly strands: TackStrands;
  // contact glow (stage B5): eased strength per finger, last tip position
  private readonly touchAmt = new Float32Array(2);
  private tipsLive = false;
  private spec: TierSpec;
  private smComp = 0; private smStretch = 0; private prevSq = 0; private sqRate = 0; private touchGate = 0; private grabGate = 0;
  private calm = false;
  private shown = true;
  private disposed = false;
  get isDisposed(): boolean { return this.disposed; }
  // ---- PLAYGROUND ----
  /** setBodyPose / setBodyBreath / setBodyAsleep: the render pose (pose.ts), in the jelly's vertex stage and on the eye anchors. */
  readonly pose = new RenderPose();
  /** setBodyAsleep: the fine mesh is not re-evaluated (the body is frozen); the eyes still blink and the pose still sways (RD-05). */
  asleep = false;
  /** AddBodyOpts.lite: the low fine mesh (2562 vertices) whatever the tier (a cut squishy's chunks on med and high, RD-06). */
  readonly lite: boolean;
  /** Fine-mesh evaluations so far (the harness counts them: a sleeper does none, RD-05). */
  fineUpdates = 0;
  /** The drawn centre at the last fine-mesh evaluation (round 5, VERDICT_PG B1). A sleeping body is frozen, so its fine mesh is skipped; but a
   *  sleeper can be MOVED without waking for the stage (the shell's trip puts it at its spawn spot with placeAt, which wakes it in physics,
   *  then sleeps it again in the same moment; a ceremony slide; a render offset): the jelly then stayed at the old spot while the eyes and the
   *  ember, which follow the centre every frame, stood at the new one. Any move of the drawn centre re-evaluates the mesh once. */
  private fineCx = NaN; private fineCy = NaN; private fineCz = NaN;
  /** Calm effects or reduced motion (the stage's own reading): the pose's sway is held to 2 Hz. */
  quiet = false;
  /** Seconds the body has been still (centre speed under 0.05 m/s) since it was last touched: the stage's "player-caused motion" latch (RD-14). */
  stillS = 0;
  /** The player moved this body (a finger, a grab, a toss until it settles): the camera may follow it (D-37). */
  playerMoving = false;
  /** PLAYGROUND (D-37, round 3): the mat slot this view counts at with the autonomy framing on (the stage's assignSlots: the pieces of one
   *  squishy share ONE slot), and how the band framer measures it this frame (framing.ts FrameView.frameMode / frameSlot). */
  slotK = 0;
  frameMode = 0;
  readonly frameSlot = new Float64Array(5);
  /** A true piece: the WHOLE's rest radius, rest half width, rest height and rest centre height (from its rest mesh), so a piece group at its
   *  slot is framed as the squishy it was; 0 for a body that is not a piece. */
  readonly wholeR: number = 0; readonly wholeHalfW: number = 0; readonly wholeH: number = 0; readonly wholeCy: number = 0;
  /** setBodyLook targets (frost, wet, sand, toast, snow), each 0..1, and their eased values (about 0.4 s); all 0 = today's pixels. */
  readonly look = new Float32Array(5);
  private readonly lookNow = new Float32Array(5);
  private lastCx = NaN; private lastCz = NaN;

  constructor(id: number, inner: SoftBodyLike, genome: Genome, tier: TierName, spec: TierSpec, hub: EnvHub, quad: THREE.BufferGeometry, owned: boolean, chunk = false, lite = false) {
    this.id = id; this.genome = genome; this.tier = tier; this.style = TIER_STYLES[tier]; this.spec = spec; this.owned = owned;
    this.isPiece = isCutPiece(inner.piece);
    this.chunk = chunk && !this.isPiece;
    this.lite = lite;
    this.frac0 = typeof inner.frac === 'number' && Number.isFinite(inner.frac) && inner.frac > 0 ? inner.frac : 1;
    this.proxy = new BodyProxy(inner);
    this.palette = renderPalette(genome);
    this.scale = (this.isPiece ? (inner.piece as { whole: { radius: number } }).whole.radius : inner.restRadius) / 0.5;   // (a piece keeps the WHOLE's scale: eye, core, bubble and seam sizes do not shrink with it)
    // the rest silhouette's horizontal reach from the centre (a wide dumpling or a long bean reaches well past restRadius): framing
    let hw = inner.restRadius;
    { const P = inner.positions, c = inner.center; for (let i = 0; i < P.length; i += 3) { const d = Math.hypot(P[i] - c.x, P[i + 2] - c.z); if (d > hw) hw = d; } }
    this.restHalfW = hw;
    { const P = inner.positions; let top = 0, low = Infinity; for (let i = 1; i < P.length; i += 3) { if (P[i] > top) top = P[i]; if (P[i] < low) low = P[i]; } this.restH = Math.max(0.1, top - (Number.isFinite(low) ? low : 0)); }
    // PLAYGROUND: the rest height of the centre above the table (the rest shape's centroid over its lowest point): the camera's rest aim (D-37)
    { const R = inner.restLocal; let lo = Infinity, sum = 0, n = 0; for (let i = 1; i < R.length; i += 3) { sum += R[i]; n++; if (R[i] < lo) lo = R[i]; } this.restCy = n ? sum / n - lo : inner.restRadius; }
    if (this.isPiece) {   // (round 3: the whole's rest numbers, for a piece group framed at its slot)
      const wh = (inner.piece as { whole: { restLocal: Float32Array; radius: number } }).whole, R = wh.restLocal, n = (R.length / 3) | 0;
      let sx = 0, sy = 0, sz = 0, lo = Infinity, top = -Infinity;
      for (let i = 0; i < R.length; i += 3) { sx += R[i]; sy += R[i + 1]; sz += R[i + 2]; if (R[i + 1] < lo) lo = R[i + 1]; if (R[i + 1] > top) top = R[i + 1]; }
      const cx = n ? sx / n : 0, cz = n ? sz / n : 0;
      let w = wh.radius; for (let i = 0; i < R.length; i += 3) { const d = Math.hypot(R[i] - cx, R[i + 2] - cz); if (d > w) w = d; }
      this.wholeR = wh.radius; this.wholeHalfW = w; this.wholeH = n ? Math.max(0.1, top - lo) : 2 * wh.radius; this.wholeCy = n ? sy / n - lo : wh.radius;
    }
    this.mats = new JellyMaterials(genome, this.palette, this.scale, hub, this.style);
    this.jelly = new JellyView(this.proxy, this.mats.get(spec.tier), this.fineFreqFor(spec));
    this.jelly.mesh.renderOrder = 10;
    this.core = new Core(genome, this.palette, this.scale, this.style);
    this.core.setLite(!spec.transmission);
    this.core.noHalo = lite && this.chunk;   // RD-06: a lite chunk's core glow stays in the jelly shader's own halo term (one draw fewer)
    this.hubRef = hub;
    this.face = this.makeFace(hub);   // (makeFace hands the face the render pose, PLAYGROUND)
    this.core.setPiece(this.proxy.piece);
    this.core.pose = this.pose;   // (round 3: the ember rides the render pose too)
    this.fx = new Fx(genome, this.palette, this.jelly.mapper, spec, this.scale, this.style);
    this.decals = new Decals(quad);
    this.applyPoolColour();
    this.rarity = new RarityFx(this.style, { scale: this.scale, seed: genome.seed, mapper: this.jelly.mapper, palette: this.palette });
    this.strands = new TackStrands(hub, this.palette.body, this.palette.pale);
    this.group.add(this.jelly.mesh, this.core.group, this.face.group, this.fx.group, this.decals.shadow, this.decals.pool, this.rarity.group, this.strands.group);
    this.group.frustumCulled = false;
    if (this.chunk) { this.faceHidden = true; this.face.group.visible = false; this.rarity.group.visible = false; }
    this.update(0, 0, null, null, 0, 0);
  }

  get body(): BodyProxy { return this.proxy; }
  get visible(): boolean { return this.shown; }
  setVisible(v: boolean): void { this.shown = v; this.group.visible = v; }

  setCalm(on: boolean): void { this.calm = on; this.core.calm = on; this.fx.calm = on; this.rarity.calm = on; }

  /** The floor light pool: the body's own pool colour, tinted toward the tier colour from Uncommon up ("faint tinted light pool"). */
  private applyPoolColour(): void {
    const p = this.palette.pool, t = this.style.tell, k = this.style.poolTint, b = this.poolBase;
    b[0] = p[0] + (t[0] - p[0]) * k; b[1] = p[1] + (t[1] - p[1]) * k; b[2] = p[2] + (t[2] - p[2]) * k;
    this.decals.setColor(b);
    this.poolTellNow = 0;
    // Epic+ caustic ring: mostly the tier colour (Mythic: a cool white prism tint), a little of the body's pool
    const rc = this.style.prism ? [0.75, 0.85, 1.0] : t;
    this.decals.setRingColor([rc[0] * 0.8 + p[0] * 0.2, rc[1] * 0.8 + p[1] * 0.2, rc[2] * 0.8 + p[2] * 0.2]);
  }

  /** Rarity tier styling (DESIGN 5.3). Cheap: re-styles the material and the FX in place. */
  setTier(tier: TierName): void {
    if (tier === this.tier) return;
    this.tier = tier; this.style = TIER_STYLES[tier];
    this.mats.setStyle(this.style);
    this.jelly.mesh.material = this.mats.get(this.spec.tier);
    this.core.setStyle(this.style);
    this.fx.setStyle(this.style);
    this.rarity.setStyle(this.style);
    this.applyPoolColour();
  }

  /** The TIER frequency the fine mesh is asked for: the tier's, or for a lite body (AddBodyOpts.lite, RD-06) at most the low tier's (2562
   *  vertices for a whole). Round 3 (MERGE_PC doubt 2): this is a tier cap only, with no size term of its own. The ONE size reduction is the
   *  share law the jelly applies after it (lod.ts fineFreqFor for a whole, a mini or a chunk; pieceBuild.ts pieceFineN for a true piece:
   *  vertices ~ share^(2/3)); round 2's own "frequency 12 at a quarter or less" stacked a second size cut on top of it. */
  private fineFreqFor(spec: TierSpec): number { return this.lite ? Math.min(spec.fineFreq, TIERS.low.fineFreq) : spec.fineFreq; }

  applyQuality(spec: TierSpec): void {
    this.spec = spec;
    this.jelly.mesh.material = this.mats.get(spec.tier);
    const ff = this.fineFreqFor(spec);
    if (this.jelly.freq !== ff) this.jelly.rebuild(ff);
    this.fx.setTier(spec);
    this.core.setLite(!spec.transmission);
  }

  spawnFx(kind: FxKind, at: V3, intensity: number): void { this.fx.spawn(kind, at, intensity); }

  /**
   * One frame: sync the proxy (offset + puppet), refresh the fine mesh, then core / face / FX / decals / rarity.
   * `simDt` steps an owned body (ceremony time-scale). `time` is this view's own clock (see `clock`; the stage advances it).
   */
  update(dt: number, time: number, pointer: { x: number; y: number } | null, camera: THREE.PerspectiveCamera | null, floatT: number, simDt: number): void {
    if (this.disposed) return;
    if (this.owned && simDt > 0) this.proxy.inner.step(simDt);
    this.proxy.sync(dt, time);
    const body = this.proxy, m = body.metrics, j = this.jelly;
    // PLAYGROUND: a sleeping body is frozen, so its fine mesh (the bulk of a view's CPU) keeps last frame's evaluation (RD-05); a touch wakes it
    // first in physics, and the shell clears the flag (a finger on a body flagged asleep re-evaluates anyway). Round 5 (B1): a sleeper whose drawn
    // centre moved since the last evaluation (placed elsewhere, slid, re-offset) is evaluated again, so it is never drawn in two places.
    {
      const c = body.center;
      const moved = !(Math.abs(c.x - this.fineCx) <= FINE_MOVE_M && Math.abs(c.y - this.fineCy) <= FINE_MOVE_M && Math.abs(c.z - this.fineCz) <= FINE_MOVE_M);
      if (!this.asleep || moved || m.fingers > 0 || m.grabbed || this.fineUpdates === 0) { j.update(); this.fineUpdates++; this.fineCx = c.x; this.fineCy = c.y; this.fineCz = c.z; }
    }
    if (this.isPiece && body.piece !== this.facePiece) this.rebuildFace();   // a merge published a NEW PieceInfo: which eyes and how much ember this piece holds changed
    // the player-caused-motion latch (RD-14, D-37): a finger or a grab sets it; it clears once the body has been still for 0.4 s
    {
      const c = body.center, ddx = c.x - this.lastCx, ddz = c.z - this.lastCz;   // (no Math.hypot: it boxes its arguments)
      const sp = Number.isFinite(this.lastCx) && dt > 1e-5 ? Math.sqrt(ddx * ddx + ddz * ddz) / dt : 0;
      this.lastCx = c.x; this.lastCz = c.z;
      if (m.fingers > 0 || m.grabbed) { this.playerMoving = true; this.stillS = 0; }
      else if (sp < 0.05) { this.stillS += dt; if (this.stillS > 0.4) this.playerMoving = false; }
      else this.stillS = 0;
    }
    // "squeeze": the body's global compression, or the deepest local dent (a poke barely changes the global metric);
    // the local dent only counts while a finger is down or just lifted (a jiggling body also moves off its rigid goal)
    this.touchGate += ((m.fingers > 0 ? 1 : 0) - this.touchGate) * (1 - Math.exp(-dt * (m.fingers > 0 ? 30 : 7)));
    this.grabGate += ((m.grabbed || m.fingers > 0 ? 1 : 0) - this.grabGate) * (1 - Math.exp(-dt * (m.grabbed || m.fingers > 0 ? 30 : 7)));
    // metrics.press (PHYS round 2, optional: undefined = 0) is the physics' own deepest-dent reading; feature-detected, the fine mesh's dent stays the fallback
    const physPress = typeof m.press === 'number' && Number.isFinite(m.press) ? Math.min(1, Math.max(0, m.press)) : 0;
    const rawSq = Math.max(m.compression, j.press * 0.9 * this.touchGate, physPress * this.touchGate);
    if (dt > 1e-4) this.sqRate += ((rawSq - this.prevSq) / dt - this.sqRate) * (1 - Math.exp(-dt / 0.06));
    this.prevSq = rawSq;
    this.smComp += (rawSq - this.smComp) * (1 - Math.exp(-dt * 14));
    this.smStretch += (Math.max(m.stretch, j.pull * 0.6 * this.grabGate) - this.smStretch) * (1 - Math.exp(-dt * 10));
    // CUT: a piece growing or shrinking (setFrac: a reconnect) keeps its core, glows and contact light in proportion
    const fr = this.proxy.inner.frac, fs = !this.isPiece && typeof fr === 'number' && Number.isFinite(fr) && fr > 0 ? Math.min(3, Math.max(0.3, Math.cbrt(fr / this.frac0))) : 1;   // (a true piece never scales with frac: a merge is a rest-shape morph)
    this.core.sizeMul = this.proxy.scale * fs;
    this.sizeK = fs * this.proxy.scale; this.fracK = fs;
    // PLAYGROUND render pose: about the body's ground point, sized by its rest radius and height (the eye anchors and, round 3, the ember read the same numbers)
    this.pose.update(dt, time, body.center.x, body.center.z, j.minY, this.restH * this.sizeK, body.restRadius * this.sizeK, this.quiet);
    this.core.update(body, dt, time, this.smComp, j.caps);
    const u = this.mats.uniforms;
    u.uTime.value = time;
    u.uCompress.value = this.smComp;
    u.uStretch.value = this.smStretch;
    u.uCoreWorld.value.copy(this.core.center);
    u.uCoreAmt.value = 0.3 * this.core.amount * (this.spec.transmission ? 1 : 1.9);
    const fp = this.fp;
    fp.cx = (j.minX + j.maxX) * 0.5; fp.cz = (j.minZ + j.maxZ) * 0.5;
    fp.rx = (j.maxX - j.minX) * 0.5; fp.rz = (j.maxZ - j.minZ) * 0.5;
    fp.lowY = j.minY; fp.compression = this.smComp; fp.stretch = this.smStretch;
    if (camera) {
      const e = camera.matrixWorld.elements, cc = body.center, ox = cc.x - camera.position.x, oy = cc.y - camera.position.y, oz = cc.z - camera.position.z;
      const depth = Math.max(0.5, -(ox * e[8] + oy * e[9] + oz * e[10]));   // along the view axis (the camera looks down its -z)
      this.frameRoom = Math.max(0.2, depth * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect - Math.abs(ox * e[0] + oy * e[1] + oz * e[2]));
    }
    fp.room = this.frameRoom;
    this.fx.setFootprint(Math.max(fp.rx, fp.rz));
    this.fx.setFrameRoom(this.frameRoom);
    this.face.group.visible = this.proxy.foldAmount < 0.4 && !this.faceHidden;   // eyes disappear into the ball while it folds
    // the happy squint is the RELEASE expression: while a finger or a grab still holds the body, a wobble of the squeeze (negative rate)
    // must not trigger it, the eyes stay wide (CONTRACT 7: widen when squeezed, squint into happy arcs on release)
    const rate = Math.min(this.sqRate, m.compressionRate);
    u.uPose.value.copy(this.pose.u); u.uPoseC.value.copy(this.pose.c);
    // PLAYGROUND looks: eased toward their targets; exactly 0 once settled at 0 (the shader then skips the block)
    { const L = this.look, N = this.lookNow, k = 1 - Math.exp(-dt * 2.5);
      for (let i = 0; i < 5; i++) { N[i] += (L[i] - N[i]) * k; if (L[i] === 0 && N[i] < 1e-4) N[i] = 0; }
      u.uLook.value.set(N[0], N[1], N[2], N[3]); u.uSnowL.value = N[4]; }
    if (!this.chunk && this.face.eyeCount > 0) this.face.update(dt, time, pointer, camera, this.smComp, m.fingers > 0 || m.grabbed ? Math.max(0, rate) : rate, m.fingers > 0 || m.grabbed);   // (a piece squints and widens with ITS OWN compression)
    // CUT seam: eased in (~0.1 s) and out (~0.2 s): a glow, never a step
    // (calm: the stage's glowK halves every cut light, and the seam takes a further x0.45: the jelly shader's seam term saturates (tone mapped), so a plain half of a
    // glow that was already clipped to white read exactly as bright as the full one, VERIFY_RENDER_B B-m3)
    const sk = this.seamTarget * this.glowK * (this.calm ? CALM_SEAM : 1);
    this.seamAmt += (sk - this.seamAmt) * (1 - Math.exp(-dt * (sk > this.seamAmt ? 10 : 5)));
    if (this.seamAmt < 1e-3 && sk <= 0) this.seamAmt = 0;
    const off = this.proxy.offset, su = u.uSeam.value;
    su.set(this.seamN.x, this.seamN.y, this.seamN.z, this.seamD + this.seamN.x * off.x + this.seamN.y * off.y + this.seamN.z * off.z);
    u.uSeamAmt.value = this.seamAmt;
    u.uSeamW.value = 0.03 * this.scale * fs;
    u.uSpotR.value = 0.16 * this.scale * fs;
    if (this.lodNow === 0) this.fx.update(dt, time, body);   // (CUT3: a small piece among many draws no FX: no glitter, no bubbles, no dust)
    const tell = Math.min(1, Math.max(0, this.extraPoolTell)) * Math.min(1, this.extraPool * 2);
    if (tell !== this.poolTellNow) {   // the ceremony light on the table, in the tier colour (no allocation: the setter copies)
      this.poolTellNow = tell;
      const b = this.poolBase, t = this.style.tell;
      this.decals.setColorRGB(b[0] + (t[0] - b[0]) * tell, b[1] + (t[1] - b[1]) * tell, b[2] + (t[2] - b[2]) * tell);
    }
    this.decals.update(dt, time, fp, floatT, this.style, this.calm, this.extraPool);
    // fingertips (SoftBodyLike.tip, optional; it allocates, so only while a finger is down or just lifted): contact glow + tack strands
    let tip0: TipSphere | null = null, tip1: TipSphere | null = null;
    if (m.fingers > 0 || this.tipsLive) { tip0 = this.proxy.tip(0); tip1 = this.proxy.tip(1); }
    this.tipsLive = !!tip0 || !!tip1;
    this.touchGlow(dt, tip0, tip1);
    this.strands.update(dt, this.proxy, m.strands, tip0, tip1, this.calm);
    for (let i = 0; i < this.strands.snapsAt.length; i += 3) {   // a strand snapped: a few tiny bubbles where it broke
      this.snapAt.x = this.strands.snapsAt[i]; this.snapAt.y = this.strands.snapsAt[i + 1]; this.snapAt.z = this.strands.snapsAt[i + 2];
      this.fx.spawn('bubbles', this.snapAt, 0);
    }
    if (camera) this.rarity.frameFit = Math.min(1, Math.max(0.72, camera.aspect / 0.75));
    if (this.lodNow === 0) this.rarity.update(dt, time, body, fp.rx, fp.rz, floatT, this.frameRoom);
  }

  private readonly snapAt = { x: 0, y: 0, z: 0 };

  private hubRef: EnvHub | null = null;
  /** The PieceInfo the current face was built from (CUT2): a merge publishes a NEW one and the face (which eyes this piece holds) is built again, once. */
  private facePiece: PieceInfo | undefined;
  /** The face of this view: a whole's (both eyes), or for a piece just the eyes it holds, from the whole's eye placement (wholeRef.ts / pieceEyes.ts). */
  private makeFace(hub: EnvHub): Face {
    const pc = this.proxy.piece, pb = this.jelly.pb;
    this.facePiece = pc;
    let f: Face;
    if (this.isPiece && pc && pb) {
      const w = pc.whole;
      const ref = wholeRefFor({ vertexCount: (w.restLocal.length / 3) | 0, indices: w.indices, restLocal: w.restLocal }, w.radius, this.genome);
      f = new Face(this.proxy, this.genome, this.jelly, hub, buildPieceEyes(this.proxy.restLocal, this.proxy.indices, pc, pb, ref));
    } else f = new Face(this.proxy, this.genome, this.jelly, hub, undefined, this.faceLod);
    f.pose = this.pose;   // PLAYGROUND: the eye anchors ride the render pose (a rebuilt piece face keeps it)
    return f;
  }
  /** CUT3: a small mini (a complete copy, not a true piece; body scale under 0.7) draws its eyes from a coarser dome in one pass: sqrt of its size, 0.4 .. 1 (a whole stays 1 and two passes, exactly as before). */
  private get faceLod(): { domeQ: number; singlePass: boolean } | undefined {
    const s = this.scale;
    return this.isPiece || !(s < 0.7) || !LOD_TUNING.enabled ? undefined : { domeQ: Math.max(0.4, Math.min(1, Math.sqrt(s))), singlePass: true };
  }
  private rebuildFace(): void {
    const old = this.face;
    this.face = this.makeFace(this.hubRef as EnvHub);
    old.group.removeFromParent(); old.dispose();
    this.group.add(this.face.group);
    this.core.setPiece(this.proxy.piece);
  }

  /** CUT seam (stage.setCutSeam): the plane in the body's world space, t 0..1 (0 or a null plane: the glow eases out). */
  setSeam(plane: { point: V3; normal: V3 } | null, t: number): void {
    const n = plane?.normal, p = plane?.point;
    const l = n ? Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z) : 0;
    if (!n || !p || !(l > 1e-6) || !Number.isFinite(l) || !Number.isFinite(p.x + p.y + p.z) || !(t > 0)) { this.seamTarget = 0; return; }
    // face-aware (CUT2 8.5): a plane that IS one of this piece's live cut faces never lights the skin band (a face lies at distance 0 of its own plane: the band's gaussian would light all
    // of it at about ten times the thin line's strength). The face's own sheen channel is task R2.
    if (this.isPiece && this.planeIsFace(n.x / l, n.y / l, n.z / l, (n.x * p.x + n.y * p.y + n.z * p.z) / l)) { this.seamTarget = 0; return; }
    this.seamN.set(n.x / l, n.y / l, n.z / l);
    this.seamD = this.seamN.x * p.x + this.seamN.y * p.y + this.seamN.z * p.z;
    const x = Math.min(1, t / 0.45);
    this.seamTarget = 0.9 * x * x * (3 - 2 * x);   // rises with the waist, full well before the pieces part
  }
  /** Does the plane (unit normal, offset in the body's world space) coincide with one of the live cut faces: |cos| >= 0.97 and the face centroid within 0.03 R0 of the plane? */
  private planeIsFace(nx: number, ny: number, nz: number, d: number): boolean {
    const off = this.proxy.offset, r0 = this.scale * 0.5, shift = nx * off.x + ny * off.y + nz * off.z;
    for (const c of this.jelly.caps) {
      if (!c.live) continue;
      if (Math.abs(nx * c.nx + ny * c.ny + nz * c.nz) < 0.97) continue;
      if (Math.abs(nx * c.cx + ny * c.cy + nz * c.cz - shift - d) <= 0.03 * r0) return true;
    }
    return false;
  }
  /** The seam of the body this piece was cut from, carried over at its current strength, fading out (render world space). */
  carrySeam(nx: number, ny: number, nz: number, d: number, amt: number): void {
    const off = this.proxy.offset;
    this.seamN.set(nx, ny, nz); this.seamD = d - (nx * off.x + ny * off.y + nz * off.z);
    this.seamAmt = Math.max(this.seamAmt, amt); this.seamTarget = 0;
  }
  get seamAmount(): number { return this.seamAmt; }
  /** The body's current size (rest radius x its frac growth since the view was built): what the CUT strand and bridge are sized by. */
  get liveRadius(): number { return this.proxy.restRadius * this.sizeK; }
  private sizeK = 1;
  private fracK = 1;
  /** How far a piece has grown or shrunk since the view was built (setFrac: a reconnect), as a length factor: 1 for an ordinary body. The stage frames by it. */
  get growth(): number { return this.fracK; }
  /** CUT bridge: a soft glow spot where the reconnect neck joins this body (world position, strength 0..1; 0 = off). */
  setSpot(x: number, y: number, z: number, w: number): void { this.mats.uniforms.uSpot.value.set(x, y, z, Math.max(0, Math.min(1, w))); }

  /**
   * Contact glow ("touch the light", stage B5): where a fingertip presses, the jelly blooms softly in its CORE colour, with the press
   * depth (attack ~0.1 s, release ~0.2 s). A local light, not a flash (gate G7 unchanged); calm effects halve it.
   */
  private touchGlow(dt: number, t0: TipSphere | null, t1: TipSphere | null): void {
    const u = this.mats.uniforms, k = this.calm ? 0.45 : 0.9;
    for (let f = 0; f < 2; f++) {
      const t = f === 0 ? t0 : t1, v = f === 0 ? u.uTouch0.value : u.uTouch1.value;
      const target = t ? Math.min(1, Math.max(0, t.depth * 1.3)) : 0;
      const a = this.touchAmt[f];
      this.touchAmt[f] = a + (target - a) * (1 - Math.exp(-dt * (target > a ? 10 : 5)));
      if (t) { v.x = t.x; v.y = t.y; v.z = t.z; u.uTouchR.value = Math.max(0.05 * this.scale, t.r * 1.5); }
      v.w = this.touchAmt[f] * k;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    this.jelly.dispose(); this.core.dispose(); this.face.dispose(); this.fx.dispose(); this.mats.dispose(); this.decals.dispose(); this.rarity.dispose();
    this.strands.dispose();
  }
}
