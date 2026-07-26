// Colosseum — combat VFX.
//
// ONE InstancedMesh for every particle in the game. Blood, sparks and dust all
// come out of the same pool and differ only by per-instance colour, size and
// physics parameters. That keeps the entire effects system at ONE draw call
// no matter how violent the bout gets, which is the only way it fits alongside
// an 18,000-strong crowd.
//
// Particles are simulated on the CPU because the counts are small (a few
// hundred live at once) and CPU simulation lets them collide with the sand and
// hand off to the persistent damage layer — a GPU-only system could not tell
// sand.js where a droplet landed.

import * as THREE from "three";

const MAX = 420;

export class VFX {
  constructor(scene, { sand = null, camera = null } = {}) {
    this.scene = scene;
    this.sand = sand;
    this.camera = camera;

    const geo = new THREE.PlaneGeometry(1, 1);

    // A WHITE per-vertex colour attribute is REQUIRED. `vertexColors: true`
    // defines USE_COLOR, and three's fragment chunk only applies vColor when
    // USE_COLOR is set — but USE_COLOR also makes the vertex stage multiply by
    // the `color` attribute. With no such attribute the shader reads zero and
    // every particle renders as a BLACK RECTANGLE. White here means the final
    // colour is exactly instanceColor.
    const n = geo.attributes.position.count;
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));

    // A soft radial alpha ramp turns every quad from a hard SQUARE into a
    // droplet. Without it blood reads as red confetti and dust as pale slabs.
    // Generated in code so there is no texture to ship.
    const S = 64;
    const cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const cx = cv.getContext("2d");
    const grd = cx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0.0, "rgba(255,255,255,1)");
    grd.addColorStop(0.45, "rgba(255,255,255,0.92)");
    grd.addColorStop(1.0, "rgba(255,255,255,0)");
    cx.fillStyle = grd;
    cx.fillRect(0, 0, S, S);
    const sprite = new THREE.CanvasTexture(cv);
    sprite.colorSpace = THREE.SRGBColorSpace;

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false,
      map: sprite, alphaMap: sprite, alphaTest: 0.02,
      side: THREE.DoubleSide, name: "vfx",
    });
    // Billboarding is done on the CPU by copying the camera's rotation into
    // each instance matrix. An earlier version patched gl_Position inside
    // begin_vertex, which three's own project_vertex chunk then overwrote —
    // the particles ended up mispositioned AND black. At =<420 instances the
    // CPU cost is irrelevant and this cannot silently break.

    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.name = "vfx";
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    scene.add(this.mesh);

    // Pooled particle state. Never allocated during play.
    this.p = Array.from({ length: MAX }, () => ({
      alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      life: 0, maxLife: 1, size: 0.1, grav: -9.8, drag: 0.0,
      r: 1, g: 1, b: 1, kind: "blood", stain: 0,
    }));
    this.live = 0;

    this._m = new THREE.Matrix4();
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
  }

  _take() {
    for (let i = 0; i < MAX; i++) if (!this.p[i].alive) return this.p[i];
    return null;                    // saturated — dropping is correct, not a bug
  }

  /**
   * Arterial spray. Droplets arc, then stain the sand where they land — which
   * is why this is CPU-side: it has to report the landing point.
   */
  blood(origin, strength = 1) {
    const n = Math.round(10 + strength * 16);
    for (let i = 0; i < n; i++) {
      const p = this._take();
      if (!p) return;
      const a = Math.random() * Math.PI * 2;
      const up = 1.4 + Math.random() * 3.2 * strength;
      const out = 0.8 + Math.random() * 2.6 * strength;
      Object.assign(p, {
        alive: true, x: origin.x, y: origin.y, z: origin.z,
        vx: Math.cos(a) * out, vy: up, vz: Math.sin(a) * out,
        life: 0, maxLife: 0.55 + Math.random() * 0.5,
        size: 0.035 + Math.random() * 0.055 * strength,
        grav: -14, drag: 0.6,
        r: 0.42 + Math.random() * 0.16, g: 0.03, b: 0.025,
        kind: "blood", stain: 0.28 + Math.random() * 0.3,
      });
    }
  }

  /** Steel on steel. Fast, short-lived, no stain. */
  sparks(origin, strength = 1) {
    const n = Math.round(8 + strength * 14);
    for (let i = 0; i < n; i++) {
      const p = this._take();
      if (!p) return;
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * Math.PI * 0.5;
      const sp = 3.5 + Math.random() * 6 * strength;
      Object.assign(p, {
        alive: true, x: origin.x, y: origin.y, z: origin.z,
        vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp, vz: Math.sin(a) * Math.cos(e) * sp,
        life: 0, maxLife: 0.18 + Math.random() * 0.22,
        size: 0.018 + Math.random() * 0.03,
        grav: -18, drag: 1.8,
        r: 1.0, g: 0.82 + Math.random() * 0.18, b: 0.42,
        kind: "spark", stain: 0,
      });
    }
  }

  /** Kicked sand — a dodge, a landing, a lift breaking the surface. */
  dust(origin, strength = 1) {
    const n = Math.round(6 + strength * 12);
    for (let i = 0; i < n; i++) {
      const p = this._take();
      if (!p) return;
      const a = Math.random() * Math.PI * 2;
      const out = 0.6 + Math.random() * 2.0 * strength;
      Object.assign(p, {
        alive: true, x: origin.x, y: origin.y + 0.08, z: origin.z,
        vx: Math.cos(a) * out, vy: 0.7 + Math.random() * 1.4, vz: Math.sin(a) * out,
        life: 0, maxLife: 0.9 + Math.random() * 0.8,
        // Kicked sand, not a smoke bomb — these were 4x this size and read as
        // pale slabs hanging in the air.
        size: 0.07 + Math.random() * 0.11 * strength,
        grav: -1.6, drag: 2.4,
        r: 0.62, g: 0.54, b: 0.40,
        kind: "dust", stain: 0,
      });
    }
  }

  update(dt) {
    let n = 0;
    const col = this.mesh.instanceColor.array;
    // Face the camera. One quaternion read, reused for every particle.
    if (this.camera) this.camera.getWorldQuaternion(this._q);
    for (let i = 0; i < MAX; i++) {
      const p = this.p[i];
      if (!p.alive) continue;

      p.life += dt;
      if (p.life >= p.maxLife) { p.alive = false; continue; }

      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vz *= d;
      p.vy = (p.vy + p.grav * dt) * d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;

      // Ground contact. Blood stains and dies; dust settles; sparks wink out.
      if (p.y <= 0.02) {
        if (p.kind === "blood" && this.sand && p.stain > 0) {
          this.sand.splat(p.x, p.z, 0.06 + p.stain * 0.22, "blood", 0.35 + p.stain * 0.5);
        }
        p.alive = false;
        continue;
      }

      const t = p.life / p.maxLife;
      // Dust puffs out a little; everything else shrinks as it dies.
      const scale = p.kind === "dust" ? p.size * (1 + t * 0.9) : p.size * (1 - t * 0.55);
      const fade = p.kind === "spark" ? (1 - t) * (1 - t) : 1 - t;

      this._v.set(p.x, p.y, p.z);
      this._s.set(scale, scale, scale);
      this._m.compose(this._v, this._q, this._s);
      this.mesh.setMatrixAt(n, this._m);
      col[n * 3] = p.r * fade;
      col[n * 3 + 1] = p.g * fade;
      col[n * 3 + 2] = p.b * fade;
      n++;
    }
    this.live = n;
    this.mesh.count = n;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  stats() { return { live: this.live, capacity: MAX, drawCalls: this.live > 0 ? 1 : 0 }; }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.scene.remove(this.mesh);
  }
}
