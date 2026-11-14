#!/usr/bin/env node
/* core/settings.selftest.cjs — [lane settings] DOM-free checks for the
 * versioned settings record: defaults, schema validation/clamping, v1 → v2
 * migration (a returning player loses nothing), corrupt-data recovery,
 * quality presets vs "custom", export/import text round trip, and the
 * colour-blind palettes re-verified by simulation (Machado 2009 CVD matrices,
 * CIELAB ΔE76).
 * Run:  node core/settings.selftest.cjs     (exit 0 = all pass)
 */
"use strict";
const path = require("path");
const { pathToFileURL } = require("url");
const GAME_DIR = path.resolve(__dirname, "..");
const u = (p) => pathToFileURL(path.resolve(GAME_DIR, p)).href;

let passed = 0, failed = 0;
function ok(c, m) { if (c) { passed++; console.log("  PASS  " + m); } else { failed++; console.error("  FAIL  " + m); } }
function section(n) { console.log("\n== " + n + " =="); }

function fakeStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _m: m,
  };
}

// ---- CVD simulation (independent re-implementation, not imported) ----------
const CVD = {
  none: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const hexLin = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => lin(v / 255)); };
const simu = (rgb, m) => m.map((r) => Math.min(1, Math.max(0, r[0] * rgb[0] + r[1] * rgb[1] + r[2] * rgb[2])));
function lab([r, g, b]) {
  let X = 0.4124 * r + 0.3576 * g + 0.1805 * b, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
  X /= 0.95047; Z /= 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const dE = (a, b) => { const A = lab(a), B = lab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
const pairDE = (p, mode) => dE(simu(hexLin(p.friend), CVD[mode]), simu(hexLin(p.enemy), CVD[mode]));

async function main() {
  const M = await import(u("core/settings.js"));
  const { SCHEMA } = M;

  section("defaults");
  const d = M.defaults();
  ok(Object.keys(d).length === Object.keys(SCHEMA).length, "every schema key has a default");
  let allValid = true;
  for (const [k, s] of Object.entries(SCHEMA)) {
    if (s.kind === "enum" && !s.options.includes(s.default)) allValid = false;
    if (s.kind === "range" && !(s.default >= s.min && s.default <= s.max)) allValid = false;
  }
  ok(allValid, "every default is inside its own schema");
  ok(d.quality === "med" && d.fov === 74 && d.sens === 1 && d.renderScale === 1, "legacy defaults unchanged (med, 74°, ×1.00, native)");
  ok(d.fpsCap === "uncapped" && d.dynRes === "off" && d.shadows === "high" && d.lampAtmos === "on", "new graphics defaults reproduce the shipped frame");
  ok(d.colorblind === "off" && d.shake === 1 && d.flashIntensity === 1 && d.kbAds === "hold", "accessibility defaults are neutral");
  ok(M.presetState(d) === "med", "fresh defaults read as the med preset, not custom");

  section("validation / clamping");
  const v = M.validate({ fov: 200, sens: "abc", quality: "ultra", xhSize: -3, colorblind: "PROTANOPIA",
    fpsCap: 60, bogus: 1, rainDensity: null, hudScale: true });
  ok(v.fov === 90, "range above max clamps to max (fov 200 → 90)");
  ok(v.sens === 1, "non-numeric range → default");
  ok(v.quality === "med", "unknown enum → default");
  ok(v.xhSize === 0.5, "range below min clamps to min");
  ok(v.colorblind === "protanopia", "enum case slip tolerated");
  ok(v.fpsCap === "60", "numeric enum value accepted as its string");
  ok(!("bogus" in v), "unknown keys dropped");
  ok(v.rainDensity === 1 && v.hudScale === 1, "null / boolean in a range → default");

  section("v1 → v2 migration");
  const v1 = { quality: "low", fov: 82, sens: 0.37, adsSens: 0.8, renderScale: 0.75, bob: 0.2,
    music: 0, sfx: 0.9, ambience: 0.5, invertY: "on", aimAssist: "focused", padSensX: 1.4, padCurve: "linear" };
  const st1 = fakeStorage({ [M.LEGACY_KEY_V1]: JSON.stringify(v1) });
  const r1 = M.loadRecord(st1);
  ok(r1.from === "v1" && r1.wrote, "legacy key detected and a v2 record written");
  let kept = true;
  for (const [k, val] of Object.entries(v1)) if (r1.values[k] !== val) { kept = false; console.error("    lost", k, val, "→", r1.values[k]); }
  ok(kept, "every v1 value survives migration exactly (13 keys)");
  ok(r1.values.bloom === "off" && r1.values.grain === "off", "a 'low' v1 player gets the low-preset toggles (tier-0 frame kept)");
  ok(M.presetState(r1.values) === "low", "migrated low player reads as preset low, not custom");
  const rec = JSON.parse(st1.getItem(M.RECORD_KEY));
  ok(rec.v === 2 && rec.values && rec.values.fov === 82, "written record is {v:2, values}");
  ok(st1.getItem(M.LEGACY_KEY_V1) !== null, "legacy key left in place for rollback");
  const r1b = M.loadRecord(st1);
  ok(r1b.from === "v2" && r1b.values.sens === 0.37 && !r1b.wrote, "second load reads the v2 record, no re-migration");

  const stOut = fakeStorage({ [M.LEGACY_KEY_V1]: JSON.stringify({ fov: 999, sens: -1, quality: "high" }) });
  const r2 = M.loadRecord(stOut);
  ok(r2.values.fov === 90 && r2.values.sens === 0.05 && r2.values.quality === "high", "out-of-range legacy values clamp, never smuggle");

  section("corrupt / empty storage");
  const stBad = fakeStorage({ [M.RECORD_KEY]: "{not json", [M.LEGACY_KEY_V1]: JSON.stringify({ fov: 66 }) });
  const r3 = M.loadRecord(stBad);
  ok(r3.values.fov === 66, "corrupt v2 record falls back to the good v1 key");
  ok(stBad.getItem(M.CORRUPT_KEY) === "{not json", "corrupt text parked for diagnosis");
  const r4 = M.loadRecord(fakeStorage({ [M.RECORD_KEY]: "]]" }));
  ok(r4.from === "corrupt" && r4.values.fov === 74, "corrupt with no legacy → defaults, never throws");
  const r5 = M.loadRecord(fakeStorage());
  ok(r5.from === "none" && r5.values.quality === "med", "empty storage → defaults (from none)");
  const r6 = M.loadRecord(null);
  ok(r6.from === "none", "no storage at all (private mode) → defaults");
  const throwing = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("x"); } };
  ok(M.loadRecord(throwing).from === "none", "storage that throws on access → defaults");
  const future = M.loadRecord(fakeStorage({ [M.RECORD_KEY]: JSON.stringify({ v: 9, values: { fov: 70, newThing: 3 } }) }));
  ok(future.values.fov === 70 && !("newThing" in future.values), "a NEWER build's record: known keys kept, unknown dropped");

  section("presets / custom");
  const lowV = Object.assign(M.defaults(), { quality: "low" }, M.presetValues("low"));
  ok(M.presetState(lowV) === "low", "low + its toggles = low");
  ok(M.presetState(Object.assign({}, lowV, { vignette: "on" })) === "custom", "touching a preset toggle = custom");
  ok(M.presetState(Object.assign(M.defaults(), { shadows: "off", rainDensity: 0.3 })) === "med",
    "non-preset graphics keys never flip the preset to custom");

  section("export / import");
  const mine = Object.assign(M.defaults(), { sens: 0.42, colorblind: "tritanopia", quality: "high", bloom: "off" });
  const txt = M.exportText(mine, { fire: "KeyJ" });
  ok(txt.length < 400, `export is short (${txt.length} chars, non-defaults only)`);
  const back = M.parseImport(txt);
  ok(back.ok && back.values.sens === 0.42 && back.values.colorblind === "tritanopia", "round trip keeps values");
  ok(back.values.quality === "high" && back.values.bloom === "off", "custom preset state survives the round trip");
  ok(back.binds.fire === "KeyJ", "key bindings ride along");
  ok(!M.parseImport("hello").ok && !M.parseImport("{\"x\":1}").ok, "garbage / unrelated JSON rejected");
  ok(M.parseImport(JSON.stringify({ fov: 1000 })).values.fov === 90, "imported values are clamped too");
  ok(Object.keys(M.parseImport(JSON.stringify({ fov: 70, binds: { fire: "<script>" } })).binds).length === 0,
    "imported binds must look like key codes");

  section("colour-blind palettes (simulated)");
  const def = M.DEFAULT_TEAM_COLORS;
  ok(pairDE(def, "none") > 80, `default amber/slate ΔE normal ${pairDE(def, "none").toFixed(1)}`);
  for (const mode of ["protanopia", "deuteranopia", "tritanopia"]) {
    const p = M.teamColorsFor(mode);
    const dMode = pairDE(p, mode), dNorm = pairDE(p, "none");
    ok(dMode >= 60 && dNorm >= 60, `${mode}: ${p.friend}/${p.enemy} ΔE ${mode} ${dMode.toFixed(1)} · normal ${dNorm.toFixed(1)} (gate ≥ 60)`);
    ok(dMode > pairDE(def, mode) - 0.5, `${mode}: palette separates at least as well as the default (${pairDE(def, mode).toFixed(1)})`);
  }
  ok(M.teamColorsFor("off") === null, "mode off → null (authored tints stand)");

  console.log(`\n${failed ? "FAIL" : "PASS"}: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
