/**
 * The shader include system.
 *
 * WebGPU/Babylon gave the reference `#include<name>` out of the box via
 * `ShaderStore.IncludesShadersStoreWGSL`. Three has an equivalent —
 * `THREE.ShaderChunk` + `#include <name>` — but it is only wired into
 * `ShaderMaterial`, and every material in this port is a `RawShaderMaterial`
 * (see ARCHITECTURE §0.1), which Three passes through completely untouched. So
 * the resolver lives here.
 *
 * Why it matters more than it looks: the terrain height function is compiled
 * into the height bake, the beauty vertex stage, the linear-depth prepass and
 * all three shadow cascades. If those five copies ever drift by a single
 * constant the terrain tears along the seam between the passes that agreed and
 * the passes that did not — and it does so silently, as a shadow that misses
 * its caster. Textual inclusion from one registered chunk is what makes drift
 * impossible rather than merely unlikely.
 *
 * Grammar (deliberately tiny, so there is nothing to get subtly wrong):
 *
 *     #include "lib/noise"
 *
 * Double quotes, one include per line, arbitrary leading whitespace, nothing
 * else on the line. Not `<angle>` — that is Three's own syntax and reusing it
 * would make a stray `#include <common>` look like ours and silently pull in
 * Three's chunk instead.
 *
 * Semantics:
 *  - Recursive: a chunk may include other chunks.
 *  - Once per resolved shader, like `#pragma once`. `lib/terrain` and
 *    `lib/deform` both want `lib/noise`; without the seen-set the second copy
 *    is a redefinition error, and GLSL has no weak linkage to save us.
 *  - Unknown name throws, naming the include stack that reached it.
 *  - A cycle throws, naming the cycle. (Checked before the seen-set, so a true
 *    cycle is an error rather than being quietly truncated into a half-shader
 *    that fails to compile 200 lines later.)
 *  - Results are cached by source string; identical sources resolve once.
 *
 * ---------------------------------------------------------------------------
 * SELF-CHECKS — expected behaviour, hand-verifiable. There is no test framework
 * in this repo, so these are the contract. Paste into a console with the module
 * imported if you change anything below.
 *
 *   register("a", 'float A(){return 1.0;}');
 *   register("b", '#include "a"\nfloat B(){return A();}');
 *   register("c", '#include "a"\nfloat C(){return A();}');
 *
 *   resolve('#include "a"')
 *     -> 'float A(){return 1.0;}'
 *
 *   resolve('  #include "a"')            // leading whitespace is fine
 *     -> 'float A(){return 1.0;}'
 *
 *   resolve('#include "b"\n#include "c"')   // diamond: A appears ONCE
 *     -> 'float A(){return 1.0;}\nfloat B(){return A();}\n' +
 *        '// #include "a" — already expanded\nfloat C(){return A();}'
 *        (A's body emitted once; the second reference collapses to a comment)
 *
 *   resolve('#include "nope"')
 *     -> throws: glsl: unknown chunk "nope"
 *
 *   register("x", '#include "y"'); register("y", '#include "x"');
 *   resolve('#include "x"')
 *     -> throws: glsl: #include cycle: x -> y -> x
 *
 *   register("a", "...")                 // second time
 *     -> throws: glsl: chunk "a" is already registered
 *
 *   resolve('void main(){}')             // no includes: returned unchanged,
 *                                        // and without splitting a single line
 *
 *   shader('void main(){}')
 *     -> 'precision highp float;\nprecision highp int;\n' +
 *        'precision highp sampler2D;\n\nvoid main(){}'
 * ---------------------------------------------------------------------------
 */

/** @type {Map<string, string>} name -> chunk source */
const chunks = new Map();

/** @type {Map<string, string>} unresolved source -> resolved source */
const cache = new Map();

/**
 * One include per line, double-quoted. Non-global on purpose: `expand()`
 * recurses, and a `/g` regex shared across nested calls carries `lastIndex`
 * between them.
 */
const INCLUDE_LINE = /^[ \t]*#include[ \t]+"([^"\n]+)"[ \t]*$/;

/**
 * Add a chunk. Throws on a duplicate name — a second registration is always
 * either a copy-paste in `registry.js` or two subsystems claiming one chunk,
 * and both are worth failing loudly at module load rather than resolving to
 * whichever import happened to run last.
 * @param {string} name e.g. "lib/noise"
 * @param {string} source GLSL text
 * @returns {void}
 */
export function register(name, source) {
    if (chunks.has(name)) {
        throw new Error(`glsl: chunk "${name}" is already registered`);
    }
    chunks.set(name, source);
    // Anything resolved before this point could not have seen the new chunk.
    // In practice registry.js runs before the first material, so this clears an
    // empty map; it is here so that a late registration cannot serve stale text.
    cache.clear();
}

/**
 * Register a whole map at once, e.g. `{ "lib/noise": noiseSrc }`.
 * @param {Record<string, string>} obj
 * @returns {void}
 */
export function registerAll(obj) {
    for (const name in obj) register(name, obj[name]);
}

/**
 * Expand every `#include "name"` in `source`, recursively, each chunk at most
 * once. Cached by source string.
 * @param {string} source
 * @returns {string}
 */
export function resolve(source) {
    const hit = cache.get(source);
    if (hit !== undefined) return hit;

    const out = expand(source, new Set(), []);
    cache.set(source, out);
    return out;
}

/**
 * @param {string} src
 * @param {Set<string>} seen chunks already emitted into this shader
 * @param {string[]} stack the current include path, for cycle + error messages
 * @returns {string}
 */
function expand(src, seen, stack) {
    // Most leaf chunks contain no includes at all; skip the split entirely.
    if (src.indexOf("#include") < 0) return src;

    const lines = src.split("\n");

    for (let i = 0; i < lines.length; i++) {
        const m = INCLUDE_LINE.exec(lines[i]);
        if (m === null) continue;

        const name = m[1];

        if (stack.indexOf(name) >= 0) {
            throw new Error(
                "glsl: #include cycle: " + stack.concat(name).join(" -> ")
            );
        }

        if (seen.has(name)) {
            // `#pragma once`. Leave a breadcrumb rather than an empty line so a
            // compile error's line number still maps back to something readable.
            lines[i] = `// #include "${name}" — already expanded`;
            continue;
        }

        const chunk = chunks.get(name);
        if (chunk === undefined) {
            const via = stack.length ? " (included from " + stack.join(" -> ") + ")" : "";
            throw new Error(`glsl: unknown chunk "${name}"${via}`);
        }

        seen.add(name);
        stack.push(name);
        lines[i] = expand(chunk, seen, stack);
        stack.pop();
    }

    return lines.join("\n");
}

/**
 * Precision block prepended by `shader()`.
 *
 * `highp float` is the default in a GLSL ES 3.00 vertex stage but *undeclared*
 * in a fragment stage, and `sampler2D` defaults to `lowp` there — which on
 * mobile-derived drivers quietly quantises every texture fetch. Declaring all
 * three makes the two stages agree, which is the whole point: the terrain
 * vertex stage and the depth prepass fragment stage must sample the heightfield
 * to the same bit.
 *
 * These land immediately after Three's `#version 300 es` line and its two
 * `#define SHADER_TYPE/SHADER_NAME` lines (RawShaderMaterial adds nothing else,
 * plus whatever you passed as `defines`). That means a shader using `shader()`
 * cannot carry its own `#extension` directive, since those must precede any
 * non-preprocessor token — no shader in this port needs one, because everything
 * the reference uses (derivatives, textureLod, non-constant loop bounds) is core
 * in ES 3.00.
 */
const PREAMBLE =
    "precision highp float;\n" +
    "precision highp int;\n" +
    "precision highp sampler2D;\n";

/**
 * `resolve()` plus the shared precision preamble. This is what every material
 * should call; `resolve()` alone is for the rare stage that needs to control its
 * own preamble.
 * @param {string} source
 * @returns {string}
 */
export function shader(source) {
    return PREAMBLE + "\n" + resolve(source);
}
