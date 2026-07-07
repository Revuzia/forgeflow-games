// 2026-07-07 — Enumerate category URLs so Vike prerenders
// `/category/<name>/index.html` for each one. Imports the same CATEGORIES
// array the page component renders from, so a newly added category is
// picked up on the next build with no extra step.
import { CATEGORIES } from "../../../src/lib/supabase";

export default async function onBeforePrerenderStart(): Promise<string[]> {
  return CATEGORIES.map((c) => `/category/${c.slug}`);
}
