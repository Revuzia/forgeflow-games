p='_harness/probe_ult.ts'
s=open(p,encoding='utf-8').read()
def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)
start=s.index("function partL(): void {")
end=s.index("// ─────────────────────────────── main")
newL=r'''function partL(): void {
  console.log('\n── L. UPROAR pressed on the tick a level-up is granted: taken back (no ultFire behind the draft) ──');
  for (const titan of TITAN_IDS) {
    for (const mode of ['level', 'control', 'rankUp', 'owed'] as const) {
      // a scrap pickup worth one level dropped on the titan is collected after MIN_COLLECT_AGE: a dry run finds
      // the tick of that level-up, the identical (deterministic) second world presses UPROAR on exactly that tick.
      // rankUp: the level reached is the next Size's threshold (game.ts plays on through the MASS BREACH sting and
      // opens the draft after it — the fire must stand). owed: a draft already owed when UPROAR is pressed (the
      // app running on through that sting) — the fire must stand too.
      const lv = mode === 'rankUp' ? RANK_LEVELS[2] - 1 : RANK_LEVELS[1] + 1;
      const make = (): World => {
        const w = worldAt(titan, 1, lv);
        for (let i = 0; i < 5; i++) M.stepWorld(w, input());
        M.addUproar(w, ULT.max, true);
        if (mode === 'level' || mode === 'rankUp') M.spawnPickup(w, 'scrap', w.titan.x, w.titan.z, Math.max(1, w.titan.xpToNext - w.titan.xp) + 1, 0);
        return w;
      };
      let at = 0;
      if (mode === 'level' || mode === 'rankUp') {
        const dry = make();
        for (let i = 0; i < 90; i++) { M.stepWorld(dry, input()); if (dry.events.some((e) => e.type === 'levelUp')) { at = i; break; } }
      }
      const w = make();
      const T = w.titan, u = w.ult;
      for (let i = 0; i < at; i++) M.stepWorld(w, input());
      if (mode === 'owed') w.upgrades.pendingDrafts = 1;
      const owed0 = M.hasPendingDraft(w);
      const fired0 = u.fired, lv0 = T.level, rk0 = T.rank;
      M.stepWorld(w, input({ ultimate: true }));
      const ev = w.events;
      const levelled = T.level > lv0 && ev.some((e) => e.type === 'levelUp');
      const ranked = T.rank > rk0 && ev.some((e) => e.type === 'rankUp');
      const draft = M.hasPendingDraft(w);
      const hasFire = ev.some((e) => e.type === 'ultFire');
      const fires = hasFire && u.phase === 'roar' && u.fired === fired0 + 1;
      if (mode === 'level') {
        const ok1 = check(levelled && !ranked && draft && !hasFire && u.phase === 'idle' && u.ready && u.charge === ULT.max && u.lockT === 0 && u.fired === fired0,
          `L: ${titan}: level-up tick — levelled ${levelled}, rankUp ${ranked}, draft ${draft}, ultFire ${hasFire}, phase ${u.phase}, ready ${u.ready}, charge ${u.charge}, lockT ${u.lockT}, fired ${u.fired} (was ${fired0})`);
        // resolve the draft like the app, then the next press fires
        let g = 0;
        while (M.hasPendingDraft(w) && g++ < 20) { const off = M.rollOffer(w, w.upgrades.chestDrafts > 0); if (!off || !off.length) break; M.pickUpgrade(w, M.botPickUpgrade(w, off)); }
        M.stepWorld(w, input({ ultimate: true }));
        const ok2 = check(w.events.some((e) => e.type === 'ultFire') && u.phase === 'roar' && u.fired === fired0 + 1, `L: ${titan}: the press after the draft did not fire (phase ${u.phase})`);
        console.log(`  ${titan.padEnd(10)} level-up tick: fire taken back (idle, READY, no lockout, no ultFire) ${ok1 ? 'ok' : 'FAIL'} · next press after the draft fires ${ok2 ? 'ok' : 'FAIL'}`);
      } else if (mode === 'control') {
        const ok = check(!draft && fires, `L: ${titan}: control (no level-up) did not fire (phase ${u.phase}, draft ${draft})`);
        console.log(`  ${titan.padEnd(10)} control (no level-up): fires ${ok ? 'ok' : 'FAIL'}`);
      } else if (mode === 'rankUp') {
        const ok = check(levelled && ranked && draft && fires, `L: ${titan}: rank-up tick (sting, app plays on) — levelled ${levelled}, rankUp ${ranked}, draft ${draft}, fired ${fires} (phase ${u.phase})`);
        console.log(`  ${titan.padEnd(10)} level-up + rankUp tick (MASS BREACH sting defers the draft): fire stands ${ok ? 'ok' : 'FAIL'}`);
      } else {
        const ok = check(owed0 && draft && fires, `L: ${titan}: draft already owed at the press — owed ${owed0}, fired ${fires} (phase ${u.phase})`);
        console.log(`  ${titan.padEnd(10)} draft already owed at the press (app running on): fire stands ${ok ? 'ok' : 'FAIL'}`);
      }
    }
  }
}

'''
s=s[:start]+newL+s[end:]
rep("""    const owed = M.hasPendingDraft(w);
    if (inp.ultimate && ready0 && phase0 === 'idle' && !firedNow && w.ult.ready && w.ult.phase === 'idle' && owed) r.unfired++;
    if (firedNow && owed) r.fireWithDraft++;""",
"""    const owed = M.hasPendingDraft(w);
    const rankTick = evs.some((e) => e.type === 'rankUp');
    if (inp.ultimate && ready0 && phase0 === 'idle' && !firedNow && w.ult.ready && w.ult.phase === 'idle' && owed) r.unfired++;
    // the bot resolves every draft before it steps, so a draft owed here was granted THIS tick: it freezes the app
    // on this tick unless the tick also ranked up (game.ts plays on through the MASS BREACH sting)
    if (firedNow && owed && !rankTick) r.fireWithDraft++;
    if (firedNow && owed && rankTick) r.fireRankTick++;""")
rep("unfired: number; fireWithDraft: number; lvlMidUlt: number;", "unfired: number; fireWithDraft: number; fireRankTick: number; lvlMidUlt: number;")
rep("unfired: 0, fireWithDraft: 0, lvlMidUlt: 0 };", "unfired: 0, fireWithDraft: 0, fireRankTick: 0, lvlMidUlt: 0 };")
rep("""  const unf = runs.reduce((a, r) => a + r.unfired, 0), fwd = runs.reduce((a, r) => a + r.fireWithDraft, 0), lmu = runs.reduce((a, r) => a + r.lvlMidUlt, 0);
  check(fwd === 0, `L: ${fwd} tick(s) ended with an ultFire AND a draft owed (the roar would play behind the draft)`);
  console.log(`  L (full runs): fires taken back for a same-tick draft ${unf} · ticks ending with ultFire + a draft owed ${fwd} (want 0) · level-ups while an UPROAR is in flight ${lmu} (reported: that draft opens mid-ult — view wire)`);""",
"""  const unf = runs.reduce((a, r) => a + r.unfired, 0), fwd = runs.reduce((a, r) => a + r.fireWithDraft, 0), lmu = runs.reduce((a, r) => a + r.lvlMidUlt, 0);
  const frt = runs.reduce((a, r) => a + r.fireRankTick, 0);
  check(fwd === 0, `L: ${fwd} tick(s) ended with an ultFire AND a draft granted that tick without a rankUp (the roar would play behind the draft)`);
  console.log(`  L (full runs): fires taken back for a same-tick draft ${unf} · ticks ending with ultFire + a freezing draft ${fwd} (want 0) · fires standing on a rankUp tick (sting defers the draft) ${frt} · level-ups while an UPROAR is in flight ${lmu} (reported: that draft pauses the ult — view wire)`);""")
rep("""//   L. (critic F2-c) a fire on a tick that ends with a draft owed (a level-up) is taken back: no ultFire left in
//      the tick's events, phase idle, meter full + READY, no lockout; after the draft the next press fires. Full
//      runs: no tick ever ends with both an ultFire and a draft owed; level-ups mid-UPROAR are reported""",
"""//   L. (critic F2-c) a fire on a tick that ends with a draft granted that tick (a level-up) is taken back: no ultFire
//      left in the tick's events, phase idle, meter full + READY, no lockout; after the draft the next press fires.
//      The fire STANDS when the tick also ranks up (game.ts plays on through the MASS BREACH sting) or a draft was
//      already owed at the press (the app running on). Full runs: no tick ends with an ultFire and a freezing
//      draft; level-ups mid-UPROAR are reported""")
open(p,'w',encoding='utf-8').write(s)
print('ok')
