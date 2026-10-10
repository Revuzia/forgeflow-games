// GENESIS — one mute for the game and the ForgeFlow portal (public/game_controls.js).
//
// The portal's Mute button suspends every AudioContext, holds off resume() while muted and dispatches a window
// 'mutechange' event ({ detail: { muted } }); its state is window.__CONTROLS__.isMuted() and toggleMute() flips it (and
// remembers it as localStorage 'ff_muted'). The game's own Mute (Settings → Audio) reaches GenesisAudio.mute(). This
// keeps the two in agreement:
//   - the portal → the game: a 'mutechange' sets the engine's mute, and onMuteChange subscribers are told (the App
//     mirrors it into prefs.audio.muted, so the Settings switch shows it);
//   - the game → the portal: a mute() that changes what the game asks for is pushed to the portal (its button, its
//     icon and its memory follow; unmuting the game resumes the context the portal suspended).
// Last writer wins. Re-asserting the same request changes nothing: the App re-applies every audio pref whenever any of
// them moves (a volume slider), and that must not undo a mute the player made on the portal.
// At boot, if the two disagree, muted wins (and both end up muted): the portal has already suspended the context, or
// the player muted the game last time.

export interface PortalControls {
  isMuted(): boolean;
  toggleMute(): void;
}

/** the portal's controls on this page, if any (window.__CONTROLS__) */
export function findPortal(): PortalControls | null {
  if (typeof window === 'undefined') return null;
  const c = (window as unknown as { __CONTROLS__?: Partial<PortalControls> }).__CONTROLS__;
  return c && typeof c.isMuted === 'function' && typeof c.toggleMute === 'function' ? (c as PortalControls) : null;
}

export class MuteSync {
  /** what the game last asked for (mute()) */
  private requested: boolean;
  /** what is heard */
  private eff: boolean;
  private readonly portal: () => PortalControls | null;
  private readonly listeners = new Set<(muted: boolean) => void>();
  private pushing = false;

  constructor(initial: boolean, portal: () => PortalControls | null = findPortal) {
    this.portal = portal;
    this.requested = !!initial;
    this.eff = !!initial;
    const p = this.portalMuted();
    if (p != null && p !== this.eff) {
      this.eff = true;
      if (!p) this.push(true);
    }
  }

  get muted(): boolean { return this.eff; }

  /** the portal's own state (null: no portal on this page) */
  portalMuted(): boolean | null {
    try {
      const p = this.portal();
      return p ? !!p.isMuted() : null;
    } catch {
      return null;
    }
  }

  /** the game asks (GenesisAudio.mute); true when what is heard changed */
  request(on: boolean): boolean {
    const v = !!on;
    if (v === this.requested) return false;
    this.requested = v;
    const changed = v !== this.eff;
    this.eff = v;
    this.push(v);
    return changed;
  }

  /** the portal says (its 'mutechange'); true when what is heard changed (subscribers are told) */
  fromPortal(muted: boolean): boolean {
    if (this.pushing) return false;
    const v = !!muted;
    if (v === this.eff) return false;
    this.eff = v;
    for (const l of [...this.listeners]) {
      try { l(v); } catch (e) { console.warn('[genesis audio] onMuteChange listener failed', e); }
    }
    return true;
  }

  /**
   * `cb(muted)` whenever the mute changes from outside the game's own request (the portal's button). Called at once if
   * the portal already overrules what the game asked for. Returns an unsubscribe function.
   */
  subscribe(cb: (muted: boolean) => void): () => void {
    this.listeners.add(cb);
    if (this.eff !== this.requested) {
      try { cb(this.eff); } catch (e) { console.warn('[genesis audio] onMuteChange listener failed', e); }
    }
    return () => { this.listeners.delete(cb); };
  }

  private push(on: boolean): void {
    let p: PortalControls | null = null;
    try { p = this.portal(); } catch { p = null; }
    if (!p) return;
    this.pushing = true;
    try {
      if (!!p.isMuted() !== on) p.toggleMute();
    } catch {
      /* a portal that throws is left alone */
    } finally {
      this.pushing = false;
    }
  }
}
