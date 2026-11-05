// GENESIS — postrel punch r3 item 1: once the opening ended, the world kept running at the opening's "let the day
// pass" 100x and never went back to 1x (br2/opening.log: speed 100 from tick 28634 to 86554, ~5 Cinder years). The
// owner asked for a slow, realistic 1x: the opening's own fast-forwards end with it; a century the player asked for, or
// a speed the player picked themselves, stays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speedAfterOpening, DAY_SPEED } from '../src/ui/opening.ts';

// a bare DOM: enough for the opening's card, veil and ring to be built (no layout, no events fired)
function el(): Record<string, unknown> {
  const cls = new Set<string>();
  const e: Record<string, unknown> = {
    hidden: false, style: {}, dataset: {}, className: '', textContent: '', disabled: false, offsetWidth: 0,
    classList: { add: (c: string) => cls.add(c), remove: (c: string) => cls.delete(c), contains: (c: string) => cls.has(c), toggle: (c: string, on?: boolean) => ((on ?? !cls.has(c)) ? cls.add(c) : cls.delete(c)) },
    setAttribute() {}, append() {}, appendChild() {}, addEventListener() {}, removeEventListener() {}, replaceChildren() {},
    get firstChild() { return null; },
  };
  return e;
}
(globalThis as Record<string, unknown>).document ??= { createElement: el, querySelector: () => null };
(globalThis as Record<string, unknown>).window ??= { addEventListener() {}, removeEventListener() {} };

const { Opening } = await import('../src/ui/opening.ts');

function rig(start = 1) {
  const calls: number[] = [];
  const view = { speed: start, renderTick: 0, planet: () => null };
  const host = {
    view, keybinds: { hint: () => '' }, focusGround: () => null, powers: { get: () => undefined },
    setSpeed(x: number) { calls.push(x); view.speed = x; }, lookAt() {}, cmd: async () => ({}), sound() {},
  };
  const deps = { host, setUi() {}, hudQuiet() {}, arm() {}, menuOpen: () => false };
  const o = new Opening(el() as never, el() as never, deps as never);
  const anyO = o as unknown as Record<string, unknown> & { whisper(b: string, pv: unknown, sid: number, n: boolean): { act?: { label: string; run(): void } } };
  anyO.stage = 'whisper';
  const press = (beat: string) => { const w = anyO.whisper(beat, { id: 0 }, 0, false); assert.ok(w.act, `${beat} has an act`); w.act.run(); };
  return { o, view, calls, press, host };
}

test('speedAfterOpening: the opening\'s own speeds go back to 1x; the century, the player\'s speed and pause stay', () => {
  assert.equal(speedAfterOpening(DAY_SPEED, DAY_SPEED), 1);
  assert.equal(speedAfterOpening(10, 10), 1);
  assert.equal(speedAfterOpening(1000, 1000), null, 'let a century run is the player\'s time-lapse');
  assert.equal(speedAfterOpening(5, DAY_SPEED), null, 'the player picked 5x after the opening\'s 100x');
  assert.equal(speedAfterOpening(0, DAY_SPEED), null, 'paused stays paused');
  assert.equal(speedAfterOpening(100, 0), null, 'the opening never touched the speed');
});

test('the opening ends at 1x after "let the day pass" (the bug: it stayed at 100x for years)', () => {
  const r = rig();
  r.press('wait');
  assert.equal(r.view.speed, DAY_SPEED);
  r.o.end();
  assert.equal(r.view.speed, 1, `speed after the opening: ${r.view.speed} (calls ${r.calls.join(',')})`);
  assert.equal(r.o.isActive, false);
});

test('the rest beat\'s "let a century run" outlives the opening', () => {
  const r = rig();
  r.press('wait');
  r.press('rest');
  r.o.end();
  assert.equal(r.view.speed, 1000);
});

test('a speed the player chose during the opening is kept, and so is a world the opening never sped', () => {
  const r = rig();
  r.press('wait');
  r.host.view.speed = 5; // the HUD's 5x, picked by the player
  r.o.end();
  assert.equal(r.view.speed, 5);
  const q = rig(10);
  q.o.end();
  assert.equal(q.view.speed, 10);
  assert.deepEqual(q.calls, []);
});
