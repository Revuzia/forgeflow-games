import { CATEGORIES } from "../../lib/supabase";

export default function Footer() {
  return (
    <footer className="bg-surface-800/70 border-t border-surface-600/40 mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 sm:py-12">
        <div className="grid grid-cols-2 md:grid-cols-[1.4fr_1.2fr_1fr_1fr] gap-x-6 gap-y-9">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <a href="/" className="inline-block mb-4">
              <img
                src="/images/logo.png"
                alt="ForgeFlow Games"
                className="h-[56px] w-auto drop-shadow-[0_2px_10px_rgba(255,136,0,0.35)]"
              />
            </a>
            <p className="text-sm text-gray-300 leading-relaxed max-w-xs">
              Free original browser games. No downloads, no sign-up. Just click and play.
            </p>
          </div>

          {/* Categories: two columns so the list stays short */}
          <div>
            <h3 className="font-display font-bold text-white text-xs uppercase tracking-widest mb-4">Categories</h3>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
              {CATEGORIES.map((cat) => (
                <li key={cat.slug}>
                  <a
                    href={`/category/${cat.slug}`}
                    className="text-sm text-gray-300 hover:text-white transition-colors inline-flex items-center gap-2"
                  >
                    <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cat.color }} />
                    {cat.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="font-display font-bold text-white text-xs uppercase tracking-widest mb-4">Explore</h3>
            <ul className="space-y-2.5">
              <li><a href="/games" className="text-sm text-gray-300 hover:text-white transition-colors">All Games</a></li>
              <li><a href="/guides" className="text-sm text-gray-300 hover:text-white transition-colors">Game Guides</a></li>
              <li><a href="/about" className="text-sm text-gray-300 hover:text-white transition-colors">About Us</a></li>
              <li><a href="/contact" className="text-sm text-gray-300 hover:text-white transition-colors">Contact</a></li>
              <li><a href="/privacy" className="text-sm text-gray-300 hover:text-white transition-colors">Privacy Policy</a></li>
              <li><a href="/terms" className="text-sm text-gray-300 hover:text-white transition-colors">Terms of Service</a></li>
            </ul>
          </div>

          <div>
            <h3 className="font-display font-bold text-white text-xs uppercase tracking-widest mb-4">Connect</h3>
            <p className="text-sm text-gray-200 mb-1 font-medium">ForgeFlow Labs</p>
            <p className="text-sm text-gray-300">Dallas, TX</p>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-surface-600/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <p className="text-sm text-gray-300">
            &copy; {new Date().getFullYear()} ForgeFlow Labs. All rights reserved.
          </p>
          <p className="text-xs sm:text-sm text-gray-400">
            All games are original creations. No affiliation with any referenced franchises.
          </p>
        </div>
      </div>
    </footer>
  );
}
