import { GUIDES } from "../../../src/content/guides";

export default async function onBeforePrerenderStart() {
  console.log(`[prerender] Pre-rendering ${GUIDES.length} guides`);
  return GUIDES.map((g) => ({ url: `/guides/${g.slug}` }));
}
