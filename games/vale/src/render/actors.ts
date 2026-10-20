// VALE render — characters and units (CONTRACT §9 "Characters"; STYLE_BIBLE "Fighters").
//
//   * One template per GLB (assets.ts caches the load); every entity gets SkeletonUtils.clone of it.
//     Skins carry mesh + skeleton only: their clips come from the fighter's BASE model and bind by
//     bone name (the rig standard VALE_BIPED_1 is shared), so a skin never needs its own clips.
//   * AnimationMixer per actor, driven by EntityView.state / anim / stateTime:
//       idle / run / recall / channel / stunned  loop; run at speed / FighterArt.runRefSpeed
//       attack1 / attack2 / crit / cast_*        one-shot, time = stateTime × k where k puts the
//                                                authored impact (40 % of the clip) on the sim's
//                                                release (attack: windup × period, cast: castTime)
//       dash                                     fitted to the dash duration
//       death                                    plays once and HOLDS the last frame
//     Crossfades are 100 ms (60 ms into an attack). Clips missing from a GLB fall back to a sibling.
//   * The accent material (FighterArt.accentMaterial) is cloned per actor and tinted with the
//     viewer-relative readability colour: emissive ≤ 0.8 at rest, ≥ 1.5 (and above the bloom
//     threshold) during wind-ups — "a glow is a warning".
//   * Positions/facing interpolate between the last two sim ticks with MatchClient.alpha; jumps
//     longer than 3 m in one tick (blink, respawn) snap.
//   * Sockets: FighterArt.sockets names a bone or empty; three's loader sanitizes node names, so
//     lookups go through PropertyBinding.sanitizeNodeName.
//   * Missing art: no mesh, overlays only. In DEV builds behind ?dev=1 a fighter falls back to the
//     proof mannequin GLB and other units to clearly-marked debug geometry (CONTRACT §0).

import {
  type AnimationAction, type AnimationClip, AnimationMixer, BackSide, CapsuleGeometry, Color, CylinderGeometry,
  type Material, Group, LatheGeometry, LoopOnce, LoopRepeat, Mesh, MeshBasicMaterial, MeshStandardMaterial, type Object3D,
  OctahedronGeometry, PropertyBinding, SkinnedMesh, Vector2, Vector3, type WebGLProgramParametersWithUniforms,
} from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { CatalogT, FighterDefT, UnitDefT } from '../contracts/catalog.ts';
import type { EntityView, TeamId } from '../contracts/sim.ts';
import { TICK_DT } from '../contracts/sim.ts';
import type { Assets, LoadedModel } from './assets.ts';
import type { Palette } from './palette.ts';
import { patchWorldMaterial } from './world_material.ts';

const DEV_MANNEQUIN_HEIGHT = 1.95;
const IMPACT_AT = 0.4;
const ACCENT_REST = 0.8;
const ACCENT_WINDUP_MIN = 1.5;
const SNAP_DIST = 3;

export type ActorKind = 'fighter' | 'minion' | 'monster' | 'structure' | 'summon' | 'ward' | 'pickup';
const LOOPING = new Set(['idle', 'run', 'recall', 'channel', 'stunned', 'idle_lobby', 'victory', 'taunt']);

interface Template {
  scene: Object3D;
  clips: Map<string, AnimationClip>;
  /** clip role → clip name (FighterArt.clips / UnitDef.art.clips) */
  roles: Record<string, string | undefined>;
  /** extra scale (dev mannequin stand-in fitted to the authored height) */
  fit: number;
  dev: boolean;
}

export interface ActorOptions {
  dev: boolean;
  /** URL of the proof mannequin GLB (dev fallback for fighters) */
  devModelUrl: string | null;
}

// ── template library ─────────────────────────────────────────────────────────────────────────────
export class ModelLibrary {
  private readonly fighters = new Map<string, FighterDefT>();
  private readonly units = new Map<string, UnitDefT>();
  private readonly skins = new Map<string, string>(); // skin id → model ref
  private readonly templates = new Map<string, Promise<Template | null>>();
  private readonly patched = new WeakSet<Material>();
  private readonly assets: Assets;
  private readonly opts: ActorOptions;

  constructor(catalog: CatalogT, assets: Assets, opts: ActorOptions) {
    this.assets = assets;
    this.opts = opts;
    for (const f of catalog.fighters) this.fighters.set(f.id, f);
    for (const u of catalog.units) this.units.set(u.id, u);
    for (const s of catalog.skins) this.skins.set(s.id, s.model);
  }

  fighter(id: string): FighterDefT | undefined { return this.fighters.get(id); }
  unit(id: string): UnitDefT | undefined { return this.units.get(id); }

  /** every model ref a match needs (loading screen preload) */
  refsFor(fighters: { fighter: string; skin: string }[], unitIds: Iterable<string>): string[] {
    const out = new Set<string>();
    for (const s of fighters) {
      const f = this.fighters.get(s.fighter);
      if (f) out.add(f.art.model);
      const sk = this.skins.get(s.skin);
      if (sk) out.add(sk);
    }
    for (const u of unitIds) { const d = this.units.get(u); if (d) out.add(d.art.model); }
    return [...out];
  }

  private patchMaterials(root: Object3D, fighter: boolean, accentName: string): void {
    root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if (this.patched.has(mat)) continue;
        this.patched.add(mat);
        if (mat.name === accentName) continue; // patched per actor clone
        patchWorldMaterial(mat, { fighter });
      }
    });
  }

  fighterTemplate(fighterId: string, skinId: string | undefined): Promise<Template | null> {
    const key = `f:${fighterId}:${skinId ?? ''}`;
    let p = this.templates.get(key);
    if (p) return p;
    const def = this.fighters.get(fighterId);
    if (!def) return Promise.resolve(null);
    const skinRef = skinId ? this.skins.get(skinId) : undefined;
    p = (async (): Promise<Template | null> => {
      const base = await this.assets.model(def.art.model);
      const skin = skinRef && skinRef !== def.art.model ? await this.assets.model(skinRef) : null;
      const body: LoadedModel | null = skin?.renderable ? skin : base?.renderable ? base : null;
      if (body) {
        const clips = new Map<string, AnimationClip>();
        for (const c of base?.gltf.animations ?? []) clips.set(c.name, c);
        for (const c of body.gltf.animations) if (!clips.has(c.name)) clips.set(c.name, c);
        this.patchMaterials(body.gltf.scene, true, def.art.accentMaterial);
        return { scene: body.gltf.scene, clips, roles: def.art.clips as Record<string, string | undefined>, fit: 1, dev: false };
      }
      if (this.opts.dev && this.opts.devModelUrl) {
        const m = await this.assets.modelUrl(this.opts.devModelUrl);
        if (m?.renderable) {
          const clips = new Map<string, AnimationClip>();
          for (const c of m.gltf.animations) clips.set(c.name, c);
          this.patchMaterials(m.gltf.scene, true, def.art.accentMaterial);
          const roles: Record<string, string> = {};
          for (const c of clips.keys()) roles[c] = c;
          return { scene: m.gltf.scene, clips, roles, fit: def.art.height / DEV_MANNEQUIN_HEIGHT, dev: true };
        }
      }
      return null;
    })();
    this.templates.set(key, p);
    return p;
  }

  unitTemplate(unitId: string): Promise<Template | null> {
    const key = `u:${unitId}`;
    let p = this.templates.get(key);
    if (p) return p;
    const def = this.units.get(unitId);
    if (!def) return Promise.resolve(null);
    p = (async (): Promise<Template | null> => {
      const m = await this.assets.model(def.art.model);
      if (m?.renderable) {
        const clips = new Map<string, AnimationClip>();
        for (const c of m.gltf.animations) clips.set(c.name, c);
        this.patchMaterials(m.gltf.scene, false, 'accent');
        const roles: Record<string, string | undefined> = { ...def.art.clips };
        for (const c of clips.keys()) if (!(c in roles)) roles[c] = c;
        return { scene: m.gltf.scene, clips, roles, fit: 1, dev: false };
      }
      if (this.opts.dev) return devUnitTemplate(def);
      return null;
    })();
    this.templates.set(key, p);
    return p;
  }
}

// ── dev-only debug geometry (behind ?dev=1; never shipped as art) ─────────────────────────────────
let devClay: MeshStandardMaterial | null = null;
function devUnitTemplate(def: UnitDefT): Template {
  devClay ??= (() => { const m = new MeshStandardMaterial({ color: new Color().setStyle('#8C877C'), roughness: 0.8 }); m.name = 'dev_clay'; patchWorldMaterial(m); return m; })();
  const accent = new MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
  accent.name = 'accent';
  const g = new Group();
  g.name = 'dev_placeholder';
  const h = Math.max(0.4, def.art.height);
  const r = Math.max(0.2, def.collisionRadius || 0.4);
  if (def.kind === 'structure') {
    const pts = [new Vector2(r * 1.05, 0), new Vector2(r * 1.05, 0.5), new Vector2(r * 0.8, 0.7), new Vector2(r * 0.55, h * 0.75), new Vector2(r * 0.38, h * 0.92), new Vector2(0.02, h)];
    const body = new Mesh(new LatheGeometry(pts, 10), devClay);
    const band = new Mesh(new CylinderGeometry(r * 0.6, r * 0.62, 0.3, 10, 1, true), accent);
    band.position.y = h * 0.62;
    g.add(body, band);
  } else if (def.kind === 'pickup' || def.kind === 'ward') {
    const body = new Mesh(new OctahedronGeometry(Math.min(0.35, h * 0.35), 0), accent);
    body.position.y = h * 0.6;
    g.add(body);
  } else {
    const body = new Mesh(new CapsuleGeometry(r * 0.75, Math.max(0.05, h - r * 1.5), 3, 8), devClay);
    body.position.y = h / 2;
    const band = new Mesh(new CylinderGeometry(r * 0.78, r * 0.78, 0.12, 8, 1, true), accent);
    band.position.y = h * 0.78;
    g.add(body, band);
  }
  g.traverse((o) => { if ((o as Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { scene: g, clips: new Map(), roles: {}, fit: 1, dev: true };
}

// ── actor ────────────────────────────────────────────────────────────────────────────────────────
function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
function luma(c: Color): number { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

export class Actor {
  readonly id: number;
  readonly kind: ActorKind;
  readonly def: string;
  team: TeamId;
  owner: number;
  readonly root = new Group();
  model: Object3D | null = null;
  dev = false;
  /** bar anchor height above the ground (art height × scale + 0.35 m) */
  barHeight = 2.2;
  artHeight = 1.9;
  radius = 0.5;
  runRef = 3.6;
  attackWindup = 0.3;
  /** interpolation state */
  px = 0; py = 0; ph = 0; pf = 0;
  cx = 0; cy = 0; ch = 0; cf = 0;
  x = 0; y = 0; h = 0; facing = 0;
  seenTick = -1;
  view: EntityView | null = null;
  visible = true;
  /** fades out after the entity left the view (corpse removal) */
  leaving = -1;
  // bars
  trail = 1;
  trailFrom = 1;
  trailHoldUntil = -1;
  lastHpFrac = 1;
  // animation
  private mixer: AnimationMixer | null = null;
  private template: Template | null = null;
  private readonly actions = new Map<string, AnimationAction>();
  private current: AnimationAction | null = null;
  private currentKey = '';
  private lastStateTime = 0;
  private accent: MeshStandardMaterial[] = [];
  private accentColor = new Color();
  private accentHex = '';
  private glow = ACCENT_REST;
  private sockets = new Map<string, Object3D>();
  private socketNames: Record<string, string> = {};
  private outline: Group | null = null;
  disposed = false;

  constructor(v: EntityView) {
    this.id = v.id;
    this.kind = v.kind as ActorKind;
    this.def = v.def;
    this.team = v.team;
    this.owner = v.owner;
    this.root.name = `actor_${v.kind}_${v.id}`;
    this.px = this.cx = this.x = v.x;
    this.py = this.cy = this.y = v.y;
    this.ph = this.ch = this.h = v.height;
    this.pf = this.cf = this.facing = v.facing;
    this.radius = v.radius;
  }

  configureFighter(def: FighterDefT): void {
    this.artHeight = def.art.height * def.art.scale;
    this.barHeight = this.artHeight + 0.35;
    this.runRef = def.art.runRefSpeed;
    this.attackWindup = def.attack.windup;
    this.socketNames = def.art.sockets;
  }
  configureUnit(def: UnitDefT): void {
    this.artHeight = def.art.height * def.art.scale;
    this.barHeight = this.artHeight + 0.35;
    this.runRef = Math.max(0.5, def.base.moveSpeed ?? 3);
    this.attackWindup = def.attack?.windup ?? 0.3;
    // a unit ability whose blow lands as a delayed area (a boss's telegraphed slam): its cast clip keeps playing
    // through the delay and its impact lands on release + delay, not on release
    this.castHold.clear();
    def.abilities.forEach((a, i) => {
      const area = (a.effects as { op?: string; delay?: number }[] | undefined)?.find((e) => e.op === 'area' && (e.delay ?? 0) > 0);
      if (area) this.castHold.set(`cast_a${i + 1}`, area.delay ?? 0);
    });
  }

  /** attach the loaded template (async); safe after dispose */
  attach(t: Template | null, scale: number, accentName: string): void {
    if (this.disposed || !t) return;
    this.template = t;
    this.dev = t.dev;
    const model = t.clips.size > 0 || hasSkin(t.scene) ? cloneSkinned(t.scene) : t.scene.clone(true);
    const s = scale * t.fit;
    model.scale.setScalar(s);
    this.accent = [];
    model.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      if ((m as SkinnedMesh).isSkinnedMesh) m.frustumCulled = false;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const next = mats.map((mat) => {
        if (mat.name !== accentName) return mat;
        const c = (mat as MeshStandardMaterial).clone();
        patchWorldMaterial(c, { fighter: this.kind === 'fighter' });
        this.accent.push(c);
        return c;
      });
      m.material = Array.isArray(m.material) ? next : next[0];
    });
    // form-swapped parts (CONTRACT §12): nodes named form_<id> show in that form, form_base when in none
    this.formNodes = new Map();
    model.traverse((o) => {
      const m = /^form_([a-z0-9]+(?:_[a-z0-9]+)*?)(?:[._]\d+)?$/i.exec(o.name);
      if (!m) return;
      const k = m[1].toLowerCase();
      (this.formNodes.get(k) ?? this.formNodes.set(k, []).get(k)!).push(o);
    });
    this.shownForm = undefined;
    this.model = model;
    this.root.add(model);
    if (t.clips.size > 0) this.mixer = new AnimationMixer(model);
    for (const [k, bone] of Object.entries(this.socketNames)) {
      const o = model.getObjectByName(PropertyBinding.sanitizeNodeName(bone)) ?? model.getObjectByName(bone);
      if (o) this.sockets.set(k, o);
    }
    this.accentHex = '';
  }

  /** form id → model nodes shown only in that form ('base' = no form) */
  private formNodes = new Map<string, Object3D[]>();
  private shownForm: string | null | undefined = undefined;

  /** show the nodes of the current form (a form without its own nodes keeps the base ones) */
  private applyForm(form: string | null): void {
    if (form === this.shownForm || this.formNodes.size === 0) return;
    this.shownForm = form;
    const want = form && this.formNodes.has(form) ? form : 'base';
    for (const [k, nodes] of this.formNodes) for (const n of nodes) n.visible = k === want;
  }

  /** world position of a socket (falls back to the body centre) */
  socket(name: string, out: Vector3): Vector3 {
    const o = this.sockets.get(name);
    if (o) { o.updateWorldMatrix(true, false); return out.setFromMatrixPosition(o.matrixWorld); }
    return out.set(this.x, this.h + this.artHeight * 0.55, this.y);
  }

  /** a new sim tick arrived */
  pushTick(v: EntityView, tick: number): void {
    this.view = v;
    this.applyForm(v.form ?? null);
    this.team = v.team;
    this.owner = v.owner;
    this.radius = v.radius;
    if (this.seenTick < 0) {
      this.px = this.cx = v.x; this.py = this.cy = v.y; this.ph = this.ch = v.height; this.pf = this.cf = v.facing;
    } else {
      const jump = Math.hypot(v.x - this.cx, v.y - this.cy) > SNAP_DIST;
      if (jump) { this.px = v.x; this.py = v.y; this.ph = v.height; this.pf = v.facing; } else { this.px = this.cx; this.py = this.cy; this.ph = this.ch; this.pf = this.cf; }
      this.cx = v.x; this.cy = v.y; this.ch = v.height; this.cf = v.facing;
    }
    this.seenTick = tick;
  }

  setAccentColor(hex: string, c: Color): void {
    if (hex === this.accentHex) return;
    this.accentHex = hex;
    this.accentColor.copy(c);
    for (const m of this.accent) {
      m.color.copy(c).multiplyScalar(0.3);
      m.emissive.copy(c);
      m.emissiveIntensity = this.glow;
    }
  }

  /** interpolate + animate; dt real seconds, alpha the sim interpolation fraction */
  update(dt: number, alpha: number): void {
    const a = Math.max(0, Math.min(1, alpha));
    this.x = this.px + (this.cx - this.px) * a;
    this.y = this.py + (this.cy - this.py) * a;
    this.h = this.ph + (this.ch - this.ph) * a;
    this.facing = lerpAngle(this.pf, this.cf, a);
    this.root.position.set(this.x, this.h, this.y);
    this.root.rotation.y = Math.PI / 2 - this.facing;
    if (this.leaving >= 0) {
      this.leaving += dt;
      const k = Math.min(1, this.leaving / 0.6);
      this.root.position.y -= k * k * 0.5;
    }
    const v = this.view;
    if (!v) return;

    // accent: rest ≤ 0.8; wind-ups (cast before release) ramp above the bloom threshold
    const windup = v.state === 'cast' && v.stateDuration > 0 ? Math.min(1, (v.stateTime + a * TICK_DT) / Math.max(0.05, v.stateDuration)) : 0;
    const peak = Math.max(ACCENT_WINDUP_MIN, 1.35 / Math.max(0.05, luma(this.accentColor)));
    const target = v.alive && windup > 0 ? ACCENT_REST + (peak - ACCENT_REST) * Math.min(1, windup * 1.6) : ACCENT_REST;
    this.glow += (target - this.glow) * Math.min(1, dt * 18);
    for (const m of this.accent) m.emissiveIntensity = this.glow;

    if (this.mixer && this.template) this.animate(v, dt, a);
  }

  private clipFor(role: string): AnimationClip | null {
    const t = this.template!;
    const tryRole = (r: string): AnimationClip | null => {
      const name = t.roles[r];
      return (name && t.clips.get(name)) || t.clips.get(r) || null;
    };
    const chain: Record<string, string[]> = {
      crit: ['crit', 'attack2', 'attack1'], attack2: ['attack2', 'attack1'], attack1: ['attack1', 'attack2'],
      cast_a1: ['cast_a1', 'cast_a2', 'attack1'], cast_a2: ['cast_a2', 'cast_a1', 'attack1'], cast_a3: ['cast_a3', 'cast_a1', 'attack1'],
      cast_ult: ['cast_ult', 'cast_a1', 'attack1'], channel: ['channel', 'cast_a1', 'idle'], dash: ['dash', 'run'],
      stunned: ['stunned', 'idle'], recall: ['recall', 'channel', 'idle'], death: ['death'], run: ['run', 'idle'], idle: ['idle'],
      idle_lobby: ['idle_lobby', 'idle'], victory: ['victory', 'idle_lobby', 'idle'], spawn: ['spawn', 'idle'], taunt: ['taunt', 'idle'],
    };
    for (const r of chain[role] ?? [role, 'idle']) { const c = tryRole(r); if (c) return c; }
    return null;
  }

  private action(role: string): AnimationAction | null {
    let act = this.actions.get(role);
    if (act) return act;
    const clip = this.clipFor(role);
    if (!clip || !this.mixer) return null;
    act = this.mixer.clipAction(clip);
    if (LOOPING.has(role) || role === 'run' || role === 'idle') act.setLoop(LoopRepeat, Infinity);
    else { act.setLoop(LoopOnce, 1); act.clampWhenFinished = true; }
    this.actions.set(role, act);
    return act;
  }

  private roleOf(v: EntityView): string {
    switch (v.state) {
      case 'idle': return 'idle';
      case 'move': return 'run';
      case 'attack': return v.anim === 'crit' || v.anim === 'attack2' ? v.anim : 'attack1';
      case 'cast': return v.anim && v.anim !== 'cast' ? v.anim : 'cast_a1';
      case 'channel': return 'channel';
      case 'dash': return v.anim === 'stunned' ? 'stunned' : v.anim || 'dash';
      case 'stunned': return 'stunned';
      case 'dead': return 'death';
      case 'recall': return 'recall';
      default: return 'idle';
    }
  }

  /** unit cast role -> its delayed area's delay (s) */
  private readonly castHold = new Map<string, number>();
  /** a held cast clip playing on after its cast state: role, seconds since the cast began, impact time */
  private hold: { role: string; t: number; impact: number } | null = null;

  /** drive the clip for one frame */
  private animate(v: EntityView, dt: number, alpha: number): void {
    let role = this.roleOf(v);
    // held casts: entering a held cast starts the hold; afterwards idle/run keep the cast clip until it ends
    const delay = this.castHold.get(role);
    if (v.state === 'cast' && delay !== undefined) {
      if (!this.hold || this.hold.role !== role || v.stateTime < this.hold.t - 0.25) {
        this.hold = { role, t: v.stateTime, impact: Math.max(0.05, v.stateDuration) + delay };
      } else this.hold.t = v.stateTime;
    } else if (this.hold) {
      this.hold.t += dt;
      const clip = this.action(this.hold.role)?.getClip();
      const end = this.hold.impact / IMPACT_AT * (clip ? 1 : 0);
      if ((v.state === 'idle' || v.state === 'move') && this.hold.t < end) role = this.hold.role;
      else this.hold = null;
    }
    const restarted = v.stateTime + 1e-6 < this.lastStateTime;
    this.lastStateTime = v.stateTime;
    const key = role;
    let act = this.current;
    const held = !!this.hold && v.state !== 'cast' && role === this.hold.role;     // a held cast must not restart
    if (key !== this.currentKey || (restarted && !held && !LOOPING.has(role) && role !== 'run' && role !== 'death')) {
      const next = this.action(role);
      if (next) {
        const fade = role.startsWith('attack') || role === 'crit' ? 0.06 : 0.1;
        next.reset();
        next.enabled = true;
        next.setEffectiveWeight(1);
        if (this.current && this.current !== next) next.crossFadeFrom(this.current, fade, false);
        else next.fadeIn(fade);
        next.play();
        act = next;
      }
      this.current = act;
      this.currentKey = key;
    }
    if (act) {
      const clipDur = act.getClip().duration || 1;
      const st = v.stateTime + (v.state === 'dead' ? 0 : alpha * TICK_DT);
      if (role === 'run') {
        const speed = Math.hypot(v.vx, v.vy);
        act.timeScale = Math.max(0.35, Math.min(2.2, speed / Math.max(0.1, this.runRef)));
      } else if (role.startsWith('attack') || role === 'crit') {
        const impact = Math.max(0.05, this.attackWindup * (v.stateDuration || 1));
        act.timeScale = 0;
        act.time = Math.min(clipDur - 1e-3, st * (IMPACT_AT * clipDur) / impact);
      } else if (this.hold && role === this.hold.role) {
        // a held cast: the clip's impact (40 %) lands on release + the area's delay, then follows through
        act.timeScale = 0;
        act.time = Math.min(clipDur - 1e-3, this.hold.t * (IMPACT_AT * clipDur) / this.hold.impact);
      } else if (role.startsWith('cast_') && v.state === 'cast') {
        const impact = v.stateDuration > 0.02 ? v.stateDuration : 0.25;
        act.timeScale = 0;
        // past the release (stateDuration), keep playing the follow-through at the same rate
        act.time = Math.min(clipDur - 1e-3, st * (IMPACT_AT * clipDur) / impact);
      } else if (role === 'dash' && v.stateDuration > 0) {
        act.timeScale = 0;
        act.time = Math.min(clipDur - 1e-3, (st / v.stateDuration) * clipDur);
      } else if (role === 'death') {
        act.timeScale = 1; // plays once, clampWhenFinished holds the last frame
      } else {
        act.timeScale = 1;
      }
    }
    this.mixer!.update(dt);
  }

  /** showcase (menu plinth): loop one role regardless of any view */
  pose(role: string, dt: number): void {
    if (!this.mixer || !this.template) return;
    if (this.currentKey !== role) {
      const next = this.action(role);
      if (next) {
        next.reset(); next.setLoop(LoopRepeat, Infinity); next.enabled = true; next.setEffectiveWeight(1);
        if (this.current && this.current !== next) next.crossFadeFrom(this.current, 0.2, false); else next.fadeIn(0.2);
        next.play();
        this.current = next;
      }
      this.currentKey = role;
    }
    this.mixer.update(dt);
  }

  /** inverted-hull outline (hover); width in pixels, colour linear */
  setOutline(on: boolean, color: Color, resolution: Vector2): void {
    if (!this.model) return;
    if (!on) { if (this.outline) this.outline.visible = false; return; }
    if (!this.outline) {
      const g = new Group();
      const mat = new MeshBasicMaterial({ color, side: BackSide, depthWrite: true });
      const u = { uOutlinePx: { value: 2.5 }, uOutlineRes: { value: resolution } };
      mat.onBeforeCompile = (sh: WebGLProgramParametersWithUniforms) => {
        Object.assign(sh.uniforms, u);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uOutlinePx; uniform vec2 uOutlineRes;')
          .replace('#include <project_vertex>', `#include <project_vertex>
{
  #ifdef USE_SKINNING
  vec3 vn = normalize( normalMatrix * objectNormal );
  #else
  vec3 vn = normalize( normalMatrix * normal );
  #endif
  vec2 dir = normalize( ( projectionMatrix * vec4( vn, 0.0 ) ).xy + 1e-5 );
  gl_Position.xy += dir * uOutlinePx * 2.0 / uOutlineRes * gl_Position.w;
}`);
      };
      mat.customProgramCacheKey = () => 'vale_outline_v1';
      this.model.updateMatrixWorld(true);
      this.model.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        let copy: Mesh;
        if ((m as SkinnedMesh).isSkinnedMesh) {
          const sm = m as SkinnedMesh;
          const c = new SkinnedMesh(sm.geometry, mat);
          c.bind(sm.skeleton, sm.bindMatrix);
          c.frustumCulled = false;
          copy = c;
        } else {
          copy = new Mesh(m.geometry, mat);
        }
        copy.castShadow = false; copy.receiveShadow = false;
        copy.renderOrder = -1;
        m.add(copy);
        g.userData.copies = (g.userData.copies ?? 0) + 1;
      });
      g.userData.mat = mat;
      this.outline = g;
    }
    this.outline.visible = true;
    const mat = this.outline.userData.mat as MeshBasicMaterial;
    mat.color.copy(color);
    this.model.traverse((o) => { if ((o as Mesh).isMesh && (o as Mesh).material === mat) o.visible = true; });
  }
  hideOutline(): void {
    if (!this.outline || !this.model) return;
    const mat = this.outline.userData.mat as MeshBasicMaterial;
    this.model.traverse((o) => { if ((o as Mesh).isMesh && (o as Mesh).material === mat) o.visible = false; });
  }

  dispose(): void {
    this.disposed = true;
    this.mixer?.stopAllAction();
    if (this.mixer && this.model) this.mixer.uncacheRoot(this.model);
    this.mixer = null;
    // each clone owns its Skeleton, whose bone texture lives on the GPU until disposed (geometry and the
    // shared materials belong to the cached template and stay)
    this.model?.traverse((o) => { const sm = o as SkinnedMesh; if (sm.isSkinnedMesh) sm.skeleton.dispose(); });
    for (const m of this.accent) m.dispose();
    if (this.outline) (this.outline.userData.mat as MeshBasicMaterial).dispose();
    this.root.removeFromParent();
  }
}

function hasSkin(o: Object3D): boolean {
  let s = false;
  o.traverse((x) => { if ((x as SkinnedMesh).isSkinnedMesh) s = true; });
  return s;
}

/** relationship-coloured accents for every actor (called when the palette or a team changes) */
export function accentHexFor(palette: Palette, v: { team: TeamId; owner: number; kind: string }): string {
  return palette.unitHex(v.team, v.owner, v.kind === 'fighter');
}

export const _vec = new Vector3();
