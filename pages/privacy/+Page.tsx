// Rewritten 2026-10-06. The previous text (dated April 2026) said analytics were
// Cloudflare Web Analytics with "no cookies" and that saves were "never
// transmitted to our servers". Both were untrue: the site runs Google Analytics 4
// (cookies), and signed-in players have profiles, cloud saves, leaderboard
// scores and achievements stored in our database. A privacy policy that
// misdescribes the data practices is itself an AdSense and legal problem, so this
// describes what the site actually does.
const H2 = "font-display font-semibold text-xl text-gray-200";
const LINK = "text-brand-blue hover:underline";

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <h1 className="font-display font-bold text-3xl text-gray-100 mb-6">Privacy Policy</h1>
      <p className="text-sm text-surface-500 mb-8">Last updated: October 6, 2026</p>
      <div className="prose prose-invert prose-sm max-w-none space-y-4 text-gray-300 leading-relaxed">
        <p>
          ForgeFlow Games (forgeflowgames.com) is run by ForgeFlow Labs in Dallas, Texas. This page explains
          what information we collect when you play, what we do with it, and the choices you have. You can play
          most games without creating an account.
        </p>

        <h2 className={H2}>Information we collect</h2>
        <p>
          <strong>If you create an account</strong> (with an email and password, or by signing in with Google) we
          store your email address, the username you choose, and the basic profile details Google shares when you
          use Google sign-in. While signed in we also store your gameplay data: scores and leaderboard entries,
          achievements and experience points, friend connections, and cloud saves for games that support them.
        </p>
        <p>
          <strong>Whether or not you have an account</strong>, our servers and our hosting provider (Cloudflare)
          receive standard technical information when you load a page, such as your IP address, browser type and
          the pages requested. We use Google Analytics 4 to understand how the site is used — which pages and
          games are visited, roughly where visitors are located, and what device and browser they use. Analytics
          reports are aggregate; we do not use them to identify individual players.
        </p>

        <h2 className={H2}>Cookies and local storage</h2>
        <p>
          We and our partners use cookies and similar technologies: a sign-in session so you stay logged in,
          Google Analytics cookies to measure usage, and — when advertising is switched on — advertising cookies
          set by Google and its partners. Your browser's local storage also holds game progress, settings and
          preferences on your device; if you are signed in, some games additionally copy saves to your account so
          they follow you between devices. You can block or delete cookies and local storage in your browser
          settings, though some features, such as staying signed in, will stop working.
        </p>

        <h2 className={H2}>Advertising</h2>
        <p>
          We use, or are preparing to use, Google AdSense to show advertisements on this site. Google and its
          advertising partners may use cookies and similar technologies to show ads and measure how they perform.
          If you are in the European Economic Area, the United Kingdom or Switzerland, you will be asked for
          your consent through a consent message before personalised advertising is shown, and you can change
          that choice at any time. You can also manage personalised advertising through{" "}
          <a href="https://adssettings.google.com" className={LINK} target="_blank" rel="noopener noreferrer">Google's Ads Settings</a>{" "}
          or learn how Google uses information from sites that use its services at{" "}
          <a href="https://policies.google.com/technologies/partner-sites" className={LINK} target="_blank" rel="noopener noreferrer">policies.google.com/technologies/partner-sites</a>.
          You can opt out of many third-party advertising cookies at{" "}
          <a href="https://optout.aboutads.info" className={LINK} target="_blank" rel="noopener noreferrer">optout.aboutads.info</a>.
        </p>

        <h2 className={H2}>Who else handles your data</h2>
        <p>
          We use a small number of service providers to run the site: Cloudflare (hosting, delivery and security),
          Supabase (account sign-in and the database that stores profiles, scores, achievements and saves), Google
          (analytics, sign-in if you choose it, and advertising). They process data on our behalf or under their own
          privacy policies. We do not sell your personal information.
        </p>

        <h2 className={H2}>How long we keep it, and your choices</h2>
        <p>
          We keep account data for as long as your account exists. You can ask us to show you, correct or delete
          the personal data we hold about you — including deleting your account and its saves and scores — by
          emailing the address below. Anonymous analytics data is kept in aggregate according to Google
          Analytics' retention settings.
        </p>

        <h2 className={H2}>Children's privacy</h2>
        <p>
          ForgeFlow Games is a general-audience site and is not directed to children under 13. We do not
          knowingly collect personal information from children under 13. Some of our games contain stylised combat and violence; players under 13
          should have a parent or guardian's permission. If you believe a child has given us personal information,
          contact us and we will delete it.
        </p>

        <h2 className={H2}>Changes to this policy</h2>
        <p>
          If we change how we handle information we will update this page and the date at the top. Material
          changes — for example, switching on a new advertising partner — will be reflected here before they
          take effect.
        </p>

        <h2 className={H2}>Contact</h2>
        <p>
          For privacy-related questions or requests, contact us at{" "}
          <a href="mailto:privacy@forgeflowlabs.com" className={LINK}>privacy@forgeflowlabs.com</a>.
        </p>
      </div>
    </div>
  );
}
