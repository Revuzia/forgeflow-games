-- ForgeFlow Games — registry writes are service_role-only (2026-07-07)
--
-- WHY: the live project carried three ad-hoc permissive policies (added via
-- dashboard, never in a migration file) that turned the PUBLISHABLE key —
-- shipped in every game/site bundle — into a write credential:
--   games."Anon insert"                       INSERT with_check=true
--   games."Anon update"                       UPDATE using=true  <- anyone could deface/unpublish the whole catalog
--   achievements."Anon insert achievements"   INSERT with_check=true
--   daily_badge."Anon insert daily_badge"     INSERT with_check=true  <- self-grantable XP bonus_multiplier
-- plus seed_game_achievements() (SECURITY DEFINER, bypasses RLS) executable by anon.
--
-- Writers moved to the service key the same day (one unit with this migration):
--   scripts/run_game_pipeline.py       registry upsert + seed RPC (macro repo)
--   pipeline/deploy_game.py            insert_game_metadata (this repo; also covers
--                                      deploy_engine_game/deploy_portal/engine_game_* importers)
--   client-portal admin-game-publish   already on FFG_SERVICE_ROLE_KEY Pages secret
--
-- READS ARE UNCHANGED: games keeps a read-all SELECT policy — the portal games
-- panel lists unpublished rows with the publishable key, and forgeflowgames.com
-- filters status='published' client-side (useGames / prerender).
--
-- UNTOUCHED BY DESIGN: game_events (anon INSERT = telemetry), owner-scoped user
-- tables (game_saves, user_achievements, user_game_activity, friendships,
-- leaderboard_scores, profiles — auth.uid() policies), game_ratings/match_results
-- (mutated only via report_match_result definer RPC), find_users/played_leaderboards.

BEGIN;

-- ── games: registry is pipeline/portal-owned ────────────────────────────────
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anon insert" ON public.games;
DROP POLICY IF EXISTS "Anon update" ON public.games;
-- Normalize to ONE read-all policy (0001 shipped published-only; production
-- needs unpublished rows visible to the portal panel's publishable-key read).
DROP POLICY IF EXISTS "Public can read published games" ON public.games;
DROP POLICY IF EXISTS "Public read access" ON public.games;
CREATE POLICY "Public read access" ON public.games FOR SELECT USING (true);

-- ── achievements: definitions seeded by the pipeline only ───────────────────
ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anon insert achievements" ON public.achievements;
-- dedupe doubled read policy (keep 0003's achievements_public_read)
DROP POLICY IF EXISTS "Public read achievements" ON public.achievements;

-- ── daily_badge: zero client writers exist in the codebase ──────────────────
ALTER TABLE public.daily_badge ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anon insert daily_badge" ON public.daily_badge;
-- dedupe doubled read policy (keep 0003's daily_badge_public_read)
DROP POLICY IF EXISTS "Public read daily_badge" ON public.daily_badge;

-- ── belt & braces: revoke write privileges so PostgREST answers an explicit
--    401/403 (42501) instead of an RLS-silent 0-row 200 ───────────────────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.games        FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.achievements FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.daily_badge  FROM anon, authenticated;

-- ── seed RPC: service_role-only (was anon-executable, bypassing RLS) ─────────
REVOKE EXECUTE ON FUNCTION public.seed_game_achievements(bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.seed_game_achievements(bigint, jsonb) TO service_role;

COMMIT;
