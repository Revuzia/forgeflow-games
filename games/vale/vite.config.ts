// VALE — Vite dev/build config (CONTRACT §3.1, §13). Lane TOOLS.
//
//   * root = this folder, base './' — the built dist/ runs from any sub-path (portal folder, CDN prefix).
//   * dev http://localhost:5190, preview http://localhost:5191, strictPort (the harness hard-codes both);
//     no-store headers in dev so every reload re-fetches every ES module.
//   * TWO BUILDS: the client build (dist/) carries no content. In dev and preview a middleware serves
//     GET /catalog/* from dist-catalog/ (`npm run content`), which is exactly where deploy/ puts the
//     catalog, so './catalog/manifest.json' (public/config.js) works unchanged in dev, preview and prod.
//   * harness endpoints (dev AND preview):
//       POST /__shot/<name>    body = PNG data URL or raw image/* bytes → _harness/_shots/<name>.<ext>
//       POST /__report/<name>  body = JSON                              → _harness/_reports/<name>.json
//     <name> is sanitized to [A-Za-z0-9_.-] (no traversal); reply {ok, path, rel, bytes}.
//   * VALE_FROZEN=1 (harness runs while other lanes edit): no HMR, no file watching.
//     VALE_CATALOG_DIR=<dir> serves /catalog/* from <dir> instead of dist-catalog/ (fixture catalogs).
//   * css.postcss inline + empty: isolates the game from the repo-root postcss/Tailwind config.
//   * JSX: Vite 8 transforms TS/TSX with oxc (not esbuild). `oxc.jsx` is set explicitly to the
//     automatic runtime with importSource 'preact', matching tsconfig's jsxImportSource, so .tsx
//     compiles to `preact/jsx-runtime` imports whether or not the transform reads tsconfig.
//   * build: es2022, no source maps (they would publish the full TS source), vendor chunks for
//     three / postprocessing(+n8ao) / preact(+signals) so a game-code change does not bust their cache.

import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { createReadStream, mkdirSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';

const ROOT = dirname(fileURLToPath(import.meta.url));
// VALE_CATALOG_DIR lets the harness serve a fixture catalog without touching the real dist-catalog/
const CATALOG_DIR = resolve(ROOT, process.env.VALE_CATALOG_DIR || 'dist-catalog');
const SHOTS_DIR = resolve(ROOT, '_harness', '_shots');
const REPORTS_DIR = resolve(ROOT, '_harness', '_reports');
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const FROZEN = process.env.VALE_FROZEN === '1';
const UNWATCHED = ['dist', 'dist-catalog', 'deploy', 'art', 'audio', 'content', '_harness', '_design'].map((d) => resolve(ROOT, d));

type Next = (err?: unknown) => void;

// ── /catalog/* static middleware ────────────────────────────────────────────────────────────────
const MIME: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.hdr': 'image/vnd.radiance',
  '.exr': 'image/x-exr',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.cube': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ktx2': 'image/ktx2',
  '.svg': 'image/svg+xml',
  '.bin': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
};

function catalogMiddleware(req: IncomingMessage, res: ServerResponse, next: Next): void {
  const url = req.url ?? '';
  if (!url.startsWith('/catalog/')) { next(); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.setHeader('Allow', 'GET, HEAD'); res.end(); return; }
  let rel: string;
  try { rel = decodeURIComponent(url.slice('/catalog/'.length).split(/[?#]/)[0]); } catch { res.statusCode = 400; res.end('bad path'); return; }
  const file = resolve(CATALOG_DIR, rel);
  // never serve outside dist-catalog/ (../ in the path, absolute paths, NUL bytes)
  if (rel.includes('\0') || (file !== CATALOG_DIR && !file.startsWith(CATALOG_DIR + sep))) { res.statusCode = 403; res.end('forbidden'); return; }
  let size: number;
  try {
    const st = statSync(file);
    if (!st.isFile()) throw new Error('not a file');
    size = st.size;
  } catch {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    const r = relative(ROOT, CATALOG_DIR).replace(/\\/g, '/');
    const where = r.startsWith('..') ? CATALOG_DIR : r || '.';
    res.end(rel === 'manifest.json'
      ? `${where}/manifest.json not found — run \`npm run content\` (content build) first`
      : `not found in ${where}/: ${rel}`);
    return;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('Content-Length', String(size));
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

// ── harness endpoints ───────────────────────────────────────────────────────────────────────────
function safeName(raw: string, fallback: string): string {
  let s = raw.split(/[?#]/)[0];
  try { s = decodeURIComponent(s); } catch { /* keep raw */ }
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
  const ct = contentType.toLowerCase().split(';')[0].trim();
  if (ct.startsWith('image/')) return { bytes: body, ext: EXT_BY_MIME[ct] ?? 'png' };
  const text = body.toString('utf8').trim();
  const m = /^data:(image\/[a-z0-9.+-]+)?(;[^,]*)?,/i.exec(text);
  if (!m) throw new Error('expected a data:image/...;base64 URL or an image/* body');
  const mime = (m[1] || 'image/png').toLowerCase();
  const payload = text.slice(m[0].length);
  const bytes = /;base64/i.test(m[2] || '') ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'binary');
  if (bytes.length === 0) throw new Error('empty image payload');
  return { bytes, ext: EXT_BY_MIME[mime] ?? 'png' };
}

function harnessMiddleware(req: IncomingMessage, res: ServerResponse, next: Next): void {
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
}

function valeServer(): Plugin {
  // registered directly (not returned as a post hook) so they run BEFORE Vite's own middlewares,
  // e.g. before the SPA fallback could answer a missing /catalog/manifest.json with index.html
  const install = (m: { use(fn: (req: IncomingMessage, res: ServerResponse, next: Next) => void): unknown }): void => {
    m.use(catalogMiddleware);
    m.use(harnessMiddleware);
  };
  return {
    name: 'vale-server',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}

export default defineConfig({
  root: ROOT,
  base: './',
  publicDir: resolve(ROOT, 'public'),
  clearScreen: false,
  plugins: [valeServer()],
  css: { postcss: { plugins: [] } },
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'preact' },
  },
  server: {
    port: 5190,
    strictPort: true,
    headers: { 'Cache-Control': 'no-store' },
    ...(FROZEN ? { hmr: false, watch: null } : {
      // big non-client trees (Blender output, audio renders, build output) must not trigger reloads;
      // anchored at the project root so src/audio/** etc. still hot-reload
      watch: { ignored: [(p: string) => UNWATCHED.some((d) => p === d || p.startsWith(d + sep))] },
    }),
  },
  preview: {
    port: 5191,
    strictPort: true,
  },
  optimizeDeps: {
    include: ['three', 'postprocessing', 'n8ao', 'preact', 'preact/hooks', 'preact/jsx-runtime', 'preact/jsx-dev-runtime', '@preact/signals'],
  },
  build: {
    target: 'es2022',
    outDir: resolve(ROOT, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 2048,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor-three', test: /[\\/]node_modules[\\/]three[\\/]/ },
            { name: 'vendor-post', test: /[\\/]node_modules[\\/](postprocessing|n8ao)[\\/]/ },
            { name: 'vendor-preact', test: /[\\/]node_modules[\\/](preact|@preact)[\\/]/ },
          ],
        },
      },
    },
  },
});
