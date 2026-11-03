// VALE render — computed overhead-bar clearance (closing review CW1 combat:bar-clearance; kemdo-M1, hesmi-m3, TUN-c2,
// dunsom-lantern-nameplate, Vashil's halo).
//
// A fighter's bar anchor used to be art.height + 0.35 m. Props that ride high and off the body's axis (a lens held to
// the side, a lantern on a crook, a rack on the back, a halo, a wide brim) project INTO the bar plate whenever the
// fighter faces so the prop sits behind it: the camera is pitched 52°, so a point d metres further from the camera
// draws d·tan 52° higher on screen than one at the same height on the axis.
//
// So the anchor is computed from the model itself, once per template. The fighter's FOCAL parts are the sockets its
// art names beyond the shared rig set (FighterArt.sockets: lens, lantern, rack_top, halo, rod_head…), each part being
// the vertices skinned to that socket's bone (or within 0.25 m of it at rest). They are skinned through the idle and run clips (8 samples
// each) and turned through 8 facings. A case is "covered" when half of some focal part lies inside the bar plate or
// its level chip (vertices outside the bar's horizontal span never count; one further from the camera, −z, draws
// d·tan 52° higher). The anchor is the lowest height, from the old art.height + 0.35 m up to MAX_LIFT above it, at
// which at most 5 % of the idle cases and of the run cases are covered (the probe gates 10 %; LoL-style, a tall shaft may cross a bar, the
// focal accent is not parked under it), else the lowest with the fewest covered cases. Pure geometry at the default
// camera distance and 1080p (bars are a fixed screen size); no content field (the closing plan: "computed, not
// authored"). `_harness/probe_bar_clearance.ts` measures the result per prop over 8 facings.

import { type AnimationClip, AnimationMixer, MathUtils, type Object3D, PropertyBinding, type SkinnedMesh, Vector3 } from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/** the overhead fighter bar in 1080p reference px around its anchor (overlay/bars.ts: plate 104 + pad, level chip
 *  on the left; the self plate's double frame adds 2 px). `below` = plate half-height under the anchor. */
export const BAR_BOX = { left: -80, right: 56, below: 13, above: 12 } as const;
export const BAR_CLEAR = {
  /** the old fixed gap over art.height (the floor) */
  gap: 0.35,
  /** px kept between the plate's lower edge and the prop */
  marginPx: 2,
  /** share of (sample × facing) cases a focal part may still be half under the plate (the probe gates 10 %) */
  target: 0.08,
  /** the share of a part inside the plate that counts as covered: under the probe's half, because this is the
   *  orthographic estimate of the probe's perspective projection */
  half: 0.35,
  /** anchor search step (m) */
  step: 0.02,
  /** the most the computed anchor rises above art.height + gap (m) */
  maxLift: 0.6,
  facings: 8,
  samples: 12,
  /** a part (vertices of one bone) needs this many sampled vertices to count */
  minPart: 12,
  /** a focal part = the vertices within this radius (m) of its socket bone at rest */
  partRadius: 0.25,
  /** polish TUN-c2: past the half-covered gate the anchor keeps rising (≤ meanExtra m) while a part's mean share under
   *  the plate is over meanTarget (a brim's far edge under the under-panel) */
  meanTarget: 0.02,
  meanExtra: 0.2,
} as const;

export interface BarCam { pitchDeg: number; fovDeg: number; distance: number; viewH: number }

/** px per metre at the focus for a camera (vertical fov, 1080p reference) */
export function pxPerMetre(cam: BarCam): number {
  return (cam.viewH / 2) / Math.tan(MathUtils.degToRad(cam.fovDeg / 2)) / cam.distance;
}

/** a fighter's FOCAL parts: the sockets its art names beyond the shared rig set (a lens, a lantern, a rack top, a
 *  halo, a rod head…; FighterArt.sockets, so nothing here names a fighter) */
export const SHARED_SOCKETS: ReadonlySet<string> = new Set(['origin', 'chest', 'head', 'hand_r', 'hand_l', 'weapon_r', 'weapon_l', 'foot_r', 'foot_l', 'weapon']);
export function focalBones(sockets: Record<string, string>): string[] {
  return [...new Set(Object.entries(sockets).filter(([k]) => !SHARED_SOCKETS.has(k)).map(([, b]) => b))];
}

/** posed positions of each focal part's vertices (those within BAR_CLEAR.partRadius of the part's bone at rest), per
 *  sample of each clip, root at the origin, facing 0: rows[clip][sample] = flat xyz; part[i] = the part of vertex i */
export interface BodySamples { rows: Float32Array[][]; part: Int32Array; parts: number }
export function samplePartVerts(scene: Object3D, clips: AnimationClip[], bones: string[], o: { scale?: number; samples?: number; maxPerPart?: number } = {}): BodySamples {
  const model = cloneSkinned(scene);
  const s = o.scale ?? 1;
  model.scale.setScalar(s);
  model.updateMatrixWorld(true);
  // a part = the vertices skinned mostly to the socket's bone or a child of it (the prop rides its own bone), else the
  // vertices within partRadius of the bone at rest (a socket that is an empty on a shared bone)
  const nodes: Object3D[] = [];
  for (const b of bones) {
    const n = model.getObjectByName(PropertyBinding.sanitizeNodeName(b)) ?? model.getObjectByName(b);
    if (n) nodes.push(n);
  }
  const centres = nodes.map((n) => n.getWorldPosition(new Vector3()));
  const r = BAR_CLEAR.partRadius * s;
  const own: { m: SkinnedMesh; i: number }[][] = nodes.map(() => []);
  const near: { m: SkinnedMesh; i: number }[][] = nodes.map(() => []);
  const v = new Vector3();
  model.traverse((n) => {
    const m = n as SkinnedMesh;
    if (!m.isMesh || !m.geometry?.attributes.position || nodes.length === 0) return;
    const pos = m.geometry.attributes.position;
    const si = m.isSkinnedMesh ? m.geometry.attributes.skinIndex : undefined, sw = m.isSkinnedMesh ? m.geometry.attributes.skinWeight : undefined;
    for (let i = 0; i < pos.count; i++) {
      let carrier: Object3D | null = m;
      if (si && sw) {
        let best = 0, bw = -1;
        for (let c = 0; c < 4; c++) { const w = sw.getComponent(i, c); if (w > bw) { bw = w; best = si.getComponent(i, c); } }
        carrier = m.skeleton.bones[best] ?? m;
      }
      m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld);
      for (let c = 0; c < nodes.length; c++) {
        let under = false;
        for (let o: Object3D | null = carrier; o; o = o.parent) if (o === nodes[c]) { under = true; break; }
        if (under) own[c].push({ m, i });
        else if (v.distanceToSquared(centres[c]) <= r * r) near[c].push({ m, i });
      }
    }
  });
  const per = nodes.map((_, c) => (own[c].length >= BAR_CLEAR.minPart ? own[c] : near[c]));
  const cap = o.maxPerPart ?? 200;
  const list: { m: SkinnedMesh; i: number }[] = [];
  const partOf: number[] = [];
  let parts = 0;
  for (const vs of per) {
    if (vs.length < BAR_CLEAR.minPart) continue;
    const stride = Math.max(1, Math.ceil(vs.length / cap));
    for (let k = 0; k < vs.length; k += stride) { list.push(vs[k]); partOf.push(parts); }
    parts++;
  }
  const mixer = new AnimationMixer(model);
  const N = o.samples ?? BAR_CLEAR.samples;
  const out: Float32Array[][] = [];
  for (const clip of clips) {
    mixer.stopAllAction();
    const act = mixer.clipAction(clip);
    act.reset(); act.play();
    const rows: Float32Array[] = [];
    for (let k = 0; k < N; k++) {
      act.time = (clip.duration * k) / N;
      mixer.update(0);
      model.updateMatrixWorld(true);
      const f = new Float32Array(list.length * 3);
      let j = 0;
      for (const e of list) { e.m.getVertexPosition(e.i, v).applyMatrix4(e.m.matrixWorld); f[j++] = v.x; f[j++] = v.y; f[j++] = v.z; }
      rows.push(f);
    }
    out.push(rows);
    mixer.uncacheAction(clip);
  }
  mixer.uncacheRoot(model);
  return { rows: out, part: Int32Array.from(partOf), parts };
}

/** the anchor height (m above the root) at which the fewest (sample × facing) cases have a focal part half under the
 *  bar plate: the lowest anchor in [floor, floor + maxLift] whose covered share is ≤ target, else the lowest with the
 *  least covered share; `floor` = art.height + gap */
export function barAnchorFrom(b: BodySamples, floor: number, cam: BarCam): { anchor: number; covered: number; coveredAtFloor: number } {
  const k = pxPerMetre(cam);
  const p = MathUtils.degToRad(cam.pitchDeg);
  const cp = Math.cos(p), tp = Math.tan(p);
  // the plate spans BAR_BOX.below px under and BAR_BOX.above px over the anchor (+ the margin); a height step of 1 m
  // moves a point k·cos p px on screen
  const below = (BAR_BOX.below + BAR_CLEAR.marginPx) / (k * cp), above = (BAR_BOX.above + BAR_CLEAR.marginPx) / (k * cp);
  const xl = BAR_BOX.left / k, xr = BAR_BOX.right / k;
  const F = BAR_CLEAR.facings;
  const members: number[][] = Array.from({ length: b.parts }, () => []);
  for (let i = 0; i < b.part.length; i++) members[b.part[i]].push(i);
  // per case, per part: the in-span vertices' equivalent heights on the anchor's column (further from the camera, −z,
  // draws higher), sorted, and the part's vertex count
  const byClip: { h: Float64Array; n: number }[][][] = [];
  for (const rows of b.rows) {
   const cases: { h: Float64Array; n: number }[][] = [];
   byClip.push(cases);
   for (const f of rows) {
    for (let a = 0; a < F; a++) {
      const th = (2 * Math.PI * a) / F, c = Math.cos(th), s = Math.sin(th);
      const row: { h: Float64Array; n: number }[] = [];
      for (const m of members) {
        if (!m.length) continue;
        const hs: number[] = [];
        for (const v of m) {
          const i = v * 3;
          const x = c * f[i] + s * f[i + 2];
          if (x < xl || x > xr) continue;
          const z = -s * f[i] + c * f[i + 2];
          hs.push(f[i + 1] - z * tp);
        }
        row.push({ h: Float64Array.from(hs).sort(), n: m.length });
      }
      cases.push(row);
    }
   }
  }
  const lowerBound = (h: Float64Array, x: number): number => { let lo = 0, hi = h.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (h[mid] < x) lo = mid + 1; else hi = mid; } return lo; };
  // the worse clip's share (idle and run are gated apart)
  const coveredAt = (anchor: number): number => {
    let worst = 0;
    for (const cases of byClip) {
      if (!cases.length) continue;
      let bad = 0;
      for (const row of cases) {
        for (const e of row) {
          const inside = lowerBound(e.h, anchor + above) - lowerBound(e.h, anchor - below);
          if (inside >= BAR_CLEAR.half * e.n) { bad++; break; }
        }
      }
      worst = Math.max(worst, bad / cases.length);
    }
    return worst;
  };
  // polish TUN-c2: the mean share of a part under the plate (the worse clip; a wide brim is never HALF under it, yet the
  // plate's under-panel sat on its far edge in most facings)
  const meanAt = (anchor: number): number => {
    let worst = 0;
    for (const cases of byClip) {
      if (!cases.length) continue;
      let sum = 0;
      for (const row of cases) {
        let m = 0;
        for (const e of row) m = Math.max(m, (lowerBound(e.h, anchor + above) - lowerBound(e.h, anchor - below)) / e.n);
        sum += m;
      }
      worst = Math.max(worst, sum / cases.length);
    }
    return worst;
  };
  const coveredAtFloor = coveredAt(floor);
  const top = floor + BAR_CLEAR.maxLift + 1e-9;
  let best = floor, bestCov = coveredAtFloor;
  if (bestCov > BAR_CLEAR.target) {
    for (let a = floor + BAR_CLEAR.step; a <= top; a += BAR_CLEAR.step) {
      const cov = coveredAt(a);
      if (cov < bestCov - 1e-9) { best = a; bestCov = cov; }
      if (cov <= BAR_CLEAR.target) break;
    }
  }
  // once the half-covered gate is met, keep rising (at most meanExtra) until the mean share under the plate is small
  if (bestCov <= BAR_CLEAR.target) {
    const stop = Math.min(top, best + BAR_CLEAR.meanExtra + 1e-9);
    for (let a = best; a <= stop && meanAt(a) > BAR_CLEAR.meanTarget; a += BAR_CLEAR.step) best = Math.min(a + BAR_CLEAR.step, stop);
  }
  return { anchor: best, covered: coveredAt(best), coveredAtFloor };
}

/** the computed bar anchor for a fighter template (idle + run clips; its focal sockets); `floor` = art.height × scale + 0.35 */
export function fighterBarAnchor(scene: Object3D, clips: AnimationClip[], sockets: Record<string, string>, floor: number, scale: number, cam: BarCam): number {
  const bones = focalBones(sockets);
  if (!clips.length || !bones.length) return floor;
  return barAnchorFrom(samplePartVerts(scene, clips, bones, { scale }), floor, cam).anchor;
}
