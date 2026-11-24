// Menu screens: title (choose an element as you would a character, then play), the level select
// (each campaign as a road of stops, chapter by chapter), settings, pause (where you are on the
// level's journey) and level complete (a celebration). Plain DOM on the design system in ui.css.
// Which elements exist, what they are called and how far each campaign has got is data:
// src/ui/elements.js (wording, colours) and the campaigns the game passes in (levels). An element
// whose campaign has no levels yet is shown, but cannot be chosen.
// Every screen can be driven by pointer, keyboard (Tab, arrows, Enter, Escape) or gamepad (nav.js).

import { ICONS, HERO_ICONS, COLLECTIBLE_ICONS } from './icons.js';
import { elementUi } from './elements.js';
import { FocusNav } from './nav.js';
import { levelAreas } from '../render/areas.js';
import { THEMES, CAMPAIGN_THEMES, resolveTheme } from '../render/themes.js';

const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const k of Object.keys(attrs)) {
    const v = attrs[k];
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
};
/** Longest entrance animation of any screen, ms (the wordmark: 8 letters 45 ms apart, 0.7 s each; the result pips), plus a margin. */
export const SETTLE_MS = 1600;
const icon = (name, cls = 'ic') => h('span', { class: cls, html: ICONS[name], 'aria-hidden': 'true' });

export function formatTime(ms) {
  if (!(ms > 0)) return '--:--';
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), t = Math.floor((ms % 1000) / 100);
  return `${m}:${String(s % 60).padStart(2, '0')}.${t}`;
}

/** Dark or light text for a chapter banner painted in a theme's sky colours. */
function bannerText(theme) { return theme.dark > 0.4 ? '#fff0dc' : '#12303f'; }

export class Menus {
  /**
   * @param {HTMLElement} root
   * @param {object} api {
   *   campaigns ({ [element]: { element, name, levels[], chapters[] } }), order (element ids, title order),
   *   total (planned levels per campaign), save (createSave() store),
   *   element() -> the chosen element, setElement(id) (the title picked another one), playing() -> element on screen,
   *   play(id), resume(), restartLevel(), restartCheckpoint(), quit(), next(),
   *   setting(key, value), resetProgress(), sfx(name), skin(element) (dress the whole UI for an element)
   * }
   */
  constructor(root, api) {
    this.api = api;
    this.root = h('div', { class: 'menus' });
    root.appendChild(this.root);
    this.screen = null;       // current screen name
    this.stack = [];          // for "back"
    this.nav = new FocusNav(this.root);
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.stack.length) { e.stopPropagation(); e.preventDefault(); this.back(); }
    });
    this._back = false;
  }

  get visible() { return this.screen !== null; }

  hide() { this.screen = null; this.stack.length = 0; this.root.replaceChildren(); this.root.className = 'menus'; }

  _btn(label, onClick, cls = '', sound = 'ui_tap', ic = null) {
    return h('button', { type: 'button', class: `btn ${cls}`, onclick: () => { this.api.sfx(sound); onClick(); } }, ic ? icon(ic) : null, h('span', { text: label }));
  }

  _show(name, node, { push = false, dim = true } = {}) {
    if (push && this.screen) this.stack.push(this.screen);
    const keepFocus = this.root.classList.contains('show-focus');
    this.screen = name;
    this.root.className = `menus on ${dim ? 'dim' : ''} screen-${name}${this._back ? ' back' : ''}${keepFocus ? ' show-focus' : ''}`;
    this._back = false;
    this.root.replaceChildren(node);
    this._settleLater();
    const first = node.querySelector('[data-autofocus]') || node.querySelector('button');
    if (first) { try { first.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    this.nav._mark(keepFocus && first ? first : null);       // arrow keys / a pad are driving: keep their ring on the new screen
  }

  /**
   * A screen comes in with entrance animations (the panel springs up, the wordmark's letters pop in
   * one by one) that start invisible. Their end state must not depend on the animation clock: a tab
   * opened in the background, a page whose frames are not being drawn (a hidden pane, a busy first
   * frame), a browser that pauses animations - any of those can leave an animation part-way, and the
   * wordmark half faded for good. So once the longest entrance has had time to finish (or as soon as
   * the page becomes visible again) the screen is marked settled, which takes the entrance
   * animations off: every letter and panel is then simply at its own, fully opaque style.
   */
  _settleLater() {
    clearTimeout(this._settleT);
    this.root.classList.remove('settled');
    const settle = () => { clearTimeout(this._settleT); this.root.classList.add('settled'); document.removeEventListener('visibilitychange', onVis); };
    const onVis = () => { if (!document.hidden) settle(); };
    if (this._onVis) document.removeEventListener('visibilitychange', this._onVis);
    this._onVis = onVis;
    document.addEventListener('visibilitychange', onVis);
    this._settleT = setTimeout(settle, SETTLE_MS);
  }

  back() {
    this.api.sfx('ui_back');
    const prev = this.stack.pop();
    if (!prev) return;
    this.screen = null;
    this._back = true;
    this[prev.fn](...(prev.args || []));
  }

  _pushable(fn, args) { return { fn, args }; }

  // ------------------------------------------------------------------ helpers: campaigns
  /** Levels of an element's campaign ([] when it has none yet, or the id is unknown). */
  _levels(element) { const c = this.api.campaigns[element]; return c ? c.levels : []; }
  /**
   * Why an element cannot be chosen yet, or null when it can:
   *   'soon'   its campaign has no levels yet (shown as "Coming soon"),
   *   'locked' an earlier element's campaign is not finished (the roads are played in order:
   *            Water, then Fire, then Clay), with `after` naming the element to finish first.
   */
  elementLock(element) {
    if (this._levels(element).length === 0) return { why: 'soon' };
    const order = this.api.order || [], at = order.indexOf(element), save = this.api.save;
    for (let i = 0; i < at; i++) {
      const lv = this._levels(order[i]);
      if (lv.length && !lv.every((l) => save.level(l.id).done)) return { why: 'locked', after: order[i] };
    }
    return null;
  }
  /** An element can be chosen once it has levels and every element before it is finished. */
  playable(element) { return this.elementLock(element) === null; }

  /** Where "Play / Continue" goes for an element: { level, fresh } (fresh = nothing played yet). */
  resume(element) {
    const save = this.api.save, levels = this._levels(element);
    if (!levels.length) return null;
    const anyDone = levels.some((l) => save.level(l.id).done);
    const last = levels.find((l) => l.id === save.lastFor(element));
    const firstOpen = levels.find((l, i) => !save.level(l.id).done && this.unlocked(i, element)) || levels[0];
    const level = last && this.unlocked(levels.indexOf(last), element) ? (save.level(last.id).done ? firstOpen : last) : firstOpen;
    return { level, fresh: !(anyDone || last) };
  }

  /** Is level `index` of an element's campaign open? (The first always is; the rest follow the one before.) */
  unlocked(index, element = this.api.element()) {
    // Owner's decision (2026-11-24): levels open in order - finish one to open the next - and an
    // element's road opens only when the road before it is finished (see elementLock).
    if (!this.playable(element)) return false;
    if (index <= 0) return true;
    const levels = this._levels(element);
    return !!levels[index - 1] && this.api.save.level(levels[index - 1].id).done;
  }

  // ------------------------------------------------------------------ title: choose an element, then play
  title() {
    const { save, order, total } = this.api;
    const cur = this.api.element();
    if (!this.playable(cur)) {
      // a save can name an element that is not open (yet, or any more): fall back to the first open road
      const open = order.find((id) => this.playable(id));
      if (open && open !== cur && this.api.setElement(open) !== false) return;   // the game calls title() again
    }
    const ui = elementUi(cur), levels = this._levels(cur);
    this.stack.length = 0;
    if (this.api.skin) this.api.skin(cur);
    const cards = order.map((id) => {
      const u = elementUi(id), lv = this._levels(id), lock = this.elementLock(id), ok = lock === null, on = id === cur;
      const done = lv.filter((l) => save.level(l.id).done).length;
      const lockWord = !lock ? '' : lock.why === 'soon' ? 'Coming soon' : `Finish ${elementUi(lock.after).name} first`;
      return h('button', {
        type: 'button', class: `el-card ${on ? 'on' : ''} ${ok ? '' : 'locked'}`, role: 'radio',
        'aria-checked': on ? 'true' : 'false', 'aria-disabled': ok ? undefined : 'true', 'data-element': id, 'data-autofocus': on && this._focusCards ? '' : undefined,
        'aria-label': `${u.name}: ${u.hero}. ${u.pitch} ${ok ? `${done} of ${total} levels done` : lockWord}`, 'data-lock': lock ? lock.why : undefined,
        onclick: () => {
          if (!ok) { this.api.sfx('denied'); return; }
          if (id === cur) return;
          this.api.sfx('ui_tap');
          this._focusCards = true;
          this.api.setElement(id);          // the game swaps the scene behind and calls title() again
        },
      },
        h('span', { class: 'el-hero', html: HERO_ICONS[id] }),
        h('span', { class: 'el-name', text: u.name }),
        h('span', { class: 'el-who', text: u.hero }),
        ok
          ? h('span', { class: 'el-progress' }, h('span', { class: 'el-bar', style: `--p:${Math.round(done / total * 100)}%` }), h('span', { text: `${done}/${total}` }))
          : h('span', { class: 'el-progress', text: lock.why === 'soon' ? 'Not yet' : `After ${elementUi(lock.after).name}` }),
        ok ? null : h('span', { class: 'el-soon' }, icon('lock', ''), lock.why === 'soon' ? 'Coming soon' : 'Locked'),
      );
    });
    const go = this.resume(cur);
    const got = save.shardsIn(levels.map((l) => l.id)), done = levels.filter((l) => save.level(l.id).done).length;
    const word = 'DEWPOINT';
    const play = this._btn(go.fresh ? `Play ${ui.name}` : 'Continue', () => this.api.play(go.level.id), 'primary', 'ui_tap', 'play');
    if (!this._focusCards) play.setAttribute('data-autofocus', '');
    play.setAttribute('aria-label', go.fresh ? `Play ${ui.name}: ${go.level.name}` : `Continue: ${go.level.name}`);
    this._focusCards = false;
    const node = h('div', { class: `title title-${cur}` },
      h('div', { class: 'logo' },
        h('h1', { class: 'logo-word', 'aria-label': 'Dewpoint' }, [...word].map((ch, i) => h('span', { style: `--i:${i}`, text: ch, 'aria-hidden': 'true' }))),
        h('p', { class: 'tagline', text: ui.tagline }),
      ),
      h('div', { class: 'el-cards', role: 'radiogroup', 'aria-label': 'Choose your element' }, cards),
      h('div', { class: 'el-detail' },
        h('span', { class: 'el-detail-name' }, `${ui.hero} `, h('small', { text: `· ${ui.campaign}` })),
        h('span', { class: 'el-detail-pitch', text: go.fresh ? ui.pitch : `Next: ${go.level.name}` }),
        h('span', { class: 'el-detail-count', 'aria-label': `${done} of ${total} levels, ${got} of ${levels.length * 3} ${ui.collectible.many}` },
          h('span', {}, icon('flag', ''), `${done} / ${total}`),
          h('span', {}, h('span', { html: COLLECTIBLE_ICONS[ui.id][0] }), `${got} / ${levels.length * 3}`)),
      ),
      h('div', { class: 'title-actions' },
        play,
        this._btn('Levels', () => { this.stack.push(this._pushable('title')); this.levelSelect(cur); }, '', 'ui_tap', 'levels'),
        this._btn('Settings', () => { this.stack.push(this._pushable('title')); this.settings(); }, '', 'ui_tap', 'gear'),
      ),
    );
    this._show('title', node, { dim: false });
  }

  // ------------------------------------------------------------------ level select: one element's road, chapter by chapter
  levelSelect(element = this.api.element()) {
    const { save, order } = this.api;
    if (!this.playable(element)) element = this.api.element();
    const camp = this.api.campaigns[element], levels = camp.levels, chapters = camp.chapters;
    const ui = elementUi(element), [gem, gemEmpty] = COLLECTIBLE_ICONS[ui.id];
    if (this.api.skin) this.api.skin(element);
    // the easy way to switch: a tab per element (a campaign without levels is shown, greyed)
    const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Element' }, order.map((id) => {
      const u = elementUi(id), lock = this.elementLock(id), ok = lock === null, on = id === element;
      return h('button', {
        type: 'button', class: `tab ${on ? 'on' : ''} ${ok ? '' : 'locked'}`, role: 'tab', 'aria-selected': on ? 'true' : 'false',
        'aria-disabled': ok ? undefined : 'true', 'data-element': id,
        'aria-label': ok ? `${u.name} levels` : lock.why === 'soon' ? `${u.name}: coming soon` : `${u.name}: locked, finish ${elementUi(lock.after).name} first`,
        onclick: () => {
          if (!ok) { this.api.sfx('denied'); return; }
          if (on) return;
          this.api.sfx('ui_tap');
          this.screen = null; this.levelSelect(id);     // same place in the back stack
        },
      }, h('span', { class: 'tab-icon', html: HERO_ICONS[id] }), h('span', { text: u.name }), ok ? null : h('span', { class: 'tab-lock', html: ICONS.lock }));
    }));
    const nextIndex = levels.findIndex((l, i) => !save.level(l.id).done && this.unlocked(i, element));
    const sections = [];
    let focusSet = false;
    for (const ch of chapters) {
      const list = levels.filter((l) => (l.chapter || 1) === ch.id);
      if (!list.length) continue;
      const themeName = (list[0].theme && THEMES[list[0].theme] ? list[0].theme : (CAMPAIGN_THEMES[element] || [])[ch.id - 1]) || 'slip';
      const theme = resolveTheme(themeName);
      const stops = list.map((l) => {
        const i = levels.indexOf(l), st = save.level(l.id), open = this.unlocked(i, element), next = i === nextIndex;
        const areas = levelAreas(l);
        const pips = h('span', { class: 'pips', role: 'img', 'aria-label': `${st.shards.length} of 3 ${ui.collectible.many}` },
          [0, 1, 2].map((k) => h('span', { class: `pip ${st.shards.includes(k) ? 'got' : ''}`, html: st.shards.includes(k) ? gem : gemEmpty })));
        const stop = h('button', {
          type: 'button', class: `stop ${st.done ? 'done' : ''} ${next ? 'next' : ''} ${open ? '' : 'locked'}`, disabled: !open,
          'data-level': l.id, 'data-autofocus': next && !focusSet ? '' : undefined,
          'aria-label': `Level ${i + 1}: ${l.name}${st.done ? `, completed, best time ${formatTime(st.bestMs)}` : next ? ', next up' : ''}${open ? '' : ', locked'}${areas.length ? `. ${areas.length} areas: ${areas.map((a) => a.name).join(', ')}` : ''}`,
          onclick: () => { this.api.sfx('ui_tap'); this.api.play(l.id); },
        },
          h('span', { class: 'stop-node' }, st.done ? icon('check', '') : open ? String(i + 1) : icon('lock', '')),
          h('span', { class: 'stop-name', text: l.name }),
          h('span', { class: 'stop-meta' }, pips, st.done ? h('span', { class: 'stop-time' }, icon('clock', ''), formatTime(st.bestMs)) : null),
          areas.length ? h('span', { class: 'stop-areas' }, areas.map(() => h('i')), h('span', { text: open ? areas.map((a) => a.name).join(' · ') : `${areas.length} areas` })) : null,
          next ? h('span', { class: 'stop-badge', text: 'Next' }) : null,
        );
        if (next) focusSet = true;
        return stop;
      });
      const doneN = list.filter((l) => save.level(l.id).done).length;
      sections.push(h('section', { class: 'chapter', style: `--ch-a:${theme.sky.top};--ch-b:${theme.sky.horizon};--ch-text:${bannerText(theme)}` },
        h('div', { class: 'chapter-head' },
          h('span', { class: 'chapter-num', text: String(ch.id) }),
          h('h3', {}, ch.name, h('small', { text: theme.time })),
          h('span', { class: 'chapter-count', text: `${doneN} / ${list.length}` })),
        h('div', { class: 'stops' }, stops)));
    }
    const node = h('div', { class: `panel wide select-${element}` },
      this._header('Levels'),
      tabs,
      h('p', { class: 'road-head' }, ui.campaign, h('small', { text: `with ${ui.hero}` })),
      h('div', { class: 'scroll' }, sections),
    );
    this._show('select', node);
  }

  _header(text) {
    return h('div', { class: 'panel-head' },
      this.stack.length ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Back', html: ICONS.back, onclick: () => this.back() }) : h('span', { class: 'icon-btn ghost' }),
      h('h2', { text }),
      h('span', { class: 'icon-btn ghost' }),
    );
  }

  // ------------------------------------------------------------------ settings
  settings() {
    const s = this.api.save.data.settings, set = (k, v) => this.api.setting(k, v);
    const slider = (label, key, min, max, step, fmt) => {
      const out = h('output', { text: fmt(s[key]) });
      const input = h('input', {
        type: 'range', min, max, step, value: s[key], 'aria-label': label,
        oninput: (e) => { const v = Number(e.target.value); out.textContent = fmt(v); set(key, v); },
        onchange: () => this.api.sfx('ui_tap'),
      });
      return h('label', { class: 'row' }, h('span', { class: 'row-label', text: label }), input, out);
    };
    const toggle = (label, key, note) => {
      const input = h('input', { type: 'checkbox', role: 'switch', checked: s[key] ? true : undefined, 'aria-label': label, onchange: (e) => { this.api.sfx('ui_tap'); set(key, e.target.checked); } });
      input.checked = !!s[key];
      return h('label', { class: 'row' }, h('span', { class: 'row-label' }, label, note ? h('small', { text: note }) : null), h('span', { class: 'switch' }, input, h('span', { class: 'switch-track' })));
    };
    const seg = (label, key, options) => {
      const group = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
      const draw = (focus) => {
        group.replaceChildren(...options.map(([val, text]) => h('button', {
          type: 'button', class: `seg-btn ${s[key] === val ? 'on' : ''}`, role: 'radio', 'aria-checked': s[key] === val ? 'true' : 'false', 'data-val': val,
          onclick: () => { this.api.sfx('ui_tap'); set(key, val); draw(val); },
        }, text)));
        if (focus !== undefined) { const b = group.querySelector(`[data-val="${focus}"]`); if (b) b.focus({ preventScroll: true }); }
      };
      draw();
      return h('div', { class: 'row' }, h('span', { class: 'row-label', text: label }), group);
    };
    const pct = (v) => `${Math.round(v * 100)}%`;
    let armed = false;
    const reset = h('button', { type: 'button', class: 'btn danger small' }, h('span', { text: 'Reset progress' }));
    reset.addEventListener('click', () => {
      if (!armed) { armed = true; reset.firstChild.textContent = 'Press again to erase all progress'; this.api.sfx('denied'); return; }
      this.api.resetProgress(); this.api.sfx('ui_back'); reset.firstChild.textContent = 'Progress erased'; reset.disabled = true;
    });
    const node = h('div', { class: 'panel' },
      this._header('Settings'),
      h('div', { class: 'scroll' },
        slider('Music', 'music', 0, 1, 0.05, pct),
        slider('Sound', 'sfx', 0, 1, 0.05, pct),
        toggle('Mute all', 'muted'),
        seg('Quality', 'quality', [['auto', 'Auto'], ['low', 'Low'], ['high', 'High']]),
        slider('Camera speed', 'sensitivity', 0.2, 3, 0.1, (v) => `${v.toFixed(1)}x`),
        toggle('Invert camera Y', 'invertY'),
        toggle('Reduced motion', 'reducedMotion', 'calmer camera, fewer particles, no wobble'),
        this.api.save.persistent ? null : h('p', { class: 'note', text: 'This browser is not letting the game save. Progress will last until the tab closes.' }),
        h('div', { class: 'row end' }, reset),
      ),
    );
    this._show('settings', node);
  }

  // ------------------------------------------------------------------ pause
  /**
   * @param info the level's name, or { name, element, number, areas: [{ name, seen, here }], shards: [bool, bool, bool] }
   */
  pause(info) {
    if (typeof info === 'string') info = { name: info };
    this.stack.length = 0;
    const self = this._pushable('pause', [info]);
    const ui = elementUi(info.element || this.api.playing()), [gem, gemEmpty] = COLLECTIBLE_ICONS[ui.id];
    if (this.api.skin) this.api.skin(ui.id);
    const areas = info.areas || [];
    const seenN = areas.filter((a) => a.seen).length;
    const journey = areas.length || info.shards
      ? h('div', { class: 'journey' },
        h('div', { class: 'journey-top' },
          h('span', { text: areas.length ? `Area ${Math.max(1, areas.findIndex((a) => a.here) + 1)} of ${areas.length}` : ui.collectible.label }),
          info.shards ? h('span', { class: 'pips', role: 'img', 'aria-label': `${info.shards.filter(Boolean).length} of 3 ${ui.collectible.many}` }, info.shards.map((g) => h('span', { class: `pip ${g ? 'got' : ''}`, html: g ? gem : gemEmpty }))) : null),
        areas.length ? h('ol', { 'aria-label': `Areas of this level, ${seenN} of ${areas.length} reached` }, areas.map((a) => h('li', { class: `${a.here ? 'here' : ''} ${a.seen ? 'seen' : ''}` }, h('i'), h('span', { text: a.name })))) : null)
      : null;
    const node = h('div', { class: 'panel pause-panel' },
      h('div', { class: 'panel-tag', text: 'Paused' }),
      h('h2', { class: 'complete-name', text: info.number ? `${info.number}. ${info.name}` : info.name }),
      journey,
      h('div', { class: 'btn-col' },
        (() => { const b = this._btn('Resume', () => this.api.resume(), 'primary', 'ui_tap', 'play'); b.setAttribute('data-autofocus', ''); return b; })(),
        h('div', { class: 'btn-row' },
          this._btn('Checkpoint', () => this.api.restartCheckpoint(), 'small', 'ui_tap', 'flag'),
          this._btn('Restart', () => this.api.restartLevel(), 'small', 'ui_tap', 'restart')),
        h('div', { class: 'btn-row' },
          this._btn('Levels', () => { this.stack.push(self); this.levelSelect(this.api.playing()); }, 'small', 'ui_tap', 'levels'),
          this._btn('Settings', () => { this.stack.push(self); this.settings(); }, 'small', 'ui_tap', 'gear')),
        this._btn('Quit to title', () => this.api.quit(), 'small', 'ui_back', 'home'),
      ),
    );
    node.querySelector('.btn-row .btn').setAttribute('aria-label', 'Back to checkpoint');
    node.querySelectorAll('.btn-row .btn')[1].setAttribute('aria-label', 'Restart level');
    this._show('pause', node);
  }

  // ------------------------------------------------------------------ level complete
  complete(info) {
    // info: { element, name, timeMs, bestMs, newBest, shards:[...this run], allShards:[...ever], deaths, hasNext, nextName,
    //         count (levels registered in this campaign), total (levels it will have) }
    this.stack.length = 0;
    const ui = elementUi(info.element), [gem, gemEmpty] = COLLECTIBLE_ICONS[ui.id];
    if (this.api.skin) this.api.skin(ui.id);
    const pips = h('div', { class: 'big-pips', role: 'img', 'aria-label': `${info.shards.length} of 3 ${ui.collectible.many}` }, [0, 1, 2].map((k) => {
      const now = info.shards.includes(k), ever = info.allShards.includes(k);
      return h('span', { class: `pip ${now ? 'got pop' : ever ? 'got old' : ''}`, style: `animation-delay:${0.3 + k * 0.2}s`, html: now || ever ? gem : gemEmpty });
    }));
    const colours = ['var(--el)', 'var(--accent)', '#fff', 'var(--el-deep)'];
    const confetti = h('div', { class: 'confetti', 'aria-hidden': 'true' }, Array.from({ length: 22 }, (_, i) =>
      h('i', { style: `--x:${(i * 37 + 11) % 100};--d:${((i * 53) % 10) / 10};--s:${i % 2 ? 1 : -1};--c:${colours[i % colours.length]}` })));
    const node = h('div', { class: 'panel complete-panel' },
      h('div', { class: 'complete-rays', 'aria-hidden': 'true' }),
      confetti,
      h('div', { class: 'panel-tag', text: `${ui.win}!` }),
      h('h2', { class: 'complete-name', text: info.name }),
      h('div', { class: 'complete-body' },
        pips,
        h('div', { class: 'stats' },
          h('div', {}, h('span', { class: 'stat-k', text: 'Time' }), h('span', { class: 'stat-v', text: formatTime(info.timeMs) })),
          h('div', { class: info.newBest ? 'best' : '' }, h('span', { class: 'stat-k', text: info.newBest ? 'New best!' : 'Best' }), h('span', { class: 'stat-v', text: formatTime(info.bestMs) })),
          h('div', {}, h('span', { class: 'stat-k', text: ui.deaths }), h('span', { class: 'stat-v', text: String(info.deaths) })),
        ),
      ),
      h('div', { class: 'btn-col' },
        info.hasNext
          ? (() => { const b = this._btn(`Next: ${info.nextName}`, () => this.api.next(), 'primary', 'ui_tap', 'next'); b.setAttribute('data-autofocus', ''); return b; })()
          : h('p', { class: 'note', text: ui.id === 'water' || !(info.count < info.total)
            ? 'That is every level so far. More of the works wakes up soon.'
            : `That is every level of ${ui.campaign} so far (${info.count} of ${info.total}). More of the works wakes up soon.` }),
        h('div', { class: 'btn-row' },
          this._btn('Again', () => this.api.restartLevel(), 'small', 'ui_tap', 'restart'),
          this._btn('Levels', () => { this.stack.push(this._pushable('complete', [info])); this.levelSelect(ui.id); }, 'small', 'ui_tap', 'levels')),
        this._btn('Title', () => this.api.quit(), 'small', 'ui_back', 'home'),
      ),
    );
    node.querySelector('.btn-row .btn').setAttribute('aria-label', 'Play again');
    this._show('complete', node);
  }
}
