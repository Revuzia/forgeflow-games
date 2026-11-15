// BLOCKTOOTH ONLINE VS — the ONLINE MENU and the APPLICANT LOBBY (lane O-LOBBY; ONLINE_PLAN B.1, vs_design.md §10).
//
//   MENU    QUICK MATCH · CREATE ROOM · JOIN WITH CODE (4 letter tiles, type or paste) · BACK
//   LOBBY   the four seats filling (portrait, name, titan pick, HOST / YOU chips; guests are GUEST-xxxx, signed-in players show
//           their account name), the 20 s quick-match countdown ("MATCH STARTS IN n S") with START NOW for the host, the
//           room code + invite link for a room (COPY INVITE LINK), the version-mismatch / room-full / no-host / matchmaker-down
//           messages, and a LOADING state while the START is being turned into a city.
//
// Both are driven from outside: the app calls openMenu() (resolves with the choice) and openLobby() (a handle whose update()
// takes the controller's LobbyState). Nothing here talks to the network.

import './lobby.css';
import type { TitanId } from '../core/types.ts';
import type { Input } from '../core/input.ts';
import { VS as STR_VS, titanTag, vsFmt } from '../data/strings_vs.ts';
import { VS } from '../core/config.ts';
import { BIOMES } from '../data/biomes.ts';
import type { LobbyState } from '../online.ts';
import { buildBug } from './menus.ts';
import { type ModalSession, type UiPress, TextSlot, clearEl, div, el, keyChip, onTap, pulse, runModal, flashesReduced, wrapIndex } from './dom.ts';

const S = STR_VS.online;

export type MenuChoice = { kind: 'quick' } | { kind: 'create' } | { kind: 'join'; code: string };

export interface MenuOpts {
  titan: TitanId;
  /** a code to open the JOIN entry with (from ?room=) */
  code?: string;
  portraits: Partial<Record<TitanId, string>>;
}

export interface LobbyHandle {
  update(s: LobbyState): void;
  /** resolves 'leave' on ESC / the LEAVE button */
  done: Promise<'leave'>;
  close(): void;
}

const ITEMS: { kind: 'quick' | 'create' | 'join'; title: string; sub: string }[] = [
  { kind: 'quick', title: S.quick, sub: S.quickSub },
  { kind: 'create', title: S.create, sub: S.createSub },
  { kind: 'join', title: S.join, sub: S.joinSub },
];

const CODE_LEN = 4;

export class LobbyScreen {
  /** the host's START NOW button */
  onStartNow: (() => void) | null = null;
  /** RETRY (ROOM NOT FOUND): look for the room again */
  onRetry: (() => void) | null = null;
  private readonly input: Input;
  private readonly layer: HTMLDivElement;
  // header
  private readonly kicker: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  /** the host's city (right end of the header) */
  private readonly cityBox: HTMLDivElement;
  private readonly cityName: HTMLElement;
  // menu view
  private readonly menuBox: HTMLDivElement;
  private readonly items: HTMLButtonElement[] = [];
  private readonly mePick: HTMLDivElement;
  private readonly codeBox: HTMLDivElement;
  private readonly tiles: HTMLElement[] = [];
  private readonly codeHint: HTMLElement;
  // lobby view
  private readonly lobbyBox: HTMLDivElement;
  private readonly seatsBox: HTMLDivElement;
  private readonly side: HTMLDivElement;
  private readonly codeBig: HTMLDivElement;
  private readonly inviteTxt: HTMLElement;
  private readonly inviteLbl: HTMLElement;
  private readonly roomPanel: HTMLDivElement;
  private readonly dial: HTMLDivElement;
  private readonly dialNum: TextSlot;
  private readonly dialLbl: TextSlot;
  private readonly note: HTMLDivElement;
  private readonly foot: HTMLDivElement;
  private readonly leaveBtn: HTMLButtonElement;
  private readonly leaveLbl: HTMLElement;
  private readonly retryBtn: HTMLButtonElement;
  private readonly copyBtn: HTMLButtonElement;
  private readonly copyLbl: HTMLElement;
  private readonly startBtn: HTMLButtonElement;
  private seatNodes: { root: HTMLElement; img: HTMLImageElement; name: TextSlot; chip: HTMLElement; chip2: HTMLElement; tag: TextSlot; state: TextSlot; key: string }[] = [];
  private portraits: Partial<Record<TitanId, string>> = {};
  private sel = 0;
  private code = '';
  private view: 'menu' | 'code' | 'lobby' = 'menu';
  private session: ModalSession<unknown> | null = null;
  private copied = 0;
  private lastState: LobbyState | null = null;
  private lobbyDone: ((v: 'leave') => void) | null = null;
  private pasteHandler: ((e: ClipboardEvent) => void) | null = null;

  constructor(root: HTMLElement, input: Input) {
    this.input = input;
    const L = this.layer = div('bt-layer bt-screen bt-lobby bt-hidden', root);
    L.setAttribute('role', 'dialog');
    L.setAttribute('aria-label', S.header);
    L.dataset.v2 = 'lobby';
    div('bt-sel-bg', L);
    div('bt-halftone soft', L);

    const head = div('bt-lob-head', L);
    buildBug(head, '');
    const ht = div('bt-lob-htxt', head);
    this.kicker = div('bt-lob-kicker', ht);
    this.title = div('bt-lob-title', ht);
    this.sub = div('bt-lob-sub', ht);
    this.cityBox = div('bt-lob-city bt-hidden', head);
    this.cityBox.dataset.v2 = 'lobby-city';
    this.cityBox.appendChild(el('small', '', S.city));
    this.cityName = el('b');
    this.cityBox.appendChild(this.cityName);

    const body = div('bt-lob-body', L);

    // ── MENU view ──
    this.menuBox = div('bt-lob-menu', body);
    const list = div('bt-lob-items', this.menuBox);
    list.setAttribute('role', 'menu');
    ITEMS.forEach((it, i) => {
      const b = el('button', 'bt-lob-item');
      b.type = 'button';
      b.tabIndex = -1;
      b.setAttribute('role', 'menuitem');
      b.dataset.kind = it.kind;
      b.appendChild(el('span', 'bt-lob-item-n', String(i + 1)));
      const tx = div('bt-lob-item-tx', b);
      tx.appendChild(el('b', '', it.title));
      tx.appendChild(el('span', '', it.sub));
      list.appendChild(b);
      this.items.push(b);
      b.addEventListener('mouseenter', () => this.select(i));
      onTap(b, () => { this.select(i); this.activate(); });
    });
    this.mePick = div('bt-lob-me', this.menuBox);

    // ── CODE entry view ──
    this.codeBox = div('bt-lob-codebox', body);
    this.codeBox.appendChild(el('div', 'bt-lob-codetitle', S.codeTitle));
    const tiles = div('bt-lob-tiles', this.codeBox);
    for (let i = 0; i < CODE_LEN; i++) this.tiles.push(div('bt-lob-tile', tiles));
    this.codeHint = div('bt-lob-codehint', this.codeBox);

    // ── LOBBY view ──
    this.lobbyBox = div('bt-lob-lobby', body);
    this.seatsBox = div('bt-lob-seats', this.lobbyBox);
    this.side = div('bt-lob-side', this.lobbyBox);
    this.roomPanel = div('bt-lob-room', this.side);
    this.roomPanel.appendChild(el('small', '', S.roomCode));
    this.codeBig = div('bt-lob-codebig', this.roomPanel);
    this.inviteLbl = el('small', '', S.invite);
    this.roomPanel.appendChild(this.inviteLbl);
    this.inviteTxt = div('bt-lob-invite', this.roomPanel);
    this.dial = div('bt-lob-dial', this.side);
    this.dialNum = new TextSlot(div('bt-lob-dialnum', this.dial));
    this.dialLbl = new TextSlot(div('bt-lob-diallbl', this.dial));
    this.note = div('bt-lob-note', this.side);

    this.foot = div('bt-lob-foot', L);
    const mk = (cls: string, label: string, key: string, fn: () => void): { b: HTMLButtonElement; l: HTMLElement } => {
      const b = el('button', 'bt-btn ' + cls);
      b.type = 'button'; b.tabIndex = -1;
      const l = el('span', '', label);
      b.appendChild(l);
      b.appendChild(keyChip(key, cls.includes('coral') ? 'dark' : ''));
      onTap(b, fn);
      this.foot.appendChild(b);
      return { b, l };
    };
    const lv = mk('bt-btn-ghost', S.leave, 'ESC', () => this.leave());
    this.leaveBtn = lv.b; this.leaveLbl = lv.l;
    this.retryBtn = mk('bt-btn-coral', S.retry, 'R', () => this.retry()).b;
    const c = mk('bt-btn-ghost', S.copy, 'C', () => this.copyInvite());
    this.copyBtn = c.b; this.copyLbl = c.l;
    this.startBtn = mk('bt-btn-coral', S.startNow, 'ENTER', () => this.startNow()).b;
  }

  setPortraits(p: Partial<Record<TitanId, string>>): void { this.portraits = p; }

  // ─────────────────────────────── the 3-way menu + code entry ───────────────────────────────

  /** QUICK MATCH / CREATE ROOM / JOIN WITH CODE. Resolves null on BACK. */
  openMenu(o: MenuOpts): Promise<MenuChoice | null> {
    this.abortSession();
    this.portraits = o.portraits;
    this.view = 'menu';
    this.code = '';
    this.sel = 0;
    this.render();
    this.mePick.textContent = '';
    this.mePick.appendChild(el('small', '', S.yourPick));
    const ph = el('img', 'bt-lob-me-ph');
    ph.alt = '';
    const url = o.portraits[o.titan];
    if (url) ph.src = url;
    this.mePick.appendChild(ph);
    this.mePick.appendChild(el('b', '', titanTag(o.titan)));
    this.show();
    if (o.code) { this.code = o.code.slice(0, CODE_LEN); this.view = 'code'; this.sel = 2; this.render(); }
    const { promise, session } = runModal<MenuChoice | null>(this.layer, this.input, (p) => this.onMenuPress(p, session), {
      armMs: 220,
      onClose: () => { this.detachPaste(); this.session = null; },
    });
    this.session = session as ModalSession<unknown>;
    this.attachPaste();
    return promise;
  }

  private onMenuPress(p: UiPress, s: ModalSession<MenuChoice | null>): void {
    if (this.view === 'code') {
      const k = p.key;
      if (k === 'backspace') { this.code = this.code.slice(0, -1); this.render(); return; }
      if (k === 'escape') { this.view = 'menu'; this.code = ''; this.render(); return; }
      if (k === 'enter' || k === 'numpadenter' || p.key === 'pad:0') { this.submitCode(s); return; }
      if (k.length === 1 && /[a-z]/.test(k)) { if (this.code.length < CODE_LEN) { this.code += k.toUpperCase(); this.render(); if (this.code.length === CODE_LEN) pulse(this.codeBox, [{ transform: 'scale(1.03)' }, { transform: '' }], 160); } return; }
      return;
    }
    switch (p.act) {
      case 'up': this.select(wrapIndex(this.sel - 1, ITEMS.length)); break;
      case 'down': this.select(wrapIndex(this.sel + 1, ITEMS.length)); break;
      case 'pick1': this.select(0); this.activate(); break;
      case 'pick2': this.select(1); this.activate(); break;
      case 'pick3': this.select(2); this.activate(); break;
      case 'confirm': case 'alt': this.activate(); break;
      case 'back': s.finish(null, 0); break;
      default: break;
    }
  }

  private select(i: number): void {
    this.sel = i;
    this.items.forEach((b, k) => b.classList.toggle('is-sel', k === i));
  }

  private activate(): void {
    const s = this.session as ModalSession<MenuChoice | null> | null;
    if (!s || s.done || this.view !== 'menu') return;
    const kind = ITEMS[this.sel].kind;
    if (kind === 'join') { this.view = 'code'; this.code = ''; this.render(); return; }
    s.finish({ kind }, flashesReduced() ? 60 : 200);
  }

  private submitCode(s: ModalSession<MenuChoice | null>): void {
    if (this.code.length < CODE_LEN) {
      this.codeHint.textContent = S.codeShort;
      this.codeHint.classList.add('bad');
      pulse(this.codeBox, [{ transform: 'translateX(-2%)' }, { transform: 'translateX(2%)' }, { transform: '' }], 240);
      return;
    }
    s.finish({ kind: 'join', code: this.code }, flashesReduced() ? 60 : 200);
  }

  private attachPaste(): void {
    this.detachPaste();
    this.pasteHandler = (e: ClipboardEvent) => {
      if (this.view !== 'code') return;
      const txt = e.clipboardData ? e.clipboardData.getData('text') : '';
      // a pasted invite link: take its ?room= value; otherwise the letters
      const m = /[?&]room=([A-Za-z0-9]+)/.exec(txt);
      const raw = (m ? m[1] : txt).toUpperCase().replace(/[^A-Z]/g, '');
      if (!raw) return;
      e.preventDefault();
      this.code = raw.slice(0, CODE_LEN);
      this.render();
    };
    document.addEventListener('paste', this.pasteHandler, true);
  }
  private detachPaste(): void {
    if (this.pasteHandler) document.removeEventListener('paste', this.pasteHandler, true);
    this.pasteHandler = null;
  }

  // ─────────────────────────────── the lobby ───────────────────────────────

  /** show the lobby; the app feeds it LobbyStates */
  openLobby(portraits: Partial<Record<TitanId, string>>): LobbyHandle {
    this.abortSession();
    this.portraits = portraits;
    this.view = 'lobby';
    this.seatNodes = [];
    clearEl(this.seatsBox);
    this.lastState = null;
    this.render();
    this.show();
    let resolve: (v: 'leave') => void = () => {};
    const done = new Promise<'leave'>((r) => { resolve = r; });
    this.lobbyDone = resolve;
    const { session } = runModal<'leave'>(this.layer, this.input, (p) => {
      if (p.act === 'back') this.leave();
      else if (p.key === 'c') this.copyInvite();
      else if (p.key === 'r') this.retry();
      else if (p.act === 'confirm') { if (this.lastState && this.lastState.phase === 'noroom') this.retry(); else this.startNow(); }
    }, { armMs: 200, onClose: () => { this.session = null; } });
    this.session = session as ModalSession<unknown>;
    return {
      update: (s) => this.updateLobby(s),
      done,
      close: () => { this.lobbyDone = null; this.abortSession(); this.layer.classList.add('bt-hidden'); },
    };
  }

  private leave(): void {
    const r = this.lobbyDone;
    if (this.view === 'lobby' && r) { this.lobbyDone = null; r('leave'); }
  }

  private startNow(): void {
    const s = this.lastState;
    if (this.view === 'lobby' && s && s.canStartNow && this.onStartNow) this.onStartNow();
  }

  private retry(): void {
    const s = this.lastState;
    if (this.view === 'lobby' && s && s.phase === 'noroom' && this.onRetry) this.onRetry();
  }

  private copyInvite(): void {
    const s = this.lastState;
    if (!s || !s.inviteUrl) return;
    const url = s.inviteUrl;
    let settled = false;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      this.copyLbl.textContent = ok ? S.copied : S.copyFail;
      this.copied = performance.now();
      window.setTimeout(() => { if (performance.now() - this.copied >= 1700) this.copyLbl.textContent = S.copy; }, 1800);
    };
    // 1) the legacy path first, synchronously inside the click / key gesture: it works inside the portal iframe, where the async
    //    clipboard API is blocked (the iframe has no `clipboard-write` permission)
    try {
      const ta = document.createElement('textarea');
      ta.value = url; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (ok) { done(true); return; }
    } catch { /* fall through */ }
    // 2) the async API; a permission prompt that never answers must not leave the button silent
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(() => done(true), () => done(false));
    } catch { /* fall through */ }
    window.setTimeout(() => done(false), 1200);
  }

  private updateLobby(s: LobbyState): void {
    this.lastState = s;
    if (this.view !== 'lobby') return;
    // header copy per phase
    let title: string = S.connecting, sub = ' ';
    const filled = s.filled;
    switch (s.phase) {
      case 'connecting': title = S.connecting; break;
      case 'seeking':
        title = S.seeking;
        sub = s.waitLeftS !== null && s.waitLeftS > 0 ? vsFmt(S.seekingSub, { n: filled, s: s.waitLeftS }) : vsFmt(S.seekingNow, { n: filled });
        if (!s.host && s.waitLeftS === null) sub = vsFmt(S.guestSeekSub, { n: filled });
        break;
      case 'waiting':
        if (s.mode === 'rematch') { title = S.rematch; sub = vsFmt(S.rematchSub, { n: filled }); }
        else if (s.host) { title = S.roomHost; sub = vsFmt(S.roomHostSub, { n: filled }); }
        else { title = S.roomGuest; sub = vsFmt(S.roomGuestSub, { n: filled }); }
        break;
      case 'starting': title = S.starting; sub = S.startingSub; break;
      case 'loading': title = S.starting; sub = s.loading ? vsFmt(S.loadingN, { n: s.loading.ready, m: s.loading.total }) : S.startingWait; break;
      case 'full': title = S.full; sub = S.fullSub; break;
      case 'version': title = S.version; sub = S.versionSub; break;
      case 'looking': title = vsFmt(S.lookingTitle, { code: s.code ?? '' }); sub = S.lookingSub; break;
      case 'noroom': title = S.noRoomTitle; sub = vsFmt(S.noRoomSub, { code: s.code ?? '' }); break;
      case 'error': title = S.errorTitle; sub = s.error ? S.errorSub : S.errorSub; break;
      default: break;
    }
    const city = s.city && BIOMES[s.city as keyof typeof BIOMES] ? BIOMES[s.city as keyof typeof BIOMES].name.toUpperCase() : '';
    this.kicker.textContent = S.lobbyKicker;
    this.cityBox.classList.toggle('bt-hidden', !city);
    if (city && this.cityName.textContent !== city) this.cityName.textContent = city;
    this.title.textContent = title;
    this.sub.textContent = sub;
    this.layer.dataset.phase = s.phase;
    this.layer.dataset.mode = s.mode;

    // seat cards
    if (this.seatNodes.length !== VS.maxPlayers) this.buildSeats();
    for (let i = 0; i < this.seatNodes.length; i++) {
      const n = this.seatNodes[i], seat = s.seats[i];
      if (!seat) continue;
      const key = seat.open ? 'open|' + (seat.left ?? '') : seat.id + '|' + seat.titan + '|' + seat.name + '|' + seat.host + '|' + seat.me;
      const searching = s.phase === 'seeking' || s.phase === 'connecting' || s.phase === 'looking';
      if (n.key !== key + '|' + searching) {
        const wasOpen = n.key.startsWith('open');
        n.key = key + '|' + searching;
        n.root.classList.toggle('open', seat.open);
        n.root.classList.toggle('me', seat.me);
        if (seat.open) {
          n.name.set(seat.left !== null ? vsFmt(S.seatLeft, { name: seat.left || S.guest }) : S.open);
          n.state.set(seat.left !== null ? S.seatLeftSub : searching ? S.openSeek : S.openSub);
          n.tag.set(' ');
          n.img.removeAttribute('src');
          n.img.style.visibility = 'hidden';
          n.chip.classList.add('bt-hidden'); n.chip2.classList.add('bt-hidden');
        } else {
          n.name.set(seat.name || S.guest);
          n.tag.set(seat.titan ? titanTag(seat.titan) : ' ');
          n.state.set(S.seatFilled);
          const url = seat.titan ? this.portraits[seat.titan] : '';
          if (url) { n.img.src = url; n.img.style.visibility = 'visible'; } else n.img.style.visibility = 'hidden';
          n.chip.classList.toggle('bt-hidden', !seat.host);
          n.chip2.classList.toggle('bt-hidden', !seat.me);
          if (wasOpen) pulse(n.root, [{ transform: 'translateX(-6%)', opacity: 0.2 }, { transform: 'none', opacity: 1 }], 260);
        }
      }
    }
    // side panel
    const room = s.code !== null && s.phase !== 'version' && s.phase !== 'full' && s.phase !== 'error';
    this.roomPanel.classList.toggle('bt-hidden', !room);
    if (room) {
      this.codeBig.textContent = '';
      for (const ch of (s.code ?? '').slice(0, 12)) this.codeBig.appendChild(el('i', '', ch));
      this.inviteTxt.textContent = s.inviteUrl ?? '';
      // a joiner that has not found the room has nothing to invite anyone to yet: just the code (to check it)
      const noInvite = s.phase === 'looking' || s.phase === 'noroom';
      this.inviteLbl.classList.toggle('bt-hidden', noInvite);
      this.inviteTxt.classList.toggle('bt-hidden', noInvite);
    }
    const showDial = s.phase === 'seeking' && s.waitLeftS !== null;
    this.dial.classList.toggle('bt-hidden', !showDial);
    if (showDial) {
      this.dialNum.set(String(Math.max(0, s.waitLeftS ?? 0)));
      this.dialLbl.set(S.botsFill);
      this.dial.style.setProperty('--p', String(Math.max(0, Math.min(1, (s.waitLeftS ?? 0) / Math.max(1, VS.bots.quickMatchWaitS)))));
    }
    // notes: version / strangers / errors
    let note = '';
    let bad = false;
    if (s.phase === 'version') { note = S.versionSub; bad = true; }
    else if (s.phase === 'full') { note = S.fullSub; bad = true; }
    else if (s.phase === 'error') { note = S.errorSub + (s.error ? ' · ' + s.error.slice(0, 90).toUpperCase() : ''); bad = true; }
    else if (s.phase === 'noroom') { note = S.noHost; }
    else if (s.hostLeft) { note = S.hostLeftNote; }
    else if (s.strangers > 0) { note = vsFmt(S.versionOthers, { n: s.strangers }); bad = true; }
    this.note.textContent = note;
    this.note.classList.toggle('bt-hidden', note === '');
    this.note.classList.toggle('bad', bad);
    // buttons
    const busy = s.phase === 'starting' || s.phase === 'loading';
    this.startBtn.classList.toggle('bt-hidden', !s.canStartNow);
    this.retryBtn.classList.toggle('bt-hidden', s.phase !== 'noroom');
    this.copyBtn.classList.toggle('bt-hidden', !room || busy || s.phase === 'looking' || s.phase === 'noroom');
    this.leaveBtn.classList.toggle('bt-hidden', false);
    const backLbl = s.phase === 'noroom' ? S.back : S.leave;
    if (this.leaveLbl.textContent !== backLbl) this.leaveLbl.textContent = backLbl;
  }

  private buildSeats(): void {
    clearEl(this.seatsBox);
    this.seatNodes = [];
    for (let i = 0; i < VS.maxPlayers; i++) {
      const root = div('bt-lob-seat open', this.seatsBox);
      root.style.setProperty('--seat', VS.seatColors[i] ?? '#fff');
      root.dataset.slot = String(i);
      root.dataset.v2 = 'lobby-seat';
      const img = el('img', 'bt-lob-seat-ph');
      img.alt = ''; img.style.visibility = 'hidden';
      root.appendChild(img);
      const main = div('bt-lob-seat-main', root);
      const nm = div('bt-lob-seat-name', main);
      const nameB = el('b');
      nm.appendChild(nameB);
      const chip = el('span', 'bt-vs-chip crown bt-hidden', S.host);
      const chip2 = el('span', 'bt-vs-chip you bt-hidden', S.you);
      nm.appendChild(chip); nm.appendChild(chip2);
      const tag = div('bt-lob-seat-tag', main);
      const st = div('bt-lob-seat-state', main);
      this.seatNodes.push({ root, img, name: new TextSlot(nameB), chip, chip2, tag: new TextSlot(tag), state: new TextSlot(st), key: '' });
    }
  }

  // ─────────────────────────────── plumbing ───────────────────────────────

  private render(): void {
    const v = this.view;
    this.layer.dataset.view = v;
    if (v !== 'lobby') this.cityBox.classList.add('bt-hidden');
    this.menuBox.classList.toggle('bt-hidden', v !== 'menu');
    this.codeBox.classList.toggle('bt-hidden', v !== 'code');
    this.lobbyBox.classList.toggle('bt-hidden', v !== 'lobby');
    this.foot.classList.toggle('bt-hidden', v !== 'lobby');
    if (v === 'menu') {
      this.kicker.textContent = S.menuKicker;
      this.title.textContent = S.menuTitle;
      this.sub.textContent = S.menuSub;
      this.select(this.sel);
    } else if (v === 'code') {
      this.kicker.textContent = S.menuKicker;
      this.title.textContent = S.join;
      this.sub.textContent = S.codeHint;
      this.tiles.forEach((t, i) => { t.textContent = this.code[i] ?? ''; t.classList.toggle('on', i === this.code.length); t.classList.toggle('full', !!this.code[i]); });
      this.codeHint.textContent = S.codeHint;
      this.codeHint.classList.remove('bad');
    }
  }

  private show(): void {
    this.layer.classList.remove('bt-hidden');
    pulse(this.layer, [{ opacity: 0 }, { opacity: 1 }], 200);
  }

  private abortSession(): void {
    this.detachPaste();
    if (this.session && !this.session.done) this.session.abort();
    this.session = null;
  }

  /** hide whatever is showing (a forced transition) */
  clear(): void {
    this.lobbyDone = null;
    this.abortSession();
    this.layer.classList.add('bt-hidden');
  }

  get visible(): boolean { return !this.layer.classList.contains('bt-hidden'); }
}

