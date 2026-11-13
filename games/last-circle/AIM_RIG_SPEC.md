I read the code, then measured the real assets with real three.js r172 rather than reasoning from the research alone. The measurements changed several conclusions, including one load-bearing comment in `pose.js` that is factually false.

---

# Aim-Rig Replacement Spec — `last-circle`

**Scope:** `forgeflow-games/games/last-circle/runtime/3d/royale/pose.js` and `player.js`.
**Confidence labels used throughout:** `[MEASURED]` = probed this session against the shipping GLBs with three@0.172.0 (the exact version pinned at `index.html:21`); `[PRIMARY]` = primary engine/biomechanics source; `[SECONDARY]` = clinical/secondary; `[INFERRED]` = my derivation; `[CHOSEN]` = a tuning value with no source, flagged as such.

---

## 0. Ground truth measured this session

Reproduce: `cd forgeflow-games && node <script>` — three@0.172.0 is installed at `node_modules/three` (verified: `REVISION 172`, `AdditiveAnimationBlendMode = 2501`) and `GLTFLoader` parses the GLBs headlessly with `globalThis.self = globalThis` shimmed.

**Rig topology `[MEASURED]`** — `soldier.glb`, 24 joints, identical across all 5 skins:

```
Armature (scale 0.01 — bone units are CENTIMETRES)
└ Hips
  ├ LeftUpLeg → LeftLeg → LeftFoot → LeftToeBase        (and Right)
  └ Spine02 → Spine01 → Spine → ┬ LeftShoulder → LeftArm → LeftForeArm → LeftHand
                                ├ RightShoulder → RightArm → RightForeArm → RightHand
                                └ neck → Head → { head_end, headfront }
```

**The bone names are INVERTED relative to every convention the research assumes.** `Spine02` is the LOWEST spine joint (child of Hips, the lumbar analogue). `Spine` is the HIGHEST (the chest, carrying both clavicles and the neck). Root→tip order is `Spine02 → Spine01 → Spine`. Any weight table copied from UE/FinalIK literature must be applied in that order, not in name order.

**Orientation `[MEASURED]`** — model faces **+Z**, up **+Y**, model-left **+X**. Proven, not assumed: the `headfront` node's offset from `Head`, expressed in armature space, is `[0.00, 0.00, 1.00]` on soldier and wraith. Every bone's local **+Y is the bone direction** (children are offset purely along +Y). This confirms the `pose.js:95` comment.

**No finger bones, no twist bones `[MEASURED]`** — `LeftForeArm → LeftHand` is a direct edge and `LeftHand` is a leaf. Any forearm pronation applied at the hand bone will candy-wrapper the wrist skin; it has to live on the ForeArm bone.

**Per-skin arm chains `[MEASURED]`** (metres, after the 0.01 armature scale):

| skin | upperArm | foreArm | chain | 0.99·chain | headfront axis (Head-local) |
|---|---|---|---|---|---|
| soldier | 0.2766 | 0.2813 | 0.5579 | 0.5523 | `[0.001, 0.418, 0.908]` |
| athlete | 0.2307 | 0.2542 | 0.4850 | 0.4801 | `[-0.002, 0.561, 0.828]` |
| wraith | 0.2660 | 0.2121 | 0.4781 | 0.4733 | `[-0.019, 0.587, 0.810]` |
| juggernaut | 0.3224 | 0.3213 | 0.6437 | 0.6373 | `[0.002, 0.798, 0.602]` |
| viper | 0.2669 | 0.2746 | 0.5416 | 0.5362 | `[0.008, 0.481, 0.876]` |

Arm chains vary 35% between skins and the head's face axis varies by 24–53°. **Neither can be a constant.** Both must be derived at load. Every skin has `headfront`, so the face axis is free to derive.

---

## 1. What is wrong today

### 1.1 `bone.rotation.x` is not the pitch axis — it is off by up to 151° on the default player skin `[MEASURED]`

`applySpineAim` (`pose.js:137-141`) writes `bone.rotation.x`. THREE's Euler order is XYZ, so `q = qx·qy·qz`; adding Δ to `ex` gives `R' = Rx(Δ)·R` — a **pre-multiplication in the PARENT's frame**. The axis is therefore the *parent bone's* world X, whatever the animation has done to it.

Measured with the real mixer, sampling 12 frames per clip, the angle between the axis `bone.rotation.x` actually rotates about and the true sagittal (model-left) axis:

| skin/clip | Spine02 | Spine01 | Spine |
|---|---|---|---|
| **soldier/idle** | **87–151°** | 2–82° | 2–86° |
| **soldier/walk** | **91–97°** | 1–7° | 2–8° |
| **soldier/run** | **89–107°** | 2–14° | 3–16° |
| athlete/idle | 7–79° | 0–82° | 4–86° |
| athlete/walk | 1–5° | 1–6° | 2–8° |
| wraith/idle | 3–84° | 2–81° | 3–85° |
| wraith/walk | 5–11° | 1–6° | 2–8° |
| juggernaut/idle | 6–77° | 2–82° | 3–86° |
| viper/idle | 6–83° | 1–82° | 3–86° |

`pose.js:164` gives **Spine02 the largest single share (0.30)** — and Spine02 is exactly the bone whose axis is worst. On **soldier, the default player skin, the axis is never better than 87° off in any clip**: the "aim bend" is a pure lateral bend / roll, not pitch. On the other four skins it degrades to 77–86° during the *idle* clip, which is the state ~50 bots stand in for most of a match.

Per-frame trace, soldier idle (16 samples over 4.03 s), Spine02/Spine01/Spine:
`132/40/31 131/39/32 121/27/20 100/2/9 85/18/31 93/7/17 109/13/5 129/40/38 148/70/74 153/83/88 150/78/81 142/59/58 133/42/36 129/36/29 130/38/29 131/39/30`

It is not a transient. It sweeps continuously through the idle cycle. The bend direction is a moving target.

### 1.2 The sign is inverted, and the head has zero counter-rotation `[MEASURED]`

I replicated `applySpineAim` exactly at max look-up (`pk = +0.9 rad = +51.6°`, i.e. `Spine02.rotation.x += 0.27`, `Spine01.rotation.x += 0.162`) and measured the world result:

| skin/clip | chest world pitch before → after (Δ) | head pitch Δ | head LATERAL tilt Δ |
|---|---|---|---|
| soldier/idle | +31.8 → +36.8 (**+5.0**) | +12.5 | **−11.4** |
| soldier/walk | +14.9 → +25.8 (**+10.9**) | −7.9 | **−5.3** |
| athlete/walk | +7.9 → +32.6 (**+24.7**) | **−24.7** | −0.4 |
| wraith/walk | +1.8 → +26.4 (**+24.6**) | **−24.7** | −1.9 |
| juggernaut/walk | +7.9 → +32.5 (**+24.7**) | **−24.7** | 0.0 |
| viper/walk | +10.2 → +34.8 (**+24.6**) | **−24.7** | −1.5 |

(Positive chest pitch = leaning FORWARD. Head-pitch deltas are exact; the absolute head values carry a ~+25° baseline offset because I used Head-local +Z rather than the derived `headfront` axis — the deltas are what matter.)

Read that table: **the player looks UP 51.6° and the character folds FORWARD 24.7°, and the head pitches DOWN a further 24.7° on top.** Total gaze error on juggernaut/walk ≈ **107°**. That is the "broken back". Positive rotation about model-left takes +Y toward +Z (forward) = flexion; the code feeds `+pitch` into it, so aim-up produces flexion when it should produce a small extension. On soldier the sign question is moot — the axis is 91–97° off, so the character gets an **11.4° lateral head flop** instead.

### 1.3 The comment at `pose.js:155-162` is factually false `[MEASURED]`

> "the locomotion clips do not key the spine chain at all, so nothing ever restored it"

Every clip keys **all 24 nodes with translation + rotation + scale** — 72 channels each. Verified on `soldier.glb` (Idle), `_walk` (Casual_Walk), `_run` (Standard_Forward_Charge), `_crouch`, `_idlearmed` (Alert), `_jump`. `Spine02`, `Spine01`, `Spine`, `neck`, `Head`, `LeftShoulder`, `RightShoulder` are all keyed in all six.

The real cause of the 68.6-rad runaway is `AnimationMixer.apply()`'s dirty check: it only calls `binding.setValue` when the two accumulators differ (`PropertyMixer.js`, r172 `[PRIMARY]`). A **frozen** clip never changes, so the mixer never writes, so `+=` compounded. This codebase freezes clips deliberately in three places — `player.js:1186` (`far` LOD, `timeScale = 0`), `player.js:1204` (crouch standing still, `timeScale: 0`), `player.js:1196` (freefall, `timeScale: 0.05`). **Fixing the wrong cause means the same bug returns the moment any new frozen-clip state is added.**

### 1.4 The "absolute" fix silently deletes the clip's own spine animation `[MEASURED]`

`applySpineAim` caches `_aimBaseX` once, then every frame assigns `rotation.x = base + off`. The kernel runs mixers at `ffg_kernel_3d.js:385` and updaters at `:386`, so the mixer's fresh value is read and thrown away each frame. Clip `euler.x` peak-to-peak discarded:

| | Spine02 | Spine01 |
|---|---|---|
| soldier/walk | 14.7° | 2.8° |
| **soldier/run** | **350.8°** | 6.3° |
| wraith/run | 18.9° | 6.1° |

Soldier's Spine02 `euler.x` **wraps across ±180°** during the run clip (range `−174.7° … +176.1°`), and its `euler.y` peaks at **68.9°** — 21° from the XYZ gimbal branch at 90°. So `_aimBaseX` is a coin flip between two values 355° apart in the Euler representation, decided by whichever frame the layer first ran on.

### 1.5 Two incompatible weapon-orientation mechanisms with a pop at the boundary

`player.js:1284` overwrites `a.hand.quaternion` from the camera basis every frame — **but only when `_armMode` is `gunReady`/`reload`** (`:1271`). In `lowReady` (the out-of-combat carry that 50 actors spend most of a match in), the gun is oriented by the static per-skin `HAND_AIM_ROT` table (`player.js:112-118`) instead. Crossing the combat boundary swaps mechanism, and `HAND_AIM_ROT` is 5 hand-tuned triples that are *dead code* in the combat path.

The overwrite also welds the gun to the camera regardless of where the hand actually is, so the arm chain and the weapon are unrelated: **the left hand never touches the weapon.** `POSES.gunReady[2..3]` (`pose.js:103`) puts it "near" the fore-end via two magic direction triples that know nothing about weapon length — and `WPN_LEN` spans 0.34 m (pistol) to 0.95 m (sniper).

**Good news, verified:** removing the weld cannot affect gameplay. `weapons.js:457-464` takes only the muzzle *position* from `a.hand.matrixWorld`; the shot *direction* is `_d` from `aimDir(a)`. Barrel orientation is purely cosmetic.

### 1.6 Smaller defects

- `pose.js:150` clamps `pk` to ±0.9 rad while the camera pitch is clamped to ±1.35 rad (`player.js:699`), and `:151` scales by 0.85. At max look-up the arms tilt 43.8° while the camera aims 77.3° up — a **33.5° shortfall** absorbed entirely by the wrist weld.
- `findArmBones` (`pose.js:15-41`) never caches `LeftShoulder`/`RightShoulder`. The clavicles exist and carry real motion; without them the shoulder visually detaches at high elevation `[SECONDARY]`.
- `pose.js:81-93` `aim()` makes 4 world-matrix queries per bone (`getWorldPosition` ×2, `getWorldQuaternion` ×2, plus the parent's), each walking the whole ancestor chain — ~40 chain walks per character per frame. Measured by the research lens at 0.644 ms/frame for 50 characters vs 0.103 ms for the local-space equivalent.
- `aim()` calls `setFromUnitVectors` unguarded. r172 picks an **arbitrary** perpendicular when `dot < −1 + ε` `[PRIMARY]` — a 180° snap, reachable on a pose switch.
- No torso-vs-feet yaw budget at all: `a._bodyYaw` (`player.js:1161-1166`) lerps at `dt*10`, ≈1800 °/s for a 180° turn — 4.5× Valve's shipped `mp_feetyawrate 400` `[PRIMARY]`.

---

## 2. The target system

**One principle: every correction is composed in the ACTOR frame and conjugated into bone-local. Nothing ever touches `bone.rotation.*`.**

Unreal *requires* Mesh Space additive for aim offsets precisely because local-space additive skews the aim when a parent leans `[PRIMARY]`. three.js r172 cannot do mesh space — `constants.js` defines only `NormalAnimationBlendMode = 2500` and `AdditiveAnimationBlendMode = 2501`, both local `[PRIMARY]`. We get the mesh-space property by hand, for 5 bones, at ~5 quaternion ops per character:

```
L_new = inv(P_world) · D_world · P_world · L_clip
```

`D_world` = `setFromAxisAngle(actorLeftInWorld, θ_joint)`; `P_world` = parent bone's world quaternion; `L_clip` = the bone's local quaternion **as the mixer wrote it this frame**. This is skin-independent by construction, which §1.1 proves is mandatory.

**Clip-base capture — the permanent fix for accumulation.** Per posed bone keep `_clipQ` and `_lastOut`:

```
if (|dot(bone.quaternion, _lastOut)| > 1 - 1e-7)  bone.quaternion.copy(_clipQ);  // mixer skipped → restore
else                                              _clipQ.copy(bone.quaternion);  // mixer wrote → new base
... apply layer ...
_lastOut.copy(bone.quaternion);
```

One quaternion dot per bone. It makes the layer idempotent whether or not the mixer wrote, so `timeScale: 0` is safe forever.

**Chain split — aim ≠ look.** CryEngine's shipped player `chrparams` `[PRIMARY]` puts `Pelvis..Spine3` in `AimIK_Definition` with `Additive="1"` and marks **`Neck` and `Head` `Additive="0" Primary="0"` — excluded from aim.** They move only under `LookIK_Definition`. Dragging the head with aim pitch is the documented cause of the head-thrown-back artifact. We adopt exactly this.

| layer | bones | role | blend |
|---|---|---|---|
| **TRUNK AIM** | `Spine02 → Spine01 → Spine` | small asymmetric sagittal lean | additive over clip, actor frame |
| **GAZE** | `neck → Head` | separate look-at, counter-rotates the trunk | additive over clip, actor frame, deadzoned |
| **ARMS (right)** | `RightArm → RightForeArm` | FK from the actor-local direction table | override (keep `aim()`) |
| **ARMS (left)** | `LeftArm → LeftForeArm → LeftHand` | analytic two-bone IK to the weapon foregrip | override |
| **WRIST/FOREARM** | `RightForeArm` (twist) + `RightHand` (swing) | clamped residual barrel correction | additive, swing-twist split |
| **CLAVICLES** *(phase 4)* | `LeftShoulder`, `RightShoulder` | 1:2 scapulohumeral follow | additive |

**Weapon attachment stays where it is.** Rigid to the right hand — the AAA convention (Epic Hand IK Retargeting: two-bone IK drives the hands, the weapon is socketed to the dominant hand) `[PRIMARY]`. Keep the `a.hand` group under `RightHand` with its `1/worldScale` compensation. Two changes: derive the grip rotation at load instead of the `HAND_AIM_ROT` table, and add a `foregrip` `Object3D` child of `a.hand` positioned data-driven from the weapon bbox (same technique `weapons.js:144-164` already uses for the grip).

**Explicitly NOT adopted, with reasons:**
- **`AnimationUtils.makeClipAdditive` / `AdditiveAnimationBlendMode`.** It is local-space only, it mutates the clip in place, and the kernel shares one `gltf.animations` array across all 50 clones (`ffg_kernel_3d.js:296-307`) so mutation would hit every actor. It also needs authored aim poses Meshy does not ship.
- **`CCDIKSolver`.** Iterative, no pole vector (so elbow direction is undefined — the exact inversion failure mode), indexes into `skeleton.bones` requiring dummy target bones, and its `rotationMin/Max` clamps go through Euler — the same gimbal defect we are removing. Its `limitation` branch rebuilds the quaternion as `(axis·sqrt(1−w²), w)`, which is always ≥0 and therefore **destroys the rotation sign** `[PRIMARY, r172 source]`. Use ~60 lines of closed-form two-bone IK instead.

---

## 3. The numbers table

Paste-ready. Degrees. Sign convention: **positive = flexion** (rotation about actor-LEFT `+X` takes bone `+Y` toward `+Z` = forward). Aim-up therefore produces **negative** trunk angles.

```js
// ── AIM RIG CONSTANTS ───────────────────────────────────────────────────────
// Sources are in the comment on each line. Weights are shares of the TRUNK
// budget, root->tip. NOTE the rig's inverted naming: Spine02 is the LOWEST
// spine joint, Spine is the CHEST (measured from the shipping GLBs).
export const AIM = {
  // --- trunk aim chain, root -> tip ---------------------------------------
  // weights: FinalIK IKSolverAim step=1/N cascade reduced to 1 DOF [PRIMARY+INFERRED]
  trunk: [
    { bone: "Spine02", w: 0.333, maxPitch: 15, maxYaw: 20, maxRoll: 10 }, // lumbar
    { bone: "Spine01", w: 0.444, maxPitch: 15, maxYaw: 20, maxRoll: 10 }, // thoracic
    { bone: "Spine",   w: 0.222, maxPitch: 15, maxYaw: 20, maxRoll: 10 }, // chest
  ],
  // chain totals. UP = extension, budget = thoracic 22 + lumbar 31 = 53 deg
  // anatomical ceiling [SECONDARY, anatomystandard in-vivo]; ~40% working
  // range [INFERRED from Unity shipping +/-40 neck vs 63-113 anatomical].
  trunkPitchUpMax:   -20,   // aiming up   (extension)
  trunkPitchDownMax:  45,   // aiming down (flexion; thoracic 26 + lumbar 65 = 91, ~50%)
  trunkYawMax:        60,   // torso vs hips [PRIMARY cs_playeranimstate.cpp m_flMaxBodyYawDegrees=60;
                            //  corroborated: thoracic 47 + lumbar 15.3 = 62.3 anatomical]
  trunkYawForceFeet:  70,   // above this the feet must turn [PRIMARY base_playeranimstate.cpp MAX_TORSO_ANGLE]
  feetYawRateDegS:   400,   // [PRIMARY ConVar mp_feetyawrate default 400]
  // world-space guard: chest pitch from vertical must land in this band
  chestWorldPitchBand: [-20, 50],

  // --- gaze chain (SEPARATE from aim; neck/head excluded from aim per
  //     CryEngine AimIK_Definition Additive="0" Primary="0") [PRIMARY] -------
  gaze: [
    { bone: "neck", w: 0.40, maxPitch: 25, maxYaw: 25, maxRoll: 10 },
    { bone: "Head", w: 0.60, maxPitch: 35, maxYaw: 40, maxRoll: 12 },
  ],
  gazePitchMax:  45,   // AAOS cervical flexion 45 / extension 45 [SECONDARY]
  gazeYawMax:    60,   // AAOS cervical rotation 60/side [SECONDARY]
  gazeSumMax:    60,   // |neck| + |head| ceiling [CHOSEN, under both AAOS totals]
  gazeDeadzone:  20,   // no head motion below this error; head contributes ~0
                       // to gaze shifts under 20 deg [SECONDARY]

  // --- clavicles (phase 4) -------------------------------------------------
  // scapulohumeral rhythm 120 GH : 60 ST = 2:1 [SECONDARY]
  clavicleRatio: 0.5, claviclePhaseStart: 30, clavicleMax: 12, // 11-15 deg [SECONDARY JOSPT]

  // --- arm joint clamps (AAOS normals) [SECONDARY goniometer.io/AAOS] ------
  shoulder: { flexion: 180, extension: 60, abduction: 180, intRot: 70, extRot: 90 },
  elbow:    { flexionMin: 16, flexionMax: 150 },  // interior angle 30..164 deg
  forearm:  { pronation: 80, supination: 80 },    // MUST live on *ForeArm (no twist bones)
  wrist:    { flexion: 80, extension: 70, radialDev: 20, ulnarDev: 30 },
  wristResidualMax: 25,   // cap on the barrel-error correction at the hand [CHOSEN]

  // --- two-bone IK (ozz IKTwoBoneJob defaults) [PRIMARY] -------------------
  ik: { reachClamp: 0.99, soften: 0.97, weight: 1.0, twistAngle: 0,
        acosClamp: [-1, 1], denomEps: 1e-4, poleGuardDot: 0.95 },

  // --- rate limits ---------------------------------------------------------
  maxBoneDeltaDegPerFrame60: 25,   // = 1500 deg/s; human max voluntary head
                                   // velocity 780-1433 deg/s [SECONDARY]
  layerFadeS: 0.08,                // hit-reaction-class blend-in [SECONDARY]
};
```

**Derived, per-skin, at load — never constants:**

| value | how | why |
|---|---|---|
| `armChainLen` | `\|LeftForeArm.position\| + \|LeftHand.position\|` | varies 0.478–0.644 m across skins `[MEASURED]` |
| `faceAxisLocal` | `headfront.position.normalize()` | varies 24–53° across skins `[MEASURED]`; present on all 5 |
| `gripRot` | at spawn, solve for the `a.hand` rotation that puts the weapon's `+Z` on the actor's `+Z` with `+Y` up | replaces the 5 `HAND_AIM_ROT` triples |
| `foregrip.z` | `0.55 × (weaponBBox.max.z − 0)` in `a.hand` space, only when `WPN_LEN[id] > 0.4` | same vertex-cluster technique as `weapons.js:144-164`; pistols get no foregrip |

**Elbow-bend floor, verified against these bones `[MEASURED + INFERRED]`:** law of cosines at `reachClamp = 0.99` gives interior angle 163.8° on soldier (0.2766/0.2813) and 163.6° on wraith (0.2660/0.2121). Bone asymmetry moves it <0.3°. So **assert ≥16° of elbow bend on every skin.** At `soften = 0.97` the floor is 28.1°.

**Two disagreements I did not resolve — stated, not papered over:**
1. **Cervical ROM.** AAOS says flexion/extension 45° each and rotation 60°/side; in-vivo biomechanics says 64/63 and 85°/side — a ~40% gap. I used the narrower AAOS values, because a clamp should be a value you are confident is reachable.
2. **Lumbar axial rotation.** Classical clinical says ~15.3° total; an in-vivo 6-DOF study says ~45°. A 3× gap with no reconcilable measurement convention. I used the conservative figure inside `trunkYawMax = 60`, which is anchored on Valve's shipped 60 anyway.

Unity's default *spine* muscle limits are **not available** — they live behind `HumanTrait.GetMuscleDefaultMin/Max` in native code and are published nowhere. Only the neck/head ±40 is documented. If anyone quotes a Unity spine table, ask where it came from.

---

## 4. Implementation steps

Each step is independently verifiable and independently revertable.

### Phase 1 — kill the Euler spine layer *(this is the fix for "broken back")*

**1.1** Add `LeftShoulder`/`RightShoulder`/`headfront` to `findArmBones` (`pose.js:19-38`). Add a `poseInit(bones)` that caches, per skin: `faceAxisLocal` from `headfront.position`, `armChainLen` per side, and per-posed-bone `{_clipQ, _lastOut}` scratch quaternions.
*Verify:* log the 5 skins' derived `faceAxisLocal` and confirm they match the table in §0.

**1.2** Add `applyMeshSpaceDelta(bone, axisWorld, angleRad)` implementing `L_new = inv(P_world)·D·P_world·L_clip` plus the clip-base capture from §2. Module-scoped scratch quaternions only — no allocation.
*Verify (node, no renderer):* load `soldier.glb`, play the run clip, call the layer with angle 0 for 600 frames → every posed bone's quaternion must equal the mixer's, `angleTo < 0.01°`. Then set `timeScale = 0` and repeat → same result (this is the regression test for §1.3).

**1.3** Delete `applySpineAim` (`pose.js:137-141`) and its two call sites (`:164-165`). Replace with `applyTrunkAim(obj, bones, pitchRad, yawRad, weight)`:
```
θ_total = pitch > 0 ? clamp(-pitch·k_up,  trunkPitchUpMax, 0)
                    : clamp(-pitch·k_down, 0, trunkPitchDownMax)
per-joint θ_i = θ_total · AIM.trunk[i].w · weight, clamped to ±maxPitch
axisWorld = obj.getWorldQuaternion() applied to (1,0,0)   // once per actor
```
Start with `k_up = 0.25`, `k_down = 0.55` `[CHOSEN]` — at the ±77.3° camera clamp these hit −19.3° / +42.5°, just inside both budgets.
*Verify:* rerun the §1.2 probe with `pitch = +0.9`; chest world pitch must move **negative** (extension) by 15–20°, and the delta must be within 2° across all 5 skins — versus the +24.7 / +5.0 / +10.9 spread measured today.

**1.4** Add `applyGaze(obj, bones, aimPitch, aimYaw, weight)`: measure the head's world facing via `faceAxisLocal`, compute the error against the aim vector, apply the deadzone, split 0.40/0.60 across `neck`/`Head`, clamp per-bone and by the sum.
*Verify:* at `pitch = +0.9`, head world pitch must land within 15° of +51.6° on all 5 skins. Today juggernaut lands at roughly −56° — a 107° error.

**1.5** Raise the `pk` clamp (`pose.js:150`) to the full camera range (±1.35 rad) and the tilt coefficient (`:151`) from 0.85 to 1.0. The shoulder clamp becomes the limiter, not an arbitrary scalar. Guard `setFromUnitVectors` in `aim()` (`pose.js:87`): if `dot < −0.999`, skip the frame and let the previous slerp carry.
*Verify:* barrel error before the wrist weld drops from ~33.5° at max up-aim to under 10°.

### Phase 2 — put the left hand on the weapon

**2.1** In `weapons.js` `refreshWeaponMesh` (`:211-219`), add a `foregrip` `Object3D` to `a.hand` at the barrel-axis point derived from the weapon bbox (§3). Skip for `WPN_LEN[id] ≤ 0.4`.
**2.2** Write `solveTwoBone(root, mid, tip, targetWorld, poleWorld, opts)` — closed-form, ozz-shaped: pole from `VectorPlaneProject(elbowWorld − shoulderWorld, targetWorld − shoulderWorld)`, reach clamped to `0.99·chain`, soften from `0.97`, `acos` args clamped to `[-1,1]`, denominator guard `1e-4`, absolute local rotations written (never `+=`).
**2.3** Delete `POSES[*][2]` and `[3]` (the left-arm triples) for `gunReady`, `lowReady`, `reload` only. Run the IK after the right arm's FK pose. Leave `relax`, `skydive`, `hang` on the table — there is no weapon to grip.
*Verify:* `|LeftHand.worldPos − foregrip.worldPos| < 0.02 m` across all 6 weapons × 5 skins × the 25-point aim grid; elbow interior angle stays in [30°, 164°].

### Phase 3 — one weapon-orientation mechanism

**3.1** Replace `HAND_AIM_ROT` (`player.js:112-118`) with a load-time solve. **3.2** Delete the per-frame `a.hand.quaternion` overwrite (`player.js:1284`) and the `_armMode === gunReady || reload` gate — orientation becomes mode-independent, so the lowReady↔gunReady pop disappears. **3.3** Apply the residual barrel error as a **swing-twist split**: twist → `RightForeArm` (pronation, ≤80°), swing → `RightHand` (≤25°). The rig has no twist bones, so putting twist at the wrist is the candy-wrapper bug.
*Verify:* barrel-vs-aim error ≤3° over the aim grid, in **all** modes; no visible pop when `combat` toggles.

### Phase 4 — optional, defer

Clavicle follow; torso-yaw budget + `feetYawRateDegS 400`. **Flag:** turn-in-place needs a turn clip and `MESHY_CLIPS` (`player.js:166`) has none — it would have to be faked from `walk` at low `timeScale`. Do not start this without owner sign-off on the look.

---

## 5. Validation assertions

### Per-frame, dev build (~20 float ops/char; round-robin one actor per frame at 50 actors)

1. `angleTo(bone.quaternion, bone.restQuaternion) ≤` that bone's clamp, every posed bone.
2. Sum of added trunk pitch ≤ 20° up / 45° down; any single trunk joint ≤ 15°.
3. Chest world pitch from vertical inside `[-20°, +50°]`.
4. `|head world pitch − commanded aim pitch| ≤ 15°`, using the derived `faceAxisLocal`. **This is the single highest-value assert** — it is the one that fails today at 107°.
5. No bone quaternion delta > 25° in one 60 fps frame.
6. `abs(|q| − 1) < 1e-6` on every posed bone.
7. **Unconditional in shipping, not dev-only:** `|dot(aimDir, poleVector)| < 0.95` and no `setFromUnitVectors` call with `dot < −0.999`. These *prevent* the flip; the rest only *detect*.

### Headless CI sweep — new file `runtime/3d/royale/pose.selftest.mjs`

There is currently **no 3D selftest** for last-circle; `runtime/sim/royale.selftest.cjs` is pure-CJS sim only and cannot import three. The new file runs under node with the local `three@0.172.0` and `GLTFLoader` (`globalThis.self = globalThis` shim required — verified working this session). Matrix: 5 pitch × 5 yaw × 6 poses × 5 skins × 4 root yaws = 3000 evaluations, sub-second, no renderer.

8. **Idempotence** — applying the layer twice in one frame equals once; max bone delta < 0.01°.
9. **Return-to-rest** — with aim zeroed, every posed bone within 0.5° of the clip value inside 30 frames, **including with `timeScale = 0`** (the §1.3 regression).
10. **Axis correctness** — for each skin and clip, the world axis the trunk layer rotates about is within **2°** of the actor-left axis. *Today soldier measures 87–151°.* This assert alone would have caught the entire bug.
11. **Cross-skin consistency** — for a given aim input, chest world pitch varies < 3° across the 5 skins. *Today it varies 5.0°→24.7°.*
12. **Zero-leak** — at pitch 0 / weight 0, object-space virtual-vertex displacement (`d = 3 cm`, two orthogonal probes per bone, ACL's shipped default) < 0.1 cm on every bone.
13. Elbow interior angle in [30°, 164°]; knee [0°, 135°]; never negative.
14. Grip error `|LeftHand − foregrip| < 0.02 m` when the solver reports reached (≤1.6 cm when soften is active).
15. **Swimming** — `|handInWeaponSpace(t) − handInWeaponSpace(t−1)| < 0.005 m` while not reloading.
16. Chest-vs-hips yaw separation ≤ 62°.
17. No code path reads or writes `bone.rotation.*` on a posed bone — grep assert.

### What the screenshots must show

Third-person, `soldier` (the worst skin) and `juggernaut` (the biggest head error), each at **pitch −60°, 0°, +60°**, in `lowReady` and `gunReady`, standing and mid-run — 24 frames:

- **At +60° up-aim:** the chest is *vertical or leaning slightly back*, never folded forward. **The face points at the sky.** Today the face points at the ground.
- **Head-to-chest relationship reads as one body** — no hinge at the neck, no lateral flop. Soldier specifically must show **zero sideways head tilt**; it measures 11.4° today.
- **Both hands on the weapon** at every pitch, with a visibly bent left elbow (≥16°) and no wrist candy-wrapper.
- **The barrel points where the crosshair points** in both `lowReady` and `gunReady` — and looks the same crossing the combat boundary.
- **At −60° down-aim:** a forward lean over the sights, chest ≤50° from vertical, no interpenetration of forearm and thigh.
- **Side-by-side before/after at +60°** is the acceptance shot. The failure is only fully legible in profile.

---

## 6. What to leave alone

These are already right. Do not touch them.

- **`aim()`'s actor-local target directions** (`pose.js:81-93`, `POSES` at `:98-120`). Steering arms toward an *actor-frame* direction is skin-independent by construction — which is exactly what the spine layer failed to do. Keep the mechanism; optimise the 4 world queries per bone down to one parent-world fetch, and keep the direction table for `relax`/`skydive`/`hang`/`reload` and the right arm.
- **The 0.92 / 0.88 slerp blends** (`pose.js:166,169`). A one-frame exponential smoother that suppresses pop. Do not raise to 1.0.
- **The weapon-holder architecture** (`player.js:364-388`): a `Group` under the `RightHand` bone with `1/worldScale` compensation. Hand-as-parent for the dominant hand is the AAA convention `[PRIMARY]`, and the world-scale compensation is genuinely necessary (Meshy bone scale ~0.065 vs Quaternius ~5.5).
- **The data-driven grip anchor** (`weapons.js:144-164`) — vertex-cluster the bottom third and subtract. This is the *right* pattern, and the foregrip should copy it rather than invent per-weapon constants.
- **`stripRootMotion`** (`player.js:141-164`). Correct, generator-level, well-reasoned.
- **The mode-selection ladder** (`player.js:1233-1242`) and the `_armW` fade (`:1247-1248`). Sound state machine; the `lowReady` state in particular is a genuinely good call for 50 actors.
- **`measureLean` / `uprightTorso`** (`pose.js:46-73`). `uprightTorso` already works in the actor frame via `aim()`, which is the pattern the new layer adopts. Note it targets `bones.spine` — the **chest** on this inverted-naming rig — which is the correct joint for a straighten. It must run **before** the trunk aim layer (as it does at `player.js:1246`), and its output must become the trunk layer's `_clipQ` base.
- **Gameplay aim** (`weapons.js:454-464`). Shot direction is `aimDir`, independent of the visual barrel. Leave it that way — it is what lets us delete the per-frame quaternion weld without any gameplay risk.
- **The `far` LOD** (`player.js:1186`) and the `!far && !a.emoting` guard around the whole pose block. Correct, and the clip-base capture makes the frozen-mixer case safe rather than requiring the guard to be defensive.

---

**Cost:** the replacement is not more expensive than what is there now. Trunk + gaze is 5 quaternion conjugations per character (~500 quaternion ops/frame at 50 actors, well under 0.1 ms); one analytic two-bone IK per character is ~2 `acos` + 4 quaternion multiplies. Fixing `aim()`'s world-query storm frees more than the new layer costs. The only genuinely expensive options — `CCDIKSolver` per-frame, and per-bone mesh-space additive across a full skeleton — are both explicitly rejected above.