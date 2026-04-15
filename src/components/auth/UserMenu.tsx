import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { signInWithEmail, signUpWithEmail, signOut, getProfile, getXPProgress, type UserProfile } from "../../lib/auth";
import type { User } from "@supabase/supabase-js";

export default function UserMenu() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Check current session
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      if (user) loadProfile(user.id);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) loadProfile(session.user.id);
      else setProfile(null);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(userId: string) {
    const p = await getProfile(userId);
    setProfile(p);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (isSignUp) {
        await signUpWithEmail(email, password, username);
      } else {
        await signInWithEmail(email, password);
      }
      setShowModal(false);
      setEmail(""); setPassword(""); setUsername("");
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    }
    setLoading(false);
  }

  async function handleSignOut() {
    await signOut();
    setShowDropdown(false);
  }

  // Not signed in — show Sign In button
  if (!user) {
    return (
      <>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-brand-orange to-[#ff5500] text-white hover:opacity-90 transition-opacity"
        >
          Sign In
        </button>

        {/* Auth Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowModal(false)}>
            <div className="bg-surface-800 rounded-2xl border border-surface-600/50 p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
              <h2 className="font-display font-bold text-xl text-white mb-1">
                {isSignUp ? "Create Account" : "Sign In"}
              </h2>
              <p className="text-sm text-gray-400 mb-5">
                {isSignUp ? "Join ForgeFlow Games — save progress, compete on leaderboards!" : "Welcome back!"}
              </p>

              {error && (
                <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2 text-sm text-red-300 mb-4">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-3">
                {isSignUp && (
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="Username"
                    required
                    className="w-full px-4 py-2.5 rounded-lg bg-surface-900 border border-surface-600/50 text-gray-100 text-sm
                               placeholder-gray-500 focus:outline-none focus:border-brand-orange/50"
                  />
                )}
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="Email"
                  required
                  className="w-full px-4 py-2.5 rounded-lg bg-surface-900 border border-surface-600/50 text-gray-100 text-sm
                             placeholder-gray-500 focus:outline-none focus:border-brand-orange/50"
                />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Password"
                  required
                  minLength={6}
                  className="w-full px-4 py-2.5 rounded-lg bg-surface-900 border border-surface-600/50 text-gray-100 text-sm
                             placeholder-gray-500 focus:outline-none focus:border-brand-orange/50"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 rounded-lg font-semibold text-sm text-white
                             bg-gradient-to-r from-brand-orange to-[#ff5500] hover:opacity-90 transition-opacity
                             disabled:opacity-50"
                >
                  {loading ? "..." : isSignUp ? "Create Account" : "Sign In"}
                </button>
              </form>

              <div className="mt-4 text-center">
                <button
                  onClick={() => { setIsSignUp(!isSignUp); setError(""); }}
                  className="text-sm text-gray-400 hover:text-brand-orange transition-colors"
                >
                  {isSignUp ? "Already have an account? Sign In" : "New here? Create Account"}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // Signed in — show user avatar + dropdown
  const xpInfo = profile ? getXPProgress(profile.xp) : { level: 1, current: 0, needed: 100, percent: 0 };

  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-800 border border-surface-600/30
                   hover:border-brand-orange/40 transition-all"
      >
        {/* Level badge */}
        <span className="w-6 h-6 rounded-full bg-gradient-to-br from-brand-orange to-[#ff5500] flex items-center justify-center text-[10px] font-bold text-white">
          {xpInfo.level}
        </span>
        <span className="text-sm text-gray-200 font-medium max-w-[100px] truncate">
          {profile?.username || user.email?.split("@")[0] || "Player"}
        </span>
        <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {showDropdown && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
          <div className="absolute right-0 top-full mt-2 w-64 bg-surface-800 border border-surface-600/50 rounded-xl shadow-xl z-50 overflow-hidden">
            {/* Profile summary */}
            <div className="p-4 border-b border-surface-600/30">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-orange to-[#ff5500] flex items-center justify-center text-lg font-bold text-white">
                  {xpInfo.level}
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{profile?.username || "Player"}</p>
                  <p className="text-xs text-gray-400">Level {xpInfo.level}</p>
                </div>
              </div>
              {/* XP bar */}
              <div className="w-full h-2 bg-surface-900 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand-orange to-[#ff5500] transition-all duration-500"
                  style={{ width: `${xpInfo.percent}%` }}
                />
              </div>
              <p className="text-[10px] text-gray-500 mt-1">{xpInfo.current}/{xpInfo.needed} XP to Level {xpInfo.level + 1}</p>
            </div>

            {/* Menu items */}
            <div className="py-1">
              <a href="/profile" className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-300 hover:bg-surface-700 hover:text-white transition-colors">
                <span>Profile</span>
              </a>
              <a href="/achievements" className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-300 hover:bg-surface-700 hover:text-white transition-colors">
                <span>Achievements</span>
              </a>
              <a href="/leaderboards" className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-300 hover:bg-surface-700 hover:text-white transition-colors">
                <span>Leaderboards</span>
              </a>
              <a href="/friends" className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-300 hover:bg-surface-700 hover:text-white transition-colors">
                <span>Friends</span>
              </a>
            </div>

            <div className="border-t border-surface-600/30 py-1">
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-400 hover:bg-surface-700 transition-colors text-left"
              >
                Sign Out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
