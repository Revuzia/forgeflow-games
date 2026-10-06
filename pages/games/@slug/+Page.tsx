import { usePageContext } from "vike-react/usePageContext";
import { useConfig } from "vike-react/useConfig";
import { Head } from "vike-react/Head";
import { categoryHref, genreLabel } from "../../../src/lib/categories";
import { SITE_URL, SITE_NAME, absUrl, canonicalFor, clip } from "../../../src/config/site";
import type { Game } from "../../../src/lib/supabase";
import AdSlot from "../../../src/components/ads/AdSlot";
import useNoindex from "../../../src/hooks/useNoindex";
import AdRails from "../../../src/components/ads/AdRails";
import { useGame, useRelatedGames } from "../../../src/hooks/useGames";
import GamePlayer from "../../../src/components/game/GamePlayer";
import GameCarousel from "../../../src/components/game/GameCarousel";
import GameDescription from "../../../src/components/game/GameDescription";
import { getMobileSupport, MOBILE_BADGE } from "../../../src/lib/mobile";
import useIsTouchDevice from "../../../src/hooks/useIsTouchDevice";
import { GAME_STATS_PANELS } from "../../../src/components/game/StatsPanel";

const DIFFICULTY_LABELS: Record<string, { label: string; color: string }> = {
  easy: { label: "Easy", color: "#00ff88" },
  medium: { label: "Medium", color: "#ff8800" },
  hard: { label: "Hard", color: "#ff3366" },
  extreme: { label: "Extreme", color: "#a855f7" },
};

export default function GamePage() {
  // gameSeed / relatedSeed are the registry rows handed over at prerender time
  // (pages/games/@slug/+onBeforePrerenderStart.ts), so the STATIC html is the
  // real game page. They are absent on a client-side navigation, which fetches.
  const { routeParams, gameSeed, relatedSeed } = usePageContext() as {
    routeParams?: Record<string, string>;
    gameSeed?: Game;
    relatedSeed?: Game[];
  };
  const slug = routeParams?.slug || "";
  const { data: game, isLoading, error } = useGame(slug, gameSeed);
  const { data: related } = useRelatedGames(game || null, relatedSeed);
  const isTouch = useIsTouchDevice();
  // A slug that resolves to nothing is only discovered client-side (see useNoindex).
  useNoindex(!isLoading && (!!error || !game));

  // Head. Before this, every game page shared the homepage's generic description
  // and had no <title> at all.
  const config = useConfig();
  if (game) {
    config({
      title: `Play ${game.title} Free Online | ${SITE_NAME}`,
      description: clip(
        game.short_description || game.description ||
          `Play ${game.title}, a free ${genreLabel(game.genre).toLowerCase()} game, in your browser on ${SITE_NAME}.`,
      ),
      image: absUrl(game.hero_image_url || game.thumbnail_url || ""),
    });
  } else if (!isLoading) {
    config({ title: `Game not found | ${SITE_NAME}` });
  }

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="animate-pulse">
          <div className="aspect-video bg-surface-800 rounded-xl mb-6" />
          <div className="h-8 bg-surface-800 rounded w-1/3 mb-4" />
          <div className="h-4 bg-surface-800 rounded w-2/3" />
        </div>
      </div>
    );
  }

  if (error || !game) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-20 text-center">
        <Head><meta name="robots" content="noindex, follow" /></Head>
        <h1 className="font-display font-bold text-3xl text-gray-200 mb-3">Game Not Found</h1>
        <p className="text-surface-500 mb-6">This game doesn't exist or hasn't been published yet.</p>
        <a href="/games" className="btn-primary">Browse All Games</a>
      </div>
    );
  }

  const diff = DIFFICULTY_LABELS[game.difficulty] || DIFFICULTY_LABELS.medium;
  const rating = game.rating_count > 0 ? (game.rating_sum / game.rating_count).toFixed(1) : null;
  // 2026-09-15 — honest mobile labelling, driven by games.mobile_support.
  const mobile = getMobileSupport(game);
  const mobileBadge = mobile === "none" ? null : MOBILE_BADGE[mobile];
  const touchControlsNote =
    mobile === "full"
      ? "On-screen thumbstick and action buttons — playable on phones and tablets."
      : mobile === "partial"
      ? "Partial on-screen touch controls — some actions still need a keyboard."
      : null;

  // Structured data: VideoGame + breadcrumbs. aggregateRating only when real
  // ratings exist — never invented. "<" is escaped so database text can never
  // close the <script> early.
  const canonical = canonicalFor(`/games/${game.slug}`);
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "VideoGame",
        name: game.title,
        url: canonical,
        description: clip(game.description || game.short_description || "", 300),
        image: absUrl(game.hero_image_url || game.thumbnail_url || ""),
        genre: genreLabel(game.genre),
        applicationCategory: "Game",
        operatingSystem: "Any — runs in a web browser",
        inLanguage: "en",
        datePublished: game.created_at,
        dateModified: game.updated_at,
        publisher: { "@type": "Organization", name: "ForgeFlow Labs", url: SITE_URL },
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD", availability: "https://schema.org/InStock" },
        ...(game.rating_count > 0 && rating
          ? { aggregateRating: { "@type": "AggregateRating", ratingValue: Number(rating), ratingCount: game.rating_count, bestRating: 5, worstRating: 1 } }
          : {}),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
          { "@type": "ListItem", position: 2, name: "Games", item: `${SITE_URL}/games/` },
          { "@type": "ListItem", position: 3, name: game.title, item: canonical },
        ],
      },
    ],
  }).replace(/</g, "\\u003c");

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      <Head>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      </Head>
      <AdRails />
      {/* Breadcrumb */}
      <nav className="text-sm text-surface-500 mb-4 flex items-center gap-2">
        <a href="/" className="hover:text-brand-blue transition-colors">Home</a>
        <span>/</span>
        <a href="/games" className="hover:text-brand-blue transition-colors">Games</a>
        <span>/</span>
        <a href={categoryHref(game.genre)} className="hover:text-brand-blue transition-colors capitalize">
          {genreLabel(game.genre)}
        </a>
        <span>/</span>
        <span className="text-gray-300">{game.title}</span>
      </nav>

      {/* 2026-05-11 — Reverted to the original 2-column grid per user
          feedback. Real ads will live in the viewport whitespace OUTSIDE
          this max-w-7xl wrapper (handled by the layout shell, not this
          page). All in-page "Advertisement" placeholder boxes have been
          removed below — they were noise. */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Game player */}
        <div>
          <GamePlayer game={game} />

          {/* Game info below player */}
          <div className="mt-4">
            <h1 className="font-display font-bold text-2xl sm:text-3xl text-gray-100 mb-2">
              {game.title}
            </h1>

            {/* Stats row */}
            <div className="flex flex-wrap items-center gap-4 text-sm mb-4">
              <span className="px-2 py-0.5 rounded text-xs font-bold" style={{ color: diff.color, backgroundColor: diff.color + "15" }}>
                {diff.label}
              </span>
              {mobileBadge ? (
                <span
                  className="px-2 py-0.5 rounded text-xs font-bold flex items-center gap-1"
                  style={{ color: mobileBadge.color, backgroundColor: mobileBadge.color + "15" }}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                  {mobileBadge.long}
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-xs font-bold text-surface-500 bg-surface-800 border border-surface-600/30 flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  Desktop only
                </span>
              )}
            </div>

            {/* Touch visitor + keyboard-only game: say so plainly instead of
                letting them tap Play and find dead controls. */}
            {isTouch && mobile === "none" && (
              <div className="mb-4 rounded-lg border border-surface-600/30 bg-surface-800 px-3 py-2 text-sm text-surface-500">
                This game needs a keyboard and mouse — it won’t be playable on this device.
              </div>
            )}

            {/* 2026-09-15 — line breaks and "- " bullets in the stored
                description are honoured now (text-only, never raw HTML).
                Previously the whole string landed in one <p> as a run-on wall. */}
            {game.description && (
              <GameDescription text={game.description} className="text-gray-300 leading-relaxed mb-6" />
            )}

            {/* Controls */}
            {(game.controls_keyboard || game.controls_gamepad || touchControlsNote) && (
              <div className="bg-surface-800 rounded-lg p-4 border border-surface-600/30 mb-6">
                <h3 className="font-display font-semibold text-sm text-gray-200 mb-2">Controls</h3>
                {game.controls_keyboard && (
                  <p className="text-sm text-surface-500 mb-1">
                    <span className="text-gray-400">Keyboard:</span> {game.controls_keyboard}
                  </p>
                )}
                {game.controls_gamepad && (
                  <p className="text-sm text-surface-500 mb-1">
                    <span className="text-gray-400">Gamepad:</span> {game.controls_gamepad}
                  </p>
                )}
                {touchControlsNote ? (
                  <p className="text-sm text-surface-500">
                    <span className="text-gray-400">Touch:</span> {touchControlsNote}
                  </p>
                ) : (
                  <p className="text-sm text-surface-500">
                    <span className="text-gray-400">Touch:</span> Not supported — desktop only.
                  </p>
                )}
              </div>
            )}

            {/* Tags */}
            {game.tags && game.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-6">
                {game.tags.map((tag) => (
                  <span key={tag} className="px-3 py-1 rounded-full text-xs bg-surface-800 text-surface-500 border border-surface-600/30">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* 2026-10-01 — per-game RECORDS & LEADERBOARDS, only for slugs
                in GAME_STATS_PANELS (BLOCKTOOTH first); every other game
                renders nothing here. */}
            {(() => {
              const StatsPanel = GAME_STATS_PANELS[game.slug];
              return StatsPanel ? <StatsPanel game={game} /> : null;
            })()}
          </div>

          {/* 2026-05-11 — Removed fake bottom-banner Advertisement placeholder.
              Real ads will live in the viewport whitespace outside this
              page wrapper (handled by the layout shell), not as boxes
              inside content. */}
        </div>

        {/* Sidebar */}
        <aside className="space-y-6">
          {/* 2026-05-11 — Removed fake sidebar Advertisement placeholder; same
              reason as above. Screenshots remain — those are real content. */}

          {/* Screenshots */}
          {game.screenshot_urls && game.screenshot_urls.length > 0 && (
            <div>
              <h3 className="font-display font-semibold text-sm text-gray-200 mb-3">Screenshots</h3>
              <div className="grid grid-cols-2 gap-2">
                {game.screenshot_urls.slice(0, 4).map((url, i) => (
                  <img key={i} src={url} alt={`${game.title} screenshot ${i + 1}`} className="rounded-lg w-full aspect-video object-cover" loading="lazy" />
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* In-flow ad: below the whole player + info grid, so it is far more than 150px from the game canvas (AdSense accidental-click rule). Renders nothing until ads are enabled. */}
      <AdSlot slot="gameBelow" className="mt-10" />

      {/* Related games */}
      {related && related.length > 0 && (
        <div className="mt-12">
          <GameCarousel
            title="You Might Also Like"
            games={related}
            viewAllHref={categoryHref(game.genre)}
          />
        </div>
      )}
    </div>
  );
}
