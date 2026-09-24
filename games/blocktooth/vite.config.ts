// BLOCKTOOTH — Vite dev/build config (CONTRACT.md §14). app lane.
//
//   * dev server: http://localhost:5178, strictPort (the harness hard-codes the port), no-store
//     headers so every reload re-fetches every ES module (doctrine §6: "ES modules cache hard").
//   * base './' so a built dist/ can be hosted from any sub-path (portal / CDN folder).
//   * harness endpoints (dev AND `vite preview`):
//       POST /__shot/<name>    body = PNG data URL (or raw image/png | image/jpeg bytes)
//                              → _shots/<name>.png          reply {ok, path, bytes}
//       POST /__report/<name>  body = JSON                  → _harness/_reports/<name>.json
//     Names are sanitised to [A-Za-z0-9_.-]; directories are created on demand. A shot posted as
//     a data URL of another image type keeps its real extension (.jpg / .webp).
//   * optimizeDeps pre-bundles three + Rapier (compat build embeds its WASM) so the first page
//     load does not stall on a dependency re-optimisation reload.
//   * css.postcss is inline + empty on purpose (see below): isolates the game from the parent
//     repo's Tailwind PostCSS config.

import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = resolve(ROOT, '_shots');
const REPORTS_DIR = resolve(ROOT, '_harness', '_reports');
/** largest accepted POST body (a 4K PNG data URL is ~20 MB) */
const MAX_BODY_BYTES = 64 * 1024 * 1024;

type Next = (err?: unknown) => void;

/** `/__shot/a b/c.png?x=1` → `a_b_c` (never escapes the target directory). */
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
      if (size > limit) {
        failed = true;
        fail(new Error(`body larger than ${limit} bytes`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!failed) ok(Buffer.concat(chunks)); });
    req.on('error', (e) => { if (!failed) { failed = true; fail(e); } });
  });
}

function reply(res: ServerResponse, code: number, body: Record<string, unknown>): void {
  const text = JSON.stringify(body);
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(text);
}

const EXT_BY_MIME: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp' };

/** Decode a shot body: `data:image/png;base64,...` text, or raw image bytes. */
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

/** The /__shot + /__report POST endpoints the harness and window.__BT__.shot() use. */
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
    name: 'blocktooth-harness-endpoints',
    configureServer(server) { server.middlewares.use(handle); },
    configurePreviewServer(server) { server.middlewares.use(handle); },
  };
}

export default defineConfig({
  root: ROOT,
  base: './',
  clearScreen: false,
  plugins: [harnessEndpoints()],
  // an INLINE PostCSS config stops Vite searching parent folders: forgeflow-games/postcss.config.js
  // (the portal's Tailwind) would otherwise run over this game's stylesheet
  css: { postcss: { plugins: [] } },
  server: {
    port: 5178,
    strictPort: true,
    headers: { 'Cache-Control': 'no-store' },
    // BT_FROZEN=1 (set by harness runs while other agents edit src/): no HMR and no file watching,
    // so a concurrent edit can never hot-reload a page mid-test and bounce it back to the title.
    ...(process.env.BT_FROZEN === '1' ? { hmr: false, watch: null } : {}),
    fs: { strict: true },
  },
  preview: {
    port: 5179,
    strictPort: true,
    headers: { 'Cache-Control': 'no-store' },
  },
  optimizeDeps: {
    include: ['three', '@dimforge/rapier3d-compat'],
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    assetsInlineLimit: 4096,
    // Rapier's compat build inlines its WASM (~2 MB of base64) and three is ~0.7 MB minified: big
    // vendor chunks by nature. The default 500 kB warning would fire on every build and bury real
    // warnings; the limit sits above the Rapier chunk.
    chunkSizeWarningLimit: 4096,
    rolldownOptions: {
      output: {
        // vendor chunks change far less often than game code → better caching between deploys
        codeSplitting: {
          groups: [
            { name: 'vendor-rapier', test: /[\\/]node_modules[\\/]@dimforge[\\/]/ },
            { name: 'vendor-three', test: /[\\/]node_modules[\\/]three[\\/]/ },
          ],
        },
      },
    },
  },
});
