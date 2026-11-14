import { useEffect, useState } from "react";

const TOUCH_QUERY = "(hover: none) and (pointer: coarse)";

/**
 * True when the VISITOR is on a touch-primary device (phone/tablet).
 *
 * Starts false on purpose: these pages are prerendered by Vike, so the first
 * client render must match the server HTML or hydration breaks. The real value
 * lands in the effect, one tick later.
 */
export default function useIsTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(TOUCH_QUERY);
    const apply = () => setIsTouch(mq.matches);
    apply();
    // Safari < 14 only has the deprecated addListener
    if (mq.addEventListener) {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
    mq.addListener(apply);
    return () => mq.removeListener(apply);
  }, []);

  return isTouch;
}
