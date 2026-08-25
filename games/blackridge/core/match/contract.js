// core/match/contract.js [W1] — the PVP content contract gate
// (PVP_BUILD_PLAN C19; a re-authoring of mission.js:28-135's two-phase split).
// THREE-free, Node-safe.
//
// Two phases, the exact split mission.js uses:
//   • content-internal checks — run at makeMatch(); pass NO opts.
//   • node / weapon / nav checks — run at match.start(sim); pass
//     { nodes, weapons, nav, world } from the live sim.
// Both are also runnable standalone via
//   node core/match/match.selftest.cjs --contract
//
// A1 (owner amendment): content.json v2 RETAINS the campaign `mission` block
// alongside the PVP blocks. The campaign half is validated by
// core/sim/mission.js:validateContent (sim.selftest.cjs --contract); THIS
// gate validates only the PVP half. While W4 has not yet landed the PVP
// blocks, hasPvpContent() is false and callers synthesize a flagged fallback
// instead of failing the boot (the boot-without-content.json philosophy).

export function hasPvpContent(content) {
  return !!(content && (content.arena || content.modes || content.teams ||
    content.botRoster || content.spawnPoints || content.clusters || content.flags));
}

// validateMatchContent(content, opts) → { ok, errors, pending }
//   opts.modeIds — the MODES registry's ids (both-direction check, C19/R9)
//   opts.nodes / opts.weapons / opts.nav — arm the deferred half
export function validateMatchContent(content, opts = {}) {
  const errors = [];
  if (!content) return { ok: false, errors: ["content missing"], pending: false };
  if (!hasPvpContent(content)) {
    // W4 has not landed the PVP blocks — pending, not broken. makeMatch
    // synthesizes a loudly-flagged fallback arena; the live-content half of
    // this gate arms automatically the moment the blocks appear.
    return { ok: true, errors: [], pending: true };
  }

  const modeIds = opts.modeIds || null;
  const nodes = opts.nodes || null;
  const weapons = opts.weapons || null;
  const nav = opts.nav || null;

  const teams = content.teams || [];
  const clusters = content.clusters || {};
  const points = content.spawnPoints || [];
  const flags = content.flags || [];
  const modes = content.modes || {};
  const roster = content.botRoster || [];
  const archetypes = content.archetypes || {};
  const arena = content.arena || null;

  // ---- content-internal half -------------------------------------------
  if (!arena) errors.push("arena block missing");
  if (teams.length !== 2) errors.push(`teams.length ${teams.length} !== 2`);
  if (roster.length !== 9) errors.push(`botRoster.length ${roster.length} !== 9`);

  // C19/R9 both directions: every modes key exists in the registry AND every
  // registry entry has a data block — a mode with no data is as broken as
  // data with no mode.
  if (modeIds) {
    for (const k of Object.keys(modes)) {
      if (k.startsWith("_")) continue;
      if (!modeIds.includes(k)) errors.push(`content.modes.${k}: not in MODES registry`);
    }
    for (const id of modeIds) {
      if (!Object.prototype.hasOwnProperty.call(modes, id)) {
        errors.push(`MODES registry '${id}' has no content.modes block`);
      }
    }
  }

  // roster archetypes resolve after BOTH team suffixes (C19)
  const suffixes = teams.map((t) => t.archetypeSuffix || "");
  for (const r of roster) {
    for (const sfx of suffixes.length ? suffixes : [""]) {
      const key = r.archetype + sfx;
      if (!archetypes[key] && !archetypes[r.archetype]) {
        errors.push(`botRoster slot ${r.slot}: archetype '${r.archetype}' resolves with neither suffix`);
        break;
      }
    }
  }

  // spawn points: cluster exists, no dup ids, 40–50 points, ≥6/cluster/mode
  const seen = new Set();
  for (const p of points) {
    if (seen.has(p.id)) errors.push(`spawnPoints: duplicate id '${p.id}'`);
    seen.add(p.id);
    if (!clusters[p.cluster]) errors.push(`spawnPoint ${p.id}: cluster '${p.cluster}' unknown`);
    if (!Array.isArray(p.pos) || p.pos.length !== 3) errors.push(`spawnPoint ${p.id}: bad pos`);
  }
  if (points.length < 40 || points.length > 50) {
    errors.push(`spawnPoints count ${points.length} outside 40–50`);
  }
  // C7b: the per-mode cluster count assertion — ≥6 eligible per cluster per
  // mode (a point with no `modes` field is eligible in every mode).
  const modeList = modeIds || Object.keys(modes).filter((k) => !k.startsWith("_"));
  for (const mid of modeList) {
    const perCluster = {};
    for (const p of points) {
      if (p.modes && !p.modes.includes(mid)) continue;
      perCluster[p.cluster] = (perCluster[p.cluster] || 0) + 1;
    }
    for (const [cid, c] of Object.entries(clusters)) {
      if (cid.startsWith("_")) continue;
      if (c.modes && !c.modes.includes(mid)) continue; // FFA-only clusters (SC_PLAZA)
      const n = perCluster[cid] || 0;
      if (n < 6) errors.push(`mode ${mid}: cluster ${cid} has ${n} eligible points (< 6)`);
    }
  }

  // flags: team exists, exactly one per team
  const flagTeams = {};
  for (const f of flags) {
    if (!teams.some((t) => t.id === f.team)) errors.push(`flag ${f.id}: team ${f.team} unknown`);
    flagTeams[f.team] = (flagTeams[f.team] || 0) + 1;
    if (!Array.isArray(f.home) || f.home.length !== 3) errors.push(`flag ${f.id}: bad home`);
  }
  if (flags.length) {
    for (const t of teams) {
      if ((flagTeams[t.id] || 0) !== 1) errors.push(`team ${t.id}: ${flagTeams[t.id] || 0} flags (need exactly 1)`);
    }
  }

  // ---- deferred half (needs colliders/weapons/nav — at match.start) ------
  if (weapons) {
    for (const [id, a] of Object.entries(archetypes)) {
      if (id.startsWith("_")) continue;
      if (a.weapon && !Object.prototype.hasOwnProperty.call(weapons, a.weapon)) {
        errors.push(`archetype ${id}: unknown weapon '${a.weapon}'`);
      }
    }
  }
  if (nodes) {
    const checkNode = (n, where) => {
      if (n && !Object.prototype.hasOwnProperty.call(nodes, n)) errors.push(`${where}: unknown node '${n}'`);
    };
    for (const [cid, c] of Object.entries(clusters)) checkNode(c.node, `cluster ${cid}`);
    for (const f of flags) checkNode(f.node, `flag ${f.id}`);
  }
  if (arena && arena.bounds) {
    const inB = (pos) =>
      pos[0] >= arena.bounds.min[0] && pos[0] <= arena.bounds.max[0] &&
      pos[2] >= arena.bounds.min[2] && pos[2] <= arena.bounds.max[2];
    for (const p of points) {
      if (Array.isArray(p.pos) && p.pos.length === 3 && !inB(p.pos)) {
        errors.push(`spawnPoint ${p.id}: outside arena.bounds`);
      }
    }
    for (const f of flags) {
      if (Array.isArray(f.home) && f.home.length === 3 && !inB(f.home)) {
        errors.push(`flag ${f.id}: home outside arena.bounds`);
      }
    }
  }
  if (nav) {
    for (const p of points) {
      if (Array.isArray(p.pos) && p.pos.length === 3 && nav.onNav && !nav.onNav(p.pos, 1.5)) {
        errors.push(`spawnPoint ${p.id}: not nav-walkable`);
      }
    }
    for (const f of flags) {
      if (Array.isArray(f.home) && f.home.length === 3 && nav.onNav && !nav.onNav(f.home, 1.5)) {
        errors.push(`flag ${f.id}: home not nav-walkable`);
      }
    }
    // every spawn point and flag home nav-reachable from every cluster anchor
    if (nav.reachable) {
      const anchors = Object.entries(clusters)
        .filter(([k]) => !k.startsWith("_"))
        .map(([k, c]) => [k, c.anchor])
        .filter(([, a]) => Array.isArray(a));
      for (const [ck, anchor] of anchors) {
        for (const p of points) {
          if (Array.isArray(p.pos) && p.pos.length === 3 && !nav.reachable(anchor, p.pos)) {
            errors.push(`spawnPoint ${p.id}: not nav.reachable from cluster ${ck}`);
          }
        }
        for (const f of flags) {
          if (Array.isArray(f.home) && f.home.length === 3 && !nav.reachable(anchor, f.home)) {
            errors.push(`flag ${f.id}: home not nav.reachable from cluster ${ck}`);
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, pending: false };
}
