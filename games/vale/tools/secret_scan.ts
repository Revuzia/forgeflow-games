// VALE — tracked-file secret scan (final parity review, originality F1: a vendor key sat in tracked pipeline
// scripts of a public repo). Part of `npm run check`.
//
//   node tools/secret_scan.ts            scan every tracked file of the whole repository (working tree)
//   node tools/secret_scan.ts --cached   scan the staged versions instead (for a pre-commit hook)
//   node tools/secret_scan.ts --list     print the rules
//
// Searches with `git grep` from the repository root (text files only, -I), so untracked scratch files and
// ignored folders never count (a few seconds over the ~22k tracked files). Exit 1 on any hit. A hit is reported
// as path:line, the rule and the match's length — never the matched value. A line that must hold a look-alike
// on purpose (a test fixture) can carry the marker `secret-scan: allow`. Credentials belong in the environment
// (MESHY_API_KEY, XAI_API_KEY, …) or in an untracked file, never in the repo. A key that was ever pushed must be
// revoked and rotated at its vendor: removing it from the files (or from history) does not make it safe again.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Rule { id: string; re: RegExp; anchors: string[]; icase?: boolean }

// The Meshy prefix is assembled so this file holds no literal of it.
const MESHY = ['ms', 'y_'].join('');
// `anchors`: fixed strings, one of which every hit contains; a fast `git grep -l -F` on them picks the candidate
// files, and only those are read and tested line by line with `re` (POSIX ERE over 20k files is ~10x slower).
// (^|[^…]) stands in for a word boundary where a prefix is also a word ending ("task-…", "chr8_…").
const RULES: Rule[] = [
  { id: 'meshy-api-key', re: new RegExp(`${MESHY}[A-Za-z0-9_-]{20,}`), anchors: [MESHY] },
  { id: 'xai-api-key', re: /xai-[A-Za-z0-9]{40,}/, anchors: ['xai-'] },
  { id: 'anthropic-api-key', re: /sk-ant-[A-Za-z0-9_-]{20,}/, anchors: ['sk-ant-'] },
  { id: 'openai-api-key', re: /(^|[^A-Za-z0-9_-])sk-(proj-)?[A-Za-z0-9]{32,}/, anchors: ['sk-'] },
  { id: 'github-token', re: /gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}/, anchors: ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_'] },
  { id: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/, anchors: ['AKIA'] },
  { id: 'google-api-key', re: /AIza[0-9A-Za-z_-]{35}/, anchors: ['AIza'] },
  { id: 'slack-token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/, anchors: ['xoxb-', 'xoxa-', 'xoxp-', 'xoxr-', 'xoxs-'] },
  { id: 'stripe-live-key', re: /[sr]k_live_[A-Za-z0-9]{20,}/, anchors: ['k_live_'] },
  { id: 'huggingface-token', re: /(^|[^A-Za-z0-9])hf_[A-Za-z0-9]{34,}/, anchors: ['hf_'] },
  { id: 'replicate-token', re: /(^|[^A-Za-z0-9])r8_[A-Za-z0-9]{37}/, anchors: ['r8_'] },
  { id: 'private-key-block', re: /-----BEGIN ([A-Z]+ )?PRIVATE KEY-----/, anchors: ['PRIVATE KEY-----'] },
  // a long literal assigned to a key-, secret-, token- or password-named field
  {
    id: 'credential-assignment', icase: true,
    re: /(api[_-]?key|secret|access[_-]?token|auth[_-]?token|password|bearer)["']?\s*[:=]\s*["'][A-Za-z0-9_/+=.-]{24,}["']/i,
    anchors: ['api_key', 'apikey', 'api-key', 'secret', 'access_token', 'access-token', 'auth_token', 'auth-token', 'password', 'bearer'],
  },
];
const ALLOW = 'secret-scan: allow';

const args = process.argv.slice(2);
if (args.includes('--list')) {
  for (const r of RULES) console.log(`${r.id.padEnd(22)} ${r.re.source}${r.icase ? '  (case-insensitive)' : ''}`);
  process.exit(0);
}
const cached = args.includes('--cached');

const git = (a: string[], cwd?: string, input?: string): Buffer => execFileSync('git', a, { cwd, input, maxBuffer: 1024 * 1024 * 1024 });
const top = git(['rev-parse', '--show-toplevel']).toString('utf8').trim();

/** tracked (or staged) text files holding any of the fixed strings */
const candidates = (anchors: string[], icase: boolean): string[] => {
  try {
    const out = git(['grep', '-I', '-l', '-z', '-F', ...(icase ? ['-i'] : []), ...(cached ? ['--cached'] : []), ...anchors.flatMap((a) => ['-e', a]), '--', '.'], top);
    return out.toString('utf8').split('\0').filter(Boolean);
  } catch (e) {
    if ((e as { status?: number }).status === 1) return [];   // git grep: no match
    throw e;
  }
};
const files = new Set<string>([
  ...candidates(RULES.filter((r) => !r.icase).flatMap((r) => r.anchors), false),
  ...candidates(RULES.filter((r) => r.icase).flatMap((r) => r.anchors), true),
]);

/** the text of each candidate: the working tree, or the index (--cached) through one `git cat-file --batch` */
const texts = new Map<string, string>();
if (cached) {
  const list = [...files];
  const out = git(['cat-file', '--batch'], top, list.map((p) => `:${p}\n`).join(''));
  let o = 0;
  for (const p of list) {
    const nl = out.indexOf(10, o);
    const head = out.subarray(o, nl).toString('utf8').split(' ');
    o = nl + 1;
    if (head[1] === 'missing') continue;
    const size = Number(head[2]);
    texts.set(p, out.subarray(o, o + size).toString('utf8'));
    o += size + 1;
  }
} else {
  for (const p of files) { try { texts.set(p, readFileSync(join(top, p), 'utf8')); } catch { /* deleted in the working tree */ } }
}

interface Hit { path: string; line: number; rule: string; len: number }
const hits: Hit[] = [];
for (const [path, text] of texts) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.includes(ALLOW)) continue;
    for (const r of RULES) {
      const m = r.re.exec(l);
      if (m) hits.push({ path, line: i + 1, rule: r.id, len: m[0].length });
    }
  }
}

const what = cached ? 'staged files' : 'tracked files';
if (!hits.length) {
  console.log(`secret_scan: PASS (${RULES.length} rules over the ${what} of ${top})`);
  process.exit(0);
}
for (const h of hits) console.log(`  ${h.path}:${h.line}  ${h.rule}  (${h.len} chars, value withheld)`);
console.log(`secret_scan: FAIL — ${hits.length} hit(s) in ${what}. Move the credential to the environment, then revoke and rotate it at the vendor.`);
process.exit(1);
