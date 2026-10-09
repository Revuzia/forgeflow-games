// GENESIS — buildings on a planet (CONTRACT.md §15.6): BuildingBlock → instanced kit meshes.
//
//   * Each building resolves to a visual VARIANT: archetype (from the content building + the material its builders
//     used + the settlement's era: a shelter of thatch is a round hut, of mudbrick a flat-roofed house, of brick in an
//     industrial city a tenement), material, style, era, mood (the settlement's alignment) and quantised footprint.
//     Variants are generated on demand (render/gen/buildinggen.ts) within a per-frame time budget, nearest the camera
//     first (up to a third of the frame while buildings in view are still missing, a few ms otherwise), and cached;
//     every building of a variant is one instance of its InstancedMesh (two LODs).
//   * Placement: the building's local up is the radial up (walls stay plumb); its floor sits at the highest ground
//     under its footprint (the generator's plinths and piles run 4 m down, so the downhill side meets the slope);
//     docks and shipyards sit on the water when their footprint reaches it.
//   * State per instance (progress, damage, flags, light) drives construction cut-aways, scaffolds, char, ruins (and
//     a rubble heap), burning embers and night-lit windows in the material (render/life/buildingmat.ts).
//   * Outputs for the rest of the life layer: body-frame EMITTERS (chimney smoke, hearths, kiln / forge mouths,
//     factory stacks, beacons, braziers, and fires on burning buildings) for particles and point lights, and a per-
//     cell night LIGHT field (hearth → lamps → electric) for the terrain's city lights seen from orbit.

import {
  BufferGeometry, Color, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, type IUniform,
  type Material, type ShaderMaterial,
} from 'three';
import type { BuildingBlock, SettlementView } from '../../sim/types.ts';
import { BuildingFlag } from '../../sim/types.ts';
import type { PlanetView } from '../../client/worldview.ts';
import { groundHeight } from '../../sim/grid/surface.ts';
import { hashFloat } from '../../sim/core/rng.ts';
import { buildingAt, dwellingFamily, eraIndex, materialAt, shelterKind, type BuildFamily, type BuildingKind } from './catalog.ts';
import { extractRoads } from './roadnet.ts';
import { EMIT, buildingMesh, rubbleMesh, scaffoldKindFor, scaffoldMesh, yardPropMesh, type BuildingMesh, type Emitter, type YardProp } from '../gen/buildinggen.ts';
import { makeBuildingDepthMaterial, makeBuildingMaterial } from './buildingmat.ts';

/** a body-frame emitter of a building (particles / lights) */
export interface LifeEmitter {
  /** body-frame position (m) */
  x: number; y: number; z: number;
  /** body-frame up (unit) */
  ux: number; uy: number; uz: number;
  kind: number;
  size: number;
  /** 0..1 strength (light level, burning, working) */
  power: number;
  /** stable seed */
  seed: number;
}

interface Variant {
  key: string;
  meshes: (BuildingMesh | null)[];
  buckets: (Bucket | null)[];
  /** the same meshes for buildings cut open (rising, ruined, burning): drawn double-sided, see makeBucket */
  cutBuckets: (Bucket | null)[];
  pending: boolean;
  /** distance (m) from the camera to the nearest building of this variant (pending variants build nearest first) */
  near: number;
  spec: { kind: BuildingKind; matIdx: number; style: number; era: number; mood: number; w: number; d: number; family?: BuildFamily };
}

interface Bucket {
  mesh: InstancedMesh;
  state: InstancedBufferAttribute;
  info: InstancedBufferAttribute;
  count: number;
  cap: number;
  geo: BufferGeometry;
  cut: boolean;
  noShadow?: boolean;
}

/** a building's front: centre of its door side, outward and sideways axes, width; east / north there */
export interface Front { x: number; y: number; z: number; fx: number; fy: number; fz: number; sx: number; sy: number; sz: number; w: number; ex: number; ey: number; ez: number; nx: number; ny: number; nz: number }

interface Rec {
  id: number;
  /** the LOD drawn last (−1 none yet): the switch has hysteresis */
  lod?: number;
  /** a ruin a standing building now covers (not drawn) */
  covered?: boolean;
  settlement: number;
  kind: BuildingKind;
  variant: Variant;
  m: Float32Array; // 16, column-major body-frame matrix
  /** body position of the origin, radial up */
  px: number; py: number; pz: number;
  ux: number; uy: number; uz: number;
  state: [number, number, number, number];
  seed: number;
  /** quantised static key (rebuild placement only when it changes) */
  skey: string;
  w: number; d: number;
  /** where its instance went in the last full rewrite (a state-only change rewrites just that slot) */
  slot: Bucket | null;
  slotI: number;
  /** sim tick it was first seen ruined (NaN: not ruined; -1e9: already a ruin when first seen) */
  ruinAt: number;
}

/**
 * The light a building shows at night. The sim already gives hearth-age dwellings no glow when their settlement keeps
 * no fire at all (SettlementView.nightLight = 0: a people huddled cold in the dark, CONTRACT §16.1); this gate keeps
 * that true for older saves and lookdev data — unless a fire burns in that very building (BuildingFlag.lit).
 */
function effectiveLight(light: number, flags: number, nightLight: number): number {
  if (nightLight > 0 || (flags & BuildingFlag.lit) || Math.floor(light / 256) > 1) return light;
  return 0;
}

/** the parts of a state that change which meshes a building is drawn with (cut-open, scaffold, rubble) */
function structural(s: ArrayLike<number>): number {
  const ruinedHeap = (s[2] & BuildingFlag.ruined) !== 0 || s[1] > 0.62;
  const cut = s[0] < 0.999 || s[1] > 0.3 || (s[2] & (BuildingFlag.ruined | BuildingFlag.burning)) !== 0;
  return (cut ? 1 : 0) | (ruinedHeap ? 2 : 0) | ((s[2] & BuildingFlag.burning) ? 4 : 0);
}

/** the parts of a state the emitters and night lights read (occupancy and work only change smoke strength) */
function lightKey(s: ArrayLike<number>): number {
  return (s[0] >= 0.999 ? 1 : 0) | (s[1] > 0.5 ? 2 : 0) | ((s[2] & (BuildingFlag.ruined | BuildingFlag.burning | BuildingFlag.lit)) << 2) | (s[3] << 12);
}

const _m4 = new Matrix4();
const _yl = new Matrix4();
const _c = new Color();
const LOD0 = 110;
const MAX_DIST = 3600;
/** yard props are drawn this close (m) */
const YARD_DIST = 320;
/** the kinds people live in (their yards are dressed) */
const DWELLINGS = new Set<BuildingKind>(['hut', 'wattle', 'mudbrick', 'stone-house', 'timber', 'half-timber', 'brick-house', 'longhouse']);
/**
 * ms per frame spent generating variant meshes: a little always; while buildings near the camera are still missing,
 * up to a third of the frame time (a slow frame — a camera cut, a software renderer — fills the view sooner)
 */
const GEN_MS = 4;
const GEN_MS_NEAR = 10;

export class Buildings {
  readonly group = new Group();
  private material: Material;
  private materialCut: Material;
  private depth: ShaderMaterial;
  private variants = new Map<string, Variant>();
  private recs: Rec[] = [];
  private byId = new Map<number, Rec>();
  private lastBlock: BuildingBlock | null = null;
  private lastSurfaceVersion = -1;
  private lastCam: [number, number, number] = [1e9, 0, 0];
  private dirty = true;
  /** buildings whose state changed without changing their meshes (rewritten in place by update) */
  private stateChanged: Rec[] = [];
  private scaffolds = new Map<string, Bucket>();
  /** yard props around dwellings: prop|variant -> bucket */
  private yard = new Map<string, Bucket>();
  private rubble: Bucket[] = [];
  castShadows = false;
  enabled = true;
  /** front doors of every building of a settlement (ambient crowds stand and walk there) */
  frontsOf(settlement: number): Front[] {
    let l = this.fronts.get(settlement);
    if (l) return l;
    l = [];
    for (const r of this.recs) {
      if (r.settlement !== settlement || r.state[0] < 0.999 || (r.state[2] & BuildingFlag.ruined)) continue;
      const m = r.m;
      const hz = r.d / 2;
      let ex = r.uz, ez = -r.ux;
      const el = Math.hypot(ex, ez) || 1;
      ex /= el; ez /= el;
      l.push({
        x: r.px + m[8] * hz, y: r.py + m[9] * hz, z: r.pz + m[10] * hz, fx: m[8], fy: m[9], fz: m[10], sx: m[0], sy: m[1], sz: m[2], w: r.w,
        ex, ey: 0, ez, nx: r.uy * ez, ny: r.uz * ex - r.ux * ez, nz: -r.uy * ex,
      });
    }
    this.fronts.set(settlement, l);
    return l;
  }
  private fronts = new Map<number, Front[]>();

  /** body-frame emitters of every building (rebuilt when the buildings change) */
  emitters: LifeEmitter[] = [];
  emittersVersion = 0;
  /** bumps when buildings are placed, moved, removed or ruined (footprints change) */
  layoutVersion = 0;
  private lastGenT = 0;
  /** lit windows: one light source per lit, intact building (at night the nearest become point lights) */
  windowLights: { x: number; y: number; z: number; kind: number; power: number; seed: number }[] = [];
  /** per-cell night light (0..~2), for the terrain's light channel */
  lightField: Float32Array | null = null;
  lightVersion = 0;
  stats = { buildings: 0, instances: 0, variants: 0, pendingVariants: 0 };
  private shared: Record<string, IUniform>;

  constructor(shared: Record<string, IUniform>) {
    this.shared = shared;
    this.group.name = 'buildings';
    this.group.matrixAutoUpdate = false;
    // intact buildings are closed shells: single-sided (a double-sided draw lets the back faces of roof and wall
    // slabs win the depth test in rows of specks); buildings cut open by construction, ruin or fire are drawn
    // double-sided, so the inside faces of their walls read as broken cores (buildingmat.ts)
    this.material = makeBuildingMaterial(shared, false);
    this.materialCut = makeBuildingMaterial(shared, true);
    this.depth = makeBuildingDepthMaterial(shared);
    for (let i = 0; i < 2; i++) this.rubble.push(this.makeBucket(rubbleMesh(77 + i * 13, i === 0), 64, true));
  }

  private makeBucket(geo: BufferGeometry, cap: number, cut = false, noShadow = false): Bucket {
    const state = new InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    const info = new InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    state.setUsage(DynamicDrawUsage);
    info.setUsage(DynamicDrawUsage);
    geo.setAttribute('iState', state);
    geo.setAttribute('iInfo', info);
    const mesh = new InstancedMesh(geo, cut ? this.materialCut : this.material, cap);
    mesh.userData.cut = cut;
    // far (LOD 1) buildings and yard props cast no shadow: the cascades do not resolve them, and the depth passes
    // roughly doubled the geometry drawn
    mesh.userData.noShadow = noShadow;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    if (this.castShadows && !noShadow) mesh.layers.enable(1);
    this.group.add(mesh);
    return { mesh, state, info, count: 0, cap, geo, cut, noShadow };
  }

  private grow(b: Bucket, need: number): Bucket {
    if (need <= b.cap) return b;
    let cap = b.cap;
    while (cap < need) cap *= 2;
    const nb = this.makeBucket(b.geo, cap, b.cut, b.noShadow);
    // keep what is already written this pass (the instances before the one that did not fit)
    const n = b.count;
    if (n > 0) {
      (nb.mesh.instanceMatrix.array as Float32Array).set((b.mesh.instanceMatrix.array as Float32Array).subarray(0, n * 16));
      (nb.state.array as Float32Array).set((b.state.array as Float32Array).subarray(0, n * 4));
      (nb.info.array as Float32Array).set((b.info.array as Float32Array).subarray(0, n * 4));
      if (b.mesh.instanceColor) {
        nb.mesh.setColorAt(0, _c.setRGB(1, 1, 1));
        (nb.mesh.instanceColor!.array as Float32Array).set((b.mesh.instanceColor.array as Float32Array).subarray(0, n * 3));
      }
    }
    this.group.remove(b.mesh);
    b.mesh.dispose();
    b.mesh = nb.mesh; b.state = nb.state; b.info = nb.info; b.cap = cap;
    return b;
  }

  setShadowCasting(on: boolean): void {
    if (on === this.castShadows) return;
    this.castShadows = on;
    this.group.traverse((o) => { if ((o as InstancedMesh).isInstancedMesh) { if (on && !o.userData.noShadow) o.layers.enable(1); else o.layers.disable(1); } });
  }

  swapDepth(depth: boolean): void {
    this.group.traverse((o) => {
      const m = o as InstancedMesh;
      if (m.isInstancedMesh) m.material = depth ? this.depth : m.userData.cut ? this.materialCut : this.material;
    });
  }

  private variantFor(kind: BuildingKind, matIdx: number, style: number, era: number, mood: number, w: number, d: number, family?: BuildFamily): Variant {
    const key = `${kind}|${matIdx}|${style}|${era}|${mood}|${w}|${d}${family ? `|${family}` : ''}`;
    let v = this.variants.get(key);
    if (!v) {
      v = { key, meshes: [null, null], buckets: [null, null], cutBuckets: [null, null], pending: true, near: 1e9, spec: { kind, matIdx, style, era, mood, w, d, family } };
      this.variants.set(key, v);
    }
    return v;
  }

  /** remember when a building became a ruin (its char weathers from then) */
  private noteRuin(r: Rec, flags: number, tick: number, firstLook: boolean): void {
    const ruined = (flags & BuildingFlag.ruined) !== 0;
    if (!ruined) { r.ruinAt = NaN; return; }
    if (Number.isNaN(r.ruinAt)) r.ruinAt = firstLook ? -1e9 : tick;
  }

  /**
   * The instance's fourth state value: its light, or for a ruin its weathering (2000 + 0..999; buildingmat.ts reads
   * it) — soot-black when it falls, grey-brown and greening after about six days.
   */
  private stateW(r: Rec, tick: number, dayTicks: number): number {
    if (!(r.state[2] & BuildingFlag.ruined)) return r.state[3];
    const age = Number.isNaN(r.ruinAt) ? 1e9 : tick - r.ruinAt;
    return 2000 + Math.round(Math.max(0, Math.min(1, age / (6 * dayTicks))) * 999);
  }
  private lastWeatherTick = -1e9;

  /** settlement era / mood lookup */
  private settlementInfo(settlements: SettlementView[], id: number): { era: number; mood: number; alignment: number } {
    for (const s of settlements) if (s.id === id) {
      const mood = s.alignment < -0.33 ? -1 : s.alignment > 0.33 ? 1 : 0;
      return { era: eraIndex(s.era), mood, alignment: s.alignment };
    }
    return { era: 2, mood: 0, alignment: 0 };
  }

  /** place a dwelling's yard props (1–3, chosen and placed by a hash of its id) */
  private yardFor(r: Rec, era: number): void {
    const pool: YardProp[] = era <= 2 ? ['woodpile', 'rack', 'woodpile'] : era <= 5 ? ['woodpile', 'barrels', 'fence', 'garden', 'rack'] : era <= 8 ? ['woodpile', 'barrels', 'fence', 'garden', 'cart', 'laundry'] : ['barrels', 'laundry', 'cart', 'garden'];
    const n = 1 + Math.floor(hashFloat(r.id, 0x7a1) * 2.6);
    const used = new Set<number>();
    for (let i = 0; i < n; i++) {
      const prop = pool[Math.floor(hashFloat(r.id, i, 0x7a2) * pool.length)];
      // by the left, right or back wall (never across the door), a little along it
      let slot = Math.floor(hashFloat(r.id, i, 0x7a3) * 3);
      while (used.has(slot) && used.size < 3) slot = (slot + 1) % 3;
      used.add(slot);
      const along = (hashFloat(r.id, i, 0x7a4) - 0.5) * 0.5;
      const gap = prop === 'garden' || prop === 'fence' ? 2.0 : prop === 'cart' || prop === 'laundry' ? 2.4 : 1.0;
      const x = slot === 0 ? -(r.w / 2 + gap) : slot === 1 ? r.w / 2 + gap : along * r.w;
      const z = slot === 2 ? -(r.d / 2 + gap) : along * r.d;
      const yaw = slot === 0 ? -Math.PI / 2 : slot === 1 ? Math.PI / 2 : Math.PI;
      const vi = hashFloat(r.id, i, 0x7a5) < 0.5 ? 0 : 1;
      const key = `${prop}|${vi}`;
      let b = this.yard.get(key);
      if (!b) { b = this.makeBucket(yardPropMesh(prop, vi), 32, false, true); this.yard.set(key, b); }
      b = this.grow(b, b.count + 1);
      const j = b.count++;
      _m4.fromArray(r.m).multiply(_yl.makeRotationY(yaw).setPosition(x, -0.04, z));
      b.mesh.setMatrixAt(j, _m4);
      b.state.setXYZW(j, 1, 0, 0, 0);
      b.info.setXYZW(j, 1, 1, 1, r.seed);
      const tone = 0.9 + 0.2 * hashFloat(r.id, i, 0x7a6);
      b.mesh.setColorAt(j, _c.setRGB(tone, tone, tone));
    }
  }

  /** ruins under a standing building are not drawn (a rebuilt house stood on the black heap of the hut before it) */
  private coverRuins(): void {
    const standing = this.recs.filter((r) => (r.state[2] & BuildingFlag.ruined) === 0);
    for (const r of this.recs) {
      r.covered = false;
      if ((r.state[2] & BuildingFlag.ruined) === 0) continue;
      const rr = Math.max(r.w, r.d) * 0.5;
      for (const o of standing) {
        const d = Math.hypot(r.px - o.px, r.py - o.py, r.pz - o.pz);
        if (d < (rr + Math.max(o.w, o.d) * 0.5) * 0.75) { r.covered = true; break; }
      }
    }
  }

  /** each settlement's building tradition: the family most of its dwellings belong to */
  private buildFamilies(settlements: SettlementView[], b: BuildingBlock): Map<number, BuildFamily> {
    const counts = new Map<number, number[]>();
    const eras = new Map<number, number>();
    for (const v of settlements) eras.set(v.id, eraIndex(v.era));
    for (let i = 0; i < b.count; i++) {
      const look = buildingAt(b.type[i]);
      if (!look.byMaterial) continue;
      const sid = b.settlement[i];
      const f = dwellingFamily(shelterKind(look, materialAt(b.material[i]), eras.get(sid) ?? 2, b.style[i] & 7));
      if (!f) continue;
      let c = counts.get(sid);
      if (!c) { c = [0, 0, 0]; counts.set(sid, c); }
      c[f === 'earth' ? 0 : f === 'timber' ? 1 : 2]++;
    }
    const out = new Map<number, BuildFamily>();
    for (const [sid, c] of counts) out.set(sid, c[2] >= c[1] && c[2] >= c[0] ? 'stone' : c[0] >= c[1] ? 'earth' : 'timber');
    return out;
  }

  /** settlement era / mood stamp (a change re-resolves every building's variant) */
  private settleStamp(settlements: SettlementView[]): string {
    let s = '';
    for (const v of settlements) s += `${v.id}:${v.era}:${v.alignment < -0.33 ? -1 : v.alignment > 0.33 ? 1 : 0}:${v.nightLight > 0 ? 1 : 0},`;
    return s;
  }

  /** settlement id → night light (0 = no fire kept) */
  private nightLights(settlements: SettlementView[]): Map<number, number> {
    const m = this.nlMap;
    m.clear();
    for (const v of settlements) m.set(v.id, v.nightLight);
    return m;
  }
  private nlMap = new Map<number, number>();
  private lastSettleStamp = '';

  /**
   * The live sim sends a fresh BuildingBlock with every snapshot (≤ 30 Hz) even when nothing changed. When the
   * buildings themselves (ids, types, materials, places, sizes) and the settlements' eras are the same as last time,
   * only the per-instance state is copied: instances are rewritten when a state changed, and the emitters / lights /
   * fronts only when something they depend on did (lit, burning, ruined, finished). Returns false when a full sync is
   * needed.
   */
  private syncStates(pv: PlanetView, b: BuildingBlock, prev: BuildingBlock): boolean {
    if (b.count !== prev.count || b.count !== this.recs.length) return false;
    const n = b.count;
    for (let i = 0; i < n; i++) {
      if (b.id[i] !== prev.id[i] || b.type[i] !== prev.type[i] || b.material[i] !== prev.material[i] || b.style[i] !== prev.style[i]
        || b.rot[i] !== prev.rot[i] || b.scale[i] !== prev.scale[i] || b.settlement[i] !== prev.settlement[i]) return false;
    }
    for (let i = 0; i < n * 3; i++) if (b.pos[i] !== prev.pos[i]) return false;
    let outputs = false, smoke = false;
    const nl = this.nightLights(pv.settlements);
    for (let i = 0; i < n; i++) {
      const r = this.recs[i];
      if (r.id !== b.id[i]) return false;
      const s = r.state;
      const p = b.progress[i], d = b.damage[i], f = b.flags[i], l = effectiveLight(b.light[i], b.flags[i], nl.get(b.settlement[i]) ?? 1);
      if (s[0] === p && s[1] === d && s[2] === f && s[3] === l) continue;
      const next: [number, number, number, number] = [p, d, f, l];
      this.noteRuin(r, f, pv.paramsTick, false);
      // a change of which meshes draw it needs the full rewrite; a progress / light change rewrites its slot only
      if (structural(s) !== structural(next) || !r.slot) this.dirty = true;
      else this.stateChanged.push(r);
      if (lightKey(s) !== lightKey(next)) outputs = true;
      else if ((s[2] ^ f) & (BuildingFlag.occupied | BuildingFlag.working)) smoke = true;
      r.state = next;
    }
    if (outputs || smoke) { this.fronts.clear(); this.rebuildOutputs(pv); }
    return true;
  }

  /** (re)read the building block: placement for new / moved buildings, state for all */
  private sync(pv: PlanetView): void {
    const b = pv.buildings;
    const sv = pv.fieldVersion.get('surface') ?? 0;
    if (b === this.lastBlock && sv === this.lastSurfaceVersion) return;
    const groundMoved = sv !== this.lastSurfaceVersion;
    const stamp = this.settleStamp(pv.settlements);
    const prev = this.lastBlock;
    if (b && prev && !groundMoved && stamp === this.lastSettleStamp && this.syncStates(pv, b, prev)) { this.lastBlock = b; return; }
    this.lastSettleStamp = stamp;
    this.lastBlock = b ?? null;
    this.lastSurfaceVersion = sv;
    this.dirty = true;
    if (!b || !b.count) {
      if (this.recs.length) this.layoutVersion++;
      this.recs = []; this.byId.clear();
      this.rebuildOutputs(pv);
      return;
    }
    let changed = b.count !== this.recs.length;
    const nl = this.nightLights(pv.settlements);
    const families = this.buildFamilies(pv.settlements, b);
    const water = pv.fields.get('water'), surface = pv.fields.get('surface');
    const gates = this.gateFinder(pv, b);
    const next: Rec[] = [];
    const nextById = new Map<number, Rec>();
    for (let i = 0; i < b.count; i++) {
      const id = b.id[i];
      const look = buildingAt(b.type[i]);
      const mat = materialAt(b.material[i]);
      const st = this.settlementInfo(pv.settlements, b.settlement[i]);
      const style = b.style[i] & 7;
      let kind = shelterKind(look, mat, st.era, style);
      const sc = Math.max(0.4, Math.min(4, b.scale[i] || 1));
      let w = Math.max(1.5, Math.round(look.w * sc * 2) / 2), d = Math.max(1.5, Math.round(look.d * sc * 2) / 2);
      const px = b.pos[i * 3], py = b.pos[i * 3 + 1], pz = b.pos[i * 3 + 2];
      let rot = b.rot[i];
      // a wall segment a street runs through is drawn as a gatehouse across that street
      if (kind === 'wall' && gates(px, py, pz)) { kind = 'gate'; const L = Math.max(w, d); d = Math.max(5, Math.min(w, d) * 2.5); w = Math.max(9, L); rot += Math.PI / 2; }
      // a temple is built in its people's tradition (their dwellings: earthen, timber or masonry)
      const family = kind === 'temple' ? families.get(b.settlement[i]) : undefined;
      const skey = `${b.type[i]}|${b.material[i]}|${style}|${st.era}|${st.mood}|${px.toFixed(6)}|${py.toFixed(6)}|${pz.toFixed(6)}|${b.rot[i].toFixed(3)}|${sc.toFixed(2)}${family ? `|${family}` : ''}`;
      const state: [number, number, number, number] = [b.progress[i], b.damage[i], b.flags[i], effectiveLight(b.light[i], b.flags[i], nl.get(b.settlement[i]) ?? 1)];
      let rec = this.byId.get(id);
      if (rec && rec.skey === skey && !groundMoved) {
        if ((rec.state[2] ^ state[2]) & BuildingFlag.ruined) changed = true;
        rec.state = state;
      } else {
        changed = true;
        const old = rec;
        const variant = this.variantFor(kind, b.material[i], style, st.era, st.mood, w, d, family);
        rec = this.place(pv, id, variant, px, py, pz, rot, w, d, kind, water ?? null, surface ?? null);
        rec.settlement = b.settlement[i];
        rec.skey = skey;
        rec.state = state;
        if (old) rec.ruinAt = old.ruinAt;
      }
      // a ruin already standing at the first look is old; one that falls while we watch starts fresh
      this.noteRuin(rec, state[2], pv.paramsTick, prev === null);
      next.push(rec);
      nextById.set(id, rec);
    }
    this.recs = next;
    this.byId = nextById;
    this.coverRuins();
    if (changed) this.layoutVersion++;
    this.fronts.clear();
    this.stats.buildings = next.length;
    this.rebuildOutputs(pv);
  }

  /**
   * Street crossings of walls: the road chains (render/life/roadnet.ts) around every settlement that has wall
   * segments, and a test "does a street centreline pass within 5 m of this point".
   */
  private gateFinder(pv: PlanetView, b: BuildingBlock): (x: number, y: number, z: number) => boolean {
    const road = pv.fields.get('road');
    if (!road) return () => false;
    const R = pv.params.radius;
    const pts: number[] = [];
    const done = new Set<number>();
    for (let i = 0; i < b.count; i++) {
      const s = b.settlement[i];
      if (done.has(s) || buildingAt(b.type[i]).kind !== 'wall') continue;
      done.add(s);
      const sv = pv.settlements.find((q) => q.id === s);
      const c: [number, number, number] = sv ? [sv.pos[0], sv.pos[1], sv.pos[2]] : [b.pos[i * 3], b.pos[i * 3 + 1], b.pos[i * 3 + 2]];
      const cells = pv.grid.cellsWithin(c[0], c[1], c[2], 420 / R).slice();
      for (const ch of extractRoads(pv.grid, road, cells, R, 0.6, 3)) for (const v of ch.pts) pts.push(v);
    }
    if (!pts.length) return () => false;
    const lim = 5 / R;
    return (x, y, z) => {
      for (let k = 0; k < pts.length; k += 3) {
        const dx = pts[k] - x, dy = pts[k + 1] - y, dz = pts[k + 2] - z;
        if (dx * dx + dy * dy + dz * dz < lim * lim) return true;
      }
      return false;
    };
  }

  /**
   * The nearest building hit by a body-frame ray (origin o, unit direction d) within `maxT` metres: the ray is taken into
   * each building's own frame (radial up, front axis) and slab-tested against its box (footprint × generated height).
   */
  pick(o: ArrayLike<number>, d: ArrayLike<number>, maxT: number): { id: number; t: number } | null {
    let best: { id: number; t: number } | null = null;
    let bt = maxT;
    for (const r of this.recs) {
      const m = r.m;
      // quick reject: distance from the ray to the building's centre
      const cx = r.px - o[0], cy = r.py - o[1], cz = r.pz - o[2];
      const along = cx * d[0] + cy * d[1] + cz * d[2];
      const big = Math.max(r.w, r.d) + 12;
      if (along < -big || along - big > bt) continue;
      const px = cx - d[0] * along, py = cy - d[1] * along, pz = cz - d[2] * along;
      if (px * px + py * py + pz * pz > big * big) continue;
      const H = (r.variant.meshes[0] ?? r.variant.meshes[1])?.height ?? 4;
      // local ray: origin relative to the building origin, projected on its axes
      const ox = -cx, oy = -cy, oz = -cz;
      const lo = [ox * m[0] + oy * m[1] + oz * m[2], ox * m[4] + oy * m[5] + oz * m[6], ox * m[8] + oy * m[9] + oz * m[10]];
      const ld = [d[0] * m[0] + d[1] * m[1] + d[2] * m[2], d[0] * m[4] + d[1] * m[5] + d[2] * m[6], d[0] * m[8] + d[1] * m[9] + d[2] * m[10]];
      const ruined = (r.state[2] & BuildingFlag.ruined) !== 0;
      const lo3 = [-r.w / 2, -0.5, -r.d / 2], hi3 = [r.w / 2, Math.max(1.2, (ruined ? 0.3 : Math.max(0.15, r.state[0])) * H), r.d / 2];
      let t0 = 0, t1 = bt;
      let ok = true;
      for (let k = 0; k < 3 && ok; k++) {
        if (Math.abs(ld[k]) < 1e-9) { if (lo[k] < lo3[k] || lo[k] > hi3[k]) ok = false; continue; }
        let a = (lo3[k] - lo[k]) / ld[k], b = (hi3[k] - lo[k]) / ld[k];
        if (a > b) { const t = a; a = b; b = t; }
        t0 = Math.max(t0, a); t1 = Math.min(t1, b);
        if (t0 > t1) ok = false;
      }
      if (ok && t0 < bt) { bt = t0; best = { id: r.id, t: t0 }; }
    }
    return best;
  }

  /** body-frame position (floor centre) of a building, or null */
  positionOf(id: number): [number, number, number] | null {
    const r = this.byId.get(id);
    if (!r) return null;
    const H = (r.variant.meshes[0] ?? r.variant.meshes[1])?.height ?? 4;
    return [r.px + r.ux * H * 0.6, r.py + r.uy * H * 0.6, r.pz + r.uz * H * 0.6];
  }

  /** footprints that roads should not run through: [x, y, z, radius] in the body frame */
  footprints(): [number, number, number, number][] {
    const out: [number, number, number, number][] = [];
    for (const r of this.recs) {
      switch (r.kind) { case 'wall': case 'gate': case 'pen': case 'market': case 'dock': case 'well': case 'hearth': case 'aqueduct': case 'shipyard': continue; }
      if (r.state[2] & BuildingFlag.ruined) continue;
      out.push([r.px, r.py, r.pz, 0.42 * Math.min(r.w, r.d)]);
    }
    return out;
  }

  /** body-frame matrix of a building: radial up, front toward heading `rot`, floor at the highest ground corner */
  private place(pv: PlanetView, id: number, variant: Variant, px: number, py: number, pz: number, rot: number, w: number, d: number, kind: BuildingKind, water: Float32Array | null, surface: Float32Array | null): Rec {
    const l = Math.hypot(px, py, pz) || 1;
    const ux = px / l, uy = py / l, uz = pz / l;
    // east / north tangent frame (tangentBasis convention: east = Y × p)
    let ex = uz, ez = -ux;
    const el = Math.hypot(ex, ez) || 1;
    ex /= el; ez /= el;
    const ey = 0;
    const nx = uy * ez - uz * ey, ny = uz * ex - ux * ez, nz = ux * ey - uy * ex;
    const c = Math.cos(rot), s = Math.sin(rot);
    // local +Z (front) = heading direction; local +X = up × Z
    const zx = nx * c + ex * s, zy = ny * c + ey * s, zz = nz * c + ez * s;
    const xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx;
    const R = pv.params.radius;
    // ground under the footprint: centre + corners
    let hi = -Infinity, lo = Infinity, wet = false, wl = -Infinity, sum = 0, n = 0;
    for (const [a, bb] of [[0, 0], [-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [0, 0.5], [0, -0.5]] as [number, number][]) {
      const qx = ux + (xx * a * w + zx * bb * d) / R, qy = uy + (xy * a * w + zy * bb * d) / R, qz = uz + (xz * a * w + zz * bb * d) / R;
      const ql = Math.hypot(qx, qy, qz);
      const g = groundHeight(pv.ground, qx / ql, qy / ql, qz / ql);
      hi = Math.max(hi, g); lo = Math.min(lo, g); sum += g; n++;
      if (water && surface) {
        const wd = pv.grid.sample(water, qx / ql, qy / ql, qz / ql);
        if (wd > 0.3) { wet = true; wl = Math.max(wl, R + pv.grid.sample(surface, qx / ql, qy / ql, qz / ql) + wd); }
      }
    }
    // the floor: on gentle ground at the mean of the footprint (set into the slope, the uphill side a little buried),
    // on steep ground at the highest corner (its plinth then a foundation wall downhill). Always at the highest corner,
    // every house on a hillside stood on a tall pale pedestal.
    const grade = (hi - lo) / Math.max(1, Math.max(w, d));
    let base = (grade < 0.12 ? Math.max(sum / n, hi - 0.45) : hi) + 0.04;
    if ((kind === 'dock' || kind === 'shipyard') && wet) base = Math.max(lo, wl + 0.35);
    const m = new Float32Array(16);
    m[0] = xx; m[1] = xy; m[2] = xz; m[3] = 0;
    m[4] = ux; m[5] = uy; m[6] = uz; m[7] = 0;
    m[8] = zx; m[9] = zy; m[10] = zz; m[11] = 0;
    m[12] = ux * base; m[13] = uy * base; m[14] = uz * base; m[15] = 1;
    return { id, settlement: -1, kind, variant, m, px: ux * base, py: uy * base, pz: uz * base, ux, uy, uz, state: [1, 0, 0, 0], seed: hashFloat(id, 911), skey: '', w, d, slot: null, slotI: -1, ruinAt: NaN };
  }

  /** emitters and the light field follow the building set and states */
  private rebuildOutputs(pv: PlanetView): void {
    const em: LifeEmitter[] = [];
    const wl: { x: number; y: number; z: number; kind: number; power: number; seed: number }[] = [];
    const N = pv.grid.count;
    // the new light field is built aside and only published (version bump → terrain texture upload) when it differs
    if (!this.lightScratch || this.lightScratch.length !== N) this.lightScratch = new Float32Array(N);
    const lf = this.lightScratch;
    lf.fill(0);
    for (const r of this.recs) {
      const [progress, damage, flags, light] = r.state;
      const kindL = Math.floor(light / 256), level = (light % 256) / 255;
      const ruined = (flags & BuildingFlag.ruined) !== 0;
      const burning = (flags & BuildingFlag.burning) !== 0;
      const working = (flags & BuildingFlag.working) !== 0;
      const flaggedLit = (flags & BuildingFlag.lit) !== 0;
      const lit = flaggedLit || level > 0.01;
      // night light into the cell under the building: kind weights (electric reads brighter from orbit)
      if (lit && !ruined && progress >= 0.999) {
        const c = pv.grid.nearestCell(r.ux, r.uy, r.uz);
        lf[c] += Math.max(level, 0.35) * (kindL >= 4 ? 1.6 : kindL === 3 ? 1.2 : kindL === 2 ? 0.9 : 0.6) * Math.min(2, (r.w * r.d) / 40);
      }
      if (burning) {
        const c = pv.grid.nearestCell(r.ux, r.uy, r.uz);
        lf[c] += 1.5;
      }
      if (lit && !ruined && !burning && progress >= 0.999 && r.kind !== 'wall' && r.kind !== 'gate' && r.kind !== 'pen' && r.kind !== 'dock') {
        const m0 = r.m, hz = r.d / 2 + 1.2;
        wl.push({ x: r.px + m0[8] * hz + m0[4] * 1.6, y: r.py + m0[9] * hz + m0[5] * 1.6, z: r.pz + m0[10] * hz + m0[6] * 1.6, kind: 11, power: Math.max(0.4, level) * (kindL >= 4 ? 1.6 : 1), seed: r.seed });
      }
      const vm = r.variant.meshes[0] ?? r.variant.meshes[1];
      const m = r.m;
      const toBody = (p: [number, number, number]): [number, number, number] => [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
      ];
      if (vm && progress >= 0.999 && !ruined) {
        for (let i = 0; i < vm.emitters.length; i++) {
          const e: Emitter = vm.emitters[i];
          // fire-places burn when the building works or is lit; chimneys smoke when someone is home (or it works)
          let power = 0;
          if (e.kind === EMIT.hearth || e.kind === EMIT.mouth || e.kind === EMIT.brazier) power = working || lit ? Math.max(0.55, level) : 0.25;
          else if (e.kind === EMIT.smoke) power = (flags & (BuildingFlag.occupied | BuildingFlag.working)) || lit ? 0.8 : 0.3;
          else if (e.kind === EMIT.stack) power = working || lit ? 1 : 0.35;
          else if (e.kind === EMIT.beacon || e.kind === EMIT.blink) power = lit ? 1 : 0.5;
          if (power <= 0) continue;
          const p = toBody(e.p);
          em.push({ x: p[0], y: p[1], z: p[2], ux: r.ux, uy: r.uy, uz: r.uz, kind: e.kind, size: e.size, power, seed: hashFloat(r.id, i, 17) });
        }
      }
      if (burning) {
        // fires along the roof — on the ridge and the eaves, spread over the building's length, sized by its footprint
        // and taller as the burn goes on — and one dense dark column of smoke above (lit from below by the fire)
        const H = vm ? vm.height : 4;
        const long = r.w >= r.d;
        const L = (long ? r.w : r.d) * 0.42, S2 = (long ? r.d : r.w) * 0.32;
        const n = Math.max(3, Math.min(6, 2 + Math.round((r.w * r.d) / 25)));
        const grow = 0.75 + 0.5 * Math.min(1, damage * 1.5);
        for (let i = 0; i < n; i++) {
          const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
          const ridge = i % 2 === 0;
          const a = t * L + (hashFloat(r.id, i, 31) - 0.5) * 0.8;
          const b2 = ridge ? (hashFloat(r.id, i, 37) - 0.5) * 0.6 : (hashFloat(r.id, i, 37) < 0.5 ? -S2 : S2);
          const y = ridge ? H * (0.82 + 0.1 * hashFloat(r.id, i, 41)) : H * (0.55 + 0.1 * hashFloat(r.id, i, 41));
          const p = toBody(long ? [a, y, b2] : [b2, y, a]);
          em.push({ x: p[0], y: p[1], z: p[2], ux: r.ux, uy: r.uy, uz: r.uz, kind: EMIT.blaze, size: (0.9 + 0.5 * Math.min(r.w, r.d) / 4) * (0.8 + 0.5 * hashFloat(r.id, i, 43)) * grow, power: 1, seed: hashFloat(r.id, i, 47) });
        }
        const p = toBody([0, H + 1.0, 0]);
        em.push({ x: p[0], y: p[1], z: p[2], ux: r.ux, uy: r.uy, uz: r.uz, kind: EMIT.stack, size: Math.max(1.4, Math.min(4.5, (r.w + r.d) * 0.22)), power: 1, seed: hashFloat(r.id, 53) });
      } else if (ruined && damage > 0.5 && hashFloat(r.id, 59) < 0.5 && pv.paramsTick - r.ruinAt < 1.5 * Math.max(60, pv.params.dayHours * 60)) {
        // a smouldering ruin (for a day or so after the fire)
        const p = toBody([0, 0.6, 0]);
        em.push({ x: p[0], y: p[1], z: p[2], ux: r.ux, uy: r.uy, uz: r.uz, kind: EMIT.smoke, size: 0.8, power: 0.5, seed: hashFloat(r.id, 61) });
      }
    }
    // publish only what changed: occupancy churn in the live sim must not re-upload textures or respawn particles
    let sameEm = em.length === this.emitters.length && wl.length === this.windowLights.length;
    for (let i = 0; sameEm && i < em.length; i++) {
      const a = em[i], b = this.emitters[i];
      if (a.kind !== b.kind || a.power !== b.power || a.seed !== b.seed || a.x !== b.x || a.y !== b.y || a.z !== b.z) sameEm = false;
    }
    for (let i = 0; sameEm && i < wl.length; i++) if (wl[i].power !== this.windowLights[i].power || wl[i].x !== this.windowLights[i].x) sameEm = false;
    if (!sameEm) { this.emitters = em; this.windowLights = wl; this.emittersVersion++; }
    const prev = this.lightField;
    let sameLf = !!prev && prev.length === N;
    for (let i = 0; sameLf && i < N; i++) if (prev![i] !== lf[i]) sameLf = false;
    if (!sameLf) {
      this.lightScratch = prev && prev.length === N ? prev : null;
      this.lightField = lf;
      this.lightVersion++;
    }
  }
  private lightScratch: Float32Array | null = null;

  /** build a few pending variants (a stall at a cut is fine; a stall every frame is not) */
  private buildPending(pv: PlanetView, camX: number, camY: number, camZ: number): boolean {
    let built = 0;
    let any = false;
    const t0 = performance.now();
    const frameMs = this.lastGenT > 0 ? Math.min(4000, t0 - this.lastGenT) : 16;
    this.lastGenT = t0;
    const pend: Variant[] = [];
    for (const v of this.variants.values()) if (v.pending) { v.near = 1e9; pend.push(v); }
    if (!pend.length) { this.stats.pendingVariants = 0; return false; }
    // nearest first: what the camera is looking at appears before the far side of the world
    for (const r of this.recs) {
      if (!r.variant.pending) continue;
      const d = Math.hypot(r.px - camX, r.py - camY, r.pz - camZ);
      if (d < r.variant.near) r.variant.near = d;
    }
    pend.sort((a, b) => a.near - b.near);
    const budget = pend[0].near < 600 ? Math.max(GEN_MS_NEAR, frameMs * 0.33) : GEN_MS;
    for (const v of pend) {
      if (built > 0 && performance.now() - t0 > budget) { any = true; break; }
      const sp = v.spec;
      const mat = materialAt(sp.matIdx);
      for (let lod = 0; lod < 2; lod++) {
        const bm = buildingMesh({ kind: sp.kind, mat, style: sp.style, era: sp.era, mood: sp.mood, w: sp.w, d: sp.d, lod, family: sp.family });
        v.meshes[lod] = bm;
        v.buckets[lod] = this.makeBucket(bm.geo, 8, false, lod === 1);
      }
      v.pending = false;
      built++;
    }
    if (built) { this.dirty = true; this.rebuildOutputs(pv); }
    this.stats.pendingVariants = any ? pend.length - built : 0;
    return any;
  }

  update(pv: PlanetView, camX: number, camY: number, camZ: number): void {
    this.group.visible = this.enabled;
    if (!this.enabled) return;
    this.sync(pv);
    const tick = pv.paramsTick;
    const dayTicks = Math.max(60, pv.params.dayHours * 60);
    // ruins weather slowly: their state is rewritten every couple of game hours while they do
    if (Math.abs(tick - this.lastWeatherTick) > 120) {
      this.lastWeatherTick = tick;
      for (const r of this.recs) if (r.state[2] & BuildingFlag.ruined && tick - r.ruinAt < 7 * dayTicks && r.slot) this.stateChanged.push(r);
    }
    const pend = this.buildPending(pv, camX, camY, camZ);
    const moved = Math.hypot(camX - this.lastCam[0], camY - this.lastCam[1], camZ - this.lastCam[2]);
    if (!this.dirty && moved < 8 && !pend) {
      // state-only changes (a wall rising, a fire lit): rewrite those instances' state in place
      if (this.stateChanged.length) {
        for (const r of this.stateChanged) {
          const b = r.slot;
          if (!b || r.slotI < 0 || r.slotI >= b.count) continue;
          b.state.setXYZW(r.slotI, r.state[0], r.state[1], r.state[2], this.stateW(r, tick, dayTicks));
          b.state.needsUpdate = true;
        }
        this.stateChanged.length = 0;
      }
      return;
    }
    this.stateChanged.length = 0;
    this.dirty = false;
    for (const r of this.recs) { r.slot = null; r.slotI = -1; }
    this.lastCam = [camX, camY, camZ];
    for (const v of this.variants.values()) { for (const b of v.buckets) if (b) b.count = 0; for (const b of v.cutBuckets) if (b) b.count = 0; }
    for (const b of this.scaffolds.values()) b.count = 0;
    for (const b of this.yard.values()) b.count = 0;
    for (const b of this.rubble) b.count = 0;
    let inst = 0;
    for (const r of this.recs) {
      const v = r.variant;
      if (v.pending || r.covered) continue;
      const dist = Math.hypot(r.px - camX, r.py - camY, r.pz - camZ);
      if (dist > MAX_DIST) continue;
      const big = Math.max(r.w, r.d);
      // a ±10 m band around the switch: a building keeps the LOD it has until it is clearly past it (no flicker
      // back and forth while the camera hovers at the threshold)
      const edge = LOD0 + big * 3;
      const lod = r.lod === 0 ? (dist < edge + 10 ? 0 : 1) : r.lod === 1 ? (dist < edge - 10 ? 0 : 1) : dist < edge ? 0 : 1;
      r.lod = lod;
      const bm = v.meshes[lod]!;
      const [progress, damage, flags, light] = r.state;
      const cut = progress < 0.999 || damage > 0.3 || (flags & (BuildingFlag.ruined | BuildingFlag.burning)) !== 0;
      let b: Bucket;
      if (cut) {
        // its own geometry object (sharing the mesh buffers) so its per-instance attributes stay its own
        let cb = v.cutBuckets[lod];
        if (!cb) {
          const g2 = new BufferGeometry();
          for (const [name, a] of Object.entries(bm.geo.attributes)) if (name !== 'iState' && name !== 'iInfo') g2.setAttribute(name, a);
          g2.setIndex(bm.geo.index);
          cb = v.cutBuckets[lod] = this.makeBucket(g2, 4, true, lod === 1);
        }
        b = cb;
      } else b = v.buckets[lod]!;
      b = this.grow(b, b.count + 1);
      const i = b.count++;
      r.slot = b; r.slotI = i;
      _m4.fromArray(r.m);
      b.mesh.setMatrixAt(i, _m4);
      b.state.setXYZW(i, progress, damage, flags, this.stateW(r, tick, dayTicks));
      b.info.setXYZW(i, bm.height, bm.hx, bm.hz, r.seed);
      const tone = 0.9 + 0.2 * r.seed;
      _c.setRGB(tone, tone * (0.98 + 0.04 * hashFloat(r.id, 3)), tone * (0.96 + 0.06 * hashFloat(r.id, 5)));
      b.mesh.setColorAt(i, _c);
      inst++;
      // scaffold while it rises
      if (progress < 0.999 && dist < 900) {
        const H = Math.max(2, Math.round(bm.height * 0.9 / 2) * 2);
        const sk = scaffoldKindFor(r.kind, materialAt(v.spec.matIdx), bm.height);
        const key = `${sk}|${Math.round(r.w)}|${Math.round(r.d)}|${H}`;
        let sb = this.scaffolds.get(key);
        if (!sb) { sb = this.makeBucket(scaffoldMesh(Math.round(r.w), Math.round(r.d), H, sk), 8, true); this.scaffolds.set(key, sb); }
        sb = this.grow(sb, sb.count + 1);
        const j = sb.count++;
        sb.mesh.setMatrixAt(j, _m4);
        sb.state.setXYZW(j, 1, 0, 0, 0);
        sb.info.setXYZW(j, H, r.w / 2, r.d / 2, r.seed);
        sb.mesh.setColorAt(j, _c.setRGB(1, 1, 1));
      }
      // a household's yard: a woodpile, barrels, a fence run, a kitchen garden, a cart, washing, a drying rack — by era,
      // a few per house by the side and back walls (no house stood alone on bare smeared dirt)
      if (progress >= 0.999 && !(flags & BuildingFlag.ruined) && dist < YARD_DIST && DWELLINGS.has(r.kind)) this.yardFor(r, v.spec.era);
      // rubble heaps on ruins: the fallen roof and walls spread a little beyond the footprint
      const ruined = (flags & BuildingFlag.ruined) !== 0 || damage > 0.62;
      if (ruined && dist < 1500) {
        const stone = v.spec.matIdx >= 0 && materialAt(v.spec.matIdx).tier >= 2;
        let rb = this.rubble[stone ? 0 : 1];
        rb = this.grow(rb, rb.count + 1);
        const j = rb.count++;
        const sx = r.w * 0.66, sz = r.d * 0.66, sy = Math.min(1.6, 0.35 + bm.height * 0.12) / 0.32;
        const m = r.m;
        _m4.set(
          m[0] * sx, m[4] * sy, m[8] * sz, m[12],
          m[1] * sx, m[5] * sy, m[9] * sz, m[13],
          m[2] * sx, m[6] * sy, m[10] * sz, m[14],
          0, 0, 0, 1,
        );
        rb.mesh.setMatrixAt(j, _m4);
        rb.state.setXYZW(j, 1, damage, flags & (BuildingFlag.burning | BuildingFlag.ruined), this.stateW(r, tick, dayTicks));
        rb.info.setXYZW(j, 1, 1, 1, r.seed);
        rb.mesh.setColorAt(j, _c.setRGB(1, 1, 1));
      }
    }
    const flush = (b: Bucket) => {
      b.mesh.count = b.count;
      b.mesh.visible = b.count > 0;
      if (b.count) {
        b.mesh.instanceMatrix.needsUpdate = true;
        if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
        b.state.needsUpdate = true;
        b.info.needsUpdate = true;
      }
    };
    let nv = 0;
    for (const v of this.variants.values()) { for (const b of v.buckets) if (b) flush(b); for (const b of v.cutBuckets) if (b) flush(b); if (!v.pending) nv++; }
    for (const b of this.scaffolds.values()) flush(b);
    for (const b of this.yard.values()) flush(b);
    for (const b of this.rubble) flush(b);
    this.stats.instances = inst;
    this.stats.variants = nv;
  }

  dispose(): void {
    this.group.traverse((o) => { if ((o as InstancedMesh).isInstancedMesh) { (o as InstancedMesh).geometry.dispose(); (o as InstancedMesh).dispose(); } });
    this.material.dispose();
    this.materialCut.dispose();
    this.depth.dispose();
  }
}
