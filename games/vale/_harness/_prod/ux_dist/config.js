// VALE runtime config — copied verbatim into the client build (dist/config.js) and loaded by
// index.html BEFORE the game bundle. Edit it on the deployed site; no rebuild needed.
//
// catalog: URL of the content manifest (CONTRACT §3.1–3.3). Relative URLs resolve against the page.
//   * default './catalog/manifest.json' — `npm run package` co-locates the catalog under deploy/catalog/.
//   * moving content to a CDN or another bucket: point this at the new manifest, e.g.
//     'https://cdn.example.com/vale/catalog/manifest.json' (that host must send CORS headers for this
//     origin). Catalog files and assets are content-addressed/immutable; only manifest.json changes
//     between content releases, so give it a short cache TTL and everything else a long one.
//   * a one-off override for QA: append ?catalog=<url> to the page URL (it wins over this file).
// server: the game server for online play (`npm run server`, CONTRACT §7.2), e.g. 'wss://play.example.com'.
//   null = this build plays every queue against bots. A one-off override: ?server=<url>.
window.VALE_CONFIG = {
  catalog: './catalog/manifest.json',
  server: null,
};
