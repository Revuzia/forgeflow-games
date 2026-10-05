// BodyView: everything the stage draws for ONE body: the fine jelly mesh, core, face, FX, the two table decals and the
// rarity FX. The stage holds a list of these (multi-body: two parents and a result during a ceremony). Each view reads a
// BodyProxy (offset + puppet) instead of the raw body, owns its GPU objects and disposes them all in dispose().
// Shared across views: the environment (EnvHub), the unit decal quad, and the compiled shader programs (same cache keys).
import * as THREE from 'three';
import type { FxKind, SoftBodyLike, TierName, V3 } from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import { BodyProxy } from './bodyproxy.ts';
import { Core } from './core.ts';
import { Decals, type Footprint } from './decals.ts';
import type { EnvHub } from './env.ts';
import { Face } from './face.ts';
import { Fx } from './fx.ts';
import { JellyView } from './jelly.ts';
import { JellyMaterials } from './material.ts';
import { genomePalette, type JellyPalette } from './oklch.ts';
import type { TierSpec } from './quality.ts';
import { RarityFx, TIER_STYLES, type TierStyle } from './rarity.ts';

export class BodyView {
  readonly id: number;
  readonly proxy: BodyProxy;
  readonly genome: Genome;
  readonly palette: JellyPalette;
  readonly group = new THREE.Group();
  readonly scale: number;
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
  /** Extra pool light (capsule tell, merge charge) 0..1 added by the ceremonies. */
  extraPool = 0;
  /**
   * The view's OWN clock (seconds since it was created). Every time-phased idle effect (blink, breathing, core pulse, aurora,
   * thin-film drift, orbiting motes / satellites, glitter twinkle, pool caustics) reads this, never the stage's global time, so
   * a body's look is a function of its own age: a ceremony skip() can fast-forward the result to EXACTLY the frame the natural
   * ending reaches, and two bodies on the table do not breathe in lockstep. Advanced by the stage every frame (hidden views too).
   */
  clock = 0;
  private spec: TierSpec;
  private readonly hub: EnvHub;
  private smComp = 0; private smStretch = 0; private prevSq = 0; private sqRate = 0; private touchGate = 0; private grabGate = 0;
  private calm = false;
  private shown = true;
  private disposed = false;

  constructor(id: number, inner: SoftBodyLike, genome: Genome, tier: TierName, spec: TierSpec, hub: EnvHub, quad: THREE.BufferGeometry, owned: boolean) {
    this.id = id; this.genome = genome; this.tier = tier; this.style = TIER_STYLES[tier]; this.spec = spec; this.hub = hub; this.owned = owned;
    this.proxy = new BodyProxy(inner);
    this.palette = genomePalette(genome);
    this.scale = inner.restRadius / 0.5;
    this.mats = new JellyMaterials(genome, this.palette, this.scale, hub, this.style);
    this.jelly = new JellyView(this.proxy, this.mats.get(spec.tier), spec.fineFreq);
    this.jelly.mesh.renderOrder = 10;
    this.core = new Core(genome, this.palette, this.scale, this.style);
    this.core.setLite(!spec.transmission);
    this.face = new Face(this.proxy, genome, this.jelly, hub);
    this.fx = new Fx(genome, this.palette, this.jelly.mapper, spec, this.scale, this.style);
    this.decals = new Decals(quad);
    this.applyPoolColour();
    this.rarity = new RarityFx(this.style, { scale: this.scale, seed: genome.seed, mapper: this.jelly.mapper, palette: this.palette });
    this.group.add(this.jelly.mesh, this.core.group, this.face.group, this.fx.group, this.decals.shadow, this.decals.pool, this.rarity.group);
    this.group.frustumCulled = false;
    this.update(0, 0, null, null, 0, 0);
  }

  get body(): BodyProxy { return this.proxy; }
  get visible(): boolean { return this.shown; }
  setVisible(v: boolean): void { this.shown = v; this.group.visible = v; }

  setCalm(on: boolean): void { this.calm = on; this.core.calm = on; this.fx.calm = on; this.rarity.calm = on; }

  /** The floor light pool: the body's own pool colour, tinted toward the tier colour from Uncommon up ("faint tinted light pool"). */
  private applyPoolColour(): void {
    const p = this.palette.pool, t = this.style.tell, k = this.style.poolTint;
    this.decals.setColor([p[0] + (t[0] - p[0]) * k, p[1] + (t[1] - p[1]) * k, p[2] + (t[2] - p[2]) * k]);
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

  applyQuality(spec: TierSpec): void {
    this.spec = spec;
    this.jelly.mesh.material = this.mats.get(spec.tier);
    if (this.jelly.freq !== spec.fineFreq) this.jelly.rebuild(spec.fineFreq);
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
    j.update();
    // "squeeze": the body's global compression, or the deepest local dent (a poke barely changes the global metric);
    // the local dent only counts while a finger is down or just lifted (a jiggling body also moves off its rigid goal)
    this.touchGate += ((m.fingers > 0 ? 1 : 0) - this.touchGate) * (1 - Math.exp(-dt * (m.fingers > 0 ? 30 : 7)));
    this.grabGate += ((m.grabbed || m.fingers > 0 ? 1 : 0) - this.grabGate) * (1 - Math.exp(-dt * (m.grabbed || m.fingers > 0 ? 30 : 7)));
    const rawSq = Math.max(m.compression, j.press * 0.9 * this.touchGate);
    if (dt > 1e-4) this.sqRate += ((rawSq - this.prevSq) / dt - this.sqRate) * (1 - Math.exp(-dt / 0.06));
    this.prevSq = rawSq;
    this.smComp += (rawSq - this.smComp) * (1 - Math.exp(-dt * 14));
    this.smStretch += (Math.max(m.stretch, j.pull * 0.6 * this.grabGate) - this.smStretch) * (1 - Math.exp(-dt * 10));
    this.core.update(body, dt, time, this.smComp);
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
    this.fx.setFootprint(Math.max(fp.rx, fp.rz));
    this.face.group.visible = this.proxy.foldAmount < 0.4;   // eyes disappear into the ball while it folds
    this.face.update(dt, time, pointer, camera, this.smComp, Math.min(this.sqRate, m.compressionRate));
    this.fx.update(dt, time, body);
    this.decals.update(dt, time, fp, floatT, this.style, this.calm, this.extraPool);
    this.rarity.update(dt, time, body, fp.rx, fp.rz, floatT);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    this.jelly.dispose(); this.core.dispose(); this.face.dispose(); this.fx.dispose(); this.mats.dispose(); this.decals.dispose(); this.rarity.dispose();
    void this.hub;
  }
}
