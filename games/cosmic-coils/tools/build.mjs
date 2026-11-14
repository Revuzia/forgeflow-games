/**
 * Cosmic Coils — local production-like build (no deploy).
 *
 * 1. Strips cache-bust `+ V` dynamic import suffixes so the graph is static.
 * 2. Rewrites top-level `const X = await import(...)` → static ESM imports
 *    so esbuild can fully bundle (lazy online net stays as a static include).
 * 3. Bundles + minifies boot → dist/runtime/3d/boot.js (three left external/CDN).
 * 4. Minifies game_controls.js; copies index, content.json, assets.
 *
 * Usage: node tools/build.mjs
 * Preview: npm run preview  →  http://127.0.0.1:4173/
 */
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const STAGING = path.join(ROOT, ".build-staging");

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}
function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}
function copyFile(src, dest) {
  mkdirp(path.dirname(dest));
  fs.copyFileSync(src, dest);
}
function copyDir(src, dest) {
  mkdirp(dest);
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else copyFile(s, d);
  }
}

/**
 * Rewrite Cosmic Coils' cache-busted top-level dynamic imports into static
 * ESM so esbuild can produce one minified module. Leaves https:// URLs alone.
 * Also flattens lazy `this._netMod = await import(...)` to a static binding.
 */
function rewriteForBundle(code, filePath) {
  const rel = path.relative(ROOT, filePath).replace(/\\/g, "/");
  const staticLines = [];
  let body = code;
  let n = 0;

  // top-level: const { A, B } = await import("x" + V);
  body = body.replace(
    /^const\s+(\{[^}]+\}|\w+)\s*=\s*await\s+import\s*\(\s*(["'`])([^"'`]+)\2\s*(?:\+\s*V)?\s*\)\s*;?\s*$/gm,
    (_, binding, q, spec) => {
      if (/^https?:\/\//.test(spec)) return _;
      if (binding.startsWith("{")) {
        staticLines.push(`import ${binding} from ${q}${spec}${q};`);
      } else {
        staticLines.push(`import * as ${binding} from ${q}${spec}${q};`);
      }
      return `/* bundled import: ${spec} */`;
    }
  );

  // mid-function lazy: await import("rel" + V)  →  use pre-imported namespace
  // Only for relative net/coilnet path used by game.js
  if (rel.endsWith("runtime/3d/game.js")) {
    const alias = `__netCoil`;
    if (/import\s*\(\s*["'`][^"'`]*coilnet\.js["'`]\s*(?:\+\s*V)?\s*\)/.test(body)) {
      staticLines.push(`import * as ${alias} from "../net/coilnet.js";`);
      body = body.replace(
        /(?:this\._netMod\s*=\s*)?await\s+import\s*\(\s*["'`][^"'`]*coilnet\.js["'`]\s*(?:\+\s*V)?\s*\)/g,
        `this._netMod = ${alias}`
      );
      // fix double-assign if pattern was `this._netMod = await import` → already assigned
      body = body.replace(/this\._netMod\s*=\s*this\._netMod\s*=\s*/g, "this._netMod = ");
      // openOnline used: if (!this._netMod) this._netMod = ...
      body = body.replace(
        /if\s*\(\s*!this\._netMod\s*\)\s*this\._netMod\s*=\s*__netCoil\s*;?/g,
        "this._netMod = __netCoil;"
      );
    }
  }

  // any remaining relative `import("x" + V)` → `import("x")` (esbuild may still chunk)
  body = body.replace(
    /import\s*\(\s*(["'`])(\.?\.?\/[^"'`]+)\1\s*\+\s*V\s*\)/g,
    'import($1$2$1)'
  );

  // drop unused `const V = new URL(import.meta.url).search` if no longer referenced as + V
  // keep it if still used elsewhere (rare)

  if (!staticLines.length) return body;
  // inject static imports after the first block comment / "use strict" / existing imports
  const inject = staticLines.join("\n") + "\n";
  const m = body.match(/^(?:(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*|\s)*import\s[^;]+;\s*)*/);
  if (m) {
    const at = m[0].length;
    return body.slice(0, at) + inject + body.slice(at);
  }
  return inject + body;
}

function stageSources() {
  rmrf(STAGING);
  mkdirp(STAGING);
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === "node_modules" || ent.name === "dist" || ent.name === ".build-staging") continue;
      const s = path.join(dir, ent.name);
      const rel = path.relative(ROOT, s);
      const d = path.join(STAGING, rel);
      if (ent.isDirectory()) {
        if (ent.name.startsWith(".") && ent.name !== ".") continue;
        walk(s);
      } else if (ent.name.endsWith(".js") && rel.startsWith("runtime" + path.sep)) {
        const src = fs.readFileSync(s, "utf8");
        mkdirp(path.dirname(d));
        fs.writeFileSync(d, rewriteForBundle(src, s));
      }
    }
  };
  walk(ROOT);
}

async function main() {
  console.log("[cc-build] staging sources…");
  stageSources();

  rmrf(DIST);
  mkdirp(path.join(DIST, "runtime", "3d"));
  mkdirp(path.join(DIST, "assets"));

  console.log("[cc-build] bundling runtime/3d/boot.js…");
  const result = await esbuild.build({
    absWorkingDir: STAGING,
    entryPoints: ["runtime/3d/boot.js"],
    bundle: true,
    minify: true,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    outfile: path.join(DIST, "runtime", "3d", "boot.js"),
    external: [
      "three",
      "three/*",
      "https://esm.sh/*",
      "https://cdn.jsdelivr.net/*",
    ],
    logLevel: "info",
    write: true,
    metafile: true,
    // Keep dynamic https import for supabase inside net layer
    banner: {
      js: "/* Cosmic Coils production bundle — local preview only */",
    },
  });

  // minify game_controls (classic script, not ESM)
  await esbuild.build({
    entryPoints: [path.join(ROOT, "game_controls.js")],
    outfile: path.join(DIST, "game_controls.js"),
    minify: true,
    bundle: false,
    platform: "browser",
    logLevel: "silent",
  });

  // index.html → point at bundle without cache-bust (single artifact)
  let html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  html = html
    .replace(/game_controls\.js\?v=\d+/g, "game_controls.js")
    .replace(/runtime\/3d\/boot\.js\?v=\d+/g, "runtime/3d/boot.js");
  // annotate for local preview clarity
  html = html.replace(
    "</title>",
    "</title>\n<!-- local production bundle (npm run preview) -->"
  );
  fs.writeFileSync(path.join(DIST, "index.html"), html);

  copyFile(path.join(ROOT, "content.json"), path.join(DIST, "content.json"));
  if (fs.existsSync(path.join(ROOT, "game_meta.json"))) {
    copyFile(path.join(ROOT, "game_meta.json"), path.join(DIST, "game_meta.json"));
  }
  copyDir(path.join(ROOT, "assets"), path.join(DIST, "assets"));

  // size report
  const bootStat = fs.statSync(path.join(DIST, "runtime", "3d", "boot.js"));
  const ctrlStat = fs.statSync(path.join(DIST, "game_controls.js"));
  const bytes = (n) => (n < 1024 ? n + " B" : (n / 1024).toFixed(1) + " KB");
  console.log("[cc-build] boot.js   ", bytes(bootStat.size));
  console.log("[cc-build] controls  ", bytes(ctrlStat.size));
  if (result.metafile) {
    const outs = Object.keys(result.metafile.outputs);
    console.log("[cc-build] outputs   ", outs.length, "file(s)");
  }

  rmrf(STAGING);
  console.log("[cc-build] done → dist/");
  console.log("[cc-build] preview: npm run preview   (http://127.0.0.1:4173/)");
  console.log("[cc-build] source : npm run dev       (unbundled modules)");
}

main().catch((e) => {
  console.error("[cc-build] FAILED", e);
  try { rmrf(STAGING); } catch (_) {}
  process.exit(1);
});
