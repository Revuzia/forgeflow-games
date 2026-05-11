// 2026-05-11 — Was `prerender: false`. With that setting Vike skipped
// generating per-slug HTML files at build time. Cloudflare Pages's SPA
// catch-all (_redirects `/* /index.html 200`) then served the HOMEPAGE
// index.html for `/games/<slug>` URLs, so visitors hard-loading a game
// URL saw the homepage instead of the game page.
//
// Fix: prerender every active game slug at build time. The slug list
// comes from Supabase via the onBeforePrerenderStart hook in
// `pages/games/@slug/+onBeforePrerenderStart.ts`. The build still
// completes fast (~50 games × ~3 KB HTML each ≈ 150 KB total static
// output) and direct-URL navigation works.
export default {
  prerender: true,
};
