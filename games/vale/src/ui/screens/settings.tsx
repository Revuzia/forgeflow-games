// VALE UI — Settings (client_hud §12): five tabs, changes save as you make them (Session.updateSettings).
// Video: the quality preset + every ladder value (a manual change turns the preset Custom), render scale,
// frame-rate cap, sharpness, fullscreen. Audio: six sliders + mute in the background. Controls: a keycap
// for every action (a conflict MOVES the other bind and says so), quick cast, camera lock, edge pan +
// speed, attack on move, the self-cast key. Accessibility: colourblind palettes with live swatches and
// shape codes, FRAY seat colours (Automatic / Standard / Stamp-forward / Simple colours, previewed),
// UI scale 80–150 %, HUD and minimap scale, reduce motion, screen shake, subtitles. Gameplay toggles.

import type { ComponentChildren, JSX } from 'preact';
import type { Settings } from '../../contracts/session.ts';
import { defaultSettings } from '../../session/settings.ts';
import { useApp } from '../app_ctx.ts';
import { Button } from '../components/Button.tsx';
import { KeybindCapture } from '../components/KeybindCapture.tsx';
import { confirmDialog } from '../components/Modal.tsx';
import { Screen } from '../components/Screen.tsx';
import { SeatMark } from '../components/Seat.tsx';
import { Segmented, Select, type Option } from '../components/Select.tsx';
import { Slider } from '../components/Slider.tsx';
import { Tabs } from '../components/Tabs.tsx';
import { Toggle } from '../components/Toggle.tsx';
import { keyLabel } from '../keys.ts';
import type { FrayColors } from '../state.ts';
import { TOKENS } from '../tokens.ts';

type Tab = 'video' | 'audio' | 'controls' | 'access' | 'gameplay';
const TABS: Tab[] = ['video', 'audio', 'controls', 'access', 'gameplay'];
const pct = (v: number): string => `${Math.round(v * 100)}%`;

function Row(p: { id: string; label: string; desc?: string; children: ComponentChildren; wide?: boolean }): JSX.Element {
  return (
    <div class={`srow2 stg ${p.wide ? 'srow2--wide' : ''}`}>
      <div class="srow2__text">
        <label class="t-body srow2__label" for={p.id}>{p.label}</label>
        {p.desc ? <span class="t-caption muted srow2__desc">{p.desc}</span> : null}
      </div>
      <div class="srow2__ctl">{p.children}</div>
    </div>
  );
}

export function SettingsScreen(p: { params: Record<string, string> }): JSX.Element {
  const { cv, router, state, session, overlay } = useApp();
  const tab: Tab = (TABS as string[]).includes(p.params.tab) ? (p.params.tab as Tab) : 'video';
  const s = state.settings.value;
  const t = (k: string, f: string): string => cv.t(`settings.${k}`, f);
  const set = <K extends keyof Settings>(sec: K, patch: Partial<Settings[K]>): void => { session.updateSettings({ [sec]: { ...s[sec], ...patch } } as Partial<Settings>); };
  const resetTab = (): void => {
    void confirmDialog(overlay, { title: t('reset_tab', 'Reset this tab'), confirm: t('reset_tab', 'Reset this tab'), tone: 'danger' }).then((yes) => {
      if (!yes) return;
      const d = defaultSettings();
      if (tab === 'access') state.setPrefs({ frayColors: 'auto' });
      session.updateSettings({ [tab]: d[tab] } as Partial<Settings>);
      state.toast(cv.t('toast.settings_reset', 'Settings reset to defaults.'), 'ok');
    });
  };
  const resetAll = (): void => {
    void confirmDialog(overlay, { title: t('reset_defaults', 'Reset to defaults'), confirm: t('reset_defaults', 'Reset to defaults'), tone: 'danger' }).then((yes) => {
      if (!yes) return;
      state.setPrefs({ frayColors: 'auto' });
      session.updateSettings(defaultSettings());
      state.toast(cv.t('toast.settings_reset', 'Settings reset to defaults.'), 'ok');
    });
  };
  return (
    <Screen title={t('title', 'Settings')}
      headSide={<span class="t-body-s muted">{t('changes_saved', 'Changes are saved as you make them.')}</span>}
      foot={<div class="row">
        <Button variant="secondary" size="s" icon="reroll" onPress={resetTab}>{t('reset_tab', 'Reset this tab')}</Button>
        <Button variant="quiet" size="s" onPress={resetAll}>{t('reset_defaults', 'Reset to defaults')}</Button>
      </div>}>
      <Tabs label={t('title', 'Settings')} value={tab} onChange={(id) => router.setParams({ tab: id })}
        items={TABS.map((id) => ({ id, label: t(`tab.${id}`, id) }))} />
      <div class="tabpanel settings">
        {tab === 'video' ? <Video s={s} set={set} /> : null}
        {tab === 'audio' ? <Audio s={s} set={set} /> : null}
        {tab === 'controls' ? <Controls s={s} set={set} /> : null}
        {tab === 'access' ? <Access s={s} set={set} /> : null}
        {tab === 'gameplay' ? <Gameplay s={s} set={set} /> : null}
      </div>
    </Screen>
  );
}

type SetFn = <K extends keyof Settings>(sec: K, patch: Partial<Settings[K]>) => void;

function opts<T extends string | number>(cv: ReturnType<typeof useApp>['cv'], key: string, values: readonly T[]): Option<T>[] {
  return values.map((v) => ({ value: v, label: cv.t(`settings.${key}.opt.${v}`, String(v)) }));
}

function Video(p: { s: Settings; set: SetFn }): JSX.Element {
  const { cv } = useApp();
  const v = p.s.video;
  const L = (k: string, f: string): string => cv.t(`settings.video.${k}.label`, f);
  const D = (k: string): string => cv.t(`settings.video.${k}.desc`, '');
  const fullscreen = (on: boolean): void => {
    p.set('video', { fullscreen: on });
    try { if (on && !document.fullscreenElement) void document.documentElement.requestFullscreen?.(); else if (!on && document.fullscreenElement) void document.exitFullscreen?.(); } catch { /* not allowed here */ }
  };
  return (
    <div class="srows">
      <Row id="v-preset" label={L('preset', 'Quality preset')} desc={D('preset')} wide>
        <Segmented label={L('preset', 'Quality preset')} value={v.preset} onChange={(x) => p.set('video', { preset: x })}
          options={opts(cv, 'video.preset', ['low', 'medium', 'high', 'ultra', 'custom'] as const).map((o) => (o.value === 'custom' && v.preset !== 'custom' ? { ...o, disabled: D('preset') } : o))} />
      </Row>
      <Row id="v-scale" label={L('renderScale', 'Render scale')} desc={D('renderScale')}>
        <Slider id="v-scale" label={L('renderScale', 'Render scale')} value={v.renderScale} min={0.5} max={2} step={0.05} format={(x) => `${Math.round(x * 100)}%`} marks={[1]} onChange={(x) => p.set('video', { renderScale: x })} />
      </Row>
      <Row id="v-shadows" label={L('shadows', 'Shadows')} desc={D('shadows')}>
        <Segmented size="s" label={L('shadows', 'Shadows')} value={v.shadows} options={opts(cv, 'video.shadows', [0, 1, 2, 3] as const)} onChange={(x) => p.set('video', { shadows: x })} />
      </Row>
      <Row id="v-ao" label={L('ao', 'Ambient occlusion')} desc={D('ao')}>
        <Segmented size="s" label={L('ao', 'Ambient occlusion')} value={v.ao} options={opts(cv, 'video.ao', [0, 1, 2] as const)} onChange={(x) => p.set('video', { ao: x })} />
      </Row>
      <Row id="v-bloom" label={L('bloom', 'Bloom')} desc={D('bloom')}>
        <Toggle id="v-bloom" label={L('bloom', 'Bloom')} checked={v.bloom} onChange={(x) => p.set('video', { bloom: x })} />
      </Row>
      <Row id="v-aa" label={L('antialias', 'Edge smoothing')} desc={D('antialias')}>
        <Segmented size="s" label={L('antialias', 'Edge smoothing')} value={v.antialias} options={opts(cv, 'video.antialias', ['off', 'smaa', 'msaa'] as const)} onChange={(x) => p.set('video', { antialias: x })} />
      </Row>
      <Row id="v-particles" label={L('particles', 'Effects detail')} desc={D('particles')}>
        <Segmented size="s" label={L('particles', 'Effects detail')} value={v.particles} options={opts(cv, 'video.particles', [0, 1, 2] as const)} onChange={(x) => p.set('video', { particles: x })} />
      </Row>
      <Row id="v-scatter" label={L('scatter', 'Scenery detail')} desc={D('scatter')}>
        <Segmented size="s" label={L('scatter', 'Scenery detail')} value={v.scatter} options={opts(cv, 'video.scatter', [0, 1, 2] as const)} onChange={(x) => p.set('video', { scatter: x })} />
      </Row>
      <Row id="v-fps" label={L('fpsCap', 'Frame rate limit')} desc={D('fpsCap')}>
        <Select id="v-fps" label={L('fpsCap', 'Frame rate limit')} value={v.fpsCap} options={opts(cv, 'video.fpsCap', [0, 30, 60, 120, 144] as const)} onChange={(x) => p.set('video', { fpsCap: x })} />
      </Row>
      <Row id="v-dpr" label={L('maxDpr', 'Sharpness')} desc={D('maxDpr')}>
        <Slider id="v-dpr" label={L('maxDpr', 'Sharpness')} value={v.maxDpr} min={0.5} max={4} step={0.25} format={(x) => cv.t('settings.unit.x', '×{n}', { n: x })} marks={[1, 2]} onChange={(x) => p.set('video', { maxDpr: x })} />
      </Row>
      <Row id="v-fs" label={L('fullscreen', 'Fullscreen')} desc={D('fullscreen')}>
        <Toggle id="v-fs" label={L('fullscreen', 'Fullscreen')} checked={v.fullscreen} onChange={fullscreen} />
      </Row>
      <p class="t-body-s muted settings__note">{cv.t('settings.video.note', 'Every quality level draws danger areas the same way.')}</p>
    </div>
  );
}

function Audio(p: { s: Settings; set: SetFn }): JSX.Element {
  const { cv } = useApp();
  const a = p.s.audio;
  const keys = ['master', 'music', 'sfx', 'voice', 'ui', 'ambience'] as const;
  return (
    <div class="srows">
      {keys.map((k) => (
        <Row id={`a-${k}`} label={cv.t(`settings.audio.${k}.label`, k)} desc={cv.t(`settings.audio.${k}.desc`, '')}>
          <Slider id={`a-${k}`} label={cv.t(`settings.audio.${k}.label`, k)} value={a[k]} min={0} max={1} step={0.05} format={pct} onChange={(x) => p.set('audio', { [k]: x } as Partial<Settings['audio']>)} />
        </Row>
      ))}
      <Row id="a-bg" label={cv.t('settings.audio.muteInBackground.label', 'Mute in the background')} desc={cv.t('settings.audio.muteInBackground.desc', '')}>
        <Toggle id="a-bg" label={cv.t('settings.audio.muteInBackground.label', 'Mute in the background')} checked={a.muteInBackground} onChange={(x) => p.set('audio', { muteInBackground: x })} />
      </Row>
    </div>
  );
}

const ACTION_GROUPS: { key: string; actions: string[] }[] = [
  { key: 'abilities', actions: ['a1', 'a2', 'a3', 'ult', 'spell1', 'spell2'] },
  { key: 'items', actions: ['item1', 'item2', 'item3', 'item4', 'item5', 'item6'] },
  { key: 'commands', actions: ['attackMove', 'stop', 'recall', 'shop', 'ping', 'scoreboard'] },
  { key: 'camera', actions: ['cameraLock', 'centerCamera'] },
];

function Controls(p: { s: Settings; set: SetFn }): JSX.Element {
  const { cv, state } = useApp();
  const c = p.s.controls;
  const name = (a: string): string => cv.t(`settings.controls.action.${a}`, a);
  // the self-cast modifier is edited through `selfCastModifier` and mirrored into the binds' selfCastMod
  const bind = (action: string, code: string): void => {
    const binds = { ...c.binds };
    const prev = binds[action];
    const other = Object.keys(binds).find((k) => k !== action && binds[k] === code);
    binds[action] = code;
    if (other) {
      binds[other] = prev ?? '';
      state.toast(cv.t('toast.bind_conflict', '{key} was moved from {other} to {action}.', { key: keyLabel(code), other: name(other), action: name(action) }), 'warn');
    } else state.toast(cv.t('toast.bind_set', '{action} is now {key}.', { action: name(action), key: keyLabel(code) }), 'ok', undefined, 2400);
    const patch: Partial<Settings['controls']> = { binds };
    if (action === 'selfCastMod') patch.selfCastModifier = code;
    if (other === 'selfCastMod') patch.selfCastModifier = binds[other];
    p.set('controls', patch);
  };
  const defaults = defaultSettings().controls.binds;
  return (
    <div class="srows">
      <div class="srows__intro stg">
        <h2 class="t-h2">{cv.t('settings.controls.binds.title', 'Keys')}</h2>
        <span class="t-body-s muted">{cv.t('settings.controls.binds.desc', 'Click a key, then press the key or mouse button you want.')} {cv.t('settings.controls.cancel_hint', 'Press Esc to cancel.')}</span>
        <Button variant="quiet" size="s" icon="reroll" onPress={() => { p.set('controls', { binds: { ...defaults }, selfCastModifier: defaults.selfCastMod ?? c.selfCastModifier }); }}>{cv.t('settings.controls.reset_keys', 'Reset all keys')}</Button>
      </div>
      {ACTION_GROUPS.map((g) => (
        <div class="bindgroup stg">
          <h3 class="t-label muted bindgroup__title">{cv.t(`settings.controls.group.${g.key}`, g.key)}</h3>
          <div class="bindgroup__rows">
            {g.actions.map((a) => (
              <div class="bindrow">
                <span class="t-body-s">{name(a)}</span>
                <KeybindCapture label={name(a)} code={c.binds[a] ?? ''} onChange={(code) => bind(a, code)} isDefault={c.binds[a] === defaults[a]} />
              </div>
            ))}
          </div>
        </div>
      ))}
      <Row id="c-qc" label={cv.t('settings.controls.quickCast.label', 'Quick cast')} desc={cv.t('settings.controls.quickCast.desc', '')}>
        <Toggle id="c-qc" label={cv.t('settings.controls.quickCast.label', 'Quick cast')} checked={c.quickCast} onChange={(x) => p.set('controls', { quickCast: x })} />
      </Row>
      <Row id="c-lock" label={cv.t('settings.controls.cameraLock.label', 'Lock camera to your fighter')} desc={cv.t('settings.controls.cameraLock.desc', '')}>
        <Toggle id="c-lock" label={cv.t('settings.controls.cameraLock.label', 'Lock camera to your fighter')} checked={c.cameraLock} onChange={(x) => p.set('controls', { cameraLock: x })} />
      </Row>
      <Row id="c-edge" label={cv.t('settings.controls.edgePan.label', 'Edge pan')} desc={cv.t('settings.controls.edgePan.desc', '')}>
        <Toggle id="c-edge" label={cv.t('settings.controls.edgePan.label', 'Edge pan')} checked={c.edgePan} onChange={(x) => p.set('controls', { edgePan: x })} />
      </Row>
      <Row id="c-pan" label={cv.t('settings.controls.panSpeed.label', 'Pan speed')} desc={cv.t('settings.controls.panSpeed.desc', '')}>
        <Slider id="c-pan" label={cv.t('settings.controls.panSpeed.label', 'Pan speed')} value={c.panSpeed} min={0} max={1} step={0.05} format={pct} disabled={c.edgePan ? undefined : cv.t('settings.controls.edgePan.label', 'Edge pan')} onChange={(x) => p.set('controls', { panSpeed: x })} />
      </Row>
      <Row id="c-am" label={cv.t('settings.controls.attackMoveOnClick.label', 'Attack on move')} desc={cv.t('settings.controls.attackMoveOnClick.desc', '')}>
        <Toggle id="c-am" label={cv.t('settings.controls.attackMoveOnClick.label', 'Attack on move')} checked={c.attackMoveOnClick} onChange={(x) => p.set('controls', { attackMoveOnClick: x })} />
      </Row>
      <Row id="c-self" label={cv.t('settings.controls.selfCastModifier.label', 'Self-cast key')} desc={cv.t('settings.controls.selfCastModifier.desc', '')}>
        <KeybindCapture modifier label={cv.t('settings.controls.selfCastModifier.label', 'Self-cast key')} code={c.selfCastModifier} onChange={(code) => bind('selfCastMod', code)} />
      </Row>
    </div>
  );
}

/** a relationship bar drawn with its shape code (self double frame · ally rounded · enemy chevron · neutral square) */
function RelBar(p: { kind: 'self' | 'ally' | 'enemy' | 'neutral'; color: string }): JSX.Element {
  const d = p.kind === 'ally' ? 'M6 2h28a4 4 0 0 1 0 8H6a4 4 0 0 1 0-8z' : p.kind === 'enemy' ? 'M4 2h32l-3 4 3 4H4l3-4z' : 'M2 2h36v8H2z';
  return (
    <svg viewBox="0 0 40 12" class="relbar" aria-hidden="true">
      <path d={d} fill={p.color} />
      {p.kind === 'self' ? <path d="M0.5 0.5h39v11H0.5z" fill="none" stroke={p.color} stroke-width="1" /> : null}
    </svg>
  );
}

function Swatches(p: { mode: 'off' | 'deutan' | 'protan' | 'tritan' }): JSX.Element {
  const { cv } = useApp();
  const base = { self: TOKENS.team.self, ally: TOKENS.team.ally, enemy: TOKENS.team.enemy };
  const pal = p.mode === 'off' ? base : TOKENS.colorblind[p.mode];
  const kinds = [['self', pal.self], ['ally', pal.ally], ['enemy', pal.enemy], ['neutral', TOKENS.team.neutral]] as const;
  return (
    <span class="swatches">
      {kinds.map(([k, c]) => <span class="swatch" title={`${cv.t(`settings.access.colors.${k}`, k)} · ${c}`}><RelBar kind={k} color={c} /></span>)}
    </span>
  );
}

function Access(p: { s: Settings; set: SetFn }): JSX.Element {
  const { cv, state } = useApp();
  const x = p.s.access;
  const L = (k: string, f: string): string => cv.t(`settings.access.${k}.label`, f);
  const D = (k: string): string => cv.t(`settings.access.${k}.desc`, '');
  const modes = ['off', 'deutan', 'protan', 'tritan'] as const;
  const fray = state.prefs.value.frayColors;
  const [ulo, uhi] = TOKENS.type.uiScale;
  const [hlo, hhi] = TOKENS.hud.scale.hud;
  const [mlo, mhi] = TOKENS.hud.scale.minimap;
  return (
    <div class="srows">
      <Row id="x-cvd" label={L('colorblind', 'Colourblind mode')} desc={D('colorblind')} wide>
        <div class="cvd" role="radiogroup" aria-label={L('colorblind', 'Colourblind mode')} data-arrownav="grid">
          {modes.map((m) => (
            <button type="button" role="radio" aria-checked={x.colorblind === m} data-nav="" class={`cvd__opt plate ${x.colorblind === m ? 'is-selected plate--lit' : ''}`}
              onClick={() => p.set('access', { colorblind: m })}>
              {x.colorblind === m ? <span class="tick" aria-hidden="true" /> : null}
              <span class="t-label">{cv.t(`settings.access.colorblind.opt.${m}`, m)}</span>
              <Swatches mode={m} />
              <span class="t-caption muted">{cv.t(`settings.access.colorblind.opt_desc.${m}`, '')}</span>
            </button>
          ))}
        </div>
      </Row>
      <Row id="x-fray" label={L('fray', 'FRAY seat colours')} desc={D('fray')} wide>
        <div class="stack stack--s">
          <Segmented label={L('fray', 'FRAY seat colours')} value={fray} onChange={(v) => state.setPrefs({ frayColors: v as FrayColors | 'auto' })}
            options={(['auto', 'standard', 'stamp', 'simple'] as const).map((v) => ({ value: v, label: cv.t(`settings.access.fray.opt.${v}`, v), desc: cv.t(`settings.access.fray.opt_desc.${v}`, '') }))} />
          <span class="t-caption muted">{cv.t(`settings.access.fray.opt_desc.${fray}`, '')}</span>
          <div class="seatpreview" aria-label={L('fray', 'FRAY seat colours')}>
            {TOKENS.fray.map((s, i) => <SeatMark seat={s.seat} you={i === 3} size={20} />)}
          </div>
        </div>
      </Row>
      <Row id="x-ui" label={L('uiScale', 'UI scale')} desc={D('uiScale')}>
        <Slider id="x-ui" label={L('uiScale', 'UI scale')} value={Math.min(uhi, Math.max(ulo, x.uiScale))} min={ulo} max={uhi} step={0.05} format={pct} marks={[1]} onChange={(v) => p.set('access', { uiScale: v })} />
      </Row>
      <Row id="x-hud" label={L('hudScale', 'HUD scale')} desc={D('hudScale')}>
        <Slider id="x-hud" label={L('hudScale', 'HUD scale')} value={Math.min(hhi, Math.max(hlo, x.hudScale))} min={hlo} max={hhi} step={0.05} format={pct} marks={[1]} onChange={(v) => p.set('access', { hudScale: v })} />
      </Row>
      <Row id="x-mm" label={L('minimapScale', 'Minimap scale')} desc={D('minimapScale')}>
        <Slider id="x-mm" label={L('minimapScale', 'Minimap scale')} value={Math.min(mhi, Math.max(mlo, x.minimapScale))} min={mlo} max={mhi} step={0.05} format={pct} marks={[1]} onChange={(v) => p.set('access', { minimapScale: v })} />
      </Row>
      <Row id="x-rm" label={L('reduceMotion', 'Reduce motion')} desc={D('reduceMotion')}>
        <Toggle id="x-rm" label={L('reduceMotion', 'Reduce motion')} checked={x.reduceMotion} onChange={(v) => p.set('access', { reduceMotion: v })} />
      </Row>
      <Row id="x-shake" label={L('screenShake', 'Screen shake')} desc={D('screenShake')}>
        <Slider id="x-shake" label={L('screenShake', 'Screen shake')} value={x.screenShake} min={0} max={1} step={0.05} format={pct} onChange={(v) => p.set('access', { screenShake: v })} />
      </Row>
      <Row id="x-loc" label={L('locFlash', 'Loss-of-control edge')} desc={D('locFlash')}>
        <Toggle id="x-loc" label={L('locFlash', 'Loss-of-control edge')} checked={x.locFlash} onChange={(v) => p.set('access', { locFlash: v })} />
      </Row>
      <Row id="x-dmg" label={L('damageFlash', 'Hit edge')} desc={D('damageFlash')}>
        <Toggle id="x-dmg" label={L('damageFlash', 'Hit edge')} checked={x.damageFlash} onChange={(v) => p.set('access', { damageFlash: v })} />
      </Row>
      <Row id="x-sub" label={L('subtitles', 'Subtitles')} desc={D('subtitles')}>
        <Toggle id="x-sub" label={L('subtitles', 'Subtitles')} checked={x.subtitles} onChange={(v) => p.set('access', { subtitles: v })} />
      </Row>
    </div>
  );
}

function Gameplay(p: { s: Settings; set: SetFn }): JSX.Element {
  const { cv } = useApp();
  const g = p.s.gameplay;
  const toggles = ['showDamageNumbers', 'showAllyIndicators', 'healthBarTicks'] as const;
  return (
    <div class="srows">
      {toggles.map((k) => (
        <Row id={`g-${k}`} label={cv.t(`settings.gameplay.${k}.label`, k)} desc={cv.t(`settings.gameplay.${k}.desc`, '')}>
          <Toggle id={`g-${k}`} label={cv.t(`settings.gameplay.${k}.label`, k)} checked={g[k]} onChange={(v) => p.set('gameplay', { [k]: v } as Partial<Settings['gameplay']>)} />
        </Row>
      ))}
      <Row id="g-side" label={cv.t('settings.gameplay.minimapSide.label', 'Minimap side')} desc={cv.t('settings.gameplay.minimapSide.desc', '')}>
        <Segmented size="s" label={cv.t('settings.gameplay.minimapSide.label', 'Minimap side')} value={g.minimapSide} options={opts(cv, 'gameplay.minimapSide', ['right', 'left'] as const)} onChange={(v) => p.set('gameplay', { minimapSide: v })} />
      </Row>
    </div>
  );
}

