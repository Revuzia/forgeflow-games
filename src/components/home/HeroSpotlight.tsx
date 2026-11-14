import { useEffect, useState } from "react";
import type { Game } from "../../lib/supabase";

type Props = {
  /** newest games that have cover art (first one is what the static HTML shows) */
  games: Game[];
  /** real counts from the registry, shown in the stat strip */
  stats: { games: number; touch: number };
};

const ROTATE_MS = 7000;

export default function HeroSpotlight({ games, stats }: Props) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  // Rotate through the newest releases. Starts only after hydration, so the
  // prerendered HTML (always slide 0) and the first client render agree; stops
  // while the pointer or keyboard focus is on the card; off for reduced motion.
  useEffect(() => {
    if (games.length < 2 || paused) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setIdx((i) => (i + 1) % games.length), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [games.length, paused]);

  const g = games[idx % Math.max(games.length, 1)];
  const art = g ? g.hero_image_url || g.thumbnail_url || "" : "";

  return (
    <section className="relative overflow-hidden border-b border-surface-600/30">
      {/* Backdrop: the current game's art, blurred and darkened, so the whole hero takes on its colours */}
      {art && (
        <img
          key={`bg-${g.id}`}
          src={art}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover scale-125 blur-3xl opacity-40 animate-fade-in"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-surface-900/55 via-surface-900/70 to-surface-900" />
      <div className="absolute inset-0 opacity-[0.05]" style={{
        backgroundImage: "linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)",
        backgroundSize: "56px 56px",
      }} />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-10 pb-8 sm:pt-14 sm:pb-10 lg:pt-16">
        <div className={`grid gap-10 items-center ${g ? "lg:grid-cols-[1fr_1.05fr]" : ""}`}>
          <div className={g ? "" : "text-center max-w-3xl mx-auto"}>
            <p className="inline-flex items-center gap-2 rounded-full border border-brand-orange/40 bg-brand-orange/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-brand-orange mb-5">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-orange animate-pulse" />
              Free in your browser
            </p>
            <h1 className="font-display font-bold text-5xl sm:text-6xl lg:text-7xl leading-[1.02] tracking-tight mb-5">
              <span className="bg-gradient-to-r from-brand-orange via-[#ffb347] to-brand-orange bg-clip-text text-transparent">Premium</span>
              <br />
              <span className="text-white">Browser Games</span>
            </h1>
            <p className="text-lg sm:text-xl text-gray-300 mb-8 leading-relaxed max-w-xl">
              Original games you can play instantly. No downloads, no sign-up. Pick one and play.
            </p>
            <a href="/games" className="btn-primary inline-block text-lg px-9 py-4">Browse All Games</a>

            {/* Real numbers from the registry */}
            <dl className="mt-9 grid grid-cols-3 gap-4 max-w-md">
              {[
                { n: stats.games, l: "Games" },
                { n: stats.touch, l: "Work on phones" },
                { n: 0, l: "Downloads", text: "0" },
              ].map((s) => (
                <div key={s.l}>
                  <dt className="sr-only">{s.l}</dt>
                  <dd className="font-display font-bold text-3xl text-white leading-none">{s.text ?? s.n}</dd>
                  <dd className="text-xs uppercase tracking-widest text-gray-400 mt-1.5">{s.l}</dd>
                </div>
              ))}
            </dl>
          </div>

          {g && (
            <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
              <a
                href={`/games/${g.slug}`}
                className="group relative block rounded-3xl overflow-hidden border border-white/10 shadow-2xl shadow-black/70 aspect-video ring-1 ring-brand-orange/20"
              >
                <img
                  key={g.id}
                  src={art}
                  alt={`${g.title} cover art`}
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105 animate-fade-in"
                  loading="eager"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
                  <span className="inline-block px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider bg-brand-orange text-white">
                    New release
                  </span>
                  <h2 className="font-display font-bold text-2xl sm:text-4xl text-white mt-2.5 drop-shadow">{g.title}</h2>
                  {g.short_description && (
                    <p className="text-sm sm:text-[15px] text-gray-200 mt-1.5 line-clamp-2 max-w-lg">{g.short_description}</p>
                  )}
                  <span className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white/95 px-5 py-2.5 text-sm font-bold text-surface-900 group-hover:bg-brand-orange group-hover:text-white transition-colors">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                    Play now
                  </span>
                </div>
              </a>
              {games.length > 1 && (
                <div className="mt-4 flex items-center justify-center gap-2" role="tablist" aria-label="New releases">
                  {games.map((x, i) => (
                    <button
                      key={x.id}
                      type="button"
                      role="tab"
                      aria-selected={i === idx}
                      aria-label={`Show ${x.title}`}
                      onClick={() => setIdx(i)}
                      className={`h-2 rounded-full transition-all ${i === idx ? "w-8 bg-brand-orange" : "w-2 bg-white/30 hover:bg-white/60"}`}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
