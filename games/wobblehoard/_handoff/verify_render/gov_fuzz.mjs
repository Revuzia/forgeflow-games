// FlashGovernor property fuzz (pure TS, node): random / adversarial request streams, check the DESIGN 6.6 invariants on what it GRANTS.
import { FlashGovernor, rampEnvelope } from '/home/user/forgeflow-games/games/wobblehoard/src/render/flash.ts';
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const viol = { flashWindow: 0, flashGap: 0, alpha: 0, ring: 0, tint: 0, calm: 0 };
let maxInWindow = 0, minGap = Infinity;
for (let run = 0; run < 2000; run++) {
  const g = new FlashGovernor();
  let t = rnd() * 100;
  const grants = [], rings = [], tints = [];
  for (let i = 0; i < 400; i++) {
    t += rnd() < 0.3 ? rnd() * 0.02 : rnd() * 0.4;        // bursts of requests and gaps
    const k = rnd();
    if (k < 0.4) { const a = g.flash(t, rnd() * 0.6); if (a > 0) { grants.push(t); if (a > 0.25 + 1e-12) viol.alpha++; } }
    else if (k < 0.7) { if (g.ring(t)) rings.push(t); }
    else { const fam = ['coral', 'cyan', 'other'][Math.floor(rnd() * 3)]; const got = g.tint(t, fam); if (got === fam && fam !== 'other') tints.push([t, got]); }
    if (rnd() < 0.002) { g.calm = true; if (g.flash(t, 0.2) > 0 || g.ring(t)) viol.calm++; g.calm = false; }
  }
  for (let i = 0; i < grants.length; i++) {
    let n = 0; for (let j = i; j < grants.length && grants[j] - grants[i] < 1; j++) n++;
    maxInWindow = Math.max(maxInWindow, n); if (n > 2) viol.flashWindow++;
    if (i) { minGap = Math.min(minGap, grants[i] - grants[i - 1]); if (grants[i] - grants[i - 1] < 0.48 - 1e-9) viol.flashGap++; }
  }
  for (let i = 1; i < rings.length; i++) if (rings[i] - rings[i - 1] < 0.5 - 1e-9) viol.ring++;
  // GRANTED tints (returned === requested): a coral <-> cyan switch must come >= 0.5 s after the last grant of the other family
  let lastFam = null, lastAt = -1e9;
  for (const [tt, f] of tints) {
    if (f === 'other') continue;
    if (lastFam && f !== lastFam && tt - lastAt < 0.5 - 1e-9) viol.tint++;
    lastFam = f; lastAt = tt;
  }
}
// luminance transitions implied by two granted ramps at the minimum spacing: up, down, up, down inside 1 s?
const ramps = [0, 0.48];
const env = (t) => ramps.reduce((s, r0) => s + rampEnvelope(t - r0), 0);
let pivot = env(0), dir = 0, flips = []; const thr = 0.3;
for (let t = 0; t <= 1.2; t += 1 / 60) { const v = env(t); if (dir >= 0 && v < pivot - thr) { dir = -1; pivot = v; flips.push(+t.toFixed(2)); } else if (dir <= 0 && v > pivot + thr) { dir = 1; pivot = v; flips.push(+t.toFixed(2)); } else if ((dir === 1 && v > pivot) || (dir === -1 && v < pivot) || dir === 0) pivot = dir === 0 ? pivot : v; }
console.log(JSON.stringify({ violations: viol, maxGrantsIn1s: maxInWindow, minGrantGap: +minGap.toFixed(3), twoRampsAtMinSpacing_envelopeFlips_at30pctOfPeak: flips }));
