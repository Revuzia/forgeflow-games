// VALE probe — content build (CONTRACT §3). Lane TOOLS.
//
// Runs the REAL CLI (`node tools/build_content.ts`) against the synthetic fixture tree
// _harness/fixtures/{content_min, art/out, audio/out, design_min} and checks:
//   * a valid build: manifest shape (§3.2), catalog sha256, zod-parseable output with defaults
//     applied, every asset ref rewritten to assets/<sha256-12>-<basename> and present with that hash;
//   * reproducibility: an unchanged rebuild keeps the catalog bytes and adds no history entry;
//     a version bump appends history and keeps the old catalog file;
//   * --check writes nothing; --allow-missing-assets downgrades a missing asset to a warning and
//     leaves the ref untouched;
//   * negative cases fail with file + JSON path in the message: unknown key, broken cross-refs,
//     missing asset, Git LFS pointer, recipe sum, blank kit text, base-skin ownership, deny-listed names;
//   * names_check rules (multi-word, non-dictionary, strict, allowlist, prose vs name, normalization).
// Fixture ids are placeholders (fx_*). Pass --keep to leave the temp dirs for inspection.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Catalog } from '../src/contracts/catalog.ts';
import type { CatalogManifest } from '../src/contracts/manifest.ts';
import { checkNames, loadDenyList, nameTokens, parseNamesNotUsed } from '../tools/names_check.ts';

const HARNESS = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HARNESS, '..');
const FIX = join(HARNESS, 'fixtures');
const BUILD = join(ROOT, 'tools', 'build_content.ts');
const DESIGN = join(FIX, 'design_min');
const KEEP = process.argv.includes('--keep');

let failures = 0;
let checks = 0;
function check(cond: unknown, what: string, detail?: string): void {
  checks++;
  if (cond) return;
  failures++;
  console.error(`FAIL ${what}${detail ? `\n     ${detail.split('\n').slice(0, 12).join('\n     ')}` : ''}`);
}

const TMP = mkdtempSync(join(tmpdir(), 'vale-probe-content-'));
const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

function run(args: string[]): { code: number; out: string } {
  const r = spawnSync(process.execPath, [BUILD, ...args], { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status ?? -1, out: `${r.stdout}\n${r.stderr}` };
}

/** copy the whole fixture tree so the default <content>/../art/out roots still resolve */
let caseN = 0;
function fixtureCopy(mutate?: (contentDir: string, root: string) => void): string {
  const root = join(TMP, `case${++caseN}`);
  for (const d of ['content_min', 'art', 'audio']) cpSync(join(FIX, d), join(root, d), { recursive: true });
  mutate?.(join(root, 'content_min'), root);
  return join(root, 'content_min');
}
function editJson(file: string, fn: (j: any) => void): void {
  const j = readJson<any>(file);
  fn(j);
  writeFileSync(file, JSON.stringify(j, null, 2));
}

try {
  // ── 1. valid build ────────────────────────────────────────────────────────────────────────────
  const out = join(TMP, 'out');
  const b1 = run(['--content', join(FIX, 'content_min'), '--out', out, '--design', DESIGN]);
  check(b1.code === 0, 'fixture builds (exit 0)', b1.out);
  check(/names check\s+ran/.test(b1.out), 'names check ran against the fixture deny-list', b1.out);
  const manifest = readJson<CatalogManifest>(join(out, 'manifest.json'));
  check(manifest.format === 1 && manifest.product === 'vale', 'manifest format 1 / product vale');
  const e1 = manifest.schemas['1'];
  check(e1 && e1.version === '2026.10.0' && e1.catalog === 'schema-1/2026.10.0/catalog.json', 'manifest schemas["1"] points at schema-1/<version>/catalog.json', JSON.stringify(manifest.schemas));
  const catBytes = readFileSync(join(out, e1.catalog));
  check(sha(catBytes) === e1.sha256, 'manifest sha256 matches catalog.json bytes');
  check(manifest.history.length === 1 && manifest.history[0].schema === 1 && manifest.history[0].version === '2026.10.0', 'history has one entry', JSON.stringify(manifest.history));

  const cat = JSON.parse(catBytes.toString('utf8'));
  const parsed = Catalog.safeParse(cat);
  check(parsed.success, 'emitted catalog passes the zod schema', parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3)));
  check(cat.schema === 1 && cat.version === '2026.10.0' && typeof cat.builtAt === 'string', 'catalog carries schema/version/builtAt');
  check(cat.fighters[0].kit.a1.castTime === 0.25 && cat.fighters[0].art.runRefSpeed === 3.6 && cat.items[0].sellRatio === 0.7, 'zod defaults are applied in the shipped catalog');
  check(!('$comment' in cat.fighters[0]), '$comment keys are stripped');
  check(cat.setup.spells[0].pools.length === 0 && cat.setup.boons[0].path === 'fx_path_a', 'setup spells/boons keep their extension fields');

  const refs: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') { if (v.startsWith('assets/')) refs.push(v); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(cat);
  check(refs.length >= 20, `catalog has asset refs (${refs.length})`);
  const badRefs = refs.filter((r) => !/^assets\/[0-9a-f]{12}-[A-Za-z0-9_.-]+$/.test(r));
  check(badRefs.length === 0, 'every asset ref is rewritten to assets/<sha256-12>-<basename>', badRefs.slice(0, 5).join(', '));
  for (const r of new Set(refs)) {
    const f = join(out, r);
    if (!existsSync(f)) { check(false, `asset file exists: ${r}`); continue; }
    check(sha(readFileSync(f)).slice(0, 12) === r.slice('assets/'.length, 'assets/'.length + 12), `asset content hash matches its name: ${r}`);
  }
  check(cat.fighters[0].art.model.endsWith('-fx_fighter_a.glb') && cat.audio.cues.fx_cue_hit.files[0].endsWith('-fx_hit.ogg') && cat.roles[0].icon.endsWith('-fx_icon.png'),
    'refs from all three roots (art/out, audio/out, content/) resolve and keep their basename');

  // ── 2. unchanged rebuild is byte-stable ─────────────────────────────────────────────────────────
  const b2 = run(['--content', join(FIX, 'content_min'), '--out', out, '--design', DESIGN]);
  const m2 = readJson<CatalogManifest>(join(out, 'manifest.json'));
  check(b2.code === 0 && /unchanged/.test(b2.out), 'rebuild reports the catalog unchanged', b2.out);
  check(m2.schemas['1'].sha256 === e1.sha256 && readFileSync(join(out, e1.catalog)).equals(catBytes), 'unchanged rebuild keeps catalog bytes and sha256');
  check(m2.history.length === 1, 'unchanged rebuild adds no history entry', JSON.stringify(m2.history));

  // ── 3. version bump appends history, keeps the old catalog ─────────────────────────────────────
  const bumped = fixtureCopy((c) => writeFileSync(join(c, 'version.json'), JSON.stringify({ version: '2026.10.1' })));
  const b3 = run(['--content', bumped, '--out', out, '--design', DESIGN]);
  const m3 = readJson<CatalogManifest>(join(out, 'manifest.json'));
  check(b3.code === 0, 'bumped version builds', b3.out);
  check(m3.schemas['1'].version === '2026.10.1' && existsSync(join(out, 'schema-1/2026.10.1/catalog.json')), 'manifest now serves 2026.10.1');
  check(existsSync(join(out, 'schema-1/2026.10.0/catalog.json')), 'previous catalog file is kept (immutable, CDN-cached)');
  check(m3.history.length === 2 && m3.history[1].version === '2026.10.1', 'history appended', JSON.stringify(m3.history));

  // ── 4. --check writes nothing ───────────────────────────────────────────────────────────────────
  const noOut = join(TMP, 'never-written');
  const b4 = run(['--check', '--content', join(FIX, 'content_min'), '--out', noOut, '--design', DESIGN]);
  check(b4.code === 0 && /check only/.test(b4.out), '--check passes on the fixture', b4.out);
  check(!existsSync(noOut), '--check writes no output');

  // ── 5. negative cases ───────────────────────────────────────────────────────────────────────────
  const neg = (name: string, mutate: (c: string, root: string) => void, expect: (string | RegExp)[], extra: string[] = []): void => {
    const c = fixtureCopy(mutate);
    const r = run(['--check', '--content', c, '--design', DESIGN, ...extra]);
    check(r.code === 1, `${name}: build fails (exit 1)`, r.out);
    for (const e of expect) check(typeof e === 'string' ? r.out.includes(e) : e.test(r.out), `${name}: output mentions ${String(e)}`, r.out);
  };

  neg('unknown key', (c) => editJson(join(c, 'fighters/fx_fighter_a.json'), (j) => { j.kit.a1.bogusKey = 1; }),
    ['fighters/fx_fighter_a.json $.kit.a1', 'bogusKey']);
  neg('unknown key in setup (strictness through extend)', (c) => editJson(join(c, 'setup.json'), (j) => { j.boons[0].sneaky = true; }),
    ['setup.json $.boons[0]', 'sneaky']);
  neg('broken cross-ref: queue → mode', (c) => editJson(join(c, 'queues.json'), (j) => { j[0].mode = 'fx_mode_b'; }),
    ['queues.json $[0].mode', 'unknown mode "fx_mode_b"', 'did you mean "fx_mode_a"']);
  neg('broken cross-ref: item component + skin owner', (c) => {
    editJson(join(c, 'items.json'), (j) => { j[1].components = ['fx_item_nope']; });
    editJson(join(c, 'skins/fx_fighter_a.json'), (j) => { j[1].fighter = 'fx_fighter_zz'; });
  }, ['items.json $[1].components[0]: unknown item "fx_item_nope"', 'skins/fx_fighter_a.json $[1].fighter']);
  neg('broken cross-ref: vfx/cue/clip/form used by an ability', (c) => editJson(join(c, 'fighters/fx_fighter_a.json'), (j) => {
    j.kit.a1.effects[0].present = { vfx: 'fx_vfx_nope', sfx: 'fx_cue_nope' };
    j.kit.a1.present = { anim: 'cast_a1' };
    j.kit.a1.recast = undefined;
    j.kit.a2.present = { anim: 'crit' };
    j.kit.ult.effects[1].then[0].form = 'fx_form_zz';
  }), ['unknown vfx id "fx_vfx_nope"', 'unknown audio cue "fx_cue_nope"', '$.kit.a2.present.anim', 'unknown clip role "crit"', 'unknown form (kit.passive.forms) "fx_form_zz"']);
  neg('missing asset', (c) => editJson(join(c, 'roles.json'), (j) => { j[0].icon = 'assets/ui/fx_missing.png'; }),
    ['roles.json $[0].icon', 'asset not found: "assets/ui/fx_missing.png"']);
  neg('Git LFS pointer instead of a GLB', (_c, root) => writeFileSync(join(root, 'art/out/units/fx_unit.glb'), 'version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 1\n'),
    ['units.json $[0].art.model', 'Git LFS pointer']);
  neg('recipe does not sum', (c) => editJson(join(c, 'items.json'), (j) => { j[1].cost = 500; }),
    ['items.json $[1].cost', 'recipe does not sum']);
  neg('blank kit text', (c) => editJson(join(c, 'fighters/fx_fighter_a.json'), (j) => { j.kit.a2.desc = '   '; }),
    ['$.kit.a2.desc: blank desc']);
  neg('base skin not starter-owned', (c) => editJson(join(c, 'store.json'), (j) => { j.starterOwnership = []; }),
    ['fighters/fx_fighter_a.json $: no base skin is in store.starterOwnership']);
  neg('deny-listed names', (c) => {
    editJson(join(c, 'fighters/fx_fighter_a.json'), (j) => { j.name = 'Zzyzxblade'; j.title = "The Gloomspire's Herald"; j.lore = 'Carries an ember of the old fire.'; });
    editJson(join(c, 'skins/fx_fighter_a.json'), (j) => { j[1].name = 'Ember'; });
    editJson(join(c, 'items.json'), (j) => { j[0].desc = 'Forged near the Quorvath gate.'; });
  }, ['fighters/fx_fighter_a.json $.name: deny-listed name', 'fighters/fx_fighter_a.json $.title: deny-listed name', 'skins/fx_fighter_a.json $[1].name: deny-listed name', 'items.json $[0].desc: deny-listed name']);
  {
    // prose use of a strict dictionary word ("ember" in lore) must NOT be flagged
    const c = fixtureCopy((cc) => editJson(join(cc, 'fighters/fx_fighter_a.json'), (j) => { j.lore = 'Carries an ember of the old fire, through the vale.'; }));
    const r = run(['--check', '--content', c, '--design', DESIGN]);
    check(r.code === 0, 'strict dictionary word in prose and an allowlisted word pass', r.out);
  }
  {
    const c = fixtureCopy((cc) => editJson(join(cc, 'roles.json'), (j) => { j[0].icon = 'assets/ui/fx_missing.png'; }));
    const out2 = join(TMP, 'out-missing');
    const r = run(['--content', c, '--out', out2, '--design', DESIGN, '--allow-missing-assets']);
    check(r.code === 0 && /warn .*asset not found/.test(r.out), '--allow-missing-assets builds with a warning', r.out);
    const m = readJson<CatalogManifest>(join(out2, 'manifest.json'));
    const built = readJson<any>(join(out2, m.schemas['1'].catalog));
    check(built.roles[0].icon === 'assets/ui/fx_missing.png', '--allow-missing-assets leaves the missing ref as written');
    check(/-fx_icon\.png$/.test(built.ranks[0].emblem), '--allow-missing-assets still rewrites the refs that resolve');
  }
  {
    const r = run(['--check', '--content', join(TMP, 'does-not-exist')]);
    check(r.code === 1 && /content directory not found/.test(r.out), 'missing content dir fails clearly', r.out);
    const u = run(['--bogus-flag']);
    check(u.code === 2, 'unknown flag is a usage error (exit 2)', u.out);
  }

  // ── 6. names_check rules ────────────────────────────────────────────────────────────────────────
  const deny = loadDenyList(DESIGN);
  const hit = (text: string, kind: 'name' | 'prose' = 'name'): string[] => checkNames([{ path: 'p', text, kind }], deny).map((h) => h.protectedName);
  check(nameTokens("Kai’Sa's Café-Bar").join(' ') === 'kaisa cafe bar', 'normalization: apostrophes, possessive, diacritics, punctuation', nameTokens("Kai’Sa's Café-Bar").join(' '));
  check(hit('Gloomspire Herald').length === 1 && hit('the gloomspire herald returns', 'prose').length === 1, 'multi-word entry flagged in names and prose');
  check(hit("Gloomspire's Herald").length === 1 && hit('GloomspireHerald').length === 1, 'multi-word entry flagged through possessive and squashed spelling');
  check(hit('Zzýzxblade').length === 1 && hit('a zzyzxblade appears', 'prose').length === 1, 'non-dictionary single word flagged everywhere (diacritics folded)');
  check(hit('Zzyzxblades').length === 0 && hit('Gloomspire').length === 0, 'whole-word only (no partial or plural match)');
  check(hit('Lantern').length === 1 && hit('Iron Lantern').length === 0 && hit('a lantern', 'prose').length === 0, 'non-strict dictionary word is protected only as an entire name');
  check(hit('The Beacon').length === 1 && hit('Beacon Tower').length === 0 && hit('Glass Crown').length === 1 && hit('the glass crown shatters', 'prose').length === 0,
    'exact_only entries match an entire name only (leading "the" ignored), never inside text');
  check(hit('Zzyzx Blade').length === 1 && hit('zzyzx blade', 'prose').length === 0, 'a name spelled with different breaks is compared squashed');
  check(hit('Ember').length === 1 && hit('Ember Knight').length === 1 && hit('an ember glows', 'prose').length === 0, 'strict dictionary word flagged inside names only');
  check(hit('Marrow').length === 1, 'NAMES_NOT_USED "(strict)" heading makes its section strict');
  check(hit('Vale').length === 0, 'allowlisted entry is ignored');
  check(hit('Fen Hollow').length === 1 && hit('Hollowfen').length === 1, 'NAMES_NOT_USED "A / B" bullets yield both names');
  const md = parseNamesNotUsed('# Fighters (strict)\n- **Ab Cd** — why\n* [Ef](http://x) (note)\n  - Gh: nested\nnot a bullet\n');
  check(JSON.stringify(md.map((e) => [e.category, e.name, e.strict])) === JSON.stringify([['not_used/fighters', 'Ab Cd', true], ['not_used/fighters', 'Ef', true], ['not_used/fighters', 'Gh', true]]),
    'NAMES_NOT_USED.md bullet parsing', JSON.stringify(md));
} finally {
  if (!KEEP) rmSync(TMP, { recursive: true, force: true });
  else console.log(`kept ${TMP}`);
}

console.log(`${failures ? 'FAIL' : 'PASS'} probe_content_build: ${checks - failures}/${checks} checks`);
process.exitCode = failures ? 1 : 0;
