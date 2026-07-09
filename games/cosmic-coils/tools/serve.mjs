/**
 * Tiny static file server (no deps) for local preview.
 * Usage: node tools/serve.mjs [rootDir] [port]
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const dirArg = process.argv[2] || "dist";
const port = Number(process.argv[3] || 4173);
const root = path.resolve(ROOT, dirArg);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

if (!fs.existsSync(root)) {
  console.error(`[serve] root not found: ${root}`);
  console.error(`[serve] run "npm run build" first if serving dist`);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  try {
    const u = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    let rel = decodeURIComponent(u.pathname);
    if (rel === "/") rel = "/index.html";
    // block path escape
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root)) {
      res.writeHead(403); res.end("forbidden"); return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found: " + rel);
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const data = fs.readFileSync(file);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(data);
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[serve] ${root}`);
  console.log(`[serve] PREVIEW_URL http://127.0.0.1:${port}/`);
});
