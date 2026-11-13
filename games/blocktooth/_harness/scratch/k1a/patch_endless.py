p = r'C:\Users\TestRun\Claude Claw\forgeflow-games\games\blocktooth\_harness\probe_endless.ts'
s = open(p, encoding='utf-8').read()


def rep(a, b):
    global s
    assert a in s, a[:100]
    s = s.replace(a, b)


rep("""// Scenario A (the §9.3 run): the gate bot plays until the city's boss is fielded, the boss is killed the way
// the dev cheat does it (intro skipped, bossUltHit(w, 1, 0)), the next tick files `runEnd clear`, then""",
    """// Scenario A (the §9.3 run): the gate bot plays until the city's boss is fielded, the boss is killed the way
// the dev cheat does it (intro skipped, bossUltHit(w, 1, 0)), the Size V finale plays out (GATEKEEPERS §4.3:
// `runEnd clear` GATES.finaleS after the kill, with run.endT = the kill), then""")
rep("""//      boss null, EndlessState per §9.1 (rematches 0, nextBossT +150, bossIx 1, nextEliteT +30, killsAt, tonsAt)""",
    """//      boss null, EndlessState per §9.1 (rematches 0, nextBossT +ENDLESS_V3.rematchGapS 75, bossIx 1, nextEliteT
//      +30, killsAt, tonsAt), gates.rematchSeq 0""")
rep("""//   4. rematches: the first at KEEP GOING + 150 s, each next one 150 s after the previous rematch dies (±1 tick),
//      in rematchOrder(biome) starting at bossIx 1 (GRID-EAST: CAISSON-4 → IRON GULLY → PARKADE-6 → …), HP =
//      BOSSES[id].hp × BOSS_HP_SCALE[rank] × (1 + 0.5 n); `endlessBoss` + ONE `alert rematch` (no `alert boss`);
//      a dead rematch drops a chest (+ a forced power-up once the L4 map sim is merged) and rematches++""",
    """//   4. rematches (GATEKEEPERS §4.4, lane K1a): the first at KEEP GOING + 75 s, each next one 75 s after the
//      previous rematch dies (±1 tick), ALTERNATING a gatekeeper and a city boss: STENCIL-1, the next city boss in
//      rematchOrder(biome) from bossIx 1 (GRID-EAST: CAISSON-4 → IRON GULLY → PARKADE-6 → …), CORDON-2, the next
//      city boss, SWITCHBOARD-5, …. City boss HP = BOSSES[id].hp × BOSS_HP_SCALE[rank] × (1 + 0.5 n) with
//      `endlessBoss` + ONE `alert rematch` (no `alert boss`); a gatekeeper = gateHpFor(id, rank, n) (GATE_HP_AT_RANK[4]
//      × GATE_HP_MUL × (1 + 0.5 n), n = its own rematches won) with `gateSpawn {rematch}` + `alert gateRematch`,
//      slot 0; a dead rematch drops a chest (+ a forced power-up once the L4 map sim is merged); a city death
//      does rematches++, a gatekeeper death gates.rematchN[ix]++ / rematchGates++ and NEVER rematches++""")
rep("""//   6. the score is monotone (every tick) and equals floor(10·s + 2·kills + 5000·rematches + tons/500)""",
    """//   6. the score is monotone (every tick) and equals floor(10·s + 2·kills + 5000·rematches + tons/500
//      + 1500·gates.rematchGates)""")
rep("import { BOSS_HP_SCALE, ENDLESS, SIM_HZ } from '../src/core/config.ts';",
    "import { BOSS_HP_SCALE, ENDLESS, ENDLESS_V3, GATES, SIM_HZ } from '../src/core/config.ts';\nimport { GATE_IDS } from '../src/core/types.ts';")
rep("""  titansim: typeof import('../src/titans/titansim.ts');
  BOSSES""", """  titansim: typeof import('../src/titans/titansim.ts');
  gates: typeof import('../src/meta/gates.ts');
  BOSSES""")
rep("""      titansim: await import('../src/titans/titansim.ts'),
      BOSSES""", """      titansim: await import('../src/titans/titansim.ts'),
      gates: await import('../src/meta/gates.ts'),
      BOSSES""")
rep("""  if (w.endless) { n(w.endless.score); n(w.endless.rematches); n(w.endless.bossIx); n(Number.isFinite(w.endless.nextBossT) ? w.endless.nextBossT : -1); }""",
    """  if (w.endless) { n(w.endless.score); n(w.endless.rematches); n(w.endless.bossIx); n(Number.isFinite(w.endless.nextBossT) ? w.endless.nextBossT : -1); }
  if (w.gates) { n(w.gates.rematchSeq); n(w.gates.rematchGates); n(w.gates.rematchN[0]); n(w.gates.rematchN[1]); n(w.gates.rematchN[2]); }""")
rep("""  b.introT = 0;
  M.bosses.bossUltHit(w, 1, 0);
  botStep(w);
  return w.run.result === 'clear';""", """  b.introT = 0;
  M.bosses.bossUltHit(w, 1, 0);
  // GATEKEEPERS §4.3: the kill → Size V → the finale (GATES.finaleS) → runEnd clear
  const t = GATES.finaleS * SIM_HZ + 2 * SIM_HZ;
  for (let i = 0; i < t && !w.run.result; i++) botStep(w);
  return w.run.result === 'clear';""")
rep("""  ok(E.startT === t0 && E.rematches === 0 && near(E.nextBossT, t0 + ENDLESS.bossEveryS) && E.bossIx === 1 && near(E.nextEliteT, t0 + 30) && E.killsAt === kills0 && E.tonsAt === tons0 && E.score === 0,""",
    """  ok(E.startT === t0 && E.rematches === 0 && near(E.nextBossT, t0 + ENDLESS_V3.rematchGapS) && E.bossIx === 1 && near(E.nextEliteT, t0 + 30) && E.killsAt === kills0 && E.tonsAt === tons0 && E.score === 0 && w.gates.rematchSeq === 0,""")
rep("""  let alerts = { boss: 0, rematch: 0 };""", """  let alerts = { boss: 0, rematch: 0, gateRematch: 0 };
  let cityRematches = 0, gateRematches = 0, cityDeaths = 0, gateDeaths = 0;
  /** GATEKEEPERS §4.4: rotation step k → the expected fight */
  const expectAt = (k: number): string => (k % 2 === 0 ? GATE_IDS[Math.floor(k / 2) % GATE_IDS.length] : order[(1 + (k - 1) / 2) % order.length]);""")
rep("""  const hpChecks: string[] = [];""", """  const hpChecks: string[] = [];
  const onRematch = (id: string): void => {
    const b = w.boss!;
    log.rematchT.push(w.t); log.rematchIds.push(id);
    const n = log.rematchT.length - 1;
    ok(id === expectAt(n), `${tag}: rematch #${n + 1} is ${id} (want ${expectAt(n)})`);
    let wantHp: number;
    if ((GATE_IDS as readonly string[]).includes(id)) {
      const ix = (GATE_IDS as readonly string[]).indexOf(id);
      wantHp = M.gates.gateHpFor(id as (typeof GATE_IDS)[number], w.titan.rank, w.gates.rematchN[ix]);
      ok(b.role === 'gate' && b.slot === 0, `${tag}: rematch #${n + 1} (${id}) role ${b.role} slot ${b.slot} (want gate / 0)`);
      hpChecks.push(`${id} ${b.maxHp.toFixed(0)}/${wantHp.toFixed(0)}`);
      ok(near(b.maxHp, wantHp, 1e-9) && near(b.hp, b.maxHp), `${tag}: rematch #${n + 1} HP ${b.maxHp.toFixed(0)} = gateHpFor(${id}, rank ${w.titan.rank}, n ${w.gates.rematchN[ix]})`);
    } else {
      wantHp = M.BOSSES[id as BossId].hp * BOSS_HP_SCALE[w.titan.rank] * (1 + ENDLESS.rematchHpStep * E.rematches);
      hpChecks.push(`${id} ${b.maxHp.toFixed(0)}/${wantHp.toFixed(0)}`);
      ok(near(b.maxHp, wantHp, 1e-9) && near(b.hp, b.maxHp), `${tag}: rematch #${n + 1} HP ${b.maxHp.toFixed(0)} = ${M.BOSSES[id as BossId].hp} × ${BOSS_HP_SCALE[w.titan.rank]} × (1 + 0.5·${E.rematches})`);
    }
    const due = n === 0 ? t0 + ENDLESS_V3.rematchGapS : log.bossDeathT[log.bossDeathT.length - 1] + ENDLESS_V3.rematchGapS;
    ok(Math.abs(w.t - due) <= 2 * TICK + 1e-9, `${tag}: rematch #${n + 1} at ${w.t.toFixed(2)} s (due ${due.toFixed(2)} s)`);
  };""")
a0 = s.index("        if (e.type === 'endlessBoss') {")
a1 = s.index("        else if (e.type === 'bossDefeated') { log.bossDeathT.push(w.t); pendingDeath = { chests, pu: 0, ticks: 0 }; }")
a1e = a1 + len("        else if (e.type === 'bossDefeated') { log.bossDeathT.push(w.t); pendingDeath = { chests, pu: 0, ticks: 0 }; }")
s = s[:a0] + """        if (e.type === 'endlessBoss') { cityRematches++; onRematch(e.boss); }
        else if (e.type === 'gateSpawn' && e.rematch) { gateRematches++; onRematch(e.gate); }
        else if (e.type === 'alert' && e.key === 'boss') alerts.boss++;
        else if (e.type === 'alert' && e.key === 'rematch') alerts.rematch++;
        else if (e.type === 'alert' && e.key === 'gateRematch') alerts.gateRematch++;
        else if (e.type === 'bossDefeated') { cityDeaths++; log.bossDeathT.push(w.t); pendingDeath = { chests, pu: 0, ticks: 0 }; }
        else if (e.type === 'gateDefeated' && e.rematch) { gateDeaths++; log.bossDeathT.push(w.t); pendingDeath = { chests, pu: 0, ticks: 0 }; }""" + s[a1e:]
rep("""        M.bosses.bossUltHit(w, 1, 0);          // outside stepWorld: its bossDefeated event is not in the next scan
        if (!w.boss.alive) { log.bossDeathT.push(w.t); pendingDeath = { chests: chestsBefore(w), pu: 0, ticks: 0 }; }""",
    """        const wasGate = w.boss.role === 'gate';
        M.bosses.bossUltHit(w, 1, 0);          // outside stepWorld: its bossDefeated / gateDefeated event is not in the next scan
        if (!w.boss.alive) { if (wasGate) gateDeaths++; else cityDeaths++; log.bossDeathT.push(w.t); pendingDeath = { chests: chestsBefore(w), pu: 0, ticks: 0 }; }""")
rep("""  ok(alerts.boss === 0 && alerts.rematch === log.rematchT.length, `${tag}: one 'alert rematch' per rematch, no 'alert boss' (rematch ${alerts.rematch}, boss ${alerts.boss}, rematches ${log.rematchT.length})`);
  ok(E.rematches === log.bossDeathT.length, `${tag}: rematches won ${E.rematches} = rematch deaths ${log.bossDeathT.length}`);""",
    """  ok(alerts.boss === 0 && alerts.rematch === cityRematches && alerts.gateRematch === gateRematches, `${tag}: one 'alert rematch' per city rematch and one 'alert gateRematch' per gatekeeper rematch, no 'alert boss' (rematch ${alerts.rematch}/${cityRematches}, gateRematch ${alerts.gateRematch}/${gateRematches}, boss ${alerts.boss})`);
  ok(E.rematches === cityDeaths, `${tag}: city rematches won ${E.rematches} = city rematch deaths ${cityDeaths} (gatekeeper deaths never count)`);
  ok(w.gates.rematchGates === gateDeaths && w.gates.rematchN[0] + w.gates.rematchN[1] + w.gates.rematchN[2] === gateDeaths, `${tag}: gatekeeper rematches won ${w.gates.rematchGates} (rematchN ${w.gates.rematchN.join('/')}) = gatekeeper rematch deaths ${gateDeaths}`);""")
rep("""  const want = Math.floor(S.perSecond * (w.t - t0) + S.perKill * (w.titan.kills - kills0) + S.perRematch * E.rematches + (w.run.tonnage - tons0) * S.perTons);""",
    """  const want = Math.floor(S.perSecond * (w.t - t0) + S.perKill * (w.titan.kills - kills0) + S.perRematch * E.rematches + (w.run.tonnage - tons0) * S.perTons
    + ENDLESS_V3.scorePerGateRematch * w.gates.rematchGates);""")
rep("""· won ${E.rematches} · RAMRODs""", """· won ${E.rematches} city + ${w.gates.rematchGates} gatekeeper · RAMRODs""")
open(p, 'w', encoding='utf-8').write(s)
print('ok')
