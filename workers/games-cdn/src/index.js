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

    // CORS — allow embedding from forgeflowgames.com
    headers.set("access-control-allow-origin", "*");
    headers.set("access-control-allow-methods", "GET, HEAD, OPTIONS");
    headers.set("cross-origin-embedder-policy", "credentialless");

    // HTML: no-store (Cloudflare's edge cache will not retain). Assets: 1 day.
    // 2026-05-05 — switched HTML from no-cache to no-store + private after
    // observing CF edge serving stale game HTML even with no-cache, breaking
    // SDK rollout. js+css are versioned by content so 24h is fine.
    if (ext === "html" || ext === "js") {
      headers.set("cache-control", "no-store, no-cache, must-revalidate, private");
      headers.set("pragma", "no-cache");
      headers.set("expires", "0");
    } else {
      headers.set("cache-control", "public, max-age=86400");
    }

    return new Response(object.body, { headers });
  },
};
