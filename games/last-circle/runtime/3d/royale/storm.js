/**
 * royale/storm.js — the shrinking storm. Math lives in sim (SIM.Storm,
 * deterministic from seed); this renders the wall, applies damage ticks,
 * drives warnings, and exposes state for HUD/minimap/bots.
 *
 * Wall: a tall open-ended cylinder with a scrolling additive gradient texture
 * (violet electric look), scaled to the live radius each frame. Outside = a
 * subtle screen tint via HUD event.
 */
import * as THREE from "three";

let K = null;

export function init(W) {
  K = W.SIM;
}

export function createStorm(W) {
  const storm = new K.Storm({ seed: W.seed, mode: W.mode, half: W.map.half });
  const g = W.group("storm");
  g.clear();

  // wall texture: vertical gradient with noise streaks
  const cv = document.createElement("canvas");
  cv.width = 256; cv.height = 256;
  const ctx = cv.getContext("2d");
  const grad = ctx.createLinearGradient(0, 256, 0, 0);
  grad.addColorStop(0, "rgba(150,60,220,0.55)");
  grad.addColorStop(0.25, "rgba(120,40,200,0.28)");
  grad.addColorStop(1, "rgba(90,20,160,0.02)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 60; i++) {
    ctx.strokeStyle = "rgba(220,150,255," + (0.05 + Math.random() * 0.12) + ")";
    ctx.beginPath();
    const x = Math.random() * 256;
    ctx.moveTo(x, 256);
    ctx.lineTo(x + (Math.random() - 0.5) * 40, Math.random() * 160);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(12, 1);

  const wallGeo = new THREE.CylinderGeometry(1, 1, 320, 96, 1, true);
  const wallMat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
    color: 0x9a4de0,   // violet tint — untinted additive washed out white against the sky
    opacity: 0.75,
  });
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.position.y = 120;
  wall.renderOrder = 5;
  wall.visible = storm.phases.length > 0;   // practice mode has no storm
  g.add(wall);

  const ctl = {
    storm, wall, tex,
    lastPhase: 0, tickAcc: 0, warned: {},
    state: () => storm.stateAt(W.t),
  };
  return ctl;
}

export function update(W, dt) {
  const ctl = W.stormCtl;
  if (!ctl) return;
  if (!ctl.storm.phases.length) { ctl.wall.visible = false; return; }
  const st = ctl.storm.stateAt(W.t);
  ctl.tex.offset.x += dt * 0.03;

  // wall follows the live circle — hidden while the pre-shrink super-circle
  // still surrounds the whole map (a wall past the coastline just reads as
  // white streaks on the horizon everywhere)
  if (st.radius > 0.5 && st.radius < W.map.half * 1.02) {
    ctl.wall.visible = true;
    ctl.wall.position.x = st.center.x;
    ctl.wall.position.z = st.center.z;
    ctl.wall.scale.set(st.radius, 1, st.radius);
  } else {
    ctl.wall.visible = false;
  }

  // phase transitions → warnings
  if (st.phase !== ctl.lastPhase || (st.closing && !ctl.warned["c" + st.phase])) {
    if (st.closing) { W.events.emit("stormClosing", st); ctl.warned["c" + st.phase] = true; }
    else if (st.phase !== ctl.lastPhase) W.events.emit("stormPhase", st);
    ctl.lastPhase = st.phase;
  }
  // 10s-to-close warning
  if (st.phaseState === "waiting" && st.tToNext < 10 && !ctl.warned["w" + st.phase]) {
    ctl.warned["w" + st.phase] = true;
    W.events.emit("stormWarning", st);
  }

  // damage ticks (1 Hz)
  if (st.dps > 0 && W.phase === "match") {
    ctl.tickAcc += dt;
    while (ctl.tickAcc >= 1) {
      ctl.tickAcc -= 1;
      for (const a of W.actors) {
        if (!a.alive || a.netRemote) continue;
        const d = Math.hypot(a.pos.x - st.center.x, a.pos.z - st.center.z);
        if (d > st.radius) {
          // storm ignores shield (classic BR): hp only
          a.hp -= st.dps;
          a.lastDamageT = W.t;
          if (a === W.player) W.events.emit("stormTick", st.dps);
          if (a.hp <= 0) {
            W.events.emit("stormKill", a);
            // credit a recent attacker (within 8s) if any, else the storm
            const credit = a.lastAttacker && W.t - (a.lastHurtByActorT || -99) < 8 ? a.lastAttacker : null;
            W.killActor(a, credit, "storm");
          }
        }
      }
    }
  }
  // player in-storm state for HUD tint + audio
  const p = W.player;
  if (p) {
    const d = Math.hypot(p.pos.x - st.center.x, p.pos.z - st.center.z);
    const inStorm = st.dps > 0 && d > st.radius;
    if (inStorm !== W._playerInStorm) { W._playerInStorm = inStorm; W.events.emit("playerStormState", inStorm); }
  }
}
