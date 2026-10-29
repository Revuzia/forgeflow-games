// VALE — tracked-file secret scan (final parity review, originality F1: a vendor key sat in tracked pipeline
// scripts of a public repo, and again in their tracked __pycache__/*.pyc). Part of `npm run check`.
//
//   node tools/secret_scan.ts            scan every tracked file of the whole repository (working tree)
//   node tools/secret_scan.ts --cached   scan the staged versions instead (for a pre-commit hook)
//   node tools/secret_scan.ts --list     print the rules
//
// Every tracked file is scanned as BYTES, binary files included (-a): a key literal compiled into a .pyc, packed
// into a .glb or left in an archive counts exactly like one in a .py. Untracked scratch files and ignored folders
// never count. Exit 1 on any hit. A hit is reported as path:line (text) or path@byte (binary), the rule and the
// match's length — never the matched value. A text line that must hold a look-alike on purpose (a test fixture)
// can carry the marker `secret-scan: allow`. Credentials belong in the environment (MESHY_API_KEY, XAI_API_KEY,
// …) or in an untracked file, never in the repo. A key that was ever pushed must be revoked and rotated at its
// vendor: removing it from the files (or from history) does not make it safe again.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Rule { id: string; re: RegExp; anchors: string[]; icase?: boolean }

// The Meshy prefix is assembled so this file holds no literal of it.
const MESHY = ['ms', 'y_'].join('');
// `anchors`: fixed strings, one of which every hit contains, and none further than 32 bytes into a hit. A fast
// `git grep -a -l -F` on them picks the candidate files; in each, only the stretches of a line within WINDOW bytes
// of an anchor are tested with `re` (POSIX ERE over 23k files / 5 GB is far slower).
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
/** bytes of a line tested on each side of an anchor: far longer than any key, short enough for binary blobs */
const WINDOW = 4096;

const args = process.argv.slice(2);
if (args.includes('--list')) {
  for (const r of RULES) console.log(`${r.id.padEnd(22)} ${r.re.source}${r.icase ? '  (case-insensitive)' : ''}`);
  console.log(`(every tracked file, binary included, is scanned as bytes)`);
  process.exit(0);
}
const cached = args.includes('--cached');

const git = (a: string[], cwd?: string, input?: string): Buffer => execFileSync('git', a, { cwd, input, maxBuffer: 1024 * 1024 * 1024 });
const top = git(['rev-parse', '--show-toplevel']).toString('utf8').trim();

/** tracked (or staged) files, binary included (-a), holding any of the fixed strings */
const candidates = (anchors: string[], icase: boolean): string[] => {
  try {
    const out = git(['grep', '-a', '-l', '-z', '-F', ...(icase ? ['-i'] : []), ...(cached ? ['--cached'] : []), ...anchors.flatMap((a) => ['-e', a]), '--', '.'], top);
    return out.toString('utf8').split('\0').filter(Boolean);
  } catch (e) {
    if ((e as { status?: number }).status === 1) return [];   // git grep: no match
    throw e;
  }
};
const exact = RULES.filter((r) => !r.icase);
const folded = RULES.filter((r) => r.icase);
/** path -> the rules whose anchors it holds */
const files = new Map<string, Rule[]>();
for (const [rules, icase] of [[exact, false], [folded, true]] as const) {
  for (const p of candidates(rules.flatMap((r) => r.anchors), icase)) files.set(p, [...(files.get(p) ?? []), ...rules]);
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const anchorRe = new Map<Rule, RegExp>(RULES.map((r) => [r, new RegExp(r.anchors.map(esc).join('|'), r.icase ? 'gi' : 'g')]));
const ruleRe = new Map<Rule, RegExp>(RULES.map((r) => [r, new RegExp(r.re.source, r.icase ? 'gi' : 'g')]));

interface Hit { path: string; line: number; offset: number; binary: boolean; rule: string; len: number }
const hits: Hit[] = [];

/** test one file's bytes (decoded 1:1 as latin1, so every byte keeps its offset) against its candidate rules */
const scan = (path: string, buf: Buffer, rules: Rule[]): void => {
  const s = buf.toString('latin1');
  const binary = buf.subarray(0, 8000).includes(0);   // git's own binary heuristic
  for (const r of rules) {
    // the line stretches around each anchor: [lineStart or a-WINDOW, lineEnd or a+WINDOW), merged when they touch
    const spans: [number, number][] = [];
    const ar = anchorRe.get(r)!;
    ar.lastIndex = 0;
    for (let m = ar.exec(s); m; m = ar.exec(s)) {
      const a = m.index;
      let lo = a;
      while (lo > 0 && lo > a - WINDOW && s.charCodeAt(lo - 1) !== 10) lo--;
      let hi = a;
      while (hi < s.length && hi < a + WINDOW && s.charCodeAt(hi) !== 10) hi++;
      const last = spans[spans.length - 1];
      if (last && lo <= last[1]) last[1] = Math.max(last[1], hi); else spans.push([lo, hi]);
    }
    const rr = ruleRe.get(r)!;
    for (const [lo, hi] of spans) {
      const part = s.slice(lo, hi);
      rr.lastIndex = 0;
      for (let m = rr.exec(part); m; m = rr.exec(part)) {
        const at = lo + m.index;
        if (!binary) {
          const ls = s.lastIndexOf('\n', at) + 1;
          const le = s.indexOf('\n', at);
          if (s.slice(ls, le < 0 ? s.length : le).includes(ALLOW)) continue;
        }
        let line = 1;
        for (let i = s.indexOf('\n'); i >= 0 && i < at; i = s.indexOf('\n', i + 1)) line++;
        hits.push({ path, line, offset: at, binary, rule: r.id, len: m[0].length });
        if (m[0].length === 0) rr.lastIndex++;
      }
    }
  }
};

if (cached) {
  // the index's blobs through `git cat-file --batch`, in chunks so a run of large binaries stays bounded
  const list = [...files.keys()];
  const CHUNK = 64;
  for (let c = 0; c < list.length; c += CHUNK) {
    const part = list.slice(c, c + CHUNK);
    const out = git(['cat-file', '--batch'], top, part.map((p) => `:${p}\n`).join(''));
    let o = 0;
    for (const p of part) {
      const nl = out.indexOf(10, o);
      const head = out.subarray(o, nl).toString('utf8').split(' ');
      o = nl + 1;
      if (head[1] === 'missing') continue;
      const size = Number(head[2]);
      scan(p, out.subarray(o, o + size), files.get(p)!);
      o += size + 1;
    }
  }
} else {
  for (const [p, rules] of files) {
    let buf: Buffer;
    try { buf = readFileSync(join(top, p)); } catch { continue; /* deleted in the working tree */ }
    scan(p, buf, rules);
  }
}

const what = cached ? 'staged files' : 'tracked files';
if (!hits.length) {
  console.log(`secret_scan: PASS (${RULES.length} rules over the ${what} of ${top}, binary files included; ${files.size} candidate files tested)`);
  process.exit(0);
}
for (const h of hits) console.log(`  ${h.binary ? `${h.path}@byte ${h.offset} (binary)` : `${h.path}:${h.line}`}  ${h.rule}  (${h.len} chars, value withheld)`);
console.log(`secret_scan: FAIL — ${hits.length} hit(s) in ${what}. Move the credential to the environment, then revoke and rotate it at the vendor.`);
process.exit(1);
