// The shared piece types every element's levels may draw on (LEVELS.md section 4). Kept in its own
// module so element definitions can list them without importing the level loader.
// Element-only pieces (wood, fuse, pool ...) are NOT here: they come from "packs" (ELEMENTS.md).

export const PIECE_TYPES = [
  'block', 'ramp', 'mover', 'door', 'crate', 'pane', 'ember', 'grate', 'slot', 'sprout',
  'plate', 'electrodes', 'sensor',
  'fan', 'heatvent', 'frost', 'cold', 'hotfloor', 'fire', 'current',
  'checkpoint', 'shard', 'exit', 'hint', 'prop',
];
