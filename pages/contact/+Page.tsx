const EMAIL = "sales@forgeflowlabs.com";

const mail = (subject: string) => `mailto:${EMAIL}?subject=${encodeURIComponent(subject)}`;

const REASONS = [
  {
    title: "Questions and feedback",
    text: "Something you liked, something that confused you, or an idea for a game or a feature. We read what players send us and it shapes what we build next.",
    subject: "ForgeFlow Games feedback",
  },
  {
    title: "Report a bug",
    text: "If a game does not load, runs badly or behaves strangely, tell us which game it was, what you were doing, your device and browser, and what you saw on the screen. A screenshot helps.",
    subject: "ForgeFlow Games bug report",
  },
  {
    title: "Business and partnerships",
    text: "If you represent a company or another site and want to work with us, write to us with a few lines about who you are and what you have in mind.",
    subject: "ForgeFlow Games business enquiry",
  },
  {
    title: "Privacy requests",
    text: "To ask what information we hold about you, or to have it deleted, write to us from the address linked to your account. Our privacy policy explains what we collect and why.",
    subject: "ForgeFlow Games privacy request",
  },
];

export default function ContactPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <h1 className="font-display font-bold text-3xl sm:text-4xl text-white tracking-tight mb-4">Contact ForgeFlow Games</h1>
      <p className="text-lg text-gray-300 leading-relaxed mb-8">
        ForgeFlow Games is made by ForgeFlow Labs in Dallas, Texas. The easiest way to reach us is by email. Every message
        goes to the same inbox, so pick whichever subject fits best and tell us what you need.
      </p>

      <div className="surface-panel p-6 mb-10">
        <p className="text-sm uppercase tracking-widest text-gray-400 mb-2">Email</p>
        <a href={`mailto:${EMAIL}`} className="font-display font-bold text-2xl text-brand-orange hover:underline break-all">
          {EMAIL}
        </a>
        <p className="text-sm text-gray-300 mt-3">ForgeFlow Labs · Dallas, Texas</p>
      </div>

      <h2 className="font-display font-bold text-xl sm:text-2xl text-white tracking-tight mb-4">What to write to us about</h2>
      <div className="grid gap-4 sm:grid-cols-2 mb-10">
        {REASONS.map((r) => (
          <div key={r.title} className="surface-panel p-5 flex flex-col">
            <h3 className="font-display font-semibold text-lg text-white mb-2">{r.title}</h3>
            <p className="text-sm text-gray-300 leading-relaxed flex-1">{r.text}</p>
            <a href={mail(r.subject)} className="mt-4 text-sm font-semibold text-brand-orange hover:underline">
              Email us about this
            </a>
          </div>
        ))}
      </div>

      <h2 className="font-display font-bold text-xl sm:text-2xl text-white tracking-tight mb-3">Before you write</h2>
      <ul className="list-disc pl-6 space-y-2 text-gray-300 leading-relaxed marker:text-brand-orange mb-8">
        <li>
          Many answers are already in our <a href="/guides" className="text-brand-orange hover:underline">game guides</a>, including how online play and room codes work.
        </li>
        <li>
          Each game page lists its controls and a short how-to-play section, so check there first if a game feels unclear.
        </li>
        <li>
          Read our <a href="/privacy" className="text-brand-orange hover:underline">privacy policy</a> and{" "}
          <a href="/terms" className="text-brand-orange hover:underline">terms of service</a> to see how the site works.
        </li>
      </ul>

      <p className="text-gray-300 leading-relaxed">
        Thank you for playing. If you tell us which game you were playing and what happened, we can look into it much faster.
      </p>
    </div>
  );
}
