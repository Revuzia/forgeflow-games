// Round 14 (R14_ROOMS, D-104; the owner 2026-11-23: "Make sq footage of rooms wider and volume bigger to allow easier exploration for our squishies"):
// THE BROWSER CHECK of the bigger rooms and their camera, on 1280 x 800 (mouse) and 390 x 844 (touch), at Home and the six places, three out.
// REAL INPUT everywhere a player acts: the Places sheet by clicks / taps, the carry by a mouse drag / one finger, the zoom by the wheel / a pinch, the pan by
// Shift + the right button / two fingers, the edge chip by a click / tap (Playwright's mouse; CDP touch points on the phone). The sim is stepped by the dev hook
// between the input events (the software rasteriser runs far under real time), so every row is the same on every run.
// Usage: WH_FROZEN=1 node _harness/browser_rooms.mjs [--port=5364] [--places=home,hearthlog] [--only=desk|phone] [--tag=r]
//   -> rows on stdout, pictures in _harness/_renders/rooms/<tag>_<frame>_<place>_<view>.png, JSON in _harness/_reports/browser_rooms.json; exit 1 on a FAIL.
import { launch, startVite, ROOT } from './pw.mjs';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PLACE_INFO } from '../src/data/places.ts';
import { PLACE as HOME } from '../src/data/place_home.ts';
import { PLACE as HEARTHLOG } from '../src/data/place_hearthlog.ts';
import { PLACE as RIPPLE } from '../src/data/place_ripple.ts';
import { PLACE as FROSTBELL } from '../src/data/place_frostbell.ts';
import { PLACE as RAINLEAF } from '../src/data/place_rainleaf.ts';
import { PLACE as LANTERNROOF } from '../src/data/place_lanternroof.ts';
import { PLACE as CLOUDLOFT } from '../src/data/place_cloudloft.ts';
import { ROOM_CAM, HOME_R } from '../src/render/roomcam.ts';
import { PROPS } from '../src/physics/props.ts';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const PORT = Number(arg('port', 5364)), ONLY = arg('only', ''), TAG = arg('tag', 'r'), TRACE = process.argv.includes('--trace');
const DEFS = { home: HOME, hearthlog: HEARTHLOG, ripple: RIPPLE, frostbell: FROSTBELL, rainleaf: RAINLEAF, lanternroof: LANTERNROOF, cloudloft: CLOUDLOFT };
const PLACES = arg('places', 'home,hearthlog,ripple,frostbell,rainleaf,lanternroof,cloudloft').split(',').filter((p) => DEFS[p]);
const NAMES = Object.fromEntries(PLACE_INFO.map((p) => [p.id, p.name])), IDX = Object.fromEntries(PLACE_INFO.map((p) => [p.id, p.idx]));
const SHOTS = resolve(ROOT, '_harness/_renders/rooms');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
let fails = 0;
const check = (name, ok, detail = '') => { rows.push({ name, ok: !!ok, detail }); if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`); };
const r2 = (v) => Math.round(v * 100) / 100;
const FRAMES = [
  ['desk', { viewport: { width: 1280, height: 800 } }],
  ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true }],
].filter(([n]) => !ONLY || n === ONLY);

/** load 2's seed: every place open (the saved journal's stamps at 45), once, on the load after sessionStorage.roomseed is set */
const init = () => {
  window.__liveLog = [];
  const rec = () => { const el = document.getElementById('wh-live'); if (!el) { setTimeout(rec, 30); return; } new MutationObserver(() => { if (el.textContent) window.__liveLog.push(el.textContent); }).observe(el, { childList: true, characterData: true, subtree: true }); };
  rec();
  try {
    // (the stamps open Ripple .. Cloudloft, QUESTS 7; the cabin opens by the first wish: its bit of `pl` is set here, as the wish sets it)
    const seed = JSON.parse(sessionStorage.getItem('roomseed') || 'null');
    if (seed) { const k = 'wobblehoard:v2:journal', j = JSON.parse(localStorage.getItem(k) || 'null'); if (j) { j.st = Math.max(j.st | 0, seed.st); j.pl = (j.pl | 0) | seed.pl; localStorage.setItem(k, JSON.stringify(j)); } sessionStorage.removeItem('roomseed'); }
  } catch (e) { console.info('seed: ' + e); }
};

const srv = await startVite(PORT);
const browser = await launch();
try {
  for (const [frame, ctxOpt] of FRAMES) {
    const touch = frame === 'phone', tall = touch;
    const ctx = await browser.newContext(ctxOpt);
    await ctx.addInitScript(init);
    const page = await ctx.newPage();
    const cdp = touch ? await ctx.newCDPSession(page) : null;
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('error: ' + m.text()); });
    const W = ctxOpt.viewport.width, H = ctxOpt.viewport.height;

    // ---- the page's helpers ----
    const step = (s) => page.evaluate(async (sec) => { for (let t = 0; t < sec - 1e-9; t += 0.5) { window.__WH__.step(1 / 60, Math.round(Math.min(0.5, sec - t) * 60)); await new Promise((r) => setTimeout(r, 0)); } }, s);
    const frames = (n) => page.evaluate((k) => { window.__WH__.step(1 / 60, k); }, n);
    const bodies = () => page.evaluate(() => window.__WH__.shell.matInfo().bodies.map((b, i) => ({ i, x: b.x, y: b.y, r: b.r, carried: b.carried, fingers: b.fingers, w: b.w })));
    const view = () => page.evaluate(() => { const st = window.__WH__.shell.stageObj(), o = new Float32Array(6); const on = st.roomView ? st.roomView(o) : false; return on ? Array.from(o) : null; });
    const yawOf = () => page.evaluate(() => { const e = window.__WH__.shell.stageObj().camera.matrixWorld.elements; return Math.atan2(e[8], e[10]); });
    const proj = (pts) => page.evaluate((ps) => ps.map(([x, y, z]) => window.__WH__.shell.project(x, y, z)), pts);
    const band = () => page.evaluate(() => { const t = document.querySelector('.hud-top')?.getBoundingClientRect(), b = document.querySelector('.hud-bottom')?.getBoundingClientRect(); return { top: t && t.height > 0 ? t.bottom : 0, bottom: b && b.height > 0 ? b.top : innerHeight }; });
    const shot = async (n) => { await page.evaluate(() => { const d = document.querySelector('.dev'); if (d) d.style.visibility = 'hidden'; }); await page.evaluate(async () => { const raf = () => new Promise((r) => requestAnimationFrame(() => r())); await raf(); await raf(); }); await page.screenshot({ path: resolve(SHOTS, `${TAG}_${frame}_${n}.png`), timeout: 180000 }); };
    const boxOf = (sel) => page.evaluate((q) => { const e = document.querySelector(q); if (!e) return null; const r = e.getBoundingClientRect(); return r.width > 0 && !e.disabled ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, sel);
    // ---- REAL input ----
    const tapAt = async (x, y) => { if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); };
    const clickSel = async (sel) => { const b = await boxOf(sel); if (!b) return false; await tapAt(b.x, b.y); await sleep(350); return true; };
    const tp = (pts) => pts.map(([x, y], id) => ({ x: Math.round(x), y: Math.round(y), id: id + 1, radiusX: 8, radiusY: 8, force: 0.5 }));
    const fDown = async (x, y) => { if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp([[x, y]]) }); else { await page.mouse.move(x, y); await page.mouse.down(); } };
    const fMove = async (x, y) => { if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp([[x, y]]) }); else await page.mouse.move(x, y); };
    const fUp = async () => { if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); else await page.mouse.up(); };
    /** an empty spot of the play band for a look-around gesture: `n` points `gap` px apart on a row, each clear of every squishy on screen and of every thing a
     *  finger could take (the page's own hit test through a real press would start a gesture: the points are tried with elementFromPoint and the bodies' discs) */
    const emptyRow = async (gap) => {
      const bs = await bodies(), bd = await band();
      for (const fy of [0.3, 0.42, 0.2, 0.55, 0.68, 0.8]) for (const fx of [0.5, 0.3, 0.7, 0.2, 0.8]) {
        const y = bd.top + (bd.bottom - bd.top) * fy, x0 = W * fx - gap / 2, x1 = W * fx + gap / 2;
        if (x0 < 12 || x1 > W - 12) continue;
        const clear = (x) => bs.every((b) => Math.hypot(b.x - x, b.y - y) > b.r + 26);
        if (!clear(x0) || !clear(x1) || !clear((x0 + x1) / 2)) continue;
        // (R15_CLOSE 1, RE-SPECIFIED with its reason: a pinch IN starts with the fingers 30 px either side of the row's middle; only the middle and the ends
        // were tested. At Rainleaf on a phone, after the first notch, a squishy stood 31 px from a starting finger (inside its 35 px disc): that finger began a
        // carry, and 60 pinches there moved nothing, while the same pinch at 17 other spots of the frame zoomed to the close view (traced). Every point a
        // finger of either pinch starts on is now clear of every squishy.)
        const mid0 = (x0 + x1) / 2;
        if (![mid0 - 30, mid0 + 30, mid0 - 110, mid0 + 110].every((x) => bs.every((b) => Math.hypot(b.x - x, b.y - y) > b.r + 14))) continue;
        // (R15_CLOSE: and every starting point is on the canvas: a pinch IN's inner points (30 px either side) were not tested, and at Cloudloft on a phone one
        // lay on the Kite Swing's AUTO chip (a DOM button): the canvas saw ONE finger, the published one-finger turn, and the next row's whole-room view was
        // turned (R15_FIX F7 found the same by hand))
        const onCanvas = await page.evaluate(([a, b, yy]) => [a, b, (a + b) / 2 - 30, (a + b) / 2 + 30].every((x) => [0, -9, 9].every((dy) => document.elementFromPoint(x, yy + dy)?.tagName === 'CANVAS')), [x0, x1, y]);
        if (onCanvas) return { x0, x1, y };
      }
      return null;
    };
    /** zoom by REAL input: the wheel (desk), a two-finger pinch on an empty spot (phone); dir > 0 = away. Until `done(view)` or `max` notches. */
    const zoomBy = async (dir, done, max = 40) => {
      for (let k = 0; k < max; k++) {
        const v = await view();
        if (v && done(v)) return true;
        if (!touch) { await page.mouse.move(W / 2, H / 2); await page.mouse.wheel(0, dir > 0 ? 240 : -240); }
        else {
          const row = await emptyRow(220);
          if (!row) return false;
          const mid = (row.x0 + row.x1) / 2, a0 = dir > 0 ? 110 : 30, a1 = dir > 0 ? 30 : 110;
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp([[mid - a0, row.y]]) });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp([[mid - a0, row.y], [mid + a0, row.y]]) });
          for (let i = 1; i <= 6; i++) { const a = a0 + ((a1 - a0) * i) / 6; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp([[mid - a, row.y], [mid + a, row.y]]) }); await frames(1); }
          if (process.env.ROOMS_DBG && k < 4) console.log('dbg pinch mid', dir, k, JSON.stringify({ row, st: await page.evaluate(() => { const L = window.__WH__.life(); const m = window.__WH__.shell.matInfo(); return { auto: L.auto, tap: L.tapWhy ?? L.tap ?? null, fingers: m.bodies.map((b) => [b.fingers, b.carried]), quiet: L.quiet, keys: Object.keys(L).slice(0, 40) }; }) }));
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        }
        await frames(24);
        if (process.env.ROOMS_DBG && touch && k < 3) console.log('dbg pinch', dir, k, JSON.stringify({ before: v && v.map(r2), after: (await view())?.map(r2) }));
      }
      const v = await view();
      if (process.env.ROOMS_DBG && touch && !(v && done(v))) {
        // (diagnosis: the same pinch at a grid of spots: which move the view)
        const bd = await band(), out = [];
        for (const fy of [0.15, 0.3, 0.45, 0.6, 0.75, 0.9]) for (const fx of [0.3, 0.5, 0.7]) {
          const y = bd.top + (bd.bottom - bd.top) * fy, mid = W * fx, a0 = dir > 0 ? 110 : 30, a1 = dir > 0 ? 30 : 110, v0 = await view();
          const el = await page.evaluate(([a, b, yy]) => [a, b].map((x) => document.elementFromPoint(x, yy)?.tagName + '.' + (document.elementFromPoint(x, yy)?.className ?? '')), [mid - a0, mid + a0, y]);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp([[mid - a0, y]]) });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp([[mid - a0, y], [mid + a0, y]]) });
          for (let i = 1; i <= 6; i++) { const a = a0 + ((a1 - a0) * i) / 6; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp([[mid - a, y], [mid + a, y]]) }); await frames(1); }
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await frames(24);
          const v1 = await view();
          out.push([fx, fy, Math.round(y), el.join('|').slice(0, 60), v0 && r2(v0[5]), v1 && r2(v1[5]), v1 && r2(v1[2])]);
        }
        console.log('dbg pinch grid', JSON.stringify(out), 'bodies', JSON.stringify((await bodies()).map((b) => [Math.round(b.x), Math.round(b.y), Math.round(b.r)])));
        await shot('dbg_pinchfail');
      }
      return !!v && done(v);
    };
    /** the lift's direction on screen: up when the frame has 380 px above the squishy, else toward the side with the most room (a player pulls a squishy that
     *  stands high in the frame sideways; the press is on that side of it, an outward drag) */
    const liftDir = (b, bd, others = []) => {
      // (the press must land on THIS squishy: a side whose press point lies on a neighbour's disc is not a free side)
      const free = (ux, uy) => { const x = b.x + 0.55 * b.r * ux, y = b.y + 0.55 * b.r * uy; return others.every((o) => o.i === b.i || Math.hypot(o.x - x, o.y - y) > 0.95 * o.r); };
      if (b.y - 0.55 * b.r - bd.top > 380 && free(0, -1)) return [0, -1];
      const right = W - b.x, left = b.x;
      if (free(1, 0) && (right >= left || !free(-1, 0))) return [1, 0];
      if (free(-1, 0)) return [-1, 0];
      return free(0, -1) ? [0, -1] : (right > left ? [1, 0] : [-1, 0]);
    };
    /** ONE carry by real input: press the squishy `i` (its upper part: an outward drag lifts), drag until the physics carries it, then steer the pointer toward
     *  the world spot (tx, tz) by where the spot and the body stand on screen; the pointer never leaves the play band, so a far spot is reached by the view's
     *  edge scroll. One press, one release. */
    const carryTo = async (i, tx, tz, tol = 0.45, fling = 0) => {
      const bd = await band(), b0 = (await bodies())[i];
      const out = { carried: false, scrolled: 0, moved: 0, dist: NaN, from: [r2(b0.w[0]), r2(b0.w[2])], view0: await view(), steps: 0 };
      const [ux, uy] = liftDir(b0, bd, await bodies());
      let px = b0.x + 0.55 * b0.r * ux, py = b0.y + 0.55 * b0.r * uy;
      if (fling !== 0 && process.env.ROOMS_DBG) { await shot(`dbg_tosspress_${i}`); console.log('dbg press', JSON.stringify({ i, press: [Math.round(px), Math.round(py)], bodies: (await bodies()).map((q) => [Math.round(q.x), Math.round(q.y), Math.round(q.r), q.w.map(r2)]) })); }
      await fDown(px, py); await frames(8);
      for (let k = 1; k <= 40; k++) {
        px = Math.min(W - 10, Math.max(10, px + ux * 14)); py = Math.min(bd.bottom - 10, Math.max(bd.top + 10, py + uy * 14));
        await fMove(px, py); await frames(2);
        // (R15_CLOSE 3, RE-SPECIFIED with its reason: the press takes the squishy the PLAYER SEES under the pointer (game.ts pickBody: the nearest hit on the
        // ray). The row aimed by screen discs of the rest radius and asked that squishy `i` itself be carried; with the party bunched (phone Home, after the
        // chip row: `i` stood behind another, their discs 24 px apart) the same press rightly picked up the one in front and the row read "carried false".
        // The squishy in the hand is the one this carry is about (out.who); everything measured after is measured on it.)
        { const bb = await bodies(), w = bb[i].carried ? i : bb.findIndex((q) => q.carried); if (w >= 0) { out.carried = true; out.who = w; i = w; out.liftPx = k * 14; break; } }
      }
      if (!out.carried) { const bb = await bodies(); out.miss = { press: [Math.round(b0.x + 0.55 * b0.r * ux), Math.round(b0.y + 0.55 * b0.r * uy)], dir: [ux, uy], body: [Math.round(b0.x), Math.round(b0.y), Math.round(b0.r)], now: [Math.round(bb[i].x), Math.round(bb[i].y)], fingers: bb.map((q) => q.fingers), carried: bb.map((q) => q.carried), tool: await page.evaluate(() => { const s = window.__WH__.state(); return { tool: s.tool, phase: s.phase, quiet: window.__WH__.life()?.quiet, open: [...document.querySelectorAll('[role="dialog"], .sheet, .pt')].filter((e) => !e.hidden && e.getBoundingClientRect().width > 0).map((e) => (e.className || e.id || '').toString().slice(0, 30)) }; }) }; await fUp(); await step(1); return out; }
      const x0 = bd.top + 14, x1 = bd.bottom - 14;
      for (let k = 0; k < 420; k++) {
        const b = (await bodies())[i], d = Math.hypot(b.w[0] - tx, b.w[2] - tz);
        out.dist = d; out.steps = k;
        if (d < tol) break;
        const [tp2, bp] = await proj([[tx, b.w[1], tz], [b.w[0], b.w[1], b.w[2]]]);
        // (the spot's direction on screen from the body; the step is at most 26 px, the pointer stays in the band)
        let dx = (tp2 ? tp2.x : W / 2) - (bp ? bp.x : px), dy = (tp2 ? tp2.y : py) - (bp ? bp.y : py);
        // (a hand slows down as it arrives: near the spot the step is small, so a far spot near the horizon, where a pixel is a metre, is not overshot)
        const L = Math.hypot(dx, dy) || 1, s = Math.min(d < 1.2 ? 7 : 26, L);
        const L2 = Math.hypot(dx, dy) || 1;
        px = Math.min(W - 14, Math.max(14, px + (dx / L2) * s)); py = Math.min(x1, Math.max(x0, py + (dy / L2) * s));
        await fMove(px, py); await frames(3);
        const v = await view();
        if (v && v[3] === 1) out.scrolled++;
        if (v && v[3] > 0) out.inHand = (out.inHand ?? 0) + 1;
        if (TRACE && k % 6 === 0) console.log('trace', k, JSON.stringify({ ptr: [Math.round(px), Math.round(py)], body: b.w.map(r2), scr: bp && [Math.round(bp.x), Math.round(bp.y)], want: tp2 && [Math.round(tp2.x), Math.round(tp2.y)], view: v && v.map(r2), carried: b.carried }));
      }
      if (fling !== 0) {
        // the FLING: from where it hangs, the hand goes `fling` px a frame across the frame for 5 frames (as fast as a hand goes), then lets go
        // (R15_CLOSE 3, RE-SPECIFIED for a narrow frame, with its reason: 5 frames of 90 px are 450 px, more than a 390 px phone is wide. The carry toward the
        // side of the room leaves the finger near that edge of the screen (the view scrolls under it), so the "fling" ran into the screen's edge on its first
        // frame and the finger then stood still for 4 frames before the let go: a still finger is a set-down (gestures.ts FLICK_V), and the row read
        // "fastest 0.4 m/s" (no toss) on every phone run. Where the screen has no room for the fling the hand first swings BACK toward the middle (a slow
        // carry, 300 px/s, as a thrower does), then flings with what the screen allows (at least 3000 px/s on 390 px), letting go while it moves.)
        const dirF = Math.sign(fling), need = 5 * Math.abs(fling);
        let room = dirF < 0 ? px - 4 : W - 4 - px, stepF = Math.abs(fling);
        if (room < need) {
          const bx = dirF < 0 ? Math.min(Math.round(W * 0.74), px + (need - room)) : Math.max(Math.round(W * 0.26), px - (need - room));
          while (Math.abs(bx - px) > 1) { px += Math.sign(bx - px) * Math.min(10, Math.abs(bx - px)); await fMove(px, py); await frames(2); }
          await frames(4);
          room = dirF < 0 ? px - 4 : W - 4 - px; stepF = Math.min(stepF, Math.floor(room / 5));
          out.backswing = Math.round(px);
        }
        out.flingPx = stepF; { const bf = (await bodies())[i]; out.flingFrom = [r2(bf.w[0]), r2(bf.w[2])]; }
        for (let k = 0; k < 5; k++) { px = Math.min(W - 4, Math.max(4, px + dirF * stepF)); await fMove(px, py); await frames(1); }
        await fUp();
        return out;
      }
      // (round 15, R15_FIX BR; RE-SPECIFIED with its reason) the hand LETS GO ON ARRIVAL, after 3 frames of a still finger. The row used to hold still "until the
      // squishy hangs still under the hand (at most a second)": when the arrival has the finger at the frame's edge, the view goes on scrolling under a resting
      // finger (the edge scroll, as designed: R15_FIX F6) and carries the squishy on for that second, so "rest" measured the harness's wait, not the game (desk
      // Home: 1.2 to 3 m). A still finger at the let go is a set-down whatever the hand's speed (gestures.ts FLICK_V, R15_FIX F3), so no wait is needed for one.
      await frames(3);
      const v1 = await view();
      if (out.view0 && v1) out.moved = Math.hypot(v1[0] - out.view0[0], v1[1] - out.view0[1]);
      const bh = (await bodies())[i];
      out.atHold = [r2(bh.w[0]), r2(bh.w[2])];
      await fUp();
      if (TRACE) for (let k = 0; k < 5; k++) { await step(0.5); const bb = (await bodies())[i]; console.log('after release', k, JSON.stringify({ body: bb.w.map(r2), view: (await view())?.map(r2) })); }
      else await step(2.5);
      const b1 = (await bodies())[i];
      out.at = [r2(b1.w[0]), r2(b1.w[2])]; out.rest = Math.hypot(b1.w[0] - tx, b1.w[2] - tz);
      // (round 15, R15_FIX BR) the next row presses a squishy where it stands on screen NOW: wait (after the rest is measured) until the room camera has stopped
      // easing back from the hand's view (it narrows from 2.5 s after the let go: with the let go on arrival the next press came exactly then, the picture slid
      // from under the pointer during its 8 frames of press, and the Hearthlog and Frostbell toss rows read "carried false"); 6 s at most
      for (let k = 0, v0 = await view(); k < 12; k++) { await step(0.5); const v1 = await view(); const still = v0 && v1 && Math.abs(v1[0] - v0[0]) + Math.abs(v1[1] - v0[1]) + Math.abs(v1[2] - v0[2]) < 0.004; v0 = v1; if (still || !v1) break; }
      return out;
    };

    // ---- boot: a fresh profile, then the same profile with every place open ----
    const boot = async () => {
      await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 180000 });
      await page.waitForSelector('.cta:not([disabled])', { timeout: 60000 });
      const b = await boxOf('.cta'); await tapAt(b.x, b.y);
      await page.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 30000 });
      await page.waitForFunction(() => !!window.__WH__.life(), null, { timeout: 90000 });
      await page.evaluate(() => { const wh = window.__WH__; wh.shell.matBusyMs(1e9); wh.setSetting('quality', 'low'); wh.setSetting('skipAnimations', true); wh.pause(); });
    };
    await page.goto(srv.url + '?dev=1&rseed=4242', { waitUntil: 'load' });
    await boot();
    await step(2); await page.evaluate(() => window.__WH__.resume()); await sleep(1500);
    await page.evaluate((pl) => sessionStorage.setItem('roomseed', JSON.stringify({ st: 45, pl })), Object.values(IDX).reduce((m, ix) => m | (1 << ix), 0));
    await page.reload({ waitUntil: 'load', timeout: 180000 });
    await boot();
    await step(2);
    await page.keyboard.press('Escape');
    // (round 15, R15_FIX BR: with nothing to close, Escape OPENS the Menu on a phone; it is closed again, or the taps below land on its rows: the Credits sheet
    // covered the play view and the whole phone half of this harness ran behind it (15 reds). browser_carry.mjs has the same lines.)
    for (let k = 0; k < 3 && (await page.evaluate(() => !!document.querySelector('#wh-menu:not([hidden]), .k-modal:not([hidden]), .panel[data-open="true"]'))); k++) { await page.keyboard.press('Escape'); await sleep(400); }

    // ---- Home, ONE out: the published toy (the room camera does not drive) ----
    if (PLACES.includes('home')) {
      const v = await view(), b = (await bodies())[0], bd = await band();
      // RE-SPECIFIED in round 15 (R15_FIX BR; written reason): "centred" asked the squishy within 6 % of the frame's middle. The PUBLISHED phone camera does not
      // stand there: it shows the mat's middle at x 154 of 390 (the live source and this tree project (0, 0, 0) to (154.23, 434.42) on 390 x 844 and to
      // (640, 525.55) on 1280 x 800: S/v/scripts/one_cam.mjs, R15_FIX F2), so the phone row could never pass. The row now pins the published camera itself: the
      // mat's middle within 1.5 px of where the live build draws it, the squishy within 0.2 of the frame's width of it, between the HUD rows, at its size.
      const [o0] = await proj([[0, 0, 0]]), pub = tall ? [154.23, 434.42] : [640, 525.55];
      check(`${frame} Home, one squishy out: the published camera (the room camera does not drive; the mat's middle where the live build draws it); the squishy close, by the mat's middle, between the HUD rows`,
        v === null && !!o0 && Math.hypot(o0.x - pub[0], o0.y - pub[1]) < 1.5 && Math.abs(b.x - pub[0]) < W * 0.2 && b.y - b.r > bd.top - 4 && b.y + b.r < bd.bottom + 4 && b.r > (tall ? 70 : 90),
        JSON.stringify({ roomView: v, origin: o0 && [+o0.x.toFixed(2), +o0.y.toFixed(2)], published: pub, x: Math.round(b.x), y: Math.round(b.y), r: Math.round(b.r), band: [Math.round(bd.top), Math.round(bd.bottom)] }));
      await shot('home_one');
    }

    // ---- three out (the capsules by the dev hook; the party by the real tray) ----
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => { window.__WH__.shell.grant(1); });
      for (let k = 0; k < 30 && !(await page.evaluate(() => window.__WH__.shell.meter().onTable)); k++) await step(0.1);
      await page.evaluate(() => { void window.__WH__.shell.openCapsule(); });
      for (let k = 0; k < 40; k++) { await step(0.1); if (await page.evaluate(() => { const c = window.__WH__.shell.ceremony(); return c.kind === null && !c.pending; })) break; }
    }
    await step(1);
    const count = () => page.evaluate(() => window.__WH__.shell.matInfo().count);
    await page.evaluate(() => window.__WH__.resume()); await sleep(600);
    if ((await count()) > 1) { await clickSel('.mat-chip'); await sleep(600); }
    // (round 15, R15_FIX BR: browser_carry.mjs's flow, which works on a phone) the Friends strip hides while something covers the play view (a phone's "New stamp"
    // moment after the capsules): a player waits for it; a chip below the sheet's fold is scrolled into view; Bring friends fills the party when one is not reached
    for (let k = 0; k < 30 && !(await boxOf('.pt-btn')); k++) await sleep(500);
    if (await clickSel('.pt-btn')) {
      for (let k = 0; k < 6 && (await page.evaluate(() => document.querySelectorAll('.pt-chip[aria-pressed="true"]:not([data-play])').length)) < 2; k++) {
        await page.evaluate(() => document.querySelector('.pt-chip[aria-pressed="false"]:not([data-play])')?.scrollIntoView({ block: 'center' }));
        await sleep(200);
        await clickSel('.pt-chip[aria-pressed="false"]:not([data-play])');
      }
      if ((await count()) < 3) await clickSel('.pt-bring');
      await clickSel('.pt-close');
    }
    await page.evaluate(() => window.__WH__.pause()); await step(1.5);
    check(`${frame}: three squishies out`, (await count()) === 3, `${await count()} out`);

    let chipPairDone = false;
    for (const place of PLACES) {
      const def = DEFS[place], lay = tall && def.tall ? def.tall : def, B = lay.bounds;
      const home = place === 'home', cx = B.x, cz = B.z, hx = home ? (B.r ?? HOME_R) : B.hx, hz = home ? (B.r ?? HOME_R) : B.hz;
      const label = `${frame} ${NAMES[place] ?? place}`;
      const e0 = errs.length;
      // ---- the trip, by the real Places sheet ----
      if (!home || (await page.evaluate(() => window.__WH__.life()?.place ?? 0)) !== 0) {
        await page.evaluate(() => window.__WH__.resume());
        const opened = await clickSel('.dock-places');
        let go = false;
        // (R15_CLOSE 5, RE-SPECIFIED with its reason: on a 390 x 844 phone the Places sheet scrolls; the Go buttons of the fourth place on lie below its fold,
        // and the tap went to where the button would be without scrolling (go true, arrived false: Frostbell, Rainleaf, Lanternroof, Cloudloft on every phone
        // run, while the first three places arrived). A player scrolls the sheet to the place: the button is scrolled into view, then tapped.)
        // (the sheet slides in: the button is tapped once it stands still (two reads 150 ms apart agree), and the tap is made again if the trip has not
        // begun 0.9 s later: a tap on a button still moving went beside it, "go true, arrived false", in one run of three)
        const started = () => page.evaluate((ix) => { const L = window.__WH__.life(); return !!L && (L.travelling === true || L.place === ix); }, IDX[place]);
        for (let k = 0; k < 24 && !(go && (await started())); k++) {
          await sleep(400);
          const q = `.jn-go[data-place="${place}"]`;
          await page.evaluate((qq) => document.querySelector(qq)?.scrollIntoView({ block: 'center', behavior: 'instant' }), q);
          let b0 = await boxOf(q), still = false;
          for (let j = 0; j < 12 && !still; j++) { await sleep(150); const b1 = await boxOf(q); still = !!b0 && !!b1 && Math.abs(b1.x - b0.x) + Math.abs(b1.y - b0.y) < 1 && b1.y > 60 && b1.y < H - 30; b0 = b1; }
          if (!still) continue;
          go = (await clickSel(q)) || go;
          await sleep(900);
        }
        if (!go) console.log('debug sheet', JSON.stringify(await page.evaluate(() => { const d = document.getElementById('wh-travel'); return { sheet: !!d, cards: d ? [...d.querySelectorAll('.jn-card')].map((c) => `${c.dataset.place}:${c.dataset.open}`) : null, go: d ? [...d.querySelectorAll('.jn-go')].map((b) => `${b.dataset.place}:${b.disabled}`) : null, places: !!document.querySelector('.dock-places'), reasons: window.__WH__.shell.pauseReasons(), live: window.__liveLog.slice(-3) }; })));
        await page.evaluate(() => window.__WH__.pause());
        let arrived = false;
        for (let k = 0; k < 80 && !arrived; k++) { await step(0.25); arrived = await page.evaluate((ix) => { const L = window.__WH__.life(); return !!L && L.place === ix && !L.travelling; }, IDX[place]); }
        check(`${label}: the trip by the real Places sheet (the button, the place's Go), the three arrive`, opened && go && arrived && (await count()) === 3, JSON.stringify({ opened, go, arrived, out: await count() }));
        if (!arrived) continue;
      }
      await step(4);
      const bd = await band();
      if (process.argv.includes('--debug')) console.log('debug offs', JSON.stringify(await page.evaluate(() => { const wh = window.__WH__; return { life: wh.life().chars.filter((c) => c.kind === 0).map((c) => [c.view, c.x, c.z]), mat: wh.shell.matInfo().bodies.map((b) => b.w.map((v) => +v.toFixed(3))) }; })));
      if (process.argv.includes('--debug')) console.log('debug', JSON.stringify(await page.evaluate(() => { const at = (x, y) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName}.${e.className}#${e.id}` : null; }; const wh = window.__WH__; return { mid: at(innerWidth / 2, innerHeight / 2), up: at(innerWidth / 2, innerHeight * 0.3), reasons: wh.shell.pauseReasons(), paused: wh.shell.paused(), tool: document.body.dataset.tool, open: [...document.querySelectorAll('[role="dialog"]')].filter((d) => !d.hidden && d.offsetParent !== null).map((d) => d.id || d.className) }; })));
      if (process.argv.includes('--debug-only')) continue;
      // ---- the default view: the party at a readable size, inside the HUD rows ----
      const v0 = await view(), b0 = await bodies();
      const inBand = (b) => b.x - b.r > -2 && b.x + b.r < W + 2 && b.y - b.r > bd.top - 6 && b.y + b.r < bd.bottom + 6;
      check(`${label}: the room camera drives; by itself it shows the three between the HUD rows at today's size or more than 70 % of it (view factor <= ${home ? 'far' : r2(ROOM_CAM.far)})`,
        !!v0 && b0.every(inBand) && (home || v0[2] <= ROOM_CAM.far + 0.01) && v0[5] === 0,
        JSON.stringify({ view: v0 && v0.map(r2), discs: b0.map((b) => [Math.round(b.x), Math.round(b.y), Math.round(b.r)]), band: [Math.round(bd.top), Math.round(bd.bottom)] }));
      await shot(`${place}_default`);
      const rDefault = Math.min(...b0.map((b) => b.r));

      // ---- zoom by real input: out to the whole room, in to the close view ----
      const outOk = await zoomBy(1, (v) => v[2] > 0.995);
      await step(2);
      const vR = await view(), bR = await bodies();
      const rim = home ? Array.from({ length: 12 }, (_, k) => [cx + hx * Math.cos((k * Math.PI) / 6), 0, cz + hx * Math.sin((k * Math.PI) / 6)]) : [[cx - hx, 0, cz - hz], [cx + hx, 0, cz - hz], [cx - hx, 0, cz + hz], [cx + hx, 0, cz + hz]];
      const rp = await proj(rim);
      const rimIn = rp.every((p) => p && p.x > -3 && p.x < W + 3 && p.y > bd.top - 3 && p.y < bd.bottom + 3);
      check(`${label}: ${touch ? 'a pinch' : 'the wheel'} zooms out to the WHOLE ROOM: every ${home ? 'side of the felt' : 'corner of the floor'} is in the frame between the HUD rows, the three still in view`,
        outOk && !!vR && vR[2] > 0.995 && rimIn && bR.every(inBand),
        JSON.stringify({ view: vR && vR.map(r2), rim: rp.map((p) => p && [Math.round(p.x), Math.round(p.y)]), r: bR.map((b) => Math.round(b.r)), rDefault: Math.round(rDefault) }));
      await shot(`${place}_room`);
      const inOk = await zoomBy(-1, (v) => v[5] > 0 && v[5] < (home ? 0.999 * v[2] + 1 : ROOM_CAM.close + 0.01) && (home ? v[2] < 0.6 * vR[2] : true), 60);
      await step(2);
      const vC = await view(), bC = await bodies();
      check(`${label}: ${touch ? 'a pinch' : 'the wheel'} zooms in to a CLOSE view (a squishy at least ${home ? '1.6' : '2.2'} times its whole-room size)`,
        inOk && !!vC && Math.max(...bC.map((b) => b.r)) >= (home ? 1.6 : 2.2) * Math.max(...bR.map((b) => b.r)),
        JSON.stringify({ view: vC && vC.map(r2), r: bC.map((b) => Math.round(b.r)), rRoom: bR.map((b) => Math.round(b.r)) }));
      // back to about the camera's own size (the player's zoom stays where it is put); `own`: the factor the camera took by itself on arrival
      const own = v0 ? v0[2] : ROOM_CAM.near;
      await zoomBy(1, (v) => v[5] >= 0.93 * own, 30);
      await step(1.5);

      // ---- pan by real input (Shift + the right button; two fingers); the plain right drag / one finger still turns the view ----
      {
        const row = await emptyRow(touch ? 120 : 10), vA = await view(), yawA = await yawOf();
        if (!row) check(`${label}: pan by real input`, false, 'no empty spot on screen for the gesture');
        else {
          // (the drag goes the way that takes the view's centre toward the room's middle: a pan toward a wall the view already touches cannot move it)
          const mid = (row.x0 + row.x1) / 2, y = row.y, D = touch ? 110 : 160, sgn = vA && vA[0] > cx ? 1 : -1;
          if (touch) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp([[row.x0, y]]) });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp([[row.x0, y], [row.x1, y]]) });
            for (let i = 1; i <= 8; i++) { const o = (sgn * D * i) / 8; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp([[row.x0 + o, y], [row.x1 + o, y]]) }); await frames(2); }
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          } else {
            await page.keyboard.down('Shift'); await page.mouse.move(mid, y); await page.mouse.down({ button: 'right' });
            for (let i = 1; i <= 8; i++) { await page.mouse.move(mid + (sgn * D * i) / 8, y); await frames(2); }
            await page.mouse.up({ button: 'right' }); await page.keyboard.up('Shift');
          }
          await step(1.2);
          const vB = await view(), yawB = await yawOf();
          const shift = vA && vB ? Math.hypot(vB[0] - vA[0], vB[1] - vA[1]) : 0, dirOk = vA && vB ? (vB[0] - vA[0]) * sgn < -0.05 : false;
          check(`${label}: ${touch ? 'a two-finger drag' : 'Shift + a right-button drag'} PANS the view (the picture follows the hand: ${D} px ${sgn > 0 ? 'right' : 'left'} moves the view's centre ${sgn > 0 ? 'left' : 'right'}); the camera does not turn`,
            shift > 0.25 && dirOk && Math.abs(yawB - yawA) < 0.01, JSON.stringify({ from: vA && vA.slice(0, 3).map(r2), to: vB && vB.slice(0, 3).map(r2), shift: r2(shift), yaw: [r2(yawA), r2(yawB)] }));
          // the published turn: a plain right-button drag (mouse) / one finger on empty space (touch)
          const row2 = (await emptyRow(10)) ?? row, m2 = (row2.x0 + row2.x1) / 2;
          if (touch) { await fDown(m2, row2.y); for (let i = 1; i <= 6; i++) { await fMove(m2 + (sgn * 60 * i) / 6, row2.y); await frames(2); } await fUp(); }
          else { await page.mouse.move(m2, row2.y); await page.mouse.down({ button: 'right' }); for (let i = 1; i <= 6; i++) { await page.mouse.move(m2 + (sgn * 60 * i) / 6, row2.y); await frames(2); } await page.mouse.up({ button: 'right' }); }
          await step(0.6);
          const yawC = await yawOf();
          check(`${label}: the published turn still works (${touch ? 'one finger on empty space' : 'a plain right-button drag'} turns the view)`, Math.abs(yawC - yawB) > 0.03, JSON.stringify({ yaw: [r2(yawB), r2(yawC)] }));
          // (turn back, so the rest of the rows run in the default direction)
          if (touch) { await fDown(m2 + sgn * 60, row2.y); for (let i = 1; i <= 6; i++) { await fMove(m2 + sgn * 60 - (sgn * 60 * i) / 6, row2.y); await frames(2); } await fUp(); }
          else { await page.mouse.move(m2 + sgn * 60, row2.y); await page.mouse.down({ button: 'right' }); for (let i = 1; i <= 6; i++) { await page.mouse.move(m2 + sgn * 60 - (sgn * 60 * i) / 6, row2.y); await frames(2); } await page.mouse.up({ button: 'right' }); }
          await step(0.6);
        }
      }

      // ---- ONE carry from the front of the room to the far back corner, from a view that does not show both (the view must scroll under the hand) ----
      await zoomBy(-1, (v) => v[5] > 0 && v[5] <= 0.8 * own, 30);
      await step(1.5);
      {
        // a free spot of floor by a point: the nearest grid point (0.4 m) within 1.4 m of it that is 1.0 m clear of every thing and inside the bounds by 0.8 m
        const things = (tall && def.tall ? def.tall.things : def.things).map((t) => [t.x, t.z]);
        const freeSpot = ([qx, qz]) => {
          let best = [qx, qz], bd2 = Infinity;
          for (let ix = -4; ix <= 4; ix++) for (let iz = -4; iz <= 4; iz++) {
            const x = qx + ix * 0.4, z = qz + iz * 0.4, d = Math.hypot(x - qx, z - qz);
            if (d > 1.45 || d >= bd2) continue;
            if (home ? Math.hypot(x - cx, z - cz) > hx - 0.8 : Math.abs(x - cx) > hx - 0.8 || Math.abs(z - cz) > hz - 0.8) continue;
            if (things.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 1.0)) continue;
            best = [x, z]; bd2 = d;
          }
          return best;
        };
        const inset = home ? 0 : 1.0;
        // Home's felt is a disc: its front is (0, +0.75 r), its far back side (-0.55 r, -0.6 r)
        const front = freeSpot(home ? [cx + 0.1 * hx, cz + 0.72 * hx] : [cx + (hx - inset) * 0.85, cz + hz - inset]), back = freeSpot(home ? [cx - 0.55 * hx, cz - 0.6 * hx] : [cx - (hx - inset), cz - (hz - inset)]);
        const bs = await bodies();
        // the squishy nearest the front goes there first (a carry of its own), then to the far back corner in ONE gesture
        const freeSide = (b) => [[0, -1], [1, 0], [-1, 0]].some(([ux, uy]) => { const x = b.x + 0.55 * b.r * ux, y = b.y + 0.55 * b.r * uy; return x > 20 && x < W - 20 && y > bd.top + 10 && bs.every((o) => o.i === b.i || Math.hypot(o.x - x, o.y - y) > 0.95 * o.r); });
        const cand = bs.filter(freeSide), pool = cand.length ? cand : bs;
        const i = pool.reduce((a, b) => (Math.hypot(b.w[0] - front[0], b.w[2] - front[1]) < Math.hypot(bs[a].w[0] - front[0], bs[a].w[2] - front[1]) ? b.i : a), pool[0].i);
        const c1 = await carryTo(i, front[0], front[1]);
        const c2 = await carryTo(c1.who ?? i, back[0], back[1]);
        const span = Math.hypot(back[0] - front[0], back[1] - front[1]);
        const inside = (p) => (home ? Math.hypot(p[0] - cx, p[1] - cz) <= hx + 0.05 : Math.abs(p[0] - cx) <= hx + 0.05 && Math.abs(p[1] - cz) <= hz + 0.05);
        check(`${label}: ONE carry (one press, one release) takes a squishy from the front of the room to the far back ${home ? 'side of the felt' : 'corner'} (${r2(span)} m across the room); the view scrolls under the hand`,
          c1.carried && c2.carried && c2.rest < 1.3 && inside(c2.at) && c2.scrolled > 0 && c2.from[1] > cz + 0.3 * hz && Math.hypot(c2.at[0] - c2.from[0], c2.at[1] - c2.from[1]) > 0.6 * span,
          JSON.stringify({ toFront: { carried: c1.carried, want: front.map(r2), at: c1.at, rest: r2(c1.rest ?? NaN), scrolled: c1.scrolled }, toBack: { carried: c2.carried, from: c2.from, at: c2.at, want: back.map(r2), rest: r2(c2.rest ?? NaN), scrolledFrames: c2.scrolled, inHandFrames: c2.inHand ?? 0, viewMoved: r2(c2.moved), steps: c2.steps } }));
        await shot(`${place}_carried`);

        // ---- the edge chips: a squishy out of view is hinted; a tap brings the camera to it ----
        await zoomBy(-1, (v) => v[5] > 0 && v[5] <= (home ? 0.6 * own : ROOM_CAM.close + 0.03), 50);
        await step(1.5);
        // (the friends may have walked over to the carried one: when everybody is in the picture the player looks away, a pan by real input, so that one is not)
        const outNow = async () => (await bodies()).filter((b) => !(b.x > 0 && b.x < W && b.y > bd.top && b.y < bd.bottom)).length;
        for (let n = 0; n < 4 && (await outNow()) === 0; n++) {
          const row = await emptyRow(touch ? 120 : 10);
          if (!row) break;
          const m = (row.x0 + row.x1) / 2, vv = await view(), sg = vv && vv[0] > cx ? 1 : -1, D = touch ? 150 : 320;
          if (touch) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp([[row.x0, row.y]]) });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp([[row.x0, row.y], [row.x1, row.y]]) });
            for (let q = 1; q <= 8; q++) { const o = (sg * D * q) / 8; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp([[row.x0 + o, row.y], [row.x1 + o, row.y]]) }); await frames(2); }
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          } else {
            await page.keyboard.down('Shift'); await page.mouse.move(m, row.y); await page.mouse.down({ button: 'right' });
            for (let q = 1; q <= 8; q++) { await page.mouse.move(m + (sg * D * q) / 8, row.y); await frames(2); }
            await page.mouse.up({ button: 'right' }); await page.keyboard.up('Shift');
          }
          await step(0.8);
        }
        await page.evaluate(() => window.__WH__.resume()); await sleep(900); await page.evaluate(() => window.__WH__.pause());
        await step(0.3); await sleep(500);
        const chips = () => page.evaluate(() => [...document.querySelectorAll('.rm-chip')].filter((c) => !c.hidden).map((c) => { const r = c.getBoundingClientRect(); return { label: c.getAttribute('aria-label'), x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; }));
        await shot(`${place}_chips`);
        await sleep(300);
        let ch = await chips(), vE = await view(), bE = await bodies();
        // (R15_CLOSE, RE-SPECIFIED with its reason: the row counted a squishy as outside the picture as soon as its MIDDLE left the frame or the band; the game
        // shows a chip once it is half hidden or more (ui/later-room.ts: the middle 10 px past a side, 18 px past the band). A squishy in between read
        // "off screen 1, chips none" (Rainleaf, phone). The row now counts by the game's own written rule.)
        let offNow = bE.filter((b) => !(b.x > -10 && b.x < W + 10 && b.y > bd.top - 18 && b.y < bd.bottom + 18)).length;
        // (R15_CLOSE: TWO OFF THE SAME SIDE (the overlapping chips of Lanternroof): at each place that is not Home, the two squishies
        // that are not nearest the view's middle are set close together far off one side (by the physics' own placeAt), and their chips must stand apart)
        // (at EVERY place: the close view by itself does not always leave a squishy outside the picture (Lanternroof, phone: "off screen 0, chips none"), and
        // then the chip row below had nothing to test; with two set off one side it always has)
        if (!home) {
          chipPairDone = true;
          const res = await page.evaluate(async ([px, pz]) => {
            const pm = await import('/src/physics/props.ts');
            const orig = pm.PropWorld.prototype.beginFrame;
            let W0 = null; pm.PropWorld.prototype.beginFrame = function () { W0 = this; return orig.call(this); };
            window.__WH__.step(1 / 60, 2);
            pm.PropWorld.prototype.beginFrame = orig;
            if (!W0) return 'no world';
            const bs = W0.bodies.filter((b) => !b.chunk && !b.capFlat);
            if (bs.length < 3) return 'bodies ' + bs.length;
            const st = window.__WH__.shell.stageObj(), o = new Float32Array(6); st.roomView(o);
            bs.sort((a, b) => Math.hypot(a.center.x - o[0], a.center.z - o[1]) - Math.hypot(b.center.x - o[0], b.center.z - o[1]));
            bs[1].placeAt({ x: px, y: bs[1].center.y, z: pz - 0.55 }, { x: 0, y: 0, z: 0 });
            bs[2].placeAt({ x: px, y: bs[2].center.y, z: pz + 0.55 }, { x: 0, y: 0, z: 0 });
            window.__WH__.step(1 / 60, 30);
            return 'placed';
          }, [vE && vE[0] > cx ? cx - hx + 0.9 : cx + hx - 0.9, vE ? vE[1] : cz]);   // (0.9 m inside the side: at 0.5 m the camera, kept inside the room, could not bring the squishy fully into a phone's frame, and its chip stayed after the tap: Cloudloft)
          await page.evaluate(() => window.__WH__.resume()); await sleep(900); await page.evaluate(() => window.__WH__.pause()); await step(0.3); await sleep(300);
          const cp = await chips();
          const apart = cp.every((c, a) => cp.every((d, b) => a === b || Math.abs(c.x - d.x) >= 44 || Math.abs(c.y - d.y) >= 44));
          check(`${label}: two squishies off the SAME side of the picture: their chips do not lie on each other (44 px apart at least)`, res === 'placed' && cp.length >= 2 && apart, JSON.stringify({ res, chips: cp.map((c) => [c.label, Math.round(c.x), Math.round(c.y)]) }));
          ch = cp; vE = await view(); bE = await bodies();
          offNow = bE.filter((b) => !(b.x > -10 && b.x < W + 10 && b.y > bd.top - 18 && b.y < bd.bottom + 18)).length;
        }
        let focus = null;
        if (ch.length) {
          const live0 = await page.evaluate(() => window.__liveLog.length);
          const hitEl = await page.evaluate(([x, y]) => { const c = [...document.querySelectorAll('.rm-chip')].find((q) => !q.hidden); return { at: document.elementsFromPoint(x, y).slice(0, 3).map((e) => `${e.tagName}.${typeof e.className === 'string' ? e.className : ''}`), inert: !!c?.closest('[inert]'), pe: c ? getComputedStyle(c).pointerEvents : null, vis: c ? getComputedStyle(c).visibility : null }; }, [ch[0].x, ch[0].y]);
          await tapAt(ch[0].x, ch[0].y); await sleep(300);
          await step(2.5); await sleep(400);
          // (round 15, R15_FIX BR: the chips are DOM, redrawn by the running loop: it runs a moment before they are read again, as before the first read above;
          // read while paused, a chip of a squishy already back in the picture was still listed: "onScreen 3, gone false")
          await page.evaluate(() => window.__WH__.resume()); await sleep(900); await page.evaluate(() => window.__WH__.pause()); await step(0.3); await sleep(300);
          const vF = await view(), bF = await bodies(), ch2 = await chips();
          const said = await page.evaluate((n) => window.__liveLog.slice(n).filter((t) => /^Looking at /.test(t)), live0);
          focus = { hitEl, said, moved: vE && vF ? r2(Math.hypot(vF[0] - vE[0], vF[1] - vE[1])) : 0, chipsAfter: ch2.map((c) => c.label), onScreen: bF.filter((b) => b.x > 0 && b.x < W && b.y > bd.top && b.y < bd.bottom).length, gone: !ch2.some((c) => c.label === ch[0].label) };
        }
        check(`${label}: a squishy outside the picture is hinted by a chip at the frame's edge (44 px, inside the frame, named, no chip on another); a ${touch ? 'tap' : 'click'} on it brings the camera to that squishy ("Looking at ...")`,
          offNow > 0 && ch.length >= 1 && ch.every((c, a) => ch.every((d, b) => a === b || Math.abs(c.x - d.x) >= 44 || Math.abs(c.y - d.y) >= 44)) && ch.every((c) => c.w >= 44 && c.h >= 44 && c.x > 20 && c.x < W - 20 && c.y > bd.top && c.y < bd.bottom && /^Go to /.test(c.label ?? '')) && !!focus && focus.said.length === 1 && focus.moved > 0.3 && focus.gone,
          JSON.stringify({ view: vE && vE.slice(0, 3).map(r2), offScreen: offNow, chips: ch.map((c) => [c.label, Math.round(c.x), Math.round(c.y)]), focus }));
        await zoomBy(1, (v) => v[5] >= 0.93 * own, 30);
        await step(1);

        // ---- a hard toss (the fastest throw a hand makes) stays inside the room: the squishy is carried to 2.6 m from the left side of the room and flung
        //      at that side, without letting go in between (one press: the carry, then the fling) ----
        const tossFrom = freeSpot(home ? [cx - hx + 2.6, cz + 0.4] : [cx - hx + 2.6, cz + 0.15 * hz]);
        // (round 15, R15_FIX BR: the press below is aimed at where the squishy stands on screen now: the camera, brought to a squishy by the chip row for 8 s
        // (roomcam focusS), must have stopped easing back first, or the picture slides from under the press ("carried false"); 10 s at most)
        for (let k = 0, v0 = await view(); k < 20; k++) { await step(0.5); const v1 = await view(); const still = v0 && v1 && Math.abs(v1[0] - v0[0]) + Math.abs(v1[1] - v0[1]) + Math.abs(v1[2] - v0[2]) < 0.004; v0 = v1; if (k >= 16 || !v1 || (still && k >= 2)) break; }
        // (R15_CLOSE 5, RE-SPECIFIED with its reason: the toss row pressed squishy `i` wherever it stood; on the phone at the cabin it stood at the frame's very
        // edge (disc (17, 315) r 25 on a 390 px frame, under the edge chip's place) and the press took nothing. A player throws a squishy they can see: the
        // one pressed is `i` when its disc is inside the frame, else the one nearest the frame's middle.)
        const bsT = await bodies(), bdT = await band(), inFrame = (q) => q.x > q.r + 24 && q.x < W - q.r - 24 && q.y > bdT.top + q.r && q.y < bdT.bottom - q.r;
        const iPress = inFrame(bsT[i]) ? i : bsT.reduce((a, q) => (Math.hypot(q.x - W / 2, q.y - (bdT.top + bdT.bottom) / 2) < Math.hypot(bsT[a].x - W / 2, bsT[a].y - (bdT.top + bdT.bottom) / 2) ? q.i : a), bsT[0].i);
        const cT = await carryTo(iPress, tossFrom[0], tossFrom[1], 0.6, -90);
        const carried = cT.carried, stepPx = 90, iT = cT.who ?? iPress;
        let top = 0, far = 0, vMax = 0, last = (await bodies())[iT].w;
        // (R15_CLOSE 1, RE-SPECIFIED with its reason: "fastest" was read over 5 frames at a time (83 ms). A phone's toss lands in about 0.3 s in these rooms, so
        // the 5-frame mean depended on where the window fell: the same fling read 2.42, 3.87 and 8.12 m/s in three runs (traced). The first 20 frames after
        // the let go are now read frame by frame (the speed the toss really has); the 2.5 m/s bar is unchanged.)
        for (let k = 0; k < 20; k++) { await frames(1); const w = (await bodies())[iT].w; vMax = Math.max(vMax, Math.hypot(w[0] - last[0], w[1] - last[1], w[2] - last[2]) * 60); last = w; top = Math.max(top, w[1]); far = Math.max(far, home ? Math.hypot(w[0] - cx, w[2] - cz) - hx : Math.max(Math.abs(w[0] - cx) - hx, Math.abs(w[2] - cz) - hz)); }
        for (let k = 0; k < 56; k++) {
          await frames(5);
          const w = (await bodies())[iT].w;
          if (process.env.ROOMS_DBG && k % 4 === 3) console.log('dbg toss', k, JSON.stringify({ w: w.map(r2), out: r2(home ? Math.hypot(w[0] - cx, w[2] - cz) - hx : 0), v: r2(Math.hypot(w[0] - last[0], w[1] - last[1], w[2] - last[2]) / (5 / 60)) }));
          vMax = Math.max(vMax, Math.hypot(w[0] - last[0], w[1] - last[1], w[2] - last[2]) / (5 / 60)); last = w;
          top = Math.max(top, w[1]);
          far = Math.max(far, home ? Math.hypot(w[0] - cx, w[2] - cz) - hx : Math.max(Math.abs(w[0] - cx) - hx, Math.abs(w[2] - cz) - hz));
        }
        const end = (await bodies())[iT].w;
        // (an open place has no wall: its edge turns a squishy back within the physics' rim, PG.boundsRim 0.6 m past the bounds, and it glides back inside)
        check(`${label}: a hard toss at the side of the room 2.6 m away stays inside (the squishy's middle never passes the ${home ? "felt's rim" : 'bounds'} by more than the 0.6 m rim, stays under the ${PROPS.WALL_H} m wall top, and comes to rest in the room)`,
          carried && vMax > 2.5 && far < 0.7 && top < PROPS.WALL_H && inside([end[0], end[2]]) && end[1] < 1.2 && end[1] > -0.2,
          JSON.stringify({ carried, miss: cT.miss, who: cT.who, from: tossFrom.map(r2), flungFrom: cT.flingFrom, backswing: cT.backswing, fling: cT.flingPx ?? Math.round(stepPx), fastest: r2(vMax), highest: r2(top), pastBounds: r2(far), end: end.map(r2) }));
        await step(1);
      }
      const errsHere = errs.slice(e0);
      check(`${label}: no console error and no page error`, errsHere.length === 0, errsHere.slice(0, 3).join(' | '));
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  srv.stop();
}
mkdirSync(resolve(ROOT, '_harness/_reports'), { recursive: true });
writeFileSync(resolve(ROOT, '_harness/_reports/browser_rooms.json'), JSON.stringify({ at: new Date().toISOString(), tag: TAG, rows }, null, 1));
console.log(`\n${rows.length - fails} ok, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
