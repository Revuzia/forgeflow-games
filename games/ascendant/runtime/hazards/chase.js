// runtime/hazards/chase.js
// ASCENDANT — the run-or-die wall.
//
// `chase` is one hazard with three faces:
//   mat:'lava' — a rising molten front, sharing the pool shader from ./lava.js
//   mat:'void' — a collapsing floor: the world behind the line dissolves into shards and nothing
//   mat:'wall' — an advancing wall of energy on a hex lattice, dragged along by support pylons
//
// It advances along `axis` at `speed` after `delay`, and is PURE IN t:
//   front = from + clamp((t - delay) * speed, 0, |to - from|) * sign(to - from)
// Everything at or behind the front is lethal, so there is no "did it catch me" ambiguity.
//
// Warning: `hazard.warn01` (0..1) rises as the front closes, `hazard.hud` feeds the HUD, and a
// screen-edge tint is pushed through an optional post hook. Audio ramps in interval and pitch.

import * as THREE from 'three';
import { clamp, lerp } from '../core/util.js';
import {
  Hazard, num, v3, sizeVec, palette, hazMat, additiveMaterial, makeGlowSprite,
  bevelBox, mergeAll, makeKill, updateKillBox, hazSfx, hazBurst, hazAmbient,
  hazRandom, qualityOf, GLSL_NOISE, resolvePlayer, resolvePost, HazLoop,
} from './lasers.js';
import { lavaSurfaceMaterial, configureLavaMesh, heatContribute, heatRelease } from './lava.js';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _chaseSpin = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _box = new THREE.Box3();
const AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

/* ======================================================================================
   ENERGY WALL SHADER
   ====================================================================================== */

const WALL_VERT = `
varying vec2 vP;
varying vec3 vNrm;
varying vec3 vView;
void main() {
  vP = position.xz;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNrm = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

// Hex lattice + travelling scanlines + edge fresnel. Reads as containment field, not fog.
const WALL_FRAG = `
uniform vec3 uColor;
uniform vec3 uHot;
uniform float uTime;
uniform float uEnergy;
varying vec2 vP;
varying vec3 vNrm;
varying vec3 vView;
${GLSL_NOISE}
float hexDist(vec2 p) {
  p = abs(p);
  float c = dot(p, normalize(vec2(1.0, 1.73)));
  return max(c, p.x);
}
void main() {
  vec2 g = vP * 0.62;
  vec2 r = vec2(1.0, 1.73);
  vec2 a = mod(g, r) - r * 0.5;
  vec2 b = mod(g - r * 0.5, r) - r * 0.5;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  float hd = 0.5 - hexDist(gv);
  float cell = smoothstep(0.055, 0.0, hd);
  float pulse = 0.55 + 0.45 * sin(uTime * 3.1 - vP.y * 0.5 + vP.x * 0.2);
  float scan = smoothstep(0.72, 1.0, fract(vP.y * 0.22 - uTime * 0.75));
  float grain = hzFbm(vP * 0.35 + vec2(uTime * 0.4, -uTime * 0.27));
  float fres = pow(1.0 - clamp(abs(dot(normalize(vNrm), normalize(vView))), 0.0, 1.0), 1.6);
  float body = 0.10 + cell * 0.85 * pulse + scan * 0.55 + grain * 0.22 + fres * 0.75;
  vec3 col = mix(uColor, uHot, clamp(cell * pulse + scan, 0.0, 1.0));
  float a2 = clamp(body * uEnergy, 0.0, 1.0);
  gl_FragColor = vec4(col * body * 1.5 * uEnergy, a2 * 0.92);
}
`;

// The void front: an inward-collapsing dissolve with a burning rim.
const VOID_FRAG = `
uniform vec3 uColor;
uniform vec3 uHot;
uniform float uTime;
uniform float uEnergy;
varying vec2 vP;
varying vec3 vNrm;
varying vec3 vView;
${GLSL_NOISE}
void main() {
  float n = hzFbm(vP * 0.42 + vec2(uTime * 0.22, uTime * 0.13));
  float n2 = hzFbm(vP * 1.6 - vec2(uTime * 0.5, 0.0));
  float hole = smoothstep(0.42, 0.68, n + n2 * 0.35);
  float rim = smoothstep(0.34, 0.46, n + n2 * 0.35) * (1.0 - hole);
  float fres = pow(1.0 - clamp(abs(dot(normalize(vNrm), normalize(vView))), 0.0, 1.0), 2.0);
  vec3 col = mix(uColor * 0.05, uHot, clamp(rim * 2.2 + fres * 0.5, 0.0, 1.0));
  float a2 = clamp((0.92 - hole * 0.75 + rim * 0.6) * uEnergy, 0.0, 1.0);
  gl_FragColor = vec4(col, a2);
}
`;

/* ======================================================================================
   CHASE HAZARD
   ====================================================================================== */

class ChaseHazard extends Hazard {
  constructor(def, ctx) {
    super(def, ctx, 'chase');
    const pal = palette(ctx);
    const q = qualityOf(ctx);

    const axisKey = def.axis === 'x' ? 'x' : def.axis === 'z' ? 'z' : 'y';
    this.axisKey = axisKey;
    this.axis = AXES[axisKey].clone();

    this.from = num(def.from, 0);
    this.to = num(def.to, this.from + 60);
    this.sign = this.to >= this.from ? 1 : -1;
    this.travel = Math.abs(this.to - this.from);
    this.speed = Math.max(0.05, num(def.speed, 4));
    this.delay = Math.max(0, num(def.delay, 3));
    this.style = def.mat === 'void' || def.mat === 'wall' ? def.mat : 'lava';

    // Cross-section. `p` is the lateral centre; `s` (or w/h) gives the face size. A generous
    // default covers a normal obby corridor without the stage author having to think about it.
    this.center = v3(def.p || def.center, 0, 0, 0);
    const dflt = axisKey === 'y' ? [70, 2, 70] : [70, 46, 70];
    const s = sizeVec(def.s, dflt[0], dflt[1], dflt[2]);
    if (axisKey === 'x') { this.faceW = num(def.w, s.y); this.faceH = num(def.h, s.z); }
    else if (axisKey === 'z') { this.faceW = num(def.w, s.x); this.faceH = num(def.h, s.y); }
    else { this.faceW = num(def.w, s.x); this.faceH = num(def.h, s.z); }
    this.faceW = Math.max(2, this.faceW);
    this.faceH = Math.max(2, this.faceH);

    this.color = new THREE.Color(def.color !== undefined ? def.color
      : (this.style === 'lava' ? (pal.killGlow !== undefined ? pal.killGlow : 0xff7a2b)
        : this.style === 'void' ? 0x1a0f2b
          : (pal.kill !== undefined ? pal.kill : 0xff2f4d)));
    this.hotColor = new THREE.Color(this.style === 'void'
      ? (pal.kill !== undefined ? pal.kill : 0xd23bff)
      : this.color.getHex()).lerp(new THREE.Color(0xffffff), 0.25);

    this.front = this.from;
    this.warn01 = 0;
    this._rumbleAcc = 0;
    this._lastPostWarn = -1;
    this._lastStart = null;
    this.post = resolvePost(ctx);

    this._buildFront(q);
    this._buildDebris(q);
    this._buildKill();
    this._buildAmbience(q);

    this.hud = { type: 'chase', label: this.style === 'lava' ? 'LAVA FRONT' : this.style === 'void' ? 'COLLAPSE' : 'ENERGY WALL', value: 0, distance: 0 };
    this.reset(0);
  }

  /** Front position along `axis` at stage time `t`. Pure. */
  frontAt(t) {
    return this.from + clamp((t - this.delay) * this.speed, 0, this.travel) * this.sign;
  }

  /** World point on the axis for a scalar front position. */
  _frontPoint(value, out) {
    out.copy(this.center);
    if (this.axisKey === 'x') out.x = value;
    else if (this.axisKey === 'y') out.y = value;
    else out.z = value;
    return out;
  }

  // ---- build ------------------------------------------------------------------------------
  _buildFront(q) {
    this.frontGroup = new THREE.Group();
    this.add(this.frontGroup);

    if (this.style === 'lava') this._buildLavaFront(q);
    else this._buildEnergyFront(this.style === 'void' ? VOID_FRAG : WALL_FRAG);

    // Rim: a hot bar running the full width of the leading edge — the single most important
    // readability element, because it is what you see in your peripheral vision while sprinting.
    const rimParts = [];
    const barT = clamp(Math.min(this.faceW, this.faceH) * 0.012, 0.06, 0.30);
    rimParts.push(bevelBox(this.faceW, barT, barT * 2.2, barT * 0.3));
    for (let i = 0; i < 7; i++) {
      const u = (i / 6 - 0.5) * this.faceW * 0.94;
      const g = bevelBox(barT * 2.4, barT * 1.6, barT * 3.6, barT * 0.25, 1.7, 0.4);
      g.translate(u, 0, 0);
      rimParts.push(g);
    }
    this.rimMat = additiveMaterial(this.hotColor.getHex(), { cached: false, opacity: 0.9, side: THREE.DoubleSide });
    this.own(this.rimMat);
    this.rim = new THREE.Mesh(mergeAll(rimParts), this.rimMat);
    this.rim.renderOrder = 6;
    this.frontGroup.add(this.rim);

    this.frontGlow = makeGlowSprite(this.hotColor.getHex(), Math.max(this.faceW, this.faceH) * 0.55, 0.35, 2.4);
    this.own(this.frontGlow.material);
    this.frontGlow.renderOrder = 7;
    this.frontGroup.add(this.frontGlow);

    // Orient the front group so its local +Y is the direction of travel.
    _v.copy(this.axis).multiplyScalar(this.sign);
    this.frontQuat = new THREE.Quaternion().setFromUnitVectors(AXES.y, _v);
    this.frontGroup.quaternion.copy(this.frontQuat);
  }

  _buildLavaFront(q) {
    const { material, uniforms } = lavaSurfaceMaterial(this.ctx);
    this.lavaUniforms = uniforms;
    const density = lerp(0.4, 0.85, clamp(q.decor, 0, 1));
    const segX = clamp(Math.round(this.faceW * density), 6, 96);
    const segZ = clamp(Math.round(this.faceH * density), 6, 96);
    // Authored in the front group's local XZ plane (local +Y == travel direction), so the same
    // displacement shader that makes a pool churn makes this front bulge forward.
    const geo = new THREE.PlaneGeometry(this.faceW, this.faceH, segX, segZ);
    geo.rotateX(-Math.PI * 0.5);
    this.surface = new THREE.Mesh(geo, material);
    this.surface.renderOrder = 2;
    configureLavaMesh(this.surface, uniforms, {
      amp: clamp(Math.min(this.faceW, this.faceH) * 0.02, 0.10, 0.55),
      scale: 1, glow: 1.35,
      halfX: this.faceW * 0.5, halfZ: this.faceH * 0.5,
      originX: this.center.x * 0.3, originZ: this.center.z * 0.3,
    });
    this.frontGroup.add(this.surface);

    this.light = new THREE.PointLight(this.color.getHex(), 0, Math.max(this.faceW, this.faceH) * 0.5 + 14, 1.7);
    this.light.castShadow = false;
    this.baseLightIntensity = clamp(this.faceW * 0.35, 6, 40);
    this.mesh.add(this.light);
    this.lights.push(this.light);
  }

  _buildEnergyFront(fragment) {
    const geo = new THREE.PlaneGeometry(this.faceW, this.faceH, 1, 1);
    this.wallUniforms = {
      uColor: { value: this.color.clone() },
      uHot: { value: this.hotColor.clone() },
      uTime: { value: 0 },
      uEnergy: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.wallUniforms, vertexShader: WALL_VERT, fragmentShader: fragment,
      transparent: true, blending: this.style === 'void' ? THREE.NormalBlending : THREE.AdditiveBlending,
      depthWrite: this.style === 'void', side: THREE.DoubleSide, toneMapped: false, fog: false,
    });
    this.own(mat);
    // The plane is authored in XY then laid into the group's XZ face.
    geo.rotateX(-Math.PI * 0.5);
    this.surface = new THREE.Mesh(geo, mat);
    this.surface.renderOrder = 2;
    this.frontGroup.add(this.surface);

    // Support pylons dragged along by the field — gives the wall mass and a sense of machinery.
    const pylonParts = [];
    const pr = clamp(Math.min(this.faceW, this.faceH) * 0.02, 0.12, 0.5);
    for (const sx of [-1, 1]) {
      const col = new THREE.CylinderGeometry(pr, pr * 1.35, this.faceH * 0.98, 12);
      col.rotateX(Math.PI * 0.5);
      col.translate(sx * this.faceW * 0.5, -pr * 1.4, 0);
      pylonParts.push(col);
      for (let i = -2; i <= 2; i++) {
        const ring = new THREE.TorusGeometry(pr * 1.5, pr * 0.28, 6, 14);
        ring.translate(sx * this.faceW * 0.5, -pr * 1.4, i * this.faceH * 0.2);
        pylonParts.push(ring);
      }
    }
    const pyl = mergeAll(pylonParts);
    if (pyl) {
      this.pylons = new THREE.Mesh(pyl, hazMat(this.ctx, 'metal'));
      this.pylons.castShadow = false;
      this.frontGroup.add(this.pylons);
    }

    this.light = new THREE.PointLight(this.hotColor.getHex(), 0, Math.max(this.faceW, this.faceH) * 0.45 + 10, 1.9);
    this.light.castShadow = false;
    this.baseLightIntensity = clamp(this.faceW * 0.28, 4, 30);
    this.mesh.add(this.light);
    this.lights.push(this.light);
  }

  _buildDebris(q) {
    // Shards torn off the leading edge — the "the floor is going" read for a collapse, and
    // spitting slag for a lava front. Instanced, deterministic, tumbling on a fixed clock.
    const n = clamp(Math.round(this.faceW * 0.7 * clamp(q.particles, 0.2, 1)), 8, 90);
    this.debrisCount = n;
    const parts = [];
    const shard = new THREE.OctahedronGeometry(0.5, 0);
    shard.scale(1, 0.45, 1.3);
    parts.push(shard);
    const geo = mergeAll(parts);
    const matKey = this.style === 'lava' ? 'obsidian' : this.style === 'void' ? 'obsidian' : 'metal';
    this.debris = new THREE.InstancedMesh(geo, hazMat(this.ctx, matKey), n);
    this.debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debris.castShadow = false;
    this.debris.frustumCulled = false;
    this.frontGroup.add(this.debris);

    const rnd = hazRandom(this.def, 401);
    this.debrisData = [];
    for (let i = 0; i < n; i++) {
      this.debrisData.push({
        x: (rnd() - 0.5) * this.faceW * 0.98,
        z: (rnd() - 0.5) * this.faceH * 0.98,
        scale: lerp(0.16, 0.62, rnd()),
        period: lerp(1.4, 3.6, rnd()),
        phase: rnd() * 9,
        spin: lerp(-3.2, 3.2, rnd()),
        rise: lerp(0.8, 3.4, rnd()),
      });
    }
  }

  _buildKill() {
    // Everything at or behind the front dies. The box is deep enough that no geometry hides in it.
    this.killDepth = Math.max(this.travel + 40, 60);
    this.killHalf = new THREE.Vector3();
    if (this.axisKey === 'x') this.killHalf.set(this.killDepth * 0.5, this.faceW * 0.5, this.faceH * 0.5);
    else if (this.axisKey === 'y') this.killHalf.set(this.faceW * 0.5, this.killDepth * 0.5, this.faceH * 0.5);
    else this.killHalf.set(this.faceW * 0.5, this.faceH * 0.5, this.killDepth * 0.5);

    this._frontPoint(this.from - this.sign * this.killDepth * 0.5, _v);
    this.kill = makeKill({
      type: 'box', center: _v, half: this.killHalf,
      kind: this.style === 'void' ? 'void' : 'lava', ref: this,
    });
    this.kills.push(this.kill);
  }

  _buildAmbience(q) {
    if (this.style !== 'lava') return;
    this._frontPoint(this.from, _v);
    _box.min.set(_v.x - this.faceW * 0.5, _v.y, _v.z - this.faceH * 0.5);
    _box.max.set(_v.x + this.faceW * 0.5, _v.y + 8, _v.z + this.faceH * 0.5);
    const h = hazAmbient(this.ctx, 'ember', _box.clone(), clamp(this.faceW * 0.35, 2, 24));
    if (h) this._ambients.push(h);

    // A molten front is the loudest thing in the stage; give it the looping bed, not just the
    // periodic slam, so you can hear exactly how close it is without looking back.
    this.flowLoop = new HazLoop(this.ctx, 'lava_flow', {
      gain: clamp(0.45 + this.faceW * 0.006, 0.4, 1),
      ref: clamp(this.faceW * 0.35, 10, 40),
      max: 220,
    });
    this._loops.push(this.flowLoop);
  }

  // ---- per-frame ---------------------------------------------------------------------------
  update(t, dt) {
    this.time = t;
    const front = this.frontAt(t);
    this.front = front;
    const armed = t >= this.delay;
    const done = Math.abs(front - this.from) >= this.travel - 1e-4;

    // --- placement ----------------------------------------------------------------------------
    this._frontPoint(front, _v);
    this.frontGroup.position.copy(_v);
    if (this.light) this.light.position.copy(_v).addScaledVector(this.axis, this.sign * -1.2);

    if (this.lavaUniforms) this.lavaUniforms.uLavaTime.value = t;
    if (this.wallUniforms) {
      this.wallUniforms.uTime.value = t;
      // Spool the field up over the last second of the delay: the wall powers on, then moves.
      this.wallUniforms.uEnergy.value = clamp((t - (this.delay - 1.0)) / 1.0, 0.06, 1);
    }

    // --- leading rim + glow ---------------------------------------------------------------------
    const flick = 0.78 + 0.14 * Math.sin(t * 5.3) + 0.08 * Math.sin(t * 11.7);
    this.rimMat.opacity = clamp((armed ? 0.75 : 0.35) * flick + 0.2, 0, 1);
    this.rim.position.y = 0.06;
    this.frontGlow.material.opacity = (armed ? 0.34 : 0.16) * flick;
    this.frontGlow.scale.setScalar(Math.max(this.faceW, this.faceH) * (0.45 + 0.06 * flick));
    if (this.light) this.light.intensity = this.baseLightIntensity * flick * (armed ? 1 : 0.35);

    // --- debris -------------------------------------------------------------------------------
    for (let i = 0; i < this.debrisCount; i++) {
      const d = this.debrisData[i];
      const k = (((t + d.phase) / d.period) % 1 + 1) % 1;
      const up = k * d.rise;
      const fade = Math.sin(k * Math.PI);
      _v.set(d.x, 0.2 + up, d.z);
      _q.setFromAxisAngle(AXES.x, t * d.spin).multiply(
        _chaseSpin.setFromAxisAngle(AXES.z, t * d.spin * 0.6 + d.phase),
      );
      const sc = d.scale * clamp(fade * 1.4, 0.001, 1) * (armed ? 1 : 0.35);
      _s.setScalar(sc);
      _m.compose(_v, _q, _s);
      this.debris.setMatrixAt(i, _m);
    }
    this.debris.instanceMatrix.needsUpdate = true;

    // --- kill volume ---------------------------------------------------------------------------
    this._frontPoint(front - this.sign * this.killDepth * 0.5, _v);
    updateKillBox(this.kill, _v, this.killHalf);
    this.kill.active = this.enabled && armed;

    this._updateWarning(t, dt, front, armed, done);
  }

  _updateWarning(t, dt, front, armed, done) {
    const pl = resolvePlayer(this.ctx);
    const p = pl && pl.pos ? pl.pos : null;

    let gap = Infinity;
    if (p) {
      const pv = this.axisKey === 'x' ? p.x : this.axisKey === 'y' ? p.y : p.z;
      gap = (pv - front) * this.sign;                 // positive == still ahead of the front
    }

    // 0 at 26 m of clearance, 1 when the front is on top of you.
    const warn = !armed ? 0
      : Number.isFinite(gap) ? clamp(1 - gap / 26, 0, 1)
        : clamp(Math.abs(front - this.from) / Math.max(0.001, this.travel), 0, 1);
    this.warn01 = warn;
    this.hud.value = warn;
    this.hud.distance = Number.isFinite(gap) ? gap : -1;
    this.hud.armed = armed;

    // Screen feedback for the approach. A molten front drives the real heat-shimmer amount
    // (shared with lava pools through the same aggregator, loudest source wins). The death
    // vignette (setDamage) is deliberately never hijacked; setDanger/setEdgeTint are optional
    // hooks no Post build ships today, so they stay guarded.
    if (this.style === 'lava') {
      heatContribute(this.post, this, warn * 0.85);
      if (this.flowLoop) {
        this._frontPoint(front, _v);
        this.flowLoop.update(t, _v, armed ? 1 : 0.35);
      }
    }
    const post = this.post;
    if (post && Math.abs(warn - this._lastPostWarn) > 0.02) {
      this._lastPostWarn = warn;
      try {
        if (typeof post.setDanger === 'function') post.setDanger(warn, this.hotColor);
        else if (typeof post.setEdgeTint === 'function') post.setEdgeTint(warn, this.hotColor);
      } catch (e) { /* optional hook */ }
    }

    // Start-of-chase stinger, once. `edge` records the transition even while silent, so a
    // respawn into a chase that has already started never replays it.
    if (this.edge(this, '_lastStart', armed ? 1 : 0) && armed) {
      this._frontPoint(front, _v);
      hazSfx(this.ctx, 'crusher_slam', { gain: 0.9, rate: 0.5, pos: _v, ref: 30, max: 200 });
      hazBurst(this.ctx, 'dust', _v, { count: 24, speed: 5, color: this.hotColor.getHex() });
    }

    if (this._silent || !armed || done) { this._rumbleAcc = 0; return; }

    // Approach drone: interval shortens and pitch rises as it closes.
    const interval = lerp(1.9, 0.42, warn);
    this._rumbleAcc += Math.max(0, dt || 0);
    if (this._rumbleAcc >= interval) {
      this._rumbleAcc = 0;
      this._frontPoint(front, _v);
      hazSfx(this.ctx, 'crusher_slam', {
        gain: clamp(0.12 + warn * 0.55, 0.08, 0.72),
        rate: lerp(0.34, 0.62, warn),
        pos: _v, ref: 30, max: 200,
      });
    }
  }

  reset(t) {
    this._rumbleAcc = 0;
    this._lastPostWarn = -1;
    super.reset(t);
  }

  dispose() {
    heatRelease(this);
    const post = this.post;
    if (post && this._lastPostWarn > 0) {
      try {
        if (typeof post.setDanger === 'function') post.setDanger(0, this.hotColor);
        else if (typeof post.setEdgeTint === 'function') post.setEdgeTint(0, this.hotColor);
      } catch (e) { /* teardown must never throw */ }
    }
    if (this.surface) this.surface.onBeforeRender = chaseNoop;
    super.dispose();
  }
}

function chaseNoop() {}

/* ======================================================================================
   FACTORY
   ====================================================================================== */

/**
 * The run-or-die wall.
 * `{kind:'chase', axis:'x'|'y'|'z', from, to, speed, delay, mat:'lava'|'void'|'wall',
 *   p?:[lateral centre], s?:[cross-section], w?, h?, color?}`
 *
 * Pure in `t`. Exposes `frontAt(t)`, `warn01` and `hud` for the HUD and the audio mix.
 */
export function chase(def, ctx) {
  return new ChaseHazard(def, ctx);
}
