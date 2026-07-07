/**
 * Dungeon Forge — runtime/net/cloud.js
 * Optional cloud layer over Supabase REST (anon key): publish dungeons under
 * short codes, fetch them, and keep a fastest-escape leaderboard per dungeon.
 * Everything degrades gracefully — if the tables aren't reachable the game
 * still works with local saves + URL share codes.
 */
const SUPABASE_URL = "https://wugoxdewcdxzfppgzohy.supabase.co";
const ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1Z294ZGV3Y2R4emZwcGd6b2h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM5OTU0MzEsImV4cCI6MjA2OTU3MTQzMX0.ljJYgVp0n9d_tJeL3ZG6liYfW0lQ7d_29svPMbUAves";

const V = new URL(import.meta.url).search;

export class Cloud {
  constructor() {
    this.base = SUPABASE_URL + "/rest/v1";
    this.h = {
      apikey: ANON,
      Authorization: "Bearer " + ANON,
      "Content-Type": "application/json",
    };
  }

  async _req(path, opts = {}) {
    try {
      const r = await fetch(this.base + path, {
        method: opts.method || "GET",
        headers: Object.assign({}, this.h, opts.headers || {}),
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      if (!r.ok) return null;
      const txt = await r.text();
      return txt ? JSON.parse(txt) : [];
    } catch (e) { return null; }
  }

  /** Publish (upsert by code) → {code} or null. */
  async publishDungeon(d) {
    const D = await import("../sim/dungeon.js" + V);
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = randCode(6);
      const row = {
        code, name: d.name, theme: d.theme, difficulty: d.difficulty || 1,
        author: (d.author || "anonymous").slice(0, 24), data: JSON.parse(D.serialize(d)),
      };
      const res = await this._req("/df_dungeons", {
        method: "POST", body: row, headers: { Prefer: "return=representation" },
      });
      if (res && res.length) return { code: res[0].code };
      if (res === null) {
        // could be a code collision (unique violation) → retry with a new code;
        // or the table is missing → give up after attempts
        continue;
      }
    }
    return null;
  }

  async fetchDungeon(code) {
    if (!code || code.length < 4) return null;
    const D = await import("../sim/dungeon.js" + V);
    const rows = await this._req(`/df_dungeons?code=eq.${encodeURIComponent(code.toUpperCase())}&select=data&limit=1`);
    if (!rows || !rows.length) return null;
    return D.sanitize(rows[0].data);
  }

  async submitScore(dungeonCode, player, timeMs, deaths) {
    return this._req("/df_scores", {
      method: "POST",
      body: { dungeon_code: dungeonCode.toUpperCase(), player: String(player).slice(0, 24), time_ms: timeMs, deaths: deaths | 0 },
    });
  }

  async topScores(dungeonCode, n = 5) {
    return this._req(`/df_scores?dungeon_code=eq.${encodeURIComponent(dungeonCode.toUpperCase())}&select=player,time_ms,deaths&order=time_ms.asc&limit=${n}`);
  }
}

function randCode(n) {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < n; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
