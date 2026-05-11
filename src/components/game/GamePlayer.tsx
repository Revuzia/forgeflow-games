import { useState, useRef, useCallback, useEffect } from "react";
import type { Game } from "../../lib/supabase";
import { initGameBridge, destroyGameBridge } from "../../lib/gameBridge";

type Props = {
  game: Game;
};

export default function GamePlayer({ game }: Props) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showPreroll, setShowPreroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // 2026-05-06 — Stable per-mount nonce that forces the iframe URL to differ
  // between page loads, so the browser always refetches game.js + levels.json.
  // Combined with build_version (which captures intentional deploys) this
  // makes the cache-bust 100% reliable. We capture it in useRef so the iframe
  // src doesn't change WITHIN a session (would re-mount iframe on every state
  // update — kills the running game).
  const mountNonce = useRef<string>(String(Date.now()));

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true));
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false));
    }
  }, []);

  useEffect(() => {
    const handleEsc = () => {
      if (!document.fullscreenElement) setIsFullscreen(false);
    };
    document.addEventListener("fullscreenchange", handleEsc);
    return () => document.removeEventListener("fullscreenchange", handleEsc);
  }, []);

  // Listen for PostMessage from game iframe (ad triggers, analytics)
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== "object") return;
      switch (e.data.type) {
        case "forgeflow:show_interstitial":
          // TODO: trigger interstitial ad
          console.log("[ad] Interstitial requested by game");
          break;
        case "forgeflow:show_rewarded":
          // TODO: trigger rewarded ad, send reward back
          console.log("[ad] Rewarded ad requested by game");
          break;
        case "forgeflow:level_complete":
          console.log("[analytics] Level complete:", e.data.level);
          break;
        case "forgeflow:game_over":
          console.log("[analytics] Game over, score:", e.data.score);
          break;
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const startGame = () => {
    setShowPreroll(false);
    // Initialize game-to-portal bridge (scores, achievements, saves, play time)
    initGameBridge(game.slug, game.id);
  };

  // Cleanup bridge on unmount
  useEffect(() => {
    return () => destroyGameBridge();
  }, []);

  // 2026-05-08 — Layout pivot per user. Was: full 100vw breakout when
  // playing, so the game ate the whole viewport edge-to-edge. New: keep
  // the iframe centered with an ad-slot column on each side. Browser-
  // fullscreen (F key or button) still spans 100vw/100vh. The pre-roll
  // covers continue to use the page's normal max-w-7xl flow.
  const playingClasses = "relative bg-black rounded-xl overflow-hidden";

  return (
    <div ref={containerRef} className={playingClasses}>
      {/* Pre-roll: game cover image (or ad placeholder fallback) + Play button */}
      {showPreroll && (
        <div className="absolute inset-0 z-20 bg-surface-900 flex flex-col items-center justify-center">
          {/* 2026-05-05 — Hero/cover image takes the slot that used to be a
              house-ad placeholder. If a thumbnail/hero is set, render it; if
              neither exists, fall back to the ad-shaped placeholder so the
              layout doesn't collapse. */}
          {/* 2026-05-11 — Cover-art slot. If the game has a hero image
              or thumbnail, render it. If not, render nothing (was: fake
              "Advertisement" placeholder, removed per user feedback —
              real ads live in viewport-edge whitespace, not as content
              boxes). */}
          {(game.hero_image_url || game.thumbnail_url) && (
            <div className="w-full max-w-lg mx-auto mb-8 px-4">
              <img
                src={game.hero_image_url || game.thumbnail_url}
                alt={`${game.title} cover art`}
                className="aspect-video w-full rounded-lg object-cover border border-surface-600/30 shadow-lg"
                loading="eager"
              />
            </div>
          )}
          <button
            onClick={startGame}
            className="group flex items-center gap-3 px-8 py-4 bg-brand-blue text-surface-900 rounded-xl font-display font-bold text-xl hover:bg-brand-blue/90 transition-all active:scale-95 animate-glow-pulse"
          >
            <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            Play {game.title}
          </button>
          <p className="text-xs text-surface-500 mt-4">Free to play. No downloads required.</p>
        </div>
      )}

      {/*
        2026-05-11 — Layout v4: GamePlayer is just a 16:9 frame.
        The ad columns are NOT inside GamePlayer anymore — they belong to
        the slug-page grid (pages/games/@slug/+Page.tsx), which now uses
        `grid-cols-[160px_1fr_320px]` so ads + game + sidebar all sit in
        the SAME grid. Previous version tried to add ad columns INSIDE
        GamePlayer + break out of the page wrapper, but the page's parent
        wasn't centered in the viewport so the breakout pulled the left
        column off-screen (x=-154).
       */}
      <div
        className={
          isFullscreen
            ? "relative w-screen h-screen"
            : "relative aspect-video w-full bg-black rounded-lg overflow-hidden"
        }
      >
        <div
          className={
            isFullscreen
              ? "w-full h-full"
              : "absolute inset-0"
          }
        >
        {!showPreroll && (
          <iframe
            ref={iframeRef}
            // 2026-05-06 — ?v=<build_version|updated_at> cache-buster so the
            // browser fetches the latest game.js + levels.json every time the
            // games row updates, instead of serving stale iframe assets.
            // Without this, players who'd already loaded an old version of
            // the game would keep seeing the pre-deploy build until they
            // cleared their browser cache.
            src={`${game.game_url}${game.game_url.includes("?") ? "&" : "?"}v=${encodeURIComponent(game.build_version || game.updated_at || "1")}-${mountNonce.current}`}
            className="w-full h-full border-0"
            allow="autoplay; fullscreen; gamepad"
            sandbox="allow-scripts allow-same-origin allow-popups"
            onLoad={() => setIsLoading(false)}
            title={game.title}
          />
        )}

        {/* Loading overlay */}
        {!showPreroll && isLoading && (
          <div className="absolute inset-0 bg-surface-900 flex items-center justify-center z-10">
            <div className="text-center">
              <div className="w-10 h-10 border-3 border-brand-blue/30 border-t-brand-blue rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-surface-500">Loading {game.title}...</p>
            </div>
          </div>
        )}

        {/* Controls overlay */}
        {!showPreroll && (
          <div className="absolute top-3 right-3 z-10 flex items-center gap-2 opacity-0 hover:opacity-100 transition-opacity duration-300">
            <button
              onClick={toggleFullscreen}
              className="p-2 rounded-lg bg-black/60 text-white hover:bg-black/80 transition-colors"
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              )}
            </button>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
