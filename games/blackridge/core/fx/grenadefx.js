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

  // ---- [heavy weapons] Anvil rockets in flight (sim.internal.rockets) -----------
  // A dark olive body with a pale nose band and four fins, the motor burning at the
  // tail (additive glow, flickering) and a grey smoke trail laid down behind it —
  // the trail stays and fades after the rocket is gone so the shot's line reads.
  const R_POOL = 6, TRAIL_N = 48, TRAIL_LIFE = 1.6, TRAIL_EVERY = 0.016;
  const rBodyMat = new THREE.MeshStandardMaterial({ color: 0x3a4030, roughness: 0.6, metalness: 0.25, emissive: 0x080a06 });
  const rNoseMat = new THREE.MeshStandardMaterial({ color: 0x8a8a78, roughness: 0.45, metalness: 0.4 });
  const rBodyG = new THREE.CylinderGeometry(0.042, 0.042, 0.62, 12); rBodyG.rotateX(Math.PI / 2);
  const rNoseG = new THREE.ConeGeometry(0.042, 0.20, 12); rNoseG.rotateX(-Math.PI / 2); rNoseG.translate(0, 0, -0.41);
  const rBandG = new THREE.CylinderGeometry(0.044, 0.044, 0.05, 12); rBandG.rotateX(Math.PI / 2); rBandG.translate(0, 0, -0.27);
  const rFinG = new THREE.BoxGeometry(0.006, 0.15, 0.12); rFinG.translate(0, 0, 0.26);
  const smokeTex = (() => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 64;
    const g = cv.getContext("2d");
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 31);
    r.addColorStop(0, "rgba(255,255,255,0.9)"); r.addColorStop(0.5, "rgba(255,255,255,0.35)"); r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; return tx;
  })();
  const rockets = [];
  for (let i = 0; i < R_POOL; i++) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(rBodyG, rBodyMat), new THREE.Mesh(rNoseG, rNoseMat), new THREE.Mesh(rBandG, rNoseMat));
    for (let k = 0; k < 4; k++) { const f = new THREE.Mesh(rFinG, rBodyMat); f.rotation.z = k * Math.PI / 2; g.add(f); }
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: gTex, color: 0xffa040, transparent: true, opacity: 1,
      depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    flame.position.z = 0.42; flame.scale.setScalar(0.9);
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: gTex, color: 0xfff0c0, transparent: true, opacity: 1,
      depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    core.position.z = 0.37; core.scale.setScalar(0.38);
    g.add(flame, core);
    g.visible = false; g.frustumCulled = false;
    root.add(g);
    rockets.push({ g, flame, core, ref: null });
  }
  // shared trail pool (ring buffer) — puffs outlive the rocket
  const trail = [];
  for (let i = 0; i < R_POOL * TRAIL_N; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0x9a9890, transparent: true, opacity: 0,
      depthWrite: false, fog: true }));
    s.visible = false;
    root.add(s);
    trail.push({ s, born: -9, size: 0.3 });
  }
  let trailCursor = 0;
  const _rq = new THREE.Vector3(), _rm = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0), _zero = new THREE.Vector3();
  function puffAt(x, y, z, t) {
    const p = trail[trailCursor]; trailCursor = (trailCursor + 1) % trail.length;
    p.s.position.set(x, y, z); p.born = t; p.size = 0.22 + ((trailCursor * 0.6180339) % 1) * 0.12; p.s.visible = true;
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

  // ---- [fx v152] kill cam replay feed (see update) ------------------------------
  let lastRf = null;
  const rFrag = [], rRock = [];
  const rFragV = [], rRockV = [];
  for (let i = 0; i < 4; i++) {
    rFragV.push({ pos: [0, 0, 0], vel: [0, 0, 0], fuseLeft: 2, _p: [0, 0, 0], _id: -1 });
    rRockV.push({ pos: [0, 0, 0], vel: [0, 0, -1], age: 1 });
  }
  function fragView(pool, i, q) {
    const v = pool[i];
    if (v._id !== q.id) { v._id = q.id; v._p[0] = q.x; v._p[1] = q.y; v._p[2] = q.z; }
    // a spin axis from the recorded path (the recording keeps no velocity)
    v.vel[0] = (q.x - v._p[0]) * 30; v.vel[1] = (q.y - v._p[1]) * 30; v.vel[2] = (q.z - v._p[2]) * 30;
    v._p[0] = q.x; v._p[1] = q.y; v._p[2] = q.z;
    v.pos[0] = q.x; v.pos[1] = q.y; v.pos[2] = q.z;
    v.fuseLeft = q.a;
    return v;
  }
  function rockView(pool, i, q) {
    const v = pool[i];
    v.pos[0] = q.x; v.pos[1] = q.y; v.pos[2] = q.z;
    const cp = Math.cos(q.b);
    v.vel[0] = Math.sin(q.a) * cp * 50; v.vel[1] = Math.sin(q.b) * 50; v.vel[2] = Math.cos(q.a) * cp * 50;
    return v;
  }
  // replay-only tripmines (the live ones are equipment_fx's; a mine that made
  // the kill no longer exists in the live sim when its kill is replayed)
  const MINE_N = 4;
  const mines = [];
  {
    const mm = new THREE.MeshStandardMaterial({ color: 0x3d4434, roughness: 0.7, metalness: 0.2 });
    const legM = new THREE.MeshStandardMaterial({ color: 0x24261f, roughness: 0.8 });
    const bodyG = new THREE.BoxGeometry(0.22, 0.12, 0.05); bodyG.translate(0, 0.11, 0);
    const legG = new THREE.CylinderGeometry(0.006, 0.006, 0.07, 5); legG.translate(0, 0.035, 0);
    for (let i = 0; i < MINE_N; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(bodyG, mm));
      for (const x of [-0.08, 0.08]) { const l = new THREE.Mesh(legG, legM); l.position.x = x; g.add(l); }
      const led = new THREE.Sprite(new THREE.SpriteMaterial({ map: gTex, color: 0xff2a1a, transparent: true, opacity: 0.6,
        depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      led.scale.setScalar(0.07); led.position.set(0.07, 0.16, -0.03);
      g.add(led);
      g.userData.led = led;
      g.visible = false; g.frustumCulled = false;
      root.add(g);
      mines.push(g);
    }
  }

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

      // [fx v152] KILL CAM REPLAY FEED. While killcam.js plays a replay it
      // publishes ctx.replayFx: the RECORDED frags / rockets in flight (and
      // tripmines that are about to go off). The live lists are the wrong
      // timeline then — the rocket that made the kill is long gone — so they are
      // swapped for the recording, and the trail pool is wiped at both cuts.
      const rf = ctx.replayFx || null;
      if (rf !== lastRf) {
        lastRf = rf;
        for (const p of trail) p.s.visible = false;
        for (const R of rockets) { R.g.visible = false; R.ref = null; }
      }
      let list = (s.internal && s.internal.grenades) || [];
      let rl = (s.internal && s.internal.rockets) || [];
      if (rf) {
        rFrag.length = 0; rRock.length = 0;
        for (let i = 0; i < rf.n; i++) {
          const q = rf.projs[i];
          if (q.kind === 1) rFrag.push(fragView(rFragV, rFrag.length, q));
          else if (q.kind === 2) rRock.push(rockView(rRockV, rRock.length, q));
        }
        list = rFrag; rl = rRock;
      }
      for (let i = 0; i < MINE_N; i++) {
        const mn = mines[i];
        const q = rf && i < rf.minesN ? rf.mines[i] : null;
        if (!q) { if (mn.visible) mn.visible = false; continue; }
        mn.visible = true;
        mn.position.set(q.x, q.y - 0.05, q.z);
        mn.rotation.set(0, q.yaw || 0, 0);
        mn.userData.led.material.opacity = (t % 0.8) < 0.12 ? 1 : 0.25;
      }

      // frags in flight
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

      // [heavy weapons] rockets in flight + their smoke trails
      for (let i = 0; i < R_POOL; i++) {
        const R = rockets[i];
        const rk = rl[i];
        if (!rk) { if (R.g.visible) R.g.visible = false; R.ref = null; continue; }
        const v = rk.vel || [0, 0, -1];
        R.g.visible = true;
        R.g.position.set(rk.pos[0], rk.pos[1], rk.pos[2]);
        // Matrix4.lookAt(eye, target) aims the object's +Z at eye - target: target = +v puts
        // +Z (the motor end) BEHIND the flight and the -Z nose along it
        _rq.set(v[0], v[1], v[2]);
        if (_rq.lengthSq() > 1e-6) { _rm.lookAt(_zero, _rq, _up); R.g.quaternion.setFromRotationMatrix(_rm); }
        const fl = 0.75 + 0.25 * Math.sin(t * 90 + i * 1.7) + 0.1 * Math.sin(t * 37);
        R.flame.scale.setScalar(0.85 * fl + Math.min(0.35, rk.age * 1.2));
        R.core.material.opacity = 0.8 + 0.2 * fl;
        if (R.ref !== rk) { R.ref = rk; R.lastPuff = -9; R.lastP = rk.pos.slice(); }
        if (t - R.lastPuff >= TRAIL_EVERY) {
          // fill the gap since the last puff so a 0.9 m/tick rocket leaves a continuous line
          const lp = R.lastP, d = Math.hypot(rk.pos[0] - lp[0], rk.pos[1] - lp[1], rk.pos[2] - lp[2]);
          const n = Math.max(1, Math.min(8, Math.round(d / 0.22)));
          for (let k = 1; k <= n; k++) {
            const u = k / n;
            puffAt(lp[0] + (rk.pos[0] - lp[0]) * u, lp[1] + (rk.pos[1] - lp[1]) * u, lp[2] + (rk.pos[2] - lp[2]) * u, t);
          }
          R.lastPuff = t; R.lastP = rk.pos.slice();
        }
      }
      for (const p of trail) {
        if (!p.s.visible) continue;
        const a = t - p.born;
        if (a < 0 || a > TRAIL_LIFE) { p.s.visible = false; continue; }
        const u = a / TRAIL_LIFE;
        p.s.material.opacity = 0.55 * (1 - u) * (1 - u);
        p.s.scale.setScalar(p.size + u * 1.3);
        p.s.position.y += dt * 0.25;                            // smoke lifts
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
    clear() {
      reconEndT = -1; for (const f of frags) f.g.visible = false; drone.visible = false;
      for (const R of rockets) { R.g.visible = false; R.ref = null; }
      for (const p of trail) p.s.visible = false;
    },
    root,
  };
}
