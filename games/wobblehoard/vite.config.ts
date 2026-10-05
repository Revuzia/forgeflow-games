// WOBBLEHOARD — Vite dev/build config.
//   * dev :5360 / preview :5361, strictPort (the harness hard-codes them), no-store headers.
//   * base './' so a built dist/ can be hosted from any sub-path (portal / CDN folder).
//   * harness endpoints (dev server and `vite preview` ONLY; never part of a build), same contract as the other ForgeFlow 3D games:
//       POST /__shot/<name>    body = PNG data URL (or raw image bytes) → _shots/<name>.png
//       POST /__report/<name>  body = JSON                              → _harness/_reports/<name>.json
//     They write into the repo, so they answer SAME-ORIGIN LOCALHOST requests only (harnessRefusal below): a web page open in
//     another tab must not be able to fill the disk or overwrite gate evidence with a cross-site "simple" POST.
//   * G0 size budget: every `vite build` prints the size of its output folder and FAILS when it is over 1.2 MB (CONTRACT section 6,
//     gate G0, measured exactly like _harness/browser_shell.mjs: every file in the output folder, public/ files included).
//   * css.postcss is inline + empty on purpose: isolates the game from the portal's Tailwind PostCSS config.
import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = resolve(ROOT, '_shots');
const REPORTS_DIR = resolve(ROOT, '_harness', '_reports');
// A PNG data URL of a DPR-2 desktop canvas is a few MB; the largest shot on disk today is 2.2 MB. Reports are small JSON.
const MAX_SHOT_BYTES = 24 * 1024 * 1024;
const MAX_REPORT_BYTES = 8 * 1024 * 1024;
const G0_BUDGET_BYTES = 1.2 * 1024 * 1024; // the same constant as browser_shell.mjs ('dist stays under the 1.2 MB budget (G0)')

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

export function sizeBudget(limit: number): Plugin {
  let outDir = '';
  return {
    name: 'wobblehoard-g0-size-budget',
    apply: 'build',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    closeBundle() {
      const total = dirBytes(outDir);
      const kb = (b: number): string => `${(b / 1024).toFixed(0)} KB`;
      const rel = relative(ROOT, outDir);
      const line = `[G0] build output ${kb(total)} of the ${kb(limit)} budget (${rel && !rel.startsWith('..') ? rel : outDir})`;
      if (total >= limit) throw new Error(`${line}: OVER BUDGET (CONTRACT section 6, gate G0)`);
      console.log(line);
    },
  };
}

export default defineConfig({
  root: ROOT,
  base: './',
  clearScreen: false,
  plugins: [harnessEndpoints(), sizeBudget(G0_BUDGET_BYTES)],
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
  },
});
