// CLAY - Dab, a thumb of clay (DESIGN-ELEMENTS.md "Clay"). Schema: ELEMENTS.md.
//
// How it differs from Water and Fire in the hands:
//   clay   the default: the heaviest default of the three (slowest to get going, falls hard, a
//          modest jump) - and it STICKS: it climbs rough walls and hangs under rough ceilings
//          while its grip lasts (src/sim/packs/clay.js). It sheds nothing and spends nothing.
//   slip   liquid clay: flat on the floor, no jump. Oozes downhill on its own, runs fast down a
//          slope and crawls up one. Pours through floor slots and under low gaps, fills moulds,
//          and (wet clay) closes a pair of electrodes.
//   stone  fired clay: heavy, slow, a tiny hop. Presses heavy plates, shoves crates, smashes panes
//          by falling on them, walks through kiln fire. Its special sheds a stone shell.
//          It is NOT chosen: only kiln heat makes it, and only soaking in water undoes it.
//   dust   dried clay: a cloud that sinks slowly. Falls through grates and sieves, rides fans
//          across anything, ignores plates. It holds together for the gauge, then settles as clay.
// The economy is the ROOM: heat fires Dab, water soaks it, wind dries it. What kills one element
// feeds another - kiln fire puts Cinder's gauge up, here it is a wall only fired clay can pass.
// The gauge is DUST: how long a cloud of dust holds together (it fills again on the ground, and a
// fan that blows slip into dust fills it). Grip, the other thing Dab runs out of, is per climb and
// lives in the pack (p.grip).
//
// Every number here is measured into LEVELS.md (section 11) by `node tests/measure-clay.js`.

import hazards from '../packs/hazards.js';
import clayPack, { CLAY } from '../packs/clay.js';

export const DUST_MAX = 5;            // seconds of dust on a full gauge
export const DUST_REFILL = 2.5;       // gauge per second regained on the ground in any other form
export const DUST_MIN_START = 1;      // needed to crumble into dust by choice

export default {
  id: 'clay',
  name: 'Clay',
  hero: 'Dab',
  campaign: 'The Thrown Road',
  forms: ['clay', 'slip', 'stone', 'dust'],       // button order: 1 2 3 4
  defaultForm: 'clay',

  gauge: { name: 'dust', max: DUST_MAX, start: DUST_MAX, refill: DUST_REFILL },

  formDefs: {
    clay: {
      r: 0.34, h: 0.62, move: 'walk',
      speed: 4.6, accel: 30, decel: 38, airAccel: 14, airDecel: 2.5,
      jump: 8.2, step: 0.3, airStep: 0.12, fallMul: 1.55, cutMul: 2.6,
      pressesLight: true,
      climbsRough: true,                          // the pack: rough walls and ceilings
      windCarry: 0.3, updraftAccel: 0.5,          // a lump: fans barely move it
      pistonScale: 1, wheelFling: 1,
      water: { pool: { to: 'slip' }, spray: { to: 'slip' } },   // soaked to slip; a drip does nothing
      soakTo: 'slip',                             // what running water (a `current`) makes of it
    },
    slip: {
      r: 0.34, h: 0.16, move: 'walk',            // (as wide as clay: a form change on a slope must fit)
      speed: 3.2, accel: 13, decel: 9, airAccel: 4, airDecel: 1,
      step: 0.12, airStep: 0.04, fallMul: 1.0,
      slope: { up: 0.55, down: 1.7, flow: 2.0 },  // runs downhill, crawls uphill, oozes when let go
      pressesLight: true,
      passesSlot: true, conducts: true,
      fillsMould: true,
      floats: true, floatDepth: 0.06,             // carried along by running water
      windForm: 'dust',                           // a fan dries it to dust (the pack)
      pistonScale: 0.7, wheelFling: 1.2, wheelSlide: 0.4,
      soakTo: 'slip',
      sfxEnter: 'slip_pour', sfxLeave: 'squish',
    },
    stone: {
      r: 0.34, h: 0.64, move: 'walk',
      speed: 2.8, accel: 11, decel: 20, airAccel: 4, airDecel: 1.5,
      jump: 5.0, step: 0.22, airStep: 0.08, fallMul: 1.7, cutMul: 1.0,
      pressesLight: true, pressesHeavy: true, pushesCrates: true, smashesPanes: true,
      immuneFire: true,                           // walks through kiln fire
      sinks: true, waterGravity: 0.6,
      zoneOnly: 'kiln',                           // only kiln heat fires clay: the button refuses it
      locksIn: 'fired',                           // and fired clay cannot be soft again by choice
      special: 'shed',
      pistonScale: 0.35, wheelFling: 0.3,
      water: { pool: { to: 'slip' } },            // only a soak un-fires it
      soakTo: 'slip',
      sfxEnter: 'fire_harden', sfxLeave: 'soak',
    },
    dust: {
      r: 0.34, h: 0.5, move: 'float',
      speed: 1.5, accel: 4, drag: 2.5,             // weak steering: fans are what carry dust
      rise: 1.1, floatDown: true, riseAccel: 5,   // it SINKS, slowly (floatDown: `rise` is downward)
      windAccel: 18,                              // a fan drags it to wind speed
      step: 0, airStep: 0,
      passesGrate: true, passesSieve: true,
      drain: 1, minStart: DUST_MIN_START,
      windHold: true,                             // held together while it rides a fan
      pistonScale: 1.6,
      water: { pool: { to: 'slip' }, drip: { to: 'clay' }, spray: { to: 'clay' } },
      soakTo: 'slip',
      sfxEnter: 'dust_puff', sfxLeave: 'squish',
    },
  },

  // The shared zone pieces, as clay meets them. Clay's own kiln `heat` piece uses `heat`.
  zones: {
    heat: { force: 'stone' },                     // the pack's `heat` zone: the kiln fires it
    heatvent: { force: 'stone' },                 // any rising heat does the same
    hotfloor: { force: 'stone' },                 // and so does a hot floor
    frost: { demote: { slip: 'clay' }, refuse: { slip: 'frost' } },   // wet slip stiffens
    cold: { demote: { dust: 'clay' }, ifFits: true, refuse: { dust: 'cold' } },   // damp air settles dust
  },
  kilnFire: 'kill',                               // open flame bursts soft clay; stone is immuneFire

  // Shared pieces a Clay level may use, plus the packs' own. Not here: ember and sprout (they
  // answer only to water's douses / waters).
  pieces: [
    'block', 'ramp', 'mover', 'door', 'crate', 'pane', 'grate', 'slot', 'plate', 'electrodes', 'sensor',
    'fan', 'heatvent', 'frost', 'cold', 'hotfloor', 'fire', 'current',
    'checkpoint', 'shard', 'exit', 'hint', 'prop',
    ...hazards.types, ...clayPack.types,
  ],
  packs: [hazards, clayPack],

  specials: {
    /**
     * Stone: shed a shell. One stone block, the size of Dab, is left where Dab stands, and Dab pops
     * up onto it. Only on the ground, only with room overhead; a new shell crumbles the old one.
     */
    shed(sim, p) { return clayPack.shed(sim, p, CLAY); },
  },
};
