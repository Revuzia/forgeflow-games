"""
NIM — a pure-python port of the hero.js pose writers (runtime/player/hero.js,
`_writePose` and every `_pose*` under it, `_applyRoot`, `_applyFootPlant`), so
the SAME numbers that drive the procedural rig in the game author the GLB's
clips. No bpy here: build_clips.py turns a Frame into bone quaternions.

Conventions (hero.js header): a limb's own axis runs down -Y, a POSITIVE
rotation about X swings its tip toward -Z (forward), the character's right is
+X, yaw 0 faces -Z. Every bone rotation is an Euler XYZ in that frame.

    sampler = PoseSampler()
    for clip in CLIPS: frames = sampler.clip_frames(clip)   # list of Frame
"""
import math

TAU = math.pi * 2
TUNE = dict(speedWalk=3.2, speedRun=9.0, jumpV=[11.4, 13.3, 15.6], gravRise=34.0, gravFall=46.0,
            backflip_vy=14.8, sideflip_vy=14.3, pound_hang=0.20, landLag=0.05, hardLandLag=0.20,
            slope_maxSpeed=16.0)
STRIDE_RUN = 1.90; STRIDE_WALK = 1.10
RIG_PIVOT_Y = 0.62
SQUASH_LAND = 0.85; STRETCH_JUMP = 1.12; SQUASH_LAMBDA = 13.0
POUND_SPIN_HZ = 2.4
IDLE_LOOK_AFTER = 4.0; LOOK_YAW_MAX = 0.58
P = dict(hipY=0.66, hipDrop=0.04, upperLeg=0.245, lowerLeg=0.215, ankleY=0.160, legX=0.112)
SOLE_TOE_Z = 0.186; SOLE_HEEL_Z = 0.086

BONE_NAMES = ['hips', 'spine', 'chest', 'neck', 'head',
              'shoulderR', 'upperArmR', 'lowerArmR', 'handR',
              'shoulderL', 'upperArmL', 'lowerArmL', 'handL',
              'upperLegR', 'lowerLegR', 'footR', 'upperLegL', 'lowerLegL', 'footL']
REST = {n: [0.0, 0.0, 0.0] for n in BONE_NAMES}
REST.update({
    'upperArmR': [0.06, 0, 0.165], 'upperArmL': [0.06, 0, -0.165],
    'lowerArmR': [0.32, 0, 0.06], 'lowerArmL': [0.32, 0, -0.06],
    'handR': [0.10, 0, 0.05], 'handL': [0.10, 0, -0.05],
    'upperLegR': [0, 0, 0.035], 'upperLegL': [0, 0, -0.035],
    'lowerLegR': [-0.06, 0, 0], 'lowerLegL': [-0.06, 0, 0],
    'spine': [-0.03, 0, 0], 'chest': [0.04, 0, 0],
})


def clamp(x, a, b): return a if x < a else (b if x > b else x)
def clamp01(x): return clamp(x, 0.0, 1.0)
def lerp(a, b, t): return a + (b - a) * t


def smoothstep(e0, e1, x):
    t = clamp01((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)


def damp(a, b, lam, dt): return lerp(a, b, 1 - math.exp(-lam * dt))


class Bone:
    __slots__ = ('tx', 'ty', 'tz', 'cx', 'cy', 'cz', 'rx', 'ry', 'rz')

    def __init__(self, rest):
        self.rx, self.ry, self.rz = rest
        self.reset()

    def reset(self):
        self.tx, self.ty, self.tz = self.rx, self.ry, self.rz
        self.cx = self.cy = self.cz = 0.0

    def euler(self):
        return [self.tx + self.cx, self.ty + self.cy, self.tz + self.cz]


class Frame:
    """One sampled pose: bone Euler XYZ (rest + pose + cyclic) and the rig channels."""

    def __init__(self):
        self.bones = {}
        self.rig_rot = [0.0, 0.0, 0.0]      # Euler XYZ applied to the `rig` bone
        self.rig_pos = [0.0, 0.0, 0.0]
        self.rig_scale = [1.0, 1.0, 1.0]
        self.extra = {}                     # eyes/pupils etc.


class PoseSampler:
    def __init__(self):
        self.B = {n: Bone(REST[n]) for n in BONE_NAMES}
        self._legs = [dict(side=1, ul='upperLegR', ll='lowerLegR', ft='footR'),
                      dict(side=-1, ul='upperLegL', ll='lowerLegL', ft='footL')]
        self._arms = [dict(side=1, ua='upperArmR', la='lowerArmR', hd='handR'),
                      dict(side=-1, ua='upperArmL', la='lowerArmL', hd='handL')]

    # ------------------------------------------------------------------ state
    def _reset(self, ctx):
        for b in self.B.values():
            b.reset()
        self.rootPitch = self.rootRoll = self.rootYaw = self.rootY = self.rootZ = 0.0
        self.flipPitch = self.flipYaw = self.flipRoll = 0.0
        self.cycY = self.cycRoll = self.cycPitch = 0.0
        self.cycW = 0.0
        self.lean = ctx.get('lean', 0.0)
        self.speed = ctx.get('speed', 0.0)
        self.speedN = clamp01(self.speed / TUNE['speedRun'])
        self.grounded = ctx.get('grounded', True)
        self.phase = ctx.get('phase', 0.0)
        self.breathe = ctx.get('breathe', 0.0)
        self.idleT = ctx.get('idleT', 0.0)
        self.climbPh = ctx.get('climbPh', 0.0)
        self.wallPh = ctx.get('wallPh', 0.0)
        self.lookYaw = 0.0
        self.animT = ctx.get('t', 0.0)
        self.vy = ctx.get('vy', 0.0)
        self.horiz = ctx.get('horiz', self.speed)
        self.flipDir = ctx.get('flipDir', 1)
        self.wallSide = ctx.get('wallSide', 1)

    # ---------------------------------------------------------------- sample
    def sample(self, state, ctx):
        self._reset(ctx)
        B = self.B
        t = self.animT
        sn = self.speedN
        w = {
            'run': lambda: self._poseLocomotion(False), 'walk': lambda: self._poseLocomotion(False),
            'crouchwalk': lambda: self._poseLocomotion(True),
            'idle': lambda: self._poseIdle(),
            'skid': lambda: self._poseSkid(False), 'pivot': lambda: self._poseSkid(True),
            'bonk': lambda: self._poseBonk(t), 'crouch': lambda: self._poseCrouch(0.85),
            'jump1': lambda: self._poseJump(1, t), 'jump2': lambda: self._poseJump(2, t), 'jump3': lambda: self._poseJump(3, t),
            'longjump': lambda: self._poseLongJump(t), 'backflip': lambda: self._poseBackflip(t),
            'sideflip': lambda: self._poseSideflip(t), 'fall': lambda: self._poseFall(self.vy),
            'fly': lambda: self._poseFly(t), 'dive': lambda: self._poseDive(t), 'slide': lambda: self._poseSlide(t),
            'slideRecover': lambda: self._poseSlideRecover(t), 'wallslide': lambda: self._poseWallslide(),
            'wallkick': lambda: self._poseWallkick(t), 'poundHang': lambda: self._posePoundHang(t),
            'poundFall': lambda: self._posePoundFall(t), 'poundLand': lambda: self._posePoundLand(t),
            'land': lambda: self._poseLand(t, False), 'hardLand': lambda: self._poseLand(t, True),
            'slopeSlide': lambda: self._poseSlopeSlide(self.horiz),
            'swimIdle': lambda: self._poseSwim(False, True), 'swim': lambda: self._poseSwim(False, False),
            'swimDive': lambda: self._poseSwim(True, False), 'climb': lambda: self._poseClimb(),
            'climbKick': lambda: self._poseClimbKick(t), 'cannon': lambda: self._poseCannon(t),
            'dead': lambda: self._poseDead(t),
        }[state]
        w()
        # ---- universal layers (hero.js _writePose tail)
        self.rootRoll += -self.lean * 0.38
        B['chest'].tz += -self.lean * 0.16
        B['head'].tz += -self.lean * 0.10
        B['head'].ty += self.lean * 0.22
        if self.grounded and state not in ('crouch', 'slide', 'dive', 'skid', 'pivot', 'bonk', 'slopeSlide'):
            self.rootPitch -= sn * 0.24
            self.rootY += -sn * 0.020
        return self._frame(ctx)

    def _frame(self, ctx):
        f = Frame()
        cw = self.cycW
        for n, b in self.B.items():
            f.bones[n] = [b.tx + b.cx * cw, b.ty + b.cy * cw, b.tz + b.cz * cw]
        sy = ctx.get('squash', 1.0)
        sxz = 1 / math.sqrt(max(0.2, sy))
        rot = [self.rootPitch - self.flipPitch + self.cycPitch * cw,
               self.rootYaw + self.flipYaw,
               self.rootRoll + self.flipRoll + self.cycRoll * cw]
        f.rig_rot = rot
        f.rig_scale = [sxz, sy, sxz]
        # pivot: T = S.p - R.S.p   (hero.js _applyRoot)
        v = euler_apply(rot, [0.0, RIG_PIVOT_Y * sy, 0.0])
        f.rig_pos = [-v[0], RIG_PIVOT_Y * sy - v[1] + self.rootY + self.cycY * cw, -v[2] + self.rootZ]
        f.extra['lookYaw'] = self.lookYaw
        f.extra['grounded'] = self.grounded
        f.extra['rootPitch'] = self.rootPitch
        f.extra['lean'] = self.lean
        return f

    # ------------------------------------------------------------ writers
    def _poseLocomotion(self, crouched):
        B = self.B
        ph = self.phase; sn = self.speedN
        walkMix = clamp01((self.speed - 0.3) / (TUNE['speedWalk'] - 0.2))
        amp = lerp(0.16, 0.80, sn) * walkMix
        armAmp = lerp(0.20, 0.92, sn) * walkMix
        s = math.sin(ph); c = math.cos(ph)
        if self.speed < 0.18:
            self._poseIdle(); return
        self.cycW = 1.0
        B['upperLegR'].cx = s * amp; B['upperLegL'].cx = -s * amp
        B['lowerLegR'].tx = -0.10; B['lowerLegL'].tx = -0.10
        B['lowerLegR'].cx = -clamp01(-math.sin(ph + 0.95)) * (0.55 + sn * 0.85)
        B['lowerLegL'].cx = -clamp01(-math.sin(ph + 0.95 + math.pi)) * (0.55 + sn * 0.85)
        B['footR'].tx = 0.14; B['footL'].tx = 0.14
        B['footR'].cx = -s * 0.22 * amp; B['footL'].cx = s * 0.22 * amp
        B['upperArmR'].cx = -s * armAmp; B['upperArmL'].cx = s * armAmp
        B['upperArmR'].tz = 0.165 + sn * 0.10; B['upperArmL'].tz = -0.165 - sn * 0.10
        B['lowerArmR'].tx = 0.34; B['lowerArmL'].tx = 0.34
        B['lowerArmR'].cx = clamp01(-s) * (0.30 + sn * 0.55)
        B['lowerArmL'].cx = clamp01(s) * (0.30 + sn * 0.55)
        B['hips'].cy = s * (0.06 + sn * 0.07); B['hips'].cz = c * 0.045 * sn
        B['chest'].cy = -s * (0.07 + sn * 0.10); B['head'].cy = s * 0.05
        B['spine'].tx = -0.035 - sn * 0.165; B['chest'].tx = -0.045 - sn * 0.215
        B['neck'].tx = 0.050 + sn * 0.210; B['head'].tx = 0.045 + sn * 0.180
        self.cycY = math.sin(ph * 2) * (0.010 + sn * 0.034)
        self.cycRoll = math.sin(ph) * 0.050 * sn
        self.cycPitch = 0.0
        self.rootY += -sn * 0.012
        if crouched:
            self._poseCrouchOverlay(0.55); self.rootY -= 0.14

    def _poseIdle(self):
        B = self.B
        br = math.sin(self.breathe * 1.5); sway = math.sin(self.breathe * 0.45)
        B['chest'].tx = 0.04 + br * 0.035; B['spine'].tx = -0.03 - br * 0.020
        B['upperArmR'].tx = 0.06 + br * 0.045; B['upperArmL'].tx = 0.06 + br * 0.045
        B['upperArmR'].tz = 0.165 + br * 0.030; B['upperArmL'].tz = -0.165 - br * 0.030
        B['hips'].tz = sway * 0.035; B['hips'].ty = sway * 0.045
        B['head'].tz = -sway * 0.030
        self.rootY += br * 0.010
        if self.idleT > IDLE_LOOK_AFTER:
            lt = (self.idleT - IDLE_LOOK_AFTER) % 6.0
            w = smoothstep(0, 0.6, lt) * (1 - smoothstep(4.4, 5.4, lt))
            d = math.sin(lt * 1.05)
            B['head'].ty += d * LOOK_YAW_MAX * w
            B['head'].tx += (0.10 - abs(d) * 0.16) * w
            B['chest'].ty += d * 0.16 * w
            self.lookYaw = d * w

    def _poseBonk(self, t):
        B = self.B
        recoil = 1 - clamp01(t / 0.18); sc = math.sin(t * 7.0)
        self.rootPitch = -0.24 + recoil * 0.38
        self.rootY -= 0.05 + recoil * 0.06
        B['upperArmR'].tx = -1.42 - recoil * 0.25; B['upperArmL'].tx = -1.42 - recoil * 0.25
        B['upperArmR'].tz = 0.46; B['upperArmL'].tz = -0.46
        B['lowerArmR'].tx = 0.30; B['lowerArmL'].tx = 0.30
        B['upperLegR'].tx = 0.10 + sc * 0.26; B['upperLegL'].tx = 0.10 - sc * 0.26
        B['lowerLegR'].tx = -0.30 - clamp01(sc) * 0.34; B['lowerLegL'].tx = -0.30 - clamp01(-sc) * 0.34
        B['footR'].tx = 0.24 - sc * 0.14; B['footL'].tx = 0.24 + sc * 0.14
        B['hips'].ty = sc * 0.05; B['spine'].tx = 0.16
        B['chest'].tx = 0.10 + recoil * 0.18; B['head'].tx = 0.26 + recoil * 0.10

    def _poseSkid(self, isPivot):
        B = self.B; k = 1.0 if isPivot else 0.75
        self.rootPitch = 0.34 * k; self.rootY -= 0.10 * k
        B['upperLegR'].tx = 0.44 * k; B['upperLegL'].tx = -0.30 * k
        B['lowerLegR'].tx = -0.42 * k; B['lowerLegL'].tx = -0.20 * k
        B['footR'].tx = 0.42 * k; B['footL'].tx = 0.10
        B['upperArmR'].tx = -0.75 * k; B['upperArmL'].tx = -0.55 * k
        B['upperArmR'].tz = 0.62 * k; B['upperArmL'].tz = -0.70 * k
        B['lowerArmR'].tx = 0.55; B['lowerArmL'].tx = 0.70
        B['chest'].tx = -0.16 * k; B['head'].tx = -0.22 * k
        if isPivot:
            B['hips'].ty = self.lean * 0.35; B['chest'].ty = -self.lean * 0.40

    def _poseCrouch(self, k):
        self._poseCrouchOverlay(k); self.rootY -= 0.30 * k

    def _poseCrouchOverlay(self, k):
        B = self.B
        B['upperLegR'].tx = 0.92 * k; B['upperLegL'].tx = 0.92 * k
        B['upperLegR'].tz = 0.22 * k; B['upperLegL'].tz = -0.22 * k
        B['lowerLegR'].tx = -1.55 * k; B['lowerLegL'].tx = -1.55 * k
        B['footR'].tx = 0.62 * k; B['footL'].tx = 0.62 * k
        B['spine'].tx = 0.30 * k; B['chest'].tx = 0.22 * k; B['head'].tx = -0.34 * k
        B['upperArmR'].tx = 0.55 * k; B['upperArmL'].tx = 0.55 * k
        B['upperArmR'].tz = 0.34 * k; B['upperArmL'].tz = -0.34 * k
        B['lowerArmR'].tx = 1.05 * k; B['lowerArmL'].tx = 1.05 * k

    def _jumpAirTime(self, n):
        v0 = TUNE['jumpV'][clamp(n - 1, 0, 2)]
        return v0 / TUNE['gravRise'] + v0 / TUNE['gravFall']

    def _poseJump(self, n, t):
        B = self.B; rise = clamp01(t / 0.22)
        if n == 1:
            B['upperLegR'].tx = 0.75 * rise; B['upperLegL'].tx = 0.52 * rise
            B['lowerLegR'].tx = -0.95 * rise; B['lowerLegL'].tx = -0.62 * rise
            B['footR'].tx = 0.35; B['footL'].tx = 0.28
            B['upperArmR'].tx = -0.95 * rise; B['upperArmL'].tx = -0.95 * rise
            B['upperArmR'].tz = 0.42; B['upperArmL'].tz = -0.42
            B['lowerArmR'].tx = 0.62; B['lowerArmL'].tx = 0.62
            B['spine'].tx = -0.14 * rise; B['head'].tx = -0.12 * rise
            self.rootPitch = -0.10
        elif n == 2:
            B['upperLegR'].tx = 1.35 * rise; B['upperLegL'].tx = 0.30 * rise
            B['lowerLegR'].tx = -1.45 * rise; B['lowerLegL'].tx = -0.35 * rise
            B['footR'].tx = 0.50; B['footL'].tx = 0.18
            B['upperArmR'].tx = -2.15 * rise; B['upperArmL'].tx = -2.15 * rise
            B['upperArmR'].tz = 0.26; B['upperArmL'].tz = -0.26
            B['lowerArmR'].tx = 0.32; B['lowerArmL'].tx = 0.32
            B['spine'].tx = -0.20 * rise; B['head'].tx = 0.16 * rise
            self.rootPitch = -0.16; self.rootRoll += 0.10
        else:
            air = max(0.35, self._jumpAirTime(3)); f = clamp01(t / air)
            self.flipPitch = TAU * clamp01(f / 0.94)
            launch = 1 - smoothstep(0, 0.24, f)
            tuck = smoothstep(0.06, 0.34, f) * (1 - smoothstep(0.56, 0.84, f))
            land = smoothstep(0.58, 0.92, f)
            B['upperLegR'].tx = -0.55 * launch + 1.55 * tuck + 0.72 * land
            B['upperLegL'].tx = -0.48 * launch + 1.45 * tuck + 0.42 * land
            B['lowerLegR'].tx = 0.10 * launch - 2.05 * tuck - 0.95 * land
            B['lowerLegL'].tx = 0.10 * launch - 2.05 * tuck - 0.62 * land
            B['footR'].tx = -0.55 * launch + 0.55 * tuck + 0.46 * land
            B['footL'].tx = -0.55 * launch + 0.55 * tuck + 0.46 * land
            B['upperArmR'].tx = 2.60 * launch + 0.85 * tuck - 1.35 * land
            B['upperArmL'].tx = 2.60 * launch + 0.85 * tuck - 1.05 * land
            B['upperArmR'].tz = 0.30 * launch + 0.55 * tuck + 1.42 * land
            B['upperArmL'].tz = -0.30 * launch - 0.55 * tuck - 1.42 * land
            B['lowerArmR'].tx = 0.24 * launch + 1.75 * tuck + 0.78 * land
            B['lowerArmL'].tx = 0.24 * launch + 1.75 * tuck + 0.78 * land
            B['spine'].tx = -0.30 * launch + 0.42 * tuck + 0.30 * land
            B['chest'].tx = -0.16 * launch + 0.30 * tuck + 0.18 * land
            B['head'].tx = 0.34 * launch - 0.30 * tuck - 0.46 * land
            self.rootPitch = -0.34 * launch - 0.30 * land
            self.rootY -= 0.16 * land

    def _poseLongJump(self, t):
        B = self.B; k = smoothstep(0, 0.16, t)
        self.rootPitch = -1.40 * k; self.rootY += 0.32 * k
        B['upperArmR'].tx = 2.95 * k; B['upperArmL'].tx = 2.95 * k
        B['upperArmR'].tz = 0.30 * k; B['upperArmL'].tz = -0.30 * k
        B['lowerArmR'].tx = -0.06 * k; B['lowerArmL'].tx = -0.06 * k
        B['handR'].tx = -0.10 * k; B['handL'].tx = -0.10 * k
        B['shoulderR'].tz = -0.14 * k; B['shoulderL'].tz = 0.14 * k
        B['upperLegR'].tx = -0.12 * k; B['upperLegL'].tx = -0.12 * k
        B['upperLegR'].tz = -0.035 * k; B['upperLegL'].tz = 0.035 * k
        B['lowerLegR'].tx = 0.06 * k; B['lowerLegL'].tx = 0.06 * k
        B['footR'].tx = -0.62 * k; B['footL'].tx = -0.62 * k
        B['spine'].tx = -0.16 * k; B['chest'].tx = -0.14 * k
        B['neck'].tx = 0.32 * k; B['head'].tx = 0.92 * k

    def _poseBackflip(self, t):
        B = self.B
        air = TUNE['backflip_vy'] / TUNE['gravRise'] + TUNE['backflip_vy'] / TUNE['gravFall']
        f = clamp01(t / max(0.35, air))
        self.flipPitch = -TAU * clamp01(f / 0.94)
        launch = 1 - smoothstep(0, 0.24, f)
        tuck = smoothstep(0.06, 0.34, f) * (1 - smoothstep(0.56, 0.84, f))
        land = smoothstep(0.58, 0.92, f)
        B['upperLegR'].tx = -0.42 * launch + 1.65 * tuck + 0.66 * land
        B['upperLegL'].tx = -0.42 * launch + 1.65 * tuck + 0.40 * land
        B['lowerLegR'].tx = 0.12 * launch - 2.15 * tuck - 0.92 * land
        B['lowerLegL'].tx = 0.12 * launch - 2.15 * tuck - 0.60 * land
        B['footR'].tx = -0.50 * launch + 0.60 * tuck + 0.44 * land
        B['footL'].tx = -0.50 * launch + 0.60 * tuck + 0.44 * land
        B['upperArmR'].tx = -2.45 * launch + 1.10 * tuck - 1.25 * land
        B['upperArmL'].tx = -2.45 * launch + 1.10 * tuck - 0.95 * land
        B['upperArmR'].tz = 0.22 * launch + 0.42 * tuck + 1.48 * land
        B['upperArmL'].tz = -0.22 * launch - 0.42 * tuck - 1.48 * land
        B['lowerArmR'].tx = 0.30 * launch + 2.05 * tuck + 0.72 * land
        B['lowerArmL'].tx = 0.30 * launch + 2.05 * tuck + 0.72 * land
        B['spine'].tx = -0.34 * launch + 0.36 * tuck + 0.26 * land
        B['chest'].tx = -0.18 * launch + 0.14 * tuck + 0.16 * land
        B['head'].tx = -0.38 * launch - 0.42 * tuck - 0.42 * land
        self.rootPitch = 0.30 * launch - 0.26 * land
        self.rootY -= 0.14 * land

    def _poseSideflip(self, t):
        B = self.B
        air = TUNE['sideflip_vy'] / TUNE['gravRise'] + TUNE['sideflip_vy'] / TUNE['gravFall']
        f = clamp01(t / max(0.35, air)); d = self.flipDir
        self.flipRoll = d * TAU * smoothstep(0.02, 0.90, f)
        tuck = math.sin(math.pi * clamp01(f * 1.10))
        B['upperLegR'].tx = 0.95 * tuck; B['upperLegL'].tx = 1.35 * tuck
        B['upperLegR'].tz = 0.45 * tuck; B['upperLegL'].tz = -0.20 * tuck
        B['lowerLegR'].tx = -1.35 * tuck; B['lowerLegL'].tx = -1.75 * tuck
        B['upperArmR'].tx = -1.10 * tuck; B['upperArmL'].tx = -1.10 * tuck
        B['upperArmR'].tz = 1.35 * tuck; B['upperArmL'].tz = -1.35 * tuck
        B['lowerArmR'].tx = 0.45; B['lowerArmL'].tx = 0.45
        B['chest'].tz = d * 0.30 * tuck; B['head'].tz = -d * 0.28 * tuck

    def _poseFall(self, vy):
        B = self.B; f = clamp01(-vy / 22)
        B['upperArmR'].tx = -1.15 - f * 0.55; B['upperArmL'].tx = -1.15 - f * 0.55
        B['upperArmR'].tz = 0.60 + f * 0.35; B['upperArmL'].tz = -0.60 - f * 0.35
        B['lowerArmR'].tx = 0.55; B['lowerArmL'].tx = 0.55
        B['upperLegR'].tx = 0.34 - f * 0.30; B['upperLegL'].tx = 0.10 - f * 0.20
        B['lowerLegR'].tx = -0.55 + f * 0.35; B['lowerLegL'].tx = -0.28 + f * 0.20
        B['footR'].tx = 0.25 + f * 0.25; B['footL'].tx = 0.20 + f * 0.25
        B['spine'].tx = -0.10 + f * 0.16; B['head'].tx = -0.16 - f * 0.22
        self.rootPitch = -0.06 + f * 0.22
        self.rootRoll += math.sin(self.breathe * 2.1) * 0.06 * f

    def _poseFly(self, t):
        B = self.B; beat = math.sin(t * 7.0)
        B['upperArmR'].tx = -1.45; B['upperArmL'].tx = -1.45
        B['upperArmR'].tz = 1.15 + beat * 0.16; B['upperArmL'].tz = -1.15 - beat * 0.16
        B['lowerArmR'].tx = 0.18; B['lowerArmL'].tx = 0.18
        B['upperLegR'].tx = -0.28; B['upperLegL'].tx = -0.22
        B['lowerLegR'].tx = -0.30; B['lowerLegL'].tx = -0.24
        B['spine'].tx = -0.16; B['head'].tx = 0.24
        self.rootPitch = -0.42 + beat * 0.05; self.rootY += 0.06 + beat * 0.03

    def _poseDive(self, t):
        B = self.B; k = smoothstep(0, 0.12, t)
        self.rootPitch = -1.86 * k; self.rootY += 0.34 * k; self.rootZ += -0.06 * k
        B['upperArmR'].tx = 2.28 * k; B['upperArmL'].tx = 2.28 * k
        B['upperArmR'].tz = 0.10 * k; B['upperArmL'].tz = -0.10 * k
        B['lowerArmR'].tx = -0.04 * k; B['lowerArmL'].tx = -0.04 * k
        B['handR'].tx = 0.26 * k; B['handL'].tx = 0.26 * k
        B['shoulderR'].tz = -0.24 * k; B['shoulderL'].tz = 0.24 * k
        B['upperLegR'].tx = -0.20 * k; B['upperLegL'].tx = -0.06 * k
        B['upperLegR'].tz = 0.17 * k; B['upperLegL'].tz = -0.17 * k
        B['lowerLegR'].tx = 0.02 * k; B['lowerLegL'].tx = 0.02 * k
        B['footR'].tx = -0.70 * k; B['footL'].tx = -0.55 * k
        B['spine'].tx = 0.30 * k; B['chest'].tx = 0.16 * k
        B['neck'].tx = -0.22 * k; B['head'].tx = -0.26 * k

    def _poseSlide(self, t):
        B = self.B
        self.rootPitch = -1.50; self.rootY += -0.42
        kick = math.sin(t * 12)
        B['upperArmR'].tx = -2.60; B['upperArmL'].tx = -1.95
        B['upperArmR'].tz = 0.22; B['upperArmL'].tz = -0.55
        B['lowerArmR'].tx = 0.10; B['lowerArmL'].tx = 1.05
        B['upperLegR'].tx = -0.18 + kick * 0.16; B['upperLegL'].tx = -0.18 - kick * 0.16
        B['lowerLegR'].tx = -0.50 - kick * 0.30; B['lowerLegL'].tx = -0.50 + kick * 0.30
        B['footR'].tx = -0.40; B['footL'].tx = -0.40
        B['spine'].tx = -0.20; B['head'].tx = 0.62

    def _poseSlideRecover(self, t):
        B = self.B; f = clamp01(t / 0.25)
        self.rootPitch = lerp(-1.50, -0.20, f); self.rootY += lerp(-0.42, -0.05, f)
        B['upperArmR'].tx = lerp(-2.60, -0.30, f); B['upperArmL'].tx = lerp(-1.95, -0.30, f)
        B['upperArmR'].tz = 0.45; B['upperArmL'].tz = -0.45
        B['lowerArmR'].tx = 1.15; B['lowerArmL'].tx = 1.15
        B['upperLegR'].tx = lerp(-0.18, 0.95, f); B['upperLegL'].tx = lerp(-0.18, 0.55, f)
        B['lowerLegR'].tx = lerp(-0.50, -1.30, f); B['lowerLegL'].tx = lerp(-0.50, -0.90, f)
        B['spine'].tx = lerp(-0.20, 0.28, f); B['head'].tx = lerp(0.62, -0.10, f)

    def _poseWallslide(self):
        B = self.B; side = self.wallSide
        ni = 0 if side > 0 else 1; fi = 1 - ni
        armNear, armFar = self._arms[ni], self._arms[fi]
        legNear, legFar = self._legs[ni], self._legs[fi]
        j = math.sin(self.wallPh); slip = math.sin(self.wallPh * 0.21)
        self.rootRoll += side * 0.44 + j * 0.028
        self.rootYaw += -side * 0.36
        self.rootPitch = -0.10 + j * 0.018
        self.rootY += j * 0.014
        B[armNear['ua']].tx = -0.95 - slip * 0.30
        B[armNear['ua']].tz = side * (1.42 + slip * 0.10)
        B[armNear['la']].tx = 1.15
        B[armNear['hd']].tz = side * 0.55
        B[armFar['ua']].tx = -0.42; B[armFar['ua']].tz = side * 0.34
        B[armFar['la']].tx = 1.38; B[armFar['hd']].tz = side * 0.30
        B[legNear['ul']].tx = 0.62 + j * 0.045; B[legNear['ul']].tz = side * 0.66
        B[legNear['ll']].tx = -0.78; B[legNear['ft']].tx = 0.12; B[legNear['ft']].tz = side * 0.42
        B[legFar['ul']].tx = -0.24; B[legFar['ul']].tz = -side * 0.08
        B[legFar['ll']].tx = -0.12; B[legFar['ft']].tx = 0.34
        B['spine'].tz = side * 0.14; B['chest'].tz = side * 0.30
        B['chest'].ty = -side * 0.24; B['head'].ty = side * 0.48
        B['head'].tx = -0.24 + j * 0.02

    def _poseWallkick(self, t):
        B = self.B; f = clamp01(t / 0.20)
        B['upperArmR'].tx = lerp(-0.6, -2.35, f); B['upperArmL'].tx = lerp(-0.6, -2.35, f)
        B['upperArmR'].tz = lerp(0.9, 0.28, f); B['upperArmL'].tz = lerp(-0.9, -0.28, f)
        B['lowerArmR'].tx = 0.35; B['lowerArmL'].tx = 0.35
        B['upperLegR'].tx = lerp(1.25, -0.25, f); B['upperLegL'].tx = lerp(0.85, 0.30, f)
        B['lowerLegR'].tx = lerp(-1.55, -0.20, f); B['lowerLegL'].tx = lerp(-1.10, -0.45, f)
        B['footR'].tx = 0.30; B['footL'].tx = 0.30
        B['spine'].tx = lerp(0.22, -0.22, f); B['head'].tx = lerp(-0.20, 0.14, f)
        self.rootPitch = lerp(0.20, -0.18, f)

    def _posePoundHang(self, t):
        B = self.B; f = clamp01(t / TUNE['pound_hang'])
        self.flipYaw = TAU * smoothstep(0, 1, f)
        B['upperLegR'].tx = 1.78; B['upperLegL'].tx = 1.66
        B['upperLegR'].tz = 0.24; B['upperLegL'].tz = -0.24
        B['lowerLegR'].tx = -2.30; B['lowerLegL'].tx = -2.30
        B['footR'].tx = 0.62; B['footL'].tx = 0.62
        B['upperArmR'].tx = -2.66; B['upperArmR'].tz = 0.36
        B['lowerArmR'].tx = 0.16; B['handR'].tx = 0.38
        B['upperArmL'].tx = -1.30; B['upperArmL'].tz = -0.66
        B['lowerArmL'].tx = 1.60; B['handL'].tx = 0.30
        B['spine'].tx = 0.34; B['chest'].tx = 0.24; B['head'].tx = -0.30
        self.rootY += 0.16

    def _posePoundFall(self, t):
        B = self.B
        self.flipYaw = TAU * (1 + t * POUND_SPIN_HZ)
        wob = math.sin(t * 26) * 0.030
        B['shoulderR'].tz = -0.34; B['shoulderL'].tz = 0.34
        B['upperArmR'].tx = 1.34 + wob; B['upperArmL'].tx = 1.34 - wob
        B['upperArmR'].tz = -0.18; B['upperArmL'].tz = 0.18
        B['lowerArmR'].tx = 0.02; B['lowerArmL'].tx = 0.02
        B['handR'].tx = 0.46; B['handL'].tx = 0.46
        B['upperLegR'].tx = 0.34; B['upperLegL'].tx = 0.26
        B['upperLegR'].tz = 0.20; B['upperLegL'].tz = -0.20
        B['lowerLegR'].tx = -2.30; B['lowerLegL'].tx = -2.20
        B['footR'].tx = 0.68; B['footL'].tx = 0.68
        B['spine'].tx = 0.34; B['chest'].tx = 0.26
        B['neck'].tx = -0.16; B['head'].tx = -0.44
        self.rootPitch = -0.95; self.rootRoll += wob * 0.8; self.rootY += 0.06

    def _posePoundLand(self, t):
        B = self.B; f = clamp01(t / 0.18); k = 1 - f
        self._poseCrouchOverlay(0.80 + k * 0.25)
        self.rootY -= 0.36 * (0.5 + k * 0.5)
        B['upperArmR'].tx = -0.35 - k * 0.55; B['upperArmL'].tx = -0.35 - k * 0.55
        B['upperArmR'].tz = 0.75 + k * 0.35; B['upperArmL'].tz = -0.75 - k * 0.35
        B['head'].tx = -0.42 * (0.4 + k * 0.6)

    def _poseLand(self, t, hard):
        B = self.B
        dur = TUNE['hardLandLag'] if hard else TUNE['landLag'] + 0.14
        f = clamp01(t / max(0.06, dur)); k = (1 - f) * (1.0 if hard else 0.62)
        self._poseCrouchOverlay(0.35 + k * 0.62)
        self.rootY -= (0.10 + k * 0.24)
        B['upperArmR'].tx = -0.20 - k * 1.10; B['upperArmL'].tx = -0.20 - k * 0.55
        B['upperArmR'].tz = 0.40 + k * 0.45; B['upperArmL'].tz = -0.40 - k * 0.30
        B['lowerArmR'].tx = 0.55 + k * 0.35; B['lowerArmL'].tx = 0.85
        if hard:
            B['chest'].tx = 0.28 * k; B['head'].tx = -0.44 * k

    def _poseSlopeSlide(self, horiz):
        B = self.B; f = clamp01(horiz / TUNE['slope_maxSpeed'])
        self.rootPitch = -0.22 - f * 0.18; self.rootRoll += self.lean * 0.30; self.rootY -= 0.16
        B['upperLegR'].tx = 0.72; B['upperLegL'].tx = 0.42
        B['upperLegR'].tz = 0.28; B['upperLegL'].tz = -0.20
        B['lowerLegR'].tx = -1.05; B['lowerLegL'].tx = -0.70
        B['footR'].tx = 0.42; B['footL'].tx = 0.30
        B['upperArmR'].tx = -0.95; B['upperArmL'].tx = -0.95
        B['upperArmR'].tz = 1.05; B['upperArmL'].tz = -1.05
        B['lowerArmR'].tx = 0.35; B['lowerArmL'].tx = 0.35
        B['spine'].tx = 0.16; B['head'].tx = 0.10

    def _poseSwim(self, submerged, idle):
        B = self.B; t = self.breathe
        if idle:
            s = math.sin(t * 2.4); sc = math.sin(t * 3.6)
            self.rootPitch = -0.22
            B['upperArmR'].tx = -1.42; B['upperArmL'].tx = -1.42
            B['upperArmR'].tz = 1.18 + sc * 0.30; B['upperArmL'].tz = -1.18 - sc * 0.30
            B['upperArmR'].ty = -0.30 - sc * 0.35; B['upperArmL'].ty = 0.30 + sc * 0.35
            B['lowerArmR'].tx = 0.95; B['lowerArmL'].tx = 0.95
            B['handR'].tz = sc * 0.55; B['handL'].tz = -sc * 0.55
            B['upperLegR'].tx = 0.62 + s * 0.30; B['upperLegL'].tx = 0.62 - s * 0.30
            B['upperLegR'].tz = 0.46; B['upperLegL'].tz = -0.46
            B['lowerLegR'].tx = -1.05 - clamp01(s) * 0.30; B['lowerLegL'].tx = -1.05 - clamp01(-s) * 0.30
            B['footR'].tx = 0.25; B['footL'].tx = 0.25
            B['spine'].tx = 0.10; B['chest'].tx = 0.08
            B['head'].tx = 0.30; B['head'].ty = math.sin(t * 0.8) * 0.35
            self.rootY += math.sin(t * 1.6) * 0.035
            return
        if not submerged:
            ph = t * 4.2; s = math.sin(ph); c = -s
            self.rootPitch = -1.18; self.rootRoll += s * 0.52; self.rootY += 0.18
            B['upperArmR'].tx = -1.55 - s * 1.45; B['upperArmL'].tx = -1.55 - c * 1.45
            B['upperArmR'].tz = 0.30 + clamp01(-s) * 0.55; B['upperArmL'].tz = -0.30 - clamp01(-c) * 0.55
            B['lowerArmR'].tx = 0.30 + clamp01(-s) * 1.25 + clamp01(s) * 0.35
            B['lowerArmL'].tx = 0.30 + clamp01(-c) * 1.25 + clamp01(c) * 0.35
            B['upperLegR'].tx = -0.15 + math.sin(ph * 2) * 0.42; B['upperLegL'].tx = -0.15 - math.sin(ph * 2) * 0.42
            B['lowerLegR'].tx = -0.35; B['lowerLegL'].tx = -0.35
            B['footR'].tx = -0.45; B['footL'].tx = -0.45
            B['chest'].ty = s * 0.34
            B['head'].tx = 0.42; B['head'].ty = s * 0.80; B['head'].tz = s * 0.30
            return
        ph = (t * 2.1) % 1
        pull = smoothstep(0, 0.35, ph) * (1 - smoothstep(0.45, 0.75, ph))
        kick = smoothstep(0.25, 0.55, ph) * (1 - smoothstep(0.60, 0.90, ph))
        self.rootPitch = -1.45; self.rootY += 0.20
        B['upperArmR'].tx = -2.45 + pull * 1.90; B['upperArmL'].tx = -2.45 + pull * 1.90
        B['upperArmR'].tz = 0.20 + pull * 0.95; B['upperArmL'].tz = -0.20 - pull * 0.95
        B['lowerArmR'].tx = 0.15 + pull * 0.55; B['lowerArmL'].tx = 0.15 + pull * 0.55
        B['upperLegR'].tx = -0.20 + kick * 1.10; B['upperLegL'].tx = -0.20 + kick * 1.10
        B['upperLegR'].tz = kick * 0.55; B['upperLegL'].tz = -kick * 0.55
        B['lowerLegR'].tx = -0.15 - kick * 1.55; B['lowerLegL'].tx = -0.15 - kick * 1.55
        B['footR'].tx = -0.40; B['footL'].tx = -0.40
        B['spine'].tx = -0.10; B['head'].tx = 0.35

    def _poseClimb(self):
        B = self.B; ph = self.climbPh
        s = math.sin(ph); c = -s
        self.rootPitch = -0.34; self.rootY += s * 0.045
        B['upperArmR'].tx = 2.46 + s * 0.42; B['upperArmL'].tx = 2.46 + c * 0.42
        B['upperArmR'].tz = 0.26; B['upperArmL'].tz = -0.26
        B['lowerArmR'].tx = 0.55 + clamp01(-s) * 0.85; B['lowerArmL'].tx = 0.55 + clamp01(-c) * 0.85
        B['handR'].tx = 0.45; B['handL'].tx = 0.45
        B['upperLegR'].tx = 0.92 + c * 0.42; B['upperLegL'].tx = 0.92 + s * 0.42
        B['upperLegR'].tz = 0.42; B['upperLegL'].tz = -0.42
        B['lowerLegR'].tx = -1.30 - clamp01(c) * 0.40; B['lowerLegL'].tx = -1.30 - clamp01(s) * 0.40
        B['footR'].tx = 0.52; B['footL'].tx = 0.52
        B['spine'].tx = 0.12; B['chest'].ty = s * 0.24; B['hips'].ty = -s * 0.20
        B['head'].tx = -0.26

    def _poseClimbKick(self, t):
        B = self.B; f = clamp01(t / 0.22)
        B['upperArmR'].tx = lerp(2.42, -0.85, f); B['upperArmL'].tx = lerp(2.42, -0.85, f)
        B['upperArmR'].tz = 0.75; B['upperArmL'].tz = -0.75
        B['lowerArmR'].tx = 0.65; B['lowerArmL'].tx = 0.65
        B['upperLegR'].tx = lerp(1.20, -0.30, f); B['upperLegL'].tx = lerp(1.20, -0.30, f)
        B['lowerLegR'].tx = lerp(-1.65, -0.15, f); B['lowerLegL'].tx = lerp(-1.65, -0.15, f)
        B['spine'].tx = lerp(0.28, -0.20, f)
        self.rootPitch = lerp(0.24, -0.16, f)

    def _poseCannon(self, t):
        B = self.B
        self._poseCrouchOverlay(1.10); self.rootY -= 0.30
        B['upperArmR'].tx = 0.95; B['upperArmL'].tx = 0.95
        B['upperArmR'].tz = 0.55; B['upperArmL'].tz = -0.55
        B['lowerArmR'].tx = 1.95; B['lowerArmL'].tx = 1.95
        B['head'].tx = -0.55
        self.rootPitch = 0.22 + math.sin(t * 18) * 0.03

    def _poseDead(self, t):
        B = self.B; f = clamp01(t / 0.45)
        self.rootPitch = -1.45 * f; self.rootRoll += 0.40 * f; self.rootY -= 0.42 * f
        B['upperArmR'].tx = -0.20 * f; B['upperArmL'].tx = -0.10 * f
        B['upperArmR'].tz = 0.95 * f + 0.165; B['upperArmL'].tz = -1.15 * f - 0.165
        B['lowerArmR'].tx = 0.30; B['lowerArmL'].tx = 0.20
        B['upperLegR'].tx = 0.85 * f; B['upperLegL'].tx = 0.45 * f
        B['upperLegR'].tz = 0.35 * f; B['upperLegL'].tz = -0.15 * f
        B['lowerLegR'].tx = -1.35 * f; B['lowerLegL'].tx = -0.75 * f
        B['footR'].tx = -0.20; B['footL'].tx = -0.20
        B['spine'].tx = 0.30 * f; B['chest'].tx = -0.15 * f
        B['head'].tx = 0.55 * f; B['head'].tz = 0.35 * f


# ------------------------------------------------------------ small linear algebra
def rot_x(a):
    c, s = math.cos(a), math.sin(a); return [[1, 0, 0], [0, c, -s], [0, s, c]]


def rot_y(a):
    c, s = math.cos(a), math.sin(a); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]


def rot_z(a):
    c, s = math.cos(a), math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]


def mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def mat_apply(m, v):
    return [sum(m[i][k] * v[k] for k in range(3)) for i in range(3)]


def euler_mat(e):
    """three.js Euler XYZ -> matrix Rx*Ry*Rz."""
    return mat_mul(mat_mul(rot_x(e[0]), rot_y(e[1])), rot_z(e[2]))


def euler_apply(e, v):
    return mat_apply(euler_mat(e), v)


# --------------------------------------------------------------- foot plant IK
_ik = {'hip': 0.0, 'knee': 0.0}


def solve_leg(dy, fz, l1, l2):
    dmin = abs(l1 - l2) + 1e-3; dmax = l1 + l2 - 1e-3
    d = clamp(math.hypot(dy, fz), dmin, dmax)
    base = math.atan2(fz, max(1e-4, dy))
    cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1)
    cosB = clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1)
    _ik['hip'] = base + math.acos(cosA)
    _ik['knee'] = -(math.pi - math.acos(cosB))
    return _ik


def rig_matrix(frame):
    """4x4-ish (R*S, T) of the rig bone: the frame's rig channels as hero.js applies them."""
    R = euler_mat(frame.rig_rot)
    S = frame.rig_scale
    RS = [[R[i][j] * S[j] for j in range(3)] for i in range(3)]
    return RS, frame.rig_pos


def apply_foot_plant(frame, state, speed, phase, iters=4):
    """Steady-state port of hero.js _applyFootPlant + _clampSoles (flat ground)."""
    grounded = frame.extra.get('grounded', True)
    if not grounded or state in ('slide', 'dive', 'dead', 'cannon', 'swim', 'swimIdle', 'swimDive', 'climb'):
        return
    sn = clamp01(speed / TUNE['speedRun'])
    w = clamp01(1 - sn * 0.35) * (1.0 if state in ('idle', 'run', 'walk', 'crouchwalk', 'crouch', 'land', 'bonk') else 0.45)
    if w <= 0.01:
        return
    moving = clamp01((speed - 0.35) / 1.2)
    sp = math.sin(phase)
    hipY = P['hipY'] - P['hipDrop']; l1 = P['upperLeg']; l2 = P['lowerLeg']
    RS, T = rig_matrix(frame)
    m10, m11, m12, m13 = RS[1][0], RS[1][1], RS[1][2], T[1]
    if abs(m11) < 1e-4:
        m11 = 1.0
    soleY = P['ankleY']
    legs = [dict(side=1, ul='upperLegR', ll='lowerLegR', ft='footR', penY=0.0),
            dict(side=-1, ul='upperLegL', ll='lowerLegL', ft='footL', penY=0.0)]
    for _ in range(iters):
        for leg in legs:
            s = leg['side']
            ulr = frame.bones[leg['ul']]; llr = frame.bones[leg['ll']]; ftr = frame.bones[leg['ft']]
            contact = lerp(1, clamp01(-s * sp * 1.6 + 0.25), moving)
            wl = w * contact
            fx = s * P['legX']
            fz = math.sin(ulr[0]) * (l1 + l2) * 0.7
            groundY = 0.0
            targetY = (groundY + leg['penY'] - m10 * fx - m12 * (-fz) - m13) / m11 + soleY
            poseFootY = hipY - l1 * math.cos(ulr[0]) - l2 * math.cos(ulr[0] + llr[0])
            pen = clamp01((targetY - poseFootY) / 0.02)
            wEff = max(wl * (1 - moving), pen)
            if wl <= 0.01 and pen <= 0.01:
                continue
            if wEff <= 0.01:
                continue
            solve_leg(hipY - targetY, fz, l1, l2)
            ulr[0] = lerp(ulr[0], _ik['hip'], wEff)
            llr[0] = lerp(llr[0], _ik['knee'], wEff)
            ftr[0] = lerp(ftr[0], -(ulr[0] + llr[0]), wEff * 0.85)
            ftr[2] = lerp(ftr[2], 0.0, wEff * 0.85)
        # sole clamp: measure the real toe/heel through FK and feed back
        for leg in legs:
            toe, heel, legX = foot_contacts(frame, leg)
            pen = max(-toe[1], -heel[1])
            if pen > 0.002:
                k = clamp01(pen / 0.03)
                ftr = frame.bones[leg['ft']]
                ftr[0] = lerp(ftr[0], -legX, k)
                leg['penY'] = clamp(leg['penY'] + pen, 0, 0.20)


def foot_contacts(frame, leg):
    """World (hero-local) toe and heel points of a boot under the frame's pose."""
    RS, T = rig_matrix(frame)
    s = leg['side']

    def chain(pos, rot_e, M, O):
        # child transform: O' = O + M*pos ; M' = M * R(rot)
        O2 = [O[i] + sum(M[i][k] * pos[k] for k in range(3)) for i in range(3)]
        M2 = mat_mul(M, euler_mat(rot_e))
        return M2, O2
    M, O = RS, list(T)
    M, O = chain([0, P['hipY'], 0], frame.bones['hips'], M, O)
    M, O = chain([s * P['legX'], -P['hipDrop'], 0], frame.bones[leg['ul']], M, O)
    M, O = chain([0, -P['upperLeg'], 0], frame.bones[leg['ll']], M, O)
    M, O = chain([0, -P['lowerLeg'], 0], frame.bones[leg['ft']], M, O)
    toe = [O[i] + sum(M[i][k] * [0, -P['ankleY'], -SOLE_TOE_Z][k] for k in range(3)) for i in range(3)]
    heel = [O[i] + sum(M[i][k] * [0, -P['ankleY'], SOLE_HEEL_Z][k] for k in range(3)) for i in range(3)]
    legX = frame.bones[leg['ul']][0] + frame.bones[leg['ll']][0]
    return toe, heel, legX


# ------------------------------------------------------------------ clip plan
def _air(v0):
    return v0 / TUNE['gravRise'] + v0 / TUNE['gravFall']


def clip_plan():
    """Every §11 state (plus walk + bonk). dur in seconds; 'loop' for cycles;
    the ctx function maps clip time -> sampler context. sheet_t = the frame the
    contact sheet shows (the most readable moment)."""
    run_dur = STRIDE_RUN / TUNE['speedRun']
    walk_dur = STRIDE_WALK / TUNE['speedWalk']
    R = TUNE['speedRun']; W = TUNE['speedWalk']
    plan = [
        ('idle', 10.0, True, lambda t: dict(t=t, breathe=t * 1.15, idleT=t, speed=0.0), 1.0, None, None),
        ('run', run_dur, True, lambda t: dict(t=t, speed=R, phase=(t / run_dur) * TAU, breathe=t * 2.05), 0.25 * run_dur, None, None),
        ('walk', walk_dur, True, lambda t: dict(t=t, speed=W, phase=(t / walk_dur) * TAU, breathe=t * 1.47), 0.25 * walk_dur, None, None),
        ('crouchwalk', walk_dur, True, lambda t: dict(t=t, speed=W, phase=(t / walk_dur) * TAU, breathe=t * 1.47), 0.25 * walk_dur, None, None),
        ('skid', 0.5, False, lambda t: dict(t=t, speed=6.0), 0.3, None, None),
        ('pivot', 0.5, False, lambda t: dict(t=t, speed=6.0, lean=1.0), 0.3, None, None),
        ('bonk', 0.9, False, lambda t: dict(t=t, speed=0.0), 0.45, None, None),
        ('crouch', 0.5, False, lambda t: dict(t=t, speed=0.0), 0.3, None, None),
        ('jump1', _air(11.4), False, lambda t: dict(t=t, grounded=False), 0.45 * _air(11.4), 'stretch', None),
        ('jump2', _air(13.3), False, lambda t: dict(t=t, grounded=False), 0.45 * _air(13.3), 'stretch', None),
        ('jump3', _air(15.6), False, lambda t: dict(t=t, grounded=False), 0.40 * _air(15.6), 'stretch', None),
        ('longjump', _air(8.5), False, lambda t: dict(t=t, grounded=False), 0.5 * _air(8.5), 'stretch', None),
        ('backflip', _air(14.8), False, lambda t: dict(t=t, grounded=False), 0.40 * _air(14.8), 'stretch', None),
        ('sideflip', _air(14.3), False, lambda t: dict(t=t, grounded=False, flipDir=1), 0.40 * _air(14.3), 'stretch', None),
        ('fall', 1.2, False, lambda t: dict(t=t, grounded=False, vy=-22.0 * clamp01(t / 1.0), breathe=t * 1.15), 0.9, None, None),
        ('dive', 0.6, False, lambda t: dict(t=t, grounded=False), 0.4, 'stretch', None),
        ('slide', TAU / 12.0, True, lambda t: dict(t=t, speed=8.0), 0.2, None, None),
        ('slideRecover', 0.25, False, lambda t: dict(t=t, speed=0.0), 0.12, None, None),
        ('wallslide', 1.87, True, lambda t: dict(t=t, grounded=False, wallPh=t * 16.0, wallSide=1), 0.5, None, None),
        ('wallkick', 0.30, False, lambda t: dict(t=t, grounded=False), 0.18, 'stretch', None),
        ('poundHang', TUNE['pound_hang'], False, lambda t: dict(t=t, grounded=False), 0.12, None, None),
        ('poundFall', 0.6, False, lambda t: dict(t=t, grounded=False), 0.3, None, None),
        ('poundLand', 0.30, False, lambda t: dict(t=t, speed=0.0), 0.04, 'squashHard', None),
        ('land', TUNE['landLag'] + 0.14, False, lambda t: dict(t=t, speed=0.0), 0.03, 'squash', None),
        ('hardLand', TUNE['hardLandLag'], False, lambda t: dict(t=t, speed=0.0), 0.04, 'squashHard', None),
        ('slopeSlide', 1.0, False, lambda t: dict(t=t, speed=10.0, horiz=10.0, lean=0.5), 0.5, None, None),
        ('swimIdle', 4.55, True, lambda t: dict(t=t, grounded=False, breathe=t * 1.15), 1.0, None, None),
        ('swim', 0.935, True, lambda t: dict(t=t, grounded=False, speed=4.5, breathe=t * 1.6), 0.25, None, None),
        ('swimDive', 0.2976 * 2, True, lambda t: dict(t=t, grounded=False, speed=4.5, breathe=t * 1.6), 0.15, None, None),
        ('climb', 0.828, True, lambda t: dict(t=t, grounded=False, climbPh=t * 7.59), 0.25, None, None),
        ('climbKick', 0.30, False, lambda t: dict(t=t, grounded=False), 0.12, None, None),
        ('cannon', 0.349, True, lambda t: dict(t=t, speed=0.0), 0.1, None, None),
        ('fly', 0.898, True, lambda t: dict(t=t, grounded=False), 0.3, None, None),
        ('dead', 0.8, False, lambda t: dict(t=t, speed=0.0), 0.7, None, None),
    ]
    out = []
    for i, (name, dur, loop, ctxf, sheet_t, squash, _) in enumerate(plan):
        out.append(dict(index=i, name=name, dur=dur, loop=loop, ctx=ctxf, sheet_t=sheet_t, squash=squash))
    return out


def squash_curve(kind, dur, fps):
    """hero.js _updateSquash + the two-stage spring in _applyRoot, sampled per frame."""
    n = int(round(dur * fps)) + 1
    if kind is None:
        return [1.0] * n
    s = {'squash': SQUASH_LAND, 'squashHard': SQUASH_LAND - 0.06, 'stretch': STRETCH_JUMP}[kind]
    tgt = s; cur = s; out = []
    dt = 1.0 / fps
    for _ in range(n):
        out.append(cur)
        cur = damp(cur, tgt, SQUASH_LAMBDA, dt)
        tgt = damp(tgt, 1.0, SQUASH_LAMBDA * 0.75, dt)
    return out
