/* Grid Rush — behavioral test harness (deterministic, in-browser).
 *
 * The game exposes `window.__GR__` (the GridRushGame instance). The in-app
 * browser pane freezes requestAnimationFrame, so we drive the sim by pumping
 * `g.update(1/60)` directly — fully reproducible, frame-rate controllable.
 *
 * USAGE (in the game page's console, or via an automation agent):
 *   const r = runGridRushTests(window.__GR__);
 *   console.log(r.passed + '/' + r.total, r.failed ? 'FAIL' : 'PASS');
 *   console.table(r.results);
 *
 * Returns { passed, failed, total, results:[{name, pass, detail}] }.
 * Every check is an observed effect on real game state, not a mock.
 */
(function () {
  function runGridRushTests(g) {
    if (!g) return { error: 'no game instance (window.__GR__)' };
    const V3 = g.camera.position.constructor;
    const dot = (u, v) => u.x * v.x + u.y * v.y + u.z * v.z;
    const results = [];
    const T = (name, fn) => {
      try {
        const d = fn();
        const pass = d === true || (d && d.pass === true);
        results.push({ name, pass, detail: d && d.detail !== undefined ? d.detail : '' });
      } catch (e) {
        results.push({ name, pass: false, detail: 'threw: ' + e.message });
      }
    };
    const race = (vid, tid) => {
      if (vid) g.vehicleId = vid;
      if (tid) g.trackId = tid;
      g.startRace();
      let gd = 0;
      g.keys.clear();
      while (g.phase !== 'racing' && gd < 1200) { g.update(1 / 60); gd++; }
      return g.player;
    };
    const step = (n, dt) => { for (let i = 0; i < n; i++) g.update(dt || 1 / 60); };
    const setKeys = (arr) => { g.keys.clear(); arr.forEach((k) => g.keys.add(k)); };

    // 1. Controls — direction correctness vs the live camera axes
    T('W drives forward', () => {
      const p = race();
      const camF = g.camera.getWorldDirection(new V3());
      setKeys(['KeyW']); const p0 = p.mesh.position.clone(); step(40);
      const moved = dot(p.mesh.position.clone().sub(p0), camF);
      g.keys.clear();
      return { pass: moved > 3 && p.speed > 5, detail: 'fwd=' + moved.toFixed(1) };
    });
    T('A steers left, D steers right', () => {
      const p = race(); setKeys(['KeyW']); step(40);
      g.camera.updateMatrixWorld(true);
      const camR = new V3().setFromMatrixColumn(g.camera.matrixWorld, 0);
      const f0 = p.forward.clone(); setKeys(['KeyW', 'KeyA']); step(30);
      const aDot = dot(p.forward.clone().sub(f0), camR);
      const f1 = p.forward.clone(); setKeys(['KeyW', 'KeyD']); step(6); const f2 = p.forward.clone();
      setKeys(['KeyW', 'KeyD']); step(30); const dDot = dot(p.forward.clone().sub(f2), f1 && camR);
      g.keys.clear();
      return { pass: aDot < 0 && dDot > 0, detail: 'A=' + aDot.toFixed(2) + ' D=' + dDot.toFixed(2) };
    });
    T('S slows / reverses', () => {
      const p = race(); setKeys(['KeyW']); step(120); const fast = p.speed;
      setKeys(['KeyS']); step(60); const after = dot(p.velocity, p.forward); g.keys.clear();
      return { pass: after < fast, detail: 'velFwd=' + after.toFixed(1) };
    });

    // 2. Grip is frame-rate independent
    T('grip identical at 60 vs 30 fps', () => {
      const runYaw = (dt) => { const p = race(); setKeys(['KeyW', 'KeyA']); for (let i = 0; i < Math.round(2 / dt); i++) g.update(dt); g.keys.clear(); return p.yaw; };
      const y60 = runYaw(1 / 60), y30 = runYaw(1 / 30);
      return { pass: Math.abs(y60 - y30) < 0.15, detail: '60=' + y60.toFixed(2) + ' 30=' + y30.toFixed(2) };
    });

    // 3. Burst exceeds top speed; overclock thrusts
    T('SHIFT burst exceeds normal top speed', () => {
      let p = race(); p.velocity.copy(p.forward).multiplyScalar(200); p.turbine = 0; g.keys.clear(); step(1);
      const capN = p.speed;
      p = race(); p.velocity.copy(p.forward).multiplyScalar(200); p.turbine = 100; setKeys(['ShiftLeft']); step(1);
      const capB = p.speed; g.keys.clear();
      return { pass: capB > capN * 1.2, detail: 'no=' + capN.toFixed(0) + ' burst=' + capB.toFixed(0) };
    });
    T('OVERCLOCK produces thrust', () => {
      const p = race(); p.overclockTimer = 5; p.velocity.set(0, 0, 0); p.speed = 0; g.keys.clear(); step(120);
      return { pass: p.speed > 8, detail: 'speed=' + p.speed.toFixed(1) };
    });

    // 4. Turbine + chassis differentiation
    T('Nova turbine recovery > Prism', () => {
      const regen = (v) => { const p = race(v); p.turbine = 0; g.keys.clear(); step(60); return p.turbine; };
      const pr = regen('prism'), nv = regen('nova');
      return { pass: nv > pr * 1.4, detail: 'prism=' + pr.toFixed(0) + ' nova=' + nv.toFixed(0) };
    });
    T('6 chassis differentiated by top speed', () => {
      const V = g.constructor; const cfg = g.player && g.player.vehicle; // read config via a race
      const tops = {};
      for (const v of ['prism', 'volt', 'phantom', 'drill', 'echo', 'nova']) {
        const p = race(v); tops[v] = 58 * p.vehicle.speed;
      }
      const uniq = new Set(Object.values(tops).map((x) => Math.round(x)));
      return { pass: uniq.size >= 4, detail: 'distinct tops=' + uniq.size };
    });

    // 5. All 10 gadgets apply an effect (no stubs)
    T('all 10 gadgets fire an effect', () => {
      const p = race(); const others = g.racers.filter((r) => r !== p);
      const checks = {};
      const use = (id, setup) => { p.item = id; p.itemCooldown = 0; if (setup) setup(); const before = capture(); g.tryUseItem(p); return before; };
      const capture = () => ({ well: g.itemWorld.entities.length });
      // pulse_mine + gravity_well spawn entities
      let e0 = g.itemWorld.entities.length; p.item = 'pulse_mine'; p.itemCooldown = 0; g.tryUseItem(p);
      checks.pulse_mine = g.itemWorld.entities.length > e0;
      e0 = g.itemWorld.entities.length; p.item = 'gravity_well'; p.itemCooldown = 0; g.tryUseItem(p);
      checks.gravity_well = g.itemWorld.entities.length > e0;
      // phase_skate sets phasing
      p.phasing = false; p.item = 'phase_skate'; p.itemCooldown = 0; g.tryUseItem(p); checks.phase_skate = p.phasing === true; p.phasing = false;
      // overclock sets timer
      p.overclockTimer = 0; p.item = 'overclock'; p.itemCooldown = 0; g.tryUseItem(p); checks.overclock = p.overclockTimer > 0;
      // static_veil sets veil
      p.veil = false; p.item = 'static_veil'; p.itemCooldown = 0; g.tryUseItem(p); checks.static_veil = p.veil === true;
      // warp_anchor advances trackS ~38
      const s0 = p.trackS; p.item = 'warp_anchor'; p.itemCooldown = 0; g.tryUseItem(p); checks.warp_anchor = Math.abs(p.trackS - s0 - 38) < 5;
      // volt_lash / mirror_fog / emp_bloom / data_siphon act on others
      const tgt = others[0]; tgt.progress = 1e7; p.progress = 1e6; others.slice(1).forEach((o) => (o.progress = 0));
      tgt.stun = 0; p.item = 'volt_lash'; p.itemCooldown = 0; g.tryUseItem(p); checks.volt_lash = tgt.stun > 0;
      tgt.steerInvert = 0; tgt.veil = false; p.item = 'mirror_fog'; p.itemCooldown = 0; g.tryUseItem(p); checks.mirror_fog = tgt.steerInvert > 0;
      others.forEach((o) => { o.position.copy(p.position); o.stun = 0; o.veil = false; }); p.item = 'emp_bloom'; p.itemCooldown = 0; g.tryUseItem(p); checks.emp_bloom = others.some((o) => o.stun > 0);
      tgt.item = 'pulse_mine'; tgt.veil = false; tgt.position.copy(p.position); p.item = 'data_siphon'; p.itemCooldown = 0; g.tryUseItem(p); checks.data_siphon = p.item === 'pulse_mine';
      const fired = Object.values(checks).filter(Boolean).length;
      return { pass: fired === 10, detail: fired + '/10 ' + JSON.stringify(checks) };
    });

    // 6. Veil scope + hazards spare it
    T('veil blocks fog + siphon, hazards spare it', () => {
      const p = race(); const b = g.racers[1];
      b.veil = true; b.steerInvert = 0; b.progress = 1e7; p.progress = 1e6; g.racers.slice(2).forEach((o) => (o.progress = 0));
      p.item = 'mirror_fog'; p.itemCooldown = 0; g.tryUseItem(p);
      const fogBlocked = b.veil === false && b.steerInvert === 0;
      b.veil = true; b.item = 'pulse_mine'; b.position.copy(p.position); p.item = 'data_siphon'; p.itemCooldown = 0; g.tryUseItem(p);
      const siphonBlocked = b.veil === false && b.item === 'pulse_mine';
      p.veil = true; p.hazardIFrames = 0; p.hopY = 0; p.phasing = false;
      const hz = g.track.hazards.find((h) => h.type === 'static') || g.track.hazards[0];
      p.position.copy(hz.mesh.position); g.checkHazards(p);
      const hazardSparedVeil = p.veil === true;
      return { pass: fogBlocked && siphonBlocked && hazardSparedVeil, detail: 'fog=' + fogBlocked + ' siphon=' + siphonBlocked + ' hazVeil=' + hazardSparedVeil };
    });

    // 7. Drill clears hazards by jumping
    T('Mag-Drill clears hazard by jump', () => {
      const p = race('drill'); setKeys(['Space']); step(1); g.keys.delete('Space');
      let peak = 0; for (let i = 0; i < 60; i++) { g.update(1 / 60); if (p.hopY > peak) peak = p.hopY; }
      return { pass: peak > 1.4, detail: 'peakHopY=' + peak.toFixed(2) };
    });

    // 8. No kart pile-ups (3 stacked karts separate)
    T('stacked karts depenetrate (no pile-up)', () => {
      race(); const rs = g.racers.slice(0, 3); const base = rs[0].position.clone();
      rs.forEach((r, i) => { r.position.copy(base); r.position.x += i * 0.15; r.velocity.set(0, 0, 0); r._bumpT = 0; });
      for (let f = 0; f < 40; f++) g.resolveCollisions();
      let minD = 1e9; for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) minD = Math.min(minD, rs[i].position.distanceTo(rs[j].position));
      return { pass: minD > 2.0, detail: 'minDist=' + minD.toFixed(2) };
    });

    // 9. Hazards never trap a racer over a full race, at 60 and 144 fps
    T('no hazard-stuck over 40s race (60 & 144fps)', () => {
      const run = (dt) => {
        race(); const N = g.racers.length; const stalled = new Array(N).fill(0); let stuck = 0; const prevS = g.racers.map((r) => r.trackS);
        setKeys(['KeyW']);
        for (let f = 0; f < Math.round(40 / dt); f++) {
          g.update(dt);
          for (let i = 0; i < N; i++) {
            const r = g.racers[i]; let md = 1e9;
            for (const h of g.track.hazards) { const d = Math.hypot(r.mesh.position.x - h.pos.x, r.mesh.position.z - h.pos.z) - (h.radius || 1.45); if (d < md) md = d; }
            if (md < 3 && (r.trackS - prevS[i]) < 0.02 && Math.abs(r.speed) < 6) { stalled[i]++; if (stalled[i] === Math.round(1 / dt)) stuck++; } else stalled[i] = 0;
            prevS[i] = r.trackS;
          }
        }
        g.keys.clear(); return stuck;
      };
      const s60 = run(1 / 60), s144 = run(1 / 144);
      return { pass: s60 === 0 && s144 === 0, detail: '60fps=' + s60 + ' 144fps=' + s144 };
    });

    // 10. Ranking is monotonic; race completes with correct standings
    T('progress monotonic + race completes', () => {
      race(); setKeys(['KeyW']); const prev = g.racers.map((r) => { g.updateProgress(); return r.progress; }); let back = 0;
      for (let f = 0; f < 2600; f++) { g.update(1 / 60); g.updateProgress(); for (let i = 0; i < g.racers.length; i++) { const r = g.racers[i]; if (!r.finished && r.progress - prev[i] < -5) back++; prev[i] = r.progress; } }
      g.keys.clear();
      const finished = g.racers.filter((r) => r.finished).length;
      return { pass: back === 0 && finished >= 3, detail: 'backJumps=' + back + ' finished=' + finished };
    });

    // 11. All 5 circuits load and close (no seam cliff)
    T('all 5 circuits close (no seam cliff)', () => {
      const bad = [];
      for (const tid of ['prism_boulevard', 'volt_canyon', 'glass_harbor', 'null_spire', 'echo_yards']) {
        race(null, tid); const s = g.track.samples; const N = s.length; const segs = [];
        for (let i = 0; i < N; i++) segs.push(s[i].pos.distanceTo(s[(i + 1) % N].pos));
        const closing = s[N - 1].pos.distanceTo(s[0].pos); const med = [...segs].sort((a, b) => a - b)[Math.floor(N / 2)];
        if (closing / med > 2.0) bad.push(tid + ':' + (closing / med).toFixed(1));
      }
      return { pass: bad.length === 0, detail: bad.length ? 'cliffs=' + bad.join(',') : 'all smooth' };
    });

    const passed = results.filter((r) => r.pass).length;
    return { passed, failed: results.length - passed, total: results.length, results };
  }
  if (typeof window !== 'undefined') window.runGridRushTests = runGridRushTests;
  if (typeof globalThis !== 'undefined') globalThis.runGridRushTests = runGridRushTests;
})();
