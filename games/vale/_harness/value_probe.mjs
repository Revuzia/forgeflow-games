// VALE harness — environment value probe (r12 B5: the ground must leave the top of the value range to
// characters, effects and UI). The real client (render bench, real map, real post chain, real Chrome GPU) at the
// gameplay camera over named spots, VFX and UI hidden, fog of war off (every region lit: the authored values,
// the strict case). Per map and tier it reports, from the DISPLAY pixels (sRGB 8-bit, what a capture measures):
//
//   frame      Rec.709 luma (0-255) p5 / p50 / p95 / p99 of the whole frame (FRAY gates p50 <= 90, not 55-75: its
//              plate is the lane and fills ~86 % of the frame; tokens grade.maps.fray.frameLuma, r12 B5.4)
//   masks      the same per region, from a CLASS PASS: the scene drawn again into an 8-bit target with every
//              material's fragment output replaced by its region id — the ground's from the terrain's OWN baked
//              region fields (uSplat / uSplat2: lane, camp room, brush, Standing Shadow, Fallen Shaft; plazas,
//              Seat and the Noonplate from the ground's own uniforms), the walls' from the wall mesh's own kind
//              attribute (face / lip / top), everything else from the scene graph (scatter role, landmark,
//              actor kind). Masks are eroded 1 px so AA'd edges never count.
//                lane       the road (laneD < LANE_HALF); FRAY: the Noonplate's floor
//                walkable   the paved walkable stone: lane + plazas + the Seat (verges, the off-lane deck and the
//                           Dialwood floor are their own masks); spread = p95 - p5
//              The masks pool the FIXED spots only (lanes, jungle, centre, FRAY's seats). The 'fight' spot follows the bots
//              (the bench's b.fight(): the densest fighter cluster at --t), so a bot change used to move a ground gate (RIFT
//              High walkableSpread 44 -> 51 when the fight moved from the South road onto the Seat, which 'centre' already
//              frames); it still feeds the frame, env>180 and actor stats. perSpot carries each spot's walkable p5 / p95
//                edge       the walls' painted edge light (the cap course's chamfer, wall kind 3)
//                jungle     the Dialwood floor (RIFT)          camp     camp rooms
//                wallFace / wallLip / wallTop                  canopy   Dialwood trees
//                grass, brush, clutter, rock, landmark, lamp (landmark meshes with an authored emissive), seat,
//                shadow (the Standing Shadow), water (the Fallen Shaft's floor and film), outside (beyond the map)
//   sat        HSV saturation (0-1) of the ground (lane, verge, jungle, camp, plaza pooled; lane alone)
//   env>180    share of environment pixels (terrain, scatter, landmarks, sky) above luma 180, split into authored
//              lamp emissives (landmark emissive materials, the ground's lit inlays) and everything else
//   fighters   CIE L* of the fighter pixels: top-25 % (mean of the pixels at or above the 75th percentile), p75,
//              middle-50 and the gap to the lane's L* p50, pooled and per fighter (one extra spot on every live
//              fighter with art; a fighter still on the dev mannequin is left out); blow-out: p99 and the share of
//              fighter pixels above L* 90 (gt90, pooled and per fighter); wicks, monsters and structures for information
//   flash      a T4 ultimate landing (injected area event of a real ultimate, the director's own path: its VFX
//              and the default impact envelope) at your fighter: the mean luma of the 3.5 m impact disc on
//              screen, before vs the brightest frame of the next 0.8 s (sim held, VFX on, UI hidden)
//
//   node _harness/value_probe.mjs [--maps rift,bridge,fray] [--tiers high,low] [--tag before] [--t 75]
//                                 [--seed 7] [--shots 1] [--flash 1] [--masks 0] [--you burdam] [--fshots 0] [--fog 0|1|only]
//
//   fog        (--fog 1 adds it, --fog only runs nothing else) env F3, the fog of war A/B: at every spot the same frame
//              twice, fog off and fully unseen (the vision texture held at 0: every pixel at the fog's full strength),
//              sim held; per class pixel (eroded, lit luma >= 20) the DISPLAY luma ratio unseen / lit. Gate: the lane
//              (FRAY: the Noonplate) and the jungle floor at p50 0.50-0.60 (tokens grade.fogOfWar.valueMul 0.55); every
//              other class (walls, scatter, landmarks and lamps, the Standing Shadow and its fogged L*) is reported
//
//   bases      (env m1) one spot per team base of a lane map: halfway from the base's spawn to the team's structure
//              nearest it (RIFT / BRIDGE: the Hourbell), the plaza a respawning player sees. Measured like the fighter
//              spots (never pooled into the frame stats): the plaza's mean HSV saturation (band 0.17-0.40, the ground
//              band: LoL's bases stay tinted), and the base structures' L* p95 (<= 80: structure chalk sits under the
//              fighters, r12 B5) and display luma p95 against the fighters' (verdict base_<n>_plaza / base_<n>_structure)
//
//   --vfxcaps the flash test again per VFX lift cap (e.g. off,1.3,1.6: renderer.vfx.liftCap, combat F4; off = effects
//             lifted like the ground), reported as flash.byCap
//   --you     pins seat 0's fighter (the bench's `you=`): measure a fighter the map's default seat roster leaves out
//             (e.g. FRAY has no Burdam); other seats keep the default roster
//   --fshots  1 also screenshots each fighter spot (value_<map>_<tier>_<tag>_f_<fighter>.png)
//
// Tiers: high = 1920×1080, low = 1280×720 (the camera sign-off tier). Report: _harness/_reports/value_probe.json
// (runs keyed by --tag, merged with earlier tags). Shots: _harness/_shots/value_<map>_<tier>_<tag>_<spot>.png.
// VALE_URL picks the dev server (default http://localhost:5190).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, shot } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const MAPS = opt('maps', 'rift,bridge,fray').split(',');
const TIERS = opt('tiers', 'high,low').split(',');
const TAG = opt('tag', 'run');
const T = Number(opt('t', 75));
const SEED = Number(opt('seed', 7));
const SHOTS = opt('shots', '1') === '1';
const FLASH = opt('flash', '1') === '1';
const MASKS = opt('masks', '0') === '1';
const YOU = opt('you', '');
const FSHOTS = opt('fshots', '0') === '1';
const FOG = opt('fog', '0');
const FOG_ONLY = FOG === 'only';
/** combat F4: the flash test once per VFX lift cap (renderer.vfx.liftCap; 'off' = effects lifted like the ground) */
const VFX_CAPS = opt('vfxcaps', '').split(',').filter(Boolean).map((c) => (c === 'off' ? null : Number(c)));
/** env F3: the unseen / lit display ratio band (tokens grade.fogOfWar.valueMul 0.55) */
const FOG_BAND = [0.5, 0.6];
const RES = { high: [1920, 1080], low: [1280, 720], medium: [1920, 1080], ultra: [1920, 1080] };

// ── in-page probe (installed once per page as window.__VP__) ──────────────────────────────────────────
function install() {
  const b = window.__VALE_BENCH__, R = b.renderer, gl = R.gl, ctx = gl.getContext();
  const Color = R.tmpColor.constructor;
  const RT = R.warmRT.constructor;
  const Vec3 = R.ground.normal.constructor;
  // ── hide VFX and UI (originals kept for the flash test) ──
  const vfxDraw = R.vfx.draw.bind(R.vfx);
  const overlayDraw = R.overlay.draw.bind(R.overlay);
  const fx = R.vfx.screen.fx;
  const setDead = fx.setDead.bind(fx);
  const hide = () => {
    R.vfx.draw = () => {};
    R.vfx.group.visible = false;
    R.overlay.draw = () => {};
    R.vfx.clear();
    fx.setDead = () => {};
    fx.reset();
    R.fog.enabled = false;
  };
  const showVfx = () => { R.vfx.draw = vfxDraw; R.vfx.group.visible = true; };
  // env F3 fog A/B: the vision texture held at 0 after every update (every pixel fully unseen) while forced
  let forceUnseen = false;
  const fogUpdate = R.fog.update.bind(R.fog);
  R.fog.update = (view, team, dt) => {
    fogUpdate(view, team, dt);
    if (forceUnseen && R.fog.tex) { R.fog.bytes.fill(0); R.fog.cur.fill(0); R.fog.tex.needsUpdate = true; }
  };
  // ── class ids ──
  const C = {
    sky: 0, lane: 1, verge: 2, jungle: 3, camp: 4, brush: 5, plaza: 6, shadow: 7, outside: 8, seat: 9,
    wallFace: 10, wallLip: 11, wallTop: 12, canopy: 13, rock: 14, grass: 15, landmark: 16, water: 17, clutter: 18, lamp: 19,
    fighter: 20, wick: 21, monster: 22, structure: 23, actor: 24,
  };
  const GROUND_SNIP = /* glsl */`
{
  vec2 qp = vGroundW.xz;
  vec4 q1 = texture( uSplat, qp * uSplatScale );
  vec4 q2 = texture( uSplat2, qp * uSplatScale );
  float qLane = q1.r * 16.0, qClear = q1.g * 24.0 - 8.0, qThick = q1.a * 8.0 - 4.0;
  bool qIn = qp.x >= 0.0 && qp.y >= 0.0 && qp.x <= uMapSize.x && qp.y <= uMapSize.y;
  float qc = 3.0, qg = 0.0;
#if defined( VALE_STYLE_PLATE )
  qc = length( qp - uPlate.xy ) < uPlate.z ? 1.0 : 8.0;
  if ( valeInlay( qp ).b < 0.06 ) qg = 1.0;   // the hour-marks' lit grooves and their anti-aliased rims
#else
  if ( qLane < uLaneHalf ) qc = 1.0; else if ( qLane < uLaneHalf + 2.4 ) qc = 2.0;
  if ( qClear < 0.0 ) qc = 4.0;
#endif
#if defined( VALE_STYLE_SPAN )
  if ( qc > 2.5 ) qc = 2.0;
  if ( valeInlay( qp ).b < 0.06 ) qg = 1.0;   // the Snap's lit fracture and its anti-aliased rim
#endif
  if ( qThick < 0.0 ) qc = 5.0;
  if ( uPlaza0.z > 0.0 && length( qp - uPlaza0.xy ) < uPlaza0.z ) qc = 6.0;
  if ( uPlaza1.z > 0.0 && length( qp - uPlaza1.xy ) < uPlaza1.z ) qc = 6.0;
#if defined( VALE_STYLE_DIAL )
  if ( q2.g * 8.0 - 4.0 < 0.0 ) qc = 17.0;
  if ( uSeat.z > 0.0 && length( qp - uSeat.xy ) < uSeat.z ) qc = 9.0;
#endif
  if ( !qIn ) qc = 8.0;
  gl_FragColor = vec4( qc / 255.0, qg / 255.0, 0.0, 1.0 );
}`;
  const WALL_SNIP = /* glsl */`
{
  float qk = vWA.w;
  float qc = qk < 1.5 ? 10.0 : qk < 5.5 ? 11.0 : qk < 6.5 ? 12.0 : ( qk > 8.5 && qk < 9.5 ) ? 11.0 : 10.0;
  float qg = abs( qk - 3.0 ) < 0.5 ? 3.0 : 0.0;   // the painted edge light's chamfer
  gl_FragColor = vec4( qc / 255.0, qg / 255.0, 0.0, 1.0 );
}`;
  const cache = new Map();
  const figs = [];
  const classMat = (m, cls, kind, g = 0) => {
    const key = `${m.uuid}|${kind}|${cls}|${g}`;
    let c = cache.get(key);
    if (c) return c;
    c = m.clone();
    const ob = m.onBeforeCompile, ck = m.customProgramCacheKey;
    const snip = kind === 'ground' ? GROUND_SNIP : kind === 'wall' ? WALL_SNIP : `gl_FragColor = vec4( ${cls}.0 / 255.0, ${g}.0 / 255.0, 0.0, 1.0 );`;
    c.onBeforeCompile = (sh, r) => {
      ob.call(m, sh, r);
      sh.fragmentShader = sh.fragmentShader.replace(/\}\s*$/, `\n${snip}\n}\n`);
    };
    c.customProgramCacheKey = () => `${ck.call(m)}|vp:${kind}:${cls}:${g}`;
    c.blending = 1; c.premultipliedAlpha = false;
    cache.set(key, c);
    return c;
  };
  const emissive = (m) => !!(m.emissiveMap || (m.emissive && m.emissiveIntensity > 0 && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.02));
  const classify = (o) => {
    const names = [];
    for (let p = o; p && p !== R.scene; p = p.parent) names.push(p.name || '');
    const m0 = Array.isArray(o.material) ? o.material[0] : o.material;
    if (['vale_outline', 'vale_flash', 'vale_veil_depth'].includes(o.name)) return null;
    if (m0?.isShaderMaterial || (m0?.isMeshBasicMaterial && m0.transparent)) return null;
    const actor = names.find((n) => n.startsWith('actor_'));
    if (actor) {
      const k = actor.split('_')[1];
      if (k === 'fighter') {
        // per fighter (G = its index in figs); a fighter on the dev mannequin (no art yet) is not a fighter's value
        const a = R.actors.get(Number(actor.split('_')[2]));
        if (!a || a.dev) return { cls: C.actor };
        let g = figs.indexOf(a.def) + 1;
        if (!g) { figs.push(a.def); g = figs.length; }
        return { cls: C.fighter, g };
      }
      return { cls: k === 'minion' ? C.wick : k === 'monster' ? C.monster : k === 'structure' ? C.structure : C.actor };
    }
    if (names.includes('vale_crowd')) return { cls: C.wick };
    if (!names.includes('vale_terrain')) return { cls: C.landmark };
    if (o.name === 'vale_ground') return { cls: 0, kind: 'ground' };
    if (o.name === 'vale_cliffs') return { cls: 0, kind: 'wall' };
    if (o.name === 'vale_rock_stacks') return { cls: C.wallFace };
    if (names.some((n) => n.startsWith('vale_mist') || n === 'vale_fallen_shaft')) return { cls: C.water };
    if (names.includes('vale_standing_shadow')) return { cls: C.shadow };
    if (names.includes('vale_needlegrass')) return { cls: C.grass };
    if (names.some((n) => /^vale_(trees|canopies|trunks)/.test(n))) return { cls: C.canopy };
    if (names.some((n) => /^vale_(boulders|stones)/.test(n))) return { cls: C.rock };
    if (names.some((n) => n.startsWith('vale_clutter'))) return { cls: C.clutter };
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    return { cls: ms.some(emissive) ? C.lamp : C.landmark, perMat: true };
  };
  /** the class pass into an 8-bit target at the drawing-buffer size; returns RGBA bytes (bottom-up) */
  const classPass = () => {
    const w = gl.domElement.width, h = gl.domElement.height;
    const rt = new RT(w, h, { depthBuffer: true });
    const undo = [];
    R.scene.traverse((o) => {
      if (!o.isMesh) return;
      const k = classify(o);
      if (!k) { const vis = o.visible; undo.push(() => { o.visible = vis; }); o.visible = false; return; }
      const prev = o.material;
      const map = (m) => classMat(m, k.perMat ? (emissive(m) ? C.lamp : C.landmark) : k.cls, k.kind ?? 'const', k.g ?? 0);
      o.material = Array.isArray(prev) ? prev.map(map) : map(prev);
      undo.push(() => { o.material = prev; });
    });
    const bg = R.scene.background, env = R.scene.environment;
    R.scene.background = null;
    const cc = new Color(); gl.getClearColor(cc); const ca = gl.getClearAlpha();
    const au = gl.shadowMap.autoUpdate;
    gl.shadowMap.autoUpdate = false;
    const prevRT = gl.getRenderTarget();
    gl.setRenderTarget(rt);
    gl.setClearColor(0x000000, 1);
    gl.clear(true, true, true);
    gl.render(R.scene, R.rig.camera);
    const buf = new Uint8Array(w * h * 4);
    gl.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    gl.setRenderTarget(prevRT);
    gl.setClearColor(cc, ca);
    gl.shadowMap.autoUpdate = au;
    R.scene.background = bg; R.scene.environment = env;
    for (const u of undo) u();
    rt.dispose();
    return { w, h, buf };
  };
  const readFrame = () => {
    const w = gl.domElement.width, h = gl.domElement.height;
    gl.setRenderTarget(null);
    const buf = new Uint8Array(w * h * 4);
    ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, buf);
    return { w, h, buf };
  };
  // ── colour maths ──
  const lin8 = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const v = i / 255; lin8[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  const lstarOf = (r, g, bb) => {
    const Y = 0.2126 * lin8[r] + 0.7152 * lin8[g] + 0.0722 * lin8[bb];
    return Y > 216 / 24389 ? 116 * Math.cbrt(Y) - 16 : Y * (24389 / 27);
  };
  /** per-class histograms of the frame: luma (256 bins), L* (201 bins, 0.5 steps), HSV saturation (101 bins) */
  const measure = (frame, cls) => {
    const { w, h } = frame, F = frame.buf, K = cls.buf;
    const H = {};
    const get = (c) => (H[c] ??= { n: 0, luma: new Float64Array(256), lstar: new Float64Array(201), sat: new Float64Array(101), lamp: 0 });
    const all = get('frame');
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      const r = F[i], g = F[i + 1], bb = F[i + 2];
      const L = Math.min(255, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * bb));
      const ls = Math.min(200, Math.max(0, Math.round(lstarOf(r, g, bb) * 2)));
      const mx = Math.max(r, g, bb), mn = Math.min(r, g, bb);
      const s = mx > 0 ? Math.round(((mx - mn) / mx) * 100) : 0;
      all.n++; all.luma[L]++; all.lstar[ls]++; all.sat[s]++;
      const c = K[i];
      // eroded: the 4-neighbours share the class (AA'd edges never count)
      if (K[i - 4] !== c || K[i + 4] !== c || K[i - w * 4] !== c || K[i + w * 4] !== c) continue;
      const e = get(c);
      e.n++; e.luma[L]++; e.lstar[ls]++; e.sat[s]++;
      if (c === C.fighter) { const z = get(`fig${K[i + 1]}`); z.n++; z.luma[L]++; z.lstar[ls]++; z.sat[s]++; }
      if (c === C.wallLip && K[i + 1] === 3) { const z = get('edge'); z.n++; z.luma[L]++; z.lstar[ls]++; z.sat[s]++; }
      // environment pixels above 180: authored lamp emissives vs everything else
      if (c < 20 && L > 180) { const lamp = c === C.lamp || (c < 10 && K[i + 1] === 1); get(lamp ? 'env180lamp' : 'env180').n++; get(`env180_${c}${lamp ? 'L' : ''}`).n++; }
    }
    // env count (eroded env pixels) for the share
    let envN = 0;
    for (const [k, v] of Object.entries(H)) if (k !== 'frame' && !k.startsWith('env') && Number(k) < 20) envN += v.n;
    const out = { w, h, envN, figs: figs.slice(), hist: {} };
    for (const [k, v] of Object.entries(H)) out.hist[k] = { n: v.n, luma: Array.from(v.luma), lstar: Array.from(v.lstar), sat: Array.from(v.sat) };
    return out;
  };
  const settle = (n = 4) => { for (let i = 0; i < n; i++) R.render(1 / 60); };
  /** mean display luma inside the screen projection of a ground disc (x, y, r m) */
  const discMean = (frame, x, y, r) => {
    const { w, h, buf } = frame;
    const sx = gl.domElement.width / R.cssW;
    const c = R.worldToScreen(x, y, 0);
    const pts = [];
    for (let k = 0; k < 32; k++) { const a = (k / 32) * Math.PI * 2; const p = R.worldToScreen(x + Math.cos(a) * r, y + Math.sin(a) * r, 0); pts.push([p.x * sx, p.y * sx]); }
    const inside = (px, py) => { let ins = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [px, py] of pts) { x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
    let s = 0, n = 0;
    for (let py = Math.max(0, Math.floor(y0)); py < Math.min(h, Math.ceil(y1)); py++) for (let px = Math.max(0, Math.floor(x0)); px < Math.min(w, Math.ceil(x1)); px++) {
      if (!inside(px + 0.5, py + 0.5)) continue;
      const i = ((h - 1 - py) * w + px) * 4;
      s += 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]; n++;
    }
    return { mean: n ? s / n : 0, n, centre: [c.x * sx, c.y * sx] };
  };
  const api = {
    C,
    spots: () => {
      const m = b.catalog.maps.find((x) => x.id === b.host.setup.map);
      const [W, H] = m.size;
      const s = {};
      const along = (path, f) => {
        let L = 0; for (let i = 1; i < path.length; i++) L += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
        let d = L * f;
        for (let i = 1; i < path.length; i++) { const l = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); if (d <= l) { const t = d / l; return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t]; } d -= l; }
        return path[path.length - 1];
      };
      m.lanes.forEach((l, i) => { s[`lane${i}`] = along(l.path, 0.3); });
      if (m.lanes.length === 1) s.lane_mid = along(m.lanes[0].path, 0.5);
      if (m.lanes.length >= 3) s.jungle = [W * 0.33, H * 0.28];
      s.centre = [W / 2, H / 2];
      if (!m.lanes.length) s.north = [W / 2, H * 0.3];
      // FRAY: a ring of seat spots (r 26, every 36°: each seat's spawn and respawn view, which sees the rim, the rim
      // wall and the fair's court beyond it)
      const pl = m.art?.terrain?.plate;
      if (pl && Array.isArray(pl.at)) {
        const RN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
        for (let k = 0; k < 10; k++) { const a = (k * 36 * Math.PI) / 180; s[`seat${RN[k]}`] = [pl.at[0] + Math.sin(a) * 26, pl.at[1] - Math.cos(a) * 26]; }
      }
      const f = b.fight();
      if (f) s.fight = [f.x, f.y];
      return s;
    },
    /** env m1: one spot per team base (halfway from its spawn to the team's structure nearest it); never pooled */
    baseSpots: () => {
      const m = b.catalog.maps.find((x) => x.id === b.host.setup.map);
      const s = {};
      for (const base of m.bases ?? []) {
        if (!Array.isArray(base.spawn)) continue;
        const [sx, sy] = base.spawn;
        let best = null, bd = Infinity;
        for (const st of m.structures ?? []) {
          if (st.team !== base.team) continue;
          const d = Math.hypot(st.at[0] - sx, st.at[1] - sy);
          if (d < bd) { bd = d; best = st; }
        }
        s[`base${base.team}`] = best ? [(sx + best.at[0]) / 2, (sy + best.at[1]) / 2] : [sx, sy];
      }
      return s;
    },
    /** one spot per live fighter with art (fighter values only: these spots never enter the frame stats) */
    fighterSpots: () => {
      const s = {}, seen = new Set();
      for (const a of R.actors.values()) {
        if (a.kind !== 'fighter' || a.dev || !a.view?.alive || seen.has(a.def)) continue;
        seen.add(a.def);
        s[`f_${a.def}`] = [a.x, a.y];
      }
      return s;
    },
    you: () => b.you(),
    prep: () => { hide(); settle(6); },
    measureAt: (x, y, wantMask) => {
      b.focus(x, y); b.zoom(28.5);
      R.vfx.clear(); fx.reset();
      settle(12);
      const frame = readFrame();
      const cls = classPass();
      const m = measure(frame, cls);
      if (wantMask) {
        // a false-colour mask for eyeballing (top-down rows)
        const pal = {};
        const rnd = (k) => pal[k] ??= [(k * 97) % 255, (k * 57 + 80) % 255, (k * 151 + 40) % 255];
        const out = new Uint8ClampedArray(cls.w * cls.h * 4);
        for (let y = 0; y < cls.h; y++) for (let x = 0; x < cls.w; x++) {
          const i = ((cls.h - 1 - y) * cls.w + x) * 4, o = (y * cls.w + x) * 4;
          const c = rnd(cls.buf[i]);
          out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
        }
        const cv = document.createElement('canvas'); cv.width = cls.w; cv.height = cls.h;
        cv.getContext('2d').putImageData(new ImageData(out, cls.w, cls.h), 0, 0);
        m.maskPng = cv.toDataURL('image/png');
      }
      return m;
    },
    /** env F3: the same frame lit and fully unseen; per class (eroded) the display luma ratio of every pixel lit at
     *  luma >= 20 (400 bins over 0-2), the unseen L* and the summed lumas. Leaves the frame unseen (fogOff()) */
    fogAB: (x, y) => {
      b.focus(x, y); b.zoom(28.5);
      R.vfx.clear(); fx.reset();
      R.fog.enabled = false; forceUnseen = false;
      settle(12);
      const lit = readFrame();
      const cls = classPass();
      R.fog.enabled = true; forceUnseen = true;
      settle(12);
      const dark = readFrame();
      const { w, h } = lit, A = lit.buf, D = dark.buf, K = cls.buf;
      const H = {};
      const get = (c) => (H[c] ??= { n: 0, ratio: new Float64Array(400), lstar: new Float64Array(201), litSum: 0, darkSum: 0 });
      for (let yy = 1; yy < h - 1; yy++) for (let xx = 1; xx < w - 1; xx++) {
        const i = (yy * w + xx) * 4;
        const La = 0.2126 * A[i] + 0.7152 * A[i + 1] + 0.0722 * A[i + 2];
        if (La < 20) continue;
        const Ld = 0.2126 * D[i] + 0.7152 * D[i + 1] + 0.0722 * D[i + 2];
        const bin = Math.min(399, Math.floor((Ld / La) * 200));
        const ls = Math.min(200, Math.max(0, Math.round(lstarOf(D[i], D[i + 1], D[i + 2]) * 2)));
        const all = get('frame'); all.n++; all.ratio[bin]++; all.lstar[ls]++; all.litSum += La; all.darkSum += Ld;
        const c = K[i];
        if (K[i - 4] !== c || K[i + 4] !== c || K[i - w * 4] !== c || K[i + w * 4] !== c) continue;
        const e = get(c); e.n++; e.ratio[bin]++; e.lstar[ls]++; e.litSum += La; e.darkSum += Ld;
      }
      const out = {};
      for (const [k, v] of Object.entries(H)) out[k] = { n: v.n, ratio: Array.from(v.ratio), lstar: Array.from(v.lstar), litSum: v.litSum, darkSum: v.darkSum };
      return out;
    },
    /** the fog A/B leaves the frame unseen (for its screenshot): back to lit */
    fogOff: () => { R.fog.enabled = false; forceUnseen = false; settle(4); },
    /** a T4 ultimate landing at your fighter: mean luma of the impact disc, before and over 0.8 s */
    flash: (ability, vfx, radius) => {
      const me = b.you();
      if (!me) return null;
      b.focus(me.x, me.y); b.zoom(28.5);
      showVfx();
      R.vfx.clear(); fx.reset();
      settle(12);
      const base = discMean(readFrame(), me.x, me.y, radius);
      const t = b.host.view.time;
      R.injectEvents([{ e: 'area', t, src: me.id, ability, x: me.x, y: me.y, shape: { kind: 'circle', radius }, delay: 0, vfx, telegraph: 'everyone' }]);
      const series = [];
      for (let i = 0; i < 48; i++) { R.render(1 / 60); series.push(+discMean(readFrame(), me.x, me.y, radius).mean.toFixed(1)); }
      hide();
      const peak = Math.max(...series);
      return { at: [me.x, me.y], radius, ability, vfx, base: +base.mean.toFixed(1), peak, ratio: +(peak / Math.max(1, base.mean)).toFixed(2), px: base.n, series };
    },
  };
  window.__VP__ = api;
  return true;
}

// ── stats from histograms ──────────────────────────────────────────────────────────────────────────
const pct = (hist, p, scale = 1) => {
  const n = hist.reduce((a, b) => a + b, 0);
  if (!n) return null;
  const want = p * n;
  let acc = 0;
  for (let i = 0; i < hist.length; i++) { acc += hist[i]; if (acc >= want) return +(i * scale).toFixed(1); }
  return +((hist.length - 1) * scale).toFixed(1);
};
const meanOf = (hist, scale = 1) => { let s = 0, n = 0; hist.forEach((c, i) => { s += c * i * scale; n += c; }); return n ? +(s / n).toFixed(2) : null; };
/** mean of the values at or above the p-th percentile */
const topMean = (hist, p, scale = 1) => {
  const n = hist.reduce((a, b) => a + b, 0);
  if (!n) return null;
  let need = n * (1 - p), s = 0, k = 0;
  for (let i = hist.length - 1; i >= 0 && need > 0; i--) { const take = Math.min(hist[i], need); s += take * i * scale; k += take; need -= take; }
  return k ? +(s / k).toFixed(1) : null;
};
const add = (a, b) => (a ? a.map((v, i) => v + b[i]) : b.slice());
const pool = (hists, ids) => {
  const o = { n: 0, luma: null, lstar: null, sat: null };
  for (const h of hists) for (const id of ids) {
    const e = h[id];
    if (!e || !e.n) continue;
    o.n += e.n; o.luma = add(o.luma, e.luma); o.lstar = add(o.lstar, e.lstar); o.sat = add(o.sat, e.sat);
  }
  return o.n ? o : null;
};
const lumaStats = (e, total) => e && {
  share: total ? +(e.n / total).toFixed(4) : undefined,
  p5: pct(e.luma, 0.05), p50: pct(e.luma, 0.5), p95: pct(e.luma, 0.95), p99: pct(e.luma, 0.99), mean: meanOf(e.luma),
  spread: +(pct(e.luma, 0.95) - pct(e.luma, 0.05)).toFixed(1),
  lstarP50: pct(e.lstar, 0.5, 0.5), sat: meanOf(e.sat, 0.01), satP50: pct(e.sat, 0.5, 0.01),
};

/** spots that follow the sim rather than the map: kept out of the region masks (see the header) */
const DYNAMIC_SPOTS = ['fight'];

function summarise(spots, C, fspots = {}) {
  const hists = Object.values(spots).map((s) => s.hist);
  const total = hists.reduce((a, h) => a + (h.frame?.n ?? 0), 0);
  const fixed = Object.entries(spots).filter(([k]) => !DYNAMIC_SPOTS.includes(k)).map(([, s]) => s.hist);
  const fixedTotal = fixed.reduce((a, h) => a + (h.frame?.n ?? 0), 0);
  const g = (name, ids) => lumaStats(pool(fixed, ids.map(String)), fixedTotal);
  const masks = {
    lane: g('lane', [C.lane]), walkable: g('walkable', [C.lane, C.plaza, C.seat]), verge: g('verge', [C.verge]),
    jungle: g('jungle', [C.jungle]), camp: g('camp', [C.camp]), plaza: g('plaza', [C.plaza]), seat: g('seat', [C.seat]), shadow: g('shadow', [C.shadow]),
    brush: g('brush', [C.brush]), grass: g('grass', [C.grass]), clutter: g('clutter', [C.clutter]), outside: g('outside', [C.outside]),
    wallFace: g('wallFace', [C.wallFace]), wallLip: g('wallLip', [C.wallLip]), wallTop: g('wallTop', [C.wallTop]),
    walls: g('walls', [C.wallFace, C.wallLip]), edge: g('edge', ['edge']), canopy: g('canopy', [C.canopy]), rock: g('rock', [C.rock]),
    landmark: g('landmark', [C.landmark]), lamp: g('lamp', [C.lamp]), water: g('water', [C.water]), sky: g('sky', [C.sky]),
    ground: g('ground', [C.lane, C.verge, C.jungle, C.camp, C.plaza, C.seat]),
  };
  for (const k of Object.keys(masks)) if (!masks[k]) delete masks[k];
  const frame = lumaStats(pool(hists, ['frame']), total);
  const envIds = Object.values(C).filter((v) => v < 20).map(String);
  const envN = pool(hists, envIds)?.n ?? 0;
  const e180 = pool(hists, ['env180'])?.n ?? 0, e180l = pool(hists, ['env180lamp'])?.n ?? 0;
  const fhists = [...hists, ...Object.values(fspots).map((s) => s.hist)];
  const fighter = pool(fhists, [String(C.fighter)]);
  const wick = pool(hists, [String(C.wick)]);
  const structure = pool(hists, [String(C.structure)]);
  const laneL = masks.lane?.lstarP50 ?? null;
  const monster = pool(hists, [String(C.monster)]);
  /** share of an L* histogram (0.5 steps) above L* `v` */
  const above = (h, v) => { let n = 0, t = 0; h.forEach((c, i) => { t += c; if (i * 0.5 > v) n += c; }); return t ? +(n / t).toFixed(4) : 0; };
  const fig = fighter && {
    px: fighter.n, top25: topMean(fighter.lstar, 0.75, 0.5), p75: pct(fighter.lstar, 0.75, 0.5), p50: pct(fighter.lstar, 0.5, 0.5), p25: pct(fighter.lstar, 0.25, 0.5),
    p95: pct(fighter.lstar, 0.95, 0.5), p99: pct(fighter.lstar, 0.99, 0.5), gt90: above(fighter.lstar, 90), lumaP95: pct(fighter.luma, 0.95),
  };
  if (fig && laneL != null) fig.overLane = +(fig.top25 - laneL).toFixed(1);
  // per fighter (pooled over the spots it appears in)
  if (fig) {
    const per = {};
    for (const s of [...Object.values(spots), ...Object.values(fspots)]) for (const [k, e] of Object.entries(s.hist)) {
      if (!k.startsWith('fig')) continue;
      const def = s.figs?.[Number(k.slice(3)) - 1] ?? k;
      const o = (per[def] ??= { n: 0, lstar: null });
      o.n += e.n; o.lstar = add(o.lstar, e.lstar);
    }
    fig.per = Object.fromEntries(Object.entries(per).filter(([, o]) => o.n >= 400).map(([d, o]) => [d, { px: o.n, top25: topMean(o.lstar, 0.75, 0.5), p75: pct(o.lstar, 0.75, 0.5), p50: pct(o.lstar, 0.5, 0.5), p25: pct(o.lstar, 0.25, 0.5), gt90: above(o.lstar, 90) }]));
    fig.maxGt90 = Math.max(0, ...Object.values(fig.per).map((o) => o.gt90));
    const tops = Object.values(fig.per).map((o) => o.top25).sort((a, b) => a - b);
    fig.medianTop25 = tops.length ? tops[Math.floor(tops.length / 2)] : null;
  }
  return {
    frame, masks, maskSpots: Object.keys(spots).filter((k) => !DYNAMIC_SPOTS.includes(k)),
    env180: { env: envN, other: e180, lamp: e180l, otherShare: envN ? +(e180 / envN).toFixed(5) : 0, lampShareOfFrame: total ? +(e180l / total).toFixed(5) : 0,
      byClass: Object.fromEntries([...new Set(hists.flatMap((h) => Object.keys(h)).filter((k) => k.startsWith('env180_')))].map((k) => [k.slice(7), pool(hists, [k])?.n ?? 0])) },
    fighters: fig,
    wicks: wick && { px: wick.n, top25: topMean(wick.lstar, 0.75, 0.5), p95: pct(wick.lstar, 0.95, 0.5), lumaP95: pct(wick.luma, 0.95) },
    monsters: monster && { px: monster.n, top25: topMean(monster.lstar, 0.75, 0.5), p95: pct(monster.lstar, 0.95, 0.5) },
    structures: structure && { px: structure.n, top25: topMean(structure.lstar, 0.75, 0.5), p95: pct(structure.lstar, 0.95, 0.5) },
    perSpot: Object.fromEntries(Object.entries(spots).map(([k, s]) => {
      const f = s.hist.frame; const ln = s.hist[String(C.lane)];
      const wk = pool([s.hist], [C.lane, C.plaza, C.seat].map(String));
      return [k, { at: s.at, frameP50: pct(f.luma, 0.5), frameP95: pct(f.luma, 0.95), frameP99: pct(f.luma, 0.99), laneP50: ln ? pct(ln.luma, 0.5) : null,
        walkableP5: wk ? pct(wk.luma, 0.05) : null, walkableP95: wk ? pct(wk.luma, 0.95) : null, inMasks: !DYNAMIC_SPOTS.includes(k) }];
    })),
  };
}

/** env F3: pool the fog A/B histograms over the spots, per class name */
function summariseFog(perSpot, C) {
  const names = Object.fromEntries(Object.entries(C).map(([k, v]) => [String(v), k]));
  const pooled = {};
  for (const h of Object.values(perSpot)) for (const [k, e] of Object.entries(h)) {
    const name = k === 'frame' ? 'frame' : names[k] ?? `c${k}`;
    const o = (pooled[name] ??= { n: 0, ratio: null, lstar: null, litSum: 0, darkSum: 0 });
    o.n += e.n; o.ratio = add(o.ratio, e.ratio); o.lstar = add(o.lstar, e.lstar); o.litSum += e.litSum; o.darkSum += e.darkSum;
  }
  const rp = (hist, p) => { const n = hist.reduce((a, b) => a + b, 0); let acc = 0; for (let i = 0; i < hist.length; i++) { acc += hist[i]; if (acc >= p * n) return +((i + 0.5) / 200).toFixed(3); } return 2; };
  const out = {};
  for (const [k, o] of Object.entries(pooled)) {
    if (o.n < 200) continue;
    out[k] = { px: o.n, p25: rp(o.ratio, 0.25), p50: rp(o.ratio, 0.5), p75: rp(o.ratio, 0.75), meanRatio: +(o.darkSum / o.litSum).toFixed(3), unseenLstarP50: pct(o.lstar, 0.5, 0.5) };
  }
  return out;
}

function fogVerdict(f) {
  const v = {};
  for (const k of ['lane', 'jungle']) {
    const e = f[k];
    if (!e) continue;
    v[`fog_${k}`] = `p50 ${e.p50} ${e.p50 >= FOG_BAND[0] && e.p50 <= FOG_BAND[1] ? 'PASS' : 'FAIL'} (${FOG_BAND[0]}-${FOG_BAND[1]})`;
  }
  return v;
}

/** env m1: per base spot, the plaza's saturation and the structures' values against the fighters' */
function summariseBases(bspots, C, fighters) {
  const out = {};
  for (const [k, sp] of Object.entries(bspots)) {
    const h = sp.hist;
    const plaza = pool([h], [String(C.plaza)]);
    const ground = pool([h], [C.lane, C.verge, C.plaza, C.seat].map(String));
    const st = pool([h], [String(C.structure)]);
    const gt = (hist, v) => { let n = 0, t = 0; hist.forEach((c, i) => { t += c; if (i > v) n += c; }); return t ? +(n / t).toFixed(4) : 0; };
    out[k] = {
      at: sp.at,
      plaza: plaza && { px: plaza.n, satP50: pct(plaza.sat, 0.5, 0.01), sat: meanOf(plaza.sat, 0.01), lumaP50: pct(plaza.luma, 0.5), lstarP50: pct(plaza.lstar, 0.5, 0.5) },
      ground: ground && { px: ground.n, satP50: pct(ground.sat, 0.5, 0.01), sat: meanOf(ground.sat, 0.01) },
      structures: st && { px: st.n, lstarP95: pct(st.lstar, 0.95, 0.5), lumaP95: pct(st.luma, 0.95), above180: gt(st.luma, 180), top25: topMean(st.lstar, 0.75, 0.5) },
      fighterLumaP95: fighters?.lumaP95 ?? null,
    };
  }
  return out;
}

function baseVerdict(bases) {
  const ok = (c) => (c ? 'PASS' : 'FAIL');
  const v = {};
  for (const [k, b] of Object.entries(bases ?? {})) {
    const p = b.plaza ?? b.ground;
    if (p) v[`${k}_plaza`] = `saturation ${p.sat} ${ok(p.sat >= 0.17 && p.sat <= 0.40)} (0.17-0.40; mean HSV, as groundSat)`;
    if (b.structures) {
      const s = b.structures, f = b.fighterLumaP95;
      v[`${k}_structure`] = `L* p95 ${s.lstarP95} ${ok(s.lstarP95 <= 80)} (<= 80); luma p95 ${s.lumaP95} vs fighters ${f ?? '-'} ${f == null ? '' : ok(s.lumaP95 <= f)}; above 180: ${(s.above180 * 100).toFixed(1)} %`;
    }
  }
  return v;
}

function verdict(s, flash, map) {
  const ok = (c) => (c ? 'PASS' : 'FAIL');
  const v = {};
  if (s.masks.lane) v.laneP50 = `${s.masks.lane.p50} ${ok(s.masks.lane.p50 >= 85 && s.masks.lane.p50 <= 100)} (85-100)`;
  if (s.masks.walkable) v.walkableSpread = `${s.masks.walkable.spread} ${ok(s.masks.walkable.spread <= 45)} (<= 45)`;
  if (s.masks.lane) v.laneSpread = `${s.masks.lane.spread} ${ok(s.masks.lane.spread <= 45)} (<= 45)`;
  // FRAY: the plate is the lane and fills ~86 % of the frame, so its median follows the plate (tokens grade.maps.fray.frameLuma)
  v.frameP50 = map === 'fray' ? `${s.frame.p50} ${ok(s.frame.p50 <= 90)} (<= 90, FRAY: follows the plate)` : `${s.frame.p50} ${ok(s.frame.p50 >= 55 && s.frame.p50 <= 75)} (55-75)`;
  v.frameP95 = `${s.frame.p95} ${ok(s.frame.p95 <= 130)} (<= 130)`;
  v.frameP99 = `${s.frame.p99} ${ok(s.frame.p99 <= 160)} (<= 160)`;
  v.env180 = `other ${(s.env180.otherShare * 100).toFixed(3)} % of env, lamps ${(s.env180.lampShareOfFrame * 100).toFixed(3)} % of frame ${ok(s.env180.otherShare <= 0.0005 && s.env180.lampShareOfFrame <= 0.02)}`;
  if (s.masks.ground) v.groundSat = `${s.masks.ground.sat} ${ok(s.masks.ground.sat >= 0.17 && s.masks.ground.sat <= 0.40)} (0.17-0.40; spec 0.22-0.35)`;
  if (s.fighters) v.fighterTop25 = `${s.fighters.top25} ${ok(s.fighters.top25 >= 70 && s.fighters.top25 <= 85)} (70-85), over lane ${s.fighters.overLane} ${ok((s.fighters.overLane ?? 99) >= 30)} (>= 30)`;
  if (s.fighters) v.fighterBlowout = `above L* 90: ${(s.fighters.gt90 * 100).toFixed(2)} % of fighter pixels ${ok(s.fighters.gt90 < 0.02)} (< 2 %), worst fighter ${(s.fighters.maxGt90 * 100).toFixed(1)} %, p99 ${s.fighters.p99}`;
  if (s.wicks) v.wickTop25 = `${s.wicks.top25} (info: <= 65, WICK lane)`;
  if (s.monsters) v.monsterTop25 = `${s.monsters.top25} (info)`;
  if (flash) v.flash = `${flash.ratio}x ${ok(flash.ratio >= 2.0)} (>= 2.0x)`;
  return v;
}

// ── run ──────────────────────────────────────────────────────────────────────────────────────────────
const REPORT = join(HERE, '_reports', 'value_probe.json');
mkdirSync(dirname(REPORT), { recursive: true });
const report = existsSync(REPORT) ? JSON.parse(readFileSync(REPORT, 'utf8')) : { note: 'r12 B5 environment value probe (_harness/value_probe.mjs)', runs: {} };
report.runs[TAG] ??= {};
for (const map of MAPS) for (const tier of TIERS) {
  const [w, h] = RES[tier] ?? RES.high;
  const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=${map}&q=${tier}&t=${T}&seed=${SEED}&dev=1&hud=0&manual=1${YOU ? `&you=${YOU}` : ''}`, { wait: false, hmr: false, width: w, height: h });
  try {
    await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 180000 });
    const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
    await B((b) => b.frames(60, 1 / 30));
    await page.waitForTimeout(5000);                                       // async props, landmarks, textures
    await B((b) => b.frames(6, 1 / 30));
    await page.evaluate(`(${install.toString()})()`);
    const V = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VP__, x), [fn.toString(), a]);
    const C = await V((v) => v.C);
    const spots = await V((v) => v.spots());
    await V((v) => v.prep());
    let fog = null;
    if (FOG === '1' || FOG_ONLY) {
      const per = {};
      for (const [k, at] of Object.entries(spots)) {
        per[k] = await V((v, a) => v.fogAB(a[0], a[1]), at);
        if (SHOTS) await shot(page, `value_${map}_${tier}_${TAG}_${k}_unseen`);
        await V((v) => v.fogOff());
        if (SHOTS) await shot(page, `value_${map}_${tier}_${TAG}_${k}_lit`);
      }
      fog = summariseFog(per, C);
      const fv = fogVerdict(fog);
      console.log(`\n${map} ${tier} [${TAG}] fog A/B (unseen / lit display luma, p50 [p25-p75], mean, unseen L* p50)`);
      for (const [k, e] of Object.entries(fog)) console.log(`  ${k.padEnd(9)} ${String(e.px).padStart(8)} px  p50 ${e.p50} [${e.p25}-${e.p75}]  mean ${e.meanRatio}  L* ${e.unseenLstarP50}`);
      for (const [k, v] of Object.entries(fv)) console.log(`  ${k}: ${v}`);
      if (FOG_ONLY) {
        report.runs[TAG][`${map}_${tier}`] = { tier, viewport: [w, h], t: T, seed: SEED, spots: Object.keys(spots), fog, verdict: fv, logs: logs.filter((l) => !/favicon|toNonIndexed/.test(l)).slice(0, 12) };
        report.generated = new Date().toISOString();
        writeFileSync(REPORT, JSON.stringify(report, null, 1));
        continue;
      }
    }
    const res = {};
    for (const [k, at] of Object.entries(spots)) {
      const m = await V((v, a) => v.measureAt(a.at[0], a.at[1], a.mask), { at, mask: MASKS });
      if (SHOTS) await shot(page, `value_${map}_${tier}_${TAG}_${k}`);
      if (m.maskPng) writeFileSync(join(HERE, '_shots', `value_${map}_${tier}_${TAG}_${k}_mask.png`), Buffer.from(m.maskPng.split(',')[1], 'base64'));
      res[k] = { at: at.map((x) => +x.toFixed(1)), hist: m.hist, figs: m.figs };
    }
    const fres = {};
    const fspots = await V((v) => v.fighterSpots());
    for (const [k, at] of Object.entries(fspots)) {
      const m = await V((v, a) => v.measureAt(a.at[0], a.at[1], false), { at });
      if (FSHOTS) await shot(page, `value_${map}_${tier}_${TAG}_${k}`);
      fres[k] ={ at: at.map((x) => +x.toFixed(1)), hist: m.hist, figs: m.figs };
    }
    const bres = {};
    const bspots = await V((v) => v.baseSpots());
    for (const [k, at] of Object.entries(bspots)) {
      const m = await V((v, a) => v.measureAt(a.at[0], a.at[1], false), { at });
      if (SHOTS) await shot(page, `value_${map}_${tier}_${TAG}_${k}`);
      bres[k] = { at: at.map((x) => +x.toFixed(1)), hist: m.hist, figs: m.figs };
    }
    let flash = null;
    if (FLASH) flash = await V((v) => v.flash('marund_domefall', 'marund_ult_domefall', 3.5));
    if (FLASH && VFX_CAPS.length) {
      flash.byCap = {};
      for (const cap of VFX_CAPS) {
        // a fresh landing: the director's once-per-cast beat bookkeeping forgets the last one (else no envelope)
        const f = await page.evaluate(([c]) => {
          const R = window.__VALE_BENCH__.renderer, D = R.director, keep = R.vfx.liftCap;
          for (const k of ['beats', 'lastPulse', 'pulseQ', 'castAt']) D[k]?.clear?.();
          R.vfx.liftCap = c;
          try { return window.__VP__.flash('marund_domefall', 'marund_ult_domefall', 3.5); } finally { R.vfx.liftCap = keep; }
        }, [cap]);
        flash.byCap[cap === null ? 'off' : String(cap)] = f ? { base: f.base, peak: f.peak, ratio: f.ratio } : null;
      }
      console.log(`  flash by VFX lift cap: ${Object.entries(flash.byCap).map(([k, f]) => `${k} ${f?.ratio}x (${f?.base} -> ${f?.peak})`).join(' · ')}`);
    }
    const s = summarise(res, C, fres);
    const bases = summariseBases(bres, C, s.fighters);
    const out = { tier, viewport: [w, h], t: T, seed: SEED, spots: Object.keys(res), ...s, bases, flash, fog, verdict: { ...verdict(s, flash, map), ...baseVerdict(bases), ...(fog ? fogVerdict(fog) : {}) }, logs: logs.filter((l) => !/favicon|toNonIndexed/.test(l)).slice(0, 12) };
    report.runs[TAG][`${map}_${tier}`] = out;
    report.generated = new Date().toISOString();
    writeFileSync(REPORT, JSON.stringify(report, null, 1));
    console.log(`\n${map} ${tier} [${TAG}]  frame p5/p50/p95/p99 ${s.frame.p5}/${s.frame.p50}/${s.frame.p95}/${s.frame.p99}`);
    for (const [k, m] of Object.entries(s.masks)) console.log(`  ${k.padEnd(9)} share ${(m.share * 100).toFixed(1).padStart(5)} %  luma p5 ${m.p5} p50 ${m.p50} p95 ${m.p95} p99 ${m.p99}  L* ${m.lstarP50}  sat ${m.sat}`);
    console.log(`  per spot walkable p5-p95 (* = not in the masks): ${Object.entries(s.perSpot).map(([k, p]) => `${k}${p.inMasks ? '' : '*'} ${p.walkableP5 ?? '-'}-${p.walkableP95 ?? '-'}`).join('  ')}`);
    console.log('  fighters', JSON.stringify(s.fighters), ' wicks', JSON.stringify(s.wicks));
    console.log('  env>180', JSON.stringify(s.env180));
    for (const [k, b] of Object.entries(bases)) console.log(`  ${k} at ${b.at}: plaza ${JSON.stringify(b.plaza)} structures ${JSON.stringify(b.structures)}`);
    if (flash) console.log('  flash', flash.base, '->', flash.peak, `${flash.ratio}x`);
    for (const [k, v] of Object.entries(out.verdict)) console.log(`  ${k}: ${v}`);
  } finally {
    await browser.close();
  }
}
console.log(`\nreport: ${REPORT}`);
