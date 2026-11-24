// Focus navigation geometry (src/ui/nav.js): which control an arrow key or a d-pad press moves to.

import { test, assert, eq } from './lib/harness.js';
import { pickTarget, FOCUSABLE } from '../src/ui/nav.js';

const R = (x, y, w, h) => ({ x, y, w, h });

test('nav: a column of buttons is walked up and down, and stops at its ends', () => {
  const col = [R(100, 0, 300, 50), R(100, 62, 300, 50), R(100, 124, 300, 50)];
  eq(pickTarget(col[0], col, 'down'), 1); eq(pickTarget(col[1], col, 'down'), 2); eq(pickTarget(col[2], col, 'down'), -1);
  eq(pickTarget(col[2], col, 'up'), 1); eq(pickTarget(col[0], col, 'up'), -1);
  eq(pickTarget(col[1], col, 'left'), -1); eq(pickTarget(col[1], col, 'right'), -1);
});

test('nav: in a grid the control straight ahead wins over a nearer one off to the side', () => {
  // two rows of three, and a wide button below
  const g = [R(0, 0, 100, 80), R(110, 0, 100, 80), R(220, 0, 100, 80), R(0, 90, 100, 80), R(110, 90, 100, 80), R(220, 90, 100, 80), R(0, 190, 320, 60)];
  eq(pickTarget(g[0], g, 'right'), 1); eq(pickTarget(g[1], g, 'right'), 2); eq(pickTarget(g[2], g, 'left'), 1);
  eq(pickTarget(g[1], g, 'down'), 4); eq(pickTarget(g[4], g, 'up'), 1);
  eq(pickTarget(g[5], g, 'down'), 6, 'from the last column down to the wide button');
  assert([3, 4, 5].includes(pickTarget(g[6], g, 'up')), 'and back up from it to the row above');
  eq(pickTarget(g[3], g, 'left'), -1);
});

test('nav: the phone title layout - three cards, play, then two buttons', () => {
  const cards = [R(16, 440, 108, 140), R(133, 440, 108, 140), R(250, 440, 108, 140)];
  const play = R(16, 665, 343, 60), levels = R(16, 737, 165, 52), settings = R(194, 737, 165, 52);
  const all = [...cards, play, levels, settings];
  eq(pickTarget(cards[0], all, 'right'), 1); eq(pickTarget(cards[1], all, 'down'), 3);
  eq(pickTarget(play, all, 'down'), 4); eq(pickTarget(levels, all, 'right'), 5); eq(pickTarget(settings, all, 'up'), 3);
  assert([0, 1, 2].includes(pickTarget(play, all, 'up')), 'up from play reaches a card');
});

test('nav: empty and degenerate rectangles are skipped', () => {
  const cur = R(0, 0, 50, 50);
  eq(pickTarget(cur, [null, R(0, 100, 0, 0), R(0, 200, 50, 50)], 'down'), 2);
  eq(pickTarget(cur, [], 'down'), -1);
  assert(FOCUSABLE.includes('button') && FOCUSABLE.includes('input'));
});
