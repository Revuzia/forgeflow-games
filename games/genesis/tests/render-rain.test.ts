// GENESIS — rain drawn as water, not chalk (punch P06: the first rain on the barren world fell as thick white bars).
// The precipitation box round the camera put streaks a hand's breadth from the lens at full strength, 20 mm wide and
// bright 1.6 × the sky's light at alpha .55: at 2 m a streak was ~9 px wide, at 1 m it was a bar across the frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const VFX = readFileSync(new URL('../src/render/fx/vfx.ts', import.meta.url), 'utf8');
const WX = readFileSync(new URL('../src/render/fx/weatherfx.ts', import.meta.url), 'utf8');

test('rain streaks are thin, fade out before the lens and are not drawn chalk-white (punch P06)', () => {
  const rain = /\n\s*1: \{ sys: SYS\.precip, speed: [\d.]+, size: ([\d.]+)/.exec(WX);
  assert.ok(rain, 'the rain entry of the fall table');
  const w = Number(rain[1]);
  assert.ok(w <= 0.013, `a rain streak is ${w * 1000} mm wide`);
  // pixels across at 2 m (60° vertical fov, 540 px tall)
  const px = w / ((2 * Math.tan(Math.PI / 6) * 2) / 540);
  assert.ok(px <= 6, `a streak 2 m from the lens is ${px.toFixed(1)} px wide`);
  const branch = VFX.slice(VFX.indexOf('} else if (S == 16 || S == 19) {'), VFX.indexOf('} else if (S == 17) {'));
  assert.match(branch, /S == 16 && p2 < 0\.5\) a \*= smoothstep\(1\.\d+, [2-9](\.\d+)?, length\(q\)\)/, 'rain fades out in the last metres before the lens');
  const frag = VFX.slice(VFX.indexOf('// a rain streak: thin'), VFX.indexOf('// a leaf: a little lit ellipse'));
  const bright = Number((/float bright = ([\d.]+);/.exec(frag) ?? [])[1]);
  assert.ok(bright <= 1.4, `rain is lit ${bright} × the sky's light`);
  assert.match(frag, /vKind > 5\.1 \? 0\.55 : 0\.4\d?\)/, "a rain streak's alpha is under .45 (a driven flake keeps .55)");
});

// the first rain seen from the god's height (punch P06, fr4i-first-rain-60: orbit 400 m in the storm): the downpour's
// ground murk (0.5 x 0.011 /m over ~140 m of air, x(1 + 1.2 gust)) veiled the bare hill at 50-80 % in pale blue-grey —
// the rock read as frost — and the Touch's cloud, lit by the full sun under the storm deck, stood on it as a white crescent
test("a downpour's murk thins with the god's height, and the Touch's cloud is not sunlit under the storm deck (punch P06)", () => {
  const m = /const rainK = (type === 2 && precip > 6 \? [^;]+);/.exec(WX);
  assert.ok(m, 'the downpour murk has its own term');
  const smooth = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const rainK = new Function('type', 'precip', 'alt', 'smooth', `return ${m[1]};`) as (t: number, p: number, a: number, s: typeof smooth) => number;
  assert.equal(rainK(2, 10, 20, smooth), 0.5, 'down among things the downpour still closes in');
  const k400 = rainK(2, 10, 400, smooth);
  assert.ok(k400 <= 0.2, `from 400 m the murk is ${k400}`);
  // the veil it lays on the ground below a camera 375 m up looking 20° off straight down, gusting (screenfx.ts)
  const H = 140, h0 = 375, slope = -Math.cos((20 * Math.PI) / 180), d = h0 / -slope;
  const k = (H / slope) * (Math.exp(-h0 / H) - Math.exp(-(h0 + d * slope) / H));
  const veil = 1 - Math.exp(-k400 * 0.011 * (1 + 1.2 * 0.6) * k);
  assert.ok(veil < 0.35, `the hill below is veiled ${(veil * 100).toFixed(0)} %`);
  assert.match(WX, /Math\.max\(fog, type === 7 \? [^,]+, rainK, hazeK\)/, 'the murk term feeds the fog');
  const HAND = readFileSync(new URL('../src/render/hand.ts', import.meta.url), 'utf8');
  const light = HAND.slice(HAND.indexOf('vec3 touchLight(vec3 P) {'), HAND.indexOf('}', HAND.indexOf('vec3 touchLight(vec3 P) {')));
  assert.match(light, /overcastAt|uOvercastK/, "the Touch's light knows the storm overhead");
  const sunK = Number((/sun \* 0\.24 \* \(1\.0 - ([\d.]+) \* ov\)/.exec(light) ?? [])[1]);
  assert.ok(sunK >= 0.7, `under the deck the Touch's cloud keeps ${(1 - sunK) * 100} % of the sun`);
  const CL = readFileSync(new URL('../src/render/sky/clouds.ts', import.meta.url), 'utf8');
  assert.match(CL, /uOvercastC: \{ value: new Vector4\(/, "the overcast uniforms are among the planet's shared uniforms");
});
