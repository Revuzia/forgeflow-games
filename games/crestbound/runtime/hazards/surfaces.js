// runtime/hazards/surfaces.js
// CRESTBOUND — surface hazards: ice, conveyor, jumppad, speedpad, wind.
//
// These are the "feel" objects. Each one owns a solid Collider whose `surface` + `props` are
// read by runtime/player/collide.js and acted on by runtime/player/controller.js, and each one
// makes that physics LEGIBLE BEFORE the player commits: ice looks slippery, a conveyor's treads
// really travel at `power`, a jump pad draws the arc it will send you on, a speed pad's chevrons
// flow in the boost direction, wind is drawn by what it carries.
//
// SURFACE PROPS CONTRACT (what the controller reads from `collider.props`):
//   surface 'ice'      props {slick:1}                       — TUNE.ice.accel / TUNE.ice.friction
//   surface 'conveyor' props {dir:Vector3, power:number}      — m/s along dir, clamp TUNE.conveyorMax
//   surface 'bounce'   props {power:number, dir:Vector3}      — power = TARGET APEX IN METRES
//   surface 'speed'    props {dir:Vector3, power:number}      — m/s boost along dir
//   every surface also carries props.stepSfx / props.stepRate for the footstep voice.
//
// `wind` is NOT a collider — it publishes a `Volume` of kind 'wind' (CONTRACT §9/§21) with
// `props {dir, power}` so it can never become an accidental wall. It ALSO drives
// `player.addWind()` directly when the controller exposes it, and keeps a `fields` entry, so
// the push lands whichever integration path the controller author chose.
//
// TOUCH HOOK: when a surface effect fires, the player may call
//   `collider.ref.onTouch({type:'bounce'|'speed'|'step'|'enter', point, vel, t})`
// Pads also self-detect from the live player, so the art never goes dead.
//
// Ported from Ascendant by transliteration; retuned onto CRESTBOUND's TUNE block (§0):
// jump-pad `power` is the target APEX IN METRES resolved through `launchVelocityForApex`, and
// the ghost arc integrates the asymmetric gravRise/gravFall pair so the drawn arc is the arc
// the hero actually flies.

import * as THREE from 'three';
import { clamp, lerp, easeOutCubic } from '../core/util.js';
import { TUNE, launchVelocityForApex } from '../core/tuning.js';
import {
  Hazard, num, v3, sizeVec, dirVec, palette, hazMat, additiveMaterial, makeGlowSprite,
  bevelBox, mergeAll, makeCollider, makeVolume, hazSfx, hazBurst, hazRandom,
  qualityOf, sparkTexture, roundedRectShape, resolvePlayer, resolvePost,
  resolveListener, HazLoop,
} from './lasers.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _chevFlip = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const JP_ONE = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler();
const _c = new THREE.Color();
const UPV = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

/** The air-speed ceiling a launched hero can carry (CONTRACT §0 `airSpeedCapBonus`). */
const AIR_SPEED_CAP = TUNE.speedRun + TUNE.airSpeedCapBonus;

/** Euler from a course `rot` triple (RADIANS). */
function eulerOf(rot) {
  if (!rot) return _e.set(0, 0, 0);
  if (Array.isArray(rot)) return _e.set(num(rot[0], 0), num(rot[1], 0), num(rot[2], 0));
  return _e.set(num(rot.x, 0), num(rot.y, 0), num(rot.z, 0));
}

/** Extent of an axis-aligned full-size box measured along an arbitrary unit axis. */
function extentAlong(size, axis) {
  return Math.abs(axis.x) * size.x + Math.abs(axis.y) * size.y + Math.abs(axis.z) * size.z;
}

/**
 * Slab helper: a chamfered box pre-translated into local space.
 * `detail` is forwarded to bevelBox — drop it for small repeated parts.
 */
function slab(w, h, d, x, y, z, bevel = 0.02, detail = 1) {
  const g = bevelBox(Math.max(0.02, w), Math.max(0.02, h), Math.max(0.02, d), bevel, 1.7, detail);
  g.translate(x, y, z);
  return g;
}

const _hslA = { h: 0, s: 0, l: 0 };
const _hslB = { h: 0, s: 0, l: 0 };

/**
 * The colour a MOTION telegraph (conveyor / speedpad chevrons, lamps) may wear.
 * Normally the theme accent — but never a colour in the theme's kill hue band: in EMBER
 * FOUNDRY "orange that glows and moves" is that theme's own definition of lethal. There the
 * cue falls back to safeEdge, matching its landable language.
 */
function motionAccent(ctx) {
  const pal = palette(ctx);
  const accent = pal.accent !== undefined ? pal.accent : 0x5ec8ff;
  const kill = pal.kill !== undefined ? pal.kill : 0xff3a1f;
  _c.set(accent).getHSL(_hslA, THREE.SRGBColorSpace);
  _c.set(kill).getHSL(_hslB, THREE.SRGBColorSpace);
  const d = Math.abs(_hslA.h - _hslB.h) % 1;
  const hueDist = Math.min(d, 1 - d);
  if (hueDist < 45 / 360) return pal.safeEdge !== undefined ? pal.safeEdge : 0x9fdcff;
  return accent;
}

/**
 * Near-black matte backing for a bright telegraph. An additive chevron on an emissive belt in
 * bright fog contributes nothing (additive-over-bright is invisible); riding on this plate it
 * reads at distance in every theme. ONE shared material — never disposed by a hazard.
 */
let _chevBackMat = null;
function chevronBackingMaterial() {
  if (_chevBackMat) return _chevBackMat;
  _chevBackMat = new THREE.MeshBasicMaterial({ color: 0x0a0d12, fog: false });
  _chevBackMat.name = 'chevron_backing';
  return _chevBackMat;
}

/** A flat chevron (arrow head) lying in the XZ plane, pointing +Z. */
function chevronGeometry(w, d, thick) {
  const shape = new THREE.Shape();
  const hw = w * 0.5;
  shape.moveTo(-hw, -d * 0.5);
  shape.lineTo(0, d * 0.5);
  shape.lineTo(hw, -d * 0.5);
  shape.lineTo(hw * 0.52, -d * 0.5);
  shape.lineTo(0, d * 0.5 - d * 0.46);
  shape.lineTo(-hw * 0.52, -d * 0.5);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI * 0.5);
  g.translate(0, thick * 0.5, 0);
  return g;
}

/* ======================================================================================
   ICE
   ====================================================================================== */

const SPARK_VERT = `
attribute float aSeed;
attribute float aPhase;
uniform float uTime;
uniform float uSize;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float k = fract(uTime * (0.22 + 0.55 * aSeed) + aPhase);
  float tw = smoothstep(0.0, 0.09, k) * smoothstep(0.46, 0.11, k);
  vA = tw;
  gl_PointSize = clamp(uSize * (0.45 + aSeed) * tw * (280.0 / max(0.4, -mv.z)), 0.0, 26.0);
}
`;

const SPARK_FRAG = `
uniform sampler2D uMap;
uniform vec3 uColor;
varying float vA;
void main() {
  if (vA <= 0.01) discard;
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(uColor * (1.2 + vA), t.a * vA);
}
`;

class IceHazard extends Hazard {
  constructor(def, ctx) {
    super(def, ctx, 'ice');
    const q = qualityOf(ctx);

    this.center = v3(def.p, 0, 0, 0);
    this.size = sizeVec(def.s, 6, 0.6, 6);
    this.quat = new THREE.Quaternion().setFromEuler(eulerOf(def.rot));
    this.rimColor = new THREE.Color(num(def.color, 0x9fdcff));

    const w = this.size.x, h = this.size.y, d = this.size.z;

    // --- body: a bevelled ice slab with an inset frozen core --------------------------------
    const bodyGeo = bevelBox(w, h, d, Math.min(0.09, h * 0.3), 1.9);
    this.body = new THREE.Mesh(bodyGeo, hazMat(ctx, 'ice'));
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.body.position.copy(this.center);
    this.body.quaternion.copy(this.quat);
    this.add(this.body);

    // A crystal core just under the deck: catches the key light and reads as depth, not paint.
    const coreGeo = bevelBox(w * 0.86, h * 0.55, d * 0.86, 0.05, 2.4);
    coreGeo.translate(0, -h * 0.08, 0);
    this.core = new THREE.Mesh(coreGeo, hazMat(ctx, 'crystal'));
    this.core.castShadow = false;
    this.core.receiveShadow = false;
    this.core.position.copy(this.center);
    this.core.quaternion.copy(this.quat);
    this.add(this.core);

    // --- frosted edge: a cold rim strip on the top perimeter ---------------------------------
    const rimW = clamp(Math.min(w, d) * 0.035, 0.06, 0.24);
    const top = h * 0.5 + 0.008;
    const rimParts = [
      slab(w, 0.03, rimW, 0, top, (d - rimW) * 0.5, 0.008, 0.5),
      slab(w, 0.03, rimW, 0, top, -(d - rimW) * 0.5, 0.008, 0.5),
      slab(rimW, 0.03, d - rimW * 2, (w - rimW) * 0.5, top, 0, 0.008, 0.5),
      slab(rimW, 0.03, d - rimW * 2, -(w - rimW) * 0.5, top, 0, 0.008, 0.5),
    ];
    this.rimMat = additiveMaterial(this.rimColor.getHex(), { cached: false, opacity: 0.55 });
    this.own(this.rimMat);
    this.rim = new THREE.Mesh(mergeAll(rimParts), this.rimMat);
    this.rim.renderOrder = 4;
    this.rim.position.copy(this.center);
    this.rim.quaternion.copy(this.quat);
    this.add(this.rim);

    // Frost crust: a ring of rime where the slab meets the world, so the edge reads at speed.
    // The y-stretch is capped at 1.8 — needle rime reads as a miniature spike bed lining a
    // WALKABLE surface, and readability law says kill silhouettes must stay unambiguous.
    const crustParts = [];
    const rnd = hazRandom(def, 71);
    const crustN = clamp(Math.round((w + d) * 1.4), 8, 46);
    for (let i = 0; i < crustN; i++) {
      const along = rnd();
      const edge = Math.floor(rnd() * 4);
      const sx = edge < 2 ? lerp(-w * 0.5, w * 0.5, along) : (edge === 2 ? w * 0.5 : -w * 0.5);
      const sz = edge < 2 ? (edge === 0 ? d * 0.5 : -d * 0.5) : lerp(-d * 0.5, d * 0.5, along);
      const g = new THREE.OctahedronGeometry(lerp(0.05, 0.14, rnd()), 0);
      g.scale(1, lerp(1.2, 1.8, rnd()), 1);
      g.rotateY(rnd() * Math.PI);
      g.translate(sx, h * 0.5 - 0.02, sz);
      crustParts.push(g);
    }
    const crustGeo = mergeAll(crustParts);
    if (crustGeo) {
      this.crust = new THREE.Mesh(crustGeo, hazMat(ctx, 'crystal'));
      this.crust.castShadow = false;
      this.crust.position.copy(this.center);
      this.crust.quaternion.copy(this.quat);
      this.add(this.crust);
    }

    this._buildSparkles(q, w, h, d);

    // --- collider ----------------------------------------------------------------------------
    this.collider = makeCollider({
      center: this.center,
      half: _v.set(w * 0.5, h * 0.5, d * 0.5),
      quat: this.quat,
      surface: 'ice',
      ref: this,
      props: { stepSfx: 'step_ice', stepRate: 1.0, slick: 1 },
    });
    this.colliders.push(this.collider);
    this.reset(0);
  }

  _buildSparkles(q, w, h, d) {
    const n = clamp(Math.round(w * d * 1.6 * clamp(q.particles, 0.2, 1)), 8, 220);
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    const phase = new Float32Array(n);
    const rnd = hazRandom(this.def, 205);
    for (let i = 0; i < n; i++) {
      _v.set((rnd() - 0.5) * w * 0.96, h * 0.5 + 0.02 + rnd() * 0.06, (rnd() - 0.5) * d * 0.96);
      _v.applyQuaternion(this.quat).add(this.center);
      pos[i * 3] = _v.x; pos[i * 3 + 1] = _v.y; pos[i * 3 + 2] = _v.z;
      seed[i] = rnd();
      phase[i] = rnd();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    g.computeBoundingSphere();
    this.sparkUniforms = {
      uTime: { value: 0 },
      uSize: { value: 7.5 },
      uMap: { value: sparkTexture() },
      uColor: { value: this.rimColor.clone().lerp(new THREE.Color(0xffffff), 0.4) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.sparkUniforms, vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      toneMapped: false, fog: false,
    });
    this.own(mat);
    this.sparkles = new THREE.Points(g, mat);
    this.sparkles.renderOrder = 6;
    this.add(this.sparkles);
  }

  update(t) {
    this.time = t;
    this.sparkUniforms.uTime.value = t;
    // Slow cold breathing on the rim so a frozen platform never looks like a static decal.
    this.rimMat.opacity = 0.40 + 0.22 * (0.5 + 0.5 * Math.sin(t * 0.9 + this.center.x * 0.3));
    this.collider.active = this.enabled;
  }

  onTouch(info) {
    if (info && info.type === 'step') {
      hazSfx(this.ctx, 'step_ice', { gain: 0.7, pos: (info && info.point) || this.center });
    }
  }
}

/**
 * Slippery collider surface with a frosted, unmistakably-icy read.
 * `{kind:'ice', p:[centre], s:[FULL size], rot?:[rx,ry,rz] RADIANS, color?}`
 * The controller reads `surface:'ice'` and applies TUNE.ice.accel / TUNE.ice.friction; a slope
 * of more than TUNE.slope.iceSlideDeg (20 deg) on ice starts a slopeSlide.
 */
export function ice(def, ctx) { return new IceHazard(def, ctx); }

/* ======================================================================================
   CONVEYOR
   ====================================================================================== */

class ConveyorHazard extends Hazard {
  constructor(def, ctx) {
    super(def, ctx, 'conveyor');
    const q = qualityOf(ctx);

    this.center = v3(def.p, 0, 0, 0);
    this.size = sizeVec(def.s, 8, 0.7, 3);
    this.power = clamp(num(def.power, 5.5), -TUNE.conveyorMax, TUNE.conveyorMax);

    // Belt frame: fwd = travel, nrm = surface normal, side = nrm x fwd (right handed).
    this.fwd = dirVec(def.dir, 1, 0, 0);
    this.nrm = Math.abs(this.fwd.dot(UPV)) > 0.9 ? new THREE.Vector3(0, 0, 1) : UPV.clone();
    this.nrm.sub(_v.copy(this.fwd).multiplyScalar(this.nrm.dot(this.fwd)));
    if (this.nrm.lengthSq() < 1e-8) this.nrm.set(0, 0, 1);
    this.nrm.normalize();
    this.side = new THREE.Vector3().crossVectors(this.nrm, this.fwd).normalize();

    this.beltLen = Math.max(0.6, extentAlong(this.size, this.fwd));
    this.beltWidth = Math.max(0.4, extentAlong(this.size, this.side));
    this.beltThick = Math.max(0.12, extentAlong(this.size, this.nrm));
    this.R = this.beltThick * 0.5;
    this.accent = new THREE.Color(motionAccent(ctx));

    // A closed loop: two straight runs plus a half-turn around each roller.
    this.straight = Math.max(0.2, this.beltLen - this.beltThick);
    this.perimeter = this.straight * 2 + Math.PI * this.beltThick;

    this._buildFrame();
    this._buildTreads(q);
    this._buildChevrons(q);

    this.collider = makeCollider({
      center: this.center,
      half: _v.copy(this.size).multiplyScalar(0.5),
      surface: 'conveyor',
      ref: this,
      props: {
        dir: this.fwd.clone(), dirArr: [this.fwd.x, this.fwd.y, this.fwd.z],
        power: this.power, stepSfx: 'step_metal', stepRate: 1.0,
      },
    });
    this.colliders.push(this.collider);
    this.reset(0);
  }

  /** Local belt-space point + frame for an arclength `s`. Allocation free. */
  _beltPoint(s, outPos, outUp, outTan) {
    const L = this.straight, R = this.R;
    const arc = Math.PI * R;
    let k = s % this.perimeter;
    if (k < 0) k += this.perimeter;
    if (k < L) {                                   // top run, travelling +fwd
      outPos.copy(this.fwd).multiplyScalar(-L * 0.5 + k).addScaledVector(this.nrm, R);
      outUp.copy(this.nrm);
      outTan.copy(this.fwd);
    } else if (k < L + arc) {                      // leading roller
      const th = (k - L) / R;
      outPos.copy(this.fwd).multiplyScalar(L * 0.5 + Math.sin(th) * R)
        .addScaledVector(this.nrm, Math.cos(th) * R);
      outUp.copy(this.fwd).multiplyScalar(Math.sin(th)).addScaledVector(this.nrm, Math.cos(th));
      outTan.copy(this.fwd).multiplyScalar(Math.cos(th)).addScaledVector(this.nrm, -Math.sin(th));
    } else if (k < L * 2 + arc) {                  // bottom run, travelling -fwd
      const u = k - (L + arc);
      outPos.copy(this.fwd).multiplyScalar(L * 0.5 - u).addScaledVector(this.nrm, -R);
      outUp.copy(this.nrm).multiplyScalar(-1);
      outTan.copy(this.fwd).multiplyScalar(-1);
    } else {                                       // trailing roller
      const th = (k - (L * 2 + arc)) / R;
      outPos.copy(this.fwd).multiplyScalar(-L * 0.5 - Math.sin(th) * R)
        .addScaledVector(this.nrm, -Math.cos(th) * R);
      outUp.copy(this.fwd).multiplyScalar(-Math.sin(th)).addScaledVector(this.nrm, -Math.cos(th));
      outTan.copy(this.fwd).multiplyScalar(-Math.cos(th)).addScaledVector(this.nrm, Math.sin(th));
    }
    outPos.add(this.center);
    return outPos;
  }

  _buildFrame() {
    // Everything is authored in belt-local space (X = side, Y = nrm, Z = fwd), rotated once.
    const parts = [];
    const L = this.straight, R = this.R, W = this.beltWidth;
    const railW = clamp(W * 0.10, 0.06, 0.26);

    // core slab the treads wrap around
    parts.push(slab(W * 0.92, (R - 0.05) * 2, L, 0, 0, 0, 0.02));

    // side rails, flush with the belt top so they never trip the player
    parts.push(slab(railW, R * 2 * 0.9, L + this.beltThick * 0.6, (W - railW) * 0.5, 0, 0, 0.015));
    parts.push(slab(railW, R * 2 * 0.9, L + this.beltThick * 0.6, -(W - railW) * 0.5, 0, 0, 0.015));

    // rollers with machined grooves
    for (const zz of [L * 0.5, -L * 0.5]) {
      const roller = new THREE.CylinderGeometry(R * 0.96, R * 0.96, W * 0.9, 18, 1, false);
      roller.rotateZ(Math.PI * 0.5);
      roller.translate(0, 0, zz);
      parts.push(roller);
      for (let i = -2; i <= 2; i++) {
        const groove = new THREE.CylinderGeometry(R * 1.02, R * 1.02, W * 0.035, 18, 1, false);
        groove.rotateZ(Math.PI * 0.5);
        groove.translate(i * W * 0.17, 0, zz);
        parts.push(groove);
      }
      // end caps / bearing housings
      for (const sx of [1, -1]) {
        const cap = new THREE.CylinderGeometry(R * 0.55, R * 0.62, W * 0.06, 12);
        cap.rotateZ(Math.PI * 0.5);
        cap.translate(sx * W * 0.47, 0, zz);
        parts.push(cap);
      }
    }

    const geo = mergeAll(parts);
    this.frame = new THREE.Mesh(geo, hazMat(this.ctx, 'conveyor'));
    this.frame.castShadow = true;
    this.frame.receiveShadow = true;
    this._orient(this.frame);
    this.add(this.frame);

    // static direction arrows engraved into the rails
    const n = clamp(Math.round(L / 1.5), 2, 12);
    const arrowParts = [];
    const backParts = [];
    for (let i = 0; i < n; i++) {
      const z = lerp(-L * 0.42, L * 0.42, n === 1 ? 0.5 : i / (n - 1));
      for (const sx of [1, -1]) {
        const g = chevronGeometry(railW * 0.8, railW * 1.1, 0.012);
        g.translate(sx * (this.beltWidth - railW) * 0.5, R * 0.9 + 0.012, z);
        arrowParts.push(g);
        const b = chevronGeometry(railW * 0.94, railW * 1.24, 0.012);
        b.translate(sx * (this.beltWidth - railW) * 0.5, R * 0.9 + 0.006, z);
        backParts.push(b);
      }
    }
    const arrowGeo = mergeAll(arrowParts);
    if (arrowGeo) {
      // dark backing first, so the additive arrows read on the lit rail
      const backGeo = mergeAll(backParts);
      if (backGeo) {
        const backing = new THREE.Mesh(backGeo, chevronBackingMaterial());
        backing.renderOrder = 3;
        this._orient(backing, this.power < 0);
        this.add(backing);
      }
      this.arrowMat = additiveMaterial(this.accent.getHex(), { cached: false, opacity: 0.55 });
      this.own(this.arrowMat);
      const arrows = new THREE.Mesh(arrowGeo, this.arrowMat);
      arrows.renderOrder = 4;
      this._orient(arrows, this.power < 0);
      this.add(arrows);
    }
  }

  /** Place a belt-local mesh into world space (optionally flipped for a reversed belt). */
  _orient(obj, flip) {
    _m.makeBasis(this.side, this.nrm, this.fwd);
    obj.quaternion.setFromRotationMatrix(_m);
    if (flip) obj.quaternion.multiply(_q.setFromAxisAngle(UPV, Math.PI));
    obj.position.copy(this.center);
  }

  _buildTreads(q) {
    const W = this.beltWidth;
    const treadDepth = clamp(this.R * 1.5, 0.16, 0.6);
    this.treadSpacing = treadDepth * 1.28;
    const count = clamp(Math.round(this.perimeter / this.treadSpacing), 4, Math.round(lerp(40, 96, clamp(q.decor, 0, 1))));
    this.treadSpacing = this.perimeter / count;
    this.treadCount = count;

    const parts = [];
    const treadThick = 0.075;
    const ribH = 0.05;
    // The tread's OUTER face must land exactly on the collider surface, or the player's feet
    // visibly float. Everything is authored down from that face.
    this.treadInset = treadThick * 0.5 + ribH * 0.5;
    parts.push(slab(W * 0.9, treadThick, treadDepth, 0, 0, 0, 0.012, 0.34));
    for (let i = -1; i <= 1; i++) {
      parts.push(slab(W * 0.84, ribH, treadDepth * 0.16, 0, ribH * 0.5 + treadThick * 0.2, i * treadDepth * 0.28, 0.008, 0.34));
    }
    const geo = mergeAll(parts);
    this.treadMesh = new THREE.InstancedMesh(geo, hazMat(this.ctx, 'metal'), count);
    this.treadMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.treadMesh.castShadow = false;
    this.treadMesh.receiveShadow = true;
    this.treadMesh.frustumCulled = false;
    this.add(this.treadMesh);
  }

  _buildChevrons() {
    const L = this.straight;
    const n = clamp(Math.round(L / 0.85), 2, 22);
    this.chevCount = n;
    this.chevSpacing = L / n;
    // A dark plate UNDER each flowing chevron: "the chevrons point the way it will carry you"
    // only teaches if a chevron survives to the screen — an additive glyph alone dies on an
    // emissive belt. The backing geometry is authored 6 mm lower so both meshes can share one
    // instance matrix.
    const backGeo = chevronGeometry(this.beltWidth * 0.46, this.beltWidth * 0.38, 0.02);
    backGeo.translate(0, -0.006, 0);
    this.chevBack = new THREE.InstancedMesh(backGeo, chevronBackingMaterial(), n);
    this.chevBack.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chevBack.frustumCulled = false;
    this.chevBack.renderOrder = 4;
    this.add(this.chevBack);
    const geo = chevronGeometry(this.beltWidth * 0.38, this.beltWidth * 0.30, 0.02);
    this.chevMat = additiveMaterial(this.accent.getHex(), { cached: false, opacity: 0.7 });
    this.own(this.chevMat);
    this.chevMesh = new THREE.InstancedMesh(geo, this.chevMat, n);
    this.chevMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chevMesh.frustumCulled = false;
    this.chevMesh.renderOrder = 5;
    this.add(this.chevMesh);
  }

  update(t) {
    this.time = t;
    const travel = t * this.power;

    // Treads ride the loop at exactly the surface speed, so the eye and the physics agree.
    for (let i = 0; i < this.treadCount; i++) {
      this._beltPoint(i * this.treadSpacing + travel, _v, _v2, _v3);
      _v.addScaledVector(_v2, -this.treadInset);
      _m.makeBasis(this.side, _v2, _v3);
      _q.setFromRotationMatrix(_m);
      _m.compose(_v, _q, ONE);
      this.treadMesh.setMatrixAt(i, _m);
    }
    this.treadMesh.instanceMatrix.needsUpdate = true;

    // Chevrons flow along the top run only, wrapping at the ends.
    const dirSign = this.power >= 0 ? 1 : -1;
    const L = this.straight;
    const flow = ((t * Math.abs(this.power)) % this.chevSpacing + this.chevSpacing) % this.chevSpacing;
    _m.makeBasis(this.side, this.nrm, this.fwd);
    const baseQ = _q.setFromRotationMatrix(_m);
    if (dirSign < 0) baseQ.multiply(_chevFlip.setFromAxisAngle(UPV, Math.PI));
    for (let i = 0; i < this.chevCount; i++) {
      let z = -L * 0.5 + i * this.chevSpacing + flow * dirSign;
      z = ((z + L * 0.5) % L + L) % L - L * 0.5;
      const fade = Math.min(1, Math.min(z + L * 0.5, L * 0.5 - z) / (L * 0.16 + 0.001));
      _v.copy(this.fwd).multiplyScalar(z).addScaledVector(this.nrm, this.R + 0.045).add(this.center);
      const sc = clamp(fade, 0, 1);
      _s.set(sc, sc, sc);
      _m.compose(_v, baseQ, _s);
      this.chevMesh.setMatrixAt(i, _m);
      this.chevBack.setMatrixAt(i, _m);
    }
    this.chevMesh.instanceMatrix.needsUpdate = true;
    this.chevBack.instanceMatrix.needsUpdate = true;
    this.chevMat.opacity = 0.45 + 0.30 * (0.5 + 0.5 * Math.sin(t * 3.4));

    this.collider.active = this.enabled;
  }

  onTouch(info) {
    if (info && info.type === 'step') hazSfx(this.ctx, 'step_metal', { gain: 0.75, rate: 1.06 });
  }
}

/**
 * Belt with real travelling treads; pushes the player along `dir` at `power` m/s.
 * `{kind:'conveyor', p, s, dir:[x,y,z]|'x'|'-z', power:m/s}`
 * `power` is SIGNED and clamped to ±TUNE.conveyorMax (8 m/s); negative reverses the belt art.
 */
export function conveyor(def, ctx) { return new ConveyorHazard(def, ctx); }

/* ======================================================================================
   JUMP PAD
   ====================================================================================== */

class JumpPadHazard extends Hazard {
  constructor(def, ctx) {
    super(def, ctx, 'jumppad');
    const pal = palette(ctx);

    this.center = v3(def.p, 0, 0, 0);
    this.size = sizeVec(def.s, 1.8, 0.42, 1.8);
    // `power` is the TARGET APEX IN METRES (CONTRACT §21 README), not a velocity.
    this.power = clamp(num(def.power, TUNE.bounceDefaultApex), 0.4, 40);
    this.launchV = launchVelocityForApex(this.power);
    this.dir = dirVec(def.dir, 0, 1, 0);
    this.accent = new THREE.Color(pal.checkpoint !== undefined ? pal.checkpoint : 0x35e0ff);

    // Heading used for the readability arc: an explicit aim, the horizontal part of `dir`,
    // or +X as a last resort.
    this.aim = new THREE.Vector3();
    if (def.aim) this.aim.copy(dirVec(def.aim, 1, 0, 0));
    else {
      this.aim.set(this.dir.x, 0, this.dir.z);
      if (this.aim.lengthSq() < 1e-6) this.aim.set(1, 0, 0);
      this.aim.normalize();
    }

    this.top = this.center.y + this.size.y * 0.5;
    this._fireAt = -99;
    this._lastAuto = -99;
    this._arcSpeed = TUNE.speedRun * 0.85;

    this._buildPad();
    this._buildArc();

    this.collider = makeCollider({
      center: this.center,
      half: _v.copy(this.size).multiplyScalar(0.5),
      surface: 'bounce',
      ref: this,
      props: {
        power: this.power, launchV: this.launchV,
        dir: this.dir.clone(), dirArr: [this.dir.x, this.dir.y, this.dir.z],
        stepSfx: 'step_wood', stepRate: 0.9,
      },
    });
    this.colliders.push(this.collider);
    this.reset(0);
  }

  _buildPad() {
    const w = this.size.x, h = this.size.y, d = this.size.z;
    const padR = Math.min(w, d) * 0.5;

    // --- base housing (static) ---------------------------------------------------------------
    const baseParts = [];
    baseParts.push(slab(w, h * 0.34, d, 0, -h * 0.5 + h * 0.17, 0, 0.03));
    const ringOuter = new THREE.CylinderGeometry(padR * 0.98, padR * 1.05, h * 0.22, 24, 1, false);
    ringOuter.translate(0, -h * 0.5 + h * 0.42, 0);
    baseParts.push(ringOuter);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI * 0.5 * i + Math.PI * 0.25;
      baseParts.push(slab(padR * 0.26, h * 0.3, padR * 0.26,
        Math.cos(a) * padR * 0.82, -h * 0.5 + h * 0.15, Math.sin(a) * padR * 0.82, 0.015));
    }
    /* BATCHED (hazards/batch.js): every part of the pad joins the course-wide batch for its
       material, so the pad's nine loose draws collapse into shared ones. Poses are written from
       exactly the numbers the meshes used to hold. */
    this.basePart = this.solidPart(hazMat(this.ctx, 'metal'), mergeAll(baseParts), true, true);
    this.setPart(this.basePart, this.center, null, JP_ONE);

    // --- spring: a real helix, scaled in Y to compress -----------------------------------------
    const coilPts = [];
    const turns = 3.4;
    const coilR = padR * 0.55;
    const coilH = h * 0.52;
    for (let i = 0; i <= 72; i++) {
      const u = i / 72;
      const a = u * Math.PI * 2 * turns;
      coilPts.push(new THREE.Vector3(Math.cos(a) * coilR, u * coilH, Math.sin(a) * coilR));
    }
    const coilGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coilPts), 108, Math.max(0.018, padR * 0.055), 6, false);
    // castShadow stays FALSE, exactly as the loose spring mesh had it (it sits inside the
    // housing and its shadow is never seen) — so it takes the non-casting metal batch.
    this.springPart = this.solidPart(hazMat(this.ctx, 'metal'), coilGeo, false, true);
    coilGeo.dispose();
    this.springPos = this.center.clone();
    this.springPos.y += -h * 0.5 + h * 0.30;
    this.springBaseY = this.springPos.y;
    this.springScale = new THREE.Vector3(1, 1, 1);
    this.setPart(this.springPart, this.springPos, null, this.springScale);

    // --- bellows: three concentric rings that squash on trigger ---------------------------------
    const bellowGeo = new THREE.TorusGeometry(padR * 0.74, Math.max(0.02, padR * 0.085), 8, 22);
    bellowGeo.rotateX(Math.PI * 0.5);
    this.bellowParts = [];
    // castShadow FALSE as before — three concentric rings inside the housing.
    for (let i = 0; i < 3; i++) this.bellowParts.push(this.solidPart(hazMat(this.ctx, 'rubber'), bellowGeo, false, true));
    bellowGeo.dispose();
    this.bellowsBaseY = this.center.y - h * 0.5 + h * 0.34;
    this.bellowsSpan = h * 0.42;

    // --- top pad --------------------------------------------------------------------------------
    const padParts = [];
    const shape = roundedRectShape(w * 0.94, d * 0.94, Math.min(w, d) * 0.22);
    const padGeo = new THREE.ExtrudeGeometry(shape, {
      depth: h * 0.16, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 5, steps: 1,
    });
    padGeo.translate(0, 0, -h * 0.08);
    padGeo.rotateX(-Math.PI * 0.5);
    padParts.push(padGeo);
    const grip = new THREE.CylinderGeometry(padR * 0.62, padR * 0.62, h * 0.06, 22);
    grip.translate(0, h * 0.11, 0);
    padParts.push(grip);
    this.padPart = this.solidPart(hazMat(this.ctx, 'rubber'), mergeAll(padParts), true, true);
    this.padPos = this.center.clone();
    this.padPos.y = this.top - this.size.y * 0.10;
    this.padBaseY = this.padPos.y;
    this.setPart(this.padPart, this.padPos, null, JP_ONE);

    // --- emissive face + launch ring ------------------------------------------------------------
    const faceGeo = new THREE.CylinderGeometry(padR * 0.58, padR * 0.58, 0.018, 24);
    this.facePart = this.trimPart(faceGeo);
    this.facePos = new THREE.Vector3();

    const ringGeo = new THREE.RingGeometry(padR * 0.7, padR * 0.98, 40, 1);
    ringGeo.rotateX(-Math.PI * 0.5);
    this.ringPart = this.trimPart(ringGeo);
    this.ringPos = new THREE.Vector3(this.center.x, this.top + 0.03, this.center.z);
    this.ringScale = new THREE.Vector3(1, 1, 1);
    this.setPart(this.ringPart, this.ringPos, null, this.ringScale);

    this.padGlowPart = this.glowPart();
    this.padGlowPos = new THREE.Vector3(this.center.x, this.top + 0.12, this.center.z);
    this.padGlowSize = padR * 3.0;
    this.padR = padR;
  }

  _buildArc() {
    this.arcCount = 11;
    const geo = new THREE.OctahedronGeometry(0.085, 0);
    this.arcParts = [];
    for (let i = 0; i < this.arcCount; i++) this.arcParts.push(this.trimPart(geo.clone()));
    geo.dispose();
    this._writeArc(this._arcSpeed);
  }

  /**
   * Ghost markers along the launch trajectory. Uses CRESTBOUND's ASYMMETRIC gravity (§0
   * gravRise 34 / gravFall 46) so the drawn arc is the arc the hero actually flies: rise under
   * gravRise to `power` metres, fall under gravFall. Subtle by design — a readability aid, not
   * a HUD element.
   */
  _writeArc(hSpeed) {
    const v0 = this.launchV;
    const tRise = v0 / TUNE.gravRise;
    const tFall = Math.sqrt(2 * this.power / TUNE.gravFall);
    const total = (tRise + tFall) * 1.06;
    for (let i = 0; i < this.arcCount; i++) {
      const u = (i + 1) / (this.arcCount + 1);
      const tt = u * total;
      let y;
      if (tt <= tRise) y = v0 * tt - 0.5 * TUNE.gravRise * tt * tt;
      else { const td = tt - tRise; y = this.power - 0.5 * TUNE.gravFall * td * td; }
      _v.copy(this.center)
        .addScaledVector(this.aim, hSpeed * tt)
        .setY(this.top + Math.max(y, -this.size.y));
      const fade = Math.sin(u * Math.PI) * 0.85 + 0.15;
      _s.setScalar(clamp(fade, 0.15, 1) * lerp(1.15, 0.55, u));
      this.setPart(this.arcParts[i], _v, null, _s);
    }
    this._arcSpeed = hSpeed;
  }

  /** Fired by the player (or self-detected) when the pad launches someone. */
  onTouch(info) {
    if (info && info.type && info.type !== 'bounce') {
      if (info.type === 'step') hazSfx(this.ctx, 'step_metal', { gain: 0.6, rate: 1.2 });
      return;
    }
    this._trigger(info && info.point ? info.point : null);
  }

  /** A ground pound onto the pad fires it as hard as a landing does. */
  onPound() { this._trigger(null); }

  _trigger(point) {
    this._fireAt = this.time;
    if (this._silent) return;
    _v.set(this.center.x, this.top + 0.05, this.center.z);
    hazSfx(this.ctx, 'bounce', {
      gain: 1, rate: clamp(0.9 + this.power * 0.014, 0.8, 1.5), pos: point || _v,
    });
    hazBurst(this.ctx, 'bounce', point || _v, { count: 16, speed: 5.5, color: this.accent.getHex(), power: this.power });
  }

  update(t, dt, player) {
    this.time = t;
    if (player) this.__player = player;
    const h = this.size.y;

    // Self-detect a launch when the controller has not wired onTouch. Cheap and debounced —
    // this is the PRIMARY path, not a fallback: nothing in the engine is obliged to call
    // hazard.onTouch, and a dead-looking pad is a broken pad.
    const pl = resolvePlayer(this.ctx, player || this.__player);
    if (pl && pl.pos && pl.vel) {
      const dx = Math.abs(pl.pos.x - this.center.x), dz = Math.abs(pl.pos.z - this.center.z);
      if (t - this._lastAuto > 0.3
        && dx < this.size.x * 0.62 && dz < this.size.z * 0.62
        && pl.pos.y > this.top - 0.4 && pl.pos.y < this.top + 1.6 && pl.vel.y > 5) {
        this._lastAuto = t;
        this._trigger(null);
      }
      // Track the real horizontal speed so the ghost arc predicts the hero's actual launch.
      // Only redraw on a meaningful change: 11 instance matrices is cheap, but not free.
      const hs = Math.hypot(pl.vel.x, pl.vel.z);
      if (Math.abs(hs - this._arcSpeed) > 0.45) this._writeArc(clamp(hs, 0, AIR_SPEED_CAP));
    }

    const age = t - this._fireAt;
    // compress fast (60 ms), release with an overshoot, settle by 420 ms
    let compress = 0;
    if (age >= 0 && age < 0.42) {
      if (age < 0.06) compress = age / 0.06;
      else compress = Math.cos((age - 0.06) / 0.36 * Math.PI * 2.4) * Math.exp(-(age - 0.06) * 7.5);
    }
    const idle = 0.035 * Math.sin(t * 1.8);
    const sink = compress * h * 0.30;

    this.padPos.y = this.padBaseY - sink + idle * h;
    this.setPart(this.padPart, this.padPos, null, JP_ONE);
    this.springScale.set(1, clamp(1 - compress * 0.42, 0.35, 1.1), 1);
    this.springPos.y = this.springBaseY;
    this.setPart(this.springPart, this.springPos, null, this.springScale);

    for (let i = 0; i < 3; i++) {
      const u = (i + 1) / 4;
      const y = this.bellowsBaseY + this.bellowsSpan * u * clamp(1 - compress * 0.55, 0.25, 1.1) - sink * u * 0.7;
      _v.set(this.center.x, y, this.center.z);
      const bulge = 1 + compress * 0.16 * (1 - u);
      _s.set(bulge, clamp(1 - compress * 0.3, 0.5, 1.2), bulge);
      this.setPart(this.bellowParts[i], _v, null, _s);
    }

    // face + glow breathe; ring blooms outward on launch
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.6);
    this.facePos.set(this.center.x, this.padPos.y + h * 0.15, this.center.z);
    this.setPart(this.facePart, this.facePos, null, JP_ONE);
    this.setPartColor(this.facePart, this.accent, 0.45 + 0.30 * pulse + clamp(1 - age / 0.25, 0, 1) * 0.9);
    this.padGlowPos.y = this.top + 0.12;
    this.setPartGlow(this.padGlowPart, this.padGlowPos, this.padGlowSize);
    this.setPartColor(this.padGlowPart, this.accent, 0.16 + 0.10 * pulse + clamp(1 - age / 0.3, 0, 1) * 0.5);

    if (age >= 0 && age < 0.55) {
      const k = easeOutCubic(clamp(age / 0.55, 0, 1));
      this.setPartVisible(this.ringPart, true);
      this.ringScale.setScalar(0.4 + k * 2.6);
      this.ringPos.set(this.center.x, this.top + 0.03 + k * 1.3, this.center.z);
      this.setPart(this.ringPart, this.ringPos, null, this.ringScale);
      this.setPartColor(this.ringPart, this.accent, (1 - k) * 0.8);
    } else {
      this.setPartVisible(this.ringPart, false);
    }

    for (let i = 0; i < this.arcCount; i++) this.setPartColor(this.arcParts[i], this.accent, 0.14 + 0.10 * pulse);
    this.collider.active = this.enabled;
  }

  reset(t) {
    this._fireAt = -99;
    this._lastAuto = -99;
    super.reset(t);
  }
}

/**
 * Springy launcher.
 * `{kind:'jumppad', p, s?, power:APEX_METRES, dir?, aim?}`
 * `power` is the TARGET APEX IN METRES (default TUNE.bounceDefaultApex = 4 m) — the collider
 * publishes both `props.power` (metres) and `props.launchV` (the m/s the controller sets vy to),
 * so nobody has to redo `sqrt(2 * gravRise * apex)` at the call site. The ghost arc draws where
 * you land at your current run speed.
 */
export function jumppad(def, ctx) { return new JumpPadHazard(def, ctx); }

/* ======================================================================================
   SPEED PAD
   ====================================================================================== */

class SpeedPadHazard extends Hazard {
  constructor(def, ctx) {
    super(def, ctx, 'speedpad');

    this.center = v3(def.p, 0, 0, 0);
    this.size = sizeVec(def.s, 2.6, 0.24, 2.6);
    this.dir = dirVec(def.dir, 1, 0, 0);
    this.flat = new THREE.Vector3(this.dir.x, 0, this.dir.z);
    if (this.flat.lengthSq() < 1e-6) this.flat.set(1, 0, 0);
    this.flat.normalize();
    this.power = clamp(num(def.power, TUNE.speedRun), 1, 30);
    this.accent = new THREE.Color(motionAccent(ctx));
    this.top = this.center.y + this.size.y * 0.5;
    this._fireAt = -99;
    this._lastAuto = -99;

    this._buildPad();

    this.collider = makeCollider({
      center: this.center,
      half: _v.copy(this.size).multiplyScalar(0.5),
      surface: 'speed',
      ref: this,
      props: {
        dir: this.flat.clone(), dirArr: [this.flat.x, 0, this.flat.z],
        power: this.power, stepSfx: 'step_metal', stepRate: 1.15,
      },
    });
    this.colliders.push(this.collider);
    this.reset(0);
  }

  _buildPad() {
    const h = this.size.y;
    const len = extentAlong(this.size, this.flat);
    const wid = extentAlong(this.size, _v.copy(this.flat).cross(UPV).normalize());
    this.padLen = len; this.padWid = wid;

    const parts = [];
    parts.push(slab(wid, h, len, 0, 0, 0, 0.028));
    // recessed channel the chevrons sit in
    parts.push(slab(wid * 0.72, h * 0.2, len * 0.94, 0, h * 0.5 - h * 0.09, 0, 0.012));
    // side lamp housings
    for (const sx of [1, -1]) {
      parts.push(slab(wid * 0.09, h * 0.7, len * 0.9, sx * wid * 0.43, h * 0.12, 0, 0.01));
    }
    const geo = mergeAll(parts);
    this.body = new THREE.Mesh(geo, hazMat(this.ctx, 'panel'));
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    _m.makeBasis(_v2.copy(this.flat).cross(UPV).normalize().negate(), UPV, this.flat);
    this.body.quaternion.setFromRotationMatrix(_m);
    this.body.position.copy(this.center);
    this.add(this.body);
    this.baseQuat = this.body.quaternion.clone();

    // side lamp strips
    const lampParts = [];
    for (const sx of [1, -1]) {
      lampParts.push(slab(wid * 0.045, 0.02, len * 0.86, sx * wid * 0.43, h * 0.5 + 0.006, 0, 0.006, 0.34));
    }
    this.lampMat = additiveMaterial(this.accent.getHex(), { cached: false, opacity: 0.6 });
    this.own(this.lampMat);
    this.lamps = new THREE.Mesh(mergeAll(lampParts), this.lampMat);
    this.lamps.renderOrder = 5;
    this.lamps.quaternion.copy(this.baseQuat);
    this.lamps.position.copy(this.center);
    this.add(this.lamps);

    // flowing chevrons, each on a dark backing plate (see chevronBackingMaterial)
    this.chevCount = clamp(Math.round(len / 0.55), 3, 16);
    this.chevSpacing = len / this.chevCount;
    const bg = chevronGeometry(wid * 0.58, wid * 0.42, 0.02);
    bg.translate(0, -0.006, 0);
    this.chevBack = new THREE.InstancedMesh(bg, chevronBackingMaterial(), this.chevCount);
    this.chevBack.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chevBack.frustumCulled = false;
    this.chevBack.renderOrder = 5;
    this.add(this.chevBack);
    const cg = chevronGeometry(wid * 0.5, wid * 0.34, 0.02);
    this.chevMat = additiveMaterial(this.accent.getHex(), { cached: false, opacity: 0.85 });
    this.own(this.chevMat);
    this.chevMesh = new THREE.InstancedMesh(cg, this.chevMat, this.chevCount);
    this.chevMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chevMesh.frustumCulled = false;
    this.chevMesh.renderOrder = 6;
    this.add(this.chevMesh);

    // Half-size, dim halo: at pad size the sprite fuses pad, lamps and chevrons into one
    // bloomed blob from 15 m — the telegraph must stay a drawn arrow field, not a light source.
    this.glow = makeGlowSprite(this.accent.getHex(), Math.max(wid, len) * 0.6, 0.10, 2.8);
    this.own(this.glow.material);
    this.glow.position.set(this.center.x, this.top + 0.10, this.center.z);
    this.add(this.glow);
  }

  onTouch(info) {
    if (info && info.type === 'step') { hazSfx(this.ctx, 'step_metal', { gain: 0.6, rate: 1.2 }); return; }
    this._trigger(info && info.point ? info.point : null);
  }

  _trigger(point) {
    this._fireAt = this.time;
    if (this._silent) return;
    _v.set(this.center.x, this.top + 0.08, this.center.z);
    hazSfx(this.ctx, 'wind', { gain: 0.62, rate: 1.9, pos: point || _v });
    hazBurst(this.ctx, 'spark', point || _v, {
      count: 14, speed: 7, color: this.accent.getHex(), dir: this.flat,
    });
    // Motion-line hooks for the FX layer; optional by design, guarded so they can simply not
    // exist. `Post.setSpeedLines` is the CONTRACT §7 name.
    try {
      const post = resolvePost(this.ctx);
      if (post && typeof post.setSpeedLines === 'function') post.setSpeedLines(clamp(this.power / 18, 0, 1));
      const fx = this.ctx && this.ctx.fx;
      if (fx && typeof fx.speedLines === 'function') fx.speedLines(this.flat, this.power, 260);
      else if (fx && fx.impacts && typeof fx.impacts.speed === 'function') fx.impacts.speed(this.flat, this.power);
    } catch (e) { /* a missing VFX hook must never break the pad */ }
  }

  update(t, dt, player) {
    this.time = t;
    if (player) this.__player = player;
    const age = t - this._fireAt;

    const pl = resolvePlayer(this.ctx, player || this.__player);
    if (pl && pl.pos && t - this._lastAuto > 0.45) {
      const dx = Math.abs(pl.pos.x - this.center.x), dz = Math.abs(pl.pos.z - this.center.z);
      if (dx < this.size.x * 0.62 && dz < this.size.z * 0.62
        && pl.pos.y > this.top - 0.3 && pl.pos.y < this.top + 2.2) {
        this._lastAuto = t;
        this._trigger(null);
      }
    }

    const flowSpeed = 2.6 + this.power * 0.22;
    const flow = ((t * flowSpeed) % this.chevSpacing + this.chevSpacing) % this.chevSpacing;
    const L = this.padLen;
    const boost = clamp(1 - age / 0.4, 0, 1);
    for (let i = 0; i < this.chevCount; i++) {
      let z = -L * 0.5 + i * this.chevSpacing + flow;
      z = ((z + L * 0.5) % L + L) % L - L * 0.5;
      const u = (z + L * 0.5) / L;
      _v.copy(this.flat).multiplyScalar(z).add(this.center);
      _v.y = this.top + 0.02;
      const sc = clamp(Math.sin(u * Math.PI) * 1.25, 0.12, 1.1) * (1 + boost * 0.35);
      _s.set(sc, sc, sc);
      _m.compose(_v, this.baseQuat, _s);
      this.chevMesh.setMatrixAt(i, _m);
      this.chevBack.setMatrixAt(i, _m);
    }
    this.chevMesh.instanceMatrix.needsUpdate = true;
    this.chevBack.instanceMatrix.needsUpdate = true;

    const pulse = 0.5 + 0.5 * Math.sin(t * 5.2);
    this.chevMat.opacity = 0.55 + 0.28 * pulse + boost * 0.4;
    this.lampMat.opacity = 0.32 + 0.18 * pulse + boost * 0.6;
    this.glow.material.opacity = 0.08 + 0.04 * pulse + boost * 0.40;
    this.collider.active = this.enabled;
  }

  reset(t) {
    this._fireAt = -99;
    this._lastAuto = -99;
    super.reset(t);
  }
}

/**
 * Horizontal boost strip. Chevrons flow in the boost direction; whoosh + motion lines on entry.
 * `{kind:'speedpad', p, s?, dir:[x,y,z], power?:m/s}` — `power` defaults to TUNE.speedRun (9).
 */
export function speedpad(def, ctx) { return new SpeedPadHazard(def, ctx); }

/* ======================================================================================
   WIND
   ====================================================================================== */

class WindHazard extends Hazard {
  constructor(def, ctx) {
    super(def, ctx, 'wind');
    const pal = palette(ctx);
    const q = qualityOf(ctx);

    this.center = v3(def.p, 0, 0, 0);
    this.size = sizeVec(def.s, 10, 8, 10);
    this.dir = dirVec(def.dir, 1, 0, 0);
    this.power = num(def.power, 16);                 // m/s^2 applied while inside
    this.accent = new THREE.Color(num(def.color, pal.safeEdge !== undefined ? pal.safeEdge : 0x9fdcff));

    this.box = new THREE.Box3(
      this.center.clone().sub(_v.copy(this.size).multiplyScalar(0.5)),
      this.center.clone().add(_v.copy(this.size).multiplyScalar(0.5)),
    );
    this.span = extentAlong(this.size, this.dir);

    this._buildStreaks(q);
    this._buildEdge();
    this.post = resolvePost(ctx);
    this._pushedTo = null;
    this._pushedAt = -1;
    this._lastInside = 0;
    this._near = new THREE.Vector3();

    // The volume is invisible, so it MUST be audible: 'wind' is a synthesised looping voice.
    // It is placed at the nearest point of the box to the listener, so it swells as you
    // approach and sits all around you once you are inside.
    this.windLoop = new HazLoop(this.ctx, 'wind', {
      gain: clamp(0.35 + Math.abs(this.power) * 0.018, 0.3, 0.95),
      ref: clamp(this.span * 0.35, 5, 18),
      max: clamp(Math.max(this.size.x, this.size.y, this.size.z) * 2.2 + 24, 40, 120),
    });
    this._loops.push(this.windLoop);

    // CONTRACT §9/§21: the influence is a non-solid Volume of kind 'wind' the collision layer
    // reports through `CollisionResult.wind`. NEVER a collider — wind must not become a wall.
    this.volume = makeVolume({
      center: this.center,
      half: _v.copy(this.size).multiplyScalar(0.5),
      kind: 'wind',
      ref: this,
      props: {
        dir: this.dir.clone(), dirArr: [this.dir.x, this.dir.y, this.dir.z],
        dx: this.dir.x, dy: this.dir.y, dz: this.dir.z,
        power: this.power, hazard: this,
        falloff: (p) => this.falloffAt(p),
      },
    });
    this.volumes.push(this.volume);

    const hz = this;
    /**
     * Legacy `fields` entry — a host that walks `hazard.fields` and calls
     * `field.apply(state, dt)` gets the same push, guarded against double application.
     */
    this.field = {
      type: 'wind',
      kind: 'wind',
      hazard: hz,
      volume: this.volume,
      box: this.box,
      dir: this.dir.clone(),
      power: this.power,
      contains(p) { return hz.box.containsPoint(p); },
      /** Acceleration at a point, with a soft edge so entering is a swell, not a slap. */
      forceAt(p, out) {
        const o = out || new THREE.Vector3();
        o.set(0, 0, 0);
        if (!hz.box.containsPoint(p)) return o;
        return o.copy(hz.dir).multiplyScalar(hz.power * hz.falloffAt(p));
      },
      /**
       * Integrate onto a {pos, vel} state. Returns the 0..1 strength applied. If the hazard
       * already pushed this exact target through Player.addWind() this frame, the strength is
       * reported but NOT applied again — belt and braces against a double force.
       */
      apply(state, dt) {
        if (!state || !state.pos || !state.vel || !hz.enabled) return 0;
        if (!hz.box.containsPoint(state.pos)) return 0;
        const k = hz.falloffAt(state.pos);
        if (state === hz._pushedTo && hz._pushedAt === hz.time) return k;
        state.vel.addScaledVector(hz.dir, hz.power * k * (dt || 0));
        return k;
      },
    };
    this.fields.push(this.field);
    this.reset(0);
  }

  /** 0..1 wind strength at a world point — full in the core, tapering at the volume walls. */
  falloffAt(p) {
    const hx = this.size.x * 0.5, hy = this.size.y * 0.5, hz2 = this.size.z * 0.5;
    const fx = clamp((1 - Math.abs(p.x - this.center.x) / hx) * 5, 0, 1);
    const fy = clamp((1 - Math.abs(p.y - this.center.y) / hy) * 5, 0, 1);
    const fz = clamp((1 - Math.abs(p.z - this.center.z) / hz2) * 5, 0, 1);
    return fx * fy * fz;
  }

  /** Convenience for anything that wants the vector without touching `volumes`/`fields`. */
  windAt(p, out) { return this.field.forceAt(p, out); }

  _buildStreaks(q) {
    const vol = this.size.x * this.size.y * this.size.z;
    const n = clamp(Math.round(vol * 0.09 * clamp(q.particles, 0.15, 1)), 12, 220);
    this.streakCount = n;

    // A stretched octahedron reads as a wind streak far better than a box does.
    const geo = new THREE.OctahedronGeometry(0.5, 0);
    geo.scale(0.055, 0.055, 1);
    this.streakMat = additiveMaterial(this.accent.getHex(), { cached: false, opacity: 0.55 });
    this.own(this.streakMat);
    this.streaks = new THREE.InstancedMesh(geo, this.streakMat, n);
    this.streaks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.streaks.frustumCulled = false;
    this.streaks.renderOrder = 5;
    this.add(this.streaks);

    // Lateral basis for scattering the streaks across the volume's cross-section.
    this.latA = Math.abs(this.dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    this.latA.sub(_v.copy(this.dir).multiplyScalar(this.latA.dot(this.dir)));
    if (this.latA.lengthSq() < 1e-8) this.latA.set(1, 0, 0);
    this.latA.normalize();
    this.latB = new THREE.Vector3().crossVectors(this.dir, this.latA).normalize();
    this.latAExt = extentAlong(this.size, this.latA) * 0.48;
    this.latBExt = extentAlong(this.size, this.latB) * 0.48;

    const rnd = hazRandom(this.def, 143);
    this.streakData = [];
    for (let i = 0; i < n; i++) {
      this.streakData.push({
        a: (rnd() * 2 - 1) * this.latAExt,
        b: (rnd() * 2 - 1) * this.latBExt,
        off: rnd(),
        speed: lerp(0.55, 1.5, rnd()),
        len: lerp(0.6, 2.4, rnd()),
        bright: lerp(0.35, 1, rnd()),
      });
    }
    this.streakQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.dir);
  }

  _buildEdge() {
    // A whisper of a frame so the boundary is discoverable without looking like a solid box.
    const w = this.size.x, h = this.size.y, d = this.size.z;
    const t = clamp(Math.min(w, h, d) * 0.012, 0.02, 0.07);
    const parts = [];
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) parts.push(slab(w, t, t, 0, sy * h * 0.5, sz * d * 0.5, t * 0.3, 0.34));
      for (const sx of [-1, 1]) parts.push(slab(t, t, d, sx * w * 0.5, sy * h * 0.5, 0, t * 0.3, 0.34));
    }
    const geo = mergeAll(parts);
    if (!geo) return;
    this.edgeMat = additiveMaterial(this.accent.getHex(), { cached: false, opacity: 0.10 });
    this.own(this.edgeMat);
    this.edge = new THREE.Mesh(geo, this.edgeMat);
    this.edge.position.copy(this.center);
    this.edge.renderOrder = 4;
    this.add(this.edge);
  }

  update(t, dt, player) {
    this.time = t;
    if (player) this.__player = player;
    const span = this.span;
    const base = _v3.copy(this.center).addScaledVector(this.dir, -span * 0.5);

    for (let i = 0; i < this.streakCount; i++) {
      const s = this.streakData[i];
      const u = (s.off + t * s.speed * 0.22) % 1;
      _v.copy(base)
        .addScaledVector(this.dir, u * span)
        .addScaledVector(this.latA, s.a)
        .addScaledVector(this.latB, s.b);
      const fade = Math.min(1, Math.min(u, 1 - u) * 7);
      _s.set(1, 1, s.len * (0.5 + fade * 0.8));
      _m.compose(_v, this.streakQuat, _s);
      this.streaks.setMatrixAt(i, _m);
      _c.setScalar(clamp(s.bright * fade, 0, 1));
      this.streaks.setColorAt(i, _c);
    }
    this.streaks.instanceMatrix.needsUpdate = true;
    if (this.streaks.instanceColor) this.streaks.instanceColor.needsUpdate = true;
    this.streakMat.opacity = 0.35 + 0.22 * (0.5 + 0.5 * Math.sin(t * 1.7));
    if (this.edgeMat) this.edgeMat.opacity = 0.07 + 0.05 * (0.5 + 0.5 * Math.sin(t * 1.1));

    this.volume.active = this.enabled;

    // The push itself. `Player.addWind()` is a per-frame acceleration the controller clears
    // every update, and Course.update() runs BEFORE Player.update(), so a value written here
    // is consumed in the same frame. Kept as a direct call because it is the cheapest path
    // that always works — the Volume in `volumes` is the contract path.
    const pl = resolvePlayer(this.ctx, player || this.__player);
    let inside = 0;
    if (pl && pl.pos && this.box.containsPoint(pl.pos)) inside = this.falloffAt(pl.pos);
    if (inside > 0 && this.enabled && pl && typeof pl.addWind === 'function') {
      const f = this.power * inside;
      pl.addWind(this.dir.x * f, this.dir.y * f, this.dir.z * f);
      this._pushedTo = pl;
      this._pushedAt = t;
    }

    // Audible bed: nearest point of the volume to the ear, louder once you are inside it.
    const ear = resolveListener(this.ctx);
    const earPos = (pl && pl.pos) || (ear && ear.position) || null;
    if (earPos) this.box.clampPoint(earPos, this._near); else this._near.copy(this.center);
    this.windLoop.update(t, this._near, 0.45 + inside * 0.55);

    // Screen-edge smear hook — optional; stays guarded.
    const post = this.post;
    if (post && inside !== this._lastInside) {
      this._lastInside = inside;
      try {
        if (typeof post.setWind === 'function') post.setWind(inside, this.dir);
        else if (typeof post.setSmear === 'function') post.setSmear(inside, this.dir);
      } catch (e) { /* optional hook */ }
    }
  }

  dispose() {
    const post = this.post;
    if (post && this._lastInside) {
      try {
        if (typeof post.setWind === 'function') post.setWind(0, this.dir);
        else if (typeof post.setSmear === 'function') post.setSmear(0, this.dir);
      } catch (e) { /* teardown must never throw */ }
    }
    super.dispose();
  }
}

/**
 * An invisible push volume with a visible tell.
 * `{kind:'wind', p, s, dir:[x,y,z], power:m/s²}`
 * Publishes a `Volume` of kind 'wind' in `hazard.volumes` (props `{dir, power}`) — the
 * controller reads `CollisionResult.wind`. Wind is deliberately NOT a collider.
 */
export function wind(def, ctx) { return new WindHazard(def, ctx); }
