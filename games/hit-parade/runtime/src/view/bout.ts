// HIT PARADE - the 3D presentation of one match (CONTRACT §16 BoutView, §7, §17, §26 CHANGED(VIEW) P2).
//
// BoutView reads ONLY snapshots + (deduped, new) events. Per rendered frame (`frame`):
//   1. PRIME TIME: while MatchSnap.cinematic is active, view/prime.ts turns (cue, cinematic frame) into both fighters'
//      poses / positions, the camera shot, FX beats, props, dim / spotlight / letterbox / name slate; an 8-frame blend
//      hands the pose back to the sim after the cinematic;
//   2. fighters posed from state (anim.ts) or the cinematic override, victim shake during hitstop, props by rule;
//   3. events -> FX anchored on the CURRENT pose (a strike's HIT + COUNTER / PUNISH on the same frame collapse into ONE
//      burst of the strongest kind), camera cues, crowd pops, projectile impacts, goon downs, score popups;
//   4. camera: cinematic shot > KO orbit (+ low hero hold on the winner, loser out of frame) > super punch-in >
//      perfect-parry freeze > side rig (BRAWL: the player + goons in reach);
//   5. background dim, crowd intensity from SHOWTIME, projectile visuals (MatchSnap.proj), goons (MatchSnap.goons),
//      stage dressing (stages.json hooks + monitor feeds);
//   6. FX / crowd / stage advance at the slow-mo rate (KO x0.25, PRIME TIME holds x0.3); flash + camera smoothing real time.
// `render()` draws through the post chain. `create()` loads the stage + both fighters (+ props, goons), bakes/loads the
// crowd atlas and WARMS every program (RT variants then canvas, E34) before the first round.
//
// CHANGED(VIEW3D) (CONTRACT §35): the 3D ring. Fighters / goons / projectiles at their snapshot (x, y, z) + yaw; the
// orbit camera follows the sim's camN (camera.ts); hit / block / parry FX sit at the real 3D contact (the victim's body,
// 0.18 m back along the hit direction, 0.12 m toward the camera) with the spray along the hit direction; WALL_SPLAT decodes
// the §35.13 payload (b & 255 = wall, b >> 8 = inward normal deg, c / d = contact cm) onto the ring wall. PRIME TIME runs
// in LINE SPACE (prime.ts is 1D: x along the fight line, z toward the camera) mapped onto the ring through a frame frozen
// at the cinematic start: origin = the attacker's root, R = the attacker's forward x facing, the camera side = the sim's
// camN side unless the room there is cramped (< 3.2 m to the ring), then the roomier side - so every cue frames the
// same at any fight-line angle. Victim / attacker cinematic roots are clamped inside the ring (0.3 m).

import * as THREE from 'three';
import type { Renderer } from './renderer.ts';
import { Assets, type FighterAsset } from './assets.ts';
import { Post } from './post.ts';
import { FightCamera, CAM, type CamFighter, type CinePose } from './camera.ts';
import { FighterView, type FighterOverride, type PoseItem } from './fighters.ts';
import { FxSystem, type HitKind } from './fx.ts';
import { StageView, stageDef } from './stage.ts';
import { CrowdView, bakeCrowdAtlas, loadCrowdAtlas, type CrowdAtlas } from './crowd.ts';
import { animTableFor, animSeconds, clipFactsOf, moveKeys } from './animtable.ts';
import { newPose, sampleTrack, trackFor, newLocalPose, type V3 } from './cinematics.ts';
import { compilePlan, newSample, paintSlate, PrimeProps, propsAt, samplePlan, slateParts, type CineDef, type ClipFact, type PrimePlan, type PrimeSample } from './prime.ts';
import { ProjectileView } from './projectiles.ts';
import { PropLibrary, propGlbUrl } from './props.ts';
import { BrawlView, type Popup } from './brawl.ts';
import { setOutlineViewport } from './toon.ts';
import { warmupComposer } from './warmup.ts';
import { EV, EV_SOURCE } from './ev.ts';
import { LineFrame, ringClamp, ringFrom, ringRay, ringSolidTop, ringWallAt, type RingGeom } from './ring3d.ts';
import { stepFactsFor } from './stepanim.ts';
import { makeLightProbe } from './lightlevel.ts';
import {
  DEFAULT_VIEW_SETTINGS, flagOn, type ViewEvent, type ViewFighterSnap, type ViewGameData, type ViewMatchCfg,
  type ViewMatchSnap, type ViewSettings,
} from './types.ts';

export type { ViewSettings } from './types.ts';
export type { Popup } from './brawl.ts';

function numAt(o: unknown, paths: string[][], dflt: number): number {
  for (const p of paths) {
    let v: unknown = o;
    for (const k of p) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return dflt;
}
function smooth(t: number): number { const x = t < 0 ? 0 : t > 1 ? 1 : t; return x * x * (3 - 2 * x); }
function ps0(s: PrimeSample): number { return s.freeze; }
/** a fighter's standing push-box front (m): the measured `push.front`, else half the symmetric box */
function pushFront(def: unknown): number {
  const d = def as { push?: { front?: unknown }; pushbox?: ReadonlyArray<unknown> } | undefined;
  if (!d) return 0;
  const f = Number(d.push?.front ?? (Array.isArray(d.pushbox) ? Number(d.pushbox[0]) / 2 : 0));
  return Number.isFinite(f) ? Math.max(0, f) : 0;
}

const TRAUMA_BY_STRENGTH = [0.10, 0.15, 0.20, 0.20, 0.25, 0.35, 0.10, 0.20];
const OUTRO_FRAMES = 8;

export interface BoutOptions {
  /** allow the stand-in set when the stage GLB is missing (lab / dev); default true */
  allowStageFallback?: boolean;
  /** crowd on/off (perf A/B); default true */
  crowd?: boolean;
  /** outline hulls on/off (perf A/B); default true */
  outline?: boolean;
  /** skip the warm-up (debug: per-program compile timing) */
  warm?: boolean;
  /** attach ASSETS props (default true) */
  props?: boolean;
}

export class BoutView {
  readonly r: Renderer;
  readonly scene = new THREE.Scene();
  readonly cam: FightCamera;
  readonly post: Post;
  readonly fx: FxSystem;
  readonly stage: StageView;
  readonly fighters: [FighterView, FighterView];
  readonly crowd: CrowdView | null;
  readonly proj: ProjectileView;
  readonly primeProps: PrimeProps;
  brawl: BrawlView | null = null;
  readonly cfg: ViewMatchCfg;
  readonly data: ViewGameData;
  settings: Required<ViewSettings> = { ...DEFAULT_VIEW_SETTINGS };
  private sizeVersion = -1;
  private lastRound = -1;
  private superAt = -1000;
  private superFrames: number;
  private superFrames1: number;
  private superFrames3: number;
  private readonly cine = newPose();
  private lastDt = 1 / 60;
  private realTime = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmp3 = new THREE.Vector3();
  private readonly gV = new THREE.Vector3();
  private readonly gU = new THREE.Vector3();
  private readonly gR = new THREE.Vector3();
  private readonly gD = new THREE.Vector3();
  private readonly gPts: Array<[number, number, number, number]> = [];   // [x, y, z, axis 0 = top, 1 = side]
  /** the last frame's framing-guard correction (lab read-back): dolly m, fov widened by deg, crouch follow m */
  guardLast = { dolly: 0, fov: 0, crouch: 0 };
  private readonly camF: [CamFighter, CamFighter] = [{ x: 0, y: 0, z: 0, head: 1.8 }, { x: 0, y: 0, z: 0, head: 1.8 }];
  /** CHANGED(VIEW3D): the ring (stage facts + the sim's ring once a snapshot carries it) */
  ring: RingGeom;
  private ringFromSim = false;
  /** CHANGED(VIEW3D): PRIME TIME line frame (frozen at the cinematic start) + the facing in it */
  readonly cineF = new LineFrame();
  private cineFacing = 1;
  private cineFlip = false;
  private readonly cl2: [number, number] = [0, 0];
  private readonly wl4: [number, number, number, number] = [0, 0, 0, 0];
  private readonly goonPts: Array<[number, number]> = [];
  private dustCol: THREE.Color | null = null;
  private pendingHits = new Map<string, { kind: HitKind; rank: number; ev: ViewEvent }>();
  private lastSnaps: [ViewFighterSnap, ViewFighterSnap] | null = null;
  // PRIME TIME state (all derived from sim frames; `plan` is a cache of compilePlan for the running cinematic)
  private plan: PrimePlan | null = null;
  private planKey = '';
  private planAtt = 0;
  private lastCineFrame = -1;
  private firedUpTo = -1;
  private metalUntil = -1;
  private readonly ps: PrimeSample = newSample();
  private readonly psScratch = { prev: newLocalPose(), blendFrom: newLocalPose() };
  private smearPrev: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private readonly ov: [FighterOverride, FighterOverride] = [{}, {}];
  private outro: { at: number; att: number; lists: [PoseItem[], PoseItem[]]; pos: Array<[number, number, number]> } | null = null;
  private readonly slateCanvas: HTMLCanvasElement = document.createElement('canvas');
  private readonly slateTex: THREE.CanvasTexture;
  private slateKey = '';
  private crowdFocus: V3 | null = null;
  private cineTs = 1;
  private readonly propLib: PropLibrary | null;
  /** CHANGED(fixer) D4: screen-y fraction (from the top) of each fighter's top, last frame */
  readonly lastTops: [number, number] = [0, 0];
  /** CHANGED(fix_view) D13: screen-y fraction (from the top) of each fighter's feet (root), last frame */
  readonly lastFeet: [number, number] = [0, 0];
  /** CHANGED(fix_view) D5: the toon light scale at a world point (stage light pool) */
  lightProbe: ((x: number, y: number, z: number) => number) | null = null;
  /** CHANGED(fix_view) D13: frame by the measured neutral top (head + a raised limb); false = the old head-only top (A/B) */
  realTops = true;

  /** CHANGED(fix_view) D5 harness A/B: the pre-fix look (old bloom, no body light cap) */
  legacyLook(on: boolean): void {
    this.post.legacyBloom = on;
    for (const f of this.fighters) f.lightProbe = on ? null : this.lightProbe;
  }
  warmMs = 0;
  warmSplit: Record<string, number> = {};
  loadSplit: Record<string, number> = {};

  private constructor(r: Renderer, cfg: ViewMatchCfg, data: ViewGameData, stage: StageView, fighters: [FighterView, FighterView],
    crowd: CrowdView | null, propLib: PropLibrary | null) {
    this.r = r;
    this.cfg = cfg;
    this.data = data;
    this.stage = stage;
    this.fighters = fighters;
    this.crowd = crowd;
    this.propLib = propLib;
    this.cam = new FightCamera(r.css.x / Math.max(1, r.css.y));
    if (cfg.mode === 'brawl') this.cam.variant = 'brawl';
    this.ring = ringFrom(null, stageDef(data, cfg.stage));
    this.cam.ring = this.ring;
    if (this.ring.dust) { try { this.dustCol = new THREE.Color(this.ring.dust); } catch { this.dustCol = null; } }
    this.scene.name = 'bout';
    stage.applyTo(this.scene, r.three);
    for (const f of fighters) this.scene.add(f.root);
    // CHANGED(fix_view) D6 / D5: sidestep facts per fighter (system step + its own step.distM + its clips' rootLat) and the
    // light cap from the stage's light pool
    {
      const probe = makeLightProbe(stage.lights, stage.def.exposure ?? 1).probe;
      fighters.forEach((f, i) => { f.stepFacts = stepFactsFor(cfg.p[i]?.fighter ?? f.id, data.fighters[cfg.p[i]?.fighter ?? f.id], data.system); f.lightProbe = probe; });
      this.lightProbe = probe;
      // D13: a bigger body's feet reach further toward the lens
      this.cam.feetDepth = CAM.feetDepth * Math.max(1, ...fighters.map((f) => f.heightM / 1.8));
    }
    if (crowd) this.scene.add(crowd.mesh);
    this.post = new Post(r, this.scene, this.cam.camera);
    this.fx = new FxSystem(this.scene, this.post, this.cam);
    this.proj = new ProjectileView(this.scene, this.fx, fighters, data, cfg);
    this.primeProps = new PrimeProps();
    this.scene.add(this.primeProps.group);
    this.slateTex = new THREE.CanvasTexture(this.slateCanvas);
    this.slateTex.colorSpace = THREE.SRGBColorSpace;
    paintSlate(this.slateCanvas, 'PRIME TIME', ' ', ' ');
    this.post.setSlate(this.slateTex, 0, 0, 0, 0, 0);
    // system.json super.freeze1 / freeze3 (FIGHTING_DESIGN 1c: fixed frames per level)
    this.superFrames3 = numAt(data.system, [['super', 'freeze3'], ['super', 'freeze']], CAM.superFrames);
    this.superFrames1 = numAt(data.system, [['super', 'freeze1'], ['super', 'freeze']], 30);
    this.superFrames = this.superFrames3;
    this.setSettings({});
  }

  /** Load stage + both fighters (+ props, goons), bake/load the crowd atlas, warm every program. */
  static async create(r: Renderer, a: Assets, cfg: ViewMatchCfg, data: ViewGameData, opts: BoutOptions = {}): Promise<BoutView> {
    const ids = [cfg.p[0]?.fighter ?? '', cfg.p[1]?.fighter ?? ''];
    const t0 = performance.now();
    const [stage, fa, fb] = await Promise.all([
      StageView.create(a, cfg.stage, data, r.shadowSize(), opts.allowStageFallback !== false),
      a.fighter(ids[0]), a.fighter(ids[1]),
    ]);
    const t1 = performance.now();
    const mk = (i: number, asset: FighterAsset) => new FighterView(a, asset, animTableFor(data, ids[i]), data.fighters[ids[i]],
      cfg.p[i]?.color ?? 0, opts.outline !== false);
    const fighters: [FighterView, FighterView] = [mk(0, fa), mk(1, fb)];
    for (const f of fighters) f.measureTop();                  // CHANGED(fix_view) D13: the camera's real tops
    let crowd: CrowdView | null = null;
    if (opts.crowd !== false && stage.crowd.length) {
      let atlas: CrowdAtlas | null = null;
      const cd = stageDef(data, cfg.stage).crowd;
      if (cd?.atlas && cd.cols && cd.rows) {
        try {
          atlas = await loadCrowdAtlas(new URL(`../../../art/gltf/stages/${cd.atlas}`, import.meta.url).href,
            cd.meta ? new URL(`../../../art/gltf/stages/${cd.meta}`, import.meta.url).href : null, cd.cols, cd.rows,
            { count: cd.count, tint: cd.tint, brightness: cd.brightness, anchor: cd.anchor });
        } catch (e) { console.warn('[view] crowd atlas failed, baking one:', e); }
      }
      if (!atlas) atlas = await bakeCrowdAtlas(r.three, a, [{ asset: fa, body: data.fighters[ids[0]]?.body }, { asset: fb, body: data.fighters[ids[1]]?.body }]);
      crowd = new CrowdView(atlas, stage.crowd, 7);
    }
    const lib = opts.props !== false ? new PropLibrary() : null;
    const v = new BoutView(r, cfg, data, stage, fighters, crowd, lib);
    if (lib) {
      for (let i = 0; i < 2; i++) {
        for (const p of await lib.load(a, ids[i])) fighters[i].attachProp(p.obj, p.attach, v.scene, p.rule.show, p.id);
      }
    }
    if (opts.props !== false) {
      await v.proj.useAssetBodies(a);
      const fu = propGlbUrl('football');
      if (fu) { try { a.setUrl('prop', 'football', fu); v.primeProps.setBall(await a.prop('football')); } catch (e) { console.warn('[view] prime ball prop', e); } }
    }
    if (cfg.mode === 'brawl' || cfg.mode === 'heckler') {
      v.brawl = await BrawlView.create(a, v.fx, fb, data.goonAnims);
      v.scene.add(v.brawl.group);
    }
    const t2 = performance.now();
    v.loadSplit = { assets: Math.round(t1 - t0), fightersCrowdProps: Math.round(t2 - t1) };
    if (opts.warm !== false) await v.warm();
    // dev-only harness handle (lookshots.py --game reads the view's own read-back in the REAL game; tree-shaken from the
    // build): window.__HP_VIEW__ = { info(), popups() } of the live bout
    if (import.meta.env.DEV) (window as unknown as { __HP_VIEW__?: unknown }).__HP_VIEW__ = { info: () => v.info(), popups: () => v.popups(), view: v };
    return v;
  }

  /** shader / texture warm-up (blocktooth warmup.ts: RT variants, then the canvas) + one composer frame */
  private async warm(): Promise<void> {
    const t0 = performance.now();
    // a neutral pose + camera so every program's variant for this scene links now
    const idle = { x: -1.2, y: 0, facing: 1, animId: 0, animFrame: 0, prevAnimId: 0, prevAnimFrame: 0, blendT: 1 };
    this.fighters[0].update(idle, 0, 0);
    this.fighters[1].update({ ...idle, x: 1.2, facing: -1 }, 0, 0);
    this.fighters[0].toon.setGlow(0.01); this.fighters[1].toon.setGlow(0.01);
    this.cam.update(1 / 60, [{ x: -1.2, y: 0, head: 1.8 }, { x: 1.2, y: 0, head: 1.8 }], this.r.css.x / Math.max(1, this.r.css.y), 0);
    this.fx.primeForWarmup();
    this.primeProps.showForWarmup();
    this.post.setSlate(this.slateTex, 0.01, 0.01, 0.01, 0.01, 0.01);
    this.post.setLetterbox(0.001);
    const bloomWas = this.post.bloom.enabled;
    this.post.bloom.enabled = this.settings.bloom && this.r.bloomAllowed();
    this.crowdPts();                                           // CHANGED(fix_view) G9: cached here, not at the first super
    const t1 = performance.now();
    await warmupComposer(this.r.three, this.scene, this.cam.camera);
    const t2 = performance.now();
    this.render();
    const t3 = performance.now();
    this.post.bloom.enabled = bloomWas;
    this.primeProps.hideAll();
    this.post.setSlate(null, 0, 0, 0, 0, 0);
    this.post.setLetterbox(0);
    this.warmSplit = { prep: Math.round(t1 - t0), warmup: Math.round(t2 - t1), firstComposer: Math.round(t3 - t2),
      programs: this.r.three.info.programs?.length ?? 0 };
    this.warmPrime();
    this.warmMs = performance.now() - t0;
  }

  /**
   * CHANGED(fix_view) G9: the first PRIME TIME of a page spent ~12 ms more on its start frame than later ones (measured
   * with the lab's frameCost probe: cold cf0 'prime' 12.2 ms vs ~0.6 ms warm) - first-run JIT of the cinematic code plus the
   * plan compile. Run the same compile and a few samples for both fighters' cinematic moves here, behind the loading card,
   * then drop the plan (no beats fire, nothing is shown).
   */
  private warmPrime(): void {
    const t0 = performance.now();
    const idle = (x: number, facing: number): ViewFighterSnap => ({ x, y: 0, z: 0, yaw: facing * Math.PI / 2, facing, animId: 0, animFrame: 0, prevAnimId: 0, prevAnimFrame: 0, blendT: 1 });
    const snaps: [ViewFighterSnap, ViewFighterSnap] = [idle(-1.2, 1), idle(1.2, -1)];
    for (const who of [0, 1] as const) {
      const def = this.data.fighters[this.cfg.p[who]?.fighter ?? ''];
      const keys = moveKeys(def);
      const k = keys.findIndex((q) => !!def?.moves[q]?.cinematic);
      if (k < 0) continue;
      try {
        this.primeBegin(snaps, who, k, 0, !!(def!.moves[keys[k]] as { grab?: unknown }).grab, [0, 1]);
        const pl = this.plan!;
        for (let cf = 0; cf < pl.frames; cf += 15) samplePlan(pl, cf, false, this.crowdFocus, 0, this.cineFacing, null, this.ps, this.psScratch);
      } catch (e) { console.warn('[view] PRIME TIME warm-up', e); }
    }
    this.plan = null; this.outro = null; this.planKey = ''; this.lastCineFrame = -1; this.firedUpTo = -1;
    this.warmSplit.prime = Math.round(performance.now() - t0);
  }

  /**
   * CHANGED(fixer) D4: the screen band the HUD covers at the top (fraction of the frame height, 0 = none). The camera's
   * jump pan keeps an airborne fighter's head below it (game.ts passes Hud.safeTop() each frame; cheap, cached there).
   */
  setSafeArea(top: number): void { this.cam.safeTop = Number.isFinite(top) ? Math.max(0, Math.min(0.45, top)) : 0; }

  setSettings(s: ViewSettings): void {
    this.settings = { ...this.settings, ...Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) } as Required<ViewSettings>;
    this.fx.mode = this.settings.splatter;
    this.fx.reduceFlashing = this.settings.reduceFlashing;
    this.post.reduceFlashing = this.settings.reduceFlashing;
    this.cam.shakeScale = this.settings.screenShake;
    this.post.setBloom(this.settings.bloom);
  }

  /** P2: live score popups (BRAWL BREAK / HECKLER TOSS) with screen positions (0..1, y from the top) for the UI to draw */
  popups(): ReadonlyArray<Popup> { return this.brawl ? this.brawl.popups() : []; }

  /**
   * CHANGED(VIEW3D): the strike's 3D contact point -> `out` (world) and the FX basis for its spray: X = the hit direction
   * (attacker -> victim on the ground) signed so that X . R >= 0 (Z = toward the camera); returns the spray sign along X.
   */
  private hitPos(att: ViewFighterSnap, vic: ViewFighterSnap, vicView: FighterView, dcm: number, out: THREE.Vector3, sc = -1): number {
    const ax = att.x, az = att.z ?? 0, vx = vic.x, vz = vic.z ?? 0;
    let dx = vx - ax, dz = vz - az;
    let l = Math.hypot(dx, dz);
    if (l < 1e-4) {
      const yw = typeof att.yaw === 'number' ? att.yaw : (att.facing < 0 ? -1 : 1) * Math.PI / 2;
      dx = Math.sin(yw); dz = Math.cos(yw); l = 1;
    }
    dx /= l; dz /= l;
    const b = this.cam.basis();
    const s = dx * b.rx + dz * b.rz >= 0 ? 1 : -1;
    this.fx.setBasis(s * dx, s * dz);
    if (sc === 7) {
      // CHANGED(fixer) D7: a throw's damage lands on the victim's BODY - the thrown clip has carried it off its root
      // x and down to the floor, so the fixed contact height (d = 100 cm at the root) floated the spark in mid-air
      vicView.chest(out);
      this.fx.offset(out, 0, 0, 0.12, out);
      return s;
    }
    const y = dcm > 0 ? vic.y + dcm / 100 : vicView.chest(out).y;
    out.set(vx - dx * 0.18, y, vz - dz * 0.18);
    this.fx.offset(out, 0, 0, 0.12, out);
    return s;
  }

  /** CHANGED(VIEW3D): the camera's screen-right as the FX basis (every frame; the cinematic frame during PRIME TIME) */
  private camBasis(): void {
    if (this.plan && this.lastCineActive) { this.fx.setBasis(this.cineF.rx, this.cineF.rz); return; }
    const b = this.cam.basis();
    this.fx.setBasis(b.rx, b.rz);
  }
  private lastCineActive = false;

  private queueHit(ev: ViewEvent, kind: HitKind, rank: number): void {
    const key = `${ev.frame}:${ev.a}:${ev.b}`;
    const cur = this.pendingHits.get(key);
    if (!cur || rank > cur.rank) this.pendingHits.set(key, { kind, rank, ev: cur && cur.ev.c > ev.c ? cur.ev : ev });
  }

  private events(m: ViewMatchSnap, f: [ViewFighterSnap, ViewFighterSnap], ev: ReadonlyArray<ViewEvent>): void {
    const F = this.fighters;
    const p = (i: number): ViewFighterSnap => f[i === 1 ? 1 : 0];
    const inCine = !!this.plan && !!m.cinematic && flagOn(m.cinematic.active);
    // CHANGED(fix_view) D7: the sim emits each goon's HIT / THROW / GOON_DOWN right before the SCORE it earns (brawl.ts
    // award); the last goon referenced (and every goon hit this frame, for a CROWD bonus) anchors the next SCORE popup
    let goonRef = -1;
    const swing: number[] = [];
    for (const e of ev) {
      const t = e.type;
      this.camBasis();
      if ((t === EV.HIT || t === EV.THROW || t === EV.PROJ_HIT) && e.b >= 8) { goonRef = e.b - 8; if (swing.indexOf(goonRef) < 0) swing.push(goonRef); }
      else if (t === EV.GOON_DOWN && e.a >= 8) goonRef = e.a - 8;
      if (t === EV.SUPER_HIT && inCine) {
        // PRIME TIME blows land on the victim's presentation body (the sim holds its x; the view carries it); the cinematic
        // line frame is the FX basis here, so the spray runs along the fight line in line space
        const vi = e.b === 1 ? 1 : 0;
        const vp = F[vi].root.position, ap = F[1 - vi].root.position;
        const dir = Math.sign(this.cineF.lx(vp.x, vp.z) - this.cineF.lx(ap.x, ap.z)) || 1;
        this.fx.setBasis(this.cineF.rx, this.cineF.rz);
        const at = this.fx.offset(F[vi].chest(this.tmp2), -dir * 0.12, 0, 0.12, this.tmp);
        // v2 data adds its own impact_* bursts on the blows, so the base spark stays medium there
        this.fx.hit('hit', this.plan!.v2 ? 1 : 3, at, dir);
        if ((m.cinematic?.frame ?? 0) <= this.metalUntil) this.fx.metalSparks(at, dir, 1.1);
        F[vi].flash(0.3, 0xffffff, 0.07);
        this.cam.addTrauma(0.22);
        continue;
      }
      if (t === EV.HIT || t === EV.SUPER_HIT || t === EV.PROJ_HIT) this.queueHit(e, 'hit', 0);
      else if (t === EV.COUNTER) this.queueHit(e, 'counter', 1);
      else if (t === EV.PUNISH) this.queueHit(e, 'punish', 2);
      else if (t === EV.THROW) this.queueHit({ ...e, c: 7 }, 'throw', 0);
      else if (t === EV.BLOCK) {
        const vic = p(e.b), att = p(e.a);
        const dir = this.hitPos(att, vic, F[e.b === 1 ? 1 : 0], e.d, this.tmp);
        this.fx.hit('block', e.c, this.tmp, dir);
        F[e.b === 1 ? 1 : 0].victim = true;
        this.cam.addTrauma(0.04);
      } else if (t === EV.PARRY || t === EV.PERFECT_PARRY) {
        const who = e.b === 1 ? 1 : 0;
        const dir = this.hitPos(p(e.a), p(who), F[who], e.d, this.tmp);
        const perfect = t === EV.PERFECT_PARRY;
        this.fx.hit(perfect ? 'perfect' : 'parry', e.c, this.tmp, dir);
        F[who].flash(perfect ? 0.6 : 0.35, 0xbfefff, perfect ? 0.3 : 0.12);
        if (perfect) { this.cam.perfectParry(m.frame, who); this.crowd?.popNow(0.5); }
      } else if (t === EV.THROW_TECH || t === EV.IMPACT_CLASH || t === EV.PROJ_CLASH) {
        this.camBasis();
        this.fx.offset(this.tmp2.set((f[0].x + f[1].x) / 2, 1.25, ((f[0].z ?? 0) + (f[1].z ?? 0)) / 2), 0, 0, 0.15, this.tmp);
        if (t !== EV.PROJ_CLASH) this.fx.hit('clash', 1, this.tmp, 1);
        this.cam.addTrauma(0.12);
      } else if (t === EV.WALL_SPLAT) {
        // CHANGED(VIEW3D) §35.13 item 7: a = victim, b = wall index + 256 x the INWARD normal (deg, yaw convention),
        // c / d = the contact point on the wall's inner face (cm). A legacy payload (b 0 / 1, no contact) -> the ring wall
        // nearest the victim.
        const vic = e.a === 1 ? 1 : 0;
        const w = this.wl4;
        if (e.b >= 256 || e.c !== 0 || e.d !== 0) {
          const nd = (e.b >> 8) * Math.PI / 180;
          w[0] = e.c / 100; w[1] = e.d / 100; w[2] = Math.sin(nd); w[3] = Math.cos(nd);
        } else ringWallAt(this.ring, f[vic].x, f[vic].z ?? 0, w);
        this.fx.wallSplat(w[0], w[1], w[2], w[3], F[vic].chest(this.tmp).y, ringSolidTop(this.ring), this.dustCol);
        this.lastSplat = { x: w[0], z: w[1], nx: w[2], nz: w[3], wall: e.b & 255, normalDeg: e.b >> 8, frame: e.frame };
        this.cam.addTrauma(0.35);
        this.crowd?.popNow(0.7);
      } else if (t === EV.GROUND_BOUNCE || t === EV.KNOCKDOWN || t === EV.CRUMPLE) {
        const who = e.a === 1 ? 1 : 0;
        this.camBasis();
        this.fx.dust(this.fx.offset(this.tmp2.set(f[who].x, 0.05, f[who].z ?? 0), 0, 0, 0.1, this.tmp), t === EV.GROUND_BOUNCE ? 1.3 : 0.9);
        if (t === EV.GROUND_BOUNCE) this.cam.addTrauma(0.2);
      } else if (t === EV.IMPACT_START) {
        const who = e.a === 1 ? 1 : 0;
        F[who].glow(0.45);
        this.fx.impactStart(F[who].chest(this.tmp));
      } else if (t === EV.IMPACT_ARMOR) {
        const who = e.a === 1 ? 1 : 0;
        F[who].glow(0.3);
        this.camBasis();
        this.fx.hit('armor', 5, F[who].chest(this.tmp), f[who].facing < 0 ? 1 : -1);
        this.cam.addTrauma(0.1);
      } else if (t === EV.SUPER_FREEZE) {
        const who = e.a === 1 ? 1 : 0;
        this.superAt = m.frame;
        this.superFrames = e.b >= 3 ? this.superFrames3 : this.superFrames1;
        this.cam.superFreeze(m.frame, who, this.superFrames);
        this.fx.superFlash(F[who].chest(this.tmp), e.b);
        F[who].flash(0.35, 0xfff2b0, 0.25);
        this.crowd?.popNow(0.6);
      } else if (t === EV.KO) {
        const loser = e.b === 0 || e.b === 1 ? e.b : 1;
        const winner = e.a === 0 || e.a === 1 ? e.a : 1 - loser;
        this.cam.ko(m.frame, winner, loser, e.c === 1);
        this.cam.addTrauma(CAM.trauma.KO);
        this.fx.koFinish(F[loser].chest(this.tmp), e.c === 1);
        F[loser].flash(0.8, 0xffffff, 0.2);
        this.crowd?.popNow(1.1);
      } else if (t === EV.STAGE_FRIGHT_ON) {
        F[e.a === 1 ? 1 : 0].flash(0.4, 0x6a7cff, 0.5);
      } else if (t === EV.TAUNT || t === EV.METER_BAR) {
        this.crowd?.popNow(0.25);
      } else if (t === EV.GOON_DOWN) {
        this.brawl?.goonDown(e.a >= 8 ? e.a - 8 : e.a);
        this.cam.addTrauma(0.2);
        this.crowd?.popNow(0.4);
      } else if (t === EV.SCORE) {
        // §28.4: d = reason (1 hit, 2 KO, 3 combo, 4 crowd hit, 5/6 parry, 7/8 heckle parry, 9 heckle hit)
        // CHANGED(fix_view) D7: each popup at its OWN event: a hit / KO over the goon it names, a crowd bonus over the
        // goons that swing hit, a combo / parry / heckle score over the player (was: every KO / crowd popup at the
        // last downed goon, every hit popup on the player's chest - they stacked at one anchor)
        let at: THREE.Vector3 | null = null;
        if (this.brawl && this.brawl.legacyPopups) this.brawl.score(e.b, e.a, e.d === 2 || e.d === 4 ? null : F[0].chest(this.tmp3), e.d, e.c);
        else if (this.brawl) {
          if ((e.d === 1 || e.d === 2) && goonRef >= 0 && this.brawl.goonChest(goonRef, this.tmp3)) at = this.tmp3;
          else if (e.d === 4 && swing.length) {
            let n = 0; this.tmp3.set(0, 0, 0);
            for (const k of swing) if (this.brawl.goonChest(k, this.tmp2)) { this.tmp3.add(this.tmp2); n++; }
            if (n) at = this.tmp3.multiplyScalar(1 / n);
          }
          if (!at) { F[0].chest(this.tmp3); this.tmp3.y = Math.max(this.tmp3.y, F[0].root.position.y + F[0].heightM * 0.85); at = this.tmp3; }
          this.brawl.score(e.b, e.a, at, e.d, e.c);
        }
      }
      if (t === EV.PROJ_HIT || t === EV.PROJ_CLASH) this.proj.onEvent(e);
    }
    // collapsed strikes: one burst per (frame, attacker, victim) of the strongest kind
    for (const { kind, ev: e } of this.pendingHits.values()) {
      if (e.b >= 8 && this.brawl) {
        // BRAWL: the player hit a goon (§28.4 fighter fields 8 + slot); the spray runs player -> goon (CHANGED(VIEW3D))
        if (this.brawl.goonChest(e.b - 8, this.tmp)) {
          let dx = this.tmp.x - f[0].x, dz = this.tmp.z - (f[0].z ?? 0);
          const l = Math.hypot(dx, dz) || 1;
          dx /= l; dz /= l;
          const b = this.cam.basis();
          const s = dx * b.rx + dz * b.rz >= 0 ? 1 : -1;
          this.fx.setBasis(s * dx, s * dz);
          this.tmp.x -= dx * 0.15; this.tmp.z -= dz * 0.15;
          this.fx.hit(kind, e.c, this.tmp, s);
          this.cam.addTrauma(TRAUMA_BY_STRENGTH[e.c] ?? 0.1);
        }
        continue;
      }
      const vi = e.b === 1 ? 1 : 0, ai = 1 - vi;
      const dir = this.hitPos(p(ai), p(vi), F[vi], e.d, this.tmp, e.c);
      this.fx.hit(kind, e.c, this.tmp, dir);
      F[vi].victim = true;
      F[vi].flash(kind === 'punish' ? 0.55 : kind === 'counter' ? 0.5 : 0.4,
        kind === 'punish' ? 0xffd400 : kind === 'counter' ? 0xff5a1f : 0xffffff, kind === 'hit' ? 0.07 : 0.14);
      const tr = kind === 'punish' || kind === 'counter' ? Math.max(CAM.trauma.PC, TRAUMA_BY_STRENGTH[e.c] ?? 0.1) : (TRAUMA_BY_STRENGTH[e.c] ?? 0.1);
      this.cam.addTrauma(tr);
      if (e.c >= 2) this.crowd?.popNow(0.2 + 0.1 * Math.min(3, e.c - 2));
    }
    this.pendingHits.clear();
    this.camBasis();
  }

  /** CHANGED(VIEW3D) read-back: the last WALL_SPLAT as the view placed it */
  lastSplat: { x: number; z: number; nx: number; nz: number; wall: number; normalDeg: number; frame: number } | null = null;

  // ───────────────────────────── PRIME TIME ─────────────────────────────

  private clipFacts(id: string): Record<string, ClipFact> { return clipFactsOf(this.data.clips?.[id]) as Record<string, ClipFact>; }

  /**
   * v2 PRIME TIME framing guard. The §26.1 numbers assume standing 1.80 m bodies at the authored gap (§26.5 scales lookH /
   * dist by height); a launched Bruno, a crouched flex or a victim flung wide still leaves the picture. Deterministic: it
   * reads only this frame's posed bodies (both online peers see the same shot). `top` shots are left alone.
   *   1. a `close` shot on ONE fighter follows a crouching subject down (camera and look translate together, 0.8 of the
   *      drop of the head below its standing height), so a bent-over flex is not framed on the crowd above it;
   *   2. the target's head top (airborne: also hands and feet) stays under the letterbox, and on `both` shots both bodies
   *      stay inside the frame sideways: dolly out along the view (<= 2.5 m), then widen the FOV (<= 60 deg).
   */
  private frameGuard(c: CinePose, ps: PrimeSample, att: 0 | 1): void {
    const G = this.guardLast;
    G.dolly = 0; G.fov = 0; G.crouch = 0;
    if (ps.shot === 'top') return;
    const A = this.fighters[att], V = this.fighters[1 - att];
    const tgt = ps.camTarget;
    const subj = tgt === 'attacker' ? [A] : tgt === 'defender' ? [V] : [A, V];
    if (ps.shot === 'close' && subj.length === 1) {
      const f = subj[0];
      const dy = 0.8 * Math.min(0, f.headY() - (f.root.position.y + f.heightM));
      c.pos.y += dy; c.look.y += dy; G.crouch = dy;
    }
    const aspect = this.r.css.x / Math.max(1, this.r.css.y);
    const v = this.gV.subVectors(c.look, c.pos);
    if (v.lengthSq() < 1e-6) return;
    v.normalize();
    const u = this.gU.set(0, 1, 0).addScaledVector(v, -v.y);
    if (u.lengthSq() < 1e-4) return;
    u.normalize();
    const rgt = this.gR.crossVectors(v, u);
    // CHANGED(VIEW3D): the guard points in world 3D (roots at their x / z; the side points along the shot's own right)
    const pts = this.gPts;
    pts.length = 0;
    for (const f of subj) {
      const p = f.root.position;
      pts.push([p.x, f.headY(), p.z, 0]);
      if (p.y > 0.25) {
        pts.push([p.x, f.topY(), p.z, 0]);
        for (const b of ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase']) if (f.bonePos(b, this.gD)) pts.push([this.gD.x, this.gD.y + 0.08, this.gD.z, 0]);
      }
    }
    if (subj.length === 2) for (const f of subj) {
      const ch = f.chest(this.gD);
      const cx = ch.x, cy = ch.y, cz = ch.z;
      pts.push([cx - rgt.x * 0.35, cy, cz - rgt.z * 0.35, 1], [cx + rgt.x * 0.35, cy, cz + rgt.z * 0.35, 1]);
    }
    const tv = Math.tan((c.fov * Math.PI / 180) / 2);
    const allowY = tv * Math.max(0.3, 1 - 2 * ps.letterbox) * 0.94, allowX = tv * aspect * 0.93;
    const need = (): [number, number] => {           // [dolly needed, worst ratio]
      let s = 0, q = 0;
      for (const [x, y, z, ax] of pts) {
        const d = this.gD.set(x - c.pos.x, y - c.pos.y, z - c.pos.z);
        const depth = d.dot(v);
        if (depth < 0.2) continue;
        const off = ax === 0 ? d.dot(u) : Math.abs(d.dot(rgt));
        if (off <= 0) continue;
        const al = ax === 0 ? allowY : allowX;
        s = Math.max(s, off / al - depth); q = Math.max(q, off / depth / al);
      }
      return [s, q];
    };
    const [s0] = need();
    const s = Math.min(2.5, s0);
    if (s > 0.005) {
      // (the ring / clear-radius limits are the camera's occlusion step - camera.ts constrain - after this guard)
      c.pos.addScaledVector(v, -s);
      c.pos.y = Math.max(0.12, c.pos.y);
      G.dolly = Math.round(s * 1000) / 1000;
    }
    const [, q] = need();
    if (q > 1.001) {
      const fov = Math.min(60, 2 * Math.atan(tv * q) * 180 / Math.PI);
      if (fov > c.fov) { G.fov = Math.round((fov - c.fov) * 100) / 100; c.fov = fov; }
    }
  }

  /**
   * CHANGED(VIEW3D): freeze the PRIME TIME line frame. Origin = the attacker's root; forward f = toward the victim (the
   * attacker's yaw when they overlap); R = facing x f with facing chosen so N = (-R.z, R.x) is on the sim camera's side -
   * unless that side is cramped (< 3.2 m from the pair midpoint to the ring along N) and the other side has >= 0.8 m more
   * room: then the cinematic films from the roomier side (a hard cut either way).
   */
  private setCineFrame(snaps: readonly [ViewFighterSnap, ViewFighterSnap], who: 0 | 1, camN: ReadonlyArray<number> | undefined): void {
    const sa = snaps[who], sv = snaps[1 - who];
    const ax = sa.x, az = sa.z ?? 0, vx = sv.x, vz = sv.z ?? 0;
    let fx = vx - ax, fz = vz - az;
    let l = Math.hypot(fx, fz);
    if (l < 0.05) {
      const yw = typeof sa.yaw === 'number' ? sa.yaw : (sa.facing < 0 ? -1 : 1) * Math.PI / 2;
      fx = Math.sin(yw); fz = Math.cos(yw); l = 1;
    }
    fx /= l; fz /= l;
    const cnx = camN && camN.length >= 2 ? Number(camN[0]) : 0, cnz = camN && camN.length >= 2 ? Number(camN[1]) : 1;
    // facing +1: R = f, N = (-f.z, f.x)
    let facing = (-fz * cnx + fx * cnz) >= 0 ? 1 : -1;
    const mx = (ax + vx) / 2, mz = (az + vz) / 2;
    const nX = -fz * facing, nZ = fx * facing;
    const room = ringRay(this.ring, mx, mz, nX, nZ), roomBack = ringRay(this.ring, mx, mz, -nX, -nZ);
    this.cineFlip = room < 3.2 && roomBack > room + 0.8;
    if (this.cineFlip) facing = -facing;
    this.cineF.fromR(ax, az, facing * fx, facing * fz);
    this.cineFacing = facing;
  }

  /** CHANGED(fix_view) G9 read-back: the last cinematic start's cost split (ms) */
  primeCost = { plan: 0, crowd: 0, slate: 0, total: 0 };

  /** compile (or reuse) the plan for the running cinematic */
  private primeBegin(snaps: [ViewFighterSnap, ViewFighterSnap], who: 0 | 1, moveIdx: number, simFrames: number, simVictim: boolean, camN?: ReadonlyArray<number>): void {
    const pt0 = performance.now();
    const id = this.cfg.p[who]?.fighter ?? '';
    const def = this.data.fighters[id];
    const mk = def ? moveKeys(def)[moveIdx] ?? '' : '';
    const mv = def?.moves[mk];
    const frames = simFrames > 0 ? simFrames : mv?.cinematic?.frames ?? 150;
    const c: CineDef = mv?.cinematic ? { ...mv.cinematic, frames } as CineDef : { frames };
    const A = this.fighters[who], V = this.fighters[1 - who];
    const sa = snaps[who], sv = snaps[1 - who];
    const pre = (fv: FighterView, s: ViewFighterSnap): { clip: string; t: number } | null => {
      const e = s.animId >= 0 && s.animId < fv.table.length ? fv.table[s.animId] : null;
      if (!e || !fv.pose.has(e.clip)) return null;
      return { clip: e.clip, t: animSeconds(e, s.animFrame, fv.pose.dur(e.clip)) };
    };
    this.setCineFrame(snaps, who, camN);
    const F = this.cineF;
    const facing = this.cineFacing;
    // the room ahead of the attacker along its forward (facing x R): the victim's root stops 0.45 m short of the ring wall
    const wallDist = ringRay(this.ring, F.ox, F.oz, facing * F.rx, facing * F.rz) - 0.45;
    this.plan = compilePlan({
      def: c, moveKey: mk, moveName: mv?.name ?? mk, fighterName: def?.name ?? id,
      attFacts: this.clipFacts(id), vicFacts: this.clipFacts(this.cfg.p[1 - who]?.fighter ?? ''),
      attDur: (clip) => A.pose.has(clip) ? A.pose.dur(clip) : 0, vicDur: (clip) => V.pose.has(clip) ? V.pose.dur(clip) : 0,
      gap0: Math.hypot(sv.x - sa.x, (sv.z ?? 0) - (sa.z ?? 0)), ax: 0, facing, attPre: pre(A, sa), vicPre: pre(V, sv), hA: A.heightM, hV: V.heightM, simVictim,
      // a riot shield held in front adds its thickness + standoff to the body front (Krane's bash met Bruno INSIDE the shield)
      frontA: pushFront(def) + (A.propInfo().some((q) => /shield/.test(q.id)) ? 0.2 : 0),
      frontV: pushFront(this.data.fighters[this.cfg.p[1 - who]?.fighter ?? '']) + (V.propInfo().some((q) => /shield/.test(q.id)) ? 0.2 : 0),
      wallDist,
    });
    const pt1 = performance.now();
    this.planKey = `${who}:${moveIdx}:${simVictim ? 'grab' : 'cin'}`;
    this.planAtt = who;
    this.firedUpTo = -1;
    this.metalUntil = -1;
    this.outro = null;
    // the stage-magic props live in line space: their group carries the frame
    F.applyTo(this.primeProps.group);
    // the crowd the crowd_pop shot turns to: the stands behind the action (line space: beyond the fight line from the camera)
    // CHANGED(fix_view) G9: the crowd slots' world positions are cached once per match (the stage never moves): calling
    // getWorldPosition on each slot re-walked its parent chain (updateWorldMatrix) - with control_room's slots that was
    // most of a 26 ms PRIME TIME start frame
    const cp = this.crowdPts();
    let n = 0, cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < cp.length; k += 3) {
      this.tmp.set(cp[k], cp[k + 1], cp[k + 2]);
      F.toLocal(this.tmp, this.tmp);
      if (this.tmp.z > -2.5 || Math.abs(this.tmp.x) > 6.5) continue;
      cx += this.tmp.x; cy += this.tmp.y; cz += this.tmp.z; n++;
    }
    this.crowdFocus = n ? [(cx / n) * facing, cy / n + 1.2, cz / n] : null;
    const pt2 = performance.now();
    // the name slate
    const tag = this.data.strings?.['hud.combo.prime'] ?? 'PRIME TIME';
    const [line, who2] = slateParts(this.plan.slate, tag, this.plan.moveName, this.plan.fighterName);
    const key = `${tag}|${line}|${who2}`;
    if (key !== this.slateKey) {
      paintSlate(this.slateCanvas, tag, line.toUpperCase(), who2.toUpperCase());
      this.slateTex.needsUpdate = true;
      this.slateKey = key;
    }
    const pt3 = performance.now();
    const r2 = (v: number) => Math.round(v * 100) / 100;
    this.primeCost = { plan: r2(pt1 - pt0), crowd: r2(pt2 - pt1), slate: r2(pt3 - pt2), total: r2(pt3 - pt0) };
  }

  /** CHANGED(fix_view) G9: the stage's crowd slot world positions, packed xyz, computed once */
  private crowdCache: Float32Array | null = null;
  private crowdPts(): Float32Array {
    if (this.crowdCache) return this.crowdCache;
    const c = this.stage.crowd;
    const out = new Float32Array(c.length * 3);
    this.stage.group.updateMatrixWorld(true);
    for (let k = 0; k < c.length; k++) {
      const e = c[k].matrixWorld.elements;
      out[k * 3] = e[12]; out[k * 3 + 1] = e[13]; out[k * 3 + 2] = e[14];
    }
    this.crowdCache = out;
    return out;
  }

  private anchor(fv: FighterView, name: string, out: THREE.Vector3): boolean {
    switch (name) {
      case 'aFootR': case 'vFootR': return fv.bonePos('RightToeBase', out) || fv.bonePos('RightFoot', out);
      case 'aFootL': case 'vFootL': return fv.bonePos('LeftToeBase', out) || fv.bonePos('LeftFoot', out);
      case 'aHead': case 'vHead': if (!fv.bonePos('Head', out)) return false; out.y += 0.14; return true;
      case 'aHand': return fv.bonePos('RightHand', out);
      case 'vChest': fv.chest(out); return true;
      default: return false;
    }
  }

  /** the FighterView a beat's `target` names (attacker | defender | both -> defender for body FX) */
  private tgt(target: string, att: number, dflt: 'att' | 'vic'): FighterView {
    const who = target === 'attacker' ? att : target === 'defender' || target === 'both' ? 1 - att : dflt === 'att' ? att : 1 - att;
    return this.fighters[who];
  }

  /** CHANGED(VIEW3D): `ax` / `vx` are LINE-SPACE x (the cinematic frame); W() maps a line-space point to world */
  private primeBeat(name: string, dur: number, fStart: number, target: string, amount: number, att: number, ax: number, facing: number, vx: number): void {
    const A = this.fighters[att], V = this.fighters[1 - att];
    const T = this.tgt(target, att, 'vic');
    const t = this.tmp2;
    const dir = facing;
    const F = this.cineF;
    const W = (lx: number, y: number, lz: number): THREE.Vector3 => F.toWorld(lx, y, lz, t);
    switch (name) {
      // v2 body FX (CONTRACT §26.1 vocabulary) - extra bursts on top of the sim's SUPER_HIT sparks
      case 'impact_s': case 'impact_m': case 'impact_l': {
        // an extra comic burst on the target (no screen flash / lines: the data asks for those with its own beats)
        const k = name === 'impact_s' ? 0.55 : name === 'impact_m' ? 0.75 : 1.0;
        this.fx.offset(T.chest(this.tmp3), -dir * 0.1, 0, 0.12, t);
        this.fx.impactBurst(t, dir, k);
        break;
      }
      case 'splat': this.fx.splatter(T.chest(t), dir, 1.4); break;
      case 'sparks': this.fx.metalSparks(T.chest(t), dir, 1.2); break;
      case 'smoke': this.fx.smokePuff(T.chest(t), 1.1); break;
      case 'cards': this.fx.cards(T.chest(t), 16); break;
      case 'shake_s': this.cam.addTrauma(0.10); break;
      case 'shake_m': this.cam.addTrauma(0.20); break;
      case 'shake_l': this.cam.addTrauma(0.35); break;
      case 'zoomlines': this.fx.speedLines(this.tgt(target, att, 'att').chest(t), 1.1, 0xffffff, 0.35, 2, 0.12); break;
      case 'freeze': this.crowd?.popNow(0.3); break;
      case 'ball_trail': break;                             // continuous (ball fire window)
      // shared names (v1 per-cue defaults + v2 mapped names)
      case 'speedlines': this.fx.speedLines(this.tgt(target, att, 'vic').chest(t), 0.9, 0xffffff, 0.12, 3, 0.22); break;
      case 'speedlines_att': this.fx.speedLines(A.chest(t), 0.9, 0xfff2b0, 0.16, 3, 0.24); break;
      case 'slam': this.fx.slam(W(vx, 0, 0.05), 1.25); this.cam.addTrauma(0.55); this.crowd?.popNow(0.5); break;
      case 'slam_trap': this.fx.slam(W(ax + facing * 0.45, 0, 0.05), 1.0); this.cam.addTrauma(0.45); break;
      case 'flash': this.fx.screenFlash(0.42, 0xffffff, 0.03); break;
      case 'crowd': this.crowd?.popNow(1.2 * amount); break;
      case 'confetti': this.fx.confettiRain(W(ax + facing * 1.0, 0, 0), 8, 110); break;
      case 'confetti_big': this.fx.confettiRain(W(ax + facing * 1.0, 0, 0), 13, 240); break;
      case 'glow': A.glow(Math.max(0.2, dur / 60)); this.fx.shockwave(A.chest(t), 0.8, 0xffd65a); break;
      case 'metal': this.metalUntil = fStart + Math.max(1, dur); break;
      case 'doves': this.fx.doves(target ? T.chest(t) : W(vx, 1.1, 0.1), 12); break;
      case 'cards_vic': this.fx.cards(W(vx, 1.2, 0.1), 16); break;
      case 'sparkle_vic': this.fx.sparkle(V.chest(t), 18); break;
      case 'fire_burst': this.fx.fireBurst(T.chest(t), 1.15); this.cam.addTrauma(0.3); break;
      case 'fire_burst_floor': { this.fx.fireBurst(W(vx, 0.45, 0.1), 1.25); const q = W(vx, 0, 0.1); this.fx.fireColumn(q.x, q.z, 1.6, 1 / 20, 1.5); break; }
      case 'smoke_att': this.fx.smokePuff(this.fx.offset(this.tmp3.set(A.root.position.x, 0, A.root.position.z), 0, 1.0, 0.1, t), 1.3); break;
      case 'smoke_high': this.fx.smokePuff(W(vx, 3.9, 0), 1.2); break;
      case 'shockwave': this.fx.shockwave(this.tgt(target, att, 'att').chest(t), 1.2); this.cam.addTrauma(0.3); break;
      case 'shockwave_vic': this.fx.shockwave(V.chest(t), 1.0, 0x9ad8ff); break;
      case 'lights_flicker': this.stage.flicker(Math.max(0.2, (dur || 30) / 60)); break;
      case 'sparks_rain': this.fx.sparkShower(W(vx, 5.2, 0), 2.5, 90); this.cam.addTrauma(0.3); break;
      case 'dust': this.fx.dust(target ? this.fx.offset(this.tmp3.set(T.root.position.x, 0.1, T.root.position.z), 0, 0, 0.1, t) : W(vx, 0.1, 0.1), 1.3); break;
      case 'taser': this.fx.electric(T.chest(t), 1.2); break;
      case 'wall_splat': {
        // the ring wall straight ahead of the attacker (the line the v1 path flings the victim along)
        const d = ringRay(this.ring, F.ox, F.oz, facing * F.rx, facing * F.rz);
        const w = ringWallAt(this.ring, F.ox + facing * F.rx * d, F.oz + facing * F.rz * d, this.wl4);
        this.fx.wallSplat(w[0], w[1], w[2], w[3], 1.1, ringSolidTop(this.ring), this.dustCol);
        this.cam.addTrauma(0.5); this.crowd?.popNow(0.8);
        break;
      }
      default: break;                                      // continuous / plan-level names (spot, dim, letterbox, slate, pyro, flame_jet ...)
    }
  }

  private primeContinuous(p: PrimePlan, f: number, att: number, ax: number, facing: number, dt: number): void {
    const A = this.fighters[att], V = this.fighters[1 - att];
    for (const b of p.beats) {
      if (!(b.dur > 0) || f < b.f || f >= b.f + b.dur) continue;
      const T = this.tgt(b.target, att, b.name === 'smear' ? 'att' : 'vic');
      switch (b.name) {
        case 'dust_spin':
          if ((f & 1) === 0) {
            A.bonePos('Hips', this.tmp3);
            const a = f * 0.9;
            this.tmp3.y = 0.08;
            this.fx.offset(this.tmp3, Math.cos(a) * 0.45, 0, Math.sin(a) * 0.35, this.tmp2);
            this.fx.trail(this.tmp2, this.tmp.set(Math.cos(a) * 1.6, 0.4, Math.sin(a) * 0.8), 0.35, 0x9b8f86, 10, 0.6, false, 2.2, -0.3, 2.5, 0.45);
          }
          break;
        case 'taser': {
          if (!b.target) { if (!A.bonePos('LeftHand', this.tmp3)) A.chest(this.tmp3); }
          else { T.bonePos((f & 4) ? 'LeftHand' : 'RightFoot', this.tmp3); }
          T.chest(this.tmp2);
          this.fx.arc(this.tmp3, this.tmp2, 1.4);
          if (f % 2 === 0) T.flash(0.55, (f & 2) ? 0xcfeeff : 0x6ab8ff, 0.05);
          if (f % 6 === 0) this.fx.electric(this.tmp2, 0.8);
          break;
        }
        case 'jolt': if (f % 2 === 0) V.flash(0.55, (f & 2) ? 0xcfeeff : 0x6ab8ff, 0.05); break;
        case 'flame_jet': {
          if (!A.bonePos('RightHand', this.tmp3)) A.chest(this.tmp3);
          const len = Math.max(0.8, Math.hypot(V.root.position.x - this.tmp3.x, V.root.position.z - this.tmp3.z) + 0.7);
          this.fx.flameJet(this.tmp3, facing, len, 1.4, dt);
          break;
        }
        case 'pyro':
          for (const dx of [-4.8, -2.6, 2.6, 4.8]) {
            const q = this.cineF.toWorld(ax + dx, 0, -1.4, this.tmp2);
            ringClamp(this.ring, q.x, q.z, 0.3, this.cl2);
            this.fx.fireColumn(this.cl2[0], this.cl2[1], 2.2, dt, 1.2);
          }
          if (f % 12 === 0) this.cam.addTrauma(0.08);
          break;
        case 'smear': {
          // motion smear on the target's fastest limb (~8 f): stretched streaks from that limb's travel
          const bones = ['RightHand', 'LeftHand', 'RightFoot', 'LeftFoot'];
          let best = -1, bd = 0;
          for (let k = 0; k < 4; k++) {
            if (!T.bonePos(bones[k], this.tmp)) continue;
            const d = this.tmp.distanceTo(this.smearPrev[k]);
            if (d > bd && d < 1.5) { bd = d; best = k; }
            this.smearPrev[k].copy(this.tmp);
          }
          if (best >= 0 && bd > 0.02) {
            T.bonePos(bones[best], this.tmp2);
            for (let k = 0; k < 3; k++) this.fx.trail(this.tmp2, this.tmp.set(this.fx.rr(-0.3, 0.3), this.fx.rr(-0.3, 0.3), 0), 0.22, 0xffffff, 2, 0.08, true, 0.4, 0, 1, 0.6);
          }
          break;
        }
        default: break;
      }
    }
  }

  /** a landed grab super (bruno) runs as a grab lock: the cinematic block plays from the attacker's lock frame (§26.1) */
  private grabLock(snaps: [ViewFighterSnap, ViewFighterSnap]): { who: 0 | 1; moveIdx: number; frame: number; frames: number } | null {
    for (let i = 0; i < 2; i++) {
      const fv = this.fighters[i], s = snaps[i];
      const e = s.animId >= 0 && s.animId < fv.table.length ? fv.table[s.animId] : null;
      if (!e || e.moveId < 0) continue;
      const def = this.data.fighters[this.cfg.p[i]?.fighter ?? ''];
      const keys = moveKeys(def);
      if (s.animId < 34 + keys.length) continue;           // the ordinary move entry, not the §19.10 grab entry
      const mv = def?.moves[keys[e.moveId]] as { cinematic?: { frames: number }; grab?: unknown } | undefined;
      if (!mv?.cinematic || !mv.grab) continue;
      return { who: i === 1 ? 1 : 0, moveIdx: e.moveId, frame: s.animFrame, frames: mv.cinematic.frames };
    }
    return null;
  }

  /** once per rendered frame; `ev` = NEW (deduped) events; `dtReal` = real seconds since the last frame */
  frame(m: ViewMatchSnap, f: readonly [ViewFighterSnap, ViewFighterSnap], ev: ReadonlyArray<ViewEvent>, dtReal: number): void {
    const dt = Math.min(0.1, Math.max(0, dtReal));
    this.lastDt = dt;
    this.realTime += dt;
    const snaps: [ViewFighterSnap, ViewFighterSnap] = [f[0], f[1]];
    this.lastSnaps = snaps;
    const ts = flagOn(m.slowmo) ? 0.25 : 1;
    if (m.round !== undefined && m.round !== this.lastRound) {
      if (this.lastRound !== -1) { this.cam.clearKo(); this.cam.setCinematic(null); this.plan = null; this.outro = null; }
      this.lastRound = m.round;
      for (const fv of this.fighters) fv.turn.reset();          // CHANGED(fix_view) D2: a new round re-spawns: no turn
    }
    // CHANGED(fix_view) D2: the presented yaw advances per SIM frame
    for (const fv of this.fighters) fv.simFrame = Number.isFinite(m.frame) ? m.frame : -1;
    // CHANGED(VIEW3D): the sim's ring (constant per match) + its camera normal for this frame
    if (m.ring && !this.ringFromSim) {
      this.ring = ringFrom(m.ring, stageDef(this.data, this.cfg.stage));
      this.cam.ring = this.ring;
      this.ringFromSim = true;
    }
    this.cam.camN = m.camN && m.camN.length >= 2 ? [Number(m.camN[0]), Number(m.camN[1])] : null;
    const fs = this.fsplit, now = (): number => performance.now();
    let ft = now();
    // 1. PRIME TIME sample (pure function of the cinematic frame / the grab super's lock frame)
    const cin = m.cinematic;
    const simCine = !!cin && flagOn(cin.active);
    const lock = simCine ? null : this.grabLock(snaps);
    const active = simCine || !!lock;
    let ps: PrimeSample | null = null;
    let att: 0 | 1 = 0;
    const F = this.cineF;
    if (active) {
      att = simCine ? (cin!.fighter === 1 ? 1 : 0) : lock!.who;
      const moveIdx = simCine ? cin!.cueId : lock!.moveIdx;
      const cf = simCine ? cin!.frame : lock!.frame;
      const key = `${att}:${moveIdx}:${simCine ? 'cin' : 'grab'}`;
      // a rollback that rewinds back into the same cinematic (<= 8 frames) resumes the plan (beats already fired stay
      // fired); a NEW cinematic (another move, or the same one restarting from frame 0) compiles a fresh plan
      if (this.outro && this.plan && this.planKey === key && cf + 20 >= this.lastCineFrame) this.outro = null;
      else if (!this.plan || this.planKey !== key || cf + 20 < this.lastCineFrame || this.outro) {
        this.primeBegin(snaps, att, moveIdx, simCine ? cin!.frames ?? 0 : lock!.frames, !simCine, m.camN);
      }
      const facing = this.cineFacing;
      const sv = snaps[1 - att];
      // line space: the attacker at x 0 (the frame origin), the sim's victim (grab supers) at its line x
      ps = samplePlan(this.plan!, cf, this.settings.cinematicCamera === 'short', this.crowdFocus, 0, facing,
        this.plan!.simVictim ? F.lx(sv.x, sv.z ?? 0) : null, this.ps, this.psScratch);
      this.lastCineFrame = cf;
    } else if (this.plan && !this.outro) {
      // the cinematic just ended: blend the last cinematic pose into the sim's for OUTRO_FRAMES
      const a = this.planAtt;
      this.outro = { at: m.frame, att: a, lists: [[], []], pos: [[0, 0, 0], [0, 0, 0]] };
      for (let i = 0; i < 2; i++) {
        const src = i === a ? this.ps.att : this.plan.simVictim ? [] : this.ps.vic;
        this.outro.lists[i] = src.map((e) => ({ ...e }));
        const rp = this.fighters[i].root.position;
        this.outro.pos[i] = [rp.x, rp.y, rp.z];
      }
    }
    this.lastCineActive = !!ps;
    this.camBasis();
    // the fighters' presentation depth offset runs toward the camera
    { const b = this.cam.basis(); for (const fv of this.fighters) fv.towardCam.set(b.nx, 0, b.nz); }
    fs.prime = now() - ft; ft = now();
    // 2. fighters (cinematic overrides / outro blend / plain snapshot)
    const hideP2 = this.cfg.mode === 'brawl' || this.cfg.mode === 'heckler';
    const ovA = this.ov[0], ovB = this.ov[1];
    for (const o of this.ov) { o.list = undefined; o.blend = undefined; o.x = undefined; o.y = undefined; o.z = undefined; o.yaw = undefined; o.facing = undefined; o.visible = undefined; o.inCinematic = undefined; }
    if (ps && this.plan) {
      const vic = 1 - att;
      const sa = snaps[att];
      const facing = this.cineFacing;
      const oa = att === 0 ? ovA : ovB, ob = att === 0 ? ovB : ovA;
      this.fighters[0].zTarget = 0; this.fighters[1].zTarget = 0;
      // line space -> world, kept inside the ring (the 1D view clamped x to +-7.55)
      const place = (o: typeof oa, lx: number, lz: number) => {
        const w = F.toWorld(lx, 0, lz, this.tmp3);
        ringClamp(this.ring, w.x, w.z, 0.3, this.cl2);
        o.x = this.cl2[0]; o.z = this.cl2[1];
      };
      oa.list = ps.att; oa.facing = facing; oa.visible = ps.attVisible; oa.inCinematic = true;
      if (!this.plan.simVictim) { place(oa, facing * ps.attDx, 0); oa.y = Math.max(-2.2, ps.attY); oa.yaw = F.yawAlong(facing); }
      this.fighters[att].update(sa, dt, this.realTime, oa);
      if (!this.plan.simVictim) {
        let vx = facing * (ps.attDx + ps.vicGap), vz = 0, vy = ps.vicY;
        let yaw = F.yawAlong(-facing);
        if (ps.carryBlend > 0) {
          // carried at the attacker's chest (line space: x AND z, so a spinning carrier swings the victim round with him)
          const A = this.fighters[att];
          A.chest(this.tmp); A.forward(this.tmp2);
          this.tmp.x += this.tmp2.x * 0.3; this.tmp.z += this.tmp2.z * 0.3;
          const cxv = F.lx(this.tmp.x, this.tmp.z), czv = F.lz(this.tmp.x, this.tmp.z);
          const cyv = Math.max(0, this.tmp.y - 0.72 * this.plan.hV + 0.1) + (ps.carry === 2 ? 0.45 : 0);
          vx += (cxv - vx) * ps.carryBlend; vz += (czv - vz) * ps.carryBlend; vy += (cyv - vy) * ps.carryBlend;
          if (ps.carry) yaw = Math.atan2(-this.tmp2.x, -this.tmp2.z);
        }
        place(ob, vx, vz);
        ob.list = ps.vic; ob.y = vy; ob.yaw = yaw; ob.facing = -facing; ob.visible = ps.vicVisible; ob.inCinematic = true;
      }
      this.fighters[vic].update(snaps[vic], dt, this.realTime, this.plan.simVictim ? null : ob);
    } else {
      const o = this.outro;
      const k = o ? smooth((m.frame - o.at) / OUTRO_FRAMES) : 1;
      if (o && k >= 1) { this.outro = null; this.plan = null; }
      for (let i = 0; i < 2; i++) {
        const fv = this.fighters[i];
        // CHANGED(fixer) D3: a side-swap throw victim (thrown_b, then its face-down landing) passes in FRONT of the thrower
        const e = snaps[i].animId >= 0 ? fv.table[snaps[i].animId] : undefined;
        const swapPose = !!e && (e.clip === 'thrown_b' || (fv.zTarget > 0 && e.clip === 'kd_ground_f'));
        const dx = Math.hypot(snaps[i].x - snaps[1 - i].x, (snaps[i].z ?? 0) - (snaps[1 - i].z ?? 0));
        fv.zTarget = swapPose ? 0.55 * Math.max(0, Math.min(1, 1.6 - dx)) : 0;
        const ov = this.ov[i];
        if (o && k < 1 && o.lists[i].length) {
          ov.blend = { list: o.lists[i], w: 1 - k };
          ov.x = o.pos[i][0] + (snaps[i].x - o.pos[i][0]) * k;
          ov.y = o.pos[i][1] + (snaps[i].y - o.pos[i][1]) * k;
          ov.z = o.pos[i][2] + ((snaps[i].z ?? 0) - o.pos[i][2]) * k;
        }
        if (hideP2 && i === 1) ov.visible = false;
        if (snaps[i].absent) ov.visible = false;
        fv.update(snaps[i], dt, this.realTime, ov);
      }
    }
    fs.fighters = now() - ft; ft = now();
    // 3. events (after posing: FX sit on the current bones)
    if (ev.length) this.events(m, snaps, ev);
    fs.events = now() - ft; ft = now();
    // 4. PRIME TIME beats, continuous FX, props (line space)
    this.cineTs = ps ? ps.ts : 1;
    if (ps && this.plan) {
      const p = this.plan;
      const facing = this.cineFacing;
      const vp = this.fighters[1 - att].root.position;
      const vx = F.lx(vp.x, vp.z);
      for (const b of p.beats) if (b.f > this.firedUpTo && b.f <= ps.f) this.primeBeat(b.name, b.dur, b.f, b.target, b.amount, att, 0, facing, vx);
      this.firedUpTo = Math.max(this.firedUpTo, ps.f);
      if (!ps.freeze) this.primeContinuous(p, ps.f, att, 0, facing, dt * ps.ts);
      const A = this.fighters[att], V = this.fighters[1 - att];
      // the props group carries the line frame: bone anchors come back in line space
      propsAt(p, p.eff[ps.f], ps, 0, facing, this.primeProps,
        (name, out) => { const ok = name.startsWith('v') ? this.anchor(V, name, out) : this.anchor(A, name, out); if (ok) F.toLocal(out, out); return ok; }, this.tmp, this.tmp2);
      const fireOn = (p.tweak.ballFire && ps.f >= p.tweak.ballFire[0] && ps.f < p.tweak.ballFire[1])
        || p.beats.some((b) => b.name === 'ball_trail' && ps!.f >= b.f && ps!.f < b.f + b.dur);
      if (fireOn && this.primeProps.ball.visible && !ps.freeze) {
        const bp = this.primeProps.ball.getWorldPosition(this.tmp3);
        for (let k = 0; k < 3; k++) this.fx.trail(bp, this.tmp.set(-facing * this.fx.rr(1, 2.5), this.fx.rr(0.2, 1), this.fx.rr(-0.3, 0.3)), this.fx.rr(0.16, 0.28), k ? 0xff6a10 : 0xffdc70, 16, 0.3, true, 2.4, -1.5, 2.2, 0.85);
      }
    } else this.primeProps.hideAll();
    fs.beats = now() - ft; ft = now();
    // 5. camera
    if (ps && this.plan) {
      const facing = this.cineFacing;
      const L = ps.cam;
      const c: CinePose = this.cine;
      c.free = false;
      // line space (attacker at x 0) -> world through the cinematic frame
      if (ps.camLocal) {
        F.toWorld(facing * L.pos.x, L.pos.y, L.pos.z, c.pos);
        F.toWorld(facing * L.look.x, L.look.y, L.look.z, c.look);
      } else {
        F.toWorld(L.pos.x, L.pos.y, L.pos.z, c.pos);
        F.toWorld(L.look.x, L.look.y, L.look.z, c.look);
      }
      c.roll = L.roll * facing;
      c.fov = L.fov;
      if (!ps.camLocal) this.frameGuard(c, ps, att);
      else this.guardLast.dolly = this.guardLast.fov = this.guardLast.crouch = 0;
      c.pos.y = Math.max(0.12, c.pos.y);
      this.cam.setCinematic(c);
      if (ps.freeze) this.cam.trauma = 0;
    } else if (simCine && !this.plan) {
      const who = cin!.fighter === 1 ? 1 : 0;
      const id = this.cfg.p[who]?.fighter ?? '';
      const def = this.data.fighters[id];
      const mv = def ? def.moves[moveKeys(def)[cin!.cueId] ?? ''] : undefined;
      this.setCineFrame(snaps, who, m.camN);
      const c = sampleTrack(trackFor(mv?.cinematic?.cue), cin!.frame, cin!.frames ?? 150, 0, this.cineFacing, this.settings.cinematicCamera === 'short', this.cine);
      F.toWorld(c.pos.x, c.pos.y, c.pos.z, c.pos); F.toWorld(c.look.x, c.look.y, c.look.z, c.look);
      c.free = false;
      this.cam.setCinematic(c);
    } else this.cam.setCinematic(null);
    // background dim: super freeze (strong), cinematic (per shot), spotlight
    const inSuper = m.frame - this.superAt < this.superFrames || (flagOn(m.freeze) && m.frame - this.superAt < this.superFrames * 3);
    this.fx.dimTarget = ps ? ps.dim : inSuper ? 0.62 : active ? 0.3 : 0;
    this.fx.spotTarget = ps ? ps.spot : 0;
    if (ps) { const sp = this.fighters[ps.spotOnVictim ? 1 - att : att].root.position; this.fx.spotX = sp.x; this.fx.spotZ = sp.z; }
    this.post.setLetterbox(ps ? ps.letterbox : 0);
    this.post.setBorder(ps ? ps.freeze : 0);
    if (ps && ps.slate > 0 && this.plan) {
      const slide = Math.min(1, Math.max(0, (ps.f - this.plan.slateAt) / 10));
      const e = 1 - (1 - slide) * (1 - slide) * (1 - slide);
      this.post.setSlate(this.slateTex, -0.42 + 0.455 * e, 0.125, 0.42, 0.105, ps.slate);
    } else this.post.setSlate(null, 0, 0, 0, 0, 0);
    // camera fighters: the pair, or in BRAWL the player + the goons in reach
    for (let i = 0; i < 2; i++) {
      const c = this.camF[i];
      // CHANGED(fixer) D4: an airborne fighter's top includes raised hands (grounded: the head only, so an uppercut's fist
      // does not bob the camera)
      // CHANGED(fix_view) D13: never below the body's measured neutral top (head + a raised limb: THE FREAK's claw)
      const air = snaps[i].y > 0.02;
      c.x = snaps[i].x; c.y = snaps[i].y; c.z = snaps[i].z ?? 0;
      c.head = this.realTops ? this.fighters[i].camTop(air) : air ? this.fighters[i].topY() : this.fighters[i].headY();
    }
    this.cam.extra.length = 0;
    this.cam.fwd0 = null;
    if (hideP2) {
      // CHANGED(VIEW3D) BRAWL: the camera frames the player + the goons in reach (their ground points); "behind" the player
      // is read from his yaw
      const c1 = this.camF[1], c0 = this.camF[0];
      c1.x = c0.x; c1.z = c0.z; c1.y = 0; c1.head = c0.head;
      if (this.brawl) for (const q of this.brawl.goonPts(this.goonPts)) this.cam.extra.push(q);
      const yw = snaps[0].yaw;
      if (typeof yw === 'number') this.cam.fwd0 = [Math.sin(yw), Math.cos(yw)];
    }
    this.cam.update(dt, this.camF, this.r.css.x / Math.max(1, this.r.css.y), m.frame, ts);
    // CHANGED(fixer) D4 read-back: where each fighter's top lands on screen (fraction of the frame height from the top)
    for (let i = 0; i < 2; i++) {
      this.tmp.set(this.camF[i].x, this.camF[i].head, this.camF[i].z ?? 0).project(this.cam.camera);
      this.lastTops[i] = Math.round(((1 - this.tmp.y) / 2) * 1000) / 1000;
      this.tmp.set(this.camF[i].x, this.camF[i].y, this.camF[i].z ?? 0).project(this.cam.camera);
      this.lastFeet[i] = Math.round(((1 - this.tmp.y) / 2) * 1000) / 1000;
    }
    // the dim plane goes just behind the farther fighter along the camera's view (fighters stay lit in any shot)
    const cc = this.cam.camera;
    cc.getWorldDirection(this.tmp);
    let far = 0;
    for (let i = 0; i < 2; i++) {
      const fp = this.fighters[i].root.position;
      const d = (fp.x - cc.position.x) * this.tmp.x + (fp.y + 1.0 - cc.position.y) * this.tmp.y + (fp.z - cc.position.z) * this.tmp.z;
      if (d > far) far = d;
    }
    this.fx.dimDepth = far + 0.9;
    const pts = ts * this.cineTs;
    this.stage.followShadow(this.cam.midX, this.cam.midZ);
    this.camBasis();
    const hp0 = snaps[0].hpMax ? (snaps[0].hp ?? 0) / snaps[0].hpMax : 1, hp1 = snaps[1].hpMax ? (snaps[1].hp ?? 0) / snaps[1].hpMax : 1;
    fs.camera = now() - ft; ft = now();
    this.stage.update(dt * pts, { hp: [hp0, hp1], names: [this.nameOf(0), this.nameOf(1)], timer: m.timer, time: this.realTime },
      (at, size, col) => this.fx.trail(at, this.tmp3.set(this.fx.rr(-0.2, 0.2), this.fx.rr(0.8, 1.4), this.fx.rr(-0.1, 0.1)), size * this.fx.rr(0.5, 0.8), col, 17, 1.4, false, 2.6, -0.4, 0.8, 0.35));
    fs.stage = now() - ft; ft = now();
    if (this.crowd) {
      const st = ((snaps[0].showtime ?? 0) + (snaps[1].showtime ?? 0)) / 60000;
      this.crowd.intensityTarget = Math.min(1, 0.2 + 0.8 * st + (ps ? 0.35 + 0.5 * ps.crowdBoost : 0));
      this.crowd.update(dt * pts);
    }
    fs.crowd = now() - ft; ft = now();
    this.proj.frame(m.proj, dt * pts, m.frame);
    if (this.brawl) { this.brawl.frame(m.brawl?.goons, dt, this.realTime, snaps[0].x); this.brawl.updatePopups(dt, this.cam.camera, this.cam.safeTop); }
    fs.proj = now() - ft; ft = now();
    this.fx.update(dt, pts);
    fs.fx = now() - ft;
  }

  /** CHANGED(fix_view) G9 read-back: the last frame()'s CPU split by section (ms; the lab's frameCost probe reads it) */
  readonly fsplit = { prime: 0, fighters: 0, events: 0, beats: 0, camera: 0, stage: 0, crowd: 0, proj: 0, fx: 0 };

  private nameOf(i: number): string { const id = this.cfg.p[i]?.fighter ?? ''; return this.data.fighters[id]?.name ?? id.toUpperCase(); }

  render(): void {
    this.r.beginFrame();
    this.r.resize();
    if (this.sizeVersion !== this.r.sizeVersion) {
      this.sizeVersion = this.r.sizeVersion;
      setOutlineViewport(this.r.buffer.x, this.r.buffer.y);
    }
    this.post.render(this.lastDt);
  }

  /** forget presentation state (camera smoothing, overrides, FX): a new round / a lab re-run */
  resetPresentation(): void {
    this.cam.reset();
    this.fx.reset();
    this.proj.reset();
    this.superAt = -1000;
    this.lastRound = -1;
    this.plan = null; this.outro = null; this.lastCineFrame = -1; this.firedUpTo = -1;
    this.primeProps.hideAll();
    this.post.setLetterbox(0); this.post.setSlate(null, 0, 0, 0, 0, 0);
    this.pendingHits.clear();
    for (const f of this.fighters) { f.victim = false; f.flash(0, 0xffffff, 0.001); f.turn.reset(); }
  }

  /** CHANGED(fixer) D4: small per-frame camera read-back (test surface `state().cam`) */
  camReadback(): Record<string, unknown> {
    const L = this.cam.last;
    return { mode: L.mode, dist: Math.round(L.dist * 1000) / 1000, lookY: Math.round(L.lookY * 1000) / 1000, safeTop: this.cam.safeTop, yawDeg: L.yawDeg,
      tops: [...this.lastTops], topY: [Math.round(this.camF[0].head * 1000) / 1000, Math.round(this.camF[1].head * 1000) / 1000], feet: [...this.lastFeet] };
  }

  /** read-back for the test surface / lab */
  info(): Record<string, unknown> {
    const p = this.plan;
    return {
      camera: { ...this.cam.last }, fighters: this.fighters.map((x) => ({ ...x.last, props: x.propInfo() })), fx: { ...this.fx.stats },
      crowd: this.crowd ? this.crowd.count : 0, crowdExcite: this.crowd ? Math.round(this.crowd.excitement() * 100) / 100 : 0, stageFallback: this.stage.fallback, evSource: EV_SOURCE, warmMs: Math.round(this.warmMs),
      warmSplit: this.warmSplit, loadSplit: this.loadSplit,
      prime: p ? { cue: p.cue, frames: p.frames, f: this.ps.f, shot: this.ps.shot, shotIdx: this.ps.shotIdx, att: this.ps.att.map((e) => `${e.clip}@${e.t.toFixed(2)}x${e.w.toFixed(2)}`),
        vic: this.ps.vic.map((e) => `${e.clip}@${e.t.toFixed(2)}x${e.w.toFixed(2)}`), gap: +this.ps.vicGap.toFixed(2), vy: +this.ps.vicY.toFixed(2), carry: this.ps.carry,
        beats: p.beats.length, v2: p.v2, endGap: p.endGap, wallSplatAt: p.wallSplatAt, simVictim: p.simVictim,
        shots: p.v2 ? p.cams.map((c) => [c.from, c.to, c.shot ?? '']) : p.shots.map((x) => [x.f0, x.f1, x.name]), hits: p.hits.map((h) => h[0]),
        freeze: ps0(this.ps), guard: { ...this.guardLast }, camTarget: this.ps.camTarget, slate: +this.ps.slate.toFixed(2), letterbox: +this.ps.letterbox.toFixed(3), dim: this.ps.dim, spot: this.ps.spot } : null,
      proj: this.proj.info(), props: this.propLib ? this.propLib.report() : null, brawl: this.brawl ? this.brawl.info() : null,
      stage: { ...this.stage.report, live: this.stage.live() },
      // CHANGED(VIEW3D) read-back: the ring the view uses, the PRIME TIME line frame, the last wall splat as placed
      ring: { shape: this.ring.shape, r: this.ring.r, sides: this.ring.sides, rotDeg: Math.round(this.ring.rot * 1800 / Math.PI) / 10, wallH: this.ring.wallH,
        surface: this.ring.surface, solidTop: ringSolidTop(this.ring), clearR: this.ring.clearR, fromSim: this.ringFromSim },
      cineFrame: p ? { ox: +this.cineF.ox.toFixed(3), oz: +this.cineF.oz.toFixed(3), rDeg: Math.round(Math.atan2(this.cineF.rx, this.cineF.rz) * 1800 / Math.PI) / 10,
        facing: this.cineFacing, flip: this.cineFlip } : null,
      splat: this.lastSplat,
      // CHANGED(fix_view) D13 read-back: each fighter's framed top / feet as screen fractions from the top, the HUD band
      framing: { tops: [...this.lastTops], feet: [...this.lastFeet], safeTop: this.cam.safeTop, topM: this.fighters.map((x) => x.neutralTopM),
        // the posed top this frame (independent of what the camera framed by) and the lowest foot bone, as screen fractions
        live: this.fighters.map((x) => { const p = x.root.position; this.tmp.set(p.x, x.liveTop(), p.z).project(this.cam.camera); return Math.round(((1 - this.tmp.y) / 2) * 1000) / 1000; }),
        liveFeet: this.fighters.map((x) => { let lo = 0; for (const n of ['LeftToeBase', 'RightToeBase', 'LeftFoot', 'RightFoot']) if (x.bonePos(n, this.tmp2)) { this.tmp2.project(this.cam.camera); lo = Math.max(lo, (1 - this.tmp2.y) / 2); } return Math.round(lo * 1000) / 1000; }) },
      feet: this.fighters.map((x) => x.feetInfo()),
      primeCost: { ...this.primeCost },
      missingClips: this.fighters.map((x) => [...x.pose.missing]), render: this.r.info(),
    };
  }

  dispose(): void {
    for (const f of this.fighters) f.dispose();
    this.fx.dispose();
    this.proj.dispose();
    this.primeProps.dispose();
    this.brawl?.dispose();
    this.crowd?.dispose();
    this.stage.dispose();
    this.slateTex.dispose();
    this.post.dispose();
    this.scene.clear();
  }
}
