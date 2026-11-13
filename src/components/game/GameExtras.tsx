import type { Game } from "../../lib/supabase";
import { extrasFor } from "../../content/gameExtras";
import { guidesForGame } from "../../content/guides";

/**
 * The written guidance under a game's description: what it is, how to play it,
 * tips, and the guides that mention it. Text lives in src/content/gameExtras
 * (hand-written per game). A game published after that file was last updated
 * still gets a "How to play" built from its own registry controls, and the
 * build prints a warning naming it (scripts/build-seo.mjs).
 */
export default function GameExtras({ game }: { game: Game }) {
  const x = extrasFor(game.slug);
  const guides = guidesForGame(game.slug);

  // Fallback steps: the registry's own controls text, split on its " · " separators.
  const fallback =
    !x && game.controls_keyboard
      ? game.controls_keyboard.split(/\s+·\s+/).map((s) => s.trim()).filter(Boolean)
      : [];

  if (!x && !fallback.length && !guides.length) return null;

  const h2 = "font-display font-bold text-xl sm:text-2xl text-white tracking-tight mb-3";

  return (
    <section className="mt-10 space-y-9" aria-label={`More about ${game.title}`}>
      {x && (
        <div>
          <h2 className={h2}>About {game.title}</h2>
          <p className="text-gray-300 leading-relaxed">{x.about}</p>
        </div>
      )}

      {(x?.howTo.length || fallback.length) ? (
        <div>
          <h2 className={h2}>How to play {game.title}</h2>
          <ol className="list-decimal pl-6 space-y-2 text-gray-300 leading-relaxed marker:text-brand-orange marker:font-semibold">
            {(x ? x.howTo : fallback).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      ) : null}

      {x && x.tips.length > 0 && (
        <div>
          <h2 className={h2}>Tips for {game.title}</h2>
          <ul className="list-disc pl-6 space-y-2 text-gray-300 leading-relaxed marker:text-brand-orange">
            {x.tips.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {guides.length > 0 && (
        <div>
          <h2 className={h2}>Related guides</h2>
          <ul className="space-y-2">
            {guides.map((g) => (
              <li key={g.slug}>
                <a href={`/guides/${g.slug}`} className="text-brand-orange hover:underline font-medium">
                  {g.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
