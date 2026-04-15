import { CATEGORIES } from "../../lib/supabase";

export default function Footer() {
  return (
    <footer className="bg-surface-800 border-t border-surface-600/50 mt-20">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-14">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
          {/* Brand — big logo, readable text */}
          <div className="md:col-span-1">
            <a href="/" className="inline-block mb-5">
              <img
                src="/images/logo.png"
                alt="ForgeFlow Games"
                className="h-16 w-auto drop-shadow-[0_0_10px_rgba(255,136,0,0.25)]"
              />
            </a>
            <p className="text-sm text-gray-400 leading-relaxed">
              Premium browser games for everyone. No downloads, no signups. Just play.
            </p>
          </div>

          {/* Categories — colored links matching genre colors */}
          <div>
            <h3 className="font-display font-bold text-white text-sm uppercase tracking-wider mb-4">Categories</h3>
            <ul className="space-y-2.5">
              {CATEGORIES.map((cat) => (
                <li key={cat.slug}>
                  <a
                    href={`/category/${cat.slug}`}
                    className="text-sm font-medium transition-colors hover:brightness-125"
                    style={{ color: cat.color }}
                  >
                    {cat.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Quick Links — visible gray, not invisible */}
          <div>
            <h3 className="font-display font-bold text-white text-sm uppercase tracking-wider mb-4">Quick Links</h3>
            <ul className="space-y-2.5">
              <li><a href="/games" className="text-sm text-gray-400 hover:text-white transition-colors">All Games</a></li>
              <li><a href="/about" className="text-sm text-gray-400 hover:text-white transition-colors">About Us</a></li>
              <li><a href="/privacy" className="text-sm text-gray-400 hover:text-white transition-colors">Privacy Policy</a></li>
              <li><a href="/terms" className="text-sm text-gray-400 hover:text-white transition-colors">Terms of Service</a></li>
            </ul>
          </div>

          {/* Contact — readable */}
          <div>
            <h3 className="font-display font-bold text-white text-sm uppercase tracking-wider mb-4">Connect</h3>
            <p className="text-sm text-gray-300 mb-1 font-medium">ForgeFlow Labs</p>
            <p className="text-sm text-gray-400">Dallas, TX</p>
          </div>
        </div>

        {/* Bottom bar — contrasted text */}
        <div className="mt-12 pt-6 border-t border-surface-600/50 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-gray-400">
            &copy; {new Date().getFullYear()} ForgeFlow Labs. All rights reserved.
          </p>
          <p className="text-sm text-gray-500">
            All games are original creations. No affiliation with any referenced franchises.
          </p>
        </div>
      </div>
    </footer>
  );
}
