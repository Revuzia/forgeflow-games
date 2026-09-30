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
const POOL_PER_KIND = 4;

/** a score popup for the UI: points (negative = a heckle hit), reason = SCORE `d` (§28.4), screen x / y (0..1, y down) */
export interface Popup { id: number; points: number; player: number; reason: number; total: number; x: number; y: number; wx: number; wy: number; age: number }

/** depth stagger (m) for goons waiting in the approach ring, per slot: a wave on one side of the line does not read as
 *  one body walking through another (the sim keeps goons on the fight line; an attacking goon comes back to z 0) */
const STAGGER = [0, -0.55, 0.35, -0.3, 0.55, -0.7, 0.2, -0.45];

/** an in-canvas score popup (numbers only - no copy): a comic sprite that rises and fades with the popup's age */
class PopSprite {
  readonly canvas = document.createElement('canvas');
  readonly tex: THREE.CanvasTexture;
  readonly sprite: THREE.Sprite;
  id = -1;
  constructor() {
    this.canvas.width = 256; this.canvas.height = 128;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
    this.sprite = new THREE.Sprite(m);
    this.sprite.renderOrder = 50;
    this.sprite.visible = false;
    this.sprite.scale.set(0.95, 0.475, 1);
  }
  paint(points: number): void {
    const g = this.canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, 256, 128);
    const fam = (() => { try { return document.fonts && document.fonts.check("40px 'Bungee'") ? "'Bungee', Impact, sans-serif" : "Impact, 'Arial Black', sans-serif"; } catch { return "Impact, 'Arial Black', sans-serif"; } })();
    const txt = (points > 0 ? '+' : points < 0 ? '-' : '') + Math.abs(Math.round(points));
    let size = 76;
    g.font = `${size}px ${fam}`;
    while (size > 30 && g.measureText(txt).width > 236) { size -= 4; g.font = `${size}px ${fam}`; }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = 12; g.strokeStyle = '#111';
    g.strokeText(txt, 128, 68);
    g.fillStyle = points < 0 ? '#ff3a4a' : '#ffd21a';
    g.fillText(txt, 128, 64);
    this.tex.needsUpdate = true;
  }
  dispose(): void { this.tex.dispose(); (this.sprite.material as THREE.SpriteMaterial).dispose(); }
}

class GoonView {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly pose: PoseDriver;
  readonly toon: ToonHandle;
  readonly heightM: number;
  kindId: string;
  z = 0;
  /** the sim kind of the slot this view shows (read-back: must equal kindId unless the pool had to borrow) */
  simKind = '';
  alive = false;
  downFor = 0;
  constructor(assets: Assets, a: FighterAsset, tint: number, kindId: string, standIn: boolean) {
    this.kindId = kindId;
    this.model = assets.instantiate(a);
    // a real goon body keeps its true size (1.78-1.95 m, same hurt / push boxes in the sim); only the stand-in (the
    // round's opponent, up to 2.4 m) is brought to goon size
    const k = standIn ? 1.8 / Math.max(0.5, a.heightM) : 1;
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
  private readonly pops: PopSprite[] = [];
  private readonly zTargets = new Map<number, number>();
  /** the view draws the numeric popups itself (no UI consumer of popups() exists); a UI that draws its own sets false */
  drawPopups = true;
  private nextId = 1;
  private readonly tmp = new THREE.Vector3();
  private lastDown = new THREE.Vector3(0, 1.1, 0);
  private tables: Readonly<Record<string, ReadonlyArray<AnimRef>>> = {};
  /** borrowed = a goon shown on another kind's body (pool of that kind exhausted); 0 is the expectation */
  readonly stats = { goons: 0, downs: 0, popups: 0, kinds: [] as string[], borrowed: 0, drawn: 0 };

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
    // the pool: POOL_PER_KIND views per goon body (brawl.maxActive 4 alive + the downed ones still fading, so a wave of
    // one kind never borrows another kind's body), or 8 of the stand-in body
    const n = fb ? 8 : bodies.length * POOL_PER_KIND;
    for (let i = 0; i < n && bodies.length; i++) {
      const a = fb ? bodies[0] : bodies[Math.floor(i / POOL_PER_KIND)];
      const t = TINTS[i % TINTS.length];
      const g = new GoonView(assets, a, fb ? 0.9 + t * 0.2 : t * 0.2, a.id, fb);
      g.root.name = 'goon:' + i;
      v.goons.push(g);
      v.group.add(g.root);
    }
    for (let i = 0; i < 12; i++) { const ps = new PopSprite(); v.pops.push(ps); v.group.add(ps.sprite); }
    v.stats.goons = v.goons.length;
    v.stats.kinds = [...new Set(bodies.map((b) => b.id))];
    if (fb) console.warn('[view] BRAWL: no goon_* GLB in art/gltf yet; goons use the opponent body (stand-in)');
    return v;
  }

  /** place / pose every goon from the snapshot list */
  frame(list: ReadonlyArray<ViewGoon> | undefined, dt: number, time: number, px = 0): void {
    const seen = new Set<number>();
    // depth targets: goons waiting in the ring are staggered; engaged ones (token / telegraph / hit / down) come to the
    // line - except one that overlaps a goon NEARER the player on the same side (|dx| < 0.7 m): it steps back in depth,
    // so a kick from behind passes beside the goon in front instead of through it (seen in the real game: a hardhat's
    // goon_kick went through the medic; the sim keeps every goon on the line)
    const zt = this.zTargets;
    zt.clear();
    const order = (list ?? []).filter((s) => !(s.alive === false || s.alive === 0)).sort((a, b) => Math.abs(a.x - px) - Math.abs(b.x - px));
    for (let i = 0; i < order.length; i++) {
      const s = order[i];
      const onLine = !!s.token || !!s.telegraph || (s.hitstop ?? 0) > 0 || s.down === true || s.down === 1 || /^(hit|kd|ko|wake|block)/.test(s.stateName ?? '');
      let z = onLine ? 0 : STAGGER[s.slot % STAGGER.length];
      for (let j = 0; j < i; j++) {
        const o = order[j], oz = zt.get(o.slot) ?? 0;
        if (Math.abs(o.x - s.x) < 0.7 && Math.sign(o.x - px) === Math.sign(s.x - px) && Math.abs(oz - z) < 0.45) z = Math.max(-1.2, oz - 0.55);
      }
      zt.set(s.slot, z);
    }
    for (const s of list ?? []) {
      if (s.alive === false || s.alive === 0) continue;
      seen.add(s.slot);
      let g = this.bySlot.get(s.slot);
      if (!g) {
        const want = typeof s.kind === 'string' ? s.kind : null;
        g = this.goons.find((x) => !x.alive && (!want || x.kindId === want));
        if (!g) { g = this.goons.find((x) => !x.alive); if (g && want && !this.fallback) this.stats.borrowed++; }
        if (!g) continue;
        g.alive = true; g.downFor = 0; g.simKind = want ?? '';
        g.z = STAGGER[s.slot % STAGGER.length];
        this.bySlot.set(s.slot, g);
      }
      const facing = (s.facing ?? 1) < 0 ? -1 : 1;
      g.root.visible = true;
      g.z += ((zt.get(s.slot) ?? 0) - g.z) * Math.min(1, dt * 5);
      g.root.position.set(s.x, s.y ?? 0, g.z);
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

  /** age popups and project them to screen fractions (0..1, y from the top); the in-canvas sprites follow */
  updatePopups(dt: number, cam: THREE.Camera): void {
    for (const p of this.popupsL) {
      p.age += dt;
      this.tmp.set(p.wx, p.wy + p.age * 0.6, 0).project(cam);
      p.x = Math.round((this.tmp.x * 0.5 + 0.5) * 1000) / 1000;
      p.y = Math.round((0.5 - this.tmp.y * 0.5) * 1000) / 1000;
    }
    this.popupsL = this.popupsL.filter((p) => p.age < 1.4);
    // sprites: one per live popup (painted once), a pop-in scale, a rise, a fade over the last 0.4 s
    for (const ps of this.pops) if (!this.drawPopups || !this.popupsL.some((p) => p.id === ps.id)) { ps.sprite.visible = false; ps.id = -1; }
    if (!this.drawPopups) return;
    this.stats.drawn = 0;
    for (let k = 0; k < this.popupsL.length; k++) {
      const p = this.popupsL[k];
      let ps = this.pops.find((x) => x.id === p.id);
      if (!ps) { ps = this.pops.find((x) => x.id < 0); if (!ps) continue; ps.id = p.id; ps.paint(p.points); }
      const pop = p.age < 0.12 ? 0.6 + 0.4 * (p.age / 0.12) * 1.25 : 1;
      ps.sprite.visible = true;
      ps.sprite.position.set(p.wx, p.wy + 0.25 + p.age * 0.6 + (k % 2) * 0.18, 0.4);
      ps.sprite.scale.set(0.95 * pop, 0.475 * pop, 1);
      (ps.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, Math.min(1, (1.4 - p.age) / 0.4));
      this.stats.drawn++;
    }
  }

  popups(): ReadonlyArray<Popup> { return this.popupsL; }

  /** a goon's chest (FX anchor for hits on goons: event fields 8 + slot) */
  goonChest(slot: number, out: THREE.Vector3): boolean {
    const g = this.bySlot.get(slot);
    if (!g) return false;
    out.set(g.root.position.x, g.root.position.y + g.heightM * 0.68, g.root.position.z + 0.1);
    return true;
  }

  /** live goon x positions (camera framing) */
  goonXs(out: number[]): number[] {
    out.length = 0;
    for (const g of this.bySlot.values()) if (g.alive && g.root.visible) out.push(g.root.position.x);
    return out;
  }

  info(): Record<string, unknown> {
    const live = [...this.bySlot].map(([slot, g]) => ({ slot, sim: g.simKind, body: g.kindId, clip: g.pose.last.clip, h: +g.heightM.toFixed(2), vis: g.root.visible }));
    return { ...this.stats, fallback: this.fallback, active: this.bySlot.size, popups: this.popupsL.length, live };
  }

  dispose(): void {
    for (const g of this.goons) { g.pose.dispose(); g.toon.dispose(); }
    for (const ps of this.pops) ps.dispose();
    this.group.removeFromParent();
  }
}
