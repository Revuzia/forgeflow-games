/* Grid Rush — settings.js
 * Industry-standard settings panel (menu + pause), persisted to localStorage as
 * one JSON blob. Owns steer/mouse/volume/camera/graphics; the shell
 * (game_controls.js) still owns Fullscreen/Mute/Pause.
 *
 * Integration (game.js constructor, AFTER this.sfx + this.camera + this.renderer
 * exist, BEFORE this.bindUI()):
 *     import { installSettings } from './settings.js';
 *     installSettings(this);
 *     this.applyGraphics(this.settings.graphics);
 *     this.camera.fov = this.settings.fov; this.camera.updateProjectionMatrix();
 *     this.applyVolume();
 */

const LS_KEY = 'gridrush_settings';

export const SETTINGS_DEFAULTS = Object.freeze({
  graphics: 'high', // 'low' | 'medium' | 'high' — render resolution + effects
  steerSens: 1.0, // 0.5–2.0  scales player steer rate
  invertSteer: false,
  mouseSteer: false, // position-based mouse steering
  mouseSens: 1.0, // 0.3–2.5  mouse + cruise gain
  cruiseSteer: true, // hold RIGHT mouse button + move L/R to steer
  masterVol: 0.8,
  musicVol: 0.7,
  sfxVol: 1.0,
  cameraDist: 1.0, // 0.7–1.5  chase-cam distance
  fov: 68, // 60–90
});

// [min, max, step, unit]  unit: '%' | 'x' | 'deg'
const RANGES = {
  steerSens: [0.5, 2.0, 0.05, 'x'],
  mouseSens: [0.3, 2.5, 0.05, 'x'],
  masterVol: [0, 1, 0.01, '%'],
  musicVol: [0, 1, 0.01, '%'],
  sfxVol: [0, 1, 0.01, '%'],
  cameraDist: [0.7, 1.5, 0.05, 'x'],
  fov: [60, 90, 1, 'deg'],
};
const AUDIO_KEYS = new Set(['masterVol', 'musicVol', 'sfxVol']);
const GFX_PRESETS = ['low', 'medium', 'high'];

function load() {
  const v = { ...SETTINGS_DEFAULTS };
  try {
    Object.assign(v, JSON.parse(localStorage.getItem(LS_KEY) || '{}'));
  } catch (e) {}
  return v;
}
function save(v) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(v));
  } catch (e) {}
}
function fmt(key, val) {
  const unit = RANGES[key]?.[3];
  if (unit === '%') return Math.round(val * 100) + '%';
  if (unit === 'x') return val.toFixed(2) + '×';
  if (unit === 'deg') return Math.round(val) + '°';
  return String(val);
}

function injectStyle() {
  if (document.getElementById('gr-settings-style')) return;
  const s = document.createElement('style');
  s.id = 'gr-settings-style';
  s.textContent = `
  #gr-settings{position:absolute;inset:0;z-index:40;display:none;align-items:center;
    justify-content:center;background:#04000ccc;backdrop-filter:blur(4px);
    font-family:var(--font-mono,"Share Tech Mono",monospace);color:#e8f7ff;}
  #gr-settings.show{display:flex;}
  .gr-set-box{width:min(470px,94vw);max-height:88vh;overflow:auto;padding:1.3rem 1.5rem;
    background:var(--glass,rgba(8,4,22,0.92));border:1px solid var(--stroke,rgba(0,240,255,0.45));
    border-radius:14px;box-shadow:0 0 50px #ff2bd628,inset 0 0 30px #00f0ff08;}
  .gr-set-title{font-family:var(--font-display,"Orbitron",sans-serif);font-weight:800;
    letter-spacing:.14em;color:var(--cyan,#00f0ff);text-align:center;margin-bottom:1rem;font-size:1.05rem;}
  .gr-set-group{font-size:.56rem;letter-spacing:.18em;color:var(--magenta,#ff2bd6);
    margin:.9rem 0 .35rem;text-transform:uppercase;}
  .gr-row{display:flex;align-items:center;gap:.6rem;margin:.3rem 0;font-size:.64rem;letter-spacing:.06em;}
  .gr-row>label{flex:0 0 42%;color:#c8dcffcc;}
  .gr-row input[type=range]{flex:1;accent-color:var(--cyan,#00f0ff);height:4px;cursor:pointer;}
  .gr-row .gr-val{flex:0 0 46px;text-align:right;font-family:var(--font-display,"Orbitron",sans-serif);
    color:var(--yellow,#ffe566);font-size:.62rem;}
  .gr-toggle{margin-left:auto;position:relative;width:38px;height:20px;border-radius:20px;
    border:1px solid var(--stroke,rgba(0,240,255,0.45));background:#00000060;cursor:pointer;transition:.15s;flex:0 0 38px;}
  .gr-toggle::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#889;transition:.15s;}
  .gr-toggle.on{background:#00f0ff22;border-color:var(--cyan,#00f0ff);box-shadow:0 0 10px #00f0ff40;}
  .gr-toggle.on::after{left:20px;background:var(--cyan,#00f0ff);box-shadow:0 0 8px #00f0ff;}
  .gr-seg{margin-left:auto;display:flex;gap:3px;flex:0 0 auto;}
  .gr-seg button{padding:.3rem .7rem;border-radius:6px;cursor:pointer;font-family:var(--font-mono,monospace);
    font-size:.6rem;letter-spacing:.08em;border:1px solid rgba(255,255,255,.14);background:#00000050;color:#99a;transition:.12s;}
  .gr-seg button.on{border-color:var(--cyan,#00f0ff);background:#00f0ff22;color:#fff;box-shadow:0 0 10px #00f0ff40;}
  .gr-set-actions{display:flex;gap:.6rem;margin-top:1.1rem;}
  .gr-set-actions button{flex:1;padding:.7rem;border-radius:8px;cursor:pointer;
    font-family:var(--font-display,"Orbitron",sans-serif);font-weight:700;letter-spacing:.12em;font-size:.72rem;transition:.12s;}
  .gr-btn-done{border:1px solid var(--cyan,#00f0ff);background:#00f0ff22;color:#fff;}
  .gr-btn-reset{border:1px solid rgba(255,255,255,.16);background:transparent;color:#aab;}
  .gr-btn-done:hover{box-shadow:0 0 16px #00f0ff55;}
  .gr-btn-reset:hover{border-color:var(--magenta,#ff2bd6);color:#fff;}
  .gr-set-hint{font-size:.54rem;color:#8aa;line-height:1.5;margin-top:.7rem;}`;
  document.head.appendChild(s);
}

export function installSettings(game) {
  const values = load();
  game.settings = values;
  injectStyle();

  const overlay = document.createElement('div');
  overlay.id = 'gr-settings';
  const box = document.createElement('div');
  box.className = 'gr-set-box';
  overlay.appendChild(box);
  document.getElementById('app')?.appendChild(overlay) || document.body.appendChild(overlay);

  const rerenderers = [];
  function commit(key) {
    save(values);
    if (AUDIO_KEYS.has(key)) game.applyVolume?.();
  }

  function slider(parent, key, label) {
    const [min, max, step] = RANGES[key];
    const row = document.createElement('div');
    row.className = 'gr-row';
    const lab = document.createElement('label');
    lab.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = min;
    inp.max = max;
    inp.step = step;
    const val = document.createElement('span');
    val.className = 'gr-val';
    const paint = () => {
      inp.value = values[key];
      val.textContent = fmt(key, values[key]);
    };
    inp.addEventListener('input', () => {
      values[key] = parseFloat(inp.value);
      val.textContent = fmt(key, values[key]);
      commit(key);
    });
    row.append(lab, inp, val);
    parent.appendChild(row);
    rerenderers.push(paint);
    paint();
  }
  function toggle(parent, key, label) {
    const row = document.createElement('div');
    row.className = 'gr-row';
    const lab = document.createElement('label');
    lab.textContent = label;
    const t = document.createElement('div');
    t.className = 'gr-toggle';
    t.setAttribute('role', 'switch');
    const paint = () => t.classList.toggle('on', !!values[key]);
    t.addEventListener('click', () => {
      values[key] = !values[key];
      paint();
      commit(key);
    });
    row.append(lab, t);
    parent.appendChild(row);
    rerenderers.push(paint);
    paint();
  }
  function segment(parent, key, label, opts) {
    const row = document.createElement('div');
    row.className = 'gr-row';
    const lab = document.createElement('label');
    lab.textContent = label;
    const seg = document.createElement('div');
    seg.className = 'gr-seg';
    const btns = opts.map((o) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = o.toUpperCase();
      b.addEventListener('click', () => {
        values[key] = o;
        paint();
        save(values);
        if (key === 'graphics') game.applyGraphics?.(o);
      });
      seg.appendChild(b);
      return b;
    });
    const paint = () => opts.forEach((o, i) => btns[i].classList.toggle('on', values[key] === o));
    row.append(lab, seg);
    parent.appendChild(row);
    rerenderers.push(paint);
    paint();
  }
  function group(text) {
    const g = document.createElement('div');
    g.className = 'gr-set-group';
    g.textContent = text;
    box.appendChild(g);
  }

  const title = document.createElement('div');
  title.className = 'gr-set-title';
  title.textContent = 'SETTINGS';
  box.appendChild(title);

  group('Graphics');
  segment(box, 'graphics', 'Quality', GFX_PRESETS);
  group('Steering');
  slider(box, 'steerSens', 'Keyboard steer');
  toggle(box, 'invertSteer', 'Invert steering');
  group('Mouse');
  toggle(box, 'mouseSteer', 'Mouse steering');
  slider(box, 'mouseSens', 'Mouse sensitivity');
  toggle(box, 'cruiseSteer', 'Right-click cruise steer');
  group('Audio');
  slider(box, 'masterVol', 'Master volume');
  slider(box, 'musicVol', 'Music');
  slider(box, 'sfxVol', 'SFX');
  group('Camera');
  slider(box, 'cameraDist', 'Camera distance');
  slider(box, 'fov', 'Field of view');

  const hint = document.createElement('div');
  hint.className = 'gr-set-hint';
  hint.textContent = 'Hold RIGHT mouse button and move left/right to cruise-steer like A / D.';
  box.appendChild(hint);

  const actions = document.createElement('div');
  actions.className = 'gr-set-actions';
  const reset = document.createElement('button');
  reset.className = 'gr-btn-reset';
  reset.textContent = 'RESET';
  reset.addEventListener('click', () => {
    Object.assign(values, SETTINGS_DEFAULTS);
    save(values);
    game.applyVolume?.();
    game.applyGraphics?.(values.graphics);
    game.camera.fov = values.fov;
    game.camera.updateProjectionMatrix();
    rerenderers.forEach((fn) => fn());
  });
  const done = document.createElement('button');
  done.className = 'gr-btn-done';
  done.textContent = 'DONE';
  done.addEventListener('click', close);
  actions.append(reset, done);
  box.appendChild(actions);

  function open() {
    rerenderers.forEach((fn) => fn());
    overlay.classList.add('show');
  }
  function close() {
    overlay.classList.remove('show');
  }
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.code === 'Escape' && overlay.classList.contains('show')) {
        e.stopPropagation();
        close();
      }
    },
    true
  );

  // trigger buttons (idempotent — a pre-existing [data-gr-settings] wins)
  document.querySelectorAll('[data-gr-settings]').forEach((el) => el.addEventListener('click', open));
  const mkBtn = (text) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mode-btn ghost';
    b.textContent = text;
    b.addEventListener('click', open);
    return b;
  };
  if (!document.querySelector('.launch-panel [data-gr-settings]')) {
    const host = document.querySelector('.launch-panel');
    if (host) {
      const controls = host.querySelector('.controls-card');
      const b = mkBtn('⚙ SETTINGS');
      controls ? controls.before(b) : host.appendChild(b);
    }
  }
  if (!document.querySelector('.pause-box [data-gr-settings]')) {
    const host = document.querySelector('.pause-box');
    if (host) {
      const quit = document.getElementById('btn-quit');
      const b = mkBtn('SETTINGS');
      quit ? quit.before(b) : host.appendChild(b);
    }
  }

  game.openSettings = open;
  game.closeSettings = close;
  return values;
}
