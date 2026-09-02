// runtime/hazards/fluids.js
// CRESTBOUND — the three "the ground is not solid" hazards (CONTRACT §21):
//
//   current   — a Volume of kind 'current' that pushes whatever is inside it along `dir` at
//               `power`. Swimming through TIDEWELL TEMPLE and gliding through PRISM RIDE are
//               both this object; it is never a collider, so it can never become a wall.
//   quicksand — a Volume of kind 'quicksand' plus a real sand surface that RIPPLES: concentric
//               rings bloom out from wherever the hero is standing, so the sink is announced by
//               the ground itself a beat before the controller starts pulling him down.
//   sandboard — a long steep chute from `a` to `b`: rotated 'sand' colliders carrying
//               `props.board = true` (low friction, a speed FLOOR so you never stall halfway
//               down), berm walls that keep you in, and a spray plume that sells the speed.
//
// DETERMINISM (CONTRACT §21): every ripple, mote and plume here is a closed-form function of the
// course clock `t` (and, for the quicksand ripple centre, of the hero's live position, which is
// read but never integrated). `reset(t)` is `update(t, 0)`.

import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/util.js';
import { TUNE } from '../core/tuning.js';
import {
  Hazard, GLSL_NOISE, num, v3, sizeVec, dirVec, palette, hazMat, additiveMaterial,
  makeGlowSprite, bevelBox, mergeAll, makeCollider, makeVolume, hazSfx, hazBurst,
  hazAmbient, hazRandom, qualityOf, resolvePlayer, resolveListener, HazLoop,
} from './lasers.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _box = new THREE.Box3();
const UPV = new THREE.Vector3(0, 1, 0);

/** A chamfered slab pre-translated into local space. */
function slab(w, h, d, x, y, z, bevel = 0.02, detail = 1) {
  const g = bevelBox(Math.max(0.02, w), Math.max(0.02, h), Math.max(0.02, d), bevel, 1.7, detail);
  g.translate(x, y, z);
  return g;
}

/** Extent of an axis-aligned full-size box measured along an arbitrary unit axis. */
function extentAlong(size, axis) {
  return Math.abs(axis.x) * size.x + Math.abs(axis.y) * size.y + Math.abs(axis.z) * size.z;
}

/* ======================================================================================
   CURRENT
   ====================================================================================== */

// `fog: true` on the material makes three write fogColor/fogNear/fogFar (or fogDensity)
// into the uniform block EVERY frame — with no fog uniforms present it threw
// "Cannot read properties of undefined (reading 'value')" out of refreshFogUniforms and
// killed the frame. Declaring fog therefore means SHIPPING the fog chunks, both stages.
const FLOW_VERT = `
#include <common>
#include <fog_pars_vertex>
varying vec3 vLocal;
varying vec3 vNrm;
varying vec3 vView;
void main() {
  vLocal = position;
  // MUST be named 'mvPosition': three's <fog_vertex> chunk reads it by name.
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vNrm = normalize(normalMatrix * normal);
  vView = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

// Local +Z runs along the flow. Banded scroll + fresnel shell: reads as MOVING WATER seen from
// outside, and stays legible from inside (which is where the player spends the whole trip).
const FLOW_FRAG = `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor;
uniform vec3 uHot;
uniform float uTime;
uniform float uSpeed;
uniform float uLen;
varying vec3 vLocal;
varying vec3 vNrm;
varying vec3 vView;
${GLSL_NOISE}
void main() {
  float s = vLocal.z / max(0.001, uLen) + 0.5;
  float scroll = s * 5.0 - uTime * uSpeed * 0.34;
  float band = smoothstep(0.55, 1.0, fract(scroll));
  float fine = smoothstep(0.72, 1.0, fract(scroll * 3.7 + hzNoise(vLocal.xy * 0.9) * 0.6));
  float grain = hzFbm(vec2(vLocal.x * 0.7 + uTime * 0.15, s * 4.0 - uTime * 0.5));
  float fres = pow(1.0 - clamp(abs(dot(normalize(vNrm), normalize(vView))), 0.0, 1.0), 1.5);
  float body = 0.10 + band * 0.55 + fine * 0.42 + grain * 0.18 + fres * 0.65;
  vec3 col = mix(uColor, uHot, clamp(band * 0.7 + fine, 0.0, 1.0));
  gl_FragColor = vec4(col * body * 1.35, clamp(body * 0.72, 0.0, 0.85));
  #include <fog_fragment>
}
`;

class CurrentHazard extends Hazard {
  constructor(def, ctx) {
    super(def, ctx, 'current');
    const pal = palette(ctx);
    const q = qualityOf(ctx);

    this.center = v3(def.p, 0, 0, 0);
    this.size = sizeVec(def.s, 6, 4, 14);
    this.dir = dirVec(def.dir, 0, 0, -1);
    this.power = clamp(num(def.power, 9), 0.2, 40);      // m/s the flow carries you at

    this.color = new THREE.Color(def.color !== undefined ? def.color
      : (pal.water !== undefined ? pal.water : 0x3aa7d8));
    this.hotColor = new THREE.Color(pal.safeEdge !== undefined ? pal.safeEdge : 0x9fe8ff);

    this.span = Math.max(0.5, extentAlong(this.size, this.dir));
    this.box = new THREE.Box3(
      this.center.clone().sub(_v.copy(this.size).multiplyScalar(0.5)),
      this.center.clone().add(_v.copy(this.size).multiplyScalar(0.5)),
    );

    // Lateral basis for the tube cross-section and the mote scatter.
    this.latA = Math.abs(this.dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    this.latA.sub(_v.copy(this.dir).multiplyScalar(this.latA.dot(this.dir)));
    if (this.latA.lengthSq() < 1e-8) this.latA.set(1, 0, 0);
    this.latA.normalize();
    this.latB = new THREE.Vector3().crossVectors(this.dir, this.latA).normalize();
    this.extA = extentAlong(this.size, this.latA) * 0.5;
    this.extB = extentAlong(this.size, this.latB) * 0.5;

    this._pushedAt = -1;
    this._lastInside = 0;
    this._near = new THREE.Vector3();

    this._buildTube();
    this._buildMotes(q);
    this._buildAmbience(q);
    this._buildVolume();
    this.reset(0);
  }

  _buildTube() {
    // A rounded rectangular shell along the flow. Authored in local space (Z = flow) then
    // oriented once — the shader reads `vLocal.z` so the scroll always runs downstream.
    _m.makeBasis(this.latA, this.latB, this.dir);
    this.orientQuat = new THREE.Quaternion().setFromRotationMatrix(_m);

    const geo = new THREE.CylinderGeometry(1, 1, 1, 22, 1, true);
    geo.rotateX(Math.PI * 0.5);              // long axis -> +Z
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      // squash the circular section into the authored cross-section
      pos.setX(i, pos.getX(i) * this.extA * 0.96);
      pos.setY(i, pos.getY(i) * this.extB * 0.96);
      pos.setZ(i, pos.getZ(i) * this.span);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    // UniformsLib.fog first: the shader declares the fog chunks, so the renderer WILL
    // write fogColor/fogNear/fogFar here every frame and they must exist.
    this.flowUniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]);
    this.flowUniforms.uColor = { value: this.color.clone() };
    this.flowUniforms.uHot = { value: this.hotColor.clone() };
    this.flowUniforms.uTime = { value: 0 };
    this.flowUniforms.uSpeed = { value: this.power };
    this.flowUniforms.uLen = { value: this.span };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.flowUniforms, vertexShader: FLOW_VERT, fragmentShader: FLOW_FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false, fog: true,
    });
    this.own(mat);
    this.tube = new THREE.Mesh(geo, mat);
    this.tube.position.copy(this.center);
    this.tube.quaternion.copy(this.orientQuat);
    this.tube.renderOrder = 5;
    this.add(this.tube);

    // Intake and outfall rims: bright hoops that say WHERE the ride starts and ends.
    const rimParts = [];
    for (const s of [-1, 1]) {
      const ring = new THREE.TorusGeometry(Math.max(this.extA, this.extB) * 0.98, Math.max(0.05, Math.min(this.extA, this.extB) * 0.07), 6, 34);
      ring.scale(this.extA / Math.max(this.extA, this.extB), this.extB / Math.max(this.extA, this.extB), 1);
      ring.translate(0, 0, s * this.span * 0.5);
      rimParts.push(ring);
    }
    // downstream chevrons on the tube wall
    for (let i = 0; i < 6; i++) {
      const u = (i + 0.5) / 6 - 0.5;
      for (const sa of [1, -1]) {
        const g = bevelBox(this.extA * 0.30, 0.05, this.extA * 0.10, 0.014, 1.7, 0.4);
        g.rotateY(sa > 0 ? 0.6 : -0.6);
        g.translate(sa * this.extA * 0.72, -this.extB * 0.78, u * this.span);
        rimParts.push(g);
      }
    }
    this.rimMat = additiveMaterial(this.hotColor.getHex(), { cached: false, opacity: 0.55, side: THREE.DoubleSide });
    this.own(this.rimMat);
    this.rim = new THREE.Mesh(mergeAll(rimParts), this.rimMat);
    this.rim.position.copy(this.center);
    this.rim.quaternion.copy(this.orientQuat);
    this.rim.renderOrder = 6;
    this.add(this.rim);

    this.glow = makeGlowSprite(this.hotColor.getHex(), Math.max(this.extA, this.extB) * 2.2, 0.12, 2.8);
    this.own(this.glow.material);
    this.glow.position.copy(this.center).addScaledVector(this.dir, this.span * 0.5);
    this.add(this.glow);
  }

  _buildMotes(q) {
    // Debris riding the flow at exactly `power`, so the eye can measure the speed before the
    // body commits to it.
    const n = clamp(Math.round(this.span * this.extA * this.extB * 0.55 * clamp(q.particles, 0.2, 1)), 14, 180);
    this.moteCount = n;
    const geo = new THREE.OctahedronGeometry(0.5, 0);
    geo.scale(0.07, 0.07, 0.22);
    this.moteMat = additiveMaterial(this.hotColor.getHex(), { cached: false, opacity: 0.6 });
    this.own(this.moteMat);
    this.motes = new THREE.InstancedMesh(geo, this.moteMat, n);
    this.motes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 6;
    this.add(this.motes);
    this.moteQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.dir);

    const rnd = hazRandom(this.def, 811);
    this.moteData = [];
    for (let i = 0; i < n; i++) {
      this.moteData.push({
        a: (rnd() * 2 - 1) * this.extA * 0.88,
        b: (rnd() * 2 - 1) * this.extB * 0.88,
        off: rnd(),
        speed: lerp(0.82, 1.18, rnd()),      // fraction of `power`
        scale: lerp(0.55, 1.5, rnd()),
      });
    }
  }

  _buildAmbience(q) {
    _box.copy(this.box);
    const h = hazAmbient(this.ctx, 'spray', _box.clone(),
      clamp(this.span * 0.8 * clamp(q.particles, 0.15, 1), 1, 18), { color: this.hotColor.getHex() });
    if (h) this._ambients.push(h);

    this.flowLoop = new HazLoop(this.ctx, 'water_flow', {
      gain: clamp(0.28 + this.power * 0.02, 0.25, 0.85),
      ref: clamp(this.span * 0.3, 5, 20),
      max: clamp(this.span * 2.2 + 30, 40, 140),
    });
    this._loops.push(this.flowLoop);
  }

  _buildVolume() {
    // CONTRACT §9/§21: kind 'current', props {dir, power}. Never a collider.
    this.volume = makeVolume({
      center: this.center,
      half: _v.copy(this.size).multiplyScalar(0.5),
      kind: 'current',
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
    // Legacy `fields` entry for a host that walks fields instead of volumes.
    this.field = {
      type: 'current', kind: 'current', hazard: hz, volume: this.volume, box: this.box,
      dir: this.dir.clone(), power: this.power,
      contains(p) { return hz.box.containsPoint(p); },
      forceAt(p, out) {
        const o = out || new THREE.Vector3();
        o.set(0, 0, 0);
        if (!hz.box.containsPoint(p)) return o;
        return o.copy(hz.dir).multiplyScalar(hz.power * hz.falloffAt(p));
      },
      apply(state, dt) {
        if (!state || !state.pos || !state.vel || !hz.enabled) return 0;
        if (!hz.box.containsPoint(state.pos)) return 0;
        const k = hz.falloffAt(state.pos);
        state.vel.addScaledVector(hz.dir, hz.power * k * (dt || 0));
        return k;
      },
    };
    this.fields.push(this.field);
  }

  /** 0..1 flow strength: full in the core, tapering at the tube wall so entry is a swell. */
  falloffAt(p) {
    _v.subVectors(p, this.center);
    const a = Math.abs(_v.dot(this.latA)) / Math.max(1e-4, this.extA);
    const b = Math.abs(_v.dot(this.latB)) / Math.max(1e-4, this.extB);
    const c = Math.abs(_v.dot(this.dir)) / Math.max(1e-4, this.span * 0.5);
    return clamp((1 - a) * 4, 0, 1) * clamp((1 - b) * 4, 0, 1) * clamp((1 - c) * 6, 0, 1);
  }

  /** The push at a world point. Allocation-free when handed an `out`. */
  currentAt(p, out) { return this.field.forceAt(p, out); }

  update(t, dt, player) {
    this.time = t;
    if (player) this.__player = player;
    this.flowUniforms.uTime.value = t;

    // Motes ride the tube at the real flow speed and wrap at the outfall.
    const base = _v3.copy(this.center).addScaledVector(this.dir, -this.span * 0.5);
    for (let i = 0; i < this.moteCount; i++) {
      const md = this.moteData[i];
      const u = (md.off + t * this.power * md.speed / this.span) % 1;
      _v.copy(base)
        .addScaledVector(this.dir, u * this.span)
        .addScaledVector(this.latA, md.a)
        .addScaledVector(this.latB, md.b);
      const fade = Math.min(1, Math.min(u, 1 - u) * 8);
      _s.set(md.scale, md.scale, md.scale * lerp(1, 2.4, clamp(this.power / 14, 0, 1)));
      _s.multiplyScalar(clamp(fade, 0.05, 1));
      _m.compose(_v, this.moteQuat, _s);
      this.motes.setMatrixAt(i, _m);
    }
    this.motes.instanceMatrix.needsUpdate = true;

    const breathe = 0.5 + 0.5 * Math.sin(t * 1.6);
    this.rimMat.opacity = 0.40 + 0.22 * breathe;
    this.moteMat.opacity = 0.42 + 0.22 * breathe;
    this.glow.material.opacity = 0.08 + 0.06 * breathe;
    this.volume.active = this.enabled;

    // Direct push, for a controller that reads a per-frame acceleration instead of the Volume.
    const pl = resolvePlayer(this.ctx, player || this.__player);
    let inside = 0;
    if (pl && pl.pos && this.box.containsPoint(pl.pos)) inside = this.falloffAt(pl.pos);
    if (inside > 0 && this.enabled && pl && typeof pl.addCurrent === 'function') {
      const f = this.power * inside;
      pl.addCurrent(this.dir.x * f, this.dir.y * f, this.dir.z * f);
      this._pushedAt = t;
    }
    this._lastInside = inside;

    const ear = resolveListener(this.ctx);
    const earPos = (pl && pl.pos) || (ear && ear.position) || null;
    if (earPos) this.box.clampPoint(earPos, this._near); else this._near.copy(this.center);
    this.flowLoop.update(t, this._near, 0.5 + inside * 0.5);
  }
}

/**
 * A flow volume that carries swimmers and flyers.
 * `{kind:'current', p, s, dir:[x,y,z]|'x'|'-z', power:m/s}`
 * Publishes a `Volume` of kind 'current' with `props {dir, power}` (CONTRACT §9) — never a
 * collider. `power` is the SPEED the flow carries you at, in m/s; the falloff tapers to zero at
 * the tube wall so entering is a swell rather than a slap.
 */
export function current(def, ctx) { return new CurrentHazard(def, ctx); }

/* ======================================================================================
   QUICKSAND
   ====================================================================================== */

class QuicksandHazard extends Hazard {
  constructor(def, ctx) {
    super(def, ctx, 'quicksand');
    const pal = palette(ctx);
    const q = qualityOf(ctx);

    this.center = v3(def.p, 0, 0, 0);
    this.size = sizeVec(def.s, 8, 3, 8);
    this.halfX = this.size.x * 0.5;
    this.halfZ = this.size.z * 0.5;
    this.surfaceY = this.center.y + this.size.y * 0.5;
    this.sink = Math.max(0.05, num(def.sink, 1.1));                 // m/s the controller pulls
    this.escapeJumpV = Math.max(0, num(def.escapeJumpV, TUNE.swim.surfaceJumpV * 0.8));

    this.sandColor = new THREE.Color(def.color !== undefined ? def.color : 0xd8c49a);
    this.warnColor = new THREE.Color(pal.kill !== undefined ? pal.kill : 0xff5a3c);

    /** Where the ripples bloom from: the hero when he is in it, else the pool centre. */
    this.rippleCentre = new THREE.Vector3(this.center.x, this.surfaceY, this.center.z);
    this._inside = 0;
    this._lastGulp = -99;

    this._buildSurface(q);
    this._buildRim();
    this._buildVolume();
    this._buildAmbience(q);
    this.reset(0);
  }

  _buildSurface(q) {
    // The sand surface is the shared Mats 'sand' PBR bake CLONED once (shared registry
    // materials must never be mutated) and patched with a ripple displacement: two travelling
    // dune waves plus a concentric ring set that blooms from `uRipple`. That ring set is the
    // whole readability idea — the ground TELLS you it has you before the controller does.
    const base = hazMat(this.ctx, 'sand');
    const mat = base.clone();
    this.own(mat);
    mat.roughness = clamp(num(mat.roughness, 0.95), 0.7, 1);
    mat.metalness = 0.0;
    mat.side = THREE.DoubleSide;

    this.sandUniforms = {
      uQsTime: { value: 0 },
      uQsAmp: { value: clamp(Math.min(this.size.x, this.size.z) * 0.012, 0.03, 0.14) },
      uQsRipple: { value: new THREE.Vector2(0, 0) },
      uQsPull: { value: 0 },
      uQsHalf: { value: new THREE.Vector2(this.halfX, this.halfZ) },
      uQsWarn: { value: this.warnColor.clone() },
    };
    const U = this.sandUniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', [
          '#include <common>',
          'uniform float uQsTime;',
          'uniform float uQsAmp;',
          'uniform vec2  uQsRipple;',
          'uniform float uQsPull;',
          'uniform vec2  uQsHalf;',
          'varying float vQsRing;',
          'varying float vQsEdge;',
          'float qsField(vec2 p, float tt) {',
          '  float dune = sin(p.x * 0.62 + tt * 0.55) * 0.55 + sin(p.y * 0.47 - tt * 0.41) * 0.45;',
          '  float d = length(p - uQsRipple);',
          '  float ring = sin(d * 3.4 - tt * 4.6) * exp(-d * 0.34) * (0.35 + uQsPull * 1.5);',
          '  return dune * 0.5 + ring;',
          '}',
        ].join('\n'))
        .replace('#include <begin_vertex>', [
          '#include <begin_vertex>',
          'float qsW = qsField(position.xz, uQsTime);',
          'transformed.y += qsW * uQsAmp;',
          'vQsRing = clamp(qsW * 0.6 + 0.5, 0.0, 1.0);',
          'vec2 qsE = abs(position.xz) / max(uQsHalf, vec2(0.001));',
          'vQsEdge = clamp((1.0 - max(qsE.x, qsE.y)) * 6.0, 0.0, 1.0);',
        ].join('\n'))
        .replace('#include <beginnormal_vertex>', [
          '#include <beginnormal_vertex>',
          'float qsE0 = qsField(position.xz, uQsTime);',
          'float qsEx = qsField(position.xz + vec2(0.35, 0.0), uQsTime);',
          'float qsEz = qsField(position.xz + vec2(0.0, 0.35), uQsTime);',
          'objectNormal = normalize(vec3(-(qsEx - qsE0) * uQsAmp / 0.35, 1.0, -(qsEz - qsE0) * uQsAmp / 0.35));',
        ].join('\n'));
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', [
          '#include <common>',
          'uniform float uQsPull;',
          'uniform vec3  uQsWarn;',
          'varying float vQsRing;',
          'varying float vQsEdge;',
        ].join('\n'))
        .replace('#include <color_fragment>', [
          '#include <color_fragment>',
          'float qsTrough = 1.0 - vQsRing;',
          'diffuseColor.rgb *= mix(0.62, 1.12, vQsRing);',
          'diffuseColor.rgb = mix(diffuseColor.rgb, uQsWarn, clamp(qsTrough * uQsPull * 0.55, 0.0, 0.55));',
          'diffuseColor.rgb *= mix(0.55, 1.0, vQsEdge);',
        ].join('\n'));
    };
    mat.customProgramCacheKey = () => 'crestbound-quicksand-surface';
    mat.needsUpdate = true;
    this.sandMat = mat;

    const density = lerp(0.6, 1.15, clamp(q.decor, 0, 1));
    const segX = clamp(Math.round(this.size.x * density), 8, 96);
    const segZ = clamp(Math.round(this.size.z * density), 8, 96);
    const geo = new THREE.PlaneGeometry(this.size.x, this.size.z, segX, segZ);
    geo.rotateX(-Math.PI * 0.5);
    this.surface = new THREE.Mesh(geo, mat);
    this.surface.receiveShadow = true;
    this.surface.castShadow = false;
    this.surface.position.set(this.center.x, this.surfaceY, this.center.z);
    this.add(this.surface);
  }

  _buildRim() {
    // A crusted lip of dry sand and half-buried stones so the pool has a discoverable edge —
    // the whole point of quicksand is that it is a trap you can SEE and choose to skirt.
    const parts = [];
    const w = clamp(Math.min(this.size.x, this.size.z) * 0.06, 0.14, 0.6);
    parts.push(slab(this.size.x + w, w * 0.55, w, 0, -0.02, this.halfZ, 0.03));
    parts.push(slab(this.size.x + w, w * 0.55, w, 0, -0.02, -this.halfZ, 0.03));
    parts.push(slab(w, w * 0.55, this.size.z - w, this.halfX, -0.02, 0, 0.03));
    parts.push(slab(w, w * 0.55, this.size.z - w, -this.halfX, -0.02, 0, 0.03));
    const rnd = hazRandom(this.def, 277);
    const nStone = clamp(Math.round((this.size.x + this.size.z) * 0.5), 6, 26);
    for (let i = 0; i < nStone; i++) {
      const edge = Math.floor(rnd() * 4);
      const along = rnd() * 2 - 1;
      const x = edge < 2 ? along * this.halfX : (edge === 2 ? this.halfX : -this.halfX);
      const z = edge < 2 ? (edge === 0 ? this.halfZ : -this.halfZ) : along * this.halfZ;
      const g = new THREE.DodecahedronGeometry(lerp(0.14, 0.36, rnd()), 0);
      g.scale(1, lerp(0.45, 0.8, rnd()), 1);
      g.rotateY(rnd() * Math.PI * 2);
      g.translate(x + (rnd() - 0.5) * w, -0.06, z + (rnd() - 0.5) * w);
      parts.push(g);
    }
    this.rim = new THREE.Mesh(mergeAll(parts), hazMat(this.ctx, 'stone'));
    this.rim.castShadow = true;
    this.rim.receiveShadow = true;
    this.rim.position.set(this.center.x, this.surfaceY, this.center.z);
    this.add(this.rim);

    // Warning haze right above the surface: dim, but unmistakable once you are in it.
    this.haze = makeGlowSprite(this.warnColor.getHex(), Math.min(this.size.x, this.size.z) * 0.8, 0, 3.2);
    this.own(this.haze.material);
    this.haze.position.set(this.center.x, this.surfaceY + 0.5, this.center.z);
    this.haze.renderOrder = 6;
    this.add(this.haze);
  }

  _buildVolume() {
    this.volume = makeVolume({
      center: this.center,
      half: _v.copy(this.size).multiplyScalar(0.5),
      kind: 'quicksand',
      ref: this,
      props: {
        sink: this.sink, escapeJumpV: this.escapeJumpV,
        surfaceY: this.surfaceY, hazard: this,
        stepSfx: 'step_sand', stepRate: 0.6,
      },
    });
    this.volumes.push(this.volume);
  }

  _buildAmbience(q) {
    _box.min.set(this.center.x - this.halfX, this.surfaceY - 0.2, this.center.z - this.halfZ);
    _box.max.set(this.center.x + this.halfX, this.surfaceY + 2.2, this.center.z + this.halfZ);
    const h = hazAmbient(this.ctx, 'sandDust', _box.clone(),
      clamp(this.size.x * this.size.z * 0.012 * clamp(q.particles, 0.15, 1), 1, 16),
      { color: this.sandColor.getHex() });
    if (h) this._ambients.push(h);
  }

  /** 0..1 how deep into the trap a point is (1 = dead centre, 0 = outside). */
  gripAt(p) {
    if (!p) return 0;
    if (p.y > this.surfaceY + 0.5 || p.y < this.center.y - this.size.y * 0.6) return 0;
    const gx = clamp((1 - Math.abs(p.x - this.center.x) / this.halfX) * 3.5, 0, 1);
    const gz = clamp((1 - Math.abs(p.z - this.center.z) / this.halfZ) * 3.5, 0, 1);
    return gx * gz;
  }

  update(t, dt, player) {
    this.time = t;
    if (player) this.__player = player;

    const pl = resolvePlayer(this.ctx, player || this.__player);
    const grip = pl && pl.pos ? this.gripAt(pl.pos) : 0;
    this._inside = grip;

    // The ripple centre chases the hero while he is in it, and eases back to the middle when
    // he is not — so the rings always bloom from the thing that disturbed the sand.
    if (grip > 0.02 && pl && pl.pos) {
      this.rippleCentre.x = lerp(this.rippleCentre.x, pl.pos.x, clamp((dt || 0) * 9, 0, 1));
      this.rippleCentre.z = lerp(this.rippleCentre.z, pl.pos.z, clamp((dt || 0) * 9, 0, 1));
    } else {
      this.rippleCentre.x = lerp(this.rippleCentre.x, this.center.x, clamp((dt || 0) * 1.4, 0, 1));
      this.rippleCentre.z = lerp(this.rippleCentre.z, this.center.z, clamp((dt || 0) * 1.4, 0, 1));
    }

    this.sandUniforms.uQsTime.value = t;
    this.sandUniforms.uQsRipple.value.set(
      this.rippleCentre.x - this.center.x,
      this.rippleCentre.z - this.center.z,
    );
    this.sandUniforms.uQsPull.value = grip;

    this.haze.material.opacity = grip * 0.22 + 0.02 * (0.5 + 0.5 * Math.sin(t * 1.3));
    this.haze.scale.setScalar(Math.min(this.size.x, this.size.z) * (0.7 + grip * 0.35));
    this.volume.active = this.enabled;

    if (this._silent) return;
    // A slow gulp while the hero is genuinely sinking — the audio cue that says "get out".
    if (grip > 0.25 && t - this._lastGulp > lerp(1.5, 0.55, grip)) {
      this._lastGulp = t;
      _v.set(this.rippleCentre.x, this.surfaceY, this.rippleCentre.z);
      hazSfx(this.ctx, 'step_sand', { gain: clamp(0.22 + grip * 0.35, 0.2, 0.6), rate: lerp(0.55, 0.36, grip), pos: _v, ref: 8, max: 34 });
      hazBurst(this.ctx, 'sandPuff', _v, { count: Math.round(6 + grip * 10), speed: 1.6 + grip * 1.6, color: this.sandColor.getHex() });
    }
  }

  reset(t) {
    this.rippleCentre.set(this.center.x, this.surfaceY, this.center.z);
    this._lastGulp = -99;
    this._inside = 0;
    super.reset(t);
  }
}

/**
 * A pool of sand that swallows you.
 * `{kind:'quicksand', p:[centre], s:[FULL size], sink?:m/s, escapeJumpV?:m/s, color?}`
 * Publishes a `Volume` of kind 'quicksand' with `props {sink, escapeJumpV, surfaceY}`
 * (CONTRACT §9) — the controller reads `CollisionResult.inQuicksand` / `.quicksand`. `s.y` is
 * how DEEP the pool is; the visible surface sits on its top face.
 */
export function quicksand(def, ctx) { return new QuicksandHazard(def, ctx); }

/* ======================================================================================
   SANDBOARD
   ====================================================================================== */

class SandboardHazard extends Hazard {
  constructor(def, ctx) {
    super(def, ctx, 'sandboard');
    const pal = palette(ctx);
    const q = qualityOf(ctx);

    // The chute runs from `a` (top) to `b` (bottom); `pts` authors a multi-segment run.
    const pts = Array.isArray(def.pts) && def.pts.length >= 2 ? def.pts : [def.a, def.b];
    this.points = [];
    for (let i = 0; i < pts.length; i++) this.points.push(v3(pts[i], 0, 0, 0).clone());
    if (this.points.length < 2) this.points = [new THREE.Vector3(), new THREE.Vector3(0, -8, -20)];

    this.width = clamp(num(def.w, 6), 1.2, 40);
    this.deckH = clamp(num(def.h, 0.6), 0.15, 2.5);
    /** Speed FLOOR: the board never lets you stall halfway down the dune. */
    this.minSpeed = clamp(num(def.minSpeed, TUNE.speedRun * 0.85), 1, TUNE.slope.maxSpeed);
    /** Sliding friction — well under the run's normal deceleration, close to ice. */
    this.friction = clamp(num(def.friction, TUNE.ice.friction * 0.8), 0.05, 8);
    this.bermH = clamp(num(def.berm, this.width * 0.16), 0, 4);

    this.sandColor = new THREE.Color(0xd8c49a);
    this.accent = new THREE.Color(pal.safeEdge !== undefined ? pal.safeEdge : 0x9fe8ff);

    this.segments = [];
    this.totalLen = 0;
    this._buildRun(q);
    this._buildSpray(q);
    this.reset(0);
  }

  _buildRun(q) {
    const deckParts = [];
    const bermParts = [];
    const stripes = [];
    const markerParts = [];

    for (let i = 0; i < this.points.length - 1; i++) {
      const a = this.points[i], b = this.points[i + 1];
      _v.subVectors(b, a);
      const len = _v.length();
      if (len < 0.05) continue;
      const fwd = _v.clone().multiplyScalar(1 / len);
      // Right-handed deck frame: X = side, Y = deck normal, Z = fwd.
      const side = new THREE.Vector3().crossVectors(UPV, fwd);
      if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
      side.normalize();
      const up = new THREE.Vector3().crossVectors(fwd, side).normalize();
      _m.makeBasis(side, up, fwd);
      const quat = new THREE.Quaternion().setFromRotationMatrix(_m);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const slopeDeg = Math.abs(Math.asin(clamp(-fwd.y, -1, 1))) * 180 / Math.PI;

      // One OBB per segment — a straight run gets ONE collider, so there is no seam to catch
      // a foot on at 16 m/s (CONTRACT §10 is seam-jitter-free, but a seam we never author is
      // a seam that can never bite).
      const col = makeCollider({
        center: mid,
        half: _v2.set(this.width * 0.5, this.deckH * 0.5, len * 0.5),
        quat,
        surface: 'sand',
        ref: this,
        group: 'hazard',
        props: {
          board: true, slick: 0.85,
          minSpeed: this.minSpeed, friction: this.friction,
          slopeDeg, stepSfx: 'step_sand', stepRate: 1.3,
        },
      });
      this.colliders.push(col);
      this.segments.push({ a: a.clone(), b: b.clone(), fwd, side, up, quat, mid, len, slopeDeg });
      this.totalLen += len;

      // ---- art (authored in the segment frame, then transformed into world) ----------------
      const local = [];
      const bermLocal = [];
      const stripeLocal = [];

      // deck with wind-carved corrugations across the run
      local.push(slab(this.width, this.deckH, len, 0, 0, 0, Math.min(0.08, this.deckH * 0.3)));
      const nRipple = clamp(Math.round(len / 1.1), 2, 40);
      for (let k = 0; k < nRipple; k++) {
        const u = (k + 0.5) / nRipple - 0.5;
        local.push(slab(this.width * 0.97, this.deckH * 0.10, len / nRipple * 0.42,
          0, this.deckH * 0.5 + this.deckH * 0.03, u * len, 0.012, 0.34));
      }

      // berms: banked walls that hold the line through the chute
      if (this.bermH > 0.05) {
        for (const s of [1, -1]) {
          bermLocal.push(slab(this.width * 0.16, this.bermH, len,
            s * (this.width * 0.5 - this.width * 0.06), this.bermH * 0.42, 0, 0.05));
        }
        // Berm colliders keep the run readable AND survivable — you ricochet, you do not fall.
        for (const s of [1, -1]) {
          _v3.copy(mid).addScaledVector(side, s * (this.width * 0.5 - this.width * 0.06))
            .addScaledVector(up, this.bermH * 0.42);
          this.colliders.push(makeCollider({
            center: _v3,
            half: _v2.set(this.width * 0.08, this.bermH * 0.5, len * 0.5),
            quat, surface: 'sand', ref: this, group: 'hazard',
            props: { board: true, berm: true, slick: 0.9, stepSfx: 'step_sand', stepRate: 1.0 },
          }));
        }
      }

      // leading-edge stripes down both sides of the deck (CONTRACT hard rule 2)
      const st = clamp(this.width * 0.022, 0.04, 0.14);
      // Inboard of the berms when there are berms, flush with the deck edge when there are not.
      const stripeX = this.bermH > 0.05 ? this.width * 0.5 - this.width * 0.14 : this.width * 0.5 - st;
      for (const s of [1, -1]) {
        stripeLocal.push(slab(st, 0.04, len * 0.985, s * stripeX, this.deckH * 0.5 + 0.016, 0, 0.008, 0.4));
      }
      // downhill chevrons so the fall line is unmistakable from the drop-in
      const nChev = clamp(Math.round(len / 3.2), 1, 14);
      for (let k = 0; k < nChev; k++) {
        const u = (k + 0.5) / nChev - 0.5;
        for (const s of [1, -1]) {
          const g = bevelBox(this.width * 0.13, 0.04, this.width * 0.05, 0.01, 1.7, 0.34);
          g.rotateY(s * 0.62);
          g.translate(s * this.width * 0.13, this.deckH * 0.5 + 0.02, u * len);
          stripeLocal.push(g);
        }
      }

      const place = (list, dst) => {
        for (const g of list) {
          g.applyQuaternion(quat);
          g.translate(mid.x, mid.y, mid.z);
          dst.push(g);
        }
      };
      place(local, deckParts);
      place(bermLocal, bermParts);
      place(stripeLocal, stripes);
    }

    // Marker posts every ~9 m along the run — depth cues for a slope with almost no texture.
    const rnd = hazRandom(this.def, 929);
    const nMark = clamp(Math.round(this.totalLen / 9), 2, 22);
    for (let i = 0; i < nMark; i++) {
      const u = (i + 0.5) / nMark;
      this.pointAt(u, _v, _v2, _v3);
      for (const s of [1, -1]) {
        const h = lerp(1.0, 1.7, rnd());
        const post = new THREE.CylinderGeometry(0.07, 0.09, h, 7);
        post.translate(0, h * 0.5, 0);
        post.rotateZ((rnd() - 0.5) * 0.16);
        post.translate(
          _v.x + _v3.x * s * (this.width * 0.5 + 0.45),
          _v.y + this.bermH * 0.2,
          _v.z + _v3.z * s * (this.width * 0.5 + 0.45),
        );
        markerParts.push(post);
      }
    }

    this.deck = new THREE.Mesh(mergeAll(deckParts), hazMat(this.ctx, 'sand'));
    this.deck.castShadow = false;
    this.deck.receiveShadow = true;
    this.add(this.deck);

    if (bermParts.length) {
      this.berms = new THREE.Mesh(mergeAll(bermParts), hazMat(this.ctx, 'sand'));
      this.berms.castShadow = true;
      this.berms.receiveShadow = true;
      this.add(this.berms);
    }
    if (markerParts.length) {
      this.markers = new THREE.Mesh(mergeAll(markerParts), hazMat(this.ctx, 'wood'));
      this.markers.castShadow = true;
      this.add(this.markers);
    }

    this.stripeMat = additiveMaterial(this.accent.getHex(), { cached: false, opacity: 0.6 });
    this.own(this.stripeMat);
    this.stripeMesh = new THREE.Mesh(mergeAll(stripes), this.stripeMat);
    this.stripeMesh.renderOrder = 5;
    this.add(this.stripeMesh);
  }

  /**
   * Point / forward / side at a 0..1 parameter along the whole run. Allocation-free.
   * @param {number} u 0 at the top, 1 at the bottom
   */
  pointAt(u, outP, outFwd, outSide) {
    const want = clamp(u, 0, 1) * this.totalLen;
    let acc = 0;
    for (let i = 0; i < this.segments.length; i++) {
      const sg = this.segments[i];
      if (want <= acc + sg.len || i === this.segments.length - 1) {
        const f = clamp((want - acc) / Math.max(1e-4, sg.len), 0, 1);
        outP.lerpVectors(sg.a, sg.b, f);
        if (outFwd) outFwd.copy(sg.fwd);
        if (outSide) outSide.copy(sg.side);
        return outP;
      }
      acc += sg.len;
    }
    outP.copy(this.points[this.points.length - 1]);
    return outP;
  }

  _buildSpray(q) {
    // Sand thrown up by a rider. Deterministic in `t` while idle, and BOOSTED (denser, faster,
    // brighter) for as long as the hero is actually on the deck — the plume is the speedometer.
    const n = clamp(Math.round(this.totalLen * 1.2 * clamp(q.particles, 0.2, 1)), 12, 160);
    this.sprayCount = n;
    const geo = new THREE.OctahedronGeometry(0.5, 0);
    geo.scale(0.06, 0.06, 0.06);
    this.sprayMat = additiveMaterial(this.sandColor.getHex(), { cached: false, opacity: 0.32 });
    this.own(this.sprayMat);
    this.spray = new THREE.InstancedMesh(geo, this.sprayMat, n);
    this.spray.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.spray.frustumCulled = false;
    this.spray.renderOrder = 6;
    this.add(this.spray);

    const rnd = hazRandom(this.def, 1013);
    this.sprayData = [];
    for (let i = 0; i < n; i++) {
      this.sprayData.push({
        u: rnd(), lat: (rnd() * 2 - 1) * 0.9, off: rnd(),
        speed: lerp(0.10, 0.28, rnd()), rise: lerp(0.25, 1.1, rnd()), scale: lerp(0.5, 1.6, rnd()),
      });
    }
    this._riderU = -1;
  }

  update(t, dt, player) {
    this.time = t;
    if (player) this.__player = player;

    // --- rider read ---------------------------------------------------------------------------
    const pl = resolvePlayer(this.ctx, player || this.__player);
    let ride = 0;
    if (pl && pl.pos) {
      // Closest approach to the run, cheaply: the nearest segment's perpendicular distance.
      let best = 1e9, bestU = -1, acc = 0;
      for (let i = 0; i < this.segments.length; i++) {
        const sg = this.segments[i];
        _v.subVectors(pl.pos, sg.a);
        const along = clamp(_v.dot(sg.fwd), 0, sg.len);
        _v2.copy(sg.a).addScaledVector(sg.fwd, along);
        const d = _v2.distanceTo(pl.pos);
        if (d < best) { best = d; bestU = (acc + along) / Math.max(1e-4, this.totalLen); }
        acc += sg.len;
      }
      if (best < Math.max(this.width * 0.6, this.deckH * 2 + 1.4)) {
        ride = clamp(1 - best / Math.max(this.width * 0.6, 2), 0, 1);
        this._riderU = bestU;
      }
    }
    const speed = pl && pl.vel ? Math.hypot(pl.vel.x, pl.vel.z) : 0;
    const heat = ride * clamp(speed / this.minSpeed, 0, 1.4);

    // --- spray -----------------------------------------------------------------------------------
    for (let i = 0; i < this.sprayCount; i++) {
      const sp = this.sprayData[i];
      // Idle motes drift on the whole run; while somebody is riding, they cluster just behind
      // the rider and fly up the fall line.
      const k = (sp.off + t * sp.speed * (0.6 + heat * 2.4)) % 1;
      const u = heat > 0.04 && this._riderU >= 0
        ? clamp(this._riderU - k * 0.10 - 0.01, 0, 1)
        : (sp.u + k * 0.08) % 1;
      this.pointAt(u, _v, _v2, _v3);
      const rise = k * sp.rise * (0.35 + heat * 1.8);
      _v.addScaledVector(_v3, sp.lat * this.width * 0.42)
        .addScaledVector(UPV, this.deckH * 0.5 + rise)
        .addScaledVector(_v2, -k * (0.6 + heat * 3.4));
      const fade = Math.sin(k * Math.PI);
      _s.setScalar(sp.scale * clamp(fade, 0.02, 1) * (0.5 + heat * 1.4));
      _q.identity();
      _m.compose(_v, _q, _s);
      this.spray.setMatrixAt(i, _m);
    }
    this.spray.instanceMatrix.needsUpdate = true;
    this.sprayMat.opacity = 0.10 + heat * 0.45;

    this.stripeMat.opacity = 0.36 + 0.20 * (0.5 + 0.5 * Math.sin(t * 2.0)) + heat * 0.28;
    for (let i = 0; i < this.colliders.length; i++) this.colliders[i].active = this.enabled;

    if (this._silent) return;
    // Hiss while the board is genuinely carrying somebody.
    if (heat > 0.35 && t - (this._lastHiss || -9) > 0.28) {
      this._lastHiss = t;
      this.pointAt(this._riderU, _v, null, null);
      hazSfx(this.ctx, 'step_sand', {
        gain: clamp(0.16 + heat * 0.30, 0.14, 0.5),
        rate: clamp(1.2 + heat * 0.5, 1.1, 1.9), pos: _v, ref: 9, max: 40,
      });
    }
  }

  reset(t) {
    this._riderU = -1;
    this._lastHiss = -9;
    super.reset(t);
  }
}

/**
 * A dune chute you ride.
 * `{kind:'sandboard', a:[top], b:[bottom], w?:METRES (default 6), h?:DECK THICKNESS,
 *   pts?:[[x,y,z], …] (a multi-segment run instead of a/b), minSpeed?:m/s, friction?, berm?}`
 *
 * The deck is one rotated OBB per segment carrying `surface:'sand'` with
 * `props {board:true, slick, minSpeed, friction, slopeDeg}` — the controller reads `board` to
 * apply ice-like friction plus the SPEED FLOOR (`minSpeed`, default 0.85 x TUNE.speedRun) that
 * stops a rider stalling halfway down. Berm walls on both sides are colliders too, so a bad
 * line ricochets instead of dropping you off the mountain.
 */
export function sandboard(def, ctx) { return new SandboardHazard(def, ctx); }
