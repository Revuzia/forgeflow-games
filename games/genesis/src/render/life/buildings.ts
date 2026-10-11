// GENESIS — buildings on a planet (CONTRACT.md §15.6): BuildingBlock → instanced kit meshes.
//
//   * Each building resolves to a visual VARIANT: archetype (from the content building + the material its builders
//     used + the settlement's era: a shelter of thatch is a round hut, of mudbrick a flat-roofed house, of brick in an
//     industrial city a tenement), material, style, era, mood (the settlement's alignment) and quantised footprint.
//     Variants are generated on demand (render/gen/buildinggen.ts) within a per-frame time budget, nearest the camera
//     first (up to a third of the frame while buildings in view are still missing, a few ms otherwise), and cached.
//     Every mesh (variant LODs, yard props, scaffolds, rubble) lives in one of four BATCHES by material and shadow
//     role (render/life/bldbatch.ts: three's BatchedMesh, one draw call each): near / far × intact / cut open.
//   * Placement: the building's local up is the radial up (walls stay plumb); its floor sits at the highest ground
//     under its footprint (the generator's plinths and piles run 4 m down, so the downhill side meets the slope);
//     docks and shipyards sit on the water when their footprint reaches it.
//   * State per instance (progress, damage, flags, light) drives construction cut-aways, scaffolds, char, ruins (and
//     a rubble heap), burning embers and night-lit windows in the material (render/life/buildingmat.ts).
//   * Outputs for the rest of the life layer: body-frame EMITTERS (chimney smoke, hearths, kiln / forge mouths,
//     factory stacks, beacons, braziers, and fires on burning buildings) for particles and point lights, and a per-
//     cell night LIGHT field (hearth → lamps → electric) for the terrain's city lights seen from orbit.

import { BufferGeometry, Color, Float32BufferAttribute, Group, Matrix4, type IUniform } from 'three';
import type { BuildingBlock, SettlementView } from '../../sim/types.ts';
import { BuildingFlag } from '../../sim/types.ts';
import type { PlanetView } from '../../client/worldview.ts';
import { groundHeight } from '../../sim/grid/surface.ts';
import { hashFloat } from '../../sim/core/rng.ts';
import { SURF, buildingAt, dwellingFamily, eraIndex, materialAt, shelterKind, type BuildFamily, type BuildingKind } from './catalog.ts';
import { KitBuilder, PART } from '../gen/meshkit.ts';
import { extractRoads } from './roadnet.ts';
import { EMIT, HOUSEHOLD_VARIANTS, buildingMesh, marketHallH, rubbleMesh, scaffoldKindFor, scaffoldMesh, yardPropMesh, type BuildingMesh, type Emitter, type YardProp } from '../gen/buildinggen.ts';
import { BldBatch } from './bldbatch.ts';

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
  pending: boolean;
  /** distance (m) from the camera to the nearest building of this variant (pending variants build nearest first) */
  near: number;
  spec: { kind: BuildingKind; matIdx: number; style: number; era: number; mood: number; w: number; d: number; family?: BuildFamily; hv?: number };
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
  slot: BldBatch | null;
  slotI: number;
  /** the ground's slope under it (local x, z) for the kinds that follow the ground instead of standing level */
  shx?: number; shz?: number;
  /** its far-LOD instance while it cross-fades between LODs */
  slot2?: BldBatch | null;
  /** its shadow caster's slot in the shadow batch (−1 none) */
  slotS?: number;
  slotI2?: number;
  /** sim tick it was first seen ruined (NaN: not ruined; -1e9: already a ruin when first seen) */
  ruinAt: number;
  /** its own geometry per LOD (a market draped on the ground under it), and the variant mesh each was made from */
  own?: (BufferGeometry | null)[];
  ownSrc?: (BufferGeometry | null)[];
  /** the drape of a market: local ground offset (m) at local (x, z) */
  drape?: (x: number, z: number) => number;
  /** the earth bank round its footing on a slope (undefined: not made yet, null: none needed) */
  bank?: BufferGeometry | null;
  /** it burned (seen burning, or a ruin first seen on burnt ground or beside a fire): its ruin is charred */
  burnt?: boolean;
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
const _cb = new Color(1, 1, 1);
const LOD0 = 110;
/** houses whose shadow beyond ~55 m is a box-and-gable proxy (Buildings.shadowProxy) */
const PROXY_KINDS = new Set<string>(['wattle', 'mudbrick', 'stone-house', 'timber', 'brick-house', 'half-timber', 'block', 'workshop', 'longhouse', 'barn', 'tenement']);
/** half-width (m) of the band over which a building cross-fades from its near mesh to its far one */
const LOD_BAND = 14;
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
  /** the batches: near (LOD 0) and far (LOD 1 and yard props), each intact and cut open, and the shadow casters */
  private bNear: BldBatch;
  private bNearCut: BldBatch;
  private bFar: BldBatch;
  private bFarCut: BldBatch;
  private bShadow: BldBatch;
  private batches: BldBatch[];
  private variants = new Map<string, Variant>();
  private recs: Rec[] = [];
  private byId = new Map<number, Rec>();
  private lastBlock: BuildingBlock | null = null;
  private lastSurfaceVersion = -1;
  private lastCam: [number, number, number] = [1e9, 0, 0];
  private dirty = true;
  /** buildings whose state changed without changing their meshes (rewritten in place by update) */
  private stateChanged: Rec[] = [];
  private scaffolds = new Map<string, BufferGeometry>();
  /** yard props around dwellings: prop|variant -> geometry */
  private yard = new Map<string, BufferGeometry>();
  private rubble: BufferGeometry[] = [];
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
  /** some building is cross-fading between its LODs (instances are rewritten on smaller camera moves) */
  private fading = false;
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
    // double-sided, so the inside faces of their walls read as broken cores (buildingmat.ts). The shadows of the near
    // buildings are cast by their FAR meshes (a quarter of the triangles: sills, frames and shutters do not show in a
    // shadow map's texels) from a batch drawn only into the cascades; far buildings and yard props cast none (the
    // cascades do not resolve them, and the depth passes had doubled the geometry drawn).
    this.bNear = new BldBatch('buildings-near', shared, false, false);
    this.bNearCut = new BldBatch('buildings-near-cut', shared, true, false, 128, 1 << 17);
    this.bFar = new BldBatch('buildings-far', shared, false, false);
    this.bFarCut = new BldBatch('buildings-far-cut', shared, true, false, 128, 1 << 16);
    this.bShadow = new BldBatch('buildings-shadow', shared, false, true, 512, 1 << 18, true);
    this.batches = [this.bNear, this.bNearCut, this.bFar, this.bFarCut, this.bShadow];
    for (const b of this.batches) this.group.add(b.mesh);
    for (let i = 0; i < 2; i++) this.rubble.push(rubbleMesh(77 + i * 13, i === 0));
  }

  setShadowCasting(on: boolean): void {
    if (on === this.castShadows) return;
    this.castShadows = on;
    for (const b of this.batches) {
      if (b.shadowOnly) { if (on) b.mesh.layers.set(1); else b.mesh.layers.disableAll(); continue; }
      if (on && b.shadow) b.mesh.layers.enable(1); else b.mesh.layers.disable(1);
    }
  }

  swapDepth(depth: boolean): void {
    for (const b of this.batches) b.mesh.material = depth ? b.depth : b.material;
  }

  private variantFor(kind: BuildingKind, matIdx: number, style: number, era: number, mood: number, w: number, d: number, family?: BuildFamily, hv?: number): Variant {
    const key = `${kind}|${matIdx}|${style}|${era}|${mood}|${w}|${d}${family ? `|${family}` : ''}${hv !== undefined ? `|h${hv}` : ''}`;
    let v = this.variants.get(key);
    if (!v) {
      v = { key, meshes: [null, null], pending: true, near: 1e9, spec: { kind, matIdx, style, era, mood, w, d, family, hv } };
      this.variants.set(key, v);
    }
    return v;
  }

  /** remember when a building became a ruin (its char weathers from then), and whether it burned */
  private noteRuin(r: Rec, flags: number, tick: number, firstLook: boolean): void {
    if (flags & BuildingFlag.burning) r.burnt = true;
    const ruined = (flags & BuildingFlag.ruined) !== 0;
    if (!ruined) { r.ruinAt = NaN; return; }
    if (Number.isNaN(r.ruinAt)) r.ruinAt = firstLook ? -1e9 : tick;
  }

  /**
   * The instance's fourth state value: its light, or for a ruin its weathering (buildingmat.ts reads it): 2000 +
   * 0..999 a burnt ruin (soot-black when it falls, grey-brown and greening after about six days), 3000 + 0..999 one
   * fallen from neglect, flood or abandonment (its own walls, darkened and streaked, greening the same).
   */
  private stateW(r: Rec, tick: number, dayTicks: number): number {
    if (!(r.state[2] & BuildingFlag.ruined)) return r.state[3];
    const age = Number.isNaN(r.ruinAt) ? 1e9 : tick - r.ruinAt;
    return (r.burnt ? 2000 : 3000) + Math.round(Math.max(0, Math.min(1, age / (6 * dayTicks))) * 999);
  }

  /** ruins first seen already fallen: charred if the ground about them burned or a fire burns beside them */
  private judgeBurnt(pv: PlanetView): void {
    const burntF = pv.fields.get('burnt'), fireF = pv.fields.get('fire');
    for (const r of this.recs) {
      if (r.burnt !== undefined || !(r.state[2] & BuildingFlag.ruined)) continue;
      let b = false;
      const c = pv.grid.nearestCell(r.ux, r.uy, r.uz);
      if ((burntF && burntF[c] > 0.12) || (fireF && fireF[c] > 0.05)) b = true;
      if (!b) for (const o of this.recs) {
        if (!(o.state[2] & BuildingFlag.burning)) continue;
        if (Math.hypot(o.px - r.px, o.py - r.py, o.pz - r.pz) < 45) { b = true; break; }
      }
      r.burnt = b;
    }
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
      const gap = prop === 'garden' || prop === 'fence' ? 1.7 : prop === 'cart' || prop === 'laundry' ? 2.1 : 0.7;
      // clear of the house's own extent (eaves, an annex on one side)
      const ext = r.variant.meshes[0]?.ext ?? [-r.w / 2, r.w / 2, -r.d / 2, r.d / 2];
      const x = slot === 0 ? ext[0] - gap : slot === 1 ? ext[1] + gap : along * r.w;
      const z = slot === 2 ? ext[2] - gap : along * r.d;
      const yaw = slot === 0 ? -Math.PI / 2 : slot === 1 ? Math.PI / 2 : Math.PI;
      const vi = hashFloat(r.id, i, 0x7a5) < 0.5 ? 0 : 1;
      const key = `${prop}|${vi}`;
      let g = this.yard.get(key);
      if (!g) { g = yardPropMesh(prop, vi); this.yard.set(key, g); }
      _m4.fromArray(r.m).multiply(_yl.makeRotationY(yaw).setPosition(x, -0.04, z));
      const tone = 0.9 + 0.2 * hashFloat(r.id, i, 0x7a6);
      const b = this.bFar;
      b.add(b.geom(g), _m4, _c.setRGB(tone, tone, tone), 1, 0, 0, 0, 1, 1, 1, r.seed, 0, 0, 0);
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
      for (const old of this.recs) if (old.own || old.bank) this.dropOwn(old);
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
        // each household builds its own way (colours, pitch, door, chimney, annex...): a street is not one model repeated
        const hv = DWELLINGS.has(kind) ? Math.floor(hashFloat(id, 0x4856) * HOUSEHOLD_VARIANTS) : undefined;
        const variant = this.variantFor(kind, b.material[i], style, st.era, st.mood, w, d, family, hv);
        rec = this.place(pv, id, variant, px, py, pz, rot, w, d, kind, water ?? null, surface ?? null);
        rec.settlement = b.settlement[i];
        rec.skey = skey;
        rec.state = state;
        if (old) { rec.ruinAt = old.ruinAt; rec.burnt = old.burnt; }
      }
      // a ruin already standing at the first look is old; one that falls while we watch starts fresh
      this.noteRuin(rec, state[2], pv.paramsTick, prev === null);
      next.push(rec);
      nextById.set(id, rec);
    }
    for (const old of this.recs) if ((old.own || old.bank) && nextById.get(old.id) !== old) this.dropOwn(old);
    this.recs = next;
    this.byId = nextById;
    this.coverRuins();
    this.judgeBurnt(pv);
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

  /**
   * How far above the ground (m) someone stands at unit vector (ux, uy, uz) whose ground is `ground` (distance from
   * the planet centre): on a market square, its draped paving (drapeMarket: raised over the ground's dimples); 0
   * elsewhere.
   */
  surfaceLift(ux: number, uy: number, uz: number, ground: number): number {
    for (const r of this.recs) {
      if (!r.drape) continue;
      const m = r.m;
      const dx = ux * ground - m[12], dy = uy * ground - m[13], dz = uz * ground - m[14];
      const x = dx * m[0] + dy * m[1] + dz * m[2], z = dx * m[8] + dy * m[9] + dz * m[10];
      if (Math.abs(x) > r.w / 2 + 0.15 || Math.abs(z) > r.d / 2 + 0.15) continue;
      return Math.max(0, r.drape(x, z) - (dx * m[4] + dy * m[5] + dz * m[6]));
    }
    return 0;
  }

  /**
   * Roof ridges near a body-frame point where birds can perch: [x, y, z] (body frame, on the ridge line) for up to
   * `max` intact, finished buildings within `r` metres
   */
  perchesNear(x: number, y: number, z: number, r: number, max: number): number[] {
    const out: number[] = [];
    for (const rec of this.recs) {
      if (out.length >= max * 3) break;
      if (rec.state[0] < 0.999 || (rec.state[2] & (BuildingFlag.ruined | BuildingFlag.burning)) || rec.covered) continue;
      if (Math.hypot(rec.px - x, rec.py - y, rec.pz - z) > r) continue;
      const vm = rec.variant.meshes[0] ?? rec.variant.meshes[1];
      if (!vm) continue;
      // along the ridge (the long axis), a little below the top
      const m = rec.m, h = vm.height * 0.97;
      const long = rec.w >= rec.d;
      for (const t of [-0.3, 0.05, 0.32]) {
        const lx = long ? t * rec.w : 0, lz = long ? 0 : t * rec.d;
        out.push(m[12] + m[0] * lx + m[4] * h + m[8] * lz, m[13] + m[1] * lx + m[5] * h + m[9] * lz, m[14] + m[2] * lx + m[6] * h + m[10] * lz);
      }
    }
    return out;
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
    let hi = -Infinity, lo = Infinity, wet = false, wl = -Infinity, sum = 0, n = 0, gx = 0, gz = 0;
    // (a lighthouse's keeper's cottage stands behind the tower, outside its footprint: buildinggen lighthouse())
    const samples: [number, number][] = [[0, 0], [-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [0, 0.5], [0, -0.5]];
    if (kind === 'lighthouse') {
      const zc = -(Math.min(w, d) * 0.38 + 3.2) / d;
      samples.push([-2.5 / w, zc - 2 / d], [2.5 / w, zc - 2 / d], [2.5 / w, zc + 2 / d], [-2.5 / w, zc + 2 / d], [0, zc]);
    }
    for (const [a, bb] of samples) {
      const qx = ux + (xx * a * w + zx * bb * d) / R, qy = uy + (xy * a * w + zy * bb * d) / R, qz = uz + (xz * a * w + zz * bb * d) / R;
      const ql = Math.hypot(qx, qy, qz);
      const g = groundHeight(pv.ground, qx / ql, qy / ql, qz / ql);
      hi = Math.max(hi, g); lo = Math.min(lo, g); sum += g; n++;
      // the ground's plane over the footprint (least squares through the samples)
      gx += a * g; gz += bb * g;
      if (water && surface) {
        const wd = pv.grid.sample(water, qx / ql, qy / ql, qz / ql);
        if (wd > 0.3) { wet = true; wl = Math.max(wl, R + pv.grid.sample(surface, qx / ql, qy / ql, qz / ql) + wd); }
      }
    }
    // the floor: on gentle ground at the mean of the footprint (set into the slope, the uphill side a little buried),
    // on steep ground at the highest corner (its plinth then a foundation wall downhill). Always at the highest corner,
    // every house on a hillside stood on a tall pale pedestal.
    const grade = (hi - lo) / Math.max(1, Math.max(w, d));
    // (on steep ground the house is also cut a little into the slope uphill — a terrace — so the footing downhill is
    // not a storey-high pedestal)
    let base = (grade < 0.12 ? Math.max(sum / n, hi - 0.45) : Math.max(hi - 0.6, lo + (hi - lo) * 0.5)) + 0.04;
    // the footing shows at most ~0.8 m downhill (plinth top ~0.3 m above the floor): the house is set into the slope
    // instead, up to ~1.2 m on its uphill side (the ground meets its wall there); what is still exposed below that, an
    // earth bank covers (bankFor). A 2 m dark wedge under every house on a hillside read as a pedestal.
    base = Math.min(base, Math.max(lo + 0.5, hi - 1.2));
    if ((kind === 'dock' || kind === 'shipyard') && wet) base = Math.max(lo, wl + 0.35);
    // open ground works follow the slope (a sheared mesh: posts stay plumb) instead of standing on a level slab whose
    // downhill side stood up like a table: a market square, a pen, a run of wall, a hearth ring, a store pit
    let shx = 0, shz = 0;
    if (kind === 'market') {
      // a market square is draped on its own ground (drapeMarket): its floor at the footprint's mean
      base = sum / n;
    } else if (kind === 'pen' || kind === 'wall' || kind === 'hearth' || kind === 'store-pit') {
      // Σa² = Σb² = 4 × 0.25 + 1 × 0.25 (the corners and the two edge mid-points), over w and d metres
      shx = Math.max(-0.35, Math.min(0.35, gx / (1.0 * w)));
      shz = Math.max(-0.35, Math.min(0.35, gz / (1.5 * d)));
      base = sum / n + 0.03;
    }
    const m = new Float32Array(16);
    m[0] = xx; m[1] = xy; m[2] = xz; m[3] = 0;
    m[4] = ux; m[5] = uy; m[6] = uz; m[7] = 0;
    m[8] = zx; m[9] = zy; m[10] = zz; m[11] = 0;
    m[12] = ux * base; m[13] = uy * base; m[14] = uz * base; m[15] = 1;
    return { id, settlement: -1, kind, variant, m, px: ux * base, py: uy * base, pz: uz * base, ux, uy, uz, state: [1, 0, 0, 0], seed: hashFloat(id, 911), skey: '', w, d, slot: null, slotI: -1, ruinAt: NaN, shx, shz };
  }

  private dropOwn(r: Rec): void {
    for (const g of r.own ?? []) if (g) { for (const b of this.batches) b.dropGeom(g); g.dispose(); }
    if (r.bank) { for (const b of this.batches) b.dropGeom(r.bank); r.bank.dispose(); }
    r.own = undefined; r.ownSrc = undefined; r.bank = undefined;
  }

  /**
   * A house's shadow beyond ~55 m from the camera: a box to the eaves under a gabled prism to its top (~20 triangles)
   * instead of its far mesh (~400–800: the city view's shadow casters were 115 k triangles in three cascades). Its
   * faces wound outward like the kit's, so only the side away from the sun casts (buildingmat.ts depth: back faces).
   */
  private shadowProxy(lm: BuildingMesh): BufferGeometry {
    let g = this.proxies.get(lm.geo);
    if (g) return g;
    const k = new KitBuilder();
    const H = Math.max(2.5, lm.height), e = Math.max(2, H * 0.62);
    const hx = lm.hx, hz = lm.hz, c: [number, number, number] = [0.5, 0.5, 0.5];
    k.box(-hx * 0.92, -1, -hz * 0.92, hx * 0.92, e, hz * 0.92, SURF.plaster, PART.wall, c, { skip: ['bottom'] });
    // the roof: its ridge along the long side
    const P = (a: number, y: number, b: number): [number, number, number] => (hx >= hz ? [a, y, b] : [b, y, -a]);
    const L = Math.max(hx, hz), S = Math.min(hx, hz);
    k.quad(P(-L, e, S), P(L, e, S), P(L, H, 0), P(-L, H, 0), SURF.plaster, PART.roof, c);
    k.quad(P(L, e, -S), P(-L, e, -S), P(-L, H, 0), P(L, H, 0), SURF.plaster, PART.roof, c);
    k.triangle(P(L, e, S), P(L, e, -S), P(L, H, 0), SURF.plaster, PART.wall, c);
    k.triangle(P(-L, e, -S), P(-L, e, S), P(-L, H, 0), SURF.plaster, PART.wall, c);
    g = k.build();
    this.proxies.set(lm.geo, g);
    return g;
  }
  private proxies = new WeakMap<BufferGeometry, BufferGeometry>();

  /**
   * An earth bank round a building's footing where the ground falls away more than ~0.8 m below its plinth top: a
   * ragged slope of soil and turf from 0.8 m under the plinth top out to where it meets the ground (1:1.3, sunk at its
   * foot), darker soil at the top, the ground's grass toward its foot. Only where the footing shows: where the ground
   * already reaches the bank's top the bank dives under it (a ring drawn all round lay on the grass as a brown path).
   * Null when the footing nowhere shows that much.
   */
  private bankFor(r: Rec, pv: PlanetView): BufferGeometry | null {
    switch (r.kind) { case 'market': case 'pen': case 'wall': case 'gate': case 'hearth': case 'store-pit': case 'dock': case 'shipyard': case 'well': case 'aqueduct': return null; }
    const m = r.m;
    const g = (x: number, z: number): number => {
      const px = m[0] * x + m[8] * z + m[12], py = m[1] * x + m[9] * z + m[13], pz = m[2] * x + m[10] * z + m[14];
      const l = Math.hypot(px, py, pz);
      return groundHeight(pv.ground, px / l, py / l, pz / l) - l;
    };
    const k = new KitBuilder();
    let any = false;
    if (r.kind === 'lighthouse') {
      // its footings are the round tower and the keeper's cottage behind it (buildinggen lighthouse(): R = 0.38 × the
      // short side, the cottage 5 × 4 m centred at z = −R − 3.2), not the footprint's square
      const R0 = Math.min(r.w, r.d) * 0.38;
      any = this.bankRing(k, r, g, 0, 0, R0 + 0.15, R0 + 0.15, R0 + 0.15, 0) || any;
      any = this.bankRing(k, r, g, 0, -R0 - 3.2, 2.5 + 0.35, 2 + 0.35, 0.5, 1) || any;
    } else any = this.bankRing(k, r, g, 0, 0, r.w / 2 + 0.25, r.d / 2 + 0.25, 0.6, 0);
    return any ? k.build() : null;
  }

  /** one bank round a rounded-rectangle footing (centre cx, cz; half sizes; corner radius) into k; false if none shows */
  private bankRing(k: KitBuilder, r: Rec, g: (x: number, z: number) => number, cx: number, cz: number, hw: number, hd: number, rc: number, salt: number): boolean {
    rc = Math.min(rc, hw, hd);
    const sx = hw - rc, sz = hd - rc;
    const L1 = 2 * sx, L2 = 2 * sz, A = (Math.PI / 2) * rc;
    const total = 2 * (L1 + L2) + 4 * A;
    // every ~0.9 m round the footing
    const n = Math.max(16, Math.round(total / 0.9));
    const ring: [number, number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      let t = (i / n) * total;
      // walk the rounded rectangle: +z side (x from −sx to sx), corner, +x side, corner, −z side, corner, −x side, corner
      const segs: [number, (u: number) => [number, number, number, number]][] = [
        [L1, (u) => [-sx + u, hd, 0, 1]],
        [A, (u) => { const a = u / rc; return [sx + Math.sin(a) * rc, sz + Math.cos(a) * rc, Math.sin(a), Math.cos(a)]; }],
        [L2, (u) => [hw, sz - u, 1, 0]],
        [A, (u) => { const a = u / rc; return [sx + Math.cos(a) * rc, -sz - Math.sin(a) * rc, Math.cos(a), -Math.sin(a)]; }],
        [L1, (u) => [sx - u, -hd, 0, -1]],
        [A, (u) => { const a = u / rc; return [-sx - Math.sin(a) * rc, -sz - Math.cos(a) * rc, -Math.sin(a), -Math.cos(a)]; }],
        [L2, (u) => [-hw, -sz + u, -1, 0]],
        [A, (u) => { const a = u / rc; return [-sx - Math.cos(a) * rc, sz + Math.sin(a) * rc, -Math.cos(a), Math.sin(a)]; }],
      ];
      for (const [len, f] of segs) { if (t <= len) { const q = f(t); q[0] += cx; q[1] += cz; ring.push(q); break; } t -= len; }
    }
    // top of the bank: 0.8 m below the plinth top (~0.3 m over the floor), where the ground is lower than that
    const top = 0.3 - 0.8;
    let any = false;
    const rows: { x: number; z: number; y: number }[][] = [];
    const drops: number[] = [];
    for (let i = 0; i < ring.length; i++) {
      const [x, z, nx, nz] = ring[i];
      const gp = g(x, z);
      const yt = Math.max(gp, top + 0.12 * (hashFloat(r.id, i + salt * 977, 0xba1) - 0.5));
      const drop = yt - gp;
      drops.push(drop);
      if (drop > 0.12) any = true;
      // out along the normal to where a 1:1.3 slope meets the ground (two passes), a little ragged
      let run = Math.max(0.3, drop * 1.3);
      for (let q = 0; q < 2; q++) run = Math.max(0.3, Math.min(4, (yt - g(x + nx * run, z + nz * run)) * 1.3));
      run *= 0.9 + 0.25 * hashFloat(r.id, i + salt * 977, 0xba2);
      const qx = x + nx * run, qz = z + nz * run;
      const mx = x + nx * run * 0.45, mz = z + nz * run * 0.45;
      const gm = g(mx, mz), gq = g(qx, qz);
      // (a low bank swells less, and where the ground already reaches the top it dives under the grass)
      const s = Math.min(1, drop / 0.5);
      rows.push([
        { x: x - nx * 0.3, z: z - nz * 0.3, y: drop > 0.08 ? yt : gp - 0.25 },
        { x: mx, z: mz, y: Math.max(gm - 0.03 - 0.2 * (1 - s), yt - (yt - gq) * 0.38 + 0.08 * s - 0.2 * (1 - s)) },
        { x: qx, z: qz, y: gq - 0.3 },
      ]);
    }
    if (!any) return false;
    const soil: [number, number, number] = [0.095, 0.074, 0.05], turf: [number, number, number] = [0.095, 0.1, 0.05];
    const cols = [soil, [0.095, 0.088, 0.05] as [number, number, number], turf];
    for (let i = 0; i < rows.length; i++) {
      const i1 = (i + 1) % rows.length;
      if (Math.max(drops[i], drops[i1]) < 0.1) continue;
      const a = rows[i], b = rows[i1];
      for (let j = 0; j < 2; j++) {
        // (wound so the face looks up and out)
        const p0: [number, number, number] = [a[j].x, a[j].y, a[j].z], p1: [number, number, number] = [a[j + 1].x, a[j + 1].y, a[j + 1].z];
        const p2: [number, number, number] = [b[j + 1].x, b[j + 1].y, b[j + 1].z], p3: [number, number, number] = [b[j].x, b[j].y, b[j].z];
        const c = cols[j];
        k.quad(p0, p1, p2, p3, SURF.earth, PART.prop, c, [0.8, 0.95, 0.95, 0.8], 0.37);
      }
    }
    return true;
  }

  /** a building's own (draped) geometry for LOD l, or its variant's shared mesh */
  private geoFor(r: Rec, l: number, lm: BuildingMesh, pv: PlanetView): BufferGeometry {
    if (r.kind !== 'market') return lm.geo;
    r.own ??= [null, null];
    r.ownSrc ??= [null, null];
    if (r.own[l] && r.ownSrc[l] === lm.geo) return r.own[l]!;
    if (r.own[l]) { for (const b of this.batches) b.dropGeom(r.own[l]!); r.own[l]!.dispose(); }
    const g = this.drapeMarket(r, lm, pv);
    r.own[l] = g; r.ownSrc[l] = lm.geo;
    return g;
  }

  /**
   * A market's own copy of its variant mesh, draped on the ground under it. The paving (a grid of 1 m flags) and its
   * kerb follow the ground, raised by the chord error over each flag (a hump between two grid nodes never pokes
   * through; a plain slope lifts nothing) + 3 cm; stalls, crates, the well and the hall's column bases stand on the
   * draped paving where they are; the hall's capitals, beams and roof stay level at the highest column base and its
   * shafts stretch to meet them. (A level slab sunk into the ground, or one sheared to the slope's plane, could not
   * follow the ground's ~12 m humps: they broke through the paving, or the downhill edge stood up as a wall.)
   */
  private drapeMarket(r: Rec, lm: BuildingMesh, pv: PlanetView): BufferGeometry {
    if (!r.drape) {
      const W = r.w, D = r.d, m = r.m;
      const nx = Math.max(2, Math.round(W)), nz = Math.max(2, Math.round(D));
      const cw = W / nx, cd = D / nz;
      // ground (m along the local up) at local (x, z), relative to the floor's level
      const g = (x: number, z: number): number => {
        const px = m[0] * x + m[8] * z + m[12], py = m[1] * x + m[9] * z + m[13], pz = m[2] * x + m[10] * z + m[14];
        const l = Math.hypot(px, py, pz);
        return groundHeight(pv.ground, px / l, py / l, pz / l) - l;
      };
      // nodes of the flag grid, with one ring of nodes beyond it (i, j from −1 to n + 1)
      const NX = nx + 3, NZ = nz + 3;
      const X = (i: number) => -W / 2 + i * cw, Z = (j: number) => -D / 2 + j * cd;
      const h = new Float32Array(NX * NZ), lift = new Float32Array(NX * NZ);
      // a paved square does not dip into the ground's ~3 m dimples: each node is raised by the dimple it sits in (half
      // 0.7 of the rise of the ground ~1.4 m either side of it, the slope cancelled between the pair; at most 0.4 m). The
      // terrain mesh drops that octave of the detail relief on its coarser patches (chunks.ts), and the dimples it
      // leaves filled stood through a paving draped into them — a blotchy "egg-crate" of soil across the square. The
      // kerb runs deep enough to meet the ground under a raised edge, and people stand on the paving (surfaceLift).
      const RING = 1.4;
      for (let j = -1; j <= nz + 1; j++) for (let i = -1; i <= nx + 1; i++) {
        const g0 = g(X(i), Z(j));
        let dip = 0;
        for (let q = 0; q < 3; q++) {
          const a = (q / 3) * Math.PI + 0.3, ox = Math.cos(a) * RING, oz = Math.sin(a) * RING;
          dip = Math.max(dip, 0.7 * ((g(X(i) + ox, Z(j) + oz) + g(X(i) - ox, Z(j) - oz)) * 0.5 - g0));
        }
        h[(j + 1) * NX + i + 1] = g0 + Math.min(0.4, dip);
      }
      for (let j = -1; j <= nz; j++) for (let i = -1; i <= nx; i++) {
        const k00 = (j + 1) * NX + i + 1, k10 = k00 + 1, k01 = k00 + NX, k11 = k01 + 1;
        let e = 0;
        for (const u of [0.25, 0.5, 0.75]) for (const v of [0.25, 0.5, 0.75]) {
          const bil = h[k00] * (1 - u) * (1 - v) + h[k10] * u * (1 - v) + h[k01] * (1 - u) * v + h[k11] * u * v;
          e = Math.max(e, g(X(i) + u * cw, Z(j) + v * cd) - bil);
        }
        for (const k of [k00, k10, k01, k11]) lift[k] = Math.max(lift[k], e);
      }
      r.drape = (x: number, z: number): number => {
        const fi = Math.max(-1, Math.min(nx + 1 - 1e-6, (x + W / 2) / cw)), fj = Math.max(-1, Math.min(nz + 1 - 1e-6, (z + D / 2) / cd));
        const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
        const k00 = (j + 1) * NX + i + 1, k10 = Math.min(k00 + 1, (j + 2) * NX - 1), k01 = Math.min(k00 + NX, NX * NZ - 1), k11 = Math.min(k01 + 1, NX * NZ - 1);
        const H = (k: number) => h[k] + lift[k];
        return H(k00) * (1 - u) * (1 - v) + H(k10) * u * (1 - v) + H(k01) * (1 - u) * v + H(k11) * u * v + 0.04;
      };
    }
    const at = r.drape;
    const src = lm.geo;
    const pos = src.getAttribute('position');
    const out = new Float32Array(pos.count * 3);
    // the hall: a level roof at its highest column base
    const Hh = marketHallH(r.variant.spec.era);
    let roofOff = -1e9;
    if (Hh > 0) for (let i = 0; i < 6; i++) for (const sz of [-1, 1]) roofOff = Math.max(roofOff, at(-r.w / 2 + 1 + (i * (r.w - 2)) / 5, sz * (r.d / 2 - 1)));
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      let off = at(x, z);
      if (Hh > 0) {
        if (y >= Hh - 0.3) off = roofOff;
        else if (y > 0.45) off += (roofOff - off) * Math.min(1, (y - 0.45) / (Hh - 0.75));
      }
      out[i * 3] = x; out[i * 3 + 1] = y + off; out[i * 3 + 2] = z;
    }
    const g = new BufferGeometry();
    for (const [name, a] of Object.entries(src.attributes)) g.setAttribute(name, name === 'position' ? new Float32BufferAttribute(out, 3) : a);
    g.setIndex(src.index);
    return g;
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
        // fires along the roof — on the ridge and the eaves, sized by the footprint and taller as the burn goes on —
        // clustered where the fire took hold (the biggest blaze there; the burn front of buildingmat.ts spreads from the
        // same point), their spacing and height irregular and some places not (yet) burning: no picket fence of
        // matching flames on every roof. One dense dark column of smoke above (lit from below by the fire).
        const H = vm ? vm.height : 4;
        const hx = vm ? vm.hx : r.w / 2, hz = vm ? vm.hz : r.d / 2;
        const long = hx >= hz;
        const half = long ? hx : hz;
        const L = (long ? r.w : r.d) * 0.42, S2 = (long ? r.d : r.w) * 0.32;
        const n = Math.max(3, Math.min(7, 2 + Math.round((r.w * r.d) / 22)));
        const grow = 0.75 + 0.5 * Math.min(1, damage * 1.5);
        // where it started (buildingmat.ts fOrigin) and how far along the house it has spread
        const origin = (((r.seed * 7.31) % 1) - 0.5) * 1.4 * half;
        const burnB = Math.min(1, damage * 1.35 + 0.12);
        const spread = 0.8 + burnB * (H * 0.75 + 1 + 0.38 * half * 1.7) / 0.38 * 0.5;
        const sp = (2 * L) / Math.max(1, n - 1);
        let placed = 0;
        for (let i = 0; i < n; i++) {
          const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
          const a = Math.max(-L * 1.1, Math.min(L * 1.1, t * L + (hashFloat(r.id, i, 31) - 0.5) * 0.8 * sp));
          const from = Math.abs(a - origin);
          const lead = i === Math.round(((origin / Math.max(1e-3, L)) * 0.5 + 0.5) * (n - 1));
          // 20–40 % of the places are not burning, and none the fire has not reached yet
          if (!lead && (hashFloat(r.id, i, 33) < 0.2 + 0.2 * hashFloat(r.id, 35) || from > spread)) continue;
          const ridge = (i + (hashFloat(r.id, 39) < 0.5 ? 0 : 1)) % 2 === 0;
          const b2 = ridge ? (hashFloat(r.id, i, 37) - 0.5) * 0.6 : (hashFloat(r.id, i, 37) < 0.5 ? -S2 : S2);
          const y = ridge ? H * (0.8 + 0.12 * hashFloat(r.id, i, 41)) : H * (0.52 + 0.14 * hashFloat(r.id, i, 41));
          const p = toBody(long ? [a, y, b2] : [b2, y, a]);
          // 0.6–1.6×, biggest at the seat of the fire
          const k = (lead ? 1.6 : 0.6 + 0.75 * Math.exp(-from / Math.max(1, 0.5 * L)) + 0.25 * hashFloat(r.id, i, 43));
          em.push({ x: p[0], y: p[1], z: p[2], ux: r.ux, uy: r.uy, uz: r.uz, kind: EMIT.blaze, size: (0.9 + 0.5 * Math.min(r.w, r.d) / 4) * k * grow, power: 1, seed: hashFloat(r.id, i, 47) });
          placed++;
        }
        void placed;
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
        v.meshes[lod] = buildingMesh({ kind: sp.kind, mat, style: sp.style, era: sp.era, mood: sp.mood, w: sp.w, d: sp.d, lod, family: sp.family, hv: sp.hv });
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
    // (while buildings are cross-fading between LODs the instances are rewritten every couple of metres)
    if (!this.dirty && moved < (this.fading ? 2 : 8) && !pend) {
      // state-only changes (a wall rising, a fire lit): rewrite those instances' state in place
      if (this.stateChanged.length) {
        for (const r of this.stateChanged) {
          for (const [b, i] of [[r.slot, r.slotI], [r.slot2 ?? null, r.slotI2 ?? -1], [this.bShadow, r.slotS ?? -1]] as [BldBatch | null, number][]) {
            if (b) b.setState(i, r.state[0], r.state[1], r.state[2], this.stateW(r, tick, dayTicks));
          }
        }
        this.stateChanged.length = 0;
      }
      return;
    }
    this.stateChanged.length = 0;
    this.dirty = false;
    this.fading = false;
    for (const r of this.recs) { r.slot = null; r.slotI = -1; r.slot2 = null; r.slotI2 = -1; r.slotS = -1; }
    this.lastCam = [camX, camY, camZ];
    for (const b of this.batches) b.begin();
    let inst = 0;
    for (const r of this.recs) {
      const v = r.variant;
      if (v.pending || r.covered) continue;
      const dist = Math.hypot(r.px - camX, r.py - camY, r.pz - camZ);
      if (dist > MAX_DIST) continue;
      const big = Math.max(r.w, r.d);
      // near / far mesh: across a band around the switch distance both are drawn, sharing the pixels of a dither
      // (the near one fading out as the far one fades in) — no pop, no flicker at the threshold
      const edge = LOD0 + big * 3;
      const f = Math.max(0, Math.min(1, (edge + LOD_BAND - dist) / (2 * LOD_BAND)));
      const near = f * f * (3 - 2 * f);
      const lod = near >= 0.5 ? 0 : 1;
      r.lod = lod;
      const bm = v.meshes[lod]!;
      const [progress, damage, flags, light] = r.state;
      const cut = progress < 0.999 || damage > 0.3 || (flags & (BuildingFlag.ruined | BuildingFlag.burning)) !== 0;
      const tone = 0.9 + 0.2 * r.seed;
      _c.setRGB(tone, tone * (0.98 + 0.04 * hashFloat(r.id, 3)), tone * (0.96 + 0.06 * hashFloat(r.id, 5)));
      _m4.fromArray(r.m);
      const sw = this.stateW(r, tick, dayTicks);
      const put = (l: number, fade: number): void => {
        const lm = v.meshes[l]!;
        const b = l === 0 ? (cut ? this.bNearCut : this.bNear) : (cut ? this.bFarCut : this.bFar);
        // (the fade is stored as 1 − fade so that zero — what a mesh without it reads — is whole)
        const i = b.add(b.geom(this.geoFor(r, l, lm, pv)), _m4, _c, progress, damage, flags, sw, lm.height, lm.hx, lm.hz, r.seed, 1 - fade, r.shx ?? 0, r.shz ?? 0);
        if (l === lod) { r.slot = b; r.slotI = i; } else { r.slot2 = b; r.slotI2 = i; }
      };
      if (near > 0.002 && near < 0.998) {
        put(0, near);
        put(1, -(1 - near));
        this.fading = true;
      } else put(lod, 1);
      // the shadow of a near building, cast by its far mesh (whole: a dithered caster would leave a dotted shadow)
      if (near > 0.002) {
        const lm1 = v.meshes[1]!, sb = this.bShadow;
        const proxy = dist > 55 && !cut && PROXY_KINDS.has(r.kind) ? this.shadowProxy(lm1) : null;
        r.slotS = sb.add(sb.geom(proxy ?? this.geoFor(r, 1, lm1, pv)), _m4, _c, progress, damage, flags, sw, lm1.height, lm1.hx, lm1.hz, r.seed, 0, r.shx ?? 0, r.shz ?? 0);
      } else r.slotS = -1;
      inst++;
      // the earth bank round its footing on a slope (an instance of its own, never cut away)
      if (r.bank === undefined) r.bank = this.bankFor(r, pv);
      if (r.bank) {
        const bb = lod === 0 ? this.bNear : this.bFar;
        bb.add(bb.geom(r.bank), _m4, _cb, 1, 0, 0, 0, 1, r.w / 2, r.d / 2, r.seed, 0, 0, 0);
      }
      // scaffold while it rises
      if (progress < 0.999 && dist < 900) {
        const H = Math.max(2, Math.round(bm.height * 0.9 / 2) * 2);
        const sk = scaffoldKindFor(r.kind, materialAt(v.spec.matIdx), bm.height);
        const key = `${sk}|${Math.round(r.w)}|${Math.round(r.d)}|${H}`;
        let sg = this.scaffolds.get(key);
        if (!sg) { sg = scaffoldMesh(Math.round(r.w), Math.round(r.d), H, sk); this.scaffolds.set(key, sg); }
        const sb = this.bNearCut;
        sb.add(sb.geom(sg), _m4, _c.setRGB(1, 1, 1), 1, 0, 0, 0, H, r.w / 2, r.d / 2, r.seed, 0, 0, 0);
        this.bShadow.add(this.bShadow.geom(sg), _m4, _c, 1, 0, 0, 0, H, r.w / 2, r.d / 2, r.seed, 0, 0, 0);
      }
      // a household's yard: a woodpile, barrels, a fence run, a kitchen garden, a cart, washing, a drying rack — by era,
      // a few per house by the side and back walls (no house stood alone on bare smeared dirt)
      if (progress >= 0.999 && !(flags & BuildingFlag.ruined) && dist < YARD_DIST && DWELLINGS.has(r.kind)) this.yardFor(r, v.spec.era);
      // rubble heaps on ruins: the fallen roof and walls spread a little beyond the footprint
      const ruined = (flags & BuildingFlag.ruined) !== 0 || damage > 0.62;
      if (ruined && dist < 1500) {
        const stone = v.spec.matIdx >= 0 && materialAt(v.spec.matIdx).tier >= 2;
        const rg = this.rubble[stone ? 0 : 1];
        const sx = r.w * 0.66, sz = r.d * 0.66, sy = Math.min(1.0, 0.3 + bm.height * 0.08) / 0.27;
        const m = r.m;
        _m4.set(
          m[0] * sx, m[4] * sy, m[8] * sz, m[12],
          m[1] * sx, m[5] * sy, m[9] * sz, m[13],
          m[2] * sx, m[6] * sy, m[10] * sz, m[14],
          0, 0, 0, 1,
        );
        const rb = this.bNearCut;
        // (a negative height: the heap is the collapse, never cut away itself)
        rb.add(rb.geom(rg), _m4, _c.setRGB(1, 1, 1), 1, damage, flags & (BuildingFlag.burning | BuildingFlag.ruined), sw, -1, 1, 1, r.seed, 0, 0, 0);
        if (dist < 400) this.bShadow.add(this.bShadow.geom(rg), _m4, _c, 1, damage, flags & (BuildingFlag.burning | BuildingFlag.ruined), sw, -1, 1, 1, r.seed, 0, 0, 0);
      }
    }
    for (const b of this.batches) b.end();
    let nv = 0;
    for (const v of this.variants.values()) if (!v.pending) nv++;
    this.stats.instances = inst;
    this.stats.variants = nv;
  }

  dispose(): void {
    for (const b of this.batches) b.dispose();
    for (const v of this.variants.values()) for (const m of v.meshes) m?.geo.dispose();
    for (const g of this.scaffolds.values()) g.dispose();
    for (const g of this.yard.values()) g.dispose();
    for (const g of this.rubble) g.dispose();
  }
}
