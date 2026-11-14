// core/fx/grenadefx.js — what the player SEES of a thrown frag and of the
// SIGNAL SWEEP recon drone.
//
// 2026-10-14 review: thrown grenades were INVISIBLE in flight — nothing outside
// the sim and the AI ever read sim.internal.grenades, so the only sign of a frag
// was a dust puff where it bounced. Each live grenade now gets a small pooled
// mesh that tumbles along its arc, with a faint fuse glint so it reads at night.
//
// The SIGNAL SWEEP (core/sim/streaks.js, 3-kill reward) gets a drone that takes
// station high over the map for the sweep's duration: dark airframe, slow orbit,
// blinking red/green navigation lights, and a soft scan cone that pulses on every
// sweep. Pure view layer — reads sim state and the "streak" bridge events.

import * as THREE from "three";

const POOL = 8;

function glintTex() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const g = cv.getContext("2d");
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 31);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.3, "rgba(255,255,255,0.55)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createGrenadeFx(ctx) {
  const root = new THREE.Group();
  root.name = "grenade_fx";
  ctx.scene.add(root);
  const gTex = glintTex();

  // ---- frag pool -------------------------------------------------------------
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3b4230, roughness: 0.55, metalness: 0.2,
    emissive: 0x0b0d08 });
  const spoonMat = new THREE.MeshStandardMaterial({ color: 0x6b6b66, roughness: 0.35, metalness: 0.8 });
  const bodyG = new THREE.SphereGeometry(0.034, 14, 10);
  bodyG.scale(1, 1.18, 1);
  const capG = new THREE.CylinderGeometry(0.014, 0.016, 0.026, 10);
  const spoonG = new THREE.BoxGeometry(0.010, 0.060, 0.004);
  const frags = [];
  for (let i = 0; i < POOL; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(bodyG, bodyMat);
    const cap = new THREE.Mesh(capG, spoonMat); cap.position.y = 0.046;
    const spoon = new THREE.Mesh(spoonG, spoonMat); spoon.position.set(0.032, 0.022, 0); spoon.rotation.z = -0.25;
    const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: gTex, color: 0xffa060, transparent: true,
      opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    glint.scale.setScalar(0.16);
    g.add(body, cap, spoon, glint);
    g.visible = false;
    g.frustumCulled = false;
    root.add(g);
    frags.push({ g, glint, spin: 0, ax: new THREE.Vector3(1, 0, 0) });
  }

  // ---- recon drone -----------------------------------------------------------
  const drone = new THREE.Group();
  {
    const dm = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6, metalness: 0.3, emissive: 0x0b0d10 });
    const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.14, 2.6, 10), dm);
    fus.rotation.x = Math.PI / 2;
    const wing = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.06, 0.62), dm);
    wing.position.z = -0.1;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.36), dm);
    tail.position.z = 1.15;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 0.4), dm);
    fin.position.set(0, 0.26, 1.15);
    drone.add(fus, wing, tail, fin);
    const mk = (col, x, sz) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: gTex, color: col, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
      s.scale.setScalar(sz); s.position.set(x, 0, -0.1);
      drone.add(s);
      return s;
    };
    drone.userData.navL = mk(0xff2a1a, -2.6, 3.0);
    drone.userData.navR = mk(0x2aff6a, 2.6, 3.0);
    drone.userData.strobe = mk(0xffffff, 0, 4.0);
    drone.userData.strobe.position.set(0, -0.25, 0);
    // scan cone: a faint downward cone that flashes on each sweep
    const cone = new THREE.Mesh(new THREE.ConeGeometry(38, 60, 32, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false }));
    cone.position.y = -30;
    drone.add(cone);
    drone.userData.cone = cone;
  }
  drone.visible = false;
  root.add(drone);
  let reconEndT = -1, reconT0 = 0, lastSweepT = -99;
  let lastSim = null;

  function onStreak(d) {
    if (!d || d.id !== "recon") return;
    const s = ctx.sim && ctx.sim();
    if (!s) return;
    if (d.phase === "call") {
      reconEndT = (d.endT || (s.state.time + 24)) + 1.5;
      reconT0 = s.state.time;
    } else if (d.phase === "sweep") {
      lastSweepT = s.state.time;
    } else if (d.phase === "done") {
      reconEndT = Math.min(reconEndT, s.state.time + 1.5);
    }
  }

  return {
    attach(bridge) {
      reconEndT = -1; lastSweepT = -99;
      bridge.register("streak", (d) => { try { onStreak(d); } catch (e) { /* view must not break */ } });
    },
    update(dt) {
      const s = ctx.sim ? ctx.sim() : null;
      if (!s) return;
      if (s !== lastSim) { lastSim = s; reconEndT = -1; }
      const t = s.state.time;

      // frags in flight
      const list = (s.internal && s.internal.grenades) || [];
      for (let i = 0; i < POOL; i++) {
        const f = frags[i];
        const gr = list[i];
        if (!gr) { if (f.g.visible) f.g.visible = false; continue; }
        f.g.visible = true;
        f.g.position.set(gr.pos[0], gr.pos[1], gr.pos[2]);
        const v = gr.vel || [0, 0, 0];
        const sp = Math.hypot(v[0], v[1], v[2]);
        if (sp > 0.3) {
          f.ax.set(v[2], 0, -v[0]).normalize();
          f.spin += sp * dt * 2.2;
          f.g.quaternion.setFromAxisAngle(f.ax, f.spin);
        }
        // fuse glint flickers faster as the fuse runs out
        const fl = gr.fuseLeft != null ? gr.fuseLeft : 2;
        const rate = fl < 1 ? 16 : 7;
        f.glint.material.opacity = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * rate * Math.PI * 2));
      }

      // recon drone
      const on = t < reconEndT;
      drone.visible = on;
      if (on) {
        const b = s.colliders && s.colliders.bounds;
        const cx = b ? (b.min[0] + b.max[0]) * 0.5 : s.state.player.pos[0];
        const cz = b ? (b.min[2] + b.max[2]) * 0.5 : s.state.player.pos[2];
        const R = b ? Math.max(25, Math.min(70, Math.hypot(b.max[0] - b.min[0], b.max[2] - b.min[2]) * 0.3)) : 40;
        const age = t - reconT0;
        const a = age * 0.16;                                     // slow orbit
        const alt = 62 + Math.sin(age * 0.4) * 2;
        drone.position.set(cx + Math.cos(a) * R, alt, cz + Math.sin(a) * R);
        drone.rotation.set(0, -a, 0.32);                           // banked into the turn
        const u = drone.userData;
        const blink = (Math.sin(t * Math.PI * 2 * 1.1) > 0.6) ? 1 : 0.15;
        u.navL.material.opacity = 0.35 + 0.65 * blink;
        u.navR.material.opacity = 0.35 + 0.65 * blink;
        u.strobe.material.opacity = (t % 1.3) < 0.07 ? 1 : 0;
        const sw = t - lastSweepT;
        u.cone.material.opacity = sw >= 0 && sw < 0.6 ? 0.07 * (1 - sw / 0.6) : 0;
      }
    },
    clear() { reconEndT = -1; for (const f of frags) f.g.visible = false; drone.visible = false; },
    root,
  };
}
