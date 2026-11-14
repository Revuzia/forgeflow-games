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

  var ForgeFlow = {
    /** True when running inside the ForgeFlow Games portal iframe. */
    isHosted: inIframe,

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
