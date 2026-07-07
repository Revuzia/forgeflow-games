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
    this.boltMeshes.clear();
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
      let m = this.boltMeshes.get(b.id);
      if (!m) {
        m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), new THREE.MeshBasicMaterial({ color: b.hostile ? 0xff4444 : col }));
        const l = new THREE.PointLight(b.hostile ? 0xff4444 : col, 3, 5);
        m.add(l);
        this.g.world.add(m);
        this.boltMeshes.set(b.id, m);
      }
      m.position.set(b.x, b.f * floorH + 1.15, b.z);
      // trail
      if (Math.random() < 0.5) this.spawn(m.position, new THREE.Vector3(0, 0.3, 0), 0.22, 1.4, b.hostile ? 0xff4444 : col);
    }
    for (const [id, m] of this.boltMeshes) if (!seen.has(id)) { this.g.world.remove(m); this.boltMeshes.delete(id); }
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
