// VALE harness — the queue pop is heard in a background tab (final parity AUD-2, engine half).
//
//   node _harness/probe_audio_qpop.mjs [--out <report.json>]
//
// Real Chrome (pw.mjs, fresh profile = DEFAULT settings, muteInBackground on), the real client and the real audio
// engine. The limiter's output (what reaches the speakers) is metered per 2048-sample block by a ScriptProcessor
// tap on the engine's graph (window.__valeAudio.graph, dev builds). The tab is hidden the way a player tabbing away
// hides it (document.hidden / visibilityState → 'hidden', visibilitychange), then:
//   A  hidden, defaults: queue for co-op (session.queue, what Find match calls) → the ready check pops; the window
//      [found − 0.2 s, found + 3 s] must carry ui_queue_pop in the cue log and peak ≥ −12 dBFS, while the master
//      (the background mute) stays at 0
//   B  hidden, defaults: ordinary cues (UI, match, combat; the same play() the UI calls) stay digital silence
//   C  hidden, defaults: the ready-check reminder (whatever audio.ui.queue_remind binds) is heard too
//   D  hidden, UI slider at 0.05: the pop still peaks ≥ −12 dBFS (the alert floor)
//   E  hidden, master at 0 (the player's explicit full mute): the pop is silent
//   F  visible, defaults, music 0 (so the bed does not mask the reading): the pop's level as a reference
// Exit 0 = A, B, C, D, E hold. Report → _harness/_reports/fw_W3_qpop.json (or --out). Needs the dev server.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, vale, waitFor } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(HERE, '_reports', 'fw_W3_qpop.json');
const GATE_DBFS = -12;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

const { browser, page, logs } = await open('/?dev=1&render=0', { hmr: false });
const failures = [];
const report = { probe: 'probe_audio_qpop', gateDbfs: GATE_DBFS };
try {
  await page.waitForFunction(() => !!window.__valeAudio, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.keyboard.press('Shift');                         // a gesture: the engine creates + resumes its context
  await page.waitForFunction(() => window.__valeAudio?.graph?.ctx?.state === 'running', null, { timeout: 20000 });
  report.settings = await vale(page, (v) => v.session.profile().settings.audio);
  report.alerts = await page.evaluate(() => window.__valeAudio.alerts);
  // the tap: limiter → ScriptProcessor (per-block sample peak, both channels) → a silent sink
  await page.evaluate(() => {
    const { ctx, limiter, master } = window.__valeAudio.graph;
    const st = { blocks: [] };
    window.__tap = st;
    const proc = ctx.createScriptProcessor(2048, 2, 2);
    proc.onaudioprocess = (ev) => {
      let pk = 0;
      for (let c = 0; c < ev.inputBuffer.numberOfChannels; c++) {
        const d = ev.inputBuffer.getChannelData(c);
        for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > pk) pk = a; }
      }
      st.blocks.push([ev.playbackTime, pk, master.gain.value]);
      if (st.blocks.length > 20000) st.blocks.splice(0, 5000);
    };
    const sink = ctx.createGain(); sink.gain.value = 0;
    limiter.connect(proc); proc.connect(sink); sink.connect(ctx.destination);
  });
  const now = () => page.evaluate(() => window.__valeAudio.graph.ctx.currentTime);
  const drainCues = () => vale(page, (v) => (v.cueLog ?? []).splice(0));
  /** sample-peak dBFS of the limiter output over [a, b] (ctx seconds), and the master gain range */
  const meter = async (a, b) => {
    await page.waitForTimeout(400);                          // the tap's blocks lag the clock a little
    return page.evaluate(([a, b]) => {
      const bl = window.__tap.blocks.filter((r) => r[0] >= a && r[0] <= b);
      const pk = bl.reduce((m, r) => Math.max(m, r[1]), 0);
      const mg = bl.map((r) => r[2]);
      return { blocks: bl.length, peakDbfs: pk > 0 ? +(20 * Math.log10(pk)).toFixed(2) : -999, masterGain: mg.length ? [Math.min(...mg), Math.max(...mg)] : null };
    }, [a, b]);
  };
  const hide = (on) => page.evaluate((on) => {
    if (on) {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    } else { delete document.hidden; delete document.visibilityState; }
    document.dispatchEvent(new Event('visibilitychange'));
  }, on);
  /** change Settings.audio the way the settings screen does, then wait until the ENGINE has it (profile → UI → engine) */
  const setAudio = async (patch) => {
    await vale(page, (v, p) => { v.session.updateSettings({ audio: { ...v.session.profile().settings.audio, ...p } }); return true; }, patch);
    await page.waitForFunction((p) => Object.entries(p).every(([k, x]) => window.__valeAudio.vol?.[k] === x), patch, { timeout: 10000 });
    await page.waitForTimeout(300);                          // the gains glide (τ 50 ms)
    return page.evaluate(() => ({ ...window.__valeAudio.vol }));
  };
  /** play a cue through the same port the UI uses, return its window's reading */
  const playAndMeter = async (id, hold = 2.2) => {
    await page.waitForTimeout(1200);                         // cooldowns + the previous tail
    await drainCues();
    const a = await now();
    await page.evaluate((id) => window.__valeAudio.play(id), id);
    await page.waitForTimeout(hold * 1000);
    const m = await meter(a - 0.05, a + hold);
    return { id, ...m, cues: await drainCues() };
  };

  // ── A: the real ready check in a hidden tab, default settings ──────────────────────────────────────
  await hide(true);
  await page.waitForTimeout(800);
  await drainCues();
  await vale(page, (v) => { (v.state.queueFor ? v.state.queueFor({ queue: 'rift_coop' }) : v.session.queue({ queue: 'rift_coop' })); return true; });
  log('queued (hidden tab)');
  await waitFor(page, (v) => v.state.queue.value?.state === 'found', 90000);
  const found = await now();
  log('ready check up');
  await page.waitForTimeout(3200);
  report.A_hidden_default = { ...(await meter(found - 0.2, found + 3)), cues: await drainCues(), title: await page.title() };
  const A = report.A_hidden_default;
  if (!A.cues.includes(report.alerts.find((x) => /pop/.test(x)) ?? 'ui_queue_pop')) failures.push(`A: the pop is not in the cue log (${A.cues.join(', ')})`);
  if (!(A.peakDbfs >= GATE_DBFS)) failures.push(`A: hidden-tab pop peaks ${A.peakDbfs} dBFS (< ${GATE_DBFS})`);
  if (!A.masterGain || A.masterGain[1] > 0.001) failures.push(`A: the background mute is not holding (master gain ${JSON.stringify(A.masterGain)})`);
  await vale(page, (v) => { (v.session.declineMatch ?? v.session.cancelQueue).call(v.session); return true; }).catch(() => {});
  log('A', A.peakDbfs, 'dBFS');

  // ── B: everything else stays muted in the background ───────────────────────────────────────────────
  const others = await page.evaluate(() => {
    const a = window.__valeAudio.alerts;
    return ['ui_confirm', 'ui_notify', 'ui_purchase', 'ui_level_account', 'm_level_up', 'm_takedown', 'm_announce_major', 'c_crit'].filter((x) => !a.includes(x));
  });
  report.B_hidden_others = [];
  for (const id of others) {
    const r = await playAndMeter(id, 1.6);
    report.B_hidden_others.push(r);
    if (r.peakDbfs > -120) failures.push(`B: ${id} is audible in a hidden tab (${r.peakDbfs} dBFS)`);
  }
  log('B', report.B_hidden_others.map((r) => `${r.id} ${r.peakDbfs}`).join(' · '));

  // ── C: the reminder rides the alert path too ───────────────────────────────────────────────────────
  const remind = await vale(page, () => window.__valeAudio.alerts.find((x) => /remind/.test(x)) ?? null);
  if (remind) {
    report.C_hidden_remind = await playAndMeter(remind);
    if (!(report.C_hidden_remind.peakDbfs > -30)) failures.push(`C: ${remind} is silent in a hidden tab (${report.C_hidden_remind.peakDbfs} dBFS)`);
    log('C', remind, report.C_hidden_remind.peakDbfs);
  } else report.C_hidden_remind = { skipped: 'audio.ui.queue_remind is not bound in the served catalog (rebuild it: npm run content)' };

  const pop = report.alerts.find((x) => /pop/.test(x)) ?? 'ui_queue_pop';
  // ── D: the floor beats a low UI slider ─────────────────────────────────────────────────────────────
  report.D_engineVol = await setAudio({ ui: 0.05 });
  report.D_hidden_ui005 = await playAndMeter(pop);
  if (!(report.D_hidden_ui005.peakDbfs >= GATE_DBFS)) failures.push(`D: with the UI slider at 0.05 the pop peaks ${report.D_hidden_ui005.peakDbfs} dBFS (< ${GATE_DBFS})`);
  log('D', report.D_hidden_ui005.peakDbfs);
  // ── E: an explicit master 0 is honoured ────────────────────────────────────────────────────────────
  report.E_engineVol = await setAudio({ ui: report.settings.ui, master: 0 });
  report.E_hidden_master0 = await playAndMeter(pop);
  if (report.E_hidden_master0.peakDbfs > -120) failures.push(`E: master 0 still plays the pop (${report.E_hidden_master0.peakDbfs} dBFS)`);
  log('E', report.E_hidden_master0.peakDbfs);
  // ── F: visible reference (music off so the bed does not mask the reading) ──────────────────────────
  await setAudio({ master: report.settings.master, music: 0 });
  await hide(false);
  await page.waitForTimeout(1500);
  report.F_visible_default_music0 = await playAndMeter(pop);
  log('F', report.F_visible_default_music0.peakDbfs);
  await setAudio({ music: report.settings.music });
} catch (e) {
  failures.push(`probe error: ${e?.message ?? e}`);
} finally {
  report.failures = failures;
  report.pass = failures.length === 0;
  report.logs = logs.slice(0, 40);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 1));
  await browser.close();
}
console.log(failures.length ? `FAIL\n  ${failures.join('\n  ')}` : `PASS: hidden-tab pop ${report.A_hidden_default.peakDbfs} dBFS (≥ ${GATE_DBFS}); other cues silent in the background`);
console.log(`report → ${OUT}`);
process.exit(failures.length ? 1 : 0);
