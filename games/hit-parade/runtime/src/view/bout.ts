// HIT PARADE - the 3D presentation of one match (CONTRACT §16 BoutView, §7, §17).
//
// BoutView reads ONLY snapshots + (deduped, new) events. Per rendered frame (`frame`):
//   1. events -> FX, camera cues, fighter flashes / victim marks, crowd pops (a strike's HIT + COUNTER / PUNISH on the
//      same frame collapse into ONE burst of the strongest kind);
//   2. fighters posed from state (anim.ts), victim shake during hitstop;
//   3. camera: cinematic track (sim cinematic frame) > KO orbit > super punch-in > perfect-parry freeze > side rig;
//   4. background dim during super freezes, crowd intensity from SHOWTIME, projectile visuals from MatchSnap.proj;
//   5. FX / crowd / stage dressing advance at the slow-mo rate (KO x0.25); the flash and camera smoothing in real time.
// `render()` draws through the post chain. `create()` loads the stage + both fighters, bakes/loads the crowd atlas and
// WARMS every program (RT variants then canvas, E34) before the first round.

import * as THREE from 'three';
import type { Renderer } from './renderer.ts';
import { Assets, type FighterAsset } from './assets.ts';
import { Post } from './post.ts';
import { FightCamera, CAM, type CamFighter } from './camera.ts';
import { FighterView } from './fighters.ts';
import { FxSystem, type HitKind } from './fx.ts';
import { StageView, stageDef } from './stage.ts';
import { CrowdView, bakeCrowdAtlas, loadCrowdAtlas, type CrowdAtlas } from './crowd.ts';
import { animTableFor, moveKeys } from './animtable.ts';
import { newPose, sampleTrack, trackFor } from './cinematics.ts';
import { setOutlineViewport } from './toon.ts';
import { warmupComposer } from './warmup.ts';
import { EV, EV_SOURCE } from './ev.ts';
import {
  DEFAULT_VIEW_SETTINGS, flagOn, type ViewEvent, type ViewFighterSnap, type ViewGameData, type ViewMatchCfg,
  type ViewMatchSnap, type ViewSettings,
} from './types.ts';

export type { ViewSettings } from './types.ts';

function numAt(o: unknown, paths: string[][], dflt: number): number {
  for (const p of paths) {
    let v: unknown = o;
    for (const k of p) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return dflt;
}

const TRAUMA_BY_STRENGTH = [0.10, 0.15, 0.20, 0.20, 0.25, 0.35, 0.10, 0.20];

export interface BoutOptions {
  /** allow the stand-in set when the stage GLB is missing (lab / dev); default true */
  allowStageFallback?: boolean;
  /** crowd on/off (perf A/B); default true */
  crowd?: boolean;
  /** outline hulls on/off (perf A/B); default true */
  outline?: boolean;
  /** skip the warm-up (debug: per-program compile timing) */
  warm?: boolean;
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
  private readonly camF: [CamFighter, CamFighter] = [{ x: 0, y: 0, head: 1.8 }, { x: 0, y: 0, head: 1.8 }];
  private pendingHits = new Map<string, { kind: HitKind; rank: number; ev: ViewEvent }>();
  private lastSnaps: [ViewFighterSnap, ViewFighterSnap] | null = null;
  warmMs = 0;
  warmSplit: Record<string, number> = {};
  loadSplit: Record<string, number> = {};

  private constructor(r: Renderer, cfg: ViewMatchCfg, data: ViewGameData, stage: StageView, fighters: [FighterView, FighterView],
    crowd: CrowdView | null) {
    this.r = r;
    this.cfg = cfg;
    this.data = data;
    this.stage = stage;
    this.fighters = fighters;
    this.crowd = crowd;
    this.cam = new FightCamera(r.css.x / Math.max(1, r.css.y));
    if (cfg.mode === 'brawl') this.cam.variant = 'brawl';
    this.scene.name = 'bout';
    stage.applyTo(this.scene, r.three);
    for (const f of fighters) this.scene.add(f.root);
    if (crowd) this.scene.add(crowd.mesh);
    this.post = new Post(r, this.scene, this.cam.camera);
    this.fx = new FxSystem(this.scene, this.post, this.cam);
    // system.json super.freeze1 / freeze3 (FIGHTING_DESIGN 1c: fixed frames per level)
    this.superFrames3 = numAt(data.system, [['super', 'freeze3'], ['super', 'freeze']], CAM.superFrames);
    this.superFrames1 = numAt(data.system, [['super', 'freeze1'], ['super', 'freeze']], 30);
    this.superFrames = this.superFrames3;
    this.setSettings({});
  }

  /** Load stage + both fighters, bake/load the crowd atlas, warm every program. */
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
    const t2 = performance.now();
    const v = new BoutView(r, cfg, data, stage, fighters, crowd);
    v.loadSplit = { assets: Math.round(t1 - t0), fightersAndCrowd: Math.round(t2 - t1) };
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
    const bloomWas = this.post.bloom.enabled;
    this.post.bloom.enabled = this.settings.bloom && this.r.bloomAllowed();
    const t1 = performance.now();
    await warmupComposer(this.r.three, this.scene, this.cam.camera);
    const t2 = performance.now();
    this.render();
    const t3 = performance.now();
    this.post.bloom.enabled = bloomWas;
    this.warmMs = t3 - t0;
    this.warmSplit = { prep: Math.round(t1 - t0), warmup: Math.round(t2 - t1), firstComposer: Math.round(t3 - t2),
      programs: this.r.three.info.programs?.length ?? 0 };
  }

  setSettings(s: ViewSettings): void {
    this.settings = { ...this.settings, ...Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) } as Required<ViewSettings>;
    this.fx.mode = this.settings.splatter;
    this.fx.reduceFlashing = this.settings.reduceFlashing;
    this.post.reduceFlashing = this.settings.reduceFlashing;
    this.cam.shakeScale = this.settings.screenShake;
    this.post.setBloom(this.settings.bloom);
  }

  private hitPos(att: ViewFighterSnap, vic: ViewFighterSnap, vicView: FighterView, dcm: number, out: THREE.Vector3): number {
    const dir = Math.sign(vic.x - att.x) || (att.facing < 0 ? -1 : 1);
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
    for (const e of ev) {
      const t = e.type;
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
        this.fx.hit('clash', 1, this.tmp, 1);
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
      }
    }
    // collapsed strikes: one burst per (frame, attacker, victim) of the strongest kind
    for (const { kind, ev: e } of this.pendingHits.values()) {
      const vi = e.b === 1 ? 1 : 0, ai = 1 - vi;
      const dir = this.hitPos(p(ai), p(vi), F[vi], e.d, this.tmp);
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

  /** once per rendered frame; `ev` = NEW (deduped) events; `dtReal` = real seconds since the last frame */
  frame(m: ViewMatchSnap, f: readonly [ViewFighterSnap, ViewFighterSnap], ev: ReadonlyArray<ViewEvent>, dtReal: number): void {
    const dt = Math.min(0.1, Math.max(0, dtReal));
    this.lastDt = dt;
    this.realTime += dt;
    const snaps: [ViewFighterSnap, ViewFighterSnap] = [f[0], f[1]];
    this.lastSnaps = snaps;
    const ts = flagOn(m.slowmo) ? 0.25 : 1;
    if (m.round !== undefined && m.round !== this.lastRound) {
      if (this.lastRound !== -1) { this.cam.clearKo(); this.cam.setCinematic(null); }
      this.lastRound = m.round;
    }
    if (ev.length) this.events(m, snaps, ev);
    this.fighters[0].update(snaps[0], dt, this.realTime);
    this.fighters[1].update(snaps[1], dt, this.realTime);
    // cinematic camera from the sim's cinematic frame
    const cin = m.cinematic;
    if (cin && flagOn(cin.active)) {
      const who = cin.fighter === 1 ? 1 : 0;
      const id = this.cfg.p[who]?.fighter ?? '';
      const def = this.data.fighters[id];
      const mv = def ? def.moves[moveKeys(def)[cin.cueId] ?? ''] : undefined;
      const frames = cin.frames && cin.frames > 0 ? cin.frames : mv?.cinematic?.frames ?? 150;
      const track = trackFor(mv?.cinematic?.cue);
      this.cam.setCinematic(sampleTrack(track, cin.frame, frames, snaps[who].x, snaps[who].facing < 0 ? -1 : 1,
        this.settings.cinematicCamera === 'short', this.cine));
    } else this.cam.setCinematic(null);
    // background dim: super freeze (strong), cinematic (light)
    const inSuper = m.frame - this.superAt < this.superFrames || (flagOn(m.freeze) && m.frame - this.superAt < this.superFrames * 3);
    this.fx.dimTarget = inSuper ? 0.62 : cin && flagOn(cin.active) ? 0.3 : 0;
    // camera
    for (let i = 0; i < 2; i++) {
      const c = this.camF[i];
      c.x = snaps[i].x; c.y = snaps[i].y; c.head = this.fighters[i].headY();
    }
    this.cam.update(dt, this.camF, this.r.css.x / Math.max(1, this.r.css.y), m.frame, ts);
    // the dim plane goes just behind the farther fighter along the camera's view (fighters stay lit in any shot)
    const cc = this.cam.camera;
    cc.getWorldDirection(this.tmp);
    let far = 0;
    for (let i = 0; i < 2; i++) {
      const d = (snaps[i].x - cc.position.x) * this.tmp.x + (snaps[i].y + 1.0 - cc.position.y) * this.tmp.y + (0 - cc.position.z) * this.tmp.z;
      if (d > far) far = d;
    }
    this.fx.dimDepth = far + 0.9;
    this.stage.followShadow(this.cam.midX);
    this.stage.update(dt * ts);
    if (this.crowd) {
      const st = ((snaps[0].showtime ?? 0) + (snaps[1].showtime ?? 0)) / 60000;
      this.crowd.intensityTarget = Math.min(1, 0.2 + 0.8 * st);
      this.crowd.update(dt * ts);
    }
    this.fx.projectiles(m.proj);
    this.fx.update(dt, ts);
  }

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
    this.superAt = -1000;
    this.lastRound = -1;
    this.pendingHits.clear();
    for (const f of this.fighters) { f.victim = false; f.flash(0, 0xffffff, 0.001); }
  }

  /** read-back for the test surface / lab */
  info(): Record<string, unknown> {
    return {
      camera: { ...this.cam.last }, fighters: this.fighters.map((x) => ({ ...x.last })), fx: { ...this.fx.stats },
      crowd: this.crowd ? this.crowd.count : 0, crowdExcite: this.crowd ? Math.round(this.crowd.excitement() * 100) / 100 : 0, stageFallback: this.stage.fallback, evSource: EV_SOURCE, warmMs: Math.round(this.warmMs),
      warmSplit: this.warmSplit, loadSplit: this.loadSplit,
      missingClips: this.fighters.map((x) => [...x.pose.missing]), render: this.r.info(),
    };
  }

  dispose(): void {
    for (const f of this.fighters) f.dispose();
    this.fx.dispose();
    this.crowd?.dispose();
    this.stage.dispose();
    this.post.dispose();
    this.scene.clear();
  }
}
