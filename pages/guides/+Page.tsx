import { GUIDES, guideWordCount } from "../../src/content/guides";

const TOPICS = ["Board games", "Strategy", "Action", "Playing online", "Mobile"] as const;

export default function GuidesIndexPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
      <nav className="text-sm text-gray-400 mb-4 flex flex-wrap items-center gap-2" aria-label="Breadcrumb">
        <a href="/" className="hover:text-brand-orange transition-colors">Home</a>
        <span>/</span>
        <span className="text-gray-200">Guides</span>
      </nav>

      <h1 className="font-display font-bold text-3xl sm:text-4xl text-white tracking-tight mb-3">Game Guides</h1>
      <p className="text-lg text-gray-300 leading-relaxed max-w-3xl mb-10">
        Plain-English guides to the rules, strategy and controls behind the games on ForgeFlow Games. Learn how classic
        board games work, how to get more out of tower defense and horde-survival games, how online play finds your
        friends, and how to play well on a phone.
      </p>

      {TOPICS.map((topic) => {
        const list = GUIDES.filter((g) => g.topic === topic);
        if (!list.length) return null;
        return (
          <section key={topic} className="mb-12">
            <h2 className="section-title mb-4">{topic}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {list.map((g) => (
                <a
                  key={g.slug}
                  href={`/guides/${g.slug}`}
                  className="surface-panel p-5 block transition-all duration-300 hover:-translate-y-1 hover:border-brand-orange/50"
                >
                  <h3 className="font-display font-bold text-lg text-white mb-2">{g.title}</h3>
                  <p className="text-sm text-gray-300 leading-relaxed">{g.description}</p>
                  <p className="text-xs text-gray-400 mt-3">
                    {Math.max(1, Math.round(guideWordCount(g) / 200))} min read
                  </p>
                </a>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
