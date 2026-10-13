// core/fx/streakfx.js — what the player SEES of a kill-streak call-in.
//
//   MORTAR     red target ring + sky beam, shells that streak in from 90 m
//   AIRSTRIKE  the bomb-run line painted on the ground, a jet that actually flies
//              the line, bombs dropping from it onto each impact
//   ORBITAL    a wide target circle and thick light beams lancing down
//
// All timing is SIM time (state.time vs the plan the sim emitted with the "call"
// event), so a paused or frozen game holds the strike in mid-air. The explosions
// themselves are the game's normal `explosion` events (core/fx/explosions.js) —
// this file only draws the lead-in.

import * as THREE from "three";

const COL = { mortar: 0xff5a3a, airstrike: 0xff9a3a, orbital: 0xff3a6a };

function streakTex() {
  const cv = document.createElement("canvas");
  cv.width = 32; cv.height = 128;
  const g = cv.getContext("2d");
  const l = g.createLinearGradient(0, 0, 0, 128);
  l.addColorStop(0.0, "rgba(255,255,255,0)");
  l.addColorStop(0.8, "rgba(255,255,255,0.9)");
  l.addColorStop(1.0, "rgba(255,255,255,1)");
  g.fillStyle = l; g.fillRect(0, 0, 32, 128);
  const e = g.createLinearGradient(0, 0, 32, 0);
  e.addColorStop(0, "rgba(0,0,0,1)"); e.addColorStop(0.5, "rgba(0,0,0,0)"); e.addColorStop(1, "rgba(0,0,0,1)");
  g.globalCompositeOperation = "destination-out"; g.fillStyle = e; g.fillRect(0, 0, 32, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function ringTex() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const g = cv.getContext("2d");
  const r = g.createRadialGradient(64, 64, 20, 64, 64, 62);
  r.addColorStop(0.0, "rgba(255,255,255,0.08)");
  r.addColorStop(0.82, "rgba(255,255,255,0.10)");
  r.addColorStop(0.92, "rgba(255,255,255,0.95)");
  r.addColorStop(1.0, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createStreakFx(ctx) {
  const root = new THREE.Group();
  root.name = "streak_fx";
  ctx.scene.add(root);

  const sTex = streakTex(), rTex = ringTex();
  const mats = new Map();
  const addMat = (tex, color, opacity = 1) => {
    const k = tex.uuid + color + opacity;
    let m = mats.get(k);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false, side: THREE.DoubleSide, fog: false });
      mats.set(k, m);
    }
    return m;
  };
  const planeV = new THREE.PlaneGeometry(1, 1);       // streak: scaled (w, len)
  const ringG = new THREE.CircleGeometry(1, 48); ringG.rotateX(-Math.PI / 2);
  const jetMat = new THREE.MeshStandardMaterial({ color: 0x1a1d21, roughness: 0.5, metalness: 0.6 });

  const calls = [];   // active call-ins
  let lastSim = null;

  function makeJet() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.4, 14, 10), jetMat);
    body.rotation.x = Math.PI / 2;                    // along Z
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.7, 4.5, 10), jetMat);
    nose.rotation.x = -Math.PI / 2; nose.position.z = -9;
    const wing = new THREE.Mesh(new THREE.BoxGeometry(15, 0.18, 4.2), jetMat);
    wing.position.z = 1.2;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.15, 2), jetMat);
    tail.position.z = 6.2;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.6, 2.2), jetMat);
    fin.position.set(0, 1.3, 6);
    const glow = new THREE.Mesh(planeV, addMat(sTex, 0xffb060, 0.9));
    glow.scale.set(1.4, 9, 1); glow.rotation.x = Math.PI / 2; glow.position.z = 11;
    glow.rotation.y = 0;
    g.add(body, nose, wing, tail, fin, glow);
    g.scale.setScalar(1.0);
    return g;
  }

  function onCall(d) {
    const s = ctx.sim && ctx.sim();
    if (!s || !d || !d.plan || !d.plan.length) return;
    const col = COL[d.id] || 0xff4a3a;
    const g = new THREE.Group();
    root.add(g);
    const t = d.target;
    // target ring on the ground (+ a tall sky beam)
    const radius = d.id === "orbital" ? Math.max(8, d.span) : d.id === "mortar" ? Math.max(4, d.span) : 4;
    const ring = new THREE.Mesh(ringG, addMat(rTex, col, 0.55));
    ring.position.set(t[0], t[1] + 0.06, t[2]);
    ring.scale.setScalar(radius);
    ring.renderOrder = 7;
    g.add(ring);
    const beam = new THREE.Mesh(planeV, addMat(sTex, col, 0.34));
    beam.scale.set(0.45, 46, 1);
    beam.position.set(t[0], t[1] + 23, t[2]);
    beam.renderOrder = 7;
    const beam2 = beam.clone(); beam2.rotation.y = Math.PI / 2;
    g.add(beam, beam2);
    // airstrike: the run painted on the ground + the jet
    let line = null, jet = null, jetPath = null;
    const first = d.plan[0], last = d.plan[d.plan.length - 1];
    if (d.id === "airstrike") {
      const dx = last.pos[0] - first.pos[0], dz = last.pos[2] - first.pos[2];
      const len = Math.hypot(dx, dz) || 1;
      line = new THREE.Mesh(new THREE.PlaneGeometry(3.0, len + 6), addMat(rTex, col, 0.16));
      line.rotation.x = -Math.PI / 2;
      line.rotation.z = Math.atan2(dx, dz) * -1;    // plane's +Y after the tilt maps to world -Z
      line.position.set((first.pos[0] + last.pos[0]) / 2, t[1] + 0.07, (first.pos[2] + last.pos[2]) / 2);
      line.renderOrder = 7;
      g.add(line);
      jet = makeJet();
      jet.visible = false;
      g.add(jet);
      const tn = Math.max(0.2, last.t - first.t);
      jetPath = { x0: first.pos[0], z0: first.pos[2], dx: dx / tn, dz: dz / tn, t0: first.t, yaw: Math.atan2(-dx, -dz), alt: 58 };
    }
    // falling streaks — one per impact
    const lead = d.id === "mortar" ? 1.15 : d.id === "airstrike" ? 0.85 : 0.32;
    const wide = d.id === "orbital" ? 1.6 : d.id === "airstrike" ? 0.5 : 0.28;
    const fall = d.plan.map((q) => {
      const m = new THREE.Mesh(planeV, addMat(sTex, col, 1));
      m.visible = false; m.renderOrder = 8;
      const m2 = m.clone(); m2.rotation.y = Math.PI / 2;
      const grp = new THREE.Group(); grp.add(m, m2); grp.visible = false; g.add(grp);
      return { grp, q, lead, wide };
    });
    calls.push({ id: d.id, g, ring, beam, beam2, line, jet, jetPath, fall, endT: last.t + 1.0, startT: s.state.time, col, radius });
  }

  function onDone(d) {
    void d;
  }

  return {
    attach(bridge) {
      this.clear();
      bridge.register("streak", (d) => { if (!d) return; if (d.phase === "call") onCall(d); else if (d.phase === "done") onDone(d); });
    },
    update(dt) {
      void dt;
      const s = ctx.sim ? ctx.sim() : null;
      if (!s) return;
      if (s !== lastSim) { this.clear(); lastSim = s; }
      const t = s.state.time;
      const pulse = 0.6 + 0.4 * Math.sin(t * 7);
      for (let i = calls.length - 1; i >= 0; i--) {
        const c = calls[i];
        if (t > c.endT) { root.remove(c.g); calls.splice(i, 1); continue; }
        c.ring.scale.setScalar(c.radius * (0.96 + 0.04 * pulse));
        c.ring.material.opacity = 0.30 + 0.30 * pulse;
        for (const f of c.fall) {
          const tt = f.q.t - t;
          if (tt > f.lead || tt < -0.05) { f.grp.visible = false; continue; }
          const k = 1 - Math.max(0, tt) / f.lead;           // 0 = just released, 1 = impact
          const top = c.id === "orbital" ? 150 : c.id === "airstrike" ? 58 : 95;
          const y = f.q.pos[1] + (top) * (1 - k);
          const len = c.id === "orbital" ? 70 : c.id === "airstrike" ? 7 : 11;
          f.grp.visible = true;
          f.grp.position.set(f.q.pos[0], y + len * 0.5, f.q.pos[2]);
          f.grp.children[0].scale.set(f.wide, len, 1);
          f.grp.children[1].scale.set(f.wide, len, 1);
        }
        if (c.jet && c.jetPath) {
          const jp = c.jetPath;
          const tj = t - jp.t0;
          // visible from 4.5 s before the first bomb until 4 s after the last
          if (tj > -4.5 && tj < (c.endT - jp.t0) + 4) {
            const x = jp.x0 + jp.dx * tj, z = jp.z0 + jp.dz * tj;
            c.jet.visible = true;
            c.jet.position.set(x, jp.alt, z);
            c.jet.rotation.y = jp.yaw + Math.PI;           // nose along travel (+Z local = tail)
          } else c.jet.visible = false;
        }
      }
    },
    clear() {
      for (const c of calls) root.remove(c.g);
      calls.length = 0;
    },
    root,
  };
}
