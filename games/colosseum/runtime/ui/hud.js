// Colosseum — the combat HUD.
//
// Design rule: during a fight the player's eyes are on the sand, not on the
// UI. So every element is readable in peripheral vision — big blocks of colour
// that change SHAPE, not small numbers you have to focus on to parse.
//
//   bottom-left   your vitals: health, stamina, shield integrity
//   top-centre    the opponent, named, with the crowd's mood above them
//   centre        state banners (SALUTE, the verdict) and nothing else, ever
//
// Stamina is the one bar that must never be ambiguous: it gates attacking and
// dodging, so it flashes when a swing would be refused.

const GOLD = "#d8ad4e";
const STONE = "#c9b891";
const BLOOD = "#8e2f22";

export class HUD {
  constructor(root) {
    this.root = root;
    this.el = document.createElement("div");
    this.el.id = "combat-hud";
    this.el.style.cssText = `position:absolute;inset:0;pointer-events:none;display:none;
      font-family:Georgia,'Times New Roman',serif;color:${STONE};z-index:20;user-select:none`;
    this.el.innerHTML = `
      <!-- opponent -->
      <div id="hd-foe" style="position:absolute;top:26px;left:50%;transform:translateX(-50%);
        text-align:center;width:520px;opacity:0;transition:opacity .35s">
        <div id="hd-crowd" style="height:4px;width:300px;margin:0 auto 9px;background:#241a10;border:1px solid rgba(216,173,78,.3)">
          <div id="hd-crowdbar" style="height:100%;width:50%;background:linear-gradient(90deg,#6b5a3a,${GOLD})"></div>
        </div>
        <div id="hd-foename" style="font-size:19px;letter-spacing:2px;color:${STONE}"></div>
        <div id="hd-foetitle" style="font-size:11px;letter-spacing:1px;color:#9c8760;font-style:italic;margin-top:1px"></div>
        <div style="height:9px;margin-top:7px;background:#1c1209;border:1px solid rgba(142,47,34,.6)">
          <div id="hd-foehp" style="height:100%;width:100%;background:linear-gradient(90deg,#6e2016,${BLOOD});transition:width .12s"></div>
        </div>
        <div id="hd-foesleft" style="font-size:10px;letter-spacing:2px;color:#8a7a5e;margin-top:5px"></div>
      </div>

      <!-- player vitals -->
      <div id="hd-me" style="position:absolute;left:30px;bottom:28px;width:330px;opacity:0;transition:opacity .35s">
        <div id="hd-myname" style="font-size:13px;letter-spacing:3px;color:#9c8760;margin-bottom:6px"></div>
        <div style="height:15px;background:#1c1209;border:1px solid rgba(216,173,78,.45)">
          <div id="hd-hp" style="height:100%;width:100%;background:linear-gradient(90deg,#8e2f22,#c4432c);transition:width .12s"></div>
        </div>
        <div style="height:8px;margin-top:5px;background:#141a0e;border:1px solid rgba(160,190,110,.35)">
          <div id="hd-stam" style="height:100%;width:100%;background:linear-gradient(90deg,#5d7a34,#93b84e);transition:width .08s"></div>
        </div>
        <div id="hd-shieldwrap" style="height:6px;margin-top:5px;background:#0f1418;border:1px solid rgba(150,170,190,.3);display:none">
          <div id="hd-shield" style="height:100%;width:100%;background:linear-gradient(90deg,#4a5a6b,#8fa5bb);transition:width .12s"></div>
        </div>
        <div id="hd-combo" style="font-size:12px;color:${GOLD};margin-top:6px;height:15px"></div>
      </div>

      <!-- centre banner -->
      <div id="hd-banner" style="position:absolute;top:38%;left:0;right:0;text-align:center;opacity:0;transition:opacity .4s">
        <div id="hd-bannermain" style="font-size:50px;font-weight:900;letter-spacing:9px;
          background:linear-gradient(180deg,#ffeec4,${GOLD} 55%,#a8471f);-webkit-background-clip:text;
          background-clip:text;color:transparent"></div>
        <div id="hd-bannersub" style="font-size:14px;letter-spacing:4px;color:#9c8760;margin-top:6px"></div>
      </div>

      <!-- wave / objective -->
      <div id="hd-wave" style="position:absolute;top:26px;right:30px;text-align:right;font-size:12px;
        letter-spacing:2px;color:#9c8760"></div>`;
    root.appendChild(this.el);

    this.q = (s) => this.el.querySelector(s);
    this._bannerT = 0;
    this._lastHp = 1;
    this.visible = false;
  }

  show() { this.visible = true; this.el.style.display = "block"; }
  hide() { this.visible = false; this.el.style.display = "none"; }

  banner(main, sub = "", seconds = 2.0) {
    this.q("#hd-bannermain").textContent = main;
    this.q("#hd-bannersub").textContent = sub;
    this.q("#hd-banner").style.opacity = "1";
    this._bannerT = seconds;
  }

  /**
   * @param {object} s the match's hudState()
   */
  update(s, dt = 0) {
    if (!this.visible || !s) return;

    if (this._bannerT > 0) {
      this._bannerT -= dt;
      if (this._bannerT <= 0) this.q("#hd-banner").style.opacity = "0";
    }

    // --- player ---------------------------------------------------------
    const me = s.player;
    const meEl = this.q("#hd-me");
    if (me) {
      meEl.style.opacity = "1";
      this.q("#hd-myname").textContent = (me.name || "").toUpperCase();
      const hpF = Math.max(0, me.hp / me.maxHp);
      this.q("#hd-hp").style.width = `${hpF * 100}%`;

      const stF = Math.max(0, me.stamina / me.maxStamina);
      const stEl = this.q("#hd-stam");
      stEl.style.width = `${stF * 100}%`;
      // Exhausted stamina is the most actionable state in the game — it gates
      // attacking and dodging — so it changes COLOUR, not just length.
      stEl.style.background = stF < 0.18
        ? "linear-gradient(90deg,#8a3a1e,#c46a2c)"
        : "linear-gradient(90deg,#5d7a34,#93b84e)";

      const shWrap = this.q("#hd-shieldwrap");
      if (me.shieldHp > 0 || me.shieldBroken) {
        shWrap.style.display = "block";
        this.q("#hd-shield").style.width = me.shieldBroken ? "0%" : `${Math.min(100, me.shieldHp)}%`;
      } else shWrap.style.display = "none";

      this.q("#hd-combo").textContent = me.combo > 1 ? `${me.combo}× COMBO` : "";
    } else meEl.style.opacity = "0";

    // --- opponent -------------------------------------------------------
    const foe = s.foe;
    const foeEl = this.q("#hd-foe");
    if (foe) {
      foeEl.style.opacity = "1";
      this.q("#hd-foename").textContent = (foe.name || "").toUpperCase();
      this.q("#hd-foetitle").textContent = foe.title || "";
      this.q("#hd-foehp").style.width = `${Math.max(0, (foe.hp / foe.maxHp) * 100)}%`;
      this.q("#hd-foesleft").textContent = s.foesLeft > 1 ? `${s.foesLeft} STILL STANDING` : "";
    } else foeEl.style.opacity = "0";

    // --- crowd ----------------------------------------------------------
    this.q("#hd-crowdbar").style.width = `${clampPct(s.crowdFavour * 100)}%`;

    // --- wave -----------------------------------------------------------
    this.q("#hd-wave").textContent = s.waves > 1 ? `WAVE ${s.wave} / ${s.waves}` : "";
  }

  dispose() { this.el.remove(); }
}

function clampPct(v) { return Math.max(0, Math.min(100, v)); }
