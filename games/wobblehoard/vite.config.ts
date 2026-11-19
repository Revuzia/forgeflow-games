// WOBBLEHOARD — Vite dev/build config.
//   * dev :5360 / preview :5361, strictPort (the harness hard-codes them), no-store headers.
//   * base './' so a built dist/ can be hosted from any sub-path (portal / CDN folder).
//   * harness endpoints (dev server and `vite preview` ONLY; never part of a build), same contract as the other ForgeFlow 3D games:
//       POST /__shot/<name>    body = PNG data URL (or raw image bytes) → _shots/<name>.png
//       POST /__report/<name>  body = JSON                              → _harness/_reports/<name>.json
//     They write into the repo, so they answer SAME-ORIGIN LOCALHOST requests only (harnessRefusal below): a web page open in
//     another tab must not be able to fill the disk or overwrite gate evidence with a cross-site "simple" POST.
//   * G0 size budget: every `vite build` prints the size of its output folder and FAILS when it is over 3 MB (G0), or when the first-play
//     files (html, js, css, not `later-*` chunks) are over 600 KB gzip (G0b) (CONTRACT section 6; G0 counts every file in the output
//     folder, public/ files included, like _harness/browser_shell.mjs does).
//   * css.postcss is inline + empty on purpose: isolates the game from the portal's Tailwind PostCSS config.
import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = resolve(ROOT, '_shots');
const REPORTS_DIR = resolve(ROOT, '_harness', '_reports');
// A PNG data URL of a DPR-2 desktop canvas is a few MB; the largest shot on disk today is 2.2 MB. Reports are small JSON.
const MAX_SHOT_BYTES = 24 * 1024 * 1024;
const MAX_REPORT_BYTES = 8 * 1024 * 1024;
// G0 was 1.2 MB raw. Raised by the owner's decision (2026-10-08; "fine if it is industry standard and does not hurt us on the web"): portals ask for
// far more (Poki: first load under 8 MB; CrazyGames: 50 MB, 20 MB for its mobile home page), and what players feel is the first-play download, so the
// gate is now TWO numbers: G0 = the whole output folder under 3 MB raw, G0b = the first-play files (html, js, css, not `later-*` chunks) under
// 600 KB gzip (about 345 KB today). Features that are not needed for the first play (pets, voices, secondary screens) are dynamic imports named `later-*`.
const G0_BUDGET_BYTES = 3 * 1024 * 1024;
const G0B_FIRST_PLAY_GZIP_BYTES = 600 * 1024;
// (round 10, R10_FIX 3; VERDICT_R9 A3) T1 = PLAYGROUND_BUILD 14.3's whole-build cap SZ-02 (D9's ceiling): every file under the output folder's `assets/` (the code and
// styles the game downloads over a play, first load and lazy chunks; the page, credits, meta and thumbnail beside it are the portal's) at most 2000 KB (decimal, as
// SZ-02 and the verifier measure it). `vite build` FAILS over it; until round 10 only G0's 3 MB folder gate ran, so the total grew past 2000 unnoticed.
const T1_ASSETS_BUDGET_BYTES = 2000 * 1000;

// PLAYGROUND (PG_SHELL round 3; PLAYGROUND_BUILD.md 13, 14.3, D-69): the lazy chunks that only load AFTER the first frame of play are named `later-*`, so G0b counts
// what a first play downloads and nothing else. By file name already: `shell/later-life.ts` (the LIFE chunk, requested after the first frame of play) and
// `ui/later-journal.ts` (the Journal and Travel screens). By facade here: the away chunk (the place host and the ambience bed, loaded with the first trip), each
// place's three modules (render look, audio recipe, data; loaded when the place is visited) and the stage's lazy bubbles-and-Home-things module (`render/lifelook.ts`:
// the stage loads it only when the LIFE host first draws a bubble or a thing). A chunk with no facade is `later-shared-*` only when EVERY module in it is one of
// these lazy-only modules. NOT renamed: `audio/life_voices.ts` (the engine loads it at the first audio unlock, i.e. at the start of play: it is first-play, and G0b
// counts it). The HONESTY CHECK (sizeBudget's generateBundle): a build FAILS when a chunk counted as first-play statically imports a later-* chunk, because then
// the later-* name would hide first-play bytes from G0b.
const LATER_FACADES: ReadonlyArray<readonly [RegExp, (m: RegExpMatchArray) => string]> = [
  [/[\\/]src[\\/]render[\\/]place\.ts$/, () => 'later-away'],
  [/[\\/]src[\\/]audio[\\/]ambience\.ts$/, () => 'later-away-sound'],
  [/[\\/]src[\\/]render[\\/]places[\\/]([a-z]+)\.ts$/, (m) => `later-place-${m[1]}`],
  [/[\\/]src[\\/]audio[\\/]places[\\/]([a-z]+)\.ts$/, (m) => `later-place-${m[1]}-sound`],
  [/[\\/]src[\\/]data[\\/]place_([a-z]+)\.ts$/, (m) => `later-place-${m[1]}-data`],
  [/[\\/]src[\\/]render[\\/]lifelook\.ts$/, () => 'later-lifelook'],
  // (round 6) the Places sheet's postcard pictures (R6_RENDER 4), imported by the Journal / Travel chunk once a sheet opens
  [/[\\/]src[\\/]render[\\/]postcard\.ts$/, () => 'later-postcard'],
  // the Journal's words (the screens chunk imports them; the life chunk imports them lazily for a stamp's title outside Home): when the split makes them a
  // chunk of their own, it is lazy-only (LAZY_ONLY below) and named so
  [/[\\/]src[\\/]data[\\/]journal_text\.ts$/, () => 'later-journal-text'],
];
/** modules that only lazy code imports (the LIFE chunk, the Journal, the away and place chunks, the stage's lazy bubbles) */
const LAZY_ONLY: readonly RegExp[] = [
  /[\\/]src[\\/]life[\\/]/, /[\\/]src[\\/]data[\\/](life|places|quests|journal_text|place_[a-z]+)\.ts$/, /[\\/]src[\\/]core[\\/]quests\.ts$/,
  /[\\/]src[\\/]collection[\\/]journal(_store)?\.ts$/, /[\\/]src[\\/]physics[\\/]props\.ts$/, /[\\/]src[\\/](shell|ui)[\\/]later-/, /[\\/]src[\\/]ui[\\/](wishes\.ts|journal\.css|play\.css)$/,
  /[\\/]src[\\/]render[\\/](place|placeview|lifelook|homekit|emotes|postcard)\.ts$/, /[\\/]src[\\/]render[\\/]places[\\/]/, /[\\/]src[\\/]audio[\\/](ambience|props|things)\.ts$/, /[\\/]src[\\/]audio[\\/]places[\\/]/,
];
/** Round 7 (R7_SHELL; D-92's overflow rule "over a cap a lane packs, then moves into a lazier named chunk"): LIFE's brain (src/life/**) is a chunk of its own,
 *  `later-brain`, which the life chunk imports (so it loads with it, in parallel: vite's preload of a dynamic import's dependencies). The life chunk was 147.1 KB
 *  of its 150 KB cap (SZ-02) at round 6's end, and round 7 grows LIFE's brain by about 12 KB and the host by about 3 KB. Only the brain's own modules move
 *  (no dependency of theirs: `includeDependenciesRecursively: false`), so nothing a first play loads can land in it (the honesty check would fail the build). */
const BRAIN_RE = /[\\/]src[\\/]life[\\/]/;
export function laterChunkName(facade: string | null, moduleIds: readonly string[]): string | null {
  const f = facade ?? '';
  for (const [re, nm] of LATER_FACADES) { const m = f.match(re); if (m) return nm(m); }
  if (!facade && moduleIds.length > 0 && moduleIds.every((id) => BRAIN_RE.test(id))) return 'later-brain';
  if (!facade && moduleIds.length > 0 && moduleIds.every((id) => LAZY_ONLY.some((re) => re.test(id)))) return 'later-shared';
  return null;
}

// D-96 (owner, 2026-11-18: seven places): Fizzwell Tub, Cogwhistle Bench and Echo Hollow are DROPPED. Their place modules are gone (data, sound; they never had a
// look), so no `later-place-<id>*` chunk is emitted for them; this guard keeps it so: a build FAILS when an emitted chunk is named for a dropped place, holds a
// module of one (src/data/place_<id>.ts, src/audio/places/<id>.ts, src/render/places/<id>.ts), or carries a dropped place's PLAYER-VISIBLE name (its capitalised
// name: "Fizzwell", "Cogwhistle", "Echo Hollow"). The lower-case ids stay as append-only tombstones in src/data/places.ts (a place, thing, quest and keepsake index
// is saved: R6_DATA.md 1), so an id alone is not a leak.
export const DROPPED_PLACE_IDS = ['fizzwell', 'cogwhistle', 'echohollow'] as const;
const DROPPED_RE = DROPPED_PLACE_IDS.join('|');
const DROPPED_CHUNK = new RegExp(`(^|/)later-place-(${DROPPED_RE})(-|$)`);
const DROPPED_MODULE = new RegExp(`[\\\\/]src[\\\\/](data[\\\\/]place_|audio[\\\\/]places[\\\\/]|render[\\\\/]places[\\\\/])(${DROPPED_RE})\\.ts$`);
const DROPPED_NAME = /Fizzwell|Cogwhistle|Echo Hollow/;
/** What of a dropped place an emitted bundle would ship (file -> why), empty when none: the D-96 guard of sizeBudget's generateBundle (probe_app tests it). */
export function droppedPlaceLeaks(bundle: Readonly<Record<string, { type: string; fileName?: string; moduleIds?: readonly string[]; code?: string; source?: unknown }>>): string[] {
  const out: string[] = [];
  for (const [f, c] of Object.entries(bundle)) {
    if (DROPPED_CHUNK.test(f)) out.push(`${f}: a chunk named for a dropped place`);
    if (c.type === 'chunk') {
      for (const m of c.moduleIds ?? []) if (DROPPED_MODULE.test(m)) out.push(`${f}: holds ${m}`);
      const hit = typeof c.code === 'string' ? DROPPED_NAME.exec(c.code) : null;
      if (hit) out.push(`${f}: names "${hit[0]}"`);
    } else if (/\.(html|css|js|json|txt)$/.test(f) && (typeof c.source === 'string' || c.source instanceof Uint8Array)) {
      const text = typeof c.source === 'string' ? c.source : Buffer.from(c.source).toString('utf8');
      const hit = DROPPED_NAME.exec(text);
      if (hit) out.push(`${f}: names "${hit[0]}"`);
    }
  }
  return out;
}

type Next = (err?: unknown) => void;

function safeName(raw: string, fallback: string): string {
  let s = raw.split('?')[0].split('#')[0];
  try { s = decodeURIComponent(s); } catch { /* keep the raw text */ }
  s = s.replace(/\.(png|jpe?g|webp|json)$/i, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/^[._-]+/, '')
    .slice(0, 160);
  return s || fallback;
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on('data', (c: Buffer) => {
      if (failed) return;
      size += c.length;
      if (size > limit) { failed = true; fail(new Error(`body larger than ${limit} bytes`)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (!failed) ok(Buffer.concat(chunks)); });
    req.on('error', (e) => { if (!failed) { failed = true; fail(e); } });
  });
}

function reply(res: ServerResponse, code: number, body: Record<string, unknown>): void {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

const EXT_BY_MIME: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp' };

function decodeShot(body: Buffer, contentType: string): { bytes: Buffer; ext: string } {
  const ct = contentType.toLowerCase();
  if (ct.startsWith('image/')) {
    const mime = ct.split(';')[0].trim();
    return { bytes: body, ext: EXT_BY_MIME[mime] ?? 'png' };
  }
  const text = body.toString('utf8').trim();
  const m = /^data:(image\/[a-z0-9.+-]+)?(;[^,]*)?,/i.exec(text);
  if (!m) throw new Error('expected a data:image/...;base64 URL or an image/* body');
  const mime = (m[1] || 'image/png').toLowerCase();
  const isB64 = /;base64/i.test(m[2] || '');
  const payload = text.slice(m[0].length);
  const bytes = isB64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'binary');
  if (bytes.length === 0) throw new Error('empty image payload');
  return { bytes, ext: EXT_BY_MIME[mime] ?? 'png' };
}

// ---------------------------------------------------------------------------------------------------------------- same-origin gate
/** Loopback names only: localhost (and *.localhost, which browsers pin to loopback), 127.0.0.0/8, [::1]. */
function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || /^127(?:\.\d{1,3}){3}$/.test(h) || h === '[::1]';
}

function hostnameOf(host: string): string | null {
  try { return new URL(`http://${host}`).hostname; } catch { return null; }
}

/**
 * Why this request may NOT use the harness endpoints, or null when it may.
 *   * Host must name a loopback address (blocks DNS rebinding; Vite's own allowedHosts check runs first and says the same).
 *   * A browser marks every fetch/form POST with Sec-Fetch-Site and/or Origin. Only `same-origin` is accepted: a page served by THIS
 *     server (the game at ?dev=1, the harness pages). Another site, another localhost port, a sandboxed frame ('null') are refused.
 *   * A request with neither header did not come from a web page (curl, a Node script): nothing a website can trigger, so it passes.
 * The endpoints answer no CORS preflight with a grant, so a cross-origin caller cannot even read the refusal.
 */
export function harnessRefusal(headers: IncomingMessage['headers']): string | null {
  const host = typeof headers.host === 'string' ? headers.host : '';
  const hostName = host ? hostnameOf(host) : null;
  if (!hostName || !isLoopbackHostname(hostName)) return `host ${JSON.stringify(host)} is not a loopback address`;
  const site = headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin') return `Sec-Fetch-Site ${JSON.stringify(site)} (only same-origin pages may post here)`;
  const origin = headers.origin;
  if (origin !== undefined) {
    let o: URL;
    try { o = new URL(origin); } catch { return `Origin ${JSON.stringify(origin)} is not a URL`; }
    if (o.host.toLowerCase() !== host.toLowerCase() || !isLoopbackHostname(o.hostname)) {
      return `Origin ${JSON.stringify(origin)} is not this server (${host})`;
    }
  }
  return null;
}

function harnessEndpoints(): Plugin {
  const handle = (req: IncomingMessage, res: ServerResponse, next: Next): void => {
    const url = req.url ?? '';
    const isShot = url.startsWith('/__shot/');
    const isReport = url.startsWith('/__report/');
    if (!isShot && !isReport) { next(); return; }
    const refusal = harnessRefusal(req.headers);
    if (refusal) {
      reply(res, 403, { ok: false, error: `harness endpoint refused: ${refusal}` });
      req.resume(); // drain and discard the body
      return;
    }
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.setHeader('Allow', 'POST, OPTIONS'); res.end(); return; }
    if (req.method !== 'POST') { reply(res, 405, { ok: false, error: 'POST only' }); return; }
    readBody(req, isShot ? MAX_SHOT_BYTES : MAX_REPORT_BYTES).then((body) => {
      if (isShot) {
        const name = safeName(url.slice('/__shot/'.length), 'shot');
        const { bytes, ext } = decodeShot(body, String(req.headers['content-type'] ?? ''));
        mkdirSync(SHOTS_DIR, { recursive: true });
        const file = resolve(SHOTS_DIR, `${name}.${ext}`);
        writeFileSync(file, bytes);
        reply(res, 200, { ok: true, path: file, rel: relative(ROOT, file).replace(/\\/g, '/'), bytes: bytes.length });
      } else {
        const name = safeName(url.slice('/__report/'.length), 'report');
        const text = body.toString('utf8');
        let data: unknown;
        try { data = JSON.parse(text); } catch (e) { throw new Error('report body is not JSON: ' + (e instanceof Error ? e.message : String(e))); }
        mkdirSync(REPORTS_DIR, { recursive: true });
        const file = resolve(REPORTS_DIR, `${name}.json`);
        writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
        reply(res, 200, { ok: true, path: file, rel: relative(ROOT, file).replace(/\\/g, '/'), bytes: Buffer.byteLength(text) });
      }
    }).catch((e: unknown) => {
      reply(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) });
    });
  };
  return {
    name: 'wobblehoard-harness-endpoints',
    apply: 'serve', // dev server and `vite preview` (both resolve with command 'serve'); never in `vite build`
    configureServer(server) { server.middlewares.use(handle); },
    configurePreviewServer(server) { server.middlewares.use(handle); },
  };
}

// ---------------------------------------------------------------------------------------------------------------- G0 size budget
function dirBytes(dir: string): number {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name);
    n += e.isDirectory() ? dirBytes(p) : statSync(p).size;
  }
  return n;
}

/** Gzip level 9 size of every html / js / css file in the output folder that is NOT a `later-` chunk (G0b: what a first play must download).
 *  Gzip, not brotli, on purpose: it is the more conservative of the two that a CDN serves. */
function firstPlayGzipBytes(dir: string): number {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) n += firstPlayGzipBytes(p);
    else if (/\.(html|js|css)$/.test(e.name) && !e.name.startsWith('later-')) n += gzipSync(readFileSync(p), { level: 9 }).length;
  }
  return n;
}

export function sizeBudget(limit: number, firstPlayLimit: number, assetsLimit = T1_ASSETS_BUDGET_BYTES): Plugin {
  let outDir = '';
  return {
    name: 'wobblehoard-g0-size-budget',
    apply: 'build',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    // the honesty check of the later-* names (PG_SHELL round 3): a chunk G0b counts (not later-*) must never STATICALLY import a later-* chunk
    generateBundle(_o, bundle) {
      const later = (f: string): boolean => /(^|\/)later-[^/]*$/.test(f);
      const bad: string[] = [];
      for (const [f, c] of Object.entries(bundle)) {
        if (c.type !== 'chunk' || later(f)) continue;
        for (const imp of c.imports) if (later(imp)) bad.push(`${f} -> ${imp}`);
      }
      if (bad.length) throw new Error(`[G0b] a first-play chunk statically imports a later-* chunk, so its later-* name would hide first-play bytes: ${bad.join(', ')}`);
      // D-96: nothing of the three dropped places ships (droppedPlaceLeaks above)
      const leaks = droppedPlaceLeaks(bundle as unknown as Parameters<typeof droppedPlaceLeaks>[0]);
      if (leaks.length) throw new Error(`[D-96] the build would ship a dropped place (Fizzwell Tub, Cogwhistle Bench, Echo Hollow): ${leaks.join('; ')}`);
    },
    closeBundle() {
      const total = dirBytes(outDir);
      const first = firstPlayGzipBytes(outDir);
      const kb = (b: number): string => `${(b / 1024).toFixed(0)} KB`;
      const rel = relative(ROOT, outDir);
      const line = `[G0] build output ${kb(total)} of the ${kb(limit)} budget (${rel && !rel.startsWith('..') ? rel : outDir})`;
      const line2 = `[G0b] first-play download ${kb(first)} gzip of the ${kb(firstPlayLimit)} budget (html, js and css except later-* chunks)`;
      let assets = 0;
      try { assets = dirBytes(resolve(outDir, 'assets')); } catch { assets = 0; }
      const line3 = `[T1] game assets ${(assets / 1000).toFixed(1)} KB of the ${(assetsLimit / 1000).toFixed(0)} KB whole-build cap (SZ-02, D9: every file under assets/)`;
      if (total >= limit) throw new Error(`${line}: OVER BUDGET (CONTRACT section 6, gate G0)`);
      if (first >= firstPlayLimit) throw new Error(`${line2}: OVER BUDGET (CONTRACT section 6, gate G0b)`);
      if (assets > assetsLimit) throw new Error(`${line3}: OVER BUDGET (PLAYGROUND_BUILD 14.3 SZ-02, gate T1)`);
      console.log(line);
      console.log(line2);
      console.log(line3);
    },
  };
}

export default defineConfig({
  root: ROOT,
  base: './',
  clearScreen: false,
  plugins: [harnessEndpoints(), sizeBudget(G0_BUDGET_BYTES, G0B_FIRST_PLAY_GZIP_BYTES)],
  css: { postcss: { plugins: [] } },
  server: {
    port: 5360,
    strictPort: true,
    headers: { 'Cache-Control': 'no-store' },
    // WH_FROZEN=1: no HMR / no file watching, so concurrent edits never reload a page mid-test.
    ...(process.env.WH_FROZEN === '1' ? { hmr: false, watch: null } : {}),
    fs: { strict: true },
  },
  preview: {
    port: 5361,
    strictPort: true,
    headers: { 'Cache-Control': 'no-store' },
  },
  optimizeDeps: { include: ['three'] },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 1024,
    rolldownOptions: {
      output: {
        // PLAYGROUND: the later-* names of the lazy chunks (laterChunkName above); every other chunk keeps Vite's default name
        chunkFileNames: (c) => { const n = laterChunkName(c.facadeModuleId ?? null, c.moduleIds); return n ? `assets/${n}-[hash].js` : 'assets/[name]-[hash].js'; },
        // (round 7) LIFE's brain in a lazy chunk of its own (BRAIN_RE above); every other module is split as before (automatic)
        codeSplitting: { includeDependenciesRecursively: false, groups: [{ name: 'later-brain', test: BRAIN_RE }] },
      },
    },
  },
});
