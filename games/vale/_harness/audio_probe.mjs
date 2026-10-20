// VALE harness — does a REAL browser decode both audio formats? (CONTRACT §11 format fallback)
//
//   node _harness/audio_probe.mjs [--safari | --chrome] [--ref assets/<sha>-x.ogg] [--keep-open]
//
// Starts a small HTTP endpoint on a free 127.0.0.1 port (CORS open), opens
// <dev server>/_harness/web/audio_probe.html?report=<endpoint> — in Safari (default; `open -a Safari`) or in
// headless Chrome (playwright) — and waits for the page's POST: canPlayType, then for one music bed's .ogg (or
// --ref, any catalog .ogg ref) and its .m4a sibling (catalog audio.m4a) the decodeAudioData result, length and
// decode time, for a loop (bed, layer, looping cue) the loop-seam step and the browser's own looped playback
// across the wrap (step + rms dip), and the two decodes against each other (lag, rms difference, samples past
// the .ogg's length). The page closes its own tab; for Safari the tab is
// also closed by AppleScript (only tabs whose URL contains "audio_probe"). Report → _harness/_reports/
// audio_probe_<browser>.json (--ref: audio_probe_<browser>_ref.json). Needs the dev server and a content build.
// Exit 0 = the .m4a decodes (a loop: with a seamless wrap) and, when the .ogg decodes too, both are aligned
// (lag 0) and a loop has the same length; a one-shot's .m4a may be longer by less than one 1024-sample AAC
// frame of silence (Safari does not apply a one-shot's end trim, CONTRACT §11).

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.VALE_URL ?? 'http://localhost:5190';
const args = process.argv.slice(2);
const browser = args.includes('--chrome') ? 'chrome' : 'safari';
const ref = args.includes('--ref') ? args[args.indexOf('--ref') + 1] : null;

let gotReport, gotClosed;
const report = new Promise((r) => { gotReport = r; });
const closed = new Promise((r) => { gotClosed = r; });
const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.end(); return; }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    res.end('{"ok":true}');
    if (req.method !== 'POST') return;
    if (req.url?.startsWith('/report')) { try { gotReport(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { gotReport({ error: `bad report: ${e}` }); } }
    else if (req.url?.startsWith('/closed')) gotClosed(true);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const endpoint = `http://127.0.0.1:${server.address().port}/report`;
const url = `${BASE}/_harness/web/audio_probe.html?report=${encodeURIComponent(endpoint)}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}${args.includes('--keep-open') ? '&close=0' : ''}`;
const timeout = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));

let chrome = null;
let version = null;
if (browser === 'safari') {
  version = spawnSync('defaults', ['read', '/Applications/Safari.app/Contents/Info', 'CFBundleShortVersionString'], { encoding: 'utf8' }).stdout.trim();
  spawn('open', ['-a', 'Safari', url], { stdio: 'ignore' });
} else {
  const { chromium } = await import('playwright-core');
  chrome = await chromium.launch({ channel: 'chrome', headless: process.env.VALE_HEADED !== '1' });
  version = chrome.version();
  await (await chrome.newPage()).goto(url);
}
console.log(`audio probe: ${browser} ${version} ← ${url}`);
const r = await Promise.race([report, timeout(120000, null)]);
let closedBy = null;
if (browser === 'safari') {
  closedBy = (await Promise.race([closed, timeout(3000, false)])) ? 'page (window.close)' : null;
  // AppleScript close as well (a no-op when the page closed itself); bounded: an unanswered Automation
  // prompt makes Safari time out Apple events
  const osa = spawnSync('osascript', ['-e', 'tell application "Safari" to close (every tab of every window whose URL contains "audio_probe")'], { encoding: 'utf8', timeout: 20000 });
  if (osa.status === 0) closedBy ??= 'osascript';
  else if (!closedBy) closedBy = `NOT CLOSED (osascript: ${(osa.stderr || osa.error?.message || 'timeout').trim()})`;
}
await chrome?.close();
server.close();

if (!r) { console.error('FAIL: no report within 120 s'); process.exit(1); }
const out = join(HERE, '_reports', `audio_probe_${browser}${ref ? '_ref' : ''}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ browser, version, closedBy, ...r }, null, 1) + '\n');
if (r.error) { console.error(`FAIL: ${r.error}`); process.exit(1); }
console.log(`  canPlayType  ogg/opus "${r.canPlayType.oggOpus}"  aac "${r.canPlayType.aac}"  AudioContext ${r.contextRate} Hz`);
const loopText = (f) => !r.loop ? '(one-shot: no loop test)' : `wrap step ${f.seam.ratio.toFixed(2)}x p99.9, looped playback ${f.loop.err
  ? `ERROR ${f.loop.err}` : `step ${f.loop.stepRatio.toFixed(2)}x / rms dip ${f.loop.rmsDipDb.toFixed(1)} dB`}`;
for (const [k, f] of Object.entries(r.files)) {
  console.log(f.ok
    ? `  ${k.padEnd(4)} OK    ${f.length} samples @ ${f.rate} Hz × ${f.channels} ch (${f.duration.toFixed(3)} s, ${(f.bytes / 1024).toFixed(0)} KB, ${f.ms} ms)  ${loopText(f)}  ${f.url.split('/').pop()}`
    : `  ${k.padEnd(4)} FAIL  ${f.err}  ${f.url ?? ''}`);
}
const c = r.compare;
if (c) console.log(`  m4a vs ogg  same length ${c.sameLength}${c.sameLength ? '' : ` (m4a ${c.extra > 0 ? '+' : ''}${c.extra} samples${c.extra > 0 ? `, peak ${c.extraPeak.toExponential(1)}` : ''})`}, lag ${c.lag} samples, rms difference ${c.diffDb.toFixed(1)} dB`);
if (closedBy) console.log(`  tab closed by ${closedBy}`);
console.log(`  → ${out}`);
// the .m4a must work everywhere; an .ogg that fails is what the engine falls back from, one that decodes must match
const { ogg, m4a } = r.files;
if (!ogg.ok && m4a.ok) console.log('  (.ogg does not decode here: the engine switches this browser to .m4a)');
const seamless = (f) => !r.loop || (!f.loop.err && f.seam.ratio <= 1.5 && f.loop.stepRatio <= 1.5 && f.loop.rmsDipDb > -20);   // a gap (untrimmed priming) is digital silence; music dips a few dB
// a one-shot's .m4a may run on to the end of its last AAC frame (Safari), as silence
const length = (cmp) => cmp.sameLength || (!r.loop && cmp.extra > 0 && cmp.extra < 1024 && cmp.extraPeak <= 1e-4);
const ok = m4a.ok && seamless(m4a) && (!ogg.ok || (length(c) && c.lag === 0 && seamless(ogg)));
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
