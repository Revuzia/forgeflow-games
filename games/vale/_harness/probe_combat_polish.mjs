// VALE harness — combat polish gates on the real renderer (render bench, real Chrome GPU, heavy slot). One match host of
// its own (the lineup below), fast-forwarded 420 s, waves frozen, bots muted; the viewer is seat 0 (Lisvel), every
// caster is an ENEMY (its telegraphs are the enemy treatment). content/vfx.json on disk replaces the catalog's VFX
// defs (the dev catalog may be stale); `--before <file>` measures that defs file instead (the impact-hold A/B).
//
//   ult     combat F4. Kemdo, Rishal, Tunlan, Hesmi cast their ultimate at the viewer 4.5 m away. Every frame the lift
//           uniforms (vfx/screen.ts uLiftA) are read; on frames with a lift ≥ 1.3 the frame is grabbed:
//             ctr      the lift's screen centre (firstCtr: the first beat) vs the caster's and the victim's ground points;
//                      done: the centre sits nearer the victim / the shape's centroid than the caster (Tunlan's cone,
//                      Rishal's track)
//             body     the victim's BODY pixels (its skinned body alone rendered into an empty target, above its feet) and the share of them that is white (luma > 225, chroma < 30) with the lift alone
//                      (VFX off, the actor's victim flash hidden: the envelope's own effect) less the body's white with no
//                      lift (its own pale parts), with the hit flash, and in the full frame; done: the lift adds ≤ 0.10 at every beat
//                      (the review: the struck unit went 22-34 % white on the first beat, its box measure). `boxWhite`
//                      repeats the review's box measure (body box ±45 px, ground included), `boxWhiteNoVfx` the same
//                      with the VFX pass off; done (W1 verify combat:F4): boxWhite ≤ 0.35 on every beat frame
//             core     mean luma inside 0.5 × the lift radius over the same circle after everything faded (the median of 5
//                      frames once only what the frame before the cast held is alive; report: baseCore; the review's
//                      measure) and the same with the victim's box left out (ground only); done: ≥ 2.3 on the first
//                      beat (r12 M13 2.3-2.5×); ×2.0 where the lifted ground reaches the ≈ 218 clip (owner ruling 10:
//                      the beat's core at the clip, or its unlifted core × 2.3 past it)
//   cc      combat F5. Each hard CC kind is put on one fighter in a row (applyStatus), the frame is shot; the label
//           draw must carry one CC plate per fighter, and the plate's alpha must be 0 → 1 over 70 ms.
//   flash   combat m-3. Tunlan's 9 m cone and Burdam's 7 m circle land on the viewer: on the landing-flash frames the
//           telegraph layer's alpha is read at the shape's middle (axis 50 % / centre ring 25 %), just inside the
//           edge and on the inner contour; done: middle ≤ 0.22 (56/255), edge band ≥ 0.45.
//   hold    combat m-1. Kemdo (heavy), Rishal (light) and Tunlan's shot (magic) basic-attack the viewer; from the hit
//           event, the pixels the VFX pass adds inside the victim box (luma delta ≥ 0.08) are counted every frame for
//           12 frames (30 Hz), with the lit region's reach (2 × the 90th-percentile distance from its centroid) over the
//           victim's art height. `sizeMs` = how long the reach stays ≥ 0.5; done: ≥ 200 ms (r12 M5: ≈ 0.7 × victim
//           height for ≈ 200 ms). `eqd` the lit area as a disc's diameter over the victim's height; polish C3: the done
//           gate is `discMs` (eqd ≥ 0.5 from the hit) ≥ 167 ms, `sizeMs` (reach, noisy) is info; `readMs` how long the
//           count stays ≥ 25 % of its peak.
//
//             detail   the eye note (CW1 round 3, combat:beat-readability-eye): does the struck unit keep its inside? The luma
//                      spread (stddev) over the body's pixels with everything on, over the same spread with no lift, flash
//                      or VFX: `detail` 1 = as drawn, 0 = a flat silhouette. `detailLost` counts the frames under 0.5; done:
//                      at most 2 (a beat may blink, a body that stays flat is a readability bug).
//           --q low runs the section on that preset (screen coordinates are mapped to its smaller buffer); --slot a3 casts that
//           slot, measures the body on every frame of the window, and leaves out the ult-only core and anchor gates (--every: an ult too,
//           every frame, not only the beats).
//   clutter orch1 VFX-O1 (W1-D; measured here, ENFORCED by W2-B). A whole bot match (10 fighters) on RIFT/High at the game camera is scanned
//           from --t0 (default 720 s) for looks (3 sim frames apart) with >= 4 fighters of each side within 14 m of one fighter; every such
//           look (up to --frames 30 a seed, ranked by VFX load) is measured on the live frame: per visible on-screen fighter its BODY (the
//           skinned meshes alone into an empty target) share of pixels the VFX pass changes (VFX draw + telegraph layer off vs on; changed =
//           luma delta > 24/255 or chroma delta > 40/255) = `occlusion`; whether the local fighter's ground ring is found (ring mesh off vs
//           on: >= 60 changed pixels around its feet) = `selfRing`; the telegraph edge contrast (telegraph layer off vs on, the 90th
//           percentile of |dL| / max(L, 16) over the changed pixels) = `teleEdge`; screen particles vs the preset's budget. If a seed finds
//           fewer than 30 natural looks, the 10 fighters are moved into one arena (5 a side, 5 m apart) and the scan goes on (`scripted`).
//           Bars (W2-B): median occlusion <= 0.25, no fighter above 0.60 for more than 300 ms, teleEdge >= 0.45, selfRing 100 %.
//           node _harness/probe_combat_polish.mjs clutter [--seeds 7,11,23] [--frames 30] [--t0 720] [--scan 4500] [--tag <name>] [--out <json>]
//           -> _design/reviews/orch1/evidence/clutter/clutter[_tag].json (exit 0 whatever the bars say; `bars.pass` carries the verdict)
//   node _harness/probe_combat_polish.mjs [ult,cc,flash,hold] [--before <vfx.json>] [--tag <name>] [--ults kemdo,rishal,tunlan,hesmi | all] [--q high|low] [--slot ult]
//   (--ults all: the 16 fighters, critic combat-16; a fighter outside the first lineup's enemy side is cast from a lineup of its own)
//                                         [--vfxcap off|1.3]   (renderer.vfx.liftCap: the most the envelope lifts an effect)
//   → _harness/_reports/fw_W1_combat_polish[_tag].json, shots _harness/_shots/fw_W1_polish_*.png
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, '_shots'), REPS = join(HERE, '_reports');
mkdirSync(SHOTS, { recursive: true }); mkdirSync(REPS, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const ONLY = (args[0] && !args[0].startsWith('--') ? args[0] : 'ult,cc,flash,hold').split(',');
const BEFORE = opt('before', ''), TAG = opt('tag', BEFORE ? 'before' : '');
const OUT = join(REPS, `fw_W1_combat_polish${TAG ? '_' + TAG : ''}.json`);
const strip = (v) => (Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('$')).map(([k, x]) => [k, strip(x)])) : v);
const defs = strip(JSON.parse(readFileSync(BEFORE || join(HERE, '../content/vfx.json'), 'utf8')));
/** owner ruling 10: the post-grade luma clip the lifted ground stops at (the first-beat core target drops to ×2.0 there) */
const CORE_CLIP = 218;
const LINEUP = ['lisvel', 'ardit', 'dunsom', 'ilsheta', 'odrum', 'kemdo', 'tunlan', 'hesmi', 'rishal', 'burdam'];
const SELF_ULT = new Set(readdirSync(join(HERE, '../content/fighters')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(HERE, '../content/fighters', f), 'utf8')))
  .filter((f) => { const fx = (f.kit?.ult?.effects ?? []).filter((e) => e.op === 'area' || e.op === 'zone'); return fx.length > 0 && fx.every((e) => e.at === 'self'); }).map((f) => f.id));
const ALL = readdirSync(join(HERE, '../content/fighters')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();


const QUALITY = opt('q', 'high');
// ---------------------------------------------------------------------------------------------- clutter (orch1 VFX-O1, W1-D)
async function clutterMain() {
  const SEEDS = opt('seeds', '7,11,23').split(',').map(Number), WANT = Number(opt('frames', 30)), T0 = Number(opt('t0', 720)), SCAN = Number(opt('scan', 4500));
  // W2-B: --shots <dir> saves the full frame (and the same frame with the VFX pass off) of the looks listed by --shot-at (default 0,10,20)
  const SHOTS = opt('shots', ''), SHOT_AT = opt('shot-at', '0,10,20').split(',').map(Number);
  const outDir = join(HERE, '..', '_design', 'reviews', 'orch1', 'evidence', 'clutter'); mkdirSync(outDir, { recursive: true });
  const res = { gate: 'clutter', at: new Date().toISOString(), quality: QUALITY, t0: T0, scan: SCAN, bars: { medianOcclusion: 0.25, worstRunMs: 300, worstRunOcclusion: 0.6, teleEdge: 0.45, selfRing: 1, hotBody: 0.3, vfxTris: 35000, draws: 450 }, seeds: [] };
  for (const seed of SEEDS) {
    const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=rift&q=${QUALITY}&t=${T0}&seed=${seed}&dev=1&hud=0&manual=1`, { wait: false, hmr: false });
    try {
      await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
      const err = await page.evaluate(() => window.__VALE_BENCH__?.error ?? null); if (err) throw new Error(err);
      await page.waitForTimeout(6000);                                                  // models, textures, shader warm-up
      const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
      for (let i = 0; i < 60 && (await B((b) => b.renderer.lib?.pending ?? 0)) > 0; i++) await page.waitForTimeout(1000);
      // W2-B: measure the defs on disk (content/vfx.json; --before <file> for an A/B), as every other section does
      await B(async (b, d) => { const { VfxDef } = await import('/src/contracts/catalog.ts'); b.renderer.vfx.redefine(d.map((x) => VfxDef.parse(x))); }, defs);
      await B((b) => { b.frames(30, 1 / 30); b.follow(); });
      const out = await page.evaluate(async ([want, scan, q, shots]) => {
        const b = window.__VALE_BENCH__, R = b.renderer, host = b.host, canvas = document.getElementById('c');
        window.__clutterShots = [];
        const gl = R.gl.getContext();
        const budget = { low: 700, medium: 900, high: 2000, ultra: 2500 }[q] ?? 2000;
        const luma = (px, o) => 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
        const chroma = (px, o) => Math.max(px[o], px[o + 1], px[o + 2]) - Math.min(px[o], px[o + 1], px[o + 2]);
        // display L* from the sRGB frame: relative luminance Y over the linearised channels; L* 85 <=> Y 0.660
        const LIN = new Float32Array(256); for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
        const Y = (px, o) => 0.2126 * LIN[px[o]] + 0.7152 * LIN[px[o + 1]] + 0.0722 * LIN[px[o + 2]];
        const HOT_Y = ((85 + 16) / 116) ** 3;
        // --shots: the look's full frame as a PNG (the read-back pixels, flipped to screen order)
        const png = (fr) => { const c = document.createElement('canvas'); c.width = fr.W; c.height = fr.H; const x = c.getContext('2d'), im = x.createImageData(fr.W, fr.H);
          for (let y = 0; y < fr.H; y++) im.data.set(fr.px.subarray((fr.H - 1 - y) * fr.W * 4, (fr.H - y) * fr.W * 4), y * fr.W * 4);
          for (let i = 3; i < im.data.length; i += 4) im.data[i] = 255; x.putImageData(im, 0, 0); return c.toDataURL('image/png').split(',')[1]; };
        const grab = () => { R.render(0); const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, px = new Uint8Array(W * H * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return { px, W, H }; };
        const bodyMask = (a, W, H) => {
          const skip = []; a.root.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh) { skip.push([o, o.layers.mask]); o.layers.disableAll(); } });
          for (const m of a.flashMeshes ?? []) m.traverse((o) => { skip.push([o, o.layers.mask]); o.layers.disableAll(); });
          const RT = new (R.overlay.teleTarget.constructor)(W, H), g = R.gl, mask = new Uint8Array(W * H * 4);
          const cc = g.getClearColor(new (R.tmpColor.constructor)()), ca = g.getClearAlpha(), ac = g.autoClear;
          try { g.setRenderTarget(RT); g.setClearColor(0x000000, 0); g.clear(true, true, false); g.autoClear = false; g.render(a.root, R.rig.camera); g.readRenderTargetPixels(RT, 0, 0, W, H, mask); }
          finally { g.setRenderTarget(null); g.setClearColor(cc, ca); g.autoClear = ac; for (const [o, m] of skip) o.layers.mask = m; RT.dispose(); }
          return mask;
        };
        const measure = async () => {
          const v = host.view, W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, st = R.stats();
          // W2-B (VFX-O10): this frame's VFX triangles and the whole frame's draws / triangles (the renderer's profile hook)
          let prof = null; if (b.profile) { const pp = b.profile(); R.render(0); prof = await pp; }
          const full = grab();
          const dv = R.vfx.draw, tv = R.overlay.teleScene.visible;
          R.vfx.draw = () => {}; R.overlay.teleScene.visible = false;
          const noFx = grab();
          R.vfx.draw = dv; R.overlay.teleScene.visible = tv;
          // telegraph alone off
          const tMask = R.teles.mesh.layers.mask; R.overlay.teleScene.visible = false; R.teles.mesh.layers.disableAll(); const noTele = grab(); R.teles.mesh.layers.mask = tMask; R.overlay.teleScene.visible = tv;
          // the renderer rewrites .visible every frame: hide the ring layer through the layers mask
          const ringMask = R.rings.mesh.layers.mask; R.rings.mesh.layers.disableAll(); const noRing = grab(); R.rings.mesh.layers.mask = ringMask;
          R.render(0);
          const me = v.players.find((p) => p.player === 0), meE = me ? v.entity(me.entity) : null;
          const fighters = [];
          for (const f of v.entities.filter((e) => e.kind === 'fighter' && e.alive)) {
            const a = R.actors.get(f.id); if (!a || !a.model || !a.root.visible) continue;
            const sc = b.screen(f.x, f.y, 1.0); if (sc.x < 0 || sc.x > 1920 || sc.y < 0 || sc.y > 1080) continue;
            const mask = bodyMask(a, W, H);
            let n = 0, ch = 0, hot = 0;
            for (let o = 0; o < W * H * 4; o += 4) {
              if (mask[o + 3] < 128) continue; n++;
              if (Math.abs(luma(full.px, o) - luma(noFx.px, o)) > 24 || Math.abs(chroma(full.px, o) - chroma(noFx.px, o)) > 40) ch++;
              // W2-B (GFX-3): VFX at display L* > 85 over the body (the pixel is that bright with the VFX and was not without)
              if (Y(full.px, o) > HOT_Y && Y(noFx.px, o) <= HOT_Y) hot++;
            }
            // which effects sit on a body that goes hot (W2-B diagnosis): live instances within 1.6 m of it
            let near = undefined;
            if (n >= 200 && hot / n > 0.3) near = R.vfx.insts.filter((it) => it.active && Math.hypot((it.following ? it.head : it.target).x - f.x, (it.following ? it.head : it.target).z - f.y) < 1.6)
              .map((it) => `${it.def.id}:T${it.tier}:${it.t.toFixed(2)}`);
            if (n >= 200) fighters.push({ id: f.id, def: f.def, team: f.team, bodyPx: n, occlusion: +(ch / n).toFixed(3), hot: +(hot / n).toFixed(3), me: f.id === meE?.id, ...(near ? { near } : {}) });
          }
          // self ring: pixels the ring mesh changes around the local fighter's feet
          let selfRing = null;
          if (meE && meE.alive) {
            const g0 = b.screen(meE.x, meE.y, 0), k = W / 1920, R0 = Math.round(110 * k), cx = Math.round(g0.x * k), cy = Math.round(g0.y * k);
            let n = 0;
            for (let y = Math.max(0, cy - R0); y < Math.min(H, cy + R0); y++) for (let x = Math.max(0, cx - R0); x < Math.min(W, cx + R0); x++) {
              const o = ((H - 1 - y) * W + x) * 4; if (Math.abs(luma(full.px, o) - luma(noRing.px, o)) > 12) n++;
            }
            selfRing = { px: n, found: n >= 60 };
          }
          // telegraph edge contrast over the pixels the telegraph layer changes
          let teleEdge = null;
          if ((st.telegraphs ?? 0) > 0) {
            const d = [];
            for (let o = 0; o < W * H * 4; o += 4 * 2) { const a = luma(full.px, o), c = luma(noTele.px, o); const dd = Math.abs(a - c) / Math.max(c, a, 16); if (dd > 0.04) d.push(dd); }
            d.sort((x, y) => x - y);
            teleEdge = { px: d.length, p90: d.length ? +d[Math.floor(d.length * 0.9)].toFixed(3) : 0, n: st.telegraphs };
            // W2-B: the bar reads the ENEMY telegraphs alone (ally outlines, own aim and zone outlines left out, as the bar names
            // them): the director's list held to the viewer's enemies for the on / off pair, the same p90 over their pixels
            const T = R.director.telegraphs, keep = T.slice(), vt = R.palette.viewer.team;
            const foe = keep.filter((x) => vt >= 0 && x.team !== vt && x.team >= 0 && !x.heal);
            if (foe.length) {
              T.length = 0; T.push(...foe);
              const eOn = grab(); R.overlay.teleScene.visible = false; R.teles.mesh.layers.disableAll(); const eOff = grab(); R.teles.mesh.layers.mask = tMask; R.overlay.teleScene.visible = tv;
              // the same pair with the VFX pass off: how much of the edge the effects under it take (info)
              R.vfx.draw = () => {};
              const xOn = grab(); R.overlay.teleScene.visible = false; R.teles.mesh.layers.disableAll(); const xOff = grab(); R.teles.mesh.layers.mask = tMask; R.overlay.teleScene.visible = tv;
              R.vfx.draw = dv;
              T.length = 0; T.push(...keep);
              const x = [];
              for (let o = 0; o < W * H * 4; o += 4 * 2) { const a = luma(xOn.px, o), c = luma(xOff.px, o); const dd = Math.abs(a - c) / Math.max(c, a, 16); if (dd > 0.04) x.push(dd); }
              x.sort((p, q) => p - q);
              const e = [];
              for (let o = 0; o < W * H * 4; o += 4 * 2) { const a = luma(eOn.px, o), c = luma(eOff.px, o); const dd = Math.abs(a - c) / Math.max(c, a, 16); if (dd > 0.04) e.push(dd); }
              e.sort((x, y) => x - y);
              // W2-B fix 1 (info, not a bar): the same contrast over the shapes' BOUNDARY alone (changed pixels within 6 px of an
              // unchanged one, VFX on): what the edge and its ink band read once the interior fill (renderer.ts: 0.16 for a
              // zone) is left out, so the gate's p90 can be told apart into edge vs fill
              const cm = new Uint8Array(W * H), dv2 = new Float32Array(W * H);
              for (let i = 0, o = 0; i < W * H; i++, o += 4) { const a = luma(eOn.px, o), c = luma(eOff.px, o); const dd = Math.abs(a - c) / Math.max(c, a, 16); if (dd > 0.04) { cm[i] = 1; dv2[i] = dd; } }
              const eb = [], R6 = 6;
              for (let yy = R6; yy < H - R6; yy += 2) for (let xx = R6; xx < W - R6; xx += 2) {
                const i = yy * W + xx; if (!cm[i]) continue;
                if (!cm[i - R6] || !cm[i + R6] || !cm[i - R6 * W] || !cm[i + R6 * W]) eb.push(dv2[i]);
              }
              eb.sort((p, q) => p - q);
              teleEdge.enemy = { px: e.length, p90: e.length ? +e[Math.floor(e.length * 0.9)].toFixed(3) : 0, n: foe.length, p90NoFx: x.length ? +x[Math.floor(x.length * 0.9)].toFixed(3) : 0,
                boundaryPx: eb.length, p90Boundary: eb.length ? +eb[Math.floor(eb.length * 0.9)].toFixed(3) : 0, medBoundary: eb.length ? +eb[Math.floor(eb.length * 0.5)].toFixed(3) : 0 };
            }
            R.render(0);
          }
          return { fighters, selfRing, teleEdge, particles: st.particles, vfx: st.vfx, telegraphs: st.telegraphs, particleBudget: budget, tris: prof?.total?.tris ?? st.triangles, vfxTris: prof?.groups?.vfx?.tris ?? null, vfxCalls: prof?.groups?.vfx?.calls ?? null, draws: prof?.total?.calls ?? st.calls, programs: st.programs, $png: shotNow ? png(full) : null, $pngNoFx: shotNow ? png(noFx) : null };
        };
        let shotNow = false;
        const looks = []; let step = 0;
        const consider = () => {
          const v = host.view, fs = v.entities.filter((e) => e.kind === 'fighter' && e.alive);
          let best = null;
          for (const f of fs) {
            const near = fs.filter((e) => Math.hypot(e.x - f.x, e.y - f.y) < 14), a = near.filter((e) => e.team === 0).length, c = near.filter((e) => e.team === 1).length;
            if (a < 4 || c < 4) continue;
            const x = near.reduce((s, e) => s + e.x, 0) / near.length, y = near.reduce((s, e) => s + e.y, 0) / near.length;
            if (!best || a + c > best.a + best.c) best = { a, c, x, y };
          }
          return best;
        };
        const placeArena = () => { // scripted: 5 a side in one arena on the mid lane, 5 m apart (bots fight from there)
          const v = host.view; const x0 = 85, y0 = 55; let i0 = 0, i1 = 0;
          for (const f of v.entities.filter((e) => e.kind === 'fighter')) { const t = f.team === 0 ? i0++ : i1++; f.x = x0 + (f.team === 0 ? -2.5 : 2.5) + (t % 2) * 0.6; f.y = y0 + (t - 2) * 1.6; f.vx = f.vy = 0; if (!f.alive) { f.alive = true; f.hp = f.maxHp; } }
          v.hashDirty = true;
        };
        let scripted = false, natural = 0;
        const t0 = performance.now();
        for (let i = 0; i < scan * 2 && looks.length < want; i += 3) {
          if (i === scan && !scripted && looks.length < want) { scripted = true; placeArena(); }
          if (scripted && i % 900 === 0) placeArena();
          b.frames(3, 1 / 30);
          const c = consider(); if (!c) continue;
          shotNow = shots.includes(looks.length);
          const m = await measure();
          const t = +host.view.time.toFixed(2);
          if (m.$png) window.__clutterShots.push({ i: looks.length, t, png: m.$png, noFx: m.$pngNoFx });
          delete m.$png; delete m.$pngNoFx;
          looks.push({ t, a: c.a, c: c.c, scripted, ...m });
          if (!scripted) natural++;
          b.focus(c.x, c.y);
          if (performance.now() - t0 > 900000) break;
        }
        return { looks, natural, scripted, secs: Math.round((performance.now() - t0) / 1000) };
      }, [WANT, SCAN, QUALITY, SHOTS ? SHOT_AT : []]);
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        for (const sh of await page.evaluate(() => window.__clutterShots)) {
          writeFileSync(join(SHOTS, `clutter_s${seed}_look${String(sh.i).padStart(2, '0')}_t${Math.round(sh.t * 10)}.png`), Buffer.from(sh.png, 'base64'));
          writeFileSync(join(SHOTS, `clutter_s${seed}_look${String(sh.i).padStart(2, '0')}_t${Math.round(sh.t * 10)}_nofx.png`), Buffer.from(sh.noFx, 'base64'));
        }
      }
      // aggregate
      const med = (v) => { const a = [...v].sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };
      const occ = out.looks.flatMap((l) => l.fighters.map((f) => f.occlusion));
      const byFighter = new Map();
      for (const l of out.looks) for (const f of l.fighters) { const r = byFighter.get(f.id) ?? []; r.push({ t: l.t, o: f.occlusion, def: f.def }); byFighter.set(f.id, r); }
      let worst = { ms: 0, id: null, def: null };
      for (const [id, r] of byFighter) {
        let run = 0, start = 0;
        for (let i = 0; i < r.length; i++) {
          if (r[i].o > res.bars.worstRunOcclusion) { if (!run) start = r[i].t; run++; const ms = Math.round((r[i].t - start) * 1000) + 100; if (ms > worst.ms) worst = { ms, id, def: r[i].def }; } else run = 0;
        }
      }
      const rings = out.looks.map((l) => l.selfRing).filter(Boolean), teles = out.looks.map((l) => l.teleEdge).filter(Boolean);
      const hots = out.looks.flatMap((l) => l.fighters.map((f) => ({ hot: f.hot ?? 0, def: f.def, t: l.t }))).sort((x, y) => y.hot - x.hot);
      const num = (k) => out.looks.map((l) => l[k]).filter((x) => typeof x === 'number');
      const peaks = out.looks.map((l) => l.particles);
      const s = {
        seed, peakFrames4v4: out.looks.length, naturalPeakFrames: out.natural, scriptedPeakFrames: out.looks.length - out.natural, scanSeconds: out.secs,
        looksWithSides: { minA: Math.min(...out.looks.map((l) => l.a)), minC: Math.min(...out.looks.map((l) => l.c)) },
        medianOcclusion: med(occ), p90Occlusion: occ.length ? [...occ].sort((x, y) => x - y)[Math.floor(occ.length * 0.9)] : null, fighterSamples: occ.length,
        worstFighterRun: worst, selfRing: { frames: rings.length, found: rings.filter((r) => r.found).length, rate: rings.length ? +(rings.filter((r) => r.found).length / rings.length).toFixed(3) : null },
        teleEdge: { frames: teles.length, medianP90: med(teles.map((t) => t.p90)), enemyFrames: teles.filter((t) => t.enemy).length, enemyMedianP90: med(teles.filter((t) => t.enemy).map((t) => t.enemy.p90)), enemyMedianP90NoFx: med(teles.filter((t) => t.enemy).map((t) => t.enemy.p90NoFx)), enemyMedianP90Boundary: med(teles.filter((t) => t.enemy).map((t) => t.enemy.p90Boundary)) },
        particles: { peak: Math.max(0, ...peaks), median: med(peaks), budget: out.looks[0]?.particleBudget ?? null, overBudgetFrames: out.looks.filter((l) => l.particles > l.particleBudget).length },
        hotBody: { max: hots[0]?.hot ?? null, worst: hots[0] ?? null, median: med(hots.map((h) => h.hot)), over30: hots.filter((h) => h.hot > 0.3).length },
        frame: { vfxTrisPeak: Math.max(0, ...num('vfxTris')), vfxTrisMedian: med(num('vfxTris')), trisPeak: Math.max(0, ...num('tris')), drawsPeak: Math.max(0, ...num('draws')), programsPeak: Math.max(0, ...num('programs')) },
        consoleErrors: logs.filter((l) => !/favicon/.test(l)).slice(0, 5), looks: out.looks,
      };
      res.seeds.push(s);
      console.log(`clutter seed ${seed}: ${s.peakFrames4v4} peak frames (${s.naturalPeakFrames} natural), median occlusion ${s.medianOcclusion}, worst run ${s.worstFighterRun.ms} ms (${s.worstFighterRun.def}), self ring ${s.selfRing.found}/${s.selfRing.frames}, tele edge p90 ${s.teleEdge.medianP90} (enemy ${s.teleEdge.enemyMedianP90} over ${s.teleEdge.enemyFrames}, with no VFX ${s.teleEdge.enemyMedianP90NoFx}, boundary only ${s.teleEdge.enemyMedianP90Boundary}), particles peak ${s.particles.peak}/${s.particles.budget}, hot body max ${s.hotBody.max} (${s.hotBody.worst?.def}), vfx tris peak ${s.frame.vfxTrisPeak}, draws peak ${s.frame.drawsPeak}, programs ${s.frame.programsPeak}`);
    } finally { await browser.close(); }
  }
  const okSeeds = res.seeds.filter((s) => s.peakFrames4v4 >= WANT).length;
  const all = (k) => res.seeds.map((s) => k(s)).filter((v) => v !== null && v !== undefined);
  res.summary = { seedsWith30PeakFrames: okSeeds, medianOcclusion: all((s) => s.medianOcclusion).length ? Math.max(...all((s) => s.medianOcclusion)) : null, worstRunMs: Math.max(0, ...res.seeds.map((s) => s.worstFighterRun.ms)), teleEdge: all((s) => s.teleEdge.enemyMedianP90).length ? Math.min(...all((s) => s.teleEdge.enemyMedianP90)) : null, teleEdgeAll: all((s) => s.teleEdge.medianP90).length ? Math.min(...all((s) => s.teleEdge.medianP90)) : null, selfRingRate: all((s) => s.selfRing.rate).length ? Math.min(...all((s) => s.selfRing.rate)) : null, particlesPeak: Math.max(0, ...res.seeds.map((s) => s.particles.peak)),
    hotBodyMax: Math.max(0, ...res.seeds.map((s) => s.hotBody.max ?? 0)), vfxTrisPeak: Math.max(0, ...res.seeds.map((s) => s.frame.vfxTrisPeak)), trisPeak: Math.max(0, ...res.seeds.map((s) => s.frame.trisPeak)),
    drawsPeak: Math.max(0, ...res.seeds.map((s) => s.frame.drawsPeak)), programsPeak: Math.max(0, ...res.seeds.map((s) => s.frame.programsPeak)) };
  res.bars.pass = { scan: okSeeds >= 2, medianOcclusion: res.summary.medianOcclusion !== null && res.summary.medianOcclusion <= res.bars.medianOcclusion, worstRun: res.summary.worstRunMs <= res.bars.worstRunMs, teleEdge: res.summary.teleEdge !== null && res.summary.teleEdge >= res.bars.teleEdge, selfRing: res.summary.selfRingRate === 1,
    hotBody: res.summary.hotBodyMax <= res.bars.hotBody, vfxTris: res.summary.vfxTrisPeak <= res.bars.vfxTris, draws: res.summary.drawsPeak <= res.bars.draws };
  res.bars.enforcedBy = 'W2-B';
  res.load1 = (await import('node:os')).loadavg()[0];
  const tag = opt('tag', '');
  const outFile = opt('out', join(outDir, `clutter${tag ? '_' + tag : ''}.json`));
  writeFileSync(outFile, JSON.stringify(res, null, 1));
  console.log(`clutter: ${okSeeds}/${SEEDS.length} seeds with ${WANT} peak frames; summary ${JSON.stringify(res.summary)}; bars ${JSON.stringify(res.bars.pass)} -> ${outFile}`);
  process.exit(okSeeds >= 2 ? 0 : 1);
}
// ---------------------------------------------------------------------------------------------- death (orch1 VFX-O4, W2-B)
//   death   a REAL kill on RIFT/High (seed 7, spectator, fog off): seat 0's fighter basic-attacks an enemy fighter left at a sliver of
//           health (the kill comes through the sim's own attack path, not dealDamage from page script); both drivers are removed so
//           nobody walks off. The director's events and fired defs are logged; from the death event's frame the victim's clip role, clip
//           time, head height (its head socket) and the frame are taken at 0 / 0.1 / 0.2 / 0.3 / 0.5 / 0.8 / 1.2 s.
//           done: the fighter death def (vfxEvents.death) fires on the death frame; the clip role is 'death' on the death frame and the
//           head has dropped >= 25 % of its standing height by 0.5 s.
//           node _harness/probe_combat_polish.mjs death [--shots <dir>] [--seed 7] [--tag <name>]
async function deathMain() {
  const SEED = Number(opt('seed', 7)), SHOTS = opt('shots', '');
  const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=rift&q=${QUALITY}&t=420&seed=${SEED}&dev=1&hud=0&manual=1`, { wait: false, hmr: false });
  const res = { gate: 'death', at: new Date().toISOString(), seed: SEED, quality: QUALITY };
  try {
    await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
    const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
    await page.waitForTimeout(4000);
    for (let i = 0; i < 60 && (await B((b) => b.renderer.lib?.pending ?? 0)) > 0; i++) await page.waitForTimeout(1000);
    await B(async (b, d) => { const { VfxDef } = await import('/src/contracts/catalog.ts'); b.renderer.vfx.redefine(d.map((x) => VfxDef.parse(x))); }, defs);
    const setup = await B((b) => {
      const R = b.renderer, v = b.host.view;
      R.palette.viewer.team = -1; R.fog.enabled = false; R.rig.spectator = true;
      const me = v.entity(v.players.find((p) => p.player === 0).entity);
      for (let i = 0; i < 600 && !me.alive; i++) b.frames(1, 1 / 30);
      const foeP = v.players.find((p) => v.entity(p.entity)?.team !== me.team && v.entity(p.entity)?.alive);
      const foe = v.entity(foeP.entity);
      b.host.drivers.delete(0); b.host.drivers.delete(foeP.player);
      const x = 60, y = 55;
      me.x = x; me.y = y; me.vx = me.vy = 0; me.hp = me.maxHp;
      foe.x = x + 1.6; foe.y = y; foe.vx = foe.vy = 0; foe.hp = Math.max(1, foe.maxHp * 0.02); foe.shields = [];
      v.hashDirty = true;
      b.zoom(b.catalog.maps.find((q) => q.id === b.host.setup.map).camera.distance); b.focus(x + 0.8, y);
      // the logs: director events (death) and fired defs
      const d = R.director, fire = d.fire.bind(d), handle = d.handle.bind(d);
      b.__fired = []; b.__deaths = [];
      d.fire = (id, src, tier, o) => { const h = fire(id, src, tier, o); b.__fired.push({ id: id ?? null, h, t: +v.time.toFixed(3), src, tier }); return h; };
      d.handle = (evs) => { for (const e of evs) if (e.e === 'death') b.__deaths.push({ ...e, at: +v.time.toFixed(3) }); return handle(evs); };
      b.frames(2, 1 / 30);
      return { me: me.id, meDef: me.def, foe: foe.id, foeDef: foe.def, foeHp: foe.hp };
    });
    res.setup = setup;
    // the victim's state per frame
    const probe = () => B((b, id) => {
      const R = b.renderer, a = R.actors.get(id), e = b.host.view.entity(id);
      const hp = { x: 0, y: 0, z: 0 }; let head = null;
      try { const V = R.rig.camera.position.constructor; const out = new V(); if (R.vfx.world.socketPos?.(id, 'head', out)) head = +out.y.toFixed(3); } catch { /* none */ }
      return { t: +b.host.view.time.toFixed(3), alive: e?.alive ?? null, state: e?.state ?? null, role: a?.currentKey ?? null, clipT: a?.current ? +a.current.time.toFixed(3) : null, head };
    }, setup.foe);
    const stand = await probe();
    res.standing = stand;
    await B((b, p) => b.host.sim.command(0, { type: 'attack', target: p.foe }), setup);
    let deathFrame = null; const pre = [];
    for (let i = 0; i < 240; i++) {
      await B((b) => b.frames(1, 1 / 30));
      const d = await B((b) => b.__deaths.length);
      pre.push(await probe());
      if (d > 0) { deathFrame = i; break; }
    }
    res.deaths = await B((b) => b.__deaths);
    if (deathFrame === null) throw new Error('no death event in 8 s');
    const AT = [0, 0.1, 0.2, 0.3, 0.5, 0.8, 1.2];
    const frames = []; let el = 0;
    for (const at of AT) {
      const n = Math.round((at - el) * 30); if (n > 0) await B((b, n) => b.frames(n, 1 / 30), n); el = at;
      const st = await probe();
      const png = await B((b) => { b.renderer.render(0); return document.getElementById('c').toDataURL('image/png').split(',')[1]; });
      if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); writeFileSync(join(SHOTS, `death_${setup.foeDef}_${String(Math.round(at * 10)).padStart(2, '0')}.png`), Buffer.from(png, 'base64')); }
      frames.push({ at, ...st, drop: stand.head && st.head ? +(1 - st.head / stand.head).toFixed(3) : null });
    }
    const dt = res.deaths[0].at;
    res.fired = (await B((b) => b.__fired)).filter((f) => f.t >= dt - 0.05 && f.t <= dt + 0.2);
    res.frames = frames; res.preDeath = pre.slice(-3);
    const deathDef = JSON.parse(readFileSync(join(HERE, '../content/client.json'), 'utf8')).vfxEvents.death;
    const firedDeath = res.fired.find((f) => f.id === deathDef && f.src === setup.foe);
    res.done = {
      deathVfxOnDeathFrame: !!firedDeath && Math.abs(firedDeath.t - dt) < 0.001,
      roleDeathOnDeathFrame: frames[0].role === 'death',
      headDrop05: frames.find((f) => f.at === 0.5)?.drop ?? null,
    };
    res.done.pass = res.done.deathVfxOnDeathFrame && res.done.roleDeathOnDeathFrame && (res.done.headDrop05 ?? 0) >= 0.25;
    res.consoleErrors = logs.filter((l) => !/favicon/.test(l)).slice(0, 5);
  } finally { await browser.close(); }
  const out = opt('out', join(REPS, `w2b_death${TAG ? '_' + TAG : ''}.json`));
  writeFileSync(out, JSON.stringify(res, null, 1));
  console.log(`death: ${res.setup?.meDef} kills ${res.setup?.foeDef}; fired ${JSON.stringify(res.fired?.map((f) => f.id))}; frames ${JSON.stringify(res.frames?.map((f) => [f.at, f.role, f.clipT, f.head, f.drop]))}; done ${JSON.stringify(res.done)} -> ${out}`);
  process.exit(0);
}
// ---------------------------------------------------------------------------------------------- dust (orch1 VFX-O6 / O7, W2-B)
//   dust    an A/B sheet of the defs that lost their ink puffs (Wick death, hit backings, silence / summon specks, Hesmi's shadow, the
//           heavy hit's crack): each def fired by renderer.vfxTest at a lane spot on RIFT/High at the game camera with the --before defs
//           (row A) and the defs on disk (row B), cropped at 0.1 / 0.25 / 0.45 s.
//           node _harness/probe_combat_polish.mjs dust --before <old vfx.json> [--out <png>] [--ids a,b,c]
async function dustMain() {
  const sharp = (await import('sharp')).default;
  const IDS = opt('ids', 'lib_wick_death,lib_hit_phys_light,lib_hit_phys_heavy,lib_hit_magic,lib_silence,lib_summon_rise,hesmi_ult_shadow,lib_status_stun,lib_status_root,lib_status_fear').split(',');
  const TIMES = [0.1, 0.25, 0.45], CW = 360, CH = 300;
  const after = strip(JSON.parse(readFileSync(join(HERE, '../content/vfx.json'), 'utf8')));
  const { browser, page } = await open(`/_harness/web/render_bench.html?mode=rift&q=high&t=1&dev=1&hud=0&manual=1`, { wait: false, hmr: false });
  const tiles = [];
  try {
    await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
    const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
    await B((b) => b.frames(30, 1 / 30));
    const spot = { x: 60, y: 55 };
    for (const [row, set] of [['A', defs], ['B', after]]) {
      await B(async (b, d) => { const { VfxDef } = await import('/src/contracts/catalog.ts'); b.renderer.vfx.redefine(d.map((x) => VfxDef.parse(x))); }, set);
      for (const id of IDS) {
        await B((b, s) => { b.renderer.vfx.clear(); b.focus(s.x, s.y); b.zoom(b.catalog.maps.find((q) => q.id === b.host.setup.map).camera.distance); b.frames(10, 1 / 30); }, spot);
        // fix 1 (verifier r1: the hit rows were empty): vfxTest puts its target 6 m along `dir` unless `to` is given, so a
        // 'target' def fired off the tile; the target is the spot itself. A basic attack's hit fires as the director does: T1,
        // game scale (1)
        await B((b, a) => b.renderer.vfxTest(a.id, a.x, a.y, { to: [a.x, a.y], tier: a.id.includes('_ult_') ? 4 : a.id.startsWith('lib_hit_phys') ? 1 : 2, scale: a.id.startsWith('lib_hit_') ? 1 : undefined, anchor: 'target' }), { id, ...spot });
        let el = 0;
        for (const t of TIMES) {
          const n = Math.max(1, Math.round((t - el) * 30)); el = t;
          const png = await B((b, a) => { b.frames(a.n, 1 / 30); b.renderer.render(0); const c = document.getElementById('c'); const sc = b.screen(a.x, a.y, 0.8);
            const o = document.createElement('canvas'); o.width = a.cw; o.height = a.ch; o.getContext('2d').drawImage(c, sc.x - a.cw / 2, sc.y - a.ch / 2, a.cw, a.ch, 0, 0, a.cw, a.ch); return o.toDataURL('image/png').split(',')[1]; }, { n, ...spot, cw: CW, ch: CH });
          tiles.push({ row, id, t, buf: Buffer.from(png, 'base64') });
        }
      }
    }
  } finally { await browser.close(); }
  const W = CW * TIMES.length * 2, H = CH * IDS.length, comp = [];
  for (const tl of tiles) comp.push({ input: tl.buf, left: (tl.row === 'A' ? 0 : CW * TIMES.length) + TIMES.indexOf(tl.t) * CW, top: IDS.indexOf(tl.id) * CH });
  const labels = IDS.map((id, i) => `<text x="8" y="${i * CH + 22}" font-family="Helvetica" font-size="18" fill="#EDE6D6" stroke="#0B0D11" stroke-width="3" paint-order="stroke">${id}  A (before) | B (after) at ${TIMES.join(' / ')} s</text>`).join('');
  comp.push({ input: Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${labels}<line x1="${CW * TIMES.length}" y1="0" x2="${CW * TIMES.length}" y2="${H}" stroke="#F4EFE2" stroke-width="3"/></svg>`), left: 0, top: 0 });
  const out = opt('out', join(SHOTS, 'w2b_dust_ab.png'));
  await sharp({ create: { width: W, height: H, channels: 3, background: '#0B0D11' } }).composite(comp).jpeg({ quality: 90 }).toFile(out);
  console.log('dust A/B ->', out);
  process.exit(0);
}
if (ONLY.includes('dust')) await dustMain();
if (ONLY.includes('death')) await deathMain();
if (ONLY.includes('clutter')) await clutterMain();

const report = { at: new Date().toISOString(), defs: BEFORE || 'content/vfx.json', ult: [], cc: null, flash: [], hold: [], pass: true, fails: [] };
const fail = (m) => { report.pass = false; report.fails.push(m); console.log('FAIL', m); };

const SLOT = opt('slot', 'ult');
report.quality = QUALITY; report.slot = SLOT;
const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=rift&q=${QUALITY}&t=0&dev=1&hud=0&manual=1`, { wait: false, hmr: false });
try {
  await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
  const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
  await B(async (b, d) => { const { VfxDef } = await import('/src/contracts/catalog.ts'); b.renderer.vfx.redefine(d.map((x) => VfxDef.parse(x))); }, defs);
  if (opt('vfxcap', '')) await B((b, c) => { b.renderer.vfx.liftCap = c === 'off' ? null : Number(c); }, opt('vfxcap', ''));
  // W2-B A/B: --noprotect turns the character-protection rule off (with --before <old vfx.json>: the pre-W2-B look)
  if (args.includes('--noprotect')) await B((b) => { b.renderer.vfx.bodyProtect = false; });
  // the match host for a lineup (seat 0 the viewer, seats 5-9 its enemies); re-run for another lineup (--ults beyond them)
  const SETUP = async (b, picks) => {
    const { LocalMatchHost } = await import('/src/session/match_host.ts');
    const { createBots } = await import('/src/sim/bots/index.ts');
    // the SAME module instance the bench loaded when the timing buffer still lists it: after an edit the dev server serves
    // a changed file as `…?t=<stamp>`, and a bare import is a second instance (module state the bench never sees)
    const loaded = (path) => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => new URL(n).pathname === path).pop() ?? path;
    b.__st = await import(loaded('/src/sim/status.ts'));
    const cat = b.catalog, base = b.host.setup, R = b.renderer;
    // the envelope's uniforms as the renderer's own post chain holds them (the exposure effect's Uniform objects ARE
    // vfx/screen.ts screenUniforms of the instance the renderer runs)
    const expo = R.post.gradePass.effects.find((e) => e.name === 'ValeExposure');
    b.__U = { uLiftA: expo.uniforms.get('uLiftA'), uExpo: expo.uniforms.get('uExpo'), uBreath: expo.uniforms.get('uBreath') };
    const setup = { ...base, matchId: `polish-${picks.join('-')}`, seats: base.seats.map((s, i) => {
      const fighter = picks[i] || s.fighter;
      const skin = cat.skins.find((k) => k.fighter === fighter && k.tier === 'base')?.id ?? cat.skins.find((k) => k.fighter === fighter)?.id ?? '';
      return { ...s, fighter, skin };
    }) };
    const h = new LocalMatchHost(cat, setup, 0, { bots: createBots(cat, setup), autopilot: true, maxTimeScale: 16, pregameSeconds: 0 });
    h.start(); h.setTimeScale(16);
    let guard = 0; while (h.view.time < 420 && !h.ended && guard++ < 100000) h.pump(0.25);
    h.setTimeScale(1);
    await R.preload(setup);
    R.setScene(h);
    b.__H = h;
    const W = h.sim.world; b.__W = W;
    b.__muted = new Set(W.players.map((_, i) => i));
    const orig = W.command.bind(W); W.command = (p, c) => { if (b.__allow || !b.__muted.has(p)) orig(p, c); };
    try { h.drivers.clear(); } catch { /* none */ }
    b.__cmd = (p, c) => { b.__allow = true; try { h.sim.command(p, c); } finally { b.__allow = false; } };
    W.systems[8] = W.systems[8].filter((f) => f.name !== 'waveSystem' && f.name !== 'minionSystem');
    const m = cat.maps.find((x) => x.id === setup.map);
    b.__clear = () => { let n = 0; for (const e of W.entities) if ((e.kind === 'minion' || e.kind === 'monster') && e.alive) { const sp = m.bases[e.team]?.spawn ?? [5, 5]; e.x = sp[0] + (e.team ? -3 : 3) + (n % 5) * 0.4; e.y = sp[1] - 4 + (n % 7); e.vx = e.vy = 0; n++; } };
    b.__step = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) { h.pump(dt); R.render(dt); } };
    b.__prep = (id, x, y, face) => {
      const e = W.entity(id); if (!e) return false;
      if (!e.alive) { e.alive = true; e.hp = e.maxHp; }
      e.x = x; e.y = y; e.vx = 0; e.vy = 0; if (face !== undefined) e.facing = face;
      e.hp = e.maxHp; e.res = e.maxRes; e.shield = 0; e.statuses.length = 0; e.autoAttack = false;
      if (e.level < 13) e.level = 13;
      for (let i = 0; i < 4; i++) { const s = e.slots?.[i]; if (s) { s.rank = Math.max(s.rank, s.maxRank); s.cooldown = 0; if (s.maxCharges) s.charges = s.maxCharges; } }
      return true;
    };
    b.__park = () => { for (let p = 0; p < W.players.length; p++) b.__prep(W.players[p].entity, p < 5 ? 30 + p : 150, 40 + p); };
    b.__ev = [];
    h.onEvents((evs) => { for (const e of evs) b.__ev.push(JSON.parse(JSON.stringify(e))); });
    const gl = () => R.gl.getContext();
    b.__grab = () => { R.render(0); const c = gl(); const Wd = c.drawingBufferWidth, Hd = c.drawingBufferHeight; const px = new Uint8Array(Wd * Hd * 4); c.bindFramebuffer(c.FRAMEBUFFER, null); c.readPixels(0, 0, Wd, Hd, c.RGBA, c.UNSIGNED_BYTE, px); return { px, Wd, Hd }; };
    b.__h = (id) => { const a = R.actors.get(id); const e = h.view.entity(id); const x = a ? a.x : e.x, y = a ? a.y : e.y; const g = b.screen(x, y, 0), t = b.screen(x, y, a?.barHeight ?? 2.2), hd = b.screen(x, y, a?.artHeight ?? 1.9); return { gx: g.x, gy: g.y, ty: t.y, hy: hd.y }; };
    const luma = (r, g, bl) => 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    // screen coordinates are CSS px (b.screen, the 1920 canvas): k maps them to a preset's smaller buffer (Low's 0.75)
    const kOf = (g) => g.Wd / 1920;
    const boxK = (box, k) => ({ x0: box.x0 * k, y0: box.y0 * k, x1: box.x1 * k, y1: box.y1 * k });
    b.__white = (g, box0) => { const { px, Wd, Hd } = g; const box = boxK(box0, kOf(g)); let w = 0, n = 0, s = 0; for (let y = Math.max(0, box.y0 | 0); y < Math.min(Hd, box.y1 | 0); y++) for (let x = Math.max(0, box.x0 | 0); x < Math.min(Wd, box.x1 | 0); x++) { const o = ((Hd - 1 - y) * Wd + x) * 4; const l = luma(px[o], px[o + 1], px[o + 2]); const c = Math.max(px[o], px[o + 1], px[o + 2]) - Math.min(px[o], px[o + 1], px[o + 2]); n++; s += l; if (l > 225 && c < 30) w++; } return { white: +(w / Math.max(1, n)).toFixed(3), mean: +(s / Math.max(1, n)).toFixed(1) }; };
    // mean luma inside a circle, the box left out (ground only)
    b.__circ = (g, cx0, cy0, rad0, box0) => { const { px, Wd, Hd } = g; const k = kOf(g), cx = cx0 * k, cy = cy0 * k, rad = rad0 * k, box = box0 && boxK(box0, k); let s = 0, n = 0; for (let y = Math.max(0, cy - rad | 0); y < Math.min(Hd, cy + rad); y += 2) for (let x = Math.max(0, cx - rad | 0); x < Math.min(Wd, cx + rad); x += 2) { if ((x - cx) ** 2 + (y - cy) ** 2 > rad * rad) continue; if (box && x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1) continue; const o = ((Hd - 1 - y) * Wd + x) * 4; s += luma(px[o], px[o + 1], px[o + 2]); n++; } return n ? s / n : 0; };
    // a quantile of the luma inside the same circle (owner ruling 10: has the lifted ground reached its clip?)
    b.__circQ = (g, cx0, cy0, rad0, box0, q) => { const { px, Wd, Hd } = g; const k = kOf(g), cx = cx0 * k, cy = cy0 * k, rad = rad0 * k, box = box0 && boxK(box0, k); const v = []; for (let y = Math.max(0, cy - rad | 0); y < Math.min(Hd, cy + rad); y += 2) for (let x = Math.max(0, cx - rad | 0); x < Math.min(Wd, cx + rad); x += 2) { if ((x - cx) ** 2 + (y - cy) ** 2 > rad * rad) continue; if (box && x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1) continue; const o = ((Hd - 1 - y) * Wd + x) * 4; v.push(luma(px[o], px[o + 1], px[o + 2])); } v.sort((a, c) => a - c); return v.length ? v[Math.min(v.length - 1, Math.floor(q * v.length))] : 0; };
    // the victim's body: actor shown vs hidden (VFX and telegraphs off) inside the box, above its feet. White share of
    // those pixels (luma > 225, chroma < 30) in four frames: `base` no lift and no hit flash (the body's own pale parts),
    // `lift` the envelope alone (the hit flash hidden too: what the post chain does to the body), `flash` the envelope
    // with the actor's own victim flash (the 1-2 frame hit flash, actors.ts VICTIM_FLASH), `full` everything
    b.__body = (id, box0, feetY0) => {
      const a = R.actors.get(id); const d = R.vfx.draw; const tv = R.overlay.teleScene.visible;
      const U = b.__U;
      // no lift for one grab: the envelope writes into stand-ins that ignore it, the dip and the breath read 1 and 0
      const pin = (u, v) => Object.defineProperty(u, 'value', { get: () => v, set: () => {}, configurable: true });
      const unpin = (u, v) => Object.defineProperty(u, 'value', { value: v, writable: true, enumerable: true, configurable: true });
      const keep = { a: U.uLiftA.value, e: U.uExpo.value, b: U.uBreath.value };
      const noLift = () => { const z = keep.a.map((v) => { const q = v.clone(); q.set(0, 0, 0, 0); q.set = function () { return this; }; return q; }); pin(U.uLiftA, z); pin(U.uExpo, 1); pin(U.uBreath, 0); };
      const lifted = () => { unpin(U.uLiftA, keep.a); unpin(U.uExpo, keep.e); unpin(U.uBreath, keep.b); };
      const full = b.__grab();
      R.vfx.draw = () => {}; R.overlay.teleScene.visible = false;
      let lift, flash, hid, base;
      // the renderer re-sets root.visible every frame (its cull): hide through the layers instead
      const masks = [];
      const off = (o) => { masks.push([o, o.layers.mask]); o.layers.disableAll(); };
      const restore = () => { for (const [o, m] of masks.splice(0)) o.layers.mask = m; };
      try {
        flash = b.__grab();
        for (const m of a.flashMeshes ?? []) m.traverse(off);
        lift = b.__grab();
        noLift();
        base = b.__grab();
      } finally { lifted(); restore(); R.vfx.draw = d; R.overlay.teleScene.visible = tv; }
      // the body mask: the actor's skinned body alone rendered into an empty target (its shadow and contact blob on the
      // ground are not body)
      const { Wd, Hd } = full;
      const box = boxK(box0, kOf(full)), feetY = feetY0 * kOf(full);
      const g = R.gl; const RT = new (R.overlay.teleTarget.constructor)(Wd, Hd);
      const skip = [];
      a.root.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh) { skip.push([o, o.layers.mask]); o.layers.disableAll(); } });
      for (const m of a.flashMeshes ?? []) m.traverse((o) => { skip.push([o, o.layers.mask]); o.layers.disableAll(); });
      const cc = g.getClearColor(new (R.tmpColor.constructor)()), ca = g.getClearAlpha(), ac = g.autoClear;
      const mask = new Uint8Array(Wd * Hd * 4);
      try {
        g.setRenderTarget(RT); g.setClearColor(0x000000, 0); g.clear(true, true, false); g.autoClear = false;
        g.render(a.root, R.rig.camera);
        g.readRenderTargetPixels(RT, 0, 0, Wd, Hd, mask);
      } finally { g.setRenderTarget(null); g.setClearColor(cc, ca); g.autoClear = ac; for (const [o, m] of skip) o.layers.mask = m; RT.dispose(); }
      hid = null;
      R.render(0);
      let n = 0, wl = 0, wf = 0, wb = 0, wh = 0, sb = 0, sb2 = 0, sf = 0, sf2 = 0, sh = 0, sh2 = 0, sl = 0, sl2 = 0;
      const white = (g, o) => { const l = luma(g.px[o], g.px[o + 1], g.px[o + 2]); const c = Math.max(g.px[o], g.px[o + 1], g.px[o + 2]) - Math.min(g.px[o], g.px[o + 1], g.px[o + 2]); return l > 225 && c < 30; };
      for (let y = Math.max(0, box.y0 | 0); y < Math.min(Hd, feetY | 0); y++) for (let x = Math.max(0, box.x0 | 0); x < Math.min(Wd, box.x1 | 0); x++) {
        const o = ((Hd - 1 - y) * Wd + x) * 4;
        if (mask[o + 3] < 128) continue;   // the target's rows are bottom-up like readPixels
        const lb = luma(base.px[o], base.px[o + 1], base.px[o + 2]), lf = luma(full.px[o], full.px[o + 1], full.px[o + 2]);
        sb += lb; sb2 += lb * lb; sf += lf; sf2 += lf * lf;
        const lh = luma(flash.px[o], flash.px[o + 1], flash.px[o + 2]), ll = luma(lift.px[o], lift.px[o + 1], lift.px[o + 2]);
        sh += lh; sh2 += lh * lh; sl += ll; sl2 += ll * ll;
        n++; if (white(lift, o)) wl++; if (white(full, o)) wf++; if (white(base, o)) wb++; if (white(flash, o)) wh++;
      }
      const k = (w) => +(w / Math.max(1, n)).toFixed(3);
      const dev = (s1, s2) => (n ? Math.sqrt(Math.max(0, s2 / n - (s1 / n) ** 2)) : 0);
      const stdBase = dev(sb, sb2), stdFull = dev(sf, sf2);
      return { flashK: +(a.flashLevel ?? 0).toFixed(2), n, baseWhite: k(wb), liftWhite: k(wl), flashWhite: k(wh), fullWhite: k(wf), boxWhite: b.__white(full, box0), boxNoVfx: b.__white(flash, box0), stdBase: +stdBase.toFixed(1), stdFull: +stdFull.toFixed(1), detail: +(stdFull / Math.max(1, stdBase)).toFixed(2), detailFlash: +(dev(sh, sh2) / Math.max(1, stdBase)).toFixed(2), detailLift: +(dev(sl, sl2) / Math.max(1, stdBase)).toFixed(2), meanFull: +(sf / Math.max(1, n)).toFixed(0), meanBase: +(sb / Math.max(1, n)).toFixed(0) };
    };
    // only these VFX ids spawn while set (the impact-hold window measures the hit's own look)
    b.__onlyIds = null;
    const spawn0 = R.vfx.spawnHandle.bind(R.vfx);
    R.vfx.spawnHandle = (vid, o) => (b.__onlyIds && !b.__onlyIds.includes(vid) ? 0 : spawn0(vid, o));
    b.__vfxPx = (box) => {
      const tv = R.overlay.teleScene.visible; R.overlay.teleScene.visible = false;
      const on = b.__grab(); const d = R.vfx.draw; R.vfx.draw = () => {}; let off; try { off = b.__grab(); } finally { R.vfx.draw = d; R.overlay.teleScene.visible = tv; } R.render(0);
      const { Wd, Hd } = on; let n = 0; const xs = [], ys = [];
      for (let y = Math.max(0, box.y0 | 0); y < Math.min(Hd, box.y1 | 0); y++) for (let x = Math.max(0, box.x0 | 0); x < Math.min(Wd, box.x1 | 0); x++) {
        const o = ((Hd - 1 - y) * Wd + x) * 4;
        const r = Math.max(0, on.px[o] - off.px[o]) / 255, g = Math.max(0, on.px[o + 1] - off.px[o + 1]) / 255, bl = Math.max(0, on.px[o + 2] - off.px[o + 2]) / 255;
        if (luma(r, g, bl) >= 0.08) { n++; xs.push(x); ys.push(y); }
      }
      // the lit region's size: twice the 90th-percentile distance of its pixels from their centroid (a starburst's
      // reach, the same at any rotation of its points; stray sparks and chips left out)
      if (n < 20) return { n, ext: 0 };
      let cx = 0, cy = 0; for (let i = 0; i < n; i++) { cx += xs[i]; cy += ys[i]; } cx /= n; cy /= n;
      const ds = xs.map((x, i) => Math.hypot(x - cx, ys[i] - cy)).sort((p, q) => p - q);
      return { n, ext: 2 * ds[Math.floor(n * 0.9)] };
    };
    // the telegraph layer alone (premultiplied alpha 0..255) at ground points
    b.__teleAt = (pts) => {
      const g = R.gl; const RT = new (R.overlay.teleTarget.constructor)(1920, 1080);
      g.setRenderTarget(RT); g.setClearColor(0x000000, 0); g.clear(true, true, false);
      const ac = g.autoClear; g.autoClear = false; g.render(R.overlay.teleScene, R.rig.camera); g.autoClear = ac; g.setRenderTarget(null);
      const buf = new Uint8Array(1920 * 1080 * 4); g.readRenderTargetPixels(RT, 0, 0, 1920, 1080, buf); RT.dispose();
      return pts.map((p) => { const s = b.screen(p.x, p.y, 0.04); let sum = 0, n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = Math.round(s.x) + dx, Y = 1079 - (Math.round(s.y) + dy); if (X < 0 || X >= 1920 || Y < 0 || Y >= 1080) continue; sum += buf[(Y * 1920 + X) * 4 + 3]; n++; } return { k: p.k, a: n ? Math.round(sum / n) : -1 }; });
    };
    b.__park(); b.__clear();
    b.__step(10);
    return W.players.map((p, i) => { const e = W.entity(p.entity); return { seat: i, def: e?.def, team: e?.team, entity: p.entity }; });
  };
  report.players = await B(SETUP, LINEUP);
  let P = report.players;
  const seat = (def) => P.find((p) => p.def === def);
  const spot = { x: 74, y: 55 };
  const setCam = () => B((b, s) => { b.renderer.rig.mode = 'free'; b.focus(s.x, s.y); b.zoom(b.catalog.maps.find((m) => m.id === b.__H.setup.map).camera.distance); b.__step(4); }, spot);
  await setCam();
  const clip = await B((b, s) => { const c = b.screen(s.x, s.y, 0); return { x: Math.round(c.x - 480), y: Math.round(c.y - 330), width: 960, height: 620 }; }, spot);
  const shot = (name, c = clip) => page.screenshot({ path: join(SHOTS, `fw_W1_polish_${name}${TAG ? '_' + TAG : ''}.png`), clip: c });
  // caster at spot.x − d/2, victim (seat 0) at spot.x + d/2, both still
  const stage = (c, d = 4.5) => B((b, a) => {
    const W = b.__W, pc = W.players[a.c].entity, pv = W.players[0].entity;
    b.__park(); b.__clear();
    b.__prep(pc, a.x - a.d / 2, a.y, 0); b.__prep(pv, a.x + a.d / 2, a.y, Math.PI);
    b.__cmd(a.c, { type: 'stop' }); b.__cmd(0, { type: 'stop' });
    b.__step(30);
    b.__prep(pc, a.x - a.d / 2, a.y, 0); b.__prep(pv, a.x + a.d / 2, a.y, Math.PI);
    b.__step(2);
    b.__ev.length = 0;
    return { pc, pv };
  }, { c, d, ...spot });

  // ── combat F4: the beat's anchor and the struck unit
  if (ONLY.includes('ult')) {
    // critic combat-16: any fighter's ult. The casters must be ENEMIES of the viewer (seats 5-9): a fighter not on
    // that side of the current lineup is cast from another lineup (5 casters each, the viewer Lisvel, or Ardit when
    // Lisvel casts), built like the first; the first lineup comes back for the later sections
    const want = opt('ults', 'kemdo,rishal,tunlan,hesmi') === 'all' ? ALL : opt('ults', 'kemdo,rishal,tunlan,hesmi').split(',').filter(Boolean);
    const enemy0 = LINEUP.slice(5);
    const order = [...want.filter((d) => enemy0.includes(d)).map((d) => ({ d, lineup: null }))];
    const rest = want.filter((d) => !enemy0.includes(d));
    for (let i = 0; i < rest.length; i += 5) {
      const g = rest.slice(i, i + 5);
      const viewer = g.includes('lisvel') ? 'ardit' : 'lisvel';
      const fill = ALL.filter((f) => f !== viewer && !g.includes(f));
      const lineup = [viewer, ...fill.slice(0, 4), ...g, ...fill.slice(4)].slice(0, 10);
      for (const d of g) order.push({ d, lineup });
    }
    let cur = null;
    for (const { d: def, lineup } of order) {
      if (lineup !== cur) {
        cur = lineup;
        P = report.players = await B(SETUP, lineup ?? LINEUP);
        await setCam();
        console.log(`lineup ${(lineup ?? LINEUP).join(',')}`);
      }
      const c = seat(def);
      const st = await stage(c.seat);
      const geo = await B((b, a) => ({ c: b.__h(a.pc), v: b.__h(a.pv) }), st);
      const vbox = { x0: geo.v.gx - 45, y0: geo.v.ty - 5, x1: geo.v.gx + 45, y1: geo.v.gy + 5 };
      const base = await B((b, a) => b.__white(b.__grab(), a.vbox), { vbox });
      // the frame before the cast, kept to read at the beat's circle (a cross-check on the faded core below) and what is
      // alive in it (a kit's passive, the map's): the faded frame must be down to this
      const live0 = await B((b) => { b.__g0 = b.__grab(); return [...new Set(b.renderer.vfx.insts.filter((it) => it.active).map((it) => it.def.id))]; });
      await B((b, a) => { const me = b.__H.view.entity(a.pv); b.__cmd(a.c, { type: 'cast', slot: a.slot, x: me.x, y: me.y, target: a.pv }); }, { ...st, c: c.seat, slot: SLOT });
      const rows = [];
      let flatN = 0;
      for (let f = 1; f <= 72; f++) {
        rows.push(await B((b, a) => {
          b.__step(1);
          for (const id of [a.pc, a.pv]) { const e = b.__W.entity(id); if (e && e.alive) { e.hp = Math.max(e.hp, e.maxHp * 0.6); e.res = e.maxRes; } }
          const U = b.__U;
          const L = U.uLiftA.value.map((q) => ({ ux: q.x, uy: q.y, rr: q.z, w: q.w })).filter((q) => q.w > 0);
          const out = { w: L.length ? +Math.max(...L.map((q) => q.w)).toFixed(3) : 0 };
          if (a.every && !L.some((q) => q.w >= 1.3)) out.white = b.__body(a.pv, a.vbox, a.feetY);
          else if (L.some((q) => q.w >= 1.3)) {
            const q = L.reduce((m, x) => (x.w > m.w ? x : m));
            const g = b.__grab();
            const cx = q.ux * 1920, cy = (1 - q.uy) * 1080, rad = q.rr * 1080;
            out.q = { ux: q.ux, uy: q.uy, rr: q.rr };
            out.ctr = [Math.round(cx), Math.round(cy)];
            out.core = +b.__circ(g, cx, cy, rad * 0.5, null).toFixed(1);
            out.coreGround = +b.__circ(g, cx, cy, rad * 0.5, a.vbox).toFixed(1);
            // the lifted GROUND alone (the VFX pass off): its brightest tenth, against the faded frame's (ruling 10)
            { const R = b.renderer, d = R.vfx.draw; R.vfx.draw = () => {}; let g0; try { g0 = b.__grab(); } finally { R.vfx.draw = d; } out.liftP90 = +b.__circQ(g0, cx, cy, rad * 0.5, a.vbox, 0.9).toFixed(1); }
            out.white = b.__body(a.pv, a.vbox, a.feetY);
            // the VFX instances alive on the beat (def id: count), for the box measure's culprits
            const live = {};
            for (const it of b.renderer.vfx.insts) if (it.active) live[it.def.id] = (live[it.def.id] ?? 0) + 1;
            out.live = live;
          }
          return out;
        }, { ...st, vbox, feetY: geo.v.gy - 6, every: SLOT !== 'ult' || args.includes('--every') }));
        if (rows[rows.length - 1].white && !rows.slice(0, -1).some((r) => r.white)) await shot(`ult_${def}_beat`);
        // --every: the frames the eye note asks about: the 1st and 6th flat frame of the body (detail < 0.5)
        if (args.includes('--every') && rows[rows.length - 1].white?.detail < 0.5 && rows[rows.length - 1].white?.n >= 200) { flatN = (flatN ?? 0) + 1; if (flatN === 1 || flatN === 6) await shot(`ult_${def}_flat${flatN}`); }
      }
      await B((b) => { b.__step(75); });
      const first = rows.find((r) => r.ctr);
      let baseCore = null;
      if (first) {
        // CW1 r3 refix (done:1): 'faded' means faded. A fixed 179 frames ended a few frames before Hesmi's 5 s shadow zone
        // (0.35 + 0.75 + 5 s = 183 frames), and one single-frame read took 110 where others took 97-99 (mostly inside the
        // victim's box: ground 105 vs 102; cause not reproduced). Wait until no effect of the kit's that the frame before the
        // cast did not hold is alive, then take the median of 5 frames; the report holds every sample, the wait and the
        // pre-cast frame's reading
        const faded = await B((b, a) => { let n = 0; const left = () => [...new Set(b.renderer.vfx.insts.filter((it) => it.active && it.def.id.startsWith(`${a.def}_`) && !a.live0.includes(it.def.id)).map((it) => it.def.id))]; while (left().length && n < 600) { b.__step(15); n += 15; } return { frames: n, left: left() }; }, { live0, def });
        await stage(c.seat);
        baseCore = await B((b, a) => {
          const cx = a.q.ux * 1920, cy = (1 - a.q.uy) * 1080, r = a.q.rr * 1080 * 0.5;
          const flashOf = () => +(b.renderer.actors.get(a.pv)?.flashState?.k ?? 0).toFixed(3);
          const read = (g) => ({ flash: flashOf(), all: +b.__circ(g, cx, cy, r, null).toFixed(1), ground: +b.__circ(g, cx, cy, r, a.vbox).toFixed(1), p90: +b.__circQ(g, cx, cy, r, a.vbox, 0.9).toFixed(1) });
          const samples = [];
          for (let i = 0; i < 5; i++) { if (i) b.__step(6); samples.push(read(b.__grab())); }
          const med = (k) => samples.map((x) => x[k]).sort((p, q) => p - q)[2];
          const pre = read(b.__g0); b.__g0 = null;
          return { all: med('all'), ground: med('ground'), p90: med('p90'), samples, pre };
        }, { q: first.q, vbox, pv: st.pv });
        baseCore.waited = faded.frames; baseCore.left = faded.left;
      }
      const beats = rows.map((r, i) => ({ f: i + 1, ...r })).filter((r) => r.white);
      const dC = first ? Math.hypot(first.ctr[0] - geo.c.gx, first.ctr[1] - geo.c.gy) : null, dV = first ? Math.hypot(first.ctr[0] - geo.v.gx, first.ctr[1] - geo.v.gy) : null;
      const res = {
        def, caster: [Math.round(geo.c.gx), Math.round(geo.c.gy)], victim: [Math.round(geo.v.gx), Math.round(geo.v.gy)], firstCtr: first?.ctr ?? null,
        ctrToCaster: dC && Math.round(dC), ctrToVictim: dV && Math.round(dV), baseWhite: base, baseCore,
        beats: beats.map((r) => ({ f: r.f, w: r.w, bodyPx: r.white.n, bodyWhiteBase: r.white.baseWhite, bodyWhiteLift: r.white.liftWhite, bodyWhiteFlash: r.white.flashWhite, bodyWhiteFull: r.white.fullWhite, boxWhite: r.white.boxWhite.white,
          boxWhiteNoVfx: r.white.boxNoVfx.white, flashK: r.white.flashK, live: r.live, detail: r.white.detail, detailFlash: r.white.detailFlash, detailLift: r.white.detailLift, stdBase: r.white.stdBase, stdFull: r.white.stdFull, meanBase: r.white.meanBase, meanFull: r.white.meanFull,
          core: r.core, ratio: baseCore ? +(r.core / baseCore.all).toFixed(2) : null, ratioGround: baseCore ? +(r.coreGround / baseCore.ground).toFixed(2) : null })),
      };
      res.maxWhite = beats.length ? Math.max(...res.beats.map((r) => r.bodyWhiteLift)) : null;
      // what the envelope itself adds to the body (its own pale parts left out)
      res.maxLiftAdds = beats.length ? Math.max(...res.beats.map((r) => +(r.bodyWhiteLift - r.bodyWhiteBase).toFixed(3))) : null;
      res.maxWhiteFlash = beats.length ? Math.max(...res.beats.map((r) => r.bodyWhiteFlash)) : null;
      res.maxWhiteFull = beats.length ? Math.max(...res.beats.map((r) => r.bodyWhiteFull)) : null;
      res.maxBoxWhite = beats.length ? Math.max(...res.beats.map((r) => r.boxWhite)) : null;
      res.firstRatio = res.beats[0]?.ratio ?? null;
      res.firstRatioGround = res.beats[0]?.ratioGround ?? null;
      res.maxLift = Math.max(...rows.map((r) => r.w));
      res.detailLost = res.beats.filter((r) => r.bodyPx >= 200 && r.detail < 0.5).length;
      res.minDetail = res.beats.length ? Math.min(...res.beats.map((r) => r.detail)) : null;
      report.ult.push(res);
      console.log(`         ${def} ${SLOT} max lift ${res.maxLift}, detail per frame (lost ${res.detailLost}, min ${res.minDetail}): ${res.beats.filter((r) => r.detail < 0.8).map((r) => `f${r.f} ${r.detail} [noVfx ${r.detailFlash} noFlash ${r.detailLift} flash k ${r.flashK}] (mean ${r.meanFull}/${r.meanBase})`).join(' · ')}`);
      if (res.detailLost > 2) fail(`${def} ${SLOT}: the struck body stays flat for ${res.detailLost} frames (detail < 0.5; at most 2)`);
      console.log(`         box white per beat (VFX off): ${res.beats.map((r) => `f${r.f} ${r.boxWhite} (${r.boxWhiteNoVfx})`).join(' · ')}`);
      console.log(`ult ${def.padEnd(7)} ctr ${JSON.stringify(res.firstCtr)} caster ${JSON.stringify(res.caster)} victim ${JSON.stringify(res.victim)} (to caster ${res.ctrToCaster}, to victim ${res.ctrToVictim})  body white: lift adds ${res.maxLiftAdds} (lift ${res.maxWhite}, + hit flash ${res.maxWhiteFlash}, full frame ${res.maxWhiteFull}) · box ${res.maxBoxWhite} (box base ${base.white})  core ×${res.firstRatio} ground ×${res.firstRatioGround}, faded core ${baseCore?.all} ground ${baseCore?.ground} (samples ${baseCore?.samples.map((x) => x.all).join(' ')}; before the cast ${baseCore?.pre.all}; waited ${baseCore?.waited} frames, left ${baseCore?.left.join(',') || 'none'})`);
      if (SLOT !== 'ult') { /* a kit slot: only the body's detail is asked */ }
      else if (!first) fail(`${def}: no beat ≥ 1.3`);
      else {
        // a self-centred ultimate (every area / zone of it at the caster: Burdam's, Ilsheta's, Sukri's, Ulkro's, Ardit's)
        // beats where it stands; the centre gate is for the ults aimed at a unit or a shape (Tunlan's cone, Rishal's track)
        if (!SELF_ULT.has(def) && dV >= dC) fail(`${def}: the beat sits on the caster (${Math.round(dC)} px from it, ${Math.round(dV)} from the victim)`);
        if (!args.includes('--every') && res.beats.some((r) => r.bodyPx < 200)) fail(`${def}: the victim's body was not isolated (${res.beats.map((r) => r.bodyPx).join('/')} px)`);
        if (res.maxLiftAdds > 0.1) fail(`${def}: the lift whites ${res.maxLiftAdds} more of the victim's body at a beat (> 0.10)`);
        // W1 verify combat:F4: the review's box measure (victim box ±45 px, white = luma > 225 and chroma < 30) on every
        // beat frame, VFX on: the kit's own light over the struck unit included
        if (res.maxBoxWhite > 0.35) fail(`${def}: the victim box goes ${res.maxBoxWhite} white at a beat (> 0.35)`);
        // owner ruling 10: where the lifted ground reaches the post-grade luma clip (≈ 218) the target is ×2.0, else ×2.3.
        // The ground reaches it when ×2.3 of its own unlifted core would pass the clip (base × 2.3 ≥ 218: a mid-value
        // ground of luma ≥ 95 cannot read ×2.3 without going white), or when the beat's core itself sits at the clip
        const b0 = res.beats[0];
        res.firstCore = b0?.core ?? null;
        // ... or when the lifted ground's brightest tenth (VFX off) stops short of ×2.3 its faded value: the tone curve's
        // top (post.ts LIFT_GROUND_TOP, then the grade) holds it, wherever that clip lands for the ground's own hue
        res.liftP90 = first?.liftP90 ?? null; res.baseP90 = baseCore?.p90 ?? null;
        res.groundClipped = res.liftP90 !== null && res.baseP90 > 0 && res.liftP90 < res.baseP90 * 2.3 - 3;
        res.clipBound = !!b0 && (b0.core >= CORE_CLIP || (baseCore?.all ?? 0) * 2.3 >= CORE_CLIP || res.groundClipped);
        res.coreTarget = res.clipBound ? 2.0 : 2.3;
        // ruling 51 (W2-B fix 1): on the ruling-46 ground the faded core sits at luma ~123, so x2.0 of it (~246) lies past the
        // ~218 clip itself: a x2.0 core there IS the near-white ruling 10 forbids, and it cannot coexist with the body and box
        // white gates (ruling 48 measured the landing's peak at display luma ~222-230 whatever the solve). Where x2.0 of the
        // faded core passes the clip, the target is the clip: the first beat's core luma >= CORE_CLIP
        res.clipTarget = !!baseCore && baseCore.all * 2.0 >= CORE_CLIP;
        if (res.clipTarget) { if (res.firstCore !== null && res.firstCore < CORE_CLIP) fail(`${def}: core luma ${res.firstCore} < the clip ${CORE_CLIP} on the first beat (x${res.firstRatio}; faded core ${baseCore?.all}: x2.0 would be ${+(baseCore.all * 2).toFixed(1)}, past the clip, ruling 51)`); }
        else if (res.firstRatio !== null && Math.max(res.firstRatio, res.firstRatioGround ?? 0) < res.coreTarget) fail(`${def}: core ×${res.firstRatio} (ground ×${res.firstRatioGround}, luma ${res.firstCore}, faded core ${baseCore?.all} ground ${baseCore?.ground}, lifted ground p90 ${res.liftP90} vs faded ${res.baseP90}) < ${res.coreTarget} on the first beat`);
      }
      await B((b) => { b.__park(); b.__step(40); });
    }
    if (cur !== null) { P = report.players = await B(SETUP, LINEUP); await setCam(); }
  }

  // ── combat F5: one plate per hard CC
  if (ONLY.includes('cc')) {
    const kinds = ['stun', 'airborne', 'sleep', 'taunt', 'fear', 'root', 'silence'];
    const r = await B((b, a) => {
      const W = b.__W, R = b.renderer;
      b.__park(); b.__clear();
      const ids = W.players.slice(0, a.kinds.length).map((p) => p.entity);
      ids.forEach((id, i) => { b.__prep(id, a.x - 9 + i * 3, a.y + (i % 2 ? 1.5 : -1.5), Math.PI / 2); b.__cmd(W.players.findIndex((p) => p.entity === id), { type: 'stop' }); });
      b.__step(20);
      ids.forEach((id, i) => { b.__prep(id, a.x - 9 + i * 3, a.y + (i % 2 ? 1.5 : -1.5), Math.PI / 2); });
      b.__step(1);
      const labels0 = R.bars.labels.geometry.instanceCount;
      const src = W.entity(W.players[9].entity);
      ids.forEach((id, i) => b.__st.applyStatus(W, src, W.entity(id), a.kinds[i], 2));
      // a second CC under the first on fighter 0: the plate names the higher one (stun over root)
      b.__st.applyStatus(W, src, W.entity(ids[0]), 'root', 2);
      const alpha = [];
      for (let f = 0; f < 5; f++) {
        b.__step(1, 1 / 60);
        const L = R.bars.labels.geometry; const n = L.instanceCount; const t = L.getAttribute('ua3');
        // the plate is each fighter's last label; its tint alpha is the fade
        alpha.push({ ms: Math.round((f + 1) * 1000 / 60), labels: n, a: Array.from({ length: n }, (_, j) => +t.getW(j).toFixed(2)) });
      }
      return { ids, labels0, alpha, cells: R.bars.ccKind?.length ?? null, kinds: ids.map((id) => b.__H.view.entity(id)?.statuses.map((s) => s.kind)) };
    }, { kinds, ...spot });
    await B((b) => b.__step(6));
    const ccClip = await B((b, s) => { const c = b.screen(s.x, s.y, 2.6); return { x: Math.round(c.x - 640), y: Math.round(c.y - 170), width: 1280, height: 300 }; }, spot);
    await shot('cc_plates', ccClip);
    const after = await B((b) => b.renderer.bars.labels.geometry.instanceCount);
    report.cc = { ...r, labelsAfter: after, plates: after - r.labels0 };
    console.log(`cc plates: labels ${r.labels0} → ${after} (+${after - r.labels0} for ${kinds.length} CC'd fighters), fade ${r.alpha.map((x) => `${x.ms}ms`).join(' ')}`);
    if (after - r.labels0 !== kinds.length) fail(`cc: ${after - r.labels0} plates for ${kinds.length} CC'd fighters`);
    // the statuses run out on their own (clearing the list would leave the sim's control flags set)
    await B((b) => { b.__step(75); b.__park(); b.__step(5); });
  }

  // ── combat m-3: the landing flash of a wide area
  if (ONLY.includes('flash')) {
    for (const def of ['tunlan', 'burdam']) {
      const c = seat(def);
      const st = await stage(c.seat, 4.5);
      await B((b, a) => { const me = b.__H.view.entity(a.pv); b.__cmd(a.c, { type: 'cast', slot: 'ult', x: me.x, y: me.y, target: a.pv }); }, { ...st, c: c.seat });
      let best = null;
      for (let f = 1; f <= 60 && !best; f++) {
        const r = await B((b, a) => {
          b.__step(1);
          const R = b.renderer, tnow = R.time;
          const t = R.director.telegraphs.find((x) => x.src === a.pc && x.zone < 0 && x.stage === undefined);
          if (!t) return null;
          if (!(tnow >= t.land && tnow < t.end)) return { wait: true };
          const s = t.shape, r0 = s.radius ?? 1;
          const pts = [];
          if (s.kind === 'cone') {
            const P = (ang, d, k) => ({ k, x: t.x + Math.cos(ang) * d, y: t.y + Math.sin(ang) * d });
            const ha = (s.angle ?? 1) / 2, sn = Math.sin(ha), rho = (r0 * sn) / (1 + sn);
            // off the axis by a few degrees (the victim stands on it at 4.5 m and hides the ground behind it)
            pts.push(P(t.dir + 0.12, r0 * 0.3, 'middle'), P(t.dir - 0.1, r0 * 0.68, 'middle68'), P(t.dir + 0.1, r0 - 0.12, 'edgeBand'), P(t.dir - ha * 0.5, r0 - 0.15, 'edgeBand2'));
            // the contour: half the inscribed circle's depth in from the far arc
            pts.push(P(t.dir + 0.08, r0 - rho * 0.5, 'contour'));
          } else {
            const P = (ang, d, k) => ({ k, x: t.x + Math.cos(ang) * d, y: t.y + Math.sin(ang) * d });
            // east (toward the victim and past it) and west: the lane's walls cover the north and south arcs
            pts.push(P(0.3, r0 * 0.25, 'middle'), P(Math.PI - 0.2, r0 * 0.7, 'middle70'), P(0.22, r0 - 0.12, 'edgeBand'), P(-0.22, r0 - 0.15, 'edgeBand2'), P(0.15, r0 * 0.5, 'contour'));
          }
          return { f: 0, shape: { kind: s.kind, r: r0 }, alpha: b.__teleAt(pts) };
        }, st);
        if (r && !r.wait) { best = { ...r, f }; await shot(`flash_${def}`); }
      }
      if (!best) { fail(`${def}: no landing flash frame seen`); continue; }
      const A = Object.fromEntries(best.alpha.map((p) => [p.k, +(p.a / 255).toFixed(2)]));
      const middle = Math.max(...Object.entries(A).filter(([k]) => k.startsWith('middle')).map(([, v]) => v));
      const edge = Math.min(A.edgeBand, A.edgeBand2);
      report.flash.push({ def, frame: best.f, shape: best.shape, alpha: A, middleMax: middle, edgeMin: edge });
      console.log(`flash ${def.padEnd(7)} ${best.shape.kind} ${best.shape.r} m: middle ≤ ${middle}  edge band ≥ ${edge}  contour ${A.contour}`);
      if (middle > 0.225) fail(`${def}: landing fill ${middle} > 0.22 in the middle`);
      if (edge < 0.4) fail(`${def}: landing edge band ${edge} < 0.4`);
      await B((b) => { b.__park(); b.__step(60); });
    }
  }

  // ── combat m-1: how long a basic attack's impact reads
  if (ONLY.includes('hold')) {
    // Tunlan's shot: an ENEMY ranged magic attacker (the viewer's own team cannot strike it)
    for (const def of ['kemdo', 'rishal', 'tunlan']) {
      const c = seat(def);
      const ranged = def === 'tunlan';
      const st = await stage(c.seat, ranged ? 4.5 : 1.6);
      const geo = await B((b, a) => b.__h(a.pv), st);
      const box = { x0: geo.gx - 110, y0: geo.ty - 50, x1: geo.gx + 110, y1: geo.gy + 40 };
      await B((b, a) => {
        const fd = b.catalog.fighters.find((f) => f.id === a.def);
        b.__onlyIds = [fd.attack.present.hitVfx];
        b.__W.entity(a.pc).autoAttack = true; b.__cmd(a.c, { type: 'attack', target: a.pv });
      }, { ...st, c: c.seat, def });
      let hitF = -1; const counts = [], spans = [];
      const vH = Math.max(1, geo.gy - geo.hy);
      for (let f = 1; f <= 90 && (hitF < 0 || f - hitF <= 12); f++) {
        const r = await B((b, a) => {
          b.__step(1);
          const e = b.__W.entity(a.pv); e.hp = e.maxHp;
          const ev = b.__ev.splice(0).filter((x) => (x.e === 'damage' || x.e === 'hit') && x.src === a.pc && (!x.ability || x.ability === 'attack'));
          return { hit: ev.length > 0 };
        }, st);
        if (r.hit && hitF < 0) hitF = f;
        if (hitF > 0) {
          // stop the next swing from landing in the window
          if (f === hitF) await B((b, a) => { b.__W.entity(a.pc).autoAttack = false; b.__cmd(a.c, { type: 'stop' }); }, { ...st, c: c.seat });
          const px = await B((b, a) => b.__vfxPx(a.box), { box });
          counts.push(px.n); spans.push(+(px.ext / vH).toFixed(2));
          if (f - hitF === 3) await shot(`hold_${def}_f3`);
        }
      }
      await B((b) => { b.__onlyIds = null; });
      if (hitF < 0) { fail(`${def}: no basic-attack hit`); continue; }
      const peak = Math.max(...counts);
      let readF = 0; for (let i = 0; i < counts.length; i++) { if (counts[i] >= peak * 0.25) readF = i + 1; else if (i > 0) break; }
      // the gauge (r12 M5): a starburst of ≈ 0.7 × the victim's height for ≈ 200 ms. `sizeMs`: how long from the hit
      // the lit region spans ≥ 0.5 × the victim's height (the done gate, ≥ 200 ms); `readMs` (info): how long the lit
      // pixel count stays ≥ 25 % of its peak, a peak the 35 ms flash and the cut set on the hit frame; `eqd` the lit area
      // as a disc (a thin four-point glint reads larger than its area)
      let sizeF = 0; for (let i = 0; i < spans.length; i++) { if (spans[i] >= 0.5) sizeF = i + 1; else break; }
      const eqd = counts.map((n) => +(2 * Math.sqrt(n / Math.PI) / vH).toFixed(2));
      // polish C3: the done gate is the lit area as a disc ≥ 0.5 × the victim's height for ≥ 167 ms (5 frames from the
      // hit); the reach (`sizeMs`) is noisy run to run and stays info
      let discF = 0; for (let i = 0; i < eqd.length; i++) { if (eqd[i] >= 0.5) discF = i + 1; else break; }
      const res = { def, hitFrame: hitF, victimPx: Math.round(vH), counts, spans, eqd, peak, readMs: Math.round(readF * 1000 / 30), sizeMs: Math.round(sizeF * 1000 / 30), discMs: Math.round(discF * 1000 / 30), spanAtHit: spans[0] };
      report.hold.push(res);
      console.log(`hold ${def.padEnd(7)} px per frame from the hit ${counts.join(' ')}  reach/victim ${spans.join(' ')}  ≥0.5 for ${res.sizeMs} ms · disc/victim ${eqd.join(' ')} ≥0.5 for ${res.discMs} ms (count ≥25 % of peak ${res.readMs} ms)`);
      if (!BEFORE && res.discMs < 167) fail(`${def}: the impact's disc is ≥ 0.5 × the victim for ${res.discMs} ms < 167`);
      await B((b) => { b.__park(); b.__step(30); });
    }
  }
  report.logs = logs.filter((l) => !/favicon|toNonIndexed|status of 404/.test(l)).slice(0, 20);
} catch (e) {
  fail(`harness error: ${e.stack ?? e.message}`);
} finally {
  writeFileSync(OUT, JSON.stringify(report, null, 1));
  await browser.close();
}
console.log(report.pass ? 'combat_polish: PASS' : `combat_polish: FAIL (${report.fails.length})`, '→', OUT);
process.exit(report.pass ? 0 : 1);
