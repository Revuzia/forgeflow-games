// VALE harness — decoded audio across a real session in real Chrome (closing PERF-C2, the audio half; CW2 done-criterion
// "Decoded audio at Home after RIFT, BRIDGE, FRAY <= 150 MB, the previous bed freed on change").
//
//   node _harness/probe_audio_session_mem.mjs [--modes rift,bridge,fray] [--speed 16] [--out _harness/_reports/fw_CW2_session_mem.json]
//
// The closing verifier's method (closing_perf_verify_mem): ONE page (the dev server, ?dev=1&autopilot=match), Home → for
// each mode in turn: Play → the mode's station → (RIFT: Co-op vs bots) → Find match → Ready → a fighter locked → loading →
// the match on the dev autopilot at --speed to its REAL end → post-game → Return home; a forced GC (CDP
// HeapProfiler.collectGarbage), 3 s settle, then a sample of the audio engine's own buffer cache
// (window.__valeAudio.buffers: every settled AudioBuffer's length x channels x 4 bytes) with its biggest files, plus the
// JS heap. The match is sampled too (at 60 s of match time) to show what the cache holds in play.
// Gates:
//   S1  decoded audio at Home after each map <= 150 MB
//   S2  no match bed (mus_match_*) and no match-only cue (f_*, u_*, c_*) is left in the cache at Home
//   S3  the previous bed is freed on a bed change: at Home only the menu bed's files of the music beds remain
// Exit 0 = PASS, 1 = a gate fails, 2 = the journey broke (screens / timeouts).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, shot, vale, waitFor } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const MODES = String(opt('modes', 'rift,bridge,fray')).split(',');
const SPEED = Number(opt('speed', 16));
const OUT = opt('out', join(HERE, '_reports', 'fw_CW2_session_mem.json'));
const HOME_MB = 150;
const QUEUE_CARD = { rift: 'Co-op vs bots', bridge: null, fray: null };

const report = { probe: 'probe_audio_session_mem', at: new Date().toISOString(), speed: SPEED, samples: [], gates: {}, errors: [] };
const t0 = Date.now();
const log = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(5)} s  ${s}`);

const { browser, page, logs } = await open(`/?dev=1&autopilot=match&speed=${SPEED}`, { hmr: false });
const cdp = await page.context().newCDPSession(page);

/** the engine's cache: files settled, MB, biggest files, and which match-only / bed files are held */
async function audioCache() {
  return page.evaluate(async () => {
    const a = window.__valeAudio;
    if (!a?.buffers) return null;
    const rows = [];
    for (const [k, p] of a.buffers.entries()) {
      const b = await Promise.race([p, new Promise((r) => setTimeout(r, 50, null))]);
      if (b?.length) rows.push([k, b.length * b.numberOfChannels * 4, b.duration]);
    }
    rows.sort((x, y) => y[1] - x[1]);
    const name = (k) => k.split('/').pop().replace(/^[0-9a-f]{8,}-/, '');   // built files carry a content-hash prefix
    const bytes = rows.reduce((s, r) => s + r[1], 0);
    return {
      files: rows.length, mb: +(bytes / 1048576).toFixed(1),
      top: rows.slice(0, 10).map(([k, b, d]) => [name(k), +(b / 1048576).toFixed(1), Math.round(d)]),
      music: rows.filter(([k]) => /\/music\/|mus_/.test(k)).map(([k]) => name(k)),
      matchOnly: rows.filter(([k]) => /(^|\/)(f_|u_|c_|mus_match)/.test(name(k))).map(([k]) => name(k)),
    };
  });
}
async function sample(tag) {
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  await page.waitForTimeout(3000);
  const audio = await audioCache();
  const heapMb = await page.evaluate(() => +((performance.memory?.usedJSHeapSize ?? 0) / 1048576).toFixed(1));
  const route = await vale(page, (v) => v.router.route.value.screen);
  const s = { tag, route, heapMb, audio };
  report.samples.push(s);
  log(`${tag}: route ${route}, heap ${heapMb} MB, audio ${audio?.mb} MB in ${audio?.files} files; top ${JSON.stringify(audio?.top.slice(0, 4))}`);
  return s;
}

async function click(locator) {
  await locator.first().waitFor({ state: 'visible', timeout: 20000 });
  for (let i = 0; i < 3; i++) {
    try { await locator.first().click({ timeout: 10000 }); return; } catch (e) { if (i === 2) throw e; await page.waitForTimeout(600); }
  }
}

async function journey(mode) {
  await click(page.locator('.nav__item', { hasText: 'Play' }));
  await click(page.locator('.station', { hasText: mode.toUpperCase() }));
  if (QUEUE_CARD[mode]) await click(page.locator('.qcard', { hasText: QUEUE_CARD[mode] }));
  await click(page.getByRole('button', { name: 'Find match' }));
  await waitFor(page, (v) => v.state.queue.value?.state === 'found' || !!v.state.draft.value, 30000);
  const ready = page.getByRole('button', { name: /^Ready/ });
  if (await ready.count()) await click(ready);
  await waitFor(page, (v) => !!v.state.draft.value || !!v.state.loading.value || !!v.state.match.value, 30000);
  // a fighter locked when it is your pick turn (else the protocol assigns one)
  await waitFor(page, (v) => { const s = v.state.draft.value; const m = s?.seats.find((x) => x.isYou); return !s || (s.phase !== 'pick' && s.phase !== 'ban') || !!m?.locked || (s.turn?.action !== 'ban' && !!s.turn?.players.includes(m?.player)); }, 90000);
  const need = await vale(page, (v) => { const s = v.state.draft.value; const m = s?.seats.find((x) => x.isYou); return !!s && s.phase === 'pick' && !m?.locked; });
  if (need) {
    const card = page.locator('.scr--draft:not(.is-leaving) .fcard:not(.is-taken):not(.is-locked):not(.is-banned):not([aria-disabled="true"])').first();
    await card.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    if (await card.count()) { await card.click(); await page.waitForTimeout(250); }
    const lock = page.locator('.scr--draft').getByRole('button', { name: /Lock in/i }).first();
    if (await lock.count()) { await lock.click(); await page.waitForTimeout(400); }
  }
  await waitFor(page, (v) => !!v.state.loading.value || !!v.state.match.value, 120000);
  await waitFor(page, (v) => v.state.match.value?.view.phase === 'pregame' || v.state.match.value?.view.phase === 'live', 90000);
  log(`${mode}: match loaded`);
  await waitFor(page, (v) => (v.state.match.value?.view.time ?? 0) > 60, 240000);
  await sample(`${mode}_in_match_60s`);
  await waitFor(page, (v) => v.state.ending.value || v.router.route.value.screen === 'postgame', 1500000);
  await waitFor(page, (v) => v.router.route.value.screen === 'postgame', 30000);
  await page.waitForTimeout(2500);
  await sample(`${mode}_postgame`);
  await click(page.getByRole('button', { name: /Return home/i }));
  await waitFor(page, (v) => v.router.route.value.screen === 'home', 20000);
  await page.waitForTimeout(4000);   // the bed change's fade
  const s = await sample(`${mode}_home`);
  await shot(page, `fw_CW2_session_mem_${mode}_home`);
  return s;
}

let broke = false;
try {
  await page.waitForTimeout(4000);
  await sample('home_0');
  for (const m of MODES) {
    try { await journey(m); } catch (e) { broke = true; report.errors.push(`${m}: ${String(e?.message ?? e).slice(0, 300)}`); log(`✗ ${m}: ${e?.message ?? e}`); await shot(page, `fw_CW2_session_mem_${m}_FAIL`).catch(() => {}); break; }
  }
} finally {
  report.consoleErrors = logs.slice(0, 20);
  await browser.close().catch(() => {});
}

const homes = report.samples.filter((s) => /_home$/.test(s.tag));
const s1 = homes.map((s) => ({ tag: s.tag, mb: s.audio?.mb ?? null, ok: (s.audio?.mb ?? Infinity) <= HOME_MB }));
const s2 = homes.map((s) => ({ tag: s.tag, matchOnly: s.audio?.matchOnly ?? null, ok: (s.audio?.matchOnly?.length ?? 1) === 0 }));
const s3 = homes.map((s) => ({ tag: s.tag, music: s.audio?.music ?? null, ok: (s.audio?.music ?? ['?']).every((f) => /mus_menu/.test(f)) }));
report.gates = { S1: s1, S2: s2, S3: s3, homeMbMax: HOME_MB };
const pass = !broke && homes.length === MODES.length && [...s1, ...s2, ...s3].every((g) => g.ok);
report.pass = pass;
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(`S1 Home after each map: ${s1.map((g) => `${g.tag} ${g.mb} MB`).join(', ')} (<= ${HOME_MB})`);
console.log(`S2 match-only files at Home: ${s2.map((g) => `${g.tag} ${g.matchOnly?.length ?? '?'}`).join(', ')}`);
console.log(`S3 beds at Home: ${s3.map((g) => `${g.tag} [${(g.music ?? []).join(' ')}]`).join(', ')}`);
console.log(`${pass ? 'PASS' : broke ? 'BROKE' : 'FAIL'} → ${OUT}`);
process.exit(pass ? 0 : broke ? 2 : 1);
