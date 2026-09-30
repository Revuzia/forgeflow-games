// HIT PARADE - projectile visuals (CONTRACT §7 "projectile visuals per fighter", §17.1, §24.10 MatchSnap.proj, §26.5).
//
// The sim lists live projectiles each frame (MatchSnap.proj: slot, owner, x, y, vx, moveId, kind 0 projectile / 1 ball /
// 2 heckle object). The visual TYPE comes from the owner's move data `projectile.clip` (brick, card, flame, flame_breath,
// taser_bolt, football, fireball_football, saw_card, spotlight_beam, pyro_line; any other id falls back by keyword),
// kind 1 = Gazza's ball, kind 2 = heckle objects (tomato / bottle / shoe / chair by `obj` or slot). Each type is a real
// body (propmesh.ts, or an ASSETS prop GLB with the same id when shipped) or an authored particle effect (fire, beams),
// with its own launch FX (when a slot appears), trail, and impact / destroy FX (PROJ_HIT / PROJ_CLASH events, or the slot
// vanishing). Pools are built at construction for the types this match can produce, so everything is warmed.
// Pure presentation: positions come from the snapshot every frame; spin / wobble run on sim-frame-derived time.

import * as THREE from 'three';
import { FxSystem, C, CONFETTI } from './fx.ts';
import { brickMesh, cardMesh, footballMesh, sawCardMesh, taserMesh } from './propmesh.ts';
import { moveKeys } from './animtable.ts';
import type { ViewEvent, ViewGameData, ViewMatchCfg, ViewProjectile } from './types.ts';
import type { FighterView } from './fighters.ts';
import type { Assets } from './assets.ts';
import { propGlbUrl } from './props.ts';
import { EV } from './ev.ts';

export type ProjType = 'brick' | 'card' | 'saw_card' | 'flame' | 'flame_breath' | 'taser_bolt' | 'football' | 'fireball_football'
  | 'spotlight_beam' | 'pyro_line' | 'tomato' | 'bottle' | 'shoe' | 'chair' | 'orb';
export const HECKLE_TYPES: ProjType[] = ['tomato', 'bottle', 'shoe', 'chair'];

export function projTypeOf(clip: string | undefined): ProjType {
  const c = (clip ?? '').toLowerCase();
  if (c === 'brick' || /brick/.test(c)) return 'brick';
  if (c === 'saw_card' || /saw/.test(c)) return 'saw_card';
  if (/card/.test(c)) return 'card';
  if (c === 'flame_breath' || /breath/.test(c)) return 'flame_breath';
  if (c === 'fireball_football' || (/fire/.test(c) && /ball/.test(c))) return 'fireball_football';
  if (/football|ball/.test(c)) return 'football';
  if (/taser|bolt|zap/.test(c)) return 'taser_bolt';
  if (/spot|beam/.test(c)) return 'spotlight_beam';
  if (/pyro/.test(c)) return 'pyro_line';
  if (/flame|fire/.test(c)) return 'flame';
  if (/tomato/.test(c)) return 'tomato';
  if (/bottle/.test(c)) return 'bottle';
  if (/shoe|boot/.test(c)) return 'shoe';
  if (/chair/.test(c)) return 'chair';
  return 'orb';
}

// ───────────────────────────────────────── heckle object meshes ─────────────────────────────────────────

function stdMat(name: string, color: number, rough: number, metal = 0, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  m.name = name;
  return m;
}

function tomatoMesh(): THREE.Group {
  const g = new THREE.Group(); g.name = 'tomato';
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.055, 20, 14), stdMat('prop-tomato', 0xd7261e, 0.35, 0, { emissive: 0x2a0402 }));
  body.scale.set(1, 0.82, 1);
  const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.02, 5), stdMat('prop-tomato-leaf', 0x3b8f2a, 0.7));
  leaf.position.y = 0.045;
  g.add(body, leaf);
  return g;
}
function bottleMesh(): THREE.Group {
  const g = new THREE.Group(); g.name = 'bottle';
  const pts = [[0, 0], [0.032, 0], [0.034, 0.01], [0.034, 0.15], [0.03, 0.18], [0.014, 0.21], [0.013, 0.27], [0.016, 0.28], [0, 0.28]].map(([r, y]) => new THREE.Vector2(r, y));
  const glass = stdMat('prop-bottle', 0x2f7d3b, 0.15, 0.1, { transparent: true, opacity: 0.85 });
  const b = new THREE.Mesh(new THREE.LatheGeometry(pts, 16), glass);
  b.position.y = -0.14;
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0345, 0.0345, 0.06, 16, 1, true), stdMat('prop-bottle-label', 0xf2e6c8, 0.8));
  label.position.y = -0.06;
  g.add(b, label);
  return g;
}
function shoeMesh(): THREE.Group {
  const g = new THREE.Group(); g.name = 'shoe';
  const leather = stdMat('prop-shoe', 0x3a2418, 0.55, 0.05);
  const sole = stdMat('prop-shoe-sole', 0xe8e0d0, 0.8);
  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.16, 6, 12), leather);
  upper.rotation.z = Math.PI / 2; upper.scale.set(1, 1, 0.8);
  const heel = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.075), leather);
  heel.position.set(-0.075, 0.03, 0);
  const s = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.022, 0.085), sole);
  s.position.y = -0.04;
  g.add(upper, heel, s);
  return g;
}
function chairMesh(): THREE.Group {
  const g = new THREE.Group(); g.name = 'chair';
  const steel = stdMat('prop-chair-steel', 0x9aa2ad, 0.35, 0.85);
  const seatM = stdMat('prop-chair-seat', 0x243a6b, 0.6, 0.1);
  const leg = (x: number, z: number, h: number, tilt: number) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, h, 8), steel);
    m.position.set(x, -h / 2 + 0.02, z); m.rotation.x = tilt; g.add(m);
  };
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.4), seatM);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.28, 0.025), seatM);
  back.position.set(0, 0.28, -0.2); back.rotation.x = -0.12;
  g.add(seat, back);
  leg(-0.19, 0.17, 0.46, 0.2); leg(0.19, 0.17, 0.46, 0.2); leg(-0.19, -0.19, 0.9, -0.12); leg(0.19, -0.19, 0.9, -0.12);
  g.children.forEach((c) => { c.castShadow = true; });
  return g;
}

// ───────────────────────────────────────── shadows / beams ─────────────────────────────────────────

let SHADOW_TEX: THREE.CanvasTexture | null = null;
function shadowTex(): THREE.CanvasTexture {
  if (SHADOW_TEX) return SHADOW_TEX;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  SHADOW_TEX = new THREE.CanvasTexture(c);
  return SHADOW_TEX;
}

const BEAM_VERT = /* glsl */`
varying float vY; varying vec3 vN; varying vec3 vV;
void main() { vY = uv.y; vec4 wp = modelMatrix * vec4( position, 1.0 ); vN = normalize( mat3( modelMatrix ) * normal ); vV = normalize( cameraPosition - wp.xyz ); gl_Position = projectionMatrix * viewMatrix * wp; }
`;
const BEAM_FRAG = /* glsl */`
uniform vec3 uColor; uniform float uAlpha;
varying float vY; varying vec3 vN; varying vec3 vV;
void main() { float rim = abs( dot( normalize( vN ), normalize( vV ) ) ); float a = uAlpha * pow( rim, 1.6 ) * ( 0.25 + 0.75 * vY ) * smoothstep( 0.0, 0.12, vY ); gl_FragColor = vec4( uColor * a, 1.0 ); }
`;

// ───────────────────────────────────────── the view ─────────────────────────────────────────

interface Inst {
  type: ProjType;
  obj: THREE.Object3D;
  head: THREE.Object3D | null;
  shadow: THREE.Mesh | null;
  wire: THREE.Line | null;
  beam: THREE.Mesh | null;
  pool: THREE.Mesh | null;
  busy: boolean;
}
interface Live { inst: Inst; owner: number; x: number; y: number; vx: number; age: number; lastMark: number; seen: number }

const TYPE_COLOR: Record<ProjType, number> = {
  brick: 0x8a3019, card: 0xfbf8f0, saw_card: 0xd8dde6, flame: 0xff6a10, flame_breath: 0xff6a10, taser_bolt: 0x9ad8ff, football: 0xf4f2ec,
  fireball_football: 0xff6a10, spotlight_beam: 0xfff0c8, pyro_line: 0xff5a10, tomato: 0xd7261e, bottle: 0x2f7d3b, shoe: 0x3a2418, chair: 0x9aa2ad, orb: 0xffb040,
};

export class ProjectileView {
  readonly group = new THREE.Group();
  private readonly fx: FxSystem;
  private readonly fighters: [FighterView, FighterView];
  private readonly data: ViewGameData;
  private readonly cfg: ViewMatchCfg;
  private readonly pools = new Map<ProjType, Inst[]>();
  private readonly live = new Map<number, Live>();
  private readonly typeCache = new Map<string, ProjType>();
  private frameNo = 0;
  /** system.json heckler.objects ids in index order (MatchSnap.proj[].obj for kind 2, §28.3) */
  private readonly heckleIds: string[];
  private readonly v0 = new THREE.Vector3();
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  readonly stats = { spawned: 0, destroyed: 0, impacts: 0, types: [] as string[], assets: [] as string[] };

  constructor(scene: THREE.Scene, fx: FxSystem, fighters: [FighterView, FighterView], data: ViewGameData, cfg: ViewMatchCfg) {
    this.fx = fx; this.fighters = fighters; this.data = data; this.cfg = cfg;
    const objs = ((data.system as { heckler?: { objects?: Array<{ id?: string }> } } | undefined)?.heckler?.objects) ?? [];
    this.heckleIds = objs.map((o) => o.id ?? '');
    this.group.name = 'projectiles';
    const need = new Set<ProjType>();
    for (let i = 0; i < 2; i++) {
      const def = data.fighters[cfg.p[i]?.fighter ?? ''];
      for (const k of moveKeys(def)) { const m = def!.moves[k]; if (m.projectile) need.add(projTypeOf(m.projectile.clip)); }
      if ((cfg.p[i]?.fighter ?? '') === 'gazza') need.add('football');
    }
    if (cfg.mode === 'heckler' || cfg.mode === 'brawl') for (const t of HECKLE_TYPES) need.add(t);
    for (const t of need) this.pools.set(t, [this.make(t), this.make(t), ...(HECKLE_TYPES.includes(t) ? [this.make(t), this.make(t)] : [])]);
    this.stats.types = [...need];
    scene.add(this.group);
  }

  private make(t: ProjType): Inst {
    let obj: THREE.Object3D;
    let wire: THREE.Line | null = null, beam: THREE.Mesh | null = null, pool: THREE.Mesh | null = null;
    switch (t) {
      case 'brick': obj = brickMesh(); break;
      case 'card': {
        const g = new THREE.Group(); g.name = 'card_fan';
        for (let k = -1; k <= 1; k++) { const c = cardMesh(1.55); c.position.set(k * 0.02, k * 0.05, k * 0.004); c.rotation.z = k * 0.35; g.add(c); }
        obj = g; break;
      }
      case 'saw_card': obj = sawCardMesh(); break;
      case 'football': case 'fireball_football': obj = footballMesh(); break;
      case 'taser_bolt': {
        obj = taserMesh();
        const geo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 16 }, () => new THREE.Vector3()));
        const lm = new THREE.LineBasicMaterial({ color: 0xe9d27a, transparent: true, opacity: 0.9 });
        lm.name = 'prop-taser-wire';
        wire = new THREE.Line(geo, lm); wire.frustumCulled = false; wire.name = 'taser-wire';
        this.group.add(wire);
        break;
      }
      case 'spotlight_beam': {
        const cone = new THREE.CylinderGeometry(0.1, 0.75, 5.5, 32, 1, true);
        cone.translate(0, 2.75, 0);
        const m = new THREE.ShaderMaterial({ name: 'fx-spot', uniforms: { uColor: { value: new THREE.Color(1.0, 0.92, 0.72) }, uAlpha: { value: 0.6 } },
          vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
        beam = new THREE.Mesh(cone, m); beam.frustumCulled = false; beam.renderOrder = 18; beam.name = 'spot-beam';
        const pm = new THREE.MeshBasicMaterial({ map: shadowTex(), color: 0xfff2c4, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
        pm.name = 'prop-spot-pool';
        pool = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), pm); pool.rotation.x = -Math.PI / 2; pool.renderOrder = 6; pool.name = 'spot-pool';
        this.group.add(beam, pool);
        obj = new THREE.Group(); obj.name = 'spotlight_beam';
        break;
      }
      case 'tomato': obj = tomatoMesh(); break;
      case 'bottle': obj = bottleMesh(); break;
      case 'shoe': obj = shoeMesh(); break;
      case 'chair': obj = chairMesh(); break;
      default: obj = new THREE.Group(); obj.name = t;          // flame / flame_breath / pyro_line / orb: particles only
    }
    obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    let shadow: THREE.Mesh | null = null;
    if (t !== 'flame_breath' && t !== 'pyro_line' && t !== 'spotlight_beam') {
      const sm = new THREE.MeshBasicMaterial({ map: shadowTex(), transparent: true, depthWrite: false, fog: false, color: 0x000000 });
      sm.name = 'prop-shadow';
      shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), sm);
      shadow.rotation.x = -Math.PI / 2; shadow.renderOrder = 4; shadow.name = 'proj-shadow';
      this.group.add(shadow);
    }
    this.group.add(obj);
    const inst: Inst = { type: t, obj, head: null, shadow, wire, beam, pool, busy: false };
    this.hide(inst);
    return inst;
  }

  private hide(i: Inst): void {
    i.obj.visible = false;
    if (i.head) i.head.visible = false;
    if (i.shadow) i.shadow.visible = false;
    if (i.wire) i.wire.visible = false;
    if (i.beam) i.beam.visible = false;
    if (i.pool) i.pool.visible = false;
  }

  /**
   * Lane ASSETS' prop GLBs replace the view's procedural bodies where they exist (props.json `projectile: true`: brick,
   * card_fan / card, football; the `spotlight` world prop becomes the rig head above Ricky's beam). Call once after
   * construction, before the warm-up. Returns the ids used.
   */
  async useAssetBodies(assets: Assets): Promise<string[]> {
    const used: string[] = [];
    const pick = (ids: string[]) => ids.find((id) => propGlbUrl(id) !== null) ?? null;
    const load = async (id: string): Promise<THREE.Object3D | null> => {
      try { assets.setUrl('prop', id, propGlbUrl(id)!); return await assets.prop(id); } catch (e) { console.warn('[view] projectile prop', id, e); return null; }
    };
    const centred = (o: THREE.Object3D, name: string): THREE.Object3D => {
      const g = new THREE.Group(); g.name = name;
      const box = new THREE.Box3().setFromObject(o);
      const c = box.getCenter(new THREE.Vector3());
      o.position.sub(c);
      g.add(o);
      g.traverse((x) => { if ((x as THREE.Mesh).isMesh) (x as THREE.Mesh).castShadow = true; });
      return g;
    };
    const swap: Array<[ProjType, string[]]> = [['brick', ['brick']], ['card', ['card_fan', 'card']], ['football', ['football']], ['fireball_football', ['football']]];
    for (const [t, ids] of swap) {
      const pool = this.pools.get(t);
      const id = pool ? pick(ids) : null;
      if (!pool || !id) continue;
      for (const inst of pool) {
        const o = await load(id);
        if (!o) break;
        const body = centred(o, `${t}:${id}`);
        inst.obj.removeFromParent();
        inst.obj = body;
        body.visible = false;
        this.group.add(body);
      }
      used.push(`${t}<-${id}`);
    }
    const spot = this.pools.get('spotlight_beam');
    const sid = spot ? pick(['spotlight']) : null;
    if (spot && sid) {
      for (const inst of spot) {
        const o = await load(sid);
        if (!o) break;
        const head = centred(o, 'spot-head');
        head.rotation.x = Math.PI;                         // prop +Y (the lens) points down at the floor
        head.visible = false;
        inst.head = head;
        this.group.add(head);
      }
      used.push(`spotlight_beam head<-${sid}`);
    }
    this.stats.assets = used;
    return used;
  }

  /** the visual type for a live projectile */
  typeFor(p: ViewProjectile): ProjType {
    if (p.kind === 1) return 'football';
    if (p.kind === 2) {
      if (typeof p.obj === 'string') return projTypeOf(p.obj);
      if (typeof p.obj === 'number') return this.heckleIds[p.obj] ? projTypeOf(this.heckleIds[p.obj]) : HECKLE_TYPES[((p.obj % 4) + 4) % 4];
      return HECKLE_TYPES[p.slot % 4];
    }
    const key = `${p.owner}:${p.moveId ?? -1}`;
    let t = this.typeCache.get(key);
    if (!t) {
      const def = this.data.fighters[this.cfg.p[p.owner === 1 ? 1 : 0]?.fighter ?? ''];
      const mk = moveKeys(def)[p.moveId ?? -1];
      t = projTypeOf(mk ? def!.moves[mk]?.projectile?.clip : undefined);
      this.typeCache.set(key, t);
    }
    return t;
  }

  private acquire(t: ProjType): Inst {
    let pool = this.pools.get(t);
    if (!pool) { pool = []; this.pools.set(t, pool); }
    let i = pool.find((x) => !x.busy);
    if (!i) { i = this.make(t); pool.push(i); }             // an unexpected type: built late (only reached by data outside the kit)
    i.busy = true;
    return i;
  }

  /** hand position of a fighter for launch FX / taser wires */
  private hand(owner: number, bone: string, out: THREE.Vector3): THREE.Vector3 {
    const f = this.fighters[owner === 1 ? 1 : 0];
    if (!f.bonePos(bone, out)) f.chest(out);
    return out;
  }

  private launch(t: ProjType, l: Live): void {
    this.stats.spawned++;
    const d = l.vx >= 0 ? 1 : -1;
    const at = this.v0.set(l.x, l.y, 0.05);
    switch (t) {
      case 'brick': this.fx.dust(this.hand(l.owner, 'RightHand', this.v1), 0.35); break;
      case 'card': case 'saw_card': this.fx.sparkle(at, 12); break;
      case 'taser_bolt': this.fx.electric(this.hand(l.owner, 'LeftHand', this.v1), 0.6); break;
      case 'flame': case 'fireball_football': this.fx.fireBurst(at, 0.45); break;
      case 'football': this.fx.dust(this.v1.set(l.x - d * 0.2, 0.05, 0.1), 0.4); break;
      case 'spotlight_beam': this.fx.glowAt(this.v1.set(l.x, 5.2, -0.1), 1.2, 0xfff2c4, 0.25); this.fx.sparkle(at, 10, 0xfff2c4); break;
      case 'pyro_line': this.fx.fireBurst(this.v1.set(l.x, 0.2, 0.05), 0.5); break;
      default: break;
    }
  }

  /** impact / destroy FX at (x, y) for a type; `hit` = it connected with a body */
  burst(t: ProjType, x: number, y: number, dir: number, hit: boolean): void {
    const at = this.v0.set(x, y, 0.08);
    switch (t) {
      case 'brick': this.fx.debris(at, TYPE_COLOR.brick, 16, dir * -0.6); this.fx.dust(at, 0.7, new THREE.Color(0.55, 0.32, 0.25)); break;
      case 'card': this.fx.cards(at, 12, -dir); this.fx.sparkle(at, 10); break;
      case 'saw_card': this.fx.metalSparks(at, -dir, 1.4); this.fx.cards(at, 8, -dir); break;
      case 'flame': case 'fireball_football': this.fx.fireBurst(at, hit ? 1.0 : 0.7); break;
      case 'flame_breath': this.fx.fireBurst(at, 0.5); break;
      case 'taser_bolt': this.fx.electric(at, 1.2); break;
      case 'football': this.fx.dust(at, 0.5); this.fx.sparkle(at, 6, 0xffffff); break;
      case 'spotlight_beam': this.fx.screenFlash(0.25, 0xfff2c4); this.fx.sparkle(at, 20, 0xfff2c4); this.fx.glowAt(at, 2.2, 0xfff2c4, 0.2); break;
      case 'pyro_line': this.fx.fireBurst(this.v1.set(x, 0.4, 0.05), 0.9); break;
      case 'tomato': this.fx.debris(at, 0xd7261e, 18, -dir, C.BLOB_A); this.fx.floorMark(x + dir * -0.3, 0.2, 0.5, C.BLOB_B, 0xa01010, 5); break;
      case 'bottle': this.fx.debris(at, 0x4fae5c, 16, -dir, C.SHARD); this.fx.sparkle(at, 8, 0xcff7d6); break;
      case 'shoe': this.fx.dust(at, 0.5); break;
      case 'chair': this.fx.metalSparks(at, -dir, 1.0); this.fx.debris(at, 0x9aa2ad, 8, -dir, C.SHARD); break;
      default: this.fx.fireBurst(at, 0.4);
    }
  }

  /** sim events that concern projectiles (PROJ_HIT / PROJ_CLASH): impact FX at the projectile's last position */
  onEvent(e: ViewEvent): void {
    if (e.type !== EV.PROJ_HIT && e.type !== EV.PROJ_CLASH) return;
    let best: Live | null = null;
    if (e.type === EV.PROJ_CLASH) best = this.live.get(e.b) ?? null;
    if (!best) {
      const vic = this.fighters[e.b === 1 ? 1 : 0].root.position.x;
      let bd = 1e9;
      for (const l of this.live.values()) if (l.owner === e.a && Math.abs(l.x - vic) < bd) { bd = Math.abs(l.x - vic); best = l; }
    }
    if (!best) return;
    this.stats.impacts++;
    this.burst(best.inst.type, best.x, best.y, best.vx >= 0 ? 1 : -1, e.type === EV.PROJ_HIT);
    best.seen = -1;                                          // consumed: no second "fizzle" burst when the slot vanishes
  }

  /** once per rendered frame: place every live projectile, trails, launch + vanish FX */
  frame(list: ReadonlyArray<ViewProjectile> | undefined, dt: number, simFrame: number): void {
    this.frameNo++;
    const t = simFrame / 60;
    const present = new Set<number>();
    for (const p of list ?? []) {
      if (p.alive === false || p.alive === 0) continue;
      present.add(p.slot);
      const type = this.typeFor(p);
      let l = this.live.get(p.slot);
      if (l && l.inst.type !== type) { this.hide(l.inst); l.inst.busy = false; this.live.delete(p.slot); l = undefined; }
      if (!l) {
        l = { inst: this.acquire(type), owner: p.owner, x: p.x, y: p.y, vx: p.vx ?? 0, age: 0, lastMark: p.x, seen: this.frameNo };
        this.live.set(p.slot, l);
        this.launch(type, l);
      }
      const vx = p.vx ?? (p.x - l.x) * 60;
      l.vx = Math.abs(vx) > 0.01 ? vx : l.vx; l.x = p.x; l.y = p.y; l.age += dt; l.seen = this.frameNo;
      this.place(l, type, t, dt, p);
    }
    for (const [slot, l] of this.live) {
      if (present.has(slot)) continue;
      if (l.seen !== -1) { this.burst(l.inst.type, l.x, l.y, l.vx >= 0 ? 1 : -1, false); this.stats.destroyed++; }
      this.hide(l.inst); l.inst.busy = false; this.live.delete(slot);
    }
  }

  private place(l: Live, type: ProjType, t: number, dt: number, p: ViewProjectile): void {
    const i = l.inst, o = i.obj;
    const d = l.vx >= 0 ? 1 : -1;
    const y = type === 'football' || type === 'fireball_football' ? Math.max(0.11, l.y) : l.y;
    o.visible = true;
    o.position.set(l.x, y, 0.05);
    o.rotation.set(0, 0, 0);
    const trailV = this.v1.set(-d * this.fx.rr(0.3, 1.0), this.fx.rr(-0.2, 0.3), this.fx.rr(-0.2, 0.2));
    switch (type) {
      case 'brick':
        o.rotation.set(0.3, 0.25, -t * 14 * d);
        if (this.fx.rr(0, 1) < 0.5) this.fx.trail(o.position, trailV, 0.12, 0x8d7b6c, C.DUST, 0.35, false, 1.8, -0.3, 1.5, 0.35);
        break;
      case 'card':
        o.rotation.set(-0.35, 0.2 * d, -t * 20 * d);
        if (this.fx.rr(0, 1) < 0.7) this.fx.trail(o.position, trailV, 0.07, 0xffd65a, C.STAR5, 0.4, true, 0.2);
        break;
      case 'saw_card':
        o.rotation.set(-0.25, 0.15 * d, -t * 34 * d);
        this.fx.trail(o.position, trailV, 0.06, 0xfff0b0, C.STREAK, 0.18, true, 0.3);
        if (this.fx.rr(0, 1) < 0.4) this.fx.glowAt(o.position, 1.1, 0xbfd8ff, 0.05, 0.35);
        break;
      case 'football': {
        const rolling = l.y < 0.2;
        o.rotation.set(0, 0, -(l.x / 0.11) * (rolling ? 1 : 0.6));
        if (!rolling && this.fx.rr(0, 1) < 0.3) this.fx.trail(o.position, trailV, 0.08, 0xffffff, C.STREAK, 0.12, true, 0.2);
        break;
      }
      case 'fireball_football':
        o.rotation.set(0, 0, -(l.x / 0.11));
        for (let k = 0; k < 3; k++) {
          this.v2.set(-d * this.fx.rr(1.5, 3.0), this.fx.rr(0.2, 1.0), this.fx.rr(-0.3, 0.3));
          this.fx.trail(o.position, this.v2, this.fx.rr(0.18, 0.3), k === 0 ? 0xffdc70 : 0xff6a10, C.FLAME, 0.3, true, 2.4, -1.5, 2.2, 0.85);
        }
        this.fx.glowAt(o.position, 0.9, 0xff8a30, 0.04, 0.6);
        break;
      case 'flame': {
        for (let k = 0; k < 4; k++) {
          this.v2.set(-d * this.fx.rr(0.5, 1.8) + this.fx.rr(-0.4, 0.4), this.fx.rr(0.3, 1.4), this.fx.rr(-0.3, 0.3));
          this.fx.trail(o.position, this.v2, this.fx.rr(0.16, 0.28), k === 0 ? 0xffe28a : k === 1 ? 0xff8c20 : 0xe8300a, C.FLAME, this.fx.rr(0.22, 0.38), true, 2.6, -2, 2.4, 0.85);
        }
        this.fx.glowAt(o.position, 0.8, 0xff7a20, 0.04, 0.7);
        if (this.fx.rr(0, 1) < 0.3) this.fx.trail(o.position, this.v2.set(0, 0.8, 0), 0.25, 0x2c2828, C.SMOKE, 0.9, false, 2.5, -0.5, 1, 0.4);
        break;
      }
      case 'flame_breath': {
        o.visible = false;
        const f = this.fighters[l.owner === 1 ? 1 : 0];
        const mouth = this.v2;
        if (!f.bonePos('Head', mouth)) f.chest(mouth);
        mouth.x += d * 0.18; mouth.y -= 0.05; mouth.z = 0.05;
        const len = Math.max(0.4, Math.abs(l.x - mouth.x) + 0.35);
        this.fx.flameJet(mouth, d, len, 1.1, dt);
        break;
      }
      case 'taser_bolt': {
        o.rotation.set(0, d > 0 ? 0 : Math.PI, 0);
        const w = i.wire!;
        w.visible = true;
        const a = this.hand(l.owner, 'LeftHand', this.v2);
        const pos = w.geometry.getAttribute('position') as THREE.BufferAttribute;
        const n = pos.count;
        for (let k = 0; k < n; k++) {
          const u = k / (n - 1);
          const sag = -0.12 * Math.sin(Math.PI * u) * Math.min(1, Math.abs(l.x - a.x) / 2);
          pos.setXYZ(k, a.x + (l.x - a.x) * u, a.y + (y - a.y) * u + sag, 0.05);
        }
        pos.needsUpdate = true;
        if (this.fx.rr(0, 1) < 0.35) this.fx.arc(a, o.position, 0.8);
        this.fx.glowAt(o.position, 0.35, 0x9ad8ff, 0.04, 0.6);
        break;
      }
      case 'spotlight_beam': {
        const b = i.beam!, pl = i.pool!;
        b.visible = true; pl.visible = true;
        b.position.set(l.x, 0, -0.05);
        (b.material as THREE.ShaderMaterial).uniforms.uAlpha.value = 0.55 + 0.1 * Math.sin(t * 30);
        if (i.head) { i.head.visible = true; i.head.position.set(l.x, 5.6, -0.05); }
        pl.position.set(l.x, 0.012, 0.05);
        this.fx.glowAt(this.v2.set(l.x, y, 0.1), 0.7, 0xfff2c4, 0.04, 0.8);
        if (this.fx.rr(0, 1) < 0.5) this.fx.trail(this.v2, trailV, 0.06, 0xfff2c4, C.TWINKLE, 0.35, true, 0.2);
        break;
      }
      case 'pyro_line': {
        o.visible = false;
        this.fx.fireColumn(l.x, 0.05, 1.4, dt, 1.2);
        if (Math.abs(l.x - l.lastMark) > 0.45) { l.lastMark = l.x; this.fx.floorMark(l.x, 0.05, 0.6, C.SCORCH, 0x140a06, 4, 0.7); }
        break;
      }
      case 'tomato': case 'bottle': case 'shoe': case 'chair': {
        const spin = type === 'chair' ? 6 : type === 'bottle' ? 11 : 9;
        o.rotation.set(t * 3, t * 2, -t * spin * d);
        if (type === 'tomato' && this.fx.rr(0, 1) < 0.2) this.fx.trail(o.position, trailV, 0.04, 0xd7261e, C.DROP, 0.4, false, 0.6, 9.8, 0.5, 0.9);
        break;
      }
      default:
        this.fx.glowAt(o.position, 0.55, TYPE_COLOR.orb, 0.04, 0.8);
        this.fx.trail(o.position, trailV, 0.2, 0xff5a1f, C.GLOW, 0.25, true, 0.1);
    }
    if (i.shadow) {
      i.shadow.visible = true;
      const h = Math.max(0, y);
      i.shadow.position.set(l.x, 0.009, 0.05);
      const s = type === 'saw_card' ? 1.2 : type === 'chair' ? 1.4 : 0.55;
      i.shadow.scale.setScalar(s * (1 + h * 0.3));
      (i.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.12, 0.7 - h * 0.25);
    }
    void p; void CONFETTI;
  }

  /** read-back (lab / harness) */
  info(): Record<string, unknown> {
    return { ...this.stats, live: [...this.live.entries()].map(([slot, l]) => ({ slot, type: l.inst.type, x: +l.x.toFixed(2), y: +l.y.toFixed(2) })) };
  }

  reset(): void {
    for (const l of this.live.values()) { this.hide(l.inst); l.inst.busy = false; }
    this.live.clear();
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!(m.isMesh || (o as THREE.Line).isLine)) return;
      m.geometry.dispose();
      for (const x of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) { if (x.map && x.map !== SHADOW_TEX) x.map.dispose(); x.dispose(); }
    });
    this.group.removeFromParent();
  }
}
