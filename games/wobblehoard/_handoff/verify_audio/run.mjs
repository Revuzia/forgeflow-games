// Verifier runner: vite (port 5380, frozen) on the scratch copy + Chromium; runs the named jobs and stores raw Float32 stems.
//   node run.mjs job1 job2 ...
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { launch } from './wb/_harness/pw.mjs';
import { playScenario, sparseScenario, placements } from './scen.mjs';

const HERE = '/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/verify_audio3';
const DATA = resolve(HERE, process.env.DATADIR || 'data');
mkdirSync(DATA, { recursive: true });
const PORT = 5380;
const URL = `http://localhost:${PORT}/`;

async function up() { try { return (await fetch(URL)).ok; } catch { return false; } }
let vite = null;
if (!(await up())) {
  vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: resolve(HERE, process.env.WBDIR || 'wb'), env: { ...process.env, WH_FROZEN: '1' }, stdio: 'ignore', detached: true });
  const t0 = Date.now();
  while (!(await up())) { if (Date.now() - t0 > 90000) throw new Error('vite'); await new Promise((r) => setTimeout(r, 300)); }
}
const stopVite = () => { if (vite) { try { process.kill(-vite.pid); } catch { /* gone */ } } };
process.on('exit', stopVite);

const browser = await launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
await page.goto(`${URL}_harness/audioview/index.html`);
await page.waitForFunction(() => window.AV && window.AV.ready, null, { timeout: 120000 });
await page.evaluate(() => import('/_harness/myv/drv.js'));

const dec = (s) => { const b = Buffer.from(s, 'base64'); return b; };
async function engine(name, spec, meta = {}) {
  const t0 = Date.now();
  const r = await page.evaluate((s) => window.MYV.runEngine(s), spec);
  for (const k of ['mix', 'music', 'fx', 'mixL', 'mixR']) if (r[k]) { writeFileSync(resolve(DATA, `${name}.${k}.f32`), dec(r[k])); delete r[k]; }
  writeFileSync(resolve(DATA, `${name}.json`), JSON.stringify({ ...r, spec: { ...spec, events: undefined }, nEvents: spec.events?.length ?? 0, ...meta }));
  console.log(name, 'wall', ((Date.now() - t0) / 1000).toFixed(1), 's; render', (r.wallMs / 1000).toFixed(1), 's; stops', r.stops, 'errors', r.errors, JSON.stringify(r.final.music).slice(0, 300), 'nodes', r.final.stats.liveNodes);
  return r;
}

const jobs = {
  // music alone (reference), engine seed 11, 72 s
  async ref11() { await engine('ref11', { secs: 72, seed: 11, events: [] }); },
  // dense continuous play 4..64 s at 3-6 interactions/s
  async dense11() { const s = playScenario(101, 4, 64); writeFileSync(resolve(DATA, 'dense11.events.json'), JSON.stringify(s)); await engine('dense11', { secs: 72, seed: 11, events: s.ev }, { rate: s.rate, n: s.n }); },
  async sparse11() { const s = sparseScenario(202, 4, 64); writeFileSync(resolve(DATA, 'sparse11.events.json'), JSON.stringify(s)); await engine('sparse11', { secs: 72, seed: 11, events: s.ev }, { rate: s.rate, n: s.n }); },
  async bursts11() {
    const ev = [], spans = []; let n = 0;
    for (let k = 0; k < 6; k++) { const s = playScenario(300 + k, 4 + 10 * k, 9 + 10 * k, { lo: 3.5, hi: 5 }); ev.push(...s.ev); spans.push(...s.spans); n += s.n; }
    writeFileSync(resolve(DATA, 'bursts11.events.json'), JSON.stringify({ ev, spans, n }));
    await engine('bursts11', { secs: 72, seed: 11, events: ev }, { n });
  },
  // isolated placements for separation, 3 engine seeds x 120 s (+ references)
  async place() {
    for (const [seed, ps] of [[22, 501], [33, 502], [44, 503]]) {
      const s = placements(ps, 4, 124);
      writeFileSync(resolve(DATA, `place${seed}.events.json`), JSON.stringify(s));
      await engine(`place${seed}`, { secs: 126, seed, events: s.ev, want: ['music', 'fx'] }, { n: s.spans.length });
    }
  },
  async placeHi() {
    const s = placements(601, 4, 64);
    writeFileSync(resolve(DATA, 'placehi55.events.json'), JSON.stringify(s));
    await engine('placehi55', { secs: 66, seed: 55, music: 1, events: s.ev, want: ['music', 'fx'] }, { n: s.spans.length });
  },
  async rooms() {
    // pad only and melody only, seed 5, 40 s: no dip vs a -24 dB one-shot dip at 12.0 s held to 12.9 s, and a staircase
    for (const [tag, layers] of [['pad', { pad: 1, mallet: 0 }], ['mel', { pad: 0, mallet: 1 }]]) {
      for (const [rt, rooms] of [['none', []], ['dip', [{ from: 12.0, until: 12.9, db: -24 }, { from: 20.0, until: 20.25, db: -24 }, { from: 20.1, until: 24.0, db: -10 }, { from: 21.0, until: 21.3, db: -24 }]]]) {
        const r = await page.evaluate((s) => window.MYV.musicRooms(s), { secs: 40, seed: 5, layers, rooms });
        writeFileSync(resolve(DATA, `rooms_${tag}_${rt}.f32`), dec(r.x));
        if (rt === 'none') writeFileSync(resolve(DATA, `rooms_${tag}_log.json`), JSON.stringify(r.log));
      }
    }
    console.log('rooms done');
  },
  async live() {
    await page.evaluate(() => import('/_harness/myv/live.js'));
    const ios = await page.evaluate(() => window.MYL.iosDedupe());
    const r0 = await page.evaluate(() => window.MYL.revealStall(0));
    const r1 = await page.evaluate(() => window.MYL.revealStall(800));
    const r2 = await page.evaluate(() => window.MYL.revealStall(0));
    const out = { ios, reveal: [r0, r1, r2] };
    writeFileSync(resolve(DATA, 'live.json'), JSON.stringify(out, null, 1));
    console.log(JSON.stringify(out));
  },
  async placeFull() {
    // every effect on full-level music: 7.5-9 s after the previous one ended (the hold is 4.5 s + a 2 s return)
    for (const [seed, ps, mv] of [[22, 701, 0.45], [33, 702, 0.45], [44, 703, 0.45], [55, 704, 1]]) {
      const s = placements(ps, 4, mv === 1 ? 304 : 404, [7.5, 9]);
      const nm = `full${seed}${mv === 1 ? 'hi' : ''}`;
      writeFileSync(resolve(DATA, `${nm}.events.json`), JSON.stringify(s));
      await engine(nm, { secs: mv === 1 ? 306 : 406, seed, music: mv, events: s.ev, want: ['music', 'fx'] }, { n: s.spans.length });
    }
  },
  async bub() {
    const notes = [];
    for (const pitch of [1, 0.97, 1.06]) for (let m = 79; m <= 100; m++) notes.push({ midi: m, pitch });
    const r = await page.evaluate((s) => window.MYV.bubbles(s), { notes });
    for (const q of r) writeFileSync(resolve(DATA, `bub_${q.midi}_${q.pitch}.f32`), dec(q.x));
    writeFileSync(resolve(DATA, 'bub.json'), JSON.stringify(r.map((q) => ({ midi: q.midi, pitch: q.pitch }))));
    console.log('bubbles', r.length);
  },
  async strand() {
    // the strand alone through the engine at realistic call patterns (no music), several audio-clock grids
    const sm = (u) => { const t = Math.min(1, Math.max(0, u)); return t * t * (3 - 2 * t); };
    const pats = [['30Hz_q128', 30, 0.3, 128 / 48000], ['60Hz_q10ms', 60, 0.2, 0.01], ['120Hz_q1024', 120, 0.1, 1024 / 48000], ['45Hz_q21ms', 45, 0.4, 1024 / 48000], ['90Hz_q5ms', 90, 0.25, 0.005]];
    const { mul32 } = await import('./scen.mjs');
    for (const [name, hz, jit, q] of pats) {
      const r = mul32(hz * 7);
      const ev = [];
      // stretch 0 -> 0.8 over 1.0 s, hold 0.8 for 1.0 s (trembling), then calls stop (no snap)
      let t = 0.5;
      while (t < 2.5) { const x = t - 0.5; ev.push({ t, op: 'strand', a: { tension: x < 1 ? 0.8 * sm(x) : 0.8 + 0.015 * Math.sin(2 * Math.PI * 6 * x), pitch: 1 } }); t += (1 / hz) * (1 + jit * (2 * r() - 1)); }
      // a second gesture: slow pull to 0.4 and hold (low tension)
      t = 4;
      while (t < 6) { const x = t - 4; ev.push({ t, op: 'strand', a: { tension: x < 1 ? 0.4 * sm(x) : 0.4, pitch: 1.3 } }); t += (1 / hz) * (1 + jit * (2 * r() - 1)); }
      await engine(`strand_${name}`, { secs: 7.5, seed: 77, musicOn: false, quantum: q, frameHz: 240, events: ev, want: ['mix', 'fx'] });
    }
  },
};

for (const j of process.argv.slice(2)) { console.log('== job', j); await jobs[j](); }
await browser.close();
stopVite();
process.exit(0);
