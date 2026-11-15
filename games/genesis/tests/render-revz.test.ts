// PERF s18 (ROADMAP-60FPS step 8): reversed-Z float depth — the decode, the choice of path, the CPU frustum.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Frustum, Matrix4, PerspectiveCamera, Sphere, Vector3 } from 'three';
import { CAM_FAR, CAM_NEAR, DEPTH_DECODE, REVZ, chooseDepthMode, frustumFromProjection, reversedFromViewZ, revzReport, viewZFromReversed } from '../src/render/shaders/revz.ts';

const fakeGl = (ext: string[]) => ({ getSupportedExtensions: () => ext }) as unknown as WebGL2RenderingContext;

test('revz: with EXT_clip_control the reversed path is chosen; without it, or switched off, the log path', () => {
  assert.equal(chooseDepthMode(fakeGl(['EXT_clip_control', 'EXT_depth_clamp']), true), true);
  assert.equal(REVZ.on, true);
  assert.match(revzReport()[0], /REVERSED-Z.*EXT_clip_control YES/);
  assert.match(revzReport()[1], /\+EXT_clip_control .*\+EXT_depth_clamp/);
  assert.equal(chooseDepthMode(fakeGl(['EXT_depth_clamp']), true), false);
  assert.equal(REVZ.on, false);
  assert.match(revzReport()[0], /LOGARITHMIC.*EXT_clip_control NO/);
  assert.match(revzReport()[1], /-EXT_clip_control/);
  assert.equal(chooseDepthMode(fakeGl(['EXT_clip_control']), false), false);
  assert.match(revzReport()[0], /LOGARITHMIC.*EXT_clip_control YES.*revz=0/);
  assert.equal(chooseDepthMode(null, true), false);
});

test('revz: the depth three writes for a reversed projection decodes to the view depth, to float precision', () => {
  const cam = new PerspectiveCamera(50, 16 / 9, CAM_NEAR, CAM_FAR);
  (cam as unknown as { _reversedDepth: boolean })._reversedDepth = true;
  cam.updateProjectionMatrix();
  const f32 = new Float32Array(1);
  for (const w of [0.05, 0.3, 1, 7, 90, 1400, 7600, 2.5e5, 3e6, 1.9e7]) {
    // clip z and w as the vertex shader computes them (float32), the perspective divide, a float32 depth buffer
    const p = new Vector3(0, 0, -w).applyMatrix4(cam.projectionMatrix); // (three divides by w)
    f32[0] = p.z;
    const d = f32[0];
    assert.ok(d >= 0 && d <= 1, `depth in range at ${w}`);
    assert.ok(Math.abs(d - reversedFromViewZ(w)) <= 2e-7 * Math.max(d, 1e-30) + 1e-12, `three's depth = the formula at ${w}`);
    const back = viewZFromReversed(d);
    assert.ok(Math.abs(back - w) / w < 4e-7, `decode at ${w} m: ${back}`);
  }
  // nearer is larger; nothing drawn (cleared 0) is the sky
  assert.ok(reversedFromViewZ(10) > reversedFromViewZ(11));
  assert.equal(reversedFromViewZ(CAM_NEAR), 1);
  assert.equal(reversedFromViewZ(CAM_FAR), 0);
});

test('revz: two surfaces 2 cm apart at 1 km, 1 m apart at 1000 km keep distinct float32 depths (log depth could not)', () => {
  const f = new Float32Array(2);
  for (const [w, gap] of [[1000, 0.02], [1e6, 1], [50, 0.001], [7600, 0.05]]) {
    f[0] = reversedFromViewZ(w); f[1] = reversedFromViewZ(w + gap);
    assert.ok(f[0] > f[1], `distinct at ${w} m + ${gap}`);
  }
});

test('revz: the decode chunk serves both paths from three\'s own define', () => {
  assert.match(DEPTH_DECODE, /#ifdef USE_REVERSED_DEPTH_BUFFER/);
  assert.match(DEPTH_DECODE, /GENESIS_NDC_NEAR 1\.0/);
  assert.match(DEPTH_DECODE, /GENESIS_NDC_NEAR -1\.0/);
  assert.match(DEPTH_DECODE, /d <= 0\.0/);
  assert.match(DEPTH_DECODE, /d >= 0\.999999/);
  assert.match(DEPTH_DECODE, /0\.0500/);
});

test('revz: a frustum from a reversed projection culls like the standard one', () => {
  const std = new PerspectiveCamera(50, 16 / 9, CAM_NEAR, 5000);
  const rev = new PerspectiveCamera(50, 16 / 9, CAM_NEAR, 5000);
  (rev as unknown as { _reversedDepth: boolean })._reversedDepth = true;
  for (const c of [std, rev]) { c.position.set(3, 40, -7); c.lookAt(100, 0, 60); c.updateProjectionMatrix(); c.updateMatrixWorld(true); }
  const fs = frustumFromProjection(new Frustum(), new Matrix4().multiplyMatrices(std.projectionMatrix, std.matrixWorldInverse), std);
  const fr = frustumFromProjection(new Frustum(), new Matrix4().multiplyMatrices(rev.projectionMatrix, rev.matrixWorldInverse), rev);
  let inside = 0, n = 0, s = 12345;
  const rnd = (): number => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < 4000; i++) {
    const sp = new Sphere(new Vector3((rnd() - 0.5) * 16000, (rnd() - 0.5) * 3000, (rnd() - 0.5) * 16000), rnd() * 80);
    const a = fs.intersectsSphere(sp), b = fr.intersectsSphere(sp);
    // (the plane equations are normalised from different rows: allow a sphere touching a plane to within rounding)
    if (a !== b) { const m = Math.min(...fs.planes.map((p) => Math.abs(p.distanceToPoint(sp.center) + sp.radius))); assert.ok(m < 1e-2, `sphere ${i} differs away from a plane (${m})`); }
    if (a) inside++; n++;
  }
  assert.ok(inside > 50 && inside < n - 50, `a real mix of inside / outside (${inside}/${n})`);
});
