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
    python _harness/p23/gunhold.py --disk --plant head-reload     # the reload layer holds the gun at head height  - MUST FAIL reload-height
    python _harness/p23/gunhold.py --disk --plant reload-off      # the R3B reload layer off (the W9 clip)        - MUST FAIL reload-hand + pistol-reload
    python _harness/p23/gunhold.py --disk --plant gun-in-water    # the held gun not put away on the surface   - MUST FAIL swim
    python _harness/p23/gunhold.py --disk --plant sling-all       # the slung-gun cap removed                  - MUST FAIL swap
    python _harness/p23/gunhold.py --disk --plant swim-cam-under  # the camera follows the sunk swim body      - MUST FAIL swim-view
    python _harness/p23/gunhold.py --disk --plant swim-sunk       # the sink keyed off the chest, clip lean kept - MUST FAIL swim-head
    python _harness/p23/gunhold.py --disk --plant swim-lean       # the upright correction off (clip lean kept) - MUST FAIL swim
    python _harness/p23/gunhold.py --disk --plant swim-arms-up    # the arms ride the straightened torso up     - MUST FAIL swim-arms
    python _harness/p23/gunhold.py --disk --plant kerb-pop        # the arm / gun layers gated by onGround     - MUST FAIL kerb
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
Wave 10 round 3 lane R3B rows (parts reload, swim, swap):
  reload-height  the barrel tip (the gun's measured tip, world) stays within 0.35 m of its aim-pose height (the 10 frames before the
                 reload) on every frame of the reload: all 9 guns standing, every skin, plus the AR reloading on the run [head height]
  reload-hand    left wrist within 0.08 m of the gun's mag well on every frame of each magazine / shell window ([beat - 0.02, beat + 0.03]
                 of reloadS, the beats read from audio.js RELOAD_SETS in the page: rifle out + in, pistol in, each shotgun shell, the
                 sniper's out + in, the launcher's shell); the well anchor is checked ON the gun (<= 0.07 m from a sampled vertex),
                 under the bore and behind the handguard anchor [never]
  pistol-reload  the pistol reloads in its own pose (player._rlAnim 'pistol_reload' on >= 80 % of the reload frames) with the left hand on
                 its mag well in the mag-in window (<= 0.08 m) ["idle"]
  swim           on the surface (deep water, still then swimming forward): 0 frames with the held or a slung gun visible; Spine2 (chest)
                 below the water surface on every frame after a 0.7 s settle [crouch on water, gun out]. "The surface" in the swim
                 rows is the DRAWN water (the mesh's +-0.12 m swell, as the camera clamp and the underwater test read it)
  swim-view      on every swimming frame of the same run the player's camera stays >= 0.10 m above the water surface and the
                 game's underwater state (W._underwater: fog / blur / audio low-pass) is off [the camera follows the sunk body]
  swim-head      treading water, head out: on every settled swimming frame of the same run (still after 0.7 s, and swimming on) the
                 Head bone >= 0.15 m above the water surface (with the swim row's chest below it: head and shoulders out)
                 [verify2: Head -0.05..+0.01 m, only the crown of the hair out]
  swim-arms      treading / stroking, not hands-up: on >= 80 % of the settled swimming frames of the same run BOTH wrists (LeftHand,
                 RightHand bones) at or below the drawn water surface, and on 0 settled frames a wrist above the Head bone
                 [verify3: both wrists 0.12-0.31 m above the water, a hand above the Head on 258 of 258 frames]
  kerb           (W10 anim fix 4) a 20 cm kerb step-off (lifted 0.2 m at frame 12, >= 3 frames unsupported) with the AR, SMG, sniper and pistol,
                 running and still, every skin: the right hand's and the muzzle tip's largest per-frame move in the hips' frame <= 2x that
                 run's normal per-frame move (largest move on frames >= 8 away from the step and the landing) [fix3 head: 0.18-0.25 m hand,
                 0.33-0.50 m muzzle in one frame; --plant kerb-pop MUST FAIL it]
  swap           a gun swap lowers the barrel >= 25 deg off the aim mid-swap (max over 0.08-0.20 s after the swap); with >= 9 armed
                 two-gun bots on screen within 35 m, 1 <= actors drawing a slung gun <= 8 and = min(8, eligible) [none]
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
                                             ("!a.emoting && !a.gliding && !a.swimming && a.alive;", "!a.emoting && !a.gliding && !a.swimming;")])],
    "flinch-speed-gate": [(RP + "player.js", [("if (!res.dead && res.dealt > 0 && victim.alive) startJolt(W, victim, att);",
                                               "if (!res.dead && res.dealt > 0 && victim.alive && Math.hypot(victim.vel.x, victim.vel.z) < 4) startJolt(W, victim, att);")])],
    "short-guns": [(RP + "weapons.js", [("const WPN_LEN = { pistol: 0.24, smg: 0.62, ar: 0.80, shotgun: 0.95, sniper: 1.08, glauncher: 0.85 };",
                                         "const WPN_LEN = { pistol: 0.34, smg: 0.5, ar: 0.62, shotgun: 0.8, sniper: 0.95, glauncher: 0.7 };"),
                                        ("const g = mergeColoured(m, CC0_LEN[id]);", "const g = mergeColoured(m, 0);")])],
    "small-flash": [(RP + "fx.js", [("const FLASH_CORE_M = 0.21, FLASH_CORE_S = 0.075;", "const FLASH_CORE_M = 0.14, FLASH_CORE_S = 0.055;")])],
    "shiny-skin": [(RP + "player.js", [("SHEEN_K.value = hi ? 1 : 0;", "SHEEN_K.value = 0;")])],
    # W10 R3B
    # the reload holds the gun at head height: the layer's right-hand target raised 0.45 m (the W9 clip itself lifts the tip only
    # 0.30-0.32 m, inside the plan's 0.35 m bar: reported, see the lane notes; the layer-off control is "reload-off")
    "head-reload": [(RP + "player.js", [("_rlH.copy(a._aimHL); a.obj.localToWorld(_rlH); _rlH.add(shift);",
                                         "_rlH.copy(a._aimHL); a.obj.localToWorld(_rlH); _rlH.add(shift); _rlH.y += 0.45;")])],
    "reload-off": [(RP + "player.js", [("if (rlOn) reloadLayer(W, a, ", "if (false) reloadLayer(W, a, ")])],
    "gun-in-water": [(RP + "player.js", [("&& !a.gliding && !a.swimming && a.alive;", "&& !a.gliding && a.alive;")])],
    "sling-all": [(RP + "player.js", [("const SLING_CAP = 8;", "const SLING_CAP = 999;")])],
    # verify1 finding: the camera followed the sunk body (obj.position.y += _swimOff) under the surface
    "swim-cam-under": [(RP + "player.js", [("const eye = fp.y - (fp === focus.obj.position ? focus._swimOff || 0 : 0) + focus._eyeY;",
                                            "const eye = fp.y + focus._eyeY;")])],
    # verify2 finding: the sink keyed off the chest (Spine2 0.14 m under) and the swim clip's 31 deg lean kept: only the hair out
    "swim-sunk": [(RP + "player.js", [("const hd = a.armBones && a.armBones.head, b = hd || ", "const hd = null, b = hd || "),
                                      ("if (layers && a.swimming && a.armBones && a.alive && deskHi(W)) {", "if (false) {")])],
    # the upright correction off, the head-keyed sink kept: the leaning clip lifts the chest out of the water
    "swim-lean": [(RP + "player.js", [("swimUpright(a, a._swTilt);", "")])],
    # verify3 finding: straightening Hips..Head swung the clip's arms (posed for its 31 deg lean) up to the face - hands-up, not treading
    "swim-arms-up": [(RP + "player.js", [("const SWIM_ARMS_ON = true,", "const SWIM_ARMS_ON = false,")])],
    # W10 anim fix 4 (F-B, check3 finding): the arm / gun layers gated hard by onGround again (fix3's form) - the rifle hold, the weld, the
    # support hand, the pistol arm modes and the spine twist drop for the 7 frames of a 20 cm kerb: the AR's right hand jumps 0.18-0.25 m and
    # its muzzle 0.33-0.50 m in one frame
    "kerb-pop": [(RP + "player.js", [("const gndClip = !airClipOn;", "const gndClip = a.onGround;"),
                                     ("const mixHold = mixamoAim || (mixGun && rhCls && a._rhW > 0);", "const mixHold = mixamoAim;")])],
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


# W10 R3B ---------------------------------------------------------------------------------------------------------------
# the reload sets straight from audio.js (the SAME module instance the game loaded: its resource URL, query and all)
SETS_JS = r"""async () => { const e = performance.getEntriesByType('resource').map((x) => x.name).find((n) => /royale\/audio\.js(\?|$)/.test(n));
  if (!e) return { err: 'audio.js not loaded' }; const m = await import(e); const W = window.__LC__.W, K = W.SIM; const out = {};
  // a build without the R2B / R3B reload data (e.g. the W9 tip 361c5ec3): the reload rows read FAIL with this message, never a page exception
  const miss = ['RELOAD_SETS', 'RELOAD_SET_OF', 'gunSnd'].filter((k) => !m[k]); if (miss.length) return { err: 'audio.js has no ' + miss.join(' / ') + ' (a build without the reload sets)' };
  for (const id of Object.keys(K.WEAPONS)) { const set = m.RELOAD_SET_OF[m.gunSnd(id, K.WEAPONS[id])] || 'rifle'; out[id] = { set, beats: m.RELOAD_SETS[set], reloadS: K.WEAPONS[id].reloadS }; }
  return out; }"""
# per frame through a reload (started here): reload fraction, tip height over the feet, left wrist to the mag well, the layer's names
RELOAD_JS = r"""([n, pre]) => { const W = window.__LC__.W, THREE = W.THREE, p = W.player, P = window.__H_PUMP__, K = W.SIM;
  let LH = null; p.obj.traverse((o) => { if (o.isBone && /LeftHand$/.test(o.name)) LH = o; });
  const tipH = () => { const wm = p.weaponMesh; if (!wm || !wm.userData.tip) return null; W.scene.updateMatrixWorld(true); const t = wm.localToWorld(new THREE.Vector3().copy(wm.userData.tip)); return t.y - p.pos.y; };
  const aim = []; for (let i = 0; i < pre; i++) { P.step(1, 1 / 60, false); aim.push(tipH()); }
  const def = K.WEAPONS[p.weapon.id]; p.weapon.magAmmo = 0; p.input.reload = true;
  const rows = []; let started = false;
  for (let i = 0; i < n; i++) {
    P.step(1, 1 / 60, false); W.scene.updateMatrixWorld(true);
    const st = p.weapon.state; if (st === 'reloading') started = true; else if (started) break;
    if (!started) continue;
    const wm = p.weaponMesh, mw = wm && wm.userData.magWell; const r = { f: +(1 - p.weapon.reloadT / def.reloadS).toFixed(3), h: tipH(), anim: p.anim, rl: p._rlAnim || null, key: p._rlKey || null };
    if (mw && LH) { const g = p.hand.localToWorld(new THREE.Vector3(mw.x, mw.y, mw.z)); r.wrist = +LH.getWorldPosition(new THREE.Vector3()).distanceTo(g).toFixed(3); }
    rows.push(r);
  }
  // the mag-well anchor ON the gun: its distance to the model's vertices (holder space), its height under the bore, its run vs the guard
  const wm = p.weaponMesh, mw = wm && wm.userData.magWell; let anc = null;
  if (mw) { p.obj.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(p.hand.matrixWorld).invert(); const v = new THREE.Vector3(); let dm = 1e9;
    wm.traverse((o) => { if (!o.isMesh) return; const pa = o.geometry.attributes.position; const st = Math.max(1, Math.floor(pa.count / 5000)); const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      for (let i = 0; i < pa.count; i += st) { v.fromBufferAttribute(pa, i).applyMatrix4(m); dm = Math.min(dm, Math.hypot(v.x - mw.x, v.y - mw.y, v.z - mw.z)); } });
    const t = wm.userData.tip, gd = wm.userData.guard; anc = { onMesh: +dm.toFixed(3), underBore: +(t.y - mw.y).toFixed(3), z: +mw.z.toFixed(3), guardZ: gd ? +gd.z.toFixed(3) : null }; }
  return { wid: p.weapon.id, aim, rows, anchor: anc, reloadS: def.reloadS }; }"""
# the deep water closest to the player (the combat audit's finder) and the swim frames
WATER_JS = r"""() => { const W = window.__LC__.W, p = W.player, M = W.map; const wy = M.waterY; if (wy == null || wy < -100) return { err: 'no water', wy };
  let best = null; for (let r = 20; r < M.half * 1.6 && !best; r += 15) for (let a = 0; a < 24; a++) { const x = p.pos.x + Math.cos(a / 24 * 6.283) * r, z = p.pos.z + Math.sin(a / 24 * 6.283) * r; if (Math.abs(x) > M.half - 30 || Math.abs(z) > M.half - 30) continue; if (M.heightAt(x, z) < wy - 2.5) { best = [x, z]; break; } }
  if (!best) return { err: 'no deep water found', wy }; p.pos.set(best[0], wy - 0.6, best[1]); p.vel.set(0, 0, 0); p.obj.position.copy(p.pos); if (p._pp) p._pp.copy(p.pos); return { at: best, wy }; }"""
SWIM_JS = r"""(n) => { const W = window.__LC__.W, p = W.player, P = window.__H_PUMP__, wy = W.map.waterY; let S2 = null, HD = null, LH = null, RH = null;
  p.obj.traverse((o) => { if (!o.isBone) return; const nm = o.name.replace(/^mixamorig:?/i, ''); if (nm === 'Spine2' || nm === 'Spine02') S2 = o; if (nm === 'Head') HD = o; if (nm === 'LeftHand') LH = o; if (nm === 'RightHand') RH = o; });
  const rows = []; const v = new W.THREE.Vector3();
  const shown = (o) => { if (!o || !o.visible) return false; for (let q = o.parent; q; q = q.parent) if (!q.visible) return false; return true; };
  // heights are taken against the DRAWN surface (the water mesh bobs +-0.12 m around map.waterY on a ~9 s swell; the camera clamp and the
  // underwater test use the mesh too): against the static level a row read the swell's phase, not the swimmer (swim-view flipped run to run)
  for (let i = 0; i < n; i++) { P.step(1, 1 / 60, false); W.scene.updateMatrixWorld(true); const sy = W.map.water ? W.map.water.position.y : wy;
    rows.push({ sw: !!p.swimming, gun: shown(p.weaponMesh), sling: shown(p._sling), chest: S2 ? +(S2.getWorldPosition(v).y - sy).toFixed(3) : null, anim: p.anim,
      cam: W.camera ? +(W.camera.position.y - sy).toFixed(3) : null, uw: !!W._underwater, head: HD ? +(HD.getWorldPosition(v).y - sy).toFixed(3) : null,
      lh: LH ? +(LH.getWorldPosition(v).y - sy).toFixed(3) : null, rh: RH ? +(RH.getWorldPosition(v).y - sy).toFixed(3) : null,
      swell: +(sy - wy).toFixed(3) }); }
  return { rows, wy }; }"""
# the swap: barrel (holder +Z) vs the aim direction per frame after W.equipSlot to the other gun
SWAP_JS = r"""([slot, n]) => { const W = window.__LC__.W, THREE = W.THREE, p = W.player, P = window.__H_PUMP__; const out = [];
  const ang = () => { W.scene.updateMatrixWorld(true); const q = p.hand.getWorldQuaternion(new THREE.Quaternion()); const z = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch); const ad = new THREE.Vector3(-Math.sin(p.yaw) * cp, sp, -Math.cos(p.yaw) * cp);
    return +(Math.acos(Math.max(-1, Math.min(1, z.dot(ad)))) * 180 / Math.PI).toFixed(1); };
  for (let i = 0; i < 5; i++) { P.step(1, 1 / 60, false); out.push([-5 + i, ang(), p.weapon.id]); }
  W.equipSlot(p, slot);
  for (let i = 1; i <= n; i++) { P.step(1, 1 / 60, false); out.push([i, ang(), p.weapon.id]); }
  return out; }"""
# >= 9 armed bots in front of the player, each with a second gun; the sling count once they are on screen
SLING_JS = r"""(k) => { const W = window.__LC__.W, p = W.player; const ids = []; const used = window.__USED__ = window.__USED__ || {};   // (the death part takes other bots)
  const bots = W.actors.filter((a) => a.isBot && a.alive && !a.gliding && !a.downed && a !== p && a.rig && a.inventory).slice(0, k);
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  bots.forEach((b, i) => { const row = Math.floor(i / 4), col = i % 4; const d = 7 + row * 4, s = (col - 1.5) * 2.4;
    const x = p.pos.x + fx * d - fz * s, z = p.pos.z + fz * d + fx * s; b.pos.set(x, W.map.heightAt(x, z) + 0.05, z); b.vel.set(0, 0, 0); b.netRemote = true; b.yaw = p.yaw + Math.PI; b.obj.position.copy(b.pos); if (b._pp) b._pp.copy(b.pos);
    const inv = b.inventory; inv.slots[1] = { kind: 'weapon', id: 'ar', rarity: 1, mag: 30 }; inv.slots[2] = { kind: 'weapon', id: 'shotgun', rarity: 1, mag: 5 }; W.equipSlot(b, 1); ids.push(b.id); used[b.id] = 1; });
  return ids; }"""
SLING_COUNT_JS = r"""() => { const W = window.__LC__.W, p = W.player, cam = W.camera.position; let elig = 0, drawn = 0; const rows = [];
  for (const a of W.actors) { if (!a.alive || !a.rig) continue; const two = a.inventory && a.inventory.slots.some((s, i) => i !== a.inventory.active && s && s.kind === 'weapon' && (!a.weapon || s.id !== a.weapon.id));
    const d = a.pos.distanceTo(cam); const on = !!a._onScreen; const sv = !!(a._sling && a._sling.visible);
    if (two && d <= 35 && on && !a.downed && !a.swimming && !a.gliding) elig++; if (sv) { drawn++; rows.push([a.id, +d.toFixed(1)]); } }
  return { eligible: elig, drawn, slingN: W._slingN, rows }; }"""


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


MAG_CUES = {"rl_rifle_out", "rl_rifle_in", "rl_pistol_in", "rl_shell", "rl_ln_shell"}


def part_reload(s, v, R, skin, shots):
    """reload-height / reload-hand / pistol-reload: every gun standing, the AR on the run (first skin)"""
    if "reloadSets" not in R:
        R["reloadSets"] = s.js(SETS_JS)
    sets = R["reloadSets"]
    G = R.setdefault(skin, {}).setdefault("reload", {})
    for wid in GUNS + (["ar_run"] if skin == "soldier" else []):
        gid = "ar" if wid == "ar_run" else wid
        s.js(EQUIP_JS, gid)
        s.js(AIM_JS, [0.0, 0.0, False])
        s.step_frames(130, 1 / 60, render=False)
        if wid == "ar_run":
            s.hold(["KeyW"])
            s.step_frames(40, 1 / 60, render=False)
        n = int((sets.get(gid) or {}).get("reloadS", 3) * 60) + 40
        r = s.js(RELOAD_JS, [n, 10])
        if wid == "ar_run":
            s.release_all()
        save(s.js(SHOT_JS, [2.6, 0.5, 1.35, 1.2, 30, False, False]), shots, "%s_%s_reload_end.png" % (skin, wid))
        if wid in ("pistol", "ar", "shotgun", "sniper"):
            # the look: a second reload stopped at its mag-in (shotgun: second shell) beat, side and front three-quarter views
            s.step_frames(20, 1 / 60, render=False)
            s.js("() => { const p = window.__LC__.W.player; p.weapon.magAmmo = 0; p.input.reload = true; return 1; }")
            at = {"pistol": 0.55, "ar": 0.55, "shotgun": 0.27, "sniper": 0.58}[wid]
            s.step_frames(max(1, int(at * (sets.get(gid) or {}).get("reloadS", 2) * 60)), 1 / 60, render=False)
            save(s.js(SHOT_JS, [2.6, 0.5, 1.35, 1.2, 30, False, False]), shots, "%s_%s_reload_mid_side.png" % (skin, wid))
            save(s.js(SHOT_JS, [-1.4, 2.2, 1.5, 1.2, 34, False, False]), shots, "%s_%s_reload_mid_front.png" % (skin, wid))
            s.step_frames(int(4 * 60), 1 / 60, render=False)
        G[wid] = r
        s.step_frames(30, 1 / 60, render=False)
        spot = s.js("() => { const p = window.__LC__.W.player; return [p.pos.x, p.pos.z]; }")
        s.js(PLACE_JS, [spot[0], spot[1], 0.0])
    v.info("%s reload" % skin, {k: {"n": len(x.get("rows", [])), "anchor": x.get("anchor")} for k, x in G.items()})
    return G


def reload_eval(R, skins):
    sets = R.get("reloadSets") or {}
    if sets.get("err"):
        # no reload sets in the build: every reload row FAILS with the reason (the windows cannot be placed, so nothing can pass)
        why = {"err": sets["err"]}
        return (["reload sets: " + sets["err"]], why), (["reload sets: " + sets["err"]], why), (["reload sets: " + sets["err"]], why)
    hrows, hbad, wrows, wbad, prow, pbad = {}, [], {}, [], {}, []
    for skin in skins:
        G = R.get(skin, {}).get("reload", {})
        for wid, r in G.items():
            gid = "ar" if wid == "ar_run" else wid
            rows = r.get("rows") or []
            aim = [x for x in (r.get("aim") or []) if x is not None]
            hs = [x["h"] for x in rows if x.get("h") is not None]
            a0 = sum(aim) / len(aim) if aim else None
            dev = max(abs(h - a0) for h in hs) if hs and a0 is not None else None
            key = "%s/%s" % (skin, wid)
            hrows[key] = [round(a0, 3) if a0 is not None else None, round(dev, 3) if dev is not None else None, len(rows)]
            if dev is None or dev > 0.35 or len(rows) < 30:
                hbad.append(key)
            beats = (sets.get(gid) or {}).get("beats") or []
            anc = r.get("anchor") or {}
            anc_ok = anc.get("onMesh") is not None and anc["onMesh"] <= 0.07 and anc.get("underBore", -1) > 0.0 and \
                (anc.get("guardZ") is None or gid == "pistol" or anc["z"] < anc["guardZ"]) and anc["z"] > -0.1
            wins = []
            for b in beats:
                if b[1] not in MAG_CUES:
                    continue
                fr = [x.get("wrist") for x in rows if b[0] - 0.02 <= x["f"] <= b[0] + 0.03]
                fr = [x for x in fr if x is not None]
                wins.append([b[1], b[0], max(fr) if fr else None, len(fr)])
            okw = anc_ok and bool(wins) and all(w_[2] is not None and w_[2] <= 0.08 and w_[3] >= 2 for w_ in wins)
            wrows[key] = {"windows": wins, "anchor": anc}
            if not okw:
                wbad.append(key)
            if gid == "pistol":
                own = sum(1 for x in rows if x.get("rl") == "pistol_reload")
                share = own / max(1, len(rows))
                prow[key] = {"ownShare": round(share, 3), "anims": sorted(set(str(x.get("anim")) for x in rows)), "windows": wins}
                if share < 0.8 or not okw:
                    pbad.append(key)
    return (hbad, hrows), (wbad, wrows), (pbad, prow)


def part_swim(s, v, R, shots):
    s.js(EQUIP_JS, "ar")
    s.js(AIM_JS, [0.0, 0.0, False])
    s.step_frames(60, 1 / 60, render=False)
    at = s.js(WATER_JS)
    out = {"at": at}
    if at.get("err"):
        R["swim"] = out
        return out
    s.step_frames(5, 1 / 60, render=False)
    still = s.js(SWIM_JS, 150)
    save(s.js(SHOT_JS, [3.6, 0.0, 1.2, 0.3, 34, False, False]), shots, "swim_still_side.png")
    save(s.js(GAME_JS), shots, "swim_still_tp.png")
    # the screenshots above take wall-clock time, in which the water swell (maps.js, driven by real t) moves up to ~0.04 m in one step while the
    # camera eases toward it at 1 - exp(-26 dt) per pumped frame: 10 frames let the lens catch the jump the HARNESS made (a player's swell moves
    # <= 0.0014 m a frame) before the swimming-on frames are sampled
    s.step_frames(10, 1 / 60, render=False)
    s.hold(["KeyW"])
    fwd = s.js(SWIM_JS, 150)
    save(s.js(SHOT_JS, [3.6, 0.0, 1.2, 0.3, 34, False, False]), shots, "swim_fwd_side.png")
    s.release_all()
    out.update({"still": still, "fwd": fwd})
    R["swim"] = out
    return out


# (W10 anim fix 4, F-B) a 20 cm kerb step-off: the player is lifted KERB_DROP at frame KERB_AT and falls back (the ground clip keeps playing:
# 7 frames unsupported); per frame the right hand and the muzzle tip in the HIPS' frame (a pop of the arms or the spine twist shows; the
# whole body's own drop does not)
KERB_JS = r"""([n, at, drop]) => { const W = window.__LC__.W, THREE = W.THREE, P = window.__H_PUMP__, A = W.player; const out = [];
  let rh = null, hp = null; A.obj.traverse((o) => { if (!o.isBone) return; const nm = o.name.replace(/^mixamorig:?/i, ''); if (!rh && nm === 'RightHand') rh = o; if (!hp && nm === 'Hips') hp = o; });
  for (let i = 0; i < n; i++) { if (i === at) { A.pos.y += drop; A.obj.position.y += drop; }
    P.step(1, 1 / 60, false); W.scene.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(hp.matrixWorld).invert();
    const h = rh.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    const ud = A.weaponMesh && A.weaponMesh.userData, tp = A.hand && ud && ud.tip ? A.hand.localToWorld(new THREE.Vector3(ud.tip.x, ud.tip.y, ud.tip.z)).applyMatrix4(inv) : null;
    out.push([i, A.onGround ? 1 : 0, A.anim, [h.x, h.y, h.z], tp ? [tp.x, tp.y, tp.z] : null]); }
  return out; }"""
KERB_AT, KERB_DROP, KERB_N = 12, 0.2, 44
KERB_WIDS = ["ar", "smg", "sniper", "pistol"]


def kerb_eval(rows):
    """-> {pt: [largest per-frame move, frame, normal per-frame move]}; normal = the largest move on frames >= 8 away from the step and
    the landing (the same clip's own motion, same run)"""
    land = [b[0] for a, b in zip(rows, rows[1:]) if b[1] and not a[1]]
    near = set()
    for e in [KERB_AT] + land:
        near.update(range(e - 2, e + 9))
    out = {"air": sum(1 for r in rows if not r[1]), "anims": sorted(set(r[2] for r in rows))}
    for k, nm in ((3, "rh"), (4, "tip")):
        m, at, base = 0.0, None, 0.0
        for a, b in zip(rows, rows[1:]):
            if a[k] is None or b[k] is None:
                continue
            d = math.dist(a[k], b[k])
            if d > m:
                m, at = d, b[0]
            if b[0] not in near and b[0] > 2:
                base = max(base, d)
        out[nm] = [round(m, 4), at, round(base, 4)]
    return out


def part_kerb(s, v, R, skin):
    spot = L.flat_spot(s, clear=9.0, max_r=900) or {}
    home = [spot["x"], spot["z"]] if spot else s.js("() => { const p = window.__LC__.W.player; return [p.pos.x, p.pos.z]; }")
    out = {}
    for wid in KERB_WIDS:
        for sc, keys in (("run", ["KeyW"]), ("idle", [])):
            s.release_all()
            s.js(PLACE_JS, [home[0], home[1], 0.0])
            s.js(EQUIP_JS, wid)
            s.js(AIM_JS, [0.0, 0.0, False])
            s.step_frames(130, 1 / 60, render=False)                    # out of combat, the hold eased in
            if keys:
                s.hold(keys)
            s.step_frames(40, 1 / 60, render=False)
            rows = s.js(KERB_JS, [KERB_N, KERB_AT, KERB_DROP])
            s.release_all()
            out["%s/%s" % (wid, sc)] = kerb_eval(rows)
    s.step_frames(20, 1 / 60, render=False)
    s.js(PLACE_JS, [home[0], home[1], 0.0])
    R.setdefault(skin, {})["kerb"] = out
    v.info("%s kerb step-off (pt: [max per-frame move m, frame, normal per-frame move m])" % skin, out)
    return out


def part_swap(s, v, R, skin):
    s.js(EQUIP_JS, "ar")
    s.js("() => { const W = window.__LC__.W, K = W.SIM, p = W.player; p.inventory.slots[2] = { kind: 'weapon', id: 'smg', rarity: 1, mag: K.WEAPONS.smg.mag }; return 1; }")
    s.js(AIM_JS, [0.0, 0.0, False])
    s.step_frames(130, 1 / 60, render=False)
    rows = s.js(SWAP_JS, [2, 30])
    R.setdefault(skin, {})["swap"] = rows
    v.info("%s swap (frame, barrel-vs-aim deg, wid)" % skin, rows)
    s.step_frames(30, 1 / 60, render=False)
    return rows


def part_sling(s, v, R, shots):
    ids = s.js(SLING_JS, 12)
    s.step_frames(20, 1 / 60, render=True)
    c = s.js(SLING_COUNT_JS)
    c["placed"] = len(ids)
    save(s.js(GAME_JS), shots, "sling_tp.png")
    R["sling"] = c
    v.info("sling", c)
    return c


def part_death(s, v, R, sling=False, shots=None, kills=True):
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
    if sling:
        part_sling(s, v, R, shots)
    out = []
    for k in range(2 if kills else 0):
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
    if kills:
        R["death"] = out
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    ap.add_argument("--skins", default="soldier,athlete")
    ap.add_argument("--parts", default="guns,flash,pistol,flinch,death,sheen,reload,swim,swap,kerb")
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
            if want & {"guns", "flash", "pistol", "flinch", "sheen", "reload", "swap", "kerb"}:
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
                    if "reload" in want:
                        part_reload(s, v, R, skin, shots)
                    if "swap" in want:
                        part_swap(s, v, R, skin)
                    if "kerb" in want:
                        part_kerb(s, v, R, skin)
                    s.step_frames(10, 1 / 60, render=True)
                    progs.append([skin, p0, L.programs(s)])
            if "swim" in want:
                # a practice match on the island map (deep water near the range)
                v.info("practice swim", boot_practice(s, "soldier", seed=5, map_id="isla_viva"))
                p0 = L.programs(s)
                part_swim(s, v, R, shots)
                s.step_frames(10, 1 / 60, render=True)
                progs.append(["swim", p0, L.programs(s)])
            if "death" in want or "swap" in want:
                part_death(s, v, R, sling="swap" in want, shots=shots, kills="death" in want)
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
        if "reload" in want:
            (hb, hr), (wb, wr), (pb, pr) = reload_eval(R, skins)
            v.check("reload-height: the barrel tip within 0.35 m of its aim-pose height on every frame of the reload (9 guns standing, every skin; the AR on the run)",
                    not hb and bool(hr), {"bad": hb, "[aimH, maxDev, frames]": hr}, "<= 0.35 m")
            v.check("reload-hand: left wrist within 0.08 m of the mag well on every frame of each magazine / shell window (R2B beats); the anchor on the gun",
                    not wb and bool(wr), {"bad": wb, "rows": wr}, "<= 0.08 m")
            v.check("pistol-reload: the pistol's own reload pose (>= 80 % of the reload frames) with the left hand on its mag well at the mag-in beat",
                    not pb and bool(pr), {"bad": pb, "rows": pr})
        if "swim" in want:
            swd = R.get("swim") or {}
            if (swd.get("at") or {}).get("err"):
                v.cnj("swim", "no deep water: %s" % swd.get("at"))
            else:
                still = (swd.get("still") or {}).get("rows", [])
                fwd = (swd.get("fwd") or {}).get("rows", [])
                swr = [x for x in still + fwd if x["sw"]]
                gunf = sum(1 for x in swr if x["gun"] or x["sling"])
                late = [x for x in still[42:] + fwd if x["sw"]]
                chest = [x["chest"] for x in late if x["chest"] is not None]
                ok = len(swr) >= 240 and gunf == 0 and bool(chest) and max(chest) < 0.0
                v.check("swim: 0 frames with a weapon visible while swimming; the chest (Spine2) below the surface after a 0.7 s settle",
                        ok, {"swimFrames": len(swr), "of": len(still + fwd), "gunFrames": gunf, "chestMax": max(chest) if chest else None,
                             "chestMin": min(chest) if chest else None, "anims": sorted(set(str(x["anim"]) for x in swr)),
                             "swell": [min(x.get("swell", 0) for x in swr), max(x.get("swell", 0) for x in swr)] if swr else None}, "0 frames; chest < 0")
                cams = [x.get("cam") for x in swr if x.get("cam") is not None]
                uwf = sum(1 for x in swr if x.get("uw"))
                vok = len(swr) >= 240 and len(cams) == len(swr) and min(cams) >= 0.10 and uwf == 0
                v.check("swim-view: on every swimming frame the camera >= 0.10 m above the water surface and the underwater look off",
                        vok, {"swimFrames": len(swr), "camFrames": len(cams), "camMin": min(cams) if cams else None,
                              "camMax": max(cams) if cams else None, "underwaterFrames": uwf}, "cam >= 0.10 m; 0 underwater frames")
                heads = [x.get("head") for x in late]
                hv = [h for h in heads if h is not None]
                hok = len(late) >= 240 and len(hv) == len(late) and min(hv) >= 0.15
                v.check("swim-head: treading water, the Head bone >= 0.15 m above the surface on every settled swimming frame (still after 0.7 s, swimming on)",
                        hok, {"settledFrames": len(late), "headFrames": len(hv), "headMin": min(hv) if hv else None,
                              "headMax": max(hv) if hv else None}, ">= 0.15 m")
                hrows = [x for x in late if x.get("lh") is not None and x.get("rh") is not None and x.get("head") is not None]
                under = sum(1 for x in hrows if x["lh"] <= 0.0 and x["rh"] <= 0.0)
                upf = sum(1 for x in hrows if max(x["lh"], x["rh"]) > x["head"])
                share = under / len(hrows) if hrows else 0.0
                aok = len(late) >= 240 and len(hrows) == len(late) and share >= 0.80 and upf == 0
                v.check("swim-arms: both wrists at or below the surface on >= 80 % of the settled swimming frames; 0 frames a wrist above the Head bone",
                        aok, {"settledFrames": len(late), "handFrames": len(hrows), "bothUnder": under, "share": round(share, 3),
                              "aboveHead": upf, "lhMax": max(x["lh"] for x in hrows) if hrows else None,
                              "rhMax": max(x["rh"] for x in hrows) if hrows else None,
                              "lhMin": min(x["lh"] for x in hrows) if hrows else None,
                              "rhMin": min(x["rh"] for x in hrows) if hrows else None}, ">= 80 % both <= 0; 0 above head")
        if "swap" in want:
            sw, bad = {}, []
            for skin in skins:
                rows = R.get(skin, {}).get("swap") or []
                base = [x[1] for x in rows if x[0] < 0]
                mid = [x[1] for x in rows if 5 <= x[0] <= 12]
                sw[skin] = {"baseMaxDeg": max(base) if base else None, "midMaxDeg": max(mid) if mid else None, "wid": rows[-1][2] if rows else None}
                if not mid or max(mid) < 25.0 or (rows and rows[-1][2] != "smg"):
                    bad.append(skin)
            sl = R.get("sling") or {}
            el, dr = sl.get("eligible"), sl.get("drawn")
            okS = el is not None and el >= 9 and dr is not None and 1 <= dr <= 8 and dr == min(8, el)
            v.check("swap: the barrel lowered >= 25 deg off the aim mid-swap (every skin); slung second gun on 1-8 actors = min(8, eligible) with >= 9 eligible",
                    not bad and okS, {"bad": bad, "dip": sw, "sling": sl}, ">= 25 deg; <= 8")
        if "kerb" in want:
            kb, kr = [], {}
            for skin in skins:
                K_ = R.get(skin, {}).get("kerb") or {}
                for key in ["%s/%s" % (w_, sc) for w_ in KERB_WIDS for sc in ("run", "idle")]:
                    e = K_.get(key)
                    kr["%s/%s" % (skin, key)] = e and {"rh": e["rh"], "tip": e["tip"], "air": e["air"]}
                    # the step really left the ground (>= 3 frames unsupported) and neither point jumped more than 2x its own normal motion
                    ok = bool(e) and e["air"] >= 3 and all(e[p][0] <= 2.0 * e[p][2] + 1e-9 for p in ("rh", "tip"))
                    if not ok:
                        kb.append("%s/%s" % (skin, key))
            v.check("kerb: a 20 cm kerb step-off (AR / SMG / sniper / pistol, running and still): the right hand's and the muzzle's largest per-frame move (hips frame) <= 2x the same clip's normal per-frame move",
                    not kb and bool(kr), {"bad": kb, "[max, frame, normal]": kr}, "<= 2x normal")
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
