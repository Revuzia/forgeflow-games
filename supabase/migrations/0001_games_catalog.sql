-- ForgeFlow Games catalog — pipeline inserts a row per deployed game.
-- Apply once via Supabase Dashboard → SQL Editor, or via supabase CLI:
--   supabase db execute < 0001_games_catalog.sql
--
-- Columns mirror what scripts/run_game_pipeline.py phase_deploy writes:
--   title, slug (unique), description, short_description, genre, sub_genre,
--   game_url, controls_keyboard, difficulty, tags (text array), status.

CREATE TABLE IF NOT EXISTS public.games (
  id                 bigserial PRIMARY KEY,
  slug               text UNIQUE NOT NULL,
  title              text NOT NULL,
  description        text,
  short_description  text,
  genre              text,
  sub_genre          text,
  game_url           text,
  controls_keyboard  text,
  difficulty         text,
  tags               text[] DEFAULT '{}',
  status             text DEFAULT 'draft',
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS games_slug_idx    ON public.games (slug);
CREATE INDEX IF NOT EXISTS games_status_idx  ON public.games (status);
CREATE INDEX IF NOT EXISTS games_genre_idx   ON public.games (genre);
CREATE INDEX IF NOT EXISTS games_created_idx ON public.games (created_at DESC);

-- RLS: service_role (used by the pipeline) bypasses policies. For the anon
-- role (used by public read-only consumers), we only expose published games.
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read published games" ON public.games;
CREATE POLICY "Public can read published games"
  ON public.games FOR SELECT
  USING (status = 'published');

-- Optional telemetry table used by shared/analytics.js. Events are batched
-- and inserted via anon key; RLS allows anon INSERT but not SELECT/UPDATE.
CREATE TABLE IF NOT EXISTS public.game_events (
  id          bigserial PRIMARY KEY,
  game_slug   text NOT NULL,
  session_id  text,
  event       text NOT NULL,
  payload     jsonb,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS game_events_slug_idx   ON public.game_events (game_slug);
CREATE INDEX IF NOT EXISTS game_events_event_idx  ON public.game_events (event);
CREATE INDEX IF NOT EXISTS game_events_created_idx ON public.game_events (created_at DESC);

ALTER TABLE public.game_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon can insert telemetry" ON public.game_events;
CREATE POLICY "Anon can insert telemetry"
  ON public.game_events FOR INSERT
  WITH CHECK (true);

-- Upsert-on-slug trigger so phase_deploy re-runs overwrite instead of duplicating.
CREATE OR REPLACE FUNCTION public.games_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS games_touch_updated_at ON public.games;
CREATE TRIGGER games_touch_updated_at
  BEFORE UPDATE ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.games_touch_updated_at();
