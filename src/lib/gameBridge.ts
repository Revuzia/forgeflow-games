/**
 * Game-to-Portal PostMessage Bridge
 *
 * Games in iframes send messages to the portal. The portal handles:
 * - Score submission to leaderboards
 * - Achievement unlocking
 * - Play time tracking for XP
 * - Cloud save sync
 * - Online status ("currently playing X")
 *
 * Games send: window.parent.postMessage({ type: "forgeflow:...", ... }, "*")
 * Portal listens and routes to the appropriate Supabase table.
 *
 * 2026-10-01 — identity + per-game stats messages (BLOCKTOOTH online, Phase A).
 * All additive: a game that never sends them sees no change.
 *   forgeflow:whoami {_reqId}
 *     -> forgeflow:identity {_reqId, signedIn, id, username, avatar_url, level}
 *        (no token ever crosses into the iframe). The portal also PUSHES an
 *        unsolicited forgeflow:identity (no _reqId) to the game frame whenever
 *        the player signs in or out after Play, so a mid-game sign-in starts
 *        filing scores/achievements/saves without a page reload.
 *   forgeflow:run_result {payload, _reqId}
 *     -> rpc <GAME_STATS_RPC[slug].run>({p: payload})
 *     -> forgeflow:run_result_ack {_reqId, ok, data | error}
 *   forgeflow:vs_result {payload, _reqId}
 *     -> rpc <GAME_STATS_RPC[slug].vs>({p: payload})
 *     -> forgeflow:vs_result_ack {_reqId, ok, data | error}
 *   Only slugs listed in GAME_STATS_RPC are routed; for every other game the
 *   two stats messages are ignored. A guest gets an ack with
 *   {ok:false, error:"not_signed_in"} so the game never waits on it.
 *
 * 2026-10-05 (Part 2) - leaderboard scores and play activity are SERVER-written only; a player never writes them:
 *   forgeflow:score / level_complete / game_over -> rpc submit_score (keep-highest per season)
 *   Play start + a 120 s ticker -> rpc record_play 'start' / 'tick' (the server times it; the client sends no seconds)
 *   Every handler that needs the player waits for the Play-time auth read (userReady) first, so a message posted in
 *   the first few hundred ms after Play is no longer dropped for a signed-in player.
 */

import { mergePreservingKeys, REPLACE_MARKER } from "./saveMerge";
import { supabase } from "./supabase";
import { setOnlineStatus, submitScore, addRecentlyPlayed, getCurrentSeasonWeek, getProfile, getLevelFromXP } from "./auth";

/** Games with a stats backend: slug -> server functions (SECURITY DEFINER RPCs on qkid). */
const GAME_STATS_RPC: Record<string, { run: string; vs: string }> = {
  blocktooth: { run: "bt_submit_run", vs: "bt_report_vs" },
};

let currentUserId: string | null = null;
let currentGameId: number | null = null;
let currentGameSlug: string | null = null;
let playStartTime: number | null = null;
let playTimeInterval: ReturnType<typeof setInterval> | null = null;
const ACTIVITY_TICK_MS = 120_000; // how often a signed-in Play pings record_play('tick')
// Bumped by every init/destroy. A callback that outlives its Play (slow getUser, late timer) compares and stands down.
let playSeq = 0;
// Users whose record_play('start') already went out in THIS Play: play_count counts Plays, not sign-ins.
const startedFor = new Set<string>();
// Resolves once the first auth read after Play has landed, so a forgeflow:whoami
// that arrives early is not answered "signed out" for a signed-in player.
let userReady: Promise<void> = Promise.resolve();
let authReadDone = false;
let authSub: { unsubscribe: () => void } | null = null;
let identityCache: { userId: string; username: string | null; avatar_url: string | null; level: number } | null = null;

export function initGameBridge(gameSlug: string, gameId: number) {
  currentGameSlug = gameSlug;
  currentGameId = gameId;
  playStartTime = Date.now();
  const seq = ++playSeq;
  startedFor.clear();
  stopActivityTicker(); // init without a destroy in between: never leave the previous Play's ticker running

  // Track recently played (works for guests too)
  addRecentlyPlayed(gameSlug);

  // Sign-in / sign-out AFTER Play (the user used to be read once, here, and a
  // player who signed in mid-game filed nothing until a reload). The callback
  // defers its work: supabase-js warns against awaiting other client calls
  // inside onAuthStateChange. INITIAL_SESSION / TOKEN_REFRESHED carry the same
  // user id and are no-ops through the id comparison in applyAuthUser.
  if (authSub) authSub.unsubscribe();
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    const nextId = session?.user?.id ?? null;
    setTimeout(() => applyAuthUser(nextId), 0);
  });
  authSub = subscription;

  // Get user for authenticated features
  authReadDone = false;
  userReady = supabase.auth.getUser().then(({ data: { user } }) => {
    if (seq !== playSeq) return; // this Play was torn down (or replaced) while the read was in flight
    if (user) {
      if (currentUserId !== user.id) identityCache = null;
      currentUserId = user.id;
      setOnlineStatus(user.id, true, gameSlug);

      // Log the Play IMMEDIATELY (record_play 'start') so even a quick play leaves a
      // row for "Recently Played" and the leaderboards; the ticker then adds play time.
      startPlay(user.id);
    } else {
      currentUserId = null; // signed out since an earlier Play in this tab
    }
  }).catch(() => { /* auth read failed: stay a guest; the listener can still sign us in */ })
    .finally(() => { if (seq === playSeq) authReadDone = true; });

  // Listen for messages from game iframe
  window.addEventListener("message", handleGameMessage);
}

/**
 * Auth changed after Play. Only acts when the user id really changes: sets the
 * id every handler keys on, refreshes online status + the activity row, and
 * pushes a fresh forgeflow:identity to the game frame (if one has talked to us).
 */
function applyAuthUser(nextId: string | null) {
  // Before the Play-time getUser() lands, it owns the first read (avoids a
  // duplicate online/activity write from INITIAL_SESSION on every Play).
  if (!authReadDone) return;
  if (nextId === currentUserId) return;
  if (currentGameId == null) return; // bridge torn down
  currentUserId = nextId;
  identityCache = null;
  if (nextId) {
    setOnlineStatus(nextId, true, currentGameSlug ?? undefined);
    startPlay(nextId);
  } else {
    stopActivityTicker(); // signed out: nothing to record (and no session to record it with) until someone signs in
  }
  pushIdentity();
}

// 2026-05-06 — XP comes ONLY from earned achievements now. Previously
// we credited 1 XP per 5 minutes of play time, which made the user
// level up while their achievements page still showed 0/71 earned.
// The two now stay in lockstep: total XP === sum of achievement
// points the user has unlocked. Activity row is still refreshed
// for "Recently Played" tracking — just no XP side-effect.
function startActivityTicker() {
  stopActivityTicker(); // one interval at a time: a sign-in change can never leave a second one counting
  const seq = playSeq;
  const timer = setInterval(() => {
    if (seq !== playSeq) { clearInterval(timer); return; } // outlived its Play
    if (currentUserId) void recordPlay("tick");
  }, ACTIVITY_TICK_MS);
  playTimeInterval = timer;
}

function stopActivityTicker() {
  if (playTimeInterval) { clearInterval(playTimeInterval); playTimeInterval = null; }
}

// The signed-in user is now known for this Play: send 'start' once per user per Play, then keep the ticker going.
function startPlay(userId: string) {
  if (!startedFor.has(userId)) {
    startedFor.add(userId);
    void recordPlay("start");
  }
  startActivityTicker();
}

/**
 * Play activity is written by the SERVER (public.record_play, 0011): 'start' = a new Play (play_count + 1, row
 * created if needed), 'tick' = the server adds the seconds since the last event from its own clock. The client
 * never reports seconds. Awaited, error-logged, never throws.
 */
async function recordPlay(event: "start" | "tick"): Promise<void> {
  const gameId = currentGameId;
  if (gameId == null) return;
  try {
    const { data, error } = await supabase.rpc("record_play", { p_game_id: gameId, p_event: event });
    if (error) console.warn("[bridge] record_play failed:", error.message);
    else if (data && (data as { ok?: boolean }).ok === false) console.warn("[bridge] record_play refused:", (data as { error?: string }).error);
  } catch (e) {
    console.warn("[bridge] record_play threw:", e);
  }
}

async function buildIdentity(): Promise<Record<string, unknown>> {
  const uid = currentUserId;
  if (!uid) return { signedIn: false, id: null, username: null, avatar_url: null, level: null };
  if (!identityCache || identityCache.userId !== uid) {
    const p = await getProfile(uid);
    identityCache = {
      userId: uid,
      username: p?.username ?? null,
      avatar_url: p?.avatar_url ?? null,
      level: p ? getLevelFromXP(p.xp || 0) : 1,
    };
  }
  if (currentUserId !== uid) return buildIdentity(); // auth flipped mid-read
  return { signedIn: true, id: uid, username: identityCache.username, avatar_url: identityCache.avatar_url, level: identityCache.level };
}

function replyToGame(msg: Record<string, unknown>) {
  if (gameFrame?.contentWindow) gameFrame.contentWindow.postMessage(msg, gameFrameOrigin);
}

function pushIdentity() {
  if (!gameFrame) return; // no frame has spoken yet; it will ask with forgeflow:whoami
  buildIdentity().then((id) => replyToGame({ type: "forgeflow:identity", ...id }));
}

/**
 * Call a stats RPC. Idempotent server-side (run_nonce / match_id), so a retry
 * can never double-count: transient failures (network, 429, 5xx) retry with
 * 1s/2s/4s backoff; anything else (400/401/403/validation) returns at once.
 */
async function callStatsRpc(fn: string, p: unknown): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const delays = [1000, 2000, 4000];
  for (let attempt = 0; ; attempt++) {
    let status = 0;
    let errMsg = "";
    try {
      const res = await supabase.rpc(fn, { p });
      status = res.status;
      if (!res.error) return { ok: true, data: res.data };
      errMsg = res.error.message || res.error.code || "rpc_error";
    } catch (e) {
      errMsg = String((e as Error)?.message || e);
    }
    const transient = status === 0 || status === 429 || status >= 500;
    if (!transient || attempt >= delays.length) return { ok: false, error: errMsg };
    await new Promise((r) => setTimeout(r, delays[attempt]));
  }
}

function handleStatsMessage(kind: "run" | "vs", payload: Record<string, any>) {
  const ackType = kind === "run" ? "forgeflow:run_result_ack" : "forgeflow:vs_result_ack";
  const rpc = currentGameSlug ? GAME_STATS_RPC[currentGameSlug] : undefined;
  if (!rpc) return; // not a stats game: ignore entirely (other games unaffected)
  const reqId = payload._reqId;
  const body = payload.payload;
  // Capture the replying frame now; a later message from another frame must
  // not redirect this ack.
  const frame = gameFrame;
  const origin = gameFrameOrigin;
  const ack = (r: Record<string, unknown>) => {
    if (frame?.contentWindow) frame.contentWindow.postMessage({ type: ackType, _reqId: reqId, ...r }, origin);
  };
  if (!body || typeof body !== "object") { ack({ ok: false, error: "bad_payload", data: { error: "bad_payload" } }); return; }
  userReady.then(() => {
    if (!currentUserId) { ack({ ok: false, error: "not_signed_in", data: { error: "not_signed_in" } }); return; }
    // Failure acks carry the error both top-level and as data.error (the
    // game reads data.*), success acks carry the RPC's jsonb as data.
    // The RPC itself reports a rejected run as HTTP 200 {ok:false, error, reason}
    // (0008_blocktooth_stats.sql); mirror that in the top-level ok.
    callStatsRpc(kind === "run" ? rpc.run : rpc.vs, body).then((r) => {
      if (!r.ok) { ack({ ok: false, error: r.error, data: { error: r.error } }); return; }
      const d = r.data as any;
      if (d && typeof d === "object" && d.ok === false) ack({ ok: false, error: String(d.error || "rejected"), data: d });
      else ack({ ok: true, data: d });
    });
  });
}

export function destroyGameBridge() {
  window.removeEventListener("message", handleGameMessage);
  playSeq++; // anything still in flight from this Play (getUser, a queued message, a timer) now stands down
  stopActivityTicker();
  if (authSub) { authSub.unsubscribe(); authSub = null; }

  // Set offline
  if (currentUserId) {
    setOnlineStatus(currentUserId, true, null); // Still online, just not in a game
  }

  currentGameSlug = null;
  currentGameId = null;
  playStartTime = null;
}

/**
 * Run fn for the signed-in player once this Play's auth read has landed. getUser() after Play takes a few hundred
 * ms and a game posts its first score / achievement / save much sooner: reading currentUserId synchronously used to
 * drop those silently. Callbacks queue on the one userReady promise, so order per message type is preserved; a
 * guest (no user) or a Play that was torn down meanwhile writes nothing and throws nothing. The game id is the one
 * current when the message ARRIVED, so a message can never be filed under a different game.
 */
function whenSignedIn(fn: (userId: string, gameId: number) => void) {
  const seq = playSeq;
  const gameId = currentGameId;
  if (gameId == null) return;
  userReady.then(() => {
    if (seq !== playSeq || !currentUserId) return;
    fn(currentUserId, gameId);
  });
}

// The iframe the current message actually came from — remembered so replies
// (forgeflow:save_loaded) go back to the REAL sender, not whatever iframe
// happens to be first in the DOM.
let gameFrame: HTMLIFrameElement | null = null;
let gameFrameOrigin = "*";

function handleGameMessage(event: MessageEvent) {
  if (!event.data || typeof event.data !== "object" || !event.data.type) return;
  if (!event.data.type.startsWith("forgeflow:")) return;
  // SOURCE CHECK: only accept bridge messages from an iframe actually embedded
  // in this page. Without this, any window able to postMessage here (an
  // opened popup, an injected frame elsewhere) could submit scores, unlock
  // achievements, or overwrite cloud saves for the signed-in user.
  const frames = Array.from(document.querySelectorAll("iframe"));
  const src = frames.find((f) => f.contentWindow === event.source);
  if (!src) return;
  gameFrame = src;
  gameFrameOrigin = event.origin || "*";

  const { type, ...payload } = event.data;
  // scores are validated as finite numbers, not truthiness — a legitimate
  // score of exactly 0 was silently discarded before
  const numScore = typeof payload.score === "number" && isFinite(payload.score) ? payload.score : null;

  switch (type) {
    case "forgeflow:score":
      // Game reports a score for the leaderboard (the server keeps the highest per season)
      if (numScore != null) whenSignedIn((_uid, gameId) => { submitScore(gameId, numScore); });
      break;

    case "forgeflow:achievement":
      // Game reports an achievement unlock — by numeric id OR by slug.
      // The SDK prefers slug because games don't know DB ids at build time.
      // Slug only, always scoped to the CURRENT game (the old numeric-id path was
      // unscoped and no shipped game sends it). All XP/unlock logic is server-side.
      if (typeof payload.achievementSlug === "string") {
        const slug: string = payload.achievementSlug;
        whenSignedIn((_uid, gameId) => { unlockAchievementBySlug(gameId, slug); });
      }
      break;

    case "forgeflow:level_complete":
      // Level completed — submit score to leaderboards. Good time for an
      // interstitial ad. NO direct XP grant: XP only flows from earned
      // achievements (by design). Games that want XP for "completed level N"
      // should declare it as an achievement (`level_5`, `world_1` etc.) and
      // grant it via ForgeFlow.unlockAchievement().
      if (numScore != null) whenSignedIn((_uid, gameId) => { submitScore(gameId, numScore); });
      break;

    case "forgeflow:game_over":
      // Game over — submit final score (0 is legitimate)
      if (numScore != null) whenSignedIn((_uid, gameId) => { submitScore(gameId, numScore); });
      break;

    case "forgeflow:save":
      // Cloud save
      if (payload.data) {
        const saveData = payload.data;
        const saveSlot = payload.slot || 1;
        whenSignedIn((uid, gameId) => { saveGameData(uid, gameId, saveData, saveSlot); });
      }
      break;

    case "forgeflow:load": {
      // Load cloud save — respond back to game. Echo _reqId so the SDK can
      // correlate concurrent loads to their Promise resolvers.
      const reqId = payload._reqId;
      const loadSlot = payload.slot || 1;
      // reply to the frame the request actually CAME from, at its origin —
      // the first-iframe-in-DOM + "*" pair could hand a save payload to
      // the wrong embed. Captured now: the reply may run after a later message.
      const frame = gameFrame;
      const origin = gameFrameOrigin;
      whenSignedIn((uid, gameId) => {
        loadGameData(uid, gameId, loadSlot).then(data => {
          if (frame?.contentWindow) {
            frame.contentWindow.postMessage({
              type: "forgeflow:save_loaded",
              data,
              _reqId: reqId,
            }, origin);
          }
        });
      });
      break;
    }

    case "forgeflow:whoami": {
      // Who is signed in — display data only (nameplates, "sign in to save").
      // Answered for guests too ({signedIn:false}).
      const reqId = payload._reqId;
      const frame = gameFrame;
      const origin = gameFrameOrigin;
      userReady.then(() => buildIdentity()).then((id) => {
        if (frame?.contentWindow) frame.contentWindow.postMessage({ type: "forgeflow:identity", _reqId: reqId, ...id }, origin);
      });
      break;
    }

    case "forgeflow:run_result":
      handleStatsMessage("run", payload);
      break;

    case "forgeflow:vs_result":
      handleStatsMessage("vs", payload);
      break;
  }
}

// One transaction on the server (0009_server_authoritative_xp.sql): inserts the unlock
// ON CONFLICT DO NOTHING and adds XP only if a row was really inserted. Idempotent, so
// a retry or a concurrent duplicate can never double-award, and a failure rolls both back.
async function unlockAchievementBySlug(gameId: number, slug: string) {
  const { data, error } = await supabase.rpc("unlock_achievement", { p_game_id: gameId, p_slug: slug });
  if (error) console.warn("[bridge] unlock_achievement failed:", error.message);
  else if (data && (data as { ok?: boolean }).ok === false) console.warn("[bridge] unlock_achievement refused:", (data as { error?: string }).error);
}

/**
 * Write a cloud save WITHOUT ever losing what is already there.
 *
 * This used to be a bare upsert, i.e. blind replacement: whatever a game sent
 * became the record. A signed-in Ascendant player lost every unlock that way —
 * the game's read of the account timed out on a post-deploy cold boot, it then
 * pushed a fresh browser's snapshot, and the four cleared stages it did not
 * know about were simply gone. The game-side hole is fixed too (portalsync now
 * refuses to push before a successful read), but that is one game. This is the
 * guarantee for EVERY game, including ones not written yet: a save merges, so
 * a thin or stale payload can no longer delete progress.
 *
 * A game that genuinely means "wipe it" — a Reset Progress button — sends
 * `__replace: true` and gets the old behaviour, minus the marker.
 */
async function saveGameData(userId: string, gameId: number, data: any, slot: number) {
  let next = data;

  if (data && typeof data === "object" && (data as any)[REPLACE_MARKER] === true) {
    next = { ...(data as any) };
    delete (next as any)[REPLACE_MARKER];
  } else {
    // Read-modify-write. A failed read must NOT downgrade this to a blind
    // replace: if we cannot see the current record we are not entitled to
    // overwrite it, so the safe move is to leave it alone.
    const { data: row, error } = await supabase
      .from("game_saves")
      .select("save_data")
      .eq("user_id", userId)
      .eq("game_id", gameId)
      .eq("slot", slot)
      .maybeSingle();
    if (error) return;
    next = mergePreservingKeys(row?.save_data, data);
  }

  await supabase.from("game_saves").upsert({
    user_id: userId,
    game_id: gameId,
    save_data: next,
    slot,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,game_id,slot" });
}

async function loadGameData(userId: string, gameId: number, slot: number): Promise<any> {
  const { data } = await supabase
    .from("game_saves")
    .select("save_data")
    .eq("user_id", userId)
    .eq("game_id", gameId)
    .eq("slot", slot)
    .single();
  return data?.save_data || null;
}
