// Settings application: what the player chose (`persisted`, saved), the session-only URL overrides on top (`raw`), the defaults of the
// optional round-2 fields (`settings`, resolved), and applying every one of them to audio, stage, body and haptics with change detection
// (an unrelated change never re-applies the quality tier, which rebuilds render targets).
//
//   volume / squishBoost / muted   audio.setSettings({ master, squishBoost, muted })   (muted also while hidden when there is no setPaused)
//   music                          audio.setMusic({ on: music > 0, volume: music }) (round 3), else setSettings({ music })
//   shake                          stage.setShakeScale(calm ? 0 : shake)                (DESIGN 6.6: Calm effects = no screen shake)
//   calm                           stage.setCalmEffects(calm) (round 2); the ceremony controller passes `calm` to the ceremony sounds
//   quality / gravity              stage.setQuality, body.gravity + stage.setFloatMode
//   haptics                        haptics.setEnabled(haptics && the device really vibrates)
//   extraSquish / skipAnimations / fastOpen / shortcuts are read where they act (driver, ceremonies, capsules, keyboard)
import type { Settings, SoftBodyLike, SquishAudio, StageLike } from '../contracts.ts';
import type { ResolvedSettings, SettingsEnv, StorageLike } from '../core/settings.ts';
import { SETTING_KEYS, loadSettings, resolveSettings, sanitizeSetting, sanitizeSettings, saveSettings } from '../core/settings.ts';
import type { Haptics } from '../input/haptics.ts';

export interface SettingsController {
  /** every field resolved (defaults filled in) */
  readonly settings: ResolvedSettings;
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
  /** re-apply everything that differs from what was last applied (force = everything) */
  apply(force?: boolean): void;
  /** another tab saved settings: adopt them (session overrides stay on top), apply, notify. Not saved again. */
  adoptExternal(s: Settings): void;
  onChange(fn: (s: ResolvedSettings) => void): () => void;
}

export interface SettingsDeps {
  storage: StorageLike | null;
  env: SettingsEnv;
  overrides: Partial<Settings>;
  audio: SquishAudio;
  stage: StageLike;
  haptics: Haptics;
  body(): SoftBodyLike;
  /** muted by the player (M / the HUD button / ?mute=1) */
  muted(): boolean;
  /** audio must be silent for a lifecycle reason (tab hidden, context lost) */
  audioPaused(): boolean;
  report(e: unknown): void;
  dirty(): void;
}

type Applied = Partial<ResolvedSettings> & { muted?: boolean; shakeScale?: number };

export function createSettingsController(d: SettingsDeps): SettingsController {
  let persisted: Settings = loadSettings(d.storage, d.env);
  let raw: Settings = sanitizeSettings({ ...persisted, ...d.overrides }, persisted);
  let settings: ResolvedSettings = resolveSettings(raw, d.env);
  let applied: Applied = {};
  const listeners = new Set<(s: ResolvedSettings) => void>();
  const notify = (): void => { for (const f of [...listeners]) { try { f({ ...settings }); } catch (e) { d.report(e); } } };

  function apply(force = false): void {
    const a = applied, s = settings, { audio, stage } = d;
    const mutedNow = d.muted() || (d.audioPaused() && !audio.setPaused);   // setPaused (suspend) is better; mute is the fallback
    if (force || a.volume !== s.volume || a.squishBoost !== s.squishBoost || a.muted !== mutedNow) {
      audio.setSettings({ master: s.volume, squishBoost: s.squishBoost, muted: mutedNow });
    }
    if (force || a.music !== s.music) {
      try {
        if (audio.setMusic) audio.setMusic({ on: s.music > 0.001, volume: s.music });
        else if (!force) audio.setSettings({ music: s.music });
      } catch (e) { d.report(e); }
    }
    const shakeScale = s.calm ? 0 : s.shake;
    if (force || a.shakeScale !== shakeScale) stage.setShakeScale(shakeScale);
    if (force || a.calm !== s.calm) { try { stage.setCalmEffects?.(s.calm); } catch (e) { d.report(e); } }
    if (force || a.quality !== s.quality) stage.setQuality(s.quality);
    if (force || a.gravity !== s.gravity) { d.body().gravity = s.gravity; stage.setFloatMode(!s.gravity); }
    const hapticsOn = s.haptics && d.env.vibrate;
    if (force || a.haptics !== hapticsOn) d.haptics.setEnabled(hapticsOn);
    applied = { ...s, haptics: hapticsOn, muted: mutedNow, shakeScale };
    d.dirty();
  }

  return {
    get settings() { return settings; },
    set(key, value) {
      if (!(SETTING_KEYS as readonly string[]).includes(key)) return;
      const v = sanitizeSetting(key, value, settings);
      raw = { ...raw, [key]: v };
      persisted = { ...persisted, [key]: v };
      settings = resolveSettings(raw, d.env);
      saveSettings(d.storage, persisted);
      apply();
      notify();
    },
    apply,
    adoptExternal(s) {
      persisted = s;
      raw = sanitizeSettings({ ...s, ...d.overrides }, s);
      settings = resolveSettings(raw, d.env);
      apply();
      notify();
    },
    onChange(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
}
