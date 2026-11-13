// PERF s10 owner item 7: the long press is WALL TIME from when the press was handled (never frames, never the stale event
// time of a press queued behind a long frame), and a drag never opens the radial; a speed the player picks while a
// decision card eased time is not overridden when the card closes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HandInput } from '../src/ui/handinput.ts';
import { DecisionState } from '../src/ui/decision.ts';

let clock = 0;
const realNow = performance.now.bind(performance);
function hand(): { h: HandInput; opened: [number, number][] } {
  // (no DOM here: the instance is made without its constructor; frame()'s cursor / hint drawing is stubbed)
  const h = Object.create(HandInput.prototype) as HandInput & Record<string, unknown>;
  Object.assign(h, { state: 'idle', target: null, trail: [], samples: [], path: 0, longPressFired: false, aiming: false, slapping: false,
    hoverRef: null, slapMod: () => false, host: { entityAt: () => null, view: { hand: null } },
    updateHint() {}, updateBadge() {}, updateAim() {}, setCursor() {}, sendMove() {} });
  const opened: [number, number][] = [];
  h.onLongPress = (x, y) => opened.push([x, y]);
  return { h, opened };
}
const mods = { altKey: false, ctrlKey: false, shiftKey: false, metaKey: false };

test('a still press opens the radial after 620 ms of wall time, whatever the frame rate', () => {
  performance.now = () => clock;
  try {
    for (const frameMs of [16, 100, 400, 1000]) {
      const { h, opened } = hand();
      clock = 10_000;
      h.down(300, 200, mods, clock);
      let fired = -1;
      for (let t = 0; t <= 3000 && fired < 0; t += frameMs) { clock = 10_000 + t; h.frame([300, 200]); if (opened.length) fired = t; }
      // (PERF s15, owner round 4: held still in two frames in a row past the threshold — one frame later)
      assert.ok(fired >= 620 && fired < 620 + 2 * frameMs + 1, `${frameMs} ms frames: fired at ${fired}`);
    }
  } finally { performance.now = realNow; }
});

test('a press queued behind a long frame (old event time) is not a long press when the drag after it is delivered', () => {
  performance.now = () => clock;
  try {
    const { h, opened } = hand();
    // pressed at 10 000; the page was stuck in a 900 ms frame: the press is handled at 10 900 with its old event time
    clock = 10_900;
    h.down(300, 200, mods, 10_000);
    // the next frame starts at once: the drag the player began at 10 050 is not delivered yet
    h.frame([300, 200]);
    assert.equal(opened.length, 0, 'the stale event time alone must not open the radial');
    // the moves arrive before the next frame (another long one)
    clock = 11_800;
    h.move(340, 210, clock, [{ x: 310, y: 202, t: 11_000 }, { x: 325, y: 205, t: 11_400 }, { x: 340, y: 210, t: 11_790 }]);
    h.frame([340, 210]);
    assert.equal(opened.length, 0, 'a drag never opens the radial');
    assert.equal(h.up(340, 210, 11_900), 'done');
  } finally { performance.now = realNow; }
});

test('owner round 4: at ~2 fps a drag whose first frame past 620 ms had moved < 8 px does not open the radial', () => {
  performance.now = () => clock;
  try {
    const { h, opened } = hand();
    clock = 20_000;
    h.down(300, 200, mods, clock);
    clock = 20_470; h.frame([300, 200]);
    // the drag starts slowly: 3 px by the frame that crosses the threshold
    clock = 20_930; h.move(303, 200, clock); h.frame([303, 200]);
    assert.equal(opened.length, 0, 'not on the first frame past the threshold');
    // the next frame's moves show the drag
    clock = 21_400; h.move(360, 215, clock); h.frame([360, 215]);
    assert.equal(opened.length, 0, 'a drag never opens the radial');
    assert.equal(h.up(360, 215, 21_500), 'done');
  } finally { performance.now = realNow; }
});

test('a drag that comes back to where it began is still a drag', () => {
  performance.now = () => clock;
  try {
    const { h, opened } = hand();
    clock = 0; h.down(100, 100, mods, 0);
    clock = 200; h.move(130, 100, 200); h.frame([130, 100]);
    clock = 400; h.move(100, 100, 400); h.frame([100, 100]);
    clock = 900; h.frame([100, 100]);
    assert.equal(opened.length, 0);
  } finally { performance.now = realNow; }
});

test("the player's own speed while a card eased time stands when the card closes ('1' after 1000x)", () => {
  const d = new DecisionState();
  assert.equal(d.step(['tower:4'], ['tower:4'], 1000, true), 10, 'the card eases 1000x to 10x');
  d.playerSpeed(); // the '1' key
  assert.equal(d.answered(), null, 'answering does not bring 1000x back');
  const e = new DecisionState();
  e.step(['tower:4'], ['tower:4'], 1000, true);
  assert.equal(e.answered(), 1000, 'without a speed of the player\'s own the eased speed comes back as before');
});
