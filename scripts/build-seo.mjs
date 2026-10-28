// scripts/build-seo.mjs — runs as `prebuild`. Generates the three crawler-facing
// files that were missing or wrong on forgeflowgames.com:
//
//   public/sitemap.xml  every indexable page, game pages with real <lastmod>.
//                       Before this script existed /sitemap.xml returned the
//                       HOMEPAGE (the SPA catch-all), so robots.txt advertised a
//                       sitemap that did not exist.
//   public/ads.txt      generated from public/ads-config.json so the publisher id
//                       can never drift from the ad config (it used to be the
//                       literal placeholder pub-XXXXXXXXXXXXXXXX).
//   public/robots.txt   private pages disallowed, sitemap advertised.
//
// FAILURE POLICY: if the registry cannot be read we KEEP the last good sitemap
// and exit 0 with a loud warning. We never write an empty or partial sitemap —
// that would tell Google the site lost all its games.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");

// Mirrors src/config/site.ts (a .mjs cannot import TypeScript).
const SITE_URL = "https://forgeflowgames.com";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://qkidwgyapmitrdxnavmi.supabase.co";
const SUPABASE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_OY39hagVV9OObItwE2VYoA_YuAu0FPZ";

// Category slugs come from the one place they are defined, so a new category is
// picked up with no second edit here.
function categorySlugs() {
  const src = readFileSync(join(ROOT, "src", "lib", "supabase.ts"), "utf8");
  const block = src.slice(src.indexOf("export const CATEGORIES"));
  const end = block.indexOf("];");
  return [...block.slice(0, end).matchAll(/slug:\s*"([a-z0-9_-]+)"/g)].map((m) => m[1]);
}

// Guide slugs come from the one place they are defined (src/content/guides.ts).
function guideSlugs() {
  const src = readFileSync(join(ROOT, "src", "content", "guides.ts"), "utf8");
  return [...src.matchAll(/^    slug:\s*"([a-z0-9-]+)"/gm)].map((m) => m[1]);
}

// Slugs that have hand-written how-to-play / tips (src/content/gameExtras).
function extrasSlugs() {
  const dir = join(ROOT, "src", "content", "gameExtras");
  const out = new Set();
  for (const f of ["a_c.ts", "d_l.ts", "m_z.ts"]) {
    const src = readFileSync(join(dir, f), "utf8");
    for (const m of src.matchAll(/^  "?([a-z0-9-]+)"?:\s*\{/gm)) out.add(m[1]);
  }
  return out;
}

// A category page with fewer games than this is too thin to index (mirrors MIN_INDEXABLE_CATEGORY_GAMES in src/config/site.ts).
const MIN_INDEXABLE_CATEGORY_GAMES = 3;

const xmlEsc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function fetchPublished() {
  const url = `${SUPABASE_URL}/rest/v1/games?status=eq.published&select=slug,genre,updated_at&order=slug.asc`;
  const r = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
  if (!r.ok) throw new Error(`registry HTTP ${r.status}`);
  const rows = await r.json();
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("registry returned no published games");
  return rows;
}

function urlEntry(path, lastmod) {
  return `  <url>\n    <loc>${xmlEsc(SITE_URL + path)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ""}\n  </url>`;
}

async function buildSitemap() {
  const out = join(PUBLIC, "sitemap.xml");
  let games;
  try {
    games = await fetchPublished();
  } catch (e) {
    console.warn(`\n[seo] !! SITEMAP NOT REGENERATED: ${e.message}`);
    console.warn(existsSync(out)
      ? "[seo] !! keeping the previous public/sitemap.xml — redeploy once the registry is reachable\n"
      : "[seo] !! and there is NO previous sitemap — the site will ship without one\n");
    return;
  }

  const perGenre = new Map();
  for (const g of games) perGenre.set(g.genre, (perGenre.get(g.genre) || 0) + 1);
  // never advertise a thin category page (the page itself is noindexed below the same threshold)
  const cats = categorySlugs().filter((s) => (perGenre.get(s) || 0) >= MIN_INDEXABLE_CATEGORY_GAMES);
  const guides = guideSlugs();
  const have = extrasSlugs();
  const missing = games.map((g) => g.slug).filter((s) => !have.has(s));
  if (missing.length) {
    console.warn(`[seo] !! ${missing.length} published game(s) have NO hand-written how-to/tips in src/content/gameExtras: ${missing.join(", ")}`);
    console.warn("[seo] !! their pages fall back to the registry controls text only (thin) — write an entry for each");
  }
  const newest = games.map((g) => g.updated_at).filter(Boolean).sort().pop();
  const day = (iso) => (iso ? String(iso).slice(0, 10) : undefined);

  const entries = [
    urlEntry("/", day(newest)),
    urlEntry("/games/", day(newest)),
    ...cats.map((s) => urlEntry(`/category/${s}/`, day(newest))),
    urlEntry("/guides/", day(newest)),
    ...guides.map((s) => urlEntry(`/guides/${s}/`)),
    urlEntry("/about/"),
    urlEntry("/contact/"),
    urlEntry("/privacy/"),
    urlEntry("/terms/"),
    ...games.map((g) => urlEntry(`/games/${g.slug}/`, day(g.updated_at))),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`;
  writeFileSync(out, xml, "utf8");
  console.log(`[seo] sitemap.xml: ${entries.length} URLs (${games.length} games, ${cats.length} categories, ${guides.length} guides)`);
}

function buildAdsTxt() {
  const cfg = JSON.parse(readFileSync(join(PUBLIC, "ads-config.json"), "utf8"));
  const pub = String(cfg.publisherId || "").replace(/^ca-/, "");
  if (!/^pub-\d{10,20}$/.test(pub)) {
    console.warn(`[seo] !! ads-config.json publisherId "${cfg.publisherId}" is not a valid ca-pub-… id — ads.txt NOT written`);
    return;
  }
  // f08c47fec0942fa0 is Google's fixed certification-authority id for AdSense.
  writeFileSync(join(PUBLIC, "ads.txt"), `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`, "utf8");
  console.log(`[seo] ads.txt: ${pub}`);
}

function buildRobots() {
  const body = [
    "User-agent: *",
    "Allow: /",
    "# Private, per-user or transient pages — nothing here belongs in a search index.",
    "Disallow: /auth/",
    "Disallow: /profile/",
    "Disallow: /friends/",
    "Disallow: /search/",
    "",
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    "",
  ].join("\n");
  writeFileSync(join(PUBLIC, "robots.txt"), body, "utf8");
  console.log("[seo] robots.txt written");
}

await buildSitemap();
buildAdsTxt();
buildRobots();
