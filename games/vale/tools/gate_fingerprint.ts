// VALE tools — what a browser gate report is a report FOR (TECH-12). `npm run check:browser` writes
// _harness/_reports/gate_<HEAD>.json; tools/package_deploy.ts refuses to stage a tree whose report is missing,
// red, or was taken on different shipped sources. The fingerprint is HEAD plus a hash of everything under the
// shipped source folders that differs from HEAD (tracked diff and untracked files), so a gate run on a clean
// HEAD stays valid for exactly that HEAD and goes stale the moment shipped code changes.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** VALE_GATE_DIR moves the reports (the probe uses a temp folder); the default is _harness/_reports */
export const REPORTS = process.env.VALE_GATE_DIR ? resolve(process.env.VALE_GATE_DIR) : join(ROOT, '_harness', '_reports');
/** the folders and files whose changes alter what ships (art sources, harness and review notes do not) */
export const SHIPPED = ['src', 'content', 'public', 'index.html', 'vite.config.ts', 'package.json', 'server', 'tools/build_content.ts', 'tools/package_deploy.ts'];

const git = (args: string[]): string => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

export function headSha(): string { return git(['rev-parse', 'HEAD']).trim(); }

/** 16 hex chars: sha256 over the tracked diff against HEAD and the path + content of every untracked shipped file */
export function dirtyHash(): string {
  const h = createHash('sha256');
  h.update(git(['diff', 'HEAD', '--', ...SHIPPED]));
  const untracked = git(['ls-files', '-o', '--exclude-standard', '-z', '--', ...SHIPPED]).split('\0').filter(Boolean).sort();
  for (const f of untracked) { h.update(`\0${f}\0`); try { h.update(readFileSync(join(ROOT, f))); } catch { /* vanished: still named */ } }
  return h.digest('hex').slice(0, 16);
}

export interface GateReport {
  head: string;
  dirty: string;
  ok: boolean;
  at: string;
  steps: { name: string; cmd: string; code: number | null; seconds: number }[];
}

export const gatePath = (head: string): string => join(REPORTS, `gate_${head}.json`);

/** null = the report is good for this tree, else why not */
export function gateProblem(): string | null {
  let head: string;
  try { head = headSha(); } catch (e) { return `cannot read git HEAD (${(e as Error).message.split('\n')[0]})`; }
  let r: GateReport;
  try { r = JSON.parse(readFileSync(gatePath(head), 'utf8')) as GateReport; } catch { return `no browser gate report for HEAD ${head.slice(0, 10)} (run \`npm run check:browser\`)`; }
  if (r.head !== head) return `gate report names HEAD ${String(r.head).slice(0, 10)}, not ${head.slice(0, 10)}`;
  if (!r.ok) return `gate_${head.slice(0, 10)}.json is red: ${r.steps.filter((s) => s.code !== 0).map((s) => s.name).join(', ') || 'a step failed'}`;
  const now = dirtyHash();
  if (r.dirty !== now) return `gate report was taken on different shipped sources (dirty ${r.dirty} now ${now}): run \`npm run check:browser\` again`;
  return null;
}
