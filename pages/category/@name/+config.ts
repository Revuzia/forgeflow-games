// 2026-07-07 — Was `prerender: false`, so /category/<name> had no static
// HTML and a hard load fell through Cloudflare Pages's catch-all to the
// prerendered HOMEPAGE (same bug class as /games/<slug>, fixed 2026-05-11).
// The category list is a small fixed set — prerender them all. Slugs are
// enumerated in +onBeforePrerenderStart.ts from the shared CATEGORIES list.
export default {
  prerender: true,
};
