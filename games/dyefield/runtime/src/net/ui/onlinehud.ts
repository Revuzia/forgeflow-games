// DYEFIELD — the in-match online overlays (LOBBY-UI, CONTRACT_ONLINE §O6.3 step 5, §O7, §O9.5, §O10, §O12.3):
//   * the NET badge: ping to the host (a quality-coloured bar glyph + ms; "HIGH PING" over 250 ms) and a HOST chip
//     while this browser runs the match — desktop bottom right, touch under the PAUSE button;
//   * the HOST MIGRATING banner (the host left: "HOST LEFT — MIGRATING…", then "<name> IS HOSTING");
//   * the online feed: joined / left / a bot took over / court re-synced / match called off;
//   * the PLAYERS board: hold TAB (or the pad's Back / Select) — every runner with HUMAN / BOT, connection and ping;
//   * the online MATCH MENU card (§O10 "No pause online": ESC / the touch PAUSE / blur / hidden / back open it while the
//     match runs on): BACK TO MATCH, SETTINGS, HOW TO PLAY, FULLSCREEN, LEAVE MATCH (+ confirm), the players beside;
//   * the post-match controls for the victory slate (§O4.2 REMATCH / §O4.3 PLAY AGAIN / LEAVE), mounted INTO the
//     slate's card in place of PLAY AGAIN / LOBBY (or floating at the bottom when no card is given).
// Name tags: SYNC's players.ts rename(id, name) sets data-net="human" | "bot" | "away" on a runner's .df-tag; the
// rules for it live in ui.css (a BOT chip, a dimmed tag while the player is away).
// The HUD state comes from OnlineApi.hud() (polled 4 × a second while attached) and OnlineApi.onEvent.

import './ui.css';
import './hud.css';
import { Fullscreen, touchModeOn, watchTouchMode } from '../../ui/boot.ts';
import { NavController } from './nav.ts';
import { glyph } from './glyphs.ts';
import { HIGH_PING_MS, REMATCH_WINDOW_S, reduceMotionOn, type OnlineApi, type OnlineEvent, type OnlineHudState, type RoomView, type UiSettingsLike } from './types.ts';

export const HUD_TEXT = {
  migrating: 'HOST LEFT — MIGRATING…', hosting: (n: string): string => `${n.toUpperCase()} IS HOSTING`, youHost: 'YOU ARE HOSTING',
  voided: 'MATCH CALLED OFF', highPing: 'HIGH PING', host: 'HOST',
  menuTitle: 'MATCH MENU', menuNote: 'The match keeps running.', back: 'BACK TO MATCH', settings: 'SETTINGS', howto: 'HOW TO PLAY',
  fullscreen: 'FULLSCREEN', exitFullscreen: 'EXIT FULLSCREEN', leave: 'LEAVE MATCH',
  leaveQ: 'LEAVE MATCH?', leaveLine: 'A bot takes over your runner and the match goes on without you.', stay: 'STAY', leaveYes: 'LEAVE',
  players: 'PLAYERS', human: 'PLAYER', bot: 'BOT', away: 'AWAY',
  rematch: 'REMATCH', playAgain: 'PLAY AGAIN', leavePost: 'LEAVE',
  rematchWait: (s: number): string => `Waiting for another player… ${s}`,
  rematchLine: 'The same room starts again when another player presses REMATCH; otherwise you queue for the next match.',
  againLine: 'PLAY AGAIN takes everyone back to the room.',
  waitOwner: (n: string): string => `Waiting for ${n} to pick PLAY AGAIN…`,
  joined: (n: string): string => `${n} joined`, left: (n: string): string => `${n} left — a bot takes over`,
  takeover: (n: string): string => `A bot is driving ${n}`, resynced: 'Court re-synced',
} as const;

export interface OnlineHudHooks {
  /** BACK TO MATCH / Esc / pad B on the card */
  resume(): void;
  /** SETTINGS / HOW TO PLAY from the card: the integrator opens the menus' screens over the running match */
  settings(): void;
  howto(): void;
  /** LEAVE MATCH, confirmed (SYNC: leave the room, back to the lobby) */
  leaveMatch(): void;
  /** the post-match LEAVE (back to the lobby / PLAY ONLINE) */
  leavePost?(): void;
  sound?(s: 'hover' | 'click' | 'back' | 'start'): void;
  /** a runner's crew look for the players lists (mark glyph + dye); null = unknown */
  crewOf?(runner: number): { mark: string; dye: string } | null;
  /** false while TAB is bound to a game action (the board then needs the pad's Back or the menu card) */
  tabFree?(): boolean;
}

export interface OnlineHudOptions { api: OnlineApi; hooks: OnlineHudHooks; nav?: NavController; settings?: UiSettingsLike }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function btn(cls: string, text: string, id?: string): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  b.dataset.nav = '';
  if (id) b.id = id;
  return b;
}
const pingClass = (ms: number | null): string => (ms === null ? 'na' : ms <= 120 ? 'good' : ms <= HIGH_PING_MS ? 'ok' : 'bad');

export class OnlineHud {
  readonly root: HTMLElement;
  readonly nav: NavController;
  private readonly ownNav: boolean;
  private readonly api: OnlineApi;
  private readonly hooks: OnlineHudHooks;
  private offs: Array<() => void> = [];
  private attached = false;
  private poll = 0;
  private touch = touchModeOn();
  private hud: OnlineHudState | null = null;
  // badge
  private readonly net: HTMLElement;
  private readonly netPing: HTMLElement;
  private readonly netMs: HTMLElement;
  private readonly netHost: HTMLElement;
  // banner + feed
  private readonly banner: HTMLElement;
  private readonly bannerText: HTMLElement;
  private bannerT = 0;
  /** the banner shows a migration the HUD state reported (cleared when hud().migrating drops) */
  private migByHud = false;
  private readonly feed: HTMLElement;
  // board
  private readonly board: HTMLElement;
  private readonly boardList: HTMLElement;
  private readonly boardHost: HTMLElement;
  private boardHeld = { key: false, pad: false };
  private padRaf = 0;
  // menu card
  private readonly menu: HTMLElement;
  private readonly menuCard: HTMLElement;
  private readonly menuList: HTMLElement;
  private readonly menuHost: HTMLElement;
  private readonly confirm: HTMLElement;
  private readonly fsItem: HTMLButtonElement;
  private popMenu: (() => void) | null = null;
  private popConfirm: (() => void) | null = null;
  // post
  private readonly post: HTMLElement;
  private readonly postLine: HTMLElement;
  private readonly postBtns: HTMLElement;
  private postCard: HTMLElement | null = null;
  private postObs: MutationObserver | null = null;
  private postRoom: RoomView | null = null;
  private rematchAt = 0;
  private rematchT = 0;
  private popPost: (() => void) | null = null;
  /** read-back counters */
  readonly seen = { events: 0, banners: 0, feed: 0 };

  constructor(host: HTMLElement, o: OnlineHudOptions) {
    this.api = o.api;
    this.hooks = o.hooks;
    this.ownNav = !o.nav;
    this.nav = o.nav ?? new NavController();
    this.root = el('div', 'dfm dfo dfo-hud');
    this.root.id = 'df-online-hud';
    this.root.hidden = true;

    // ── NET badge
    this.net = el('div', 'dfo-net');
    this.net.setAttribute('role', 'status');
    this.netPing = el('span', 'dfo-netping');
    this.netMs = el('b', 'ms', '—');
    this.netPing.append(glyph('bars', 'dfo-g'), this.netMs);
    this.netHost = el('span', 'dfo-nethost');
    this.netHost.append(glyph('host', 'dfo-g'), el('b', '', HUD_TEXT.host));
    this.netHost.hidden = true;
    this.net.append(this.netPing, this.netHost);
    this.net.hidden = true;

    // ── banner + feed
    this.banner = el('div', 'dfo-banner');
    this.banner.setAttribute('role', 'alert');
    const drops = el('span', 'dfo-drops sm');
    for (const c of ['a', 'b', 'c']) drops.append(el('i', c));
    this.bannerText = el('b', '', '');
    this.banner.append(drops, this.bannerText);
    this.banner.hidden = true;
    this.feed = el('div', 'dfo-feed');
    this.feed.setAttribute('aria-live', 'polite');

    // ── PLAYERS board (hold TAB)
    this.board = el('div', 'dfm-card dfo-board');
    this.board.hidden = true;
    const bh = el('div', 'dfo-board-h');
    this.boardHost = el('span', 'host', '');
    bh.append(el('h3', 'dfm-cap', HUD_TEXT.players), this.boardHost);
    this.boardList = el('ol', 'dfo-plist');
    this.board.append(bh, this.boardList);

    // ── MATCH MENU card
    this.menu = el('div', 'dfo-menu');
    this.menu.hidden = true;
    this.menu.setAttribute('role', 'dialog');
    this.menu.setAttribute('aria-label', HUD_TEXT.menuTitle);
    const card = el('div', 'dfm-card dfo-menucard');
    this.menuCard = card;
    const ml = el('div', 'dfo-menu-l');
    ml.append(el('h2', '', HUD_TEXT.menuTitle), el('p', 'dfo-menunote', HUD_TEXT.menuNote));
    const back = btn('df-btn', HUD_TEXT.back, 'dfo-m-back');
    back.dataset.default = '';
    back.dataset.group = 'menu';
    back.addEventListener('click', (e) => { e.stopPropagation(); this.sound('click'); this.resume(); });
    ml.append(back);
    const item = (label: string, id: string, fn: () => void): HTMLButtonElement => {
      const b = btn('dfm-item small', '', id);
      b.dataset.group = 'menu';
      b.append(el('span', 'chev', '▶'), el('span', 'lbl', label));
      b.addEventListener('click', (e) => { e.stopPropagation(); this.sound('click'); fn(); });
      ml.append(b);
      return b;
    };
    item(HUD_TEXT.settings, 'dfo-m-settings', () => this.hooks.settings());
    item(HUD_TEXT.howto, 'dfo-m-howto', () => this.hooks.howto());
    this.fsItem = item(HUD_TEXT.fullscreen, 'dfo-m-fullscreen', () => { void Fullscreen.toggle(); });
    item(HUD_TEXT.leave, 'dfo-m-leave', () => this.askLeave());
    const mr = el('div', 'dfo-menu-r');
    const mh = el('div', 'dfo-board-h');
    this.menuHost = el('span', 'host', '');
    mh.append(el('h3', 'dfm-cap', HUD_TEXT.players), this.menuHost);
    this.menuList = el('ol', 'dfo-plist');
    mr.append(mh, this.menuList);
    card.append(ml, mr);
    this.confirm = el('div', 'dfm-confirm dfo-confirm');
    this.confirm.hidden = true;
    this.confirm.setAttribute('role', 'alertdialog');
    const qc = el('div', 'dfm-card dfm-confirm-card');
    const stay = btn('dfm-small', HUD_TEXT.stay, 'dfo-leave-no');
    stay.dataset.default = '';
    const yes = btn('df-btn danger', HUD_TEXT.leaveYes, 'dfo-leave-yes');
    stay.addEventListener('click', (e) => { e.stopPropagation(); this.sound('back'); this.closeConfirm(); });
    yes.addEventListener('click', (e) => { e.stopPropagation(); this.sound('click'); this.closeConfirm(); this.hideMenu(); this.hooks.leaveMatch(); });
    const qr = el('div', 'dfm-row center');
    qr.append(stay, yes);
    qc.append(el('h2', '', HUD_TEXT.leaveQ), el('p', '', HUD_TEXT.leaveLine), qr);
    this.confirm.append(qc);
    this.menu.append(card, this.confirm);

    // ── post-match controls (mounted into the victory card)
    this.post = el('div', 'dfo-post');
    this.postLine = el('p', 'dfo-postline', '');
    this.postBtns = el('div', 'dfo-postbtns');
    this.post.append(this.postBtns, this.postLine);
    this.post.hidden = true;

    this.root.append(this.net, this.banner, this.feed, this.board, this.menu);
    host.append(this.root);

    this.offs.push(this.api.onEvent((e) => this.onEvent(e)));
    this.offs.push(watchTouchMode((on) => { this.touch = on; this.root.classList.toggle('touch', on); }));
    this.offs.push(Fullscreen.onChange(() => this.syncFs()));
    this.root.classList.toggle('touch', this.touch);
    // REDUCE MOTION (SETTINGS or the OS): the root and the post row (it lives in the victory card)
    const rm = (): void => { const on = reduceMotionOn(o.settings); this.root.classList.toggle('rm', on); this.post.classList.toggle('rm', on); };
    rm();
    if (o.settings?.on) this.offs.push(o.settings.on(rm));
    const kd = (e: KeyboardEvent): void => {
      if (!this.attached || e.code !== 'Tab' || this.menuOpen || e.repeat) return;
      if (this.hooks.tabFree && !this.hooks.tabFree()) return;
      e.preventDefault();
      this.boardHeld.key = true;
      this.renderBoard();
    };
    const ku = (e: KeyboardEvent): void => { if (e.code === 'Tab' && this.boardHeld.key) { e.preventDefault(); this.boardHeld.key = false; this.renderBoard(); } };
    const blur = (): void => { this.boardHeld.key = false; this.renderBoard(); };
    window.addEventListener('keydown', kd, true);
    window.addEventListener('keyup', ku, true);
    window.addEventListener('blur', blur);
    this.offs.push(() => { window.removeEventListener('keydown', kd, true); window.removeEventListener('keyup', ku, true); window.removeEventListener('blur', blur); });
    this.syncFs();
  }

  // ───────────────────────────── lifecycle ─────────────────────────────
  /** the match started (this browser is in it): show the badge, start polling api.hud() */
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.root.hidden = false;
    this.refresh();
    this.poll = window.setInterval(() => this.refresh(), 250);
    const padLoop = (): void => {
      this.padRaf = requestAnimationFrame(padLoop);
      const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
      let held = false;
      for (const p of pads) if (p && p.connected) { held = !!p.buttons[8]?.pressed; break; }
      if (held !== this.boardHeld.pad) { this.boardHeld.pad = held; this.renderBoard(); }
    };
    this.padRaf = requestAnimationFrame(padLoop);
  }

  /** the match ended or was left: hide everything (the post controls stay with the slate until hidePost) */
  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    clearInterval(this.poll);
    cancelAnimationFrame(this.padRaf);
    this.poll = 0;
    this.padRaf = 0;
    this.hideMenu();
    this.boardHeld = { key: false, pad: false };
    this.board.hidden = true;
    this.banner.hidden = true;
    this.feed.replaceChildren();
    this.root.hidden = true;
  }

  private sound(s: 'hover' | 'click' | 'back' | 'start'): void { try { this.hooks.sound?.(s); } catch { /* optional */ } }

  /** read api.hud() and redraw the badge / banner / open lists */
  refresh(): void {
    const h = this.api.hud();
    this.hud = h;
    if (!h) { this.net.hidden = true; return; }
    this.net.hidden = false;
    const q = h.rttMs !== null && h.rttMs > HIGH_PING_MS ? 'bad' : h.quality;
    this.net.dataset.q = q;
    this.netMs.textContent = h.rttMs === null ? '—' : (h.rttMs > HIGH_PING_MS && !this.touch ? `${HUD_TEXT.highPing} ${Math.round(h.rttMs)} ms` : `${Math.round(h.rttMs)} ms`);
    this.net.setAttribute('aria-label', h.rttMs === null ? 'Ping unknown' : `Ping ${Math.round(h.rttMs)} milliseconds${h.host ? ', you are the host' : ''}`);
    this.netHost.hidden = !h.host;
    // HOST MIGRATING follows the HUD state while it reports one; an event-only migration clears on 'migrated' (or 8 s)
    if (h.migrating) { if (!this.migByHud || this.banner.hidden) this.showBanner(HUD_TEXT.migrating, 'mig', 0); this.migByHud = true; }
    else if (this.migByHud) { this.migByHud = false; if (this.banner.dataset.kind === 'mig') this.banner.hidden = true; }
    if (!this.board.hidden) this.renderBoard();
    if (!this.menu.hidden) this.renderList(this.menuList, this.menuHost);
  }

  // ───────────────────────────── banner + feed ─────────────────────────────
  /** a centre banner for the integrator's own news, e.g. RECONNECTING… during the §O7.2 backoff ('mig' | 'ok' | 'bad' |
   *  any kind; holdS 0 = until replaced or hideBanner) */
  notify(text: string, kind = 'mig', holdS = 0): void { this.showBanner(text, kind, holdS); }
  hideBanner(): void { clearTimeout(this.bannerT); this.banner.hidden = true; }

  private showBanner(text: string, kind: string, holdS: number): void {
    clearTimeout(this.bannerT);
    if (this.banner.hidden || this.bannerText.textContent !== text) this.seen.banners++;
    this.banner.dataset.kind = kind;
    this.bannerText.textContent = text;
    this.banner.hidden = false;
    if (holdS > 0) this.bannerT = window.setTimeout(() => { if (this.banner.dataset.kind === kind) this.banner.hidden = true; }, holdS * 1000);
  }

  private say(text: string, kind = ''): void {
    this.seen.feed++;
    const t = el('div', `dfo-feeditem ${kind}`, text);
    this.feed.append(t);
    while (this.feed.children.length > 4) this.feed.firstElementChild?.remove();
    window.setTimeout(() => { t.classList.add('out'); window.setTimeout(() => t.remove(), 450); }, 3600);
  }

  private nameOf(runner: number): string {
    return this.hud?.players.find((p) => p.runner === runner)?.name ?? `Runner ${runner + 1}`;
  }

  private onEvent(e: OnlineEvent): void {
    this.seen.events++;
    if (!this.attached) return;
    switch (e.t) {
      case 'joined': this.say(HUD_TEXT.joined(e.name), 'in'); break;
      case 'left': this.say(HUD_TEXT.left(e.name), 'out-p'); break;
      case 'botTakeover': this.say(HUD_TEXT.takeover(this.nameOf(e.runner)), 'bot'); break;
      case 'resynced': this.say(HUD_TEXT.resynced, 'sync'); break;
      case 'migrating': this.showBanner(HUD_TEXT.migrating, 'mig', 8); break;
      case 'migrated': {
        const me = this.api.hud();
        this.showBanner(me?.host ? HUD_TEXT.youHost : HUD_TEXT.hosting(e.hostName), 'ok', 1.8);
        break;
      }
      case 'voided': this.showBanner(HUD_TEXT.voided, 'bad', 3); break;
      default: break;
    }
  }

  // ───────────────────────────── players lists ─────────────────────────────
  private renderBoard(): void {
    const on = this.attached && (this.boardHeld.key || this.boardHeld.pad) && !this.menuOpen;
    this.board.hidden = !on;
    if (on) this.renderList(this.boardList, this.boardHost);
  }

  private renderList(list: HTMLElement, hostEl: HTMLElement): void {
    const h = this.hud;
    hostEl.textContent = h ? (h.host ? 'You are hosting' : `Host: ${h.hostName}`) : '';
    list.replaceChildren();
    if (!h) return;
    for (const p of [...h.players].sort((a, b) => a.runner - b.runner)) {
      const li = el('li', `dfo-prow${p.human ? '' : ' bot'}${p.human && !p.conn ? ' away' : ''}`);
      const look = this.hooks.crewOf?.(p.runner) ?? null;
      const mk = el('i', 'mk', look?.mark ?? String(p.runner + 1));
      if (look) mk.style.background = look.dye;
      const tag = el('span', `tag ${p.human ? (p.conn ? 'human' : 'away') : 'bot'}`, p.human ? (p.conn ? HUD_TEXT.human : HUD_TEXT.away) : HUD_TEXT.bot);
      const ping = el('span', `ping ${pingClass(p.human && p.conn ? p.rttMs : null)}`, p.human && p.conn && p.rttMs !== null ? `${Math.round(p.rttMs)} ms` : '—');
      li.append(mk, el('span', 'nm', p.name), tag, ping);
      list.append(li);
    }
  }

  // ───────────────────────────── MATCH MENU ─────────────────────────────
  get menuOpen(): boolean { return !this.menu.hidden; }

  /** ESC / the touch PAUSE / blur / hidden / back: the card over the running match */
  showMenu(): void {
    if (!this.menu.hidden) return;
    this.root.hidden = false;
    this.menu.hidden = false;
    this.boardHeld.key = false;
    this.renderBoard();
    this.renderList(this.menuList, this.menuHost);
    this.syncFs();
    document.documentElement.classList.add('dfo-menu-open');
    this.popMenu = this.nav.push(this.menu, { back: () => { this.sound('click'); this.resume(); return true; }, sound: (s) => this.sound(s) });
  }

  hideMenu(): void {
    this.closeConfirm(false);
    this.menu.hidden = true;
    document.documentElement.classList.remove('dfo-menu-open');
    if (this.popMenu) { this.popMenu(); this.popMenu = null; }
    if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    if (!this.attached) this.root.hidden = true;
  }

  private resume(): void {
    this.hideMenu();
    this.hooks.resume();
  }

  private askLeave(): void {
    this.confirm.hidden = false;
    this.menuCard.hidden = true;
    this.popConfirm = this.nav.push(this.confirm, { back: () => { this.sound('back'); this.closeConfirm(); return true; }, sound: (s) => this.sound(s) });
  }

  private closeConfirm(refocus = true): void {
    if (this.confirm.hidden) return;
    this.confirm.hidden = true;
    this.menuCard.hidden = false;
    if (this.popConfirm) { this.popConfirm(); this.popConfirm = null; }
    if (refocus) { const b = this.menu.querySelector<HTMLElement>('#dfo-m-leave'); if (b) this.nav.focus(b, false); }
  }

  private syncFs(): void {
    const ok = Fullscreen.enabled();
    this.fsItem.hidden = !ok;
    const l = this.fsItem.querySelector('.lbl');
    if (l) l.textContent = ok && Fullscreen.active() ? HUD_TEXT.exitFullscreen : HUD_TEXT.fullscreen;
  }

  // ───────────────────────────── post-match (victory slate) ─────────────────────────────
  /**
   * The online buttons for the victory slate: quick rooms REMATCH / LEAVE, code rooms PLAY AGAIN (owner) / LEAVE. With
   * `card` (Slates.victoryCardEl) they replace the slate's PLAY AGAIN / LOBBY row in place and appear with it (after
   * the tally); without one they float at the bottom of the screen.
   */
  showPost(room: RoomView, card: HTMLElement | null = null): void {
    this.hidePost();
    this.postRoom = room;
    this.root.classList.add('post');
    this.hideMenu();
    const owner = room.mySlot === room.ownerSlot;
    const btns: HTMLButtonElement[] = [];
    if (room.quick) {
      const re = btn('df-btn dfo-rematch', HUD_TEXT.rematch, 'dfo-rematch');
      re.dataset.default = '';
      re.addEventListener('click', (e) => { e.stopPropagation(); this.pressRematch(re); });
      btns.push(re);
      this.postLine.textContent = HUD_TEXT.rematchLine;
    } else if (owner) {
      const again = btn('df-btn dfo-again', HUD_TEXT.playAgain, 'dfo-again');
      again.dataset.default = '';
      again.addEventListener('click', (e) => { e.stopPropagation(); this.sound('start'); this.api.rematch(); });
      btns.push(again);
      this.postLine.textContent = HUD_TEXT.againLine;
    } else {
      const ownerName = room.members.find((m) => m.slot === room.ownerSlot)?.name ?? 'the owner';
      this.postLine.textContent = HUD_TEXT.waitOwner(ownerName);
    }
    // the line matters on a phone only when it is the news (waiting for the owner); a REMATCH press adds it too
    this.post.classList.toggle('wait', !room.quick && !owner);
    const leave = btn('df-btn df-lobby dfo-postleave', HUD_TEXT.leavePost, 'dfo-post-leave');
    if (!btns.length) leave.dataset.default = '';
    leave.addEventListener('click', (e) => { e.stopPropagation(); this.sound('back'); this.api.leave(); this.hidePost(); this.hooks.leavePost?.(); });
    btns.push(leave);
    this.postBtns.replaceChildren(...btns);
    this.post.hidden = false;
    this.post.classList.remove('ready');
    if (card) {
      this.postCard = card;
      card.classList.add('dfo-online');
      const orig = card.querySelector<HTMLElement>('.df-victory-btns');
      if (orig) orig.after(this.post); else card.append(this.post);
      const sync = (): void => {
        const ready = !orig || orig.classList.contains('ready');
        if (ready && !this.post.classList.contains('ready')) {
          this.post.classList.add('ready');
          const d = this.post.querySelector<HTMLElement>('[data-default]');
          if (d && !touchModeOn()) d.focus({ preventScroll: true });
        }
      };
      if (orig) { this.postObs = new MutationObserver(sync); this.postObs.observe(orig, { attributes: true, attributeFilter: ['class'] }); }
      sync();
    } else {
      this.post.classList.add('floating', 'ready');
      this.root.hidden = false;
      this.root.append(this.post);
      this.popPost = this.nav.push(this.post, { sound: (s) => this.sound(s) });
    }
  }

  private pressRematch(b: HTMLButtonElement): void {
    if (this.rematchAt) return;
    this.sound('start');
    this.api.rematch();
    this.rematchAt = performance.now();
    b.classList.add('waiting');
    this.post.classList.add('wait');
    const tick = (): void => {
      const left = Math.max(0, Math.ceil(REMATCH_WINDOW_S - (performance.now() - this.rematchAt) / 1000));
      b.textContent = HUD_TEXT.rematchWait(left);
      if (left <= 0) clearInterval(this.rematchT);
    };
    tick();
    this.rematchT = window.setInterval(tick, 250);
  }

  hidePost(): void {
    clearInterval(this.rematchT);
    this.rematchAt = 0;
    this.postObs?.disconnect();
    this.postObs = null;
    if (this.postCard) this.postCard.classList.remove('dfo-online');
    this.postCard = null;
    if (this.popPost) { this.popPost(); this.popPost = null; }
    this.post.classList.remove('floating', 'ready', 'wait');
    this.post.hidden = true;
    this.post.remove();
    this.postRoom = null;
    this.root.classList.remove('post');
  }

  // ───────────────────────────── read-back + teardown ─────────────────────────────
  readback(): Record<string, unknown> {
    const a = document.activeElement as HTMLElement | null;
    return {
      attached: this.attached, badge: this.net.hidden ? null : { q: this.net.dataset.q, text: this.netMs.textContent, host: !this.netHost.hidden },
      banner: this.banner.hidden ? null : this.bannerText.textContent, feed: [...this.feed.children].map((c) => c.textContent),
      board: !this.board.hidden, menu: this.menuOpen, confirm: !this.confirm.hidden,
      post: this.post.hidden ? null : { buttons: [...this.postBtns.children].map((b) => b.textContent), line: this.postLine.textContent,
        ready: this.post.classList.contains('ready'), inCard: !!this.postCard, quick: this.postRoom?.quick ?? null },
      focus: a && (this.root.contains(a) || this.post.contains(a)) ? (a.id || a.textContent?.trim().slice(0, 40) || a.tagName) : null,
      seen: { ...this.seen },
    };
  }

  dispose(): void {
    this.detach();
    this.hidePost();
    clearTimeout(this.bannerT);
    for (const f of this.offs) f();
    this.offs = [];
    if (this.ownNav) this.nav.dispose();
    this.root.remove();
  }
}
