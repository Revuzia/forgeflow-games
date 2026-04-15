import { CATEGORIES } from "../../lib/supabase";

export default function Footer() {
  return (
    <footer className="bg-surface-800/50 border-t border-surface-600/30 mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="md:col-span-1">
            <a href="/" className="flex items-center gap-2 mb-4">
              <img src="/images/logo.png" alt="ForgeFlow Games" className="h-10 w-auto" />
            </a>
            <p className="text-sm text-surface-500 leading-relaxed">
              Premium browser games for everyone. No downloads, no signups. Just play.
            </p>
          </div>

          {/* Categories */}
          <div>
            <h3 className="font-display font-semibold text-gray-200 mb-3">Categories</h3>
            <ul className="space-y-2">
              {CATEGORIES.map((cat) => (
                <li key={cat.slug}>
                  <a href={`/category/${cat.slug}`} className="text-sm text-surface-500 hover:text-brand-blue transition-colors">
                    {cat.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="font-display font-semibold text-gray-200 mb-3">Quick Links</h3>
            <ul className="space-y-2">
              <li><a href="/games" className="text-sm text-surface-500 hover:text-brand-blue transition-colors">All Games</a></li>
              <li><a href="/about" className="text-sm text-surface-500 hover:text-brand-blue transition-colors">About Us</a></li>
              <li><a href="/privacy" className="text-sm text-surface-500 hover:text-brand-blue transition-colors">Privacy Policy</a></li>
              <li><a href="/terms" className="text-sm text-surface-500 hover:text-brand-blue transition-colors">Terms of Service</a></li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="font-display font-semibold text-gray-200 mb-3">Connect</h3>
            <p className="text-sm text-surface-500 mb-2">Made by ForgeFlow Labs</p>
            <p className="text-sm text-surface-500">Dallas, TX</p>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-surface-600/30 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-surface-500">
            &copy; {new Date().getFullYear()} ForgeFlow Labs. All rights reserved.
          </p>
          <p className="text-xs text-surface-500">
            All games are original creations. No affiliation with any referenced franchises.
          </p>
        </div>
      </div>
    </footer>
  );
}
