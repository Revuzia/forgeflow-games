export default function AboutPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <h1 className="font-display font-bold text-3xl text-gray-100 mb-6">About ForgeFlow Games</h1>
      <div className="prose prose-invert prose-sm max-w-none space-y-4 text-gray-300 leading-relaxed">
        <p>
          ForgeFlow Games is a premium browser gaming platform built by ForgeFlow Labs in Dallas, Texas.
          We create original, high-quality games that run directly in your browser — no downloads,
          no signups, no app store required.
        </p>
        <p>
          Our growing library spans five genres: platformers, adventure, RPGs, action RPGs, and
          digital board games. Every game is an original creation built with modern web technologies
          including WebGPU, Three.js, and HTML5 Canvas.
        </p>
        <h2 className="font-display font-semibold text-xl text-gray-200 mt-8">Our Mission</h2>
        <p>
          We believe great games should be accessible to everyone. No paywalls, no mandatory
          accounts, no 2GB downloads. Just click and play. Our games are designed to deliver
          the same depth and polish you'd expect from premium titles, right in your browser.
        </p>
        <h2 className="font-display font-semibold text-xl text-gray-200 mt-8">Technology</h2>
        <p>
          Our games leverage cutting-edge web technologies. We use WebGPU for next-generation
          graphics, the Gamepad API for controller support, and responsive design so games
          work on desktop, tablet, and mobile. Audio is powered by the Web Audio API for
          spatial sound and dynamic music.
        </p>
        <h2 className="font-display font-semibold text-xl text-gray-200 mt-8">Contact</h2>
        <p>
          Have feedback, a bug report, or a game suggestion? We'd love to hear from you.
        </p>
        <p>
          Email: <a href="mailto:games@forgeflowlabs.com" className="text-brand-blue hover:underline">games@forgeflowlabs.com</a>
        </p>
      </div>
    </div>
  );
}
