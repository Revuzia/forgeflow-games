/**
 * Cosmic Coils — runtime/3d/snakes.js
 * All snake bodies render through ONE InstancedMesh (≤ 5520 segment spheres,
 * per-instance color, emissive injected from instance color so every serpent
 * GLOWS its own palette under bloom). Heads are small per-snake Groups with
 * eyes that look where they steer. Food/essence is a second InstancedMesh
 * with per-tier colors and a live pulse. Two draw calls for every creature
 * and gem on the planet.
 */
import * as THREE from "three";

const V = new URL(import.meta.url).search;
const S = await import("../sim/serpent.js" + V);
const { CONST, SKINS, terrainH, segRadius, segSpacing } = S;

const MAX_SEGS = CONST.SLOTS * (CONST.SEG_MAX + 2);
const MAX_FOOD = 2400;

/** inject per-instance color into the emissive term (the glow trick) */
function glowify(mat, factor) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGlowK = { value: factor };
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uGlowK;")
      .replace("#include <emissivemap_fragment>", `
        #include <emissivemap_fragment>
        #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
          totalEmissiveRadiance += vColor.rgb * uGlowK;
        #endif
      `);
  };
}

function makeLabel(text, color) {
  const cv = document.createElement("canvas");
  cv.width = 256; cv.height = 64;
  const c = cv.getContext("2d");
  c.font = "700 34px system-ui, sans-serif";
  c.textAlign = "center"; c.textBaseline = "middle";
  c.shadowColor = "rgba(0,0,0,0.9)"; c.shadowBlur = 8;
  c.fillStyle = color;
  c.fillText(text.slice(0, 14), 128, 32);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(4.6, 1.15, 1);
  return sp;
}

export class SnakeField {
  constructor(scene, W) {
    this.scene = scene;
    this.W = W;
    this.t = 0;

    // segment instancing
    const segGeo = new THREE.SphereGeometry(1, 18, 13);
    const segMat = new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.18 });
    glowify(segMat, 0.42);
    this.segMesh = new THREE.InstancedMesh(segGeo, segMat, MAX_SEGS);
    this.segMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.segMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SEGS * 3), 3);
    this.segMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.segMesh.count = 0;
    this.segMesh.frustumCulled = false;
    scene.add(this.segMesh);

    // food instancing
    const foodGeo = new THREE.IcosahedronGeometry(1, 1);
    const foodMat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.08 });
    glowify(foodMat, 0.95);
    this.foodMesh = new THREE.InstancedMesh(foodGeo, foodMat, MAX_FOOD);
    this.foodMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.foodMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FOOD * 3), 3);
    this.foodMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.foodMesh.count = 0;
    this.foodMesh.frustumCulled = false;
    scene.add(this.foodMesh);
    this.foodAges = new Map(); // id → spawn time (scale-in anim)

    // per-slot head groups + labels
    this.heads = new Map(); // slot → {group, eyeL, eyeR, pupL, pupR, crown, label, labelName}
    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._sc = new THREE.Vector3();
    this._c = new THREE.Color();
    this._cA = new THREE.Color();
    this._cB = new THREE.Color();
    this._up = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._m3 = new THREE.Matrix4();
  }

  _headFor(sn, accent) {
    let h = this.heads.get(sn.slot);
    if (!h) {
      const group = new THREE.Group();
      const skin = SKINS[sn.skinId % SKINS.length];
      const mkEye = (x) => {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 9), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 }));
        e.position.set(x, 0.55, 0.5);
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), new THREE.MeshBasicMaterial({ color: 0x101018 }));
        p.position.set(0, 0.05, 0.24);
        e.add(p);
        return [e, p];
      };
      const [eyeL, pupL] = mkEye(-0.42);
      const [eyeR, pupR] = mkEye(0.42);
      group.add(eyeL); group.add(eyeR);
      const crown = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), new THREE.MeshBasicMaterial({ color: 0xffd76a }));
      crown.position.set(0, 1.35, 0);
      crown.visible = false;
      group.add(crown);
      const label = makeLabel(sn.name || "?", "#" + new THREE.Color(skin.glow).getHexString());
      group.add(label);
      label.position.set(0, 2.4, 0);
      this.scene.add(group);
      h = { group, eyeL, eyeR, pupL, pupR, crown, label, labelName: sn.name };
      this.heads.set(sn.slot, h);
    }
    if (h.labelName !== sn.name) {
      h.group.remove(h.label);
      h.label.material.map.dispose(); h.label.material.dispose();
      const skin = SKINS[sn.skinId % SKINS.length];
      h.label = makeLabel(sn.name || "?", "#" + new THREE.Color(skin.glow).getHexString());
      h.label.position.set(0, 2.4, 0);
      h.group.add(h.label);
      h.labelName = sn.name;
    }
    return h;
  }

  /** mySlot: label of own snake hidden; leaderSlot gets the crown */
  update(dt, mySlot, leaderSlot) {
    this.t += dt;
    const W = this.W, R = W.R;
    let idx = 0;
    const m4 = this._m4, p = this._p, sc = this._sc, c = this._c, cA = this._cA, cB = this._cB;

    const aliveSlots = new Set();
    for (const sn of W.snakes) {
      if (!sn.alive || sn.segN < 1) continue;
      aliveSlots.add(sn.slot);
      const skin = SKINS[sn.skinId % SKINS.length];
      cA.setHex(skin.a); cB.setHex(skin.b);
      const r = segRadius(sn.mass);
      const shieldBlink = sn.shield > 0 ? (Math.sin(this.t * 16) * 0.5 + 0.5) * 0.7 + 0.5 : 1;
      const boostGlow = sn.boosting ? 1.45 : 1;
      const pulseSpeed = sn.boosting ? 9 : 4.2;
      const n = Math.min(sn.segN, CONST.SEG_MAX);
      const patternType = sn.skinId % 3; // 0 gradient, 1 stripes, 2 pulse-bands

      for (let i = 0; i < n && idx < MAX_SEGS; i++) {
        const ux = sn.segs[i * 3], uy = sn.segs[i * 3 + 1], uz = sn.segs[i * 3 + 2];
        p.set(ux, uy, uz);
        const h = terrainH(p, W.seed, CONST.TERRAIN_AMP);
        const taper = i > n - 7 ? 1 - (i - (n - 7)) / 8 : 1;
        const sr = r * (i === 0 ? 1.28 : 1) * Math.max(0.35, taper);
        const rad = R + h + sr * 0.8;
        p.multiplyScalar(rad);
        sc.setScalar(sr);
        m4.makeScale(sc.x, sc.y, sc.z);
        m4.setPosition(p);
        this.segMesh.setMatrixAt(idx, m4);

        // pattern color
        let t01;
        if (patternType === 1) t01 = (Math.floor(i / 5) % 2);
        else if (patternType === 2) t01 = 0.5 + 0.5 * Math.sin(i * 0.7 - this.t * pulseSpeed);
        else t01 = 0.5 + 0.5 * Math.sin(i * 0.16 - this.t * pulseSpeed * 0.45);
        c.copy(cA).lerp(cB, t01);
        // traveling glow wave from head
        const wave = 0.72 + 0.55 * Math.sin(i * 0.42 - this.t * pulseSpeed);
        c.multiplyScalar(wave * shieldBlink * boostGlow * (i === 0 ? 1.35 : 1));
        this.segMesh.setColorAt(idx, c);
        idx++;
      }

      // head group (eyes) on segment 0
      const hd = this._headFor(sn, skin.glow);
      hd.group.visible = true;
      const u0 = this._up.set(sn.segs[0], sn.segs[1], sn.segs[2]);
      const hH = terrainH(u0, W.seed, CONST.TERRAIN_AMP);
      const hr = r * 1.28;
      p.copy(u0).multiplyScalar(R + hH + hr * 0.8);
      hd.group.position.copy(p);
      // orient: up = normal (u0), forward = heading tangent
      this._fwd.set(sn.t.x, sn.t.y, sn.t.z);
      const zAxis = this._fwd.clone().normalize();
      const yAxis = u0.clone().normalize();
      const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
      const zFixed = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
      this._m3.makeBasis(xAxis, yAxis, zFixed);
      hd.group.quaternion.setFromRotationMatrix(this._m3);
      hd.group.scale.setScalar(hr);
      // pupils track steering
      const px = THREE.MathUtils.clamp(sn.steer * 0.2, -0.2, 0.2);
      hd.pupL.position.x = px; hd.pupR.position.x = px;
      hd.crown.visible = sn.slot === leaderSlot;
      if (hd.crown.visible) hd.crown.rotation.y = this.t * 2.2;
      hd.label.visible = sn.slot !== mySlot;
      // keep label size ~constant regardless of head scale
      const ls = 4.6 / hr;
      hd.label.scale.set(ls, ls * 0.25, 1);
      hd.label.position.y = 1.1 + 1.4 / hr;
    }

    // hide dead snakes' heads
    for (const [slot, hd] of this.heads) {
      if (!aliveSlots.has(slot)) hd.group.visible = false;
    }

    this.segMesh.count = idx;
    this.segMesh.instanceMatrix.needsUpdate = true;
    if (this.segMesh.instanceColor) this.segMesh.instanceColor.needsUpdate = true;

    // ── food ──
    let fi = 0;
    for (const f of W.food.values()) {
      if (fi >= MAX_FOOD) break;
      let age = this.foodAges.get(f.id);
      if (age == null) { age = this.t; this.foodAges.set(f.id, age); }
      const grow = Math.min(1, (this.t - age) / 0.3);
      const wob = f.seed % 6.28;
      p.set(f.u.x, f.u.y, f.u.z);
      const h = terrainH(p, W.seed, CONST.TERRAIN_AMP);
      const bob = f.tier === 9 ? Math.sin(this.t * 2.0 + wob) * 0.14 : Math.sin(this.t * 1.8 + wob) * 0.10;
      p.multiplyScalar(R + h + f.r + 0.35 + bob);
      const pulse = 1 + Math.sin(this.t * (f.tier === 9 ? 3.2 : 2.6) + wob) * (f.tier === 9 ? 0.08 : 0.10);
      const s = f.r * pulse * grow * (f.tier === 9 ? 1.05 : 1);
      m4.makeRotationY(this.t * 0.9 + wob);
      m4.scale(sc.setScalar(s));
      m4.setPosition(p);
      this.foodMesh.setMatrixAt(fi, m4);
      // tier colors — brighter than the over-muted pass (owner: orbs lost too
      // much glow). Essence is a vivid green; BIGGER essence glows a touch more.
      if (f.tier === 0) c.setHex(0xffc46a);
      else if (f.tier === 1) c.setHex(0x54f0ff);
      else if (f.tier === 2) c.setHex(0xffd94a);
      else if (f.tier === 3) c.setHex(0xff54d8);
      else c.setHex(0x9fe86a); // essence
      const essBoost = f.tier === 9 ? (1 + Math.min(0.5, f.value / 14)) : 1;
      const tw = (f.tier === 9
        ? 0.66 + 0.14 * Math.sin(this.t * 2.8 + wob * 2)
        : 0.74 + 0.22 * Math.sin(this.t * 3.4 + wob * 2)) * essBoost;
      c.multiplyScalar(tw);
      this.foodMesh.setColorAt(fi, c);
      fi++;
    }
    this.foodMesh.count = fi;
    this.foodMesh.instanceMatrix.needsUpdate = true;
    if (this.foodMesh.instanceColor) this.foodMesh.instanceColor.needsUpdate = true;
    // GC food age map occasionally
    if (this.foodAges.size > MAX_FOOD * 2 && Math.random() < 0.02) {
      for (const id of this.foodAges.keys()) if (!W.food.has(id)) this.foodAges.delete(id);
    }
  }

  setWorld(W) {
    this.W = W;
    this.foodAges.clear();
    for (const [, hd] of this.heads) {
      this.scene.remove(hd.group);
      hd.label.material.map.dispose(); hd.label.material.dispose();
    }
    this.heads.clear();
  }

  dispose() {
    this.setWorld(this.W);
    this.scene.remove(this.segMesh); this.scene.remove(this.foodMesh);
    this.segMesh.geometry.dispose(); this.segMesh.material.dispose();
    this.foodMesh.geometry.dispose(); this.foodMesh.material.dispose();
  }
}
