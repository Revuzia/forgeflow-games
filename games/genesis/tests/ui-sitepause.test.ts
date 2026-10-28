// GENESIS — the site bar's Pause (src/ui/embed.ts TimeGuard): pressing it twice always gives time back, even when a
// snapshot asked for before setSpeed(0) comes back with the old speed (review finding: the world stayed frozen).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const g = globalThis as unknown as Record<string, unknown>;
g.window ??= globalThis;
g.document ??= { addEventListener() {}, hidden: false };
const { TimeGuard } = await import('../src/ui/embed.ts');

function rig() {
  const st = { speed: 3, menu: false, sets: [] as number[] };
  const guard = new TimeGuard({
    speed: () => st.speed,
    setSpeed: (x) => { st.speed = x; st.sets.push(x); },
    openMenu: () => { st.menu = true; },
    closeWindows: () => { st.menu = false; },
    windowOpen: () => st.menu,
    titleOpen: () => false,
    hiddenPref: () => 'off',
    toast: () => {},
  });
  const bar = (g.window as { __PAUSE__: { toggle(): void; paused(): boolean } }).__PAUSE__;
  return { st, guard, bar };
}

test('site Pause, a stale snapshot with the old speed, then Pause again: the speed comes back', () => {
  const { st, guard, bar } = rig();
  bar.toggle();
  assert.equal(st.speed, 0); assert.ok(st.menu); assert.ok(bar.paused());
  st.speed = 1; // a reply to a request sent before setSpeed(0) overwrites the view's speed
  guard.frame();
  assert.ok(bar.paused(), 'a reported speed is not the player setting time running');
  st.speed = 0; // the next snapshot confirms the pause
  guard.frame();
  bar.toggle();
  assert.ok(!bar.paused()); assert.ok(!st.menu);
  assert.equal(st.speed, 3, 'the speed before the pause is restored');
});

test('the player choosing a speed lets go of the site pause; closing the menu resumes', () => {
  const { st, guard, bar } = rig();
  bar.toggle();
  guard.playerSpeed();
  assert.ok(!bar.paused());
  bar.toggle(); // pausing again records the speed then (0) and keeps it
  assert.ok(bar.paused());
  st.menu = false; guard.frame();
  assert.ok(!bar.paused(), 'closing the menu ends the site pause');
});
