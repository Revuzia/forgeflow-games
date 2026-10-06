// scripts/postbuild-404.mjs — runs as `postbuild`, after vike/vite have written
// dist/client.
//
// WHY: Cloudflare Pages treats a project with NO top-level 404.html as a
// single-page app and answers EVERY unknown URL with HTTP 200 + the homepage.
// Measured on the live site: /zzz-not-a-page -> 200. Google calls that a "soft
// 404", and it is exactly the defect that sank Revuzia's AdSense application.
// Shipping a real top-level 404.html switches Pages to proper 404 status codes.
//
// This page is deliberately plain static HTML (no React bundle): it has to work
// for any URL at any depth, and it must carry noindex.

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist", "client");

if (!existsSync(OUT)) {
  console.error(`[404] ${OUT} does not exist — build output moved? Not writing 404.html`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, follow">
<title>Page not found | ForgeFlow Games</title>
<link rel="icon" type="image/png" href="/images/favicon.png">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #0a0e1a; color: #d1d5db; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding: 24px; }
  main { max-width: 520px; text-align: center; }
  .code { font-size: 72px; font-weight: 800; letter-spacing: -2px; color: #ff8800; margin: 0; line-height: 1; }
  h1 { font-size: 24px; margin: 12px 0 8px; color: #f3f4f6; }
  p { margin: 0 0 24px; line-height: 1.6; color: #9ca3af; }
  a.btn { display: inline-block; padding: 12px 22px; border-radius: 10px; background: #ff8800; color: #0a0e1a;
    font-weight: 700; text-decoration: none; margin: 4px; }
  a.alt { background: transparent; color: #d1d5db; border: 1px solid #374151; }
</style>
</head>
<body>
<main>
  <p class="code">404</p>
  <h1>That page isn't here</h1>
  <p>The link may be old, or the game may have moved. Everything we have is a click away.</p>
  <a class="btn" href="/games/">Browse all games</a>
  <a class="btn alt" href="/">Home</a>
</main>
</body>
</html>
`;

writeFileSync(join(OUT, "404.html"), html, "utf8");
console.log("[404] wrote dist/client/404.html");
