// GENESIS — release gate:  npm run release-check
//   1. builds (vite build), unless --no-build (then dist/ must exist)
//   2. validates public/game_meta.json against what the platform reads (pipeline/deploy_game.py takes genre,
//      sub_genre, difficulty, controls_keyboard, tags...; the site shows genre only when it is a category slug in
//      src/lib/supabase.ts CATEGORIES; difficulty is easy | medium | hard; src/lib/mobile.ts reads has_mobile_support)
//   3. prints bundle sizes and fails past the budgets below
//   4. refuses a build stamped "+dirty" or "unknown" (the stamp vite.config.ts buildStamp() bakes into the bundle):
//      a release is built from a clean, committed tree.
// The checks are pure functions (tests/release-check.test.ts); only `main` touches the disk and the build.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GENRES = ['action', 'arcade', 'puzzle', 'adventure', 'platformer', 'rpg', 'strategy', 'racing', 'board_game'];
export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const BUDGET = { totalBytes: 12 * 1024 * 1024, files: 80, jsFileBytes: 4 * 1024 * 1024, audioBytes: 3 * 1024 * 1024 };

export function validateMeta(m: Record<string, unknown>): string[] {
  const bad: string[] = [];
  const str = (k: string): string => (typeof m[k] === 'string' ? (m[k] as string) : '');
  for (const k of ['title', 'short_description', 'description', 'genre', 'sub_genre', 'difficulty', 'controls_keyboard']) if (!str(k).trim()) bad.push(`${k} is missing or empty`);
  if (!GENRES.includes(str('genre'))) bad.push(`genre "${str('genre')}" is not a category slug (${GENRES.join(', ')})`);
  if (!DIFFICULTIES.includes(str('difficulty'))) bad.push(`difficulty "${str('difficulty')}" is not one of ${DIFFICULTIES.join(', ')}`);
  if (typeof m.has_mobile_support !== 'boolean') bad.push('has_mobile_support must be a boolean');
  if (m.has_mobile_support === true) bad.push('has_mobile_support is true, but the game is desktop only');
  if (m.mobile_support !== undefined && !['full', 'partial', 'none'].includes(String(m.mobile_support))) bad.push('mobile_support must be full | partial | none');
  if (m.has_mobile_support === false && m.mobile_support !== undefined && m.mobile_support !== 'none') bad.push('mobile_support contradicts has_mobile_support:false');
  if (!Array.isArray(m.tags) || m.tags.length === 0 || m.tags.some((t) => typeof t !== 'string' || !t)) bad.push('tags must be a non-empty array of strings');
  if (str('short_description').length > 400) bad.push(`short_description is ${str('short_description').length} characters (keep it under 400)`);
  if (!/english only/i.test(str('description'))) bad.push('description does not say "English only"');
  if (!/desktop only/i.test(str('description'))) bad.push('description does not say "Desktop only"');
  return bad;
}

export interface FileSize { path: string; bytes: number }

export function checkSizes(files: FileSize[]): { problems: string[]; total: number; largest: FileSize[] } {
  const total = files.reduce((a, f) => a + f.bytes, 0);
  const problems: string[] = [];
  if (total > BUDGET.totalBytes) problems.push(`dist is ${mb(total)} MB, over the ${mb(BUDGET.totalBytes)} MB budget`);
  if (files.length > BUDGET.files) problems.push(`dist has ${files.length} files, over the ${BUDGET.files} budget`);
  for (const f of files) {
    if (/\.m?js$/.test(f.path) && f.bytes > BUDGET.jsFileBytes) problems.push(`${f.path} is ${mb(f.bytes)} MB of script, over ${mb(BUDGET.jsFileBytes)} MB`);
    if (/\.(ogg|mp3|m4a|wav)$/.test(f.path) && f.bytes > BUDGET.audioBytes) problems.push(`${f.path} is ${mb(f.bytes)} MB of audio, over ${mb(BUDGET.audioBytes)} MB`);
  }
  return { problems, total, largest: [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 6) };
}

const mb = (n: number): string => (n / 1048576).toFixed(2);

/** the stamp baked into a bundle's text ("c8d721ac built 2026-11-15T09:00Z", "+dirty" when uncommitted), or null */
export function findStamp(text: string): string | null {
  const m = /\b([0-9a-f]{8}|unknown)(\+dirty)? built 20\d\d-\d\d-\d\dT\d\d:\d\dZ/.exec(text);
  return m ? m[0] : null;
}

/** problems with a stamp: none when it is a commit hash without +dirty */
export function checkStamp(stamp: string | null): string[] {
  if (!stamp) return ['no build stamp found in the bundle (vite.config.ts __GENESIS_BUILD__)'];
  if (stamp.includes('+dirty')) return [`the build is stamped dirty (${stamp}): commit first, then release`];
  if (stamp.startsWith('unknown')) return [`the build is stamped unknown (${stamp}): build from a git checkout`];
  return [];
}

function walk(dir: string, base = dir, out: FileSize[] = []): FileSize[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, base, out); else out.push({ path: p.slice(base.length + 1), bytes: statSync(p).size });
  }
  return out;
}

function main(): number {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const dist = join(root, 'dist');
  const problems: string[] = [];
  if (!process.argv.includes('--no-build')) {
    console.log('release-check: building…');
    execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'build'], { cwd: root, stdio: 'inherit' });
  }
  if (!existsSync(dist)) { console.error('release-check: no dist/ (build first)'); return 1; }

  const meta = JSON.parse(readFileSync(join(root, 'public/game_meta.json'), 'utf8')) as Record<string, unknown>;
  const mp = validateMeta(meta);
  console.log(`meta:   ${mp.length ? 'FAIL' : 'ok'}`);
  problems.push(...mp.map((p) => `meta: ${p}`));
  const distMeta = join(dist, 'game_meta.json');
  if (!existsSync(distMeta) || readFileSync(distMeta, 'utf8') !== readFileSync(join(root, 'public/game_meta.json'), 'utf8')) problems.push('dist/game_meta.json differs from public/game_meta.json (stale build)');

  const sz = checkSizes(walk(dist));
  console.log(`sizes:  ${mb(sz.total)} MB in ${walk(dist).length} files; largest: ${sz.largest.map((f) => `${f.path} ${mb(f.bytes)} MB`).join(', ')}`);
  problems.push(...sz.problems.map((p) => `size: ${p}`));

  let stamp: string | null = null;
  for (const f of walk(join(dist, 'assets'), join(dist, 'assets'))) {
    if (!f.path.endsWith('.js')) continue;
    stamp = findStamp(readFileSync(join(dist, 'assets', f.path), 'utf8'));
    if (stamp) break;
  }
  console.log(`stamp:  ${stamp ?? '(none)'}`);
  problems.push(...checkStamp(stamp).map((p) => `stamp: ${p}`));

  if (problems.length) { console.error(`release-check FAILED:\n  - ${problems.join('\n  - ')}`); return 1; }
  console.log('release-check: all clear');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
