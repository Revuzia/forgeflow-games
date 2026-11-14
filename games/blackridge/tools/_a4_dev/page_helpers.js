// dev helper (served by the local static servers): in-page test harness for the viewmodel pass.
//   await (await import('/games/blackridge/tools/_a4_dev/page_helpers.js')).init()
// then window.__H.* / window.__WD / window.__FPS__.vm._dbg(...)
export async function init() {
  for (let i = 0; i < 180; i++) {
    if (window.__FPS__ && window.__FPS__.__test) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  window.dispatchEvent(new Event("resize"));
  const F = window.__FPS__;
  const H = {
    t: F.__test,
    wait(ms) { return new Promise((r) => setTimeout(r, ms)); },
    async start() { await this.t.startMission({}); this.t.god(true); this.t.hideOverlays(); this.t.step(20); },
    async give(id) {
      const t = this.t;
      t.give(id);
      for (let i = 0; i < 80; i++) {
        t.step(3);
        await this.wait(30);
        if (F.vm.currentId === id && F.sim.state.player.weapon.state !== "switching") break;
      }
      t.step(75);
      return F.vm.currentId;
    },
    async cap(name, w = 1280, h = 720) {
      const r = await this.t.capture("presentation/" + name + ".png", w, h, { hudLayer: false });
      return r.server.split("\\").pop();
    },
    async ads(on, n = 70) { const t = this.t; if (on) t.pin("ads", true); else t.unpin("ads"); t.step(n); },
    // reload frames at progress list; returns file names
    async reloadFrames(prefix, ps, opts = {}) {
      const out = [];
      F.vm._dbg({ reloadP: 0, kind: opts.kind || null, empty: !!opts.empty, dur: opts.dur || 2.4 });
      for (const p of ps) {
        F.vm._dbg({ reloadP: p });
        this.t.step(opts.settle || 25);
        out.push(await this.cap(prefix + "_" + Math.round(p * 100), opts.w || 1280, opts.h || 720));
      }
      F.vm._dbg(null);
      this.t.step(30);
      return out;
    },
  };
  window.__H = H;
  window.__WD = await import("/games/blackridge/core/weapons/weapon_data.js");
  await H.start();
  return { id: F.vm.currentId, fb: window.__FFG_FALLBACKS__ || [], errs: (window.__BOOT_ERRORS__ || []).slice(0, 3) };
}
