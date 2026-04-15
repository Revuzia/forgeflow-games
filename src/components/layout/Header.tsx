import { useState } from "react";
import { CATEGORIES } from "../../lib/supabase";
import UserMenu from "../auth/UserMenu";

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
    <header className="sticky top-0 z-50 bg-surface-900 border-b border-surface-600/40">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-[84px]">
          {/* Logo — transparent bg, full size */}
          <a href="/" className="flex items-center shrink-0">
            <img
              src="/images/logo.png"
              alt="ForgeFlow Games"
              className="h-[60px] sm:h-[70px] w-auto drop-shadow-[0_2px_10px_rgba(255,136,0,0.4)]"
            />
          </a>

          {/* Desktop Nav — colored pills matching logo palette */}
          <nav className="hidden lg:flex items-center gap-2">
            <a href="/games" className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-surface-700 hover:bg-surface-600 transition-all">
              All Games
            </a>
            {CATEGORIES.map((cat) => (
              <a
                key={cat.slug}
                href={`/category/${cat.slug}`}
                className="px-4 py-2 rounded-lg text-sm font-semibold transition-all hover:scale-105"
                style={{
                  color: cat.color,
                  backgroundColor: cat.color + "15",
                  border: `1px solid ${cat.color}30`,
                }}
              >
                {cat.label}
              </a>
            ))}
          </nav>

          {/* Search — bigger, more visible */}
          <form onSubmit={handleSearch} className="hidden md:flex items-center">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search games..."
                className="w-52 lg:w-72 pl-10 pr-4 py-2.5 rounded-xl bg-surface-800 border border-surface-600/50
                           text-sm text-gray-100 placeholder-gray-500
                           focus:outline-none focus:border-brand-orange/50 focus:ring-2 focus:ring-brand-orange/20
                           transition-all duration-200"
              />
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </form>

          {/* User account menu */}
          <div className="hidden md:block">
            <UserMenu />
          </div>

          {/* Mobile menu button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 rounded-lg text-gray-300 hover:text-white hover:bg-surface-700"
          >
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                className="w-full pl-4 pr-4 py-2.5 rounded-xl bg-surface-800 border border-surface-600/50
                           text-sm text-gray-100 placeholder-gray-500
                           focus:outline-none focus:border-brand-orange/50"
              />
            </form>
            <div className="flex flex-wrap gap-2">
              <a href="/games" className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-surface-700">All Games</a>
              {CATEGORIES.map((cat) => (
                <a
                  key={cat.slug}
                  href={`/category/${cat.slug}`}
                  className="px-4 py-2 rounded-lg text-sm font-semibold"
                  style={{ color: cat.color, backgroundColor: cat.color + "15" }}
                >
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
