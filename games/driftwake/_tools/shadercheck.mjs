#!/usr/bin/env node
/**
 * Parse every shader module. No browser, no server, no GPU — about 200 ms.
 *
 *     node games/driftwake/_tools/shadercheck.mjs
 *
 * WHY THIS EXISTS
 *
 * Shader stages ship as `export default /* glsl *\/` + a JS template literal
 * (ARCHITECTURE §1). A single unescaped backtick anywhere inside that literal —
 * almost always someone quoting an identifier in a comment, the way the rest of
 * the codebase quotes identifiers in JSDoc — terminates the string early and the
 * whole module becomes a JS syntax error. The failure is maximally unhelpful:
 * the reported error is a stray identifier tens of lines further down, the
 * importer is blamed rather than the file, and because `shaders/registry.js`
 * imports the shared chunks, one bad file takes down `registerShaders()` and
 * with it every `#include` in the port.
 *
 * Six files across three owners have hit this in one session. `modulecheck.py`
 * does catch it, but only transitively (it imports subsystems, so the error is
 * attributed to `post/postChain.js`, not to `post/dof.glsl.js`) and it needs a
 * server, Playwright and Chrome. This names the file directly and costs nothing,
 * so it can run before every commit.
 *
 * Exit code 0 = every module parsed. 1 = at least one did not.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHADERS = join(ROOT, "src", "shaders");

/** @param {string} dir @param {string[]} out */
function walk(dir, out = []) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (e.name.endsWith(".glsl.js")) out.push(p);
    }
    return out;
}

/**
 * Lines carrying a backtick that is neither the literal's opener nor its closer.
 * A hint printed alongside the real error, because the engine's message points
 * at the wreckage rather than the cause.
 * @param {string} file
 */
function suspectBackticks(file) {
    const hits = [];
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i];
        if (!t.includes("`")) continue;
        // The delimiters: `... = /* glsl */\`` opening a literal, and a lone \`;
        // or \` closing one. Everything else inside a literal is a live grenade.
        if (/^\s*(export\s+(default|const\s+\w+\s*=)|const\s+\w+\s*=).*`\s*$/.test(t)) continue;
        if (/^\s*`\s*;?\s*$/.test(t)) continue;
        hits.push(`${i + 1}: ${t.trim()}`);
    }
    return hits;
}

const files = walk(SHADERS).sort();
let bad = 0;

for (const f of files) {
    const rel = relative(ROOT, f).replace(/\\/g, "/");
    try {
        await import(pathToFileURL(f).href);
        console.log(`  ok      ${rel}`);
    } catch (e) {
        bad++;
        const kind = e instanceof SyntaxError ? "SYNTAX" : "FAILED";
        console.log(`  ${kind}  ${rel}\n            ${e.message}`);
        if (e instanceof SyntaxError) {
            const hits = suspectBackticks(f);
            if (hits.length) {
                console.log("            unescaped backtick(s) inside the literal — the usual cause:");
                for (const h of hits) console.log(`              ${h}`);
            }
        }
    }
}

console.log(
    `\n${bad ? "SHADERCHECK FAILED" : "SHADERCHECK OK"}   ` +
    `parsed=${files.length - bad}/${files.length}`
);
process.exit(bad ? 1 : 0);
