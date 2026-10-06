// In-page probe library for the independent render verification (injected with page.evaluate; imports the game modules from the
// running Vite dev server; never touches repo files). Exposes window.__V__.
(async () => {
  const ST = await import('/src/render/stage.ts');
  const GN = await import('/src/core/genome.ts');
  const CAT = await import('/src/data/catalog.ts');
  const CR = await import('/src/render/ceremony.ts');
  const MG = await import('/src/core/merge.ts');
  let SB = null, sbErr = null;
  try { SB = (await import('/src/physics/softbody.ts')).SoftBody; } catch (e) { sbErr = String(e); }
  const Stub = (await import('/src/render/stubBody.ts')).StubBody;
  const errors = [];
  window.addEventListener('error', (e) => errors.push('error: ' + e.message));
  window.addEventListener('unhandledrejection', (e) => errors.push('unhandledrejection: ' + String(e.reason)));
  let useStub = false;
  const mkBody = (g) => (SB && !useStub ? new SB(g) : new Stub(g));
  const LUT = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  const TI = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

  const V = {
    errors, sbErr, get real() { return !!SB && !useStub; }, setStub(on) { useStub = !!on; },
    GN, CAT, CR, MG, ST, mkBody, TI,
    ctx: null,
    /** Fresh canvas + stage (disposes the previous one). */
    newStage(w, h, quality = 'med', dpr = 1, genome = null) {
      if (V.ctx) { try { V.ctx.stage.dispose(); } catch (e) { errors.push('dispose threw ' + e); } V.ctx.canvas.remove(); }
      const canvas = document.createElement('canvas');
      canvas.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px;z-index:10`;
      document.body.appendChild(canvas);
      const stage = ST.createStageDev(canvas);
      stage.resize(w, h, dpr);
      stage.setQuality(quality);
      const g = genome ?? GN.genomeFromParam('');
      const play = mkBody(g);
      stage.setBody(play, g);
      const rc = document.createElement('canvas');
      const rx = rc.getContext('2d', { willReadFrequently: true });
      V.ctx = { canvas, stage, play, time: 0, w, h, rc, rx, frameNo: 0 };
      return true;
    },
    frame(dt = 1 / 60, render = true) {
      const c = V.ctx;
      if (c.play) c.play.step(dt);
      c.time += dt; c.frameNo++;
      c.stage.update(dt, { time: c.time, pointerNdc: null });
      if (render) c.stage.render();
    },
    frames(n, dt = 1 / 60, render = false) { for (let i = 0; i < n; i++) V.frame(dt, render || i === n - 1); },
    /** Luminance statistics of the canvas right now (call in the same task as render()). */
    lum() {
      const c = V.ctx, W = c.canvas.width, H = c.canvas.height;
      if (c.rc.width !== W || c.rc.height !== H) { c.rc.width = W; c.rc.height = H; }
      c.rx.clearRect(0, 0, W, H);
      c.rx.drawImage(c.canvas, 0, 0);
      const d = c.rx.getImageData(0, 0, W, H).data;
      let s = 0; const q = [0, 0, 0, 0, 0], qn = [0, 0, 0, 0, 0]; const cr = [0, 0, 0]; let cn = 0, red = 0, maxPix = 0;
      // 3x3 grid (each cell ~11% of the frame) for local flashes, plus the global mean
      const g9 = new Float64Array(9), g9n = new Float64Array(9);
      for (let y = 0; y < H; y += 1) {
        const gy = Math.min(2, Math.floor((y * 3) / H));
        for (let x = 0; x < W; x += 1) {
          const i = (y * W + x) * 4;
          const R = LUT[d[i]], G = LUT[d[i + 1]], B = LUT[d[i + 2]];
          const l = 0.2126 * R + 0.7152 * G + 0.0722 * B;
          s += l;
          const gx = Math.min(2, Math.floor((x * 3) / W)); const k = gy * 3 + gx; g9[k] += l; g9n[k]++;
          if (x > W * 0.3 && x < W * 0.7 && y > H * 0.25 && y < H * 0.75) { cr[0] += R; cr[1] += G; cr[2] += B; cn++; }
          const sum = R + G + B; if (sum > 0.05 && R / sum >= 0.8) red++;
          if (l > maxPix) maxPix = l;
        }
      }
      const n = W * H;
      return { L: s / n, g9: Array.from(g9, (v, k) => v / g9n[k]), crgb: cr.map((v) => v / Math.max(1, cn)), red: red / n, maxPix };
    },
    fingerprint(w = 48, h = 36) {
      const c = V.ctx; c.stage.render();
      const cc = document.createElement('canvas'); cc.width = w; cc.height = h;
      const x = cc.getContext('2d', { willReadFrequently: true }); x.drawImage(c.canvas, 0, 0, w, h);
      return Array.from(x.getImageData(0, 0, w, h).data);
    },
    png() { V.ctx.stage.render(); return V.ctx.canvas.toDataURL('image/png'); },
    resultGenome(tier) { return GN.genomeFromParam(String(['', '2', '5', '19', '16', '8'][TI.indexOf(tier)] ?? '')); },
    /** A realistic in-play merge spec: MERGE_COST parents of ONE species of `parentTier`, result a species of `tier` with lineage. */
    playMergeSpec(parentTier, tier, n = 2, seed = 7) {
      const sp = CAT.speciesInTier(parentTier)[seed % CAT.speciesInTier(parentTier).length];
      const parents = Array.from({ length: n }, (_, k) => ({ genome: CAT.speciesBaseGenome(sp.id, seed * 31 + k + 1), tier: parentTier }));
      const rs = CAT.speciesInTier(tier)[(seed * 7) % CAT.speciesInTier(tier).length];
      const tmpl = CAT.speciesBaseGenome(rs.id, seed * 131 + 9);
      const g = MG.lineageGenome(tmpl, parents.map((p) => p.genome), seed);
      return { parents, result: { genome: g, tier, tierUp: TI.indexOf(tier) > TI.indexOf(parentTier), isNew: true }, parentSpecies: sp.id, resultSpecies: rs.id };
    },
    /**
     * Run one ceremony the way the shell would: (capsule) drop + land + 0.5 s squeeze first, then the reveal; record per-frame luminance.
     * Afterwards adopt the result as the play body.
     */
    async run(o) {
      const c = V.ctx, st = c.stage, dt = o.dt ?? 1 / 60;
      st.setCalmEffects(!!o.calm);
      const beats = [];
      const hooks = { onBeat(b, info) { beats.push({ beat: b, t: info.t, tier: info.tier, frame: c.frameNo }); if (o.throwInHook) throw new Error('hook boom'); } };
      let cap;
      if (o.kind === 'capsule' && !o.noDrop) {
        cap = st.dropCapsule({});
        let k = 0; while (!cap.landed && k < 240) { V.frame(dt, false); k++; }
        V.frames(20, dt);
        for (let i = 0; i < Math.round(0.5 / dt); i++) { cap.setSqueeze((i * dt) / 0.5); V.frame(dt, false); }
      }
      const rec = [];
      if (o.preRecord) for (let i = 0; i < o.preRecord; i++) { V.frame(dt); rec.push({ f: -1, ...V.lum() }); }
      const createBody = o.createBody ?? mkBody;
      let h;
      if (o.kind === 'capsule') h = st.playCapsuleReveal({ result: { genome: o.genome ?? V.resultGenome(o.tier), tier: o.tier, isNew: true }, createBody, capsule: cap, quick: !!o.quick, keepCurrent: !!o.keepCurrent }, hooks);
      else {
        const spec = o.spec ?? { parents: ['', '3', '8'].slice(0, o.parents ?? 2).map((s) => ({ genome: GN.genomeFromParam(s), tier: 'common' })), result: { genome: V.resultGenome(o.tier), tier: o.tier, tierUp: !!o.tierUp, isNew: true } };
        h = st.playMergeCeremony({ ...spec, createBody }, hooks);
      }
      let f = 0, skippedAt = -1, resultHidden = 0, maxLight = 0;
      const shots = {};
      while (h.active && f < 4000) {
        if (o.skipAt !== undefined && skippedAt < 0 && f * dt >= o.skipAt) { h.skip(); skippedAt = f; }
        if (o.at) for (const [name, tt] of Object.entries(o.at)) if (shots[name] === undefined && f * dt >= tt) { shots[name] = V.png(); }
        if (o.onFrame) o.onFrame(f, h);
        V.frame(dt, o.record !== false);
        if (o.record !== false) rec.push({ f, ...V.lum(), light: st.info.screenLight });
        maxLight = Math.max(maxLight, st.info.screenLight);
        if (skippedAt >= 0) { const rv = st.views.find((v) => v.id === h.resultBodyId); if (!rv || !rv.visible) resultHidden++; }
        f++;
      }
      const activeFrames = f;
      let doneResolved = false; await Promise.race([h.done.then(() => { doneResolved = true; }), new Promise((r) => setTimeout(r, 300))]);
      if (h.resultBody) c.play = h.resultBody;
      for (let i = 0; i < (o.settle ?? 0); i++) { V.frame(dt, o.record !== false); if (o.record !== false) rec.push({ f: f + i, ...V.lum(), light: st.info.screenLight }); }
      return {
        rec, beats, activeFrames, seconds: activeFrames * dt, duration: h.duration, skippedAt, resultHidden, doneResolved, maxLight, shots,
        stats: { ...(h.stats ?? {}) }, bodies: st.info.bodies, primaryIsResult: st.primaryBodyId() === h.resultBodyId, resultBodyId: h.resultBodyId,
        info: { ceremony: st.info.ceremony, capsule: st.info.capsule, screenLight: st.info.screenLight, particles: st.info.particles },
      };
    },
    mem() { const m = V.ctx.stage.memory(); return { geometries: m.geometries, textures: m.textures, programs: m.programs, sceneChildren: V.ctx.stage.scene.children.length, bodies: V.ctx.stage.info.bodies }; },
  };
  window.__V__ = V;
  return { real: !!SB, sbErr };
})()
