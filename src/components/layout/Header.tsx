import { useState } from "react";
import { CATEGORIES } from "../../lib/supabase";

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      window.location.href = `/search?q=${encodeURIComponent(searchQuery.trim())}`;
    }
  };

  return (
    <header className="sticky top-0 z-50 bg-surface-900/95 backdrop-blur-md border-b border-surface-600/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <a href="/" className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-blue to-brand-green flex items-center justify-center">
              <span className="text-surface-900 font-display font-bold text-sm">FF</span>
            </div>
            <span className="font-display font-bold text-xl hidden sm:block">
              <span className="text-brand-blue">Forge</span>
              <span className="text-brand-green">Flow</span>
              <span className="text-gray-300 ml-1">Games</span>
            </span>
          </a>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-1">
            <a href="/games" className="category-pill">All Games</a>
            {CATEGORIES.map((cat) => (
              <a
                key={cat.slug}
                href={`/category/${cat.slug}`}
                className="category-pill"
                style={{ "--hover-color": cat.color } as React.CSSProperties}
              >
                {cat.label}
              </a>
            ))}
          </nav>

          {/* Search */}
          <form onSubmit={handleSearch} className="hidden md:flex items-center">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search games..."
                className="w-48 lg:w-64 pl-10 pr-4 py-2 rounded-lg bg-surface-800 border border-surface-600/50
                           text-sm text-gray-200 placeholder-surface-500
                           focus:outline-none focus:border-brand-blue/50 focus:ring-1 focus:ring-brand-blue/30
                           transition-all duration-200"
              />
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </form>

          {/* Mobile menu button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-surface-800"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden pb-4 animate-slide-up">
            <form onSubmit={handleSearch} className="mb-3">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search games..."
                className="w-full pl-4 pr-4 py-2.5 rounded-lg bg-surface-800 border border-surface-600/50
                           text-sm text-gray-200 placeholder-surface-500
                           focus:outline-none focus:border-brand-blue/50"
              />
            </form>
            <div className="flex flex-wrap gap-2">
              <a href="/games" className="category-pill">All Games</a>
              {CATEGORIES.map((cat) => (
                <a key={cat.slug} href={`/category/${cat.slug}`} className="category-pill">
                  {cat.label}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
