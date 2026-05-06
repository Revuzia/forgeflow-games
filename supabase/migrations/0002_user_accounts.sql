-- ForgeFlow Games — user accounts + profiles + leaderboards
-- Apply via Supabase Dashboard → SQL Editor (paste this whole file and Run).
--
-- 2026-05-05: previously the auth code (src/lib/auth.ts) referenced
-- `public.profiles` and `public.leaderboard_scores` but neither table existed,
-- so signUpWithEmail crashed silently on the upsert and Google OAuth had
-- nowhere to land. This migration creates both tables with RLS so users can
-- only read/write their own rows.

-- ── PROFILES ────────────────────────────────────────────────────────────
-- One row per Supabase auth user. Trigger below auto-creates a profile when
-- a new user signs up via auth.users so we never have a logged-in user
-- without a profile.
CREATE TABLE IF NOT EXISTS public.profiles (
  id                       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username                 text UNIQUE,
  avatar_url               text,
  level                    integer NOT NULL DEFAULT 1,
  xp                       integer NOT NULL DEFAULT 0,
  total_play_time_seconds  bigint NOT NULL DEFAULT 0,
  games_played             integer NOT NULL DEFAULT 0,
  is_online                boolean NOT NULL DEFAULT false,
  current_game_slug        text,
  last_seen_at             timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_username      ON public.profiles (username);
CREATE INDEX IF NOT EXISTS idx_profiles_xp_level      ON public.profiles (xp DESC, level DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_online        ON public.profiles (is_online) WHERE is_online = true;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Anyone can read profiles (public game leaderboards / friend lists)
DROP POLICY IF EXISTS "profiles_public_read" ON public.profiles;
CREATE POLICY "profiles_public_read"
  ON public.profiles FOR SELECT
  USING (true);

-- Users can only update their own profile
DROP POLICY IF EXISTS "profiles_owner_update" ON public.profiles;
CREATE POLICY "profiles_owner_update"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Users can insert their own profile (sign-up path, even though the trigger
-- below usually does it)
DROP POLICY IF EXISTS "profiles_owner_insert" ON public.profiles;
CREATE POLICY "profiles_owner_insert"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ── AUTO-CREATE PROFILE ON SIGNUP ───────────────────────────────────────
-- Trigger fires when auth.users gets a new row (email signup OR Google OAuth)
-- and creates a matching profiles row. Username defaults to the email-name
-- prefix if user_metadata.username isn't set.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  derived_username text;
BEGIN
  -- Prefer metadata username (from email signup), fall back to email-name,
  -- final fallback "player_<short uuid>"
  derived_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1),
    'player_' || substring(NEW.id::text, 1, 8)
  );
  -- Username collision: append a 4-char random suffix
  IF EXISTS (SELECT 1 FROM public.profiles WHERE username = derived_username) THEN
    derived_username := derived_username || '_' || substring(md5(random()::text), 1, 4);
  END IF;

  INSERT INTO public.profiles (id, username, avatar_url, level, xp)
  VALUES (
    NEW.id,
    derived_username,
    NEW.raw_user_meta_data->>'avatar_url',
    1,
    0
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── LEADERBOARD SCORES ──────────────────────────────────────────────────
-- One row per (user, game, season-week). UPSERT-able so re-submission keeps
-- the highest score.
CREATE TABLE IF NOT EXISTS public.leaderboard_scores (
  id            bigserial PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id       bigint NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  score         integer NOT NULL,
  season_week   text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, game_id, season_week)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_game_season  ON public.leaderboard_scores (game_id, season_week, score DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboard_user         ON public.leaderboard_scores (user_id);

ALTER TABLE public.leaderboard_scores ENABLE ROW LEVEL SECURITY;

-- Anyone can read leaderboards
DROP POLICY IF EXISTS "leaderboard_public_read" ON public.leaderboard_scores;
CREATE POLICY "leaderboard_public_read"
  ON public.leaderboard_scores FOR SELECT
  USING (true);

-- Users can only insert/update their own scores
DROP POLICY IF EXISTS "leaderboard_owner_write" ON public.leaderboard_scores;
CREATE POLICY "leaderboard_owner_write"
  ON public.leaderboard_scores FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "leaderboard_owner_update" ON public.leaderboard_scores;
CREATE POLICY "leaderboard_owner_update"
  ON public.leaderboard_scores FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── PER-GAME SAVE STATE (optional but useful) ──────────────────────────
-- For games like Vector Storm that want to persist progress beyond a single
-- score (e.g., max wave reached, weapons unlocked, settings).
CREATE TABLE IF NOT EXISTS public.game_saves (
  id            bigserial PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id       bigint NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  save_data     jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, game_id)
);

ALTER TABLE public.game_saves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "game_saves_owner_all" ON public.game_saves;
CREATE POLICY "game_saves_owner_all"
  ON public.game_saves FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── TOUCH updated_at ON UPDATE ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;
CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_leaderboard_updated_at ON public.leaderboard_scores;
CREATE TRIGGER set_leaderboard_updated_at
  BEFORE UPDATE ON public.leaderboard_scores
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_game_saves_updated_at ON public.game_saves;
CREATE TRIGGER set_game_saves_updated_at
  BEFORE UPDATE ON public.game_saves
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
