# ForgeFlow Games — Deploy Flow

## TL;DR

There are **TWO independent deploy targets**. `git push` does NOT deploy either of them right now — both must be run explicitly.

| Target | Used for | Deploy command |
|---|---|---|
| **R2 bucket** `forgeflow-games` | Game files (HTML, JS, assets) — one folder per slug | `pipeline/deploy_game.py` (per-game) OR phase_deploy in `run_game_pipeline.py` (auto for pipeline-built games) |
| **Cloudflare Pages** `forgeflow-games` (forgeflowgames.com) | The React/Vike SSG portal — homepage, game-detail pages, category pages | `pipeline/deploy_portal.py` (manual, after touching src/ or pages/) |
| **Supabase** `games` table | Per-game metadata (title, description, thumbnail_url, game_url, etc.) | Auto by deploy_game.py / phase_deploy |

## The auto-deploy gap (2026-04-21 → present)

Cloudflare Pages' GitHub auto-build broke around 2026-04-21. The last
successful Pages auto-deploy was commit `e26a928`. Every commit since
that date has landed on `master` but never built. Symptoms:
- Live site serves the same JS bundle hash for weeks even though source changed
- React component updates appear to "vanish" after `git push`
- Pages dashboard shows no new deployments

**Until the GitHub→Pages integration is re-linked in the Cloudflare
dashboard, you MUST run `pipeline/deploy_portal.py` after any commit
that touches the React frontend.**

To re-link auto-deploy: dash.cloudflare.com → Pages → forgeflow-games →
Settings → Builds & deployments → Source → reconnect GitHub repo.

## When to run what

### After changing a React component (src/components/**, pages/**)
```bash
python "C:/Users/TestRun/Claude Claw/forgeflow-games/pipeline/deploy_portal.py"
```
Builds via `npm run build` then `wrangler pages deploy dist/client`. ~30-60 sec.

### After publishing a single game manually
```bash
python "C:/Users/TestRun/Claude Claw/forgeflow-games/pipeline/deploy_game.py" \
  --game-dir "C:/path/to/game" --slug your-slug
```
Auto-runs `generate_cover.py` (if no thumbnail.png), uploads all files
to R2, upserts Supabase metadata. ~1-3 min depending on file count.

### Daily 1am pipeline run
`scripts/run_game_pipeline.py` runs end-to-end: research → design →
build → QA → deploy. Its `phase_deploy` function uploads to R2 and
Supabase automatically.

**⚠ 2026-07-07 correction — new games DO need a portal redeploy.** Game
LISTINGS (homepage/category carousels) query Supabase client-side and
pick up new games instantly, but the per-game DETAIL page
`/games/<slug>` is **prerendered at portal build time**
(`pages/games/@slug/+onBeforePrerenderStart.ts`, added 2026-05-11).
Any game published after the last portal build has no static HTML, so a
hard load of its URL fell through the `_redirects` catch-all to the
homepage. Two mitigations now exist:
1. `deploy_game.py` auto-runs `deploy_portal.py` after every successful
   publish (skip with `--no-portal` for batch runs — then run
   `deploy_portal.py` once at the end).
2. The homepage has an SPA-fallback redirect (`pages/index/+Page.tsx`)
   that client-routes /games/* and /category/* hard loads to the right
   page even when the prerender is stale — so direct links WORK either
   way; the portal rebuild is what gives the URL real static HTML (SEO).

## Common confusions

**"I pushed but the site didn't update"** — yes, that's the broken Pages
auto-deploy. Run `deploy_portal.py`.

**"The new game doesn't show on the homepage"** — check Supabase. If the
row is in `games` with `status='published'`, it should appear. If not,
phase_deploy didn't reach the Supabase step (probably a previous failure).

**"Hard-loading /games/&lt;slug&gt; shows the homepage"** — the portal
prerender is stale (game published after the last portal build) AND the
deployed bundle predates the 2026-07-07 homepage SPA-fallback redirect.
Run `pipeline/deploy_portal.py`.

**"The thumbnail isn't updating"** — CDN cache. Append `?v=<timestamp>`
query param to the thumbnail_url in Supabase to bust browser/CDN caches.
Or wait up to 24h (cache-control max-age=86400 on R2 worker).

**"Pages says deploy succeeded but site is unchanged"** — hard refresh
(Ctrl+Shift+R) sometimes isn't enough; use a fresh incognito window or
append `?_=<timestamp>` to the URL.
