// runtime/hazards/lava.js
// CRESTBOUND — molten hazards: `lava` (a lethal pool) and `risinglava` (the relentless floor).
//
// The molten surface is a subdivided plane driven by a vertex-displacement wave patched onto
// the shared Mats 'lava' PBR material (scrolling emissive crust cracks in the fragment stage).
// The patched material is built ONCE PER THEME and shared by every pool in the course; per-pool
// values (amplitude, footprint, glow) ride in through an allocation-free onBeforeRender hook.
//
// DETERMINISM LAW (CONTRACT §21): surface height, wave phase, bubble state and light flicker
// are all pure functions of the course clock. Only one-shot effects (bubble pops, proximity
// rumble) are event driven, and `reset(t)` re-seeds their edge counters without replaying them.
//
// This module is also the owner of the HEAT-HAZE AGGREGATOR (`heatContribute` / `heatRelease`)
// that every molten hazard in the package shares — beams.js (flame jets) and chase.js (molten
// fronts) report through it, because fx/post.js exposes ONE screen-space shimmer amount.
//
// Ported from Ascendant by transliteration.

import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/util.js';
import {
  Hazard, GLSL_NOISE, num, v3, sizeVec, palette, themeId, hazMat, additiveMaterial,
  bevelBox, mergeAll, makeKill, updateKillBox, hazSfx, hazBurst, hazAmbient, hazRandom,
  qualityOf, makeGlowSprite, resolvePlayer, resolvePost, HazLoop,
} from './lasers.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _box = new THREE.Box3();

/* ======================================================================================
   SHARED MOLTEN SURFACE MATERIAL
   ====================================================================================== */

const LAVA_COMMON_VERT = `
varying vec2 vLavaP;
varying float vLavaW;
varying float vLavaEdge;
uniform float uLavaTime;
uniform float uLavaAmp;
uniform float uLavaScale;
uniform vec2  uLavaHalf;
uniform vec2  uLavaOrigin;
float lavaWave(vec2 p, float tt, out float dwdx, out float dwdz) {
  const float a1 = 0.50, a2 = 0.42, a3 = 0.24, a4 = 0.12;
  const float k1 = 0.70, k2 = 0.53, k3 = 1.31, k4 = 2.20;
  float p1 = p.x * k1 + tt * 1.60;
  float p2 = p.y * k2 - tt * 1.10;
  float p3 = (p.x + p.y) * k3 + tt * 2.30;
  float p4 = (p.x - p.y * 1.7) * k4 - tt * 3.10;
  dwdx = a1 * k1 * cos(p1) + a3 * k3 * cos(p3) + a4 * k4 * cos(p4);
  dwdz = a2 * k2 * cos(p2) + a3 * k3 * cos(p3) - 1.7 * a4 * k4 * cos(p4);
  return a1 * sin(p1) + a2 * sin(p2) + a3 * sin(p3) + a4 * sin(p4);
}
`;

const LAVA_COMMON_FRAG = `
varying vec2 vLavaP;
varying float vLavaW;
varying float vLavaEdge;
uniform float uLavaTime;
uniform float uLavaScale;
uniform float uLavaGlow;
uniform vec3  uLavaHot;
uniform vec3  uLavaCool;
${GLSL_NOISE}
`;

/** Cache of patched lava materials, one per theme id. */
const _lavaMats = new Map();

/**
 * The shared molten-surface material for a theme. Never clone this per pool — call
 * `configureLavaMesh` on each mesh instead.
 * @returns {{material: THREE.Material, uniforms: Object}}
 */
export function lavaSurfaceMaterial(ctx) {
  const id = themeId(ctx);
  const hit = _lavaMats.get(id);
  if (hit) return hit;

  const pal = palette(ctx);
  const base = hazMat(ctx, 'lava');
  const mat = base.clone();
  mat.side = THREE.DoubleSide;      // a rising floor must read from underneath too
  mat.roughness = clamp(num(mat.roughness, 0.7), 0.45, 1);
  mat.metalness = 0.02;
  if (!mat.emissive) mat.emissive = new THREE.Color(0xff5a1e);
  mat.emissiveIntensity = Math.max(1.0, num(mat.emissiveIntensity, 1));

  const uniforms = {
    uLavaTime: { value: 0 },
    uLavaAmp: { value: 0.16 },
    uLavaScale: { value: 1 },
    uLavaHalf: { value: new THREE.Vector2(8, 8) },
    uLavaOrigin: { value: new THREE.Vector2(0, 0) },
    uLavaGlow: { value: 1 },
    uLavaHot: { value: new THREE.Color(pal.killGlow !== undefined ? pal.killGlow : 0xff8a2b) },
    uLavaCool: { value: new THREE.Color(0x2a0f0a) },
  };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + LAVA_COMMON_VERT)
      .replace(
        '#include <beginnormal_vertex>',
        [
          '#include <beginnormal_vertex>',
          'float lvNdx, lvNdz;',
          'lavaWave(position.xz * uLavaScale + uLavaOrigin, uLavaTime, lvNdx, lvNdz);',
          'objectNormal = normalize(vec3(-uLavaAmp * lvNdx * uLavaScale, 1.0, -uLavaAmp * lvNdz * uLavaScale));',
        ].join('\n'),
      )
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          'float lvDx, lvDz;',
          'float lvW = lavaWave(position.xz * uLavaScale + uLavaOrigin, uLavaTime, lvDx, lvDz);',
          'transformed.y += lvW * uLavaAmp;',
          'vLavaW = lvW;',
          'vLavaP = position.xz;',
          'vec2 lvE = abs(position.xz) / max(uLavaHalf, vec2(0.001));',
          'vLavaEdge = clamp((1.0 - max(lvE.x, lvE.y)) * 5.0, 0.0, 1.0);',
        ].join('\n'),
      );

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + LAVA_COMMON_FRAG)
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          'vec2 lvP = vLavaP * uLavaScale;',
          'float lvF1 = hzFbm(lvP * 0.55 + vec2(uLavaTime * 0.035, -uLavaTime * 0.021));',
          'float lvF2 = hzFbm(lvP * 1.35 - vec2(uLavaTime * 0.017, uLavaTime * 0.045));',
          'float lvVein = smoothstep(0.30, 0.02, abs(lvF1 - lvF2));',
          'float lvPlate = smoothstep(0.30, 0.66, lvF1);',
          'float lvCrest = clamp(vLavaW * 0.5 + 0.5, 0.0, 1.0);',
          'float lvRim = 1.0 - vLavaEdge;',
          'float lvHeat = lvVein * 1.9 + (1.0 - lvPlate) * 0.55 + lvCrest * 0.35 + lvRim * 1.7 + 0.14;',
          'diffuseColor.rgb = mix(diffuseColor.rgb * uLavaCool * 3.2, diffuseColor.rgb, clamp(lvVein + lvRim + 0.25, 0.0, 1.0));',
        ].join('\n'),
      )
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          'totalEmissiveRadiance *= lvHeat * uLavaGlow;',
          'totalEmissiveRadiance = mix(totalEmissiveRadiance, uLavaHot * lvHeat * uLavaGlow, 0.55);',
        ].join('\n'),
      )
      .replace(
        '#include <roughnessmap_fragment>',
        [
          '#include <roughnessmap_fragment>',
          'roughnessFactor = clamp(mix(roughnessFactor, 0.20, lvVein * 0.85), 0.06, 1.0);',
        ].join('\n'),
      );
  };
  mat.customProgramCacheKey = () => 'crestbound-lava-surface';
  mat.needsUpdate = true;

  const entry = { material: mat, uniforms };
  _lavaMats.set(id, entry);
  return entry;
}

/**
 * Bind per-mesh molten parameters. The shared material's uniforms are refreshed from the
 * mesh's userData immediately before it draws — no allocation, no per-pool material clone.
 */
export function configureLavaMesh(mesh, uniforms, opts) {
  mesh.userData.lavaAmp = num(opts.amp, 0.16);
  mesh.userData.lavaScale = num(opts.scale, 1);
  mesh.userData.lavaGlow = num(opts.glow, 1);
  mesh.userData.lavaHalfX = num(opts.halfX, 8);
  mesh.userData.lavaHalfZ = num(opts.halfZ, 8);
  mesh.userData.lavaOx = num(opts.originX, 0);
  mesh.userData.lavaOz = num(opts.originZ, 0);
  mesh.onBeforeRender = function lavaBeforeRender() {
    const d = this.userData;
    uniforms.uLavaAmp.value = d.lavaAmp;
    uniforms.uLavaScale.value = d.lavaScale;
    uniforms.uLavaGlow.value = d.lavaGlow;
    uniforms.uLavaHalf.value.set(d.lavaHalfX, d.lavaHalfZ);
    uniforms.uLavaOrigin.value.set(d.lavaOx, d.lavaOz);
  };
  return mesh;
}

/* ======================================================================================
   HEAT HAZE BRIDGE (fx/post.js)
   ======================================================================================
   Post.setHeat(v01) is a SINGLE screen-space shimmer amount, not a per-source field, so every
   molten hazard in a course has to share it. Each one reports its own contribution here and
   the loudest wins; the composed value is pushed only when it actually moves, and a disposed
   hazard drops out cleanly instead of leaving the screen shimmering forever. */

const _heatSources = new Map();
let _heatPost = null;
let _heatLast = -1;

function heatCompose() {
  let m = 0;
  for (const v of _heatSources.values()) if (v > m) m = v;
  if (Math.abs(m - _heatLast) < 0.008) return;
  _heatLast = m;
  if (!_heatPost) return;
  try { _heatPost.setHeat(m); } catch (e) { _heatPost = null; }
}

/** Report this owner's heat-shimmer contribution (0..1). */
export function heatContribute(post, owner, v01) {
  if (!post || typeof post.setHeat !== 'function') return;
  _heatPost = post;
  _heatSources.set(owner, clamp(v01, 0, 1));
  heatCompose();
}

/** Drop an owner's contribution — call on dispose, or the shimmer outlives the hazard. */
export function heatRelease(owner) {
  if (!_heatSources.delete(owner)) return;
  heatCompose();
}

/* ======================================================================================
   LAVA HAZARD
   ====================================================================================== */

class LavaHazard extends Hazard {
  constructor(def, ctx, rising) {
    super(def, ctx, rising ? 'risinglava' : 'lava');
    const pal = palette(ctx);
    const q = qualityOf(ctx);

    this.center = v3(def.p, 0, 0, 0);
    this.size = sizeVec(def.s, 24, 4, 24);
    this.halfX = this.size.x * 0.5;
    this.halfZ = this.size.z * 0.5;
    this.rising = !!rising;

    const r = def.rising || def;
    this.from = num(r.from, this.center.y + this.size.y * 0.5);
    this.to = num(r.to, this.from + 24);
    this.riseSpeed = Math.max(0.01, num(r.speed, 1.4));
    this.riseDelay = Math.max(0, num(r.delay, 2.5));
    this.staticY = this.center.y + this.size.y * 0.5;

    this.hotColor = new THREE.Color(pal.killGlow !== undefined ? pal.killGlow : 0xff7a2b);
    this.killColor = new THREE.Color(pal.kill !== undefined ? pal.kill : 0xff3320);

    this._surfaceY = this.rising ? this.from : this.staticY;
    this._rumbleAcc = 0;
    this.post = resolvePost(ctx);
    this._danger = 0;
    // How much screen shimmer this pool is worth when the player is right on top of it.
    this.heatPeak = clamp(Math.max(this.size.x, this.size.z) / 40, 0.18, 0.7);

    this._buildSurface(q);
    this._buildRim();
    this._buildBubbles(q);
    this._buildLight();
    this._buildKill();
    this._buildAmbience(q);

    if (this.rising) {
      this.hud = { type: 'rising', label: 'RISING LAVA', value: 0, height: this._surfaceY };
    }
    this.reset(0);
  }

  // ---- construction -----------------------------------------------------------------------
  _buildSurface(q) {
    const surf = lavaSurfaceMaterial(this.ctx);
    this.lavaUniforms = surf.uniforms;

    // ~1 segment per 1.1 m, clamped so a huge pool never blows the vertex budget.
    const density = lerp(0.55, 1.0, clamp(q.decor, 0, 1));
    const segX = clamp(Math.round(this.size.x * 0.9 * density), 6, 120);
    const segZ = clamp(Math.round(this.size.z * 0.9 * density), 6, 120);

    const geo = new THREE.PlaneGeometry(this.size.x, this.size.z, segX, segZ);
    geo.rotateX(-Math.PI * 0.5);
    this.surface = new THREE.Mesh(geo, surf.material);
    this.surface.receiveShadow = false;
    this.surface.castShadow = false;
    this.surface.renderOrder = 1;
    this.surface.position.set(this.center.x, this._surfaceY, this.center.z);
    configureLavaMesh(this.surface, surf.uniforms, {
      amp: clamp(Math.min(this.size.x, this.size.z) * 0.018, 0.05, 0.30),
      scale: 1,
      glow: this.rising ? 1.25 : 1.0,
      halfX: this.halfX, halfZ: this.halfZ,
      originX: this.center.x * 0.35, originZ: this.center.z * 0.35,
    });
    this.add(this.surface);

    // Molten body seen edge-on: a shallow skirt of obsidian crust just under the waterline,
    // so the pool never reads as a floating plane.
    const skirtParts = [];
    const t = 0.32;
    const dy = -0.55;
    skirtParts.push(placeSlab(this.size.x, 1.1, t, 0, dy, this.halfZ - t * 0.5));
    skirtParts.push(placeSlab(this.size.x, 1.1, t, 0, dy, -this.halfZ + t * 0.5));
    skirtParts.push(placeSlab(t, 1.1, this.size.z - t * 2, this.halfX - t * 0.5, dy, 0));
    skirtParts.push(placeSlab(t, 1.1, this.size.z - t * 2, -this.halfX + t * 0.5, dy, 0));
    const skirtGeo = mergeAll(skirtParts);
    if (skirtGeo) {
      this.skirt = new THREE.Mesh(skirtGeo, hazMat(this.ctx, 'obsidian'));
      this.skirt.castShadow = false;
      this.skirt.receiveShadow = true;
      this.skirt.position.set(this.center.x, this._surfaceY, this.center.z);
      this.add(this.skirt);
    }
  }

  _buildRim() {
    // A bright rim strip inset just inside the pool border — the "it is hot where it meets
    // the rock" read. Additive and unlit so bloom picks it up cleanly.
    const parts = [];
    const w = clamp(Math.min(this.size.x, this.size.z) * 0.045, 0.10, 0.45);
    const ix = this.halfX - w * 0.5;
    const iz = this.halfZ - w * 0.5;
    parts.push(placeSlab(this.size.x - w, 0.05, w, 0, 0, iz, 0.34));
    parts.push(placeSlab(this.size.x - w, 0.05, w, 0, 0, -iz, 0.34));
    parts.push(placeSlab(w, 0.05, this.size.z - w * 3, ix, 0, 0, 0.34));
    parts.push(placeSlab(w, 0.05, this.size.z - w * 3, -ix, 0, 0, 0.34));
    const geo = mergeAll(parts);
    if (!geo) return;
    this.rimMat = additiveMaterial(this.hotColor.getHex(), { cached: false, opacity: 0.9 });
    this.own(this.rimMat);
    this.rim = new THREE.Mesh(geo, this.rimMat);
    this.rim.renderOrder = 4;
    this.rim.position.set(this.center.x, this._surfaceY + 0.06, this.center.z);
    this.add(this.rim);
  }

  _buildBubbles(q) {
    const area = this.size.x * this.size.z;
    const n = clamp(Math.round(area * 0.045 * clamp(q.particles, 0.2, 1)), 4, 40);
    const rnd = hazRandom(this.def, 91);

    const domeParts = [];
    const dome = new THREE.SphereGeometry(0.5, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.55);
    domeParts.push(dome);
    const collar = new THREE.CylinderGeometry(0.52, 0.60, 0.10, 14, 1, true);
    collar.translate(0, -0.02, 0);
    domeParts.push(collar);

    this.bubbleMesh = new THREE.InstancedMesh(mergeAll(domeParts), hazMat(this.ctx, 'lava'), n);
    this.bubbleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bubbleMesh.castShadow = false;
    this.bubbleMesh.receiveShadow = false;
    this.bubbleMesh.frustumCulled = false;
    this.add(this.bubbleMesh);

    this.bubbles = [];
    for (let i = 0; i < n; i++) {
      this.bubbles.push({
        x: this.center.x + (rnd() * 2 - 1) * (this.halfX - 0.6),
        z: this.center.z + (rnd() * 2 - 1) * (this.halfZ - 0.6),
        r: lerp(0.28, 0.95, rnd()),
        period: lerp(2.6, 7.4, rnd()),
        phase: rnd() * 12,
        lastPop: null,
        pos: new THREE.Vector3(),
      });
    }
  }

  /**
   * A pool of lava is not worth a PointLight of its own.
   *
   * Ten pools in one course used to mean ten point lights, all visible at once, every one
   * of them evaluated per fragment on every material in the course. What a pool actually
   * needs on screen is its own emissive crust (the shared molten material already carries
   * that), a glow card for the bounce, and a share of ONE orange light that the course
   * points at whichever pool you are standing nearest. So we register a light SITE with the
   * course's light budget and drive it; the course owns the single real light.
   *
   * Without a host to register with (a bare hazard harness), the glow card and the emissive
   * surface still carry the look — there is no fallback light.
   */
  _buildLight() {
    const reach = Math.max(this.size.x, this.size.z) * 0.75 + 6;
    this.baseLightIntensity = clamp(reach * 0.42, 3, 26);
    this.lightSite = null;
    const host = (this.ctx && (this.ctx.course || this.ctx.stage)) || null;
    const addSite = host && typeof host.addLightSite === 'function' ? host.addLightSite.bind(host)
      : (this.ctx && typeof this.ctx.addLightSite === 'function' ? this.ctx.addLightSite : null);
    if (addSite) {
      try {
        this.lightSite = addSite({
          p: [this.center.x, this._surfaceY + 1.1, this.center.z],
          color: this.hotColor.getHex(),
          intensity: this.baseLightIntensity,
          distance: reach,
          decay: 1.8,
        });
      } catch (e) { this.lightSite = null; }
    }

    // A soft glow card that sells the bounce even where nothing is close enough to be lit.
    // Sized to the pool but CAPPED: an unbounded additive quad feeds the bloom bright-pass
    // across half the frame. The bounce read comes from the first couple of metres above the
    // surface; a tighter, dimmer card keeps it without the frame-wide flood.
    this.glow = makeGlowSprite(this.hotColor.getHex(),
      Math.min(Math.min(this.size.x, this.size.z) * 0.55, 10), 0.16, 3.4);
    this.own(this.glow.material);
    this.glow.position.set(this.center.x, this._surfaceY + 0.6, this.center.z);
    this.glow.renderOrder = 3;
    this.add(this.glow);
  }

  _buildKill() {
    const top = this._surfaceY + 0.05;
    const depth = this.rising ? 60 : Math.max(this.size.y, 1.2);
    const half = new THREE.Vector3(this.halfX, depth * 0.5, this.halfZ);
    const center = new THREE.Vector3(this.center.x, top - depth * 0.5, this.center.z);
    this.killDepth = depth;
    this.kill = makeKill({ type: 'box', center, half, kind: 'lava', ref: this });
    this.kills.push(this.kill);
  }

  _buildAmbience(q) {
    _box.min.set(this.center.x - this.halfX, this._surfaceY, this.center.z - this.halfZ);
    _box.max.set(this.center.x + this.halfX, this._surfaceY + 7.5, this.center.z + this.halfZ);
    const rate = clamp(this.size.x * this.size.z * 0.012 * clamp(q.particles, 0.15, 1), 1, 26);
    const h = hazAmbient(this.ctx, 'ember', _box.clone(), rate, { color: this.hotColor.getHex() });
    if (h) this._ambients.push(h);

    // A pool has to be audible between bubble pops, or it is silent scenery. `lava_flow` is a
    // synthesised looping bed (optional in §5); setPos() buys distance falloff and stereo
    // placement for free, and if the voice does not exist the pops still carry it.
    const reach = Math.max(this.size.x, this.size.z);
    this.flowLoop = new HazLoop(this.ctx, 'lava_flow', {
      gain: clamp(0.30 + reach * 0.012, 0.25, 0.85),
      ref: clamp(reach * 0.45, 6, 26),
      max: clamp(reach * 2.4 + 30, 50, 190),
    });
    this._loops.push(this.flowLoop);
  }

  // ---- public API -------------------------------------------------------------------------
  /** Surface height at course time `t` — pure. Exposed so the HUD can draw a danger meter. */
  heightAt(t) {
    if (!this.rising) return this.staticY;
    return this.from + clamp((t - this.riseDelay) * this.riseSpeed, 0, this.to - this.from);
  }

  /** 0..1 "how dead am I" for a point — 1 when the surface is at or above it. */
  danger01(point, t) {
    const y = this.heightAt(t === undefined ? this.time : t);
    if (!point) return this.rising ? clamp((y - this.from) / Math.max(0.001, this.to - this.from), 0, 1) : 0;
    const dy = point.y - y;
    const dx = Math.max(0, Math.abs(point.x - this.center.x) - this.halfX);
    const dz = Math.max(0, Math.abs(point.z - this.center.z) - this.halfZ);
    const lateral = Math.sqrt(dx * dx + dz * dz);
    const vertical = clamp(1 - dy / 14, 0, 1);
    const near = clamp(1 - lateral / 12, 0, 1);
    return clamp(vertical * near, 0, 1);
  }

  // ---- per-frame --------------------------------------------------------------------------
  update(t, dt, player) {
    this.time = t;
    if (player) this.__player = player;
    const y = this.heightAt(t);
    this._surfaceY = y;

    this.lavaUniforms.uLavaTime.value = t;

    this.surface.position.y = y;
    if (this.skirt) this.skirt.position.y = y;
    if (this.rim) {
      this.rim.position.y = y + 0.06;
      const pulse = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(t * 1.9) * Math.sin(t * 0.77 + 1.3));
      this.rimMat.opacity = pulse;
    }

    // light: deterministic multi-sine flicker, driving the course's shared site
    const flick = 0.80 + 0.13 * Math.sin(t * 3.1) + 0.07 * Math.sin(t * 7.73 + 1.1) + 0.05 * Math.sin(t * 13.1);
    if (this.lightSite) {
      this.lightSite.pos.y = y + 1.1;
      this.lightSite.base = this.baseLightIntensity * flick * (this.enabled === false ? 0 : 1);
    }
    if (this.glow) {
      this.glow.position.y = y + 0.6;
      this.glow.material.opacity = 0.11 + 0.08 * flick;
    }

    // kill volume tracks the surface
    _v.set(this.center.x, y + 0.05 - this.killDepth * 0.5, this.center.z);
    _v2.set(this.halfX, this.killDepth * 0.5, this.halfZ);
    updateKillBox(this.kill, _v, _v2);
    this.kill.active = this.enabled;

    this._updateBubbles(t);
    this._updateAudioAndHud(t, dt, y, player);
  }

  _updateBubbles(t) {
    const mesh = this.bubbleMesh;
    for (let i = 0; i < this.bubbles.length; i++) {
      const b = this.bubbles[i];
      const shifted = t + b.phase;
      const k = shifted / b.period;
      const idx = Math.floor(k);
      const local = k - idx;
      let scale, yOff;
      if (local < 0.72) {
        const g = local / 0.72;
        scale = smoothstep(0, 1, g) * b.r;
        yOff = lerp(-b.r * 1.5, b.r * 0.22, smoothstep(0, 1, g));
      } else {
        const g = (local - 0.72) / 0.28;
        scale = b.r * (1 - smoothstep(0, 1, g)) * 1.25;
        yOff = b.r * 0.22 + g * 0.30;
      }
      b.pos.set(b.x, this._surfaceY + yOff, b.z);
      _s.setScalar(Math.max(0.0001, scale));
      _q.identity();
      _m.compose(b.pos, _q, _s);
      mesh.setMatrixAt(i, _m);

      // pop: fires once per cycle at the collapse boundary
      const popIdx = Math.floor((shifted - b.period * 0.72) / b.period);
      if (this.edge(b, 'lastPop', popIdx)) {
        _v.set(b.x, this._surfaceY + b.r * 0.3, b.z);
        hazBurst(this.ctx, 'lavaPop', _v, { count: Math.round(4 + b.r * 8), color: this.hotColor.getHex(), speed: 2 + b.r * 3 });
        if (b.r > 0.5) {
          hazSfx(this.ctx, 'lava_bubble', {
            gain: clamp(0.25 + b.r * 0.5, 0.1, 0.8),
            rate: clamp(1.35 - b.r * 0.55, 0.6, 1.4),
            pos: _v, ref: 9, max: 40,
          });
        }
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  _updateAudioAndHud(t, dt, y, player) {
    const pl = resolvePlayer(this.ctx, player || this.__player);
    const p = pl && pl.pos ? pl.pos : null;
    const danger = this.danger01(p, t);
    this._danger = danger;

    // Shimmer scales with proximity: a pool you are nowhere near costs nothing on screen.
    heatContribute(this.post, this, this.heatPeak * (0.12 + danger * 1.15));

    // Molten bed, parked on the surface so it rises with a rising floor.
    _v.set(this.center.x, y, this.center.z);
    this.flowLoop.update(t, _v, this.rising ? 0.75 + danger * 0.35 : 1);

    if (this.hud) {
      const span = Math.max(0.001, this.to - this.from);
      this.hud.value = clamp((y - this.from) / span, 0, 1);
      this.hud.height = y;
      this.hud.danger = danger;
    }

    if (!this.rising || this._silent) return;

    // Proximity rumble: interval tightens and gain rises as the front closes in. This is an
    // EFFECT, not state — the surface height itself stays a pure function of t.
    const moving = y > this.from + 1e-4 && y < this.to - 1e-4;
    if (!moving && danger < 0.25) { this._rumbleAcc = 0; return; }
    const interval = lerp(2.6, 0.65, danger);
    this._rumbleAcc += Math.max(0, dt || 0);
    if (this._rumbleAcc >= interval) {
      this._rumbleAcc = 0;
      _v.set(this.center.x, y, this.center.z);
      hazSfx(this.ctx, 'crusher_slam', {
        gain: clamp(0.10 + danger * 0.45, 0.06, 0.6),
        rate: lerp(0.30, 0.52, danger),
        pos: _v, ref: 22, max: 120,
      });
    }
  }

  reset(t) {
    this._rumbleAcc = 0;
    super.reset(t);
  }

  dispose() {
    heatRelease(this);
    if (this.surface) this.surface.onBeforeRender = noop;
    super.dispose();
  }
}

function noop() {}

/** A slab (chamfered box) pre-translated into pool-local space. */
function placeSlab(w, h, d, x, y, z, detail = 1) {
  const g = bevelBox(Math.max(0.02, w), Math.max(0.02, h), Math.max(0.02, d), 0.02, 1.7, detail);
  g.translate(x, y, z);
  return g;
}

/* ======================================================================================
   FACTORIES
   ====================================================================================== */

/**
 * A lethal molten pool.
 * `{kind:'lava', p:[centre], s:[FULL size], rising?:{from, to, speed, delay}}`
 * A def carrying `rising` is routed to `risinglava` so course authors only need one kind.
 * `s.y` is the pool DEPTH (how far below the surface the kill box reaches).
 */
export function lava(def, ctx) {
  if (def && def.rising) return new LavaHazard(def, ctx, true);
  return new LavaHazard(def, ctx, false);
}

/**
 * The relentless rising floor.
 * `{kind:'risinglava', p, s, rising:{from, to, speed, delay}}` (or the fields on the def
 * itself). Surface y = from + clamp((t - delay) * speed, 0, to - from) — metres and SECONDS.
 * Exposes `heightAt(t)` and a `hud` block so the HUD can render a danger meter.
 */
export function risinglava(def, ctx) {
  return new LavaHazard(def, ctx, true);
}
