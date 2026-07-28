// Colosseum — title, ludus hub, match select, settings and results.
//
// Until now everything the game could do was reachable only through test hooks.
// This is the layer that makes it a game you can sit down in front of.
//
// FLOW:  title -> (new | continue) -> LUDUS HUB -> match select -> bout
//                                          ^                        |
//                                          +----- results ----------+
//
// The hub is the between-match room the reference games all have and is where
// gold actually gets spent: armoury, blacksmith, training, then the ladder.
// Everything composites over the live arena, so the Colosseum is always behind
// the menu rather than a flat background — which costs nothing, because the
// scene is already being rendered.

const GOLD = "#d8ad4e";
const STONE = "#c9b891";
const DIM = "#9c8760";
const FAINT = "#6f6047";

export const SCREEN = {
  TITLE: "title", HUB: "hub", MATCHES: "matches",
  SETTINGS: "settings", RESULTS: "results", CREDITS: "credits",
  PAUSE: "pause", NONE: "none",
};

const css = {
  panel: `background:rgba(10,7,4,.90);border:1px solid rgba(216,173,78,.30);`,
  btn: `display:block;width:100%;text-align:left;background:rgba(24,17,10,.72);
        border:1px solid rgba(216,173,78,.28);color:${STONE};padding:13px 17px;margin-bottom:9px;
        font-family:inherit;font-size:15px;letter-spacing:1px;cursor:pointer;transition:all .13s`,
  btnHover: `background:rgba(58,42,20,.9);border-color:${GOLD};color:${GOLD}`,
};

export class Menu {
  /**
   * @param {HTMLElement} root
   * @param {object} deps { inventory, audio, ladder, hooks }
   */
  constructor(root, { inventory, audio, ladder, hooks = {} } = {}) {
    this.root = root;
    this.inv = inventory;
    this.audio = audio;
    this.ladder = ladder || [];
    this.hooks = hooks;
    this.screen = SCREEN.NONE;
    this.lastResult = null;

    this.el = document.createElement("div");
    this.el.id = "menu";
    this.el.style.cssText = `position:absolute;inset:0;display:none;pointer-events:auto;z-index:50;
      font-family:Georgia,'Times New Roman',serif;color:${STONE};overflow-y:auto`;
    root.appendChild(this.el);
  }

  // -- helpers -------------------------------------------------------------

  _btn(label, sub, onClick, { disabled = false, accent = false } = {}) {
    const b = document.createElement("button");
    b.style.cssText = css.btn + (disabled ? "opacity:.4;cursor:not-allowed;" : "") +
      (accent ? `border-color:${GOLD};background:rgba(58,42,20,.75);` : "");
    b.innerHTML = `<span style="color:${disabled ? FAINT : accent ? GOLD : STONE}">${label}</span>` +
      (sub ? `<div style="font-size:11.5px;color:${FAINT};margin-top:3px;letter-spacing:0;font-style:italic">${sub}</div>` : "");
    if (!disabled) {
      b.onmouseenter = () => { b.style.cssText = css.btn + css.btnHover; if (this.audio) this.audio.play("click", { gain: 0.25 }); };
      b.onmouseleave = () => { b.style.cssText = css.btn + (accent ? `border-color:${GOLD};background:rgba(58,42,20,.75);` : ""); };
      b.onclick = () => { if (this.audio) this.audio.play("confirm", { gain: 0.5 }); onClick(); };
    }
    return b;
  }

  _shell(title, sub, bodyEl, { back = null } = {}) {
    this.el.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.style.cssText = `min-height:100%;display:flex;align-items:center;justify-content:center;
      background:linear-gradient(90deg,rgba(8,5,3,.93),rgba(8,5,3,.55) 30%,rgba(8,5,3,.55) 70%,rgba(8,5,3,.93));`;
    const card = document.createElement("div");
    card.style.cssText = `${css.panel}width:min(720px,92vw);padding:30px 34px;margin:40px 0`;
    card.innerHTML = `
      <div style="font-size:11px;letter-spacing:6px;color:${FAINT}">${sub || ""}</div>
      <div style="font-size:31px;color:${GOLD};margin:3px 0 20px;letter-spacing:2px">${title}</div>`;
    card.appendChild(bodyEl);
    if (back) {
      const b = this._btn("← Back", "", back);
      b.style.marginTop = "16px";
      card.appendChild(b);
    }
    wrap.appendChild(card);
    this.el.appendChild(wrap);
  }

  show(screen) {
    // Remember where we came from, so Back can actually go back. This field
    // was read by the Settings back button for months and assigned NOWHERE —
    // which is why Settings->Back from the title landed in the Ludus Hub and
    // silently resumed a career.
    if (screen !== this.screen) this.screenBefore = this.screen;
    this.screen = screen;
    this.el.style.display = screen === SCREEN.NONE ? "none" : "block";
    if (screen === SCREEN.NONE) return;
    ({
      [SCREEN.TITLE]: () => this._title(),
      [SCREEN.HUB]: () => this._hub(),
      [SCREEN.MATCHES]: () => this._matches(),
      [SCREEN.SETTINGS]: () => this._settings(),
      [SCREEN.RESULTS]: () => this._results(),
      [SCREEN.CREDITS]: () => this._credits(),
      [SCREEN.PAUSE]: () => this._pause(),
    }[screen] || (() => {}))();
  }

  /**
   * The pause overlay. Shown mid-bout; the sim is frozen underneath (boot.js
   * gates the fixed-step loop on the paused flag).
   *
   * Forfeit is TWO clicks — the first arms it, the second confirms — because
   * this button ends a live bout and records a real loss. It routes through
   * hooks.onForfeit -> match._decide(false), the same verdict path a defeat
   * takes, so the loss, the purse, and gear wear are all recorded. ESC used to
   * silently destroy the match with none of that: a free rewind of any losing
   * fight.
   */
  _pause() {
    const body = document.createElement("div");
    body.appendChild(this._btn("Resume", "Back to the sand", () => {
      if (this.hooks.onResume) this.hooks.onResume();
    }, { accent: true }));
    body.appendChild(this._btn("Settings", "Audio, graphics, controls", () => this.show(SCREEN.SETTINGS)));
    const forfeit = this._btn("Forfeit the Bout", "Submit to the editor — counts as a loss", () => {
      if (!forfeit.dataset.armed) {
        forfeit.dataset.armed = "1";
        forfeit.querySelector("div").textContent = "Confirm — lay down your arms";
        return;
      }
      if (this.hooks.onForfeit) this.hooks.onForfeit();
    });
    body.appendChild(forfeit);
    this._shell("Paused", "THE CROWD WAITS", body);
  }

  hide() { this.show(SCREEN.NONE); }

  // -- screens -------------------------------------------------------------

  _title() {
    this.el.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.style.cssText = `min-height:100%;display:flex;flex-direction:column;align-items:center;
      justify-content:center;background:radial-gradient(ellipse at 50% 45%,rgba(10,7,4,.55),rgba(6,4,2,.94) 75%)`;
    wrap.innerHTML = `
      <div style="font-size:74px;font-weight:900;letter-spacing:9px;margin-top:6px;
        background:linear-gradient(180deg,#ffeec4,${GOLD} 52%,#a8471f);-webkit-background-clip:text;
        background-clip:text;color:transparent">COLOSSEUM</div>
      <div style="font-size:17px;letter-spacing:11px;color:#c9a86e;margin-top:2px">SANDS OF GLORY</div>
      <div style="width:340px;height:1px;background:linear-gradient(90deg,transparent,${GOLD},transparent);margin:26px 0 28px"></div>`;
    const menu = document.createElement("div");
    menu.style.cssText = "width:min(360px,86vw)";

    const hasSave = this.inv.matchesPlayed > 0 || this.inv.gold !== 150;
    if (hasSave) {
      menu.appendChild(this._btn("Continue",
        `${this.inv.rank().name} · ${this.inv.wins}W ${this.inv.losses}L · ${this.inv.gold} aurei`,
        () => this.show(SCREEN.HUB), { accent: true }));
    }
    menu.appendChild(this._btn(hasSave ? "New Career" : "Begin",
      hasSave ? "Abandons the fighter you have now" : "Bought, named, and thrown onto the sand",
      () => {
        if (hasSave && !window.confirm("Abandon your current gladiator? This cannot be undone.")) return;
        this.inv.reset();
        this.inv.save();
        if (this.hooks.onNewCareer) this.hooks.onNewCareer();
        this.show(SCREEN.HUB);
      }, { accent: !hasSave }));
    menu.appendChild(this._btn("Settings", "Audio, graphics, controls", () => this.show(SCREEN.SETTINGS)));
    menu.appendChild(this._btn("Credits", "", () => this.show(SCREEN.CREDITS)));
    wrap.appendChild(menu);
    this.el.appendChild(wrap);
  }

  _hub() {
    const inv = this.inv;
    const rank = inv.rank();
    const mob = inv.mobility();
    const a = inv.attrs;
    const body = document.createElement("div");

    const attrRow = (id, name) => {
      const p = a.progress(id);
      const cap = a.cap(rank.id);
      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:5px">
        <span style="width:82px;color:${DIM};font-size:12px">${name}</span>
        <span style="width:34px;color:${STONE};font-size:15px">${a.levels[id]}</span>
        <div style="flex:1;height:5px;background:#1d150d;border:1px solid rgba(216,173,78,.2)">
          <div style="height:100%;width:${(p.frac * 100).toFixed(0)}%;background:${GOLD}"></div></div>
        <span style="width:44px;text-align:right;color:${FAINT};font-size:10.5px">cap ${cap}</span>
      </div>`;
    };

    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
        <div style="font-size:15px;color:${STONE}">${rank.name} — <span style="color:${DIM}">${rank.title}</span></div>
        <div style="font-size:19px;color:${GOLD}">${inv.gold} aurei</div>
      </div>
      <div style="font-size:12px;color:${FAINT};font-style:italic;margin-bottom:14px">${rank.desc}</div>
      <div style="display:flex;gap:22px;font-size:12px;color:${DIM};margin-bottom:16px">
        <span>${inv.wins}W · ${inv.losses}L</span><span>${inv.kills} kills</span>
        <span>${mob.weight} kg · ${mob.moveSpeed} m/s</span>
        <span style="color:${a.fatigue > 40 ? "#c46a2c" : DIM}">fatigue ${Math.round(a.fatigue)}</span>
      </div>
      <div style="padding:12px 0;border-top:1px solid rgba(216,173,78,.18);border-bottom:1px solid rgba(216,173,78,.18);margin-bottom:18px">
        ${attrRow("strength", "Strength")}${attrRow("endurance", "Endurance")}
        ${attrRow("agility", "Agility")}${attrRow("skill", "Skill")}
      </div>`;

    const nextMatch = this.ladder.find((m) => !inv.completed[m.id] && this._rankOk(m));
    body.appendChild(this._btn("Enter the Arena",
      nextMatch ? `Next: ${nextMatch.name}` : "No bouts remain at your rank", () => this.show(SCREEN.MATCHES),
      { accent: true, disabled: !nextMatch }));
    body.appendChild(this._btn("Armoury", "Buy and equip arms and armour",
      () => { this.hide(); if (this.hooks.onArmoury) this.hooks.onArmoury(); }));
    body.appendChild(this._btn("Blacksmith", "Repair and reinforce what you own",
      () => { this.hide(); if (this.hooks.onBlacksmith) this.hooks.onBlacksmith(); }));
    body.appendChild(this._btn("Training Ground",
      `${a.slots} session${a.slots === 1 ? "" : "s"} before your next bout`,
      () => { this.hide(); if (this.hooks.onTraining) this.hooks.onTraining(); },
      { disabled: a.slots <= 0 }));
    body.appendChild(this._btn("Settings", "", () => this.show(SCREEN.SETTINGS)));
    body.appendChild(this._btn("Abandon the Ludus", "Return to the title screen",
      () => this.show(SCREEN.TITLE)));

    this._shell("The Ludus", "BETWEEN BOUTS", body);
  }

  _rankOk(m) {
    const order = ["tiro", "gregarius", "veteranus", "primus", "champion", "legend"];
    return order.indexOf(m.rank) <= order.indexOf(this.inv.rank().id);
  }

  _matches() {
    const body = document.createElement("div");
    const inv = this.inv;
    let lastRank = null;
    for (const m of this.ladder) {
      const unlocked = this._rankOk(m);
      const done = !!inv.completed[m.id];
      if (m.rank !== lastRank) {
        lastRank = m.rank;
        const h = document.createElement("div");
        h.style.cssText = `font-size:10px;letter-spacing:4px;color:${FAINT};margin:16px 0 8px`;
        h.textContent = m.rank.toUpperCase();
        body.appendChild(h);
      }
      body.appendChild(this._btn(
        `${done ? "✓ " : ""}${m.name}`,
        `${m.type} · ${m.purse} aurei${done ? " · already won" : ""}${!unlocked ? " · locked" : ""}`,
        () => { this.hide(); if (this.hooks.onStartMatch) this.hooks.onStartMatch(m.id); },
        { disabled: !unlocked, accent: unlocked && !done }));
    }
    this._shell("The Card", "CHOOSE YOUR BOUT", body, { back: () => this.show(SCREEN.HUB) });
  }

  _settings() {
    const body = document.createElement("div");
    const vols = this.audio ? this.audio.volumes : { master: 0.8, music: 0.5, sfx: 0.9, crowd: 0.7, voice: 0.85 };

    const slider = (bus, label) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:14px;margin-bottom:11px";
      row.innerHTML = `<span style="width:92px;color:${DIM};font-size:13px">${label}</span>`;
      const s = document.createElement("input");
      s.type = "range"; s.min = "0"; s.max = "100"; s.value = String(Math.round(vols[bus] * 100));
      s.style.cssText = "flex:1;accent-color:" + GOLD;
      const v = document.createElement("span");
      v.style.cssText = `width:38px;text-align:right;color:${STONE};font-size:12px`;
      v.textContent = `${s.value}%`;
      s.oninput = () => {
        v.textContent = `${s.value}%`;
        if (this.audio) this.audio.setVolume(bus, s.value / 100);
        this.inv.settings.volumes = this.audio ? { ...this.audio.volumes } : undefined;
        this.inv.save();
      };
      // A slider you cannot hear is useless — preview on release.
      s.onchange = () => { if (this.audio) this.audio.play(bus === "crowd" ? "confirm" : "click", { gain: 0.6 }); };
      row.appendChild(s); row.appendChild(v);
      return row;
    };

    body.innerHTML = `<div style="font-size:10px;letter-spacing:4px;color:${FAINT};margin-bottom:10px">AUDIO</div>`;
    for (const [bus, label] of [["master", "Master"], ["music", "Music"], ["sfx", "Effects"], ["crowd", "The Crowd"], ["voice", "Voices"]]) {
      body.appendChild(slider(bus, label));
    }

    const q = document.createElement("div");
    q.style.cssText = `margin-top:18px;padding-top:14px;border-top:1px solid rgba(216,173,78,.18)`;
    q.innerHTML = `<div style="font-size:10px;letter-spacing:4px;color:${FAINT};margin-bottom:10px">GRAPHICS</div>`;
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px";
    const current = (() => { try { return JSON.parse(localStorage.getItem("colosseum_quality") || '"high"'); } catch (e) { return "high"; } })();
    for (const lvl of ["low", "medium", "high", "ultra"]) {
      const b = document.createElement("button");
      const on = lvl === current;
      b.style.cssText = `flex:1;padding:9px;background:${on ? "rgba(58,42,20,.9)" : "rgba(24,17,10,.7)"};
        border:1px solid ${on ? GOLD : "rgba(216,173,78,.25)"};color:${on ? GOLD : STONE};
        font-family:inherit;font-size:12px;letter-spacing:1px;cursor:pointer;text-transform:uppercase`;
      b.textContent = lvl;
      b.onclick = () => {
        try { localStorage.setItem("colosseum_quality", JSON.stringify(lvl)); } catch (e) { /* private mode */ }
        if (this.hooks.onQuality) this.hooks.onQuality(lvl);
        this.show(SCREEN.SETTINGS);
      };
      row.appendChild(b);
    }
    q.appendChild(row);
    const note = document.createElement("div");
    note.style.cssText = `font-size:11px;color:${FAINT};margin-top:8px;font-style:italic`;
    note.textContent = "Crowd density and shadows change with quality. Takes effect on the next bout.";
    q.appendChild(note);
    body.appendChild(q);

    // Strafe handedness. A/D were mirrored; this is the fix exposed as a
    // preference, because which way "strafe right" should feel is genuinely
    // personal and some players will want it the other way regardless.
    const strafeWrap = document.createElement("div");
    strafeWrap.style.cssText = `margin-top:16px;padding-top:14px;
      border-top:1px solid rgba(216,173,78,.18)`;
    strafeWrap.innerHTML = `<div style="font-size:10px;letter-spacing:4px;color:${FAINT};margin-bottom:8px">MOVEMENT</div>`;
    const inp = this.hooks.getInput ? this.hooks.getInput() : null;
    const sBtn = this._btn(
      inp && inp.invertStrafe ? "Strafe: INVERTED  (A = right, D = left)"
                              : "Strafe: NORMAL  (A = left, D = right)",
      "Click to swap which way A and D carry you",
      () => {
        if (inp && inp.setInvertStrafe) inp.setInvertStrafe(!inp.invertStrafe);
        this.show(SCREEN.SETTINGS);          // redraw with the new label
      });
    strafeWrap.appendChild(sBtn);
    body.appendChild(strafeWrap);

    const c = document.createElement("div");
    c.style.cssText = `margin-top:18px;padding-top:14px;border-top:1px solid rgba(216,173,78,.18);
      font-size:12px;color:${DIM};line-height:1.9`;
    c.innerHTML = `<div style="font-size:10px;letter-spacing:4px;color:${FAINT};margin-bottom:8px">CONTROLS</div>
      <div><b style="color:${STONE}">WASD</b> move · <b style="color:${STONE}">Mouse</b> aim ·
      <b style="color:${STONE}">LMB</b> attack (direction from movement) ·
      <b style="color:${STONE}">RMB</b> heavy overhead ·
      <b style="color:${STONE}">Hold SHIFT</b> block (direction from movement) ·
      <b style="color:${STONE}">Space</b> dodge ·
      <b style="color:${STONE}">TAB</b> armoury · <b style="color:${STONE}">ESC</b> pause</div>
      <div style="margin-top:6px;font-style:italic;color:${FAINT}">Push toward your enemy as you strike to thrust; push sideways to cut.</div>`;
    body.appendChild(c);

    this._shell("Settings", "PREFERENCES", body,
      // Back goes where you actually came from — mid-bout pause, title, or
      // hub. The old expression ignored screenBefore (never assigned) and used
      // matchesPlayed, so Settings->Back from the TITLE dumped a returning
      // player into the Hub.
      { back: () => this.show(
          this.screenBefore === SCREEN.PAUSE ? SCREEN.PAUSE :
          this.screenBefore === SCREEN.TITLE ? SCREEN.TITLE : SCREEN.HUB) });
  }

  _results() {
    const r = this.lastResult || {};
    const body = document.createElement("div");
    body.innerHTML = `
      <div style="text-align:center;margin-bottom:20px">
        <div style="font-size:44px;font-weight:900;letter-spacing:6px;
          background:linear-gradient(180deg,#ffeec4,${r.playerWon ? GOLD : "#8e2f22"} 55%,#a8471f);
          -webkit-background-clip:text;background-clip:text;color:transparent">
          ${r.playerWon ? "VICTORIA" : (r.spared ? "MISSIO" : "DEFEAT")}</div>
        <div style="font-size:13px;color:${DIM};font-style:italic;margin-top:4px">
          ${r.playerWon ? "The mob is yours." : (r.spared ? "The editor turns his hand. You live." : "The sand takes you.")}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px 22px;font-size:13px;margin-bottom:18px">
        <span style="color:${DIM}">Purse</span><span style="text-align:right;color:${GOLD}">${r.purse || 0} aurei</span>
        <span style="color:${DIM}">Kills</span><span style="text-align:right">${r.kills || 0}</span>
        <span style="color:${DIM}">Duration</span><span style="text-align:right">${r.duration || 0}s</span>
        ${r.flawless ? `<span style="color:${DIM}">Flawless</span><span style="text-align:right;color:${GOLD}">untouched</span>` : ""}
        <span style="color:${DIM}">Purse total</span><span style="text-align:right;color:${GOLD}">${r.gold || 0} aurei</span>
      </div>
      ${r.rankUp ? `<div style="text-align:center;padding:12px;border:1px solid ${GOLD};
        background:rgba(58,42,20,.6);margin-bottom:16px">
        <div style="font-size:10px;letter-spacing:4px;color:${DIM}">YOU ARE RAISED TO</div>
        <div style="font-size:23px;color:${GOLD};letter-spacing:3px">${r.rankUp.toUpperCase()}</div></div>` : ""}`;
    body.appendChild(this._btn("Return to the Ludus", "", () => this.show(SCREEN.HUB), { accent: true }));
    this._shell(r.matchName || "The Bout", "RESULT", body);
  }

  _credits() {
    const body = document.createElement("div");
    body.style.cssText = `font-size:13px;line-height:2;color:${DIM}`;
    body.innerHTML = `
      <p style="color:${STONE}">Built on the real dimensions of the Flavian Amphitheatre —
      87 × 55 m of sand inside four tiers of stone.</p>
      <div style="margin-top:14px;font-size:10px;letter-spacing:4px;color:${FAINT}">HISTORY</div>
      <p>Armaturae, canonical pairings and the rules of the munus follow the scholarship, not the
      films. Surrender is <i>ad digitum</i> — a raised finger. Most bouts ended in <i>missio</i>.</p>
      <div style="margin-top:10px;font-size:10px;letter-spacing:4px;color:${FAINT}">AUDIO</div>
      <p>Music from the owner's own compositions. The cornu and the crowd are synthesised in
      WebAudio — no library holds a Roman war horn.</p>
      <div style="margin-top:10px;font-size:10px;letter-spacing:4px;color:${FAINT}">ASSETS</div>
      <p>Animals — <b style="color:${STONE}">Sketchfab, CC&nbsp;Attribution&nbsp;4.0</b>. Attribution is a
      licence condition, so the authors of the models that actually ship in this build are named here
      rather than in a file you cannot open:</p>
      <ul style="margin:6px 0 6px 18px;padding:0">
        <li><i>Tiger</i> — Blender Artist (<b style="color:${STONE}">moizmuhammad373</b>)</li>
        <li><i>Panther &mdash; blue, animated</i> — <b style="color:${STONE}">nolanfa</b></li>
      </ul>
      <p style="font-size:11px">Licence: creativecommons.org/licenses/by/4.0/</p>
      <p>Characters: Meshy auto-rigged humanoids, generated in-house. Surfaces: PBR material sets
      generated in-house. Impacts and UI one-shots: Kenney, CC0. Engine: three.js r172, MIT.</p>`;
    this._shell("Credits", "COLOSSEUM: SANDS OF GLORY", body, { back: () => this.show(SCREEN.TITLE) });
  }

  /** Show the results screen for a finished bout. */
  showResult(result, matchName) {
    this.lastResult = { ...result, matchName };
    this.show(SCREEN.RESULTS);
  }

  dispose() { this.el.remove(); }
}
