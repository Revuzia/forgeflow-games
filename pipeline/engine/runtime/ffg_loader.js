/**
 * FFG runtime — ffg_loader.js  (load LAST, after kernel + genre runtimes)
 * Resolves the game's content object and boots it through the kernel.
 *
 * Content resolution order:
 *   1. window.FFG_CONTENT  (inline — set by a <script> that defines the object)
 *   2. fetch("./content.json")  (static file next to index.html)
 *
 * Keeping content as data (not code) is the whole point of v2: the generator
 * emits this object; the engine is fixed.
 */
(function (root) {
  "use strict";
  var FFG = root.FFG;
  if (!FFG) { console.error("[FFG] kernel not loaded before loader"); return; }

  function start(content) {
    if (!content || !content.genre) { console.error("[FFG] invalid content (missing genre)"); return; }
    FFG.boot(content);
  }

  function go() {
    if (root.FFG_CONTENT) { start(root.FFG_CONTENT); return; }
    if (typeof fetch === "function") {
      fetch("./content.json").then(function (r) { return r.json(); }).then(start).catch(function (e) {
        console.error("[FFG] could not load content.json:", e);
      });
    } else {
      console.error("[FFG] no FFG_CONTENT and fetch unavailable");
    }
  }

  if (root.document && root.document.readyState === "loading") {
    root.document.addEventListener("DOMContentLoaded", go);
  } else {
    go();
  }
})(typeof window !== "undefined" ? window : globalThis);
