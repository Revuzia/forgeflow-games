# SQUISHY_SCIENCE: how squishies work, and how WOBBLEHOARD fakes each kind

Owner request: "gather research data on how squishies work, the different kinds, and how to put this into code".
Code: `src/data/materials.ts` (the table and `resolveMaterial`), `_harness/probe_materials.ts` (checks, `node _harness/probe_materials.ts`).
Read first: `CONTRACT.md`, `src/contracts.ts`, `src/core/genome.ts`, `src/physics/params.ts`, `src/physics/softbody.ts`.

## 0. Evidence status (read this before trusting a number)

* **WebFetch was blocked for every host** (`EGRESS_BLOCKED` from the network egress proxy: wikipedia, arxiv, acm, springer, ncbi,
  uspto, osti, github.io, the toy shops, universities). **No page was opened.** WebSearch worked, and its result summaries are the
  only source of the research facts below.
* Tags: **[S#]** = the claim is what a WebSearch result summary said, and that result list contained the URL listed under S# in
  section 7 (page not opened, so a sentence may belong to a sibling result in the same list). **[GK]** = general knowledge, unverified.
  **[M]** = measured by me in this task: 1-D reductions inside `probe_materials.ts`, or a throw-away 3-D prototype (a scratch copy of
  `softbody.ts` with the section 3 snippets patched in; it is not in the repo, and PHYS kept retuning the solver while I worked, so the
  prototype numbers are for the snapshot of 15:4x, see 3.10).
* No source gave a kPa or damping value for an actual squishy toy. Every family number in section 4 is a **design value** chosen from the
  qualitative research and tuned in the prototype, not a measurement of a product.

## 1. The kinds of squishy and what makes each one feel the way it does

| Kind | Made of | Why it feels like that | Our family |
|---|---|---|---|
| Slow-rise squishy | PU open-cell foam, painted or coated skin [S2][S26] | Cells are open: squeezing pushes air out, it must filter back in through the cell maze and skin [S2]. The polymer is viscoelastic (glass transition near room temperature, 20-30 C), so the skeleton also un-bends lazily [S1]. Recovery >= 3 s is "slow/viscoelastic" foam in the patents (preferably 5-6 s, < 20-30 s); ball rebound < 25 % versus >= 40 % for ordinary PU foam [S1]. Toy reviews say 5-20 s, PU foam 5-10 s [S3]. Compressible: volume is NOT conserved (polymer foams nu ~ 0.1-0.4 [S7]). | slowrise |
| Marshmallow-like foam | aerated gelatin/sugar gel; E ~ 29 kPa for a real marshmallow [S10] | Foam of a gel matrix: very soft, light, compressible, comes back fast | marshmallow |
| Mochi squishy (TPR) / dough-filled | TPR "stretchy, not sticky, quick to snap back" [S4]; DIY: balloon of flour, cornstarch or slime [S4][S13] | Flour/dough fill is a yield-stress paste: "play dough holds dents more than slime" [S13]; Herschel-Bulkley sigma = sigma_y + k gamma_dot^n [S20] | mochidough |
| Taba / silicone-gel squishy | hand-poured liquid silicone gel [S4] | "extra soft, sticky (but in a good way), very slow to rise, like a sleepy marshmallow" [S4]: gel viscoelasticity plus tack | mochidough + tack (no own family) |
| Gel / jelly squishy | TPR or silicone gel, translucent [S14] | Nearly incompressible (rubber nu = 0.5 [S7], silicone 0.48-0.49 [S8]) so a dent makes a bulge, bouncy and wobbly | jellygel |
| Liquid- or bead-filled squeeze toy | thin TPR skin around liquid gel / glycerine water [S13][S27] | "resistance is low at first and rises sharply as the fluid runs out of room, rebound slow because the fluid has to flow back" [S13]; slosh = mass-spring-dashpot per mode (Dodge and Abramson) [S18] | waterfill |
| Stress balls | closed-cell PU foam (gas in sealed cells, quick complete rebound) versus gel/fluid fill [S13] | gas compression versus fluid displacement | marshmallow / waterfill |
| Slime | PVA + borate crosslinks [S15] | "viscoelastic liquid with finite viscosity, observable elasticity and a relaxation time" [S15]; sticky, strings | slimegoo |
| Bouncing putty | PDMS + boron compounds [S5] | Elastic on a short time, viscous on a long time: relaxation ~ 0.1 s, rapid-deformation E ~ 1.7e6 Pa, slow-compression viscosity ~ 8e4 Pa s, restitution 0.73 (light ball, impact 4.4 ms) versus 0.45 (heavy ball, 38 ms) [S5]; Deborah number De = tau/t [S6]. One source calls it shear-thickening (dilatant) [S5]. | putty |
| Sticky stretchy TPR | SEBS/SBS block copolymer + oil + filler [S14] | Soft = low storage modulus: tack appears when G' < ~0.3 MPa at 1 Hz (Dahlquist criterion) [S19]; stretched skin thins and strings | stickystretch |
| Silicone pop / fidget dome | hollow silicone dome | Bistable snap-through: unstable between two stable shapes [S16]; a viscoelastic dome snaps back after a delay of seconds [S16] | popdome |
| Gummy / gelatin gel | gelatin + sugar | "high resiliency and springiness with relatively high firmness"; TPA cohesiveness/elasticity 80-90 %, resilience 0.57-0.89 [S10] | gummy |
| Mesh / bead ball | beads in a balloon or mesh | Granular jamming: liquid-like to rigid as packing fraction rises [S17] | beadsqueeze |
| Firm silicone ball | cast silicone rubber | Low loss (tan delta of rubbers ~ 0.03-0.3 [S11]), high resilience, grippy | firmsilicone |

Vocabulary we use (all [GK] unless tagged). Young's modulus E (stiffness), shear modulus G = E / (2(1+nu)), bulk modulus
K = E / (3(1-2nu)); nu -> 0.5 means incompressible, nu ~ 0 (cork) means no sideways bulge [S7]. Viscoelastic models [S12]: Kelvin-Voigt
(spring || dashpot: creep with retardation time), Maxwell (spring + dashpot: stress relaxation), standard linear solid or Zener (the
simplest that has both). Loss factor tan delta = energy lost / stored per cycle (rubbers 0.03-0.3, "high" 0.1-0.2, up to 1.5-2 at the glass
transition [S11]). Hysteresis = loading and unloading curves differ. Strain-rate dependence: open-cell PU foam is strongly rate dependent,
air pressure through the cells follows Darcy's law and can be ~ 30 % of energy absorption at high rates, negligible quasi-statically [S9].
Plasticity = permanent set beyond a yield. Tack = adhesion on contact, stringing = fibrils that thin and break one by one [S19].

## 2. The feel axes we model, and why they are enough

| Axis | The question a hand asks | Physical origin | Knob(s) in `MaterialParams` |
|---|---|---|---|
| Stiffness | how hard does it push back? | modulus | `smOmega`, `memStiff` |
| Compressibility | does it keep its volume? | Poisson ratio, open-cell air | `volOmega`, `volBleedMax` |
| Recovery time | how long until it is back? | air return, viscoelastic retardation | `airReturnTau`, `memTau`, `memStiff` |
| Plasticity | does it keep a dent? | yield stress, creep | `yieldStrain`, `healTau`, `memStiff` |
| Bounce / damping | does it wobble, does it rebound? | loss factor | `intDamp`, `affDamp` |
| Stretch limit | how far does it pull? | skin extensibility | `edgeAlphaT`, `edgeSoftStrain`, `maxPull` |
| Tack | does it grab my finger, does it string? | low storage modulus | `tack`, `stringiness`, `tableMu` |
| Slosh | does the inside keep moving? | liquid / bead mass | `sloshMass`, `sloshHz`, `sloshZeta` |
| Rate stiffening | does a fast poke feel firmer? | rate-dependent viscosity | `speedDamp` (and air damping for compressible) |
| Snap (optional) | does it pop? | bistability | `snap` |
| Jam (extra) | does it harden as I squeeze? | densification, jamming | `jam` |

Why these are enough: a squishy is a hand-held low-frequency, large-strain, short-contact object. Ten scalars separate every kind in
section 1 (the probe requires 12 families to be pairwise >= 0.10 RMS apart over 23 normalised axes, closest pair 0.131). What we cannot
render is **force**: the fingers are kinematic spheres, so stiffness is never felt as resistance on a touchscreen. Feel has to show up as
(a) how the rest of the body responds and bulges, (b) the recovery curve, (c) sound and haptics, (d) the blush and gloss in section 4.

## 3. The mechanism of each axis in OUR solver (units, scaling, clamping, cost)

Solver facts this relies on (read from `softbody.ts`): small-step XPBD, H = 1/360 s, one pass per substep, order = predict -> global shape
matching -> Laplacian shape memory (`bendK`) -> volume (one multiplier, `alphaT = kappa * S0`, blocked particles have zero inverse mass) ->
edges -> grabs -> finger spheres -> table -> v = dx/H -> damping (`intDamp` local, `affDamp` global, `intDamp2` per m/s).

### 3.0 Conventions and how a family reaches the solver

```ts
const H = 1 / 360;                                       // substep, params.ts
const blend = (omega: number) => { const w = (omega * H) ** 2; return w / (1 + w); };  // = smK. XPBD: alpha~ = alpha/h^2, alpha = 1/(m w^2)
const rate  = (tau: number, h = H) => 1 - Math.exp(-h / tau);                          // exact exponential step: any h, always in (0,1)
// integration (main.ts / collection): families are RATIOS on PHYS's own tuning, so retuning params.ts never breaks them
const neutral = { ...genome, firmness: 0.5, bounce: 0.5, stretch: 0.5 };                // genome bands are applied by resolveMaterial
const mat = resolveMaterial(familyId, genome);
const body = new SoftBody(genome, { params: applyMaterial(deriveParams(neutral), mat), mat: mat.solver });
```

`applyMaterial` multiplies `smOmega, bendK, edgeAlphaT, edgeSoftStrain, volKappa, intDamp, affDamp, intDamp2, tableMu, maxPull, glue,
groundDamp` (and `fingerFriction` once PHYS makes it a param) by `mat.solver.scale.*`; the gel family at a neutral genome is exactly 1.
Absolute raw values would already be wrong: `smOmega` went 13..36 to 26..62 and `edgeAlphaT` 0.05..0.7 to 1..5 while I was writing this.
**Every new feature below is a no-op at its neutral value**, so the current DOLLOP is unchanged [M: the gel at a neutral genome behaves as the plain solver within noise].

### 3.1 Stiffness, viscoelastic recovery, rate response: a Zener (standard linear solid) shape match

Standard linear solid = spring k1 in parallel with a Maxwell arm (spring k2 in series with a dashpot) [S12]. In shape matching: two goal
sets, the true rest shape Q (relaxed arm, stiffness k1) and a lagging **memory shape** MEM (the Maxwell arm: it flows toward the current
shape). Instantaneous stiffness is (1+ms) k1, relaxed stiffness k1, relaxation time tau, recovery (retardation) time tau (1+ms) [S12], with
ms = k2/k1 = `memStiff`. Mueller et al. 2005 [S22] keep a plastic deformation state with yield and creep constants and a cap c_max [GK
for the exact formulas; the source summary only confirmed the yield/creep parameters]; ours is the per-particle version, because a finger
dent is not an affine map.

```ts
// replaces `const K = this.smK` and the goal loop in the shape-matching block (R already extracted: r00..r22, centre cx,cy,cz)
const ms = mat.memStiff, wm = ms / (1 + ms);                      // wm = share of the stiffness that relaxes
let wh2 = (p.smOmega * H) ** 2 * (1 + ms);                        // instantaneous stiffness (1+ms) x relaxed
const c = this.metrics.compression; wh2 *= 1 + 6 * mat.jam * c * c; // jam: densification (3.8)
const K = wh2 / (1 + wh2);                                        // implicit spring: stable for any omega*H
for (let i = 0; i < n; i++) {
  const i3 = i * 3;
  const gx = cx + r00 * Q[i3] + r01 * Q[i3 + 1] + r02 * Q[i3 + 2];       // rest goal (as today); gy, gz likewise
  const mx = cx + r00 * MEM[i3] + r01 * MEM[i3 + 1] + r02 * MEM[i3 + 2]; // memory goal; my, mz likewise
  const tx = gx + wm * (mx - gx) /* ty, tz likewise */;                   // both arms in parallel
  const k = K * soft[i];
  XP[i3] += (tx - XP[i3]) * k; /* y, z likewise */
}
// ms = 0, jam = 0  =>  identical to the current code.
```

Memory update, **once per frame** (every 6th substep, h = 6H; the result is the same for update intervals of 1, 3, 6 and 12 substeps [M]):

```ts
function memoryStep(h: number) {                                  // MEM: Float64Array(3n), starts equal to Q
  const kFlow = rate(mat.memTau, h), kHeal = mat.memHealTau < 59 ? rate(mat.memHealTau, h) : 0;
  const y = mat.memYield * R0, maxD = mat.memMax * R0;            // memMax = 0.6 (Mueller's c_max)
  // c = mass-weighted centroid of X; body-frame position p_i = R^T (X_i - c)
  for (let i = 0; i < n; i++) {
    // e = p_i - MEM_i;  len = |e|;  excess = len - y          (Bingham: only the excess over the yield flows)
    //   if (excess > 0) MEM_i += e * (kFlow * excess / len)
    //   if (kHeal)      MEM_i += (Q_i - MEM_i) * kHeal          (dents heal to the TRUE rest shape)
    //   clamp |MEM_i - Q_i| <= maxD; accumulate mass-weighted mean offset
  }
  // re-centre: sum M_i (MEM_i - Q_i) = 0  (goal centroid stays at c, no momentum injected)
  // Laplacian memory: LQE_i = LQ_i + wm * ((MEM_i - mean(MEM_nbrs)) - LQ_i); the bendK block reads LQE instead of LQ
  // plastic only (yield > 0): EL_e = EL0_e + wm * (|MEM_a - MEM_b| - EL0_e); ESOFT_e = EL_e * edgeSoftStrain (keep EL0/restLen for `strain`)
  // glue: scale p.glue by 1/(1+ms) (applyMaterial does this): with full glue a slow family keeps a 0.03 R dent for ever [M]
}
```

* Stable: every update is a convex combination (kFlow, kHeal in (0,1)), the blend is the implicit-spring form. Cost: 642 x ~30 flops once per frame.
* **A held dent is ~ ms x yield x R0 deep**: the restoring arm pulls with k1 x against a slider of strength k2 y, so x = ms y. Putty 5 x 0.07 = 0.35 R0 [M reduction: 0.29 R0 left 6 s after a 0.5 R0 dent; gel and foam < 0.02].
* In the 1-D reduction the recovery tail decays with tau (1+ms) to within 5 % for every viscoelastic family [M].

### 3.2 Compressibility and slow-rise: a volume target that bleeds and returns (air flow)

softbody.ts: `alphaT = kappa * S0`, one pass, so the volume spring has natural frequency **omegaV = 1 / (H sqrt(kappa))** (fraction corrected per substep
= 1/(1+kappa)). Today's kappa 0.5 is omegaV = 509 rad/s: nu_eff ~ 0.5. Poisson from the stiffness ratio r = (omegaV/smOmega)^2: nu = (3r-2)/(2(3r+1))
(design-level, uncalibrated; `effectivePoisson()`). Foam: omegaV 38 rad/s = kappa ~ 90, nu_eff 0.37, in the 0.1-0.4 range polymer foams have [S7].

```ts
// state: vt in [volFloor, 1] (V*), starts at 1. Skip all of this when mat.volFloor >= 0.995 (gel): zero cost, zero change.
const vNow = vol6 / v6;                             // volume BEFORE projection: finger/grab compression shows up here
const C = (vol6 - v6 * vt) / v6;                    // pressure toward the TARGET volume, not the rest volume
const x = clamp((mat.volFloor + 0.12 - vNow) / 0.14, 0, 1), d = x * x * (3 - 2 * x);   // bottom-out
const aEff = alphaT * (1 - d) + 0.5 * S0 * d;       // spring stiffens back to incompressible near the floor
const lambda = -C / (S + aEff);                     // rest as today (WV zero for blocked particles)
// air leaves only while something LOADS the body, returns always (otherwise vt and the memory arm deadlock at a 2 % permanent set [M])
if (loaded && vNow < vt - 0.003) vt += (Math.max(vNow, mat.volFloor) - vt) * rate(mat.volOutTau);   // volOutTau = max(0.04, 0.12 volInTau)
vt += (1 - vt) * rate(mat.volInTau);                // volInTau = airReturnTau
vt = clamp(vt, mat.volFloor, 1);                    // loaded = finger down/retracting or a grab active
```

* The volume constraint holds the body at V*, so it **cannot re-inflate faster than air returns**: that is the slow rise. 95 % of the lost volume
  is back in ln(20) tau = 3 tau, independent of the step (1/360 and 1/60 agree) [M 1-D]. Foam tau 1.45 s: 4.3 s, about half the real 5-10 s [S3] on purpose.
* **Bottom-out is needed**: under fuzz (two fingers + a grab) the soft spring let marshmallow reach volume 0.29 and the dome 0.18; with bottom-out the
  minima sit at their floors (marshmallow 0.65 against floor 0.65, beads 0.82 against 0.82, foam 0.71 because the finger depth caps first) [M].
* Rate dependence of air (Darcy [S9]): damp the volume rate. Compressible families only (an incompressible body has no volume rate to damp):
  `c = 1 - exp(-2 zeta omegaV H); V_i -= c * dC * WV_i * GRAD_i / (S * v6)` with `dC = sum GRAD_i . V_i / v6`; zeta = `airDamp` (foam 0.9). It adds
  momentum-free damping of the volume mode only; measured fast/slow finger reaction 11.8 for foam against 7.1 for gel [M, older snapshot].
* **Contract conflict (resolved in the contract on 2026-10-05)**: the slice-1 G1 wanted `metrics.volume` in 0.85..1.15 for every body. True for jelly,
  silicone, gummy, liquid, putty, slime, stickystretch; the foam, marshmallow, beads and dome go to 0.65-0.82 by design. CONTRACT.md section 4.2 and
  gate G1 now use a per-family band, lower bound `min(0.85, 1 - volBleedMax - 0.05)`, upper bound 1.15, computed from `src/data/materials.ts`
  (table in CONTRACT 4.2). The probe that enforces it is physics round-2 work (in progress).

### 3.3 Plasticity and creep

Done by 3.1 (`yieldStrain`, `healTau`, `memMax`) plus the plastic edge lengths. Mochi dough: yield 0.045, heal 2.5 s: the thumb-print is ~ 90 % gone
after 5 s [M]. Putty: yield 0.07, heal 40 s: keeps a third of the dent for at least 12 s. Slime has no yield (it flows back, tau 0.8 s, ms 3: ~ 5 s).

### 3.4 Bounce and damping (three channels, all in the solver already)

`intDamp` (local ripples, peak flop), `affDamp` (whole-body squash, "does it rebound like a ball"), `intDamp2` (extra per m/s of internal speed). Genome
`bounce` scales all three by 1.6^(+-1). Foam 18/40/16 is dead, silicone 2/8/2.5 rebounds, gel 4.6/21/5.5 wobbles two to three cycles.

### 3.5 Stretch limit

No new code: `edgeAlphaT` (skin compliance), `edgeSoftStrain` (strain where the skin hardens, then alpha x 0.12) and `maxPull` (grab distance). Sticky stretch
0.75 / 0.65 / 2.9 R0, popdome 0.08 / 0.08 / 0.8 R0. Genome `stretch` scales each by 1.25^(+-1) (alpha by 1.3).

### 3.6 Rate stiffening (fast poke feels firmer)

Measured in the 3-D prototype as the finger's reaction (mass x projection correction / H^2) at the same depth, fast ramp 0.05 s against slow 1.5 s [M, the
snapshot before the last retune]: **only `intDamp2` moves it** (gel: ratio 6.4, 7.1, 9.5, 13.0 for intDamp2 = 2.5, 5.5, 14, 30, slow-press reaction
unchanged at ~ 5.8k); `affDamp` 10 versus 50 changes nothing (6.4 versus 6.5); the memory arm adds no visible finger reaction (shape matching is the
soft part of this solver). So rate stiffening = `speedDamp` (maps to `intDamp2`), with the memory arm only responsible for the slow part (recovery, held dents).
Putty 28, slime 24, foam 16, silicone 2.5. PHYS clamps the per-substep fraction at 0.9, which keeps 40 safe.

### 3.7 Tack and stringing

Always on (free): `tableMu`, `glue`, `groundDamp` and `FINGER.friction` scale with `tack` (already present in the solver, scaled by `applyMaterial`). Only for
`tack > 0.25`, a finger bond system (prototype, ~ 60 lines, +0.04 ms):

```ts
// capture: while a finger is down >= 0.1 s, every particle the tip projects (once): bond { v, o = XP_v - tipCentre, breakAt =
//   tackBreakR0 * R0 * (1 + stringiness * 1.2 * (hash(v) - 0.5)) }     // hash = imul(v+1, 2654435761) >>> 0 / 2^32: deterministic
// every substep BEFORE the finger collision:
for (const b of bonds) {
  const T = tipCentre + b.o, d = dist(T, XP[b.v]);
  if (d > b.breakAt) { remove(b); emit('snap', ...); continue; }              // staggered: each bond has its own threshold
  let g = 1 / (1 + mat.tackAlphaT * m[b.v]);
  const cap = 0.0025 * (0.5 + mat.tack);                                      // FORCE-LIMITED pull, metres per substep
  if (d * g > cap) g = cap / d;
  XP[b.v] += (T - XP[b.v]) * g;  sumMass += m * (T - XP[b.v]) * g;
}
// momentum-neutral: subtract sum/Mtot from every particle (the table and the weight hold the base; without this a bonded lift FLUNG the body 2.9 m [M])
// fingerUp with live bonds: the tip keeps moving outward by 1.6 * tackBreakR0 * R0 over retractS * (1 + 4 tack), then clear (emit 'snap')
```

[M] stickystretch: 34 bonds hold 8 frames, then break progressively over 7 frames (34, 31, 28, 20, 14, 8, 1, 0); slime similar; mochi (tack 0.3) breaks within
3 frames; a 0.15-0.27 R0 tent forms above the rest surface. A **displacement-only** threshold with stiff bonds never broke bonds (the skin follows the tip),
and a force-threshold broke all bonds in the first substep; the force cap is what makes the strings stagger. Not verified by eye. Cheap alternative if it
looks wrong: keep friction only and let RENDER draw 2-4 thin strands from the tip to the topmost bonded vertices (`stickyStrings` drives the sound either way).

### 3.8 Slosh (liquid, beads) and jam

Equivalent mechanical model of one slosh mode: a mass fraction mu on a spring and dashpot (Dodge and Abramson, [S18]). State s = offset of the liquid centre from the shell
centre, world frame; the drive is the shell's acceleration relative to what the table already supports (`ayApplied` is the gravity the solver actually applied):

```ts
const w = 2 * Math.PI * mat.sloshHz;                       // sloshHz at size 0.5; resolveMaterial scales it by 1.25^(-(size-0.5)) (bigger = slower)
sv += ((aGravityApplied - aShell) - w * w * s - 2 * zeta * w * sv) * H;  s += sv * H;   // semi-implicit Euler: stable for w*H < 2 (here <= 0.17)
// aShell = (vcm_now - vcm_prev) / H;  clamp |s| <= 0.35 R0
// shape: goal_i += 3 * mu * (s . n_i) * n_i   (n_i = R * rest normal; an odd field, so zero net displacement and no momentum)
// reaction on the shell: every V_i += H * mu/(1-mu) * (w^2 s + 2 zeta w sv)
```

At rest on the table s = 0 (no sag; the supported-body gravity already cancels it). Free fall: drive = 0, the liquid floats to the centre. [M 1-D]: oscillator never grows,
damping ratio recovered within 25 % at H and at 1/60. [M 3-D prototype]: after a 2.2 m/s shove the liquid swings -3.3, +1.4, +1.4, +0.2, -0.3 cm at 0.25 s steps (~ 2.5 cycles); no
NaN. Shape error barely changes (0.047 against 0.059 peak), so **check by eye**. Jam is the `1 + 6 jam c^2` factor in 3.1 (c = `metrics.compression`).

### 3.9 Snap (bistable dome): not built, design only

Two rest shapes (convex Q and inverted Qi: reflect the cap about the rim plane), state s in {0,1} with a Schmitt trigger on press depth (flip to 1 above ~ 0.55 of the
thickness, flip back when pushed from the other side or after a viscoelastic delay of a few seconds [S16]), goal = Q + s (Qi - Q) eased over ~ 40 ms, emit `snap`. Until then `popdome` is a
stiff compressible dome (it works as a family without the pop).

### 3.10 Prototype evidence (scratch copy of `softbody.ts` at 15:4x, 12 families at a neutral genome, 1.5 s press on the top, then release)

Rotation- and translation-free shape error against the rest shape, in rest radii (peak 0.18-0.22 for every family; **below ~ 0.02 is noise**, the plain solver wobbles 0.006-0.034):

| family | +0.25 s | +1 s | +3 s | +12 s | volume +0.25 / +1 / +3 / +8 s | reading |
|---|---|---|---|---|---|---|
| plain solver | 0.018 | 0.007 | 0.006 | 0.007 | 1.00 | back in < 0.3 s |
| slowrise | 0.092 | 0.059 | 0.024 | 0.007 | 0.91 / 0.94 / 0.98 / 1.00 | back in ~ 5 s (formula 4.5 s) |
| marshmallow | 0.052 | 0.021 | 0.020 | 0.020 | 0.93 / 0.99 / 0.99 / 0.99 | back in ~ 1 s |
| mochidough | 0.081 | 0.065 | 0.024 | 0.023 | 0.98 / 1.00 | thumb-print heals in ~ 5 s |
| putty | 0.100 | 0.082 | 0.076 | 0.065 | 1.00 | keeps ~ 1/3 of the dent |
| slimegoo | 0.031 | 0.047 | 0.018 | 0.003 | 1.00 | oozes back in ~ 5 s |
| beadsqueeze | 0.070 | 0.039 | 0.017 | 0.019 | 0.92 / 0.98 / 0.98 / 0.97 | back in ~ 2 s |
| jelly, silicone, gummy, dome, liquid, sticky | 0.008-0.035 | 0.006-0.039 | 0.005-0.021 | 0.004-0.019 | 1.00 (dome 0.82 minimum) | noise level within 0.5 s |

Fuzz (48 runs x 400 random events: fingers, pinch, grabs, nudges, dt 1/240..1/10, random genomes): 0 non-finite, 0 inverted volume, 0 table
penetration, 0 safety resets. Cost per `step(1/60)`, p50 on this container (plain solver 1.38 ms): jelly +0.04, foam +0.14, putty +0.27, sticky +0.04, liquid +0.06 ms (noisy).

## 4. The families (transcribed from `src/data/materials.ts`; the code wins)

These tables are copied by hand, not generated: no generator exists. On 2026-10-05 every number in them (506 cells, the computed `nu_eff`, `hold` and
`recovery95` columns excluded) and every family blurb was compared against `MATERIAL_FAMILIES`: all numbers matched; two blurbs (putty, popdome) had drifted and were
corrected to the code's text. Later the same day the opacity fix added the `cap` column of the visual table and moved the bead squeeze's translucency reference
(0.5 +/- 0.3 to 0.35 +/- 0.15); both were copied from the code. Numbers are design values in the units of section 3 (`smOmega` etc. are the **ratio basis**: only their ratios to the gel go to the solver). `nu_eff` is heuristic.

**Stiffness and volume**

| family | smOmega | volOmega | nu_eff | bleed | airTau s | airDamp | jam | snap |
|---|---|---|---|---|---|---|---|---|
| slowrise | 20 | 38 | 0.373 | 0.55 | 1.45 | 0.9 | 0.35 | 0 |
| marshmallow | 13 | 28 | 0.399 | 0.35 | 0.28 | 0.35 | 0.1 | 0 |
| mochidough | 14 | 150 | 0.496 | 0.05 | 0.3 | 0.1 | 0.1 | 0 |
| jellygel | 23 | 480 | 0.499 | 0 | 0.1 | 0.02 | 0 | 0 |
| waterfill | 11 | 650 | 0.5 | 0 | 0.1 | 0.05 | 0 | 0 |
| putty | 12 | 300 | 0.499 | 0 | 0.1 | 0.05 | 0 | 0 |
| stickystretch | 16 | 400 | 0.499 | 0 | 0.1 | 0.05 | 0 | 0 |
| slimegoo | 9.5 | 350 | 0.5 | 0 | 0.1 | 0.05 | 0 | 0 |
| firmsilicone | 38 | 600 | 0.498 | 0.02 | 0.06 | 0.02 | 0.15 | 0 |
| popdome | 44 | 70 | 0.325 | 0.3 | 0.06 | 0.1 | 0.5 | 1 |
| gummy | 30 | 520 | 0.498 | 0 | 0.1 | 0.02 | 0.1 | 0 |
| beadsqueeze | 15 | 36 | 0.418 | 0.18 | 0.5 | 0.3 | 0.85 | 0 |

**Time, memory and plasticity** (`hold` = dent depth kept in R0; `recovery95` = estimated seconds to 95 % back)

| family | memStiff | memTau s | yield R0 | healTau s | hold R0 | recovery95 s |
|---|---|---|---|---|---|---|
| slowrise | 2 | 0.5 | 0 | 60 | 0 | 4.5 |
| marshmallow | 0.5 | 0.25 | 0 | 60 | 0 | 1.1 |
| mochidough | 3 | 0.45 | 0.045 | 2.5 | 0.14 | 7.5 |
| jellygel | 0.1 | 0.2 | 0 | 60 | 0 | 1.3 |
| waterfill | 0.1 | 0.3 | 0 | 60 | 0 | 1.9 |
| putty | 5 | 0.5 | 0.07 | 40 | 0.35 | 60 |
| stickystretch | 0.8 | 0.35 | 0 | 60 | 0 | 1.9 |
| slimegoo | 3 | 0.8 | 0 | 60 | 0 | 9.6 |
| firmsilicone | 0.05 | 0.1 | 0 | 60 | 0 | 3 |
| popdome | 0 | 0.1 | 0 | 60 | 0 | 2.5 |
| gummy | 0.35 | 0.3 | 0 | 60 | 0 | 1.2 |
| beadsqueeze | 2 | 0.25 | 0.05 | 2.5 | 0.1 | 7.5 |

**Damping, skin, surface, slosh**

| family | intDamp | affDamp | speedDamp | edgeAlphaT | edgeSoft | maxPull | mu | tack | strings | slosh m / Hz / zeta |
|---|---|---|---|---|---|---|---|---|---|---|
| slowrise | 18 | 40 | 16 | 0.22 | 0.2 | 1 | 0.7 | 0.1 | 0 | - |
| marshmallow | 12 | 34 | 8 | 0.35 | 0.28 | 1.3 | 0.75 | 0.2 | 0.1 | - |
| mochidough | 16 | 40 | 14 | 0.55 | 0.5 | 2.1 | 0.8 | 0.3 | 0.15 | - |
| jellygel | 4.6 | 21 | 5.5 | 0.41 | 0.36 | 1.73 | 0.6 | 0.15 | 0 | - |
| waterfill | 3.2 | 14 | 4 | 0.3 | 0.22 | 1.5 | 0.55 | 0.05 | 0 | 0.45 / 2.6 / 0.1 |
| putty | 12 | 30 | 28 | 0.6 | 0.45 | 2.3 | 0.7 | 0.2 | 0.3 | - |
| stickystretch | 3.4 | 18 | 6 | 0.75 | 0.65 | 2.9 | 1.1 | 0.9 | 0.85 | - |
| slimegoo | 16 | 40 | 24 | 0.7 | 0.5 | 2.7 | 0.95 | 0.75 | 1 | - |
| firmsilicone | 2 | 8 | 2.5 | 0.12 | 0.12 | 1.15 | 0.9 | 0.1 | 0 | - |
| popdome | 2.4 | 8 | 3 | 0.08 | 0.08 | 0.8 | 0.8 | 0 | 0 | - |
| gummy | 8 | 22 | 8 | 0.2 | 0.16 | 1.25 | 0.7 | 0.3 | 0.1 | - |
| beadsqueeze | 14 | 36 | 16 | 0.4 | 0.35 | 1.4 | 0.65 | 0 | 0 | 0.2 / 3.5 / 0.35 |

**Visual signature** (RENDER). At rest foam and marshmallow are matte and opaque with sheen at grazing angles; gel, liquid, slime and gummy are glassy with a deep subsurface
colour; pressed: gel/gummy blush warm where compressed (`blush`) and go pale and clear where stretched (`stretchPale`), foam and putty barely change.
**What `resolveMaterial` does with these columns:** the genome's translucency, gloss, coreGlow and glitter pass through (since the 2026-10-05 CORE
audit fix), so the species look in `catalog.ts` is the one source for them and the tier ordering of DESIGN 5.3 holds in the resolved values
(`probe_catalog.ts` checks it); AFTER the pass-through the family's translucency **cap** applies (`lookBounds.translucencyMax`, the `cap` column; since
the 2026-10-05 opacity fix). The translucency and gloss centre +/- span, `core x` and `glitter x` are reference values: the fallback for a genome that
lacks the field (centre; 0.5 x the multiplier) and the family character that `probe_materials.ts` checks. The other columns are what the family adds.

**The foam translucency tension is resolved** (2026-10-05). It was: the catalog's foam, marshmallow and putty species carried translucency 0.45 to
0.80, so the "matte and opaque" foam look described above was not what the resolved values gave. The fix has three parts:
1. **A cap for the families that are opaque or frosted in the hand**, chosen from the make-up in section 1 (the optics are [GK]): slow-rise foam
   **0.30** (open-cell PU under a painted skin [S2][S26]: every cell wall scatters, light fades within millimetres); marshmallow **0.40** (an aerated
   gelatin-sugar foam [S10]: the cell walls are a clear gel, subsurface 0.35 against the PU foam's 0.15, so thin edges glow a little more); bounce
   putty **0.30** (filled, pigmented silicone-borate [S5]); mochi dough **0.45** (a semi-clear TPR skin [S4] over an opaque dough or flour fill
   [S13]: a milky body at most); bead squeeze **0.50** (a packed bed of beads [S17] scatters like crushed ice or sugar: each bead may be clear, the
   bed is not; its reference band moved from 0.5 +/- 0.3 to 0.35 +/- 0.15 so that the family's own band sits under its cap). Every cap is at or
   above the family's natural band (reference + span), so it removes only the catalog's stylised excess. Gel, liquid, sticky stretch, slime,
   gummy, firm silicone and pop dome have no cap: each can be cast water-clear.
2. **The 20 catalog species of those families sit under their caps with their whole cosmetic band** (base + 0.06 <= cap): slow-rise 0.15 to 0.23,
   marshmallow 0.18 to 0.33, putty 0.15 to 0.23, mochi dough 0.26 to 0.38, beads 0.30 to 0.43, still rising a little with tier inside each family.
   No catalog instance is ever clipped (`probe_catalog.ts` checks 200 instances of each), so `_spec/CATALOG.md` prints the drawn numbers; the cap
   guards genomes from elsewhere (random genomes, a share string carrying another family's look).
3. **Their tier shows in core glow, glitter and gloss instead of a see-through body**: `probe_catalog.ts` checks that inside each capped family the
   mean resolved coreGlow and glitter rise strictly with tier and gloss never falls (pooled over the capped families: coreGlow 0.23 / 0.48 / 0.67 /
   0.81 / 0.91 / 1.00, glitter 0.00 / 0.17 / 0.31 / 0.58 / 0.70 / 1.00, Common to Mythic), and that translucency still rises strictly with tier in the
   families that can be clear (0.54 / 0.65 / 0.78 / 0.81 / 0.92 / 0.95). The render lane's rim, aura and sparkle (DESIGN 5.3) carry the rest.

Still open, on the render side: the renderer reads `genome.translucency` directly (not `resolveMaterial`), adds a per-tier `translucencyAdd`
(`src/render/rarity.ts`, up to +0.2) and floors transmission at 0.62 (`src/render/material.ts`), so it does not honour the cap yet. Since the catalog
bases now sit under the caps, only the per-tier add and the floor stand between the data and an opaque foam on screen.

| family | translucency | cap | gloss | rough | subsurface | fuzz | grain | thick | blush | stretchPale | core x | glitter x |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| slowrise | 0.04 +/- 0.04 | 0.3 | 0.35 +/- 0.15 | 0.7 | 0.15 | 0.35 | 0.55 | 0.3 | 0.1 | 0.1 | 0.15 | 0 |
| marshmallow | 0.05 +/- 0.05 | 0.4 | 0.08 +/- 0.06 | 0.95 | 0.35 | 0.8 | 0.3 | 0.3 | 0.15 | 0.1 | 0.1 | 0 |
| mochidough | 0.18 +/- 0.12 | 0.45 | 0.2 +/- 0.15 | 0.85 | 0.55 | 0.55 | 0.5 | 0.8 | 0.35 | 0.45 | 0.4 | 0.1 |
| jellygel | 0.82 +/- 0.18 | - | 0.88 +/- 0.12 | 0.08 | 0.7 | 0 | 0 | 1 | 0.85 | 0.75 | 1 | 1 |
| waterfill | 0.93 +/- 0.07 | - | 0.95 +/- 0.05 | 0.04 | 0.35 | 0 | 0 | 1.4 | 0.45 | 0.3 | 0.9 | 1.4 |
| putty | 0.08 +/- 0.08 | 0.3 | 0.55 +/- 0.15 | 0.45 | 0.2 | 0.1 | 0.1 | 0.5 | 0.2 | 0.25 | 0.25 | 0.2 |
| stickystretch | 0.6 +/- 0.25 | - | 0.78 +/- 0.15 | 0.12 | 0.6 | 0.05 | 0 | 0.9 | 0.6 | 0.9 | 0.8 | 0.7 |
| slimegoo | 0.7 +/- 0.25 | - | 0.96 +/- 0.04 | 0.03 | 0.8 | 0 | 0 | 1.1 | 0.5 | 0.8 | 0.8 | 1.3 |
| firmsilicone | 0.25 +/- 0.2 | - | 0.45 +/- 0.2 | 0.35 | 0.4 | 0.05 | 0.1 | 0.6 | 0.3 | 0.3 | 0.5 | 0.3 |
| popdome | 0.35 +/- 0.2 | - | 0.7 +/- 0.2 | 0.2 | 0.25 | 0 | 0 | 0.4 | 0.15 | 0.1 | 0.6 | 0.2 |
| gummy | 0.9 +/- 0.1 | - | 0.8 +/- 0.15 | 0.15 | 0.85 | 0 | 0 | 1.2 | 0.8 | 0.6 | 0.9 | 0.5 |
| beadsqueeze | 0.35 +/- 0.15 | 0.5 | 0.5 +/- 0.3 | 0.3 | 0.3 | 0 | 0.9 | 1 | 0.25 | 0.2 | 0.5 | 1.2 |

**Audio signature** (AUDIO). Numbers are BEFORE `pitchRatio(genome)` (the audio lane still scales bubble radii and frequencies by it; do not apply size twice). Bubbles are Minnaert
resonators, f0 ~ 3.26 / r Hz with r in metres [GK; `voices.ts` uses it], so 1 mm ~ 3.3 kHz. `bubbleRate` multiplies the squish voice's Poisson rate (~ 70/s at full speed in `voices.ts`);
`wet` mixes bubble stream against dry rustle; `ring` = resonant boing; `stickyStrings` = rate of tiny "tck" releases during a peel (drive it from `snap` events).

| family | bubbleRate x | bubble r mm | noise Hz | colour | wet | airPuff | stickyStrings | bodyPitch | ring | dB |
|---|---|---|---|---|---|---|---|---|---|---|
| slowrise | 0.25 | 0.3-1 | 3800 | 0.8 | 0.1 | 0.95 | 0.1 | 0.95 | 0.05 | -3 |
| marshmallow | 0.2 | 0.3-0.9 | 4800 | 0.9 | 0.05 | 0.55 | 0.15 | 1 | 0 | -4.5 |
| mochidough | 0.5 | 0.8-2.5 | 1500 | 0.35 | 0.35 | 0.1 | 0.35 | 0.85 | 0 | -2 |
| jellygel | 1 | 0.6-4 | 2200 | 0.5 | 0.8 | 0 | 0.15 | 1 | 0.55 | 0 |
| waterfill | 1.6 | 1-6 | 1200 | 0.3 | 1 | 0 | 0.05 | 0.8 | 0.35 | 1.5 |
| putty | 0.45 | 1.2-3.5 | 700 | 0.2 | 0.3 | 0 | 0.25 | 0.75 | 0.1 | -1.5 |
| stickystretch | 0.9 | 0.5-2.5 | 2800 | 0.6 | 0.55 | 0 | 0.9 | 1.05 | 0.2 | -0.5 |
| slimegoo | 1.9 | 1.5-6 | 900 | 0.25 | 1 | 0 | 0.85 | 0.7 | 0 | 1 |
| firmsilicone | 0.35 | 0.4-1.5 | 3200 | 0.6 | 0.2 | 0.05 | 0.1 | 1.3 | 0.85 | -1 |
| popdome | 0.1 | 0.3-0.8 | 5200 | 1 | 0 | 0.2 | 0 | 1.5 | 1 | 0 |
| gummy | 0.55 | 0.6-2 | 2600 | 0.55 | 0.35 | 0 | 0.3 | 1.1 | 0.4 | -1.5 |
| beadsqueeze | 2.4 | 0.3-0.7 | 5400 | 1 | 0 | 0 | 0 | 0.9 | 0 | -2 |

**In the hand** (the `blurb` of each family)

- **slowrise** Sinks in like a sponge, then creeps back up over several seconds; light, dry, no bounce, a little crunch of air.
- **marshmallow** Featherlight and powdery; squashes flat with almost no push-back and puffs up again in a second.
- **mochidough** Soft, heavy dough: it stretches, keeps a thumb-print for a few seconds, then slowly smooths itself out.
- **jellygel** Glossy, translucent and bouncy: squashes without losing volume, bulges around your finger, wobbles for a while.
- **waterfill** A thin skin around a sloshing liquid: it bulges where you do not press and keeps swaying after you let go.
- **putty** Firm with no bounce when you poke it fast, flows like taffy when you lean on it, and keeps the dent you leave.
- **stickystretch** Clingy and stretchy: it grabs your fingertip, pulls into long thin strings, then snaps back with a tack.
- **slimegoo** A wet, sticky glob: it oozes after every squeeze, drips into strings and takes ages to pull itself together.
- **firmsilicone** Dense, grippy rubber: pushes back hard, snaps back instantly and keeps rebounding.
- **popdome** A stiff silicone dome that resists, then gives under a firm press and springs straight back. (The pop and flip of 3.9 are planned, not
  built: `materials.ts` keeps them in the family's `planned` note, and `probe_catalog.ts` refuses any blurb that promises them before they ship.)
- **gummy** Firm and chewy: a quick, slightly sticky spring-back with very little wobble, like candy.
- **beadsqueeze** A bag of tiny beads: it yields, rearranges with a crunch, firms up as it jams, and stays a little lumpy.

## 5. Per-instance variation (Genome -> family), `resolveMaterial(familyId, genome)`

The family fixes the character, the genome moves the instance inside a band. Neutral genome (all 0.5) returns the family base exactly. All maps are log-symmetric and monotone.

| Genome field | Physics effect (x factor at field = 0 .. 1) | Never changes |
|---|---|---|
| firmness | smOmega x0.8..1.25; volOmega x0.67..1.5; volBleedMax x1.15..0.85; edgeAlphaT x1.2..0.83 | which kind it is |
| bounce | intDamp, affDamp, speedDamp x1.6..0.625 (bouncier = less damping); sound `ring` x0.75..1.25 | |
| stretch | maxPull x0.8..1.25; edgeSoftStrain x0.8..1.25; edgeAlphaT x0.77..1.3 | |
| size | airReturnTau x0.8..1.25 (longer air path in a bigger body: diffusion would give size^2, we use size^1 to keep the band tight); sloshHz x1.12..0.89 | audio pitch (pitchRatio) |
| gloss, coreGlow, glitter | `look.*` = the genome's own value (the species look), unchanged; the family value is only the fallback for a missing field (section 4) | the tier ordering of DESIGN 5.3 |
| translucency | `look.translucency` = the genome's own value, then capped at the family's `lookBounds.translucencyMax` (slow-rise 0.30, marshmallow 0.40, mochi dough 0.45, putty 0.30, beads 0.50; no cap elsewhere); the family value is the fallback for a missing field | an opaque material turning see-through; a clearer genome never resolves murkier (monotone) |
| hue, seed, pattern, eyes | nothing (probe checks the physics is identical) | |

Checked by the probe: monotone sweeps for every family over three backgrounds; "firmer genome never softer" (slow-rise foam at firmness 0 -> 1: smOmega 16 -> 25); all 16 extreme genome
corners x 12 families and 1000 random genomes stay nearest to their own family; every axis within x1.6 of base; resolved values finite and in range for 12000 (genome, family) pairs and
hostile genomes (NaN, Infinity, strings, undefined); bad family ids (`'__proto__'`, `'constructor'`, `123`, `{}` ...) fall back to `jellygel` without throwing;
gloss, coreGlow and glitter equal the genome's for 4800 (genome, family) pairs and translucency equals min(cap, genome); exactly the five opaque families are capped,
each cap at or above the family's natural band; the cap never bites on a catalog species in its own family.
Margin warning: the worst corner genome moves a family 0.111 (RMS, normalised) from its base while the closest pair (jellygel / gummy) is 0.131 apart, so the bands are near their limit; do not widen them without first moving those two apart.

## 6. Priority, cost and risks

| # | Feature | Value | New code and cost (measured in the prototype) | Do it |
|---|---|---|---|---|
| P0 | `applyMaterial` ratios on existing params (stiffness, skin, damping x3, friction, glue, volume kappa) | high: jelly, silicone, gummy, liquid, slime, sticky, dome already differ in touch | 0 new solver lines, 0 cost | now |
| P1 | volume target + bottom-out (foam, marshmallow, beads, dome) | highest single "wow": a sponge that stays pressed | ~ 15 lines, one scalar, +0.05-0.1 ms; the per-family G1 band it needs is now in CONTRACT 4.2 | next |
| P2 | memory arm once per frame (viscoelastic recovery, held dents, `glue` scale, Laplacian blend) | high: putty, mochi, slime, slow rise | ~ 60 lines, MEM 3n doubles, +0.1-0.3 ms | next |
| P3 | `speedDamp` as `intDamp2` (rate stiffening) | medium, already a param | 0 lines | with P0 |
| P4 | Darcy volume-rate damping (compressible only) | low-medium | ~ 12 lines, +0.02 ms | after P1 |
| P5 | slosh mode (liquid, beads) | medium for one family, visual unverified | ~ 30 lines, +0.06 ms | after review by eye |
| P6 | tack bonds + outward peel (stickystretch, slime) | medium, risky (touches fingerUp/retract) | ~ 60 lines, +0.04 ms | after P2; fallback: friction only + drawn strands |
| P7 | snap dome | low until a pop sound + shape exist | second rest shape, hysteresis | skip now, ship popdome without the pop |
| skip | FEM viscoelasticity, real fluid, tension-field yield surface | | cost out of budget (CONTRACT: step <= 2 ms mean) | no |

**Risks**
1. **Contract G1** (contract side resolved 2026-10-05): the slice-1 band 0.85..1.15 is false for compressible families (measured minima 0.65-0.82). CONTRACT 4.3
   now states a per-family band derived from `materials.ts` (lower bound `min(0.85, 1 - volBleedMax - 0.05)`); `probe_softbody.ts` (PHYS) still checks the single
   slice-1 band until physics round 2 lands with materials.
2. **PHYS keeps retuning** (smOmega, edgeAlphaT, gravity 15 -> 10, new `bendK`, `glue`, `groundDamp`, finger friction while I worked). Ratios survive; the functional forms in 3.1-3.2 do not if the blocks are rewritten.
3. **Budget**: the plain solver is already 1.4-1.6 ms mean here against the 2.0 ms gate; the features add 0.05-0.3 ms. Update memory once per frame.
4. **No felt force** with kinematic fingers (3.6). **Resolved in the contract:** `SoftMetrics.reaction?: number` (0..1, normalised summed finger-projection
   correction, smoothed) was added to `src/contracts.ts` as an optional round-2 member, next to `press?`. PHYS's rewrite now fills both
   (`src/physics/softbody.ts` at checkpoints `fc60963` and `f14d3b8`, 2026-10-05; that rewrite is in progress and its gate was not re-run for them). Consumers still treat
   `undefined` as 0, because the members stay optional in the contract.
5. **Rotation extraction uses Q**, so a large plastic dent slightly biases R; clamp via `memMax`. Not measured.
6. **Tack and slosh are numerically tested, not seen**; both need a screenshot pass. Tack touches finger retract behaviour.
7. **Time scales are compressed ~ 2x** against real foam (4.5 s against 5-10 s [S3]) for play value; one constant per family.
8. Volume-target and memory arm can deadlock (3.2): gate the bleed on load. Found and fixed in the prototype; keep the gate.
9. Real squishy numbers (kPa, tan delta of a toy) were not found; all family numbers are design values.
10. Foam/marshmallow keep ~ 0.02 R of residual shape error even with the `glue` fix (inside the plain solver's noise band).

## 7. Sources and what is NOT verified

All URLs below appeared in WebSearch result lists in this session. **None was opened** (WebFetch: `EGRESS_BLOCKED`). Retail pages are weak evidence.

* **S1** viscoelastic foam, slow recovery: https://patents.google.com/patent/WO2019177900A1/en , https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12060506 , https://pmc.ncbi.nlm.nih.gov/articles/PMC12846099/
* **S2** slow-rise mechanism, squishy overview: https://en.wikipedia.org/wiki/Squishy , https://funnysquishy.com/blogs/news/squishy-foam-what-are-they-made-of , https://inspiretips.blog/what-are-squishy-toys-made-of-37843
* **S3** rise times, kinds: https://smoovvi.com/blogs/news/slow-rising-squishy-toys-guide , https://bamsquishy.com/blogs/news/types-of-squishies-by-material-and-texture-find-your-perfect-squeeze
* **S4** taba versus mochi: https://www.squishiebakery.com/blogs/behind-the-squish/taba-vs-mochi-the-squishy-showdown%E2%9C%A8 , https://tabasquishy.com/blogs/tabasquishy-news/types-of-squishies-explained-silicone-foam-gel-flocked-water-bead , https://yoyosquishy.com/blogs/news/how-to-identify-real-taba-squishies
* **S5** bouncing putty: https://www.physics.usyd.edu.au/~cross/SILLYPUTTY.htm , https://www.researchgate.net/publication/258606479_Elastic_and_viscous_properties_of_Silly_Putty , https://arxiv.org/pdf/1307.5168
* **S6** Deborah number: https://en.wikipedia.org/wiki/Deborah_number , http://soft-matter.seas.harvard.edu/index.php/Viscoelastic_scales
* **S7** Poisson ratio: https://en.wikipedia.org/wiki/Poisson%27s_ratio , https://www.osti.gov/pages/servlets/purl/1457403 , https://silver.neep.wisc.edu/~lakes/PoissonAniso.pdf
* **S8** silicone: https://apps.dtic.mil/sti/pdfs/ADA138129.pdf , https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10897882/ , https://www.dow.com/documents/11/11-3716-01-durometer-hardness-for-silicones.pdf
* **S9** foam air flow and strain rate: https://www.sciencedirect.com/science/article/abs/pii/S0020768324005146 , https://link.springer.com/article/10.1007/s11340-019-00521-3
* **S10** gelatin and marshmallow: https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/4876105 , https://www.sciencedirect.com/science/article/pii/S2772753X25000310 , https://spark.iop.org/youngs-or-should-it-be-yums-modulus-food-and-other-measurements
* **S11** loss factor: https://arxiv.org/pdf/2503.03701 , https://www.sciencedirect.com/science/article/pii/S2238785425021350
* **S12** viscoelastic models: https://appliedmath.brown.edu/sites/default/files/fractional/12%20EssentialsofLinearViscoelasticity.pdf , https://en.wikipedia.org/wiki/Standard_linear_solid_model
* **S13** stress balls and fills: https://funnysquishy.com/blogs/news/foam-stress-ball-vs-gel-bead-filling , https://funnysquishy.com/blogs/news/diy-stress-ball-guide
* **S14** TPR: https://www.xometry.com/resources/materials/thermoplastic-rubber-tpr/ , https://en.wikipedia.org/wiki/Thermoplastic_elastomer
* **S15** slime: https://en.wikipedia.org/wiki/Slime_(homemade_toy) , https://arxiv.org/pdf/2402.19357
* **S16** snap-through: https://www.maths.ox.ac.uk/node/32503 , https://arxiv.org/pdf/1807.05978
* **S17** jamming: https://jfi.uchicago.edu/~jaeger/group/JaegerGroupPapers/granular/SPIE_final.pdf , https://iopscience.iop.org/article/10.1088/1361-6633/aadc3c/ampdf
* **S18** slosh models: https://www2.swri.org/www2/fluid-slosh/SLOSH_Model_Derivations.pdf , https://arxiv.org/pdf/2511.10172
* **S19** tack: https://www.tainstruments.com/pdf/literature/AAN018_V1_Analysis%20of%20tack.pdf , https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12297306
* **S20** yield stress: https://arxiv.org/pdf/1110.1786 , https://pmc.ncbi.nlm.nih.gov/articles/PMC9502123/
* **S22** shape matching: https://graphics.stanford.edu/courses/cs468-05-fall/Papers/p471-muller.pdf , https://cal.cs.umbc.edu/Papers/Falkenstein-2017-RLP/Falkenstein-2017-RLP.pdf
* **S23** XPBD (alpha~ = alpha/dt^2, (grad C M^-1 grad C^T + alpha~) dlambda = -C - alpha~ lambda): https://matthias-research.github.io/pages/publications/XPBD.pdf , https://developer.blender.org/docs/features/nodes/xpbd_solver/xpbd_method/
* **S24** viscoelastic and inelastic position-based dynamics: https://royalsocietypublishing.org/rsos/article/5/2/171587/87357/Integrating-viscoelastic-mass-spring-dampers-into , https://arxiv.org/pdf/2405.11694
* **S26** integral-skin PU foam: https://imenpol.com/blog/en/educational/what-is-integral-skin-polyurethane-foam/ (it says the closed-cell dense skin sits over a cellular core; squishy sellers say "painted or coated": the sources disagree on what the skin is)
* **S27** water-bottle squishy listing (retail): https://www.amazon.com/Bottle-Squishy-Rising-Squeeze-Stress/dp/B0H5KCDM4L

**Not verified, or not found**
* Every page-level reading: all facts are search-summary level, no quote was checked in a page.
* Slow-rise toy rise times (5-20 s) and the patent recovery numbers (>= 3 s, 5-6 s, Tg 20-30 C, rebound < 25 %): summary only; the patent numbers describe mattress-type memory foam, not toys.
* Poisson ratios of our families (design targets from `effectivePoisson`, not measured); no Poisson ratio for hydrogels or gummy gels was found.
* Mueller 2005 plasticity formulas (the S_p update, the det = 1 volume normalisation, c_max): from memory; only the yield and creep parameters were confirmed by a summary.
* The XPBD damping term (gamma = alpha~ beta~ / dt) was not used; I derived and tested my own velocity-level damping instead.
* Dodge and Abramson slosh frequency formulas (omega^2 = g xi/R tanh(xi h/R), xi = 1.84): from memory, not used; `sloshHz` is a tuning value.
* Minnaert f0 = 3.26 / r [GK]. Human softness discrimination (Weber fraction): not looked up, so the 0.10 distance threshold is justified geometrically (half a range on one axis), not psychophysically.
* Play-Doh and modelling-clay yield stress (Pa): searched, not found. Hydrogel Poisson ratio: not found. kPa or tan delta of a real squishy toy: not found.
* The prototype is a scratch copy of a moving target (`softbody.ts` was edited by PHYS during this task); the rate-stiffening measurement is from the earlier snapshot. Slosh and tack were never looked at on screen.
