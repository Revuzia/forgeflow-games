import AdSlot from "./AdSlot";
import { slotId } from "../../lib/ads";

/**
 * Wide-screen side rails for the game page — the viewport whitespace OUTSIDE the
 * max-w-7xl (1280px) content column, which the page comment of 2026-05-11 had
 * reserved for real ads.
 *
 * Geometry is driven by AdSense's rule of keeping display ads ~150px from the
 * game canvas (accidental clicks on controls). The game is the LEFT column of
 * the content grid, so:
 *   - LEFT rail  : 160px wide, 150px clear of the container's left edge (= the
 *                  game's left edge)  -> needs a >= 1900px viewport.
 *   - RIGHT rail : sits beside the 320px sidebar, so it is already ~340px from
 *                  the game even hugging the container -> fits from 1640px.
 * Below those widths nothing renders; the in-flow <AdSlot slot="gameBelow"/> is
 * the only unit. Rendered nothing at all while ads are off.
 */
export default function AdRails() {
  const left = slotId("gameRailLeft");
  const right = slotId("gameRailRight");
  if (!left && !right) return null;
  return (
    <>
      {left && (
        <div className="ffg-rail ffg-rail-left" style={{ position: "fixed", top: 112, left: "calc(50% - 950px)" }}>
          <AdSlot slot="gameRailLeft" variant="rail" />
        </div>
      )}
      {right && (
        <div className="ffg-rail ffg-rail-right" style={{ position: "fixed", top: 112, left: "calc(50% + 656px)" }}>
          <AdSlot slot="gameRailRight" variant="rail" />
        </div>
      )}
    </>
  );
}
