import vikeReact from "vike-react/config";
import type { Config } from "vike/types";
import { DEFAULT_TITLE, DEFAULT_DESCRIPTION, DEFAULT_OG_IMAGE } from "../src/config/site";

export default {
  extends: vikeReact,
  prerender: true,
  // Site-wide defaults. vike-react turns these into <title>, meta description,
  // og:title/og:description/og:image and twitter:image. Every page overrides
  // title/description (see each page, or useConfig() for data-driven ones) — a
  // page that does not is still never title-less, which is what shipped before:
  // NO page on the live site had a <title> at all.
  title: DEFAULT_TITLE,
  description: DEFAULT_DESCRIPTION,
  image: DEFAULT_OG_IMAGE,
  lang: "en",
  // Prerender-time registry rows handed to the page so the static HTML contains
  // the real content (see pages/games/@slug/+onBeforePrerenderStart.ts). Pages
  // that don't get them simply fetch client-side as before.
  passToClient: ["gameSeed", "relatedSeed", "gamesSeed"],
} satisfies Config;
