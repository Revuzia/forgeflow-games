// VALE harness — orch1 CUX-16: input-to-response latency in the REAL client (dev server, real Chrome GPU, heavy slot).
// Frames from a real CDP input event (Playwright -> Input.dispatchMouseEvent / dispatchKeyEvent) to the first frame that SHOWS the response:
//   move      right-click on the ground:   `marker` = the move ring is drawn (.wmark--move), `motion` = your fighter's drawn position,
//             heading or clip changes (movement start)
//   slot      Q (ability 1) pressed:       `flash` = the slot button's press animation is running (Web Animations on .aslot),
//             `aim` = the renderer holds an aim indicator (renderer.aim, drawn that frame; null when the ability has none)
// Times are from the event's own timeStamp to the callback of the first rAF frame that carries the change (an in-page logger registered after the
// client's own loops, so it runs after they drew); frames = ms / the window's median frame interval.
// Targets (CUX-16): UI feedback (marker, flash, aim) <= 2 frames at 60 fps; movement start <= 50 ms (one 30 Hz sim tick + interpolation).
// Gate behaviour: measured and reported; the pass flags are in the JSON. Needs a quiet machine for a valid verdict (--require-quiet waits, never kills).
//
//   python3 art/blender/common/heavy.py run -- node _harness/latency_probe.mjs [--n 20] [--require-quiet [--quiet-wait-min N]] [--tag x]
//   -> _harness/_reports/latency_probe[_tag].json and _design/reviews/orch1/evidence/latency/latency_probe[_tag].json
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, vale, waitFor } from './pw.mjs';
import { requireQuietFromArgs } from './require_quiet.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const N = Number(opt('n', 20)), TAG = opt('tag', '');
const NAME = `latency_probe${TAG ? '_' + TAG : ''}.json`;
const OUT = join(HERE, '_reports', NAME), EVID = join(HERE, '..', '_design', 'reviews', 'orch1', 'evidence', 'latency', NAME);
mkdirSync(dirname(OUT), { recursive: true }); mkdirSync(dirname(EVID), { recursive: true });
const QUIET = await requireQuietFromArgs(args);
if (QUIET && !QUIET.ok) { console.log(`REFUSED (--require-quiet): ${QUIET.state.reasons.join(' | ')}`); process.exit(2); }
const report = { probe: 'latency_probe', at: new Date().toISOString(), n: N, load1: { start: +loadavg()[0].toFixed(2) }, quiet: QUIET?.state ?? null, targets: { uiFrames: 2, uiMsAt60: 33.4, motionMs: 50 }, move: [], slot: [], summary: {}, pass: null, errors: [] };
const pct = (a, k) => { const s = a.filter((x) => x !== null && x !== undefined).sort((x, y) => x - y); return s.length ? +s[Math.min(s.length - 1, Math.floor(s.length * k))].toFixed(1) : null; };

const { browser, page, logs } = await open('/?dev=1&autopilot=draft', { hmr: false });
try {
  const frames = () => page.waitForFunction(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))), null, { timeout: 60000 });
  const click = async (l) => { await l.waitFor({ state: 'visible', timeout: 30000 }); await frames(); await l.click({ timeout: 30000 }); };
  await page.waitForTimeout(2000);
  await click(page.locator('.nav__item', { hasText: 'Play' })); await page.waitForTimeout(500);
  await click(page.locator('.station', { hasText: 'RIFT' }).first()); await page.waitForTimeout(500);
  await click(page.locator('.qcard').filter({ hasText: /Lantern Drill|Co-op vs/ }).first()); await page.waitForTimeout(300);
  await click(page.getByRole('button', { name: 'Find match' }));
  await waitFor(page, (v) => v.state.queue.value?.state === 'found' || !!v.state.draft.value, 30000);
  const ready = page.getByRole('button', { name: /^Ready/ }); if (await ready.count()) await click(ready.first());
  await waitFor(page, (v) => !!v.state.draft.value || !!v.state.loading.value || !!v.state.match.value, 30000);
  await waitFor(page, (v) => v.state.match.value?.view.phase === 'live', 240000);
  await waitFor(page, (v) => { const c = v.state.match.value, R = v.state.renderer; const me = c.view.players.find((p) => p.player === c.you); return !!R.actors.get(me.entity)?.model; }, 60000);
  await page.mouse.move(960, 540);
  await page.waitForTimeout(1500);

  // freeze the field: every other seat muted so only your own orders move anything
  await vale(page, (v) => {
    const c = v.state.match.value, W = c.sim.world, R = v.state.renderer;
    const me = c.view.players.find((p) => p.player === c.you);
    const orig = W.command.bind(W);
    W.command = (p, cmd) => { if (p === c.you) orig(p, cmd); };
    window.__me = me.entity;
    const s = W.entity(me.entity); s.hp = s.maxHp;
    for (const sl of s.slots ?? []) { sl.rank = Math.max(sl.rank, 1); sl.cooldown = 0; }
    // the in-page logger: per rAF frame the drawn state, and every input's timeStamp
    const L = { frames: [], ev: [] };
    window.__L = L;
    addEventListener('pointerdown', (e) => L.ev.push({ t: e.timeStamp, k: 'pointer', button: e.button }), { capture: true });
    addEventListener('keydown', (e) => { if (!e.repeat) L.ev.push({ t: e.timeStamp, k: 'key', code: e.code }); }, { capture: true });
    const tick = (ts) => {
      requestAnimationFrame(tick);
      const a = R.actors.get(window.__me); if (!a) return;
      let flash = 0;
      for (const an of document.getAnimations()) { const t = an.effect?.target; if (t && t.classList && t.classList.contains('aslot') && an.playState === 'running') flash++; }
      L.frames.push({ ts, now: performance.now(), x: a.root.position.x, z: a.root.position.z, rot: a.root.rotation.y, key: a.currentKey, mm: document.querySelectorAll('.wmark--move').length, flash, aim: !!R.aim });
      if (L.frames.length > 20000) L.frames.splice(0, 5000);
    };
    requestAnimationFrame(tick);
  });
  const here = () => vale(page, (v) => { const R = v.state.renderer, a = R.actors.get(window.__me), P = a.root.position.clone().project(R.rig.camera); return { x: (P.x + 1) / 2 * innerWidth, y: (1 - P.y) / 2 * innerHeight }; });
  const still = async () => {
    for (let i = 0; i < 60; i++) {
      const m = await vale(page, () => { const f = window.__L.frames, n = f.length; if (n < 8) return 1; let d = 0; for (let i = n - 8; i < n; i++) d = Math.max(d, Math.hypot(f[i].x - f[n - 1].x, f[i].z - f[n - 1].z)); return d; });
      if (m < 0.002) return true; await page.waitForTimeout(100);
    }
    return false;
  };
  // resolve one input's response from the frame log
  const resolve = (idx) => vale(page, (v, idx) => {
    const L = window.__L, ev = L.ev[idx]; if (!ev) return { err: 'no input event' };
    const fr = L.frames; let b = -1;
    for (let i = 0; i < fr.length; i++) if (fr[i].now < ev.t) b = i;
    if (b < 0) return { err: 'no base frame' };
    const base = fr[b]; const out = { marker: null, motion: null, flash: null, aim: null };
    let n = 0;
    for (let i = b + 1; i < fr.length; i++) {
      const f = fr[i]; n++;
      if (out.marker === null && f.mm > base.mm) out.marker = { ms: f.now - ev.t, frames: n };
      if (out.flash === null && f.flash > base.flash) out.flash = { ms: f.now - ev.t, frames: n };
      if (out.aim === null && f.aim && !base.aim) out.aim = { ms: f.now - ev.t, frames: n };
      const moved = Math.hypot(f.x - base.x, f.z - base.z) > 0.01, turned = Math.abs(f.rot - base.rot) > 0.5 * Math.PI / 180, clip = f.key !== base.key;
      if (out.motion === null && (moved || turned || clip)) out.motion = { ms: f.now - ev.t, frames: n };
    }
    const w = fr.slice(Math.max(0, fr.length - 121)); const iv = w.slice(1).map((f, i) => f.ts - w[i].ts).sort((x, y) => x - y);
    out.frameMs = iv.length ? +iv[iv.length >> 1].toFixed(2) : null; out.baseKey = base.key;
    return out;
  }, idx);

  let dir = 1;
  for (let i = 0; i < N; i++) {
    await page.keyboard.press('KeyS'); await page.waitForTimeout(250); await still();
    const s = await here();
    const gx = Math.max(100, Math.min(1820, s.x + dir * (170 + (i % 4) * 25))), gy = Math.max(160, Math.min(900, s.y + 60 * Math.sin(i)));
    dir = -dir;
    const e0 = await vale(page, () => window.__L.ev.length);
    await page.mouse.move(gx, gy); await page.waitForTimeout(60);
    const e1 = await vale(page, () => window.__L.ev.length);
    await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(450);
    const r = await resolve(e1);
    report.move.push({ i, ...r });
    void e0;
  }
  for (let i = 0; i < N; i++) {
    await page.keyboard.press('KeyS'); await page.waitForTimeout(200); await still();
    await vale(page, (v) => { const W = v.state.match.value.sim.world, s = W.entity(window.__me); for (const sl of s.slots ?? []) sl.cooldown = 0; s.res = s.maxRes ?? s.res; });
    await page.mouse.move(960, 400); await page.waitForTimeout(80);
    const e1 = await vale(page, () => window.__L.ev.length);
    await page.keyboard.press('KeyQ');
    await page.waitForTimeout(350);
    const r = await resolve(e1);
    report.slot.push({ i, ...r });
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  }
  // summary
  const col = (arr, k, f) => arr.map((r) => r[k]?.[f] ?? null);
  const frameMs = pct(report.move.concat(report.slot).map((r) => r.frameMs), 0.5);
  const S = report.summary = {
    frameMs, fps: frameMs ? +(1000 / frameMs).toFixed(1) : null,
    moveMarker: { n: col(report.move, 'marker', 'ms').filter((x) => x !== null).length, p50Ms: pct(col(report.move, 'marker', 'ms'), 0.5), p95Ms: pct(col(report.move, 'marker', 'ms'), 0.95), p95Frames: pct(col(report.move, 'marker', 'frames'), 0.95) },
    moveMotion: { n: col(report.move, 'motion', 'ms').filter((x) => x !== null).length, p50Ms: pct(col(report.move, 'motion', 'ms'), 0.5), p95Ms: pct(col(report.move, 'motion', 'ms'), 0.95) },
    slotFlash: { n: col(report.slot, 'flash', 'ms').filter((x) => x !== null).length, p50Ms: pct(col(report.slot, 'flash', 'ms'), 0.5), p95Ms: pct(col(report.slot, 'flash', 'ms'), 0.95), p95Frames: pct(col(report.slot, 'flash', 'frames'), 0.95) },
    aim: { n: col(report.slot, 'aim', 'ms').filter((x) => x !== null).length, p50Ms: pct(col(report.slot, 'aim', 'ms'), 0.5), p95Ms: pct(col(report.slot, 'aim', 'ms'), 0.95), p95Frames: pct(col(report.slot, 'aim', 'frames'), 0.95) },
  };
  const T = report.targets, fm = frameMs ?? 16.7;
  S.verdict = {
    moveMarkerUi: S.moveMarker.p95Frames !== null && S.moveMarker.p95Frames <= T.uiFrames,
    slotFlashUi: S.slotFlash.p95Frames !== null && S.slotFlash.p95Frames <= T.uiFrames,
    aimUi: S.aim.n ? S.aim.p95Frames <= T.uiFrames : 'no aim indicator drawn for this ability (not gated)',
    moveMotion: S.moveMotion.p95Ms !== null && S.moveMotion.p95Ms <= T.motionMs,
    frameIntervalOk: fm <= 17.5,
  };
  const quietNow = (await import('./require_quiet.mjs')).quietState();
  report.load1.end = +loadavg()[0].toFixed(2); report.quietAtEnd = quietNow;
  report.pass = Object.values(S.verdict).every((v) => v === true || typeof v === 'string') && quietNow.quiet && (QUIET?.ok ?? false);
  report.validity = quietNow.quiet && QUIET?.ok ? 'valid (quiet machine start and end)' : 'NOT a valid idle measurement (machine not verified quiet; run with --require-quiet)';
  report.errors = logs.filter((l) => !/favicon/.test(l)).slice(0, 10);
  console.log(`latency: frame ${S.frameMs} ms (${S.fps} fps); move marker p50/p95 ${S.moveMarker.p50Ms}/${S.moveMarker.p95Ms} ms (${S.moveMarker.p95Frames} fr), motion ${S.moveMotion.p50Ms}/${S.moveMotion.p95Ms} ms; slot flash ${S.slotFlash.p50Ms}/${S.slotFlash.p95Ms} ms (${S.slotFlash.p95Frames} fr); aim ${S.aim.p50Ms}/${S.aim.p95Ms} ms (n ${S.aim.n}); ${report.validity}`);
} catch (e) {
  report.errors.push(String(e?.stack ?? e).slice(0, 600)); console.error('latency_probe failed:', e?.message ?? e);
} finally {
  await browser.close();
  writeFileSync(OUT, JSON.stringify(report, null, 1)); copyFileSync(OUT, EVID);
  console.log(`-> ${OUT}`);
}
process.exit(report.errors.length && !report.summary.verdict ? 3 : 0);
