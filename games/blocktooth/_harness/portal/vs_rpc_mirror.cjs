/* BLOCKTOOTH - a 1:1 JS mirror of the VS half of supabase/migrations/0008_blocktooth_stats.sql (lane O-REPORT).
 *
 * Loaded by _harness/portal/bridge_host.html (the stand-in portal: classic <script>) and by _harness/portal/probe_vsreport.ts (node).
 * It mirrors what the portal does with a `forgeflow:vs_result`: rpc bt_report_vs({p}) as the signed-in account, with
 *   bt__validate_run   (the bounds a VS roll-up row must pass)
 *   bt_report_vs       (own row only; placement unique; match_full; already; winner CONFIRMED only when >= 2 human reports exist,
 *                       every report names the same non-null winner, and that winner reported placement 1 and named ITSELF;
 *                       1-human matches never confirm a board win: the reporter's win goes to vs_solo_wins)
 * and keeps the tables a test reads back: bt_vs_matches, bt_vs_results, bt_runs (mode 'vs'), bt_player_stats (vs_* columns),
 * bt_titan_stats (vs_wins). When 0008's bt_report_vs / bt__validate_run change, change this file with them: it is the only place the
 * harness encodes the server rules (portalcheck.py's solo validator is separate).
 *
 * Deliberate differences: no md5 in a browser, so the roll-up's run_nonce is 'vs-' || match_id here (server: 'vs-' || md5(match_id));
 * the solo columns of bt_player_stats / bt_bests are not modelled (a VS test reads the VS ones).
 */
(function (root) {
  'use strict';
  var TITANS = ['molo', 'voltkite', 'hearthback', 'briarwick'];
  var BIOMES = ['grideast', 'whitestacks', 'lockwater'];
  var MAX_BLOCKS = { grideast: 240, whitestacks: 182, lockwater: 208 };
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function isNum(v) { return v !== null && v !== undefined && v !== '' && typeof v !== 'boolean' && isFinite(Number(v)); }
  /** (p->>k)::numeric -> number | null (NULL); throws on a non-numeric string (SQL cast error) */
  function numCast(p, k) {
    var v = p[k];
    if (v === null || v === undefined) return null;
    if (typeof v === 'object' || typeof v === 'boolean') throw new Error('bad_number');
    if (!isNum(v)) throw new Error('bad_number');
    return Number(v);
  }
  function rnd(x) { return x === null ? null : Math.round(x); }   // SQL round(numeric): half away from zero ~ JS for the non-negatives used here
  function coal() { for (var i = 0; i < arguments.length; i++) if (arguments[i] !== null && arguments[i] !== undefined) return arguments[i]; return null; }

  /** bt__validate_run(p): null = ok, else the reason code (mirrors the SQL line by line) */
  function validateRun(p) {
    if (p === null || typeof p !== 'object' || Array.isArray(p)) return 'bad_payload';
    var v_nonce = p.run_nonce === undefined ? null : p.run_nonce;
    var v_mode = coal(p.mode, 'solo');
    var v_titan = p.titan === undefined ? null : p.titan;
    var v_biome = p.biome === undefined ? null : p.biome;
    var v_result = p.result === undefined ? null : p.result;
    var v_phase = coal(p.phase, 'run');
    var dur, lvl, rk, kl, tn, cr, bl, bo, gk, es, esc, rm, te, clr;
    try {
      dur = rnd(numCast(p, 'duration_s')); lvl = rnd(numCast(p, 'level')); rk = rnd(numCast(p, 'peak_rank'));
      kl = rnd(numCast(p, 'kills')); tn = rnd(numCast(p, 'tonnage'));
      cr = rnd(coal(numCast(p, 'crushed'), 0)); bl = rnd(coal(numCast(p, 'blocks'), 0)); bo = rnd(coal(numCast(p, 'bosses'), 0));
      gk = rnd(coal(numCast(p, 'gate_kills'), 0)); es = rnd(coal(numCast(p, 'endless_s'), 0)); esc = rnd(coal(numCast(p, 'endless_score'), 0));
      rm = rnd(coal(numCast(p, 'rematches'), 0)); te = rnd(coal(numCast(p, 'titans_eaten'), 0));
      clr = numCast(p, 'clear_s');
    } catch (e) { return 'bad_number'; }
    if (v_nonce === null || typeof v_nonce !== 'string' || v_nonce.length < 8 || v_nonce.length > 64 || !/^[A-Za-z0-9_.:-]+$/.test(v_nonce)) return 'bad_run_nonce';
    if (v_mode !== 'solo' && v_mode !== 'vs') return 'bad_mode';
    if (v_titan === null || TITANS.indexOf(v_titan) < 0) return 'bad_titan';
    if (v_biome === null || BIOMES.indexOf(v_biome) < 0) return 'bad_biome';
    if (v_mode === 'solo' && (v_result === null || (v_result !== 'clear' && v_result !== 'dead'))) return 'bad_result';
    if (v_mode === 'vs' && (v_result === null || (v_result !== 'vs_win' && v_result !== 'vs_place'))) return 'bad_result';
    if (v_phase !== 'run' && v_phase !== 'endless') return 'bad_phase';
    if (String(coal(p.build_version, '')).length > 64) return 'bad_build_version';
    if (dur === null || dur < 5 || dur > 43200) return 'duration_out_of_range';
    if (v_result === 'clear') { if (clr === null || clr < 300 || clr > dur + 1) return 'clear_s_out_of_range'; }
    else if (clr !== null) return 'clear_s_without_clear';
    if (lvl === null || lvl < 1 || lvl > Math.min(250, 40 + Math.floor(dur / 30))) return 'level_out_of_range';
    if (rk === null || rk < 0 || rk > 4) return 'peak_rank_out_of_range';
    if (kl === null || kl < 0 || kl > 500 + 30 * dur) return 'kills_out_of_range';
    if (cr < 0 || cr > kl) return 'crushed_out_of_range';
    if (tn === null || tn < 0 || tn > 12000000 + 20000 * dur) return 'tonnage_out_of_range';
    if (bl < 0 || bl > (MAX_BLOCKS[v_biome] || 208)) return 'blocks_out_of_range';
    if (es < 0 || es > dur) return 'endless_s_out_of_range';
    if (es > 0 && v_result !== 'clear') return 'endless_without_clear';
    if (rm < 0 || rm > Math.floor(es / 150) + 1) return 'rematches_out_of_range';
    if (bo < 0 || bo > 2 + Math.floor(es / 75)) return 'bosses_out_of_range';
    if (gk < 0 || gk > 4 + Math.floor(es / 75)) return 'gate_kills_out_of_range';
    if (esc < 0 || esc > 10 * es + 2 * kl + 5000 * rm + Math.floor(tn / 500) + 1500 * (Math.floor(es / 75) + 2) + 100) return 'endless_score_out_of_range';
    if (v_mode === 'solo' && te !== 0) return 'titans_eaten_in_solo';
    if (te < 0 || te > 3) return 'titans_eaten_out_of_range';
    return null;
  }

  function FakeBtDb() {
    this.profiles = {};            // uid -> {username}
    this.bt_vs_matches = {};       // match_id -> {match_id, biome, humans, bots, winner_id, reports}
    this.bt_vs_results = [];       // {match_id, user_id, titan, placement, claimed_winner, titans_eaten, peak_level, survived_s}
    this.bt_runs = [];             // {user_id, run_nonce, mode:'vs', titan, biome, result, placement, ...}
    this.bt_player_stats = {};     // uid -> {vs_matches, vs_wins, vs_top2, vs_titans_eaten, vs_solo_wins}
    this.bt_titan_stats = {};      // uid + '|' + titan -> {vs_wins}
    this.calls = [];               // every report: {uid, p, result} (what a test asserts the wire against)
  }
  FakeBtDb.prototype.addProfile = function (uid, username) { this.profiles[uid] = { username: username || uid }; };
  FakeBtDb.prototype._stats = function (uid) {
    return this.bt_player_stats[uid] || (this.bt_player_stats[uid] = { vs_matches: 0, vs_wins: 0, vs_top2: 0, vs_titans_eaten: 0, vs_solo_wins: 0 });
  };
  FakeBtDb.prototype.resultsOf = function (matchId) { return this.bt_vs_results.filter(function (r) { return r.match_id === matchId; }); };

  /** bt_report_vs(p) as `uid` (null = anon: the portal answers not_signed_in before any RPC). Returns the jsonb. */
  FakeBtDb.prototype.report = function (uid, p) {
    var out = this._report(uid, p);
    this.calls.push({ uid: uid, p: JSON.parse(JSON.stringify(p === undefined ? null : p)), result: JSON.parse(JSON.stringify(out)) });
    return out;
  };
  FakeBtDb.prototype._report = function (uid, p) {
    var self = this;
    if (!uid) return { ok: false, error: 'not_signed_in' };
    if (p === null || typeof p !== 'object' || Array.isArray(p)) return { ok: false, error: 'rejected', reason: 'bad_payload' };
    if (!this.profiles[uid]) return { ok: false, error: 'no_profile' };
    var v_match = p.match_id === undefined ? null : p.match_id, v_biome = p.biome === undefined ? null : p.biome, v_titan = p.titan === undefined ? null : p.titan;
    var v_place, v_humans, v_bots, v_te, v_peak, v_surv, v_claim;
    try {
      v_place = rnd(numCast(p, 'placement')); v_humans = rnd(numCast(p, 'humans')); v_bots = rnd(numCast(p, 'bots'));
      v_te = rnd(coal(numCast(p, 'titans_eaten'), 0));
      v_peak = rnd(coal(numCast(p, 'peak_level'), numCast(p, 'level'), 0));
      v_surv = rnd(coal(numCast(p, 'survived_s'), numCast(p, 'duration_s'), 0));
      var c = p.claimed_winner;
      if (c === '' || c === null || c === undefined) v_claim = null;
      else if (typeof c === 'string' && UUID.test(c)) v_claim = c.toLowerCase();
      else throw new Error('bad_number');
    } catch (e) { return { ok: false, error: 'rejected', reason: 'bad_number' }; }
    if (v_match === null || typeof v_match !== 'string' || v_match.length < 8 || v_match.length > 80) return { ok: false, error: 'rejected', reason: 'bad_match_id' };
    if (v_place === null || v_place < 1 || v_place > 4) return { ok: false, error: 'rejected', reason: 'bad_placement' };
    if (v_humans === null || v_bots === null || v_humans < 1 || v_humans > 4 || v_bots < 0 || v_bots > 3 || v_humans + v_bots !== 4) return { ok: false, error: 'rejected', reason: 'bad_seats' };
    if (v_peak < 0 || v_peak > 250 || v_surv < 0 || v_surv > 43200) return { ok: false, error: 'rejected', reason: 'bad_figures' };
    if ((v_place === 1 && v_claim !== uid) || (v_claim === uid && v_place !== 1)) return { ok: false, error: 'rejected', reason: 'claim_mismatch' };
    if (v_humans === 1 && v_claim !== null && v_claim !== uid) return { ok: false, error: 'rejected', reason: 'claim_mismatch' };

    var v_run = Object.assign({}, p, {
      mode: 'vs', result: v_place === 1 ? 'vs_win' : 'vs_place', run_nonce: 'vs-' + v_match, vs_match_id: v_match, phase: 'run',
      clear_s: null, endless_s: 0, endless_score: 0, rematches: 0, titans_eaten: v_te,
    });
    var reason = validateRun(v_run);
    if (reason !== null) return { ok: false, error: 'rejected', reason: reason };

    var m = this.bt_vs_matches[v_match];
    if (!m) m = this.bt_vs_matches[v_match] = { match_id: v_match, biome: v_biome, humans: v_humans, bots: v_bots, winner_id: null, reports: 0 };
    if (this.bt_vs_results.some(function (r) { return r.match_id === v_match && r.user_id === uid; })) {
      return { ok: true, already: true, winner_confirmed: m.winner_id !== null, winner_id: m.winner_id, reports: m.reports };
    }
    if (m.reports >= m.humans) return { ok: false, error: 'rejected', reason: 'match_full' };
    if (this.bt_vs_results.some(function (r) { return r.match_id === v_match && r.placement === v_place; })) return { ok: false, error: 'rejected', reason: 'placement_taken' };

    this.bt_vs_results.push({ match_id: v_match, user_id: uid, titan: v_titan, placement: v_place, claimed_winner: v_claim, titans_eaten: v_te, peak_level: v_peak, survived_s: v_surv });
    m.reports += 1;
    // bt__file_run: the roll-up run (unique per user + run_nonce)
    if (this.bt_runs.some(function (r) { return r.user_id === uid && r.run_nonce === v_run.run_nonce; })) throw new Error('bt_report_vs: run roll-up failed: already');
    this.bt_runs.push({ user_id: uid, run_nonce: v_run.run_nonce, mode: 'vs', titan: v_titan, biome: v_biome, result: v_run.result, placement: v_place,
      duration_s: v_run.duration_s, level: v_run.level, peak_rank: v_run.peak_rank, kills: v_run.kills, tonnage: v_run.tonnage, titans_eaten: v_te, vs_match_id: v_match });
    var st = this._stats(uid);
    st.vs_matches += 1; st.vs_top2 += v_place <= 2 ? 1 : 0; st.vs_titans_eaten += v_te; st.vs_solo_wins += (m.humans === 1 && v_place === 1) ? 1 : 0;

    var rows = this.resultsOf(v_match);
    var n = rows.length, nclaims = rows.filter(function (r) { return r.claimed_winner !== null; }).length;
    var distinct = {}; rows.forEach(function (r) { if (r.claimed_winner !== null) distinct[r.claimed_winner] = 1; });
    var ndistinct = Object.keys(distinct).length;
    var v_winner = null;
    if (n >= 2 && nclaims === n && ndistinct === 1) {
      v_winner = rows[0].claimed_winner;
      if (!rows.some(function (r) { return r.user_id === v_winner && r.placement === 1; })) v_winner = null;
    }
    var v_old = m.winner_id;
    if (v_winner !== v_old) {
      if (v_old !== null) {
        var ot = rows.filter(function (r) { return r.user_id === v_old; })[0];
        st = this._stats(v_old); st.vs_wins = Math.max(0, st.vs_wins - 1);
        if (ot) { var tk = v_old + '|' + ot.titan; if (self.bt_titan_stats[tk]) self.bt_titan_stats[tk].vs_wins = Math.max(0, self.bt_titan_stats[tk].vs_wins - 1); }
      }
      if (v_winner !== null) {
        var wt = rows.filter(function (r) { return r.user_id === v_winner; })[0];
        this._stats(v_winner).vs_wins += 1;
        var k2 = v_winner + '|' + wt.titan;
        (this.bt_titan_stats[k2] || (this.bt_titan_stats[k2] = { vs_wins: 0 })).vs_wins += 1;
      }
      m.winner_id = v_winner;
    }
    return { ok: true, already: false, winner_confirmed: v_winner !== null, winner_id: v_winner, reports: m.reports };
  };

  var api = { FakeBtDb: FakeBtDb, validateRun: validateRun, TITANS: TITANS, BIOMES: BIOMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BT_VS_RPC = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
