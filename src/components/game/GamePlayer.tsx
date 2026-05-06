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

  // When the game is actually playing (not preroll) and not in browser
  // fullscreen, break out of the page's max-w-7xl wrapper so the iframe
  // can take the full viewport width. We measure the player's offset and
  // pin the playing container with negative margins so it spans 100vw.
  // This is much less janky than requestFullscreen and works everywhere.
  const playingClasses = !showPreroll && !isFullscreen
    ? "relative bg-black overflow-hidden mx-[calc(50%-50vw)] w-screen"
    : "relative bg-black rounded-xl overflow-hidden";

  return (
    <div ref={containerRef} className={playingClasses}>
      {/* Pre-roll: game cover image (or ad placeholder fallback) + Play button */}
      {showPreroll && (
        <div className="absolute inset-0 z-20 bg-surface-900 flex flex-col items-center justify-center">
          {/* 2026-05-05 — Hero/cover image takes the slot that used to be a
              house-ad placeholder. If a thumbnail/hero is set, render it; if
              neither exists, fall back to the ad-shaped placeholder so the
              layout doesn't collapse. */}
          <div className="w-full max-w-lg mx-auto mb-8 px-4">
            {(game.hero_image_url || game.thumbnail_url) ? (
              <img
                src={game.hero_image_url || game.thumbnail_url}
                alt={`${game.title} cover art`}
                className="aspect-video w-full rounded-lg object-cover border border-surface-600/30 shadow-lg"
                loading="eager"
              />
            ) : (
              <div className="aspect-video bg-surface-800 rounded-lg border border-surface-600/30 flex items-center justify-center">
                <p className="text-xs text-surface-500">Advertisement</p>
              </div>
            )}
          </div>
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

      {/* Game iframe — fills the viewport minus the top nav (~80px) when
          playing, so the user gets the largest play area without having
          to click fullscreen. The pre-roll still uses aspect-video so the
          cover art doesn't dominate. */}
      <div className={`relative ${isFullscreen ? "w-screen h-screen" : showPreroll ? "aspect-video w-full" : "w-full h-[calc(100vh-80px)] min-h-[600px]"}`}>
        {!showPreroll && (
          <iframe
            ref={iframeRef}
            // 2026-05-06 — ?v=<build_version|updated_at> cache-buster so the
            // browser fetches the latest game.js + levels.json every time the
            // games row updates, instead of serving stale iframe assets.
            // Without this, players who'd already loaded an old version of
            // the game would keep seeing the pre-deploy build until they
            // cleared their browser cache.
            src={`${game.game_url}${game.game_url.includes("?") ? "&" : "?"}v=${encodeURIComponent(game.build_version || game.updated_at || "1")}`}
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
  );
}
