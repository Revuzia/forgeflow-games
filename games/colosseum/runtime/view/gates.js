// Colosseum — the ceremonial gates.
//
// Four openings pierce the podium wall, and each carries meaning the player
// should feel before they read any UI:
//
//   Porta Triumphalis  (west, major axis)  — you enter here, to the horns
//   Porta Libitinaria  (east, major axis)  — the dead leave here
//   Beast gates        (north + south)     — portcullis to the pens
//
// The Triumphalis and Libitinaria are heavy double doors that swing inward;
// the beast gates are iron portcullises that grind straight up. Both share one
// normalised 0..1 timeline so the sequencing, dust and sound cues line up.
//
// Cost: each gate is 3 meshes (surround, leaf A, leaf B) and they are static
// geometry with a transform animation, so the whole system is 12 draw calls
// that never change count.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ARENA } from "../data/arena_spec.js";
import { clamp, smoothstep } from "../core/util.js";

export class Gates {
  /**
   * @param {THREE.Object3D} parent
   * @param {object} opts { spec, materials, colosseum }
   */
  constructor(parent, { spec = ARENA, materials = null, colosseum = null } = {}) {
    this.parent = parent;
    this.spec = spec;
    this.colosseum = colosseum;

    this.group = new THREE.Group();
    this.group.name = "gates";
    parent.add(this.group);

    this.mat = {
      stone: materials?.marble || new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: 0.7, name: "gate_stone" }),
      wood: materials?.wood || new THREE.MeshStandardMaterial({ color: 0x5a4429, roughness: 0.9, name: "gate_wood" }),
      iron: materials?.iron || new THREE.MeshStandardMaterial({ color: 0x33302c, roughness: 0.55, metalness: 0.72, name: "gate_iron" }),
      // The passage behind a gate is unlit — an open gate must read as a black
      // mouth, not a hole showing sky through the far side of the building.
      dark: new THREE.MeshBasicMaterial({ color: 0x080604, name: "gate_void" }),
    };

    this.gates = {};
    for (const def of spec.gates) this.gates[def.id] = this._makeGate(def);
  }

  _makeGate(def) {
    const { floor, podium } = this.spec;
    // Anchor on the podium ellipse.
    const a = floor.a + 0.3;
    const b = floor.b + 0.3;
    const x = a * Math.cos(def.theta);
    const z = b * Math.sin(def.theta);

    const g = new THREE.Group();
    g.position.set(x, 0, z);
    // Orient so local +z faces INTO the arena (the doors you see from the sand)
    // and local -z runs outward through the wall (where the passage void and
    // the surround's depth extend).
    //
    // A yaw of t maps local +z to (sin t, 0, cos t). The inward direction here
    // is -(x,z) normalised, so we need sin t = -x/r and cos t = -z/r, i.e.
    // t = atan2(-x, -z). Adding PI on top of that (as this first did) points
    // local -z at the arena centre instead, which stood the whole gate — void
    // box, surround and all — out on the sand.
    g.rotation.y = Math.atan2(-x, -z);
    this.group.add(g);

    const W = def.width;
    // The opening has to live inside the podium: nothing may project above it
    // or the surround punches through the first tier of seating. The podium's
    // own cornice then reads as the gate's lintel, which is both cheaper and
    // more correct than stacking a second entablature on top.
    const H = Math.min(def.height, podium.height - 0.45);
    const depth = podium.thickness + 1.4;

    // ---- the passage void -------------------------------------------------
    // A dark box set back into the wall. Without it you see straight through
    // the building the moment a gate opens.
    const voidGeo = new THREE.BoxGeometry(W * 0.98, H * 0.98, depth * 2.4);
    voidGeo.translate(0, H / 2, -depth * 1.2);
    const voidMesh = new THREE.Mesh(voidGeo, this.mat.dark);
    voidMesh.name = `${def.id}_void`;
    g.add(voidMesh);

    // ---- stone surround ---------------------------------------------------
    const surround = this._surround(W, H, depth, podium.height);
    const sMesh = new THREE.Mesh(surround, this.mat.stone);
    sMesh.name = `${def.id}_surround`;
    sMesh.castShadow = true;
    sMesh.receiveShadow = true;
    g.add(sMesh);

    const gate = { def, group: g, t: 0, state: "closed", width: W, height: H };

    if (def.role === "beast") {
      // ---- portcullis -----------------------------------------------------
      const pc = this._portcullis(W * 0.92, H * 0.96);
      pc.name = `${def.id}_portcullis`;
      pc.position.z = -0.35;
      g.add(pc);
      gate.kind = "portcullis";
      gate.portcullis = pc;
      gate.travel = H * 1.02;
    } else {
      // ---- double doors ---------------------------------------------------
      // Hinged at the jambs, swinging inward (away from the arena, i.e. -z in
      // local space). Each leaf is a Group at the hinge with the panel offset
      // inward by half its width, so rotation is about the real hinge line.
      gate.kind = "doors";
      gate.leaves = [];
      for (const side of [-1, 1]) {
        const hinge = new THREE.Group();
        hinge.position.set(side * (W / 2), 0, -0.25);
        const panel = this._doorLeaf(W / 2, H);
        panel.position.x = -side * (W / 4);
        hinge.add(panel);
        hinge.userData.side = side;
        g.add(hinge);
        gate.leaves.push(hinge);
      }
      gate.swing = Math.PI * 0.62;
    }

    this._apply(gate);
    return gate;
  }

  /**
   * Jambs + a flat header, sized to stay entirely within the podium height.
   * `top` is the hard ceiling the surround must not exceed.
   */
  _surround(W, H, depth, top) {
    const parts = [];
    const jw = 1.0;
    const headerH = Math.max(0.3, Math.min(0.55, top - H));
    for (const sx of [-1, 1]) {
      const j = new THREE.BoxGeometry(jw, H, depth);
      j.translate(sx * (W / 2 + jw / 2), H / 2, -depth / 2 + 0.3);
      parts.push(j);
    }
    const header = new THREE.BoxGeometry(W + jw * 2, headerH, depth * 1.04);
    header.translate(0, H + headerH / 2, -depth / 2 + 0.3);
    parts.push(header);

    const m = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    return m;
  }

  /** A planked, iron-banded door leaf built to span 0..w from its hinge. */
  _doorLeaf(w, h) {
    const parts = [];
    const PLANKS = 6;
    const pw = w / PLANKS;
    for (let i = 0; i < PLANKS; i++) {
      const b = new THREE.BoxGeometry(pw * 0.95, h, 0.22);
      b.translate(-w / 2 + pw * (i + 0.5), h / 2, 0);
      parts.push(b);
    }
    for (const fy of [0.18, 0.52, 0.86]) {
      const s = new THREE.BoxGeometry(w * 0.98, h * 0.05, 0.3);
      s.translate(0, h * fy, 0.02);
      parts.push(s);
    }
    // boss studs
    for (const fy of [0.18, 0.52, 0.86]) {
      for (let i = 0; i < 3; i++) {
        const st = new THREE.BoxGeometry(0.12, 0.12, 0.36);
        st.translate(-w / 2 + w * (0.2 + 0.3 * i), h * fy, 0.03);
        parts.push(st);
      }
    }
    const geo = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    const mesh = new THREE.Mesh(geo, this.mat.wood);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /** An iron grid that lifts straight up. */
  _portcullis(w, h) {
    const parts = [];
    const bar = 0.09;
    const N = Math.max(5, Math.round(w / 0.55));
    for (let i = 0; i <= N; i++) {
      const x = -w / 2 + (w * i) / N;
      const b = new THREE.BoxGeometry(bar, h, bar);
      b.translate(x, h / 2, 0);
      parts.push(b);
    }
    const M = Math.max(3, Math.round(h / 0.8));
    for (let j = 1; j <= M; j++) {
      const y = (h * j) / (M + 1);
      const b = new THREE.BoxGeometry(w, bar * 0.8, bar * 0.8);
      b.translate(0, y, 0);
      parts.push(b);
    }
    // spiked bottom edge — the detail that makes it read as a portcullis
    for (let i = 0; i <= N; i++) {
      const x = -w / 2 + (w * i) / N;
      const s = new THREE.ConeGeometry(bar * 1.1, 0.34, 4);
      s.rotateX(Math.PI);
      s.translate(x, -0.17, 0);
      parts.push(s.toNonIndexed());
      s.dispose();
    }
    const geo = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
    parts.forEach((p) => p.dispose());
    const mesh = new THREE.Mesh(geo, this.mat.iron);
    mesh.castShadow = true;
    return mesh;
  }

  // -- control -------------------------------------------------------------

  /** Open a gate by id. Returns the gate record. */
  open(id) {
    const g = this.gates[id];
    if (g && g.state !== "open") g.state = "opening";
    return g;
  }

  close(id) {
    const g = this.gates[id];
    if (g && g.state !== "closed") g.state = "closing";
    return g;
  }

  isOpen(id) {
    const g = this.gates[id];
    return !!g && g.t >= 0.995;
  }

  /** World position just inside a gate — where a fighter walks in to. */
  entryPoint(id, inset = 4.0) {
    const g = this.gates[id];
    if (!g) return new THREE.Vector3();
    const p = g.group.position;
    const dir = new THREE.Vector3(-p.x, 0, -p.z).normalize();
    return new THREE.Vector3(p.x, 0, p.z).addScaledVector(dir, inset);
  }

  /**
   * Advance all gates. Returns events for the audio/dust systems:
   * `{id, event}` with event in 'start' | 'moving' | 'done' | 'shut'.
   */
  update(dt) {
    const events = [];
    for (const id in this.gates) {
      const g = this.gates[id];
      if (g.state === "closed" || g.state === "open") continue;
      const prev = g.t;
      // Heavy doors take their time — 3.4 s open, 2.6 s shut. The weight is
      // most of the drama, so this is deliberately slower than feels efficient.
      if (g.state === "opening") {
        g.t = clamp(g.t + dt / 3.4, 0, 1);
        if (prev === 0) events.push({ id, event: "start", gate: g });
        if (g.t >= 1) { g.state = "open"; events.push({ id, event: "done", gate: g }); }
      } else if (g.state === "closing") {
        g.t = clamp(g.t - dt / 2.6, 0, 1);
        if (g.t <= 0) { g.state = "closed"; events.push({ id, event: "shut", gate: g }); }
      }
      this._apply(g);
    }
    return events;
  }

  _apply(g) {
    const e = smoothstep(g.t);
    if (g.kind === "portcullis") {
      g.portcullis.position.y = e * g.travel;
    } else {
      for (const hinge of g.leaves) {
        hinge.rotation.y = -hinge.userData.side * e * g.swing;
      }
    }
  }

  stats() {
    const out = {};
    for (const id in this.gates) out[id] = { state: this.gates[id].state, t: +this.gates[id].t.toFixed(2) };
    return out;
  }

  dispose() {
    this.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    Object.values(this.mat).forEach((m) => m.dispose && m.dispose());
    this.parent.remove(this.group);
  }
}
