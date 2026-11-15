// The screenshot key: a real action with a default key, header text with the build and canvas size, a stable file name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shotHeader, shotName } from '../src/ui/shot.ts';
import { ACTION_BY_ID } from '../src/ui/keybinds.ts';

const f = { when: '2026-11-15T10:20:30Z', build: 'abc123', canvas: '1920x1080 (css 960x540, render 1920x1080)', preset: 'ultra', gpu: 'Apple M5', dpr: 2, altitude: 98.6, extra: 'switches none' };

test('header: build, pixel size, preset, canvas, gpu, altitude', () => {
  const h = shotHeader(f, 1920, 1080);
  assert.match(h[0], /build abc123 · 1920x1080 px/);
  assert.match(h[1], /preset ultra .*dpr 2 · altitude 99 m/);
  assert.match(h[2], /gpu Apple M5/);
  assert.equal(shotHeader({ when: 'x', build: 'dev' }, 4, 3).length, 1, 'no facts, one line');
});

test('file name carries build, size and time', () => {
  assert.equal(shotName(f, 1920, 1080), 'genesis-shot-abc123-1920x1080-20261115102030.png');
});

test('the key exists and is bound', () => {
  assert.deepEqual(ACTION_BY_ID.get('ui.screenshot')?.keys, ['Shift+F8']);
});
