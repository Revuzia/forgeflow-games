import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { signInWithEmail, signUpWithEmail, signInWithGoogle, signOut, getProfile, getXPProgress, type UserProfile } from "../../lib/auth";
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

  async function handleGoogleSignIn() {
    setLoading(true);
    setError("");
    try {
      await signInWithGoogle();
      // Browser redirects to Google → returns to /auth/callback → resumes session
    } catch (err: any) {
      setError(err.message || "Google sign-in failed");
      setLoading(false);
    }
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

              {/* Google OAuth — primary auth path. Continue with Google = no
                  password to remember, instant sign-in. Email form below is
                  the fallback for users who don't want Google. */}
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 py-2.5 rounded-lg font-semibold text-sm
                           bg-white text-gray-800 hover:bg-gray-100 transition-colors
                           disabled:opacity-50 disabled:cursor-not-allowed mb-4"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </button>

              {/* Divider */}
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-px bg-surface-600/50" />
                <span className="text-xs text-gray-500">or with email</span>
                <div className="flex-1 h-px bg-surface-600/50" />
              </div>

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
