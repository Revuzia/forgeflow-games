/// <reference types="vite/client" />
// HIT PARADE - BRAWL BREAK / HECKLER TOSS presentation (CONTRACT §4.3 item 14, §7 BRAWL camera, §26.4 CHANGED(VIEW)).
//
//   * Goons: MatchSnap.goons (SIM, §26.4 shape) drawn with lane ASSETS' goon bodies (art/gltf/**/goon_*.glb; each a
//     rigged body with the shared clip set). Up to 8 pooled GoonViews, created at load (warmed with the bout). A goon is
//     posed from its snapshot exactly like a fighter (animId / animFrame against the shared-clip table, or a clip name +
//     frame), mirrored by facing, tinted per slot so a wave does not read as clones; a downed goon lies, then fades.
//     Until ASSETS ships goon GLBs the pool uses the round's opponent body (tinted studio-grey) and says so (`fallback`).
//   * Heckle objects (tomato / bottle / shoe / chair) are MatchSnap.proj kind 2 -> view/projectiles.ts.
//   * Score popups: SCORE events (a = player, b = points; UI §22.1) become popups anchored at the last downed goon / parried
//     object / the player's chest; `BoutView.popups()` returns them with live SCREEN positions every frame, for the UI to
//     draw (the view draws no text itself: copy stays in the UI's strings).
//   * The camera frames the player plus the goons within reach (BoutView feeds the BRAWL rig the cluster extents).

import * as THREE from 'three';
import type { Assets, FighterAsset } from './assets.ts';
import { PoseDriver } from './anim.ts';
import { SYSTEM_CLIPS, animSeconds } from './animtable.ts';
import { profileForBody, toonify, type ToonHandle } from './toon.ts';
import type { FxSystem } from './fx.ts';
import type { AnimRef, ViewGoon } from './types.ts';

const GOON_GLBS = import.meta.glob('../../../art/gltf/**/goon_*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const DEG = Math.PI / 180;
const TINTS = [0, 0.35, -0.3, 0.7, -0.6, 1.1, -1.0, 1.6];

/** a score popup for the UI: points (negative = a heckle hit), reason = SCORE `d` (§28.4), screen x / y (0..1, y down) */
export interface Popup { id: number; points: number; player: number; reason: number; total: number; x: number; y: number; wx: number; wy: number; age: number }

class GoonView {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly pose: PoseDriver;
  readonly toon: ToonHandle;
  readonly heightM: number;
  kindId: string;
  alive = false;
  downFor = 0;
  constructor(assets: Assets, a: FighterAsset, tint: number, kindId: string) {
    this.kindId = kindId;
    this.model = assets.instantiate(a);
    const k = 1.8 / Math.max(0.5, a.heightM);
    if (Math.abs(1 - k) > 0.08) this.model.scale.multiplyScalar(k);
    this.heightM = a.heightM * (Math.abs(1 - k) > 0.08 ? k : 1);
    this.root.add(this.model);
    this.toon = toonify(this.model, { profile: profileForBody(a.id), hueShift: tint, outline: true });
    this.pose = new PoseDriver(this.model, a.clips);
    this.root.visible = false;
  }
}

export class BrawlView {
  readonly group = new THREE.Group();
  readonly fallback: boolean;
  private readonly goons: GoonView[] = [];
  private readonly bySlot = new Map<number, GoonView>();
  private readonly fx: FxSystem;
  private popupsL: Popup[] = [];
  private nextId = 1;
  private readonly tmp = new THREE.Vector3();
  private lastDown = new THREE.Vector3(0, 1.1, 0);
  private tables: Readonly<Record<string, ReadonlyArray<AnimRef>>> = {};
  readonly stats = { goons: 0, downs: 0, popups: 0, kinds: [] as string[] };

  private constructor(fx: FxSystem, fallback: boolean) { this.fx = fx; this.fallback = fallback; this.group.name = 'brawl'; }

  /** load up to 8 goon bodies (ASSETS goon_* GLBs, else the opponent body) */
  static async create(assets: Assets, fx: FxSystem, fallbackAsset: FighterAsset | null, tables?: Readonly<Record<string, ReadonlyArray<AnimRef>>>): Promise<BrawlView> {
    const urls = Object.entries(GOON_GLBS).map(([k, url]) => ({ id: k.slice(k.lastIndexOf('/') + 1).replace(/\.glb$/i, ''), url })).sort((a, b) => a.id.localeCompare(b.id));
    const bodies: FighterAsset[] = [];
    for (const u of urls) {
      try { assets.setUrl('fighter', u.id, u.url); bodies.push(await assets.fighter(u.id)); }
      catch (e) { console.warn(`[view] goon body ${u.id} failed:`, e); }
    }
    const fb = !bodies.length;
    if (fb && fallbackAsset) bodies.push(fallbackAsset);
    const v = new BrawlView(fx, fb);
    v.tables = tables ?? {};
    for (let i = 0; i < 8 && bodies.length; i++) {
      const a = bodies[i % bodies.length];
      const g = new GoonView(assets, a, fb ? 0.9 + TINTS[i] * 0.2 : TINTS[i] * 0.25, a.id);
      g.root.name = 'goon:' + i;
      v.goons.push(g);
      v.group.add(g.root);
    }
    v.stats.goons = v.goons.length;
    v.stats.kinds = [...new Set(bodies.map((b) => b.id))];
    if (fb) console.warn('[view] BRAWL: no goon_* GLB in art/gltf yet; goons use the opponent body (stand-in)');
    return v;
  }

  /** place / pose every goon from the snapshot list */
  frame(list: ReadonlyArray<ViewGoon> | undefined, dt: number, time: number): void {
    const seen = new Set<number>();
    for (const s of list ?? []) {
      if (s.alive === false || s.alive === 0) continue;
      seen.add(s.slot);
      let g = this.bySlot.get(s.slot);
      if (!g) {
        const want = typeof s.kind === 'string' ? s.kind : null;
        g = this.goons.find((x) => !x.alive && (!want || x.kindId === want)) ?? this.goons.find((x) => !x.alive);
        if (!g) continue;
        g.alive = true; g.downFor = 0;
        this.bySlot.set(s.slot, g);
      }
      const facing = (s.facing ?? 1) < 0 ? -1 : 1;
      g.root.visible = true;
      g.root.position.set(s.x, s.y ?? 0, 0);
      g.root.rotation.set(0, facing * 90 * DEG, 0);
      g.root.scale.set(facing < 0 ? -1 : 1, 1, 1);
      const down = s.down === true || s.down === 1;
      const table = typeof s.kind === 'string' ? this.tables[s.kind] : undefined;
      if (s.clip) g.pose.poseClip(s.clip, (s.clipFrame ?? 0) / 60);
      else if (table && typeof s.animId === 'number' && s.animId >= 0 && s.animId < table.length) {
        // §28.4 goon anim ids on the goon's own table (34 shared + the goon moves), blended like a fighter (§17)
        const e = table[s.animId];
        const w = Math.max(0, Math.min(1, s.blendT ?? 1));
        const list = [{ clip: e.clip, t: animSeconds(e, s.animFrame ?? 0, g.pose.dur(e.clip)), w }];
        const pe = typeof s.prevAnimId === 'number' && s.prevAnimId >= 0 && s.prevAnimId < table.length ? table[s.prevAnimId] : null;
        if (pe && w < 1) list.push({ clip: pe.clip, t: animSeconds(pe, s.prevAnimFrame ?? 0, g.pose.dur(pe.clip)), w: 1 - w });
        g.pose.poseWeighted(list);
      } else if (typeof s.animId === 'number' && s.animId >= 0 && s.animId < SYSTEM_CLIPS.length) {
        const clip = SYSTEM_CLIPS[s.animId];
        const loop = /^(idle|walk_f|walk_b|crouch_idle|block_high|block_low|dizzy|kd_ground_b|kd_ground_f)$/.test(clip);
        g.pose.poseWeighted([{ clip, t: g.pose.clipTime(clip, (s.animFrame ?? 0) / 60, loop), w: 1 }]);
      } else g.pose.poseClip(down ? 'kd_ground_b' : 'idle', time);
      const hs = s.hitstop ?? 0;
      g.model.position.set(0, 0, hs > 0 ? ((Math.floor(time * 30) & 1) ? 0.02 : -0.02) * facing : 0);
      if (down) { g.downFor += dt; if (g.downFor > 1.2) g.root.visible = (Math.floor(time * 12) & 1) === 0; }
    }
    for (const [slot, g] of this.bySlot) {
      if (seen.has(slot)) continue;
      g.alive = false; g.root.visible = false; this.bySlot.delete(slot);
    }
  }

  /** GOON_DOWN (a = goon slot) -> a big comic burst where it fell */
  goonDown(slot: number): void {
    const g = this.bySlot.get(slot);
    if (!g) return;
    this.stats.downs++;
    this.tmp.set(g.root.position.x, 1.0, 0.1);
    this.lastDown.copy(this.tmp);
    this.fx.dust(this.tmp.set(g.root.position.x, 0.05, 0.1), 1.2);
    this.fx.sparkle(this.lastDown, 18);
  }

  /** a SCORE event (§28.4: b delta, c running total, d reason): a popup at `at`, else the last goon down */
  score(points: number, player: number, at: THREE.Vector3 | null, reason = 0, total = 0): void {
    const w = at ?? this.lastDown;
    this.popupsL.push({ id: this.nextId++, points, player, reason, total, x: 0, y: 0, wx: w.x, wy: w.y + 0.4, age: 0 });
    if (this.popupsL.length > 12) this.popupsL.shift();
    this.stats.popups++;
  }

  /** age popups and project them to screen fractions (0..1, y from the top) */
  updatePopups(dt: number, cam: THREE.Camera): void {
    for (const p of this.popupsL) {
      p.age += dt;
      this.tmp.set(p.wx, p.wy + p.age * 0.6, 0).project(cam);
      p.x = Math.round((this.tmp.x * 0.5 + 0.5) * 1000) / 1000;
      p.y = Math.round((0.5 - this.tmp.y * 0.5) * 1000) / 1000;
    }
    this.popupsL = this.popupsL.filter((p) => p.age < 1.4);
  }

  popups(): ReadonlyArray<Popup> { return this.popupsL; }

  /** a goon's chest (FX anchor for hits on goons: event fields 8 + slot) */
  goonChest(slot: number, out: THREE.Vector3): boolean {
    const g = this.bySlot.get(slot);
    if (!g) return false;
    out.set(g.root.position.x, g.root.position.y + g.heightM * 0.68, 0.1);
    return true;
  }

  /** live goon x positions (camera framing) */
  goonXs(out: number[]): number[] {
    out.length = 0;
    for (const g of this.bySlot.values()) if (g.alive && g.root.visible) out.push(g.root.position.x);
    return out;
  }

  info(): Record<string, unknown> { return { ...this.stats, fallback: this.fallback, active: this.bySlot.size, popups: this.popupsL.length }; }

  dispose(): void {
    for (const g of this.goons) { g.pose.dispose(); g.toon.dispose(); }
    this.group.removeFromParent();
  }
}
