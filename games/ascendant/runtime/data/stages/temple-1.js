/**
 * ASCENDANT — SKY TEMPLE 1 : "ASCENSION"
 * runtime/data/stages/temple-1.js
 *
 * Golden hour, five kilometres up. A ruined temple broken across a cloud sea: a rime
 * terrace on its shaded south flank, a wind-scoured courtyard, a well you climb DOWN
 * into, a carousel of two counter-turning rings, and a bronze bell the size of a house
 * hung under a rock arch, which you cross by walking round its shoulder and dropping
 * through its mouth.
 *
 * SHAPE      ~330 m of travel, 97 gameplay objects (3.4 m per object — the densest
 *            stage in the game), 6 checkpoints, 5 coins, 36 dynamic hazards across
 *            TEN families: jumppad, speedpad, wind, mover, vanish, ice, conveyor,
 *            rotor, pendulum, crusher. Difficulty 5.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * THE FOUR LAWS THIS STAGE IS BUILT ON  (each one is checked, not asserted)
 * ─────────────────────────────────────────────────────────────────────────────────
 *
 * 1. A PAD IS A FIXED ARC, AND IT RISES AT gravFall.
 *    controller.js `_applyBounce` sets `vel.y = sqrt(2 * gravFall * power)` and raises
 *    `_bounceRise`; `_gravity` then reads `vel.y > 0 ? (this._bounceRise ? gravFall :
 *    gravRise)`. BOTH halves of a bounce run at 54, not 38. Every arc below is
 *    t = sqrt(2p/54) + sqrt(2(p-dy)/54), measured from the point the pad actually
 *    fires — first ground contact, one player radius (0.35) short of the pad's near
 *    edge — NOT from the pad's centre.
 *
 * 2. THE DECK MUST SWALLOW THE WHOLE ENTRY-SPEED BAND.
 *    A pad adds nothing horizontal, and `capAir = max(preSpeed, speedAirCap)` never
 *    bleeds what you arrived with, so the landing point is set by how fast you were
 *    moving when you touched it — and holding jump on the contact frame buys another
 *    25% of apex (BOUNCE_HELD_BONUS), which stretches the flight again. Every pad on
 *    this stage lands on a deck that starts at least 0.9 m BEFORE a 6 m/s stroll comes
 *    down and ends at least 1.4 m PAST where a 12.2 m/s sprint with a held bounce
 *    does. Nobody dies here for being timid, and nobody overshoots for being quick.
 *
 * 3. EVERY LANDING IS READABLE BEFORE YOU CAN NO LONGER CHANGE IT.
 *    For a plain jump that means the landing's top face is at or below the take-off
 *    eye line (feet + 1.62). For a pad it means the hoop hangs at the exact apex so
 *    the height is visible before you touch anything, AND the landing deck's top face
 *    clears your eye line inside the first 8% of the flight — with the other 92% left
 *    to steer in. Both numbers are printed against each pad below.
 *
 * 4. A WIND VOLUME IS A MARGIN, NEVER A ROUTE, AND NEVER TOUCHES A FLOOR.
 *    Wind is `vel += power * dt`; against ground friction 13 a column of power p
 *    parks a standing player at p/13 m/s of unrequested drift, which reads as stick
 *    drift, not as design. So every wind volume on this stage sits ENTIRELY over the
 *    void: its base is above the top face of every surface you can stand still on.
 *    You feel wind only while you are already in the air.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * THE SHAPE OF THE THING
 * ─────────────────────────────────────────────────────────────────────────────────
 * It is not a corridor. The route leaves the centre line four times and comes back:
 * out to z +14 across the rime terrace, out to z +19 down into the well (where it
 * also runs 14 m BACKWARDS in x), out to z -11 around the bell's shoulder, and it
 * DESCENDS three separate times — 4.4 → 3.6 on the ice, 14.2 → 8.4 into the well,
 * 22.9 → 20.4 through the bell's mouth. 32 of 68 landable surfaces sit off the centre
 * line. There is no single beat you could paste twice and no two gameplay objects on
 * the stage share a size, a period and a material.
 *
 * BEAT MAP
 *   1  THE THRESHOLD      walk, look down, understand the drop
 *   2  READ THE EDGE      six hops, wandering ±6 m off the line
 *   3  PAD SCHOOL         one pad, in isolation, onto a deck that cannot punish it
 *   4  THE RIME TERRACE   ice, downhill, off-axis, into a counterweight lift
 *   5  THE CENSER         a swinging censer, and a coin you have to crouch for
 *   6  THE THERMAL        a pad, then the stage's only sprint gap with a column in it
 *   7  THE WELL           a crosswind bridge, then DOWN and BACKWARDS round a wheel
 *   8  THE CAROUSEL       two counter-turning rings; never more than 3.9 s to wait
 *   9  THE CRUMBLING STAIR vanish tiles, a fork, a shuttle
 *  10  THE GLASS CAUSEWAY a speed pad that survives, because it lands on ice
 *  11  THE GREAT BELL     round its shoulder, under its hammer, through its mouth
 *
 * WHY THE CAROUSEL IS TWO RINGS AND NOT THREE ORBITS IN A ROW
 *   Three slow orbits in series is not three challenges, it is three queues. Inner
 *   ring 7 s, outer ring 9 s turning the other way: relative angular rate is
 *   2π/7 + 2π/9 = 1.596 rad/s, so they line up every 3.94 s and the longest you can
 *   ever be made to stand still is under four seconds. The whole crossing is about
 *   eleven seconds and you are moving for most of them.
 *
 * WHY THE SPEED PAD IS ON ICE
 *   `_applySpeedPad` is `vel.x += dir.x * power` — an add, and nothing holds it.
 *   On stone, friction 13 bleeds the excess with a 1/13 s time constant: the boost is
 *   gone inside two metres, which is why a speed pad nine metres from a take-off is a
 *   lie. On ice, friction is 1.4. The pad sits ON the causeway at x 249; 6.8 m later
 *   at the lip you still carry 8.6 + 6.0·e^(−1.4·0.47) = 11.7 m/s. That is what the
 *   coin spur is priced against, and the main line does not need it at all.
 *
 * CHECKPOINTS: six. Longest leg 55 m (the well), shortest 27 m. Every clockOffset is
 * 0, so the phase you are shown after a death is the phase you were shown before it.
 * cp5 stands on the launch court's west lip, 1.7 m clear of the pad — a respawn never
 * fires anything.
 *
 * CONVENTIONS: p = CENTRE, s = FULL size, top = p[1] + s[1]/2. Gaps in comments are
 * EDGE TO EDGE. yaw 0 faces +X. A mover's `p` is its HOME pose and `motion.to` its far
 * pose; for 'orbit', `p` is the ORBIT CENTRE and phase 0 puts the deck at +Z (the
 * orbit basis is bu = X̂ × ŷ = +Ẑ — movers.js:356). `glow` is a MULTIPLIER on emissive
 * gain (builders.js:909), not a colour — colours come from the theme palette.
 *
 * HEIGHT LADDER  0.5 → 1.4 → 4.4 → (down 3.6) → 11.2 → 14.2 → (down 8.4) → 14.8
 *                → 15.8 → 18.5 → 21.1 → 22.9 → (down 20.4) → 19.9 → 23.0
 */

const GOLD = 0xffc35c; // theme accent — pads, hoops, warm trim
const CREAM = 0xfff8e6; // theme safeEdge — the "you can land here" stripe colour
const MINT = 0x18d69a; // theme checkpointOn — used only on checkpoint furniture
const SKY = 0x8fc0ff; // theme fill — wind, air, anything that is not stone
const VIOLET = 0xd9b6ff; // theme finish — used for nothing else anywhere in the game
const HAZE = 0x6d8fc0; // far architecture, the other side of the cloud sea

export default {
  id: 'temple-1',
  world: 'temple',
  name: 'ASCENSION',
  subtitle: 'Nothing under you but weather',
  par: 205000,
  difficulty: 5,

  spawn: { p: [0, 0.7, 0], yaw: 0 },
  killY: -45,

  checkpoints: [
    // The approach deck, one walk short of the first pad. Everything before this is a
    // hop you could take twice; everything after it is a launch you cannot take back.
    { p: [39.0, 1.6, 0], yaw: 0, clockOffset: 0 },
    // The west terrace, at the top of the counterweight lift and out of the censer's
    // arc. You can watch the censer swing three times and lose nothing but time.
    { p: [90.0, 11.4, 12.6], yaw: 0, clockOffset: 0 },
    // The great courtyard, clear of the thermal and 8 m short of the sprint gap.
    { p: [116.2, 14.4, 0], yaw: 0, clockOffset: 0 },
    // The east landing, back up out of the well and pointed at the carousel.
    { p: [159.4, 15.0, 12.0], yaw: -0.9, clockOffset: 0 },
    // The stair landing. The crumbling stair is the only thing on this stage that
    // takes the floor away from you, so it gets a checkpoint on each side of it.
    { p: [231.4, 18.7, 0], yaw: 0, clockOffset: 0 },
    // The launch court's WEST lip — 1.7 m clear of the pad, so a respawn here never
    // fires it. Ahead: the bell, and 70 m with no floor under any part of it.
    { p: [263.4, 18.7, 0], yaw: 0, clockOffset: 0 },
  ],

  finish: { p: [337.4, 23.2, 0], yaw: 0 },

  coins: [
    { p: [50.0, 5.6, -11.2] }, // 1 — out along a 1.0 m rib with nothing under it
    { p: [91.0, 11.9, 19.4] }, // 2 — in a 1.15 m slot: the only crouch on the stage
    { p: [145.0, 15.4, 7.0] }, // 3 — on a vanish tile downwind of the bridge
    { p: [138.4, 9.4, 18.8] }, // 4 — 1.8 m BELOW the well floor, under the wheel
    { p: [262.4, 20.0, 8.2] }, // 5 — only the speed pad's carry reaches this
  ],

  objects: [
    /* ============================================================================ */
    /* BEAT 1 — THE THRESHOLD                                                       */
    /* A floor you cannot fall off, two risers that both clear stepUp (0.55) on       */
    /* purpose, and a low dais to stand on and look down from. The only job of these  */
    /* twenty seconds is the cloud sea.                                              */
    /* ============================================================================ */

    { kind: 'platform', p: [2, 0, 0], s: [14, 1, 14], mat: 'stone', glow: 1.0, stripe: true }, // x -5..9, top 0.5
    { kind: 'platform', p: [1.0, 0.85, -5.2], s: [2.6, 0.7, 2.6], mat: 'sand', glow: 1.2, stripe: true }, // top 1.20
    { kind: 'platform', p: [4.2, 1.15, -5.2], s: [2.4, 1.3, 2.4], mat: 'sand', glow: 1.2, stripe: true }, // top 1.80
    { kind: 'platform', p: [6.2, 0.4, 4.8], s: [3.4, 0.8, 3.4], mat: 'sand', glow: 1.1, stripe: true }, // the dais, top 0.80

    { kind: 'text', p: [-4.2, 2.9, 0], rot: [0, -Math.PI / 2, 0], text: 'ASCENSION', size: 0.82, color: GOLD },
    { kind: 'text', p: [-4.2, 2.25, 0], rot: [0, -Math.PI / 2, 0], text: 'SKY TEMPLE  ·  I', size: 0.28, color: 0xc9b48c },
    { kind: 'text', p: [-4.2, 1.7, 0], rot: [0, -Math.PI / 2, 0], text: 'there is no floor after this one', size: 0.24, color: 0xd8a06a },
    { kind: 'text', p: [4.2, 3.0, -5.2], rot: [0, -Math.PI / 2, 0], text: 'step up', size: 0.24, color: CREAM },

    { kind: 'deco', kindOf: 'spires', p: [8.6, 0.5, 6.6], count: 5, spread: 1.6, scale: 3.4, seed: 411, mat: 'stone' },
    { kind: 'deco', kindOf: 'spires', p: [8.6, 0.5, -6.6], count: 5, spread: 1.6, scale: 3.4, seed: 412, mat: 'stone' },
    { kind: 'deco', kindOf: 'slabs', p: [4.6, 0.5, 5.4], count: 7, spread: 2.2, scale: 1.5, seed: 413, mat: 'stone' },
    { kind: 'deco', kindOf: 'crystals', p: [0.4, 0.5, 5.4], count: 6, spread: 1.0, scale: 1.2, seed: 414, glow: 1.6 },
    { kind: 'light', p: [0.4, 2.6, 5.4], color: GOLD, intensity: 7, distance: 16, flicker: 0.26 },
    { kind: 'light', p: [3, 4.4, 0], color: 0xffe6bf, intensity: 9, distance: 26 },

    /* ============================================================================ */
    /* BEAT 2 — READ THE EDGE                                                       */
    /* Six hops with nothing under them: 2.60 / 2.50 / 3.14 / 2.32 at +0.45 / 2.21 at */
    /* +0.45 / 1.60. The lesson is not "how far can I jump", it is "the bright line   */
    /* on the far side is the surface". The line wanders from z 0 out to z −5.6 and    */
    /* back, so nobody clears this on autopilot, and every landing top face is at or   */
    /* below the take-off eye line (Law 3).                                          */
    /* ============================================================================ */

    { kind: 'platform', p: [13.4, 0, 0], s: [3.6, 1, 5.0], mat: 'sand', glow: 1.3, stripe: true }, // gap 2.60, top 0.5
    { kind: 'platform', p: [19.2, 0, 2.8], s: [3.0, 1, 4.0], mat: 'sand', glow: 1.3, stripe: true }, // gap 2.50, drifts +Z
    { kind: 'platform', p: [24.8, 0, -2.4], s: [2.8, 1, 3.2], mat: 'sand', glow: 1.3, stripe: true }, // gap 3.14 diagonal
    { kind: 'platform', p: [29.8, 0.45, -5.6], s: [2.6, 1, 2.6], mat: 'sand', glow: 1.3, stripe: true }, // gap 2.32 at +0.45, top 0.95
    { kind: 'platform', p: [34.6, 0.9, -2.8], s: [2.6, 1, 2.6], mat: 'sand', glow: 1.3, stripe: true }, // gap 2.21 at +0.45, top 1.40
    { kind: 'platform', p: [42.0, 0.9, 0], s: [9, 1, 9], mat: 'stone', glow: 1.0, stripe: true }, // the approach deck, gap 1.60, x 37.5..46.5, top 1.40

    { kind: 'text', p: [11.0, 2.4, 3.8], rot: [0, -Math.PI / 2, 0], text: 'the bright edge is the edge', size: 0.26, color: 0xc9b48c },
    { kind: 'deco', kindOf: 'rocks', p: [21.0, -3.4, 7.4], count: 9, spread: 6.0, scale: 3.2, seed: 611, mat: 'stone' },
    { kind: 'deco', kindOf: 'rocks', p: [27.0, -4.2, -9.6], count: 9, spread: 6.0, scale: 3.0, seed: 622, mat: 'stone' },
    { kind: 'deco', kindOf: 'fins', p: [30.2, 1.0, -8.4], count: 4, spread: 1.2, scale: 2.6, seed: 633, mat: 'stone' },
    { kind: 'light', p: [24.0, 3.2, 0], color: 0xffdca8, intensity: 6, distance: 24 },

    /* ============================================================================ */
    /* BEAT 3 — PAD SCHOOL                                                          */
    /*                                                                              */
    /* ONE pad, in isolation, and then the verb changes. There is no pad-island-pad-  */
    /* island ladder on this stage: a pad is a thing you learn once, not a module you */
    /* stamp three times.                                                            */
    /*                                                                              */
    /* PAD 1  power 6.5, top 1.54, apex 8.04 — and the hoop hangs at 8.04, so the     */
    /*        height is a thing you SEE before you touch anything.                    */
    /*        arc  t = sqrt(13/54) + sqrt(7.14/54) = 0.4907 + 0.3636 = 0.854 s        */
    /*        fires at x 42.55 (near edge 42.90 less the 0.35 m radius)               */
    /*        walk 6.0 m/s  -> 47.68     |  deck starts 46.80  (0.88 m of margin)     */
    /*        run  8.6 m/s  -> 49.90     |  deck 46.80..58.40, so this is dead centre */
    /*        sprint 12.2 + held bounce (apex 8.125, t 0.987 s) -> 54.59 (3.81 spare) */
    /*        the deck's top face clears the eye line 50 ms in — 5.9% of the flight,  */
    /*        with 94% of it left to steer.                                          */
    /* ============================================================================ */

    { kind: 'jumppad', p: [44.4, 1.47, 0], s: [3.0, 0.14, 3.6], power: 6.5, dir: [0, 1, 0] }, // deck top 1.40 + 0.07 = pad top 1.54
    { kind: 'deco', kindOf: 'crystals', p: [44.4, 8.04, 0], count: 8, spread: 1.7, scale: 0.9, seed: 701, glow: 2.2 }, // the hoop, AT the apex
    { kind: 'text', p: [39.4, 3.4, 0], rot: [0, -Math.PI / 2, 0], text: 'RUN ONTO IT', size: 0.54, color: GOLD },
    { kind: 'text', p: [39.4, 2.85, 0], rot: [0, -Math.PI / 2, 0], text: 'the ring is where you will be', size: 0.24, color: 0xc9b48c },

    { kind: 'platform', p: [52.6, 3.9, 0], s: [11.6, 1, 9], mat: 'stone', glow: 1.0, stripe: true }, // the pad deck, x 46.80..58.40, top 4.40

    // -- COIN 1: a 1.0 m rib running north off the deck, 7.4 m of it, nothing under
    //    any of it. No wind, no timing, nothing but the willingness to walk away from
    //    the route on a plank.
    { kind: 'beam', p: [50.0, 3.9, -8.4], s: [1.0, 1, 7.4], mat: 'stone', glow: 1.6 }, // z -12.10..-4.70, top 4.40
    { kind: 'deco', kindOf: 'crystals', p: [50.0, 4.4, -11.2], count: 5, spread: 0.7, scale: 0.9, seed: 702, glow: 2.4 },
    { kind: 'light', p: [50.0, 6.2, -11.2], color: GOLD, intensity: 8, distance: 15 },

    { kind: 'deco', kindOf: 'spires', p: [52.6, 4.4, 4.2], count: 4, spread: 1.4, scale: 4.2, seed: 703, mat: 'stone' },
    { kind: 'deco', kindOf: 'girders', p: [52.6, 3.2, 0], count: 6, spread: 4.0, scale: 2.2, seed: 704, mat: 'metal' }, // the deck's underside
    { kind: 'light', p: [50.0, 7.6, 0], color: 0xffdca8, intensity: 10, distance: 26 },

    /* ============================================================================ */
    /* BEAT 4 — THE RIME TERRACE                                                    */
    /* The route turns off the centre line and goes DOWN. Three ice slabs on the      */
    /* temple's shaded south flank, 4.40 → 4.00 → 3.60, curving out to z +12.6 — the  */
    /* first descent in the game's last world and the only place on this stage you    */
    /* have less than full authority over your feet (iceFriction 1.4, iceAccel 26).   */
    /* Then a scree conveyor that runs WITH you at 5 m/s and hands you to the         */
    /* counterweight.                                                                */
    /*                                                                              */
    /* THE COUNTERWEIGHT is the answer to "how do I get up 7.6 m without a pad": you  */
    /* ride. period 6.6 with a 1.1 s dwell at each end (dwellFrac 0.167, so 2.2 s of  */
    /* travel each way) — worst case you wait 4.4 s, typical 2.2, and you can see the */
    /* whole cycle from the conveyor before you commit to it.                        */
    /* ============================================================================ */

    { kind: 'ice', p: [60.2, 3.9, 6.0], s: [5.2, 1, 4.2], color: SKY }, // x 57.6..62.8, top 4.40 — flush with the deck's south-east corner
    { kind: 'ice', p: [64.8, 3.5, 9.8], s: [4.6, 1, 3.8], color: SKY }, // top 4.00, steps down and out
    { kind: 'ice', p: [69.6, 3.1, 12.6], s: [4.2, 1, 3.4], color: SKY }, // gap 0.40 at −0.40, top 3.60
    { kind: 'conveyor', p: [76.0, 3.1, 12.6], s: [7.2, 1, 4.2], dir: [1, 0, 0], power: 5.0, mat: 'conveyor' }, // gap 0.70, top 3.60

    {
      kind: 'mover',
      p: [83.6, 3.1, 12.6],
      s: [4.6, 1, 4.6],
      mat: 'metal',
      glow: 1.4,
      stripe: true,
      motion: { type: 'linear', to: [83.6, 10.7, 12.6], period: 6.6, dwell: 1.1, ease: 'sine' },
    }, // THE COUNTERWEIGHT — boards at top 3.60 (gap 1.70 off the conveyor), sets you down at 11.20

    { kind: 'platform', p: [91.0, 10.7, 12.6], s: [9, 1, 8], mat: 'stone', glow: 1.0, stripe: true }, // the west terrace, x 86.5..95.5, z 8.6..16.6, top 11.20

    { kind: 'text', p: [57.0, 5.6, 6.0], rot: [0, -Math.PI / 2, 0], text: 'RIME', size: 0.46, color: SKY },
    { kind: 'text', p: [78.6, 5.4, 12.6], rot: [0, -Math.PI / 2, 0], text: 'ride it', size: 0.26, color: 0xc9b48c },
    { kind: 'deco', kindOf: 'crystals', p: [62.0, 4.4, 8.6], count: 10, spread: 2.4, scale: 1.1, seed: 811, glow: 1.8 },
    { kind: 'deco', kindOf: 'pipes', p: [83.6, 12.4, 12.6], count: 5, spread: 1.4, scale: 2.4, seed: 812, mat: 'metal' }, // the lift's head gear, above its travel
    { kind: 'deco', kindOf: 'rocks', p: [70.0, -2.0, 17.0], count: 10, spread: 8.0, scale: 3.4, seed: 813, mat: 'stone' },
    { kind: 'light', p: [66.0, 6.6, 10.0], color: SKY, intensity: 8, distance: 24 },
    { kind: 'light', p: [83.6, 8.2, 12.6], color: 0xffdca8, intensity: 9, distance: 22 },

    /* ============================================================================ */
    /* BEAT 5 — THE CENSER                                                          */
    /* A censer on a 3.6 m chain sweeps the terrace. Pivot 17.46 = terrace top 11.20  */
    /* + 6.26, which is the clearance spire-2 proved: the tip scythes 0.15 m over the */
    /* boards and the kill capsule 0.53 m over them, so it crosses the walk line and  */
    /* never the floor. amp 0.54 rad keeps it on the line about 28% of a 2.8 s period. */
    /*                                                                              */
    /* COIN 2 is the only crouch on the stage: a 1.15 m slot (crouchHeight is 1.05,   */
    /* standing height 1.8) off the terrace's north side. You cannot walk it.         */
    /* ============================================================================ */

    { kind: 'pendulum', p: [91.0, 17.46, 12.6], len: 3.6, amp: 0.54, period: 2.8, phase: 0, axis: [1, 0, 0], blade: { w: 2.8, h: 2.6, d: 0.26 } },

    { kind: 'platform', p: [91.0, 10.7, 18.6], s: [4.0, 1, 3.6], mat: 'sand', glow: 1.4, stripe: true }, // the slot floor, z 16.8..20.4, top 11.20
    { kind: 'platform', p: [91.0, 12.6, 18.6], s: [4.0, 0.5, 3.6], mat: 'obsidian', glow: 0.8, stripe: false }, // the lid — underside 12.35, so the slot is 1.15 m
    { kind: 'light', p: [91.0, 11.6, 20.2], color: GOLD, intensity: 6, distance: 12 },

    { kind: 'platform', p: [97.6, 10.7, 8.0], s: [3.6, 1, 3.6], mat: 'sand', glow: 1.3, stripe: true }, // gap 0.30 off the terrace, top 11.20
    { kind: 'platform', p: [106.0, 10.7, 1.0], s: [9, 1, 8.4], mat: 'stone', glow: 1.0, stripe: true }, // the launch spur, gap 2.33 diagonal, x 101.5..110.5, top 11.20

    { kind: 'text', p: [88.0, 13.4, 16.4], rot: [0, -Math.PI / 2, 0], text: 'DUCK', size: 0.38, color: GOLD },
    { kind: 'deco', kindOf: 'antennae', p: [91.0, 17.9, 12.6], count: 3, spread: 0.5, scale: 1.4, seed: 901, glow: 1.6 }, // the censer's yoke, above its arc
    { kind: 'deco', kindOf: 'spires', p: [95.0, 11.2, 15.6], count: 5, spread: 1.8, scale: 3.6, seed: 902, mat: 'stone' },
    { kind: 'deco', kindOf: 'slabs', p: [101.0, 10.2, 6.0], count: 8, spread: 3.0, scale: 1.6, seed: 903, mat: 'stone' },
    { kind: 'light', p: [91.0, 14.6, 12.6], color: GOLD, intensity: 11, distance: 24, flicker: 0.18 },

    /* ============================================================================ */
    /* BEAT 6 — THE THERMAL                                                         */
    /*                                                                              */
    /* PAD 2  power 8.0, top 11.27, apex 19.27.                                      */
    /*        arc  t = sqrt(16/54) + sqrt(10.14/54) = 0.5443 + 0.4333 = 0.978 s       */
    /*        fires at x 106.05                                                      */
    /*        walk   -> 111.92   |  courtyard starts 110.20  (1.72 m of margin)       */
    /*        run    -> 114.46   |  courtyard 110.20..122.20                          */
    /*        sprint + held (apex 10, t 1.120 s) -> 119.72  (2.48 m spare)            */
    /*        landing readable 45 ms in — 4.6% of the flight.                         */
    /*                                                                              */
    /* THEN THE ONLY SPRINT GAP ON THE STAGE. 6.00 m flat off the courtyard's east    */
    /* lip: past the 5.24 m a run-speed jump can physically cover, inside the 6.17 m  */
    /* safe sprint budget, and the landing is the same height as the take-off so you  */
    /* are looking straight at it. The column standing in the void (base 13.2, which  */
    /* is 1.0 m ABOVE the courtyard floor — Law 4) is 16 m/s² over the middle 4.4 m   */
    /* of the gap: a run-speed jump is inside it for 0.51 s and comes out the far     */
    /* side. It rescues the player who did not sprint. It is not the route.           */
    /* ============================================================================ */

    { kind: 'jumppad', p: [108.0, 11.20, 0], s: [3.2, 0.14, 3.8], power: 8.0, dir: [0, 1, 0] }, // spur top 11.20 + 0.07 = pad top 11.27
    { kind: 'deco', kindOf: 'crystals', p: [108.0, 19.27, 0], count: 9, spread: 1.9, scale: 1.0, seed: 1001, glow: 2.2 }, // the hoop, AT the apex
    { kind: 'text', p: [103.0, 13.6, 0], rot: [0, -Math.PI / 2, 0], text: 'THE AIR HOLDS YOU', size: 0.5, color: SKY },

    { kind: 'platform', p: [116.2, 13.7, 0], s: [12, 1, 13], mat: 'stone', glow: 1.0, stripe: true }, // the great courtyard, x 110.2..122.2, top 14.20

    { kind: 'wind', p: [125.2, 17.7, 0], s: [4.4, 9, 8], dir: [0, 1, 0], power: 16, color: SKY }, // x 123.0..127.4, base 13.2 — entirely over the void
    { kind: 'platform', p: [132.2, 13.7, 0], s: [8, 1, 10], mat: 'stone', glow: 1.0, stripe: true }, // the east court, gap 6.00 flat, x 128.2..136.2, top 14.20

    { kind: 'text', p: [120.0, 16.4, 0], rot: [0, -Math.PI / 2, 0], text: 'SPRINT  —  or trust the column', size: 0.28, color: SKY },
    { kind: 'deco', kindOf: 'spires', p: [116.2, 14.7, 5.6], count: 6, spread: 2.2, scale: 4.6, seed: 1002, mat: 'stone' },
    { kind: 'deco', kindOf: 'spires', p: [116.2, 14.7, -5.6], count: 6, spread: 2.2, scale: 4.6, seed: 1003, mat: 'stone' },
    { kind: 'deco', kindOf: 'girders', p: [125.2, 12.4, 0], count: 5, spread: 2.0, scale: 2.0, seed: 1004, mat: 'metal' }, // under the column, below the arc
    { kind: 'light', p: [116.2, 18.4, 0], color: 0xffe6bf, intensity: 13, distance: 30 },
    { kind: 'light', p: [125.2, 16.4, 0], color: SKY, intensity: 9, distance: 24 },

    /* ============================================================================ */
    /* BEAT 7 — THE WELL                                                            */
    /* Twelve metres of 4.4 m-wide bridge with 12 m/s² blowing across it — and the    */
    /* volume's base is 14.6, a clean metre above the boards, so it only ever touches */
    /* you in the air. Then the route does the thing the last world has never done:   */
    /* it goes DOWN. 14.20 → 13.40 → 12.20 → 11.00 → 10.20, swinging out to z +19 and */
    /* running fourteen metres BACKWARDS in x to the well floor, where a three-armed  */
    /* prayer wheel turns at chest height over an 8 m ring. You can walk the outer     */
    /* rim and never touch it, or cut the middle and time it. Coin 4 is 1.8 m further  */
    /* down still, under the wheel, on a shelf you have to drop to and climb back off. */
    /* Then a diagonal shuttle lifts you 3.6 m and carries you 8 m north-east, back    */
    /* onto the line.                                                                 */
    /* ============================================================================ */

    { kind: 'platform', p: [143.0, 13.7, 0], s: [12, 1, 4.4], mat: 'stone', glow: 1.2, stripe: true }, // the crosswind bridge, gap 0.80, x 137..149, top 14.20
    { kind: 'wind', p: [143.0, 17.1, 0.6], s: [12, 5, 10], dir: [0, 0, 1], power: 12, color: SKY }, // base 14.6 — a metre over the boards

    // -- COIN 3: a vanish tile 3.50 m downwind. It is solid 2.8 s of every 5.3, and it
    //    warns for 0.7 before it goes. The wind that shoves you out there is the same
    //    wind you have to jump back into.
    { kind: 'vanish', p: [145.0, 13.7, 7.0], s: [2.6, 1, 2.6], mat: 'sand', glow: 1.5, stripe: true, cycle: { on: 2.8, off: 1.8, warn: 0.7, phase: 0.40 } }, // top 14.20
    { kind: 'light', p: [145.0, 15.8, 7.0], color: GOLD, intensity: 7, distance: 13 },

    { kind: 'platform', p: [152.6, 12.9, 3.6], s: [4.0, 1, 4.0], mat: 'sand', glow: 1.3, stripe: true }, // gap 1.60 at −0.80, top 13.40
    { kind: 'platform', p: [156.8, 11.7, 8.4], s: [3.8, 1, 3.8], mat: 'sand', glow: 1.3, stripe: true }, // gap 0.95 at −1.20, top 12.20
    { kind: 'platform', p: [158.6, 10.5, 13.6], s: [3.6, 1, 3.6], mat: 'sand', glow: 1.3, stripe: true }, // gap 1.50 at −1.20, top 11.00
    { kind: 'platform', p: [153.0, 9.7, 17.0], s: [4.2, 1, 4.2], mat: 'sand', glow: 1.3, stripe: true }, // gap 1.70 at −0.80 — and now you are running WEST, top 10.20
    { kind: 'platform', p: [145.0, 9.7, 18.8], s: [8, 1, 8], mat: 'stone', glow: 1.0, stripe: true }, // the well floor, gap 1.90, x 141..149, top 10.20

    { kind: 'rotor', p: [145.0, 11.5, 18.8], style: 'bar', arms: 3, len: 2.6, thick: 0.34, period: 3.8, phase: 0, axis: 'y' }, // the prayer wheel, 1.3 m over the floor

    { kind: 'platform', p: [138.4, 7.9, 18.8], s: [3.0, 1, 3.0], mat: 'obsidian', glow: 1.5, stripe: true }, // COIN 4's shelf: 1.10 m out, 1.80 m down, top 8.40

    {
      kind: 'mover',
      p: [152.6, 10.7, 22.0],
      s: [4.0, 1, 4.0],
      mat: 'metal',
      glow: 1.4,
      stripe: true,
      motion: { type: 'linear', to: [152.6, 14.3, 14.0], period: 7.2, dwell: 0.9, ease: 'sine' },
    }, // the diagonal shuttle: boards at top 11.20 (gap 1.60 at +1.00), sets you down at 14.80

    { kind: 'platform', p: [159.4, 14.3, 12.0], s: [6, 1, 7], mat: 'stone', glow: 1.0, stripe: true }, // the east landing, gap 1.80, x 156.4..162.4, top 14.80
    { kind: 'platform', p: [166.6, 14.3, 5.8], s: [4.4, 1, 4.4], mat: 'sand', glow: 1.3, stripe: true }, // gap 2.06 diagonal, top 14.80
    { kind: 'platform', p: [172.4, 14.3, 1.0], s: [4.6, 1, 4.6], mat: 'sand', glow: 1.3, stripe: true }, // gap 1.30 diagonal, back on the line, top 14.80

    { kind: 'text', p: [150.0, 15.4, 3.6], rot: [0, -Math.PI / 2, 0], text: 'DOWN', size: 0.5, color: GOLD },
    { kind: 'text', p: [141.0, 12.6, 18.8], rot: [0, -Math.PI / 2, 0], text: 'the wheel is older than the floor', size: 0.22, color: 0xc9b48c },
    { kind: 'deco', kindOf: 'pipes', p: [145.0, 13.4, 18.8], count: 6, spread: 1.6, scale: 2.6, seed: 1101, mat: 'metal' }, // the wheel's head gear, above its sweep
    { kind: 'deco', kindOf: 'rocks', p: [148.0, 4.0, 18.0], count: 12, spread: 9.0, scale: 3.6, seed: 1102, mat: 'stone' },
    { kind: 'deco', kindOf: 'fins', p: [143.0, 12.6, 3.4], count: 6, spread: 4.0, scale: 1.8, seed: 1103, mat: 'stone' }, // bridge ribs, under the boards
    { kind: 'light', p: [143.0, 17.4, 0], color: SKY, intensity: 9, distance: 26 },
    { kind: 'light', p: [145.0, 12.8, 18.8], color: GOLD, intensity: 10, distance: 22, flicker: 0.14 },
    { kind: 'light', p: [138.4, 9.9, 18.8], color: GOLD, intensity: 7, distance: 14 },
    { kind: 'light', p: [159.4, 17.2, 12.0], color: MINT, intensity: 7, distance: 18 },

    /* ============================================================================ */
    /* BEAT 8 — THE CAROUSEL                                                        */
    /* Two rings on one spindle, turning against each other. OUTER radius 8.4, period */
    /* 9, anticlockwise; INNER radius 3.6, period 7, clockwise. When they line up the */
    /* decks are 0.40 m apart and you step across; relative rate 2π/7 + 2π/9 = 1.596  */
    /* rad/s puts an alignment under your feet every 3.94 s, so the longest this beat  */
    /* can ever make you stand still is 3.9 seconds, and the crossing is about eleven. */
    /*                                                                              */
    /* A mover carries no telegraph of its own (HAZARD_META.mover, telegraph:false),  */
    /* so the phase is read against something that does not move: a lit dock post at   */
    /* the boarding lip and another at the far lip. Both rings carry stripe:true and   */
    /* a raised glow — movers.js now honours both instead of hard-coding them.         */
    /* ============================================================================ */

    {
      kind: 'mover',
      p: [186.0, 15.3, 0],
      s: [4.6, 1, 4.6],
      mat: 'stone',
      glow: 1.5,
      stripe: true,
      motion: { type: 'orbit', radius: 8.4, axis: 'y', period: 9, phase: 0.25 },
    }, // OUTER — reaches x 177.6 and 194.4, top 15.80

    {
      kind: 'mover',
      p: [186.0, 15.3, 0],
      s: [4.2, 1, 4.2],
      mat: 'obsidian',
      glow: 1.7,
      stripe: true,
      motion: { type: 'orbit', radius: 3.6, axis: 'y', period: 7, phase: 0, dir: -1 },
    }, // INNER — reaches x 182.4 and 189.6, top 15.80, turning the other way

    { kind: 'platform', p: [202.0, 15.3, 0], s: [8, 1, 9], mat: 'stone', glow: 1.0, stripe: true }, // the exit deck, x 198..206, top 15.80

    { kind: 'text', p: [174.0, 17.4, 0], rot: [0, -Math.PI / 2, 0], text: 'THEY LINE UP EVERY 3.9 s', size: 0.34, color: GOLD },
    { kind: 'deco', kindOf: 'antennae', p: [175.0, 15.8, 0], count: 2, spread: 0.4, scale: 1.8, seed: 1201, glow: 2.4 }, // the west dock post — the fixed thing you read the phase against
    { kind: 'deco', kindOf: 'antennae', p: [197.0, 15.8, 0], count: 2, spread: 0.4, scale: 1.8, seed: 1202, glow: 2.4 }, // the east dock post
    { kind: 'deco', kindOf: 'pipes', p: [186.0, 20.4, 0], count: 7, spread: 1.5, scale: 3.0, seed: 1203, mat: 'metal' }, // the spindle head, entirely above both decks
    { kind: 'deco', kindOf: 'girders', p: [186.0, 12.6, 0], count: 8, spread: 7.0, scale: 2.6, seed: 1204, mat: 'metal' }, // the machine, entirely below both decks
    { kind: 'light', p: [175.0, 17.2, 0], color: MINT, intensity: 8, distance: 16 },
    { kind: 'light', p: [197.0, 17.2, 0], color: MINT, intensity: 8, distance: 16 },
    { kind: 'light', p: [186.0, 19.4, 0], color: 0xffe6bf, intensity: 12, distance: 30 },

    /* ============================================================================ */
    /* BEAT 9 — THE CRUMBLING STAIR                                                 */
    /* Two risers of +0.90 on a 5.4 s cycle (3.0 solid / 0.8 warning / 1.6 gone),     */
    /* phased a quarter apart so a steady climb never has to stop, each tile narrower */
    /* than the one before. The third riser is a PAIR half a cycle out of step: one of */
    /* them is always solid and it is never the same one twice.                       */
    /*                                                                              */
    /* The drift lives in the GAPS, not on the tiles. Two thin volumes stand in the    */
    /* two voids, base 17.1 and 18.0 — above the top face of every tile either side of */
    /* them — so a player standing on the stair feels nothing at all, and a player in  */
    /* the air between tiles gets 8 m/s² of +Z for the 0.2 s they are crossing. It     */
    /* costs you a tile if you jump without allowing for it and it can never read as   */
    /* stick drift, because it can never touch you while you are standing.             */
    /* ============================================================================ */

    { kind: 'vanish', p: [209.6, 16.2, 0], s: [3.4, 1, 3.8], mat: 'sand', glow: 1.4, stripe: true, cycle: { on: 3.0, off: 1.6, warn: 0.8, phase: 0.00 } }, // gap 1.90 at +0.90, top 16.70
    { kind: 'wind', p: [212.1, 19.6, 1.1], s: [1.6, 5, 9], dir: [0, 0, 1], power: 8, color: SKY }, // the void 211.3..212.9, base 17.1
    { kind: 'vanish', p: [214.4, 17.1, 2.2], s: [3.0, 1, 3.4], mat: 'sand', glow: 1.4, stripe: true, cycle: { on: 3.0, off: 1.6, warn: 0.8, phase: 0.28 } }, // gap 1.60 at +0.90, top 17.60
    { kind: 'wind', p: [216.9, 20.5, 0.4], s: [2.1, 5, 11], dir: [0, 0, 1], power: 8, color: SKY }, // the void 215.9..218.0, base 18.0
    { kind: 'vanish', p: [219.4, 18.0, -2.2], s: [2.8, 1, 2.8], mat: 'sand', glow: 1.4, stripe: true, cycle: { on: 2.6, off: 2.2, warn: 0.6, phase: 0.55 } }, // the fork, north lane, gap 2.47, top 18.50
    { kind: 'vanish', p: [219.4, 18.0, 2.6], s: [2.8, 1, 2.8], mat: 'sand', glow: 1.4, stripe: true, cycle: { on: 2.6, off: 2.2, warn: 0.6, phase: 0.05 } }, // the fork, south lane — half a cycle away

    {
      kind: 'mover',
      p: [225.0, 18.0, -3.6],
      s: [3.4, 1, 3.4],
      mat: 'metal',
      glow: 1.4,
      stripe: true,
      motion: { type: 'linear', to: [225.0, 18.0, 3.6], period: 5.6, dwell: 0.6, ease: 'sine' },
    }, // the shuttle, crossing on Z; 2.50 m to board from either lane, top 18.50

    { kind: 'platform', p: [231.4, 18.0, 0], s: [7, 1, 8], mat: 'stone', glow: 1.0, stripe: true }, // the stair landing, gap 1.80, x 227.9..234.9, top 18.50

    { kind: 'text', p: [206.4, 18.6, 0], rot: [0, -Math.PI / 2, 0], text: 'IT WARNS YOU ONCE', size: 0.44, color: GOLD },
    { kind: 'deco', kindOf: 'girders', p: [214.0, 14.6, 0], count: 8, spread: 6.0, scale: 2.4, seed: 1301, mat: 'metal' }, // the stair's ruined understructure
    { kind: 'deco', kindOf: 'rocks', p: [218.0, 8.0, 8.0], count: 10, spread: 8.0, scale: 3.4, seed: 1302, mat: 'stone' },
    { kind: 'light', p: [214.0, 21.6, 0], color: GOLD, intensity: 10, distance: 26, flicker: 0.12 },
    { kind: 'light', p: [225.0, 21.0, 0], color: MINT, intensity: 7, distance: 18 },

    /* ============================================================================ */
    /* BEAT 10 — THE GLASS CAUSEWAY                                                 */
    /* A colonnade under three counterweights that drop 2.8 m onto the walk line, then */
    /* ten metres of ice with the speed pad ON it. The pad is not the route: the main   */
    /* line off the causeway is a 4.30 m flat hop, inside the run budget. What the pad  */
    /* buys is COIN 5 — 6.26 m out and across, which a plain run cannot cover and a     */
    /* sprint onto the pad turns into an easy jump, because ice keeps what the pad      */
    /* gives you (see the header).                                                     */
    /* ============================================================================ */

    { kind: 'platform', p: [241.6, 18.0, 0], s: [10, 1, 7], mat: 'stone', glow: 1.0, stripe: true }, // the colonnade, gap 1.70, x 236.6..246.6, top 18.50
    { kind: 'crusher', p: [238.6, 22.0, 0], s: [2.6, 1.4, 4.6], axis: [0, -1, 0], travel: 2.8, period: 3.6, phase: 0.00, dwell: 0.9, mat: 'metal' },
    { kind: 'crusher', p: [242.2, 22.0, 0], s: [2.2, 1.4, 4.6], axis: [0, -1, 0], travel: 2.8, period: 4.4, phase: 0.37, dwell: 1.1, mat: 'metal' },
    { kind: 'crusher', p: [245.4, 22.0, 0], s: [2.8, 1.4, 4.6], axis: [0, -1, 0], travel: 2.8, period: 3.1, phase: 0.71, dwell: 0.7, mat: 'metal' },

    { kind: 'ice', p: [252.2, 18.0, 0], s: [10, 1, 4.0], color: SKY }, // the causeway, gap 0.60, x 247.2..257.2, top 18.50
    { kind: 'speedpad', p: [249.0, 18.57, 0], s: [2.8, 0.14, 4.0], dir: [1, 0, 0], power: 6.0 }, // ice top 18.50 + 0.07; 6.8 m of ice left to spend it on
    { kind: 'platform', p: [262.4, 18.0, 8.2], s: [2.6, 1, 2.6], mat: 'obsidian', glow: 1.6, stripe: true }, // COIN 5's island: 6.26 m out and across, top 18.50
    { kind: 'platform', p: [266.0, 18.0, 0], s: [9, 1, 9], mat: 'stone', glow: 1.0, stripe: true }, // the launch court, gap 4.30 flat, x 261.5..270.5, top 18.50

    { kind: 'text', p: [247.6, 20.4, 0], rot: [0, -Math.PI / 2, 0], text: 'THE ICE KEEPS IT', size: 0.44, color: SKY },
    { kind: 'text', p: [247.6, 19.8, 0], rot: [0, -Math.PI / 2, 0], text: 'friction 1.4 — the boost lasts the whole causeway', size: 0.22, color: 0xc9b48c },
    { kind: 'deco', kindOf: 'spires', p: [241.6, 18.6, 4.4], count: 5, spread: 2.0, scale: 4.4, seed: 1401, mat: 'stone' },
    { kind: 'deco', kindOf: 'spires', p: [241.6, 18.6, -4.4], count: 5, spread: 2.0, scale: 4.4, seed: 1402, mat: 'stone' },
    { kind: 'deco', kindOf: 'crystals', p: [252.2, 18.9, 2.6], count: 8, spread: 2.6, scale: 1.0, seed: 1403, glow: 1.8 },
    { kind: 'light', p: [241.6, 21.0, 0], color: 0xffe6bf, intensity: 11, distance: 28 },
    { kind: 'light', p: [252.2, 21.0, 0], color: SKY, intensity: 9, distance: 24 },
    { kind: 'light', p: [262.4, 20.6, 8.2], color: GOLD, intensity: 8, distance: 15 },

    /* ============================================================================ */
    /* BEAT 11 — THE GREAT BELL                                                     */
    /*                                                                              */
    /* Seventy metres of open sky, and hung in the middle of it, under a rock arch,   */
    /* a bronze bell eighteen metres across with its crown at 30 and its lip at 19.6. */
    /* You do not cross past it. You go round its shoulder to the north, under the    */
    /* hammer that strikes it, and then you drop THROUGH ITS MOUTH on three tiles     */
    /* that are already crumbling, come out under the lip, and ride the last ring to  */
    /* the summit stair.                                                             */
    /*                                                                              */
    /* PAD 3  power 7.6, top 18.57, apex 26.17.                                      */
    /*        arc  t = sqrt(15.2/54) + sqrt(10.14/54) = 0.5305 + 0.4333 = 0.964 s     */
    /*        fires at 266.35 | walk -> 272.13, collar starts 270.70 (1.43 m margin)  */
    /*        run -> 274.64 (collar 270.70..281.70) | sprint + held -> 279.79         */
    /*        landing readable 32 ms in — 3.3% of the flight.                         */
    /*                                                                              */
    /* PAD 4  power 5.6, top 19.97, apex 25.57.                                      */
    /*        arc  t = sqrt(11.2/54) + sqrt(5.14/54) = 0.4553 + 0.3085 = 0.764 s      */
    /*        fires at 328.95 | walk -> 333.53, summit starts 332.60 (0.93 m margin)  */
    /*        run -> 335.52 | sprint + held -> 339.84, summit ends 342.20 (2.36 spare) */
    /*        landing readable 58 ms in — 7.6% of the flight.                         */
    /*                                                                              */
    /* Nothing out here repeats: the collar is 11 × 7, the shoulder 6.4 × 4.6, the    */
    /* brow 6 × 4.4, the crown step 5.6 × 5, the throat tiles 3.2 / 3.0 / 2.8, the    */
    /* ring is a single 5.4 m deck on an 8 s turn, and the summit is 9.6 × 12.        */
    /* ============================================================================ */

    { kind: 'jumppad', p: [268.4, 18.57, 0], s: [3.4, 0.14, 4.0], power: 7.6, dir: [0, 1, 0] }, // court top 18.50 + 0.07
    { kind: 'deco', kindOf: 'crystals', p: [268.4, 26.17, 0], count: 10, spread: 2.0, scale: 1.0, seed: 1501, glow: 2.2 }, // the hoop, AT the apex
    { kind: 'text', p: [262.0, 22.0, 0], rot: [0, -Math.PI / 2, 0], text: 'THE BELL', size: 0.72, color: GOLD },
    { kind: 'text', p: [262.0, 21.3, 0], rot: [0, -Math.PI / 2, 0], text: 'round the shoulder  ·  through the mouth', size: 0.24, color: 0xc9b48c },

    { kind: 'platform', p: [276.2, 20.6, 0], s: [11, 1, 7], mat: 'stone', glow: 1.0, stripe: true }, // THE COLLAR, x 270.70..281.70, top 21.10
    { kind: 'platform', p: [287.0, 20.6, -7.2], s: [6.4, 1, 4.6], mat: 'stone', glow: 1.2, stripe: true }, // the shoulder, gap 2.52 diagonal, top 21.10
    { kind: 'platform', p: [296.0, 21.5, -8.4], s: [6, 1, 4.4], mat: 'stone', glow: 1.2, stripe: true }, // the brow, gap 2.80 at +0.90, top 22.00
    { kind: 'pendulum', p: [296.0, 28.26, -8.4], len: 3.6, amp: 0.50, period: 3.4, phase: 0, axis: [1, 0, 0], blade: { w: 2.8, h: 2.6, d: 0.26 } }, // THE HAMMER, pivot = brow top + 6.26
    { kind: 'platform', p: [302.6, 22.4, -4.6], s: [5.6, 1, 5.0], mat: 'stone', glow: 1.2, stripe: true }, // the crown step, gap 2.60 at +0.90, x 299.8..305.4, top 22.90

    // -- THE MOUTH: three crumbling tiles down the inside of the bell, 22.80 → 21.60 →
    //    20.40. The only descent in a finale in this game, and you take it on a floor
    //    that is already counting down.
    { kind: 'vanish', p: [307.6, 22.3, -0.8], s: [3.2, 1, 3.4], mat: 'obsidian', glow: 1.6, stripe: true, cycle: { on: 3.2, off: 1.5, warn: 0.8, phase: 0.10 } }, // gap 0.60 at −0.10, top 22.80
    { kind: 'vanish', p: [311.4, 21.1, 1.6], s: [3.0, 1, 3.2], mat: 'obsidian', glow: 1.6, stripe: true, cycle: { on: 3.2, off: 1.5, warn: 0.8, phase: 0.45 } }, // gap 0.70 at −1.20, top 21.60
    { kind: 'vanish', p: [313.6, 19.9, -1.4], s: [2.8, 1, 3.0], mat: 'obsidian', glow: 1.6, stripe: true, cycle: { on: 3.2, off: 1.5, warn: 0.8, phase: 0.75 } }, // gap 0.00 at −1.20, top 20.40

    {
      kind: 'mover',
      p: [322.0, 19.4, 0],
      s: [5.4, 1, 5.4],
      mat: 'obsidian',
      glow: 1.6,
      stripe: true,
      motion: { type: 'orbit', radius: 4.6, axis: 'y', period: 8, phase: 0.5 },
    }, // THE LAST RING — reaches x 317.4 and 326.6, top 19.90, one turn every 8 s

    { kind: 'platform', p: [329.4, 19.4, 0], s: [6.4, 1, 8], mat: 'stone', glow: 1.0, stripe: true }, // the summit stair, gap 1.70, x 326.2..332.6, top 19.90
    { kind: 'jumppad', p: [330.6, 19.97, 0], s: [2.6, 0.14, 3.4], power: 5.6, dir: [0, 1, 0] }, // stair top 19.90 + 0.07
    { kind: 'deco', kindOf: 'crystals', p: [330.6, 25.57, 0], count: 8, spread: 1.6, scale: 0.9, seed: 1502, glow: 2.4 }, // the last hoop
    { kind: 'platform', p: [337.4, 22.5, 0], s: [9.6, 1, 12], mat: 'obsidian', glow: 1.2, stripe: true }, // THE SUMMIT, x 332.60..342.20, top 23.00

    // The bell itself. It has no collider anywhere — it is the thing you go round and
    // through, not a thing you land on, and nothing about it carries a stripe.
    { kind: 'deco', kindOf: 'fins', p: [294.0, 19.6, 0], count: 26, spread: 8.6, scale: 6.0, seed: 1601, mat: 'metal' }, // the skirt, lip at 19.6
    { kind: 'deco', kindOf: 'fins', p: [294.0, 24.4, 0], count: 20, spread: 6.4, scale: 5.0, seed: 1602, mat: 'metal' }, // the waist
    { kind: 'deco', kindOf: 'slabs', p: [294.0, 28.6, 0], count: 12, spread: 3.4, scale: 4.0, seed: 1603, mat: 'metal' }, // the crown
    { kind: 'deco', kindOf: 'pipes', p: [294.0, 31.4, 0], count: 6, spread: 1.2, scale: 4.0, seed: 1604, mat: 'metal' }, // the yoke it hangs from
    { kind: 'deco', kindOf: 'girders', p: [294.0, 33.6, 0], count: 10, spread: 9.0, scale: 5.0, seed: 1605, mat: 'metal' }, // the rock arch's iron
    { kind: 'light', p: [294.0, 26.0, 0], color: GOLD, intensity: 26, distance: 44 },
    { kind: 'light', p: [276.2, 24.4, 0], color: GOLD, intensity: 12, distance: 28 },
    { kind: 'light', p: [296.0, 25.4, -8.4], color: 0xffe6bf, intensity: 11, distance: 24 },
    { kind: 'light', p: [311.0, 24.0, 0], color: VIOLET, intensity: 12, distance: 26 },
    { kind: 'light', p: [322.0, 23.0, 0], color: VIOLET, intensity: 11, distance: 26 },

    { kind: 'deco', kindOf: 'spires', p: [337.4, 23.0, 5.6], count: 5, spread: 1.6, scale: 5.0, seed: 1701, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'spires', p: [337.4, 23.0, -5.6], count: 5, spread: 1.6, scale: 5.0, seed: 1702, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'crystals', p: [341.0, 23.0, 0], count: 9, spread: 1.4, scale: 1.6, seed: 1703, glow: 2.6 },
    { kind: 'text', p: [333.8, 25.4, 0], rot: [0, -Math.PI / 2, 0], text: 'ASCENSION', size: 0.44, color: VIOLET },
    { kind: 'light', p: [337.4, 26.0, 0], color: VIOLET, intensity: 22, distance: 36 },

    /* ============================================================================ */
    /* THE SKY — cloud sea, sister islands, and the temple that carries on past this  */
    /* level. All of it at |z| >= 20, below y = −6, or above y = 34. None of it enters */
    /* a play corridor and none of it has a collider (buildDeco returns none).         */
    /* ============================================================================ */

    { kind: 'deco', kindOf: 'slabs', p: [150, -26, 0], count: 24, spread: 60, scale: 14, seed: 9001, mat: 'sand' },
    { kind: 'deco', kindOf: 'slabs', p: [280, -32, 30], count: 20, spread: 60, scale: 16, seed: 9002, mat: 'sand' },
    { kind: 'deco', kindOf: 'slabs', p: [60, -34, -40], count: 18, spread: 55, scale: 15, seed: 9003, mat: 'sand' },
    { kind: 'deco', kindOf: 'rocks', p: [60, -6, 34], count: 8, spread: 22, scale: 9, seed: 9101, mat: 'stone' },
    { kind: 'deco', kindOf: 'rocks', p: [210, 2, -38], count: 8, spread: 24, scale: 10, seed: 9102, mat: 'stone' },
    { kind: 'deco', kindOf: 'spires', p: [125, 22, 30], count: 9, spread: 18, scale: 8, seed: 9103, mat: 'stone' },
    { kind: 'deco', kindOf: 'spires', p: [95, 16, -46], count: 10, spread: 20, scale: 12, seed: 9201, mat: 'stone' },
    { kind: 'deco', kindOf: 'fins', p: [200, 30, 46], count: 8, spread: 18, scale: 9, seed: 9202, mat: 'stone' },
    { kind: 'deco', kindOf: 'rocks', p: [320, 10, -48], count: 6, spread: 22, scale: 12, seed: 9203, mat: 'stone' },
    { kind: 'deco', kindOf: 'antennae', p: [140, 40, 38], count: 3, spread: 2.0, scale: 3.0, seed: 9204, glow: 2.0 },

    // Route lights, one per beat, so the line still reads as a line from the top of a
    // pad arc forty metres up.
    { kind: 'light', p: [16, 4.0, 0], color: 0xffdca8, intensity: 6, distance: 24 },
    { kind: 'light', p: [44, 5.2, 0], color: GOLD, intensity: 8, distance: 24 },
    { kind: 'light', p: [76, 6.6, 12.6], color: SKY, intensity: 8, distance: 24 },
    { kind: 'light', p: [106, 14.4, 1.0], color: GOLD, intensity: 9, distance: 26 },
    { kind: 'light', p: [153, 13.0, 12.0], color: SKY, intensity: 8, distance: 26 },
    { kind: 'light', p: [202, 18.6, 0], color: 0xffe6bf, intensity: 10, distance: 26 },
    { kind: 'light', p: [231, 21.4, 0], color: MINT, intensity: 8, distance: 22 },
    { kind: 'light', p: [266, 21.6, 0], color: GOLD, intensity: 11, distance: 28 },
  ],
};
