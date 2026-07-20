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
  el.appendChild(swatch); el.appendChild(colorInput);

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
  const btnXray = mkBtn("X-ray · 3", () => { const on = paint.toggleXray(); btnXray.style.background = on ? "#2b6b58" : ""; });
  const btnShadow = mkBtn("Shadow · V", () => { paint.toggleShadow(); });
  const btnClear = mkBtn("Clear · C", () => { if (confirm("Clear all paint? (no undo)")) { paint.clear(); refresh(); } });
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
