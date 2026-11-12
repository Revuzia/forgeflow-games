// the clear tunnel through the cloud deck (src/render/sky/clouds.ts deckTunnel): a player's zoom through the deck —
// a trackpad's steady scroll as well as mouse-wheel notches — must not white out the frames inside the deck; a camera
// resting in the deck sees the ground through a thinned mist (owner ruling 2026-11-12)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deckTunnel, newTunnelState } from '../src/render/sky/clouds.ts';

const R = 3000, INNER = R + 180, OUTER = R + 420;
const inShellOf = (r: number) => Math.min(1, Math.max(0, (r - INNER + 20) / 20)) * Math.min(1, Math.max(0, (OUTER + 20 - r) / 20));

/** fly a radius path at 60 fps; returns the worst in-cloud fog seen deep inside the shell and the smallest near zone */
function fly(path: (frame: number) => number, frames: number): { worstFog: number; minNear: number; inside: number } {
  const st = newTunnelState();
  let worstFog = 0, minNear = Infinity, inside = 0;
  for (let f = 0; f < frames; f++) {
    const r = path(f);
    const s = inShellOf(r);
    const t = deckTunnel(st, r, 1000 + f * (1000 / 60), INNER, OUTER, s);
    if (s >= 1 && f > 12) { inside++; worstFog = Math.max(worstFog, t.camFog); minNear = Math.min(minNear, t.nearR); }
  }
  return { worstFog, minNear, inside };
}

test('a trackpad zoom (0.4-1 % of the distance a frame) through the deck keeps the tunnel open', () => {
  for (const rate of [0.004, 0.0065, 0.01]) {
    // orbit distance d from 900 m down, altitude ~0.7 d
    const res = fly((f) => R + 0.7 * 900 * Math.exp(-rate * f), Math.round(Math.log(900 / 150) / rate));
    assert.ok(res.inside > 10, `frames inside at rate ${rate}: ${res.inside}`);
    assert.ok(res.worstFog < 0.1, `in-cloud fog during the zoom at rate ${rate}: ${res.worstFog}`);
    assert.ok(res.minNear > 300, `near zone during the zoom at rate ${rate}: ${res.minNear}`);
  }
});

test('mouse-wheel notches (14 % every 4 frames) keep it open', () => {
  const res = fly((f) => R + 0.7 * 1400 * Math.exp(-0.13 * Math.floor(f / 4)), 70);
  assert.ok(res.inside > 0);
  assert.ok(res.worstFog < 0.1, `fog ${res.worstFog}`);
});

test('a camera resting inside the deck sees through a thinned mist (owner ruling 2026-11-12); outside the shell nothing changes', () => {
  const st = newTunnelState();
  let last = { camFog: 0, nearR: 0, mist: 0 };
  const mid = (INNER + OUTER) / 2;
  // zoom in, then rest at mid-deck for 4 s: the tunnel closes to the resting mist, not to a white-out
  for (let f = 0; f < 60 * 5; f++) {
    const r = f < 60 ? mid + 300 * (1 - f / 60) : mid;
    last = deckTunnel(st, r, 1000 + f * (1000 / 60), INNER, OUTER, inShellOf(r));
  }
  assert.ok(last.camFog > 0.2 && last.camFog < 0.4, `resting fog: ${last.camFog}`);
  assert.ok(last.mist >= 0.4, `resting mist floor: ${last.mist}`);
  assert.ok(last.nearR > 300, `resting clear zone: ${last.nearR}`);
  // resting in the deck's upper part (round 3: fully white there): the clear zone reaches through the deck below
  const top = newTunnelState();
  for (let f = 0; f < 300; f++) last = deckTunnel(top, OUTER - 10, 1000 + f * 16.7, INNER, OUTER, inShellOf(OUTER - 10));
  assert.ok(last.nearR > (OUTER - 10 - INNER) * 2, `clear zone at the deck top: ${last.nearR}`);
  // above the deck, still: no fog, no clear zone, no mist (the deck seen from above is the deck)
  const above = newTunnelState();
  for (let f = 0; f < 120; f++) last = deckTunnel(above, OUTER + 600, 1000 + f * 16.7, INNER, OUTER, 0);
  assert.ok(last.camFog === 0 && last.nearR < 40 && last.mist === 0, `above the deck: ${JSON.stringify(last)}`);
});
