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
    bg: 0x0b0910, fog: 0x0b0910, fogDensity: 0.030,
    ambient: 0x3a3450, ambientI: 0.62, hemi: 0x5a4a66, ground: 0x181018, hemiI: 0.35,
    torch: 0xff9a3c, torchI: 26, accent: "#ffb347", accent2: "#7d5fff",
    portal: 0x8f6bff, buildAmbient: 0.95,
  },
  scifi: {
    bg: 0x040a12, fog: 0x040a12, fogDensity: 0.028,
    ambient: 0x2a4458, ambientI: 0.66, hemi: 0x3d6a80, ground: 0x081018, hemiI: 0.38,
    torch: 0x37e0ff, torchI: 22, accent: "#37e0ff", accent2: "#ff3d81",
    portal: 0x22ffcc, buildAmbient: 0.95,
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
    this.hud = new Hud(this);
    this.audio = new GameAudio(this);
    this.fx = new Fx(this);
    this.menu = new Menu(this);
    this.builder = new Builder(this);
    this.escape = new Escape(this);

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
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.1, this.clock.getDelta());
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
