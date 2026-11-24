// Helpers for unit tests: build a tiny level around a flat floor.
import { play } from './play.js';

/** A level with a 60 x 20 floor (top at y=0, x -10..50, z -10..10), spawn at origin, exit far away. */
export function mini(pieces = [], extra = {}) {
  return {
    id: 'mini', name: 'Mini', spawn: [0, 0, 0],
    pieces: [
      ...(extra.noFloor ? [] : [{ type: 'block', box: [-10, -1, -10, 50, 0, 10] }]),
      { type: 'exit', pos: extra.exit || [48, 0, 8] },
      ...pieces,
    ],
    signals: extra.signals || {},
    hints: extra.hints || {},
    ...(extra.forms ? { forms: extra.forms } : {}),
    ...(extra.spawn ? { spawn: extra.spawn } : {}),
    ...(extra.killY !== undefined ? { killY: extra.killY } : {}),
    ...(extra.element ? { element: extra.element } : {}),
    ...(extra.startGauge !== undefined ? { startGauge: extra.startGauge } : {}),
  };
}

/** Runner on a mini level, settled on the ground. `extra.element: 'fire'` makes it a Fire level (Cinder). */
export function run(pieces, extra) {
  const r = play(mini(pieces, extra));
  r.wait(0.1);
  return r;
}
