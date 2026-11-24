// FIRE - Cinder, a live coal (DESIGN-ELEMENTS.md "Fire"). Schema: ELEMENTS.md.
//
// How it differs from Water in the hands:
//   ember  the default: small, quick, the best jumper. Lights things. Spends nothing.
//   blaze  a tall slow flame on its own updraft: low gravity, a long gentle jump, and a second
//          push of updraft in mid-air (its special, "flare"). Burns, melts, boils - and eats heat.
//   smoke  no gravity: rises to the ceiling and slides along it. Through grates, on the wind.
//   spark  tiny and very fast with a short hop: pinholes, floor slots, wires, gas.
// The gauge is HEAT. Nothing gives it back but fuel: braziers, coal, the kiln's own fire, and
// the wood a blaze sets alight. An empty gauge leaves Cinder an ember, which is always safe.
// Water puts every form out; each form's `water` flag says exactly how it meets a pool, a drip
// and a sprinkler (src/sim/packs/hazards.js).
//
// Every number here is measured into LEVELS.md by `node tests/measure-fire.js`.

import hazards from '../packs/hazards.js';
import firePack from '../packs/fire.js';

export const HEAT_MAX = 10;
export const FLARE_COST = 2;          // heat spent by a flare
export const FLARE_UP = 4.4;          // m/s of upward speed a flare gives

const ALL_WATER_KILLS = { pool: 'die', drip: 'die', spray: 'die' };

export default {
  id: 'fire',
  name: 'Fire',
  hero: 'Cinder',
  campaign: 'The Lit Road',
  forms: ['ember', 'blaze', 'smoke', 'spark'],    // button order: 1 2 3 4
  defaultForm: 'ember',

  // Heat never comes back by itself (refill 0).
  gauge: { name: 'heat', max: HEAT_MAX, start: HEAT_MAX, refill: 0 },

  formDefs: {
    ember: {
      r: 0.30, h: 0.56, move: 'walk',
      speed: 6.2, accel: 70, decel: 60, airAccel: 26, airDecel: 4,
      jump: 9.6, step: 0.3, airStep: 0.15, fallMul: 1.5, cutMul: 3.0,
      pressesLight: true,
      ignites: true,
      windCarry: 0.5, updraftAccel: 0.9,           // a coal is denser than a drop: fans move it less
      water: ALL_WATER_KILLS, dousedByWater: true,
      blastScale: 1,
    },
    blaze: {
      r: 0.34, h: 1.05, move: 'walk',
      speed: 4.2, accel: 26, decel: 20, airAccel: 12, airDecel: 1.5,
      jump: 5.5, step: 0.3, airStep: 0.15,
      gravMul: 0.385,                              // floats on its own updraft: about 10 m/s^2
      fallMul: 0.8, cutMul: 1.6, maxFall: 7,
      pressesLight: true,
      ignites: true, burns: true, melts: true, tripsHeat: true,
      windCarry: 1.3, updraftAccel: 1.6,           // fans push a flame hard
      drain: 1.25, minStart: 0.5,
      special: 'flare',
      water: { pool: { boil: 2 }, drip: { evaporate: 1 }, spray: { drain: 5 } }, dousedByWater: true,
      blastScale: 0.85,
      sfxEnter: 'flare', sfxLeave: 'smoke_puff',
    },
    smoke: {
      r: 0.34, h: 0.60, move: 'float',
      speed: 3.0, accel: 8, drag: 4,
      rise: 1.9, riseAccel: 8, windAccel: 22,
      step: 0, airStep: 0,
      passesGrate: true,
      drain: 1.0, minStart: 0.7,
      water: { pool: 'die', drip: { to: 'ember' }, spray: { to: 'ember', back: true } }, dousedByWater: true,
      blastScale: 0.6,
      sfxEnter: 'smoke_puff', sfxLeave: 'ignite',
    },
    spark: {
      r: 0.14, h: 0.26, move: 'walk',
      speed: 9.5, accel: 45, decel: 90, airAccel: 40, airDecel: 6,     // accel was 120: a 0.15 s key tap moved a spark 1.55 m, now 0.76 m (a held key still dashes at 9.5 m/s)
      jump: 5.2, step: 0.14, airStep: 0.08, fallMul: 1.6, cutMul: 2.0,
      ignites: true, sparksGas: true, ridesWires: true, powers: true,
      passesSlot: true,                            // small enough to drop between the slats of a floor slot
      drain: 2, minStart: 0.5,
      water: ALL_WATER_KILLS, dousedByWater: true,
      blastScale: 1.25,
      sfxEnter: 'spark_zip', sfxLeave: 'ignite',
    },
  },

  // The shared zone pieces, as fire meets them.
  zones: {
    heatvent: { hold: true },                                            // rising heat: no form spends heat inside
    frost: { demote: { blaze: 'ember' }, refuse: { blaze: 'frost' } },   // a flame cannot live in frost
    cold: { demote: { smoke: 'ember' }, refuse: { smoke: 'cold' } },     // cold air drops smoke
  },
  kilnFire: { feed: 3 },                          // the `fire` piece is fuel: +3 heat per second

  // Shared pieces a Fire level may use, plus the packs' own. Not here on purpose: crate (use
  // wood kind 'crate'), ember, sprout, electrodes and hotfloor (they answer only to water forms).
  pieces: [
    'block', 'ramp', 'mover', 'door', 'pane', 'grate', 'slot', 'plate', 'sensor',
    'fan', 'heatvent', 'frost', 'cold', 'fire', 'current',
    'checkpoint', 'shard', 'exit', 'hint', 'prop',
    ...hazards.types, ...firePack.types,
  ],
  packs: [hazards, firePack],

  specials: {
    /**
     * Blaze: a push of its own updraft. Once per time in the air (and from the ground), for
     * FLARE_COST heat. Refused without the heat, or if already used since the last landing.
     */
    flare(sim, p) {
      if (p.airSpecial || p.gauge < FLARE_COST) return false;
      sim.addGauge(-FLARE_COST);
      p.vy = FLARE_UP;
      p.grounded = false; p.ground = null; p.jumping = false; p.coyoteT = 0; p.bufferT = 0;
      p.airSpecial = true;
      sim.sfx('flare', 1);
      sim.ev({ type: 'burst', kind: 'flare', x: p.x, y: p.y, z: p.z });
      return true;
    },
  },
};
