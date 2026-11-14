/**
 * CRESTBOUND sign check — the "a sign is read, never fought" gate.
 * ===========================================================================
 * Pure Node, no browser. Imports every course's DATA module and judges each
 * `{kind:'text'}` board the way the playtest agents did, from where a player
 * actually stands: the follow camera at every checkpoint (and the spawn).
 *
 * WHAT IT PROVES, per course:
 *
 *   FAIL  runs-off-frame   a board that fills > 5 % of the boot/checkpoint frame
 *                          and crosses the frame edge, nearer than 12 m — the
 *                          'TWO STONES ACRO' class (azure-3 #7, ember-3 #5)
 *   WARN  coin-over-text   an expanded coin in the reader's sight band in front
 *                          of a plate — the 'COME D_WN HERE' class (rime-3 #4).
 *                          course.js `_coinKeepOut` moves it at build time, so
 *                          the plate reads; the author's coin line has changed
 *   WARN  hides-hero       the camera->hero line at a checkpoint pierces a board:
 *                          the runtime's occluder fade (course.js SIGN_OCC_*)
 *                          keeps Nim visible, but the plate is on the walked
 *                          line and worth moving (keep K8, rime-1 #5, azure-3 #6)
 *   WARN  faces-away       the plate's back is what its nearest checkpoint sees
 *                          (rime-3 #6 — rot is a FACING, +Z at 0, not a heading)
 *   INFO  wrapped          clauses that cannot stay on one line at >= 74 % of
 *                          their cap and wrap by measured width (course.js
 *                          TEXT_FIT_MIN) — copy worth shortening
 *
 * The board model mirrors course.js `_prepareTexts` / `_bakeBoard`: objects
 * within 0.45 m in plan, 1.8 m in height and the same facing become ONE plate;
 * `size` is a cap height; a line is capped at TEXT_MAX_LINE_M = 3.7 m; the plate
 * is a lip wider than the paint. Glyph widths are estimated (no canvas here) at
 * 0.56 em per glyph plus tracking, which is within ~8 % of the Rajdhani bake.
 *
 * The camera model is the follow camera at rest: TUNE.cam.dist behind the hero
 * along the checkpoint's heading, TUNE.cam.height above the feet, looking at the
 * chest, TUNE.cam.fov vertical, a 16:9 frame.
 *
 *   node _harness/signcheck.mjs                 # every course + the Keep
 *   node _harness/signcheck.mjs rime-3 azure-3  # a subset
 *   node _harness/signcheck.mjs --json out.json
 *
 * Exit 0 = no FAIL anywhere.
 */
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DATA_DIR = join(ROOT, 'runtime', 'data');

/* ── the same numbers course.js bakes with ─────────────────────────────── */
const TEXT_MAX_LINE_M = 3.7;
const TEXT_FIT_MIN = 0.74;
const TEXT_TRACK_EM = 0.035;
const TEXT_CAP_EM = 0.70;
const TEXT_LINE_PITCH = 1.34;
const TEXT_PAD_M = 0.15;
const TEXT_FRAME_M = 0.09;
const TEXT_MOUNT_OUT = 0.14;
const TEXT_GROUP_XZ = 0.45;
const TEXT_GROUP_DY = 1.8;
const TEXT_MEMBER_GAP = 0.55;
const GLYPH_EM = 0.56;            // estimated Rajdhani 700 uppercase advance, em

/* ── the camera at rest ────────────────────────────────────────────────── */
let CAM = { dist: 6.8, height: 1.55, fov: 58 };
try {
  const t = await import(pathToFileURL(join(ROOT, 'runtime', 'core', 'tuning.js')).href);
  if (t && t.TUNE && t.TUNE.cam) CAM = { dist: t.TUNE.cam.dist, height: t.TUNE.cam.height, fov: t.TUNE.cam.fov };
} catch (e) { /* the defaults above are the contract's */ }
const ASPECT = 16 / 9;
const CHEST = 0.82;
const HERO_HALF_W = 0.45;

const FRAME_AREA_MIN = 0.05;      // of the frame, before running off the edge counts
const FRAME_NEAR_M = 12;          // boards farther than this may straddle the edge
const COIN_FRONT_M = 3.0;         // metres in front of a plate the sight band reaches
const FACE_CP_R = 22;             // metres: a checkpoint this near is the plate's reader

/* ── helpers ───────────────────────────────────────────────────────────── */
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const v3 = (a) => (Array.isArray(a) ? [+a[0] || 0, +a[1] || 0, +a[2] || 0] : [0, 0, 0]);

function lineWidthM(text, capM) {
  const fs = capM / TEXT_CAP_EM;
  return text.length * fs * GLYPH_EM + fs * TEXT_TRACK_EM * Math.max(0, text.length - 1);
}

/** course.js `_textLines`: clauses first, fit before wrap, measured balance. */
function textLines(o, head) {
  const out = [];
  const size = fin(o.size) ? Math.min(4, Math.max(0.12, o.size)) : 0.42;
  const cap = head ? size * 0.72 : size * 0.95;
  /* per-board width cap (course.js `maxW`): a board hung in a narrow place says
     how wide it may be, and its clauses wrap to that instead of to the game's
     widest line. */
  const maxW = fin(o.maxW) ? Math.min(TEXT_MAX_LINE_M, Math.max(0.8, o.maxW)) : TEXT_MAX_LINE_M;
  let wrapped = 0;
  const raw = String(o.text).split('\n');
  for (const r of raw) {
    for (const clause of r.split(/\s+·\s+/)) {
      for (const sentence of clause.split(/(?<=[.!?])\s+(?=\S)/)) {
        const words = sentence.trim().split(/\s+/).filter((w) => w.length);
        if (!words.length) continue;
        const text = words.join(' ');
        const wM = lineWidthM(text, cap);
        if (wM <= maxW / TEXT_FIT_MIN) { out.push({ text, cap, head, maxW }); continue; }
        wrapped++;
        const n = Math.ceil(wM / maxW);
        const target = wM / n;
        let line = '', made = 0;
        for (let w = 0; w < words.length; w++) {
          const cand = line ? line + ' ' + words[w] : words[w];
          const left = words.length - w, linesLeft = n - made;
          const candW = line ? lineWidthM(cand, cap) : 0;
          if (line && linesLeft > 1 && (candW > target * 1.06 || left <= linesLeft - 1)) {
            out.push({ text: line, cap, head, maxW }); made++; line = words[w];
          } else line = cand;
        }
        if (line) out.push({ text: line, cap, head, maxW });
      }
    }
  }
  return { lines: out, wrapped };
}

/** course.js `_prepareTexts` + `_buildText`: group, size, place, face. */
function boardsOf(def) {
  const objs = Array.isArray(def.objects) ? def.objects : [];
  const groups = [];
  const yawOf = (o) => (Array.isArray(o.rot) && fin(o.rot[1])) ? o.rot[1] : (fin(o.yaw) ? o.yaw : null);
  objs.forEach((o, i) => {
    if (!o || o.kind !== 'text' || !Array.isArray(o.p) || typeof o.text !== 'string') return;
    const yaw = yawOf(o);
    let g = null;
    for (const c of groups) {
      if (Math.abs(c.p[0] - o.p[0]) > TEXT_GROUP_XZ || Math.abs(c.p[2] - o.p[2]) > TEXT_GROUP_XZ) continue;
      if (Math.abs(c.p[1] - o.p[1]) > TEXT_GROUP_DY) continue;
      if ((c.yaw === null) !== (yaw === null)) continue;
      if (c.yaw !== null && Math.abs(c.yaw - yaw) > 0.05) continue;
      g = c; break;
    }
    if (!g) { g = { p: v3(o.p), yaw, members: [] }; groups.push(g); }
    g.members.push({ index: i, o });
  });
  const sp = def.spawn && Array.isArray(def.spawn.p) ? v3(def.spawn.p) : null;
  return groups.map((g) => {
    g.members.sort((a, b) => (b.o.p[1] - a.o.p[1]) || (a.index - b.index));
    let head = g.members[0];
    for (const m of g.members) {
      const sm = fin(m.o.size) ? m.o.size : 0.42, sh = fin(head.o.size) ? head.o.size : 0.42;
      if (sm > sh + 1e-6) head = m;
    }
    let wM = 0, hM = TEXT_PAD_M * 2, wrapped = 0;
    const lines = [];
    g.members.forEach((m, mi) => {
      const isHead = m === head;
      const r = textLines(m.o, isHead);
      wrapped += r.wrapped;
      r.lines.forEach((L, li) => {
        let w = lineWidthM(L.text, L.cap);
        let cap = L.cap;
        const lim = fin(L.maxW) ? L.maxW : TEXT_MAX_LINE_M;
        if (w > lim) { cap *= lim / w; w = lim; }
        if (w > wM) wM = w;
        hM += cap * TEXT_LINE_PITCH + (isHead ? cap * 0.42 : 0) + ((li === 0 && mi > 0 && !isHead) ? cap * TEXT_MEMBER_GAP : 0);
        lines.push(L.text);
      });
    });
    wM += TEXT_PAD_M * 2;
    let top = -Infinity, bot = Infinity;
    for (const m of g.members) {
      const ms = fin(m.o.size) ? m.o.size : 0.42;
      top = Math.max(top, m.o.p[1] + ms * 0.5);
      bot = Math.min(bot, m.o.p[1] - ms * 0.5);
    }
    const c = [g.p[0], (top + bot) * 0.5, g.p[2]];
    let yaw = g.yaw;
    if (yaw === null) yaw = sp ? Math.atan2(sp[0] - c[0], sp[2] - c[2]) : 0;
    const n = [Math.sin(yaw), 0, Math.cos(yaw)];            // the FACE (+Z at rot 0)
    const u = [Math.cos(yaw), 0, -Math.sin(yaw)];           // along the plate
    c[0] += n[0] * TEXT_MOUNT_OUT; c[2] += n[2] * TEXT_MOUNT_OUT;
    return {
      index: head.index, label: String(head.o.text).slice(0, 34),
      c, n, u, hw: (wM + TEXT_FRAME_M * 2) * 0.5, hh: (hM + TEXT_FRAME_M * 2) * 0.5,
      lines, wrapped,
    };
  });
}

/** reachcheck's coin expansion, verbatim in spirit: points, rings, arcs, lines, grids. */
function expandCoins(list) {
  const out = [];
  for (const c of list || []) {
    if (!c) continue;
    if (c.ring) {
      const r = c.ring, ctr = v3(r.c), n = Math.max(1, r.n | 0 || 8), rad = r.r || 2;
      const y = fin(r.y) ? r.y : ctr[1], a0 = fin(r.from) ? r.from : 0;
      for (let i = 0; i < n; i++) { const a = a0 + (i / n) * Math.PI * 2; out.push([ctr[0] + Math.cos(a) * rad, y, ctr[2] + Math.sin(a) * rad]); }
    } else if (c.arc) {
      const r = c.arc, ctr = v3(r.c), n = Math.max(1, r.n | 0 || 6), rad = r.r || 2;
      const y = fin(r.y) ? r.y : ctr[1], a0 = fin(r.from) ? r.from : 0, a1 = fin(r.to) ? r.to : Math.PI;
      for (let i = 0; i < n; i++) { const a = a0 + (a1 - a0) * (n === 1 ? 0 : i / (n - 1)); out.push([ctr[0] + Math.cos(a) * rad, y, ctr[2] + Math.sin(a) * rad]); }
    } else if (c.line) {
      const l = c.line, a = v3(l.a), b = v3(l.b), n = Math.max(2, l.n | 0 || 5);
      for (let i = 0; i < n; i++) { const t = i / (n - 1); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
    } else if (c.grid) {
      const g = c.grid, o = v3(g.p), nx = Math.max(1, g.nx | 0 || 3), nz = Math.max(1, g.nz | 0 || 3), sx = g.dx || 2, sz = g.dz || 2;
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) out.push([o[0] + i * sx, o[1], o[2] + j * sz]);
    } else out.push(v3(c.p !== undefined ? c.p : c));
  }
  return out;
}

/** Follow camera at rest for a pad {p, yaw}: {eye, fwd, right, up, hero}. */
function cameraAt(pad) {
  const p = v3(pad.p), yaw = fin(pad.yaw) ? pad.yaw : 0;
  const h = [-Math.sin(yaw), 0, -Math.cos(yaw)];             // heading, yaw 0 = -Z
  const eye = [p[0] - h[0] * CAM.dist, p[1] + CAM.height, p[2] - h[2] * CAM.dist];
  const tgt = [p[0], p[1] + CHEST, p[2]];
  let f = [tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]];
  const fl = Math.hypot(f[0], f[1], f[2]) || 1; f = f.map((v) => v / fl);
  let r = [f[2], 0, -f[0]];                                   // f x up
  const rl = Math.hypot(r[0], r[2]) || 1; r = [r[0] / rl, 0, r[2] / rl];
  const up = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { eye, f, r, up, hero: tgt, feet: p };
}

/** Project a world point: [ndcX, ndcY, depth]. */
function project(cam, w) {
  const d = [w[0] - cam.eye[0], w[1] - cam.eye[1], w[2] - cam.eye[2]];
  const z = d[0] * cam.f[0] + d[1] * cam.f[1] + d[2] * cam.f[2];
  const x = d[0] * cam.r[0] + d[1] * cam.r[1] + d[2] * cam.r[2];
  const y = d[0] * cam.up[0] + d[1] * cam.up[1] + d[2] * cam.up[2];
  const t = Math.tan((CAM.fov * Math.PI / 180) * 0.5);
  return [x / (Math.max(z, 1e-3) * t * ASPECT), y / (Math.max(z, 1e-3) * t), z];
}

function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a) * 0.5;
}

/* ── the checks ────────────────────────────────────────────────────────── */
function checkCourse(id, def) {
  const problems = [], warnings = [], info = [];
  const boards = boardsOf(def);
  const pads = [];
  if (def.spawn && Array.isArray(def.spawn.p)) pads.push({ id: 'spawn', p: def.spawn.p, yaw: def.spawn.yaw });
  for (const cp of (Array.isArray(def.checkpoints) ? def.checkpoints : [])) {
    if (cp && Array.isArray(cp.p)) pads.push({ id: cp.id || ('cp' + pads.length), p: cp.p, yaw: cp.yaw });
  }
  const coins = expandCoins(def.coins);

  for (const b of boards) {
    const corners = [
      [b.c[0] + b.u[0] * b.hw, b.c[1] + b.hh, b.c[2] + b.u[2] * b.hw],
      [b.c[0] - b.u[0] * b.hw, b.c[1] + b.hh, b.c[2] - b.u[2] * b.hw],
      [b.c[0] - b.u[0] * b.hw, b.c[1] - b.hh, b.c[2] - b.u[2] * b.hw],
      [b.c[0] + b.u[0] * b.hw, b.c[1] - b.hh, b.c[2] + b.u[2] * b.hw],
    ];
    const tag = `objects[${b.index}] '${b.label}' at [${b.c.map((v) => v.toFixed(1)).join(', ')}] ` +
                `(${(b.hw * 2).toFixed(2)} x ${(b.hh * 2).toFixed(2)} m)`;

    for (const pad of pads) {
      const cam = cameraAt(pad);
      /* hides-hero: the camera->chest line pierces the plate */
      const segd = [cam.hero[0] - cam.eye[0], cam.hero[1] - cam.eye[1], cam.hero[2] - cam.eye[2]];
      const denom = b.n[0] * segd[0] + b.n[2] * segd[2];
      if (Math.abs(denom) > 1e-6) {
        const s = (b.n[0] * (b.c[0] - cam.eye[0]) + b.n[2] * (b.c[2] - cam.eye[2])) / denom;
        if (s > 0.02 && s < 0.985) {
          const hit = [cam.eye[0] + segd[0] * s, cam.eye[1] + segd[1] * s, cam.eye[2] + segd[2] * s];
          const lat = Math.abs((hit[0] - b.c[0]) * b.u[0] + (hit[2] - b.c[2]) * b.u[2]);
          const ver = Math.abs(hit[1] - b.c[1]);
          if (lat < b.hw + HERO_HALF_W && ver < b.hh + HERO_HALF_W) {
            warnings.push(`hides-hero   ${tag} stands between the ${pad.id} camera and Nim ` +
                          `(the occluder fade keeps him visible; the plate is on the walked line)`);
          }
        }
      }
      /* runs-off-frame: big, near, and cut by the frame edge */
      const pr = corners.map((w) => project(cam, w));
      if (pr.every((q) => q[2] > 0.3) && pr[0][2] < FRAME_NEAR_M) {
        const inside = pr.filter((q) => Math.abs(q[0]) <= 1 && Math.abs(q[1]) <= 1).length;
        const area = polyArea(pr.map((q) => [Math.max(-1, Math.min(1, q[0])), Math.max(-1, Math.min(1, q[1]))])) / 4;
        if (inside > 0 && inside < 4 && area > FRAME_AREA_MIN) {
          problems.push(`runs-off-frame ${tag} fills ${(area * 100).toFixed(0)} % of the ${pad.id} frame and is cut by its edge ` +
                        `(${pr[0][2].toFixed(1)} m from the lens)`);
        }
      }
    }

    /* coin-over-text: the runtime moves such a coin out of the band at build
       (course.js `_coinKeepOut`), so this is a WARN — the author's line is
       still worth a look, because the coin no longer sits where it was drawn */
    let over = 0;
    for (const q of coins) {
      const d = [q[0] - b.c[0], q[1] - b.c[1], q[2] - b.c[2]];
      const front = d[0] * b.n[0] + d[2] * b.n[2];
      if (front < 0.05 || front > COIN_FRONT_M) continue;
      const lat = Math.abs(d[0] * b.u[0] + d[2] * b.u[2]);
      if (lat > b.hw + 0.15 || Math.abs(d[1]) > b.hh + 0.25) continue;
      over++;
      if (over === 1) warnings.push(`coin-over-text ${tag}: coin at [${q.map((v) => v.toFixed(1)).join(', ')}] sits ` +
                                    `${front.toFixed(2)} m in front of the lettering (the runtime moves it)`);
    }
    if (over > 1) warnings[warnings.length - 1] += ` (+${over - 1} more)`;

    /* faces-away: the plate shows its back to its nearest pad AND to that
       pad's camera (a board behind a pad facing the lens reads in the boot
       frame — that is the 'briefing board' pattern, not an inversion) */
    let near = null, nearD = FACE_CP_R, anyFront = false;
    for (const pad of pads) {
      const p = v3(pad.p);
      const cam = cameraAt(pad);
      const dx = p[0] - b.c[0], dz = p[2] - b.c[2];
      const d = Math.hypot(dx, dz);
      if (d > FACE_CP_R) continue;
      const front = (dx * b.n[0] + dz * b.n[2]) / Math.max(d, 1e-3);
      const ex = cam.eye[0] - b.c[0], ez = cam.eye[2] - b.c[2];
      const frontCam = (ex * b.n[0] + ez * b.n[2]) / Math.max(Math.hypot(ex, ez), 1e-3);
      const f = Math.max(front, frontCam);
      if (f > 0.1) anyFront = true;
      if (d < nearD) { nearD = d; near = { pad, front: f }; }
    }
    if (near && near.front < -0.15 && !anyFront) {
      warnings.push(`faces-away   ${tag} shows its back to ${near.pad.id} ${nearD.toFixed(1)} m away and to its camera, ` +
                    `and no pad within ${FACE_CP_R} m sees its face — rot is a FACING (+Z at 0), not a heading`);
    }
    if (b.wrapped) info.push(`wrapped      ${tag}: ${b.wrapped} clause(s) wider than ${(TEXT_MAX_LINE_M / TEXT_FIT_MIN).toFixed(1)} m wrap`);
  }
  return { id, boards: boards.length, pads: pads.length, coins: coins.length, problems, warnings, info };
}

/* ── run ───────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
let jsonOut = null;
const only = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--json') jsonOut = argv[++i];
  else only.push(argv[i]);
}

let ids = [];
try {
  const idx = await import(pathToFileURL(join(DATA_DIR, 'index.js')).href);
  for (const r of idx.REALMS || []) ids.push(...r.courses);
  ids.push(idx.KEEP_ID || 'keep');
} catch (e) {
  ids = readdirSync(join(DATA_DIR, 'courses')).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, ''));
  if (existsSync(join(DATA_DIR, 'keep.js'))) ids.push('keep');
}
if (only.length) ids = ids.filter((id) => only.includes(id));

const reports = [];
for (const id of ids) {
  const file = id === 'keep' ? join(DATA_DIR, 'keep.js') : join(DATA_DIR, 'courses', id + '.js');
  try {
    const mod = await import(pathToFileURL(file).href);
    reports.push(checkCourse(id, mod.default || mod));
  } catch (e) {
    reports.push({ id, boards: 0, pads: 0, coins: 0, problems: [`import failed: ${e && e.message}`], warnings: [], info: [] });
  }
}

console.log('course      boards pads coins  FAIL WARN INFO');
for (const r of reports) {
  console.log(`${r.id.padEnd(11)} ${String(r.boards).padStart(6)} ${String(r.pads).padStart(4)} ${String(r.coins).padStart(5)}  ` +
              `${String(r.problems.length).padStart(4)} ${String(r.warnings.length).padStart(4)} ${String(r.info.length).padStart(4)}`);
}
for (const r of reports) {
  if (!r.problems.length && !r.warnings.length && !r.info.length) continue;
  console.log(`\n== ${r.id}`);
  for (const p of r.problems) console.log('  FAIL ' + p);
  for (const w of r.warnings) console.log('  warn ' + w);
  for (const i of r.info) console.log('  info ' + i);
}
const fails = reports.reduce((n, r) => n + r.problems.length, 0);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(reports, null, 1));
console.log(`\nSIGNCHECK ${fails ? 'FAILED' : 'OK'} (${fails} problem(s) across ${reports.length} courses)`);
process.exit(fails ? 1 : 0);
