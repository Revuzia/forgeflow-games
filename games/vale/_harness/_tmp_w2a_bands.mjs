// orch1 W2-A scratch: the ruling 46 value bands over a value_probe report (before / after tags), per map (High).
//   node _harness/_tmp_w2a_bands.mjs <report.json> <out.json> [afterTag=after] [beforeTag=before] [fray=after2]
import { readFileSync, writeFileSync } from 'node:fs';
const [,, rep, out, AFTER = 'after', BEFORE = 'before', FRAY = AFTER] = process.argv;
const j = JSON.parse(readFileSync(rep, 'utf8')).runs;
// ruling 46 bands (display L* p50, value_probe class masks, fog of war off). BRIDGE's wall class is the gorge (the drop), held as chasm.
const BANDS = {
  rift: { lane: [50, 58], jungle: [28, 34], wallFace: [24, 30] },
  bridge: { lane: [50, 58], chasm: [14, 22] },
  fray: { lane: [50, 58], wallFace: [24, 30] },
};
const res = {};
for (const map of ['rift', 'bridge', 'fray']) {
  const b = j[BEFORE]?.[`${map}_high`], a = j[map === 'fray' ? FRAY : AFTER]?.[`${map}_high`];
  if (!a) continue;
  const g = (s, k) => s?.masks?.[k === 'chasm' ? 'wallFace' : k]?.lstarP50 ?? null;
  const r = { bands: {}, fighters: {}, fog: {}, frame: {} };
  for (const [k, [lo, hi]] of Object.entries(BANDS[map])) {
    const v = g(a, k);
    r.bands[k] = { before: g(b, k), after: v, band: [lo, hi], pass: v != null && v >= lo && v <= hi };
  }
  for (const k of ['wallLip', 'wallTop', 'camp', 'shadow', 'water', 'landmark']) if (g(a, k) != null) r.bands[k] = { before: g(b, k), after: g(a, k), info: true };
  r.groundSat = { before: b?.masks?.ground?.sat, after: a.masks?.ground?.sat };
  r.fighters = { top25: { before: b?.fighters?.top25, after: a.fighters?.top25 }, overLane: { before: b?.fighters?.overLane, after: a.fighters?.overLane }, gt90: { before: b?.fighters?.gt90, after: a.fighters?.gt90 } };
  r.fog = { laneUnseenOverLit: { before: b?.fog?.lane?.p50, after: a.fog?.lane?.p50, band: [0.5, 0.6] }, jungle: { before: b?.fog?.jungle?.p50, after: a.fog?.jungle?.p50 } };
  r.frame = { envP99: { before: b?.envFrame?.p99, after: a.envFrame?.p99 }, env180other: { before: b?.env180?.otherShare, after: a.env180?.otherShare } };
  r.flash = { before: b?.flash?.ratio, after: a.flash?.ratio, bar: 2.0 };
  r.pass = Object.values(r.bands).every((x) => x.info || x.pass);
  res[map] = r;
}
writeFileSync(out, JSON.stringify({ source: rep, tags: { before: BEFORE, after: AFTER, fray: FRAY }, maps: res }, null, 1));
for (const [m, r] of Object.entries(res)) console.log(m, r.pass ? 'PASS' : 'FAIL', JSON.stringify(Object.fromEntries(Object.entries(r.bands).map(([k, v]) => [k, `${v.before}->${v.after}${v.info ? '' : v.pass ? ' ok' : ' FAIL'}`]))));
