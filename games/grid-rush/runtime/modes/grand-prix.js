/**
 * Grid Rush — GRAND PRIX (CUP) mode.
 * A thin wrapper over the single-race pipeline: run all 5 circuits back-to-back,
 * award points by finishing place, accumulate, crown a champion.
 * Mode-registry contract: setup · onRacerFinish · update · hudExtra · checkEnd
 * The engine owns ONE race; this mode owns the SERIES around it.
 */
import { TRACKS } from '../config.js';

export const CUP_ORDER = ['prism_boulevard', 'volt_canyon', 'glass_harbor', 'null_spire', 'echo_yards'];
export const CUP_POINTS = [10, 8, 6, 5, 4, 3]; // by place, index 0 = 1st

export function createGrandPrix() {
  return {
    id: 'grand_prix',
    label: 'GRAND PRIX',
    series: null,
    _overlay: null,
    _hud: null,
    _atChampion: false,

    setup(game) {
      this.series = {
        order: CUP_ORDER.slice(),
        index: 0,
        points: {}, names: {}, vehicles: {}, wins: {}, lastRank: {}, lastAward: {},
        scored: false,
      };
      this._injectStyle();
      this._ensureOverlay(game);
      this._ensureHud(game);
      game.trackId = this.series.order[0];
    },

    onRacerFinish(game, racer) {
      if (racer.isPlayer) {
        game.flashToast?.(`CUP RACE ${this.series.index + 1}: P${game.finishedOrder.length}`);
      }
    },

    update(_game, _dt) {},

    hudExtra(game) {
      const s = this.series;
      if (!s || !this._hud) return;
      this._hud.textContent = `GRAND PRIX · RACE ${s.index + 1}/${s.order.length}`;
    },

    checkEnd(game) {
      const s = this.series;
      if (!s || s.scored) return true;
      s.scored = true;
      const order = this._classify(game);
      s.lastAward = {};
      order.forEach((r, i) => {
        const pts = CUP_POINTS[i] || 0;
        s.lastAward[r.id] = pts;
        s.points[r.id] = (s.points[r.id] || 0) + pts;
        s.names[r.id] = r.callsign;
        s.vehicles[r.id] = r.vehicle?.name || '';
        s.lastRank[r.id] = i + 1;
      });
      const winId = order[0]?.id;
      if (winId) s.wins[winId] = (s.wins[winId] || 0) + 1;
      if (s.index >= s.order.length - 1) this._showChampion(game);
      else this._showStandings(game);
      return true;
    },

    _classify(game) {
      const finishers = game.finishedOrder.map((id) => game.racers.find((r) => r.id === id)).filter(Boolean);
      const dnf = game.racers.filter((r) => !game.finishedOrder.includes(r.id)).sort((a, b) => b.progress - a.progress);
      return finishers.concat(dnf);
    },

    _standings(s) {
      return Object.keys(s.points)
        .map((id) => ({
          id, pts: s.points[id], name: s.names[id] || id,
          veh: s.vehicles[id] || '', wins: s.wins[id] || 0, last: s.lastRank[id] || 99,
          add: s.lastAward[id] || 0,
        }))
        .sort((a, b) => b.pts - a.pts || b.wins - a.wins || a.last - b.last);
    },

    _continue(game) {
      const s = this.series;
      s.index += 1;
      s.scored = false;
      this._hide();
      game.els.results?.classList.add('hidden');
      game.trackId = s.order[s.index];
      game.startRace();
    },
    _restart(game) {
      this._hide();
      this.setup(game);
      game.startRace();
    },
    _finishSeries(game) {
      this._hide();
      this._atChampion = false;
      game.mode = null;
      game.returnMenu();
    },
    _hide() { this._overlay?.classList.add('hidden'); },

    _ensureOverlay(game) {
      if (this._overlay) return;
      const el = document.createElement('div');
      el.id = 'gp-standings';
      el.className = 'screen hidden';
      el.innerHTML =
        `<div class="results-panel gp-panel">
           <div id="gp-title" class="results-title">CUP STANDINGS</div>
           <div id="gp-sub" class="gp-sub"></div>
           <div id="gp-rows" class="results-stats gp-rows"></div>
           <div id="gp-next" class="gp-next"></div>
           <div class="gp-btns">
             <button id="gp-continue" class="mode-btn" type="button">CONTINUE</button>
             <button id="gp-quit" class="mode-btn ghost" type="button">QUIT CUP</button>
           </div>
         </div>`;
      (document.getElementById('app') || document.body).appendChild(el);
      el.querySelector('#gp-continue').addEventListener('click', () => {
        if (this._atChampion) this._finishSeries(game);
        else this._continue(game);
      });
      el.querySelector('#gp-quit').addEventListener('click', () => {
        if (this._atChampion) this._restart(game);
        else this._finishSeries(game);
      });
      this._overlay = el;
    },

    _rowsHtml(rows, { crown = false } = {}) {
      return rows
        .map((r, i) => {
          const me = r.id === 'local' ? ' me' : '';
          const tag = crown && i === 0 ? '♛ ' : '';
          const add = r.add ? `<span class="gp-add">+${r.add}</span>` : '';
          return `<div class="gp-row${me}"><span class="gp-pos">${i + 1}</span><span class="gp-name">${tag}${r.name}</span><span class="gp-veh">${r.veh}</span>${add}<span class="gp-pts">${r.pts}</span></div>`;
        })
        .join('');
    },

    _showStandings(game) {
      const s = this.series;
      this._atChampion = false;
      const done = TRACKS[s.order[s.index]]?.name || 'CIRCUIT';
      const nextName = TRACKS[s.order[s.index + 1]]?.name || '';
      this._overlay.querySelector('#gp-title').textContent = 'CUP STANDINGS';
      this._overlay.querySelector('#gp-sub').textContent = `${done} COMPLETE · RACE ${s.index + 1}/${s.order.length}`;
      this._overlay.querySelector('#gp-rows').innerHTML = this._rowsHtml(this._standings(s));
      this._overlay.querySelector('#gp-next').textContent = `NEXT ▸ ${nextName}`;
      this._overlay.querySelector('#gp-continue').textContent = 'CONTINUE';
      this._overlay.querySelector('#gp-quit').textContent = 'QUIT CUP';
      game.els.results?.classList.add('hidden');
      this._overlay.classList.remove('hidden');
    },

    _showChampion(game) {
      const s = this.series;
      this._atChampion = true;
      const rows = this._standings(s);
      const champ = rows[0];
      this._overlay.querySelector('#gp-title').textContent = champ.id === 'local' ? 'GRID CHAMPION — YOU' : `GRID CHAMPION — ${champ.name}`;
      this._overlay.querySelector('#gp-sub').textContent = `${s.order.length}-CIRCUIT CUP · FINAL STANDINGS`;
      this._overlay.querySelector('#gp-rows').innerHTML = this._rowsHtml(rows, { crown: true });
      this._overlay.querySelector('#gp-next').textContent = '';
      this._overlay.querySelector('#gp-continue').textContent = 'MAIN MENU';
      this._overlay.querySelector('#gp-quit').textContent = 'RUN IT BACK';
      game.els.results?.classList.add('hidden');
      this._overlay.classList.remove('hidden');
    },

    _ensureHud(game) {
      if (this._hud) return;
      const el = document.createElement('div');
      el.id = 'gp-hud';
      (game.els.hud || document.getElementById('hud'))?.appendChild(el);
      this._hud = el;
    },

    _injectStyle() {
      if (document.getElementById('gp-style')) return;
      const st = document.createElement('style');
      st.id = 'gp-style';
      st.textContent = `
        #gp-hud{position:absolute;top:54px;left:50%;transform:translateX(-50%);
          font:700 13px/1 'Orbitron',sans-serif;letter-spacing:.14em;color:#00f0ff;
          text-shadow:0 0 10px rgba(0,240,255,.6);pointer-events:none;z-index:6}
        #gp-standings .gp-sub{font:600 12px/1.4 'Share Tech Mono',monospace;
          letter-spacing:.18em;color:#ff8ad8;opacity:.85;margin:-.25rem 0 .75rem}
        #gp-standings .gp-rows{display:flex;flex-direction:column;gap:.28rem}
        #gp-standings .gp-row{display:grid;grid-template-columns:1.6rem 1fr auto 2.4rem 2.6rem;
          align-items:center;gap:.5rem;padding:.32rem .55rem;border:1px solid rgba(0,240,255,.14);
          border-radius:7px;background:rgba(6,4,18,.55);font:600 13px/1 'Share Tech Mono',monospace;color:#e8f7ff}
        #gp-standings .gp-row.me{border-color:#00f0ff;background:rgba(0,240,255,.12);box-shadow:0 0 14px rgba(0,240,255,.25)}
        #gp-standings .gp-pos{color:#ff2bd6;font-weight:800;text-align:center}
        #gp-standings .gp-veh{color:#8aa;font-size:11px;opacity:.8}
        #gp-standings .gp-add{color:#39ff88;font-size:11px;text-align:right}
        #gp-standings .gp-pts{color:#ffe566;font-weight:800;text-align:right;font-size:15px}
        #gp-standings .gp-next{margin:.85rem 0 .35rem;text-align:center;font:700 14px/1 'Orbitron',sans-serif;
          letter-spacing:.16em;color:#39ff88;text-shadow:0 0 10px rgba(57,255,136,.5)}
        #gp-standings .gp-btns{display:flex;gap:.6rem;justify-content:center;margin-top:.4rem}`;
      document.head.appendChild(st);
    },
  };
}
