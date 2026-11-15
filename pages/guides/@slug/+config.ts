// Every guide is prerendered to static HTML (slugs come from src/content/guides.ts
// through +onBeforePrerenderStart.ts), so crawlers see the full article.
export default {
  prerender: true,
};
