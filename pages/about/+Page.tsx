export default function AboutPage() {
  const h2 = "font-display font-bold text-xl sm:text-2xl text-white tracking-tight mt-10 mb-3";
  const p = "text-gray-300 leading-relaxed mb-4";
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <h1 className="font-display font-bold text-3xl sm:text-4xl text-white tracking-tight mb-6">About ForgeFlow Games</h1>

      <p className="text-lg text-gray-200 leading-relaxed mb-4">
        ForgeFlow Games is a free browser gaming site from ForgeFlow Labs in Dallas, Texas. Every game on it is an
        original creation that runs directly in your browser, with no download, no installation and no account needed to
        play.
      </p>
      <p className={p}>
        The library covers many kinds of games: action and shooters, strategy and tower defense, role-playing and
        adventure, arcade and racing, platformers, fighting games, sandbox builders, and classic digital board games such as
        chess, checkers, backgammon, dominoes, mahjong solitaire and Rummikub. New games are added over time, and the
        newest releases are featured on the home page.
      </p>

      <h2 className={h2}>What we are trying to make</h2>
      <p className={p}>
        We want games that start in seconds and are worth coming back to. That means every game has to explain itself:
        each game page has a short description, its controls, a how-to-play section and practical tips, and we write
        guides for the games and genres that need more than a paragraph. Take a look at our{" "}
        <a href="/guides" className="text-brand-orange hover:underline">game guides</a> to see how that works.
      </p>

      <h2 className={h2}>How the games run</h2>
      <p className={p}>
        The games are built with modern web technology: 3D graphics through WebGL and Three.js, the Gamepad API for
        controllers, and the Web Audio API for sound and music. Many games support touch screens, and each game card shows
        whether it works on phones and tablets. A game marked Desktop only needs a keyboard and mouse.
      </p>

      <h2 className={h2}>Playing with others</h2>
      <p className={p}>
        Several games have online play, through room codes you can share with a friend or through Quick Match. Our guide to{" "}
        <a href="/guides/play-with-friends-room-codes-quick-match" className="text-brand-orange hover:underline">
          playing online with friends
        </a>{" "}
        explains how each one works.
      </p>

      <h2 className={h2}>Accounts, progress and advertising</h2>
      <p className={p}>
        You can play without signing in. If you sign in, your achievements, records and some game progress are saved to
        your account and can appear on the leaderboards. To help keep the games free, we plan to support the site with
        advertising that sits around the game area rather than inside it. Our{" "}
        <a href="/privacy" className="text-brand-orange hover:underline">privacy policy</a> explains what information is
        collected and the choices you have.
      </p>

      <h2 className={h2}>Get in touch</h2>
      <p className={p}>
        Questions, bug reports and game suggestions are welcome. Email us at{" "}
        <a href="mailto:sales@forgeflowlabs.com" className="text-brand-orange hover:underline">sales@forgeflowlabs.com</a> or
        visit our <a href="/contact" className="text-brand-orange hover:underline">contact page</a>.
      </p>
    </div>
  );
}
