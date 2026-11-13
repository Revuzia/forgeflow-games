# Proposed fix: server-authoritative XP and achievement unlocks

STATUS: SHIPPED 2026-10-05. Part A = migrations/0009_unlock_achievement_rpc.sql (applied, self-test 12/12), client change = commit
"portal: unlock achievements + award XP through the server-side unlock_achievement RPC" (deployed to forgeflowgames.com, live bundle verified),
Part B = migrations/0010_lock_profile_xp.sql (applied, self-test 11/11). The migration files are the reviewed + dry-run versions and supersede the
SQL blocks below (those are the original draft). NOT done: Part C (one-off repair of the 1 profile that is 5 XP short; needs the owner's OK) and a
real signed-in end-to-end unlock (needs a real player session).

## 0. What it fixes

| Defect | How the proposal removes it |
|---|---|
| D1 lost update (read-modify-write on `profiles.xp`) | `UPDATE profiles SET xp = xp + gain` is one atomic statement; Postgres row-locks and re-reads under READ COMMITTED, so concurrent unlocks add up |
| D2 duplicate / failed insert still awards XP | XP is added only if `INSERT ... ON CONFLICT DO NOTHING RETURNING id` actually returned a row |
| D3 insert OK but XP never granted | unlock row and XP update run in ONE function call = one transaction; if the profile update finds no row the function raises and the insert rolls back |
| D4 numeric id not scoped to the game | the RPC resolves `(game_id, slug)` only; the bridge drops the numeric-id path (no shipped game sends it) and always passes `currentGameId`. Direct client INSERT on `user_achievements` is revoked so the table cannot be written around the RPC |
| D5 client can write its own xp/level | BEFORE INSERT/UPDATE trigger on `profiles` pins xp/level for API roles (`anon`, `authenticated`); only SECURITY DEFINER code / service_role can change them |

Residual (cannot be fixed server-side): the server cannot know the player really earned an achievement, so a hostile
client can still call `unlock_achievement(any_game_id, any_slug)`. The blast radius is now bounded to the sum of all
achievement points in the table (a fixed, small number), instead of "any number".

## 1. SQL: `supabase/migrations/0009_server_authoritative_xp.sql`

Apply in three separate steps, in this order (see section 3).

```sql
-- ═════════════ PART A (additive, safe any time, apply FIRST) ═════════════
BEGIN;

-- Level curve, mirrors XP_PER_LEVEL in src/lib/auth.ts (levels 1-10 table, 11-50 by formula, cap 50).
CREATE OR REPLACE FUNCTION public.ff_level_from_xp(p_xp integer)
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(max(l), 1)
  FROM generate_series(1, 50) AS l
  WHERE (CASE l
           WHEN 1 THEN 0    WHEN 2 THEN 100  WHEN 3 THEN 250  WHEN 4 THEN 450  WHEN 5 THEN 700
           WHEN 6 THEN 1000 WHEN 7 THEN 1400 WHEN 8 THEN 1900 WHEN 9 THEN 2500 WHEN 10 THEN 3200
           ELSE 3200 + (l - 10) * 500 + (l - 10) * (l - 10) * 50
         END) <= p_xp;
$$;

-- The ONLY way to unlock an achievement and earn its XP.
CREATE OR REPLACE FUNCTION public.unlock_achievement(p_game_id bigint, p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_ach_id bigint;
  v_points integer;
  v_mult   integer;
  v_gain   integer;
  v_row    bigint;
  v_xp     integer;
  v_level  integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  IF p_game_id IS NULL OR p_slug IS NULL OR length(p_slug) > 64 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_args');
  END IF;

  -- scoped to the game the caller names; points come from the table, never from the client
  SELECT a.id, a.points INTO v_ach_id, v_points
    FROM public.achievements a
   WHERE a.game_id = p_game_id AND a.slug = p_slug;
  IF v_ach_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_achievement');
  END IF;

  INSERT INTO public.user_achievements (user_id, achievement_id)
  VALUES (v_uid, v_ach_id)
  ON CONFLICT (user_id, achievement_id) DO NOTHING
  RETURNING id INTO v_row;

  IF v_row IS NULL THEN      -- already unlocked, or a concurrent twin committed first: no XP, not an error
    RETURN jsonb_build_object('ok', true, 'unlocked', false);
  END IF;

  -- Badge of the Day multiplier (UTC date, same as the old client's toISOString().split("T")[0])
  SELECT COALESCE(max(d.bonus_multiplier), 1) INTO v_mult
    FROM public.daily_badge d
   WHERE d.achievement_id = v_ach_id
     AND d.active_date = (now() AT TIME ZONE 'UTC')::date;
  v_gain := v_points * v_mult;

  -- atomic add; RETURNING gives the NEW values
  UPDATE public.profiles p
     SET xp    = p.xp + v_gain,
         level = public.ff_level_from_xp(p.xp + v_gain)
   WHERE p.id = v_uid
  RETURNING p.xp, p.level INTO v_xp, v_level;

  IF v_xp IS NULL THEN       -- no profile row: abort so the unlock row above rolls back too (retryable)
    RAISE EXCEPTION 'no_profile';
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'unlocked', true, 'xp_gained', v_gain, 'xp', v_xp, 'level', v_level,
    'leveled_up', v_level > public.ff_level_from_xp(v_xp - v_gain));
END;
$$;

-- Supabase default privileges grant EXECUTE to PUBLIC/anon on new functions: close that (same pattern as 0008).
REVOKE ALL ON FUNCTION public.unlock_achievement(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unlock_achievement(bigint, text) TO authenticated, service_role;

COMMIT;


-- ═════════════ PART B (lockdown, apply AFTER the client change is live) ═════════════
BEGIN;

-- D5: API roles can no longer set xp/level. SECURITY DEFINER functions run as their owner (postgres) and
-- service_role / the SQL editor run as themselves, so they pass. For a client UPSERT the xp/level it sends
-- are silently ignored (no error), so sign-up and UserMenu's self-heal upsert keep working.
CREATE OR REPLACE FUNCTION public.profiles_protect_xp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.xp := 0;  NEW.level := 1;
    ELSE
      NEW.xp := OLD.xp;  NEW.level := OLD.level;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_xp ON public.profiles;
CREATE TRIGGER profiles_protect_xp
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_protect_xp();

-- D4 / D2 residual: unlocks only through unlock_achievement(). (The old policy let a user insert ANY achievement
-- row for themselves, unscoped to a game.) Nothing else in src/ or pages/ inserts into this table.
DROP POLICY IF EXISTS "user_achievements_owner_insert" ON public.user_achievements;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.user_achievements FROM anon, authenticated;

-- OPTIONAL belt and braces (column privilege instead of the trigger). Only after the client stops sending
-- xp/level in its upserts (included in the diff below), otherwise those upserts fail with 42501:
--   REVOKE UPDATE ON public.profiles FROM anon, authenticated;
--   GRANT  UPDATE (username, avatar_url, is_online, current_game_slug, last_seen_at) ON public.profiles TO authenticated;
-- NOTE: a column-level REVOKE alone does nothing while a table-level UPDATE grant exists; the table-level one must go first.

COMMIT;


-- ═════════════ PART C (optional one-off repair; DRY RUN FIRST; the UPDATE is a bulk state rewrite, needs owner OK) ═════════════
WITH expected AS (
  SELECT ua.user_id,
         sum(a.points * COALESCE(d.bonus_multiplier, 1))::int AS xp_expected
    FROM public.user_achievements ua
    JOIN public.achievements a ON a.id = ua.achievement_id
    LEFT JOIN public.daily_badge d
           ON d.achievement_id = ua.achievement_id
          AND d.active_date = (ua.unlocked_at AT TIME ZONE 'UTC')::date
   GROUP BY ua.user_id
)
SELECT count(*) AS drifting_profiles,
       sum(COALESCE(e.xp_expected, 0) - p.xp) AS total_xp_drift
  FROM public.profiles p
  LEFT JOIN expected e ON e.user_id = p.id
 WHERE p.xp <> COALESCE(e.xp_expected, 0);
-- Print counts only; do not print user ids. If the numbers are what you expect (today: 1 profile, drift +5), repair with:
-- WITH expected AS (...same CTE as above...)
-- UPDATE public.profiles p
--    SET xp = COALESCE(e.xp_expected, 0), level = public.ff_level_from_xp(COALESCE(e.xp_expected, 0))
--   FROM (SELECT p2.id, x.xp_expected FROM public.profiles p2 LEFT JOIN expected x ON x.user_id = p2.id) e
--  WHERE e.id = p.id AND p.xp <> COALESCE(e.xp_expected, 0);   -- run as postgres / service_role (the trigger lets those through)
```

## 2. Client change (generated against the CURRENT working tree; repo untouched)

`forgeflow-games/src/lib/gameBridge.ts`: two functions and the numeric-id branch (about 55 lines) replaced by one
4-line RPC call. `forgeflow-games/src/lib/auth.ts`: `addXP` deleted, the sign-up upsert stops sending xp/level. The same
two-line drop is also wanted in `src/components/auth/UserMenu.tsx:56-62` (upsert with `level: 1, xp: 0`); it is left out
of the diff only because the trigger ignores those fields anyway.

NOTE: the working-tree `auth.ts` already carries another session's UNCOMMITTED edit to `submitScore` (about line 170).
This diff is against that working tree and does not touch that hunk.

The SDK (`public/forgeflow-sdk.js:68-74`) can stay as is: a numeric id is now simply ignored by the bridge.

```diff
--- a/forgeflow-games/src/lib/gameBridge.ts	2026-10-05 18:40:27.298153300 -0500
+++ b/forgeflow-games/src/lib/gameBridge.ts	2026-10-05 18:40:28.134975600 -0500
@@ -32,9 +32,7 @@
 
 import { mergePreservingKeys, REPLACE_MARKER } from "./saveMerge";
 import { supabase } from "./supabase";
-import { addXP, setOnlineStatus, submitScore, addRecentlyPlayed, getCurrentSeasonWeek, getProfile, getLevelFromXP } from "./auth";
-// addXP is still imported because unlockAchievement() inside this file
-// still calls it — that's the ONE remaining XP source by design.
+import { setOnlineStatus, submitScore, addRecentlyPlayed, getCurrentSeasonWeek, getProfile, getLevelFromXP } from "./auth";
 
 /** Games with a stats backend: slug -> server functions (SECURITY DEFINER RPCs on qkid). */
 const GAME_STATS_RPC: Record<string, { run: string; vs: string }> = {
@@ -282,10 +280,10 @@
     case "forgeflow:achievement":
       // Game reports an achievement unlock — by numeric id OR by slug.
       // The SDK prefers slug because games don't know DB ids at build time.
-      if (currentUserId && payload.achievementId) {
-        unlockAchievement(currentUserId, payload.achievementId);
-      } else if (currentUserId && payload.achievementSlug && currentGameId) {
-        unlockAchievementBySlug(currentUserId, currentGameId, payload.achievementSlug);
+      // Slug only, always scoped to the CURRENT game (the old numeric-id path was
+      // unscoped and no shipped game sends it). All XP/unlock logic is server-side.
+      if (currentUserId && currentGameId && typeof payload.achievementSlug === "string") {
+        unlockAchievementBySlug(currentGameId, payload.achievementSlug);
       }
       break;
 
@@ -356,56 +354,12 @@
   }
 }
 
-async function unlockAchievementBySlug(userId: string, gameId: number, slug: string) {
-  const { data } = await supabase
-    .from("achievements")
-    .select("id")
-    .eq("game_id", gameId)
-    .eq("slug", slug)
-    .single();
-  if (data?.id) await unlockAchievement(userId, data.id);
-}
-
-async function unlockAchievement(userId: string, achievementId: number) {
-  // Check if already unlocked
-  const { data: existing } = await supabase
-    .from("user_achievements")
-    .select("id")
-    .eq("user_id", userId)
-    .eq("achievement_id", achievementId)
-    .single();
-
-  if (existing) return; // Already unlocked
-
-  // Get achievement details for XP
-  const { data: ach } = await supabase
-    .from("achievements")
-    .select("points, tier")
-    .eq("id", achievementId)
-    .single();
-
-  if (!ach) return;
-
-  // Check if this is Badge of the Day (2x points)
-  const today = new Date().toISOString().split("T")[0];
-  const { data: daily } = await supabase
-    .from("daily_badge")
-    .select("bonus_multiplier")
-    .eq("achievement_id", achievementId)
-    .eq("active_date", today)
-    .single();
-
-  const multiplier = daily?.bonus_multiplier || 1;
-  const xpGain = ach.points * multiplier;
-
-  // Unlock
-  await supabase.from("user_achievements").insert({
-    user_id: userId,
-    achievement_id: achievementId,
-  });
-
-  // Award XP
-  await addXP(userId, xpGain, `achievement_${achievementId}`);
+// One transaction on the server (0009_server_authoritative_xp.sql): inserts the unlock
+// ON CONFLICT DO NOTHING and adds XP only if a row was really inserted. Idempotent, so
+// a retry or a concurrent duplicate can never double-award, and a failure rolls both back.
+async function unlockAchievementBySlug(gameId: number, slug: string) {
+  const { error } = await supabase.rpc("unlock_achievement", { p_game_id: gameId, p_slug: slug });
+  if (error) console.warn("[bridge] unlock_achievement failed:", error.message);
 }
 
 /**
--- a/forgeflow-games/src/lib/auth.ts	2026-10-05 18:40:27.434360300 -0500
+++ b/forgeflow-games/src/lib/auth.ts	2026-10-05 18:40:28.136002100 -0500
@@ -35,8 +35,6 @@
     await supabase.from("profiles").upsert({
       id: data.user.id,
       username,
-      level: 1,
-      xp: 0,
     });
   }
   return data;
@@ -131,22 +129,6 @@
   };
 }
 
-export async function addXP(userId: string, amount: number, reason: string) {
-  const profile = await getProfile(userId);
-  if (!profile) return;
-
-  const newXP = profile.xp + amount;
-  const oldLevel = getLevelFromXP(profile.xp);
-  const newLevel = getLevelFromXP(newXP);
-
-  await supabase.from("profiles").update({
-    xp: newXP,
-    level: newLevel,
-  }).eq("id", userId);
-
-  return { newXP, newLevel, leveledUp: newLevel > oldLevel };
-}
-
 // ── Online Status ──
 
 export async function setOnlineStatus(userId: string, online: boolean, gameSlug?: string) {
```

## 3. Rollout order (matters)

1. Apply SQL PART A. Purely additive; the old client keeps working exactly as before.
2. Deploy the client change (portal deploys per `reference_forgeflow_games_deploy`: the portal is the forgeflowgames.com
   Pages project). From here every unlock goes through the RPC.
3. Apply SQL PART B only after step 2 is live and a real unlock has been seen to land with the right XP. If B goes first,
   the OLD client's `user_achievements` insert is denied and its `addXP` write is silently pinned by the trigger: unlocks
   are lost until the tab reloads. Stale open tabs after step 3 behave the same way until reload (acceptable, one-time).
4. PART C is optional and needs the owner's explicit OK (bulk state rewrite). Run the SELECT first.
5. Rollback of B: `DROP TRIGGER profiles_protect_xp ON public.profiles;` and re-create the dropped policy
   (`CREATE POLICY "user_achievements_owner_insert" ON public.user_achievements FOR INSERT WITH CHECK (auth.uid() = user_id); GRANT INSERT ON public.user_achievements TO authenticated;`).
   Rollback of A: `DROP FUNCTION public.unlock_achievement(bigint, text); DROP FUNCTION public.ff_level_from_xp(integer);`.

Verification after step 3 (effect, not exit code): sign in as a throwaway test user on the portal, play a game that
fires two unlocks in one tick (Last Circle first win: `first_win` + `five_kill_game`; or BLOCKTOOTH guest-to-signed-in
catch-up), then read the profile with the publishable key: `xp` must equal the sum of both achievements' points, and a
direct `PATCH profiles {xp: 999999}` with that user's JWT must leave xp unchanged. (Both are the account owner's
actions on a test account; this proposal did not perform them.)

## 4. Self-test (run on a branch DB, or as postgres inside a transaction; everything rolls back)

```sql
BEGIN;
DO $$
DECLARE
  u1 uuid := gen_random_uuid();
  g bigint; s1 text; s2 text; p1 int; p2 int;
  r jsonb; x int; ok boolean;
BEGIN
  -- two real seeded achievements from ONE game
  SELECT game_id, min(slug), max(slug) INTO g, s1, s2 FROM public.achievements GROUP BY game_id HAVING count(*) >= 2 LIMIT 1;
  SELECT points INTO p1 FROM public.achievements WHERE game_id = g AND slug = s1;
  SELECT points INTO p2 FROM public.achievements WHERE game_id = g AND slug = s2;

  INSERT INTO auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  VALUES (u1, 'authenticated', 'authenticated', 'xp-selftest-' || u1 || '@invalid.test',
          jsonb_build_object('username', 'xp_selftest_' || left(u1::text, 8)), now(), now());
  INSERT INTO public.profiles (id, username) VALUES (u1, 'xp_selftest_' || left(u1::text, 8)) ON CONFLICT (id) DO NOTHING;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', u1::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- 1. first unlock adds exactly its points
  r := public.unlock_achievement(g, s1);
  SELECT xp INTO x FROM public.profiles WHERE id = u1;
  IF NOT (r->>'unlocked')::boolean OR x <> p1 THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 1: % xp=%', r, x; END IF;
  -- 2. repeat is a no-op (what a concurrent twin looks like after the unique index resolves it)
  r := public.unlock_achievement(g, s1);
  SELECT xp INTO x FROM public.profiles WHERE id = u1;
  IF (r->>'unlocked')::boolean OR x <> p1 THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 2: % xp=%', r, x; END IF;
  -- 3. second, different unlock accumulates
  r := public.unlock_achievement(g, s2);
  SELECT xp INTO x FROM public.profiles WHERE id = u1;
  IF x <> p1 + p2 THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 3: xp=% expected %', x, p1 + p2; END IF;
  -- 4. wrong game for a real slug is refused (D4)
  r := public.unlock_achievement(g + 100000, s1);
  IF coalesce((r->>'ok')::boolean, true) THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 4: %', r; END IF;
  -- 5. direct xp write is pinned (D5; only meaningful after PART B)
  UPDATE public.profiles SET xp = 999999, level = 50 WHERE id = u1;
  SELECT xp INTO x FROM public.profiles WHERE id = u1;
  IF x <> p1 + p2 THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 5: direct write changed xp to %', x; END IF;
  -- 6. direct achievement insert is denied (D4/D2; only meaningful after PART B)
  ok := false;
  BEGIN
    INSERT INTO public.user_achievements (user_id, achievement_id) SELECT u1, id FROM public.achievements LIMIT 1 OFFSET 3;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 6: direct insert allowed'; END IF;

  RAISE EXCEPTION 'XP_SELFTEST_PASS (rolled back on purpose)';
END $$;
ROLLBACK;
```

Concurrency (D1 proper) cannot be shown inside one transaction. Reason: `UPDATE ... SET xp = xp + n` locks the row
and re-evaluates against the committed value, and a second concurrent insert of the same `(user_id, achievement_id)`
blocks on the unique index and then does nothing. To observe it, run the RPC for two different slugs from two psql
sessions at once (or `pgbench -c 8 -f` a script that calls it) against a test user and compare xp with the sum of points.

## 5. Out of scope, noticed on the way (not in this fix)

- Early-boot drop: achievement, score, save and load messages read `currentUserId` synchronously
  (gameBridge.ts:277, 285, 312, 320) but it is only set after `auth.getUser()` resolves (gameBridge.ts:78-81). A post that
  arrives in the first few hundred ms after Play is silently dropped for a signed-in player. Only `whoami` waits on
  `userReady` (gameBridge.ts:343). Fix is a `userReady.then(...)` wrapper on those cases.
- Same class as D5 on other tables: `leaderboard_scores_owner_write/update` (0002_user_accounts.sql:124-134) and
  `user_game_activity` owner write (0003:142-147) let a client write any score / play stat for itself directly.
- Bridge source check (gameBridge.ts:263-265) accepts any `<iframe>` on the page and does not check `event.origin`. Fine
  today (one game iframe, GamePlayer.tsx:167) but a future ad iframe would be accepted as a game.
- `public/forgeflow-sdk.js:76` still says `levelComplete` "grants 5 XP"; the bridge grants none (gameBridge.ts:292-301).
- The body of `seed_game_achievements` is not in the repo (0005_registry_service_writes.sql:10, 58-59), so it could not
  be audited. It is service_role-only after 0005.
