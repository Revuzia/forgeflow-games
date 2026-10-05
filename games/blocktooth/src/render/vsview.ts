// BLOCKTOOTH ONLINE VS — the in-world VS overlays (lane B-VIEW; vs_design.md §5, §12).
//
//   * SEAT RINGS   four flat rings under the titans in the seat colours (coral / sky / amber / violet), independent of
//                  the titan palettes so duplicate titans read. The local seat wears a second, wider ring. A ring
//                  never gets thinner than ~1.4 % of the screen height (a 5 m titan under a 60 m camera keeps a
//                  visible footprint). Rule tells ride the ring: the white CLEARED flash (CC immunity), a blink under
//                  spawn protection, a gold outer ring on the FRONT PAGE holder.
//   * CROWN BEAM   a gold light shaft over the FRONT PAGE holder, drawn THROUGH buildings (depth test off): everyone
//                  can find the leader.
//   * CORDON       the CONDEMNATION ORDER ring: a red cordon line on the road + a hazard hatch outside it (one
//                  world-space shader plane, radius = World.vs.ring.r, so the 20 s shrink steps animate for free).
//   * TENDER PILLAR the amber shaft + pulsing ground ring where a PUBLIC TENDER will arrive (marker phase).
//   * frame()      the projected anchors the DOM layer (ui/vshud.ts) draws nameplates, edge arrows and tender chips
//                  from: head anchor, on-screen flag, clamped edge point + angle, on-screen body height.
//
// Reads the sim (World.players[i], World.vs), never writes it. Does nothing in solo (the root stays hidden).

import * as THREE from 'three';
import type { World } from '../core/types.ts';
import type { FrameInfo, ViewCtx, ViewModule } from './viewtypes.ts';
import { VS } from '../core/config.ts';
import { hexToRgb, type VsAnchor, type VsFrame, type VsTenderAnchor } from '../ui/vstypes.ts';

const K = 2 * Math.tan((30 * Math.PI) / 360);
const MAX_SEATS = 4;
const MAX_TENDERS = 3;
const ENEMY_RING_CAP = 280;
const GOLD = '#ffd166';
const WHITE = '#ffffff';

const CORDON_VERT = /* glsl */ `
varying vec2 vW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const CORDON_FRAG = /* glsl */ `
uniform vec2 uC;
uniform float uR;
uniform float uLine;
uniform float uA;
uniform float uT;
uniform vec3 uCol;
varying vec2 vW;
void main() {
  float d = length(vW - uC);
  float outside = smoothstep(uR - uLine * 0.4, uR + uLine * 0.4, d);
  float stripe = step(0.5, fract((vW.x + vW.y) / (uLine * 7.0)));
  float edge = 1.0 - smoothstep(uLine * 0.45, uLine, abs(d - uR));
  float pulse = 0.82 + 0.18 * sin(uT * 4.0);
  float a = outside * (0.10 + 0.13 * stripe) + edge * 0.92 * pulse;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uCol, a * uA);
  #include <colorspace_fragment>
}`;

const _v = new THREE.Vector4();
const _size = new THREE.Vector2();

function lerpPose(a: number, b: number, t: number): number { return a + (b - a) * t; }

export class VsView implements ViewModule {
  private readonly ctx: ViewCtx;
  private readonly root = new THREE.Group();
  private rings: THREE.Mesh[] = [];
  private rings2: THREE.Mesh[] = [];
  private ringMats: THREE.MeshBasicMaterial[] = [];
  private ring2Mats: THREE.MeshBasicMaterial[] = [];
  private ringGeo: THREE.BufferGeometry | null = null;
  private beamGeo: THREE.BufferGeometry | null = null;
  private crownBeam: THREE.Mesh | null = null;
  private crownMat: THREE.MeshBasicMaterial | null = null;
  private pillars: THREE.Mesh[] = [];
  private pillarRings: THREE.Mesh[] = [];
  private pillarMat: THREE.MeshBasicMaterial | null = null;
  private pillarRingMat: THREE.MeshBasicMaterial | null = null;
  private enemyRings: THREE.InstancedMesh | null = null;
  private enemyMat: THREE.MeshBasicMaterial | null = null;
  private readonly seatCol: THREE.Color[] = [];
  private readonly em = new THREE.Matrix4();
  private readonly eq = new THREE.Quaternion();
  private readonly ep = new THREE.Vector3();
  private readonly es = new THREE.Vector3();
  private cordon: THREE.Mesh | null = null;
  private cordonMat: THREE.ShaderMaterial | null = null;
  private cordonGeo: THREE.BufferGeometry | null = null;
  private mounted = false;
  private time = 0;
  private readonly out: VsFrame = { seats: [], tenders: [] };
  private readonly col = new THREE.Color();

  constructor(ctx: ViewCtx) {
    this.ctx = ctx;
    this.root.name = 'view:vs';
    for (let i = 0; i < MAX_SEATS; i++) this.out.seats.push({ slot: i, x: 0, y: 0, onScreen: false, angle: 0, distM: 0, pxH: 0, live: false });
    for (let i = 0; i < MAX_TENDERS; i++) this.out.tenders.push({ gate: '', state: '', x: 0, y: 0, onScreen: false, angle: 0, distM: 0 });
  }

  /** the pooled projected frame for the DOM layer (read it this frame, do not keep it) */
  frame(): VsFrame { return this.out; }

  mount(w: World): void {
    this.unmount();
    this.root.visible = false;
    this.out.seats.length = 0;
    this.out.tenders.length = 0;
    if (w.mode !== 'vs') { this.ctx.scene.add(this.root); return; }
    for (let i = 0; i < MAX_SEATS; i++) this.out.seats.push({ slot: i, x: 0, y: 0, onScreen: false, angle: 0, distM: 0, pxH: 0, live: false });
    for (let i = 0; i < MAX_TENDERS; i++) this.out.tenders.push({ gate: '', state: '', x: 0, y: 0, onScreen: false, angle: 0, distM: 0 });

    const g = new THREE.RingGeometry(0.8, 1, 56, 1);
    g.rotateX(-Math.PI / 2);
    this.ringGeo = g;
    const mk = (hex: string, op: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({
      color: hex, transparent: true, opacity: op, depthWrite: false, fog: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
    });
    for (let i = 0; i < MAX_SEATS; i++) {
      const hex = VS.seatColors[i] ?? '#ffffff';
      const m1 = mk(hex, 0.92), m2 = mk(hex, 0.5);
      const r1 = new THREE.Mesh(g, m1), r2 = new THREE.Mesh(g, m2);
      for (const r of [r1, r2]) { r.frustumCulled = false; r.renderOrder = 3; r.visible = false; r.castShadow = false; r.receiveShadow = false; this.root.add(r); }
      r1.name = 'vs:ring' + i; r2.name = 'vs:ring2_' + i;
      this.rings.push(r1); this.rings2.push(r2); this.ringMats.push(m1); this.ring2Mats.push(m2);
    }

    // unit light shaft (base y 0, top y 1) with an alpha gradient in the vertex colours
    const bg = new THREE.CylinderGeometry(1, 1, 1, 18, 1, true);
    bg.translate(0, 0.5, 0);
    const pos = bg.getAttribute('position');
    const col = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      col[i * 4] = 1; col[i * 4 + 1] = 1; col[i * 4 + 2] = 1;
      col[i * 4 + 3] = 0.62 * (1 - y) * (1 - y) + 0.04;
    }
    bg.setAttribute('color', new THREE.BufferAttribute(col, 4));
    this.beamGeo = bg;
    this.crownMat = new THREE.MeshBasicMaterial({
      color: GOLD, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
      side: THREE.DoubleSide, fog: false,
    });
    const cb = new THREE.Mesh(bg, this.crownMat);
    cb.name = 'vs:crown'; cb.frustumCulled = false; cb.renderOrder = 12; cb.visible = false;
    this.crownBeam = cb;
    this.root.add(cb);

    this.pillarMat = new THREE.MeshBasicMaterial({
      color: '#ffb12e', vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
      side: THREE.DoubleSide, fog: false,
    });
    this.pillarRingMat = mk('#ffb12e', 0.9);
    for (let i = 0; i < MAX_TENDERS; i++) {
      const p = new THREE.Mesh(bg, this.pillarMat);
      p.name = 'vs:tender' + i; p.frustumCulled = false; p.renderOrder = 11; p.visible = false;
      const r = new THREE.Mesh(g, this.pillarRingMat);
      r.name = 'vs:tenderRing' + i; r.frustumCulled = false; r.renderOrder = 3; r.visible = false;
      this.root.add(p, r);
      this.pillars.push(p); this.pillarRings.push(r);
    }

    // Civil Defense seat rings: every unit wears a thin ring in the colour of the titan it is assigned to (vs_design.md §8)
    this.enemyMat = new THREE.MeshBasicMaterial({
      color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false, fog: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -5,
    });
    const er = new THREE.InstancedMesh(g, this.enemyMat, ENEMY_RING_CAP);
    er.name = 'vs:enemyRings'; er.frustumCulled = false; er.renderOrder = 3; er.count = 0; er.visible = false;
    er.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    er.setColorAt(0, this.col.set('#ffffff'));
    this.enemyRings = er;
    this.root.add(er);
    this.seatCol.length = 0;
    for (let i = 0; i < MAX_SEATS; i++) this.seatCol.push(new THREE.Color(VS.seatColors[i] ?? '#ffffff'));

    // cordon plane (world space, centred on the origin; the shader positions the ring)
    const pg = new THREE.PlaneGeometry(6000, 6000);
    pg.rotateX(-Math.PI / 2);
    this.cordonGeo = pg;
    this.cordonMat = new THREE.ShaderMaterial({
      name: 'vsCordon', vertexShader: CORDON_VERT, fragmentShader: CORDON_FRAG,
      uniforms: {
        uC: { value: new THREE.Vector2(0, 0) }, uR: { value: 1e5 }, uLine: { value: 1.5 }, uA: { value: 1 }, uT: { value: 0 },
        uCol: { value: new THREE.Color('#ff3b3b') },
      },
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3,
    });
    const cm = new THREE.Mesh(pg, this.cordonMat);
    cm.name = 'vs:cordon'; cm.frustumCulled = false; cm.renderOrder = 2; cm.position.y = 0.07; cm.visible = false;
    this.cordon = cm;
    this.root.add(cm);

    this.ctx.scene.add(this.root);
    this.mounted = true;
  }

  update(w: World, f: FrameInfo): void {
    if (!this.mounted || w.mode !== 'vs' || !w.vs) { this.root.visible = false; return; }
    this.root.visible = true;
    const dt = f.frozen ? 0 : Math.min(0.1, f.dt);
    this.time += dt;
    const a = Math.max(0, Math.min(1, f.alpha));
    const ext = Math.max(1, f.camDist * K);
    const VSW = w.vs;
    const cam = this.ctx.camera;
    this.ctx.renderer.getSize(_size);
    const W = Math.max(1, _size.x), Hh = Math.max(1, _size.y);
    const u = Math.max(8, Math.min(W / 100, (Hh * 1.7778) / 100));
    cam.updateMatrixWorld();
    const follow = w.players[Math.max(0, w.cur)] ?? w.players[0];
    const fT = follow.titan;
    const fx = lerpPose(fT.px, fT.x, a), fz = lerpPose(fT.pz, fT.z, a);

    // ── seat rings + the seat anchors ──
    const crown = VSW.phase === 'takeover' || VSW.phase === 'final' || VSW.phase === 'last' ? VSW.crown : -1;
    for (let i = 0; i < MAX_SEATS; i++) {
      const ring = this.rings[i], ring2 = this.rings2[i];
      const an = this.out.seats[i];
      const P = w.players[i];
      if (!P) { ring.visible = false; ring2.visible = false; if (an) an.live = false; continue; }
      const T = P.titan;
      let ia = a;
      if (a < 1 && Math.hypot(T.x - T.px, T.z - T.pz) > Math.max(25, 6 * T.height)) ia = 1;   // a respawn teleport, not a walk
      const x = lerpPose(T.px, T.x, ia), z = lerpPose(T.pz, T.z, ia);
      const live = T.alive && !P.vs.eliminated;
      const r = Math.max(T.radius * 1.5, ext * 0.014);
      ring.visible = live;
      if (live) {
        ring.position.set(x, 0.09, z);
        ring.scale.set(r, 1, r);
        const m = this.ringMats[i];
        const cleared = P.vs.clearedT > 0, prot = P.vs.spawnProtT > 0;
        if (cleared) m.color.set(WHITE); else m.color.set(VS.seatColors[i] ?? '#ffffff');
        m.opacity = prot ? 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(this.time * 18)) : cleared ? 1 : 0.92;
        const isCrown = i === crown;
        const isLocal = i === w.view;
        ring2.visible = isCrown || isLocal;
        if (ring2.visible) {
          ring2.position.set(x, 0.085, z);
          const k = isCrown ? 1.5 : 1.28;
          ring2.scale.set(r * k, 1, r * k);
          this.ring2Mats[i].color.set(isCrown ? GOLD : VS.seatColors[i] ?? '#ffffff');
          this.ring2Mats[i].opacity = isCrown ? 0.8 + 0.2 * Math.sin(this.time * 5) : 0.45;
        }
      } else ring2.visible = false;

      // anchor for the DOM layer: the head of the titan (or its feet when dead / out)
      const hy = live ? T.height * 1.04 : 0;
      this.project(cam, x, hy, z, W, Hh, u, an, fx, fz, x, z);
      an.live = live;
      if (live && an.onScreen) {
        // on-screen body height: head vs feet in px
        _v.set(x, T.height, z, 1).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
        const wv = Math.max(1e-4, Math.abs(_v.w));
        const yHead = (0.5 - (_v.y / wv) * 0.5) * Hh;
        _v.set(x, 0, z, 1).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
        const wv2 = Math.max(1e-4, Math.abs(_v.w));
        const yFoot = (0.5 - (_v.y / wv2) * 0.5) * Hh;
        an.pxH = Math.abs(yFoot - yHead);
      } else an.pxH = 0;
    }

    // ── crown beam ──
    const cb = this.crownBeam;
    if (cb) {
      const holder = crown >= 0 ? w.players[crown] : null;
      if (holder && holder.titan.alive && !holder.vs.eliminated) {
        const T = holder.titan;
        const x = lerpPose(T.px, T.x, a), z = lerpPose(T.pz, T.z, a);
        const hgt = Math.max(30, T.height * 3.4, ext * 0.55);
        const rad = Math.max(T.radius * 0.55, ext * 0.011);
        cb.visible = true;
        cb.position.set(x, 0, z);
        cb.scale.set(rad, hgt, rad);
        if (this.crownMat) this.crownMat.opacity = 0.75 + 0.25 * Math.sin(this.time * 3);
      } else cb.visible = false;
    }

    // ── tender pillars (marker phase) + the tender chips' anchors ──
    for (let i = 0; i < MAX_TENDERS; i++) {
      const T = VSW.tenders[i];
      const p = this.pillars[i], pr = this.pillarRings[i];
      const an = this.out.tenders[i];
      const show = !!T && (T.state === 'marker' || T.state === 'live') && T.markerT >= 0;
      if (!show) { p.visible = false; pr.visible = false; if (an) { an.state = T ? T.state : ''; an.gate = T ? T.gate : ''; an.onScreen = false; an.distM = -1; } continue; }
      const marker = T.state === 'marker';
      p.visible = marker;
      pr.visible = true;
      const hgt = Math.max(50, ext * 0.7);
      p.position.set(T.x, 0, T.z);
      p.scale.set(Math.max(2.2, ext * 0.012), hgt, Math.max(2.2, ext * 0.012));
      const breathe = 0.5 + 0.5 * Math.sin(this.time * 4);
      const base = Math.max(8, ext * 0.05);
      pr.position.set(T.x, 0.1, T.z);
      const rr = marker ? base * (0.8 + 0.5 * breathe) : base * 1.6;
      pr.scale.set(rr, 1, rr);
      if (this.pillarRingMat) this.pillarRingMat.opacity = marker ? 0.55 + 0.4 * breathe : 0.35;
      if (an) {
        an.gate = T.gate; an.state = T.state;
        this.projectTender(cam, T.x, Math.max(14, ext * 0.12), T.z, W, Hh, u, an, fx, fz);
      }
    }

    // ── Civil Defense seat rings (units near the view only) ──
    const er = this.enemyRings;
    if (er) {
      const reach = Math.max(60, ext * 2.4);
      let n = 0;
      const E = w.enemies;
      for (let i = 0; i < E.length && n < ENEMY_RING_CAP; i++) {
        const e = E[i];
        if (!e.alive || e.tslot === undefined || e.tslot < 0 || e.tslot >= MAX_SEATS) continue;
        const x = lerpPose(e.px, e.x, a), z = lerpPose(e.pz, e.z, a);
        if (Math.abs(x - fx) > reach || Math.abs(z - fz) > reach) continue;
        const r = Math.max(e.radius * 1.25, ext * 0.006);
        this.ep.set(x, 0.08, z);
        this.es.set(r, 1, r);
        this.em.compose(this.ep, this.eq.identity(), this.es);
        er.setMatrixAt(n, this.em);
        er.setColorAt(n, this.seatCol[e.tslot]);
        n++;
      }
      er.count = n;
      er.visible = n > 0;
      if (n > 0) { er.instanceMatrix.needsUpdate = true; if (er.instanceColor) er.instanceColor.needsUpdate = true; }
    }

    // ── cordon ──
    const cm = this.cordon, mat = this.cordonMat;
    if (cm && mat) {
      const R = VSW.ring;
      const on = R.step >= 0 && (VSW.phase === 'final' || VSW.phase === 'last' || VSW.phase === 'over') && R.r > 0 && R.r < 5000;
      cm.visible = on;
      if (on) {
        const U = mat.uniforms;
        (U.uC.value as THREE.Vector2).set(R.cx, R.cz);
        U.uR.value = R.r;
        U.uLine.value = Math.max(1.4, ext * 0.0065);
        U.uT.value = this.time;
        U.uA.value = 1;
      }
    }
  }

  /** project a world point to CSS px (the DOM layer's pops); false when it is off screen / behind the camera */
  projectPoint(x: number, y: number, z: number, out: { x: number; y: number }): boolean {
    const cam = this.ctx.camera;
    this.ctx.renderer.getSize(_size);
    const W = Math.max(1, _size.x), Hh = Math.max(1, _size.y);
    cam.updateMatrixWorld();
    _v.set(x, y, z, 1).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
    if (_v.w <= 1e-4) return false;
    const nx = _v.x / _v.w, ny = _v.y / _v.w;
    out.x = (nx * 0.5 + 0.5) * W; out.y = (0.5 - ny * 0.5) * Hh;
    return out.x >= 0 && out.x <= W && out.y >= 0 && out.y <= Hh;
  }

  /** project a world point; fills x / y / onScreen / angle / distM. Edge points keep clear of the seat-card column. */
  private project(cam: THREE.PerspectiveCamera, x: number, y: number, z: number, W: number, Hh: number, u: number,
    out: VsAnchor, fx: number, fz: number, sx: number, sz: number): void {
    _v.set(x, y, z, 1).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
    const behind = _v.w <= 1e-4;
    const aw = Math.max(1e-4, Math.abs(_v.w));
    let nx = _v.x / aw, ny = _v.y / aw;
    if (behind) { nx = -nx; ny = -ny; }
    const px = (nx * 0.5 + 0.5) * W, py = (0.5 - ny * 0.5) * Hh;
    const on = !behind && px >= 0 && px <= W && py >= 0 && py <= Hh;
    out.distM = Math.hypot(sx - fx, sz - fz);
    out.onScreen = on;
    if (on) { out.x = px; out.y = py; out.angle = 0; return; }
    this.edge(px, py, W, Hh, u, out);
  }

  private projectTender(cam: THREE.PerspectiveCamera, x: number, y: number, z: number, W: number, Hh: number, u: number,
    out: VsTenderAnchor, fx: number, fz: number): void {
    _v.set(x, y, z, 1).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
    const behind = _v.w <= 1e-4;
    const aw = Math.max(1e-4, Math.abs(_v.w));
    let nx = _v.x / aw, ny = _v.y / aw;
    if (behind) { nx = -nx; ny = -ny; }
    const px = (nx * 0.5 + 0.5) * W, py = (0.5 - ny * 0.5) * Hh;
    const on = !behind && px >= 0 && px <= W && py >= 0 && py <= Hh;
    out.distM = Math.hypot(x - fx, z - fz);
    out.onScreen = on;
    if (on) { out.x = px; out.y = py; out.angle = 0; return; }
    this.edge(px, py, W, Hh, u, out);
  }

  /** clamp an off-screen point to the screen edge (inset) and keep it off the seat-card column / clock / ticker */
  private edge(px: number, py: number, W: number, Hh: number, u: number, out: { x: number; y: number; angle: number }): void {
    const cx = W / 2, cy = Hh / 2;
    const insL = 3 * u, insR = 3 * u, insT = 6.5 * u, insB = 5 * u;
    let dx = px - cx, dy = py - cy;
    if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = 1;
    const tx = dx >= 0 ? (cx - insR) / Math.max(1e-6, Math.abs(dx)) : (cx - insL) / Math.max(1e-6, Math.abs(dx));
    const ty = dy >= 0 ? (cy - insB) / Math.max(1e-6, Math.abs(dy)) : (cy - insT) / Math.max(1e-6, Math.abs(dy));
    const t = Math.min(tx, ty);
    let ex = cx + dx * t, ey = cy + dy * t;
    // the seat-card column (left, x 1.6u..22.6u, top 4.5u..24u): slide the arrow down / right out of it
    if (ex < 24.5 * u && ey > 3.5 * u && ey < 26.5 * u) { if (dx < 0 && Math.abs(dy) < Math.abs(dx) * 0.4) ey = 28 * u; else ex = 24.5 * u; }
    // the phase bar + clock (top centre) and the bottom panels (status card, ability bar, ACTIVE panel): arrows stop short of them
    if (Math.abs(ex - cx) < 16 * u && ey < 12 * u) ey = 12 * u;
    if (ey > Hh - 16 * u && (ex < 25 * u || Math.abs(ex - cx) < 21 * u || ex > W - 20 * u)) ey = Hh - 16 * u;
    // the KO feed + minimap column (right, top 5.5u..35.5u): arrows stop at its inner edge
    if (ex > W - 26 * u && ey > 5.5 * u && ey < 35.5 * u) ex = W - 26 * u;
    out.x = Number.isFinite(ex) ? ex : cx;
    out.y = Number.isFinite(ey) ? ey : Hh - insB;
    out.angle = Math.atan2(dy, dx);
  }

  unmount(): void {
    this.mounted = false;
    this.root.removeFromParent();
    this.root.clear();
    for (const m of this.ringMats) m.dispose();
    for (const m of this.ring2Mats) m.dispose();
    this.enemyRings?.dispose(); this.enemyMat?.dispose(); this.enemyRings = null; this.enemyMat = null;
    this.crownMat?.dispose(); this.pillarMat?.dispose(); this.pillarRingMat?.dispose(); this.cordonMat?.dispose();
    this.ringGeo?.dispose(); this.beamGeo?.dispose(); this.cordonGeo?.dispose();
    this.rings = []; this.rings2 = []; this.ringMats = []; this.ring2Mats = []; this.pillars = []; this.pillarRings = [];
    this.ringGeo = this.beamGeo = this.cordonGeo = null;
    this.crownMat = this.pillarMat = this.pillarRingMat = null;
    this.crownBeam = null; this.cordon = null; this.cordonMat = null;
  }

  /** the seat colour as 0..255 rgb (HUD tints) */
  static rgb(slot: number): [number, number, number] { return hexToRgb(VS.seatColors[slot] ?? '#ffffff'); }
}
