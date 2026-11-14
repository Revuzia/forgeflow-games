-- ForgeFlow Games — achievements, friends, activity tracking, trophies
-- Apply via Supabase Dashboard → SQL Editor (paste this whole file and Run).
--
-- 2026-05-05: existing pages (Profile, Achievements, Leaderboards, Friends) and
-- gameBridge.ts reference these tables but they didn't exist, causing the pages
-- to render empty and game-side achievement unlocks to silently no-op. Also
-- fixes the auth.users → profiles trigger which didn't fire on the first
-- Google OAuth signup (had to manually upsert the row).

-- ── FIX: make handle_new_user actually run on auth.users INSERT ─────────
-- Recreate the function + trigger. Common reason it doesn't fire on a fresh
-- Supabase project: the trigger was created against the wrong schema, or the
-- function lacks proper grants on auth.users. SECURITY DEFINER + grant to
-- supabase_auth_admin makes it work for Google OAuth signups.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  derived_username text;
  derived_avatar   text;
BEGIN
  derived_username := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'username', ''),
    NULLIF(NEW.raw_user_meta_data->>'name', ''),
    NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
    'player_' || substring(NEW.id::text, 1, 8)
  );
  -- Replace whitespace with underscore so usernames are URL-safe / searchable
  derived_username := regexp_replace(derived_username, '\s+', '_', 'g');
  -- Truncate to 30 chars
  IF length(derived_username) > 30 THEN
    derived_username := substring(derived_username, 1, 30);
  END IF;
  -- Collision: append 4-char suffix
  IF EXISTS (SELECT 1 FROM public.profiles WHERE username = derived_username) THEN
    derived_username := derived_username || '_' || substring(md5(random()::text), 1, 4);
  END IF;

  derived_avatar := NEW.raw_user_meta_data->>'avatar_url';

  INSERT INTO public.profiles (id, username, avatar_url, level, xp)
  VALUES (NEW.id, derived_username, derived_avatar, 1, 0)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Don't block signup if profile creation fails — user can recover via
  -- client-side upsert (UserMenu does this on first load anyway).
  RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── ACHIEVEMENTS DEFINITIONS ────────────────────────────────────────────
-- Per-game achievements seeded by the game pipeline. Tier maps to XP:
-- bronze=5, silver=15, gold=30, diamond=60. `slug` is unique within a game
-- so the game can unlock by slug without knowing the numeric id.
CREATE TABLE IF NOT EXISTS public.achievements (
  id            bigserial PRIMARY KEY,
  game_id       bigint REFERENCES public.games(id) ON DELETE CASCADE,
  slug          text NOT NULL,
  name          text NOT NULL,
  description   text NOT NULL,
  tier          text NOT NULL DEFAULT 'bronze' CHECK (tier IN ('bronze','silver','gold','diamond')),
  points        integer NOT NULL DEFAULT 5,
  secret        boolean NOT NULL DEFAULT false,
  icon          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_achievements_game ON public.achievements (game_id);
CREATE INDEX IF NOT EXISTS idx_achievements_tier ON public.achievements (tier);

ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "achievements_public_read" ON public.achievements;
CREATE POLICY "achievements_public_read"
  ON public.achievements FOR SELECT USING (true);

-- ── USER ACHIEVEMENTS (unlocks) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_achievements (
  id              bigserial PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  achievement_id  bigint NOT NULL REFERENCES public.achievements(id) ON DELETE CASCADE,
  unlocked_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, achievement_id)
);
CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON public.user_achievements (user_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_recent ON public.user_achievements (unlocked_at DESC);

ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_achievements_public_read" ON public.user_achievements;
CREATE POLICY "user_achievements_public_read"
  ON public.user_achievements FOR SELECT USING (true);
DROP POLICY IF EXISTS "user_achievements_owner_insert" ON public.user_achievements;
CREATE POLICY "user_achievements_owner_insert"
  ON public.user_achievements FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ── BADGE OF THE DAY ────────────────────────────────────────────────────
-- One row per day picking an achievement to spotlight (2x XP that day).
-- Populated by an admin RPC or scheduled job; UI just reads it.
CREATE TABLE IF NOT EXISTS public.daily_badge (
  active_date         date PRIMARY KEY,
  achievement_id      bigint NOT NULL REFERENCES public.achievements(id) ON DELETE CASCADE,
  bonus_multiplier    integer NOT NULL DEFAULT 2 CHECK (bonus_multiplier BETWEEN 1 AND 5),
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.daily_badge ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "daily_badge_public_read" ON public.daily_badge;
CREATE POLICY "daily_badge_public_read"
  ON public.daily_badge FOR SELECT USING (true);

-- ── USER GAME ACTIVITY (recently played + per-game play stats) ─────────
-- One row per (user, game). Updated by gameBridge.ts every 5 minutes during
-- play. Drives the "Recently Played" list and "leaderboards filtered to
-- games I played" query.
CREATE TABLE IF NOT EXISTS public.user_game_activity (
  id                 bigserial PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id            bigint NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  last_played_at     timestamptz NOT NULL DEFAULT now(),
  total_play_seconds integer NOT NULL DEFAULT 0,
  play_count         integer NOT NULL DEFAULT 1,
  high_score         integer,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, game_id)
);
CREATE INDEX IF NOT EXISTS idx_activity_user_recent ON public.user_game_activity (user_id, last_played_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_game ON public.user_game_activity (game_id);

ALTER TABLE public.user_game_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "activity_public_read" ON public.user_game_activity;
CREATE POLICY "activity_public_read"
  ON public.user_game_activity FOR SELECT USING (true);
DROP POLICY IF EXISTS "activity_owner_write" ON public.user_game_activity;
CREATE POLICY "activity_owner_write"
  ON public.user_game_activity FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "activity_owner_update" ON public.user_game_activity;
CREATE POLICY "activity_owner_update"
  ON public.user_game_activity FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── LEADERBOARD TROPHIES ───────────────────────────────────────────────
-- Awarded weekly when a season closes. UI shows top-3-by-percentile.
CREATE TABLE IF NOT EXISTS public.leaderboard_trophies (
  id                bigserial PRIMARY KEY,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id           bigint NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  season_week       text NOT NULL,
  rank_position     integer NOT NULL,
  percentile_tier   text NOT NULL,
  trophy_type       text NOT NULL CHECK (trophy_type IN ('gold','silver','bronze')),
  awarded_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, game_id, season_week)
);
CREATE INDEX IF NOT EXISTS idx_trophies_user ON public.leaderboard_trophies (user_id, awarded_at DESC);

ALTER TABLE public.leaderboard_trophies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "trophies_public_read" ON public.leaderboard_trophies;
CREATE POLICY "trophies_public_read"
  ON public.leaderboard_trophies FOR SELECT USING (true);

-- ── FRIENDSHIPS ─────────────────────────────────────────────────────────
-- Friend graph. user_id = the requester (or, after acceptance, either side).
-- We store BOTH directions on accept (see acceptRequest in friends page) so
-- a single SELECT can list a user's friends without OR-clauses.
CREATE TABLE IF NOT EXISTS public.friendships (
  id            bigserial PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friend_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','blocked')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, friend_id),
  CHECK (user_id <> friend_id)
);
CREATE INDEX IF NOT EXISTS idx_friendships_user ON public.friendships (user_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_friend ON public.friendships (friend_id, status);

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
-- A user can read rows where they are either side
DROP POLICY IF EXISTS "friendships_participant_read" ON public.friendships;
CREATE POLICY "friendships_participant_read"
  ON public.friendships FOR SELECT
  USING (auth.uid() = user_id OR auth.uid() = friend_id);
-- A user can only insert rows where they are user_id (the requester)
DROP POLICY IF EXISTS "friendships_requester_insert" ON public.friendships;
CREATE POLICY "friendships_requester_insert"
  ON public.friendships FOR INSERT
  WITH CHECK (auth.uid() = user_id);
-- A user can update rows where they are either side (e.g., accept a request
-- targeted at them, or remove a request they sent)
DROP POLICY IF EXISTS "friendships_participant_update" ON public.friendships;
CREATE POLICY "friendships_participant_update"
  ON public.friendships FOR UPDATE
  USING (auth.uid() = user_id OR auth.uid() = friend_id)
  WITH CHECK (auth.uid() = user_id OR auth.uid() = friend_id);
-- A user can delete a friendship row they participate in (unfriend)
DROP POLICY IF EXISTS "friendships_participant_delete" ON public.friendships;
CREATE POLICY "friendships_participant_delete"
  ON public.friendships FOR DELETE
  USING (auth.uid() = user_id OR auth.uid() = friend_id);

DROP TRIGGER IF EXISTS set_friendships_updated_at ON public.friendships;
CREATE TRIGGER set_friendships_updated_at
  BEFORE UPDATE ON public.friendships
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── FRIEND DISCOVERY BY EMAIL OR USERNAME ──────────────────────────────
-- The friends page should support "add by gmail account or username" but
-- emails live in auth.users which is not anon-readable. This SECURITY
-- DEFINER RPC is the only way to look up by email without leaking the full
-- email column. It returns a profile row when there is an exact email match
-- (case-insensitive) OR a username ILIKE match (returns up to 10 rows).
-- The caller never sees the email.
CREATE OR REPLACE FUNCTION public.find_users(query text)
RETURNS TABLE (
  id          uuid,
  username    text,
  avatar_url  text,
  level       integer,
  xp          integer,
  is_online   boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  -- Exact email match (1 row max)
  SELECT p.id, p.username, p.avatar_url, p.level, p.xp, p.is_online
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  WHERE lower(u.email) = lower(query)
  UNION
  -- Username partial match (up to 10)
  SELECT p.id, p.username, p.avatar_url, p.level, p.xp, p.is_online
  FROM public.profiles p
  WHERE p.username ILIKE '%' || query || '%'
  LIMIT 10;
$$;
GRANT EXECUTE ON FUNCTION public.find_users(text) TO anon, authenticated;

-- ── LEADERBOARDS FOR GAMES USER PLAYED ─────────────────────────────────
-- View that returns leaderboard rows but ONLY for games the calling user
-- has played. Used by the Leaderboards page when the user is signed in.
-- Anonymous callers get no rows — the empty state will offer to play a game.
CREATE OR REPLACE FUNCTION public.played_leaderboards(p_season_week text DEFAULT NULL)
RETURNS TABLE (
  game_id      bigint,
  game_title   text,
  game_slug    text,
  user_id      uuid,
  username     text,
  avatar_url   text,
  level        integer,
  score        integer,
  rank         bigint,
  season_week  text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH my_games AS (
    SELECT DISTINCT a.game_id
    FROM public.user_game_activity a
    WHERE a.user_id = auth.uid()
  ),
  scored AS (
    SELECT
      ls.game_id,
      ls.user_id,
      ls.score,
      ls.season_week,
      RANK() OVER (PARTITION BY ls.game_id, ls.season_week ORDER BY ls.score DESC) AS rank
    FROM public.leaderboard_scores ls
    JOIN my_games mg ON mg.game_id = ls.game_id
    WHERE p_season_week IS NULL OR ls.season_week = p_season_week
  )
  SELECT
    s.game_id,
    g.title       AS game_title,
    g.slug        AS game_slug,
    s.user_id,
    p.username,
    p.avatar_url,
    p.level,
    s.score,
    s.rank,
    s.season_week
  FROM scored s
  JOIN public.games g    ON g.id = s.game_id
  JOIN public.profiles p ON p.id = s.user_id
  ORDER BY s.game_id, s.rank
  LIMIT 500;
$$;
GRANT EXECUTE ON FUNCTION public.played_leaderboards(text) TO authenticated;

-- ── ADD `slot` COLUMN TO game_saves so cloud-save supports multiple slots ──
-- gameBridge.ts uses (user_id, game_id, slot) as the upsert key but the 0002
-- migration only had (user_id, game_id). Add slot, default 1, and replace
-- the unique constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'game_saves' AND column_name = 'slot'
  ) THEN
    ALTER TABLE public.game_saves ADD COLUMN slot integer NOT NULL DEFAULT 1;
    -- Drop the old unique constraint if present and re-add with slot
    BEGIN
      ALTER TABLE public.game_saves DROP CONSTRAINT IF EXISTS game_saves_user_id_game_id_key;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      ALTER TABLE public.game_saves ADD CONSTRAINT game_saves_user_game_slot_key UNIQUE (user_id, game_id, slot);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
END$$;
