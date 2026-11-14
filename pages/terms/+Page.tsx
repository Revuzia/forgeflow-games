export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <h1 className="font-display font-bold text-3xl text-gray-100 mb-6">Terms of Service</h1>
      <p className="text-sm text-surface-500 mb-8">Last updated: April 15, 2026</p>
      <div className="prose prose-invert prose-sm max-w-none space-y-4 text-gray-300 leading-relaxed">
        <h2 className="font-display font-semibold text-xl text-gray-200">Acceptance of Terms</h2>
        <p>
          By accessing and using ForgeFlow Games (forgeflowgames.com), you agree to
          these Terms of Service. If you do not agree, please do not use our service.
        </p>
        <h2 className="font-display font-semibold text-xl text-gray-200">Use of Service</h2>
        <p>
          ForgeFlow Games provides free browser-based games for personal, non-commercial
          entertainment. You may not redistribute, modify, or reverse-engineer our games.
          You may not use automated tools to access our service in a way that degrades
          performance for other users.
        </p>
        <h2 className="font-display font-semibold text-xl text-gray-200">Intellectual Property</h2>
        <p>
          All games, graphics, code, and content on ForgeFlow Games are original
          creations owned by ForgeFlow Labs. All rights reserved. Our games are
          inspired by classic gaming genres but are entirely original intellectual
          property with no affiliation to any third-party franchise.
        </p>
        <h2 className="font-display font-semibold text-xl text-gray-200">Advertisements</h2>
        <p>
          Our service is supported by advertisements. By using ForgeFlow Games, you
          acknowledge that ads will be displayed during your experience. We work to
          ensure ads are non-intrusive and only shown at natural break points.
        </p>
        <h2 className="font-display font-semibold text-xl text-gray-200">Disclaimer</h2>
        <p>
          ForgeFlow Games is provided "as is" without warranties of any kind. We do
          not guarantee uninterrupted access or that games will be free from bugs.
          Game save data stored in localStorage may be lost if you clear your browser data.
        </p>
        <h2 className="font-display font-semibold text-xl text-gray-200">Contact</h2>
        <p>
          Questions about these terms? Contact us at{" "}
          <a href="mailto:legal@forgeflowlabs.com" className="text-brand-blue hover:underline">legal@forgeflowlabs.com</a>.
        </p>
      </div>
    </div>
  );
}
