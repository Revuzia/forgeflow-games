// VALE — the icon probe (HUD-1): do the item and ability icons read at slot size?
//
//   node _harness/icon_probe.mjs [--items <dir>] [--abilities <dir>] [--sizes 38,40] [--out <report.json>]
//
// Each icon is scaled (cover) to 38 and 40 px, the 38 px inventory slot and the 40 px it is reviewed at, and measured
// on the sRGB values the HUD shows (luma = BT.709 weights on 0-255):
//   p50 >= 60 and p95 >= 190 at every size (items and abilities): a lit subject on a lit ground, not a dim one on navy.
//   ground = the median of the four corner patches (10 % of the side): an item's ground must sit nearest its own ledger
//     family's ground (Strike, Craft, Guard, Stride; src/ui/hud/icon_families.json, the same rule the grader uses) and
//     differ by >= 40 (L1, RGB) from every item ground of another family: no ground shared across stat families.
//   no item or ability ground within 30 (L1) of the old shared navy (13,20,32).
//   fill = share of pixels more than 60 (L1) from that ground (the review's subject-coverage measure), reported.
// Also lists every item, ability, spell and boon whose icon is missing (the HUD draws its fallback glyph; the
// art is generated in a later pass). Exit 1 on any failure. Report: _harness/_reports/fw_W2_icon_probe.json.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VALE = join(HERE, '..');
const sharp = createRequire(join(VALE, 'package.json'))('sharp');
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const ITEMS = opt('--items', join(VALE, 'content/ui/icons/items'));
const ABIL = opt('--abilities', join(VALE, 'content/ui/icons/abilities'));
const SIZES = opt('--sizes', '38,40').split(',').map(Number);
const OUT = opt('--out', join(HERE, '_reports', 'fw_W2_icon_probe.json'));
const P50 = 60, P95 = 190, SEP = 40, NAVY = [13, 20, 32], NAVY_D = 30, FILL_D = 60;

const json = (p) => JSON.parse(readFileSync(join(VALE, p), 'utf8'));
const FAM = json('src/ui/hud/icon_families.json');
const items = json('content/items.json').items;
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const l1 = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

/** the ledger family of an item (same rule as tools/imagegen/icon_grade.py item_family) */
function familyOf(it) {
  if (FAM.tiers?.[it.tier]) return FAM.tiers[it.tier];
  let best = null, score = 0;
  for (const [fid, f] of Object.entries(FAM.families)) {
    const s = Object.entries(it.stats ?? {}).reduce((a, [k, v]) => a + (f.stats[k] ?? 0) * Number(v), 0);
    if (s > score) { best = fid; score = s; }
  }
  if (best) return best;
  for (const t of it.tags ?? []) if (FAM.tags[t]) return FAM.tags[t];
  return 'craft';
}

async function measure(file, S) {
  const { data } = await sharp(file).resize(S, S, { fit: 'cover' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = S * S, L = new Array(n);
  for (let p = 0; p < n; p++) { const i = p * 3; L[p] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; }
  const c = Math.max(2, Math.round(S * 0.1));
  const corners = [[0, 0], [S - c, 0], [0, S - c], [S - c, S - c]].map(([x0, y0]) => {
    const m = [0, 0, 0];
    for (let y = y0; y < y0 + c; y++) for (let x = x0; x < x0 + c; x++) { const i = (y * S + x) * 3; m[0] += data[i]; m[1] += data[i + 1]; m[2] += data[i + 2]; }
    return m.map((v) => v / (c * c));
  });
  // median corner per channel: one corner the subject reaches into does not move the ground
  const ground = [0, 1, 2].map((k) => { const v = corners.map((q) => q[k]).sort((a, b) => a - b); return Math.round((v[1] + v[2]) / 2); });
  let fill = 0;
  for (let p = 0; p < n; p++) { const i = p * 3; if (Math.abs(data[i] - ground[0]) + Math.abs(data[i + 1] - ground[1]) + Math.abs(data[i + 2] - ground[2]) > FILL_D) fill++; }
  const s = [...L].sort((a, b) => a - b);
  return { p50: Math.round(s[n >> 1]), p95: Math.round(s[Math.floor(n * 0.95)]), ground, fill: +(fill / n).toFixed(2) };
}

const R = { at: new Date().toISOString(), sizes: SIZES, thresholds: { P50, P95, SEP, NAVY_D }, items: {}, abilities: {}, failures: [], missing: [] };
const fail = (what, info) => { R.failures.push({ what, ...info }); };

// ── items ────────────────────────────────────────────────────────────────────────────────────────
for (const it of items) {
  const f = join(ITEMS, `${it.id}.webp`);
  if (!existsSync(f)) continue;
  const row = { family: familyOf(it), tier: it.tier };
  for (const S of SIZES) row[S] = await measure(f, S);
  R.items[it.id] = row;
}
// ── abilities (every painted ability icon; owner = the fighter whose kit names it) ───────────────
const owner = {};
const famDir = join(VALE, 'content/fighters');
for (const fn of readdirSync(famDir).filter((x) => x.endsWith('.json'))) {
  const d = JSON.parse(readFileSync(join(famDir, fn), 'utf8'));
  for (const k of Object.values(d.kit)) if (k?.id) owner[k.id] = { fighter: d.id, sig: d.vfx?.signature };
}
for (const fn of existsSync(ABIL) ? readdirSync(ABIL).filter((x) => /\.(webp|png)$/.test(x)).sort() : []) {
  const id = fn.replace(/\.(webp|png)$/, '');
  const row = { owner: owner[id]?.fighter ?? (Object.keys(owner).find((k) => id.startsWith(k.split('_')[0] + '_')) ? id.split('_')[0] : null) };
  for (const S of SIZES) row[S] = await measure(join(ABIL, fn), S);
  R.abilities[id] = row;
}

// ── checks ───────────────────────────────────────────────────────────────────────────────────────
const S0 = SIZES[SIZES.length - 1];
for (const [kind, set] of [['item', R.items], ['ability', R.abilities]]) {
  for (const [id, row] of Object.entries(set)) {
    for (const S of SIZES) {
      if (row[S].p50 < P50) fail(`${kind} p50 < ${P50} at ${S} px`, { id, p50: row[S].p50 });
      if (row[S].p95 < P95) fail(`${kind} p95 < ${P95} at ${S} px`, { id, p95: row[S].p95 });
    }
    if (l1(row[S0].ground, NAVY) <= NAVY_D) fail(`${kind} ground is the old navy`, { id, ground: row[S0].ground });
  }
}
// families: centroid per family, nearest-centroid, pairwise separation across families
const fams = Object.keys(FAM.families);
const centroid = {};
for (const fid of fams) {
  const g = Object.values(R.items).filter((r) => r.family === fid).map((r) => r[S0].ground);
  centroid[fid] = g.length ? [0, 1, 2].map((k) => Math.round(g.reduce((a, v) => a + v[k], 0) / g.length)) : null;
}
R.centroids = centroid;
for (const [id, row] of Object.entries(R.items)) {
  const near = fams.filter((f) => centroid[f]).sort((a, b) => l1(row[S0].ground, centroid[a]) - l1(row[S0].ground, centroid[b]))[0];
  if (near !== row.family) fail('item ground nearest another family', { id, family: row.family, nearest: near, ground: row[S0].ground });
}
let minPair = { d: Infinity };
const ids = Object.keys(R.items);
for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
  const a = R.items[ids[i]], b = R.items[ids[j]];
  if (a.family === b.family) continue;
  const d = l1(a[S0].ground, b[S0].ground);
  if (d < minPair.d) minPair = { d, a: ids[i], b: ids[j], fa: a.family, fb: b.family };
  if (d < SEP) fail(`item grounds of two families closer than ${SEP}`, { a: ids[i], b: ids[j], d });
}
R.minCrossFamilyGround = minPair;

// ── summary ──────────────────────────────────────────────────────────────────────────────────────
const med = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[s.length >> 1]; };
R.summary = {};
for (const [kind, set] of [['items', R.items], ['abilities', R.abilities]]) {
  const rows = Object.values(set);
  R.summary[kind] = Object.fromEntries(SIZES.map((S) => [S, {
    n: rows.length, p50_median: med(rows.map((r) => r[S].p50)), p50_min: Math.min(...rows.map((r) => r[S].p50)),
    p95_median: med(rows.map((r) => r[S].p95)), p95_min: Math.min(...rows.map((r) => r[S].p95)),
    fill_median: med(rows.map((r) => r[S].fill)), navy: rows.filter((r) => l1(r[S].ground, NAVY) <= NAVY_D).length,
  }]));
}
R.summary.families = Object.fromEntries(fams.map((f) => [f, Object.values(R.items).filter((r) => r.family === f).length]));

// ── missing art (fallback glyph until the generation pass) ───────────────────────────────────────
const have = (ref) => !!ref && existsSync(join(VALE, 'content/ui', ref.replace(/^assets\/ui\//, '')));
for (const it of items) if (!have(it.icon)) R.missing.push({ kind: 'item', id: it.id, icon: it.icon ?? null });
for (const fn of readdirSync(famDir).filter((x) => x.endsWith('.json'))) {
  const d = JSON.parse(readFileSync(join(famDir, fn), 'utf8'));
  for (const k of Object.values(d.kit)) if (k?.id && !have(k.icon)) R.missing.push({ kind: 'ability', id: k.id, icon: k.icon ?? null });
}
for (const u of json('content/units.json').units) for (const a of u.abilities ?? []) if (!have(a.icon)) R.missing.push({ kind: 'unit ability', id: a.id, icon: a.icon ?? null });
const setup = json('content/setup.json');
for (const s of setup.spells ?? []) if (!have(s.icon)) R.missing.push({ kind: 'spell', id: s.id, icon: s.icon ?? null });
for (const b of setup.boons ?? []) if (!have(b.icon)) R.missing.push({ kind: 'boon', id: b.id, icon: b.icon ?? null });

writeFileSync(OUT, JSON.stringify(R, null, 1));
for (const [kind, s] of Object.entries(R.summary)) if (kind !== 'families') for (const [S, v] of Object.entries(s)) console.log(`${kind.padEnd(9)} ${S} px  n ${v.n}  p50 median ${v.p50_median} min ${v.p50_min}  p95 median ${v.p95_median} min ${v.p95_min}  fill median ${v.fill_median}  navy ${v.navy}`);
console.log('families', JSON.stringify(R.summary.families), 'centroids', JSON.stringify(centroid));
console.log('closest grounds across families', JSON.stringify(minPair));
console.log(`missing icons (fallback glyph): ${R.missing.length ? R.missing.map((m) => `${m.kind}:${m.id}`).join(', ') : 'none'}`);
if (R.failures.length) {
  console.log(`FAIL ${R.failures.length}`);
  for (const f of R.failures.slice(0, 25)) console.log('  ✗', JSON.stringify(f));
  console.log(`report: ${OUT}`);
  process.exit(1);
}
console.log(`OK  report: ${OUT}`);
