// VALE probe — ruling 67: the device start ceiling (src/render/device_tier.ts) and the first-run start preset
// (src/boot/start_tier.ts), pure. Renderer strings are the shapes Chrome on Windows (ANGLE on Direct3D 11), Chrome on a
// Mac (ANGLE on Metal), SwiftShader and Firefox report.
//   node _harness/probe_device_tier.ts
import { classifyDevice, gpuClass, TEXTURE_CAP, type GpuFacts } from '../src/render/device_tier.ts';
import { calibStillValid, parseTier, startPreset } from '../src/boot/start_tier.ts';

let fails = 0;
const expect = (ok: boolean, m: string): void => { if (ok) console.log(`ok   ${m}`); else { fails++; console.log(`FAIL ${m}`); } };
const f = (renderer: string, o: Partial<GpuFacts> = {}): GpuFacts => ({ renderer, vendor: 'Google Inc.', caveat: false, deviceMemory: 8, cores: 8, maxTextureSize: 16384, ...o });

const cases: [string, string, string][] = [
  ['ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated', 'low'],
  ['ANGLE (Intel, Intel(R) UHD Graphics (0x00009A78) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated', 'low'],
  ['ANGLE (Intel, Intel(R) HD Graphics 520 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated', 'low'],
  ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x0000A7A0) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated', 'medium'],
  ['ANGLE (Intel, Intel(R) Arc(TM) Graphics (0x00007D55) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated', 'medium'],
  ['ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics (0x000056A0) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete', 'high'],
  ['ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated', 'medium'],
  ['ANGLE (AMD, AMD Radeon(TM) Vega 8 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated', 'medium'],
  ['ANGLE (AMD, AMD Radeon 780M Graphics (0x000015BF) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated', 'medium'],
  ['ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete', 'high'],
  ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002520) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete', 'high'],
  ['ANGLE (NVIDIA, NVIDIA GeForce MX350 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated', 'medium'],
  ['ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified Version)', 'apple', 'high'],
  ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'software', 'low'],
  ['ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)', 'software', 'low'],
  ['llvmpipe (LLVM 15.0.7, 256 bits)', 'software', 'low'],
  ['ANGLE (Intel, Intel(R) HD Graphics 4000 Direct3D9Ex vs_3_0 ps_3_0)', 'integrated', 'low'],
  ['ANGLE (Qualcomm, Adreno (TM) 690 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'mobile', 'medium'],
  ['Mali-G78', 'mobile', 'low'],
  ['Apple GPU', 'apple', 'high'],
  ['', 'unknown', 'high'],
  ['WebKit WebGL', 'unknown', 'high'],
];
for (const [r, gpu, cap] of cases) {
  const g = gpuClass(r);
  expect(g.gpu === gpu && g.cap === cap, `${r || '(empty)'} -> ${g.gpu} / ${g.cap}`);
}
// machine facts
expect(classifyDevice(f('Apple GPU', { deviceMemory: 4 })).cap === 'medium', '4 GB -> at most medium');
expect(classifyDevice(f('Apple GPU', { deviceMemory: 2 })).cap === 'low', '2 GB -> low');
expect(classifyDevice(f('Apple GPU', { cores: 4 })).cap === 'medium', '4 cores -> at most medium');
expect(classifyDevice(f('Apple GPU', { cores: 2 })).cap === 'low', '2 cores -> low');
expect(classifyDevice(f('Apple GPU', { maxTextureSize: 2048 })).cap === 'low', 'MAX_TEXTURE_SIZE 2048 -> low');
expect(classifyDevice(f('Apple GPU', { deviceMemory: undefined, cores: undefined })).cap === 'high', 'no facts -> the GPU decides');
// the owner's tester: 16 GB (Chrome reports 8), a Windows laptop; an Intel UHD is low whatever the memory
expect(classifyDevice(f('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', { deviceMemory: 8, cores: 8 })).cap === 'low', '16 GB Windows laptop on Intel UHD -> low');
// a context that fails failIfMajorPerformanceCaveat is software whatever its string says
{
  const c = classifyDevice(f('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)', { caveat: true }));
  expect(c.software && c.cap === 'low', `major performance caveat -> software, low (${c.gpu}/${c.cap})`);
}
expect(classifyDevice(f('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)')).software, 'SwiftShader is software');
// texture caps: High and Ultra unchanged (the live look)
expect(TEXTURE_CAP.high === 0 && TEXTURE_CAP.ultra === 0 && TEXTURE_CAP.medium === 1024 && TEXTURE_CAP.low === 512, 'texture caps: low 512, medium 1024, high / ultra none');
// the start preset
const low = classifyDevice(f('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)'));
const hi = classifyDevice(f('Apple GPU'));
const base = { forced: null, auto: true, untouchedHigh: true, devtierDone: false } as const;
expect(startPreset({ ...base, cls: low }) === 'low', 'untouched profile on Intel UHD starts at low');
expect(startPreset({ ...base, cls: hi }) === null, 'a High-class device keeps the default (calibration decides)');
expect(startPreset({ ...base, cls: low, untouchedHigh: false }) === null, "a player's own preset is never moved");
expect(startPreset({ ...base, cls: low, devtierDone: true }) === null, 'the ceiling applies once');
expect(startPreset({ ...base, cls: low, auto: false }) === null, 'an automated browser keeps the default');
expect(startPreset({ ...base, cls: hi, forced: 'low', auto: false }) === 'low', '?tier=low forces low');
expect(parseTier('ultra') === 'ultra' && parseTier('x') === null && parseTier(null) === null, 'parseTier');
// stored first-run verdicts: the old rule's under-30-frame High is no verdict
expect(!calibStillValid(JSON.stringify({ preset: 'high', frames: 1, p50Ms: 0, p95Ms: 0 })), 'old 1-frame High verdict is judged again');
expect(calibStillValid(JSON.stringify({ preset: 'high', frames: 181 })), 'a real High verdict stands');
expect(calibStillValid(JSON.stringify({ preset: 'low', frames: 0 })), 'a forced Low verdict stands');
expect(!calibStillValid(null) && !calibStillValid('{bad'), 'no or bad verdict');
console.log(fails ? `probe_device_tier: ${fails} FAILURE(S)` : 'probe_device_tier: PASS');
process.exit(fails ? 1 : 0);
