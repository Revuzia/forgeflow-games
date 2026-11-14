// node --import ./_harness/node_three_register.mjs <script>
import { register } from "node:module";
register("./node_three_hooks.mjs", import.meta.url);
// Minimal browser globals the imported game modules touch at import time.
globalThis.window = globalThis.window || globalThis;
const store = new Map();
globalThis.localStorage = globalThis.localStorage || {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
};
