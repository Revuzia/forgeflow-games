// Seeds the /games listing into the static HTML (see src/lib/seed.ts).
import { fetchPublishedGames, slimGames } from "../../src/lib/seedFetch";

export default async function onBeforePrerenderStart() {
  return [{ url: "/games", pageContext: { gamesSeed: slimGames(await fetchPublishedGames()) } }];
}
