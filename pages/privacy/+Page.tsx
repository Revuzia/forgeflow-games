export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <h1 className="font-display font-bold text-3xl text-gray-100 mb-6">Privacy Policy</h1>
      <p className="text-sm text-surface-500 mb-8">Last updated: April 15, 2026</p>
      <div className="prose prose-invert prose-sm max-w-none space-y-4 text-gray-300 leading-relaxed">
        <h2 className="font-display font-semibold text-xl text-gray-200">Information We Collect</h2>
        <p>
          ForgeFlow Games collects minimal data to operate our service. We use
          Cloudflare Web Analytics, which is privacy-focused and does not use cookies
          or track individual users. We collect anonymous, aggregate usage data such as
          page views, game play counts, and general geographic region.
        </p>
        <h2 className="font-display font-semibold text-xl text-gray-200">Advertising</h2>
        <p>
          We display advertisements through Google AdSense and other ad networks. These
          services may use cookies and similar technologies to serve ads based on your
          browsing activity. You can manage your ad preferences through Google's Ad Settings
          or by using browser privacy controls.
        </p>
        <h2 className="font-display font-semibold text-xl text-gray-200">Local Storage</h2>
        <p>
          Some games use your browser's localStorage to save game progress. This data is
          stored only on your device and is never transmitted to our servers.
        </p>
        <h2 className="font-display font-semibold text-xl text-gray-200">Children's Privacy</h2>
        <p>
          Our games are suitable for all ages. We do not knowingly collect personal
          information from children under 13. No account creation is required to play games.
        </p>
        <h2 className="font-display font-semibold text-xl text-gray-200">Contact</h2>
        <p>
          For privacy-related questions, contact us at{" "}
          <a href="mailto:privacy@forgeflowlabs.com" className="text-brand-blue hover:underline">privacy@forgeflowlabs.com</a>.
        </p>
      </div>
    </div>
  );
}
