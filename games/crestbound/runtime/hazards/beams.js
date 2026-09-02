// runtime/hazards/beams.js
// CRESTBOUND — `beam` (pulse beam a→b, cycle {on, off, warn, phase}) and `flame` (a jet from a
// vent, same cycle law).
//
// `beam` is the BeamHazard from ./lasers.js (the shared kit file) selected by `def.mode`:
//   'single' (default) a→b · 'grid' a→b rack of `count` beams spaced along `offset`
//   · 'sweep' beam of `len` from `p` swinging through `arc` about `axis` every `period`.
// The kill volume is an analytic CAPSULE per beam, armed ONLY while the cycle is 'on' — never
// during the warn pre-glow, so the telegraph is always survivable.
//
// `flame` is a vent that breathes fire along `dir` for `len` metres on the same cycle. The jet is
// a noise-driven additive shader on a tapered tube; the kill capsule tracks the visible jet
// length so a flame that is only half-way out only kills half-way out.
//
// DETERMINISM LAW (CONTRACT §21): every value is closed-form in the course clock `t`.

import * as THREE from 'three';
import { clamp, smoothstep } from '../core/util.js';
import {
  Hazard, BeamHazard, GLSL_NOISE, num, v3, dirVec, palette, hazMat, additiveMaterial,
  makeGlowSprite, bevelBox, mergeAll, makeKill, updateKillCapsule, hazSfx, hazBurst, hazAmbient,
  hazRandom, qualityOf, cycleState, makeCycleState, buildEmitterGeometry, resolvePost, glowTexture,
} from './lasers.js';
import { heatContribute, heatRelease } from './lava.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _box = new THREE.Box3();
const UPV = new THREE.Vector3(0, 1, 0);

/* ======================================================================================
   BEAM
   ====================================================================================== */

/**
 * `{kind:'beam', a, b, cycle:{on, off, warn, phase}, mode?:'single'|'grid'|'sweep', radius?,
 *   color?, count?, spacing?, offset?, stagger?, p?, len?, axis?, arc?, period?, phase?}`
 * cycle.on/off/warn/phase are SECONDS. Sweep `arc` is RADIANS, sweep `phase` is SECONDS.
 */
export function beam(def, ctx) {
  const mode = def && (def.mode === 'grid' || def.mode === 'sweep') ? def.mode : 'single';
  return new BeamHazard(def, ctx, mode);
}

/* ======================================================================================
   FLAME SHADER
   ====================================================================================== */

const FLAME_VERT = `
varying vec2 vUv;
varying vec3 vNrm;
varying vec3 vView;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNrm = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

// uv.y runs 0 at the vent to 1 at the tip. uReach (0..1) is how far the jet has emerged.
const FLAME_FRAG = `
uniform vec3 uHot;
uniform vec3 uCool;
uniform float uTime;
uniform float uReach;
uniform float uLen;
varying vec2 vUv;
varying vec3 vNrm;
varying vec3 vView;
${GLSL_NOISE}
void main() {
  if (uReach <= 0.003) discard;
  float y = vUv.y;
  if (y > uReach) discard;
  float rim = pow(clamp(abs(dot(normalize(vNrm), normalize(vView))), 0.0, 1.0), 0.55);
  vec2 p = vec2(vUv.x * 6.0, y * uLen * 0.9 - uTime * 7.5);
  float n = hzFbm(p);
  float n2 = hzNoise(vec2(vUv.x * 14.0 + uTime * 3.0, y * uLen * 2.2 - uTime * 13.0));
  float tip = 1.0 - smoothstep(uReach * 0.55, uReach, y);
  float tongues = smoothstep(0.30, 0.75, n + n2 * 0.35 + tip * 0.35);
  float body = rim * tongues * (0.55 + 0.45 * tip);
  float core = pow(rim, 3.5) * (1.0 - y * 0.6) * (0.7 + 0.3 * n2);
  vec3 col = mix(uCool, uHot, clamp(core * 1.6 + tip * 0.4, 0.0, 1.0)) * (1.2 + body);
  col += vec3(1.0, 0.95, 0.7) * core * 1.4;
  float a = clamp(body * 0.95 + core * 0.8, 0.0, 1.0) * smoothstep(0.0, 0.06, y);
  gl_FragColor = vec4(col, a);
}
`;

/* ======================================================================================
   FLAME HAZARD
   ====================================================================================== */

class FlameHazard extends Hazard {
  constructor(def, ctx) {
    super(def, ctx, 'flame');
    const pal = palette(ctx);
    const q = qualityOf(ctx);

    this.origin = v3(def.p, 0, 0, 0);
    this.dir = dirVec(def.dir, 0, 1, 0);
    this.len = clamp(num(def.len, 4.5), 0.6, 30);
    this.radius = clamp(num(def.radius, 0.55), 0.15, 3);
    this.cycle = def.cycle || { on: 1.4, off: 2.0, warn: 0.5, phase: 0 };
    this.cs = makeCycleState();
    this.hotColor = new THREE.Color(def.color !== undefined ? def.color : (pal.killGlow !== undefined ? pal.killGlow : 0xff8a2b));
    this.coolColor = new THREE.Color(pal.kill !== undefined ? pal.kill : 0xff3320).lerp(new THREE.Color(0x3a0800), 0.35);
    this.quat = new THREE.Quaternion().setFromUnitVectors(UPV, this.dir);
    this.post = resolvePost(ctx);
    this.heatPeak = clamp(this.len / 14, 0.15, 0.55);
    this.reach = 0;
    this._lastOn = null;
    this._lastWarn = null;

    this._buildVent();
    this._buildJet();
    this._buildEmbers(q);
    this._buildKill();
    this._buildAmbience(q);
    this.reset(0);
  }

  _buildVent() {
    // The vent is an emitter housing with a wider flared mouth, sunk so its plate sits at `p`.
    const S = clamp(this.radius / 0.32, 0.8, 3.2);
    const { housing, rotor } = buildEmitterGeometry(S, 0.8);
    const mouthParts = [housing];
    const flare = new THREE.CylinderGeometry(0.62 * S, 0.34 * S, 0.24 * S, 20, 1, true);
    flare.translate(0, 0.60 * S, 0);
    mouthParts.push(flare);
    const lip = new THREE.TorusGeometry(0.62 * S, 0.045 * S, 6, 24);
    lip.rotateX(Math.PI * 0.5);
    lip.translate(0, 0.72 * S, 0);
    mouthParts.push(lip);
    // soot ring on the plate
    const geo = mergeAll(mouthParts);
    geo.applyQuaternion(this.quat);
    geo.translate(this.origin.x, this.origin.y, this.origin.z);
    this.vent = new THREE.Mesh(geo, hazMat(this.ctx, 'metal'));
    this.vent.castShadow = true;
    this.vent.receiveShadow = true;
    this.add(this.vent);
    this.ventS = S;
    this.mouthOffset = 0.72 * S;

    if (rotor) {
      rotor.applyQuaternion(this.quat);
      this.rotor = new THREE.Mesh(rotor, hazMat(this.ctx, 'copper'));
      this.rotor.position.copy(this.origin);
      this.add(this.rotor);
    }

    // scorched halo on whatever the vent is mounted on
    const scorchGeo = new THREE.RingGeometry(0.66 * S, 1.35 * S, 28, 1);
    scorchGeo.rotateX(-Math.PI * 0.5);
    scorchGeo.applyQuaternion(this.quat);
    this.scorchMat = new THREE.MeshBasicMaterial({
      map: glowTexture(1.2), color: 0x120806, transparent: true, opacity: 0.75,
      depthWrite: false, fog: true, side: THREE.DoubleSide,
    });
    this.own(this.scorchMat);
    this.scorch = new THREE.Mesh(scorchGeo, this.scorchMat);
    this.scorch.position.copy(this.origin).addScaledVector(this.dir, -0.60 * S + 0.012);
    this.scorch.renderOrder = 2;
    this.add(this.scorch);

    // pilot light: a small glow that lives in the mouth so an idle vent is readable as one
    this.pilot = makeGlowSprite(this.hotColor.getHex(), this.radius * 1.4, 0.25, 2.6);
    this.own(this.pilot.material);
    this.pilot.position.copy(this.origin).addScaledVector(this.dir, this.mouthOffset);
    this.add(this.pilot);
  }

  _buildJet() {
    const L = this.len;
    const seg = clamp(Math.round(L * 2), 4, 40);
    // Tapered tube: wider than the vent at 40 % then narrowing to a tongue.
    const geo = new THREE.CylinderGeometry(this.radius * 0.35, this.radius * 0.9, L, 18, seg, true);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / L + 0.5;               // 0 at vent .. 1 at tip
      const bulge = 1 + 0.55 * Math.sin(y * Math.PI) - 0.25 * y;
      pos.setX(i, pos.getX(i) * bulge);
      pos.setZ(i, pos.getZ(i) * bulge);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.translate(0, L * 0.5, 0);
    // flip uv.y so 0 is at the vent
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    uv.needsUpdate = true;
    geo.applyQuaternion(this.quat);
    geo.translate(this.origin.x, this.origin.y, this.origin.z);
    this.jetUniforms = {
      uHot: { value: this.hotColor.clone().lerp(new THREE.Color(0xffffff), 0.2) },
      uCool: { value: this.coolColor.clone() },
      uTime: { value: 0 },
      uReach: { value: 0 },
      uLen: { value: L },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.jetUniforms, vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false, fog: false,
    });
    this.own(mat);
    this.jet = new THREE.Mesh(geo, mat);
    this.jet.renderOrder = 6;
    this.jet.frustumCulled = false;
    this.jet.visible = false;
    this.add(this.jet);

    // mouth flash: swells on ignition
    this.flash = makeGlowSprite(this.hotColor.getHex(), this.radius * 3.2, 0, 2.2);
    this.own(this.flash.material);
    this.flash.position.copy(this.origin).addScaledVector(this.dir, this.mouthOffset + this.radius * 0.5);
    this.flash.renderOrder = 7;
    this.add(this.flash);
  }

  _buildEmbers(q) {
    // A handful of instanced ember flakes riding the jet, pure in t.
    const n = clamp(Math.round(this.len * 3 * clamp(q.particles, 0.2, 1)), 4, 36);
    this.emberCount = n;
    const g = new THREE.OctahedronGeometry(0.06, 0);
    this.emberMat = additiveMaterial(this.hotColor.getHex(), { cached: false, opacity: 0.9 });
    this.own(this.emberMat);
    this.embers = new THREE.InstancedMesh(g, this.emberMat, n);
    this.embers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.embers.frustumCulled = false;
    this.embers.renderOrder = 7;
    this.add(this.embers);
    const rnd = hazRandom(this.def, 313);
    this.emberData = [];
    this.latA = Math.abs(this.dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    this.latA.sub(_v.copy(this.dir).multiplyScalar(this.latA.dot(this.dir))).normalize();
    this.latB = new THREE.Vector3().crossVectors(this.dir, this.latA).normalize();
    for (let i = 0; i < n; i++) {
      this.emberData.push({
        off: rnd(), speed: 0.9 + rnd() * 1.1, ang: rnd() * Math.PI * 2,
        rad: 0.15 + rnd() * 0.6, spin: 3 + rnd() * 6, scale: 0.6 + rnd() * 0.9,
      });
    }
  }

  _buildKill() {
    this.killA = this.origin.clone().addScaledVector(this.dir, this.mouthOffset);
    this.killB = this.killA.clone();
    this.kill = makeKill({ type: 'capsule', a: this.killA, b: this.killB, radius: this.radius * 0.75, kind: 'lava', ref: this, active: false });
    this.kill.active = false;
    this.kills.push(this.kill);
  }

  _buildAmbience(q) {
    _v.copy(this.origin).addScaledVector(this.dir, this.len * 0.5);
    const r = this.radius + this.len * 0.25;
    _box.min.set(_v.x - r, _v.y - r, _v.z - r);
    _box.max.set(_v.x + r, _v.y + r, _v.z + r);
    const h = hazAmbient(this.ctx, 'ember', _box.clone(), clamp(this.len * 0.8 * clamp(q.particles, 0.15, 1), 1, 14), { color: this.hotColor.getHex() });
    if (h) { this._ambients.push(h); this.ambientHandle = h.handle; }
  }

  /** 0..1 fraction of `len` the jet reaches at course time `t` — pure. */
  reachAt(t) {
    const cs = cycleState(t, this.cycle, this.cs);
    if (cs.state === 'on') {
      const rise = Math.min(0.14, cs.on * 0.3);
      const fall = Math.min(0.22, cs.on * 0.3);
      const left = cs.on - cs.sinceOn;
      if (cs.sinceOn < rise) return smoothstep(0, 1, cs.sinceOn / rise);
      if (left < fall) return smoothstep(0, 1, left / fall);
      return 1;
    }
    return 0;
  }

  update(t, dt) {
    this.time = t;
    const cs = cycleState(t, this.cycle, this.cs);
    const reach = this.reachAt(t);
    this.reach = reach;
    const warn = cs.state === 'warn' ? cs.k : 0;

    // jet + flash
    const gutter = 0.93 + 0.07 * Math.sin(t * 43.0) * Math.sin(t * 17.3);
    this.jetUniforms.uTime.value = t;
    this.jetUniforms.uReach.value = reach * gutter;
    this.jet.visible = reach > 0.003;
    const sinceOn = cs.state === 'on' ? cs.sinceOn : 99;
    this.flash.material.opacity = clamp(1 - sinceOn / 0.22, 0, 1) * 0.9 + reach * 0.18;
    this.flash.scale.setScalar(this.radius * (2.4 + reach * 1.6 + clamp(1 - sinceOn / 0.22, 0, 1) * 2.2));

    // pilot: breathes while idle, flickers hard during warn (the "about to breathe" tell)
    const flick = warn > 0 ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * (14 + 30 * warn))) : 0.55 + 0.45 * Math.sin(t * 2.4);
    this.pilot.material.opacity = clamp(0.12 + flick * (0.22 + warn * 0.6) + reach * 0.5, 0, 1);
    this.pilot.scale.setScalar(this.radius * (1.2 + warn * 1.2 + reach * 0.8));
    if (this.rotor) this.rotor.setRotationFromAxisAngle(this.dir, t * (3 + reach * 18 + warn * 9));

    // embers ride the visible jet
    const L = this.len * reach;
    for (let i = 0; i < this.emberCount; i++) {
      const e = this.emberData[i];
      const u = (e.off + t * e.speed * 0.5) % 1;
      if (L < 0.05 || u * this.len > L) { _m.makeScale(0, 0, 0); this.embers.setMatrixAt(i, _m); continue; }
      const a = e.ang + t * e.spin;
      const spread = e.rad * (0.4 + u * 1.4) * this.radius;
      _v.copy(this.origin).addScaledVector(this.dir, this.mouthOffset + u * this.len)
        .addScaledVector(this.latA, Math.cos(a) * spread)
        .addScaledVector(this.latB, Math.sin(a) * spread);
      const sc = e.scale * (1 - u * 0.6) * this.radius * 1.2;
      _s.setScalar(sc);
      _q.setFromAxisAngle(this.latA, a);
      _m.compose(_v, _q, _s);
      this.embers.setMatrixAt(i, _m);
    }
    this.embers.instanceMatrix.needsUpdate = true;
    this.emberMat.opacity = 0.5 + 0.5 * reach;
    if (this.ambientHandle && this.ambientHandle.enabled !== undefined) this.ambientHandle.enabled = reach > 0.3;

    // kill capsule tracks the visible tongue; only arms once the jet is genuinely out
    _v.copy(this.origin).addScaledVector(this.dir, this.mouthOffset);
    _v2.copy(_v).addScaledVector(this.dir, Math.max(0.05, this.len * reach - this.radius * 0.4));
    updateKillCapsule(this.kill, _v, _v2, this.radius * 0.75);
    this.kill.active = this.enabled && reach > 0.22;

    // heat shimmer shares the lava aggregator
    heatContribute(this.post, this, this.heatPeak * reach);

    // one-shots on the cycle edges
    if (this.edge(this, '_lastWarn', cs.state === 'warn' ? cs.index : -1 - cs.index) && cs.state === 'warn') {
      hazSfx(this.ctx, 'vanish_warn', { gain: 0.45, rate: 0.7, pos: this.pilot.position, ref: 8, max: 40 });
    }
    if (this.edge(this, '_lastOn', cs.state === 'on' ? cs.index : -1 - cs.index) && cs.state === 'on') {
      hazSfx(this.ctx, 'wind', { gain: clamp(0.4 + this.len * 0.05, 0.4, 0.95), rate: 1.35, pos: this.pilot.position, ref: 9, max: 48 });
      hazSfx(this.ctx, 'lava_bubble', { gain: 0.5, rate: 0.75, pos: this.pilot.position, ref: 9, max: 40 });
      hazBurst(this.ctx, 'lavaPop', this.flash.position, { count: 14, speed: 4 + this.len * 0.4, color: this.hotColor.getHex(), dir: this.dir });
    }
  }

  dispose() {
    heatRelease(this);
    super.dispose();
  }
}

/**
 * A vent that breathes fire.
 * `{kind:'flame', p, dir?:[x,y,z], len?, radius?, cycle:{on, off, warn, phase}, color?}`
 * cycle values are SECONDS. The kill capsule follows the visible jet and arms at 22 % reach.
 */
export function flame(def, ctx) { return new FlameHazard(def, ctx); }
