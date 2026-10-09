// GENESIS — peoples on a planet (CONTRACT.md §15.6 "Crowds"): the agents' MoverBlock, plus ambient COHORT crowds
// around the buildings of settlements whose members are aggregated (§8.7), drawn as instanced, GPU-animated bodies.
//
//   * Body per species plan (bipeds for the plains / coastal / cold folk, hexapods for the hive, floating bells for
//     the drifters), three LODs by distance (faces, hands and hair up close; simplified; far silhouettes), hidden past
//     the silhouettes' range. Near LODs cast shadows.
//   * Positions are the snapshot's unit vectors extrapolated by their velocity to the render tick, on the curved ground
//     (sim/grid/surface.ts groundHeight — cached per person until they move), plus their altitude (drifters float,
//     swimmers sit in the water).
//   * Look per person, deterministic from their id: skin and hair from the species' palettes (elders grey), clothing
//     colour from the snapshot tint, clothing TIER from their settlement's era (hides → woven → dyed with trim, belts,
//     trousers and boots → tailored coats and hats), long hair and dresses, beards, children's proportions; a held
//     tool from what they carry or, failing that, from what they are doing (chop → axe, dig → hoe, build → hammer...).
//   * Animation: the state from the snapshot; a change eases over 0.35 s (the shader poses both states and blends).

import type { IUniform, Vector3 } from 'three';
import type { PlanetView } from '../../client/worldview.ts';
import type { MoverBlock } from '../../sim/types.ts';
import { AgentFlag, AnimState } from '../../sim/types.ts';
import { groundHeight } from '../../sim/grid/surface.ts';
import { hashFloat } from '../../sim/core/rng.ts';
import { clothTier, eraIndex, heldForItem, HELD, speciesAt } from './catalog.ts';
import { BIPED_RIG, HEX_RIG, JELLY_RIG, PLAN, STYLE, bipedMesh, hexMesh, jellyMesh, type BodyMesh } from '../gen/bodygen.ts';
import { BodyBuckets, bodyMatrix, unpackLinear } from './bodies.ts';
import type { Buildings } from './buildings.ts';
import { Boats, vesselOf } from './boats.ts';

const LOD_D = [30, 95, 650];
const BLEND_S = 0.35;
/** correction decay time constant (s) and the jump beyond which a person is placed, not slid (m) */
const SMOOTH_S = 0.15;
const SNAP_M = 12;

/**
 * Per person: animation blend, the cached ground under them, and the motion smoother. The live sim's snapshots come at
 * ≤ 30 Hz and a person is extrapolated along their velocity in between; when the next snapshot disagrees (a path turned,
 * a walk ended early, the sim ran a little slower than the clock) the difference is kept as an offset that decays
 * over ~0.15 s instead of snapping (classic error-decay smoothing). Teleports (the hand, `agent.move`) snap.
 */
interface Track {
  id: number; anim: number; prev: number; at: number; gx: number; gy: number; gz: number; ground: number;
  /** last drawn unit position (−2 = never drawn) and the decaying correction offset */
  sx: number; sy: number; sz: number; ox: number; oy: number; oz: number;
  /** drawn heading (eases toward the snapshot's: a path that turns does not flip the body in one frame) */
  hd: number;
}

/** an ambient cohort member (static spot or a short beat in front of a building) */
interface Ambient { ux: number; uy: number; uz: number; vx: number; vy: number; vz: number; len: number; heading: number; anim: number; id: number; settlement: number; species: number; tint: number; flags: number; tool: number }

const _mat = new Float32Array(16);
const _a = new Float32Array(3), _b = new Float32Array(3), _c = new Float32Array(3);
const CLOTH_FALLBACK = [0x8a6a4a, 0xa0784e, 0x6e5236, 0xb8a888, 0x7a2a22, 0x2a4a6a];

export class Crowds {
  readonly bodies: BodyBuckets;
  private tracks = new Map<number, Track>();
  private lastAgents: MoverBlock | null = null;
  private ambient: Ambient[] = [];
  private ambientStamp = '';
  enabled = true;
  density = 1;
  stats = { drawn: 0, agents: 0, ambient: 0 };
  /** drawn people this frame, for picking and the inspector's marker: id and body-frame feet position + height */
  private pickN = 0;
  private pickId = new Int32Array(256);
  private pickP = new Float32Array(256 * 4);
  private lastReal = -1;

  /** the boats people ride (AgentFlag.boat) */
  readonly boats: Boats;

  constructor(shared: Record<string, IUniform>) {
    this.bodies = new BodyBuckets(shared, 'crowds');
    this.boats = new Boats(shared);
    this.bodies.group.add(this.boats.group);
  }

  get group() { return this.bodies.group; }

  private bucketFor(species: number, lod: number) {
    const sp = speciesAt(species);
    const plan = sp.plan === 'hexapod' ? PLAN.hex : sp.plan === 'flyer' ? PLAN.jelly : PLAN.biped;
    const key = `p${plan}|${sp.furred ? 1 : 0}${sp.webbed ? 1 : 0}|${lod}`;
    return this.bodies.get(key, () => {
      let body: BodyMesh;
      if (plan === PLAN.hex) body = hexMesh(lod);
      else if (plan === PLAN.jelly) body = jellyMesh(lod);
      else body = bipedMesh(lod, { furred: sp.furred, webbed: sp.webbed });
      const rig = plan === PLAN.hex ? HEX_RIG : plan === PLAN.jelly ? JELLY_RIG : BIPED_RIG;
      return { body, opts: { plan, rig }, shadows: lod <= 1 };
    });
  }

  /** the tool a person shows: what they carry, else what their work needs */
  private toolFor(anim: number, carry: number, era: number, flags: number, id: number): number {
    const held = heldForItem(carry);
    if (held !== HELD.none) return held;
    switch (anim) {
      case AnimState.chop: return HELD.axe;
      case AnimState.dig: return era >= 4 && hashFloat(id, 3) < 0.4 ? HELD.pick : HELD.hoe;
      case AnimState.build: return HELD.hammer;
      case AnimState.work: return hashFloat(id, 5) < 0.6 ? HELD.hammer : HELD.none;
      case AnimState.fish: return HELD.rod;
      case AnimState.fight: return era >= 8 ? HELD.rifle : era >= 4 ? HELD.sword : HELD.spear;
      case AnimState.teach: return flags & AgentFlag.priest ? HELD.staff : HELD.none;
      case AnimState.carry: return HELD.basket;
    }
    if (flags & AgentFlag.soldier) return era >= 8 ? HELD.rifle : era >= 4 ? HELD.sword : HELD.spear;
    return HELD.none;
  }

  /** style bits: hair, clothing tier, dress, hat, beard, child */
  private styleFor(id: number, flags: number, era: number): number {
    const tier = clothTier(era);
    const female = (flags & AgentFlag.female) !== 0, child = (flags & AgentFlag.child) !== 0, elder = (flags & AgentFlag.elder) !== 0;
    let s = [STYLE.tier0, STYLE.tier1, STYLE.tier2, STYLE.tier3][tier];
    if (child) s |= STYLE.child;
    if (female) { s |= hashFloat(id, 11) < 0.88 ? STYLE.hairLong : STYLE.hairShort; if (tier >= 1 && !child && hashFloat(id, 13) < 0.7) s |= STYLE.dress; }
    else {
      if (elder && hashFloat(id, 17) < 0.45) s |= STYLE.bald; else s |= hashFloat(id, 19) < 0.12 ? STYLE.hairLong : STYLE.hairShort;
      if (!child && hashFloat(id, 23) < (elder ? 0.7 : 0.35)) s |= STYLE.beard;
    }
    if (!child && ((tier === 3 && hashFloat(id, 29) < 0.55) || (tier === 2 && hashFloat(id, 31) < 0.12))) s |= STYLE.hat;
    return s;
  }

  /** ambient cohort people around the buildings of settlements with aggregated members near the camera */
  private buildAmbient(pv: PlanetView, buildings: Buildings, camBody: Vector3): void {
    const R = pv.params.radius;
    const near = pv.settlements.filter((s) => s.cohort > 0 && Math.hypot(s.pos[0] * R - camBody.x, s.pos[1] * R - camBody.y, s.pos[2] * R - camBody.z) < 1400);
    const stamp = `${near.map((s) => `${s.id}:${s.cohort}`).join(',')}|${buildings.emittersVersion}|${this.density}`;
    if (stamp === this.ambientStamp) return;
    this.ambientStamp = stamp;
    this.ambient = [];
    for (const s of near) {
      const fronts = buildings.frontsOf(s.id);
      if (!fronts.length) continue;
      const n = Math.min(Math.round(s.cohort * 0.12 * this.density), 420);
      const sp = speciesAt(s.species);
      for (let k = 0; k < n; k++) {
        const f = fronts[Math.floor(hashFloat(s.id, k, 1) * fronts.length)];
        const id = 900000 + s.id * 5000 + k;
        const off = 1.2 + hashFloat(id, 2) * 3.5, side = (hashFloat(id, 3) - 0.5) * f.w;
        const px = f.x + f.fx * off + f.sx * side, py = f.y + f.fy * off + f.sy * side, pz = f.z + f.fz * off + f.sz * side;
        const l = Math.hypot(px, py, pz);
        const r = hashFloat(id, 4);
        const walking = r < 0.45;
        const anim = walking ? AnimState.walk : r < 0.62 ? AnimState.idle : r < 0.76 ? AnimState.teach : r < 0.88 ? AnimState.sit : r < 0.94 ? AnimState.work : AnimState.carry;
        // walkers pace a short beat along the frontage
        const len = walking || anim === AnimState.carry ? 4 + hashFloat(id, 5) * 10 : 0;
        const heading = Math.atan2(f.sx * f.ex + f.sy * f.ey + f.sz * f.ez, f.sx * f.nx + f.sy * f.ny + f.sz * f.nz);
        this.ambient.push({
          ux: px / l, uy: py / l, uz: pz / l, vx: f.sx / R, vy: f.sy / R, vz: f.sz / R, len,
          heading: len > 0 ? heading : heading + Math.PI / 2 + (hashFloat(id, 6) - 0.5) * 2.5, anim, id, settlement: s.id, species: s.species,
          tint: CLOTH_FALLBACK[Math.floor(hashFloat(id, 7) * CLOTH_FALLBACK.length)],
          flags: (hashFloat(id, 8) < 0.5 ? AgentFlag.female : 0) | (hashFloat(id, 9) < 0.15 ? AgentFlag.child : 0) | (hashFloat(id, 10) < 0.1 ? AgentFlag.elder : 0),
          tool: anim === AnimState.carry ? [HELD.basket, HELD.logs, HELD.pot, HELD.bundle][Math.floor(hashFloat(id, 12) * 4)] : HELD.none,
        });
        void sp;
      }
    }
  }

  update(pv: PlanetView, camBody: Vector3, ticksSinceSnap: number, animTime: number, realTime: number, buildings: Buildings): void {
    this.bodies.group.visible = this.enabled;
    if (!this.enabled) return;
    this.bodies.animTime.value = animTime;
    const A = pv.agents;
    const R = pv.params.radius;
    const eraOf = new Map<number, number>();
    for (const s of pv.settlements) eraOf.set(s.id, eraIndex(s.era));
    this.bodies.begin();
    this.boats.begin();
    const water = pv.fields.get('water');
    const surfaceF = pv.fields.get('surface');
    const cx = camBody.x, cy = camBody.y, cz = camBody.z;
    const fresh = A !== this.lastAgents;
    this.lastAgents = A ?? null;
    const dtR = this.lastReal < 0 ? 0 : Math.max(0, Math.min(0.25, realTime - this.lastReal));
    this.lastReal = realTime;
    const decay = Math.exp(-dtR / SMOOTH_S);
    // the cull radius, padded for the extrapolated step and the ground height above the datum
    const cullSq = (LOD_D[2] + 260) * (LOD_D[2] + 260);
    this.pickN = 0;
    let agents = 0;
    if (A && A.count) {
      for (let i = 0; i < A.count; i++) {
        const id = A.id[i];
        let ux = A.pos[i * 3] + A.vel[i * 3] * ticksSinceSnap, uy = A.pos[i * 3 + 1] + A.vel[i * 3 + 1] * ticksSinceSnap, uz = A.pos[i * 3 + 2] + A.vel[i * 3 + 2] * ticksSinceSnap;
        // quick cull on the datum sphere before anything else (most of a world's people are far from the camera)
        const qx = ux * R - cx, qy = uy * R - cy, qz = uz * R - cz;
        if (qx * qx + qy * qy + qz * qz > cullSq) continue;
        const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
        ux /= ul; uy /= ul; uz /= ul;
        let tr = this.tracks.get(id);
        if (!tr) { tr = { id, anim: A.anim[i], prev: A.anim[i], at: -1e9, gx: 0, gy: 0, gz: 0, ground: 0, sx: -2, sy: 0, sz: 0, ox: 0, oy: 0, oz: 0, hd: A.heading[i] }; this.tracks.set(id, tr); }
        if (fresh && A.anim[i] !== tr.anim) { tr.prev = tr.anim; tr.anim = A.anim[i]; tr.at = realTime; }
        // motion smoothing: a new snapshot's disagreement with what was drawn becomes a decaying offset
        if (fresh && tr.sx > -1.5) {
          tr.ox = tr.sx - ux; tr.oy = tr.sy - uy; tr.oz = tr.sz - uz;
          if ((tr.ox * tr.ox + tr.oy * tr.oy + tr.oz * tr.oz) * R * R > SNAP_M * SNAP_M) tr.ox = tr.oy = tr.oz = 0;
        }
        if (tr.ox !== 0 || tr.oy !== 0 || tr.oz !== 0) {
          tr.ox *= decay; tr.oy *= decay; tr.oz *= decay;
          if ((tr.ox * tr.ox + tr.oy * tr.oy + tr.oz * tr.oz) * R * R < 1e-6) tr.ox = tr.oy = tr.oz = 0;
          ux += tr.ox; uy += tr.oy; uz += tr.oz;
          const sl = Math.hypot(ux, uy, uz) || 1;
          ux /= sl; uy /= sl; uz /= sl;
        }
        tr.sx = ux; tr.sy = uy; tr.sz = uz;
        // ground, re-sampled only when the person has moved ~0.25 m
        if (Math.abs(ux - tr.gx) + Math.abs(uy - tr.gy) + Math.abs(uz - tr.gz) > 0.25 / R || tr.ground === 0) {
          tr.ground = groundHeight(pv.ground, ux, uy, uz); tr.gx = ux; tr.gy = uy; tr.gz = uz;
        }
        const flags = A.flags[i];
        const afloat = (flags & AgentFlag.boat) !== 0;
        let r = tr.ground + A.alt[i];
        // afloat: on the water surface, in their boat (the sim's altitude is for swimmers) — the LINEAR level the water
        // mesh draws (surface + depth interpolated over the sim triangle). Curved ground plus a linear depth stood boats
        // metres above the sea off steep quays and coasts, where the curved ground bulges above the linear one.
        if (afloat) r = water && surfaceF ? pv.params.radius + pv.grid.sample(surfaceF, ux, uy, uz) + Math.max(0, pv.grid.sample(water, ux, uy, uz)) : tr.ground;
        const d = Math.hypot(ux * r - cx, uy * r - cy, uz * r - cz);
        const lod = d < LOD_D[0] ? 0 : d < LOD_D[1] ? 1 : d < LOD_D[2] ? 2 : -1;
        if (lod < 0) continue;
        const sp = speciesAt(A.species[i]);
        const era = eraOf.get(A.group[i]) ?? 2;
        const b = this.bucketFor(A.species[i], lod);
        const k = this.bodies.push(b);
        const scale = (sp.height / (sp.plan === 'hexapod' ? 1.3 : sp.plan === 'flyer' ? 2.2 : 1.72)) * (A.scale[i] || 1);
        let dh = A.heading[i] - tr.hd;
        dh -= Math.round(dh / (Math.PI * 2)) * Math.PI * 2;
        tr.hd += dh * Math.min(1, dtR * 9);
        let anim = tr.anim, prevAnim = tr.prev;
        if (afloat) {
          // the boat under them, bow ahead, pitching gently on the swell; they sit in it (stand at a sail boat's helm)
          const kind = vesselOf(A.carry[i]);
          const pitch = Math.sin(realTime * 1.3 + hashFloat(id, 61) * 6.28) * 0.04;
          bodyMatrix(_mat, ux, uy, uz, r - 0.02, tr.hd, 1, pitch);
          this.boats.add(kind, _mat, hashFloat(id, 63));
          anim = prevAnim = kind === 'sail' ? AnimState.idle : AnimState.sit;
          r += kind === 'raft' ? 0.2 : kind === 'boat' ? 0.05 : 0.3;
        }
        bodyMatrix(_mat, ux, uy, uz, r, tr.hd, scale);
        const blend = Math.min(1, (realTime - tr.at) / BLEND_S);
        this.colours(id, sp, A.tint[i], flags, era, A.species[i]);
        const tool = this.toolFor(tr.anim, A.carry[i], era, flags, id);
        const cadence = 0.9 + 0.2 * hashFloat(id, 41);
        this.bodies.set(b, k, _mat, [anim, prevAnim, blend, A.phase[i] + hashFloat(id, 43)], _a, _b, _c, [this.styleFor(id, flags, era), afloat ? HELD.none : tool, cadence, flags]);
        this.addPick(id, ux * r, uy * r, uz * r, scale * (sp.plan === 'hexapod' ? 1.3 : 1.72));
        agents++;
      }
      // forget tracks of people who are gone (bounded)
      if (this.tracks.size > A.count * 2 + 512) {
        const live = new Set<number>();
        for (let i = 0; i < A.count; i++) live.add(A.id[i]);
        for (const id of this.tracks.keys()) if (!live.has(id)) this.tracks.delete(id);
      }
    }
    // ambient cohort crowds
    this.buildAmbient(pv, buildings, camBody);
    let amb = 0;
    for (const a of this.ambient) {
      let ux = a.ux, uy = a.uy, uz = a.uz;
      let heading = a.heading;
      if (a.len > 0) {
        const span = a.len * 2;
        const speed = 1.2;
        const u = (animTime * speed + hashFloat(a.id, 14) * span) % span;
        const fwd = u < a.len;
        const s = (fwd ? u : span - u) - a.len / 2;
        ux += a.vx * s; uy += a.vy * s; uz += a.vz * s;
        const l = Math.hypot(ux, uy, uz); ux /= l; uy /= l; uz /= l;
        if (!fwd) heading += Math.PI;
      }
      const dq = Math.hypot(ux * R - cx, uy * R - cy, uz * R - cz);
      if (dq > LOD_D[2]) continue;
      const g = groundHeight(pv.ground, ux, uy, uz);
      const d = Math.hypot(ux * g - cx, uy * g - cy, uz * g - cz);
      const lod = d < LOD_D[0] ? 0 : d < LOD_D[1] ? 1 : 2;
      const sp = speciesAt(a.species);
      const era = eraOf.get(a.settlement) ?? 2;
      const b = this.bucketFor(a.species, lod);
      const k = this.bodies.push(b);
      const child = (a.flags & AgentFlag.child) !== 0;
      bodyMatrix(_mat, ux, uy, uz, g, heading, (sp.height / 1.72) * (child ? 0.62 : 0.92 + 0.16 * hashFloat(a.id, 15)));
      this.colours(a.id, sp, a.tint, a.flags, era, a.species);
      this.bodies.set(b, k, _mat, [a.anim, a.anim, 1, hashFloat(a.id, 16)], _a, _b, _c, [this.styleFor(a.id, a.flags, era), a.tool, 0.9 + 0.2 * hashFloat(a.id, 17), a.flags]);
      amb++;
    }
    this.boats.end();
    this.stats.drawn = this.bodies.end();
    this.stats.agents = agents;
    this.stats.ambient = amb;
  }

  private addPick(id: number, x: number, y: number, z: number, h: number): void {
    if (this.pickN >= this.pickId.length) {
      const ni = new Int32Array(this.pickId.length * 2); ni.set(this.pickId); this.pickId = ni;
      const np = new Float32Array(this.pickP.length * 2); np.set(this.pickP); this.pickP = np;
    }
    const k = this.pickN++;
    this.pickId[k] = id;
    this.pickP[k * 4] = x; this.pickP[k * 4 + 1] = y; this.pickP[k * 4 + 2] = z; this.pickP[k * 4 + 3] = h;
  }

  /**
   * The person nearest a body-frame ray (origin o, unit direction d) among those drawn this frame: each is a vertical
   * segment from the feet to the head, accepted within a radius that grows with distance (a far figure is a few pixels
   * wide; `slack` is that allowance in radians). Returns the agent id and the ray distance.
   */
  pick(o: ArrayLike<number>, d: ArrayLike<number>, maxT: number, slack: number): { id: number; t: number } | null {
    let best: { id: number; t: number } | null = null;
    let bestScore = Infinity;
    const P = this.pickP;
    for (let k = 0; k < this.pickN; k++) {
      const x = P[k * 4], y = P[k * 4 + 1], z = P[k * 4 + 2], h = P[k * 4 + 3];
      const l = Math.hypot(x, y, z) || 1;
      // sample the figure at feet, waist and head height: nearest approach of the ray to each
      for (const f of [0.15, 0.55, 0.9]) {
        const px = x + (x / l) * h * f - o[0], py = y + (y / l) * h * f - o[1], pz = z + (z / l) * h * f - o[2];
        const t = px * d[0] + py * d[1] + pz * d[2];
        if (t <= 0 || t > maxT) continue;
        const qx = px - d[0] * t, qy = py - d[1] * t, qz = pz - d[2] * t;
        const miss = Math.hypot(qx, qy, qz);
        const tol = Math.max(0.45, t * slack);
        if (miss > tol) continue;
        const score = t + miss * 4;
        if (score < bestScore) { bestScore = score; best = { id: this.pickId[k], t }; }
      }
    }
    return best;
  }

  /** body-frame position (feet) of a drawn person and their height, or null when they were not drawn */
  positionOf(id: number): [number, number, number, number] | null {
    for (let k = 0; k < this.pickN; k++) if (this.pickId[k] === id) return [this.pickP[k * 4], this.pickP[k * 4 + 1], this.pickP[k * 4 + 2], this.pickP[k * 4 + 3]];
    return null;
  }

  /** cloth (snapshot tint), skin and hair (species palettes by id; elders grey) into _a, _b, _c */
  private colours(id: number, sp: ReturnType<typeof speciesAt>, tint: number, flags: number, era: number, species: number): void {
    unpackLinear(tint || CLOTH_FALLBACK[id % CLOTH_FALLBACK.length], _a);
    // early peoples' clothes are undyed whatever the tint says
    if (era <= 1) { const l = 0.3 * _a[0] + 0.55 * _a[1] + 0.15 * _a[2]; _a[0] = l * 1.15; _a[1] = l * 0.95; _a[2] = l * 0.7; }
    const skin = sp.skins[Math.floor(hashFloat(id, 51) * sp.skins.length)] ?? sp.skin;
    const k = 0.92 + 0.16 * hashFloat(id, 53);
    _b[0] = skin[0] * k; _b[1] = skin[1] * k; _b[2] = skin[2] * k;
    const hair = sp.hairs[Math.floor(hashFloat(id, 55) * sp.hairs.length)] ?? sp.hair;
    const grey = flags & AgentFlag.elder ? 0.7 : 0;
    _c[0] = hair[0] + (0.42 - hair[0]) * grey; _c[1] = hair[1] + (0.4 - hair[1]) * grey; _c[2] = hair[2] + (0.38 - hair[2]) * grey;
    void species;
  }

  setShadowCasting(on: boolean): void { this.bodies.setShadowCasting(on); this.boats.setShadowCasting(on); }
  swapDepth(depth: boolean): void { this.bodies.swapDepth(depth); this.boats.swapDepth(depth); }
  dispose(): void { this.bodies.dispose(); this.boats.dispose(); }
}
