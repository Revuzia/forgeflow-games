// GENESIS — additive particle emission is display-referred at its ceiling (punch P03).
//
// At night the eye's exposure is high; a volcano's lava bombs and embers (14-18x physical emission) came out hundreds of
// times display white and the bloom spread them into a white glare disc over the whole frame (run probe1: the disc went
// with the additive particles hidden, not with the lit ash, the bolts, the decals or the disaster meshes). Every
// additive branch of the particle shader now rolls its emission off toward EMIT_CAP in display terms.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Mesh, ShaderMaterial } from 'three';
import { EMIT_CAP, Vfx } from '../src/render/fx/vfx.ts';

test('additive particles: every emissive branch rolls off toward a display ceiling (P03 volcano glare disc)', () => {
  const v = new Vfx({}, {}, 1024);
  const add = (v as unknown as { add: Mesh }).add.material as ShaderMaterial;
  assert.ok(EMIT_CAP > 1 && EMIT_CAP < 10, `a ceiling a little over display white (${EMIT_CAP})`);
  assert.equal(add.uniforms.uEmitCap?.value, EMIT_CAP, 'the pass carries the ceiling');
  const fs = add.fragmentShader;
  assert.match(fs, /vec3 emitCap\(vec3 c\)/, 'the roll-off is in the shader');
  // the additive writes (alpha 0: light added, nothing covered) all pass through it
  const additive = fs.split('\n').filter((l) => /gl_FragColor\s*=\s*vec4\(.*,\s*0\.0\);/.test(l));
  assert.ok(additive.length >= 3, `streaks, blobs and flashes (${additive.length})`);
  for (const l of additive) assert.match(l, /emitCap\(/, `capped: ${l.trim()}`);
  // the roll-off itself: c / (1 + L·E / cap) — bounded by the cap on screen however hot the source or high the exposure,
  // and all but untouched within the display's range
  const shown = (L: number, E: number) => (L * E) / (1 + (L * E) / EMIT_CAP);
  assert.ok(shown(18, 400) < EMIT_CAP, 'an ember at the night exposure stays under the ceiling');
  assert.ok(shown(0.2, 1) > 0.2 * 0.9, 'a dim spark by day keeps 90 % of itself');
  v.dispose();
});
