import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Game-page screenshot gallery (sidebar) + accessible lightbox.
 *
 * 2026-10-08 — replaces the old sidebar block (a 2-column grid of at most 4
 * small, non-clickable images). Up to MAX_SHOTS screenshots: the first full
 * width, the rest in a 2-column grid, all 16:9 object-cover, lazy after the
 * first. Every thumbnail is a button that opens a modal lightbox
 * (role="dialog", aria-modal) with prev/next, an "n / N" counter, Esc to close,
 * ArrowLeft/ArrowRight (wrapping), backdrop click to close, a Tab trap, body
 * scroll lock, and focus returned to the opening thumbnail on close.
 *
 * The lightbox is portalled to <body> so no ancestor stacking context can trap
 * it under the sticky header (z-50), the GamePlayer pre-roll/loading overlays
 * (z-10/z-20) or the ad rails (z-5).
 *
 * SSR/prerender-safe: render never touches window/document. The portal target
 * is captured in an effect, and the dialog can only open after a click.
 * No screenshots -> renders nothing (no heading, no empty box).
 *
 * Key it per game at the call site (key={game.slug}): vike-react reuses the
 * game page component across /games/a -> /games/b client navigations, so an
 * unkeyed gallery would carry the open viewer's index to the next game.
 */

/** Steam asks for at least 5 store screenshots; itch.io recommends 3-5. */
export const MAX_SHOTS = 5;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const FOCUS_RING =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 focus-visible:ring-offset-surface-900";

type Props = {
  title: string;
  urls: readonly (string | null | undefined)[] | null | undefined;
};

export default function ScreenshotGallery({ title, urls }: Props) {
  // Hand-set rows can carry blanks; never render an empty <img>.
  const shots = (urls || [])
    .filter((u): u is string => typeof u === "string" && u.trim() !== "")
    .slice(0, MAX_SHOTS);
  const count = shots.length;

  const [active, setActive] = useState<number | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const openerRef = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // In range, not just non-null: a shorter list arriving while the viewer is
  // open (a refetch) must close it, never leave the scroll lock and key
  // handlers running with no dialog on screen.
  const isOpen = active !== null && active < count;

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  const open = (i: number) => {
    openerRef.current = i;
    setActive(i);
  };
  const close = useCallback(() => setActive(null), []);
  const step = useCallback(
    (d: number) => setActive((i) => (i === null || count === 0 ? i : (i + d + count) % count)),
    [count],
  );

  // Open: lock body scroll (keeping the scrollbar's width so nothing shifts) and
  // move focus into the dialog. Close/unmount: restore both, then hand focus
  // back to the thumbnail that opened the viewer.
  useEffect(() => {
    if (!isOpen) return;
    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevPaddingRight = body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    closeRef.current?.focus();
    const opener = openerRef.current;
    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPaddingRight;
      thumbRefs.current[opener]?.focus();
    };
  }, [isOpen]);

  // Keys while open: Esc closes, arrows navigate (wrapping), Tab stays inside.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // Leave browser shortcuts alone (Alt+ArrowLeft is "Back").
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) {
          e.preventDefault();
          dialog.focus();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const current = document.activeElement;
        const inside = current instanceof Node && dialog.contains(current);
        if (e.shiftKey && (!inside || current === first || current === dialog)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (!inside || current === last)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, close, step]);

  if (count === 0) return null;

  const thumb = (url: string, i: number) => (
    <button
      key={`${i}-${url}`}
      ref={(el) => {
        thumbRefs.current[i] = el;
      }}
      type="button"
      onClick={() => open(i)}
      aria-label={`Open screenshot ${i + 1} of ${count}`}
      aria-haspopup="dialog"
      className={`group block w-full overflow-hidden rounded-lg border border-surface-600/30 bg-surface-800 cursor-zoom-in transition-colors duration-200 hover:border-brand-orange/40 ${FOCUS_RING}`}
    >
      <img
        src={url}
        alt={`${title} screenshot ${i + 1}`}
        className="block w-full aspect-video object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        loading={i === 0 ? "eager" : "lazy"}
        decoding="async"
      />
    </button>
  );

  const current = isOpen ? shots[active] : null;
  const many = count > 1;
  const navButton =
    `pointer-events-auto absolute top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-full ` +
    `bg-surface-800/80 text-gray-100 border border-surface-600/60 hover:bg-surface-700 hover:text-brand-blue transition-colors ${FOCUS_RING}`;

  const lightbox =
    isOpen && current !== null && portalTarget
      ? createPortal(
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={`${title} screenshots`}
            tabIndex={-1}
            className="fixed inset-0 z-[2147483000] flex items-center justify-center outline-none animate-fade-in"
          >
            {/* Backdrop: a click anywhere outside the image and the controls closes. */}
            <div className="absolute inset-0 bg-surface-900/95 backdrop-blur-sm" aria-hidden="true" onClick={close} />

            <figure className="pointer-events-none relative m-0 flex flex-col items-center gap-3">
              <img
                key={current}
                src={current}
                alt={`${title} screenshot ${(active ?? 0) + 1} of ${count}`}
                className="pointer-events-auto block h-auto w-auto max-w-[92vw] max-h-[85vh] object-contain rounded-lg shadow-2xl bg-black"
                decoding="async"
              />
              <figcaption className="font-display text-sm font-semibold tabular-nums text-gray-300" aria-live="polite">
                {(active ?? 0) + 1} / {count}
              </figcaption>
            </figure>

            <button
              ref={closeRef}
              type="button"
              onClick={close}
              aria-label="Close screenshot viewer"
              className={`absolute right-3 top-3 sm:right-5 sm:top-5 flex h-11 w-11 items-center justify-center rounded-full bg-surface-800/80 text-gray-100 border border-surface-600/60 hover:bg-surface-700 hover:text-brand-pink transition-colors ${FOCUS_RING}`}
            >
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {many && (
              <>
                <button
                  type="button"
                  onClick={() => step(-1)}
                  aria-label="Previous screenshot"
                  className={`${navButton} left-2 sm:left-5`}
                >
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => step(1)}
                  aria-label="Next screenshot"
                  className={`${navButton} right-2 sm:right-5`}
                >
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </>
            )}
          </div>,
          portalTarget,
        )
      : null;

  return (
    <div>
      <h3 className="font-display font-semibold text-sm text-gray-200 mb-3">Screenshots</h3>
      {thumb(shots[0], 0)}
      {count > 1 && (
        <div className="grid grid-cols-2 gap-2 mt-2">{shots.slice(1).map((url, j) => thumb(url, j + 1))}</div>
      )}
      {lightbox}
    </div>
  );
}
