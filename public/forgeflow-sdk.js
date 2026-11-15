/**
 * ForgeFlow Games — Game SDK (loaded inside game iframes)
 *
 * Games include this once, then call:
 *   ForgeFlow.submitScore(1234)
 *   ForgeFlow.unlockAchievement("first_kill")    // or a numeric id
 *   ForgeFlow.levelComplete(score)
 *   ForgeFlow.gameOver(score)
 *   ForgeFlow.save({ wave: 7, weapons: [...] }, slot=1)
 *   await ForgeFlow.load(slot=1)
 *   ForgeFlow.ads.requestAd("midgame" | "rewarded", { adStarted, adFinished, adError })
 *
 * Behavior:
 *   - Outside the portal iframe (top===self), all calls become no-ops + a
 *     console.info so games still run standalone (e.g., direct R2 URL).
 *   - Inside the iframe, sends a postMessage to the portal — gameBridge.ts
 *     handles routing to Supabase.
 *
 * Drop in via: <script src="https://forgeflowgames.com/forgeflow-sdk.js"></script>
 */
(function () {
  "use strict";
  var inIframe = (function () { try { return window.top !== window.self; } catch (e) { return true; } })();
  var pendingLoads = {};
  var loadCounter = 0;

  function send(type, payload) {
    if (!inIframe) {
      console.info("[ForgeFlow SDK] standalone — skipping " + type, payload);
      return false;
    }
    try {
      window.parent.postMessage(Object.assign({ type: "forgeflow:" + type }, payload || {}), "*");
      return true;
    } catch (e) {
      console.warn("[ForgeFlow SDK] postMessage failed", e);
      return false;
    }
  }

  // Listen for save_loaded responses from the portal
  if (inIframe) {
    window.addEventListener("message", function (ev) {
      if (!ev.data || typeof ev.data !== "object") return;
      if (ev.data.type === "forgeflow:save_loaded" && typeof ev.data._reqId === "string") {
        var resolver = pendingLoads[ev.data._reqId];
        if (resolver) {
          resolver(ev.data.data || null);
          delete pendingLoads[ev.data._reqId];
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // ADS - a CrazyGames-shaped API on top of Google's AdSense H5 Games Ads
  // (the Ad Placement API, adBreak()).
  //
  //   ForgeFlow.ads.requestAd("midgame", { adStarted, adFinished, adError })
  //   ForgeFlow.ads.requestAd("rewarded", { adStarted, adFinished, adError })
  //
  // The game owns pause + mute: pause and mute in adStarted, resume in
  // adFinished OR adError. Grant a rewarded item ONLY in adFinished.
  // adError(code) codes: "adsDisabled" (the shipped state), "adCooldown",
  // "unfilled", "dismissed" (rewarded skipped), "adBusy", "adblock", "other".
  // An error is NEVER fatal - the game must simply carry on.
  //
  // WHY THIS LIVES HERE: Google requires the ad tag and every API call to be in the
  // SAME document as the game canvas ("if you add a game as an iFrame into a
  // larger page, the tag and all of the calls to the API should be made from within
  // that iFrame"), so the portal page cannot serve these; the SDK, which already
  // runs inside every game that opts in, does.
  //
  // PACING follows CrazyGames' published rules: at most ONE midgame ad per 3
  // minutes, none during the first 3 minutes after load, no midgame straight
  // after a rewarded ad, rewarded ads time-limited and always optional.
  //
  // INERT BY DEFAULT: public/ads-config.json ships with ads off. While off, this
  // loads nothing from Google and requestAd() answers adError("adsDisabled") at
  // once. Standalone (outside the portal iframe) it is also off.
  var CONFIG_URL = "https://forgeflowgames.com/ads-config.json";
  var ADS_TIMEOUT_MS = 15000;
  var adsState = { loadedAt: Date.now(), lastAdAt: 0, lastRewardedAt: 0, showing: false, scriptReady: false, scriptFailed: false };
  var adsCfgPromise = null;

  function adsConfig() {
    if (adsCfgPromise) return adsCfgPromise;
    adsCfgPromise = new Promise(function (resolve) {
      // test hook: honoured on localhost only
      try {
        if (window.__FFG_ADS_CONFIG__ && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
          return resolve(window.__FFG_ADS_CONFIG__);
        }
      } catch (e) { /* fall through */ }
      try {
        fetch(CONFIG_URL, { cache: "no-cache" })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) { resolve(j); })
          .catch(function () { resolve(null); });
      } catch (e) { resolve(null); }
    });
    return adsCfgPromise;
  }

  // Loads Google's tag once and installs the documented adBreak/adConfig shim.
  function adsEnsureScript(cfg, cb) {
    if (adsState.scriptReady) return cb(true);
    if (adsState.scriptFailed) return cb(false);
    window.adsbygoogle = window.adsbygoogle || [];
    if (typeof window.adBreak !== "function") {
      window.adBreak = window.adConfig = function (o) { window.adsbygoogle.push(o); };
    }
    if (document.querySelector('script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]')) {
      adsState.scriptReady = true;
      return cb(true);
    }
    var el = document.createElement("script");
    el.async = true;
    el.crossOrigin = "anonymous";
    el.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(cfg.publisherId);
    if (cfg.inGame && cfg.inGame.testMode) el.setAttribute("data-adbreak-test", "on");
    el.onerror = function () { adsState.scriptFailed = true; cb(false); };
    el.onload = function () { adsState.scriptReady = true; cb(true); };
    document.head.appendChild(el);
  }

  // A configured 0 must mean 0. `x || default` silently turned an explicit
  // "no grace period" into 180 seconds.
  function secs(v, dflt) { return (typeof v === "number" && isFinite(v) && v >= 0) ? v : dflt; }

  function adsStatusToCode(status) {
    switch (status) {
      case "frequencyCapped": return "adCooldown";
      case "notReady": case "timeout": case "noAdPreloaded": return "unfilled";
      case "dismissed": return "dismissed";
      default: return "other";
    }
  }

  function requestAd(type, callbacks) {
    var cb = callbacks || {};
    var done = false;
    var started = false;
    // OWNERSHIP of the single "an ad is in flight" slot. Only the request that
    // claimed it may release it: otherwise rejecting a second caller with
    // "adBusy" would clear the flag the FIRST caller still holds.
    var owns = false;
    function release() { if (owns) { owns = false; adsState.showing = false; } }
    function safe(fn, arg) { try { if (typeof fn === "function") fn(arg); } catch (e) { console.warn("[ForgeFlow ads] callback threw", e); } }
    function fail(code) {
      if (done) return; done = true;
      release();
      safe(cb.adError, code);
    }
    function finish() {
      if (done) return; done = true;
      release();
      var now = Date.now();
      adsState.lastAdAt = now;
      if (type === "rewarded") adsState.lastRewardedAt = now;
      safe(cb.adFinished);
    }

    if (type !== "midgame" && type !== "rewarded") return fail("other");
    if (!inIframe) return fail("adsDisabled");
    if (adsState.showing) return fail("adBusy");
    // Claim the slot SYNCHRONOUSLY, before the async config fetch — two calls in
    // the same tick must not both get through.
    adsState.showing = true; owns = true;

    adsConfig().then(function (cfg) {
      if (done) return;
      if (!cfg || cfg.enabled !== true || !cfg.inGame || cfg.inGame.enabled !== true ||
          !/^ca-pub-\d{10,20}$/.test(String(cfg.publisherId || ""))) return fail("adsDisabled");

      var now = Date.now();
      var c = cfg.inGame;
      if (type === "midgame") {
        if (now - adsState.loadedAt < secs(c.startGraceSeconds, 180) * 1000) return fail("adCooldown");
        if (adsState.lastAdAt && now - adsState.lastAdAt < secs(c.midgameCooldownSeconds, 180) * 1000) return fail("adCooldown");
      } else if (adsState.lastRewardedAt && now - adsState.lastRewardedAt < secs(c.rewardedCooldownSeconds, 60) * 1000) {
        return fail("adCooldown");
      }

      var guard = setTimeout(function () { fail("other"); }, ADS_TIMEOUT_MS);
      var clear = function () { clearTimeout(guard); };

      adsEnsureScript(cfg, function (ok) {
        if (done) return clear();
        if (!ok) { clear(); return fail("adblock"); }
        var viewed = false;
        function onBefore() { started = true; clearTimeout(guard); safe(cb.adStarted); }
        try {
          if (type === "midgame") {
            window.adBreak({
              type: (cb.placement || "next"),
              name: cb.name || "midgame",
              beforeAd: onBefore,
              afterAd: function () { clear(); finish(); },
              adBreakDone: function (info) {
                clear();
                if (!started) fail(adsStatusToCode(info && info.breakStatus));
              }
            });
          } else {
            window.adBreak({
              type: "reward",
              name: cb.name || "reward",
              beforeReward: function (showAdFn) { try { showAdFn(); } catch (e) { clear(); fail("other"); } },
              beforeAd: onBefore,
              adViewed: function () { viewed = true; },
              adDismissed: function () { viewed = false; },
              afterAd: function () { clear(); if (viewed) finish(); else fail("dismissed"); },
              adBreakDone: function (info) {
                clear();
                if (!started) fail(adsStatusToCode(info && info.breakStatus));
              }
            });
          }
        } catch (e) { clear(); fail("other"); }
      });
    });
  }

  var adsApi = {
    requestAd: requestAd,
    /** Tell the ad layer whether the game is currently playing sound. */
    setSound: function (on) {
      try { if (typeof window.adConfig === "function") window.adConfig({ sound: on ? "on" : "off" }); } catch (e) { /* ignore */ }
    },
    /** Read-only snapshot, for debugging and tests. */
    state: function () {
      return { showing: adsState.showing, lastAdAt: adsState.lastAdAt, lastRewardedAt: adsState.lastRewardedAt, loadedAt: adsState.loadedAt };
    },
  };

  var ForgeFlow = {
    /** True when running inside the ForgeFlow Games portal iframe. */
    isHosted: inIframe,

    /** Midgame / rewarded ads - see the ADS block above. Off until ads-config.json enables it. */
    ads: adsApi,

    /** Submit a score for the current week's leaderboard. */
    submitScore: function (score) {
      if (typeof score !== "number" || !isFinite(score)) return false;
      return send("score", { score: Math.floor(score) });
    },

    /**
     * Unlock an achievement. Pass either the numeric DB id or the slug
     * (preferred — the portal looks it up by (game_id, slug)).
     */
    unlockAchievement: function (idOrSlug) {
      if (idOrSlug == null) return false;
      var payload = typeof idOrSlug === "number"
        ? { achievementId: idOrSlug }
        : { achievementSlug: String(idOrSlug) };
      return send("achievement", payload);
    },

    /** Convenience for "level done" — also submits the score and grants 5 XP. */
    levelComplete: function (score) {
      return send("level_complete", { score: Math.floor(score || 0) });
    },

    /** Game over — submits the final score. */
    gameOver: function (score) {
      return send("game_over", { score: Math.floor(score || 0) });
    },

    /** Cloud save. data is any JSON-serializable object; slot defaults to 1. */
    save: function (data, slot) {
      return send("save", { data: data, slot: slot || 1 });
    },

    /**
     * Cloud load. Returns a Promise resolving to the saved data (or null).
     * Times out after 4s if the portal doesn't respond.
     */
    load: function (slot) {
      slot = slot || 1;
      if (!inIframe) {
        return Promise.resolve(null);
      }
      var reqId = "ld_" + (++loadCounter) + "_" + Date.now();
      return new Promise(function (resolve) {
        pendingLoads[reqId] = resolve;
        setTimeout(function () {
          if (pendingLoads[reqId]) {
            delete pendingLoads[reqId];
            resolve(null);
          }
        }, 4000);
        send("load", { slot: slot, _reqId: reqId });
      });
    },
  };

  window.ForgeFlow = ForgeFlow;
})();
