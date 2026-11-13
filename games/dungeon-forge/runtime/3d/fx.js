/**
 * Dungeon Forge — runtime/3d/fx.js
 * Lightweight particle FX on shared Points pools: hit bursts, bolt trails,
 * torch flames, vent jets, portal swirls and win confetti. One geometry per
 * pool, additive blending, zero allocations per frame.
 */
import * as THREE from "three";

const MAX = 900;

export class Fx {
  constructor(game) {
    this.g = game;
    this.parts = [];         // {p:Vector3, v:Vector3, life, maxLife, size, color}
    this.flames = [];        // {grp, y, theme}
    this.portals = [];
    this.boltMeshes = new Map();
    this._ventT = 0;

    // ── elemental FX state (fire / frost / chain-lightning / poison) ──
    this._fireImpactRings = []; this._fbGeo = null; this._fbRingGeo = null; this._fbTmp = new THREE.Vector3();
    this._frostMeshes = new Map(); this._frostShards = []; this._frostRings = [];
    this._frostGeoCore = null; this._frostGeoGlow = null; this._frostShardGeo = null; this._frx = null;
    this.arcs = [];                                  // chain-lightning arcs
    this._poisonClouds = []; this._pcDiscTex = null; this._pcTmp = new THREE.Vector3();

    const geo = new THREE.BufferGeometry();
    this.posArr = new Float32Array(MAX * 3);
    this.colArr = new Float32Array(MAX * 3);
    this.sizeArr = new Float32Array(MAX);
    geo.setAttribute("position", new THREE.BufferAttribute(this.posArr, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.colArr, 3));
    geo.setAttribute("psize", new THREE.BufferAttribute(this.sizeArr, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
      uniforms: {},
      vertexShader: `attribute float psize; varying vec3 vC; void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=psize*(180.0/-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying vec3 vC; void main(){ vec2 uv=gl_PointCoord-0.5; float d=length(uv); float a=smoothstep(0.5,0.05,d); gl_FragColor=vec4(vC,a); }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 9;
  }

  reset() {
    this.parts.length = 0;
    this.flames.length = 0;
    this.portals.length = 0;
    for (const m of this.boltMeshes.values()) this.g.world.remove(m);
    this.boltMeshes.clear();
    // elemental FX cleanup (avoid orphaned meshes across level rebuilds)
    for (const e of this._frostMeshes.values()) this.g.world.remove(e.grp); this._frostMeshes.clear();
    for (const s of this._frostShards) this.g.world.remove(s.m); this._frostShards.length = 0;
    for (const r of this._frostRings) this.g.world.remove(r.ring); this._frostRings.length = 0;
    for (const r of this._fireImpactRings) this.g.world.remove(r.ring); this._fireImpactRings.length = 0;
    for (const a of this.arcs) this.g.world.remove(a.seg); this.arcs.length = 0;
    for (const pc of this._poisonClouds) { this.g.world.remove(pc.disc); this.g.world.remove(pc.light); } this._poisonClouds.length = 0;
    if (this.points.parent) this.points.parent.remove(this.points);
    this.g.world.add(this.points);
  }

  spawn(pos, vel, life, size, color) {
    if (this.parts.length >= MAX) this.parts.shift();
    this.parts.push({ p: pos.clone(), v: vel, life, maxLife: life, size, color: new THREE.Color(color) });
  }

  burst(pos, color, n = 12, speed = 3.4) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.9, (Math.random() - 0.5)).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      this.spawn(pos, v, 0.4 + Math.random() * 0.35, 1.6 + Math.random() * 1.4, color);
    }
  }

  confetti(pos) {
    const cols = [0xff5566, 0xffd769, 0x59ff9c, 0x37e0ff, 0x8f6bff];
    for (let i = 0; i < 90; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 6, 2 + Math.random() * 5, (Math.random() - 0.5) * 6);
      this.spawn(pos.clone().add(new THREE.Vector3((Math.random() - .5) * 3, -1, (Math.random() - .5) * 3)), v, 1.4 + Math.random(), 2.2, cols[i % cols.length]);
    }
  }

  /** Floating combat number — D&D-style damage feedback. */
  damageNumber(pos, n, color = 0xffd769) {
    const c = document.createElement("canvas"); c.width = 128; c.height = 64;
    const g = c.getContext("2d");
    g.font = "900 44px system-ui"; g.textAlign = "center"; g.textBaseline = "middle";
    g.strokeStyle = "rgba(0,0,0,.9)"; g.lineWidth = 7; g.strokeText(String(n), 64, 32);
    g.fillStyle = "#" + new THREE.Color(color).getHexString(); g.fillText(String(n), 64, 32);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    spr.scale.set(1.5, 0.75, 1);
    spr.position.copy(pos);
    spr.position.x += (Math.random() - 0.5) * 0.5;
    this.g.world.add(spr);
    this.numbers = this.numbers || [];
    this.numbers.push({ spr, life: 0.9 });
  }

  /** Layered elemental impact burst — fire/frost/poison/arcane each read distinct. */
  elementBurst(pos, elem) {
    if (elem === "fire") {
      for (let i = 0; i < 20; i++) {
        const v = new THREE.Vector3((Math.random() - .5), Math.random() * 1.1 + .3, (Math.random() - .5)).normalize().multiplyScalar(2 + Math.random() * 3);
        this.spawn(pos, v, 0.4 + Math.random() * 0.4, 2.4 + Math.random() * 1.6, Math.random() < 0.6 ? 0xff6a1f : 0xffc23a);
      }
      for (let i = 0; i < 8; i++) this.spawn(pos.clone().add(new THREE.Vector3((Math.random() - .5), Math.random() * .6, (Math.random() - .5))), new THREE.Vector3(0, 1.6 + Math.random(), 0), 0.7, 1.6, 0x552200);
      this._flash(pos, 0xff7a1f, 6, 4);
    } else if (elem === "frost") {
      for (let i = 0; i < 18; i++) {
        const v = new THREE.Vector3((Math.random() - .5), Math.random() * 0.9, (Math.random() - .5)).normalize().multiplyScalar(2.4 + Math.random() * 2.4);
        this.spawn(pos, v, 0.5 + Math.random() * 0.35, 2.0 + Math.random() * 1.4, Math.random() < 0.5 ? 0x8fe6ff : 0xd8f6ff);
      }
      this._flash(pos, 0x5ad6ff, 6, 3.5);
    } else if (elem === "poison" || elem === "knife") {
      for (let i = 0; i < 16; i++) {
        const v = new THREE.Vector3((Math.random() - .5), Math.random() * 0.8 + .2, (Math.random() - .5)).normalize().multiplyScalar(1.6 + Math.random() * 2.2);
        this.spawn(pos, v, 0.6 + Math.random() * 0.5, 2.2 + Math.random() * 1.4, Math.random() < 0.5 ? 0x8fe04a : 0x4faa2a);
      }
      this._flash(pos, 0x8fe04a, 5, 3);
    } else {
      this.burst(pos, 0x9a6bff, 12, 3.2);
    }
  }

  /** Expanding ring shockwave for shield bash / crush. */
  shockwave(pos, color) {
    const geo = new THREE.RingGeometry(0.2, 0.5, 28).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(geo, mat);
    ring.position.copy(pos); ring.position.y = pos.y - 0.4;
    this.g.world.add(ring);
    this.rings = this.rings || [];
    this.rings.push({ ring, life: 0.45, max: 0.45 });
  }

  _flash(pos, color, intensity, dist) {
    const l = new THREE.PointLight(color, intensity, dist, 2);
    l.position.copy(pos);
    this.g.world.add(l);
    this.flashes = this.flashes || [];
    this.flashes.push({ l, life: 0.28 });
  }

  attachFlame(grp, theme, y) { this.flames.push({ grp, y, theme }); }
  attachPortal(grp, color) { this.portals.push({ grp, color: new THREE.Color(color), ang: Math.random() * 6 }); }

  ventJet(pos, theme) {
    this._ventT += 1;
    if (this._ventT % 3) return; // throttle
    const col = theme === "scifi" ? 0xff3355 : 0xff7a22;
    this.spawn(pos.clone().add(new THREE.Vector3((Math.random() - .5) * 0.8, 0.2, (Math.random() - .5) * 0.8)),
      new THREE.Vector3(0, 3.5 + Math.random() * 2, 0), 0.5, 2.6, col);
  }

  syncBolts(bolts, floorH, theme) {
    const col = theme === "scifi" ? 0x37e0ff : 0x9a6bff;
    const seen = new Set();
    for (const b of bolts) {
      seen.add(b.id);
      if (b.elem === "frost") { this._frostBolt(b, floorH); continue; } // self-managed icy crystal
      let m = this.boltMeshes.get(b.id);
      if (!m) {
        if (b.elem === "fire") m = this._fireBolt(b.hostile);
        else if (b.elem === "javelin") {
          // a real physical dart: bigger wooden shaft + a GLINTING steel head, laid
          // along its flight dir. A dim warm light + a flight trail (below) make the
          // launch clearly readable across a dark room (owner: "we should see that").
          m = new THREE.Group();
          const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.5, 7).rotateX(Math.PI / 2),
            new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 0.7 }));
          const head = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.42, 7).rotateX(Math.PI / 2),
            new THREE.MeshStandardMaterial({ color: 0xd7dde8, metalness: 0.85, roughness: 0.22, emissive: 0x6a7686, emissiveIntensity: 0.7 }));
          head.position.z = 0.92;
          const fletch = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.34, 0.34),
            new THREE.MeshStandardMaterial({ color: 0xc23a2a, roughness: 0.8 }));
          fletch.position.z = -0.66;
          m.add(shaft, head, fletch);
          m.rotation.y = Math.atan2(b.vx, b.vz);   // +Z model → flight dir
          const jl = new THREE.PointLight(0xffce7a, 1.6, 4.5); m.add(jl);
        } else m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), new THREE.MeshBasicMaterial({ color: b.hostile ? 0xff4444 : col }));
        if (b.elem !== "fire" && b.elem !== "javelin") { const l = new THREE.PointLight(b.hostile ? 0xff4444 : col, 3, 5); m.add(l); }
        this.g.world.add(m);
        this.boltMeshes.set(b.id, m);
      }
      m.position.set(b.x, b.f * floorH + (b.elem === "javelin" ? 0.95 : 1.15), b.z);
      if (b.elem === "fire") this._fireBoltStep(m, b);
      else if (b.elem === "javelin") { if (Math.random() < 0.8) this.spawn(m.position, new THREE.Vector3((Math.random() - .5) * .3, 0.15, (Math.random() - .5) * .3), 0.14, 0.5, 0xd8c9a0); } // dust streak behind the dart
      else if (Math.random() < 0.5) this.spawn(m.position, new THREE.Vector3(0, 0.3, 0), 0.22, 1.4, b.hostile ? 0xff4444 : col);
    }
    for (const [id, m] of this.boltMeshes) if (!seen.has(id)) { this.g.world.remove(m); this.boltMeshes.delete(id); }
    this._frostReap(seen);
  }

  // ── elemental spell FX (built by a multi-agent workflow; see CHANGELOG v1.7.1) ──

  /** Build/update the icy-crystal projectile for one frost bolt. */
  _frostBolt(b, floorH) {
    const M = this._frostMeshes;
    const S = (this._frx ||= { dir: new THREE.Vector3(), up: new THREE.Vector3(0, 0, 1), axis: new THREE.Vector3(0, 0, 1), q: new THREE.Quaternion(), spin: new THREE.Quaternion(), tmp: new THREE.Vector3() });
    let e = M.get(b.id);
    if (!e) {
      if (!this._frostGeoCore) {
        this._frostGeoCore = new THREE.OctahedronGeometry(0.17, 0).scale(0.55, 0.55, 1.9);
        this._frostGeoGlow = new THREE.OctahedronGeometry(0.17, 0).scale(0.95, 0.95, 2.7);
      }
      const grp = new THREE.Group();
      const crystal = new THREE.Mesh(this._frostGeoCore, new THREE.MeshBasicMaterial({ color: 0xbff0ff, transparent: true, opacity: 0.92 }));
      const glow = new THREE.Mesh(this._frostGeoGlow, new THREE.MeshBasicMaterial({ color: 0x6fd6ff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
      const hot = new THREE.Mesh(this._frostGeoCore, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
      hot.scale.setScalar(0.5);
      grp.add(glow, crystal, hot);
      grp.add(new THREE.PointLight(0x8fe6ff, 2.4, 5, 2));
      this.g.world.add(grp);
      e = { grp, spin: Math.random() * 6.28, swirl: Math.random() * 6.28 };
      M.set(b.id, e);
    }
    const y = b.f * floorH + 1.15;
    e.grp.position.set(b.x, y, b.z);
    const vx = b.vx || 0, vz = b.vz || 0, sp = Math.hypot(vx, vz);
    if (sp > 1e-4) { S.dir.set(vx / sp, 0, vz / sp); S.q.setFromUnitVectors(S.up, S.dir); }
    e.spin += 0.4; S.spin.setFromAxisAngle(S.axis, e.spin);
    e.grp.quaternion.copy(S.q).multiply(S.spin);
    e.swirl += 0.9;
    for (let s = 0; s < 2; s++) {
      const a = e.swirl + s * Math.PI, r = 0.32, ox = Math.cos(a) * r, oz = Math.sin(a) * r;
      this.spawn(S.tmp.set(b.x + ox, y + Math.sin(a * 2) * 0.18, b.z + oz), new THREE.Vector3(-ox * 1.4, 0.15, -oz * 1.4), 0.28, 1.3, s ? 0xdff6ff : 0x8fe6ff);
    }
    if (Math.random() < 0.7) {
      const ux = sp > 1e-4 ? vx / sp : 0, uz = sp > 1e-4 ? vz / sp : 0;
      this.spawn(S.tmp.set(b.x - ux * 0.28, y + (Math.random() - 0.5) * 0.14, b.z - uz * 0.28), new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.25, (Math.random() - 0.5) * 0.3), 0.34, 1.5, Math.random() < 0.5 ? 0xcdeeff : 0xffffff);
    }
  }

  _frostReap(seen) {
    for (const [id, e] of this._frostMeshes) {
      if (seen.has(id)) continue;
      this.g.world.remove(e.grp);
      e.grp.traverse(o => { if (o.material) o.material.dispose(); });
      this._frostMeshes.delete(id);
    }
  }

  _frostImpact(pos) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.42, 30).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    ring.position.copy(pos); ring.position.y = pos.y - 0.35;
    this.g.world.add(ring);
    this._frostRings.push({ ring, life: 0.5, max: 0.5 });
    if (!this._frostShardGeo) this._frostShardGeo = new THREE.OctahedronGeometry(0.12, 0).scale(0.5, 0.5, 1.5);
    const upAxis = new THREE.Vector3(0, 0, 1), N = 9;
    for (let i = 0; i < N; i++) {
      const m = new THREE.Mesh(this._frostShardGeo, new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffffff : 0x9fe0ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
      const a = (i / N) * 6.283 + Math.random() * 0.5, spd = 2.2 + Math.random() * 2.6;
      const v = new THREE.Vector3(Math.cos(a) * spd, 1.6 + Math.random() * 2.6, Math.sin(a) * spd);
      m.position.copy(pos); m.quaternion.setFromUnitVectors(upAxis, v.clone().normalize()); m.scale.setScalar(0.7 + Math.random() * 0.7);
      this.g.world.add(m);
      const life = 0.5 + Math.random() * 0.35;
      this._frostShards.push({ m, v, life, max: life, spin: (Math.random() - 0.5) * 12 });
    }
    for (let i = 0; i < 22; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.7, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 3.2);
      this.spawn(pos, v, 0.45 + Math.random() * 0.4, 1.8 + Math.random() * 1.6, Math.random() < 0.5 ? 0xbfefff : 0xffffff);
    }
    this._flash(pos, 0x7fe0ff, 6.5, 4);
  }

  /** Layered churning-fire projectile core (replaces the sphere for fire bolts). */
  _fireBolt(hostile = false) {
    const geo = this._fbGeo || (this._fbGeo = new THREE.SphereGeometry(1, 12, 12));
    const mk = (r, hex, op) => { const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending })); mesh.scale.setScalar(r); return mesh; };
    const grp = new THREE.Group();
    const outer = mk(0.34, hostile ? 0xff1400 : 0xff2a00, 0.32), mid = mk(0.22, 0xff7a12, 0.70), core = mk(0.13, 0xffe9b0, 1.0);
    grp.add(outer, mid, core);
    const light = new THREE.PointLight(0xff6a1a, 3.4, 6, 2); grp.add(light);
    grp.renderOrder = 9;
    grp.userData.fb = { core, mid, outer, light, ph: Math.random() * 6.28 };
    return grp;
  }

  _fireBoltStep(m, b) {
    const u = m.userData.fb; if (!u) return;
    const t = performance.now() / 1000, ph = u.ph;
    u.core.scale.setScalar(0.13 * (1 + Math.sin(t * 24 + ph) * 0.16 + Math.sin(t * 41 + ph) * 0.06));
    u.mid.scale.setScalar(0.22 * (1 + Math.sin(t * 17 + ph * 1.7) * 0.12));
    u.outer.scale.setScalar(0.34 * (1 + Math.sin(t * 12 + ph) * 0.15));
    u.mid.rotation.y = t * 5.5; u.outer.rotation.y = -t * 3.5; u.outer.rotation.x = t * 2.0;
    u.core.material.opacity = 0.9 + Math.sin(t * 33 + ph) * 0.1;
    u.outer.material.opacity = 0.28 + Math.abs(Math.sin(t * 9 + ph)) * 0.12;
    u.light.intensity = 3.0 + Math.sin(t * 26 + ph) * 0.9;
    m.position.y += Math.sin(t * 20 + ph) * 0.015;
    const sp = Math.hypot(b.vx || 0, b.vz || 0) || 1, bx = -(b.vx || 0) / sp, bz = -(b.vz || 0) / sp;
    const tmp = this._fbTmp;
    const emit = 1 + (Math.random() < 0.7 ? 1 : 0);
    for (let e = 0; e < emit; e++) {
      tmp.set(m.position.x + bx * 0.18 + (Math.random() - 0.5) * 0.5, m.position.y + (Math.random() - 0.3) * 0.28, m.position.z + bz * 0.18 + (Math.random() - 0.5) * 0.5);
      const r = Math.random(), col = r < 0.4 ? 0xffe08a : r < 0.75 ? 0xff8a1e : 0xff3606;
      this.spawn(tmp, new THREE.Vector3(bx * (0.6 + Math.random()) + (Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 1.1, bz * (0.6 + Math.random()) + (Math.random() - 0.5) * 0.6), 0.28 + Math.random() * 0.3, 1.6 + Math.random() * 1.6, col);
    }
    if (Math.random() < 0.22) {
      tmp.set(m.position.x + bx * 0.22 + (Math.random() - .5) * .4, m.position.y + 0.08, m.position.z + bz * 0.22 + (Math.random() - .5) * .4);
      this.spawn(tmp, new THREE.Vector3(bx * 0.4, 0.9 + Math.random() * 0.6, bz * 0.4), 0.55 + Math.random() * 0.45, 2.4 + Math.random() * 1.6, 0x241c14);
    }
  }

  _fireImpact(pos) {
    this._flash(pos, 0xff7a1f, 8, 5.5);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, spd = 2.4 + Math.random() * 3.2, r = Math.random(), col = r < 0.35 ? 0xffe9a8 : r < 0.72 ? 0xff8a1e : 0xff2f04;
      this.spawn(pos, new THREE.Vector3(Math.cos(a) * spd, (0.3 + Math.random() * 1.1) * spd * 0.6, Math.sin(a) * spd), 0.4 + Math.random() * 0.5, 2.4 + Math.random() * 2.2, col);
    }
    for (let i = 0; i < 10; i++) this.spawn(pos.clone().add(new THREE.Vector3((Math.random() - .5) * 0.9, Math.random() * 0.4, (Math.random() - .5) * 0.9)), new THREE.Vector3((Math.random() - .5) * 0.7, 1.6 + Math.random() * 1.4, (Math.random() - .5) * 0.7), 0.9 + Math.random() * 0.6, 2.6 + Math.random() * 2.0, 0x2a2119);
    const geo = this._fbRingGeo || (this._fbRingGeo = new THREE.RingGeometry(0.18, 0.5, 30).rotateX(-Math.PI / 2));
    const ring = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    ring.position.set(pos.x, pos.y - 0.5, pos.z); ring.renderOrder = 8;
    this.g.world.add(ring);
    this._fireImpactRings.push({ ring, life: 0.5, max: 0.5 });
  }

  /** Branching electric arc for CHAIN LIGHTNING — call once per hop. */
  chainLightning(from, to, opts = {}) {
    const core = opts.core ?? 0xeaf4ff, glow = opts.glow ?? 0x4aa8ff, life = opts.life ?? 0.28, jag = opts.jag ?? 0.55, branches = opts.branches ?? 3;
    const dir = new THREE.Vector3().subVectors(to, from), len = dir.length();
    if (len < 1e-3) return;
    dir.multiplyScalar(1 / len);
    const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const nx = new THREE.Vector3().crossVectors(dir, up).normalize(), nz = new THREE.Vector3().crossVectors(dir, nx).normalize();
    const segs = Math.max(5, Math.min(14, Math.round(len * 1.6))), pts = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, p = new THREE.Vector3().lerpVectors(from, to, t);
      if (i > 0 && i < segs) { const fall = Math.sin(t * Math.PI); p.addScaledVector(nx, (Math.random() - 0.5) * 2 * jag * fall).addScaledVector(nz, (Math.random() - 0.5) * 2 * jag * fall); }
      pts.push(p);
    }
    const verts = [], cols = [], cCore = new THREE.Color(core), cGlow = new THREE.Color(glow);
    const pushSeg = (a, b, c) => { verts.push(a.x, a.y, a.z, b.x, b.y, b.z); cols.push(c.r, c.g, c.b, c.r, c.g, c.b); };
    for (let i = 0; i < pts.length - 1; i++) pushSeg(pts[i], pts[i + 1], cCore);
    for (let k = 0; k < branches; k++) {
      const root = pts[1 + Math.floor(Math.random() * (pts.length - 2))], blen = len * (0.12 + Math.random() * 0.18);
      const bdir = new THREE.Vector3().addScaledVector(dir, Math.random() - 0.2).addScaledVector(nx, (Math.random() - 0.5) * 2).addScaledVector(nz, (Math.random() - 0.5) * 2).normalize();
      let cur = root.clone(); const bsegs = 2 + Math.floor(Math.random() * 2);
      for (let j = 0; j < bsegs; j++) { const nxt = cur.clone().addScaledVector(bdir, blen / bsegs).addScaledVector(nx, (Math.random() - 0.5) * jag * 0.6).addScaledVector(nz, (Math.random() - 0.5) * jag * 0.6); pushSeg(cur, nxt, cGlow); cur = nxt; }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const seg = new THREE.LineSegments(geo, mat); seg.frustumCulled = false; seg.renderOrder = 10;
    this.g.world.add(seg);
    this.arcs.push({ seg, mat, life, max: life });
    for (let i = 1; i < pts.length; i += 2) this.spawn(pts[i], new THREE.Vector3((Math.random() - .5) * .6, (Math.random() - .5) * .6, (Math.random() - .5) * .6), 0.14 + Math.random() * 0.08, 2.2, glow);
    for (let i = 0; i < 8; i++) {
      this.spawn(from, new THREE.Vector3((Math.random() - .5), Math.random() * .8, (Math.random() - .5)).normalize().multiplyScalar(2 + Math.random() * 2.5), 0.25 + Math.random() * 0.2, 1.8, core);
      this.spawn(to, new THREE.Vector3((Math.random() - .5), Math.random() * .9, (Math.random() - .5)).normalize().multiplyScalar(2.5 + Math.random() * 3), 0.28 + Math.random() * 0.22, 2.0, i < 4 ? core : glow);
    }
    this._flash(to, glow, 6, 5.5); this._flash(from, core, 3, 3.5);
  }

  /** Lingering toxic poison cloud — drifting green billows + ground glow. */
  poisonCloud(center, radius = 2.0, dur = 4.5) {
    if (!this._pcDiscTex) {
      const c = document.createElement("canvas"); c.width = c.height = 128;
      const gx = c.getContext("2d"), grd = gx.createRadialGradient(64, 64, 4, 64, 64, 64);
      grd.addColorStop(0.0, "rgba(150,230,70,0.9)"); grd.addColorStop(0.55, "rgba(110,200,50,0.35)"); grd.addColorStop(1.0, "rgba(90,170,40,0)");
      gx.fillStyle = grd; gx.fillRect(0, 0, 128, 128);
      this._pcDiscTex = new THREE.CanvasTexture(c); this._pcDiscTex.colorSpace = THREE.SRGBColorSpace;
    }
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2.6, radius * 2.6), new THREE.MeshBasicMaterial({ map: this._pcDiscTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    disc.rotation.x = -Math.PI / 2; disc.position.set(center.x, center.y - 0.9, center.z); disc.renderOrder = 8;
    this.g.world.add(disc);
    const light = new THREE.PointLight(0x7fdd3a, 0, radius * 2.8, 2); light.position.set(center.x, center.y + 0.3, center.z);
    this.g.world.add(light);
    this._poisonClouds.push({ c: center.clone(), r: radius, life: dur, max: dur, disc, light, acc: 0, ang: Math.random() * 6.28 });
  }

  update(dt) {
    // particles integrate
    let i = 0;
    for (let k = this.parts.length - 1; k >= 0; k--) {
      const pt = this.parts[k];
      pt.life -= dt;
      if (pt.life <= 0) { this.parts.splice(k, 1); continue; }
      pt.v.y -= 4.5 * dt;
      pt.p.addScaledVector(pt.v, dt);
    }
    for (const pt of this.parts) {
      this.posArr[i * 3] = pt.p.x; this.posArr[i * 3 + 1] = pt.p.y; this.posArr[i * 3 + 2] = pt.p.z;
      const f = pt.life / pt.maxLife;
      this.colArr[i * 3] = pt.color.r * f; this.colArr[i * 3 + 1] = pt.color.g * f; this.colArr[i * 3 + 2] = pt.color.b * f;
      this.sizeArr[i] = pt.size * (0.5 + f * 0.5);
      i++;
      if (i >= MAX) break;
    }
    this.points.geometry.setDrawRange(0, i);
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.points.geometry.attributes.psize.needsUpdate = true;

    // shockwave rings expand + fade
    if (this.rings) {
      for (let k = this.rings.length - 1; k >= 0; k--) {
        const r = this.rings[k];
        r.life -= dt;
        const g0 = 1 - r.life / r.max;
        r.ring.scale.setScalar(0.4 + g0 * 6);
        r.ring.material.opacity = Math.max(0, r.life / r.max) * 0.85;
        if (r.life <= 0) { this.g.world.remove(r.ring); r.ring.geometry.dispose(); this.rings.splice(k, 1); }
      }
    }
    // element flash lights decay
    if (this.flashes) {
      for (let k = this.flashes.length - 1; k >= 0; k--) {
        const f = this.flashes[k];
        f.life -= dt;
        f.l.intensity = Math.max(0, f.l.intensity - dt * 22);
        if (f.life <= 0) { this.g.world.remove(f.l); this.flashes.splice(k, 1); }
      }
    }

    // FROST impact shards: fly out, fall, tumble, fade
    if (this._frostShards) {
      for (let k = this._frostShards.length - 1; k >= 0; k--) {
        const s = this._frostShards[k];
        s.life -= dt;
        if (s.life <= 0) { this.g.world.remove(s.m); s.m.material.dispose(); this._frostShards.splice(k, 1); continue; }
        s.v.y -= 9 * dt; s.m.position.addScaledVector(s.v, dt); s.m.rotateZ(s.spin * dt);
        s.m.material.opacity = s.life / s.max;
      }
    }
    // FROST impact rings: expand + fade
    if (this._frostRings) {
      for (let k = this._frostRings.length - 1; k >= 0; k--) {
        const r = this._frostRings[k]; r.life -= dt; const g0 = 1 - r.life / r.max;
        r.ring.scale.setScalar(0.4 + g0 * 5.5); r.ring.material.opacity = Math.max(0, r.life / r.max) * 0.9;
        if (r.life <= 0) { this.g.world.remove(r.ring); r.ring.geometry.dispose(); r.ring.material.dispose(); this._frostRings.splice(k, 1); }
      }
    }
    // FIRE impact rings: expand + fade
    if (this._fireImpactRings) {
      for (let k = this._fireImpactRings.length - 1; k >= 0; k--) {
        const r = this._fireImpactRings[k]; r.life -= dt; const g0 = 1 - r.life / r.max;
        r.ring.scale.setScalar(0.5 + g0 * 7); r.ring.material.opacity = Math.max(0, r.life / r.max) * 0.9;
        if (r.life <= 0) { this.g.world.remove(r.ring); r.ring.material.dispose(); this._fireImpactRings.splice(k, 1); }
      }
    }
    // CHAIN LIGHTNING arcs: electric flicker over the flash-out fade
    if (this.arcs) {
      for (let k = this.arcs.length - 1; k >= 0; k--) {
        const arc = this.arcs[k]; arc.life -= dt;
        if (arc.life <= 0) { this.g.world.remove(arc.seg); arc.seg.geometry.dispose(); arc.mat.dispose(); this.arcs.splice(k, 1); continue; }
        arc.mat.opacity = (arc.life / arc.max) * (0.6 + Math.random() * 0.4);
      }
    }
    // POISON clouds: re-emit drifting billows + pulse/fade the ground glow
    if (this._poisonClouds) {
      const PC_COLS = [0x7fdd3a, 0x9be04a, 0x5aa62a, 0xbfe36a];
      for (let k = this._poisonClouds.length - 1; k >= 0; k--) {
        const pc = this._poisonClouds[k];
        pc.life -= dt; pc.ang += dt * 0.9; pc.disc.rotation.z += dt * 0.25;
        const env = Math.max(0, Math.min(1, (pc.max - pc.life) / 0.4) * Math.min(1, pc.life / (pc.max * 0.4)));
        pc.disc.material.opacity = (0.14 + 0.05 * Math.sin(pc.life * 6)) * env;
        pc.light.intensity = 1.3 * env;
        pc.acc += 16 * dt * (0.35 + 0.65 * env);
        while (pc.acc >= 1) {
          pc.acc -= 1;
          const a = pc.ang + Math.random() * 6.28, rr = Math.sqrt(Math.random()) * pc.r;
          this._pcTmp.set(pc.c.x + Math.cos(a) * rr, pc.c.y - 0.7 + Math.random() * 0.5, pc.c.z + Math.sin(a) * rr);
          const swirl = 0.5 + Math.random() * 0.5;
          this.spawn(this._pcTmp, new THREE.Vector3(-Math.sin(a) * swirl + (Math.random() - 0.5) * 0.3, 0.6 + Math.random() * 0.7, Math.cos(a) * swirl + (Math.random() - 0.5) * 0.3), 1.1 + Math.random() * 0.8, 3.4 + Math.random() * 2.2, PC_COLS[(Math.random() * PC_COLS.length) | 0]);
        }
        if (pc.life <= 0) { this.g.world.remove(pc.disc); pc.disc.geometry.dispose(); pc.disc.material.dispose(); this.g.world.remove(pc.light); this._poisonClouds.splice(k, 1); }
      }
    }

    // floating damage numbers drift up + fade
    if (this.numbers) {
      for (let k = this.numbers.length - 1; k >= 0; k--) {
        const nm = this.numbers[k];
        nm.life -= dt;
        nm.spr.position.y += dt * 1.6;
        nm.spr.material.opacity = Math.max(0, nm.life / 0.9);
        if (nm.life <= 0) { this.g.world.remove(nm.spr); nm.spr.material.map.dispose(); this.numbers.splice(k, 1); }
      }
    }

    // torch flames: puff embers
    const t = performance.now() / 1000;
    for (const f of this.flames) {
      if (!f.grp.visible || (f.grp.parent && !f.grp.parent.visible)) continue;
      if (Math.random() < 0.25) {
        const wp = f.grp.getWorldPosition(new THREE.Vector3());
        wp.y += f.y;
        const col = f.theme === "scifi" ? 0x37e0ff : (Math.random() < 0.7 ? 0xff9a3c : 0xffd769);
        this.spawn(wp.add(new THREE.Vector3((Math.random() - .5) * .3, 0, (Math.random() - .5) * .3)),
          new THREE.Vector3((Math.random() - .5) * .4, 1.1 + Math.random() * .8, (Math.random() - .5) * .4), 0.55, 2.0, col);
      }
    }
    // portal swirl
    for (const p of this.portals) {
      if (!p.grp.visible || (p.grp.parent && !p.grp.parent.visible)) continue;
      p.ang += dt * 3;
      if (Math.random() < 0.5) {
        const wp = p.grp.getWorldPosition(new THREE.Vector3());
        const a = p.ang + Math.random() * 6.28;
        this.spawn(new THREE.Vector3(wp.x + Math.cos(a) * 1.35, wp.y + 1.8 + Math.sin(a * 2) * 1.1, wp.z + Math.sin(a) * 1.35),
          new THREE.Vector3(-Math.cos(a) * .5, 0.35, -Math.sin(a) * .5), 0.8, 1.9, p.color.getHex());
      }
    }
  }
}
