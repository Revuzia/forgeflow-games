// HeroView: everything the three heroes share. A hero is a body per form that cross-morphs, plus
// ONE face - two big procedural eyes that are placed on whichever body is showing - and the marks
// that help the player: a ring on the ground at a form change, a mark straight below for judging
// jumps, a see-through silhouette behind walls.
//
// The face is meant to read at a glance from the default follow camera, even on a phone: the eyes
// are big (and grow a little with camera distance). The face and the body always point the way the
// hero is heading - moving away from the camera the player sees the back of its head - and keep that
// heading when it stops; standing still only the pupils wander (to the camera, to things worth
// noticing). The one time the face turns to the camera is the level-complete celebration.
// (tests/play.test.js holds this with real key presses in a real browser.)
//
// A subclass (mote.js, cinder.js, and Clay's dab.js one day) supplies only what is its own:
//   constructor  builds its bodies with addBody(form, object3D, opts) and calls finish()
//   poseBody(k, body, s, target, b, c)   scale / rotate one visible body this frame (s = morph scale)
//   afterBodies(c)                       per-frame material uniforms, puffs, flames ...
//   face(form, c)   -> { ey, ez, ex, tilt, es, toe }   where the eyes sit on that form's body
//   mood(form, p, c) -> { frozen, lowGauge, low, order } eye expression inputs (see update())
//   trails(c)                            particles and prints it leaves behind
//   heroEvent(e, sim, P, p)              its reaction to sim events (form change bursts, jumps ...)
//   groundMark(form, h, c) -> { size, alpha }          the mark below it (a shadow, or a pool of light)
//   light(form, p, c) -> { color:[r,g,b], power }      the glow it throws on the world around it (dark themes only)
//   shimmer(form) -> { y, r, k } | null                heat ripple above it (the ink pass draws it)
//   hide()                                             fold away anything it keeps outside its own group (flames)
// The look: bodies are cel-shaded in three flat tones of their own colour (a coloured shadow, never
// grey), with highlights drawn as hard-edged shapes; they are opaque and write the hero's ink id,
// so the ink pass outlines them like everything else, and the eyes carry an id of their own - an
// inked ring round each eye, which is what keeps the face readable at phone size.
// `c` is the per-frame context: { sim, p, form, dt, time, sp, idle, rm, lvx, lvz, x, y, z, P }.

import * as THREE from '../../../vendor/three.module.min.js';
import { INK } from '../geo.js';

export const BODY_VERT = /* glsl */`
  uniform float uTime;
  uniform float uWobble;
  uniform vec2 uLean;
  uniform float uHeight;
  uniform float uRipple;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vObj;
  void main() {
    vec3 p = position;
    float w = sin(p.y * 6.0 + uTime * 5.5) * 0.030 + sin(p.x * 8.0 - uTime * 4.1) * 0.020 + sin(p.z * 7.0 + uTime * 4.7) * 0.020;
    p += normal * w * uWobble;
    // travelling ripple across a flat sheet (film)
    float rr = length(p.xz);
    p.y += sin(rr * 14.0 - uTime * 6.0) * 0.012 * uRipple * smoothstep(0.0, 0.2, rr);
    p.xz *= 1.0 + sin(atan(p.z, p.x) * 5.0 + uTime * 2.2) * 0.05 * uRipple;
    // the top of the drop trails behind the motion
    float t = clamp(p.y / uHeight, 0.0, 1.0);
    p.xz += uLean * t * t;
    vObj = p;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;

const BODY_FRAG = /* glsl */`
  uniform vec3 uColA;
  uniform vec3 uColB;
  uniform vec3 uColC;
  uniform vec3 uLightDir;
  uniform float uFacet;
  uniform float uIrid;
  uniform float uTime;
  uniform float uHeight;
  uniform float uFlash;
  uniform float uInk;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vObj;
  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(vV);
    if (uFacet > 0.5) { n = normalize(cross(dFdx(vV), dFdy(vV))) * -1.0; if (dot(n, v) < 0.0) n = -n; }
    float ndl = dot(n, uLightDir);
    // three flat tones with soft edges: the coloured shadow, the body, the lit crown
    float ed = uFacet > 0.5 ? 0.002 : 0.035;
    vec3 col = mix(uColA, uColB, smoothstep(-0.16 - ed, -0.16 + ed, ndl));
    col = mix(col, uColC, smoothstep(0.5 - ed, 0.5 + ed, ndl + clamp(vObj.y / uHeight, 0.0, 1.0) * 0.25));
    // thin-film rainbow, in flat steps
    vec3 irid = 0.5 + 0.5 * cos(6.2832 * (floor((vObj.x * 0.9 + vObj.z * 0.7 + uTime * 0.2) * 4.0) / 4.0) + vec3(0.0, 2.1, 4.2));
    col = mix(col, col * 0.55 + irid * 0.6, uIrid * step(0.3, ndl));
    // highlights drawn as shapes: a window and a dot
    vec3 h = normalize(uLightDir + v);
    float sp = dot(n, h);
    if (uFacet > 0.5) {
      col = mix(col, vec3(1.0), step(0.93, sp) * 0.9);
      // frost: a few hard glints along the facets
      col = mix(col, vec3(1.0), step(0.992, sin(vObj.x * 23.0 + vObj.y * 17.0 - vObj.z * 11.0)) * 0.7);
    } else {
      col = mix(col, vec3(1.0), smoothstep(0.962, 0.968, sp));
      vec3 h2 = normalize(uLightDir + v + vec3(0.42, -0.3, 0.0));
      col = mix(col, vec3(1.0), smoothstep(0.9925, 0.9945, dot(n, h2)));
    }
    col = mix(col, vec3(1.0), uFlash);
    gl_FragColor = vec4(col, uInk);
    #include <colorspace_fragment>
  }`;

// A puff of cloud: two flat tones (lit from above) on a ball; a cluster of them reads as one drawn cloud.
const PUFF_VERT = /* glsl */`
  uniform float uTime;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vObj;
  void main() {
    vObj = position;
    #ifdef USE_INSTANCING
      vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
    #else
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
    #endif
    vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;
const PUFF_FRAG = /* glsl */`
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
    vec3 n = normalize(vN);
    float ndl = dot(n, uLightDir);
    vec3 col = mix(uColA, uColB, smoothstep(-0.05, 0.03, ndl));
    col = mix(col, uColC, smoothstep(0.56, 0.62, ndl));
    col = mix(col, vec3(1.0), uFlash);
    gl_FragColor = vec4(col, uInk);
    #include <colorspace_fragment>
  }`;

// Eyes: one mesh each, drawn procedurally (white, pupil, two catch-lights, upper and lower lids).
// The four colours are uniforms so each hero has its own eyes (a drop: cool whites and deep blue;
// a coal: warm glowing whites and soot).
const EYE_VERT = /* glsl */`
  varying vec3 vObj;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vObj = position;
    #ifdef USE_INSTANCING
      vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
    #else
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
    #endif
    vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;
const EYE_FRAG = /* glsl */`
  uniform vec2 uPupil;
  uniform float uLid;
  uniform float uLow;
  uniform float uPupilSize;
  uniform vec3 uLidCol;
  uniform vec3 uWhite;
  uniform vec3 uIris;
  uniform vec3 uDark;
  uniform vec3 uOutline;
  varying vec3 vObj;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec2 q = vObj.xy;
    // the white, with one flat shade under the upper lid
    vec3 col = uWhite * mix(0.84, 1.0, step(q.y, 0.42));
    // pupil (slightly tall), with a faint rim of the iris colour
    vec2 pq = (q - uPupil) * vec2(1.0, 0.86);
    float d = length(pq);
    float r = 0.5 * uPupilSize;
    col = mix(col, uIris, 1.0 - smoothstep(r + 0.07, r + 0.1, d));
    col = mix(col, uDark, 1.0 - smoothstep(r - 0.02, r + 0.01, d));
    // catch-lights
    float g1 = length(q - uPupil - vec2(0.17, 0.24) * uPupilSize);
    float g2 = length(q - uPupil - vec2(-0.16, -0.2) * uPupilSize);
    col = mix(col, vec3(1.0), 1.0 - smoothstep(0.12, 0.15, g1));
    col = mix(col, vec3(1.0), (1.0 - smoothstep(0.05, 0.075, g2)) * 0.85);
    // lids: upper comes down (blink, squint), lower comes up (a happy crescent / peeking)
    float top = mix(1.05, -1.05, uLid);
    float bot = mix(-1.05, 1.05, uLow);
    if (q.y > top || q.y < bot) col = uLidCol;
    // a drawn ring round the eye, in the hero's own ink: with the ink pass's line this is what makes the face read small
    float edge = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    col = mix(col, uOutline, smoothstep(0.52, 0.6, edge));
    gl_FragColor = vec4(col, ${INK.eye.toFixed(3)});
    #include <colorspace_fragment>
  }`;

const RING_FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform float uT;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    // a drawn ring: a bold band and a thin one outside it
    float band = smoothstep(0.66, 0.7, r) * (1.0 - smoothstep(0.84, 0.88, r)) + smoothstep(0.93, 0.95, r) * (1.0 - smoothstep(0.98, 1.0, r)) * 0.6;
    float a = band * (1.0 - uT) * (1.0 - uT);
    if (a < 0.01) discard;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.35) * a, a * 0.85);
    #include <colorspace_fragment>
  }`;

const MARK_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
// the mark below the hero: a soft disc of one colour (a dark shadow, or - additive - a pool of light)
// (a shadow: one flat tone with a soft step at its edge; a pool of light: falls away from the middle)
const MARK_FRAG = 'precision mediump float; uniform float uAlpha; uniform float uHard; uniform vec3 uColor; varying vec2 vUv; void main(){ float r = length(vUv - 0.5) * 2.0; float a = mix(1.0 - smoothstep(0.2, 1.0, r), 1.0 - smoothstep(0.78, 0.92, r), uHard) * uAlpha; if (a < 0.01) discard; gl_FragColor = vec4(uColor, a); }';

/**
 * The cel body shader: three flat tones (a: the coloured shadow, b: the body, c: the lit crown),
 * highlights as shapes; options for facets (crystal), puffs (cloud balls), thin-film shimmer.
 * Opaque, and it writes the hero's ink id, so the ink pass outlines it.
 */
export function bodyMaterial(o) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uWobble: { value: o.wobble || 0 }, uLean: { value: new THREE.Vector2() },
      uHeight: { value: o.height || 0.8 }, uRipple: { value: o.ripple || 0 },
      uColA: { value: new THREE.Color(o.a) }, uColB: { value: new THREE.Color(o.b) }, uColC: { value: new THREE.Color(o.c === undefined ? o.b : o.c) },
      uLightDir: { value: new THREE.Vector3(0.3, 0.8, 0.5) }, uFacet: { value: o.facet ? 1 : 0 },
      uIrid: { value: o.irid || 0 }, uFlash: { value: 0 }, uInk: { value: o.ink === undefined ? INK.hero : o.ink },
    },
    vertexShader: o.puff ? PUFF_VERT : BODY_VERT, fragmentShader: o.puff ? PUFF_FRAG : BODY_FRAG,
    fog: false, toneMapped: false,
  });
}

export function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
export const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Face turning, radians away from "straight at the camera". TURN: the most the face turns toward the
// way the hero is going (three-quarter view: both eyes stay on the near side). AWAY: the
// over-the-shoulder look while running away from the camera. IDLE: how far it may look off to one side while standing.
const TURN = 0.55, AWAY = 0.6, IDLE_LOOK = 0.6;
// Seconds the hero keeps facing its last heading after it stops, before the idle gaze cycle
// (glancing at the camera or at something nearby) is allowed to turn the face.
const IDLE_FACE_HOLD = 1.5;

const C = { sim: null, p: null, form: '', dt: 0, time: 0, sp: 0, idle: false, rm: false, lvx: 0, lvz: 0, x: 0, y: 0, z: 0, P: null };
const MOOD = { frozen: false, lowGauge: false, low: 0, order: 11 };
const FACE = { ey: 0.3, ez: 0.3, ex: 0.15, tilt: 0, es: 1, toe: 0.4 };
const MARK = { size: 0.95, alpha: 0.55 };

export class HeroView {
  /**
   * @param particles, prints  the shared particle and print systems
   * @param cfg { forms: [four form names], formColors: { form: [r,g,b] }, lid: { form: hex },
   *              eye: { w, h, d (half-extents, m), white, iris, dark, outline (hex) },
   *              ghost: hex (see-through silhouette), turn: { form: rate } (how fast the body turns; default 12),
   *              mark: { color: hex, additive: bool } }
   */
  constructor(particles, prints, cfg, flames = null) {
    this.particles = particles; this.prints = prints; this.cfg = cfg; this.flames = flames;
    this.group = new THREE.Group();          // positioned at the hero; not rotated
    this.bodyRoot = new THREE.Group();       // turns with the direction of travel
    this.group.add(this.bodyRoot);
    this.bodies = {};
    this.blend = {};
    for (const f of cfg.forms) this.blend[f] = f === cfg.forms[0] ? 1 : 0;
    this.timed = [];                         // materials that take uTime / uFlash / uLightDir every frame
    this.spring = 0; this.springV = 0;
    this.yaw = 0; this.blinkT = 2; this.blink = 0; this.dblBlink = false;
    this.lean = new THREE.Vector2();
    this.lastPrint = new THREE.Vector3(1e9, 0, 0);
    this.emitAcc = 0; this.pop = 1; this.popT = 1;
    this.pos = new THREE.Vector3();
    this.camDist = 8;                        // metres from the camera (a big bright body shrinks when the camera is squeezed right up to it)
    this.reduced = false;
    this.flash = 0; this.ringT = 1;
    // gaze
    this.eyeYaw = 0; this.idleT = 0; this.gazeMode = 'travel'; this.gazeT = 0; this.gazeSide = 1;
    this.glanceT = 1.6; this.glance = 0;       // moving away: time to the next glance back, and how long this one lasts
    this.eyeBoost = 1;
    this.squint = 0; this.wide = 0; this.happy = 0; this.lidAmt = 0; this.lowAmt = 0;
    this.pupil = new THREE.Vector2();
    this.wasGrounded = true;
    // See-through silhouette: each body is drawn a second time only where something hides it
    // (depth test "greater"), so the hero can always be found - behind a wall, under a low gap.
    this.ghostMat = new THREE.MeshBasicMaterial({ color: cfg.ghost, transparent: true, opacity: 0.42, depthFunc: THREE.GreaterDepth, depthWrite: false, fog: false, toneMapped: false });
  }

  /**
   * Register a form's body. opts: shadow (default true), ghost: 'all' | 'first' (only its first mesh
   * gets a silhouette; a cluster of puffs would cost a draw each) | 'none', ghostScale (default 1.07:
   * just outside a wobbling body so it never tints the hero itself).
   */
  addBody(form, body, { shadow = true, ghost = 'all', ghostScale = 1.07 } = {}) {
    const meshes = [];
    body.traverse((o) => { if (o.isMesh || o.isLine) { o.castShadow = shadow && !o.userData.noShadow && o.isMesh; o.frustumCulled = false; if (!o.userData.noGhost && o.isMesh && !o.isInstancedMesh) meshes.push(o); } });
    for (const m of (ghost === 'none' ? [] : ghost === 'first' ? meshes.slice(0, 1) : meshes)) {
      const g = new THREE.Mesh(m.geometry, this.ghostMat);
      g.renderOrder = 30; g.frustumCulled = false;
      g.scale.setScalar(ghostScale);
      m.add(g);
    }
    this.bodies[form] = body;
    this.bodyRoot.add(body);
  }

  /** Build the face, the form-change ring and the ground mark. Call at the end of the subclass constructor. */
  finish() {
    const cfg = this.cfg, E = cfg.eye;
    for (const f of cfg.forms) if (!this.bodies[f]) throw new Error(`hero: no body for form "${f}"`);
    // --- eyes: two rigs (position, turn, size) and ONE instanced draw for the pair
    const eyeGeo = new THREE.SphereGeometry(1, 16, 12);
    this.eyeMat = new THREE.ShaderMaterial({
      uniforms: {
        uPupil: { value: new THREE.Vector2() }, uLid: { value: 0 }, uLow: { value: 0 }, uPupilSize: { value: 1 }, uLidCol: { value: new THREE.Color(cfg.lid[cfg.forms[0]]) },
        uWhite: { value: new THREE.Vector3(...E.white) }, uIris: { value: new THREE.Vector3(...E.iris) },
        uDark: { value: new THREE.Vector3(...E.dark) }, uOutline: { value: new THREE.Vector3(...E.outline) },
      },
      vertexShader: EYE_VERT, fragmentShader: EYE_FRAG, fog: false, toneMapped: false,
    });
    this.eyeMats = [this.eyeMat];
    this.eyes = new THREE.Group();
    this.eyeMeshes = [];
    for (const sx of [-1, 1]) {
      const e = new THREE.Object3D();
      e.scale.set(E.w, E.h, E.d);
      e.userData.side = sx;
      this.eyes.add(e); this.eyeMeshes.push(e);
    }
    this.eyeInst = new THREE.InstancedMesh(eyeGeo, this.eyeMat, 2);
    this.eyeInst.frustumCulled = false;
    this.eyes.add(this.eyeInst);
    // the pivot turns the whole face round the body; the eyes group is offset onto the surface
    this.eyePivot = new THREE.Group();
    this.eyePivot.add(this.eyes);
    this.group.add(this.eyePivot);

    // --- form-change ring on the ground
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color() }, uT: { value: 1 } },
      vertexShader: MARK_VERT,
      fragmentShader: RING_FRAG,
      transparent: true, depthWrite: false, premultipliedAlpha: true, toneMapped: false, fog: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }));
    this.ring.visible = false; this.ring.renderOrder = 7; this.ring.frustumCulled = false;

    // --- the mark straight below: always on, because judging a 3D jump needs it
    const mk = cfg.mark || { color: [0.03, 0.1, 0.2], additive: false };
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      uniforms: { uAlpha: { value: 0.5 }, uHard: { value: mk.additive ? 0 : 1 }, uColor: { value: new THREE.Vector3(...mk.color) } },
      vertexShader: MARK_VERT,
      fragmentShader: MARK_FRAG,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: false, toneMapped: false,
      blending: mk.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    this.blob.renderOrder = 6;
    this.blob.frustumCulled = false;
  }

  /** Everything the renderer must add to (or take out of) the scene for this hero. */
  get sceneObjects() { return [this.blob, this.group, this.ring]; }

  snap(sim) {
    const p = sim.player;
    this.pos.set(p.x, p.y, p.z);
    this.yaw = p.facing; this.eyeYaw = p.facing;
    for (const k of Object.keys(this.blend)) this.blend[k] = k === p.form ? 1 : 0;
    this.spring = this.springV = 0; this.pop = 0; this.popT = 0;
    this.lastPrint.set(1e9, 0, 0);
    this.lean.set(0, 0);
    this.flash = 0; this.ringT = 1; this.ring.visible = false;
    this.idleT = 0; this.gazeMode = 'travel'; this.happy = 0; this.squint = 0; this.wide = 0;
    this.glanceT = 1.6; this.glance = 0;
  }

  /** React to sim events (called once per event). */
  onEvent(e, sim) {
    const P = this.particles, p = sim.player;
    this.heroEvent(e, sim, P, p);
    if (e.type === 'respawn') {
      this.pop = 0; this.popT = 0;
      this.blink = 0.35;
    } else if (e.type === 'shard') {
      this.wide = 1; this.flash = Math.max(this.flash, this.reduced ? 0.15 : 0.35);
    } else if (e.type === 'complete') {
      this.happy = 1;
    }
  }

  /** Start the ground ring in a form's colour (call from heroEvent on a form change). */
  startRing(col) { this.ringT = 0; this.ring.material.uniforms.uColor.value.setRGB(col[0], col[1], col[2]); }

  /** Pick what the hero is looking at: the camera, the way it is going, or something nearby. */
  _gaze(sim, dt, x, y, z, sp, camAz) {
    const p = sim.player, rm = this.reduced;
    let target = p.facing, ty = 0, rel;
    if (sp > 0.6 || !p.grounded) {
      this.idleT = 0; this.gazeMode = 'travel';
      // Moving: the face ALWAYS points the way the hero is going - including straight away from the
      // camera, where the player sees the back of its head. (An earlier version kept the face turned
      // toward the camera while moving; players read that as the hero facing the wrong way.)
      const r = wrap(p.facing - camAz);
      if (Math.abs(r) > 0.05) this.gazeSide = r >= 0 ? 1 : -1;
      rel = r;
      this.glance = 0; this.glanceT = 1.6; this.gazeT = 0;
    } else if (this.idleT < IDLE_FACE_HOLD) {
      // just stopped: keep facing the way it was going for a moment before the idle gaze cycle starts
      this.idleT += dt; this.gazeMode = 'travel';
      rel = wrap(p.facing - camAz);
    } else {
      this.idleT += dt; this.gazeT -= dt;
      if (this.gazeT <= 0) {
        // cycle: glance at the camera, look at something interesting, back at the camera...
        const thing = this._interest(sim, x, y, z);
        if (this.gazeMode !== 'camera') { this.gazeMode = 'camera'; this.gazeT = 1.6 + this.particles.rnd() * 1.8; }
        else if (thing) { this.gazeMode = 'thing'; this.gazeThing = thing; this.gazeT = 1.2 + this.particles.rnd(); }
        else { this.gazeMode = 'around'; this.gazeAround = camAz + (this.particles.rnd() < 0.5 ? -0.9 : 0.9); this.gazeT = 0.9; }
      }
      if (this.gazeMode === 'camera') target = camAz;
      else if (this.gazeMode === 'thing' && this.gazeThing) { const t = this.gazeThing; target = Math.atan2(t[0] - x, t[2] - z); ty = Math.max(-1, Math.min(1, (t[1] - y - 0.4) / Math.max(1, Math.hypot(t[0] - x, t[2] - z)))); }
      else if (this.gazeMode === 'around') target = this.gazeAround;
    }
    if (sim.completed) {
      // the level-complete celebration is the one time the hero turns to face the player
      target = camAz;
      rel = Math.max(-IDLE_LOOK, Math.min(IDLE_LOOK, wrap(target - camAz)));
    } else if (rel === undefined) {
      // standing still: the FACE stays on the heading it stopped on; only the pupils wander toward
      // whatever the gaze cycle picked (below). The face never swings round to the camera in play.
      rel = wrap(p.facing - camAz);
    }
    const clamped = camAz + rel;
    const k = Math.min(1, dt * (this.gazeMode === 'travel' ? 8 : 6));
    this.eyeYaw += wrap(clamped - this.eyeYaw) * k;
    // pupils keep looking the rest of the way the face could not turn
    const rest = wrap(target - this.eyeYaw);
    const px = Math.max(-0.32, Math.min(0.32, rest * 0.3)), py = Math.max(-0.28, Math.min(0.3, ty * 0.3 + Math.max(-1, Math.min(1, p.vy * 0.08)) * 0.2));
    this.pupil.x += (px - this.pupil.x) * Math.min(1, dt * 14);
    this.pupil.y += (py - this.pupil.y) * Math.min(1, dt * 14);
  }

  /** Nearest thing worth a look within a few metres (an untaken collectible, a plate, a post, the exit ...). */
  _interest(sim, x, y, z) {
    const L = sim.level;
    let best = null, bd = 36;
    const consider = (pos) => { const d = (pos[0] - x) ** 2 + (pos[2] - z) ** 2 + ((pos[1] - y) * 0.5) ** 2; if (d < bd && d > 0.5) { bd = d; best = pos; } };
    for (const s of L.shards) if (!s.taken) consider(s.pos);
    for (const pl of L.plates) consider(pl.pos);
    for (const c of L.checkpoints) if (!c.current) consider(c.pos);
    for (const e of L.exits) consider([e.pos[0], e.pos[1] + 1, e.pos[2]]);
    for (const s of L.sprouts) if (s.state === 0) consider(s.pos);
    this.interests(L, consider);
    return best;
  }

  // ------------------------------------------------------------------ hooks (defaults)
  hide() {}
  shimmer() { return null; }
  interests() {}
  poseBody(k, body, s) { body.scale.setScalar(s); }
  afterBodies() {}
  face() { return FACE; }
  mood(form, p) { MOOD.frozen = false; MOOD.lowGauge = false; MOOD.low = 0; MOOD.order = 11; return MOOD; }
  trails() {}
  heroEvent() {}
  groundMark(form, h) { MARK.size = 0.95 * (1 - Math.min(0.55, h * 0.06)); MARK.alpha = 0.55 * (1 - Math.min(0.6, h * 0.05)); return MARK; }
  light(form) { const c = this.cfg.formColors[form]; return { color: c, power: 14 }; }

  update(sim, alpha, dt, time, lightDirView, camera) {
    const p = sim.player, P = this.particles;
    const x = p.px + (p.x - p.px) * alpha, y = p.py + (p.y - p.py) * alpha, z = p.pz + (p.z - p.pz) * alpha;
    this.pos.set(x, y, z);
    this.group.position.copy(this.pos);
    const form = p.form;
    const sp = Math.hypot(p.vx, p.vz);
    const rm = this.reduced;

    // facing (shortest-arc smoothing)
    let d = p.facing - this.yaw; d = wrap(d);
    this.yaw += d * Math.min(1, dt * ((this.cfg.turn && this.cfg.turn[form]) || 12));
    this.bodyRoot.rotation.y = this.yaw;

    // pop-in after a respawn / pop-out into the exit
    if (sim.completed) this.popT = Math.max(0, this.popT - dt * 1.6);
    else if (p.respawnT <= 0.25) this.popT = Math.min(1, this.popT + dt * 4);
    this.pop = sim.completed ? this.popT * this.popT : easeOutBack(this.popT);

    // spring for squash & stretch
    this.springV += (-190 * this.spring - 11 * this.springV) * dt;
    this.spring += this.springV * dt;
    if (!(this.spring > -0.6)) this.spring = -0.6; if (this.spring > 0.6) this.spring = 0.6;
    this.flash = Math.max(0, this.flash - dt * 4);
    const idle = p.grounded && sp < 0.3;

    // the body's own frame: world velocity as the body sees it
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const c = C;
    c.sim = sim; c.p = p; c.form = form; c.dt = dt; c.time = time; c.sp = sp; c.idle = idle; c.rm = rm;
    c.lvx = p.vx * cy - p.vz * sy; c.lvz = p.vx * sy + p.vz * cy; c.x = x; c.y = y; c.z = z; c.P = P;

    // cross-morph between forms
    for (const k of Object.keys(this.blend)) {
      const target = k === form ? 1 : 0;
      const b = this.blend[k] + Math.sign(target - this.blend[k]) * Math.min(Math.abs(target - this.blend[k]), dt * (target ? 6.5 : 9));
      this.blend[k] = b;
      const body = this.bodies[k];
      body.visible = b > 0.02 && this.pop > 0.01;
      if (!body.visible) continue;
      const s = (target ? easeOutBack(b) : b) * this.pop;
      this.poseBody(k, body, s, target, b, c);
    }

    for (const m of this.timed) {
      m.uniforms.uTime.value = time;
      m.uniforms.uFlash.value = this.flash;
      if (lightDirView && m.uniforms.uLightDir) m.uniforms.uLightDir.value.copy(lightDirView);
    }
    this.afterBodies(c);

    // ---------------------------------------------------------------- eyes
    let camAz = this.eyeYaw;
    if (camera) camAz = Math.atan2(camera.position.x - x, camera.position.z - z);
    // keep the eyes legible when the camera sits far back (portrait phones): a little bigger with distance
    if (camera) {
      const cd = Math.hypot(camera.position.x - x, camera.position.y - y, camera.position.z - z);
      this.camDist = cd;
      this.eyeBoost += ((1 + Math.max(0, Math.min(0.28, (cd - 7.6) * 0.12))) - this.eyeBoost) * Math.min(1, dt * 4);
    }
    this._gaze(sim, dt, x, y, z, sp, camAz);
    this.eyePivot.rotation.y = this.eyeYaw;

    // blinks (sometimes a double blink)
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blink = 0.13;
      this.dblBlink = !this.dblBlink && P.rnd() < 0.25;
      this.blinkT = this.dblBlink ? 0.28 : 2.2 + P.rnd() * 3.2;
    }
    if (this.blink > 0) this.blink -= dt;
    this.squint = Math.max(0, this.squint - dt * 3);
    this.wide = Math.max(0, this.wide - dt * 1.5);
    if (!sim.completed) this.happy = Math.max(0, this.happy - dt);
    // mood: frozen = eyes held open and still (inside a crystal); lowGauge = worried lids; low = extra lower lid
    const M = this.mood(form, p, c);
    const frozen = M.frozen, falling = !p.grounded && p.vy < -7;
    let lid = this.blink > 0 && !frozen ? 1 : Math.max(this.squint * 0.45, M.lowGauge ? 0.32 : 0);
    if (falling) lid = 0;
    let low = this.happy * 0.55 + M.low;
    if (frozen) { lid = 0.08; low = 0; }
    this.lidAmt += (lid - this.lidAmt) * Math.min(1, dt * 30);
    this.lowAmt += (low - this.lowAmt) * Math.min(1, dt * 10);
    const pupilSize = 1 + this.wide * 0.25 + (falling ? 0.2 : 0) - this.happy * 0.1;

    // where the face sits on the body showing (eyes-group local: +z is the way the face looks)
    const Fc = this.face(form, c);
    const E = this.eyes, ke = Math.min(1, dt * 14), EC = this.cfg.eye;
    E.position.y += (Fc.ey - E.position.y) * ke;
    E.position.z += (Fc.ez - E.position.z) * ke;
    E.rotation.x += (Fc.tilt - E.rotation.x) * Math.min(1, dt * 12);
    E.visible = this.pop > 0.3;
    const pe = Math.min(1, this.pop) * Fc.es * (1 + this.wide * 0.12) * this.eyeBoost;
    const lidCol = this.cfg.lid[form];
    const ex = Fc.ex, toe = Fc.toe, order = M.order;
    void order;
    this.eyeMeshes.forEach((e, i) => {
      const sx = e.userData.side;
      e.position.x += (sx * ex - e.position.x) * ke;
      e.rotation.y = sx * toe;
      e.scale.set(EC.w * pe, EC.h * pe * (falling ? 1.12 : 1), EC.d * pe);
      e.updateMatrix();
      this.eyeInst.setMatrixAt(i, e.matrix);
    });
    this.eyeInst.instanceMatrix.needsUpdate = true;
    {
      const u = this.eyeMat.uniforms;
      u.uLid.value = this.lidAmt; u.uLow.value = this.lowAmt; u.uPupilSize.value = pupilSize;
      if (!frozen) u.uPupil.value.copy(this.pupil);
      u.uLidCol.value.setHex(lidCol);
    }

    // ---------------------------------------------------------------- form-change ring
    if (this.ringT < 1) {
      this.ringT = Math.min(1, this.ringT + dt * (rm ? 3 : 2.2));
      const r = rm ? 1.4 : 0.4 + this.ringT * 2.4;
      this.ring.visible = true;
      this.ring.position.set(x, y + 0.04, z);
      this.ring.scale.set(r, 1, r);
      this.ring.material.uniforms.uT.value = this.ringT;
    } else this.ring.visible = false;

    // --- trails
    if (!sim.completed && p.respawnT <= 0) {
      this.emitAcc += dt;
      this.trails(c);
    }
    this.wasGrounded = p.grounded;

    // --- the mark straight below
    const drop = sim.raycast(x, y + 0.3, z, 0, -1, 0, 30, (s) => !s.oneWay || s.active);
    if (drop < 30 && this.pop > 0.2) {
      const h = Math.max(0, drop - 0.3);
      const mk = this.groundMark(form, h, c);
      this.blob.visible = true;
      this.blob.position.set(x, y - h + 0.02, z);
      this.blob.scale.set(mk.size, 1, mk.size);
      this.blob.material.uniforms.uAlpha.value = mk.alpha;
    } else this.blob.visible = false;
  }
}
