/**
 * ForgeFlow Games CDN Worker
 * Serves game files from R2 bucket with proper CORS headers.
 * Games are loaded in iframes from forgeflowgames.com.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let key = url.pathname.slice(1); // Remove leading /

    if (!key || key === "") {
      return new Response("ForgeFlow Games CDN", { status: 200 });
    }

    // If path ends with /, serve index.html
    if (key.endsWith("/")) {
      key += "index.html";
    }

    const object = await env.GAMES.get(key);

    if (!object) {
      return new Response("Game not found", { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);

    // Content type detection
    const ext = key.split(".").pop().toLowerCase();
    const MIME = {
      html: "text/html",
      js: "application/javascript",
      css: "text/css",
      json: "application/json",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      svg: "image/svg+xml",
      webp: "image/webp",
      mp3: "audio/mpeg",
      ogg: "audio/ogg",
      m4a: "audio/mp4",
      webmanifest: "application/manifest+json",
      wav: "audio/wav",
      woff2: "font/woff2",
      woff: "font/woff",
      wasm: "application/wasm",
      glb: "model/gltf-binary",
      gltf: "model/gltf+json",
    };
    if (MIME[ext]) {
      headers.set("content-type", MIME[ext]);
    }

    // Unity WebGL streams (.unityweb) are gzip-compressed and the build ships a
    // JS decompression FALLBACK, so we deliberately do NOT set Content-Encoding:
    // gzip here — letting the browser also decompress would double-decompress and
    // corrupt the module (Maximum call stack size / bad wasm). Unity's own JS
    // decoder handles it. (The faster native-gzip path needs a build with
    // decompressionFallback OFF + .gz filenames — a separate, tested change.)

    // CORS — allow embedding from forgeflowgames.com
    headers.set("access-control-allow-origin", "*");
    headers.set("access-control-allow-methods", "GET, HEAD, OPTIONS");
    headers.set("cross-origin-embedder-policy", "credentialless");

    // 2026-09-29 (DYEFIELD mobile review A-A5): glTF binaries are served gzip-encoded
    // when the client accepts it. model/gltf-binary is not on Cloudflare's
    // auto-compress list, so a phone downloaded every map raw (Cinder 7.3 MB →
    // 2.9 MB gzipped, the DYEFIELD lobby set 4.8 → 1.5 MB). Lossless: the browser
    // decodes transparently, the bytes after decoding are identical. The Workers
    // runtime compresses the body (encodeBody "automatic"). X-File-Size keeps the
    // decoded size for load-progress bars (three.js FileLoader reads it first).
    if (ext === "glb" && /\bgzip\b/i.test(request.headers.get("accept-encoding") || "")) {
      headers.set("content-encoding", "gzip");
      headers.set("vary", "accept-encoding");
      headers.set("x-file-size", String(object.size));
      headers.set("access-control-expose-headers", "x-file-size");
    }
    // Content-hashed build assets (Vite: assets/<name>-<8-char hash>.<ext>) never
    // change under their name: cache them for a year, immutable, so a relaunch
    // (a home-screen icon included) re-downloads nothing. Opt-in per game: an
    // unhashed name that merely looks hashed must never be pinned.
    const IMMUTABLE_HASHED_GAMES = new Set(["dyefield", "rimfall"]);
    const game = key.split("/")[0];
    const hashed = IMMUTABLE_HASHED_GAMES.has(game) &&
      /\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/.test(key);
    // 2026-10-07 (Rimfall): JSON in these games is release pointers and catalogs. A cached
    // pointer keeps serving the previous release after a deploy or rollback, so it is
    // never cached. Opt-in per game: other games' JSON keeps the 1-day default.
    const NO_STORE_JSON_GAMES = new Set(["rimfall"]);

    // HTML: no-store (Cloudflare's edge cache will not retain). Assets: 1 day.
    // 2026-05-05 — switched HTML from no-cache to no-store + private after
    // observing CF edge serving stale game HTML even with no-cache, breaking
    // SDK rollout. Unhashed JS (the SDK) stays no-store for the same reason;
    // opted-in content-hashed assets are immutable (above).
    if (ext === "html") {
      headers.set("cache-control", "no-store, no-cache, must-revalidate, private");
      headers.set("pragma", "no-cache");
      headers.set("expires", "0");
    } else if (hashed) {
      headers.set("cache-control", "public, max-age=31536000, immutable");
    } else if (ext === "json" && NO_STORE_JSON_GAMES.has(game)) {
      headers.set("cache-control", "no-store");
    } else if (ext === "js") {
      headers.set("cache-control", "no-store, no-cache, must-revalidate, private");
      headers.set("pragma", "no-cache");
      headers.set("expires", "0");
    } else if (key.endsWith(".unityweb")) {
      // Unity Build streams: revalidate against R2's ETag every load so a redeploy
      // can never serve a stale wasm/framework/data against fresh siblings (that
      // mismatch = invoke-table corruption / call-stack overflow). 304 when
      // unchanged keeps it cheap; switch to immutable+hashed names for ship.
      headers.set("cache-control", "no-cache, must-revalidate");
    } else {
      headers.set("cache-control", "public, max-age=86400");
    }

    return new Response(object.body, { headers });
  },
};
