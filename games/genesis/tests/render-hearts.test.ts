// GENESIS — ARC §1.3/§1.4/§6.9: a person's heart sign becomes a pose (render/life/crowds.ts heartAnim, bodymat.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HEART_ANIM, heartAnim } from '../src/render/life/crowds.ts';
import { AnimState } from '../src/sim/types.ts';

test('the pose ids are ARC §6.2\'s AnimState additions', () => {
  assert.deepEqual({ ...HEART_ANIM }, { lookUp: 40, fist: 41, hurl: 42, curse: 43 });
});

test('a sign poses only someone standing idle or talking; work and walking keep their own', () => {
  assert.equal(heartAnim(AnimState.idle, false, 3, 1), HEART_ANIM.lookUp);
  assert.equal(heartAnim(AnimState.idle, false, 4, 1), AnimState.cheer);
  assert.equal(heartAnim(AnimState.idle, false, 1, 1), AnimState.pray);
  assert.equal(heartAnim(AnimState.chop, false, 3, 1), AnimState.chop);
  assert.equal(heartAnim(AnimState.walk, true, 3, 1), AnimState.walk);
  assert.equal(heartAnim(AnimState.idle, false, 0, 1), AnimState.idle);
  assert.equal(heartAnim(AnimState.idle, false, 5, 1), HEART_ANIM.hurl);
  assert.equal(heartAnim(AnimState.walk, true, 5, 1), AnimState.walk, 'they walk out first, then throw');
});

test('raised fists split into fists and curses, stably per person', () => {
  const got = new Set<number>();
  for (let id = 1; id < 200; id++) {
    const a = heartAnim(AnimState.idle, false, 2, id);
    assert.equal(a, heartAnim(AnimState.idle, false, 2, id));
    got.add(a);
  }
  assert.deepEqual([...got].sort(), [HEART_ANIM.fist, HEART_ANIM.curse].sort());
});

test('every heart pose has a frequency, a joint pose and nothing else costs more (no new pass)', () => {
  const src = readFileSync(new URL('../src/render/life/bodymat.ts', import.meta.url), 'utf8');
  for (const a of Object.values(HEART_ANIM)) {
    assert.match(src, new RegExp(`if \\(a == ${a}\\) return \\d`), `animFreq ${a}`);
    assert.match(src, new RegExp(`if \\(a == ${a}\\) \\{`), `pose ${a}`);
  }
});
