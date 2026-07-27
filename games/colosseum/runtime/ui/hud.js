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
  /**
   * Floating damage numbers.
   *
   * The sim already computes a per-hit damage figure, a hit zone and whether
   * the blow was heavy, and none of it ever reached the player — a hit was a
   * health bar twitching somewhere in the corner. Numbers over the body are
   * what let someone learn that a thrust beats armour and a cut does not, or
   * that a galea is eating their head shots.
   *
   * DOM rather than sprites: text stays crisp at any resolution, costs zero
   * draw calls, and needs no font atlas. The only cost is projecting a world
   * point per number, which is one matrix multiply.
   *
   * @param {THREE.Vector3} world  where the blow landed
   * @param {number} amount        damage dealt
   * @param {object} opts { zone, heavy, mine } — `mine` colours the player's
   *                       own damage differently from what is done TO them
   */
  damage(world, amount, { zone = null, heavy = false, mine = true } = {}) {
    if (!this._dmgLayer) {
      this._dmgLayer = document.createElement("div");
      this._dmgLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden";
      this.el.appendChild(this._dmgLayer);
      this._dmg = [];
    }
    const d = document.createElement("div");
    const n = Math.round(amount);
    // The player's own damage reads gold; damage taken reads red, so a glance
    // tells you which way the fight is going without reading a number.
    const col = mine ? (heavy ? "#ffdf8a" : "#e8d5a8") : "#e0603c";
    const size = heavy ? 30 : 21;
    d.textContent = zone === "head" && heavy ? `${n}!` : `${n}`;
    d.style.cssText = `position:absolute;font-family:Georgia,serif;font-weight:700;
      font-size:${size}px;color:${col};text-shadow:0 2px 6px rgba(0,0,0,.9);
      transform:translate(-50%,-50%);will-change:transform,opacity`;
    this._dmgLayer.appendChild(d);
    // A little lateral drift so stacked hits do not overlap into a smear.
    this._dmg.push({ el: d, world: world.clone(), t: 0, life: 1.0,
                     drift: (Math.random() - 0.5) * 46, rise: 46 + Math.random() * 22 });
  }

  /** Advance floating numbers. Needs the camera to project. */
  _updateDamage(dt, camera) {
    if (!this._dmg || !this._dmg.length || !camera) return;
    const w = this.el.clientWidth, h = this.el.clientHeight;
    for (let i = this._dmg.length - 1; i >= 0; i--) {
      const n = this._dmg[i];
      n.t += dt;
      const k = n.t / n.life;
      if (k >= 1) { n.el.remove(); this._dmg.splice(i, 1); continue; }
      const p = n.world.clone().project(camera);
      // Behind the camera — hide rather than draw it mirrored on screen.
      if (p.z > 1) { n.el.style.display = "none"; continue; }
      n.el.style.display = "";
      const x = (p.x * 0.5 + 0.5) * w + n.drift * k;
      const y = (-p.y * 0.5 + 0.5) * h - n.rise * k;
      n.el.style.left = `${x}px`;
      n.el.style.top = `${y}px`;
      // Pop in, then fade out over the back half.
      n.el.style.opacity = k < 0.12 ? String(k / 0.12) : String(1 - (k - 0.12) / 0.88);
      const s = k < 0.12 ? 0.7 + 0.3 * (k / 0.12) : 1;
      n.el.style.transform = `translate(-50%,-50%) scale(${s})`;
    }
  }

  update(s, dt = 0, camera = null) {
    this._updateDamage(dt, camera);
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
