// =============================================================================
//  CRESTBOUND — runtime/hazards/rotors.js
//  Spinning hazards: bar (floor sweeper), hammer, windmill, saw.
//
//  DETERMINISM LAW (CONTRACT §21): the rotor angle is
//      theta(t) = TAU * (t / period + phase) * dir            [phase = FRACTION of a rev]
//  and every collider / kill volume is derived from theta by closed form. There is no
//  integration anywhere; `reset(t)` is literally `update(t, 0)`.
//
//  Kill volumes are ANALYTIC — a capsule per arm/blade, boxes for the hammer head and the
//  saw disc. Nothing ever falls back to mesh intersection.
//
//  Frame convention: everything is authored in a canonical frame where the spin axis is +Y
//  and arm #0 points down +X, then a single `alignQ` quaternion maps that frame onto the
//  def's real axis. That keeps every derivation trivially correct for arbitrary axes.
//
//  CARRY: a `bar` rotor is a solid the player rides. It publishes
//      linVel = 0, angVel = omega, angAxis = axis, angCenter = pivot
//  and `velocityAtPoint(p, out)`, which is what runtime/player/collide.js reads to carry a
//  standing player around with the sweep (CONTRACT §10 `platformVel`).
//
//  Ported from Ascendant by transliteration. Crestbound changes: the shared hazard kit in
//  ./lasers.js supplies audio/particle/player bridges (so the §5/§8 name aliases live in one
//  place); the geometry kit is reused from ./movers.js rather than duplicated; update() takes
//  the live player; onStand / onPound / onTouch are present on every hazard.
// =============================================================================

import * as THREE from 'three';
import { Collider, KillVolume } from '../world/collider.js';
import { hazSfx, hazBurst, resolvePlayer } from './lasers.js';
import { chamferBox, mergeAll, getMat, pal } from './movers.js';
import { BatchRig, trimK } from './batchkit.js';

// ---------------------------------------------------------------------------
// module-scope scratch — zero per-frame heap allocation below this line
// ---------------------------------------------------------------------------
const TAU = Math.PI * 2;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _f = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _mat4 = new THREE.Matrix4();
const _box3 = new THREE.Box3();
const _probeSize = new THREE.Vector3(0.7, 0.7, 0.7);
const _hits = [];
const _UP = new THREE.Vector3(0, 1, 0);

// Shared audio throttle so a course full of saws cannot machine-gun the mixer.
let _lastWhirr = -1e9;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }

/** Accepts [x,y,z], {x,y,z}, 'x'|'y'|'z' and '-x'|'-y'|'-z'. */
function readVec(src, out, dx, dy, dz) {
  if (Array.isArray(src) && src.length >= 3) out.set(num(src[0], dx), num(src[1], dy), num(src[2], dz));
  else if (src && typeof src === 'object' && 'x' in src) out.set(num(src.x, dx), num(src.y, dy), num(src.z, dz));
  else if (typeof src === 'string') {
    const s = src.toLowerCase().trim();
    const sign = s.charAt(0) === '-' ? -1 : 1;
    const k = s.replace('-', '').replace('+', '');
    out.set(k === 'x' ? sign : 0, k === 'y' ? sign : 0, k === 'z' ? sign : 0);
    if (out.lengthSq() < 1e-8) out.set(dx, dy, dz);
  } else out.set(dx, dy, dz);
  return out;
}

// ---------------------------------------------------------------------------
// local geometry kit (chamferBox / partMesh / mergeAll come from ./movers.js)
// ---------------------------------------------------------------------------

/** Tapered blade: length along +X from 0..len, chord along Y, thickness along Z. */
function bladeGeo(len, rootChord, tipChord, thick) {
  const s = new THREE.Shape();
  const rc = rootChord / 2, tc = tipChord / 2;
  s.moveTo(0, -rc);
  s.lineTo(len * 0.55, -rc * 0.86 - tc * 0.14);
  s.lineTo(len, -tc);
  s.lineTo(len, tc * 0.86);
  s.lineTo(len * 0.55, rc * 0.72 + tc * 0.28);
  s.lineTo(0, rc);
  s.closePath();
  const b = Math.min(thick * 0.34, 0.05);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.004, thick - 2 * b), bevelEnabled: true,
    bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: 1, steps: 1,
  });
  g.translate(0, 0, -(thick - 2 * b) / 2);
  return g;
}

function ringGeo(r, tube, rseg = 6, tseg = 16, arc = TAU) {
  return new THREE.TorusGeometry(r, tube, rseg, tseg, arc);
}

function boltRing(count, r, br, bh) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU;
    const g = new THREE.CylinderGeometry(br, br * 1.14, bh, 6);
    g.translate(Math.cos(a) * r, 0, Math.sin(a) * r);
    out.push(g);
  }
  return out;
}

// ---------------------------------------------------------------------------
// kill-volume plumbing (field names per CONTRACT §9; aliases written defensively
// so the volume is correct whichever spelling collider.js settled on)
// ---------------------------------------------------------------------------
function makeCapsuleKV(kind, ref, r) {
  const kv = new KillVolume({
    type: 'capsule', a: new THREE.Vector3(), b: new THREE.Vector3(),
    radius: r, kind, ref,
  });
  kv.active = true;
  return kv;
}
function setCapsuleKV(kv, a, b, r) {
  if (!kv) return;
  if (kv.a && kv.a.copy) kv.a.copy(a); else kv.a = a.clone();
  if (kv.b && kv.b.copy) kv.b.copy(b); else kv.b = b.clone();
  if (kv.p0 && kv.p0.copy) kv.p0.copy(a);
  if (kv.p1 && kv.p1.copy) kv.p1.copy(b);
  if (kv.start && kv.start.copy) kv.start.copy(a);
  if (kv.end && kv.end.copy) kv.end.copy(b);
  if (typeof r === 'number') { kv.radius = r; kv.r = r; }
  if (kv.center && kv.center.copy) kv.center.copy(a).add(b).multiplyScalar(0.5);
  if (typeof kv.update === 'function') kv.update();
}
function makeBoxKV(kind, ref, hx, hy, hz2) {
  const kv = new KillVolume({
    type: 'box', center: new THREE.Vector3(),
    half: new THREE.Vector3(hx, hy, hz2), quat: new THREE.Quaternion(), kind, ref,
  });
  kv.active = true;
  return kv;
}
function setBoxKV(kv, center, quat) {
  if (!kv) return;
  if (kv.center && kv.center.copy) kv.center.copy(center); else kv.center = center.clone();
  if (kv.quat && kv.quat.copy) kv.quat.copy(quat); else kv.quat = quat.clone();
  if (typeof kv.update === 'function') kv.update();
}

// =============================================================================
//  rotor(def, ctx)
// =============================================================================
/**
 * @param {object} def {kind:'rotor', p, style:'bar'|'hammer'|'windmill'|'saw',
 *                      arms, len, thick, height?, period, phase?, axis?, tilt?|tiltDeg?,
 *                      dir?, mount?, kill?}
 *   `p`      pivot, world metres.
 *   `period` SECONDS per revolution (> 0).
 *   `phase`  FRACTION OF A REVOLUTION (0..1) — NOT seconds, NOT radians.
 *   `tilt`   RADIANS (`tiltDeg` is the degrees convenience).
 *   `len`    arm length in metres; for `saw` it is the blade RADIUS.
 *   `kill`   truthy makes a `bar` lethal too; a string names the kill kind.
 * @param {object} ctx {mats, theme, themeId, fx, audio, builders, broadphase, quality, course}
 */
export function rotor(def, ctx) {
  ctx = ctx || {};
  const D = [];
  const ownMats = [];

  const style = String(def.style || 'bar').toLowerCase();
  const period = Math.max(0.15, num(def.period, 3.4));
  const phase = num(def.phase, 0);
  const dirSign = num(def.dir, 1) < 0 ? -1 : 1;
  const omega = (TAU / period) * dirSign;               // rad/s, constant

  const defaultArms = style === 'windmill' ? 4 : (style === 'hammer' || style === 'saw' ? 1 : 2);
  const arms = style === 'saw' ? 1 : Math.max(1, Math.min(8, Math.round(num(def.arms, defaultArms))));
  const len = Math.max(0.6, num(def.len, style === 'saw' ? 2.2 : 6));
  const thick = Math.max(0.08, num(def.thick, style === 'saw' ? 0.22 : 0.5));
  const height = Math.max(0.12, num(def.height, style === 'bar' ? thick * 1.5 : thick));
  const tilt = def.tiltDeg !== undefined
    ? num(def.tiltDeg, 18) * Math.PI / 180
    : num(def.tilt, style === 'windmill' ? 0.30 : 0);

  const pivot = readVec(def.p, new THREE.Vector3(), 0, 0, 0);
  const axisDefault = (style === 'bar') ? 'y' : 'z';
  const axis = readVec(def.axis === undefined ? axisDefault : def.axis, new THREE.Vector3(), 0, 1, 0);
  if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0);
  axis.normalize();

  const lethal = (style === 'windmill' || style === 'saw' || style === 'hammer' || !!def.kill);
  const killKind = (typeof def.kill === 'string') ? def.kill : (style === 'saw' ? 'saw' : 'spike');

  // canonical(+Y) -> world(axis)
  const alignQ = new THREE.Quaternion().setFromUnitVectors(_UP, axis);

  const innerR = (style === 'saw') ? 0 : Math.max(0.20, thick * 0.9);
  const armPhase = new Float64Array(arms);
  for (let i = 0; i < arms; i++) armPhase[i] = (i / arms) * TAU;

  // -------------------------------------------------------------------------
  const root = new THREE.Group();
  root.name = 'rotor:' + style;
  root.position.copy(pivot);
  const spin = new THREE.Group();
  root.add(spin);
  /* BATCHED (hazards/batchkit.js): hub, mount, arms, plates and every glow strip are instances
     in the course batches; `spin` is still posed from theta(t) exactly as before and
     `rig.sync()` copies the pose out once per frame. */
  const rig = new BatchRig(ctx, root);
  let edgePart = null, trimPart = null;

  const hz = {
    kind: 'rotor', type: style, def,
    mesh: root, colliders: [], kills: [], volumes: [],
    linVel: new THREE.Vector3(0, 0, 0),
    angVel: omega,
    angAxis: axis.clone(),
    angCenter: pivot.clone(),
    surface: 'nostick',
    time: 0,
    enabled: true,
    __mats: ownMats,
  };

  // --- palette / materials --------------------------------------------------
  const cAccent = new THREE.Color(pal(ctx, 'accent', 0x6fe9ff));
  const cKill = new THREE.Color(pal(ctx, 'kill', 0xff4d2e));
  const cKillGlow = new THREE.Color(pal(ctx, 'killGlow', cKill.getHex()));
  const cSafe = new THREE.Color(pal(ctx, 'safeEdge', pal(ctx, 'safe', 0x9fe8ff)));

  const matMetal = getMat(ctx, 'metal');
  const matPanel = getMat(ctx, 'panel');
  const matGrate = getMat(ctx, 'grate');
  const matHazard = getMat(ctx, lethal ? 'hazard' : 'panel');
  const matDark = getMat(ctx, 'obsidian');

  const cTrim = lethal ? cKillGlow : cAccent;
  const cEdge = lethal ? cKill : cSafe;

  // =========================================================================
  //  HUB + MOUNT  (static, lives on root)
  // =========================================================================
  function buildHub() {
    const structural = [], glows = [];
    const hubR = Math.max(0.30, thick * (style === 'saw' ? 1.5 : 1.25));
    const hubH = Math.max(0.34, height * (style === 'bar' ? 1.5 : 1.15));

    const barrel = new THREE.CylinderGeometry(hubR, hubR * 1.06, hubH, 14);
    structural.push(barrel);
    for (let i = -1; i <= 1; i += 2) {
      const collar = ringGeo(hubR * 1.02, hubR * 0.14, 5, 16);
      collar.rotateX(Math.PI / 2);
      collar.translate(0, i * hubH * 0.42, 0);
      structural.push(collar);
    }
    const capA = new THREE.CylinderGeometry(hubR * 0.62, hubR * 0.78, hubH * 0.34, 12);
    capA.translate(0, hubH * 0.56, 0);
    structural.push(capA);
    const capB = new THREE.CylinderGeometry(hubR * 0.78, hubR * 0.62, hubH * 0.34, 12);
    capB.translate(0, -hubH * 0.56, 0);
    structural.push(capB);
    for (const g of boltRing(8, hubR * 0.74, hubR * 0.075, hubH * 0.42)) { g.translate(0, hubH * 0.30, 0); structural.push(g); }

    const band = ringGeo(hubR * 1.045, hubR * 0.055, 5, 20);
    band.rotateX(Math.PI / 2);
    glows.push(band);

    // mount
    const mountLen = num(def.mount, Math.abs(axis.y) > 0.7 ? 0.55 : 1.9);
    if (mountLen > 0.15) {
      const vertical = Math.abs(axis.y) > 0.7;
      if (vertical) {
        // pedestal + floor plate
        const ped = new THREE.CylinderGeometry(hubR * 1.15, hubR * 1.55, mountLen, 14);
        ped.translate(0, -hubH * 0.5 - mountLen * 0.5, 0);
        structural.push(ped);
        const plate = new THREE.CylinderGeometry(hubR * 2.1, hubR * 2.3, 0.16, 18);
        plate.translate(0, -hubH * 0.5 - mountLen - 0.06, 0);
        structural.push(plate);
        for (const g of boltRing(8, hubR * 1.85, 0.055, 0.13)) { g.translate(0, -hubH * 0.5 - mountLen - 0.06, 0); structural.push(g); }
        const ring2 = ringGeo(hubR * 2.14, 0.05, 5, 22);
        ring2.rotateX(Math.PI / 2);
        ring2.translate(0, -hubH * 0.5 - mountLen + 0.03, 0);
        glows.push(ring2);
        // the pedestal is solid — the player should not walk through the machine
        hz.colliders.push(new Collider({
          center: _a.set(0, -hubH * 0.5 - mountLen * 0.5, 0).applyQuaternion(alignQ).add(pivot).clone(),
          half: new THREE.Vector3(hubR * 1.4, mountLen * 0.5, hubR * 1.4),
          quat: alignQ.clone(), surface: 'normal', ref: hz, group: 'hazard',
        }));
      } else {
        // bracket arm hanging in world -Y from the hub. The geometry is authored
        // along -Y, so mapping +Y onto world-up-expressed-in-canonical-space sends
        // it to world -Y after alignQ.
        _c.set(0, 1, 0).applyQuaternion(_q2.copy(alignQ).invert());
        const armGeoms = [];
        const strut = chamferBox(hubR * 0.7, mountLen, hubR * 0.7, 0.05);
        strut.translate(0, -mountLen * 0.5 - hubR * 0.6, 0);
        armGeoms.push(strut);
        const foot = chamferBox(hubR * 2.4, 0.22, hubR * 2.4, 0.05);
        foot.translate(0, -mountLen - hubR * 0.6, 0);
        armGeoms.push(foot);
        for (let i = 0; i < 3; i++) {
          const rib = chamferBox(hubR * 0.95, 0.09, hubR * 0.95, 0.02);
          rib.translate(0, -hubR * 0.6 - mountLen * (0.24 + i * 0.26), 0);
          armGeoms.push(rib);
        }
        _q.setFromUnitVectors(_UP, _c.normalize());
        for (const g of armGeoms) { g.applyQuaternion(_q); structural.push(g); }
        hz.colliders.push(new Collider({
          center: new THREE.Vector3(pivot.x, pivot.y - mountLen * 0.5 - hubR * 0.6, pivot.z),
          half: new THREE.Vector3(hubR * 0.45, mountLen * 0.5, hubR * 0.45),
          quat: new THREE.Quaternion(), surface: 'normal', ref: hz, group: 'hazard',
        }));
      }
    }

    for (const g of structural) g.applyQuaternion(alignQ);
    for (const g of glows) g.applyQuaternion(alignQ);
    rig.solid(matMetal, structural, root, true, true);
    trimPart = rig.trim(glows, root);
  }

  // =========================================================================
  //  ARMS (bar) — solid sweeper beams you can ride
  // =========================================================================
  function buildBars() {
    const structural = [], glows = [], plates = [];
    for (let i = 0; i < arms; i++) {
      const phi = armPhase[i];
      const beam = chamferBox(len, height, thick, Math.min(0.07, thick * 0.28));
      beam.translate(innerR + len * 0.5, 0, 0);
      beam.rotateY(phi);
      structural.push(beam);

      // tapered outer section + end cap
      const taper = chamferBox(len * 0.30, height * 0.72, thick * 0.72, 0.04);
      taper.translate(innerR + len * 0.86, 0, 0);
      taper.rotateY(phi);
      structural.push(taper);
      const cap = chamferBox(0.16, height * 1.06, thick * 1.12, 0.045);
      cap.translate(innerR + len - 0.02, 0, 0);
      cap.rotateY(phi);
      structural.push(cap);

      // top rail — the surface a rider actually lands on
      const rail = chamferBox(len * 0.92, 0.07, thick * 1.16, 0.02);
      rail.translate(innerR + len * 0.5, height * 0.5 + 0.02, 0);
      rail.rotateY(phi);
      plates.push(rail);

      // leading-edge stripe: the face the sweep is driving into (CONTRACT hard rule 2)
      const lead = chamferBox(len * 0.94, height * 0.34, 0.05, 0.015);
      lead.translate(innerR + len * 0.5, 0, -dirSign * (thick * 0.5 + 0.012));
      lead.rotateY(phi);
      glows.push(lead);
      // trailing warning notches
      for (let k = 0; k < 4; k++) {
        const notch = chamferBox(0.10, height * 0.5, 0.045, 0.012);
        notch.translate(innerR + len * (0.24 + k * 0.20), 0, dirSign * (thick * 0.5 + 0.010));
        notch.rotateY(phi);
        glows.push(notch);
      }
      // landable top stripe so the rideable face reads from the approach
      for (let s = -1; s <= 1; s += 2) {
        const st = chamferBox(len * 0.90, 0.035, 0.05, 0.012);
        st.translate(innerR + len * 0.5, height * 0.5 + 0.055, s * (thick * 0.5 - 0.035));
        st.rotateY(phi);
        glows.push(st);
      }
    }
    // NOTE: no applyQuaternion(alignQ) here — these live on `spin`, which is itself
    // oriented by alignQ every frame. Baking it in as well would rotate the art twice
    // while the colliders (derived from armDir) rotate once.
    rig.solid(matMetal, structural, spin, true, true);
    rig.solid(matGrate, plates, spin, true, true);
    edgePart = rig.trim(glows, spin);

    for (let i = 0; i < arms; i++) {
      hz.colliders.push(new Collider({
        center: pivot.clone(),
        half: new THREE.Vector3(len * 0.5 + 0.08, height * 0.5, thick * 0.5),
        quat: new THREE.Quaternion(), surface: 'nostick', ref: hz, group: 'hazard',
      }));
      if (def.kill) hz.kills.push(makeCapsuleKV(killKind, hz, thick * 0.6));
    }
  }

  // =========================================================================
  //  HAMMER — solid shaft, lethal head
  // =========================================================================
  const headHalf = new THREE.Vector3();
  function buildHammer() {
    const shaftLen = len * 0.76;
    const headW = Math.max(0.7, len * 0.30);        // along the arm
    const headH = Math.max(0.7, height * 2.4);      // along the axis
    const headD = Math.max(0.7, thick * 2.6);       // tangential
    headHalf.set(headW * 0.5, headH * 0.5, headD * 0.5);

    const structural = [], glows = [], dark = [], hazardParts = [];
    for (let i = 0; i < arms; i++) {
      const phi = armPhase[i];
      const shaft = new THREE.CylinderGeometry(thick * 0.42, thick * 0.50, shaftLen, 12);
      shaft.rotateZ(-Math.PI / 2);
      shaft.translate(innerR + shaftLen * 0.5, 0, 0);
      shaft.rotateY(phi);
      structural.push(shaft);
      for (let k = 0; k < 4; k++) {
        const r = ringGeo(thick * 0.52, thick * 0.10, 5, 12);
        r.rotateY(Math.PI / 2);
        r.translate(innerR + shaftLen * (0.14 + k * 0.24), 0, 0);
        r.rotateY(phi);
        structural.push(r);
      }
      // yoke where the shaft meets the head
      const yoke = chamferBox(0.26, headH * 0.7, headD * 0.72, 0.045);
      yoke.translate(innerR + shaftLen + 0.05, 0, 0);
      yoke.rotateY(phi);
      structural.push(yoke);

      // the head itself
      const head = chamferBox(headW, headH, headD, Math.min(0.14, headW * 0.16));
      head.translate(innerR + shaftLen + headW * 0.5 + 0.16, 0, 0);
      head.rotateY(phi);
      hazardParts.push(head);
      // striking faces
      for (let s = -1; s <= 1; s += 2) {
        const face = chamferBox(0.10, headH * 0.86, headD * 0.86, 0.03);
        face.translate(innerR + shaftLen + headW * 0.5 + 0.16 + s * (headW * 0.5 + 0.03), 0, 0);
        face.rotateY(phi);
        dark.push(face);
      }
      // bolts + emissive core slit
      for (let k = 0; k < 4; k++) {
        const bx = ((k & 1) ? 1 : -1) * headH * 0.30;
        const bz = ((k & 2) ? 1 : -1) * headD * 0.30;
        const bolt = new THREE.CylinderGeometry(0.055, 0.065, headW * 1.02, 6);
        bolt.rotateZ(Math.PI / 2);
        bolt.translate(innerR + shaftLen + headW * 0.5 + 0.16, bx, bz);
        bolt.rotateY(phi);
        structural.push(bolt);
      }
      const slit = chamferBox(headW * 0.96, headH * 0.13, headD * 1.03, 0.02);
      slit.translate(innerR + shaftLen + headW * 0.5 + 0.16, 0, 0);
      slit.rotateY(phi);
      glows.push(slit);
      const band = chamferBox(headW * 1.03, headH * 0.62, 0.06, 0.02);
      band.translate(innerR + shaftLen + headW * 0.5 + 0.16, 0, -dirSign * (headD * 0.5 + 0.015));
      band.rotateY(phi);
      glows.push(band);
    }
    rig.solid(matMetal, structural, spin, true, true);
    rig.solid(matHazard, hazardParts, spin, true, true);
    rig.solid(matDark, dark, spin, true, false);
    edgePart = rig.trim(glows, spin);

    for (let i = 0; i < arms; i++) {
      hz.colliders.push(new Collider({
        center: pivot.clone(),
        half: new THREE.Vector3(shaftLen * 0.5, thick * 0.5, thick * 0.5),
        quat: new THREE.Quaternion(), surface: 'nostick', ref: hz, group: 'hazard',
      }));
      hz.kills.push(makeBoxKV(typeof def.kill === 'string' ? def.kill : 'crush', hz,
        headHalf.x + 0.06, headHalf.y + 0.06, headHalf.z + 0.06));
    }
  }

  // =========================================================================
  //  WINDMILL — tilted lethal blades on a horizontal axis
  // =========================================================================
  function buildWindmill() {
    const structural = [], glows = [], plates = [];
    const rootC = Math.max(0.45, height * 2.6);
    const tipC = rootC * 0.52;
    for (let i = 0; i < arms; i++) {
      const phi = armPhase[i];
      const bl = bladeGeo(len, rootC, tipC, thick);
      bl.rotateX(-Math.PI / 2);         // chord -> Z, thickness -> Y
      bl.rotateX(tilt);                 // pitch about the radial axis
      bl.translate(innerR, 0, 0);
      bl.rotateY(phi);
      plates.push(bl);

      // spar down the blade centreline
      const spar = chamferBox(len * 0.96, thick * 0.85, thick * 0.85, 0.035);
      spar.translate(innerR + len * 0.48, 0, 0);
      spar.rotateY(phi);
      structural.push(spar);

      // leading-edge glow
      const lead = chamferBox(len * 0.97, 0.055, 0.06, 0.016);
      lead.translate(innerR + len * 0.49, 0, -dirSign * rootC * 0.42);
      lead.rotateX(tilt);
      lead.rotateY(phi);
      glows.push(lead);
      const tipMark = chamferBox(0.30, 0.07, tipC * 0.9, 0.02);
      tipMark.translate(innerR + len * 0.93, 0, 0);
      tipMark.rotateX(tilt);
      tipMark.rotateY(phi);
      glows.push(tipMark);
    }
    // nose cone — points forward along the spin axis (canonical +Y)
    const noseH = Math.max(0.5, thick * 2.6);
    const nose = new THREE.ConeGeometry(Math.max(0.3, thick * 1.35), noseH, 14);
    nose.translate(0, noseH * 0.5 + thick * 0.7, 0);
    structural.push(nose);
    const noseCollar = ringGeo(Math.max(0.32, thick * 1.38), thick * 0.16, 5, 16);
    noseCollar.rotateX(Math.PI / 2);
    noseCollar.translate(0, thick * 0.7, 0);
    structural.push(noseCollar);

    rig.solid(matHazard, plates, spin, true, true);
    rig.solid(matMetal, structural, spin, true, false);
    edgePart = rig.trim(glows, spin);

    for (let i = 0; i < arms; i++) hz.kills.push(makeCapsuleKV(killKind, hz, Math.max(thick, rootC * 0.30)));
  }

  // =========================================================================
  //  SAW — real disc geometry, lethal, sparks, whirr
  // =========================================================================
  const sawR = len;                       // `len` is the blade radius for a saw
  const sawThick = thick;
  let sawShroud = null;
  function buildSaw() {
    const structural = [], teeth = [], glows = [], dark = [];

    const plate = new THREE.CylinderGeometry(sawR * 0.90, sawR * 0.90, sawThick * 0.7, 40, 1, false);
    structural.push(plate);
    const rim = new THREE.CylinderGeometry(sawR * 0.955, sawR * 0.955, sawThick, 44, 1, false);
    structural.push(rim);
    for (let i = 0; i < 3; i++) {
      const groove = ringGeo(sawR * (0.42 + i * 0.19), sawThick * 0.16, 4, 30);
      groove.rotateX(Math.PI / 2);
      dark.push(groove);
    }
    // lightening holes
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.2;
      const hole = new THREE.CylinderGeometry(sawR * 0.115, sawR * 0.115, sawThick * 1.25, 12);
      hole.translate(Math.cos(a) * sawR * 0.56, 0, Math.sin(a) * sawR * 0.56);
      dark.push(hole);
    }
    // hub
    const hub = new THREE.CylinderGeometry(sawR * 0.20, sawR * 0.20, sawThick * 2.6, 16);
    structural.push(hub);
    const hubRing = ringGeo(sawR * 0.215, sawThick * 0.30, 5, 18);
    hubRing.rotateX(Math.PI / 2);
    structural.push(hubRing);
    for (const g of boltRing(6, sawR * 0.30, sawR * 0.045, sawThick * 2.2)) structural.push(g);

    // teeth — raked wedges around the rim. Capped at 30: past that the teeth are
    // sub-pixel at any sane viewing distance and only cost triangles.
    const nT = Math.max(14, Math.min(30, Math.round(sawR * 11)));
    const tw = (TAU * sawR) / nT * 0.62;
    for (let i = 0; i < nT; i++) {
      const a = (i / nT) * TAU;
      const t = chamferBox(sawR * 0.10, sawThick * 1.02, tw, Math.min(0.02, tw * 0.24));
      t.rotateY(-dirSign * 0.36);
      t.translate(sawR * 0.985, 0, 0);
      t.rotateY(a);
      teeth.push(t);
    }
    // one merged gullet groove instead of a box per tooth
    const gullet = ringGeo(sawR * 0.90, sawThick * 0.30, 4, nT);
    gullet.rotateX(Math.PI / 2);
    dark.push(gullet);
    // hot rim stripe — the read that says "this edge kills"
    const hot = ringGeo(sawR * 0.905, sawThick * 0.26, 4, 42);
    hot.rotateX(Math.PI / 2);
    glows.push(hot);

    rig.solid(matMetal, structural, spin, true, false);
    rig.solid(matGrate, teeth, spin, true, false);
    rig.solid(matDark, dark, spin, false, false);
    edgePart = rig.trim(glows, spin);

    // static shroud over the back of the blade
    const shroudGeoms = [];
    const sh = ringGeo(sawR * 1.05, sawThick * 1.5, 6, 26, Math.PI * 0.85);
    sh.rotateX(Math.PI / 2);
    sh.rotateY(Math.PI * 0.58);
    shroudGeoms.push(sh);
    const lip = chamferBox(sawR * 0.32, sawThick * 3.0, 0.12, 0.03);
    lip.translate(-sawR * 0.92, 0, 0);
    shroudGeoms.push(lip);
    for (const g of shroudGeoms) g.applyQuaternion(alignQ);
    sawShroud = rig.solid(matPanel, shroudGeoms, root, true, false);

    // Analytic disc kill: three NESTED INSCRIBED boxes. A single box would over-reach
    // to 1.41R at the corners (unfair kills); a capsule of radius R would be a sphere.
    // Inscribed boxes only ever under-cover, and the blade's own rotation sweeps the
    // union across the whole disc.
    const bands = [[0.94, 0.34], [0.69, 0.72], [0.28, 0.96]];
    for (const band of bands) {
      hz.kills.push(makeBoxKV('saw', hz, sawR * band[0], sawThick * 0.62, sawR * band[1]));
    }
  }

  // -------------------------------------------------------------------------
  buildHub();
  if (style === 'hammer') buildHammer();
  else if (style === 'windmill') buildWindmill();
  else if (style === 'saw') buildSaw();
  else buildBars();

  const staticColliders = (style === 'saw' || style === 'windmill')
    ? hz.colliders.length          // no moving solids
    : hz.colliders.length - arms;  // mount colliders were pushed first

  // -------------------------------------------------------------------------
  //  per-frame derivation
  // -------------------------------------------------------------------------
  let bpFailed = false;
  let lastPass = null;             // whoosh bookkeeping (audio only)
  let probeIdx = 0;
  let sparkCool = 0;
  let whirrCool = 0;

  function refreshBroad(c) {
    if (bpFailed || !ctx.broadphase || typeof ctx.broadphase.refresh !== 'function') return;
    try { ctx.broadphase.refresh(c); } catch (err) { bpFailed = true; }
  }

  /** World direction of arm i at rotor angle theta. */
  function armDir(i, theta, out) {
    const a = armPhase[i] + theta;
    out.set(Math.cos(a), 0, -Math.sin(a)).applyQuaternion(alignQ);
    return out;
  }

  /** Orthonormal frame for an arm: X = dir, Y = axis, Z = dir x axis (right handed). */
  function armQuat(dir, out) {
    _f.crossVectors(dir, axis).normalize();
    _mat4.makeBasis(dir, axis, _f);
    return out.setFromRotationMatrix(_mat4);
  }

  function updateSparks(t, dt) {
    sparkCool -= dt;
    if (sparkCool > 0) return;
    if (bpFailed || !ctx.broadphase || typeof ctx.broadphase.query !== 'function') { sparkCool = 1.0; return; }
    probeIdx = (probeIdx + 1) & 7;
    const theta = TAU * (t / period + phase) * dirSign;
    const a = theta + (probeIdx / 8) * TAU;
    _a.set(Math.cos(a), 0, -Math.sin(a)).applyQuaternion(alignQ).multiplyScalar(sawR * 0.99).add(pivot);
    _box3.setFromCenterAndSize(_a, _probeSize);
    _hits.length = 0;
    let found = null;
    try {
      const res = ctx.broadphase.query(_box3, _hits);
      const list = res || _hits;
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (!c || c.ref === hz || c.active === false) continue;
        if (c.aabb && typeof c.aabb.distanceToPoint === 'function') {
          if (c.aabb.distanceToPoint(_a) > 0.22) continue;
        }
        found = c; break;
      }
    } catch (err) { bpFailed = true; sparkCool = 2.0; return; }
    _hits.length = 0;
    if (!found) { sparkCool = 0.05; return; }
    sparkCool = 0.055;
    // tangential spray direction
    _b.crossVectors(axis, _c.subVectors(_a, pivot)).multiplyScalar(dirSign).normalize();
    hazBurst(ctx, 'spark', _a, { dir: _b, count: 5, speed: 5.5 + Math.abs(omega) * 0.4, color: cKill.getHex() });
  }

  function updateAudio(t, dt) {
    const pl = resolvePlayer(ctx, hz.__player);
    if (!pl || !pl.pos) return;
    _d.set(pl.pos.x, pl.pos.y, pl.pos.z);
    const dist = _d.distanceTo(pivot);
    if (style === 'saw') {
      whirrCool -= dt;
      if (whirrCool > 0 || dist > 26) return;
      if (t < _lastWhirr) _lastWhirr = -1e9;          // course clock rewound on respawn
      if (t - _lastWhirr < 0.085) { whirrCool = 0.12; return; }
      _lastWhirr = t;
      whirrCool = 0.30;
      const vol = clamp01(1 - dist / 26);
      hazSfx(ctx, 'whirr', { pos: pivot, gain: vol * vol * 0.55, rate: 0.9 + Math.min(0.6, Math.abs(omega) * 0.06), ref: 8, max: 30 });
    } else if (style === 'hammer' || style === 'windmill' || (style === 'bar' && def.kill)) {
      const theta = TAU * (t / period + phase) * dirSign;
      const pass = Math.floor((theta * arms) / TAU);
      if (lastPass === null) { lastPass = pass; return; }
      if (pass !== lastPass) {
        lastPass = pass;
        if (dist < 30) {
          const vol = clamp01(1 - dist / 30);
          hazSfx(ctx, 'whoosh', { pos: pivot, gain: vol * vol * 0.7, rate: clamp(0.75 + 2.4 / period, 0.6, 1.9), ref: 10, max: 34 });
        }
      }
    }
  }

  hz.update = function (t, dt, player) {
    dt = num(dt, 0);
    hz.time = t;
    if (player) hz.__player = player;
    const theta = TAU * (t / period + phase) * dirSign;
    spin.quaternion.copy(alignQ).multiply(_q2.setFromAxisAngle(_UP, theta));

    hz.angVel = omega;
    hz.angAxis.copy(axis);
    hz.angCenter.copy(pivot);
    hz.linVel.set(0, 0, 0);

    if (style === 'bar' || style === 'hammer') {
      const shaftLen = (style === 'hammer') ? len * 0.76 : len;
      for (let i = 0; i < arms; i++) {
        armDir(i, theta, _a);
        armQuat(_a, _q);
        const c = hz.colliders[staticColliders + i];
        if (c) {
          const half = (style === 'hammer') ? shaftLen * 0.5 : len * 0.5 + 0.08;
          c.center.copy(pivot).addScaledVector(_a, innerR + half);
          if (c.quat && c.quat.copy) c.quat.copy(_q);
          c.active = hz.enabled;
          if (typeof c.update === 'function') c.update();
          refreshBroad(c);
        }
        if (style === 'hammer') {
          const headW = Math.max(0.7, len * 0.30);
          _b.copy(pivot).addScaledVector(_a, innerR + shaftLen + headW * 0.5 + 0.16);
          setBoxKV(hz.kills[i], _b, _q);
          hz.kills[i].active = hz.enabled;
        } else if (def.kill && hz.kills[i]) {
          _b.copy(pivot).addScaledVector(_a, innerR);
          _c.copy(pivot).addScaledVector(_a, innerR + len);
          setCapsuleKV(hz.kills[i], _b, _c);
          hz.kills[i].active = hz.enabled;
        }
      }
    } else if (style === 'windmill') {
      for (let i = 0; i < arms; i++) {
        armDir(i, theta, _a);
        _b.copy(pivot).addScaledVector(_a, innerR);
        _c.copy(pivot).addScaledVector(_a, innerR + len);
        setCapsuleKV(hz.kills[i], _b, _c);
        hz.kills[i].active = hz.enabled;
      }
    } else if (style === 'saw') {
      armDir(0, theta, _a);
      armQuat(_a, _q);
      for (let i = 0; i < hz.kills.length; i++) {
        setBoxKV(hz.kills[i], pivot, _q);
        hz.kills[i].active = hz.enabled;
      }
      updateSparks(t, dt);
    }

    // emissive life: the hot edge breathes with the sweep, warnings never sleep (the same
    // curves as the loose glow materials carried, as additive trim colour)
    const ph = (theta % TAU + TAU) % TAU;
    rig.setColor(edgePart, cEdge, trimK((lethal ? 3.0 : 2.0) + Math.sin(ph * arms) * 0.55 + Math.sin(t * 7.3) * 0.22));
    rig.setColor(trimPart, cTrim, trimK((lethal ? 2.4 : 1.8) + Math.sin(t * 2.4) * 0.30));
    rig.sync();

    updateAudio(t, dt);
  };

  hz.reset = function (t) {
    lastPass = null;
    sparkCool = 0;
    whirrCool = 0;
    hz.update(num(t, 0), 0, null);
    lastPass = Math.floor((TAU * (num(t, 0) / period + phase) * dirSign * arms) / TAU);
  };

  /** CONTRACT §21 hooks. A rotor has no stand/pound behaviour; the bar simply carries. */
  hz.onStand = function () {};
  hz.onPound = function () {};
  hz.onTouch = function () {};

  hz.velocityAtPoint = function (p, out) {
    out.copy(hz.linVel);
    _a.subVectors(p, hz.angCenter);
    _b.crossVectors(hz.angAxis, _a).multiplyScalar(hz.angVel);
    return out.add(_b);
  };

  hz.dispose = function () {
    if (root.parent) root.parent.remove(root);
    rig.dispose();
    for (const g of D) { try { g.dispose(); } catch (err) { /* already gone */ } }
    for (const mm of ownMats) { try { mm.dispose(); } catch (err) { /* already gone */ } }
    D.length = 0; ownMats.length = 0;
    hz.colliders.length = 0;
    hz.kills.length = 0;
    hz.volumes.length = 0;
    while (root.children.length) root.remove(root.children[0]);
  };

  // place the static mount colliders once, then take the first pure sample
  for (let i = 0; i < staticColliders; i++) {
    const c = hz.colliders[i];
    if (c && typeof c.update === 'function') c.update();
  }
  hz.update(0, 0, null);
  return hz;
}

/**
 * A saw blade — `rotor` with the style forced. `len` is the blade RADIUS in metres.
 * Registered only through the `rotor` kind (CONTRACT §21 has no separate `saw` key);
 * `makeHazard` accepts `kind:'saw'` as an alias for `{kind:'rotor', style:'saw'}`.
 */
export function saw(def, ctx) {
  return rotor(Object.assign({}, def, { kind: 'rotor', style: 'saw' }), ctx);
}

export default rotor;
