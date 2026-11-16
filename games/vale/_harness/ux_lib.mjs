// VALE harness — UX evidence collector library (orch1 evidence/ux). Collects and measures; judges nothing, changes no game code.
// A Rec drives one real Chrome (one heavy slot, pw.mjs rules), tags every console line / failed request with the current
// step, saves screenshots at 1920x1080 and 1366x768 (paired by live viewport resize, except cold loads), scans the DOM for
// raw layout facts (clipped, ellipsised, off-viewport, tiny text) and writes data/<phase>.json for ux_merge.py.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadavg } from 'node:os';
import { holdHeavy } from './heavy_slot.mjs';

export const OUT = process.env.UX_OUT ?? '/Users/sitskovich/Developer/forgeflow-games/games/vale/_design/reviews/orch1/evidence/ux';
export const VPS = [['1920x1080', 1920, 1080], ['1366x768', 1366, 768]];
export const load1 = () => +loadavg()[0].toFixed(2);
const pad = (n, w = 2) => String(n).padStart(w, '0');

const INIT = () => {
  const m = {}; window.__ux = { m, fr: [] };
  const mark = (k) => { if (!(k in m)) m[k] = Math.round(performance.now()); };
  const check = () => {
    if (document.querySelector('.scr--home')) mark('home_screen');
    if (document.querySelector('.nav__item')) mark('nav');
    if (document.querySelector('.scr--queue')) mark('queue');
    if (document.querySelector('.scr--draft')) mark('draft');
    if (document.querySelector('.scr--loading')) mark('loading');
    if (document.querySelector('.hud')) { mark('hud'); requestAnimationFrame(() => requestAnimationFrame(() => mark('hud_2raf'))); }
    if (document.querySelector('.scr--postgame')) mark('postgame');
    if (document.querySelector('canvas')) mark('canvas');
  };
  try { new MutationObserver(check).observe(document, { childList: true, subtree: true }); } catch { /* none */ }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') mark('fcp'); }).observe({ type: 'paint', buffered: true }); } catch { /* none */ }
  try { new PerformanceObserver((l) => { const e = l.getEntries().pop(); if (e) { m.lcp = Math.round(e.startTime); m.lcp_el = e.element ? e.element.tagName + '.' + String(e.element.className).slice(0, 40) : null; } }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch { /* none */ }
  m.longtasks = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) m.longtasks.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch { /* none */ }
  const fr = window.__ux.fr;
  const loop = (t) => { if (fr.length < 60000) fr.push(Math.round(t * 10) / 10); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
};

/** raw layout facts of the visible DOM (no judgement): text clipped by overflow, ellipsis, off-viewport, tiny text */
const SCAN = () => {
  const vw = innerWidth, vh = innerHeight, out = [];
  let minFont = 999, minFontEl = '', nText = 0;
  const label = (el) => (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '')).slice(0, 90);
  const txt = (el) => (el.innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 70);
  const visibleIn = (el) => { for (let a = el; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false; } return true; };
  const inertOrLeaving = (el) => !!el.closest('.is-leaving,[inert]');
  for (const el of document.querySelectorAll('body *')) {
    if (out.length >= 80) break;
    if (['SCRIPT', 'STYLE', 'CANVAS', 'SVG', 'PATH', 'DEFS'].includes(el.tagName.toUpperCase())) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (!visibleIn(el) || inertOrLeaving(el)) continue;
    const cs = getComputedStyle(el);
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (own) {
      nText++;
      const fs = parseFloat(cs.fontSize);
      if (fs < minFont) { minFont = fs; minFontEl = label(el) + ' "' + txt(el).slice(0, 30) + '"'; }
    }
    const ovx = cs.overflowX, ovy = cs.overflowY;
    const hidden = (v) => v === 'hidden' || v === 'clip';
    const scroll = (v) => v === 'auto' || v === 'scroll';
    if (own || el.children.length === 0) {
      if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && (hidden(ovx) || cs.textOverflow === 'ellipsis')) out.push({ kind: cs.textOverflow === 'ellipsis' ? 'ellipsis-truncated' : 'clipped-x', el: label(el), text: txt(el), scroll: el.scrollWidth, client: el.clientWidth, font: cs.fontSize });
      else if (el.scrollHeight > el.clientHeight + 1 && el.clientHeight > 0 && hidden(ovy)) out.push({ kind: 'clipped-y', el: label(el), text: txt(el), scroll: el.scrollHeight, client: el.clientHeight, font: cs.fontSize });
      else if (cs.webkitLineClamp && cs.webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + 1) out.push({ kind: 'line-clamped', el: label(el), text: txt(el), scroll: el.scrollHeight, client: el.clientHeight });
    }
    if (el.children.length && (scroll(ovy) || scroll(ovx)) && (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2) && el.clientHeight > 40) {
      out.push({ kind: 'scrollable', el: label(el), scrollH: el.scrollHeight, clientH: el.clientHeight, scrollW: el.scrollWidth, clientW: el.clientWidth, top: Math.round(el.scrollTop) });
    }
    if (own && (r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1)) {
      let clippedByAnc = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.overflowX !== 'visible' || s.overflowY !== 'visible') { const ar = a.getBoundingClientRect(); if (r.right > ar.right + 1 || r.bottom > ar.bottom + 1 || r.left < ar.left - 1 || r.top < ar.top - 1) { clippedByAnc = true; break; } }
      }
      out.push({ kind: clippedByAnc ? 'outside-scroll-ancestor' : 'outside-viewport', el: label(el), text: txt(el), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)], vw, vh });
    }
  }
  // W2-E CUX-4: positioned plates (fixed / absolute boxes of 40 px or more) that run past the viewport, and a recap over the Dial Bar.
  // World-layer marks (.hudworld) and full-bleed backdrops are not plates.
  for (const el of document.querySelectorAll('body *')) {
    if (out.length >= 120) break;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
    if (['CANVAS', 'SVG', 'svg', 'IMG', 'PATH'].includes(el.tagName) || el.closest('.hudworld,.is-leaving,[inert]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40 || !visibleIn(el)) continue;
    if (r.width >= vw - 2 && r.height >= vh - 2) continue;
    if (r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1) out.push({ kind: 'outside-viewport-plate', el: label(el), text: txt(el).slice(0, 40), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)], vw, vh });
  }
  { const rc = document.querySelector('.recap'), db = document.querySelector('.dbar');
    if (rc && db) { const a = rc.getBoundingClientRect(), b = db.getBoundingClientRect(); if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) out.push({ kind: 'recap-over-dialbar', el: 'section.recap', rect: [Math.round(a.left), Math.round(a.top), Math.round(a.right), Math.round(a.bottom)], dialbar: [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)] }); } }
  const de = document.documentElement;
  return { findings: out, minFont: minFont === 999 ? null : { px: minFont, el: minFontEl }, textNodes: nText, docScroll: { w: de.scrollWidth, h: de.scrollHeight, vw, vh } };
};

export class Rec {
  constructor(phase, { dev = true, vps = VPS } = {}) {
    this.phase = phase; this.dev = dev; this.vps = vps; this.steps = []; this.console = []; this.layout = []; this.notes = []; this.timings = {};
    this.cur = 'boot'; this.seq = 0; this.t0 = Date.now(); this.counts = { log: 0, info: 0, debug: 0 }; this.infoSample = [];
    this.curVp = null;
  }
  async open(path, { base, width = 1920, height = 1080, hmr = false } = {}) {
    this.release = await holdHeavy(`ux ${this.phase}`);
    this.t0 = Date.now();
    this.base = base ?? process.env.VALE_URL;
    this.browser = await chromium.launch({ channel: 'chrome', headless: process.env.VALE_HEADED !== '1', args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
    this.browser.on('disconnected', () => this.release?.());
    this.context = await this.browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    if (!hmr) await this.context.routeWebSocket(/.*/, () => {});
    await this.context.addInitScript(INIT);
    this.page = await this.context.newPage();
    this.curVp = `${width}x${height}`;
    const p = this.page;
    p.on('console', (m) => {
      const t = m.type(), loc = m.location();
      if (t === 'warning' || t === 'error') this.console.push({ step: this.cur, type: t, text: m.text().slice(0, 600), at: (loc.url || '').replace(/^https?:\/\/[^/]+/, '') + (loc.lineNumber ? ':' + loc.lineNumber : ''), tMs: Date.now() - this.t0 });
      else { this.counts[t] = (this.counts[t] ?? 0) + 1; if (this.infoSample.length < 40 && !this.infoSample.includes(m.text().slice(0, 200))) this.infoSample.push(m.text().slice(0, 200)); }
    });
    p.on('pageerror', (e) => this.console.push({ step: this.cur, type: 'pageerror', text: String(e.message).slice(0, 600), at: '', tMs: Date.now() - this.t0 }));
    p.on('requestfailed', (r) => this.console.push({ step: this.cur, type: 'requestfailed', text: `${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')} ${r.failure()?.errorText ?? ''}`, at: '', tMs: Date.now() - this.t0 }));
    p.on('response', (r) => { if (r.status() >= 400) this.console.push({ step: this.cur, type: 'http' + r.status(), text: r.url().replace(/^https?:\/\/[^/]+/, ''), at: '', tMs: Date.now() - this.t0 }); });
    p.on('crash', () => this.console.push({ step: this.cur, type: 'crash', text: 'page crashed', at: '', tMs: Date.now() - this.t0 }));
    if (path !== null) await this.goto(path);
    return this;
  }
  async goto(path) { this.navAt = Date.now(); await this.page.goto(this.base + path, { waitUntil: 'domcontentloaded' }); }
  V(fn, arg) { return this.page.evaluate(([src, a]) => (0, eval)(`(${src})`)(window.__vale, a), [fn.toString(), arg]); }
  obs(text, data) { this.notes.push({ step: this.cur, tMs: Date.now() - this.t0, load1: load1(), text, ...(data !== undefined ? { data } : {}) }); }
  step(name) { this.cur = name; }
  async frames(n = 2) { await this.page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r(true) : requestAnimationFrame(f)); requestAnimationFrame(f); }), n); }
  async setVp(w, h) { const id = `${w}x${h}`; if (this.curVp === id) return; await this.page.setViewportSize({ width: w, height: h }); this.curVp = id; await this.page.waitForTimeout(450); await this.frames(3); }
  async route() { return this.page.evaluate(() => { const s = [...document.querySelectorAll('.scr')].filter((e) => !e.classList.contains('is-leaving')).map((e) => [...e.classList].find((c) => c.startsWith('scr--'))).filter(Boolean); return { scr: s.join(','), hud: !!document.querySelector('.hud'), url: location.pathname + location.search }; }).catch(() => ({ scr: '?', hud: false })); }
  /** one screenshot at the current viewport */
  async snap1(name, desc, { clip, clipSel, tag } = {}) {
    this.seq++;
    const [w, h] = this.curVp.split('x');
    const dir = join(OUT, this.curVp); mkdirSync(dir, { recursive: true });
    const file = `${this.phase}_${pad(this.seq, 3)}_${name}.png`;
    await this.frames(2);
    let cl = clip;
    if (clipSel) { const b = await this.page.locator(clipSel).first().boundingBox().catch(() => null); if (b) cl = { x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8), width: Math.min(+w - Math.max(0, b.x - 8), b.width + 16), height: Math.min(+h - Math.max(0, b.y - 8), b.height + 16) }; }
    await this.page.screenshot({ path: join(dir, file), ...(cl ? { clip: cl } : {}) });
    const rt = await this.route();
    let scan = null;
    try { scan = await this.page.evaluate(SCAN); } catch (e) { scan = { error: String(e).slice(0, 100), findings: [] }; }
    const rel = `${this.curVp}/${file}`;
    let bytes = 0; try { bytes = statSync(join(dir, file)).size; } catch { /* none */ }
    this.steps.push({ file: rel, viewport: this.curVp, phase: this.phase, step: this.cur, name, desc, route: rt.scr, hud: rt.hud, crop: cl ? { x: Math.round(cl.x), y: Math.round(cl.y), w: Math.round(cl.width), h: Math.round(cl.height) } : null, bytes, tMs: Date.now() - this.t0, load1: load1(), ...(tag ? { tag } : {}),
      layout: { minFont: scan.minFont ?? null, textNodes: scan.textNodes ?? null, docScroll: scan.docScroll ?? null, counts: scan.findings.reduce((a, f) => { a[f.kind] = (a[f.kind] ?? 0) + 1; return a; }, {}) } });
    for (const f of scan.findings) this.layout.push({ file: rel, step: this.cur, ...f });
    return rel;
  }
  /** the same state at every viewport (live resize); `before` runs after each resize (hover, key down) and `after` once the shot is taken */
  async snap2(name, desc, o = {}) {
    const files = [];
    for (const [id, w, h] of this.vps) {
      await this.setVp(w, h);
      if (o.before) { try { await o.before(this.page, id); } catch (e) { this.obs(`before-hook failed at ${id}: ${String(e).slice(0, 120)}`); } await this.page.waitForTimeout(o.settle ?? 350); }
      files.push(await this.snap1(name, desc, o));
      if (o.after) { try { await o.after(this.page, id); } catch { /* none */ } }
    }
    await this.setVp(this.vps[0][1], this.vps[0][2]);
    return files;
  }
  /** performance.now() marks, frame stats of [from, to) ms, resource totals */
  async marks() { return this.page.evaluate(() => ({ ...window.__ux.m, now: Math.round(performance.now()) })); }
  async frameStats(fromMs, toMs) {
    return this.page.evaluate(([a, b]) => {
      const f = window.__ux.fr.filter((t) => t >= a && t < b); const d = []; for (let i = 1; i < f.length; i++) d.push(f[i] - f[i - 1]);
      if (!d.length) return { frames: 0 }; const s = [...d].sort((x, y) => x - y); const sum = d.reduce((x, y) => x + y, 0);
      return { frames: f.length, windowMs: Math.round(b - a), avgFps: +(1000 * d.length / sum).toFixed(1), p50ms: +s[Math.floor(s.length * 0.5)].toFixed(1), p95ms: +s[Math.floor(s.length * 0.95)].toFixed(1), maxMs: +s[s.length - 1].toFixed(1), over33ms: d.filter((x) => x > 33.4).length, over50ms: d.filter((x) => x > 50).length };
    }, [fromMs, toMs]);
  }
  async resources() { return this.page.evaluate(() => { const r = performance.getEntriesByType('resource'); const by = {}; let tx = 0, enc = 0, dec = 0; for (const e of r) { const k = (e.name.match(/\.(\w{2,5})(?:\?|$)/) ?? [, 'other'])[1]; by[k] = (by[k] ?? 0) + 1; tx += e.transferSize || 0; enc += e.encodedBodySize || 0; dec += e.decodedBodySize || 0; } return { count: r.length, transferBytes: tx, encodedBytes: enc, decodedBytes: dec, byExt: by, largest: r.map((e) => [e.name.replace(/^https?:\/\/[^/]+/, '').slice(0, 90), e.encodedBodySize, Math.round(e.responseEnd)]).sort((a, b) => b[1] - a[1]).slice(0, 8) }; }); }
  async click(loc, o = {}) { await loc.waitFor({ state: 'visible', timeout: o.timeout ?? 20000 }); await this.frames(2); await loc.click({ timeout: o.timeout ?? 20000, ...(o.force ? { force: true } : {}) }); }
  async finish(extra = {}) {
    mkdirSync(join(OUT, 'data'), { recursive: true });
    const env = { chrome: this.browser.version(), load1End: load1(), node: process.version, base: this.base, wallMs: Date.now() - this.t0 };
    writeFileSync(join(OUT, 'data', `${this.phase}.json`), JSON.stringify({ phase: this.phase, finishedAt: new Date().toISOString(), env, steps: this.steps, console: this.console, consoleCounts: this.counts, infoSample: this.infoSample, layout: this.layout, notes: this.notes, timings: this.timings, ...extra }, null, 1));
    await this.browser.close().catch(() => {});
    console.log(`[ux:${this.phase}] ${this.steps.length} shots, ${this.console.length} console/network lines, ${this.layout.length} layout findings`);
  }
}

// ── flow helpers (work in prod and dev: DOM only) ───────────────────────────────────────────────
export const NAV = (page, label) => page.locator('.nav__item', { hasText: label });
export async function gotoNav(rec, label) { await rec.click(NAV(rec.page, label)); await rec.page.waitForTimeout(700); }

export async function startQueue(rec, mode, queueName, o = {}) {
  const p = rec.page;
  await gotoNav(rec, 'Play');
  await rec.click(p.locator('.station', { hasText: new RegExp(mode, 'i') }).first()); await p.waitForTimeout(500);
  if (queueName) { await rec.click(p.locator('.qcard', { hasText: queueName }).first()); await p.waitForTimeout(300); }
  if (o.snapPlay) await rec.snap2(o.snapPlay, `Play screen, mode ${mode}, queue ${queueName ?? 'default'} selected`);
  await rec.click(p.getByRole('button', { name: 'Find match' }));
}

/** drive queue / ready check / draft / loading until the HUD is up (or `maxMs`). Snapshots every new state. */
export async function driveFlow(rec, tag, { maxMs = 240000, cap = 30, paired = true, until } = {}) {
  const p = rec.page; const t0 = Date.now(); const seen = new Set(); let snaps = 0, lastSnap = 0, loadingShots = 0, seq = 0;
  const log = [];
  while (Date.now() - t0 < maxMs) {
    const st = await p.evaluate(() => {
      const act = [...document.querySelectorAll('.scr')].find((e) => !e.classList.contains('is-leaving'));
      const scr = act ? [...act.classList].find((c) => c.startsWith('scr--')) : null;
      const hud = !!document.querySelector('.hud');
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const btns = act ? [...act.querySelectorAll('button')].filter(vis).map((b) => ({ t: (b.innerText || '').trim().slice(0, 24), d: b.disabled || b.getAttribute('aria-disabled') === 'true' })) : [];
      const head = act ? [...act.querySelectorAll('h1,h2,.scr__kicker,[role=status]')].filter(vis).map((e) => (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)).slice(0, 3).join('/') : '';
      const sel = act ? act.querySelectorAll('.fcard.is-selected,.fcard[aria-pressed="true"],.fcard[aria-selected="true"]').length : 0;
      return { scr, hud, btns, head, sel };
    }).catch(() => null);
    if (!st) { await p.waitForTimeout(400); continue; }
    if (st.hud || (until && await until(st))) break;
    const sig = [st.scr, st.head.replace(/\d+/g, '#'), st.btns.map((b) => b.t + (b.d ? '!' : '')).join(','), st.sel].join('|');
    const now = Date.now();
    const wantSnap = st.scr === 'scr--loading' ? (loadingShots < 7 && now - lastSnap > 650) : (!seen.has(sig) || now - lastSnap > 9000);
    if (wantSnap && snaps < cap) {
      seen.add(sig); lastSnap = now; snaps++;
      if (st.scr === 'scr--loading') loadingShots++;
      const nm = `${tag}_${pad(++seq)}_${(st.scr ?? 'none').replace('scr--', '')}`;
      rec.step(nm);
      const desc = `${tag}: state ${st.scr}, heading "${st.head}", buttons [${st.btns.map((b) => b.t + (b.d ? ' (disabled)' : '')).join(' | ')}], ${st.sel} selected card(s)`;
      if (paired && st.scr !== 'scr--loading') await rec.snap2(nm, desc); else await rec.snap1(nm, desc);
      log.push({ at: Date.now() - t0, sig });
    }
    try {
      if (st.scr === 'scr--queue') {
        const ready = p.getByRole('button', { name: /^Ready/ });
        if (await ready.count()) await ready.first().click({ timeout: 3000 }).catch(() => {});
      } else if (st.scr === 'scr--draft') {
        const lock = p.locator('.scr--draft:not(.is-leaving)').getByRole('button', { name: /^(Lock in|Ban)/ }).first();
        const lockOn = (await lock.count()) && (await lock.isEnabled().catch(() => false));
        if (lockOn) { await p.waitForTimeout(400); await lock.click({ timeout: 3000 }).catch(() => {}); }
        else if (!st.sel) {
          const card = p.locator('.scr--draft:not(.is-leaving) .fcard:not(.is-taken):not(.is-locked):not(.is-banned):not([aria-disabled="true"])').first();
          if (await card.count()) await card.click({ timeout: 3000 }).catch(() => {});
        }
      }
    } catch { /* retry next tick */ }
    await p.waitForTimeout(350);
  }
  return { ms: Date.now() - t0, log };
}

export async function deadline(label, ms, fn) { const t = setTimeout(() => { console.error(`[ux] ${label}: hard deadline ${ms} ms hit`); process.exit(3); }, ms); try { return await fn(); } finally { clearTimeout(t); } }
