// VALE harness — Settings › Audio › "Soften loud sounds" holds the mix's average loudness (final parity AUD-m4).
//
//   node _harness/probe_audio_soften.mjs [--out <report.json>]
//
// Real Chrome (pw.mjs), the real client (?dev=1&render=0) and the real engine (window.__valeAudio): its output stage
// is read from the live graph (the limiter's and the soften compressor's own parameters, the soften makeup gain), the
// shipped files are decoded by the engine itself, and a 30 s match-like program is rendered offline through the same
// stage twice — soften off (mix → master → limiter) and on (mix → soften compressor → makeup → master → limiter). The program:
// the RIFT match bed (calm, plus its intense layer through a 15 s fight), lane skirmishes (minion swings / hits), four
// fighters' kit autos (swing + hit at the engine's gains), ability hits, two crits, two ult releases and an announcer
// line, every cue at its catalog gain × its bus's default volume (session defaults) × the engine's per-event gain.
// The output is metered BS.1770 (K-weighted, 400 ms momentary / 3 s short-term, gated integrated).
// Gates:
//   S1  integrated loudness with soften on is within 1.5 LU of off (the average holds)
//   S2  the loud moments come down against the rest: the sample peak drops >= 2 dB, the short-term range (p95 - p10)
//       narrows >= 3 LU, and the max momentary does not rise
// Exit 0 = S1, S2 hold. Report → _harness/_reports/integ_audio_soften.json. Needs the dev server and a built catalog.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(HERE, '_reports', 'integ_audio_soften.json');
// --try '[{"threshold":-12,"knee":6,"ratio":4,"makeupDb":-2}, …]': also render these soften stages (tuning; not gated)
const TRY = args.includes('--try') ? JSON.parse(args[args.indexOf('--try') + 1]) : [];

const { browser, page, logs } = await open('/?dev=1&render=0', { hmr: false });
let res;
try {
  await page.waitForFunction(() => !!window.__valeAudio, null, { timeout: 30000 });
  res = await page.evaluate(async (TRY) => {
    const eng = window.__valeAudio;
    eng.ensure();
    const SR = 48000, LEN = 30;
    const cues = eng.cues, ev = eng.events;
    const vol = eng.vol;
    const busVol = (b) => (b === 'music' ? vol.music : b === 'sfx' ? vol.sfx : b === 'voice' ? vol.voice : b === 'ui' ? vol.ui : vol.ambience);
    const lim = eng.limiter, soft = eng.soft;
    const P = (n) => ({ threshold: n.threshold.value, knee: n.knee.value, ratio: n.ratio.value, attack: n.attack.value, release: n.release.value });
    const stage = { limiter: P(lim), soft: P(soft), makeupDb: +(20 * Math.log10(eng.softMakeup?.gain.value ?? 1)).toFixed(2), master: vol.master };
    // the program: [t, file, gain]
    const plan = [];
    const file = async (f) => (await eng.buffer(f));
    const cue = (id, i = 0) => { const c = cues[id]; return c ? { f: c.files[i % c.files.length], g: c.gain, bus: c.bus } : null; };
    const at = (t, id, mul = 1, i = 0) => { const c = cue(id, i); if (c) plan.push({ t, f: c.f, g: c.g * mul * busVol(c.bus) }); };
    const bed = eng.beds?.mus_match_rift;
    const fighters = ['burdam', 'lisvel', 'kemdo', 'nurrow'];
    // lane skirmish all along: minion swings and hits
    for (let t = 0.3, i = 0; t < LEN; t += 0.7, i++) { at(t, ev.attack, 0.3, i); at(t + 0.18, ev.hitPhysical, 0.45, i); }
    // the fight, 10-25 s
    for (const [k, f] of fighters.entries()) {
      for (let t = 10 + k * 0.23, i = 0; t < 25; t += 0.9 + k * 0.07, i++) { at(t, `f_${f}_attack_swing`, 0.6, i); at(t + 0.2, `f_${f}_attack_hit`, 0.8, i); }
      for (let t = 11 + k * 0.6, i = 0; t < 25; t += 2.1, i++) at(t, `f_${f}_hit`, 1, i);
    }
    at(14.2, ev.crit, 1); at(19.7, ev.crit, 1);
    at(15, 'f_burdam_ult_release', 1); at(21, 'f_kemdo_ult_release', 1);
    const ann = Object.keys(cues).find((k) => cues[k].bus === 'voice');
    if (ann) at(26, ann, 1);
    // decode everything through the engine
    const bufs = new Map();
    for (const p of plan) if (!bufs.has(p.f)) bufs.set(p.f, await file(p.f));
    const musicFile = bed?.file, intenseFile = bed?.layers?.find((l) => l.id === 'intense')?.file;
    const mb = musicFile ? await file(musicFile) : null, ib = intenseFile ? await file(intenseFile) : null;
    const render = async (withSoft, alt = null) => {
      const oc = new OfflineAudioContext(2, SR * LEN, SR);
      // the engine's output stage: mix → [soften compressor → makeup] → master volume → limiter
      const mix = oc.createGain();
      const master = oc.createGain(); master.gain.value = stage.master;
      const l = oc.createDynamicsCompressor(); Object.entries(stage.limiter).forEach(([k, v]) => { l[k].value = v; });
      master.connect(l);
      if (withSoft) {
        const sp = alt ? { ...stage.soft, ...alt } : stage.soft;
        const s = oc.createDynamicsCompressor(); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) s[k].value = sp[k];
        const mk = oc.createGain(); mk.gain.value = Math.pow(10, (alt ? alt.makeupDb ?? 0 : stage.makeupDb) / 20);
        mix.connect(s).connect(mk).connect(master);
      } else mix.connect(master);
      l.connect(oc.destination);
      const src = (buf, t, g, loop = false, stop = null) => {
        if (!buf) return;
        const n = oc.createBufferSource(); n.buffer = buf; n.loop = loop;
        const gn = oc.createGain(); gn.gain.value = g; n.connect(gn).connect(mix); n.start(t); if (stop) n.stop(stop);
      };
      const mg = (bed?.gain ?? 1) * vol.music;
      src(mb, 0, mg, true);
      src(ib, 10, mg, true, 25);
      for (const p of plan) src(bufs.get(p.f), p.t, p.g);
      return oc.startRendering();
    };
    // BS.1770: K-weight (two biquads at 48 kHz), 400 ms blocks every 100 ms, 3 s short-term, gated integrated
    const kweight = async (buf) => {
      const oc = new OfflineAudioContext(2, buf.length, SR);
      const s = oc.createBufferSource(); s.buffer = buf;
      const f1 = oc.createIIRFilter([1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]);
      const f2 = oc.createIIRFilter([1, -2, 1], [1, -1.99004745483398, 0.99007225036621]);
      s.connect(f1).connect(f2).connect(oc.destination); s.start();
      return oc.startRendering();
    };
    const meter = async (buf) => {
      const k = await kweight(buf);
      const ch = [k.getChannelData(0), k.getChannelData(1)];
      const hop = SR / 10;
      const ms = [];
      for (let i = 0; i + hop <= k.length; i += hop) { let a = 0; for (const c of ch) for (let j = i; j < i + hop; j++) a += c[j] * c[j]; ms.push(a / hop); }
      const L = (m) => -0.691 + 10 * Math.log10(m + 1e-20);
      const win = (n) => { const o = []; for (let i = 0; i + n <= ms.length; i++) { let a = 0; for (let j = i; j < i + n; j++) a += ms[j]; o.push(a / n); } return o; };
      const mom = win(4), st = win(30);
      const gated = mom.filter((m) => L(m) > -70);
      const rel = L(gated.reduce((a, b) => a + b, 0) / gated.length) - 10;
      const g2 = gated.filter((m) => L(m) > rel);
      const integ = L(g2.reduce((a, b) => a + b, 0) / g2.length);
      const stL = st.map(L).filter((x) => x > -70).sort((a, b) => a - b);
      const pct = (q) => stL[Math.min(stL.length - 1, Math.floor(q * stL.length))];
      let peak = 0;
      for (const c of [buf.getChannelData(0), buf.getChannelData(1)]) for (const v of c) peak = Math.max(peak, Math.abs(v));
      return { integrated: +integ.toFixed(2), maxMomentary: +Math.max(...mom.map(L)).toFixed(2), maxShortTerm: +stL[stL.length - 1].toFixed(2),
        stP10: +pct(0.1).toFixed(2), stP95: +pct(0.95).toFixed(2), range: +(pct(0.95) - pct(0.1)).toFixed(2), peakDb: +(20 * Math.log10(peak)).toFixed(2) };
    };
    const off = await meter(await render(false));
    const on = await meter(await render(true));
    const candidates = [];
    for (const alt of TRY) candidates.push({ ...alt, ...(await meter(await render(true, alt))) });
    return { candidates, stage, events: plan.length, files: bufs.size, missing: [...bufs].filter(([, b]) => !b).map(([f]) => f), music: !!mb, intense: !!ib, off, on };
  }, TRY);
} finally {
  await browser.close();
}
const failures = [];
const d = +(res.on.integrated - res.off.integrated).toFixed(2);
if (!res.music || res.missing.length) failures.push(`program incomplete: music ${res.music}, missing ${res.missing.join(', ')}`);
if (Math.abs(d) > 1.5) failures.push(`S1 integrated loudness moves ${d} LU with soften on (> 1.5)`);
const dm = +(res.off.maxMomentary - res.on.maxMomentary).toFixed(2);
const dp = +(res.off.peakDb - res.on.peakDb).toFixed(2);
if (dp < 2) failures.push(`S2 the peak drops only ${dp} dB with soften on (< 2)`);
if (!(res.off.range - res.on.range >= 3)) failures.push(`S2 the short-term range narrows only ${res.off.range} -> ${res.on.range} (< 3 LU)`);
if (dm < 0) failures.push(`S2 max momentary rises ${-dm} dB with soften on`);
const report = { probe: 'probe_audio_soften', ...res, deltaIntegrated: d, maxMomentaryDrop: dm, peakDrop: dp, failures, pass: !failures.length, logs: logs.slice(0, 20) };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(`stage ${JSON.stringify(res.stage)}; ${res.events} cue events, ${res.files} files`);
console.log(`off ${JSON.stringify(res.off)}\non  ${JSON.stringify(res.on)}\nintegrated ${d >= 0 ? '+' : ''}${d} LU, peak ${-dp} dB, max momentary ${-dm} dB, short-term range ${res.off.range} -> ${res.on.range}`);
for (const c of res.candidates) console.log(`try ${JSON.stringify(c)}  dInt ${(c.integrated - res.off.integrated).toFixed(2)}  dMaxMom ${(res.off.maxMomentary - c.maxMomentary).toFixed(2)}`);
console.log(failures.length ? `FAIL\n  ${failures.join('\n  ')}` : 'PASS: soften holds the average loudness, takes the peaks down and narrows the range');
console.log(`report → ${OUT}`);
process.exit(failures.length ? 1 : 0);
