/**
 * ASCENDANT — LAVA FOUNDRY 2 : "PRESSURE"
 * runtime/data/stages/foundry-2.js
 *
 * The casting floor, the pour pit and the ladle gantry. FOUNDRY 1 walked you DOWN to
 * the melt and taught the belt and the ram in isolation. PRESSURE does not teach either
 * again: it has verbs of its own, and where a belt or a ram appears it is welded to one
 * of them.
 *
 * ── HOW TO READ THIS HEADER ────────────────────────────────────────────────────────
 * Every number below was produced by a tool run against THIS object list, not asserted
 * from a plan. The commands and their output:
 *
 *   node _harness/reachcheck.mjs foundry-2
 *     foundry-2       329   65   26  12    68     2  PASS      (and zero warnings)
 *     len 329 m · 65 gameplay objects · 26 dynamic hazards · 12 checkpoints ·
 *     68 landable surfaces · 2 orphan surfaces
 *
 *   node _harness/geomcheck.mjs foundry-2
 *     foundry-2      171       39     37   0.45    1   PASS
 *     171 objects · longest flat run 39 m · 37 distinct platform footprints ·
 *     gap coefficient of variation 0.45 · longest run of identical obstacles 1
 *
 * THE TWO ORPHANS ARE REAL AND CORRECT: both are `crusher` heads (the belt-2 ram at
 * objects[78] and the section-C side ram at objects[119]). reachcheck treats a crusher
 * top as landable; neither is reachable, because the nearest surface under either is
 * more than 2.4 m below it. Nothing else on the stage is orphaned — in particular every
 * casting shell now carries an explicit `motion.to` at its SUNK position, so the harness
 * models the shell where it really goes instead of inventing a phantom surface 4 m ABOVE
 * it (reachcheck.mjs rectsFor: `m.to ? v3(m.to) : [p[0], p[1] + (m.travel || 4), p[2]]`,
 * and `travel` is undefined for a sink). That correction is why the orphan count fell
 * from 9 to 2, and it is what makes this PASS mean something on BEAT 2.
 *
 * WHAT THE GATE STILL CANNOT SEE, stated plainly: reachcheck models each shell at its
 * HOME height and never simulates the fuse. So the PASS proves the geometry of BEAT 2 is
 * connected; it does NOT prove the fuses are survivable. That is proved by the
 * arithmetic in BEAT 2 below (crossing time vs fuse vs drop rate) and by loopcheck.
 *
 * ── RHYTHM, MEASURED ───────────────────────────────────────────────────────────────
 * Gaps along the route reachcheck's own Dijkstra takes (spawn -> every checkpoint ->
 * finish), edge to edge, measured with the harness's `gap()`:
 *
 *     stage       difficulty   jumps   mean     sd    % in the 1.9-2.6 m band
 *     neon-1           1         30    3.09 m  0.81            20%
 *     foundry-1        3         29    3.06 m  0.54             7%
 *     foundry-2        6         38    3.42 m  0.67             8%
 *     temple-3         9         47    2.84 m  1.31            19%
 *
 * min 1.50 m (the jump-pad hop), max 4.60 m. Safe run gap is 4.35 m at dy 0, so the mean
 * jump uses 79% of the envelope. The two longest are taken at -2.20 m and -1.60 m, where
 * safe is 5.21 m and 5.01 m. 42 distinct landable tops and 32 distinct z centres across
 * 329 m. The longest run of identical consecutive rises anywhere on the stage is 2 —
 * there is no staircase.
 *
 * ── SHAPE ──────────────────────────────────────────────────────────────────────────
 * 329 m. 65 gameplay objects. 26 dynamic hazards from ELEVEN families (mover, pendulum,
 * rotor, crusher, vanish, laser, conveyor, lava, risinglava, spikes, jumppad).
 * 12 checkpoints, spacing 26.3 / 28.9 / 22.5 / 30.7 / 27.4 / 25.6 / 14.6 / 34.6 / 36.7 /
 * 29.2 / 30.7 m — the longest leg is 36.7 m, and the two hardest stretches (the belt
 * transfer and the ladle gantry) are each split by a checkpoint of their own.
 * 4 coins, every one optional: three sit off the main line and the fourth hangs in the
 * air inside the wrecking ball's arc.
 *
 * Every leg's HARDEST move, per reachcheck's own leg dump, is a plain safe `run`:
 *   cp0->cp1 3.4 | cp1->cp2 3.6 | cp2->cp3 3.6 | cp3->cp4 4.6 | cp4->cp5 3.2 |
 *   cp5->cp6 4.6 | cp6->cp7 4.0 | cp7->cp8 3.8 | cp8->cp9 4.2 | cp9->cp10 4.5 |
 *   cp10->cp11 3.6 | cp11->finish 1.5 (pad)
 * No jump on this stage requires a sprint. The one place a sprint IS required is BELT 1,
 * where it is required to move at all — see BEAT 5.
 *
 * ── VERBS, in order, never the same twice ──────────────────────────────────────────
 *   BEAT 1  read the colour code                          static
 *   BEAT 2  commit — the floor leaves once you use it      SINKERS
 *   BEAT 3  time one crossing under a swinging mass        PENDULUM (ball, across)
 *   BEAT 4  drop into a pit that is filling                RISING LAVA + VANISH GRATE
 *   BEAT 5  sprint against a floor, then be carried by one BELT x LASER, BELT x RAM
 *   BEAT 6  walk 0.9-1.1 m of steel and TURN on it         PRECISION
 *   BEAT 7  four different machines over a spike bed       SET-PIECE
 *   BEAT 8  one launch                                     JUMP PAD
 *
 * ── THE TIDE CANNOT SEAL THE ROUTE. THIS IS THE STAGE'S LOAD-BEARING GUARANTEE. ────
 * `risinglava` is a pure function of the GLOBAL stage clock (lava.js:421
 * `surfaceY(t) = from + clamp((t - delay) * speed, 0, to - from)`), and CONTRACT §17
 * rewinds that clock only on `resetFrom`, which game.js:1102 calls only from
 * `_performRespawn`. Touching a checkpoint alive rewinds nothing. A tide whose ceiling
 * sits ABOVE any part of the route therefore closes that route permanently for a
 * late-arriving player, and the only recovery is deliberate suicide. That is a soft-lock
 * and it is disqualifying, so this stage makes it impossible by construction:
 *
 *   the front climbs from y 2.00 to a CEILING of 6.00 (`rising.to`)
 *   the lowest MAIN-LINE top inside its x span (89..142) is 6.40
 *   the kill box top is surface + 0.05 (lava.js:391 `_buildKill`)
 *   => 6.05 vs 6.40: the through-route clears the flood by 0.35 m FOREVER, at every
 *      arrival time, on a first run and on the thousandth.
 *
 * What the tide DOES gate is the sump — a three-ledge shortcut through the bottom of the
 * pit that holds COIN 3. Flood table, derived from the formula above with delay 44 and
 * speed 0.30:
 *
 *      ledge     top     drowns at       what it costs you
 *      sump 2    4.40     t 51.8 s       COIN 3
 *      sump 1    4.80     t 53.2 s       the sump entrance
 *      sump 3    6.00     t 57.2 s       the sump exit (= the ceiling, reached t 57.3)
 *      main line 6.40     never          nothing
 *
 * So the pour is a SPEED REWARD, not a gate: reach the pit inside ~50 s and the sump is
 * dry and cuts the corner; arrive later and you watch it close from the walkway above it
 * and stay on the through-route, which is the line you were on anyway. Nothing is ever
 * unreachable, and nothing is ever easier because you died.
 *
 * ── CHECKPOINT CLOCKS: PINNED ONLY WHERE A PIN IS PROVABLY CORRECT ────────────────
 * game.js:1193 `_recordCpClock` captures a checkpoint's real arrival clock as its
 * respawn phase — but `if (this._cpAuthored[i] !== undefined) return;`, so an authored
 * `clockOffset` DISABLES that safety valve. Pinning all of them is what turned the
 * previous version of this stage into a soft-lock. Here only three are pinned:
 *
 *   cp0, cp1  clockOffset 0     nothing on the route is on a clock before x 59.
 *   cp2       clockOffset 0.9   the BEAT 3 ball. pendulum.js:561 gives
 *                               angle = amp * sin(TAU*t/period + phase); at t = 0.9 with
 *                               period 3.6 and phase 0 that is sin(PI/2) = 1, i.e.
 *                               angle = amp = the EXTREME of the throw, where
 *                               omega = amp*(TAU/period)*cos(PI/2) = 0. pendulum.js:584
 *                               then holds `killA.active = tipSpeed > max(3.2, len*0.55)`
 *                               FALSE, so you respawn looking at a parked, inert ball
 *                               rather than one already coming down. (The previous header
 *                               claimed angle 0 was "the top of the arc". Angle 0 is the
 *                               BOTTOM, at maximum speed. That error is corrected here.)
 *   cp3..cp11 UNPINNED          every checkpoint from the pour hall onward lets
 *                               `_recordCpClock` capture the real arrival, so a death
 *                               hands back exactly the machine state you first saw. Every
 *                               hazard downstream of cp3 is cyclic, so the phase is
 *                               deterministic within a run and identical on every
 *                               respawn (CONTRACT §16).
 *
 * ── COLOUR LAW, object by object ───────────────────────────────────────────────────
 *   MOLTEN (palette.kill)         lava, spikes, ram faces, warning text. NOTHING you can
 *                                 stand on is ever this colour.
 *   EDGE   (palette.safeEdge)     every landable you must JUMP to reach.
 *   IRON   (palette.safe)         a landable you merely step onto. Exactly one thing here
 *                                 qualifies: anvil 1, which you walk off the gantry onto
 *                                 (reachcheck classes that edge a `walkoff`). It is IRON
 *                                 and carries no stripe, because you do not jump to it.
 *   MINT   (palette.checkpointOn) the twelve checkpoint decks and nothing else.
 *   VIOLET (palette.finish)       the cooling floor and nothing else.
 *
 * `glow` is written ONLY on objects whose builder reads it (builders.js buildPlatform,
 * buildBeam, buildPad: `const glow = (def && def.glow) || 1`). `vanish` and `conveyor`
 * are NOT such objects — vanish.js:279 hardcodes `glow: true, stripe: true` on its own
 * platform def and paints its rim from palette.safeEdge, and surfaces.js never reads a
 * glow field at all. Writing `glow: EDGE` on them would be a field the runtime ignores,
 * so their colour-law assignment is stated in a comment on the object instead. All three
 * vanish tiles and both belts are accounted for that way; nothing is unassigned.
 *
 * ── SIGNAGE ────────────────────────────────────────────────────────────────────────
 * stage.js:1356 builds a text plane facing local +Z and then applies `rot`; the default
 * when no rot is given is `group.rotation.y = -PI/2`, with the comment "stages run +X:
 * face the incoming player". So `rot: [0, -Math.PI/2, 0]` points a sign AT a player
 * running +X, which is what every sign here uses. What was wrong before was PLACEMENT,
 * not rotation: the title card sat at x -5.6, BEHIND a spawn at x -3.0, so the player
 * spawned looking away from it. Every sign is now placed AHEAD of the thing it warns
 * about and within 2.5 m of the route's z at that x — 'DO NOT STOP' at x 12.6 on the
 * shells' own z line, 'THE POUR IS COMING UP' at x 82.6 on the lip's z, 'ONE HALF AT A
 * TIME' at x 289.6 on the grates' z, and so on down the run. The one deliberate exception
 * is the three-line title card at x 5.0, set 4.4 m off the centre line so it does not
 * stand in the sightline down the casting pool; it is 8 m ahead of the spawn and 29 deg
 * off the spawn yaw, well inside the 82 deg FOV.
 *
 * ── CONVENTIONS ────────────────────────────────────────────────────────────────────
 * p = CENTRE, s = FULL size, so a top surface is p[1] + s[1]/2. Every gap quoted in the
 * object comments is EDGE TO EDGE between landable tops, computed by the layout solver
 * and confirmed by reachcheck. rot/yaw in radians, yaw 0 faces +X. Crusher and vanish
 * `phase` are FRACTIONS of the cycle; pendulum `phase` and `amp` are RADIANS
 * (CONTRACT §23). Sinkers are player-triggered and carry no phase.
 *
 * ── BEAT NOTES ─────────────────────────────────────────────────────────────────────
 * BEAT 2 — THE CASTING SHELLS. Seven `sink` movers over an open pool. A shell does
 *   nothing until you stand on it, then waits out its fuse and drops. Crossing a 3.0 m
 *   shell at run speed takes 0.35 s; the fuses run 0.34 / 0.28 / 0.24 / 0.30 / 0.22 /
 *   0.20 s and the drop rates 5.0 / 6.0 / 6.5 / 5.5 / 7.0 / 8.0 m/s, so the last shells
 *   are already falling as you leave them. Six footprints, six fuses, six drop rates.
 *   Gaps 3.40 / 2.40 / 3.90 / 3.00 / 3.60 / 4.40 / 2.60 / 3.80 — no two the same.
 *   THE ISLAND at x 34.7 is now cp1, so the beat's 55 m are split in half; the previous
 *   version made you replay every shell from the far bank after a single mistake.
 *   COIN 1 hangs 3.80 m off the island at z -6.6 — a purely lateral leap, the only one on
 *   the stage — and rejoins the main line at shell 4 (1.18 m), which is exactly where the
 *   island would have taken you. It skips nothing and it cannot be used to skip anything:
 *   shell 3 is 7.97 m from it against a 7.90 m sprint maximum, and shell 5 is 9.13 m
 *   against 7.60 m, so neither edge exists and the island checkpoint cannot be bypassed.
 *   What the detour costs is the fastest fuse on the stage — 0.18 s at 7.5 m/s. That is the
 *   general rule the whole stage is built to — every FORWARD pair of surfaces is either
 *   inside the SAFE run envelope or beyond the SPRINT envelope, never in the band
 *   between, which is why reachcheck reports no tight edge on any leg. A forward-skip
 *   audit over the whole surface graph (every pair reachable from spawn by safe edges
 *   only, filtered to edges that advance +X) leaves exactly six, and every one of them
 *   is accounted for:
 *     · five land on a shell's SUNK pose, 6.0-6.9 m down. `sinkDepth` is 6 and the pool
 *       is 3 m deep with its surface at 2.00, so lava.js:391 gives a kill box spanning
 *       -0.95..2.05 and every sunk slab's top (+0.8 down to -0.4) sits INSIDE it. Those
 *       are not routes, they are ways to jump into the melt.
 *     · one is the pour-hall sump dive — see BEAT 4.
 *
 * BEAT 3 — THE BALL. One pendulum, `mode: 'ball'`, `axis: [1,0,0]` so it swings ACROSS
 *   the run and is only low near the middle. Arm 7.4, radius 1.20, pivot 15.70: the
 *   visible sphere's bottom is 7.10 (0.70 m over the floor) and the kill sphere's is
 *   pivot - armLen - radius*0.93 = 7.18 (0.78 m). A crouched player is 1.05 m tall, so
 *   you cannot duck it — you cross when it is out at the side.
 *   COIN 2 hangs in the AIR at y 8.2, 1.8 m over the floor and dead under the ball's low
 *   point: a full jump reaches it (apex 2.09) and puts your head inside the sphere's
 *   swept volume. One machine, one deck, one optional risk. Nothing else moves here.
 *
 * BEAT 4 — THE POUR. See the guarantee above. The route DROPS 2.20 m into the pit on a
 *   4.60 m jump (the longest on the stage), runs the floor of a room that is visibly
 *   filling, and climbs 4.40 m back out. Tops go 8.60 -> 6.40 -> 6.80 -> 6.40 -> 7.20 ->
 *   7.70 -> 8.60 -> 9.30 -> 10.80: down, flat, up, and never the same rise twice
 *   running. One `vanish` grate on the way out (2.4 s on / 1.2 s off) is the only thing
 *   you have to WAIT for while the pit fills behind you.
 *   THE SUMP is a pocket under the hall, not a parallel route: three ledges at 4.80 /
 *   4.40 / 6.00 holding COIN 3, entered off the sump mouth at 6.40 and leaving ONLY over
 *   its third ledge onto the vanish grate (a 1.70 m climb across a 0.80 m gap). It
 *   cannot skip main-line
 *   content, and that is checked rather than asserted: sump 2 is 9.06 m from the sump
 *   mouth against an 8.79 m sprint maximum (no edge), sump 2 to the grate is +3.30 m
 *   (above the 2.089 m apex, no edge), and sump 3 to the deck past the grate is +2.60 m
 *   (no edge). The one edge the audit does leave is a 6.44 m sprint drop from cp4 onto
 *   sump 3 — the pocket's EXIT ledge. It is deliberate and it is harmless: it lands you
 *   where the pocket already lets you out, one jump short of the grate you were going to
 *   anyway, so it advances nothing and costs a harder landing. A pocket dug under a wide
 *   deck is always inside that deck's sprint envelope; the design answer is to make sure
 *   it leads nowhere new, which it does.
 *
 * BEAT 5 — THE TRANSFER. Two belts, and neither is the belt foundry-1 taught.
 *   BELT 1 RUNS BACKWARDS. controller.js:1087 adds a conveyor as a CARRY VELOCITY on top
 *   of your own, and `conveyorMax` (tuning.js) clamps the belt at 9.0. So on a belt
 *   running -X at 9.0: walking forward at speedRun 8.6 nets -0.4 m/s — you lose ground —
 *   and only speedSprint 12.2 nets +3.2 m/s. Nine metres of belt is 2.81 s of held
 *   sprint. You cannot loiter, and the reason is arithmetic, not decoration. (The
 *   previous version ran the belt WITH you at 8.8 against a walk of 8.6, leaving 0.2 m/s
 *   of drift — 45 s of standing time under its machine. This reversal is that fix.) The
 *   failure state is deliberately not death: the belt pushes you back onto the loading
 *   step, which is flush with its near edge.
 *   Across the middle of it is a TWO-BAR LASER GATE, 1.4 s on / 2.0 s off. The low bar
 *   sits 0.55 m over the belt (a crouch is 1.05 m tall, so it does not fit under) and the
 *   high bar 2.25 m over it (a jump apexes 2.09 m, so it does not fit over). It is a pure
 *   timing gate and the belt sets the clock: 4.5 m from the near edge to the bars is
 *   1.41 s of sprint against a 2.0 s window.
 *   BELT 2 RUNS ACROSS THE COURSE and is TRANSPORT, not an obstacle: it is the only way
 *   to make the 12.6 m lateral shift to cp7, and that is a graph fact, not a claim — the
 *   direct jump from its lip to the landing is 7.75 m at dy 0.00 against a 7.44 m sprint
 *   maximum, so reachcheck finds no edge and routes you over the belt. A full-width ram
 *   on a 3.3 s cycle closes FLUSH with the belt top (p.y 11.90 - s.y/2 0.75 - travel 2.35
 *   = 8.80) over its middle 5.0 m, which is 0.56 s of exposure at belt speed.
 *
 * BEAT 6 — THE TURN. Two beams that are not the same object with a coordinate changed:
 *   beam A is 7.0 x 1.0 running along +X, beam B is 1.1 x 6.4 running along -Z, and they
 *   meet flush at a 0.50 m step (<= stepUp 0.55), so the corner is WALKED. The gallery at
 *   the far end sits +2.10 m above beam A, and maxJumpDist(8.6, 2.10) is negative — the
 *   apex is 2.089 — so there is NO edge from beam A to the gallery at any speed. The turn
 *   is mandatory, and that too is a graph fact rather than an intention.
 *
 * BEAT 7 — THE LADLE GANTRY. Not a corridor: it climbs 3.00 m over a ladle and comes back
 *   down, tops running 10.50 -> 11.70 -> 12.90 -> 13.50 -> 12.10 -> 11.30 -> 10.70 ->
 *   10.30 -> 10.90, with widths 3.6 / 3.0 / 3.0 / 2.4 / 3.4 / 2.6 / 5.0 / 3.2. FOUR
 *   MACHINES, four families, no two alike, and none of them a repeat of BEAT 3:
 *     gantry   a ROTOR windmill spinning in the XY plane, 2 arms, period 2.2 s — an arm
 *              passes bottom-dead-centre every 1.10 s and you cross the 1.0 m lethal band
 *              in 0.12 s. Lethal underside 11.25 (rotors.js:621, capsule radius
 *              max(thick, rootC*0.30) = 0.50) = deck + 0.75. `mount: 0` because
 *              rotors.js:381-427 would otherwise drop a solid bracket collider into the
 *              walkway; the deco A-frame carries it visually.
 *     blade    a PENDULUM swinging ALONG the run (axis [0,0,1]) — the opposite plane to
 *              BEAT 3's ball, period 3.3 s, tip sweeping +/-4.12 m AT you rather than
 *              across you.
 *     grates   two VANISH tiles, 2.2 s on / 1.1 s off, phases 0.0 and 0.5 — never both
 *              gone.
 *     ram      a horizontal CRUSHER punching across the gap between the grates, period
 *              3.3 s. THE SAME PERIOD AS THE GRATES, deliberately: with the grate cycle
 *              at 2.2 + 1.1 = 3.3 s the conjunction is FIXED and repeats identically on
 *              every crossing, which is the muscle-memory law (CONTRACT §16). The
 *              previous version ran the ram at 3.6 s against a 3.3 s grate for an LCM of
 *              39.6 s, so no two attempts ever showed the same gauntlet.
 *   Every period in the hall is a multiple of 1.1 s (2.2 / 3.3 / 3.3 / 3.3), so the whole
 *   set-piece repeats on a 6.6 s bar.
 *   COIN 4 — THE ANVIL LINE. You step DOWN off the gantry onto anvil 1 (IRON: a walkoff,
 *   not a jump), take the coin in the air across a 2.70 m gap to anvil 2 with nothing but
 *   exposed spike tips underneath, and climb 1.00 m back onto the gantry. Both anvils
 *   stand inside the bed with their tops 0.50 and 0.90 m above the tips at 8.60.
 *
 * BEAT 8 — THE TAP. The pad's numbers are the CONTROLLER's, not the harness's:
 *   `_applyBounce` sets vy = sqrt(2*gravFall*power) and integrates the rise at gravFall
 *   too, so the apex is EXACTLY `power` and the flight is shorter than a naive model.
 *     pad top 10.84, power 7.2, cooling floor top 14.70 -> dy 3.86
 *     rise sqrt(2*7.2/54) = 0.5164 s · fall sqrt(2*3.34/54) = 0.3517 s · flight 0.8681 s
 *
 *     entry                       travel     lands at    cooling floor spans 322.6..332.6
 *     walk 6.0, not held           5.21 m     323.31      on it
 *     run 8.6, not held            7.47 m     325.57      on it
 *     run + held (apex x1.25)      8.72 m     326.82      on it
 *     sprint 12.2, not held       10.59 m     328.69      on it
 *     sprint + held               12.37 m     330.47      on it
 *
 *   Measured from the pad's NEAR edge at x 318.10, because that is where it fires — on
 *   first contact. The required distance is 4.50 m and the plain-run flight is 7.47 m, so
 *   the last jump of the stage uses 60% of its budget with no sprint and no held jump,
 *   and all five inputs land. reachcheck's own pad-band test (which uses WALK 6.0 as the
 *   slowest credible entry) reports no shortfall and no overshoot.
 *   The pad is also the only route: the cooling floor is 4.00 m above the tap deck and a
 *   jump apexes at 2.09, so nothing else on the stage can reach it.
 */

const EMBER = 0xffb44a; // palette.accent
const MOLTEN = 0xff4a10; // palette.kill
const EDGE = 0xa8e6ff; // palette.safeEdge
const IRON = 0x8b94a4; // palette.safe
const MINT = 0x56ffd0; // palette.checkpointOn
const VIOLET = 0xc9a6ff; // palette.finish
const SLAG = 0x2a2320; // palette.deco
const RUST = 0x9a7b62; // sub-headline text

export default {
  id: 'foundry-2',
  world: 'foundry',
  name: 'PRESSURE',
  subtitle: 'The machines were here first',
  par: 215000,
  difficulty: 6,

  spawn: { p: [-3.0, 6.1, 0], yaw: 0 },
  killY: -25,

  checkpoints: [
    { p: [8.4, 6.1, 0], yaw: 0, clockOffset: 0 },
    { p: [34.7, 5.3, 0.8], yaw: 0, clockOffset: 0 },
    { p: [60.8, 6.5, 2.0], yaw: 0, clockOffset: 0.9 }, /* moved off x=63.61: the
       wrecking ball above (pivot 15.7, len 7.4, r 1.2) sweeps a thin corridor at
       x 62.1..65.2 covering the WHOLE deck in z — the old spot put every respawn
       inside it (ball bottom 7.1 vs a standing head at 8.3). 60.8 clears the
       corridor by 1.3 m and stays on the same deck (x 59.6..67.6). */
    { p: [86.16, 8.7, 1.2], yaw: 0 },
    { p: [116.86, 7.3, 1.2], yaw: 0 },
    { p: [144.26, 10.9, 0.6], yaw: 0 },
    { p: [169.86, 8.9, 0.6], yaw: 0 },
    { p: [184.46, 8.9, -8.2], yaw: 0 },
    { p: [219.03, 13.3, -6.4], yaw: 0 },
    { p: [255.7, 13.6, 0.2], yaw: 0 },
    { p: [284.9, 10.8, -1.0], yaw: 0 },
    { p: [315.6, 11.2, 0.6], yaw: 0 },
  ],

  finish: { p: [327.6, 14.8, 0.6], yaw: 0 },

  coins: [
    { p: [38.1, 6.7, -6.6] },
    { p: [63.61, 8.0, 1.4] },
    { p: [121.0, 5.3, -7.2] },
    { p: [233.15, 10.0, 6.0] },
  ],

  objects: [
    /* BEAT 1 — THE CHARGING FLOOR */
    { kind: 'platform', p: [2, 5.5, 0], s: [16, 1, 14], mat: 'stone', glow: MINT }, // top 6.00, cp0
    { kind: 'platform', p: [-1.4, 6.2, 5.0], s: [2.4, 1, 2.4], mat: 'metal', glow: EDGE, stripe: true }, // top 6.70
    { kind: 'platform', p: [1.8, 6.8, 5.0], s: [2.2, 1, 2.2], mat: 'metal', glow: EDGE, stripe: true }, // top 7.30

    { kind: 'text', p: [5.0, 9.2, -4.4], rot: [0, -Math.PI / 2, 0], text: 'PRESSURE', size: 0.82, color: EMBER },
    { kind: 'text', p: [5.0, 8.55, -4.4], rot: [0, -Math.PI / 2, 0], text: 'LAVA FOUNDRY  ·  II', size: 0.28, color: RUST },
    { kind: 'text', p: [5.0, 8.0, -4.4], rot: [0, -Math.PI / 2, 0], text: 'the machines were here first', size: 0.24, color: RUST },
    { kind: 'text', p: [9.6, 8.4, 0.6], rot: [0, -Math.PI / 2, 0], text: 'CASTING FLOOR  ·  NOTHING HERE HOLDS', size: 0.3, color: MOLTEN },

    { kind: 'deco', kindOf: 'girders', p: [11.6, 11.4, 0], s: [1.2, 1.0, 15.0], count: 3, spread: [1, 2, 14], seed: 6011, mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'pillar', p: [11.6, 8.6, 6.8], s: [1.3, 6.4, 1.3], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [11.6, 8.6, -6.8], s: [1.3, 6.4, 1.3], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'brazier', p: [6.4, 6.9, -6.0], s: [1.0, 1.4, 1.0], mat: 'metal', tint: MOLTEN },
    { kind: 'light', p: [6.4, 8.0, -6.0], color: MOLTEN, intensity: 8, distance: 16, flicker: 0.34 },
    { kind: 'light', p: [2, 9.4, 0], color: 0xffd2a0, intensity: 9, distance: 26 },

    /* BEAT 2 — THE CASTING SHELLS */
    {
      kind: 'mover', p: [15.2, 5.9, 0], s: [3.6, 1, 3.6], mat: 'metal', glow: EDGE, stripe: true,
      motion: { type: 'sink', sinkDelay: 0.34, sinkSpeed: 5.0, sinkDepth: 6, respawnAfter: 3.2, to: [15.2, -0.1, 0] },
    }, // shell 1 — top 6.40, gap 3.40 at +0.40
    {
      kind: 'mover', p: [20.9, 5.3, -3.0], s: [3.0, 1, 3.2], mat: 'metal', glow: EDGE, stripe: true,
      motion: { type: 'sink', sinkDelay: 0.28, sinkSpeed: 6.0, sinkDepth: 6, respawnAfter: 3.0, to: [20.9, -0.7, -3.0] },
    }, // shell 2 — top 5.80, gap 2.40 at -0.60
    {
      kind: 'mover', p: [27.9, 5.9, -0.6], s: [3.2, 1, 3.0], mat: 'metal', glow: EDGE, stripe: true,
      motion: { type: 'sink', sinkDelay: 0.24, sinkSpeed: 6.5, sinkDepth: 6, respawnAfter: 3.0, to: [27.9, -0.1, -0.6] },
    }, // shell 3 — top 6.40, gap 3.90 at +0.60

    { kind: 'platform', p: [34.7, 4.7, 0.8], s: [4.4, 1, 4.6], mat: 'stone', glow: MINT, stripe: true }, // the island — top 5.20, gap 3.00 at -1.20, cp1

    {
      kind: 'mover', p: [38.1, 5.3, -6.6], s: [2.6, 1, 2.6], mat: 'metal', glow: EDGE, stripe: true,
      motion: { type: 'sink', sinkDelay: 0.18, sinkSpeed: 7.5, sinkDepth: 6, respawnAfter: 3.6, to: [38.1, -0.7, -6.6] },
    }, // COIN 1 shell — top 5.80, a 3.80 m PURELY LATERAL leap off the island; rejoins the main
    // line at shell 4 (1.18 m). Shell 3 is 7.97 m away at dy -0.60 against a 7.90 m sprint
    // maximum, so no edge exists and the coin line cannot skip the island checkpoint.
    {
      kind: 'mover', p: [41.87, 5.5, -3.4], s: [2.8, 1, 2.8], mat: 'metal', glow: EDGE, stripe: true,
      motion: { type: 'sink', sinkDelay: 0.30, sinkSpeed: 5.5, sinkDepth: 6, respawnAfter: 3.4, to: [41.87, -0.5, -3.4] },
    }, // shell 4 — top 6.00, gap 3.60 at +0.80
    {
      kind: 'mover', p: [49.11, 5.1, 0.2], s: [3.0, 1, 3.0], mat: 'metal', glow: EDGE, stripe: true,
      motion: { type: 'sink', sinkDelay: 0.22, sinkSpeed: 7.0, sinkDepth: 6, respawnAfter: 3.4, to: [49.11, -0.9, 0.2] },
    }, // shell 5 — top 5.60, gap 4.40 at -0.40 — the longest jump in the pool
    {
      kind: 'mover', p: [54.51, 6.3, 3.0], s: [2.6, 1, 2.6], mat: 'metal', glow: EDGE, stripe: true,
      motion: { type: 'sink', sinkDelay: 0.20, sinkSpeed: 8.0, sinkDepth: 6, respawnAfter: 3.4, to: [54.51, 0.3, 3.0] },
    }, // shell 6 — top 6.80, gap 2.60 at +1.20 — smallest, fastest

    { kind: 'platform', p: [63.61, 5.9, 2.0], s: [8.0, 1, 8.4], mat: 'stone', glow: MINT, stripe: true }, // the crucible floor — top 6.40, gap 3.80 at -0.40, cp2

    { kind: 'lava', p: [33.0, 0.5, 0], s: [48, 3, 26] }, // surface 2.0, x 9..57

    { kind: 'deco', kindOf: 'ring', p: [38.1, 7.4, -6.6], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: EMBER },
    { kind: 'light', p: [38.1, 7.6, -6.6], color: EMBER, intensity: 7, distance: 14 },
    { kind: 'text', p: [12.6, 9.4, 0.0], rot: [0, -Math.PI / 2, 0], text: 'DO NOT STOP', size: 0.56, color: MOLTEN },
    { kind: 'text', p: [12.6, 8.8, 0.0], rot: [0, -Math.PI / 2, 0], text: 'the shells only hold once', size: 0.24, color: RUST },
    { kind: 'deco', kindOf: 'pillar', p: [34.7, 9.4, 0.8], s: [1.0, 8.0, 1.0], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'beacon', p: [34.7, 14.0, 0.8], s: [0.7, 2.4, 0.7], mat: 'emissive', tint: EMBER },
    { kind: 'deco', kindOf: 'pipes', p: [32, 12.4, 9.4], s: [42, 0.7, 0.7], count: 4, spread: [42, 1.4, 1.6], seed: 6021, mat: 'metal', tint: SLAG },
    { kind: 'deco', kindOf: 'pipes', p: [32, 13.1, -9.8], s: [42, 0.7, 0.7], count: 4, spread: [42, 1.4, 1.6], seed: 6022, mat: 'metal', tint: SLAG },
    { kind: 'deco', kindOf: 'vent', p: [19.0, 6.6, 8.4], s: [2.0, 1.6, 2.0], mat: 'metal' },
    { kind: 'deco', kindOf: 'vent', p: [46.0, 6.4, -8.6], s: [1.6, 1.2, 1.6], mat: 'metal' },
    { kind: 'light', p: [22, 3.4, 0], color: MOLTEN, intensity: 14, distance: 30, flicker: 0.13 },
    { kind: 'light', p: [48, 3.4, 0], color: MOLTEN, intensity: 14, distance: 30, flicker: 0.13 },
    { kind: 'light', p: [34.7, 7.6, 0.8], color: MINT, intensity: 8, distance: 20 },

    /* BEAT 3 — THE WRECKING BALL */
    {
      kind: 'pendulum', p: [63.61, 15.7, 1.4], len: 7.4, amp: 0.95, period: 3.6, phase: 0,
      axis: [1, 0, 0], mode: 'ball', radius: 1.2, blade: { w: 2.4, h: 2.4, d: 2.4 },
    }, // sphere bottom 7.10 = crucible floor + 0.70; swings ACROSS the run in z

    { kind: 'platform', p: [72.61, 6.7, 4.6], s: [2.8, 1, 2.8], mat: 'metal', glow: EDGE, stripe: true }, // top 7.20, gap 3.60 at +0.80
    { kind: 'platform', p: [78.06, 7.5, 1.2], s: [3.0, 1, 3.0], mat: 'metal', glow: EDGE, stripe: true }, // top 8.00, gap 2.60 at +0.80
    { kind: 'platform', p: [86.16, 8.1, 1.2], s: [5.4, 1, 6.4], mat: 'panel', glow: MINT, stripe: true }, // the pour-hall lip — top 8.60, gap 3.90 at +0.60, cp3

    { kind: 'lava', p: [72.5, 0.5, 0], s: [33, 3, 26] }, // x 56..89

    { kind: 'text', p: [59.0, 10.2, 1.6], rot: [0, -Math.PI / 2, 0], text: 'IT IS ONLY LOW IN THE MIDDLE', size: 0.3, color: MOLTEN },
    { kind: 'deco', kindOf: 'buttress', p: [63.61, 17.0, 7.2], s: [1.6, 3.2, 1.6], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'buttress', p: [63.61, 17.0, -4.4], s: [1.6, 3.2, 1.6], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'cable', p: [66, 16.6, 1.4], s: [22, 0.1, 0.1], mat: 'metal', tint: SLAG },
    { kind: 'light', p: [63.61, 12.6, 1.4], color: EMBER, intensity: 11, distance: 24 },
    { kind: 'light', p: [63.61, 8.4, 1.4], color: MOLTEN, intensity: 6, distance: 14, flicker: 0.1 },

    /* BEAT 4 — THE POUR */
    { kind: 'platform', p: [95.46, 5.9, -2.6], s: [4.0, 1, 4.4], mat: 'grate', glow: EDGE, stripe: true }, // top 6.40, gap 4.60 at -2.20 — the drop into the pit
    { kind: 'platform', p: [103.16, 6.3, 1.4], s: [3.6, 1, 3.6], mat: 'grate', glow: EDGE, stripe: true }, // top 6.80, gap 3.90 at +0.40
    { kind: 'platform', p: [109.36, 5.9, -1.8], s: [3.2, 1, 3.4], mat: 'metal', glow: EDGE, stripe: true }, // top 6.40, gap 2.80 at -0.40 — the sump mouth
    { kind: 'platform', p: [116.86, 6.7, 1.2], s: [4.4, 1, 5.0], mat: 'stone', glow: MINT, stripe: true }, // top 7.20, gap 3.70 at +0.80, cp4
    {
      kind: 'vanish', p: [124.06, 7.2, -1.6], s: [3.6, 1, 3.6], mat: 'rubber',
      cycle: { on: 2.4, off: 1.2, warn: 0.6, phase: 0.2 },
    }, // EDGE — vanish.js paints its own safeEdge rim + stripe (def.glow is not read). top 7.70, gap 3.20 at +0.50
       // mat 'rubber' (round-3 readability): this tile is read from cp4 at ~8.7 deg
       // grazing, where a smooth dielectric's Fresnel smears the warm rim/key light
       // across the whole top — measured (203,174,156) cream, INVARIANT through
       // grate -> charcoal metal (the spec term is untinted; raycast probe confirmed
       // the sampled pixels ARE this top face). Rubber's map-carried roughness
       // (0.55-1.0, metalness 0) is the one walked material whose grazing lobe
       // collapses; the dark matte top finally silhouettes. contrastcheck foundry-2 c4.
    { kind: 'platform', p: [130.96, 8.1, 1.6], s: [3.4, 1, 3.6], mat: 'grate', glow: EDGE, stripe: true }, // top 8.60, gap 3.40 at +0.90
    { kind: 'platform', p: [136.76, 8.8, -1.2], s: [3.0, 1, 3.4], mat: 'metal', glow: EDGE, stripe: true }, // top 9.30, gap 2.60 at +0.70
    { kind: 'platform', p: [144.26, 10.3, 0.6], s: [5.6, 1, 6.4], mat: 'stone', glow: MINT, stripe: true }, // top 10.80, gap 3.20 at +1.50, cp5

    { kind: 'platform', p: [115.11, 4.3, -6.4], s: [3.0, 1, 3.0], mat: 'metal', glow: EDGE, stripe: true }, // sump 1 — top 4.80
    { kind: 'platform', p: [121.0, 3.9, -7.2], s: [2.6, 1, 2.6], mat: 'metal', glow: EDGE, stripe: true }, // sump 2 — top 4.40, COIN 3
    { kind: 'platform', p: [126.21, 5.5, -5.6], s: [2.8, 1, 2.8], mat: 'metal', glow: EDGE, stripe: true }, // sump 3 — top 6.00, rejoins forward onto the grate

    { kind: 'risinglava', p: [115.5, 0.5, 0], s: [53, 3, 26], rising: { from: 2.0, to: 6.0, speed: 0.30, delay: 44 } }, // x 89..142

    { kind: 'deco', kindOf: 'ring', p: [121.0, 6.0, -7.2], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: EMBER },
    { kind: 'light', p: [121.0, 6.4, -7.2], color: EMBER, intensity: 7, distance: 14 },
    { kind: 'text', p: [82.6, 10.8, 1.2], rot: [0, -Math.PI / 2, 0], text: 'THE POUR IS COMING UP', size: 0.5, color: MOLTEN },
    { kind: 'text', p: [82.6, 10.2, 1.2], rot: [0, -Math.PI / 2, 0], text: 'the sump goes under first', size: 0.24, color: RUST },
    { kind: 'deco', kindOf: 'buttress', p: [100.0, 13.2, 6.6], s: [1.6, 2.8, 1.6], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'buttress', p: [130.0, 13.6, -9.0], s: [1.6, 2.8, 1.6], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'cable', p: [115, 15.4, 0], s: [50, 0.09, 0.09], mat: 'metal', tint: SLAG },
    { kind: 'deco', kindOf: 'screen', p: [112, 12.4, -12.0], s: [0.4, 4.4, 6.0], mat: 'emissive', tint: MOLTEN },
    { kind: 'deco', kindOf: 'slabs', p: [106.0, 3.0, 11.4], s: [3.0, 2.0, 3.0], count: 5, spread: [40, 1.2, 3], seed: 6041, tint: SLAG },
    { kind: 'light', p: [98, 4.4, 0], color: MOLTEN, intensity: 16, distance: 32, flicker: 0.16 },
    { kind: 'light', p: [132, 4.4, 0], color: MOLTEN, intensity: 16, distance: 32, flicker: 0.16 },
    { kind: 'light', p: [144.26, 12.8, 0.6], color: MINT, intensity: 9, distance: 22 },

    /* BEAT 5 — THE TRANSFER */
    { kind: 'platform', p: [153.76, 8.7, 0.6], s: [4.2, 1, 4.6], mat: 'metal', glow: EDGE, stripe: true }, // the loading step — top 9.20, gap 4.60 at -1.60
    { kind: 'conveyor', p: [160.36, 8.7, 0.6], s: [9.0, 1, 4.6], dir: [-1, 0, 0], power: 9.0, mat: 'metal' }, // BELT 1 runs BACKWARDS at conveyorMax
    {
      kind: 'laser', a: [160.36, 9.75, -2.8], b: [160.36, 9.75, 4.0], radius: 0.16,
      cycle: { on: 1.4, off: 2.0, warn: 0.5, phase: 0 }, color: MOLTEN,
    }, // low bar — 0.55 m over the belt: a crouch does not fit under it
    {
      kind: 'laser', a: [160.36, 11.45, -2.8], b: [160.36, 11.45, 4.0], radius: 0.16,
      cycle: { on: 1.4, off: 2.0, warn: 0.5, phase: 0 }, color: MOLTEN,
    }, // high bar — 2.25 m over the belt: a jump does not fit over it
    { kind: 'platform', p: [169.86, 8.3, 0.6], s: [4.4, 1, 5.0], mat: 'stone', glow: MINT, stripe: true }, // top 8.80, gap 2.80 at -0.40, cp6 — belt 1 gets its own checkpoint

    { kind: 'platform', p: [177.86, 8.3, 4.2], s: [3.6, 1, 4.0], mat: 'metal', glow: EDGE, stripe: true }, // belt 2's striped lip — top 8.80, gap 4.00 flat
    { kind: 'conveyor', p: [184.46, 8.3, -0.4], s: [9.6, 1, 9.6], dir: [0, 0, -1], power: 9.0, mat: 'metal' }, // BELT 2 runs ACROSS the course
    { kind: 'crusher', p: [184.46, 11.9, -0.4], s: [3.0, 1.5, 5.0], axis: [0, -1, 0], travel: 2.35, period: 3.3, phase: 0.35, dwell: 0.6 }, // the ram closes flush with the belt at 8.80
    { kind: 'platform', p: [184.46, 8.3, -8.2], s: [5.0, 1, 6.0], mat: 'stone', glow: MINT, stripe: true }, // flush with the belt's -z edge — top 8.80, cp6

    { kind: 'lava', p: [178.0, 0.5, 0], s: [72, 3, 32] }, // x 142..214

    { kind: 'text', p: [150.6, 11.4, 0.6], rot: [0, -Math.PI / 2, 0], text: 'THE BELT RUNS AT YOU', size: 0.44, color: MOLTEN },
    { kind: 'text', p: [150.6, 10.85, 0.6], rot: [0, -Math.PI / 2, 0], text: '9.0 m/s against you  ·  SPRINT', size: 0.24, color: RUST },
    { kind: 'text', p: [174.4, 11.0, 3.0], rot: [0, -Math.PI / 2, 0], text: 'TRANSFER  ·  IT TAKES YOU LEFT', size: 0.32, color: EMBER },
    { kind: 'deco', kindOf: 'buttress', p: [160.36, 12.8, 4.6], s: [1.6, 3.0, 1.6], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'buttress', p: [160.36, 12.8, -3.4], s: [1.6, 3.0, 1.6], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'buttress', p: [184.46, 14.4, 5.6], s: [1.6, 2.8, 1.6], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'rail', p: [160.36, 10.0, -2.4], s: [12, 0.09, 0.09], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'monolith', p: [172, 12.0, -20.0], s: [7, 22, 7], mat: 'obsidian', tint: SLAG },
    { kind: 'light', p: [160.36, 11.6, 0.6], color: MOLTEN, intensity: 10, distance: 22, flicker: 0.12 },
    { kind: 'light', p: [169.86, 11.0, 0.6], color: MINT, intensity: 9, distance: 20 },
    { kind: 'light', p: [184.46, 10.8, -0.4], color: MOLTEN, intensity: 9, distance: 20, flicker: 0.1 },
    { kind: 'light', p: [184.46, 10.8, -8.2], color: MINT, intensity: 9, distance: 22 },

    /* BEAT 6 — THE SLAG STAIR AND THE TURN */
    { kind: 'platform', p: [192.76, 9.1, -8.2], s: [4.0, 1, 4.4], mat: 'panel', glow: EDGE, stripe: true }, // top 9.60, gap 3.80 at +0.80
    { kind: 'platform', p: [199.36, 10.3, -4.8], s: [3.6, 1, 4.0], mat: 'panel', glow: EDGE, stripe: true }, // top 10.80, gap 2.80 at +1.20
    { kind: 'beam', p: [208.23, 10.75, -1.8], s: [7.0, 0.7, 1.0], mat: 'metal' }, // beam A runs along +X — top 11.10, gap 3.60 at +0.30
    { kind: 'beam', p: [212.28, 11.25, -4.6], s: [1.1, 0.7, 6.4], mat: 'metal' }, // beam B runs along -Z — top 11.60, a 0.50 m STEP: the corner is walked, not jumped
    { kind: 'platform', p: [219.03, 12.7, -6.4], s: [6.4, 1, 7.0], mat: 'stone', glow: MINT, stripe: true }, // the gallery — top 13.20, gap 3.00 at +1.60 off beam B, cp7

    { kind: 'text', p: [203.6, 12.4, -3.6], rot: [0, -Math.PI / 2, 0], text: 'NARROW  ·  AND IT TURNS', size: 0.3, color: EMBER },
    { kind: 'deco', kindOf: 'rail', p: [208.23, 12.2, -1.0], s: [7.0, 0.08, 0.08], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'rail', p: [213.1, 12.7, -4.6], s: [0.08, 0.08, 6.4], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'lantern', p: [205.0, 12.0, -1.0], s: [0.6, 0.9, 0.6], mat: 'emissive', tint: EMBER },
    { kind: 'deco', kindOf: 'lantern', p: [213.1, 12.5, -8.2], s: [0.6, 0.9, 0.6], mat: 'emissive', tint: EMBER },
    { kind: 'deco', kindOf: 'girders', p: [200.0, 5.0, -15.0], s: [10, 4.0, 3.0], count: 5, spread: [18, 5, 4], seed: 6061, mat: 'metal', tint: SLAG },
    { kind: 'light', p: [210.0, 13.0, -3.2], color: EMBER, intensity: 9, distance: 22 },
    { kind: 'light', p: [219.03, 15.4, -6.4], color: MINT, intensity: 9, distance: 22 },

    /* BEAT 7 — THE LADLE GANTRY */
    { kind: 'platform', p: [230.6, 10.0, 1.4], s: [10, 1, 3.6], mat: 'grate', glow: EDGE, stripe: true }, // the gantry — top 10.50, gap 4.20 at -2.70
    {
      kind: 'rotor', p: [230.6, 15.2, 1.4], style: 'windmill', arms: 2, len: 3.0, thick: 0.5,
      period: 2.2, phase: 0, axis: [0, 0, 1], tilt: 0, mount: 0,
    }, // rotors.js:621 — the KILL is a capsule of radius max(thick, rootC*0.30) = 0.50 along
    // innerR..innerR+len = 0.45..3.45, so the lethal underside is 15.20 - 3.95 = 11.25,
    // 0.75 m over the gantry: too low to crouch (1.05). `mount: 0` suppresses the bracket
    // arm (rotors.js:381-427 would otherwise drop a solid collider into the walkway);
    // the deco A-frame below carries the wheel visually.
    { kind: 'deco', kindOf: 'girders', p: [230.6, 13.0, 1.4], s: [1.2, 5.2, 6.4], count: 2, spread: [0.6, 4.0, 6.0], seed: 6071, mat: 'metal', tint: SLAG },

    { kind: 'platform', p: [230.6, 8.6, 5.6], s: [2.4, 1, 2.2], mat: 'obsidian', glow: IRON }, // anvil 1 — top 9.10, a 1.30 m STEP DOWN off the gantry: IRON, no stripe
    { kind: 'platform', p: [235.7, 9.0, 6.4], s: [2.4, 1, 2.2], mat: 'obsidian', glow: EDGE, stripe: true }, // anvil 2 — top 9.50, a 2.70 m jump over open spike tips, COIN 4 in the air between

    { kind: 'platform', p: [240.5, 11.2, -1.0], s: [3.4, 1, 3.0], mat: 'metal', glow: EDGE, stripe: true }, // top 11.70, gap 3.20 at +1.20
    { kind: 'platform', p: [246.3, 12.4, 1.8], s: [3.0, 1, 3.0], mat: 'metal', glow: EDGE, stripe: true }, // top 12.90, gap 2.60 at +1.20
    { kind: 'platform', p: [255.7, 13.0, 0.2], s: [8.0, 1, 2.4], mat: 'stone', glow: MINT, stripe: true }, // the ladle rim — top 13.50, gap 3.90 at +0.60, the high point of the hall, cp9
    { kind: 'platform', p: [265.9, 11.6, -2.2], s: [3.4, 1, 3.4], mat: 'metal', glow: EDGE, stripe: true }, // top 12.10, gap 4.50 at -1.40

    { kind: 'platform', p: [274.6, 10.8, 0.6], s: [8.0, 1, 2.6], mat: 'grate', glow: EDGE, stripe: true }, // the blade walk — top 11.30, gap 3.00 at -0.80
    {
      kind: 'pendulum', p: [274.6, 19.48, 0.6], len: 6.4, amp: 0.7, period: 3.3, phase: Math.PI / 3,
      axis: [0, 0, 1], mode: 'blade', blade: { w: 2.6, h: 1.8, d: 0.28 },
    }, // pendulum.js:535 — the blade's KILL capsule sits at -armLen - h*0.52 with radius
    // max(th*1.15, h*0.30) = 0.54, so its underside is 19.48 - 7.876 = 11.60, 0.30 m over
    // the walk; the VISIBLE blade bottom (-armLen - h*0.4925) is 12.19, 0.89 m over it.
    // A crouched player's head is at 12.35, so both readings agree: you cannot duck it.
    // Swings ALONG the run (axis [0,0,1]) — the opposite plane to the BEAT 3 ball.

    { kind: 'platform', p: [284.9, 10.2, -1.0], s: [5.0, 1, 5.0], mat: 'stone', glow: MINT, stripe: true }, // top 10.70, gap 3.80 at -0.60, cp8

    {
      kind: 'vanish', p: [292.7, 9.8, 1.0], s: [3.4, 1, 3.2], mat: 'rubber',
      cycle: { on: 2.2, off: 1.1, warn: 0.5, phase: 0.0 },
    }, // EDGE — vanish.js paints its own safeEdge rim + stripe. top 10.30, gap 3.60 at -0.40
       // mat 'rubber' (round-3 readability): same ~8 deg grazing spec smear as the
       // pit tile at c4 — (218,194,184) cream through three material swaps. The
       // matte rubber top is the fix. contrastcheck foundry-2 c10.
    { kind: 'crusher', p: [295.8, 11.7, 4.6], s: [2.2, 2.2, 1.8], axis: [0, 0, -1], travel: 3.6, period: 3.3, phase: 0.4, dwell: 0.9 }, // side ram, on the grates' OWN 3.3 s period
    {
      kind: 'vanish', p: [298.9, 9.8, 1.0], s: [3.4, 1, 3.2], mat: 'rubber',
      cycle: { on: 2.2, off: 1.1, warn: 0.5, phase: 0.5 },
    }, // EDGE — half a cycle out of step with grate 1: never both gone.
       // mat 'rubber' with its pair — see the c10 tile note above.
    { kind: 'platform', p: [306.7, 10.4, -0.6], s: [5.0, 1, 4.6], mat: 'stone', glow: EDGE, stripe: true }, // hall exit — top 10.90, gap 3.60 at +0.60

    { kind: 'spikes', p: [253.5, 8.0, 1.0], s: [57, 1.2, 14], dir: [0, 1, 0] }, // tips 8.60, x 225..282, z -6..8

    { kind: 'text', p: [224.4, 13.2, 1.4], rot: [0, -Math.PI / 2, 0], text: 'THE LADLE GANTRY', size: 0.62, color: MOLTEN },
    { kind: 'text', p: [224.4, 12.5, 1.4], rot: [0, -Math.PI / 2, 0], text: 'over the ladle, then down', size: 0.26, color: RUST },
    { kind: 'text', p: [269.4, 13.4, 0.6], rot: [0, -Math.PI / 2, 0], text: 'IT SWINGS AT YOU, NOT ACROSS', size: 0.3, color: MOLTEN },
    { kind: 'text', p: [289.6, 12.2, 1.0], rot: [0, -Math.PI / 2, 0], text: 'ONE HALF AT A TIME', size: 0.3, color: EMBER },
    { kind: 'deco', kindOf: 'ladle', p: [255.7, 6.4, 0.2], s: [10.0, 10.0, 10.0], mat: 'obsidian', tint: SLAG },
    { kind: 'deco', kindOf: 'ring', p: [233.15, 10.0, 6.0], s: [0.12, 2.0, 2.0], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: EMBER },
    { kind: 'deco', kindOf: 'buttress', p: [230.6, 15.4, 5.4], s: [1.5, 3.0, 1.5], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'buttress', p: [255.7, 17.0, -4.4], s: [1.5, 3.0, 1.5], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'buttress', p: [295.8, 13.6, 7.4], s: [1.5, 3.0, 1.5], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'grate', p: [258.0, 23.0, 0], s: [80, 0.2, 6.0], mat: 'grate', tint: SLAG },
    { kind: 'deco', kindOf: 'rail', p: [230.6, 11.7, -0.7], s: [10, 0.09, 0.09], mat: 'metal', tint: MOLTEN },
    { kind: 'deco', kindOf: 'rail', p: [274.6, 12.0, 2.1], s: [8, 0.09, 0.09], mat: 'metal', tint: MOLTEN },
    { kind: 'light', p: [230.6, 13.0, 1.4], color: MOLTEN, intensity: 11, distance: 24, flicker: 0.09 },
    { kind: 'light', p: [255.7, 15.8, 0.2], color: MINT, intensity: 10, distance: 24 },
    { kind: 'light', p: [274.6, 13.8, 0.6], color: MOLTEN, intensity: 11, distance: 24, flicker: 0.09 },
    { kind: 'light', p: [295.8, 12.6, 1.0], color: EMBER, intensity: 9, distance: 20 },
    { kind: 'light', p: [284.9, 12.8, -1.0], color: MINT, intensity: 9, distance: 22 },

    /* BEAT 8 — THE TAP */
    { kind: 'platform', p: [317.1, 10.2, 0.6], s: [8.0, 1, 7.0], mat: 'stone', glow: MINT, stripe: true }, // the tap deck — top 10.70, gap 3.90 at -0.20, cp9
    { kind: 'jumppad', p: [319.6, 10.77, 0.6], s: [3, 0.14, 3], power: 7.2, dir: [0, 1, 0] }, // pad top 10.84, near edge x 318.10
    { kind: 'platform', p: [327.6, 14.2, 0.6], s: [10, 1, 11], mat: 'obsidian', glow: VIOLET, stripe: true }, // the cooling floor — top 14.70, x 322.6..332.6

    { kind: 'lava', p: [269.0, 0.5, 0], s: [110, 3, 32] }, // x 214..324

    { kind: 'text', p: [311.6, 12.4, 0.6], rot: [0, -Math.PI / 2, 0], text: 'THE TAP', size: 0.62, color: VIOLET },
    { kind: 'text', p: [311.6, 11.8, 0.6], rot: [0, -Math.PI / 2, 0], text: 'walk on  ·  it does the rest', size: 0.24, color: RUST },
    { kind: 'text', p: [324.8, 17.0, 0.6], rot: [0, -Math.PI / 2, 0], text: 'PRESSURE', size: 0.44, color: VIOLET },
    { kind: 'deco', kindOf: 'arch', p: [327.6, 20.2, 0.6], s: [1.4, 1.0, 11.4], mat: 'obsidian', tint: VIOLET },
    { kind: 'deco', kindOf: 'pillar', p: [327.6, 17.6, 6.0], s: [1.3, 5.8, 1.3], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [327.6, 17.6, -4.8], s: [1.3, 5.8, 1.3], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'beacon', p: [331.8, 16.8, 0.6], s: [0.7, 3.0, 0.7], mat: 'emissive', tint: VIOLET },
    { kind: 'light', p: [327.6, 18.2, 0.6], color: VIOLET, intensity: 20, distance: 34 },
    { kind: 'light', p: [317.1, 12.6, 0.6], color: MINT, intensity: 10, distance: 22 },

    /* THE FOUNDRY — outside the play corridor */
    { kind: 'deco', kindOf: 'monolith', p: [60, 6.0, 27], s: [9, 30, 9], count: 7, spread: [140, 14, 20], seed: 6091, tint: SLAG },
    { kind: 'deco', kindOf: 'monolith', p: [60, 4.0, -27], s: [9, 30, 9], count: 7, spread: [140, 14, 20], seed: 6092, tint: SLAG },
    { kind: 'deco', kindOf: 'monolith', p: [250, 6.0, 29], s: [11, 36, 11], count: 8, spread: [170, 16, 22], seed: 6093, tint: 0x33221a },
    { kind: 'deco', kindOf: 'monolith', p: [250, 4.0, -29], s: [11, 36, 11], count: 8, spread: [170, 16, 22], seed: 6094, tint: 0x33221a },

    { kind: 'deco', kindOf: 'pipes', p: [163, 20.0, 14.5], s: [280, 0.9, 0.9], count: 5, spread: [280, 2, 2], seed: 6095, mat: 'metal', tint: SLAG },
    { kind: 'deco', kindOf: 'pipes', p: [163, 21.4, -14.5], s: [280, 0.9, 0.9], count: 5, spread: [280, 2, 2], seed: 6096, mat: 'metal', tint: SLAG },
    { kind: 'deco', kindOf: 'cable', p: [163, 24.0, 0], s: [310, 0.1, 0.1], mat: 'metal', tint: 0x1a1310 },
    { kind: 'deco', kindOf: 'antennae', p: [163, 14, 33], s: [0.7, 18, 0.7], count: 7, spread: [300, 6, 12], seed: 6097, tint: SLAG },

    { kind: 'deco', kindOf: 'emblem', p: [90, 15.6, 12.8], s: [0.4, 3.4, 3.4], mat: 'emissive', tint: MOLTEN },
    { kind: 'deco', kindOf: 'banner', p: [198, 14.0, 13.4], s: [0.14, 6.0, 3.2], mat: 'panel', tint: MOLTEN },
    { kind: 'deco', kindOf: 'banner', p: [264, 15.0, -13.4], s: [0.14, 6.0, 3.2], mat: 'panel', tint: EMBER },
    { kind: 'deco', kindOf: 'rocks', p: [163, 0.4, 18], s: [3, 2, 3], count: 14, spread: [310, 1.4, 14], seed: 6098, tint: 0x1c1310 },
    { kind: 'deco', kindOf: 'rocks', p: [163, 0.4, -18], s: [3, 2, 3], count: 14, spread: [310, 1.4, 14], seed: 6099, tint: 0x1c1310 },

    { kind: 'light', p: [10, 3.0, 0], color: MOLTEN, intensity: 12, distance: 28, flicker: 0.12 },
    { kind: 'light', p: [76, 3.0, 0], color: MOLTEN, intensity: 12, distance: 28, flicker: 0.12 },
    { kind: 'light', p: [204, 3.0, 0], color: MOLTEN, intensity: 12, distance: 28, flicker: 0.12 },
    { kind: 'light', p: [252, 3.0, 0], color: MOLTEN, intensity: 12, distance: 28, flicker: 0.12 },
    { kind: 'light', p: [308, 3.0, 0], color: MOLTEN, intensity: 12, distance: 28, flicker: 0.12 },
  ],
};
