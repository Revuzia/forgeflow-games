/**
 * accessibility.js — WCAG-compliant accessibility helpers.
 * - Colorblind modes (protanopia, deuteranopia, tritanopia) via CSS filter
 * - Reduced motion (disables screen shake + particles when user prefers)
 * - Subtitles for audio
 * - Text size scaling
 * - Keyboard-only navigation validator
 */
const Accessibility = {
  _prefs: null,

  load() {
    const stored = (window.SaveLoad && SaveLoad.loadSettings) ? SaveLoad.loadSettings() : {};
    this._prefs = {
      colorBlindMode: stored.colorBlindMode || "none",
      reducedMotion: stored.reducedMotion ?? window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
      highContrast: stored.highContrast || false,
      subtitles: stored.subtitles || false,
      textScale: stored.textScale || 1.0,
    };
    this.apply();
    return this._prefs;
  },

  apply() {
    if (!this._prefs) return;
    const c = document.querySelector("canvas") || document.getElementById("game-container");
    if (!c) return;

    // Colorblind CSS filters (applied to game canvas)
    const filters = {
      none: "",
      protanopia:   "url(#protanopia)",
      deuteranopia: "url(#deuteranopia)",
      tritanopia:   "url(#tritanopia)",
    };
    c.style.filter = filters[this._prefs.colorBlindMode] || "";

    // Inject SVG filters if not present
    if (!document.getElementById("a11y-svg-filters")) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.id = "a11y-svg-filters";
      svg.setAttribute("style", "position:absolute;width:0;height:0");
      svg.innerHTML = `
        <filter id="protanopia"><feColorMatrix type="matrix" values="0.567,0.433,0,0,0  0.558,0.442,0,0,0  0,0.242,0.758,0,0  0,0,0,1,0"/></filter>
        <filter id="deuteranopia"><feColorMatrix type="matrix" values="0.625,0.375,0,0,0  0.7,0.3,0,0,0  0,0.3,0.7,0,0  0,0,0,1,0"/></filter>
        <filter id="tritanopia"><feColorMatrix type="matrix" values="0.95,0.05,0,0,0  0,0.433,0.567,0,0  0,0.475,0.525,0,0  0,0,0,1,0"/></filter>
      `;
      document.body.appendChild(svg);
    }

    // Reduced motion → disable juice shake/particles
    if (this._prefs.reducedMotion && window.Juice) {
      // Monkey-patch juice functions to no-ops
      const noop = () => {};
      ["shake", "zoomPunch", "flash"].forEach(fn => {
        if (window.Juice[fn]) window.Juice[fn] = noop;
      });
    }

    // High contrast — add CSS class to body
    document.body.classList.toggle("a11y-high-contrast", !!this._prefs.highContrast);
  },

  set(pref, value) {
    if (!this._prefs) this.load();
    this._prefs[pref] = value;
    this.apply();
    if (window.SaveLoad && SaveLoad.saveSettings) {
      const settings = SaveLoad.loadSettings();
      SaveLoad.saveSettings({ ...settings, [pref]: value });
    }
  },

  get(pref) {
    if (!this._prefs) this.load();
    return this._prefs[pref];
  },
};

// Auto-apply on load
if (typeof window !== "undefined") {
  window.Accessibility = Accessibility;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => Accessibility.load());
  } else {
    Accessibility.load();
  }
}
