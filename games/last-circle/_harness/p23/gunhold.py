#!/usr/bin/env python
"""gunhold - Wave 10 round 1 lane R1B "guns in hand" (gate w10_gunhold). Built from the W10 combat audit's probes
(F:/lc_p23/w10/audit/combat/combat_shots.py and death_shots.py): the same practice range, camera rigs and measurements, turned
into bar rows.

    python _harness/p23/gunhold.py --disk                         # every part, soldier + athlete
    python _harness/p23/gunhold.py --disk --plant open-hand       # the support-hand IK call removed          - MUST FAIL grip
    python _harness/p23/gunhold.py --disk --plant flash-table     # the flash from the old hand-typed table    - MUST FAIL flash-tip
    python _harness/p23/gunhold.py --disk --plant smg-back        # the SMG un-flipped (W9 orientation)       - MUST FAIL smg-dir
    python _harness/p23/gunhold.py --disk --plant hip-pistol      # the W9 hip carry + Meshy run legs         - MUST FAIL pistol
    python _harness/p23/gunhold.py --disk --plant gun-in-dead-hand # the held gun not hidden at death         - MUST FAIL death
    python _harness/p23/gunhold.py --disk --plant flinch-speed-gate # the jolt gated to < 4 m/s like the clip - MUST FAIL flinch
    python _harness/p23/gunhold.py --disk --plant short-guns      # the W9 model length table                 - MUST FAIL lengths
    python _harness/p23/gunhold.py --disk --plant small-flash     # the W9 flash core (0.14 m x k, 55 ms)     - MUST FAIL flash-size
    python _harness/p23/gunhold.py --disk --plant shiny-skin      # the albedo roughness knob held at 0       - MUST FAIL sheen
    python _harness/p23/gunhold.py --rev 361c5ec3                 # the W10 base (W9 R1 live): every bar row MUST FAIL

Rows (PLAN.md "Lane R1B" acceptance bars; the audit value each replaces in brackets):
  grip        left wrist within 0.06 m of the gun's handguard point on all 8 long guns, aiming (ADS) and at idle, on each skin
              [0.10 m off axis, fixed 0.245 m ahead]. The point is the gun's OWN anchor (weaponMesh.userData.guard, holder space);
              the gate checks independently that it lies on the gun (<= 0.07 m from a sampled mesh vertex, 20-85 % of the
              grip -> tip run) so an anchor in mid-air cannot pass.
  flash-tip   flash centre (the core quad's own instance matrix in the fx pool) to the barrel tip measured from the held mesh's
              vertices <= 0.05 m on all 9 guns [0.25-0.72 m]
  smg-dir     the SMG barrel (the thin end: the smaller cross-section of the two 4 cm end slices) . aim direction >= 0.98 [backwards]
  pistol      model length 0.22-0.26 m; right-hand height within 0.15 m of the AR's at idle; planted-foot slide <= 1.1 m/s at a
              6 m/s run [0.34 m; 2.8 m/s]
  lengths     each gun within +-10 % of the plan's target table [15-25 % short]
  death       held gun hidden by the loot-spawn frame + 1; body visible (parented, dither 1) and not sunk (root >= its death floor
              - 0.02 m) at 6.0 s [gun visible to f420; sinks from ~3 s]
  flinch      a sprinting target: torso (Spine2 relative to Hips) off its phase-matched unhit pose by >= 3 deg within 100 ms of a
              hit [none]
  flash-size  core size >= 0.21 m (fx read-back) and the core quad at alpha >= 0.5 for >= 2 frames at 60 fps [0.14 m, 0.055 s]
  sheen       skin-pixel specular peak (p99 - p50 luminance of the warm skin pixels inside the actor mask, c_face and c_near
              views of the soldier) <= 0.6 x the W9 tip's (measured by a second Chrome on --sheen-base, cached) [roughness 0.272]
plus: 0 new programs over the run, 0 page / console errors, 0 failed requests, 0 shader errors, 0 [rig] lines.
Screenshots (what the player sees + side views per gun) go to --shots (default _harness/_shots/gunhold_<tag>).
Exit 0 pass / 1 fail / 2 could-not-judge.
"""
from __future__ import annotations

import argparse
import base64
import copy
import io
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import common as C  # noqa: E402
import p23lib as L  # noqa: E402

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

SHEEN_BASE = "361c5ec3"      # the W10 base = the W9 R1 live build (LIVE_REV b7e245ef + the gates baseline commit). NEVER moves
LONG = ["smg", "ar", "burst", "lmg", "dmr", "shotgun", "sniper", "glauncher"]
GUNS = ["pistol"] + LONG
TARGET = {"pistol": 0.24, "smg": 0.62, "ar": 0.80, "burst": 0.80, "lmg": 1.00, "dmr": 1.05, "shotgun": 0.95, "sniper": 1.15, "glauncher": 0.85}
RP = "runtime/3d/royale/"

# planted faults: served-file edits (each anchor must occur exactly once in the served file)
PLANTS = {
    "open-hand": [(RP + "player.js", [("if (ikOn) supportHandIK(a, ", "if (false) supportHandIK(a, ")])],
    "flash-table": [(RP + "weapons.js", [("const wm = a.weaponMesh, tip = wm && wm.userData.wid === a.weapon.id ? wm.userData.tip : null;",
                                          "const wm = a.weaponMesh, tip = null;")])],
    "smg-back": [(RP + "weapons.js", [("const WPN_FLIP = { ar: true, glauncher: true, smg: true };", "const WPN_FLIP = { ar: true, glauncher: true };")])],
    "hip-pistol": [(RP + "player.js", [("else if (armed && !combat && !isPistol(a)) mode = \"lowReady\";", "else if (armed && !combat) mode = \"lowReady\";"),
                                       ("return !!(C && C.rifle_run_g && C.rifle_idle_g && isPistol(a));", "return false;")]),
                   (RP + "weapons.js", [("const WPN_LEN = { pistol: 0.24,", "const WPN_LEN = { pistol: 0.34,")])],
    "gun-in-dead-hand": [(RP + "player.js", [("  if (victim.weaponMesh) victim.weaponMesh.visible = false;", "  /* planted: gun-in-dead-hand */"),
                                             ("!a.emoting && !a.gliding && a.alive;", "!a.emoting && !a.gliding;")])],
    "flinch-speed-gate": [(RP + "player.js", [("if (!res.dead && res.dealt > 0 && victim.alive) startJolt(W, victim, att);",
                                               "if (!res.dead && res.dealt > 0 && victim.alive && Math.hypot(victim.vel.x, victim.vel.z) < 4) startJolt(W, victim, att);")])],
    "short-guns": [(RP + "weapons.js", [("const WPN_LEN = { pistol: 0.24, smg: 0.62, ar: 0.80, shotgun: 0.95, sniper: 1.08, glauncher: 0.85 };",
                                         "const WPN_LEN = { pistol: 0.34, smg: 0.5, ar: 0.62, shotgun: 0.8, sniper: 0.95, glauncher: 0.7 };"),
                                        ("const g = mergeColoured(m, CC0_LEN[id]);", "const g = mergeColoured(m, 0);")])],
    "small-flash": [(RP + "fx.js", [("const FLASH_CORE_M = 0.21, FLASH_CORE_S = 0.075;", "const FLASH_CORE_M = 0.14, FLASH_CORE_S = 0.055;")])],
    "shiny-skin": [(RP + "player.js", [("SHEEN_K.value = hi ? 1 : 0;", "SHEEN_K.value = 0;")])],
}

EQUIP_JS = r"""(wid) => { const W = window.__LC__.W, K = W.SIM, p = W.player, inv = p.inventory;
  inv.slots[1] = { kind: 'weapon', id: wid, rarity: 2, mag: K.WEAPONS[wid].mag };
  inv.ammo = { light: 999, medium: 999, shells: 999, heavy: 999, grenades: 999 };
  W.equipSlot(p, 1); p.lastShotT = -99; return p.weapon && p.weapon.id; }"""
AIM_JS = r"""([yaw, pitch, ads]) => { const W = window.__LC__.W, p = W.player; if (yaw != null) { p.input.yaw = yaw; p.yaw = yaw; } if (pitch != null) p.input.pitch = pitch; p.input.ads = !!ads; W._rmbDown = !!ads; return [p.input.yaw, p.input.pitch]; }"""
FIRE_ON = r"""() => { const W = window.__LC__.W; W._lmbDown = true; W._fireEdge = performance.now(); W.player.input.fire = true; if (W.player.weapon) W.player.weapon.cd = 0; return W.player.weapon && W.player.weapon.magAmmo; }"""
FIRE_OFF = r"""() => { const W = window.__LC__.W; W._lmbDown = false; W.player.input.fire = false; return 1; }"""
PLACE_JS = r"""([x, z, yaw]) => { const W = window.__LC__.W, p = W.player, M = W.map; const y = M.heightAt(x, z) + 0.05;
  p.pos.set(x, y, z); p.vel.set(0, 0, 0); p.obj.position.copy(p.pos); if (p._pp) p._pp.copy(p.pos); p.input.yaw = yaw; p.yaw = yaw; p.input.pitch = 0; return [x, y, z]; }"""

# the held gun in holder space, measured from its vertices (independent of measureProto): extent along the barrel (+Z), the
# tip, the two 4 cm end slices' cross-sections, the anchor's distance to the mesh and its along-run fraction
GUN_JS = r"""() => { const W = window.__LC__.W, THREE = W.THREE, p = W.player, wm = p.weaponMesh;
  if (!wm || !p.weapon || wm.userData.wid !== p.weapon.id) return { err: 'no held mesh for ' + (p.weapon && p.weapon.id) };
  p.obj.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(p.hand.matrixWorld).invert(); const v = new THREE.Vector3(); const P = [];
  wm.traverse((o) => { if (!o.isMesh || !o.geometry) return; const pa = o.geometry.attributes.position; const st = Math.max(1, Math.floor(pa.count / 5000));
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld); for (let i = 0; i < pa.count; i += st) { v.fromBufferAttribute(pa, i).applyMatrix4(m); P.push([v.x, v.y, v.z]); } });
  if (!P.length) return { err: 'no vertices' };
  let zMin = 1e9, zMax = -1e9; for (const q of P) { if (q[2] < zMin) zMin = q[2]; if (q[2] > zMax) zMax = q[2]; }
  const slice = (lo, hi) => { let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, n = 0; for (const q of P) if (q[2] >= lo && q[2] <= hi) { n++; x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
    return n ? { n, area: +((x1 - x0) * (y1 - y0) * 1e4).toFixed(2), w: +(x1 - x0).toFixed(3), h: +(y1 - y0).toFixed(3) } : { n: 0, area: 0 }; };
  const front = slice(zMax - 0.04, zMax), back = slice(zMin, zMin + 0.04);
  const out = { wid: p.weapon.id, len: +(zMax - zMin).toFixed(3), zMax: +zMax.toFixed(3), zMin: +zMin.toFixed(3), front, back };
  const gd = wm.userData.guard;
  if (gd) { let dm = 1e9; for (const q of P) { const d = Math.hypot(q[0] - gd.x, q[1] - gd.y, q[2] - gd.z); if (d < dm) dm = d; }
    out.anchor = [+gd.x.toFixed(3), +gd.y.toFixed(3), +gd.z.toFixed(3)]; out.anchorToMesh = +dm.toFixed(3); out.anchorFrac = +(gd.z / Math.max(1e-3, zMax)).toFixed(3); }
  // barrel direction (world): holder +Z, signed toward the THIN end (the smaller end cross-section), against the aim
  const q = new THREE.Quaternion(); p.hand.getWorldQuaternion(q); const z = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const thinFront = front.area <= back.area; if (!thinFront) z.negate();
  const W2 = window.__LC__.W; const ad = new THREE.Vector3(); const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
  ad.set(-Math.sin(p.yaw) * cp, sp, -Math.cos(p.yaw) * cp).normalize();
  out.thinFront = thinFront; out.barrelDotAim = +z.dot(ad).toFixed(3);
  return out; }"""

GRIP_JS = r"""() => { const W = window.__LC__.W, THREE = W.THREE, p = W.player, wm = p.weaponMesh;
  if (!wm || wm.userData.wid !== p.weapon.id) return { err: 'no held mesh' };
  const gd = wm.userData.guard; if (!gd) return { err: 'no handguard anchor on the held gun' };
  p.obj.updateMatrixWorld(true);
  let LH = null; p.obj.traverse((o) => { if (o.isBone && /LeftHand$/.test(o.name)) LH = o; });
  if (!LH) return { err: 'no LeftHand bone' };
  const w = LH.getWorldPosition(new THREE.Vector3()); const g = wm.localToWorld(new THREE.Vector3(gd.x, gd.y, gd.z));
  return { wrist: +w.distanceTo(g).toFixed(3), anim: p.anim, ads: !!p.input.ads, fingers: p._grip ? p._grip.fingers : null, slid: !!p._gripSlid, ikW: p._ikW }; }"""

# the fx pool slot of the last muzzle flash (fx readback) + the core quad's own matrix / alpha, and the tip of the held mesh
FLASH_JS = r"""() => { const W = window.__LC__.W, THREE = W.THREE, p = W.player, wm = p.weaponMesh; const F = window.__LC__.feel().fx; const mf = F && F.muzzle;
  if (!mf) return { err: 'no fx muzzle read-back' };
  let inst = null; W.scene.traverse((o) => { if (o.name === 'fx-quads') inst = o; });
  if (!inst) return { err: 'no fx-quads mesh' };
  const m = inst.instanceMatrix.array, o = mf.idx * 16, ia = inst.geometry.attributes.iA.array;
  const c = new THREE.Vector3(m[o + 12], m[o + 13], m[o + 14]);
  const out = { wid: mf.wid, size: mf.size, life: mf.life, hi: mf.hi, idx: mf.idx, alpha: +ia[mf.idx * 4 + 1].toFixed(3), scale: +m[o].toFixed(4), centre: [c.x, c.y, c.z] };
  if (wm && wm.userData.wid === p.weapon.id) {
    p.obj.updateMatrixWorld(true);
    const q = new THREE.Quaternion(); p.hand.getWorldQuaternion(q); const z = new THREE.Vector3(0, 0, 1).applyQuaternion(q); const h = p.hand.getWorldPosition(new THREE.Vector3());
    let best = -1e9; const tp = new THREE.Vector3(), v = new THREE.Vector3(); const V = [];
    wm.traverse((o2) => { if (!o2.isMesh) return; const pa = o2.geometry.attributes.position; const st = Math.max(1, Math.floor(pa.count / 5000));
      for (let i = 0; i < pa.count; i += st) { v.fromBufferAttribute(pa, i).applyMatrix4(o2.matrixWorld); const d = v.clone().sub(h).dot(z); V.push([v.x, v.y, v.z, d]); if (d > best) { best = d; tp.copy(v); } } });
    // the tip = the centre of the muzzle face: the centroid of the vertices within 2 cm of the extreme projection along the barrel
    // (the extreme vertex alone sits on the rim, a cm or two off the bore axis)
    const tc = new THREE.Vector3(); let tn = 0; for (const q of V) if (q[3] > best - 0.02) { tc.x += q[0]; tc.y += q[1]; tc.z += q[2]; tn++; } tc.multiplyScalar(1 / tn);
    out.tipToFlash = +c.distanceTo(tc).toFixed(3); out.rimToFlash = +c.distanceTo(tp).toFixed(3);
  }
  return out; }"""
ALPHA_JS = r"""(idx) => { const W = window.__LC__.W; let inst = null; W.scene.traverse((o) => { if (o.name === 'fx-quads') inst = o; });
  const ia = inst.geometry.attributes.iA.array, m = inst.instanceMatrix.array; return [+ia[idx * 4 + 1].toFixed(3), +m[idx * 16].toFixed(4)]; }"""

HAND_JS = r"""() => { const W = window.__LC__.W, THREE = W.THREE, p = W.player; p.obj.updateMatrixWorld(true); let RH = null;
  p.obj.traverse((o) => { if (o.isBone && /RightHand$/.test(o.name)) RH = o; }); const v = RH.getWorldPosition(new THREE.Vector3());
  return { h: +(v.y - p.pos.y).toFixed(3), anim: p.anim, mode: p._armMode || null, armW: +(p._armW || 0).toFixed(2) }; }"""

SLIDE_JS = r"""([n, dt]) => { const W = window.__LC__.W, THREE = W.THREE, p = W.player, P = window.__H_PUMP__;
  let LF = null, RF = null; p.obj.traverse((o) => { if (o.isBone) { if (/LeftToeBase$/.test(o.name)) LF = o; if (/RightToeBase$/.test(o.name)) RF = o; } });
  if (!LF || !RF) { p.obj.traverse((o) => { if (o.isBone) { if (/LeftFoot$/.test(o.name)) LF = LF || o; if (/RightFoot$/.test(o.name)) RF = RF || o; } }); }
  if (!LF || !RF) return { err: 'no foot bones' };
  const v = new THREE.Vector3(); const S = { L: [], R: [], B: [] };
  for (let i = 0; i < n; i++) { P.step(1, dt, false); W.scene.updateMatrixWorld(true);
    LF.getWorldPosition(v); S.L.push([v.x, v.y - p.pos.y, v.z]); RF.getWorldPosition(v); S.R.push([v.x, v.y - p.pos.y, v.z]); S.B.push([p.pos.x, p.pos.y, p.pos.z]); }
  const out = { anim: p.anim, n };
  let bd = 0; for (let i = 1; i < n; i++) bd += Math.hypot(S.B[i][0] - S.B[i - 1][0], S.B[i][2] - S.B[i - 1][2]); out.bodySpeed = +(bd / ((n - 1) * dt)).toFixed(2);
  let sl = 0, sn = 0;
  for (const k of ['L', 'R']) { const a = S[k]; let mn = 1e9; for (const q of a) mn = Math.min(mn, q[1]);
    for (let i = 1; i < n; i++) if (a[i][1] - mn < 0.035 && a[i - 1][1] - mn < 0.035) { sl += Math.hypot(a[i][0] - a[i - 1][0], a[i][2] - a[i - 1][2]) / dt; sn++; } }
  out.plantedFrames = sn; out.slideMean = sn ? +(sl / sn).toFixed(3) : null; return out; }"""

# per frame: the clip phase and Spine2 relative to Hips (the torso pose the jolt moves)
TORSO_JS = r"""([n, hitAt]) => { const W = window.__LC__.W, THREE = W.THREE, p = W.player, P = window.__H_PUMP__;
  let H = null, S2 = null; p.obj.traverse((o) => { if (!o.isBone) return; const nm = o.name.replace(/^mixamorig:?/i, ''); if (nm === 'Hips') H = o; if (nm === 'Spine2' || nm === 'Spine02') S2 = o; });
  if (!H || !S2) return { err: 'no Hips / Spine2' };
  const qh = new THREE.Quaternion(), qs = new THREE.Quaternion(); const rows = []; const x0 = p.pos.x, z0 = p.pos.z;
  for (let i = 0; i < n; i++) {
    if (i === hitAt) W.hurtActor(p, 6, null, 'ar', false);
    P.step(1, 1 / 60, false);
    // keep the runner on its open lane: move it back to the start (velocity, clip and phase untouched; the lerp sees no teleport
    // because _pp moves with it)
    const dx = p.pos.x - x0, dz = p.pos.z - z0; p.pos.x = x0; p.pos.z = z0; p.pos.y = W.map.heightAt(x0, z0); if (p._pp) { p._pp.x -= dx; p._pp.z -= dz; p._pp.y = p.pos.y; }
    p.obj.position.copy(p.pos); p.obj.updateMatrixWorld(true);
    H.getWorldQuaternion(qh); S2.getWorldQuaternion(qs); const r = qh.invert().multiply(qs);
    const cn = p.clips && p.clips[p.anim]; const act = cn && p.rig.actions[cn]; const clip = act && act.getClip();
    rows.push({ i, anim: p.anim, ph: act && clip ? (act.time % clip.duration) / clip.duration : null, q: [r.x, r.y, r.z, r.w], spd: +Math.hypot(p.vel.x, p.vel.z).toFixed(2) });
  }
  return { rows }; }"""

BRING_JS = r"""(k) => { const W = window.__LC__.W, p = W.player; const used = window.__USED__ = window.__USED__ || {};
  const bots = W.actors.filter((a) => a.isBot && a.alive && !a.gliding && !a.downed && a !== p && !used[a.id] && a.weapon && !String(a.weapon.id).startsWith('consumable') && a.rig)
    .map((a) => [a, Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z)]).sort((a, b) => a[1] - b[1]);
  if (!bots.length) return null; const b = bots[0][0]; used[b.id] = 1;
  const x = p.pos.x + (k - 0.5) * 3.0, z = p.pos.z - 6.5; b.pos.set(x, W.map.heightAt(x, z) + 0.05, z); b.vel.set(0, 0, 0); b.yaw = Math.PI; b.obj.position.copy(b.pos); if (b._pp) b._pp.copy(b.pos);
  return { id: b.id, skin: b.skin, wpn: b.weapon && b.weapon.id, x, z, floor: W.map.heightAt(x, z) }; }"""
BODY_JS = r"""(id) => { const W = window.__LC__.W, b = W.actorById.get(id); const ud = b._bodies && b._bodies[0] && b._bodies[0].material.userData;
  return { alive: !!b.alive, parented: !!(b.obj && b.obj.parent), vis: !!(b.obj && b.obj.visible), y: +b.obj.position.y.toFixed(3), dither: ud && ud.zDither ? ud.zDither.value : null,
           gunVis: !!(b.weaponMesh && b.weaponMesh.visible && b.hand && b.hand.visible), sinkT: b._sinkT, hold: b._sinkHold, t: W.t }; }"""
KILL_JS = r"""(id) => { const W = window.__LC__.W, b = W.actorById.get(id); b.shield = 0; const before = (W.nearbyLoot(b.pos, 4, 4) || []).length;
  W.hurtActor(b, 2000, W.player.id, 'ar', false);
  const items = (W.nearbyLoot(b.pos, 4, 4) || []); const dd = items.filter((it) => String(it.id || '').startsWith('dd:' + id + ':') && it.data && it.data.kind === 'weapon').length;
  return { alive: !!b.alive, lootBefore: before, lootAfter: items.length, droppedWeapons: dd, gunVisSameFrame: !!(b.weaponMesh && b.weaponMesh.visible && b.hand && b.hand.visible) }; }"""

# camera relative to an actor, rendered through the composer (combat_shots CAM_JS / REL_JS)
SHOT_JS = r"""([side, fwdD, up, lookY, fov, hide, matte]) => { const W = window.__LC__.W, k = W.kernel, cam = k.camera, r = k.renderer, a = W.player;
  const rs = []; if (matte) for (const b of (a._bodies || [])) { const ms = Array.isArray(b.material) ? b.material : [b.material]; for (const m of ms) { rs.push([m, m.roughness]); m.roughness = 1; } }
  const y2 = (a._bodyYaw != null && a._hasBodyYaw) ? a._bodyYaw - Math.PI : a.yaw; const fx = -Math.sin(y2), fz = -Math.cos(y2), rx = -fz, rz = fx;
  const of = cam.fov, op = cam.position.clone(), oq = cam.quaternion.clone(); const ov = a.obj.visible; if (hide) a.obj.visible = false;
  cam.fov = fov; cam.updateProjectionMatrix(); cam.position.set(a.pos.x + rx * side + fx * fwdD, a.pos.y + up, a.pos.z + rz * side + fz * fwdD); cam.lookAt(a.pos.x, a.pos.y + lookY, a.pos.z); cam.updateMatrixWorld(true);
  if (k.composer) k.composer.render(1 / 60); else r.render(k.scene, cam); const png = r.domElement.toDataURL('image/png');
  for (const [m, v0] of rs) m.roughness = v0;
  a.obj.visible = ov; cam.fov = of; cam.position.copy(op); cam.quaternion.copy(oq); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true); return png; }"""
GAME_JS = r"""() => { const P = window.__H_PUMP__; P.step(1, 1 / 60, true); return window.__LC__.W.kernel.renderer.domElement.toDataURL('image/png'); }"""


def decode(url):
    return np.asarray(Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1]))).convert("RGB")).astype(np.float32)


def save(url, d, name):
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, name), "wb") as f:
        f.write(base64.b64decode(url.split(",", 1)[1]))


def qang(a, b):
    d = abs(sum(x * y for x, y in zip(a, b)))
    return math.degrees(2 * math.acos(min(1.0, d)))


def spec_peak(A, B, D):
    """the SPECULAR part of the warm (skin-like) pixels inside the actor mask |A - B| > 8: A (as shipped) minus D (the same
    frame with the body's roughness forced to 1 = the near-diffuse reference); peak = p99 of that difference over skin pixels"""
    m = np.abs(A - B).max(axis=2) > 8.0
    r, g, b = A[..., 0], A[..., 1], A[..., 2]
    L_ = 0.2126 * r + 0.7152 * g + 0.0722 * b
    warm = (r > g) & (g > b) & ((r - b) / np.maximum(r, 1.0) > 0.15) & ((r - b) / np.maximum(r, 1.0) < 0.75) & (L_ > 25) & (L_ < 250)
    sk = m & warm
    n = int(sk.sum())
    if n < 150:
        return {"skinPx": n, "usable": False}
    Ld = 0.2126 * D[..., 0] + 0.7152 * D[..., 1] + 0.0722 * D[..., 2]
    sp = np.clip(L_ - Ld, 0, None)[sk]
    return {"skinPx": n, "usable": True, "p99": float(np.percentile(sp, 99)), "p999": float(np.percentile(sp, 99.9)), "mean": float(sp.mean()), "peak": float(np.percentile(sp, 99))}


def boot_practice(s, skin, seed=5, map_id="ashgrid"):
    s.boot()
    L.dismiss_cards(s)
    s.js("(k) => { try { localStorage.setItem('lc_tutorial_seen', '1'); localStorage.setItem('lc_skin', k); } catch (e) {} return 1; }", skin)
    st = s.start_match("practice", seed, map_id, enter=True, guard=True)
    s.land(120, protect=True)
    s.freeze_loop()
    s.install_pump()
    s.guard_player(True)
    spot = L.flat_spot(s, clear=6.0)
    if spot:
        s.js(PLACE_JS, [spot["x"], spot["z"], 0.0])
    s.step_frames(30, 1 / 60, render=False)
    return {"start": st, "spot": spot, "skin": s.js("() => window.__LC__.W.player.skin")}


def part_guns(s, v, R, skin, shots, want):
    """grip / flash-tip / flash-size / smg-dir / lengths / pistol (hand height) on one skin"""
    G = R.setdefault(skin, {})
    for wid in GUNS:
        s.js(EQUIP_JS, wid)
        s.js(AIM_JS, [0.0, 0.0, False])
        s.step_frames(130, 1 / 60, render=False)                    # out of combat (> 1.5 s since a shot), ready delay over
        rec = G.setdefault(wid, {})
        rec["gun"] = s.js(GUN_JS)
        rec["idle"] = s.js(GRIP_JS)
        rec["hand"] = s.js(HAND_JS)
        save(s.js(SHOT_JS, [2.6, 0.5, 1.35, 1.2, 30, False, False]), shots, "%s_%s_side_idle.png" % (skin, wid))
        s.js(AIM_JS, [0.0, 0.0, True])
        s.step_frames(40, 1 / 60, render=False)
        rec["ads"] = s.js(GRIP_JS)
        save(s.js(SHOT_JS, [2.6, 0.5, 1.35, 1.2, 30, False, False]), shots, "%s_%s_side_ads.png" % (skin, wid))
        if "flash" in want:
            s.js(FIRE_ON)
            s.step_frames(1, 1 / 60, render=False)
            fl = s.js(FLASH_JS)
            s.js(FIRE_OFF)
            seen = []
            if "idx" in fl:
                seen.append([fl["alpha"], fl["scale"]])
                for _ in range(7):
                    s.step_frames(1, 1 / 60, render=False)
                    seen.append(s.js(ALPHA_JS, fl["idx"]))
            fl["frames"] = seen
            fl["visibleFrames"] = sum(1 for a_, sc in seen if a_ >= 0.5 and sc > 0)
            rec["flash"] = fl
            # what the player sees: the game camera on the shot frame
            s.js(FIRE_ON)
            save(s.js(GAME_JS), shots, "%s_%s_tp_fire.png" % (skin, wid))
            save(s.js(SHOT_JS, [2.6, 0.5, 1.35, 1.2, 30, False, False]), shots, "%s_%s_side_fire.png" % (skin, wid))
            s.js(FIRE_OFF)
            s.step_frames(30, 1 / 60, render=False)
        s.js(AIM_JS, [0.0, 0.0, False])
        v.info("%s %s" % (skin, wid), rec)
    return G


def part_pistol_slide(s, v, R, skin):
    out = {}
    for wid in ("pistol", "ar"):
        spot = s.js("() => { const p = window.__LC__.W.player; return [p.pos.x, p.pos.z]; }")
        s.js(EQUIP_JS, wid)
        s.js(AIM_JS, [0.0, 0.0, False])
        s.step_frames(100, 1 / 60, render=False)
        s.hold(["KeyW"])
        s.step_frames(45, 1 / 60, render=False)
        out[wid] = s.js(SLIDE_JS, [90, 1 / 60])
        s.release_all()
        s.step_frames(30, 1 / 60, render=False)
        s.js(PLACE_JS, [spot[0], spot[1], 0.0])
        s.step_frames(20, 1 / 60, render=False)
    R.setdefault(skin, {})["slide"] = out
    v.info("%s run foot slide (pistol vs ar)" % skin, out)
    return out


def part_flinch(s, v, R, skin):
    s.js(EQUIP_JS, "ar")
    s.js(AIM_JS, [0.0, 0.0, False])
    s.step_frames(60, 1 / 60, render=False)
    s.hold(["KeyW"])
    s.step_frames(10, 1 / 60, render=False)
    s.press("ShiftLeft")                                  # sprint (the audit's way: a Shift press while running)
    s.step_frames(20, 1 / 60, render=False)
    res = s.js(TORSO_JS, [110, 80])
    s.release_all()
    s.step_frames(30, 1 / 60, render=False)
    if "rows" not in res:
        return {"err": res}
    rows = res["rows"]
    base = [r_ for r_ in rows[:80] if r_["ph"] is not None and r_["anim"] == rows[79]["anim"]]
    def off(r_, pool):
        cand = [b for b in pool if b["i"] < r_["i"] - 8]
        if not cand:
            return None
        b = min(cand, key=lambda b: min(abs(b["ph"] - r_["ph"]), 1 - abs(b["ph"] - r_["ph"])))
        return qang(r_["q"], b["q"])
    noise = [off(r_, base) for r_ in rows[50:80]]
    noise = [x for x in noise if x is not None]
    post = [off(r_, base) for r_ in rows[80:86]]          # the 6 frames = 100 ms after the hit
    post = [x for x in post if x is not None]
    out = {"anim": rows[79]["anim"], "speed": rows[79]["spd"], "noiseMaxDeg": round(max(noise), 2) if noise else None,
           "postDeg": [round(x, 2) for x in post], "postMaxDeg": round(max(post), 2) if post else None}
    R.setdefault(skin, {})["flinch"] = out
    v.info("%s flinch (sprinting, hit at frame 80)" % skin, out)
    return out


def part_sheen(s, v, R, shots, tag):
    s.js(EQUIP_JS, "ar")
    s.js(AIM_JS, [0.0, 0.0, False])
    s.step_frames(90, 1 / 60, render=False)
    out = {}
    for name, rig in (("c_face", [0.0, 1.2, 1.62, 1.55, 30]), ("c_near", [0.9, 3.3, 1.15, 0.95, 30])):
        A = decode(s.js(SHOT_JS, rig + [False, False]))
        B = decode(s.js(SHOT_JS, rig + [True, False]))
        D = decode(s.js(SHOT_JS, rig + [False, True]))
        Image.fromarray(A.astype(np.uint8)).save(os.path.join(shots, "%s_%s.png" % (tag, name)))
        out[name] = spec_peak(A, B, D)
    return out


def sheen_base(args, v, shots):
    """the W9 tip's skin specular peak, measured once by a second Chrome on SHEEN_BASE and cached"""
    path = os.path.join(C.REPORTS, "gunhold_sheenbase_%s_%dx%d_v2.json" % (SHEEN_BASE, args.width, args.height))
    if os.path.exists(path) and not args.no_cache:
        with open(path) as f:
            return json.load(f), True
    a2 = copy.copy(args)
    a2.rev = SHEEN_BASE
    a2.disk = True
    a2.overlay = None
    with C.Session(a2, "gunhold_sheenbase") as s:
        boot_practice(s, "soldier")
        res = part_sheen(s, v, {}, shots, "base")
    with open(path, "w") as f:
        json.dump(res, f)
    return res, False


def part_death(s, v, R):
    s.boot()
    L.dismiss_cards(s)
    s.js("() => { try { localStorage.setItem('lc_tutorial_seen', '1'); localStorage.setItem('lc_skin', 'soldier'); } catch (e) {} return 1; }")
    s.start_match("standard", 7, "ashgrid", enter=True, guard=True)
    s.land(120, protect=True)
    s.freeze_loop()
    s.install_pump()
    s.guard_player(True)
    spot = L.flat_spot(s, clear=10.0)
    if spot:
        s.js(PLACE_JS, [spot["x"], spot["z"], 0.0])
    s.step_frames(30, 1 / 60, render=True)
    R["deathP0"] = L.programs(s)                              # this segment's program count, after its own boot
    out = []
    for k in range(2):
        b = s.js(BRING_JS, k)
        if not b:
            break
        s.step_frames(10, 1 / 60, render=False)
        before = s.js(BODY_JS, b["id"])
        kl = s.js(KILL_JS, b["id"])
        s.step_frames(1, 1 / 60, render=False)
        f1 = s.js(BODY_JS, b["id"])
        s.step_frames(359, 1 / 60, render=False)                 # 6.0 s after the kill
        t6 = s.js(BODY_JS, b["id"])
        rec = {"bot": b, "before": before, "kill": kl, "f1": f1, "t6": t6}
        out.append(rec)
        v.info("death %d" % k, rec)
    R["death"] = out
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    ap.add_argument("--skins", default="soldier,athlete")
    ap.add_argument("--parts", default="guns,flash,pistol,flinch,death,sheen")
    ap.add_argument("--shots", default=None)
    ap.add_argument("--no-cache", action="store_true", help="re-measure the W9 tip's sheen baseline")
    args = L.parse(ap)
    want = set(args.parts.split(","))
    tag = (args.plant or ("rev-" + args.rev if getattr(args, "rev", None) else "disk"))
    shots = args.shots or os.path.join(C.SHOTS, "gunhold_" + tag)
    os.makedirs(shots, exist_ok=True)

    def plant(s):
        if not args.plant:
            return
        for rel, edits in PLANTS[args.plant]:
            L.serve_patched(s, rel, edits)

    def body(v):
        R = v.data["rows"] = {}
        skins = [x for x in args.skins.split(",") if x]
        progs = []
        with C.Session(args, "w10_gunhold") as s:
            plant(s)
            if want & {"guns", "flash", "pistol", "flinch", "sheen"}:
                for i, skin in enumerate(skins):
                    v.info("practice %s" % skin, boot_practice(s, skin))
                    p0 = L.programs(s)
                    if want & {"guns", "flash", "pistol"}:
                        part_guns(s, v, R, skin, shots, want)
                    if "pistol" in want:
                        part_pistol_slide(s, v, R, skin)
                    if "flinch" in want:
                        part_flinch(s, v, R, skin)
                    if "sheen" in want and i == 0:
                        R["sheen"] = part_sheen(s, v, R, shots, "build")
                    s.step_frames(10, 1 / 60, render=True)
                    progs.append([skin, p0, L.programs(s)])
            if "death" in want:
                part_death(s, v, R)
                s.step_frames(10, 1 / 60, render=True)
                progs.append(["death", R.get("deathP0"), L.programs(s)])
            v.check("programs: none linked while the guns are equipped / fired / killed (per session segment)",
                    all(a_ is not None and b_ is not None and b_ <= a_ for _, a_, b_ in progs), progs, "no increase")
            L.errors_row(v, s)
            d = s.diagnostics()
            v.check("0 shader errors, 0 [rig] lines", not d["shader"] and not d["rigWarnings"], (d["shader"] + d["rigWarnings"])[:4])
        # ---------------- verdict rows
        if want & {"guns"}:
            bad, rows = [], {}
            for skin in skins:
                for wid in LONG:
                    r_ = R.get(skin, {}).get(wid, {})
                    g = r_.get("gun", {})
                    for st in ("idle", "ads"):
                        m = r_.get(st, {})
                        w_ = m.get("wrist")
                        on = g.get("anchorToMesh")
                        fr = g.get("anchorFrac")
                        ok = w_ is not None and w_ <= 0.06 and on is not None and on <= 0.07 and fr is not None and 0.2 <= fr <= 0.85
                        rows["%s/%s/%s" % (skin, wid, st)] = [w_, on, fr]
                        if not ok:
                            bad.append("%s/%s/%s" % (skin, wid, st))
            v.check("grip: left wrist within 0.06 m of the gun's handguard anchor on all 8 long guns, idle and ADS, every skin (anchor on the gun: <= 0.07 m from its mesh, 20-85 % of grip->tip)",
                    not bad and bool(rows), {"bad": bad, "[wrist, anchorToMesh, frac]": rows}, "<= 0.06 m")
            lens, badl = {}, []
            for wid in GUNS:
                L_ = R.get(skins[0], {}).get(wid, {}).get("gun", {}).get("len")
                lens[wid] = [L_, TARGET[wid]]
                if L_ is None or abs(L_ - TARGET[wid]) > 0.10 * TARGET[wid]:
                    badl.append(wid)
            v.check("lengths: every gun within +-10 % of its target length (pistol .24 smg .62 ar .80 burst .80 lmg 1.00 dmr 1.05 shotgun .95 sniper 1.15 gl .85)",
                    not badl, {"bad": badl, "[len, target]": lens}, "+-10 %")
            sd = {sk: R.get(sk, {}).get("smg", {}).get("gun", {}) for sk in skins}
            v.check("smg-dir: SMG barrel (thin end) . aim direction >= 0.98 on every skin",
                    all(x.get("barrelDotAim") is not None and x["barrelDotAim"] >= 0.98 for x in sd.values()),
                    {k: {kk: x.get(kk) for kk in ("barrelDotAim", "thinFront", "front", "back")} for k, x in sd.items()}, ">= 0.98")
        if "flash" in want:
            tips, badt, sizes, bads = {}, [], {}, []
            for skin in skins:
                for wid in GUNS:
                    f = R.get(skin, {}).get(wid, {}).get("flash", {})
                    d = f.get("tipToFlash")
                    tips["%s/%s" % (skin, wid)] = d
                    if d is None or d > 0.05:
                        badt.append("%s/%s" % (skin, wid))
                    sizes["%s/%s" % (skin, wid)] = [f.get("size"), f.get("visibleFrames")]
                    if f.get("size") is None or f["size"] < 0.21 - 1e-6 or (f.get("visibleFrames") or 0) < 2:
                        bads.append("%s/%s" % (skin, wid))
            v.check("flash-tip: flash centre to the barrel tip <= 0.05 m on all 9 guns, every skin", not badt, {"bad": badt, "dist": tips}, "<= 0.05 m")
            v.check("flash-size: core >= 0.21 m and at alpha >= 0.5 for >= 2 frames at 60 fps on all 9 guns", not bads, {"bad": bads, "[size, frames]": sizes}, ">= 0.21 m, >= 2 frames")
        if "pistol" in want:
            res = {}
            ok = True
            for skin in skins:
                G = R.get(skin, {})
                pl = G.get("pistol", {}).get("gun", {}).get("len")
                hp = G.get("pistol", {}).get("hand", {}).get("h")
                ha = G.get("ar", {}).get("hand", {}).get("h")
                sl = G.get("slide", {}).get("pistol", {})
                # the slide bar is the plan's: planted-foot slide <= 1.1 m/s at run, on EVERY skin measured (no per-skin exception).
                # The AR's slide on the same legs is reported beside it for diagnosis only; it never moves the cap.
                arS = G.get("slide", {}).get("ar", {}).get("slideMean")
                cap = 1.1
                one = pl is not None and 0.22 <= pl <= 0.26 and hp is not None and ha is not None and abs(hp - ha) <= 0.15 and \
                    sl.get("slideMean") is not None and sl["slideMean"] <= cap and (sl.get("bodySpeed") or 0) >= 5.0
                res[skin] = {"len": pl, "handPistol": hp, "handAr": ha, "pistolMode": G.get("pistol", {}).get("hand", {}).get("mode"),
                             "slide": sl.get("slideMean"), "bodySpeed": sl.get("bodySpeed"), "anim": sl.get("anim"), "arSlide": arS, "slideCap": cap}
                ok = ok and one
            v.check("pistol: length 0.22-0.26 m; right hand within 0.15 m of the AR's height at idle; planted-foot slide <= 1.1 m/s at a >= 5 m/s run",
                    ok and bool(res), res)
        if "flinch" in want:
            fs = {sk: R.get(sk, {}).get("flinch", {}) for sk in skins}
            v.check("flinch: a sprinting target's torso is >= 3 deg off its phase-matched unhit pose within 100 ms of a hit (every skin)",
                    all(x.get("postMaxDeg") is not None and x["postMaxDeg"] >= 3.0 and (x.get("speed") or 0) >= 6.0 for x in fs.values()), fs, ">= 3 deg")
        if "death" in want:
            D = R.get("death", [])
            ok = len(D) >= 2
            rows = []
            for d in D:
                k_, f1, t6 = d["kill"], d["f1"], d["t6"]
                one = (not k_["alive"]) and k_["droppedWeapons"] >= 1 and not f1["gunVis"] and t6["parented"] and t6["vis"] and \
                    (t6["dither"] is None or t6["dither"] >= 0.999) and t6["y"] >= d["bot"]["floor"] - 0.02
                rows.append({"id": d["bot"]["id"], "dropped": k_["droppedWeapons"], "gunVisF1": f1["gunVis"], "t6": t6, "floor": d["bot"]["floor"]})
                ok = ok and one
            v.check("death: held gun hidden by the loot-spawn frame + 1; body visible, not dithered and not sunk at 6.0 s (2 kills)", ok, rows)
        if "sheen" in want:
            b = R.get("sheen")
            if b is None:
                v.cnj("sheen", "the build was not measured")
            else:
                base, cached = sheen_base(args, v, shots)
                R["sheenBase"] = base
                rat = {}
                for k in ("c_face", "c_near"):
                    if b.get(k, {}).get("usable") and base.get(k, {}).get("usable"):
                        rat[k] = round(b[k]["peak"] / max(1e-3, base[k]["peak"]), 3)
                v.check("sheen: skin-pixel specular peak <= 0.6 x the W9 tip's on c_face and c_near", len(rat) == 2 and all(x <= 0.6 for x in rat.values()),
                        {"ratio": rat, "build": b, "w9tip": base, "baseCached": cached}, "<= 0.6x")
    return C.run_gate("w10_gunhold", body, args)


if __name__ == "__main__":
    sys.exit(main())
