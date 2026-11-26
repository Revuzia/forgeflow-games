// LOADTIME task 5: the renderer-string classes behind the "weak graphics" notice (render/gpuclass.ts, ui/gpunotice.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyGpu, gpuShortName } from '../src/render/gpuclass.ts';
import { gpuNoticeText } from '../src/ui/gpunotice.ts';

test('gpu classes from unmasked renderer strings', () => {
  const C: [string, string][] = [
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 (0x00002F04) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ok'],
    ['ANGLE (Intel, Intel(R) UHD Graphics 770 (0x00004680) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
    ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
    ['ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics (0x000056A0) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ok'],
    ['ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
    ['ANGLE (AMD, AMD Radeon RX 7800 XT (0x0000747E) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ok'],
    ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'software'],
    ['ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'software'],
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified Version)', 'ok'],
    ['', 'unknown'],
  ];
  for (const [s, want] of C) assert.equal(classifyGpu(s), want, s);
  assert.equal(gpuShortName(C[1][0]), 'Intel(R) UHD Graphics 770');
});

test('the notice: software always, built-in graphics on Windows only, nothing for a real GPU', () => {
  assert.ok(gpuNoticeText('software', 'x', false));
  assert.ok(gpuNoticeText('integrated', 'ANGLE (Intel, Intel(R) UHD Graphics 770 (0x00004680) Direct3D11 vs_5_0 ps_5_0, D3D11)', true)!.body[0].includes('Intel(R) UHD Graphics 770'));
  assert.equal(gpuNoticeText('integrated', 'x', false), null);
  assert.equal(gpuNoticeText('ok', 'x', true), null);
  assert.equal(gpuNoticeText('unknown', 'x', true), null);
});
