// WATER - Mote, a drop. The original element, re-expressed as data (schema: ELEMENTS.md).
//
// Every number is the one the v1 build used (they still live in ../constants.js, where the
// Water tests and LEVELS.md read them); this file only adds the capability flags the engine now
// reads instead of asking "is this ice?". tests/golden-water.test.js proves the result plays
// bit-identically to v1.

import {
  FORMS, STEAM_MAX, STEAM_REFILL, STEAM_MIN_START, LIQUID_WIND_FACTOR, LIQUID_UPDRAFT_ACCEL,
  WATER_FLOAT_DEPTH,
} from '../constants.js';
import { PIECE_TYPES } from '../piecetypes.js';

export default {
  id: 'water',
  name: 'Water',
  hero: 'Mote',
  campaign: 'The Wet Road',
  forms: ['liquid', 'ice', 'steam', 'film'],      // button order: 1 2 3 4
  defaultForm: 'liquid',                          // the respawn form; every level must allow it

  // The gauge: steam time. Forms with `drain` spend it; it comes back by itself on the ground.
  gauge: { name: 'steam', max: STEAM_MAX, start: STEAM_MAX, refill: STEAM_REFILL },

  formDefs: {
    liquid: {
      ...FORMS.liquid, move: 'walk',
      pressesLight: true,
      floats: true, floatDepth: WATER_FLOAT_DEPTH.liquid,
      windCarry: LIQUID_WIND_FACTOR, updraftAccel: LIQUID_UPDRAFT_ACCEL,
      douses: true, waters: true,
    },
    ice: {
      ...FORMS.ice, move: 'slide',
      pressesLight: true, pressesHeavy: true,
      smashesPanes: true, pushesCrates: true, wallBounce: true,
      sinks: true,
      sfxEnter: 'freeze', sfxLeave: 'melt',
    },
    steam: {
      ...FORMS.steam, move: 'float',
      passesGrate: true,
      drain: 1, minStart: STEAM_MIN_START,
      sfxEnter: 'vaporize', sfxLeave: 'condense',
    },
    film: {
      ...FORMS.film, move: 'walk',
      pressesLight: true,
      floats: true, floatDepth: WATER_FLOAT_DEPTH.film,
      passesSlot: true, conducts: true,
      sfxEnter: 'flatten', sfxLeave: 'unflatten',
    },
  },

  // How the shared zone pieces act on this element.
  zones: {
    heatvent: { force: 'steam', fill: true },
    frost: { force: 'ice' },
    cold: { demote: { steam: 'liquid' }, ifFits: true, refuse: { steam: 'cold' } },
    hotfloor: { demote: { ice: 'liquid' }, refuse: { ice: 'hot' } },
  },
  kilnFire: 'kill',                               // the `fire` piece respawns Mote

  pieces: PIECE_TYPES,                            // every shared piece makes sense for water
  packs: [],                                      // no element-only mechanisms
  specials: {},                                   // no form has a special
};
