// WOBBLEHOARD — Vite dev/build config.
//   * dev :5360 / preview :5361, strictPort (the harness hard-codes them), no-store headers.
//   * base './' so a built dist/ can be hosted from any sub-path (portal / CDN folder).
//   * harness endpoints (dev AND preview), same contract as the other ForgeFlow 3D games:
//       POST /__shot/<name>    body = PNG data URL (or raw image bytes) → _shots/<name>.png
//       POST /__report/<name>  body = JSON                              → _harness/_reports/<name>.json
//   * css.postcss is inline + empty on purpose: isolates the game from the portal's Tailwind PostCSS config.
import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = resolve(ROOT, '_shots');
const REPORTS_DIR = resolve(ROOT, '_harness', '_reports');
const MAX_BODY_BYTES = 64 * 1024 * 1024;

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

function harnessEndpoints(): Plugin {
  const handle = (req: IncomingMessage, res: ServerResponse, next: Next): void => {
    const url = req.url ?? '';
    const isShot = url.startsWith('/__shot/');
    const isReport = url.startsWith('/__report/');
    if (!isShot && !isReport) { next(); return; }
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.setHeader('Allow', 'POST, OPTIONS'); res.end(); return; }
    if (req.method !== 'POST') { reply(res, 405, { ok: false, error: 'POST only' }); return; }
    readBody(req, MAX_BODY_BYTES).then((body) => {
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
    configureServer(server) { server.middlewares.use(handle); },
    configurePreviewServer(server) { server.middlewares.use(handle); },
  };
}

export default defineConfig({
  root: ROOT,
  base: './',
  clearScreen: false,
  plugins: [harnessEndpoints()],
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
