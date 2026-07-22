import { PAINT_TOOLS } from "./paint.js";
/**
 * CHROMA HIDE — runtime/paint_ui.js
 * The paint HUD panel: colour picker, metallic/roughness sliders, brush size,
 * saveable palette, and inspection buttons. Drives a PaintSystem. Built as a
 * standalone DOM overlay so both the M1 sandbox and the real hider prep phase
 * (M2) mount the same panel.
 */
export function createPaintPanel(paint, opts = {}) {
  const el = document.createElement("div");
  el.className = "chroma-paint-panel";
  el.style.cssText = [
    "position:absolute", "top:12px", "left:12px", "z-index:40",
    "width:214px", "padding:12px", "border-radius:12px",
    "background:rgba(14,18,26,0.86)", "backdrop-filter:blur(8px)",
    "box-shadow:0 6px 24px rgba(0,0,0,0.4)",
    "font-family:system-ui,-apple-system,sans-serif", "color:#e8eef7",
    "font-size:12px", "user-select:none", "pointer-events:auto",
  ].join(";");

  const H = (html) => { const d = document.createElement("div"); d.innerHTML = html; return d.firstElementChild; };
  const row = (label, node) => {
    const r = document.createElement("label");
    r.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;margin:7px 0;";
    const s = document.createElement("span"); s.textContent = label; s.style.cssText = "opacity:.8;white-space:nowrap;";
    r.appendChild(s); r.appendChild(node); return r;
  };

  el.appendChild(H(`<div style="font-weight:700;letter-spacing:.06em;font-size:12px;margin-bottom:6px;color:#7fe3c4">PAINT MODE</div>`));

  // Colour picker + big swatch
  const swatch = document.createElement("div");
  swatch.style.cssText = "width:100%;height:30px;border-radius:7px;border:1px solid rgba(255,255,255,.15);cursor:pointer;";
  const colorInput = document.createElement("input");
  colorInput.type = "color"; colorInput.value = paint.colorHex();
  colorInput.style.cssText = "position:absolute;opacity:0;width:0;height:0;";
  swatch.addEventListener("click", () => colorInput.click());
  colorInput.addEventListener("input", () => { paint.setColorHex(colorInput.value); refresh(); });
  // TOOL ROW — brush / spray / marker / sponge (also hotkeys 1-4)
  const toolLabel = document.createElement("div");
  toolLabel.textContent = "TOOL";
  toolLabel.style.cssText = "opacity:.65;font-size:9.5px;letter-spacing:.08em;margin:2px 0 4px;";
  el.appendChild(toolLabel);
  const toolRow = document.createElement("div");
  toolRow.style.cssText = "display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-bottom:6px;";
  const toolBtns = {};
  Object.values(PAINT_TOOLS).forEach((t, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = `${t.label}`; b.title = `${t.label} (${i + 1})`;
    b.style.cssText = "border:1px solid rgba(255,255,255,.14);border-radius:6px;padding:5px 2px;cursor:pointer;font-size:10px;background:rgba(255,255,255,.06);color:#dfe7f2;";
    b.addEventListener("click", () => { paint.setTool(t.id); refresh(); });
    toolBtns[t.id] = b; toolRow.appendChild(b);
  });
  el.appendChild(toolRow);
  const syncTools = () => {
    const cur = paint.getTool().id;
    for (const [id, b] of Object.entries(toolBtns)) {
      b.style.background = id === cur ? "rgba(127,227,196,.24)" : "rgba(255,255,255,.06)";
      b.style.color = id === cur ? "#bff5e4" : "#dfe7f2";
      b.style.borderColor = id === cur ? "rgba(127,227,196,.5)" : "rgba(255,255,255,.14)";
    }
  };

  el.appendChild(swatch); el.appendChild(colorInput);

  // "All colours" — opens the OS picker (full spectrum)
  const allBtn = document.createElement("button");
  allBtn.type = "button"; allBtn.textContent = "🎨  All colours…";
  allBtn.style.cssText = "width:100%;margin-top:6px;border:none;border-radius:6px;padding:7px;cursor:pointer;background:rgba(127,227,196,.16);color:#bff5e4;font-size:11px;font-weight:600;";
  allBtn.addEventListener("click", () => colorInput.click());
  el.appendChild(allBtn);

  // Quick palette — the shades you actually need to match this game's surfaces,
  // plus saturated accents. One click = ready to paint.
  const PRESETS = [
    "#ffffff", "#d8dce0", "#9aa0a6", "#6a7280", "#3f4348", "#14161a",
    "#8a5a34", "#b07a3a", "#c9a24a", "#e0b83a", "#8a6038", "#5c4a36",
    "#b8523a", "#c0453a", "#d83a3a", "#e07b39", "#e0951f", "#d94f8a",
    "#2fa36b", "#5f9a3a", "#3f9f57", "#2f7d3a", "#3a6ea5", "#3b6fb0",
    "#2f9e8f", "#8fa07a", "#bcd4e0", "#8791a1", "#7a4a5a", "#35406b",
  ];
  const palLabel = document.createElement("div");
  palLabel.textContent = "QUICK PALETTE";
  palLabel.style.cssText = "opacity:.65;font-size:9.5px;letter-spacing:.08em;margin:8px 0 4px;";
  el.appendChild(palLabel);
  const pal = document.createElement("div");
  pal.style.cssText = "display:grid;grid-template-columns:repeat(6,1fr);gap:3px;margin-bottom:2px;";
  for (const hex of PRESETS) {
    const b = document.createElement("button");
    b.type = "button"; b.title = hex;
    b.style.cssText = `height:17px;border-radius:4px;border:1px solid rgba(255,255,255,.14);cursor:pointer;background:${hex};`;
    b.addEventListener("click", () => { paint.setColorHex(hex); refresh(); });
    pal.appendChild(b);
  }
  el.appendChild(pal);
  syncTools();

  // Metallic / Roughness / Size sliders
  const mkSlider = (min, max, val, step, on) => {
    const i = document.createElement("input");
    i.type = "range"; i.min = min; i.max = max; i.step = step; i.value = val;
    i.style.cssText = "width:110px;accent-color:#7fe3c4;";
    i.addEventListener("input", () => on(parseFloat(i.value)));
    return i;
  };
  const metalS = mkSlider(0, 100, paint.brush.metal * 100, 1, (v) => { paint.setMetal(v / 100); });
  const roughS = mkSlider(0, 100, paint.brush.rough * 100, 1, (v) => { paint.setRough(v / 100); });
  const sizeS = mkSlider(2, Math.round(paint.res * 0.5), paint.brush.size, 1, (v) => { paint.setSize(v); });
  el.appendChild(row("Metallic", metalS));
  el.appendChild(row("Roughness", roughS));
  el.appendChild(row("Brush", sizeS));

  // Palette
  const palWrap = document.createElement("div");
  palWrap.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin:8px 0 4px;min-height:20px;";
  const saveBtn = mkBtn("＋ Save colour", () => { paint.savePaletteColor(); refresh(); });
  el.appendChild(palWrap); el.appendChild(saveBtn);

  // Action buttons
  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:5px;margin-top:8px;flex-wrap:wrap;";
  const btnDrop = mkBtn("Eyedrop · Space", () => opts.onEyedrop && opts.onEyedrop());
  // These used to advertise "3", "V" and "C". All three now do something else in paint
  // mode — 3 picks the marker, V is the camera flag, and C SPENDS A DECOY — so reading
  // the panel and pressing the key it names cost you a clone. Buttons only.
  const btnXray = mkBtn("X-ray", () => { const on = paint.toggleXray(); btnXray.style.background = on ? "#2b6b58" : ""; });
  const btnShadow = mkBtn("Shadow", () => { paint.toggleShadow(); });
  const btnClear = mkBtn("Clear paint", () => { if (confirm("Clear all paint? (no undo)")) { paint.clear(); refresh(); } });
  [btnDrop, btnXray, btnShadow, btnClear].forEach((b) => { b.style.flex = "1 1 46%"; actions.appendChild(b); });
  el.appendChild(actions);

  const hint = H(`<div style="margin-top:8px;opacity:.55;font-size:10.5px;line-height:1.4">Hold <b>LMB</b> paint · <b>Space</b> eyedrop · <b>RMB‑drag</b> brush size · <b>MMB‑drag</b> orbit · <b>wheel</b> zoom</div>`);
  el.appendChild(hint);

  function mkBtn(label, on) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = label;
    b.style.cssText = "border:none;border-radius:6px;padding:6px 8px;cursor:pointer;background:rgba(255,255,255,.09);color:#e8eef7;font-size:11px;transition:background .12s;";
    b.addEventListener("mouseenter", () => { if (!b.style.background.includes("2b6b58")) b.style.background = "rgba(255,255,255,.18)"; });
    b.addEventListener("mouseleave", () => { if (!b.style.background.includes("2b6b58")) b.style.background = "rgba(255,255,255,.09)"; });
    b.addEventListener("click", on);
    return b;
  }

  function refresh() {
    const hex = paint.colorHex();
    swatch.style.background = hex;
    colorInput.value = hex;
    metalS.value = Math.round(paint.brush.metal * 100);
    roughS.value = Math.round(paint.brush.rough * 100);
    sizeS.value = Math.round(paint.brush.size);
    palWrap.innerHTML = "";
    for (const h of paint.palette) {
      const sw = document.createElement("button");
      sw.title = h;
      sw.style.cssText = `width:18px;height:18px;border-radius:4px;border:1px solid rgba(255,255,255,.2);cursor:pointer;background:${h};`;
      sw.addEventListener("click", () => { paint.setColorHex(h); refresh(); });
      palWrap.appendChild(sw);
    }
  }

  refresh();
  return { el, refresh };
}
