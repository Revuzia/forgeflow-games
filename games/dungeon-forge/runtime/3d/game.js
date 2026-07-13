/**
 * Dungeon Forge — runtime/3d/game.js
 * The App orchestrator: owns the scene, theme ambience, mode lifecycle
 * (menu → builder ⇄ escape), the shared session (multiplayer), and the main
 * loop. Exposes window.__DF__ test hooks (FFG preview-verification rule).
 */
import * as THREE from "three";

const V = new URL(import.meta.url).search;
const [{ Assets }, { Builder }, { Escape }, { Hud }, { Menu }, { Fx }, { GameAudio }, DModel] = await Promise.all([
  import("./assets.js" + V), import("./builder.js" + V), import("./escape.js" + V),
  import("./hud.js" + V), import("./menu.js" + V), import("./fx.js" + V), import("./audio.js" + V),
  import("../sim/dungeon.js" + V),
]);

export const THEME_LOOK = {
  fantasy: {
    bg: 0x0b0910, fog: 0x120e18, fogDensity: 0.016,
    ambient: 0x4a4462, ambientI: 1.0, hemi: 0x6a5878, ground: 0x2c2436, hemiI: 0.62,
    torch: 0xff9a3c, torchI: 38, accent: "#ffb347", accent2: "#7d5fff",
    portal: 0x8f6bff, buildAmbient: 1.05,
  },
  scifi: {
    bg: 0x040a12, fog: 0x0a1420, fogDensity: 0.015,
    ambient: 0x3a5570, ambientI: 1.02, hemi: 0x4d7a92, ground: 0x1a2632, hemiI: 0.62,
    torch: 0x37e0ff, torchI: 34, accent: "#37e0ff", accent2: "#ff3d81",
    portal: 0x22ffcc, buildAmbient: 1.05,
  },
};

export class Game {
  constructor(env) {
    Object.assign(this, env); // THREE, renderer, scene, camera, composer, bloom, container, content, V
    this.assets = new Assets();
    this.mode = null;           // "menu" | "build" | "escape"
    this.session = null;        // forgenet Session (null offline)
    this.clock = new THREE.Clock();
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this._audit = [];
  }

  audit(msg) { this._audit.push(msg); if (this._audit.length > 200) this._audit.shift(); }

  async init() {
    // industry-standard settings, persisted per browser
    this.settings = Object.assign({
      music: 0.7, sfx: 0.8, sens: 1.0, invertY: false, quality: "high", fps: false,
    }, safeParse(localStorage.getItem("df_settings")));

    this.hud = new Hud(this);
    this.audio = new GameAudio(this);
    this.fx = new Fx(this);
    this.menu = new Menu(this);
    this.builder = new Builder(this);
    this.escape = new Escape(this);
    this.applySettings();

    // lights rig (theme-tinted in applyTheme)
    this.ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 0.4);
    this.keyLight = new THREE.DirectionalLight(0xffffff, 0.55);
    this.keyLight.position.set(30, 60, 20);
    this.scene.add(this.ambient, this.hemi, this.keyLight);
    this.applyTheme("fantasy", "menu");

    // test hooks
    window.__DF__ = {
      game: this, THREE,
      model: DModel,
      get builder() { return this._b || null; },
      get escape() { return this._e || null; },
      audit: () => this._audit,
    };
    window.__THREE__ = THREE;
    this.audit("init");
  }

  applyTheme(theme, mode) {
    const L = THEME_LOOK[theme] || THEME_LOOK.fantasy;
    this.look = L;
    this.theme = theme;
    this.scene.background = new THREE.Color(L.bg);
    const build = mode === "build";
    this.scene.fog = build ? null : new THREE.FogExp2(L.fog, L.fogDensity);
    this.ambient.color.set(L.ambient); this.ambient.intensity = build ? L.buildAmbient : L.ambientI;
    this.hemi.color.set(L.hemi); this.hemi.groundColor.set(L.ground); this.hemi.intensity = build ? 0.75 : L.hemiI;
    this.keyLight.intensity = build ? 0.85 : 0.18;
    if (this.bloom) this.bloom.strength = build ? 0.35 : 0.85;
    document.documentElement.style.setProperty("--df-accent", L.accent);
    document.documentElement.style.setProperty("--df-accent2", L.accent2);
  }

  applySettings() {
    const s = this.settings;
    localStorage.setItem("df_settings", JSON.stringify(s));
    this.audio.setVolumes(s.music, s.sfx);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, s.quality === "high" ? 1.5 : 1.0));
    if (this.bloom) this.bloom.enabled = s.quality !== "low";
    // fps counter
    if (s.fps && !this._fpsEl) {
      this._fpsEl = document.createElement("div");
      this._fpsEl.className = "df-fps";
      this._fpsEl.textContent = "-- fps";
      this.container.appendChild(this._fpsEl);
    } else if (!s.fps && this._fpsEl) { this._fpsEl.remove(); this._fpsEl = null; }
  }

  /** Shared settings modal — reachable from menu, builder and the pause overlay. */
  showSettings(onClose) {
    const s = this.settings;
    const row = (label, inner) => `<div class="df-setrow"><span>${label}</span>${inner}</div>`;
    this.hud.modal(`<h3>⚙ Settings</h3>
      ${row("Music volume", `<input type="range" min="0" max="100" value="${Math.round(s.music * 100)}" data-a="music">`)}
      ${row("SFX volume", `<input type="range" min="0" max="100" value="${Math.round(s.sfx * 100)}" data-a="sfx">`)}
      ${row("Mouse sensitivity", `<input type="range" min="30" max="220" value="${Math.round(s.sens * 100)}" data-a="sens">`)}
      ${row("Invert Y", `<div class="df-toggle ${s.invertY ? "on" : ""}" data-a="invy"></div>`)}
      ${row("Quality", `<select class="df-diff" data-a="qual">
        <option value="high" ${s.quality === "high" ? "selected" : ""}>High (bloom)</option>
        <option value="med" ${s.quality === "med" ? "selected" : ""}>Medium</option>
        <option value="low" ${s.quality === "low" ? "selected" : ""}>Low (no bloom)</option></select>`)}
      ${row("FPS counter", `<div class="df-toggle ${s.fps ? "on" : ""}" data-a="fpsc"></div>`)}
      <div class="df-selrow" style="margin-top:14px"><button data-a="done" class="df-btn accent" style="flex:1">Done</button></div>`,
      (m) => {
        m.querySelector('[data-a="music"]').oninput = (e) => { s.music = e.target.value / 100; this.applySettings(); };
        m.querySelector('[data-a="sfx"]').oninput = (e) => { s.sfx = e.target.value / 100; this.applySettings(); this.audio.sfx("ui"); };
        m.querySelector('[data-a="sens"]').oninput = (e) => { s.sens = e.target.value / 100; this.applySettings(); };
        m.querySelector('[data-a="invy"]').onclick = (e) => { s.invertY = !s.invertY; e.target.classList.toggle("on", s.invertY); this.applySettings(); };
        m.querySelector('[data-a="qual"]').onchange = (e) => { s.quality = e.target.value; this.applySettings(); };
        m.querySelector('[data-a="fpsc"]').onclick = (e) => { s.fps = !s.fps; e.target.classList.toggle("on", s.fps); this.applySettings(); };
        m.querySelector('[data-a="done"]').onclick = () => { this.hud.closeModal(); if (onClose) onClose(); };
      });
  }

  clearWorld() {
    while (this.world.children.length) this.world.remove(this.world.children[0]);
    this.fx.reset();
  }

  /** Switch top-level mode. payload varies per mode. */
  async setMode(mode, payload) {
    this.audit("setMode:" + mode);
    const prev = this.mode;
    if (prev === "build") this.builder.exit();
    if (prev === "escape") this.escape.exit();
    if (prev === "menu") this.menu.hide();
    this.clearWorld();
    this.mode = mode;
    if (mode === "menu") { this.applyTheme(this.theme || "fantasy", "menu"); this.menu.show(payload); this.audio.music("menu"); }
    if (mode === "build") {
      this.applyTheme(payload.dungeon.theme, "build");
      await this.builder.enter(payload.dungeon, payload);
      window.__DF__._b = this.builder;
      this.audio.music("build");
    }
    if (mode === "escape") {
      this.applyTheme(payload.dungeon.theme, "escape");
      await this.escape.enter(payload.dungeon, payload);
      window.__DF__._e = this.escape;
      this.audio.music(payload.dungeon.theme);
    }
  }

  start() {
    let fpsAcc = 0, fpsN = 0, fpsT = 0;
    // F3 = debug toggle: forces the fps counter on + a debug readout line
    // (works regardless of the settings toggle — owner: "F3 debug doesn't work").
    // F3 = a proper top-left dev DEBUG panel (multi-line: perf + player + world),
    // separate from the plain settings FPS counter (bottom-right).
    window.addEventListener("keydown", (e) => {
      if (e.code !== "F3") return;
      e.preventDefault();
      this._debug = !this._debug;
      if (this._debug && !this._dbgEl) {
        this._dbgEl = document.createElement("div");
        this._dbgEl.className = "df-dbg";
        this._dbgEl.textContent = "F3 DEBUG …";
        this.container.appendChild(this._dbgEl);
      } else if (!this._debug && this._dbgEl) { this._dbgEl.remove(); this._dbgEl = null; }
    });
    let dbgLo = 999;
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.1, this.clock.getDelta());
      if (this._dbgEl) { const inst = dt > 0 ? 1 / dt : 0; if (inst < dbgLo) dbgLo = inst; }
      if (this._fpsEl || this._dbgEl) {
        fpsAcc += dt; fpsN++;
        if ((fpsT += dt) > 0.5) {
          const fps = Math.round(fpsN / fpsAcc);
          if (this._fpsEl) this._fpsEl.textContent = fps + " fps";
          if (this._dbgEl) {
            const inf = this.renderer.info.render, mem = this.renderer.info.memory;
            const dpr = this.renderer.getPixelRatio().toFixed(2);
            const p = this.mode === "escape" && this.escape && this.escape.run ? this.escape.me() : null;
            let s = `FPS ${fps}  (low ${Math.round(dbgLo)})   mode ${this.mode}\n`;
            s += `draws ${inf.calls}  tris ${(inf.triangles / 1000).toFixed(1)}k\n`;
            s += `geo ${mem.geometries}  tex ${mem.textures}  dpr ${dpr}  q ${this.settings.quality}`;
            if (p) {
              const foes = this.escape.run.enemies.filter((x) => x.alive);
              const aggro = foes.filter((x) => x.state === "chase").length;
              s += `\npos (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) F${p.f + 1}  yaw ${p.yaw.toFixed(2)}\n`;
              s += `hp ${Math.round(p.hp)}/${p.maxHp}  lvl ${p.level}  mana ${Math.round(p.mana || 0)}\n`;
              s += `foes ${foes.length} (chasing ${aggro})  t ${this.escape.run.time.toFixed(1)}s`;
            }
            this._dbgEl.textContent = s;
          }
          fpsAcc = 0; fpsN = 0; fpsT = 0; dbgLo = 999;
        }
      }
      try {
        if (this.mode === "build") this.builder.update(dt);
        else if (this.mode === "escape") this.escape.update(dt);
        else if (this.menu) this.menu.update(dt);
        this.fx.update(dt);
        if (this.session) this.session.frame(dt);
      } catch (e) { console.error("[DF] update", e); this.audit("ERR:" + e.message); }
      this.composer.render();
    };
    loop();
    this.setMode("menu");
  }
}

function safeParse(s) { try { return JSON.parse(s) || {}; } catch (e) { return {}; } }
