// runtime/hazards/spikes.js
// CRESTBOUND — spike beds.
//
// Three modes, one hazard class:
//   'static'  (default) — a permanent bed. The bevelled base plate is a SOLID, standable
//                         collider; only the volume above the plate kills. Land on the rim,
//                         live.
//   'retract'           — spikes rise and sink on a cycle with a telegraph: the plate
//                         shudders, dust puffs, and a low rumble plays a beat before the
//                         points clear the deck.
//   'wall'              — the whole assembly is rotated so the spikes point along `dir`, for
//                         lethal vertical faces beside a ledge run.
//
// Everything is instanced: one draw call for the spikes, one for the hot tips, one for the
// plate. Position is a pure function of the course clock; `reset(t)` reproduces `update(t)`
// exactly (DETERMINISM LAW, CONTRACT §21).
//
// Ported from Ascendant by transliteration.

import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/util.js';
import {
  Hazard, num, v3, sizeVec, dirVec, palette, hazMat, additiveMaterial,
  bevelBox, mergeAll, makeCollider, setColliderBox, makeKill, updateKillBox,
  hazSfx, hazBurst, hazRandom, qualityOf, cycleState, makeCycleState,
} from './lasers.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const UPV = new THREE.Vector3(0, 1, 0);
const _spikeEuler = new THREE.Euler();

/* ======================================================================================
   SPIKE GEOMETRY
   ====================================================================================== */

/**
 * One spike: a tapered four-sided pyramid with a bevelled collar at the base and a
 * hardened, slightly narrower tip. Built once and instanced.
 */
function buildSpikeGeometry(radius, height) {
  const parts = [];

  // main body — a 4-sided cone reads as a forged spike, not a lathe cone
  const body = new THREE.ConeGeometry(radius, height * 0.88, 4, 3, false);
  body.rotateY(Math.PI * 0.25);
  body.translate(0, height * 0.44 + height * 0.06, 0);
  parts.push(body);

  // hardened tip: a narrower cone that overlaps the body so the silhouette stays sharp
  const tip = new THREE.ConeGeometry(radius * 0.34, height * 0.28, 4, 1, false);
  tip.rotateY(Math.PI * 0.25);
  tip.translate(0, height * 0.88, 0);
  parts.push(tip);

  // collar / weld bead where the spike meets the deck
  const collar = new THREE.CylinderGeometry(radius * 1.22, radius * 1.5, height * 0.09, 10);
  collar.translate(0, height * 0.045, 0);
  parts.push(collar);

  return mergeAll(parts);
}

/** The hot emissive band near the tip — readability first: kill surfaces are unmistakable. */
function buildTipGeometry(radius, height) {
  const g = new THREE.ConeGeometry(radius * 0.40, height * 0.30, 4, 1, true);
  g.rotateY(Math.PI * 0.25);
  g.translate(0, height * 0.855, 0);
  return g;
}

/** Base plate: chamfered deck + a raised perimeter kerb. The kerb is what you land on. */
function buildPlateGeometry(w, d, h) {
  const parts = [];
  const deck = bevelBox(w, h, d, Math.min(0.05, h * 0.4));
  deck.translate(0, h * 0.5, 0);
  parts.push(deck);

  const kerb = Math.min(0.16, Math.min(w, d) * 0.06);
  const kh = h * 1.5;
  const rails = [
    [w, kh, kerb, 0, kh * 0.5, (d - kerb) * 0.5],
    [w, kh, kerb, 0, kh * 0.5, -(d - kerb) * 0.5],
    [kerb, kh, d - kerb * 2, (w - kerb) * 0.5, kh * 0.5, 0],
    [kerb, kh, d - kerb * 2, -(w - kerb) * 0.5, kh * 0.5, 0],
  ];
  for (const r of rails) {
    const g = bevelBox(Math.max(0.02, r[0]), Math.max(0.02, r[1]), Math.max(0.02, r[2]), 0.014, 1.7, 0.5);
    g.translate(r[3], r[4], r[5]);
    parts.push(g);
  }
  return mergeAll(parts);
}

/* ======================================================================================
   SPIKE HAZARD
   ====================================================================================== */

class SpikeHazard extends Hazard {
  constructor(def, ctx) {
    super(def, ctx, 'spikes');
    const pal = palette(ctx);
    const q = qualityOf(ctx);

    this.center = v3(def.p, 0, 0, 0);
    this.size = sizeVec(def.s, 4, 1.1, 4);
    this.mode = def.mode === 'retract' || def.mode === 'wall' ? def.mode : 'static';
    this.dir = dirVec(def.dir, 0, 1, 0);

    // Orientation: local +Y is "the way the spikes point".
    this.quat = new THREE.Quaternion().setFromUnitVectors(UPV, this.dir);

    // Local extents: x/z span the bed, y is the spike length (measured along `dir`).
    if (this.mode === 'wall') {
      // A wall def gives world-space extents; convert to bed-local by taking the two axes
      // perpendicular to `dir` as the face and the remaining one as the spike length.
      const ax = Math.abs(this.dir.x), ay = Math.abs(this.dir.y), az = Math.abs(this.dir.z);
      if (ax >= ay && ax >= az) { this.bedX = this.size.y; this.bedZ = this.size.z; this.spikeLen = this.size.x; }
      else if (az >= ax && az >= ay) { this.bedX = this.size.x; this.bedZ = this.size.y; this.spikeLen = this.size.z; }
      else { this.bedX = this.size.x; this.bedZ = this.size.z; this.spikeLen = this.size.y; }
    } else {
      this.bedX = this.size.x; this.bedZ = this.size.z; this.spikeLen = this.size.y;
    }
    this.spikeLen = clamp(this.spikeLen, 0.25, 12);

    this.plateH = clamp(this.spikeLen * 0.16, 0.10, 0.36);
    this.spikeH = Math.max(0.18, this.spikeLen - this.plateH);
    this.spikeR = clamp(num(def.spikeRadius, this.spikeH * 0.30), 0.05, 1.2);

    this.cycle = def.cycle || { on: 1.5, off: 1.9, warn: 0.7, phase: 0 };
    this.cs = makeCycleState();
    this.retract = this.mode === 'retract';
    this.extend = this.retract ? 0 : 1;
    this.hotColor = new THREE.Color(pal.kill !== undefined ? pal.kill : 0xff3040);

    this._lastRise = null;
    this._lastWarn = null;

    this._buildPlate();
    this._buildSpikes(q);
    this._buildColliders();
    this.reset(0);
  }

  /** Convert a bed-local offset into world space (bed-local +Y == `dir`). */
  _toWorld(lx, ly, lz, out) {
    out.set(lx, ly, lz).applyQuaternion(this.quat).add(this.center);
    return out;
  }

  _buildPlate() {
    // The plate sits with its underside on the bed origin, spanning
    // [-len/2 .. -len/2 + plateH] along the spike axis, so a static bed's deck is flush with
    // the def's lower face.
    this.baseLocalY = -this.spikeLen * 0.5;
    const geo = buildPlateGeometry(this.bedX, this.bedZ, this.plateH);
    this.plate = new THREE.Mesh(geo, hazMat(this.ctx, 'metal'));
    this.plate.castShadow = true;
    this.plate.receiveShadow = true;
    this.plate.position.copy(this.center);
    this.plate.quaternion.copy(this.quat);
    this.plate.translateY(this.baseLocalY);
    this.add(this.plate);

    // Grubby under-glow so the bed reads as hot even in dim themes.
    const glowGeo = new THREE.PlaneGeometry(this.bedX * 0.94, this.bedZ * 0.94);
    glowGeo.rotateX(-Math.PI * 0.5);
    this.glowMat = additiveMaterial(this.hotColor.getHex(), { cached: false, opacity: 0.14 });
    this.own(this.glowMat);
    this.glowPlane = new THREE.Mesh(glowGeo, this.glowMat);
    this.glowPlane.renderOrder = 3;
    this.glowPlane.position.copy(this.center);
    this.glowPlane.quaternion.copy(this.quat);
    this.glowPlane.translateY(this.baseLocalY + this.plateH + 0.012);
    this.add(this.glowPlane);
  }

  _buildSpikes(q) {
    const pitch = Math.max(this.spikeR * 2.35, 0.36);
    let cols = Math.max(1, Math.floor((this.bedX - pitch * 0.5) / pitch));
    let rows = Math.max(1, Math.floor((this.bedZ - pitch * 0.5) / pitch));
    const budget = Math.round(lerp(120, 420, clamp(q.decor, 0, 1)));
    while (cols * rows > budget && (cols > 1 || rows > 1)) {
      if (cols >= rows) cols--; else rows--;
    }
    const count = cols * rows;
    this.spikeCount = count;

    const bodyGeo = buildSpikeGeometry(this.spikeR, this.spikeH);
    const tipGeo = buildTipGeometry(this.spikeR, this.spikeH);

    this.spikeMesh = new THREE.InstancedMesh(bodyGeo, hazMat(this.ctx, 'metal'), count);
    this.spikeMesh.castShadow = true;
    this.spikeMesh.receiveShadow = true;
    this.spikeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.spikeMesh.frustumCulled = false;

    this.tipMat = additiveMaterial(this.hotColor.getHex(), { cached: false, opacity: 0.85, side: THREE.DoubleSide });
    this.own(this.tipMat);
    this.tipMesh = new THREE.InstancedMesh(tipGeo, this.tipMat, count);
    this.tipMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tipMesh.frustumCulled = false;
    this.tipMesh.renderOrder = 4;

    // Deterministic jitter — the bed must look forged, not tiled, and identically so every run.
    const rnd = hazRandom(this.def, 33);
    this.instances = [];
    const spanX = (cols - 1) * pitch;
    const spanZ = (rows - 1) * pitch;
    const jit = pitch * 0.16;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        this.instances.push({
          x: c * pitch - spanX * 0.5 + (rnd() * 2 - 1) * jit,
          z: r * pitch - spanZ * 0.5 + (rnd() * 2 - 1) * jit,
          yaw: rnd() * Math.PI * 2,
          tiltX: (rnd() * 2 - 1) * 0.09,
          tiltZ: (rnd() * 2 - 1) * 0.09,
          scale: lerp(0.82, 1.14, rnd()),
          bob: rnd(),
        });
      }
    }
    this.add(this.spikeMesh);
    this.add(this.tipMesh);
  }

  _buildColliders() {
    // Solid base plate — genuinely standable, which is what makes a spike bed a design
    // element rather than a coin flip. Half extents are expressed in the bed frame.
    const halfLocal = _v.set(this.bedX * 0.5, this.plateH * 0.5, this.bedZ * 0.5);
    this._toWorld(0, this.baseLocalY + this.plateH * 0.5, 0, _v2);
    this.plateCollider = makeCollider({
      center: _v2, half: halfLocal, quat: this.quat,
      surface: 'normal', ref: this, group: 'world',
      props: { stepSfx: 'step_metal', stepRate: 1.0 },
    });
    this.colliders.push(this.plateCollider);

    // Lethal volume: strictly ABOVE the plate, inset so brushing the kerb is survivable.
    this.killHalfLocal = new THREE.Vector3(
      Math.max(0.05, this.bedX * 0.5 - this.spikeR * 0.35),
      Math.max(0.03, this.spikeH * 0.5),
      Math.max(0.05, this.bedZ * 0.5 - this.spikeR * 0.35),
    );
    this._toWorld(0, this.baseLocalY + this.plateH + this.spikeH * 0.5, 0, _v2);
    this.kill = makeKill({
      type: 'box', center: _v2, half: this.killHalfLocal, quat: this.quat,
      kind: 'spike', ref: this,
    });
    this.kills.push(this.kill);
  }

  /** Extension 0..1 at course time `t` — pure. 0 = fully sunk, 1 = fully deployed. */
  extensionAt(t) {
    if (!this.retract) return 1;
    const cs = cycleState(t, this.cycle, this.cs);
    if (cs.state === 'on') {
      const rise = Math.min(0.16, cs.on * 0.3);
      const fall = Math.min(0.22, cs.on * 0.3);
      const left = cs.on - cs.sinceOn;
      if (cs.sinceOn < rise) return smoothstep(0, 1, cs.sinceOn / rise);
      if (left < fall) return smoothstep(0, 1, left / fall);
      return 1;
    }
    return 0;
  }

  update(t, dt, player) {
    this.time = t;
    if (player) this.__player = player;
    const cs = this.retract ? cycleState(t, this.cycle, this.cs) : null;
    const ext = this.extensionAt(t);
    this.extend = ext;

    // --- telegraph: the plate shudders through the warn window ------------------------------
    let shudder = 0;
    if (cs && cs.state === 'warn') {
      const ramp = cs.k * cs.k;
      shudder = Math.sin(t * (46 + 40 * ramp)) * 0.016 * ramp;
    }

    // --- plate + glow ------------------------------------------------------------------------
    this._toWorld(0, this.baseLocalY + shudder, 0, _v);
    this.plate.position.copy(_v);
    this._toWorld(0, this.baseLocalY + this.plateH + 0.012 + shudder, 0, _v);
    this.glowPlane.position.copy(_v);
    this.glowMat.opacity = 0.06 + 0.20 * ext + (cs && cs.state === 'warn' ? 0.22 * cs.k : 0);

    // --- spikes ------------------------------------------------------------------------------
    // Sunk spikes hide fully inside/behind the deck; deployed spikes stand proud of it.
    const sunk = -this.spikeH - this.plateH * 0.2;
    const baseY = this.baseLocalY + this.plateH + lerp(sunk, 0, ext);
    const tipGlow = this.retract
      ? clamp(ext * 1.1, 0, 1) * (0.55 + 0.45 * Math.sin(t * 2.3) * 0.5 + 0.225)
      : 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(t * 1.7));
    this.tipMat.opacity = clamp(0.25 + tipGlow * 0.75, 0, 1);

    for (let i = 0; i < this.instances.length; i++) {
      const it = this.instances[i];
      // A whisker of per-spike phase offset keeps a retracting bed from looking like one slab.
      const off = this.retract ? lerp(-0.06, 0.06, it.bob) * (1 - ext) * this.spikeH : 0;
      _v.set(it.x, baseY + off + shudder, it.z);
      _qi.setFromEuler(_spikeEuler.set(it.tiltX, it.yaw, it.tiltZ));
      _q.copy(this.quat).multiply(_qi);
      _v.applyQuaternion(this.quat).add(this.center);
      _s.set(it.scale, it.scale, it.scale);
      _m.compose(_v, _q, _s);
      this.spikeMesh.setMatrixAt(i, _m);
      this.tipMesh.setMatrixAt(i, _m);
    }
    this.spikeMesh.instanceMatrix.needsUpdate = true;
    this.tipMesh.instanceMatrix.needsUpdate = true;

    // --- physics -----------------------------------------------------------------------------
    this._toWorld(0, this.baseLocalY + this.plateH * 0.5 + shudder, 0, _v);
    _v2.set(this.bedX * 0.5, this.plateH * 0.5, this.bedZ * 0.5);
    setColliderBox(this.plateCollider, _v, _v2, this.quat);
    this.plateCollider.active = this.enabled;

    const killH = Math.max(0.03, this.spikeH * ext * 0.5);
    this.killHalfLocal.y = killH;
    this._toWorld(0, this.baseLocalY + this.plateH + killH, 0, _v);
    updateKillBox(this.kill, _v, this.killHalfLocal, this.quat);
    // Lethal only once the points have genuinely cleared the deck.
    this.kill.active = this.enabled && ext > 0.34;

    // --- one-shot telegraph + strike effects --------------------------------------------------
    if (cs) {
      const spread = Math.max(this.bedX, this.bedZ);
      if (this.edge(this, '_lastWarn', cs.state === 'warn' ? cs.index : -1 - cs.index) && cs.state === 'warn') {
        // telegraph: a low shudder under the deck, a beat before the points arrive
        this._toWorld(0, this.baseLocalY + this.plateH + 0.05, 0, _v);
        hazSfx(this.ctx, 'crusher_slam', { gain: 0.26, rate: 0.42, pos: _v, ref: 10, max: 44 });
        hazBurst(this.ctx, 'dust', _v, { count: 10, speed: 1.6, spread: spread * 0.4 });
      }
      if (this.edge(this, '_lastRise', cs.state === 'on' ? cs.index : -1 - cs.index) && cs.state === 'on') {
        this._toWorld(0, this.baseLocalY + this.plateH + 0.05, 0, _v);
        hazSfx(this.ctx, 'crusher_slam', { gain: 0.62, rate: 1.5, pos: _v, ref: 10, max: 48 });
        hazBurst(this.ctx, 'dust', _v, { count: 18, speed: 3.4, spread: spread * 0.5 });
        hazBurst(this.ctx, 'crush', _v, { count: 8, speed: 4.5, color: this.hotColor.getHex() });
      }
    }
  }

  /** A pound on the plate rattles the bed — feedback only, never a state change. */
  onPound() {
    if (this._silent) return;
    this._toWorld(0, this.baseLocalY + this.plateH + 0.05, 0, _v);
    hazBurst(this.ctx, 'spark', _v, { count: 10, speed: 4, color: this.hotColor.getHex() });
    hazSfx(this.ctx, 'crusher_slam', { gain: 0.30, rate: 1.1, pos: _v, ref: 8, max: 30 });
  }

  onTouch(info) {
    if (info && info.type === 'step') {
      hazSfx(this.ctx, 'step_metal', { gain: 0.7, pos: info.point || this.center });
    }
  }
}

/* ======================================================================================
   FACTORY
   ====================================================================================== */

/**
 * A bed of real spike geometry.
 * `{kind:'spikes', p:[centre], s:[FULL size], dir?:[x,y,z], mode?:'static'|'retract'|'wall',
 *   cycle?:{on, off, warn, phase}, spikeRadius?}`
 *
 * `cycle` values are SECONDS (`warn` is the tail of `off`). The base plate is solid and
 * standable; only the volume above it kills. In `retract` mode the kill volume only arms once
 * extension passes 34 %, so the telegraph is always survivable.
 */
export function spikes(def, ctx) {
  return new SpikeHazard(def, ctx);
}
