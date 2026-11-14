// Seeds the homepage's carousels into the static HTML (see src/lib/seed.ts).
import { fetchPublishedGames, slimGames } from "../../src/lib/seedFetch";

export default async function onBeforePrerenderStart() {
  return [{ url: "/", pageContext: { gamesSeed: slimGames(await fetchPublishedGames()) } }];
}
