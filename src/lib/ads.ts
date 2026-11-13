// Portal ad configuration + AdSense loader. The master switch is
// public/ads-config.json, decided at BUILD time (run pipeline/deploy_portal.py
// after editing it). While `enabled` is false — the shipped state — nothing in
// this file loads a script or touches the network, and <AdSlot /> renders
// nothing at all (the owner removed placeholder "Advertisement" boxes on
// 2026-05-11 as noise, so there is deliberately no empty-box fallback).
import adsConfig from "../../public/ads-config.json";

export type SlotName =
  | "homeMid"
  | "gamesBottom"
  | "categoryBottom"
  | "gameBelow"
  | "gameRailLeft"
  | "gameRailRight";

const PUB = String(adsConfig.publisherId || "");

/** True only when ads are switched on AND the publisher id is well-formed. */
export const ADS_ENABLED = adsConfig.enabled === true && /^ca-pub-\d{10,20}$/.test(PUB);

export const PUBLISHER_ID = PUB;

/**
 * AdSense ad-unit id for a slot, or null when ads are off or that slot has no id
 * yet (ids exist only after the site is approved and a unit is created).
 */
export function slotId(name: SlotName): string | null {
  if (!ADS_ENABLED) return null;
  const id = (adsConfig.slots as Record<string, string>)[name];
  return /^\d{6,}$/.test(id || "") ? id : null;
}

let loading = false;

/** Inject adsbygoogle.js once. No-op on the server, when disabled, or if already present. */
export function loadAdSenseScript(): void {
  if (typeof document === "undefined" || !ADS_ENABLED || loading) return;
  if (document.querySelector('script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]')) {
    loading = true;
    return;
  }
  loading = true;
  const s = document.createElement("script");
  s.async = true;
  s.crossOrigin = "anonymous";
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${PUB}`;
  document.head.appendChild(s);
}
