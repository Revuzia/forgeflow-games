import sys
p = 'src/game.ts'
s = open(p, encoding='utf-8').read()


def rep(old, new, cnt=1):
    global s
    n = s.count(old)
    if n != cnt:
        print('MISMATCH', n, repr(old[:90]))
        sys.exit(1)
    s = s.replace(old, new)


rep("""import { BUDGET, INPUT_BUFFER_S, SIM_DT, ULT } from './core/config.ts';""",
    """import { BUDGET, GATES, INPUT_BUFFER_S, SIM_DT, ULT } from './core/config.ts';""")
rep("""import type { CineVariant, DraftResultV2, FaceAnchor, SelectResume, SelectResultV2, TabloidChoiceV2 } from './v2types.ts';""",
    """import type { CineVariant, CiviliansAddV3, DraftResultV2, FaceAnchor, SelectResume, SelectResultV2, TabloidChoiceV2 } from './v2types.ts';
import { endFinale } from './meta/gates.ts';   // GATEKEEPERS §4.3: the finale skip (K0 stub: no-op)""")

rep("""  private stingT = 0;""", """  private stingT = 0;
  // GATEKEEPERS (§4.3, §6.6): the gate nameplate hides 1.5 s after gateDefeated; the finale's app clock
  // (s since `finale on`, −1 = none) drives the SKIP hint (after GATES.finaleSkipS) and Enter / pad A
  private gateBarHideT = 0;
  private finaleAppT = -1;
  private finaleHint: HTMLElement | null = null;
  private civilians!: CivilianView;""")

rep("""      new CivilianView(ctx),""", """      (this.civilians = new CivilianView(ctx)),""")

rep("""    this.hitStopT = 0;
    this.sizeUpHoldT = 0;
    this.input.bufferS = INPUT_BUFFER_S;
    this.stingT = 0;""", """    this.hitStopT = 0;
    this.sizeUpHoldT = 0;
    this.input.bufferS = INPUT_BUFFER_S;
    this.stingT = 0;
    this.gateBarHideT = 0;
    this.setFinaleHint(-1);""")

rep("""    } else if (w.tick > this.draftSuppressTick && hasPendingDraft(w)) {
      this.wantDraft = true;""", """    } else if (w.tick > this.draftSuppressTick && hasPendingDraft(w) && !(w.gates.finaleT > 0)) {
      // (GATEKEEPERS §4.3: draft screens are held for the finale — the level-ups stay owed)
      this.wantDraft = true;""")

rep("""        case 'runEnd': this.beginEnding(e.result); break;
        case 'ultFire': this.onUltFire(); break;     // v2 UPROAR
        default: break;""", """        case 'runEnd': this.beginEnding(e.result); break;
        case 'ultFire': this.onUltFire(); break;     // v2 UPROAR
        // ── GATEKEEPERS (§7.3; K0 pre-wire — the HUD / bossbar / sfx / views read the same events) ──
        case 'gateLocked': this.stingT = Math.max(this.stingT, 2); break;   // the GROW-bar lock refreshes from hud.onEvents
        case 'gateSpawn': {
          const def = BOSSES[e.gate];
          if (def) this.bossbar.show(def);           // ui/bossbar.ts renders the GATEKEEPER variant from def.role (lane K2b)
          this.gateBarHideT = 0;
          this.music.setIntensity(1);                // no track switch: the biome track at intensity 1 (§6.8)
          this.stingT = Math.max(this.stingT, 3);
          break;
        }
        case 'gateDefeated': this.gateBarHideT = 1.5; this.stingT = Math.max(this.stingT, 4); break;
        case 'finale': this.onFinale(e.on); break;
        default: break;""")

rep("""  /** v2 UPROAR fire (FEATURES_V2 §3.6): hit-stop, widened input buffer, camera punch (unless reduce motion). */""",
    """  /** GATEKEEPERS §4.3: the Size V finale (app side). on: the boss track resolves into a brass swell (lane K2a's
   *  audio, called only when present), 120 fleeing civilians around the titan (render/civilians.ts surge,
   *  lane K2a — called only when present), the SKIP hint after GATES.finaleSkipS; draft screens are held
   *  (onStep). off: the hint goes (runEnd clear follows on the same tick). */
  private onFinale(on: boolean): void {
    if (!on) { this.setFinaleHint(-1); return; }
    this.setFinaleHint(0);
    this.music.setIntensity(1);
    const mu = this.music as unknown as { swell?: () => void };
    if (typeof mu.swell === 'function') mu.swell();
    const w = this._world;
    const cv = this.civilians as unknown as Partial<CiviliansAddV3>;
    if (w && typeof cv.surge === 'function') cv.surge(w.titan.x, w.titan.z, 3 * w.titan.height, 120);
  }

  /** The finale SKIP hint: t < 0 removes it; t ≥ 0 keeps the app clock (shown from GATES.finaleSkipS). */
  private setFinaleHint(t: number): void {
    this.finaleAppT = t;
    if (t < 0) { if (this.finaleHint) { this.finaleHint.remove(); this.finaleHint = null; } return; }
  }

  private stepFinaleHint(w: World, dt: number): void {
    if (this.finaleAppT < 0) return;
    if (!(w.gates.finaleT > 0) || w.gates.finaleDone) { this.setFinaleHint(-1); return; }
    this.finaleAppT += dt;
    if (this.finaleAppT < GATES.finaleSkipS || this._screen !== 'play' || this.ending) return;
    const pad = this.input.lastDevice === 'gamepad';
    if (!this.finaleHint) {
      // K0 placeholder hint (lane K2b styles it and moves the copy to data/strings_gate.ts)
      const el = document.createElement('div');
      el.dataset.gate = 'finale-skip';
      el.style.cssText = 'position:absolute;right:24px;bottom:24px;font:700 14px/1 sans-serif;letter-spacing:.12em;color:#f4ecd8;'
        + 'background:rgba(27,20,38,.72);padding:8px 12px;border-radius:4px;pointer-events:none;z-index:40';
      this.uiRoot.appendChild(el);
      this.finaleHint = el;
    }
    const txt = pad ? 'SKIP [A]' : 'SKIP [ENTER]';
    if (this.finaleHint.textContent !== txt) this.finaleHint.textContent = txt;
    // Enter (keyboard 'confirm' without Space's 'ability') or pad A (gameplay 'ability' from the gamepad)
    const enter = this.input.pressed('confirm') && !this.input.pressed('ability');
    const padA = pad && this.input.pressed('ability');
    if (enter || padA) { this.mutate((ww) => endFinale(ww)); }
  }

  /** v2 UPROAR fire (FEATURES_V2 §3.6): hit-stop, widened input buffer, camera punch (unless reduce motion). */""")

rep("""    if (this._screen === 'play' && !this.ending) {
      this.musicAcc += dt;""", """    // GATEKEEPERS: the gate nameplate hides 1.5 s after gateDefeated (unless a new fight took the slot)
    if (this.gateBarHideT > 0) {
      this.gateBarHideT -= dt;
      if (this.gateBarHideT <= 0) { this.gateBarHideT = 0; if (!(w.boss && w.boss.alive)) this.bossbar.hide(); }
    }
    this.stepFinaleHint(w, dt);
    if (this._screen === 'play' && !this.ending) {
      this.musicAcc += dt;""")

rep("""      else choice = await this.broadcast.tabloid(w, photo, { newGoals, canContinue });""",
    """      else choice = await this.broadcast.tabloid(w, photo, { newGoals, canContinue, heldBy: this.heldBy(w) });""")

rep("""  private onRankUp(rank: RankIndex): void {""", """  /** GATEKEEPERS §2.6: the gatekeeper that held the titan when it died (its name), else null. */
  private heldBy(w: World): string | null {
    if (w.run.result !== 'dead') return null;
    const b = w.boss;
    const live = b && b.alive && b.role === 'gate' ? b : null;
    if (!live && !(w.gates.active >= 1 && w.gates.active <= 3)) return null;
    const def = live ? BOSSES[live.id] : null;
    return def ? def.name : null;
  }

  private onRankUp(rank: RankIndex): void {""")
open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('ok game.ts')
