import { usePageContext } from "vike-react/usePageContext";
import { useConfig } from "vike-react/useConfig";
import { Head } from "vike-react/Head";
import { guideBySlug, guideWordCount, GUIDES } from "../../../src/content/guides";
import { gameTitle } from "../../../src/content/gameTitles";
import { SITE_URL, SITE_NAME, canonicalFor, clip } from "../../../src/config/site";

export default function GuidePage() {
  const { routeParams } = usePageContext() as { routeParams?: Record<string, string> };
  const guide = guideBySlug(routeParams?.slug || "");
  const config = useConfig();

  if (!guide) {
    config({ title: `Guide not found | ${SITE_NAME}` });
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-20 text-center">
        <Head><meta name="robots" content="noindex, follow" /></Head>
        <h1 className="font-display font-bold text-3xl text-gray-200 mb-3">Guide not found</h1>
        <a href="/guides" className="btn-primary inline-block mt-4">See all guides</a>
      </div>
    );
  }

  config({ title: `${guide.title} | ${SITE_NAME}`, description: clip(guide.description) });

  const canonical = canonicalFor(`/guides/${guide.slug}`);
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        headline: guide.title,
        description: guide.description,
        url: canonical,
        mainEntityOfPage: canonical,
        datePublished: guide.published,
        dateModified: guide.published,
        wordCount: guideWordCount(guide),
        inLanguage: "en",
        author: { "@type": "Organization", name: "ForgeFlow Labs", url: SITE_URL },
        publisher: { "@type": "Organization", name: "ForgeFlow Labs", url: SITE_URL },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
          { "@type": "ListItem", position: 2, name: "Guides", item: `${SITE_URL}/guides/` },
          { "@type": "ListItem", position: 3, name: guide.title, item: canonical },
        ],
      },
    ],
  }).replace(/</g, "\\u003c");

  const others = GUIDES.filter((g) => g.slug !== guide.slug && g.topic === guide.topic).slice(0, 3);
  const more = others.length ? others : GUIDES.filter((g) => g.slug !== guide.slug).slice(0, 3);

  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      <Head>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      </Head>

      <nav className="text-sm text-gray-400 mb-5 flex flex-wrap items-center gap-2" aria-label="Breadcrumb">
        <a href="/" className="hover:text-brand-orange transition-colors">Home</a>
        <span>/</span>
        <a href="/guides" className="hover:text-brand-orange transition-colors">Guides</a>
        <span>/</span>
        <span className="text-gray-200">{guide.topic}</span>
      </nav>

      <p className="text-xs font-semibold uppercase tracking-widest text-brand-orange mb-3">{guide.topic}</p>
      <h1 className="font-display font-bold text-3xl sm:text-4xl text-white tracking-tight leading-tight mb-4">{guide.title}</h1>
      <p className="text-sm text-gray-400 mb-8">
        By ForgeFlow Labs · Published {new Date(guide.published + "T12:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })} ·{" "}
        {Math.max(1, Math.round(guideWordCount(guide) / 200))} min read
      </p>

      <p className="text-lg text-gray-200 leading-relaxed mb-8">{guide.intro}</p>

      {guide.sections.map((s) => (
        <section key={s.h} className="mb-8">
          <h2 className="font-display font-bold text-xl sm:text-2xl text-white tracking-tight mb-3">{s.h}</h2>
          {s.p?.map((t, i) => (
            <p key={i} className="text-gray-300 leading-relaxed mb-3">{t}</p>
          ))}
          {s.faq && (
            <dl className="space-y-4">
              {s.faq.map((f) => (
                <div key={f.q}>
                  <dt className="font-display font-semibold text-white mb-1">{f.q}</dt>
                  <dd className="text-gray-300 leading-relaxed">{f.a}</dd>
                </div>
              ))}
            </dl>
          )}
          {s.list && (
            s.ordered ? (
              <ol className="list-decimal pl-6 space-y-2 text-gray-300 leading-relaxed marker:text-brand-orange">
                {s.list.map((t, i) => <li key={i}>{t}</li>)}
              </ol>
            ) : (
              <ul className="list-disc pl-6 space-y-2 text-gray-300 leading-relaxed marker:text-brand-orange">
                {s.list.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            )
          )}
        </section>
      ))}

      {guide.games.length > 0 && (
        <section className="surface-panel p-5 mb-10">
          <h2 className="font-display font-bold text-lg text-white mb-3">Play these games free in your browser</h2>
          <ul className="flex flex-wrap gap-2">
            {guide.games.map((slug) => (
              <li key={slug}>
                <a href={`/games/${slug}`} className="category-pill inline-block">{gameTitle(slug)}</a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="section-title mb-4">More guides</h2>
        <ul className="space-y-2">
          {more.map((g) => (
            <li key={g.slug}>
              <a href={`/guides/${g.slug}`} className="text-brand-orange hover:underline font-medium">{g.title}</a>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
