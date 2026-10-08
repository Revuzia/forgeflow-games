// SPA fallback for game / category pages that have no static HTML yet.
//
// WHY: /games/<slug> and /category/<name> are prerendered at portal build time.
// A game published after the last build (deploy_game.py --no-portal, a failed
// portal refresh, the admin publish toggle) has no static file, so Cloudflare
// Pages answers its URL with the top-level 404.html (HTTP 404). That page is
// plain static HTML (scripts/postbuild-404.mjs); for a URL matching
// SPA_ROUTE_SOURCE its inline script hands the URL to the app as
// "/?spa=<encoded path>", and the homepage (pages/index/+Page.tsx) client-routes
// there. The game page then fetches the row from Supabase like any client-side
// navigation, and a bogus slug ends on its "Game Not Found" state.
//
// This used to be a `/games/* / 200` rewrite in public/_redirects, but on Pages a
// matching _redirects rule wins even over an existing static file, so it served
// the homepage for EVERY game page (fixed 2026-10-08).
//
// Loop guard: the 404 script records {path, t} under SPA_MARKER_KEY in
// sessionStorage before handing off, and refuses to hand the same path off again
// within SPA_MARKER_TTL_MS. The homepage clears the marker once the client router
// has actually landed on the page. So if client routing ever falls back to a hard
// reload of the URL (Vike does that when a page needs index.pageContext.json and
// gets a 404, e.g. if a server-side +data hook is ever added), the second 404 shows
// the plain 404 page instead of bouncing forever.
//
// scripts/postbuild-404.mjs mirrors SPA_PARAM, SPA_MARKER_KEY, SPA_MARKER_TTL_MS
// and SPA_ROUTE_SOURCE (it cannot import TypeScript) and fails the build if this
// file stops containing the same literals.

export const SPA_PARAM = "spa";
export const SPA_MARKER_KEY = "ffg-spa-fallback";
export const SPA_MARKER_TTL_MS = 60000;
export const SPA_ROUTE_SOURCE = "^/(games|category)/[^/]+/?$";
const SPA_ROUTE = new RegExp(SPA_ROUTE_SOURCE);

export type SpaFallback =
  | { kind: "none" }
  /** Client-route to `target` (a same-origin path, with trailing slash, plus search/hash). */
  | { kind: "navigate"; target: string }
  /** A `spa` parameter that is not ours: replace the address bar with `cleanUrl` and stay. */
  | { kind: "strip"; cleanUrl: string };

/** Trailing slash, like the URLs Pages serves prerendered pages at (and their canonicals). */
function withSlash(pathname: string): string {
  return pathname.endsWith("/") ? pathname : pathname + "/";
}

/** What the homepage should do when it hydrates at `loc`. Pure apart from reading `loc`. */
export function readSpaFallback(loc: Pick<Location, "origin" | "pathname" | "search" | "hash">): SpaFallback {
  const params = new URLSearchParams(loc.search);
  const raw = params.get(SPA_PARAM);
  if (raw !== null) {
    let url: URL | null = null;
    try {
      url = new URL(raw, loc.origin);
    } catch {
      url = null;
    }
    // Same origin and exactly one game/category segment: never an open redirect,
    // never a route the 404 page would not have handed off.
    if (url && url.origin === loc.origin && raw.startsWith("/") && SPA_ROUTE.test(url.pathname)) {
      return { kind: "navigate", target: withSlash(url.pathname) + url.search + url.hash };
    }
    params.delete(SPA_PARAM);
    const q = params.toString();
    return { kind: "strip", cleanUrl: loc.pathname + (q ? "?" + q : "") + loc.hash };
  }
  // The homepage HTML itself served at a game/category URL. Pages does not do that
  // any more (no rewrites, and the 404.html turns its SPA mode off), but if a
  // rewrite ever comes back, or a build ships without 404.html, this still recovers.
  if (SPA_ROUTE.test(loc.pathname)) {
    return { kind: "navigate", target: withSlash(loc.pathname) + loc.search + loc.hash };
  }
  return { kind: "none" };
}

/** Called once the client router has landed on the handed-off page. */
export function clearSpaFallbackMarker(): void {
  try {
    sessionStorage.removeItem(SPA_MARKER_KEY);
  } catch {
    /* storage blocked: nothing was written either */
  }
}
