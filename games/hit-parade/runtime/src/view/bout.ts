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
  private readonly camF: [CamFighter, CamFighter] = [{ x: 0, y: 0, head: 1.8 }, { x: 0, y: 0, head: 1.8 }];
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
  private outro: { at: number; att: number; lists: [PoseItem[], PoseItem[]]; pos: Array<[number, number]> } | null = null;
  private readonly slateCanvas: HTMLCanvasElement = document.createElement('canvas');
  private readonly slateTex: THREE.CanvasTexture;
  private slateKey = '';
  private crowdFocus: V3 | null = null;
  private cineTs = 1;
  private readonly goonXs: number[] = [];
  private readonly propLib: PropLibrary | null;
  /** CHANGED(fixer) D4: screen-y fraction (from the top) of each fighter's top, last frame */
  readonly lastTops: [number, number] = [0, 0];
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
    this.scene.name = 'bout';
    stage.applyTo(this.scene, r.three);
    for (const f of fighters) this.scene.add(f.root);
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
    const t1 = performance.now();
    await warmupComposer(this.r.three, this.scene, this.cam.camera);
    const t2 = performance.now();
    this.render();
    const t3 = performance.now();
    this.post.bloom.enabled = bloomWas;
    this.primeProps.hideAll();
    this.post.setSlate(null, 0, 0, 0, 0, 0);
    this.post.setLetterbox(0);
    this.warmMs = t3 - t0;
    this.warmSplit = { prep: Math.round(t1 - t0), warmup: Math.round(t2 - t1), firstComposer: Math.round(t3 - t2),
      programs: this.r.three.info.programs?.length ?? 0 };
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

  private hitPos(att: ViewFighterSnap, vic: ViewFighterSnap, vicView: FighterView, dcm: number, out: THREE.Vector3, sc = -1): number {
    const dir = Math.sign(vic.x - att.x) || (att.facing < 0 ? -1 : 1);
    if (sc === 7) {
      // CHANGED(fixer) D7: a throw's damage lands on the victim's BODY - the thrown clip has carried it off its root
      // x and down to the floor, so the fixed contact height (d = 100 cm at the root) floated the spark in mid-air
      vicView.chest(out);
      out.z = Math.max(out.z, 0) + 0.12;
      return dir;
    }
    const y = dcm > 0 ? vic.y + dcm / 100 : vicView.chest(out).y;
    out.set(vic.x - dir * 0.18, y, 0.12);
    return dir;
  }

  private queueHit(ev: ViewEvent, kind: HitKind, rank: number): void {
    const key = `${ev.frame}:${ev.a}:${ev.b}`;
    const cur = this.pendingHits.get(key);
    if (!cur || rank > cur.rank) this.pendingHits.set(key, { kind, rank, ev: cur && cur.ev.c > ev.c ? cur.ev : ev });
  }

  private events(m: ViewMatchSnap, f: [ViewFighterSnap, ViewFighterSnap], ev: ReadonlyArray<ViewEvent>): void {
    const F = this.fighters;
    const p = (i: number): ViewFighterSnap => f[i === 1 ? 1 : 0];
    const inCine = !!this.plan && !!m.cinematic && flagOn(m.cinematic.active);
    for (const e of ev) {
      const t = e.type;
      if (t === EV.SUPER_HIT && inCine) {
        // PRIME TIME blows land on the victim's presentation body (the sim holds its x; the view carries it)
        const vi = e.b === 1 ? 1 : 0;
        const at = F[vi].chest(this.tmp);
        const dir = Math.sign(F[vi].root.position.x - F[1 - vi].root.position.x) || 1;
        at.x -= dir * 0.12; at.z = Math.max(at.z, 0) + 0.12;
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
        this.tmp.set((f[0].x + f[1].x) / 2, 1.25, 0.15);
        if (t !== EV.PROJ_CLASH) this.fx.hit('clash', 1, this.tmp, 1);
        this.cam.addTrauma(0.12);
      } else if (t === EV.WALL_SPLAT) {
        const vic = e.a === 1 ? 1 : 0;
        this.fx.wallSplat(e.b === 0 || e.b === 1 ? e.b : (f[vic].x < 0 ? 0 : 1), F[vic].chest(this.tmp).y);
        this.cam.addTrauma(0.35);
        this.crowd?.popNow(0.7);
      } else if (t === EV.GROUND_BOUNCE || t === EV.KNOCKDOWN || t === EV.CRUMPLE) {
        const who = e.a === 1 ? 1 : 0;
        this.fx.dust(this.tmp.set(f[who].x, 0.05, 0.1), t === EV.GROUND_BOUNCE ? 1.3 : 0.9);
        if (t === EV.GROUND_BOUNCE) this.cam.addTrauma(0.2);
      } else if (t === EV.IMPACT_START) {
        const who = e.a === 1 ? 1 : 0;
        F[who].glow(0.45);
        this.fx.impactStart(F[who].chest(this.tmp));
      } else if (t === EV.IMPACT_ARMOR) {
        const who = e.a === 1 ? 1 : 0;
        F[who].glow(0.3);
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
        const at = e.d === 2 || e.d === 4 ? null : F[0].chest(this.tmp3);
        if (this.brawl) this.brawl.score(e.b, e.a, at, e.d, e.c);
      }
      if (t === EV.PROJ_HIT || t === EV.PROJ_CLASH) this.proj.onEvent(e);
    }
    // collapsed strikes: one burst per (frame, attacker, victim) of the strongest kind
    for (const { kind, ev: e } of this.pendingHits.values()) {
      if (e.b >= 8 && this.brawl) {
        // BRAWL: the player hit a goon (§28.4 fighter fields 8 + slot)
        if (this.brawl.goonChest(e.b - 8, this.tmp)) {
          const dir = Math.sign(this.tmp.x - f[0].x) || 1;
          this.tmp.x -= dir * 0.15;
          this.fx.hit(kind, e.c, this.tmp, dir);
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
  }

  // ───────────────────────────── PRIME TIME ─────────────────────────────

  private clipFacts(id: string): Record<string, ClipFact> { return clipFactsOf(this.data.clips?.[id]) as Record<string, ClipFact>; }

  /** compile (or reuse) the plan for the running cinematic */
  private primeBegin(snaps: [ViewFighterSnap, ViewFighterSnap], who: 0 | 1, moveIdx: number, simFrames: number, simVictim: boolean): void {
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
    const facing = sa.facing < 0 ? -1 : 1;
    this.plan = compilePlan({
      def: c, moveKey: mk, moveName: mv?.name ?? mk, fighterName: def?.name ?? id,
      attFacts: this.clipFacts(id), vicFacts: this.clipFacts(this.cfg.p[1 - who]?.fighter ?? ''),
      attDur: (clip) => A.pose.has(clip) ? A.pose.dur(clip) : 0, vicDur: (clip) => V.pose.has(clip) ? V.pose.dur(clip) : 0,
      gap0: Math.abs(sv.x - sa.x), ax: sa.x, facing, attPre: pre(A, sa), vicPre: pre(V, sv), hA: A.heightM, hV: V.heightM, simVictim,
    });
    this.planKey = `${who}:${moveIdx}:${simVictim ? 'grab' : 'cin'}`;
    this.planAtt = who;
    this.firedUpTo = -1;
    this.metalUntil = -1;
    this.outro = null;
    // the crowd the crowd_pop shot turns to: the stands behind the action, in the attacker's frame
    let n = 0, cx = 0, cy = 0, cz = 0;
    for (const o of this.stage.crowd) {
      o.getWorldPosition(this.tmp);
      if (this.tmp.z > -2.5 || Math.abs(this.tmp.x - sa.x) > 6.5) continue;
      cx += this.tmp.x; cy += this.tmp.y; cz += this.tmp.z; n++;
    }
    this.crowdFocus = n ? [((cx / n) - sa.x) * facing, cy / n + 1.2, cz / n] : null;
    // the name slate
    const tag = this.data.strings?.['hud.combo.prime'] ?? 'PRIME TIME';
    const [line, who2] = slateParts(this.plan.slate, tag, this.plan.moveName, this.plan.fighterName);
    const key = `${tag}|${line}|${who2}`;
    if (key !== this.slateKey) {
      paintSlate(this.slateCanvas, tag, line.toUpperCase(), who2.toUpperCase());
      this.slateTex.needsUpdate = true;
      this.slateKey = key;
    }
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

  private primeBeat(name: string, dur: number, fStart: number, target: string, amount: number, att: number, ax: number, facing: number, vx: number): void {
    const A = this.fighters[att], V = this.fighters[1 - att];
    const T = this.tgt(target, att, 'vic');
    const t = this.tmp2;
    const dir = facing;
    switch (name) {
      // v2 body FX (CONTRACT §26.1 vocabulary) - extra bursts on top of the sim's SUPER_HIT sparks
      case 'impact_s': case 'impact_m': case 'impact_l': {
        // an extra comic burst on the target (no screen flash / lines: the data asks for those with its own beats)
        const k = name === 'impact_s' ? 0.55 : name === 'impact_m' ? 0.75 : 1.0;
        T.chest(t); t.x -= dir * 0.1; t.z = Math.max(t.z, 0) + 0.12;
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
      case 'slam': this.fx.slam(t.set(vx, 0, 0.05), 1.25); this.cam.addTrauma(0.55); this.crowd?.popNow(0.5); break;
      case 'slam_trap': this.fx.slam(t.set(ax + facing * 0.45, 0, 0.05), 1.0); this.cam.addTrauma(0.45); break;
      case 'flash': this.fx.screenFlash(0.42, 0xffffff, 0.03); break;
      case 'crowd': this.crowd?.popNow(1.2 * amount); break;
      case 'confetti': this.fx.confettiRain(ax + facing * 1.0, 8, 110); break;
      case 'confetti_big': this.fx.confettiRain(ax + facing * 1.0, 13, 240); break;
      case 'glow': A.glow(Math.max(0.2, dur / 60)); this.fx.shockwave(A.chest(t), 0.8, 0xffd65a); break;
      case 'metal': this.metalUntil = fStart + Math.max(1, dur); break;
      case 'doves': this.fx.doves(target ? T.chest(t) : t.set(vx, 1.1, 0.1), 12); break;
      case 'cards_vic': this.fx.cards(t.set(vx, 1.2, 0.1), 16); break;
      case 'sparkle_vic': this.fx.sparkle(V.chest(t), 18); break;
      case 'fire_burst': this.fx.fireBurst(T.chest(t), 1.15); this.cam.addTrauma(0.3); break;
      case 'fire_burst_floor': this.fx.fireBurst(t.set(vx, 0.45, 0.1), 1.25); this.fx.fireColumn(vx, 0.1, 1.6, 1 / 20, 1.5); break;
      case 'smoke_att': this.fx.smokePuff(t.set(A.root.position.x, 1.0, 0.1), 1.3); break;
      case 'smoke_high': this.fx.smokePuff(t.set(vx, 3.9, 0), 1.2); break;
      case 'shockwave': this.fx.shockwave(this.tgt(target, att, 'att').chest(t), 1.2); this.cam.addTrauma(0.3); break;
      case 'shockwave_vic': this.fx.shockwave(V.chest(t), 1.0, 0x9ad8ff); break;
      case 'lights_flicker': this.stage.flicker(Math.max(0.2, (dur || 30) / 60)); break;
      case 'sparks_rain': this.fx.sparkShower(vx, 5.2, 2.5, 90); this.cam.addTrauma(0.3); break;
      case 'dust': this.fx.dust(t.set(target ? T.root.position.x : vx, 0.1, 0.1), 1.3); break;
      case 'taser': this.fx.electric(T.chest(t), 1.2); break;
      case 'wall_splat': this.fx.wallSplat(this.plan?.wallSide ?? (facing > 0 ? 1 : 0), 1.1); this.cam.addTrauma(0.5); this.crowd?.popNow(0.8); break;
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
            this.tmp2.set(this.tmp3.x + Math.cos(a) * 0.45, 0.08, Math.sin(a) * 0.35);
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
          this.tmp3.z = 0.08;
          const len = Math.max(0.8, Math.abs(V.root.position.x - this.tmp3.x) + 0.7);
          this.fx.flameJet(this.tmp3, facing, len, 1.4, dt);
          break;
        }
        case 'pyro':
          for (const dx of [-4.8, -2.6, 2.6, 4.8]) this.fx.fireColumn(ax + dx, -1.4, 2.2, dt, 1.2);
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
    }
    // 1. PRIME TIME sample (pure function of the cinematic frame / the grab super's lock frame)
    const cin = m.cinematic;
    const simCine = !!cin && flagOn(cin.active);
    const lock = simCine ? null : this.grabLock(snaps);
    const active = simCine || !!lock;
    let ps: PrimeSample | null = null;
    let att: 0 | 1 = 0;
    if (active) {
      att = simCine ? (cin!.fighter === 1 ? 1 : 0) : lock!.who;
      const moveIdx = simCine ? cin!.cueId : lock!.moveIdx;
      const cf = simCine ? cin!.frame : lock!.frame;
      const key = `${att}:${moveIdx}:${simCine ? 'cin' : 'grab'}`;
      // a rollback that rewinds back into the same cinematic (<= 8 frames) resumes the plan (beats already fired stay
      // fired); a NEW cinematic (another move, or the same one restarting from frame 0) compiles a fresh plan
      if (this.outro && this.plan && this.planKey === key && cf + 20 >= this.lastCineFrame) this.outro = null;
      else if (!this.plan || this.planKey !== key || cf + 20 < this.lastCineFrame || this.outro) {
        this.primeBegin(snaps, att, moveIdx, simCine ? cin!.frames ?? 0 : lock!.frames, !simCine);
      }
      const sa = snaps[att];
      const facing = sa.facing < 0 ? -1 : 1;
      ps = samplePlan(this.plan!, cf, this.settings.cinematicCamera === 'short', this.crowdFocus, sa.x, facing,
        this.plan!.simVictim ? snaps[1 - att].x : null, this.ps, this.psScratch);
      this.lastCineFrame = cf;
    } else if (this.plan && !this.outro) {
      // the cinematic just ended: blend the last cinematic pose into the sim's for OUTRO_FRAMES
      const a = this.planAtt;
      this.outro = { at: m.frame, att: a, lists: [[], []], pos: [[0, 0], [0, 0]] };
      for (let i = 0; i < 2; i++) {
        const src = i === a ? this.ps.att : this.plan.simVictim ? [] : this.ps.vic;
        this.outro.lists[i] = src.map((e) => ({ ...e }));
        this.outro.pos[i] = [this.fighters[i].root.position.x, this.fighters[i].root.position.y];
      }
    }
    // 2. fighters (cinematic overrides / outro blend / plain snapshot)
    const hideP2 = this.cfg.mode === 'brawl' || this.cfg.mode === 'heckler';
    const ovA = this.ov[0], ovB = this.ov[1];
    for (const o of this.ov) { o.list = undefined; o.blend = undefined; o.x = undefined; o.y = undefined; o.yaw = undefined; o.facing = undefined; o.visible = undefined; o.inCinematic = undefined; }
    if (ps && this.plan) {
      const vic = 1 - att;
      const sa = snaps[att];
      const facing = sa.facing < 0 ? -1 : 1;
      const oa = att === 0 ? ovA : ovB, ob = att === 0 ? ovB : ovA;
      this.fighters[0].zTarget = 0; this.fighters[1].zTarget = 0;
      const clampX = (x: number) => Math.max(-7.55, Math.min(7.55, x));
      oa.list = ps.att; oa.facing = facing; oa.visible = ps.attVisible; oa.inCinematic = true;
      if (!this.plan.simVictim) { oa.x = clampX(sa.x + facing * ps.attDx); oa.y = Math.max(-2.2, ps.attY); }
      this.fighters[att].update(sa, dt, this.realTime, oa);
      if (!this.plan.simVictim) {
        let vx = sa.x + facing * (ps.attDx + ps.vicGap), vy = ps.vicY;
        if (ps.carryBlend > 0) {
          const A = this.fighters[att];
          A.chest(this.tmp); A.forward(this.tmp2);
          const cxv = this.tmp.x + this.tmp2.x * 0.3;
          const cyv = Math.max(0, this.tmp.y - 0.72 * this.plan.hV + 0.1) + (ps.carry === 2 ? 0.45 : 0);
          vx += (cxv - vx) * ps.carryBlend; vy += (cyv - vy) * ps.carryBlend;
          if (ps.carry) ob.yaw = Math.atan2(-this.tmp2.x, -this.tmp2.z);
        }
        ob.list = ps.vic; ob.x = clampX(vx); ob.y = vy; ob.facing = -facing; ob.visible = ps.vicVisible; ob.inCinematic = true;
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
        const dx = Math.abs(snaps[i].x - snaps[1 - i].x);
        fv.zTarget = swapPose ? 0.55 * Math.max(0, Math.min(1, 1.6 - dx)) : 0;
        const ov = this.ov[i];
        if (o && k < 1 && o.lists[i].length) {
          ov.blend = { list: o.lists[i], w: 1 - k };
          ov.x = o.pos[i][0] + (snaps[i].x - o.pos[i][0]) * k;
          ov.y = o.pos[i][1] + (snaps[i].y - o.pos[i][1]) * k;
        }
        if (hideP2 && i === 1) ov.visible = false;
        if ((snaps[i] as { absent?: boolean }).absent) ov.visible = false;
        fv.update(snaps[i], dt, this.realTime, ov);
      }
    }
    // 3. events (after posing: FX sit on the current bones)
    if (ev.length) this.events(m, snaps, ev);
    // 4. PRIME TIME beats, continuous FX, props
    this.cineTs = ps ? ps.ts : 1;
    if (ps && this.plan) {
      const p = this.plan;
      const sa = snaps[att];
      const facing = sa.facing < 0 ? -1 : 1;
      const vx = this.fighters[1 - att].root.position.x;
      for (const b of p.beats) if (b.f > this.firedUpTo && b.f <= ps.f) this.primeBeat(b.name, b.dur, b.f, b.target, b.amount, att, sa.x, facing, vx);
      this.firedUpTo = Math.max(this.firedUpTo, ps.f);
      if (!ps.freeze) this.primeContinuous(p, ps.f, att, sa.x, facing, dt * ps.ts);
      const A = this.fighters[att], V = this.fighters[1 - att];
      propsAt(p, p.eff[ps.f], ps, sa.x, facing, this.primeProps,
        (name, out) => (name.startsWith('v') ? this.anchor(V, name, out) : this.anchor(A, name, out)), this.tmp, this.tmp2);
      const fireOn = (p.tweak.ballFire && ps.f >= p.tweak.ballFire[0] && ps.f < p.tweak.ballFire[1])
        || p.beats.some((b) => b.name === 'ball_trail' && ps!.f >= b.f && ps!.f < b.f + b.dur);
      if (fireOn && this.primeProps.ball.visible && !ps.freeze) {
        const bp = this.primeProps.ball.position;
        for (let k = 0; k < 3; k++) this.fx.trail(bp, this.tmp.set(-facing * this.fx.rr(1, 2.5), this.fx.rr(0.2, 1), this.fx.rr(-0.3, 0.3)), this.fx.rr(0.16, 0.28), k ? 0xff6a10 : 0xffdc70, 16, 0.3, true, 2.4, -1.5, 2.2, 0.85);
      }
    } else this.primeProps.hideAll();
    // 5. camera
    if (ps && this.plan) {
      const sa = snaps[att];
      const facing = sa.facing < 0 ? -1 : 1;
      const L = ps.cam;
      const c: CinePose = this.cine;
      if (ps.camLocal) {
        c.pos.set(sa.x + facing * L.pos.x, L.pos.y, L.pos.z);
        c.look.set(sa.x + facing * L.look.x, L.look.y, L.look.z);
        c.roll = L.roll * facing;
      } else {
        c.pos.copy(L.pos); c.look.copy(L.look); c.roll = L.roll * facing;
      }
      c.pos.set(Math.max(-7.7, Math.min(7.7, c.pos.x)), Math.max(0.12, c.pos.y), Math.min(9, c.pos.z));
      c.fov = L.fov;
      this.cam.setCinematic(c);
      if (ps.freeze) this.cam.trauma = 0;
    } else if (simCine && !this.plan) {
      const who = cin!.fighter === 1 ? 1 : 0;
      const id = this.cfg.p[who]?.fighter ?? '';
      const def = this.data.fighters[id];
      const mv = def ? def.moves[moveKeys(def)[cin!.cueId] ?? ''] : undefined;
      this.cam.setCinematic(sampleTrack(trackFor(mv?.cinematic?.cue), cin!.frame, cin!.frames ?? 150, snaps[who].x, snaps[who].facing < 0 ? -1 : 1,
        this.settings.cinematicCamera === 'short', this.cine));
    } else this.cam.setCinematic(null);
    // background dim: super freeze (strong), cinematic (per shot), spotlight
    const inSuper = m.frame - this.superAt < this.superFrames || (flagOn(m.freeze) && m.frame - this.superAt < this.superFrames * 3);
    this.fx.dimTarget = ps ? ps.dim : inSuper ? 0.62 : active ? 0.3 : 0;
    this.fx.spotTarget = ps ? ps.spot : 0;
    if (ps) this.fx.spotX = this.fighters[ps.spotOnVictim ? 1 - att : att].root.position.x;
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
      c.x = snaps[i].x; c.y = snaps[i].y; c.head = snaps[i].y > 0.02 ? this.fighters[i].topY() : this.fighters[i].headY();
    }
    if (hideP2) {
      const px = snaps[0].x;
      let lo = px, hi = px;
      for (const gx of this.brawl ? this.brawl.goonXs(this.goonXs) : []) if (Math.abs(gx - px) < 4.5) { lo = Math.min(lo, gx); hi = Math.max(hi, gx); }
      this.camF[0].x = lo; this.camF[1].x = hi; this.camF[1].y = 0; this.camF[1].head = this.camF[0].head;
    }
    this.cam.update(dt, this.camF, this.r.css.x / Math.max(1, this.r.css.y), m.frame, ts);
    // CHANGED(fixer) D4 read-back: where each fighter's top lands on screen (fraction of the frame height from the top)
    for (let i = 0; i < 2; i++) {
      this.tmp.set(this.camF[i].x, this.camF[i].head, 0).project(this.cam.camera);
      this.lastTops[i] = Math.round(((1 - this.tmp.y) / 2) * 1000) / 1000;
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
    this.stage.followShadow(this.cam.midX);
    const hp0 = snaps[0].hpMax ? (snaps[0].hp ?? 0) / snaps[0].hpMax : 1, hp1 = snaps[1].hpMax ? (snaps[1].hp ?? 0) / snaps[1].hpMax : 1;
    this.stage.update(dt * pts, { hp: [hp0, hp1], names: [this.nameOf(0), this.nameOf(1)], timer: (m as { timer?: number }).timer, time: this.realTime },
      (at, size, col) => this.fx.trail(at, this.tmp3.set(this.fx.rr(-0.2, 0.2), this.fx.rr(0.8, 1.4), this.fx.rr(-0.1, 0.1)), size * this.fx.rr(0.5, 0.8), col, 17, 1.4, false, 2.6, -0.4, 0.8, 0.35));
    if (this.crowd) {
      const st = ((snaps[0].showtime ?? 0) + (snaps[1].showtime ?? 0)) / 60000;
      this.crowd.intensityTarget = Math.min(1, 0.2 + 0.8 * st + (ps ? 0.35 + 0.5 * ps.crowdBoost : 0));
      this.crowd.update(dt * pts);
    }
    this.proj.frame(m.proj, dt * pts, m.frame);
    if (this.brawl) { this.brawl.frame(m.brawl?.goons, dt, this.realTime); this.brawl.updatePopups(dt, this.cam.camera); }
    this.fx.update(dt, pts);
  }

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
    for (const f of this.fighters) { f.victim = false; f.flash(0, 0xffffff, 0.001); }
  }

  /** CHANGED(fixer) D4: small per-frame camera read-back (test surface `state().cam`) */
  camReadback(): Record<string, unknown> {
    const L = this.cam.last;
    return { mode: L.mode, dist: Math.round(L.dist * 1000) / 1000, lookY: Math.round(L.lookY * 1000) / 1000, safeTop: this.cam.safeTop,
      tops: [...this.lastTops], topY: [Math.round(this.camF[0].head * 1000) / 1000, Math.round(this.camF[1].head * 1000) / 1000] };
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
        freeze: ps0(this.ps), slate: +this.ps.slate.toFixed(2), letterbox: +this.ps.letterbox.toFixed(3), dim: this.ps.dim, spot: this.ps.spot } : null,
      proj: this.proj.info(), props: this.propLib ? this.propLib.report() : null, brawl: this.brawl ? this.brawl.info() : null,
      stage: { ...this.stage.report },
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
