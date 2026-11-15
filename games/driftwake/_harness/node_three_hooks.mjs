// Node ESM resolve hook: map the bare "three" specifier to the vendored build,
// exactly as index.html's import map does. Used only by headless logic probes
// (qa_worldact_node.mjs); the browser never loads this file.
import { pathToFileURL } from "node:url";
import { resolve as presolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const THREE_URL = pathToFileURL(presolve(HERE, "../assets/vendor/three/build/three.module.js")).href;

export async function resolve(specifier, context, next) {
    if (specifier === "three") return { url: THREE_URL, shortCircuit: true };
    return next(specifier, context);
}
