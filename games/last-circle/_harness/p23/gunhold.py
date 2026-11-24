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
    python _harness/p23/gunhold.py --disk --plant inert-off       # the inertial blend never fires              - MUST FAIL swap-pop, ads-pop
    python _harness/p23/gunhold.py --disk --plant air-hold-off    # the hold dropped in the air, snapped back   - MUST FAIL land-pop
    python _harness/p23/gunhold.py --disk --plant ready-hidden    # the fix-4 patrol ready (gun behind the body) - MUST FAIL chase
    python _harness/p23/gunhold.py --disk --plant aim-arms-only   # (fix r1) no spine / head share of the aim pitch - MUST FAIL aimpitch
    python _harness/p23/gunhold.py --disk --plant low-gate-off    # (fix r1) Low / phones take the branch's arm modes - MUST FAIL lowlook
    python _harness/p23/gunhold.py --disk --plant recoil-off      # (fix r1) no recoil on the hold              - MUST FAIL recoil
    python _harness/p23/gunhold.py --disk --plant sg-fold         # (fix r1) the trigger-elbow floor off         - MUST FAIL sghold
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
  swap-pop       (W10 anim fix 5) a gun swap AR -> SMG (still), every skin: the right hand's largest per-frame move (hips frame) in the 17
                 frames from the swap <= max(2x that run's normal per-frame move, 0.01 m) [check4: 0.08-0.25 m in the swap frame; --plant
                 inert-off MUST FAIL it]
  ads-pop        (W10 anim fix 5) an ADS release, AR and SMG (still): the right hand's and the muzzle's, same bar [check4: hand 0.044-0.068 m;
                 --plant inert-off MUST FAIL it]
  land-pop       (W10 anim fix 5) a jump's landing (real Space press, still), AR and SMG: the right hand's and the muzzle's in the 17 frames
                 from the landing, same bar [check4: muzzle 0.084-0.099 m = 2.1-2.7x normal; --plant air-hold-off (the hold dropped in the air and
                 snapped back at the landing, no inertial blend) MUST FAIL it]
  chase          (W10 anim fix 5) the long gun at the patrol ready seen from the game's chase camera (AR / SMG / LMG, still and running,
                 all 5 skins): the median share of its pixels the body does not hide >= the live build's (CHASE_LIVE)
                 [check4: juggernaut AR / SMG 0.00 (live 0.26 / 0.04); --plant ready-hidden MUST FAIL it]
  swap           a gun swap lowers the barrel >= 25 deg off the aim mid-swap (max over 0.08-0.20 s after the swap); with >= 9 armed
                 two-gun bots on screen within 35 m, 1 <= actors drawing a slung gun <= 8 and = min(8, eligible) [none]
W10 anim fix r1 rows (parts trans, chase, aimpitch, lowlook, recoil, sghold; ANIM/STANDARD.md):
  trans bar      the 0.01 m floor is gone: a point passes when its largest move <= 2x the run's normal move or <= live's on the same row
                 (TRANS_LIVE, 3 decimals, gunhold --rev 8ccb6efce --parts trans, 5 skins); new rows crouch-pop, loco-pop (idle -> run,
                 run -> sprint), turn-pop, adswalk-pop (AR and pistol), pistol-pop (pistol ADS release + landing)
  chase          now 17 cells per skin at 3 decimals: AR / SMG / LMG / shotgun / sniper still + running, the pistol idle / run / crouch walk /
                 crouched / strafe / backpedal / turn; the juggernaut's pistol ready > 0
  aimpitch       +-45 deg, ADS and hip fire, AR / LMG / SMG / shotgun, 5 skins: butt <= 0.15 m from the RightArm joint, both wrists under
                 HeadTop_End, head pitch follows >= 0.7 of the aim pitch
  lowlook        desktop Low: pistol gunReady in idle / run / strafe / back / crouch / ADS, no rifle hold, no pistol chest squaring
  recoil         >= 0.015 m muzzle kick within the shot frame + 1 (SMG / AR / LMG / pistol, aimed, 5 skins)
  sghold         the pump shotgun's trigger elbow >= 52 deg (live's least) at the ready, running, crouched, aimed, backpedalling
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
    # W10 anim fix 5 (T1/T2, check4 finding): the inertial blend never fires - the swap's new hold jumps the right hand 0.12-0.25 m in the swap
    # frame, the ADS release 0.044-0.068 m (MUST FAIL swap-pop and ads-pop)
    "inert-off": [(RP + "player.js", [("const IN_S = 0.22, IN_SWAP_S = 0.45, IN_POP_MIN = 0.028,", "const IN_S = 0.22, IN_SWAP_S = 0.45, IN_POP_MIN = 99,")])],
    # W10 anim fix 5 (T4): the rifle hold eased off at the take-off and back on at the landing again - the muzzle 2.1-2.7x its normal motion
    # in the landing frames (MUST FAIL land-pop)
    # (the hold gated hard by onGround at the landing frame, as before fix 4, and no inertial blend to take the jump out)
    "air-hold-off": [(RP + "player.js", [("{ const want = rhCls && a._ikNear && deskHi(W) && !a.gliding", "{ const want = rhCls && a._ikNear && deskHi(W) && gndClip && !a.gliding"),
                                         ("const gndClip = !airClipOn;", "const gndClip = a.onGround;"),
                                         ("const mixHold = mixamoAim || (mixGun && rhCls && a._rhW > 0);", "const mixHold = mixamoAim;"),
                                         ("const IN_S = 0.22, IN_SWAP_S = 0.45, IN_POP_MIN = 0.028,", "const IN_S = 0.22, IN_SWAP_S = 0.45, IN_POP_MIN = 99,")])],
    # W10 anim fix 5 (V1): the fix-4 patrol ready (butt 8 cm out, muzzle 10 deg down, square, the blade turned back) - the juggernaut's AR / SMG
    # 0.00 visible from the chase camera (MUST FAIL chase)
    "ready-hidden": [(RP + "player.js", [("const RH_RDY_S = 0.2, RH_RDY_PITCH = 0, RH_RDY_CANT = -0.10, RH_RDY_IN = -0.10,",
                                          "const RH_RDY_S = 0.2, RH_RDY_PITCH = -0.18, RH_RDY_CANT = 0, RH_RDY_IN = -0.08,"),
                                         ("const RH_RDY_LIFT = 0.05,", "const RH_RDY_LIFT = 0,"),
                                         # (fix6) the chest turned back to RH_BLADE at the ready too, no per-skin extra blade
                                         ("Math.max(0, Math.abs(a._pBlade) - RH_BLADE) * (1 - (a._rdyE || 0)) -\n        K.clamp(a._pBlade / RH_RDY_BSIDE, -1, 1) * a._rdyBlade * a._rdyBF * (a._rdyE || 0)) * rhK",
                                          "Math.max(0, Math.abs(a._pBlade) - RH_BLADE)) * rhK")])],
    # (W10 anim fix r1, D2 / D15) the mesh-space aim offset off (the spine and the head take none of the aim pitch): the arms alone aim up and
    # down, the support hand over the head at +45 (MUST FAIL aimpitch)
    "aim-arms-only": [(RP + "player.js", [("const AO_SHARE = 0.75, AO_UP = 0.75, AO_DN = 0.75, AO_W = [0.25, 0.35, 0.40], AO_HEAD = 0.95,",
                                           "const AO_SHARE = 0, AO_UP = 0.75, AO_DN = 0.75, AO_W = [0.25, 0.35, 0.40], AO_HEAD = 0,"),
                                          ("const RH_PITCH_DROP = 0.3;", "const RH_PITCH_DROP = 0;"),
                                          ("const GRIP_UP_SLIDE = 0.35;", "const GRIP_UP_SLIDE = 0;")])],
    # (W10 anim fix r1, D4) the desktop-medium+ near gate removed: phones / Low take the branch's pistol arm modes, the squared chest (MUST FAIL lowlook)
    "low-gate-off": [(RP + "player.js", [("const hiNear = a._ikNear && deskHi(W);", "const hiNear = a._ikNear;")])],
    # (W10 anim fix r1, D12) no recoil on the hold (MUST FAIL recoil)
    "recoil-off": [(RP + "player.js", [("const RC_RISE = { pistol: 0.08, smg: 0.055, ar: 0.07, lmg: 0.06, dmr: 0.085, shotgun: 0.15, sniper: 0.17, launcher: 0.12 }, RC_TAU = 0.05, RC_S = 0.3, RC_BACK = 0.025;",
                                         "const RC_RISE = {}, RC_TAU = 0.05, RC_S = 0.3, RC_BACK = 0;"),
                                        ("const u = W.t - a.lastShotT, cls = armed ? (K.WEAPONS[a.weapon.id] || {}).cls : null;", "const u = -1, cls = null;")])],
    # (W10 anim fix r1, D9) the trigger-elbow floor off and the fix-6 pump-shotgun constants: the elbow folds to 30-39 deg (MUST FAIL sghold)
    "sg-fold": [(RP + "player.js", [("const RH_TRIG_MIN = 1.05,", "const RH_TRIG_MIN = 0.01,")])],
    # (W10 anim fix r2, D11) the pistol gaze off: the head tips against the aim again (MUST FAIL aimpitch, pistol head follow)
    "pistol-gaze-off": [(RP + "player.js", [("if (a._pgW > 0 && a.armBones && a.armBones.head) pistolGaze(a, smooth01(a._pgW));", "")])],
    # (W10 anim fix r2, D3) the kernel's linear cross-fade back (a switch inside a fade restarts the faded clip at weight 1: MUST FAIL loco-pop)
    "xfade-linear": [(RP + "player.js", [("a._xfOn = a._ikNear && deskHi(W);", "a._xfOn = false;")])],
    # (W10 anim fix r2, D10) the back-left diagonal on the side quadrant again (MUST FAIL diagclip)
    "diag-side": [(RP + "player.js", [("if ((q === 1 || q === 3) && Math.abs(phi) >= Math.PI * 0.75) q = 2;", "")])],
    # (W10 anim fix r2, D2) the patrol ready canted 0.30 rad off the aim again (MUST FAIL firstshot)
    "ready-cant-out": [(RP + "player.js", [("RH_RDY_PITCH = 0, RH_RDY_CANT = -0.10, RH_RDY_IN = -0.10,", "RH_RDY_PITCH = 0, RH_RDY_CANT = -0.30, RH_RDY_IN = -0.10,")])],
    # (W10 anim fix r2, D1) the aimed hold centred again: the long gun's sight line under the eye, no cheek cant, the pistol on the centre line (MUST FAIL adscam)
    "ads-centred": [(RP + "player.js", [("const RH_ADS_OUT = 0.09, RH_ADS_DROP = 0.03, RH_ADS_ROLL = 0.2, RH_ADS_NOD = 0.15;", "const RH_ADS_OUT = 0, RH_ADS_DROP = 0, RH_ADS_ROLL = 0, RH_ADS_NOD = 0;")]),
                    (RP + "pose.js", [("  pistolAim: [[0.10, -0.42, 0.90], [0.0, -0.28, 0.96], [-0.55, -0.22, 0.80], [-0.40, -0.06, 0.91]],",
                                       "  pistolAim: [[0.40, -0.40, 0.82], [0.30, -0.25, 0.92], [-0.30, -0.22, 0.93], [-0.12, -0.04, 0.99]],")])],
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
    // (W10 anim fix 5, G2) ...and in the DRAWN ROOT's frame (A.obj's position, the body's yaw): the whole body's own motion shows there.
    // A.obj, not A.pos: the drawn body is interpolated between fixed ticks, so A.pos-relative points carry the tick phase (fix5 kerbroot:
    // the drawn root 0.0018-0.0126 m behind A.pos through a 20 cm drop on one run, 0.0001-0.0007 m on another)
    const by = A._hasBodyYaw ? A._bodyYaw - Math.PI : A.yaw, fx = -Math.sin(by), fz = -Math.cos(by), o = A.obj.getWorldPosition(new THREE.Vector3());
    const rl = (q) => { const d = q.clone().applyMatrix4(hp.matrixWorld).sub(o); return [d.x * fz - d.z * fx, d.y, d.x * fx + d.z * fz]; };
    out.push([i, A.onGround ? 1 : 0, A.anim, [h.x, h.y, h.z], tp ? [tp.x, tp.y, tp.z] : null, rl(h), tp ? rl(tp) : null]); }
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
    for k, nm in ((3, "rh"), (4, "tip"), (5, "rhR"), (6, "tipR")):
        m, at, base = 0.0, None, 0.0
        for a, b in zip(rows, rows[1:]):
            if len(a) <= k or a[k] is None or b[k] is None:
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


# (W10 anim fix 5, G2) TRANSITION POPS: per frame the right hand and the muzzle tip in the hips' frame around a gun swap (AR -> SMG, still), an ADS
# release (AR / SMG, still, after 130 frames aimed) and a jump's landing (AR / SMG, a real Space press, still). Bar per point: the largest move in
# the event's window <= max(2x the run's normal per-frame move, TRANS_FLOOR); normal = the largest move on frames >= 8 away from every event,
# take-off and landing (kerb_eval's and check4 xan's definition: a designed blend - the ready coming back after an ADS release - is motion, a pop
# is a jump against it). The swap's muzzle is the NEW gun's (another length): the hand only there.
TRANS_JS = r"""([n]) => { const W = window.__LC__.W, THREE = W.THREE, P = window.__H_PUMP__, A = W.player; const out = [];
  let rh = null, hp = null, lh = null; A.obj.traverse((o) => { if (!o.isBone) return; const nm = o.name.replace(/^mixamorig:?/i, ''); if (!rh && nm === 'RightHand') rh = o; if (!lh && nm === 'LeftHand') lh = o; if (!hp && nm === 'Hips') hp = o; });
  for (let i = 0; i < n; i++) { P.step(1, 1 / 60, false); W.scene.updateMatrixWorld(true);
    // (W10 anim fix r2, D5) STANDARD T1's frame (analyze8 body()): from the Hips' POSITION, turned into the drawn body's yaw (the root), so a step of
    // the pelvis' own rotation shows (the Hips bone's full frame carried the upper body with it and hid a 2.3 deg pelvis step at idle -> run)
    const hq = A.obj.getWorldQuaternion(new THREE.Quaternion()).invert(), hpos = hp.getWorldPosition(new THREE.Vector3());
    const inv = new THREE.Matrix4().makeRotationFromQuaternion(hq).multiply(new THREE.Matrix4().makeTranslation(-hpos.x, -hpos.y, -hpos.z));
    const h = rh.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv), l = lh.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    const ud = A.weaponMesh && A.weaponMesh.userData, tp = A.hand && ud && ud.tip ? A.hand.localToWorld(new THREE.Vector3(ud.tip.x, ud.tip.y, ud.tip.z)).applyMatrix4(inv) : null;
    out.push([A.onGround ? 1 : 0, A.weapon && A.weapon.id, [h.x, h.y, h.z], tp ? [tp.x, tp.y, tp.z] : null, [l.x, l.y, l.z]]); }
  return out; }"""
# (W10 anim fix r1, D17) the 0.01 m floor is gone (a snap 18x a still body's motion passed under it): a point passes when its largest move in the
# event window <= 2x the run's normal per-frame move, or <= the live build's largest move on the same row (TRANS_LIVE, 3 decimals, measured with
# this part on 8ccb6efce: ANIM/fix_r1 gh_live.log); a row without a live value has the 2x-normal bar only
TRANS_LIVE = {
    "soldier/ar/swap": {"rh": 0.001},
    "soldier/ar/ads": {"rh": 0.0, "tip": 0.001},
    "soldier/ar/land": {"rh": 0.017, "tip": 0.063},
    "soldier/ar/crouchin": {"rh": 0.013, "tip": 0.031},
    "soldier/ar/crouchout": {"rh": 0.014, "tip": 0.031},
    "soldier/ar/idlerun": {"rh": 0.012, "tip": 0.035},
    "soldier/ar/runsprint": {"rh": 0.075, "tip": 0.094},
    "soldier/ar/adswalk": {"rh": 0.04, "tip": 0.082},
    "soldier/ar/turn": {"rh": 0.017, "tip": 0.034},
    "soldier/smg/ads": {"rh": 0.001, "tip": 0.001},
    "soldier/smg/land": {"rh": 0.017, "tip": 0.055},
    "soldier/pistol/ads": {"rh": 0.0, "tip": 0.0},
    "soldier/pistol/land": {"rh": 0.026, "tip": 0.026},
    "soldier/pistol/crouchin": {"rh": 0.031, "tip": 0.033},
    "soldier/pistol/crouchout": {"rh": 0.027, "tip": 0.032},
    "soldier/pistol/idlerun": {"rh": 0.021, "tip": 0.033},
    "soldier/pistol/runsprint": {"rh": 0.049, "tip": 0.063},
    "soldier/pistol/adswalk": {"rh": 0.05, "tip": 0.08},
    "soldier/pistol/turn": {"rh": 0.016, "tip": 0.025},
    "athlete/ar/swap": {"rh": 0.0},
    "athlete/ar/ads": {"rh": 0.0, "tip": 0.001},
    "athlete/ar/land": {"rh": 0.013, "tip": 0.065},
    "athlete/ar/crouchin": {"rh": 0.009, "tip": 0.027},
    "athlete/ar/crouchout": {"rh": 0.009, "tip": 0.027},
    "athlete/ar/idlerun": {"rh": 0.011, "tip": 0.034},
    "athlete/ar/runsprint": {"rh": 0.058, "tip": 0.086},
    "athlete/ar/adswalk": {"rh": 0.035, "tip": 0.085},
    "athlete/ar/turn": {"rh": 0.014, "tip": 0.031},
    "athlete/smg/ads": {"rh": 0.001, "tip": 0.001},
    "athlete/smg/land": {"rh": 0.013, "tip": 0.055},
    "athlete/pistol/ads": {"rh": 0.0, "tip": 0.0},
    "athlete/pistol/land": {"rh": 0.022, "tip": 0.022},
    "athlete/pistol/crouchin": {"rh": 0.025, "tip": 0.027},
    "athlete/pistol/crouchout": {"rh": 0.021, "tip": 0.025},
    "athlete/pistol/idlerun": {"rh": 0.016, "tip": 0.028},
    "athlete/pistol/runsprint": {"rh": 0.042, "tip": 0.057},
    "athlete/pistol/adswalk": {"rh": 0.041, "tip": 0.07},
    "athlete/pistol/turn": {"rh": 0.013, "tip": 0.022},
    "wraith/ar/swap": {"rh": 0.0},
    "wraith/ar/ads": {"rh": 0.001, "tip": 0.001},
    "wraith/ar/land": {"rh": 0.017, "tip": 0.063},
    "wraith/ar/crouchin": {"rh": 0.015, "tip": 0.032},
    "wraith/ar/crouchout": {"rh": 0.015, "tip": 0.032},
    "wraith/ar/idlerun": {"rh": 0.013, "tip": 0.036},
    "wraith/ar/runsprint": {"rh": 0.074, "tip": 0.092},
    "wraith/ar/adswalk": {"rh": 0.038, "tip": 0.083},
    "wraith/ar/turn": {"rh": 0.017, "tip": 0.034},
    "wraith/smg/ads": {"rh": 0.001, "tip": 0.001},
    "wraith/smg/land": {"rh": 0.017, "tip": 0.055},
    "wraith/pistol/ads": {"rh": 0.0, "tip": 0.0},
    "wraith/pistol/land": {"rh": 0.026, "tip": 0.026},
    "wraith/pistol/crouchin": {"rh": 0.031, "tip": 0.033},
    "wraith/pistol/crouchout": {"rh": 0.026, "tip": 0.031},
    "wraith/pistol/idlerun": {"rh": 0.021, "tip": 0.033},
    "wraith/pistol/runsprint": {"rh": 0.048, "tip": 0.061},
    "wraith/pistol/adswalk": {"rh": 0.049, "tip": 0.079},
    "wraith/pistol/turn": {"rh": 0.016, "tip": 0.025},
    "juggernaut/ar/swap": {"rh": 0.001},
    "juggernaut/ar/ads": {"rh": 0.001, "tip": 0.001},
    "juggernaut/ar/land": {"rh": 0.016, "tip": 0.064},
    "juggernaut/ar/crouchin": {"rh": 0.014, "tip": 0.031},
    "juggernaut/ar/crouchout": {"rh": 0.014, "tip": 0.031},
    "juggernaut/ar/idlerun": {"rh": 0.011, "tip": 0.035},
    "juggernaut/ar/runsprint": {"rh": 0.073, "tip": 0.089},
    "juggernaut/ar/adswalk": {"rh": 0.034, "tip": 0.078},
    "juggernaut/ar/turn": {"rh": 0.016, "tip": 0.032},
    "juggernaut/smg/ads": {"rh": 0.001, "tip": 0.001},
    "juggernaut/smg/land": {"rh": 0.016, "tip": 0.055},
    "juggernaut/pistol/ads": {"rh": 0.0, "tip": 0.0},
    "juggernaut/pistol/land": {"rh": 0.025, "tip": 0.025},
    "juggernaut/pistol/crouchin": {"rh": 0.028, "tip": 0.03},
    "juggernaut/pistol/crouchout": {"rh": 0.024, "tip": 0.029},
    "juggernaut/pistol/idlerun": {"rh": 0.019, "tip": 0.031},
    "juggernaut/pistol/runsprint": {"rh": 0.05, "tip": 0.061},
    "juggernaut/pistol/adswalk": {"rh": 0.046, "tip": 0.075},
    "juggernaut/pistol/turn": {"rh": 0.015, "tip": 0.023},
    "viper/ar/swap": {"rh": 0.0},
    "viper/ar/ads": {"rh": 0.001, "tip": 0.001},
    "viper/ar/land": {"rh": 0.012, "tip": 0.064},
    "viper/ar/crouchin": {"rh": 0.01, "tip": 0.028},
    "viper/ar/crouchout": {"rh": 0.011, "tip": 0.028},
    "viper/ar/idlerun": {"rh": 0.011, "tip": 0.035},
    "viper/ar/runsprint": {"rh": 0.058, "tip": 0.083},
    "viper/ar/adswalk": {"rh": 0.036, "tip": 0.089},
    "viper/ar/turn": {"rh": 0.014, "tip": 0.03},
    "viper/smg/ads": {"rh": 0.001, "tip": 0.001},
    "viper/smg/land": {"rh": 0.012, "tip": 0.055},
    "viper/pistol/ads": {"rh": 0.0, "tip": 0.0},
    "viper/pistol/land": {"rh": 0.023, "tip": 0.022},
    "viper/pistol/crouchin": {"rh": 0.025, "tip": 0.026},
    "viper/pistol/crouchout": {"rh": 0.02, "tip": 0.024},
    "viper/pistol/idlerun": {"rh": 0.015, "tip": 0.028},
    "viper/pistol/runsprint": {"rh": 0.039, "tip": 0.052},
    "viper/pistol/adswalk": {"rh": 0.038, "tip": 0.068},
    "viper/pistol/turn": {"rh": 0.012, "tip": 0.021},
}


# (W10 anim fix r1, D8 / D17) more transition events: [keys held before] and the event (keys after or None = unchanged, ADS after or None)
TRANS_MORE = ("crouchin", "crouchout", "idlerun", "runsprint", "adswalk", "turn")
TRANS_PRE = {"crouchout": ["KeyC"], "runsprint": ["KeyW"], "adswalk": ["KeyW"]}
TRANS_EV = {"crouchin": (["KeyC"], None), "crouchout": ([], None), "idlerun": (["KeyW"], None), "runsprint": (["KeyW", "ShiftLeft"], None),
            "adswalk": (None, False), "turn": (None, None)}
# a turn in place: the aim swept `turn` rad over the first 30 frames (the body steps round with the turn clip)
TRANS_TURN_JS = TRANS_JS.replace("for (let i = 0; i < n; i++) { P.step(1, 1 / 60, false);",
                                 "const y0 = A.input.yaw; for (let i = 0; i < n; i++) { if (i < 30) { A.input.yaw = y0 + ang * (i + 1) / 30; } P.step(1, 1 / 60, false);").replace("([n]) =>", "([n, ang]) =>")


def trans_eval(rows, evs, win, pts):
    """rows from TRANS_JS (frame i = index), evs = event frames -> {pt: [largest step m in the window, its frame, legacy normal (largest step away
    from the events), neighbour median, ratio]}.
    (W10 anim fix r2, D5) STANDARD T1's own method (audit8 / check_r1 analyze8 trans_section, verbatim): the largest per-frame step from the event
    (window: event - 1 .. event + 40; a jump: the press and the landing) against the MEDIAN of the steps 2-4 frames before and after it (floor
    1e-4 m); the bar is ratio <= 2 (T1). It replaces 'normal = the largest step anywhere away from the events', which let a snap pass when the
    run's own clip had a bigger step elsewhere (soldier ar/idlerun 0.0451 passed against a 'normal' of 0.0448)."""
    land = [i for i in range(1, len(rows)) if rows[i][0] and not rows[i - 1][0]]
    take = [i for i in range(1, len(rows)) if rows[i - 1][0] and not rows[i][0]]
    near = set()
    for e in evs + land + take:
        near.update(range(e - 2, e + 9))
    wins = set()
    for e in (evs + land if win == "land" else evs):
        wins.update(range(e - 1, e + 41))
    out = {"land": land, "ev": evs, "win": win}
    for k, nm in pts:
        sd = {}
        base = 0.0
        for i in range(1, len(rows)):
            a = rows[i - 1][k] if k < len(rows[i - 1]) else None
            b = rows[i][k] if k < len(rows[i]) else None
            if a is None or b is None:
                continue
            sd[i] = math.dist(a, b)
            if i not in near and i > 2:
                base = max(base, sd[i])
        win_ = [(d, i) for i, d in sd.items() if i in wins]
        if not win_:
            out[nm] = [None, None, round(base, 4), None, None]
            continue
        m, at = max(win_)
        nb = sorted(sd[at + q] for q in (-4, -3, -2, 2, 3, 4) if (at + q) in sd)
        med = (nb[len(nb) // 2] if len(nb) % 2 else 0.5 * (nb[len(nb) // 2 - 1] + nb[len(nb) // 2])) if nb else None
        ratio = m / max(1e-4, med) if med is not None else None
        out[nm] = [round(m, 4), at, round(base, 4), None if med is None else round(med, 4), None if ratio is None else round(ratio, 2)]
    return out


def part_trans(s, v, R, skin, only=None):
    spot = L.flat_spot(s, clear=9.0, max_r=900) or {}
    home = [spot["x"], spot["z"]] if spot else s.js("() => { const p = window.__LC__.W.player; return [p.pos.x, p.pos.z]; }")
    out = {}
    for wid in ("ar", "smg", "pistol"):
        for sc in (("swap", "ads", "land") + TRANS_MORE if wid == "ar" else ("ads", "land") if wid == "smg" else ("ads", "land") + TRANS_MORE):
            # (W10 anim fix 6) --trans: a planted control measures only its own event, so its FAIL can only come from its own row
            if only and sc not in only:
                continue
            s.release_all()
            s.js(PLACE_JS, [home[0], home[1], 0.0])
            s.js(EQUIP_JS, wid)
            s.js("() => { const W = window.__LC__.W, K = W.SIM, p = W.player; p.inventory.slots[2] = { kind: 'weapon', id: 'smg', rarity: 1, mag: K.WEAPONS.smg.mag }; return 1; }")
            s.js(AIM_JS, [0.0, 0.0, sc in ("ads", "adswalk")])
            pre = TRANS_PRE.get(sc) or []
            if pre:
                s.hold(pre)
            s.step_frames(130, 1 / 60, render=False)
            rows = s.js(TRANS_JS, [20])
            if sc in TRANS_EV:
                # (W10 anim fix r1, D8 / D17) crouch in / out, idle -> run, run -> sprint, an ADS release while walking, a turn in place, a slide
                k2, aim2 = TRANS_EV[sc]
                if k2 is not None:
                    s.release_all()
                    if k2:
                        s.hold(k2)
                if aim2 is not None:
                    s.js(AIM_JS, [None, None, aim2])
                if sc == "turn":
                    rows += s.js(TRANS_TURN_JS, [70, 1.6])
                else:
                    rows += s.js(TRANS_JS, [70])
                pts = ((2, "rh"), (4, "lh"), (3, "tip"))
            elif sc == "swap":
                s.js("() => { window.__LC__.W.equipSlot(window.__LC__.W.player, 2); return 1; }")
                rows += s.js(TRANS_JS, [70])
                pts = ((2, "rh"), (4, "lh"))
            elif sc == "ads":
                s.js(AIM_JS, [None, None, False])
                rows += s.js(TRANS_JS, [70])
                pts = ((2, "rh"), (4, "lh"), (3, "tip"))
            else:
                s.hold(["Space"])
                rows += s.js(TRANS_JS, [6])
                s.release_all()
                rows += s.js(TRANS_JS, [94])
                pts = ((2, "rh"), (4, "lh"), (3, "tip"))
            s.release_all()
            s.js(AIM_JS, [0.0, 0.0, False])
            out["%s/%s" % (wid, sc)] = trans_eval(rows, [20], "land" if sc == "land" else "ev", pts)
    s.step_frames(20, 1 / 60, render=False)
    R.setdefault(skin, {})["trans"] = out
    v.info("%s transitions (pt: [max per-frame move m in the event window, frame, normal per-frame move m])" % skin, out)
    return out


# (W10 anim fix 5, G2) CHASE VISIBILITY of the long gun at the patrol ready, every skin: from the game's default chase camera the frame is drawn
# normal / without the gun / the gun alone; visible = the gun's pixels that change when it is hidden, over the lone gun's pixels (check4's
# chasevis method). Median of 8 samples (every 5th frame), idle and running, AR / SMG / LMG; bar: >= the live build's (8ccb6efce) median measured
# the same way (fix5 cv_live5, 2026-11-23), no tolerance.
CHASE_JS = r"""async ([n, every, dyaw, seek, pre]) => { const W = window.__LC__.W, THREE = W.THREE, k = W.kernel, P = window.__H_PUMP__, A = W.player, r = k.renderer, cam = k.camera;
  const gl = r.getContext(); const Wd = r.domElement.width, Hd = r.domElement.height;
  if (seek) { const acts = A.rig && A.rig.actions ? Object.values(A.rig.actions) : []; let ns = 0;
    // (a frozen clip - timeScale 0, the crouch idle - has no phase to seek: it counts as fixed)
    for (const x of acts) if (x && x.isScheduled() && x.enabled && x.getEffectiveWeight() > 0) { if (x.isRunning()) x.time = 0; ns++; }
    window.__CHASE_SEEK__ = ns; for (let i = 0; i < (pre || 0); i++) P.step(1, 1 / 60, false); }
  const render = () => { if (k.composer) k.composer.render(1 / 60); else r.render(k.scene, cam); };
  const grab = () => { const px = new Uint8Array(Wd * Hd * 4); gl.readPixels(0, 0, Wd, Hd, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
  const hid = []; W.scene.traverse((o) => { if (o.visible && /^(clutter|grass-blades)$|grass/i.test(o.name || '')) { o.visible = false; hid.push(o); } });
  const out = [];
  for (let i = 0; i < n * every; i++) {
    if (dyaw) A.input.yaw += dyaw;
    P.step(1, 1 / 60, false); W.scene.updateMatrixWorld(true);
    if (i % every !== every - 1) continue;
    const wm = A.weaponMesh; if (!wm || wm.visible === false) { out.push(null); continue; }
    render(); const a = grab(); wm.visible = false; render(); const b = grab(); wm.visible = true;
    const off = []; const keep = new Set(); wm.traverse((o) => keep.add(o)); let p = wm; while (p) { keep.add(p); p = p.parent; }
    W.scene.traverse((o) => { if ((o.isMesh || o.isSkinnedMesh || o.isPoints || o.isLine || o.isSprite) && !keep.has(o) && o.visible) { o.visible = false; off.push(o); } });
    const bg = W.scene.background; W.scene.background = new THREE.Color(0, 0, 0); const fg = W.scene.fog; W.scene.fog = null;
    render(); const c = grab(); wm.visible = false; render(); const d = grab(); wm.visible = true;
    for (const o of off) o.visible = true; W.scene.background = bg; W.scene.fog = fg;
    let vis = 0, whole = 0; const th = 24;
    for (let j = 0; j < a.length; j += 4) {
      const dv = Math.abs(a[j] - b[j]) + Math.abs(a[j + 1] - b[j + 1]) + Math.abs(a[j + 2] - b[j + 2]);
      const dw = Math.abs(c[j] - d[j]) + Math.abs(c[j + 1] - d[j + 1]) + Math.abs(c[j + 2] - d[j + 2]);
      if (dw > th) { whole++; if (dv > th) vis++; } }
    out.push(whole ? vis / whole : null); }
  for (const o of hid) o.visible = true;
  return out; }"""
CHASE_SKINS = ["soldier", "athlete", "wraith", "juggernaut", "viper"]
CHASE_YAW = -1.5707963    # facing +X (chasevis / capture.py YAW)
# (W10 anim fix 6) chasevis's spot finder, verbatim (ANIM check3/check4 capture.py PAVED_JS): level within 0.3 m over 20 x 8 m, a paved / dirt
# / sand / stone surface, nothing standing in front of the camera
CHASE_SPOT_JS = r"""([clear, maxR]) => { const W = window.__LC__.W, M = W.map, p = W.player, wy = M.waterY; const x0 = p.pos.x, z0 = p.pos.z;
  const ok = (x, z) => { const h = M.heightAt(x, z); if (h < wy + 1) return false;
    for (let dx = -4; dx <= 16; dx += 2) for (let dz = -4; dz <= 4; dz += 2) { if (Math.abs(M.heightAt(x + dx, z + dz) - h) > 0.3) return false; if (!/concrete|dirt|sand|stone/.test(M.surfaceAt(x + dx, z + dz) || '')) return false; }
    for (const c of M.queryColliders(x + 6, z, clear + 12, [])) { if (c.dead) continue; if (c.maxY > h + 0.2 && c.minX < x + 18 && c.maxX > x - 5 && c.minZ < z + 6 && c.maxZ > z - 6) return false; }
    return true; };
  for (let r = 0; r < maxR; r += 8) for (let k = 0; k < 32; k++) { const a = k / 32 * Math.PI * 2, x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r;
    if (Math.abs(x) < 740 && Math.abs(z) < 740 && ok(x, z)) return { x, z, h: M.heightAt(x, z), surf: M.surfaceAt(x, z, M.heightAt(x, z) + 0.1) }; }
  return null; }"""
# (W10 anim fix r1, D17) at 3 decimals (check4 / fix5 / fix6 chasevis --rev 8ccb6efce, ANIM/check7/cv_cmp7.txt live column), plus the shotgun,
# the sniper and the pistol (idle, run, crouch walk, crouched still, strafe left, backpedal, turn in place); the juggernaut's pistol ready (live
# 0.000) must be > 0 (owner ruling 2026-11-23: CHASE_GT0)
CHASE_LIVE = {
    "soldier": {"idle_ar": 0.865, "run_ar": 0.803, "idle_smg": 0.770, "run_smg": 0.458, "idle_lmg": 0.765, "run_lmg": 0.591, "idle_shotgun": 0.844, "run_shotgun": 0.623,
                "idle_sniper": 0.783, "run_sniper": 0.554, "idle_pistol": 0.438, "run_pistol": 0.517, "crouch_pistol": 0.328, "crouchidle_pistol": 0.301,
                "strafeL_pistol": 0.0, "back_pistol": 0.526, "turn_pistol": 0.269},
    "athlete": {"idle_ar": 0.903, "run_ar": 0.657, "idle_smg": 0.903, "run_smg": 0.687, "idle_lmg": 0.896, "run_lmg": 0.597, "idle_shotgun": 0.945, "run_shotgun": 0.618,
                "idle_sniper": 0.964, "run_sniper": 0.798, "idle_pistol": 0.663, "run_pistol": 0.733, "crouch_pistol": 0.679, "crouchidle_pistol": 0.718,
                "strafeL_pistol": 0.0, "back_pistol": 0.672, "turn_pistol": 0.627},
    "wraith": {"idle_ar": 0.695, "run_ar": 0.567, "idle_smg": 0.565, "run_smg": 0.362, "idle_lmg": 0.481, "run_lmg": 0.377, "idle_shotgun": 0.641, "run_shotgun": 0.593,
               "idle_sniper": 0.757, "run_sniper": 0.566, "idle_pistol": 0.494, "run_pistol": 0.544, "crouch_pistol": 0.574, "crouchidle_pistol": 0.570,
               "strafeL_pistol": 0.0, "back_pistol": 0.388, "turn_pistol": 0.497},
    "juggernaut": {"idle_ar": 0.255, "run_ar": 0.301, "idle_smg": 0.037, "run_smg": 0.015, "idle_lmg": 0.227, "run_lmg": 0.178, "idle_shotgun": 0.225, "run_shotgun": 0.185,
                   "idle_sniper": 0.174, "run_sniper": 0.132, "idle_pistol": 0.0, "run_pistol": 0.0, "crouch_pistol": 0.0, "crouchidle_pistol": 0.0,
                   "strafeL_pistol": 0.0, "back_pistol": 0.466, "turn_pistol": 0.0},
    "viper": {"idle_ar": 0.909, "run_ar": 0.810, "idle_smg": 0.840, "run_smg": 0.725, "idle_lmg": 0.854, "run_lmg": 0.794, "idle_shotgun": 0.868, "run_shotgun": 0.810,
              "idle_sniper": 0.927, "run_sniper": 0.933, "idle_pistol": 0.396, "run_pistol": 0.686, "crouch_pistol": 0.684, "crouchidle_pistol": 0.710,
              "strafeL_pistol": 0.0, "back_pistol": 0.643, "turn_pistol": 0.167},
}
CHASE_GT0 = {"juggernaut": ("idle_pistol",)}
# (W10 anim fix r2, D1 / D6 / D12 / D22) the chase row's cells: the long guns still and running (AR / SMG / LMG / shotgun / sniper, and burst /
# DMR / launcher), the pistol in 7 states, and the AIM CAMERA (ADS, over the right shoulder) for the pistol and the four shouldered classes
CHASE_CELLS = ["idle_ar", "run_ar", "idle_smg", "run_smg", "idle_lmg", "run_lmg", "idle_shotgun", "run_shotgun", "idle_sniper", "run_sniper",
               "idle_burst", "run_burst", "idle_dmr", "run_dmr", "idle_glauncher", "run_glauncher",
               "idle_pistol", "run_pistol", "crouch_pistol", "crouchidle_pistol", "strafeL_pistol", "back_pistol", "turn_pistol",
               "ads_pistol", "ads_ar", "ads_smg", "ads_lmg", "ads_shotgun"]
# (W10 anim fix r2, D6) the live build's cells measured with THIS part (fixed clip phases, 16 samples): gunhold --rev 8ccb6efce --parts chase
# (ANIM/fix_r2 ghl_live.json, 2026-11-24); the fix-6 chasevis table above is kept for the record only
CHASE_LIVE2 = {
    "soldier": {"idle_ar": 0.869, "run_ar": 0.790, "idle_smg": 0.778, "run_smg": 0.448, "idle_lmg": 0.768, "run_lmg": 0.614, "idle_shotgun": 0.850, "run_shotgun": 0.606, "idle_sniper": 0.792, "run_sniper": 0.541, "idle_burst": 0.669, "run_burst": 0.473, "idle_dmr": 0.784, "run_dmr": 0.601, "idle_glauncher": 0.913, "run_glauncher": 0.817, "idle_pistol": 0.461, "run_pistol": 0.510, "crouch_pistol": 0.338, "crouchidle_pistol": 0.279, "strafeL_pistol": 0.000, "back_pistol": 0.540, "turn_pistol": 0.250, "ads_pistol": 0.543, "ads_ar": 0.887, "ads_smg": 0.771, "ads_lmg": 0.820, "ads_shotgun": 0.875},
    "athlete": {"idle_ar": 0.925, "run_ar": 0.654, "idle_smg": 0.902, "run_smg": 0.706, "idle_lmg": 0.903, "run_lmg": 0.605, "idle_shotgun": 0.938, "run_shotgun": 0.616, "idle_sniper": 0.968, "run_sniper": 0.812, "idle_burst": 0.860, "run_burst": 0.614, "idle_dmr": 0.886, "run_dmr": 0.714, "idle_glauncher": 0.867, "run_glauncher": 0.761, "idle_pistol": 0.658, "run_pistol": 0.713, "crouch_pistol": 0.701, "crouchidle_pistol": 0.729, "strafeL_pistol": 0.000, "back_pistol": 0.681, "turn_pistol": 0.637, "ads_pistol": 0.700, "ads_ar": 0.932, "ads_smg": 0.910, "ads_lmg": 0.905, "ads_shotgun": 0.944},
    "wraith": {"idle_ar": 0.701, "run_ar": 0.584, "idle_smg": 0.567, "run_smg": 0.361, "idle_lmg": 0.484, "run_lmg": 0.370, "idle_shotgun": 0.640, "run_shotgun": 0.574, "idle_sniper": 0.756, "run_sniper": 0.565, "idle_burst": 0.438, "run_burst": 0.320, "idle_dmr": 0.618, "run_dmr": 0.443, "idle_glauncher": 0.693, "run_glauncher": 0.604, "idle_pistol": 0.512, "run_pistol": 0.547, "crouch_pistol": 0.566, "crouchidle_pistol": 0.566, "strafeL_pistol": 0.000, "back_pistol": 0.509, "turn_pistol": 0.471, "ads_pistol": 0.601, "ads_ar": 0.735, "ads_smg": 0.428, "ads_lmg": 0.625, "ads_shotgun": 0.720},
    "juggernaut": {"idle_ar": 0.254, "run_ar": 0.314, "idle_smg": 0.040, "run_smg": 0.016, "idle_lmg": 0.231, "run_lmg": 0.183, "idle_shotgun": 0.223, "run_shotgun": 0.196, "idle_sniper": 0.186, "run_sniper": 0.143, "idle_burst": 0.108, "run_burst": 0.087, "idle_dmr": 0.188, "run_dmr": 0.147, "idle_glauncher": 0.660, "run_glauncher": 0.658, "idle_pistol": 0.000, "run_pistol": 0.000, "crouch_pistol": 0.000, "crouchidle_pistol": 0.000, "strafeL_pistol": 0.000, "back_pistol": 0.472, "turn_pistol": 0.000, "ads_pistol": 0.416, "ads_ar": 0.326, "ads_smg": 0.200, "ads_lmg": 0.389, "ads_shotgun": 0.393},
    "viper": {"idle_ar": 0.901, "run_ar": 0.804, "idle_smg": 0.833, "run_smg": 0.730, "idle_lmg": 0.860, "run_lmg": 0.790, "idle_shotgun": 0.858, "run_shotgun": 0.796, "idle_sniper": 0.930, "run_sniper": 0.923, "idle_burst": 0.774, "run_burst": 0.712, "idle_dmr": 0.865, "run_dmr": 0.847, "idle_glauncher": 0.876, "run_glauncher": 0.755, "idle_pistol": 0.344, "run_pistol": 0.678, "crouch_pistol": 0.659, "crouchidle_pistol": 0.699, "strafeL_pistol": 0.000, "back_pistol": 0.619, "turn_pistol": 0.181, "ads_pistol": 0.749, "ads_ar": 0.876, "ads_smg": 0.738, "ads_lmg": 0.849, "ads_shotgun": 0.896},
}
# (W10 anim fix r2, D6) the measurement's own noise: the largest difference of one cell between repeated runs of one build (ANIM/fix_r2
# noise runs); STANDARD: "worse than live" = live better by more than this
CHASE_NOISE = 0.0
# (W10 anim fix r2, D12) cells whose live value is 0 (the gun hidden) must show the gun (> CHASE_FLOOR), never pass on a 0 reference
CHASE_FLOOR = 0.05
CHASE_KEYS = {"idle": [], "run": ["KeyW"], "crouch": ["KeyW", "KeyC"], "crouchidle": ["KeyC"], "strafeL": ["KeyA"], "back": ["KeyS"], "turn": []}
CHASE_OLD = {   # the fix-5 2-decimal table this replaces (kept for the record, not used)
    "soldier": {"idle_ar": 0.87, "run_ar": 0.80, "idle_smg": 0.77, "run_smg": 0.47, "idle_lmg": 0.76, "run_lmg": 0.59},
    "athlete": {"idle_ar": 0.91, "run_ar": 0.66, "idle_smg": 0.91, "run_smg": 0.70, "idle_lmg": 0.90, "run_lmg": 0.60},
    "wraith": {"idle_ar": 0.69, "run_ar": 0.57, "idle_smg": 0.57, "run_smg": 0.37, "idle_lmg": 0.48, "run_lmg": 0.38},
    "juggernaut": {"idle_ar": 0.26, "run_ar": 0.30, "idle_smg": 0.04, "run_smg": 0.01, "idle_lmg": 0.23, "run_lmg": 0.18},
    "viper": {"idle_ar": 0.91, "run_ar": 0.81, "idle_smg": 0.83, "run_smg": 0.72, "idle_lmg": 0.86, "run_lmg": 0.80},
}


def part_chase(s, v, R, skin):
    s.js("() => window.__LC__.W.setGfx('tier', 'high')")
    s.step_frames(60, 1 / 60, render=True)
    # (W10 anim fix 6) the SAME spot as the measurement CHASE_LIVE came from (chasevis: a paved, level, open patch ahead of the camera); fix5's
    # row stood on L.flat_spot's grass, where the same build read up to 0.08 lower (gate_20261123_130217 viper idle_lmg 0.608 vs chasevis
    # 0.690, athlete idle_ar 0.829 vs 0.884): the build and its reference were measured on different ground
    spot = s.js(CHASE_SPOT_JS, [10.0, 1200]) or L.flat_spot(s, clear=9.0, max_r=900) or {}
    v.info("%s chase spot" % skin, spot)
    home = [spot["x"], spot["z"]] if spot else s.js("() => { const p = window.__LC__.W.player; return [p.pos.x, p.pos.z]; }")
    out, seeks = {}, {}
    for cell in CHASE_CELLS:
        nm, wid = cell.split("_")
        ads = nm == "ads"
        keys = [] if ads else CHASE_KEYS[nm]
        s.release_all()
        # (W10 anim fix 6) ...facing +X along the clear 20 m the spot finder checked (chasevis's yaw), not -Z
        s.js(PLACE_JS, [home[0], home[1], CHASE_YAW])
        s.js(EQUIP_JS, wid)
        s.js(AIM_JS, [CHASE_YAW, 0.0, ads])
        s.step_frames(130, 1 / 60, render=True)
        if keys:
            s.hold(keys)
        s.step_frames(40, 1 / 60, render=True)
        # (W10 anim fix r2, D6) FIXED CLIP PHASES: every running clip seeked to time 0, then 30 frames (any inertial blend the seek starts has
        # decayed: IN_S 0.22 s), then 16 samples 5 frames apart (the turn: 8 x 2 deg as live's reference). The free-running sample read up to
        # 0.015 apart between two runs of one build (gh_full vs the gate run) because the clip phase at the first sample was whatever the
        # earlier cells left
        turn = nm == "turn"
        xs = s.js(CHASE_JS, [8 if turn else 16, 5, 3.14159 / 90 if turn else 0, True, 30])
        seeks[cell] = s.js("() => window.__CHASE_SEEK__ || 0")
        xs = sorted(x for x in (xs or []) if x is not None)
        s.release_all()
        s.js(AIM_JS, [CHASE_YAW, 0.0, False])
        out[cell] = round(xs[len(xs) // 2], 3) if xs else None
    R.setdefault(skin, {})["chase"] = out
    R[skin]["chaseSeek"] = seeks
    v.info("%s chase / aim-camera gun visibility (median share of the gun's pixels the body does not hide; clips seeked)" % skin, out)
    return out


# (W10 anim fix r1, D2 / D4 / D9 / D12 / D15 / D17) per-frame pose probe for the aimpitch / lowlook / recoil / sghold parts
POSE_JS = r"""([n]) => { const W = window.__LC__.W, THREE = W.THREE, P = window.__H_PUMP__, A = W.player; const out = []; const bn = {};
  A.obj.traverse((o) => { if (!o.isBone) return; const nm = o.name.replace(/^mixamorig:?/i, ''); if (!bn[nm]) bn[nm] = o; });
  const wp = (b) => b.getWorldPosition(new THREE.Vector3()); let shot = A.lastShotT;
  for (let i = 0; i < n; i++) { P.step(1, 1 / 60, false); W.scene.updateMatrixWorld(true);
    const ud = A.weaponMesh && A.weaponMesh.userData; const inv = new THREE.Matrix4().copy(bn.Hips.matrixWorld).invert();
    const hd = wp(bn.Head), top = bn.HeadTop_End ? wp(bn.HeadTop_End) : hd.clone().add(new THREE.Vector3(0, 0.2, 0));
    const m = bn.Head.matrixWorld.elements, up = [m[4], m[5], m[6]];
    const el = (s1, m1, h1) => +(wp(bn[s1]).sub(wp(bn[m1])).angleTo(wp(bn[h1]).sub(wp(bn[m1]))) * 180 / Math.PI).toFixed(1);
    const R = { mode: A._armMode || null, rhW: A._rhW == null ? null : +A._rhW.toFixed(3), pbK: A._pbK == null ? null : +A._pbK.toFixed(3), anim: A.anim,
      headTopY: top.y, rhY: wp(bn.RightHand).y, lhY: wp(bn.LeftHand).y, up, yaw: A.yaw, elR: el('RightArm', 'RightForeArm', 'RightHand'), elL: el('LeftArm', 'LeftForeArm', 'LeftHand') };
    if (ud && ud.butt && A.hand) R.butt = +A.hand.localToWorld(new THREE.Vector3(ud.butt.x, ud.butt.y, ud.butt.z)).distanceTo(wp(bn.RightArm)).toFixed(4);
    if (ud && ud.tip && A.hand) { const t = A.hand.localToWorld(new THREE.Vector3(ud.tip.x, ud.tip.y, ud.tip.z)).applyMatrix4(inv); R.tip = [t.x, t.y, t.z]; }
    if (A.lastShotT !== shot) { R.shot = 1; shot = A.lastShotT; }
    out.push(R); }
  return out; }"""
AIMP_WIDS = ("ar", "lmg", "smg", "shotgun", "pistol")   # (W10 anim fix r2, D11) + the pistol: its head pitched DOWN aiming up (tracking -0.39, live -0.71)


def head_pitch(r):
    """the Head bone's up axis tilt (deg) toward the aim's horizontal forward: + = tipped back (looking up)"""
    fx, fz = -math.sin(r["yaw"]), -math.cos(r["yaw"])
    u = r["up"]
    return math.degrees(math.atan2(-(u[0] * fx + u[2] * fz), u[1]))


def part_aimpitch(s, v, R, skin):
    """(W10 anim fix r1, D2 / D15) the long guns at +-45 deg of aim pitch, aimed (ADS) and hip-firing"""
    spot = s.js(CHASE_SPOT_JS, [10.0, 1200]) or L.flat_spot(s, clear=9.0, max_r=900) or {}
    home = [spot["x"], spot["z"]] if spot else s.js("() => { const p = window.__LC__.W.player; return [p.pos.x, p.pos.z]; }")
    out = {}
    for wid in AIMP_WIDS:
        for st in ("ads", "hip"):
            hp = {}
            for pit in (0.7854, -0.7854):
                s.release_all(); s.js(PLACE_JS, [home[0], home[1], CHASE_YAW]); s.js(EQUIP_JS, wid)
                s.js(AIM_JS, [CHASE_YAW, pit, st == "ads"])
                s.step_frames(90, 1 / 60, render=False)
                if st == "hip":
                    s.js(FIRE_ON)
                rows = s.js(POSE_JS, [30])
                s.js(FIRE_OFF)
                r_ = rows[-1]
                key = "%s/%s/%s" % (wid, st, "up" if pit > 0 else "dn")
                out[key] = {"butt": r_.get("butt"), "lhOverTop": round(r_["lhY"] - r_["headTopY"], 3), "rhOverTop": round(r_["rhY"] - r_["headTopY"], 3),
                            "head": round(head_pitch(r_), 1), "mode": r_["mode"], "rhW": r_["rhW"]}
                hp[pit] = head_pitch(r_)
            out["%s/%s/headFollow" % (wid, st)] = round((hp[0.7854] - hp[-0.7854]) / 90.0, 3)
    s.js(AIM_JS, [CHASE_YAW, 0.0, False])
    R.setdefault(skin, {})["aimpitch"] = out
    v.info("%s aim pitch +-45 (butt to the RightArm joint m, wrists over the head top m, head pitch deg, head follow share)" % skin, out)
    return out


def part_lowlook(s, v, R, skin):
    """(W10 anim fix r1, D4) desktop Low: the pistol in live's gunReady in every state, no squared chest; the long gun without the rifle hold"""
    s.js("() => window.__LC__.W.setGfx('tier', 'low')")
    s.step_frames(30, 1 / 60, render=True)
    spot = s.js(CHASE_SPOT_JS, [10.0, 1200]) or L.flat_spot(s, clear=9.0, max_r=900) or {}
    home = [spot["x"], spot["z"]] if spot else s.js("() => { const p = window.__LC__.W.player; return [p.pos.x, p.pos.z]; }")
    out = {"tier": s.js("() => window.__LC__.W.gfxTier || null")}
    for wid, nm, keys, ads in (("pistol", "idle", [], False), ("pistol", "run", ["KeyW"], False), ("pistol", "strafeL", ["KeyA"], False),
                               ("pistol", "back", ["KeyS"], False), ("pistol", "crouch", ["KeyC"], False), ("pistol", "ads", [], True),
                               ("ar", "idle", [], False), ("ar", "run", ["KeyW"], False)):
        s.release_all(); s.js(PLACE_JS, [home[0], home[1], CHASE_YAW]); s.js(EQUIP_JS, wid); s.js(AIM_JS, [CHASE_YAW, 0.0, ads])
        s.step_frames(60, 1 / 60, render=False)
        if keys:
            s.hold(keys)
        rows = s.js(POSE_JS, [40])
        s.release_all()
        out["%s/%s" % (wid, nm)] = {"modes": sorted(set(str(r_["mode"]) for r_ in rows)), "rhWmax": max((r_["rhW"] or 0) for r_ in rows),
                                     "pbKmax": max((r_["pbK"] or 0) for r_ in rows)}
    s.js(AIM_JS, [CHASE_YAW, 0.0, False])
    s.js("() => window.__LC__.W.setGfx('tier', 'high')")
    s.step_frames(30, 1 / 60, render=True)
    R.setdefault(skin, {})["lowlook"] = out
    v.info("%s desktop Low look (arm modes, rifle-hold weight, pistol chest squaring)" % skin, out)
    return out


RECOIL_WIDS = ("smg", "ar", "lmg", "pistol")


def part_recoil(s, v, R, skin):
    """(W10 anim fix r1, D12) the muzzle's kick on each shot: its largest displacement (hips frame) in the 2 frames from the shot frame,
    against the frame before the shot"""
    spot = s.js(CHASE_SPOT_JS, [10.0, 1200]) or L.flat_spot(s, clear=9.0, max_r=900) or {}
    home = [spot["x"], spot["z"]] if spot else s.js("() => { const p = window.__LC__.W.player; return [p.pos.x, p.pos.z]; }")
    out = {}
    for wid in RECOIL_WIDS:
        s.release_all(); s.js(PLACE_JS, [home[0], home[1], CHASE_YAW]); s.js(EQUIP_JS, wid); s.js(AIM_JS, [CHASE_YAW, 0.0, True])
        s.step_frames(90, 1 / 60, render=False)
        rows = []
        for k_ in range(4):
            s.js(FIRE_ON)
            rows += s.js(POSE_JS, [2])
            s.js(FIRE_OFF)
            rows += s.js(POSE_JS, [28])
        kicks = []
        for i, r_ in enumerate(rows):
            if r_.get("shot") and i >= 1 and rows[i - 1].get("tip"):
                b = rows[i - 1]["tip"]
                kicks.append(round(max(math.dist(b, rows[j]["tip"]) for j in range(i, min(len(rows), i + 2)) if rows[j].get("tip")), 4))
        out[wid] = {"kicks": kicks}
    s.js(AIM_JS, [CHASE_YAW, 0.0, False])
    R.setdefault(skin, {})["recoil"] = out
    v.info("%s recoil (the muzzle's move in the shot frame and the next, m, hips frame)" % skin, out)
    return out


# (W10 anim fix r2, D2, STANDARD W3) the FIRST hip shot from the patrol ready: the angle between the barrel (grip -> muzzle) and the aim on the
# frame the shot leaves (lastShotT changes), every class, still, after 150 frames out of combat
FIRST_JS = r"""([n]) => { const W = window.__LC__.W, THREE = W.THREE, P = window.__H_PUMP__, A = W.player; const out = []; let shot = A.lastShotT;
  for (let i = 0; i < n; i++) { P.step(1, 1 / 60, false); W.scene.updateMatrixWorld(true);
    const ud = A.weaponMesh && A.weaponMesh.userData; if (!ud || !ud.tip || !A.hand) { out.push(null); continue; }
    // the bore: the holder's +Z axis (rifleHold / barrelWeld aim it; grip -> muzzle tip is not parallel to the bore: the tip sits above the grip)
    const t = A.hand.localToWorld(new THREE.Vector3(0, 0, 1)), o = A.hand.localToWorld(new THREE.Vector3(0, 0, 0));
    const d = t.sub(o).normalize(), y = A.yaw, pi = A.pitch, f = new THREE.Vector3(-Math.sin(y) * Math.cos(pi), Math.sin(pi), -Math.cos(y) * Math.cos(pi));
    const R = { deg: +(Math.acos(Math.max(-1, Math.min(1, d.dot(f)))) * 180 / Math.PI).toFixed(2), rdy: A._rdyE == null ? null : +A._rdyE.toFixed(3), mode: A._armMode || null };
    if (A.lastShotT !== shot) { R.shot = 1; shot = A.lastShotT; }
    out.push(R); }
  return out; }"""
FIRST_WIDS = ("pistol", "smg", "ar", "burst", "dmr", "lmg", "shotgun", "sniper", "glauncher")


def part_firstshot(s, v, R, skin):
    spot = s.js(CHASE_SPOT_JS, [10.0, 1200]) or L.flat_spot(s, clear=9.0, max_r=900) or {}
    home = [spot["x"], spot["z"]] if spot else s.js("() => { const p = window.__LC__.W.player; return [p.pos.x, p.pos.z]; }")
    out = {}
    for wid in FIRST_WIDS:
        s.release_all(); s.js(PLACE_JS, [home[0], home[1], CHASE_YAW]); s.js(EQUIP_JS, wid); s.js(AIM_JS, [CHASE_YAW, 0.0, False])
        s.step_frames(150, 1 / 60, render=False)
        pre = s.js(FIRST_JS, [2])
        s.js(FIRE_ON)
        rows = s.js(FIRST_JS, [10])
        s.js(FIRE_OFF)
        sh = [r_ for r_ in rows if r_ and r_.get("shot")]
        out[wid] = {"shotDeg": sh[0]["deg"] if sh else None, "readyDeg": pre[-1]["deg"] if pre and pre[-1] else None,
                    "readyRdy": pre[-1]["rdy"] if pre and pre[-1] else None, "mode": pre[-1]["mode"] if pre and pre[-1] else None,
                    "after": [r_["deg"] if r_ else None for r_ in rows[:6]]}
        s.step_frames(40, 1 / 60, render=False)
    s.js(AIM_JS, [CHASE_YAW, 0.0, False])
    R.setdefault(skin, {})["firstshot"] = out
    v.info("%s first hip shot from the ready (barrel-to-aim deg on the shot frame; at the ready before the press)" % skin, out)
    return out


# (W10 anim fix r2, D10 / S6) the backward diagonals with the pistol and the AR at the combat run (hip fire held off: out of combat, then in
# combat after a shot): the clip each plays after 60 frames - a back clip (rifle_run_back / rifle_walk_back), never a sprint-set clip
DIAG_KEYS = {"BL": ["KeyS", "KeyA"], "BR": ["KeyS", "KeyD"]}


def part_diagclip(s, v, R, skin):
    spot = s.js(CHASE_SPOT_JS, [10.0, 1200]) or L.flat_spot(s, clear=9.0, max_r=900) or {}
    home = [spot["x"], spot["z"]] if spot else s.js("() => { const p = window.__LC__.W.player; return [p.pos.x, p.pos.z]; }")
    out = {}
    for wid in ("pistol", "ar"):
        for dn, keys in DIAG_KEYS.items():
            s.release_all(); s.js(PLACE_JS, [home[0], home[1], CHASE_YAW]); s.js(EQUIP_JS, wid); s.js(AIM_JS, [CHASE_YAW, 0.0, False])
            s.step_frames(60, 1 / 60, render=False)
            s.hold(keys)
            s.step_frames(60, 1 / 60, render=False)
            r_ = s.js("() => { const p = window.__LC__.W.player; return { anim: p.anim, spd: Math.hypot(p.vel.x, p.vel.z) }; }")
            s.release_all()
            out["%s/%s" % (wid, dn)] = r_
            s.step_frames(30, 1 / 60, render=False)
    s.js(AIM_JS, [CHASE_YAW, 0.0, False])
    R.setdefault(skin, {})["diagclip"] = out
    v.info("%s backward diagonals (clip, speed)" % skin, out)
    return out


def part_sghold(s, v, R, skin):
    """(W10 anim fix r1, D9) the pump shotgun's trigger elbow at the ready, running, crouched and aimed"""
    spot = s.js(CHASE_SPOT_JS, [10.0, 1200]) or L.flat_spot(s, clear=9.0, max_r=900) or {}
    home = [spot["x"], spot["z"]] if spot else s.js("() => { const p = window.__LC__.W.player; return [p.pos.x, p.pos.z]; }")
    out = {}
    for nm, keys, ads in (("idle", [], False), ("run", ["KeyW"], False), ("crouch", ["KeyC"], False), ("ads", [], True), ("back", ["KeyS"], False)):
        s.release_all(); s.js(PLACE_JS, [home[0], home[1], CHASE_YAW]); s.js(EQUIP_JS, "shotgun"); s.js(AIM_JS, [CHASE_YAW, 0.0, ads])
        s.step_frames(60, 1 / 60, render=False)
        if keys:
            s.hold(keys)
        s.step_frames(30, 1 / 60, render=False)
        rows = s.js(POSE_JS, [30])
        s.release_all()
        out[nm] = {"elRmin": min(r_["elR"] for r_ in rows), "elLmed": sorted(r_["elL"] for r_ in rows)[len(rows) // 2]}
    s.js(AIM_JS, [CHASE_YAW, 0.0, False])
    R.setdefault(skin, {})["sghold"] = out
    v.info("%s shotgun hold (trigger elbow min deg, support elbow median deg)" % skin, out)
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
    ap.add_argument("--parts", default="guns,flash,pistol,flinch,death,sheen,reload,swim,swap,kerb,trans,chase,aimpitch,lowlook,recoil,sghold,firstshot,diagclip")
    ap.add_argument("--shots", default=None)
    ap.add_argument("--trans", default="swap,ads,land,crouchin,crouchout,idlerun,runsprint,adswalk,turn", help="(W10 anim fix 6) the transition events part trans measures (a control names its own)")
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
            if want & {"guns", "flash", "pistol", "flinch", "sheen", "reload", "swap", "kerb", "trans"}:
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
                    if "trans" in want:
                        part_trans(s, v, R, skin, set(args.trans.split(",")))
                    s.step_frames(10, 1 / 60, render=True)
                    progs.append([skin, p0, L.programs(s)])
            if "chase" in want:
                # (W10 anim fix 5, G2) every skin, its own practice boot (the chase camera's view of the patrol ready)
                for skin in CHASE_SKINS:
                    v.info("practice chase %s" % skin, boot_practice(s, skin))
                    part_chase(s, v, R.setdefault("chaseRows", {}), skin)
            if want & {"aimpitch", "lowlook", "recoil", "sghold", "firstshot", "diagclip"}:
                # (W10 anim fix r1) every skin, its own practice boot
                for skin in CHASE_SKINS:
                    v.info("practice r1 %s" % skin, boot_practice(s, skin))
                    s.js("() => window.__LC__.W.setGfx('tier', 'high')")
                    s.step_frames(30, 1 / 60, render=True)
                    RR = R.setdefault("r1Rows", {})
                    if "aimpitch" in want:
                        part_aimpitch(s, v, RR, skin)
                    if "recoil" in want:
                        part_recoil(s, v, RR, skin)
                    if "sghold" in want:
                        part_sghold(s, v, RR, skin)
                    if "firstshot" in want:
                        part_firstshot(s, v, RR, skin)
                    if "diagclip" in want:
                        part_diagclip(s, v, RR, skin)
                    if "lowlook" in want:
                        part_lowlook(s, v, RR, skin)
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
                    kr["%s/%s" % (skin, key)] = e and {"rh": e["rh"], "tip": e["tip"], "rhR": e.get("rhR"), "tipR": e.get("tipR"), "air": e["air"]}
                    # the step really left the ground (>= 3 frames unsupported) and neither point jumped more than 2x its own normal motion, in the
                    # hips' frame AND (W10 anim fix 5, G2) the drawn root's frame
                    ok = bool(e) and e["air"] >= 3 and all(e.get(p) and e[p][0] <= 2.0 * e[p][2] + 1e-9 for p in ("rh", "tip", "rhR", "tipR"))
                    if not ok:
                        kb.append("%s/%s" % (skin, key))
            v.check("kerb: a 20 cm kerb step-off (AR / SMG / sniper / pistol, running and still): the right hand's and the muzzle's largest per-frame move (hips frame and drawn-root frame) <= 2x the same clip's normal per-frame move",
                    not kb and bool(kr), {"bad": kb, "[max, frame, normal]": kr}, "<= 2x normal")
        if "trans" in want:
            for row, keys, txt in (("crouch-pop", ["ar/crouchin", "ar/crouchout", "pistol/crouchin", "pistol/crouchout"], "crouch in / out (AR, pistol): the right hand and the muzzle"),
                                   ("loco-pop", ["ar/idlerun", "ar/runsprint", "pistol/idlerun", "pistol/runsprint"], "idle -> run, run -> sprint (AR, pistol): the right hand and the muzzle"),
                                   ("turn-pop", ["ar/turn", "pistol/turn"], "a turn in place (aim swept 92 deg; AR, pistol): the right hand and the muzzle"),
                                   ("adswalk-pop", ["ar/adswalk", "pistol/adswalk"], "an ADS release while walking (AR, pistol): the right hand and the muzzle"),
                                   ("pistol-pop", ["pistol/ads", "pistol/land"], "the pistol's ADS release and jump landing (still): the right hand and the muzzle"),
                                   ("swap-pop", ["ar/swap"], "a gun swap (AR -> SMG, still): the right hand"),
                                   ("ads-pop", ["ar/ads", "smg/ads"], "an ADS release (AR / SMG, still): the right hand and the muzzle"),
                                   ("land-pop", ["ar/land", "smg/land"], "a jump's landing (AR / SMG, still, a real Space press): the right hand and the muzzle")):
                # (W10 anim fix 6) a row whose event --trans left out is not judged (never passed: it is not in the table)
                if not any(k_.split("/")[1] in set(args.trans.split(",")) for k_ in keys):
                    continue
                bad, rr = [], {}
                for skin in skins:
                    T = R.get(skin, {}).get("trans") or {}
                    for key in keys:
                        e = T.get(key)
                        rr["%s/%s" % (skin, key)] = e
                        pts = [p_ for p_ in ("rh", "lh", "tip") if e and p_ in e]
                        # (W10 anim fix r2, D5 / D7) STANDARD T1 as written: the largest step <= 2x the median of its neighbours, every point, all 5 skins
                        # (gate.py runs this part on the 5 skins); live's value is reported beside it, never an exemption (T1 has no live escape)
                        ok = bool(e) and len(pts) >= 2 and (key.endswith("/land") is False or bool(e.get("land"))) and \
                            all(e[p_][1] is not None and e[p_][4] is not None and e[p_][4] <= 2.0 for p_ in pts)
                        if not ok:
                            bad.append("%s/%s" % (skin, key))
                if len(skins) < 5 and not args.plant:
                    v.cnj(row, "T1 is judged on all 5 skins; this run had %s" % ",".join(skins))
                    continue
                v.check("%s: %s, and the left hand - the largest per-frame step (hips frame) from the event (-1..+40 frames) <= 2x the median of the steps 2-4 frames around it (STANDARD T1, all 5 skins; live's largest step for information)" % (row, txt),
                        not bad and bool(rr), {"bad": bad, "[max, frame, normal, nbMedian, ratio]": rr, "liveInfo": {k_: TRANS_LIVE.get(k_) for k_ in rr}}, "ratio <= 2")
        if "chase" in want:
            CR = R.get("chaseRows") or {}
            if not CHASE_LIVE2:
                v.cnj("chase", "no live reference measured with the fixed-phase part (CHASE_LIVE2 empty)")
                v.cnj("adscam", "no live reference measured with the fixed-phase part (CHASE_LIVE2 empty)")
            for row, cells, txt in (("chase", [c_ for c_ in CHASE_CELLS if not c_.startswith("ads_")],
                                     "the held gun seen from the chase camera (AR / SMG / LMG / shotgun / sniper / burst / DMR / launcher still and running, the pistol in 7 states)"),
                                    ("adscam", [c_ for c_ in CHASE_CELLS if c_.startswith("ads_")],
                                     "the held gun seen from the AIM camera (ADS over the right shoulder: pistol, AR, SMG, LMG, shotgun)")):
                if not CHASE_LIVE2:
                    continue
                bad, rr = [], {}
                for skin in CHASE_SKINS:
                    got = (CR.get(skin) or {}).get("chase") or {}
                    sk_ = (CR.get(skin) or {}).get("chaseSeek") or {}
                    for key in cells:
                        g, lv = got.get(key), (CHASE_LIVE2.get(skin) or {}).get(key)
                        rr["%s/%s" % (skin, key)] = [g, lv]
                        # the clip seek must have run (a 0-action seek is the old free-running sample); >= live - noise; a hidden live cell needs > the floor
                        if g is None or lv is None or not sk_.get(key) or g < lv - CHASE_NOISE - 1e-9 or \
                                ((lv <= CHASE_NOISE or key in CHASE_GT0.get(skin, ())) and not g > CHASE_FLOOR):
                            bad.append("%s/%s" % (skin, key))
                v.check("%s: %s as much as on the live build (>= live - the measured noise %.3f; a cell hidden on live > %.2f), fixed clip phases, 3 decimals, all 5 skins" % (row, txt, CHASE_NOISE, CHASE_FLOOR),
                        not bad and len(rr) == 5 * len(cells), {"bad": bad, "[build, live]": rr}, ">= live - noise")
        RR = R.get("r1Rows") or {}
        if "aimpitch" in want:
            # (W10 anim fix r1, D2 / D15, STANDARD A1 / A4 / W2) at +-45 deg (ADS and hip fire; AR, LMG, SMG, shotgun; 5 skins): the butt within 0.15 m of
            # the RightArm joint (the 0.10 m pocket + 5 cm), both wrists under the top of the head, the head following >= 0.7 of the aim pitch
            bad, rr = [], {}
            for skin in CHASE_SKINS:
                A_ = (RR.get(skin) or {}).get("aimpitch") or {}
                for wid in AIMP_WIDS:
                    for st in ("ads", "hip"):
                        for d_ in ("up", "dn"):
                            e = A_.get("%s/%s/%s" % (wid, st, d_))
                            rr["%s/%s/%s/%s" % (skin, wid, st, d_)] = e
                            # (the pistol has no stock: its butt is not judged)
                            if not e or (wid != "pistol" and (e["butt"] is None or e["butt"] > 0.15)) or e["lhOverTop"] > 0 or e["rhOverTop"] > 0:
                                bad.append("%s/%s/%s/%s" % (skin, wid, st, d_))
                        hf = A_.get("%s/%s/headFollow" % (wid, st))
                        rr["%s/%s/%s/headFollow" % (skin, wid, st)] = hf
                        if hf is None or hf < 0.7:
                            bad.append("%s/%s/%s/headFollow" % (skin, wid, st))
            v.check("aimpitch: at +-45 deg of aim (ADS and hip fire, AR / LMG / SMG / shotgun / pistol, 5 skins) the butt <= 0.15 m from the shoulder joint (long guns), both wrists under the head top, the head following >= 0.7 of the pitch",
                    not bad and len(rr) == 5 * len(AIMP_WIDS) * 2 * 3, {"bad": bad, "rows": rr}, "butt <= 0.15 m, wrists < head top, follow >= 0.7")
        if "lowlook" in want:
            # (W10 anim fix r1, D4, owner rule: phones / Low look as live) desktop Low: the pistol in gunReady in every state (live's only mode), no
            # squared pistol chest, no rifle hold
            bad, rr = [], {}
            for skin in CHASE_SKINS:
                A_ = (RR.get(skin) or {}).get("lowlook") or {}
                for key, e in A_.items():
                    if key == "tier":
                        continue
                    rr["%s/%s" % (skin, key)] = e
                    # (a long gun has no arm mode: _armMode keeps the last one, so only its rifle-hold weight is read)
                    if (key.startswith("pistol") and e["modes"] != ["gunReady"]) or e["rhWmax"] > 0 or e["pbKmax"] > 0:
                        bad.append("%s/%s" % (skin, key))
                if A_.get("tier") != "low":
                    bad.append("%s/tier=%s" % (skin, A_.get("tier")))
            v.check("lowlook: desktop Low keeps live's arm modes (pistol gunReady in idle / run / strafe / back / crouch / ADS; long gun no arm mode), no rifle hold, no pistol chest squaring",
                    not bad and len(rr) == 40, {"bad": bad, "rows": rr}, "as live")
        if "recoil" in want:
            # (W10 anim fix r1, D12, STANDARD W4) every shot kicks the muzzle >= 1.5 cm within the shot frame and the next (SMG, AR, LMG, pistol; aimed)
            bad, rr = [], {}
            for skin in CHASE_SKINS:
                A_ = (RR.get(skin) or {}).get("recoil") or {}
                for wid in RECOIL_WIDS:
                    k_ = (A_.get(wid) or {}).get("kicks") or []
                    rr["%s/%s" % (skin, wid)] = k_
                    if len(k_) < 3 or min(k_) < 0.015:
                        bad.append("%s/%s" % (skin, wid))
            v.check("recoil: each shot moves the muzzle >= 0.015 m (hips frame) within 1 frame of the shot (SMG / AR / LMG / pistol, aimed, >= 3 shots, 5 skins)",
                    not bad and len(rr) == 20, {"bad": bad, "kicks": rr}, ">= 0.015 m")
        if "sghold" in want:
            # (W10 anim fix r1, D9, STANDARD B2 / W1) the pump shotgun's trigger elbow >= 52 deg interior (live's least, 52-68) in every state
            bad, rr = [], {}
            for skin in CHASE_SKINS:
                A_ = (RR.get(skin) or {}).get("sghold") or {}
                for nm in ("idle", "run", "crouch", "ads", "back"):
                    e = A_.get(nm)
                    rr["%s/%s" % (skin, nm)] = e
                    if not e or e["elRmin"] < 52:
                        bad.append("%s/%s" % (skin, nm))
            v.check("sghold: the pump shotgun's trigger elbow >= 52 deg interior at the ready, running, crouched, aimed and backpedalling (5 skins)",
                    not bad and len(rr) == 25, {"bad": bad, "rows": rr}, ">= 52 deg")
        if "diagclip" in want:
            # (W10 anim fix r2, D10 / S6) a backward diagonal plays a back clip, never a side or sprint-set clip (pistol, AR; 5 skins)
            bad, rr = [], {}
            for skin in CHASE_SKINS:
                A_ = (RR.get(skin) or {}).get("diagclip") or {}
                for key in ("pistol/BL", "pistol/BR", "ar/BL", "ar/BR"):
                    e = A_.get(key)
                    rr["%s/%s" % (skin, key)] = e
                    an = (e or {}).get("anim") or ""
                    if not e or "back" not in an or "sprint" in an:
                        bad.append("%s/%s" % (skin, key))
            v.check("diagclip: the backward diagonals (back-left, back-right; pistol and AR) play a back clip, never a side or sprint-set clip (5 skins)",
                    not bad and len(rr) == 20, {"bad": bad, "rows": rr}, "a back clip")
        if "firstshot" in want:
            # (W10 anim fix r2, D2, STANDARD W3) the barrel within 5 deg of the aim on the first shot's frame from the patrol ready (every class, 5 skins)
            bad, rr = [], {}
            for skin in CHASE_SKINS:
                A_ = (RR.get(skin) or {}).get("firstshot") or {}
                for wid in FIRST_WIDS:
                    e = A_.get(wid)
                    rr["%s/%s" % (skin, wid)] = e
                    if not e or e["shotDeg"] is None or e["shotDeg"] > 5.0:
                        bad.append("%s/%s" % (skin, wid))
            v.check("firstshot: the barrel within 5 deg of the aim on the frame the first hip shot leaves from the patrol ready (9 classes, 5 skins)",
                    not bad and len(rr) == 5 * len(FIRST_WIDS), {"bad": bad, "rows": rr}, "<= 5 deg")
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
