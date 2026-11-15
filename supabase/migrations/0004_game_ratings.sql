-- ForgeFlow Games — per-game WIN/LOSS ratings + chess ELO ranking
-- Apply via Supabase Dashboard → SQL Editor (paste this whole file and Run).
--
-- 2026-06-01: games need a win/loss record on the player's profile, and chess needs
-- a proper rank-up system. This adds:
--   • public.game_ratings  — one row per (user, game): Elo rating, peak, W/L/D, games.
--   • public.match_results — an audit/idempotency log so a match is counted ONCE even
--                            if both clients report it.
--   • report_match_result()— a SECURITY DEFINER RPC that computes Elo for BOTH players
--                            and updates everything atomically. Clients can't write the
--                            tables directly (RLS = read-only); only this function can.
--
-- RATING MODEL (Elo, FIDE-style): start 1200. E = 1/(1+10^((Ropp-Rme)/400)).
-- R' = R + K*(S-E), S = 1 win / 0.5 draw / 0 loss. K = 40 while provisional (<30 games),
-- 20 under 2100, 10 at 2100+. Ratings change ONLY from online games vs another player.

-- ── RATINGS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.game_ratings (
  user_id        uuid    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  game_slug      text    NOT NULL,
  rating         integer NOT NULL DEFAULT 1200,
  peak_rating    integer NOT NULL DEFAULT 1200,
  wins           integer NOT NULL DEFAULT 0,
  losses         integer NOT NULL DEFAULT 0,
  draws          integer NOT NULL DEFAULT 0,
  games_played   integer NOT NULL DEFAULT 0,
  last_played_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_slug)
);
CREATE INDEX IF NOT EXISTS idx_game_ratings_leaderboard ON public.game_ratings (game_slug, rating DESC);

ALTER TABLE public.game_ratings ENABLE ROW LEVEL SECURITY;
-- Public read (leaderboards / profile cards). NO insert/update policy → direct writes
-- are denied; only the SECURITY DEFINER function below may mutate ratings.
DROP POLICY IF EXISTS "game_ratings_public_read" ON public.game_ratings;
CREATE POLICY "game_ratings_public_read" ON public.game_ratings FOR SELECT USING (true);

-- ── MATCH LOG (idempotency + audit) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.match_results (
  match_id    text PRIMARY KEY,          -- deterministic per match (slug:room:nonce)
  game_slug   text NOT NULL,
  white_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  black_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  result      text NOT NULL CHECK (result IN ('white','black','draw')),
  white_before integer, white_after integer,
  black_before integer, black_after integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_match_results_white ON public.match_results (white_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_results_black ON public.match_results (black_id, created_at DESC);
ALTER TABLE public.match_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "match_results_public_read" ON public.match_results;
CREATE POLICY "match_results_public_read" ON public.match_results FOR SELECT USING (true);

-- ── ELO REPORTER ────────────────────────────────────────────────────────────
-- Records ONE online result and updates both players' Elo + W/L. Idempotent by
-- match_id. Caller must be one of the two players (anti-spam). Returns the deltas.
CREATE OR REPLACE FUNCTION public.report_match_result(
  p_game text, p_white uuid, p_black uuid, p_result text, p_match_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ra integer; rb integer; ga integer; gb integer;
  ea double precision; sw double precision; sb double precision;
  ka integer; kb integer; na integer; nb integer;
  existing public.match_results%ROWTYPE;
BEGIN
  -- validate
  IF p_white = p_black THEN RAISE EXCEPTION 'players must differ'; END IF;
  IF p_result NOT IN ('white','black','draw') THEN RAISE EXCEPTION 'bad result'; END IF;
  IF auth.uid() IS NULL OR auth.uid() NOT IN (p_white, p_black) THEN
    RAISE EXCEPTION 'reporter must be a participant';
  END IF;

  -- idempotent: if this match was already recorded, return it unchanged
  SELECT * INTO existing FROM public.match_results WHERE match_id = p_match_id;
  IF FOUND THEN
    RETURN jsonb_build_object('already', true,
      'white', jsonb_build_object('before', existing.white_before, 'after', existing.white_after),
      'black', jsonb_build_object('before', existing.black_before, 'after', existing.black_after));
  END IF;

  -- ensure both rating rows exist (default 1200)
  INSERT INTO public.game_ratings (user_id, game_slug) VALUES (p_white, p_game)
    ON CONFLICT (user_id, game_slug) DO NOTHING;
  INSERT INTO public.game_ratings (user_id, game_slug) VALUES (p_black, p_game)
    ON CONFLICT (user_id, game_slug) DO NOTHING;

  SELECT rating, games_played INTO ra, ga FROM public.game_ratings WHERE user_id = p_white AND game_slug = p_game FOR UPDATE;
  SELECT rating, games_played INTO rb, gb FROM public.game_ratings WHERE user_id = p_black AND game_slug = p_game FOR UPDATE;

  -- Elo
  ea := 1.0 / (1.0 + power(10.0, (rb - ra) / 400.0));   -- white's expected score
  sw := CASE p_result WHEN 'white' THEN 1.0 WHEN 'draw' THEN 0.5 ELSE 0.0 END;
  sb := 1.0 - sw;
  ka := CASE WHEN ga < 30 THEN 40 WHEN ra < 2100 THEN 20 ELSE 10 END;
  kb := CASE WHEN gb < 30 THEN 40 WHEN rb < 2100 THEN 20 ELSE 10 END;
  na := round(ra + ka * (sw - ea));
  nb := round(rb + kb * (sb - (1.0 - ea)));

  UPDATE public.game_ratings SET
    rating = na, peak_rating = greatest(peak_rating, na), games_played = games_played + 1,
    wins   = wins   + (CASE WHEN p_result = 'white' THEN 1 ELSE 0 END),
    losses = losses + (CASE WHEN p_result = 'black' THEN 1 ELSE 0 END),
    draws  = draws  + (CASE WHEN p_result = 'draw'  THEN 1 ELSE 0 END),
    last_played_at = now()
  WHERE user_id = p_white AND game_slug = p_game;

  UPDATE public.game_ratings SET
    rating = nb, peak_rating = greatest(peak_rating, nb), games_played = games_played + 1,
    wins   = wins   + (CASE WHEN p_result = 'black' THEN 1 ELSE 0 END),
    losses = losses + (CASE WHEN p_result = 'white' THEN 1 ELSE 0 END),
    draws  = draws  + (CASE WHEN p_result = 'draw'  THEN 1 ELSE 0 END),
    last_played_at = now()
  WHERE user_id = p_black AND game_slug = p_game;

  -- mirror games_played onto the profile total (best-effort)
  UPDATE public.profiles SET games_played = games_played + 1 WHERE id IN (p_white, p_black);

  INSERT INTO public.match_results (match_id, game_slug, white_id, black_id, result,
    white_before, white_after, black_before, black_after)
  VALUES (p_match_id, p_game, p_white, p_black, p_result, ra, na, rb, nb);

  RETURN jsonb_build_object('already', false,
    'white', jsonb_build_object('before', ra, 'after', na, 'delta', na - ra),
    'black', jsonb_build_object('before', rb, 'after', nb, 'delta', nb - rb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.report_match_result(text, uuid, uuid, text, text) TO anon, authenticated;

-- ── (optional) convenience: a per-game leaderboard view joining usernames ───
CREATE OR REPLACE VIEW public.game_leaderboard AS
  SELECT gr.game_slug, gr.rating, gr.peak_rating, gr.wins, gr.losses, gr.draws,
         gr.games_played, p.username, p.avatar_url, gr.user_id
  FROM public.game_ratings gr JOIN public.profiles p ON p.id = gr.user_id
  ORDER BY gr.game_slug, gr.rating DESC;
GRANT SELECT ON public.game_leaderboard TO anon, authenticated;
