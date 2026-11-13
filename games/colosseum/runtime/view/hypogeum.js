// Colosseum — the hypogeum: trapdoors, lifts and cages.
//
// The two-level basement under the sand is the single best piece of theatre the
// building has. A beast does not walk on; the sand splits, a cage rises out of
// the dark on a counterweighted lift, the door drops, and the thing is simply
// THERE. Getting that beat right is worth more than any amount of extra polish
// on the seating.
//
// Construction notes:
//  * The pit is only ever seen through an open trap, so it is built as a shallow
//    box with a dark interior rather than a real modelled basement. When every
//    trap is shut the whole group is hidden — it costs nothing 95% of the time.
//  * Trap leaves are a hinged PAIR per lift. They rotate about their outer edge,
//    which means the pivot has to sit at the leaf edge, not its centre — so each
//    leaf is a Group whose child mesh is offset by half its width.
//  * Everything animates off a single normalised 0..1 `t` per lift so the
//    sequencing (doors -> rise -> cage opens) is one readable timeline rather
//    than a pile of independent tweens.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ARENA } from "../data/arena_spec.js";
import { TAU, clamp, smoothstep, mulberry32 } from "../core/util.js";

// Phase boundaries of the entrance timeline, in normalised time.
const PHASE = {
  doorsOpen: 0.00,   // trap leaves swing down
  doorsDone: 0.22,
  riseStart: 0.18,   // lift starts before the doors finish — reads as urgency
  riseDone: 0.68,
  cageStart: 0.72,   // cage door drops
  cageDone: 0.92,
};

export class Hypogeum {
  /**
   * @param {THREE.Object3D} parent
   * @param {object} opts { quality, seed, spec, materials }
   */
  constructor(parent, { quality = "high", seed = 99, spec = ARENA, materials = null } = {}) {
    this.parent = parent;
    this.spec = spec;
    this.quality = quality;
    this.rnd = mulberry32(seed);

    this.group = new THREE.Group();
    this.group.name = "hypogeum";
    parent.add(this.group);

    this.mat = {
      wood: materials?.wood || new THREE.MeshStandardMaterial({ color: 0x6d5236, roughness: 0.92, name: "trap_wood" }),
      iron: materials?.iron || new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.6, metalness: 0.7, name: "cage_iron" }),
      stone: new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.98, name: "pit_stone" }),
      // The pit interior is deliberately near-black: an unlit hole under a
      // blazing arena reads as a void, and the contrast is the whole effect.
      dark: new THREE.MeshBasicMaterial({ color: 0x0a0806, side: THREE.BackSide, name: "pit_void" }),
    };

    this.lifts = [];
    this._build();
    this.setAllClosed();
  }

  _build() {
    const h = this.spec.hypogeum;
    const f = this.spec.floor;
    const count = h.lifts;
    const ra = f.a * h.liftRadiusRatio;
    const rb = f.b * h.liftRadiusRatio;

    for (let i = 0; i < count; i++) {
      // Spread the lifts around an inner ellipse, offset so none sits dead
      // centre (the player spawns there) or in a gate mouth.
      const t = (i / count) * TAU + Math.PI / count;
      const x = ra * Math.cos(t);
      const z = rb * Math.sin(t);
      this.lifts.push(this._makeLift(i, x, z, t));
    }
  }

  _makeLift(index, x, z, theta) {
    const h = this.spec.hypogeum;
    const { w, d } = h.liftSize;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = -theta;                 // long axis follows the ellipse
    this.group.add(g);

    // ---- the pit ---------------------------------------------------------
    // An open-topped box. BackSide basic material = you see the inside faces
    // only, which is exactly the "hole in the floor" read, with no lighting
    // cost and no chance of it glowing.
    const pitGeo = new THREE.BoxGeometry(w * 1.06, h.depth, d * 1.06);
    pitGeo.translate(0, -h.depth / 2 - 0.05, 0);
    const pit = new THREE.Mesh(pitGeo, this.mat.dark);
    pit.name = `pit_${index}`;
    g.add(pit);

    // A stone collar around the opening so the trap doesn't read as a hole cut
    // in paper.
    const collar = this._collar(w, d);
    const collarMesh = new THREE.Mesh(collar, this.mat.stone);
    collarMesh.receiveShadow = true;
    g.add(collarMesh);

    // ---- trap leaves -----------------------------------------------------
    // Hinged at their OUTER edges. Each leaf is a Group positioned at the hinge
    // line, with the plank mesh offset inward by half a leaf so rotation about
    // the group's x-axis swings it down into the pit correctly.
    const leaves = [];
    for (const side of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.position.set(0, 0.02, side * (d / 2));
      const plankGeo = this._leaf(w, d / 2);
      const plank = new THREE.Mesh(plankGeo, this.mat.wood);
      plank.castShadow = true;
      plank.receiveShadow = true;
      // shift so the leaf spans from the hinge inward to the centre line
      plank.position.z = -side * (d / 4);
      hinge.add(plank);
      hinge.userData.side = side;
      g.add(hinge);
      leaves.push(hinge);
    }

    // ---- the platform + cage --------------------------------------------
    const platform = new THREE.Group();
    platform.position.y = -h.liftTravel;
    g.add(platform);

    const deckGeo = new THREE.BoxGeometry(w * 0.88, 0.22, d * 0.88);
    deckGeo.translate(0, -0.11, 0);
    const deck = new THREE.Mesh(deckGeo, this.mat.wood);
    deck.castShadow = true;
    deck.receiveShadow = true;
    platform.add(deck);

    const cage = this._cage(w * 0.86, d * 0.86, 2.6);
    cage.name = `cage_${index}`;
    platform.add(cage);

    return {
      index, group: g, pit, leaves, platform, cage,
      x, z, theta,
      t: 0,                 // normalised timeline position
      state: "closed",
      occupant: null,       // set by the match director
      travel: h.liftTravel,
    };
  }

  /** Stone rim around a trap opening. */
  _collar(w, d) {
    const parts = [];
    const th = 0.34;
    const rim = 0.26;
    for (const [sx, sz, ww, dd] of [
      [0, (d / 2 + rim / 2), w + rim * 2, rim],
      [0, -(d / 2 + rim / 2), w + rim * 2, rim],
      [(w / 2 + rim / 2), 0, rim, d],
      [-(w / 2 + rim / 2), 0, rim, d],
    ]) {
      const b = new THREE.BoxGeometry(ww, th, dd);
      b.translate(sx, -th / 2 + 0.03, sz);
      parts.push(b);
    }
    const m = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    return m;
  }

  /** A planked trap leaf with iron banding. */
  _leaf(w, depth) {
    const parts = [];
    const PLANKS = 5;
    const pw = w / PLANKS;
    for (let i = 0; i < PLANKS; i++) {
      const b = new THREE.BoxGeometry(pw * 0.94, 0.11, depth * 0.98);
      b.translate(-w / 2 + pw * (i + 0.5), 0, 0);
      parts.push(b);
    }
    // two iron straps across the planks
    for (const f of [-0.28, 0.3]) {
      const s = new THREE.BoxGeometry(w * 0.98, 0.05, depth * 0.14);
      s.translate(0, 0.07, depth * f);
      parts.push(s);
    }
    const m = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    return m;
  }

  /**
   * A barred cage: four corner posts, a top frame, and a drop-away front door.
   * The door is a child group so it can fall independently at the end of the
   * timeline — the beat where the beast is actually released.
   */
  _cage(w, d, height) {
    const cage = new THREE.Group();
    const bar = 0.06;
    const parts = [];

    // corner posts
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const p = new THREE.BoxGeometry(bar * 1.6, height, bar * 1.6);
        p.translate(sx * (w / 2), height / 2, sz * (d / 2));
        parts.push(p);
      }
    }
    // top frame
    for (const [ww, dd, oz, ox] of [[w, bar, d / 2, 0], [w, bar, -d / 2, 0], [bar, d, 0, w / 2], [bar, d, 0, -w / 2]]) {
      const b = new THREE.BoxGeometry(ww || bar, bar, dd || bar);
      b.translate(ox, height, oz);
      parts.push(b);
    }
    // vertical bars on the three fixed sides
    const N = 6;
    for (let i = 1; i < N; i++) {
      const fx = -w / 2 + (w * i) / N;
      const b = new THREE.BoxGeometry(bar, height, bar);
      b.translate(fx, height / 2, -d / 2);
      parts.push(b);
    }
    for (let i = 1; i < N; i++) {
      const fz = -d / 2 + (d * i) / N;
      for (const sx of [-1, 1]) {
        const b = new THREE.BoxGeometry(bar, height, bar);
        b.translate(sx * (w / 2), height / 2, fz);
        parts.push(b);
      }
    }
    const frameGeo = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    const frame = new THREE.Mesh(frameGeo, this.mat.iron);
    frame.castShadow = true;
    cage.add(frame);

    // ---- drop door (front face, +z) --------------------------------------
    const doorParts = [];
    for (let i = 1; i < N; i++) {
      const fx = -w / 2 + (w * i) / N;
      const b = new THREE.BoxGeometry(bar, height, bar);
      b.translate(fx, height / 2, 0);
      doorParts.push(b);
    }
    const dtop = new THREE.BoxGeometry(w, bar * 1.4, bar * 1.4);
    dtop.translate(0, height, 0);
    doorParts.push(dtop);
    const dbot = new THREE.BoxGeometry(w, bar * 1.4, bar * 1.4);
    dbot.translate(0, bar, 0);
    doorParts.push(dbot);
    const doorGeo = mergeGeometries(doorParts, false);
    doorParts.forEach((p) => p.dispose());
    const door = new THREE.Mesh(doorGeo, this.mat.iron);
    door.castShadow = true;
    door.position.z = d / 2;
    door.name = "cage_door";
    cage.add(door);
    cage.userData.door = door;
    cage.userData.doorHeight = height;

    return cage;
  }

  // -- state ---------------------------------------------------------------

  setAllClosed() {
    for (const l of this.lifts) {
      l.t = 0;
      l.state = "closed";
      l.group.visible = false;
      this._applyLift(l);
    }
    this.group.visible = false;   // nothing to draw while the sand is intact
  }

  /**
   * Begin an entrance on lift `index`. Optionally attach an occupant Object3D
   * (a beast or a gladiator) which rides up inside the cage.
   */
  open(index, occupant = null) {
    const l = this.lifts[index % this.lifts.length];
    if (!l) return null;
    l.state = "opening";
    l.t = 0;
    l.occupant = occupant;
    if (occupant) {
      l.platform.add(occupant);
      occupant.position.set(0, 0, 0);
    }
    // PER-LIFT visibility, not per-system. Showing the whole hypogeum because
    // one trap opened put all 8 lifts (7 meshes each) on the GPU — 56 draw
    // calls for one beast entrance. Only the lift in use is drawn.
    l.group.visible = true;
    this.group.visible = true;
    return l;
  }

  /** Close a lift back down (after the occupant has walked off). */
  close(index) {
    const l = this.lifts[index % this.lifts.length];
    if (!l) return;
    l.state = "closing";
  }

  /** World position a released occupant should walk out to. */
  exitPoint(index) {
    const l = this.lifts[index % this.lifts.length];
    if (!l) return new THREE.Vector3();
    // a couple of metres toward the arena centre
    const dir = new THREE.Vector3(-l.x, 0, -l.z).normalize();
    return new THREE.Vector3(l.x, 0, l.z).addScaledVector(dir, 3.2);
  }

  // -- animation -----------------------------------------------------------

  /**
   * Advance every active lift. Returns the list of events that fired this
   * frame so the audio and crowd systems can react on exactly the right beat:
   * `{lift, event}` where event is 'doors' | 'rising' | 'released' | 'closed'.
   */
  update(dt) {
    const events = [];
    let anyVisible = false;

    for (const l of this.lifts) {
      if (l.state === "closed") continue;
      anyVisible = true;

      const prev = l.t;
      if (l.state === "opening") {
        l.t = clamp(l.t + dt / 4.2, 0, 1);          // ~4.2 s full sequence
        if (prev < PHASE.doorsOpen + 0.001 && l.t > 0) events.push({ lift: l, event: "doors" });
        if (prev < PHASE.riseStart && l.t >= PHASE.riseStart) events.push({ lift: l, event: "rising" });
        if (prev < PHASE.cageStart && l.t >= PHASE.cageStart) events.push({ lift: l, event: "released" });
        if (l.t >= 1) l.state = "open";
      } else if (l.state === "closing") {
        l.t = clamp(l.t - dt / 3.0, 0, 1);
        if (l.t <= 0) {
          l.state = "closed";
          l.group.visible = false;      // stop paying for it the moment it shuts
          if (l.occupant && l.occupant.parent === l.platform) l.platform.remove(l.occupant);
          l.occupant = null;
          events.push({ lift: l, event: "closed" });
        }
      }
      this._applyLift(l);
    }

    // Hide the whole subsystem when every trap is shut — it is the common case.
    if (!anyVisible && this.group.visible) this.group.visible = false;
    return events;
  }

  _applyLift(l) {
    const t = l.t;

    // doors: 0 -> -PI/2 about their hinge (swinging down into the pit)
    const dz = smoothstep(clamp((t - PHASE.doorsOpen) / (PHASE.doorsDone - PHASE.doorsOpen), 0, 1));
    for (const hinge of l.leaves) {
      hinge.rotation.x = hinge.userData.side * dz * (Math.PI / 2) * 0.98;
    }

    // platform rise
    const rz = smoothstep(clamp((t - PHASE.riseStart) / (PHASE.riseDone - PHASE.riseStart), 0, 1));
    l.platform.position.y = -l.travel * (1 - rz);

    // cage door drops away
    const cz = smoothstep(clamp((t - PHASE.cageStart) / (PHASE.cageDone - PHASE.cageStart), 0, 1));
    const door = l.cage.userData.door;
    if (door) door.position.y = -cz * (l.cage.userData.doorHeight * 1.05);
  }

  /** True once the occupant can be handed to the AI (cage is open). */
  isReleased(index) {
    const l = this.lifts[index % this.lifts.length];
    return !!l && l.t >= PHASE.cageDone;
  }

  stats() {
    return {
      lifts: this.lifts.length,
      active: this.lifts.filter((l) => l.state !== "closed").length,
      visible: this.group.visible,
      states: this.lifts.map((l) => l.state),
    };
  }

  dispose() {
    this.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    Object.values(this.mat).forEach((m) => m.dispose && m.dispose());
    this.parent.remove(this.group);
  }
}
