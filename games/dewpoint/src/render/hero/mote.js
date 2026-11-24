// Mote: a drop of water with two eyes and four very different bodies.
//   liquid - jiggly teardrop (squash & stretch, anticipation, landing splat, idle wobble, wet prints)
//   ice    - a cut crystal: a six-sided body with a faceted crown, every plane one flat tone of a saturated
//            royal blue (deep, shade, body, lit), inked crease lines between planes, white drawn highlight bars
//            and a glint on the lit facets, the eyes held wide open on the flat plane that faces you
//   steam  - a drawn cloud: a cluster of white puffs with a lilac underside, eyes on the biggest one
//   film   - a thin sheet on the floor with stepped rainbow bands, eyes peeking up over its edge
// All four are cel-shaded in three flat tones and inked by the ink pass (base.js).
// The face, the gaze, the morphing, the ring and the mark below are HeroView's (base.js); this file
// is only what makes a drop a drop. Form changes cross-morph with a flash, a ground ring and a
// particle burst (all toned down with reduced motion).

import * as THREE from '../../../vendor/three.module.min.js';
import { HeroView, bodyMaterial, wrap } from './base.js';
import waterDef from '../../sim/elements/water.js';

const C_LIQ = [0.37, 0.9, 1.0], C_ICE = [0.55, 0.84, 1.0], C_STEAM = [0.9, 0.98, 1.0], C_FILM = [0.6, 0.95, 0.9];
export const FORM_COLORS = { liquid: C_LIQ, ice: C_ICE, steam: C_STEAM, film: C_FILM };
const STEAM_MAX = waterDef.gauge.max;

// The crystal's own cel shader (the shared body shader still supplies the vertex stage and the uniforms). Every
// plane is flat, so its tone is chosen per plane from the angle to the light: deep, shade, body, lit - hard edges,
// all of them blue (coloured shadows, never grey) and none of them pale, so the crystal stands out from light floors.
// On top, drawn by hand: a thin dark-blue crease where two planes meet (the plane normal jumps there, which the
// screen-space derivative finds), a wide and a narrow white bar slanting across the lit planes, and a glint on the crown.
const ICE_FRAG = /* glsl */`
  uniform vec3 uColA;
  uniform vec3 uColB;
  uniform vec3 uColC;
  uniform vec3 uLightDir;
  uniform float uFlash;
  uniform float uInk;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vObj;
  void main() {
    vec3 v = normalize(vV);
    vec3 n = normalize(cross(dFdx(vV), dFdy(vV))) * -1.0;
    if (dot(n, v) < 0.0) n = -n;
    // the crown catches more light than the sides (it leans up toward it)
    float ndl = dot(n, normalize(uLightDir)) + step(0.55, vObj.y) * 0.28;
    vec3 col = uColA * 0.66;                                   // deep: planes turned away from the light
    col = mix(col, uColA, step(-0.1, ndl));                    // shade
    col = mix(col, uColB, step(0.3, ndl));                     // body: the plane that faces you, behind the eyes
    col = mix(col, uColC, step(0.8, ndl));                     // lit
    // highlight bars (white, hard-edged) slanting over the planes that face the light, above the foot
    float lit = step(0.62, ndl) * step(0.16, vObj.y);
    float s = fract(vObj.y * 1.7 - (vObj.x + vObj.z) * 1.15);
    col = mix(col, vec3(1.0), lit * (step(0.64, s) * step(s, 0.8) + step(0.9, s) * step(s, 0.95)) * 0.92);
    // a glint on the crown: a small white diamond
    vec2 g = vec2(vObj.x - 0.07, vObj.z + 0.1);
    col = mix(col, vec3(1.0), step(0.7, vObj.y) * step(abs(g.x) + abs(g.y), 0.05) * 0.95);
    // inked creases where one plane meets the next, a constant 1.6 px wide: the six corners round the body, and the rings
    float u = atan(vObj.x, vObj.z) / 1.0471976 - 0.5;
    float du = abs(fract(u + 0.5) - 0.5), pu = max(fwidth(u), 1e-4);
    float cr = step(du / pu, 1.6);
    float y = vObj.y, py = max(fwidth(y), 1e-4);
    cr = max(cr, step(abs(y - 0.11) / py, 1.6) + step(abs(y - 0.55) / py, 1.6) + step(abs(y - 0.68) / py, 1.6) + step(abs(y - 0.79) / py, 1.6));
    col = mix(col, uColA * 0.42, min(1.0, cr) * step(0.04, y) * 0.9);
    col = mix(col, vec3(1.0), uFlash);
    gl_FragColor = vec4(col, uInk);
    #include <colorspace_fragment>
  }`;

const FACE = { ey: 0, ez: 0, ex: 0, tilt: 0, es: 1, toe: 0.4 };
const MOOD = { frozen: false, lowGauge: false, low: 0, order: 11 };
const MARK = { size: 0.95, alpha: 0.55 };
const LIGHT = { color: C_LIQ, power: 14 };

export class MoteView extends HeroView {
  constructor(particles, prints, flames) {
    super(particles, prints, {
      forms: ['liquid', 'ice', 'steam', 'film'],
      formColors: FORM_COLORS,
      // lid colour per form (the body's own colour, so a blink reads as the body closing over the eye)
      lid: { liquid: 0x2ea6ea, ice: 0x4fa2ff, steam: 0xe6ecfa, film: 0x34c2bc },
      // eye size in metres (half-extents of the eye ellipsoid), before the camera-distance boost
      eye: { w: 0.122, h: 0.156, d: 0.074, white: [1.0, 1.0, 1.0], iris: [0.06, 0.2, 0.5], dark: [0.02, 0.04, 0.12], outline: [0.02, 0.07, 0.2] },
      ghost: 0x7fe9ff,
      turn: { ice: 5 },
      mark: { color: [0.03, 0.12, 0.24], additive: false },
      // wet prints: a darker, wetter patch of floor with a bright edge
      print: { inner: [0.05, 0.3, 0.42], rim: [0.86, 0.98, 1.0], glow: 0 },
    }, flames);

    // --- liquid: lathe teardrop
    const prof = [[0, 0], [0.2, 0.012], [0.33, 0.07], [0.405, 0.18], [0.42, 0.30], [0.385, 0.43], [0.31, 0.54], [0.215, 0.63], [0.125, 0.70], [0.055, 0.755], [0, 0.79]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const liquidGeo = new THREE.LatheGeometry(prof, 24);
    this.matLiquid = bodyMaterial({ a: 0x1668c9, b: 0x2fb4f0, c: 0x74dcff, wobble: 1, height: 0.79 });
    const liquid = new THREE.Mesh(liquidGeo, this.matLiquid);

    // --- ice: a cut crystal. A lathe with six sides gives flat planes: a chamfered foot, straight sides (a
    // plane faces the eyes), a two-step crown. Turned so a plane, not a corner, faces +z where the eyes sit.
    const iceProf = [[0, 0], [0.33, 0], [0.48, 0.11], [0.48, 0.55], [0.38, 0.68], [0.2, 0.79], [0, 0.84]].map(([r, y]) => new THREE.Vector2(r, y));
    const iceGeo = new THREE.LatheGeometry(iceProf, 6);
    iceGeo.rotateY(Math.PI / 6);
    this.matIce = bodyMaterial({ a: 0x2f5fe0, b: 0x4fa2ff, c: 0x74caff, facet: true, height: 0.84 });
    this.matIce.fragmentShader = ICE_FRAG;
    const ice = new THREE.Mesh(iceGeo, this.matIce);
    // turn first, then lean: the crystal tips forward along the way IT faces (poseBody turns it to the face's
    // heading, which can run a little ahead of the body root's slower ice turn) - with the default XYZ order
    // the lean would be about the root's axis instead
    ice.rotation.order = 'YXZ';

    // --- steam: a cloud of puffs (one instanced draw)
    const puffGeo = new THREE.SphereGeometry(1, 12, 9);
    this.matSteam = bodyMaterial({ a: 0xb4c0ee, b: 0xf3f7ff, c: 0xffffff, puff: true });
    const steam = new THREE.Group();
    this.puffs = [[0, 0.42, 0, 0.3], [0.2, 0.3, 0.08, 0.2], [-0.19, 0.33, -0.05, 0.21], [0.05, 0.62, -0.13, 0.19], [-0.08, 0.2, 0.17, 0.17], [0.13, 0.5, 0.17, 0.16], [-0.16, 0.56, 0.1, 0.15]]
      .map(([x, y, z, r], i) => ({ x, y, z, r, ph: i * 1.9 }));
    this.puffInst = new THREE.InstancedMesh(puffGeo, this.matSteam, this.puffs.length);
    this.puffInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.puffO = new THREE.Object3D();
    // its see-through silhouette: one ball where the cloud is (a ghost per puff would be seven draws for nothing)
    const steamGhost = new THREE.Mesh(puffGeo, this.ghostMat);
    steamGhost.scale.setScalar(0.44); steamGhost.position.y = 0.42; steamGhost.renderOrder = 30; steamGhost.userData.noGhost = true; steamGhost.userData.noShadow = true;
    steam.add(this.puffInst, steamGhost);

    // --- film: a thin sheet
    const filmGeo = new THREE.CylinderGeometry(0.5, 0.53, 0.06, 30, 1);
    filmGeo.translate(0, 0.035, 0);
    this.matFilm = bodyMaterial({ a: 0x118aa6, b: 0x38cfc8, c: 0x9af4e2, ripple: 1, irid: 0.6, height: 0.3 });
    const film = new THREE.Mesh(filmGeo, this.matFilm);

    this.addBody('liquid', liquid);
    this.addBody('ice', ice);
    this.addBody('steam', steam, { shadow: false, ghost: 'none' });
    this.addBody('film', film);
    this.timed.push(this.matLiquid, this.matIce, this.matFilm, this.matSteam);
    this.finish();
  }

  interests() {}

  heroEvent(e, sim, P, p) {
    if (e.type === 'form') {
      const col = FORM_COLORS[e.to];
      if (e.cause !== 'respawn') {
        const n = this.reduced ? 10 : 28;
        P.burst(p.x, p.y + 0.35, p.z, n, { speed: e.to === 'steam' ? 1.6 : 3.2, life: 0.55, size: 0.16, color: col, gravity: e.to === 'steam' ? -2 : 5, drag: 2.5, up: e.to === 'steam' ? 1.2 : 0.6 });
        if (e.to === 'ice') P.burst(p.x, p.y + 0.35, p.z, 12, { speed: 4.5, life: 0.35, size: 0.09, color: [1, 1, 1], drag: 5 });
        if (e.to === 'steam') for (let i = 0; i < 6; i++) P.spawn({ x: p.x + (P.rnd() - 0.5) * 0.5, y: p.y + 0.2 + P.rnd() * 0.4, z: p.z + (P.rnd() - 0.5) * 0.5, vy: 0.8 + P.rnd(), life: 0.9, size: 0.5, grow: 0.5, color: [0.96, 0.98, 1.0], alpha: 0.6, drag: 1, solid: 1 });
        if (e.to === 'film') P.burst(p.x, p.y + 0.05, p.z, 14, { flat: true, speed: 2.6, life: 0.4, size: 0.1, color: col, drag: 3 });
        this.flash = this.reduced ? 0.35 : 0.8;
        this.startRing(col);
      }
      this.spring = e.to === 'film' ? -0.35 : 0.3;
      this.squint = 0.6;
    } else if (e.type === 'burst') {
      if (e.kind === 'jump') {
        // anticipation then release: a quick squash that springs into a stretch
        this.spring = -0.2; this.springV = 7.5;
        this.squint = 0.5;
        P.burst(e.x, e.y + 0.05, e.z, 7, { flat: true, speed: 1.9, life: 0.35, size: 0.1, color: C_LIQ, drag: 4 });
      } else if (e.kind === 'land') {
        const hard = Math.min(1, e.speed / 14);
        this.springV -= Math.min(10, e.speed * 0.75);
        const n = Math.min(16, 3 + e.speed | 0);
        P.burst(e.x, e.y + 0.05, e.z, n, { flat: true, speed: 1.2 + e.speed * 0.16, life: 0.4, size: e.form === 'ice' ? 0.08 : 0.11, color: FORM_COLORS[e.form] || C_LIQ, gravity: 6, drag: 2, up: 1.2 });
        if ((e.form === 'liquid' || !e.form) && e.speed > 3) this.prints.add(e.x, e.y, e.z, 0.7 + hard * 0.9, true);
        if (hard > 0.35) this.squint = 0.8;
      } else if (e.kind === 'splash') {
        P.burst(e.x, e.y, e.z, 22, { speed: 3, life: 0.6, size: 0.13, color: C_LIQ, gravity: 9, up: 2.5 });
      }
    } else if (e.type === 'respawn') {
      P.burst(e.from[0], e.from[1] + 0.3, e.from[2], 14, { speed: 2.5, life: 0.5, size: 0.14, color: C_LIQ, gravity: 4 });
    }
  }

  poseBody(k, body, s, target, b, c) {
    const { p, idle, rm, time, sp } = c;
    if (k === 'liquid') {
      const breathe = idle && !rm ? Math.sin(time * 2.2) * 0.03 : (p.grounded ? Math.sin(time * 2.2) * 0.015 : 0);
      const st = 1 + Math.max(-0.28, Math.min(0.32, p.vy * 0.028)) + this.spring + breathe;
      const w = 1 / Math.sqrt(Math.max(0.4, st));
      body.scale.set(s * w, s * st, s * w);
      // idle: a lazy side-to-side jiggle, like a drop settling
      body.rotation.z = idle && !rm ? Math.sin(time * 1.7) * 0.05 : 0;
      body.rotation.x = idle && !rm ? Math.sin(time * 1.3 + 1) * 0.03 : 0;
    } else if (k === 'ice') {
      const st = 1 + this.spring * 0.25;
      body.scale.set(s, s * st, s);
      body.rotation.x = Math.min(0.25, sp * 0.012) + this.spring * 0.3;
      // the crystal shows its face (and the frozen eyes) to whoever is looking
      body.rotation.y = wrap(this.eyeYaw - this.yaw) + (target && !rm ? (1 - b) * 2.2 : 0);
    } else if (k === 'film') {
      body.scale.set(s * (1 - this.spring * 0.5), s * (1 + this.spring * 2), s * (1 - this.spring * 0.5));
    } else {
      body.scale.setScalar(s);
    }
  }

  afterBodies(c) {
    const { p, form, dt, time, sp, rm, lvx, lvz } = c;
    // liquid tip trails behind (world velocity in the body's own frame)
    const k = rm ? 0.3 : 1;
    this.lean.x += (-lvx * 0.035 * k - this.lean.x) * Math.min(1, dt * 9);
    this.lean.y += (-lvz * 0.035 * k - this.lean.y) * Math.min(1, dt * 9);
    this.matLiquid.uniforms.uLean.value.copy(this.lean);
    this.matLiquid.uniforms.uWobble.value = (rm ? 0.35 : 1) * (0.7 + Math.min(1, sp / 5) * 0.6);

    // steam puffs: bob, breathe, shrink as the gauge empties (and shiver when it is nearly gone);
    // scatter then gather when forming
    if (this.bodies.steam.visible) {
      const low = form === 'steam' ? Math.min(1, p.gauge / 1.2) : 1;
      const flick = low < 1 && !rm ? 0.86 + 0.14 * Math.sin(time * 26) : 1;
      const gather = rm ? 1 : 1 + (1 - this.blend.steam) * 1.4;
      const o = this.puffO;
      this.puffs.forEach((u, i) => {
        const t = time * 1.6 + u.ph;
        o.position.set((u.x + Math.sin(t) * 0.05 - lvx * 0.02 * u.y) * gather, u.y + Math.sin(t * 1.3) * 0.045, (u.z + Math.cos(t * 0.9) * 0.05 - lvz * 0.02 * u.y) * gather);
        o.scale.setScalar(u.r * (0.9 + 0.12 * Math.sin(t * 1.7)) * (0.55 + 0.45 * low) * flick);
        o.updateMatrix();
        this.puffInst.setMatrixAt(i, o.matrix);
      });
      this.puffInst.instanceMatrix.needsUpdate = true;
    }
  }

  mood(form, p) {
    // ice eyes are frozen open; steam about to run out looks worried; film peeks over its own edge
    MOOD.frozen = form === 'ice' && this.blend.ice > 0.5;
    MOOD.lowGauge = form === 'steam' && p.gauge < STEAM_MAX * 0.25;
    MOOD.low = form === 'film' ? 0.18 : 0;
    // inside the ice: before the crystal; on a steam puff: after the puffs, so they never fog it
    MOOD.order = form === 'steam' ? 16 : 11;
    return MOOD;
  }

  face(form, c) {
    const F = FACE;
    // the eyes sit ON the flat plane that faces the eyes (apothem 0.416): a dome standing proud of it, never sunk into the crystal
    if (form === 'ice') { F.ey = 0.335; F.ez = 0.455; F.ex = 0.14; F.tilt = 0; F.es = 0.9; F.toe = 0.12; }
    else if (form === 'steam') { F.ey = 0.45 + Math.sin(c.time * 2.1) * 0.03; F.ez = 0.28; F.ex = 0.12; F.tilt = 0; F.es = 0.85; F.toe = 0.4; }
    else if (form === 'film') { F.ey = 0.085; F.ez = 0.36; F.ex = 0.14; F.tilt = -0.55; F.es = 0.95; F.toe = 0.25; }
    else {
      const liquidStretch = this.bodies.liquid.scale.y / Math.max(0.01, this.pop);
      const liquidWide = this.bodies.liquid.scale.x / Math.max(0.01, this.pop);
      F.ey = 0.34 * liquidStretch; F.ez = 0.375 * liquidWide; F.ex = 0.158 * liquidWide; F.tilt = 0; F.es = 1; F.toe = 0.4;
    }
    return F;
  }

  trails(c) {
    const { p, form, sp, x, y, z, P } = c;
    if (form === 'liquid' && p.grounded && p.ground && p.ground.kind !== 'ramp' && !p.floating) {
      if (Math.hypot(x - this.lastPrint.x, z - this.lastPrint.z) > 0.55 || Math.abs(y - this.lastPrint.y) > 0.2) {
        this.prints.add(x, y, z, 0.55 + P.rnd() * 0.2);
        this.lastPrint.set(x, y, z);
      }
    }
    if (this.emitAcc > 0.045) {
      this.emitAcc = 0;
      if (form === 'steam') {
        P.spawn({ x: x + (P.rnd() - 0.5) * 0.4, y: y + 0.1 + P.rnd() * 0.3, z: z + (P.rnd() - 0.5) * 0.4, vy: -0.3, life: 0.8, size: 0.3, grow: 0.3, color: [0.95, 0.97, 1.0], alpha: 0.4, drag: 1, solid: 1 });
      } else if (form === 'ice' && p.grounded && sp > 3) {
        P.spawn({ x: x - p.vx * 0.04 + (P.rnd() - 0.5) * 0.3, y: y + 0.04, z: z - p.vz * 0.04 + (P.rnd() - 0.5) * 0.3, vy: 0.6 + P.rnd(), life: 0.4, size: 0.07, color: [0.8, 0.95, 1], drag: 2 });
      } else if (form === 'ice' && P.rnd() < 0.12) {
        // a slow glint drifting off the crystal
        P.spawn({ x: x + (P.rnd() - 0.5) * 0.6, y: y + 0.2 + P.rnd() * 0.6, z: z + (P.rnd() - 0.5) * 0.6, vy: 0.15, life: 0.6, size: 0.07, color: [0.9, 1, 1] });
      } else if (form === 'film' && sp > 0.5 && P.rnd() < 0.5) {
        P.spawn({ x: x + (P.rnd() - 0.5) * 0.8, y: y + 0.08, z: z + (P.rnd() - 0.5) * 0.8, vy: 0.3, life: 0.5, size: 0.06, color: [0.7, 1, 0.9] });
      } else if (form === 'liquid' && p.grounded && sp > 4 && P.rnd() < 0.35) {
        P.spawn({ x: x + (P.rnd() - 0.5) * 0.3, y: y + 0.05, z: z + (P.rnd() - 0.5) * 0.3, vx: -p.vx * 0.15, vy: 1.2 + P.rnd(), vz: -p.vz * 0.15, life: 0.35, size: 0.07, color: C_LIQ, gravity: 8 });
      }
    }
  }

  groundMark(form, h) {
    MARK.size = (form === 'film' ? 1.15 : 0.95) * (1 - Math.min(0.55, h * 0.06));
    MARK.alpha = (form === 'steam' ? 0.2 : 0.36) * (1 - Math.min(0.6, h * 0.05));
    return MARK;
  }

  /** The glow Mote throws on the tiles around it: brighter and whiter as ice, softer as steam. */
  light(form) {
    LIGHT.color = FORM_COLORS[form];
    LIGHT.power = form === 'steam' ? 8 : 14;
    return LIGHT;
  }
}
