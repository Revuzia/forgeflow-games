import { useEffect, useRef, useState } from "react";
import { ADS_ENABLED, PUBLISHER_ID, loadAdSenseScript, slotId, type SlotName } from "../../lib/ads";

type Props = {
  slot: SlotName;
  /** "rail" = fixed 160x600 skyscraper; otherwise a responsive unit. */
  variant?: "responsive" | "rail";
  className?: string;
};

/**
 * One AdSense display unit.
 *
 * - Renders NOTHING when ads are off or this slot has no unit id (the shipped
 *   state) — no placeholder box, no layout space, no script, no request.
 * - Labelled "Advertisement" (AdSense requires ads to be distinguishable from
 *   content) and never given a click handler or an overlay.
 * - Loads lazily: the ad is requested only when the slot is within 300px of the
 *   viewport, so ads far down a page cost nothing and never delay first paint.
 * - Collapses itself if Google reports the slot unfilled, so there are no empty
 *   gaps in the layout.
 *
 * Placement rule (AdSense): keep display ads at least ~150px away from the game
 * canvas to avoid accidental clicks on game controls. Callers are responsible —
 * see pages/games/@slug/+Page.tsx and <AdRails />.
 */
export default function AdSlot({ slot, variant = "responsive", className = "" }: Props) {
  const id = slotId(slot);
  const ref = useRef<HTMLElement>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!id) return;
    loadAdSenseScript();
    const el = ref.current;
    if (!el) return;

    let requested = false;
    const request = () => {
      if (requested) return;
      requested = true;
      try {
        const w = window as unknown as { adsbygoogle?: unknown[] };
        (w.adsbygoogle = w.adsbygoogle || []).push({});
      } catch {
        // An ad-block or script failure must never break the page.
        setHidden(true);
      }
    };

    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === "undefined") request();
    else {
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            request();
            io?.disconnect();
          }
        },
        { rootMargin: "300px" },
      );
      io.observe(el);
    }

    const ins = el.querySelector("ins");
    const mo = new MutationObserver(() => {
      if (ins?.getAttribute("data-ad-status") === "unfilled") setHidden(true);
    });
    if (ins) mo.observe(ins, { attributes: true, attributeFilter: ["data-ad-status"] });

    return () => {
      io?.disconnect();
      mo.disconnect();
    };
  }, [id]);

  if (!ADS_ENABLED || !id) return null;

  const rail = variant === "rail";
  return (
    <aside
      ref={ref}
      aria-label="Advertisement"
      className={`ffg-ad ${className}`}
      style={hidden ? { display: "none" } : undefined}
    >
      <div className="text-[10px] tracking-[0.2em] uppercase text-surface-500/70 mb-1 text-center select-none">
        Advertisement
      </div>
      <ins
        className="adsbygoogle"
        style={rail ? { display: "inline-block", width: 160, height: 600 } : { display: "block", minHeight: 90 }}
        data-ad-client={PUBLISHER_ID}
        data-ad-slot={id}
        {...(rail ? {} : { "data-ad-format": "auto", "data-full-width-responsive": "true" })}
      />
    </aside>
  );
}
