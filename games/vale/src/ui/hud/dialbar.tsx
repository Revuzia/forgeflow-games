// VALE HUD — the Dial Bar (STYLE_BIBLE HUD density: bottom centre, 640 × 132 at 1080p; client_hud §4.2):
// portrait with the level ring (XP as a linear shadow sweep), the passive badge, the skill-point dot and
// the stats tab; abilities 64 px, ultimate 76, battle spells 48, each with its key chip, rank pips
// (hour-ticks), cost (HARM when you cannot pay), an ink cooldown shadow sweeping clockwise from 12 o'clock
// with the seconds in Mono 22/700 (m:ss from a minute up), a ready moment (a 250 ms chalk wash that
// settles + the glint), a chalk-hi border while the ability's effect runs (draining along the bottom), a
// chalk "+" to level, a recast ring, charges, and the LOCK when you cannot cast it (stun, airborne,
// sleep, taunt, fear; silence for abilities; root for dashes): darkened, an ember wash and the status
// mark; HP over the resource row (the damage trail 150 ms hold / 450 ms out, the hatched Dawnglass
// shield, ticks every 100 / 1,000 HP) with quiet "+x.x" regeneration at their right ends; your status
// row over the frame; items 3 × 2 with their cooldowns (locked with the abilities, the same mark); Gleam
// in Mono with the shop key, and recall. Down: the bar dims to 60 % and a respawn ring replaces the level
// ring. A level-up is a moment: two chalk rings leave the medallion, the level chip swings, "Level n" rises.
// The stats tab opens the LEDGER (also while the scoreboard is held): your numbers in VALE's four families
// — Strike, Craft, Guard, Stride — rising off the medallion, its gnomon wedge pointing down at your face.
// A refused press shakes its slot and a cast dips it; under reduce motion both are a short light change.
//
// r12 B4: nothing here re-renders per sim tick. Each widget re-renders on a key of its discrete state
// (useViewKey) and writes its continuous values (sweeps, seconds, bars, Gleam, rings) per tick (useWriter).

import type { CSSProperties, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { SlotT } from '../../contracts/catalog.ts';
import type { AbilityView } from '../../contracts/sim.ts';
import type { AbilityCore, AbilityIndex } from '../../input/index.ts';
import { reachOf } from '../../input/index.ts';
import { useApp } from '../app_ctx.ts';
import { Portrait } from '../components/Portrait.tsx';
import { AbilityTip, TipText, useTip } from '../components/Tooltip.tsx';
import { fmt1, fmtInt, fmtNum } from '../format.ts';
import { cdText, put, setCls, setStyle, setVar, setW, useHud, useViewKey, useWriter } from './ctx.ts';
import { abilityFamily, AbilityGlyph, GleamGlyph, ItemGlyph, StatusGlyph } from './glyphs.tsx';
import { ItemTip } from './itemtip.tsx';
import { FRAME } from './frame_layout.ts';
import type { HudModel } from './model.ts';
import { StatusRow } from './status.tsx';
import FRAME_URL from '../art/hud/dialbar.webp?url';

const ABILITY_SLOTS: SlotT[] = ['a1', 'a2', 'a3', 'ult'];
const SPELL_SLOTS: SlotT[] = ['spell1', 'spell2'];
const F = FRAME.dialbar;
const DAWN = 'cubic-bezier(0.16, 1, 0.3, 1)';
const SWING = 'cubic-bezier(0.34, 1.4, 0.64, 1)';
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
/** absolute placement in the frame's 1080p coordinates (scaled by --px) */
const at = (x: number, y: number, w?: number, h?: number): CSSProperties => ({
  left: `calc(${x} * var(--px))`, top: `calc(${y} * var(--px))`,
  ...(w !== undefined ? { width: `calc(${w} * var(--px))` } : {}), ...(h !== undefined ? { height: `calc(${h} * var(--px))` } : {}),
});
const reduced = (): boolean => document.documentElement.classList.contains('reduce-motion');
/** "+2.4" / "−1.0" per second; empty when there is none to speak of */
const regenText = (r: number | undefined): string => (!r || Math.abs(r) < 0.05 ? '' : `${r > 0 ? '+' : '−'}${fmt1(Math.abs(r))}`);

export function DialBar(): JSX.Element | null {
  const { cv } = useApp();
  const { model, board, statsOpen } = useHud();
  useViewKey(() => { const me = model.me; if (!me) return 'x'; const b = model.body; return b && b.alive ? 'a' : 'd'; });
  const me = model.me;
  if (!me) return null;
  const body = model.body;
  const dead = !body || !body.alive;
  return (
    <section class={`dbar ${dead ? 'is-dead' : ''}`} aria-label="Dial Bar">
      <div class="dbar__status" style={{ left: `calc(${F.hp[0]} * var(--px))` }}>
        <StatusRow of={() => model.body} label={cv.t('hud.your_status', 'Your status')} />
      </div>
      <DialPortrait />
      {[...ABILITY_SLOTS, ...SPELL_SLOTS].map((s) => <AbilitySlot slot={s} key={s} />)}
      <Bars />
      {[0, 1, 2, 3, 4, 5].map((i) => <ItemSlot i={i} key={i} />)}
      <Utility />
      <img class="dbar__frame" src={FRAME_URL} alt="" draggable={false} />
      {statsOpen.value || board.value ? <StatsLedger /> : null}
    </section>
  );
}

// ── portrait ─────────────────────────────────────────────────────────────────────────────────────
function DialPortrait(): JSX.Element | null {
  const { cv } = useApp();
  const { model, client, statsOpen, key } = useHud();
  useViewKey(() => {
    const me = model.me;
    if (!me) return '';
    const b = model.body;
    return `${b?.level ?? 1}|${!b || !b.alive ? 1 : 0}|${me.recallProgress > 0 ? 1 : 0}|${me.skillPoints}|${me.lives ?? ''}`;
  });
  const arc = useRef<SVGCircleElement>(null);
  const tipDot = useRef<SVGCircleElement>(null);
  const respawn = useRef<HTMLSpanElement>(null);
  const respawnMax = useRef(1);
  const C = 2 * Math.PI * F.medallion.ring;
  useWriter(() => {
    const me = model.me;
    if (!me) return;
    const b = model.body;
    const dead = !b || !b.alive;
    if (dead && me.respawnIn > respawnMax.current) respawnMax.current = me.respawnIn;
    if (!dead) respawnMax.current = 1;
    const xp = me.xpToNext > 0 ? clamp01(me.xp / me.xpToNext) : 1;
    const ring = dead ? 1 - me.respawnIn / Math.max(1, respawnMax.current) : me.recallProgress > 0 ? me.recallProgress : xp;
    setStyle(arc.current, 'strokeDasharray', `${(C * ring).toFixed(1)} ${C.toFixed(1)}`);
    const t = tipDot.current;
    if (t) { setStyle(t, 'transform', `rotate(${(ring * 360).toFixed(1)}deg)`); }
    put(respawn.current, dead ? String(Math.ceil(me.respawnIn)) : '');
  });
  // the level-up moment: two chalk rings leave the medallion, the chip swings, the caption rises
  const flash = useRef<HTMLDivElement>(null);
  const flash2 = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLSpanElement>(null);
  const lv = model.levelUp.value;
  useEffect(() => {
    if (!lv.n) return;
    const rm = reduced();
    flash.current?.animate([{ opacity: 0.95, transform: 'scale(0.86)' }, { opacity: 0, transform: 'scale(1.32)' }], { duration: rm ? 120 : 720, easing: DAWN });
    if (!rm) flash2.current?.animate([{ opacity: 0.8, transform: 'scale(0.9)' }, { opacity: 0, transform: 'scale(1.55)' }], { duration: 900, delay: 140, easing: DAWN, fill: 'backwards' });
    if (!rm) chip.current?.animate([{ transform: 'translateX(-50%) scale(1.45)', background: '#FFF8EA', color: '#0B0D11' }, { transform: 'translateX(-50%) scale(1)' }], { duration: 360, easing: SWING });
  }, [lv.n]);

  const me = model.me;
  const f = cv.fighter(me?.fighter);
  const passive = f?.kit.passive;
  const tip = useTip(passive ? () => <AbilityTip record={{ ...passive, cooldown: 0 }} kind={cv.t('hud.passive', 'Passive')} /> : null, { place: 'above' });
  const statsTip = useTip(() => <TipText text={cv.t('hud.stats.title', 'Stats')} sub={cv.t('hud.stats.hint', 'Also shown while you hold {key}.', { key: key('scoreboard') })} />, { place: 'above' });
  if (!me) return null;
  const body = model.body;
  const level = body?.level ?? 1;
  const dead = !body || !body.alive;
  const recall = me.recallProgress > 0;
  const lives = me.lives;
  const rules = cv.mode(client.setup.mode)?.rules;
  const R = F.medallion.r;
  return (
    <>
    <div class="dport__under" style={at(F.medallion.c[0] - F.medallion.face, F.medallion.c[1] - F.medallion.face, 2 * F.medallion.face, 2 * F.medallion.face)}>
      <Portrait fighter={f} skin={me.skin} size="fill" round class="dport__img" />
    </div>
    <div class="dport" style={at(F.medallion.c[0] - R, F.medallion.c[1] - R, 2 * R, 2 * R)}>
      <div class={`dport__face ${recall ? 'is-recall' : ''}`}>
        <svg class="dport__ring" viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`} aria-hidden="true">
          <circle r={F.medallion.ring} class="dport__track" />
          <circle ref={arc} r={F.medallion.ring} class={`dport__arc ${dead ? 'is-respawn' : recall ? 'is-recall' : ''}`} transform="rotate(-90)" />
          <circle ref={tipDot} cx="0" cy={-F.medallion.ring} r="3.2" class={`dport__tip ${dead ? 'is-respawn' : ''}`} />
        </svg>
        <div ref={flash} class="dport__flash" aria-hidden="true" />
        <div ref={flash2} class="dport__flash dport__flash--2" aria-hidden="true" />
        {dead ? <span class="dport__respawn num" ref={respawn} /> : null}
        <span ref={chip} class="dport__level num" title={cv.t('hud.xp', '{xp} / {next} XP', { xp: fmtInt(me.xp), next: fmtInt(me.xpToNext) })}>{level}</span>
        {me.skillPoints > 0 ? <span class="dport__sp" title={cv.t('hud.skill_points', '{n} points to spend', { n: me.skillPoints })} /> : null}
        {passive ? <span class="dport__passive" tabIndex={0} {...tip} aria-label={passive.name}><svg viewBox="0 0 24 24"><path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z" fill="currentColor" /></svg></span> : null}
        <button type="button" class={`dport__stats ${statsOpen.value ? 'is-on' : ''}`} {...statsTip} aria-pressed={statsOpen.value} aria-label={cv.t('hud.stats.title', 'Stats')}
          onPointerDown={(e) => e.stopPropagation()} onClick={() => { statsOpen.value = !statsOpen.value; }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12M6 12h8M6 17h10" /></svg>
        </button>
      </div>
      {lv.n ? <LevelMoment key={lv.n} level={lv.level} points={me.skillPoints} /> : null}
      {lives !== undefined && rules?.end.lives ? (
        <div class="dport__lives" title={cv.t('fray.lives_n', '{n} lives', { n: lives })}>
          {Array.from({ length: rules.end.lives }, (_, i) => <i class={i < lives ? 'is-on' : ''} />)}
        </div>
      ) : null}
    </div>
    </>
  );
}

/** "Level 7" rising off the medallion for 900 ms (CSS: lvlup-life), with what to do next */
function LevelMoment(p: { level: number; points: number }): JSX.Element | null {
  const { cv } = useApp();
  const [done, setDone] = useState(false);
  if (done) return null;
  return (
    <div class="lvlup" role="status" aria-live="polite" onAnimationEnd={() => setDone(true)}>
      <span class="lvlup__wedge" aria-hidden="true" />
      <span class="lvlup__title t-h2">{cv.t('hud.level', 'Level {n}', { n: p.level })}</span>
      {p.points > 0 ? <span class="lvlup__sub t-caption">{p.points === 1 ? cv.t('hud.skill_point', 'Level up an ability') : cv.t('hud.skill_points', '{n} points to spend', { n: fmtInt(p.points) })}</span> : null}
    </div>
  );
}

// ── abilities ────────────────────────────────────────────────────────────────────────────────────
/** a refused press shakes the slot, a cast dips and brightens it; reduce motion keeps only a short light
 *  change (darker for a refusal, brighter for a cast), no movement */
function useSlotAnims(slot: string, el: { current: HTMLElement | null }): void {
  const { model } = useHud();
  const dn = model.denied.value;
  useEffect(() => {
    const e = el.current;
    if (!dn.n || dn.slot !== slot || !e) return;
    if (reduced()) e.animate([{ filter: 'brightness(0.5)' }, { filter: 'brightness(1)' }], { duration: 220, easing: 'linear' });
    else e.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' }], { duration: 220 });
  }, [dn.n]);
  const pr = model.pressed.value;
  useEffect(() => {
    const e = el.current;
    if (!pr.n || pr.slot !== slot || !e) return;
    if (reduced()) e.animate([{ filter: 'brightness(1.5)' }, { filter: 'brightness(1)' }], { duration: 200, easing: 'linear' });
    else e.animate([{ transform: 'translateY(2px) scale(0.96)', filter: 'brightness(1.5)' }, { transform: 'translateY(0) scale(1)', filter: 'brightness(1)' }], { duration: 200, easing: DAWN });
  }, [pr.n]);
}

interface SlotState {
  av: AbilityView | undefined; def: AbilityCore | undefined;
  cd: number; onCd: boolean; elapsed: number; recast: boolean; charges: number | undefined; learned: boolean; noRes: boolean;
  /** the status that stops this slot (stun … fear; silence for abilities; root for dashes) */
  lock: string | null;
  /** the ability's effect is running: seconds left (Infinity = while it lasts) */
  act: number | undefined;
  key: string;
}
function slotState(model: HudModel, index: AbilityIndex, slot: SlotT, spell: boolean): SlotState {
  const me = model.me, body = model.body;
  const av = me?.abilities.find((a) => a.slot === slot);
  const def = index.get(av?.id);
  const cd = av?.cooldown ?? 0;
  const cdMax = Math.max(av?.cooldownMax ?? 0, cd, 0.001);
  const recast = (av?.recastWindow ?? 0) > 0;
  const charges = av?.maxCharges && av.maxCharges > 1 ? av.charges ?? 0 : undefined;
  const onCd = cd > 0 && !recast && !(charges !== undefined && charges > 0);
  const learned = (av?.rank ?? 0) > 0;
  const noRes = !!def && def.costKind === 'res' && (av?.cost ?? 0) > (body?.res ?? 0) + 1e-6 && learned;
  const d = model.derived();
  const lock = !body || !body.alive || !av ? null : d.castLock ?? (!spell && d.silenced ? 'silence' : d.rooted && abilityFamily(def) === 'dash' ? 'root' : null);
  const act = av ? d.active.get(av.id) : undefined;
  const key = `${av?.id ?? ''}|${av?.rank ?? 0}|${av?.maxRank ?? 0}|${av?.canLevel ? 1 : 0}|${onCd ? 1 : 0}|${noRes ? 1 : 0}|${lock ?? ''}|${recast ? 1 : 0}|${charges ?? ''}|${Math.round(av?.cost ?? 0)}|${act === undefined ? 0 : Number.isFinite(act) ? 1 : 2}`;
  return { av, def, cd, onCd, elapsed: onCd ? clamp01(1 - cd / cdMax) : 1, recast, charges, learned, noRes, lock, act, key };
}

function AbilitySlot(p: { slot: SlotT }): JSX.Element | null {
  const { cv } = useApp();
  const { model, input, index, key, client } = useHud();
  const spell = p.slot === 'spell1' || p.slot === 'spell2';
  const ult = p.slot === 'ult';
  const get = (): SlotState => slotState(model, index, p.slot, spell);
  useViewKey(() => get().key);
  const el = useRef<HTMLButtonElement>(null);
  const glint = useRef<HTMLSpanElement>(null);
  const sweep = useRef<HTMLSpanElement>(null);
  const secs = useRef<HTMLSpanElement>(null);
  const actEl = useRef<HTMLSpanElement>(null);
  const prevCd = useRef(-1);
  const actMax = useRef(0);
  useWriter(() => {
    const s = get();
    if (s.onCd) { setVar(sweep.current, '--e', s.elapsed.toFixed(4)); const t = cdText(s.cd); put(secs.current, t); setCls(secs.current, 'is-long', t.length > 3); }
    // the ready moment when a cooldown ends: a chalk wash that settles (250 ms) and the glint
    if (prevCd.current > 0.05 && s.cd <= 0 && s.learned && !reduced()) {
      glint.current?.animate([{ opacity: 0.9, transform: 'translateX(-60%) skewX(-30deg)' }, { opacity: 0, transform: 'translateX(160%) skewX(-30deg)' }], { duration: 360, easing: DAWN });
      el.current?.animate([{ filter: 'brightness(1.9) saturate(0.4)', boxShadow: '0 0 0 2px rgba(255,248,234,0.95)' }, { filter: 'brightness(1) saturate(1)', boxShadow: '0 0 0 2px rgba(255,248,234,0)' }], { duration: 250, easing: DAWN });
    }
    prevCd.current = s.cd;
    if (s.act !== undefined) {
      if (Number.isFinite(s.act)) { if (s.act > actMax.current) actMax.current = s.act; setVar(actEl.current, '--a', clamp01(s.act / Math.max(0.01, actMax.current)).toFixed(3)); }
      else setVar(actEl.current, '--a', '1');
    } else actMax.current = 0;
  });
  useSlotAnims(p.slot, el);

  const s = get();
  const { av, def } = s;
  const me = model.me;
  const f = cv.fighter(me?.fighter);
  const res = cv.resource(f?.resource);
  const aiming = input.aiming.value?.slot === p.slot;
  const q = cv.queue(client.setup.queue);
  const ultLevels = (q ? cv.rulesOf(q) : cv.mode(client.setup.mode)?.rules)?.abilityRanks.ultLevels ?? [];
  const tip = useTip(def ? () => (
    <div class="tipx tipx--ability">
      <AbilityTip record={{ ...def, targeting: { ...def.targeting, range: reachOf(def) } }} keyLabel={key(p.slot)} kind={`${cv.t(`hud.slot.${p.slot}`, p.slot)}${av && !spell ? ` · ${cv.t('hud.ability.rank', 'Rank {n} of {max}', { n: av.rank, max: av.maxRank })}` : ''}`} resourceName={res?.name}
        rank={av && !spell ? { rank: av.rank, canLevel: av.canLevel } : undefined} />
      {av && !spell ? <RankHint av={av} ult={ult} levelKey={key(p.slot)} level={model.body?.level ?? 1} ultLevels={ultLevels} /> : null}
    </div>
  ) : null, { place: 'above', wide: true });

  const [sx, sy, ss] = F.abilities[p.slot as keyof typeof F.abilities];
  if (!av) return <div class="aslot__wrap" style={at(sx, sy, ss, ss)}><span class={`aslot aslot--${ult ? 'ult' : spell ? 'spell' : 'basic'} is-empty`} /></div>;
  const cls = ['aslot', `aslot--${ult ? 'ult' : spell ? 'spell' : 'basic'}`, s.onCd ? 'is-cd' : 'is-ready', s.noRes ? 'is-nores' : '', !s.learned && !spell ? 'is-unlearned' : '',
    aiming ? 'is-aiming' : '', s.lock ? `is-locked is-locked--${s.lock}` : '', s.recast ? 'is-recast' : '', s.act !== undefined ? 'is-active' : ''].join(' ');
  return (
    <div class="aslot__wrap" style={at(sx, sy, ss, ss)}>
      {av.canLevel ? (
        <button type="button" class="aslot__lvl" aria-label={`${cv.t('hud.ability.level_up', 'Level up')} ${def?.name ?? ''}`}
          onPointerDown={(e) => { e.stopPropagation(); }} onClick={() => input.levelUp(p.slot as 'a1')}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
        </button>
      ) : null}
      <button ref={el} type="button" class={cls} {...tip} aria-label={def?.name ?? p.slot}
        onPointerDown={(e) => { if (e.button === 0) { e.preventDefault(); input.press(p.slot); } }}>
        <AbilityGlyph def={def} src={cv.asset(def?.icon)} palette={f ? [f.palette.primary, f.palette.secondary] : undefined} hue={f?.vfx?.signature} ult={ult} spell={spell} />
        <span class="aslot__glint" ref={glint} aria-hidden="true" />
        {s.onCd ? <span class="aslot__cd" ref={sweep} aria-hidden="true" /> : null}
        {s.onCd ? <span class="aslot__secs num" ref={secs} /> : null}
        {s.lock ? <span class="aslot__lock" aria-label={cv.t(`status.${s.lock}.name`, s.lock)}><StatusGlyph kind={s.lock} class="aslot__lockglyph" /></span> : null}
        {s.recast ? <span class="aslot__recast" title={cv.t('hud.ability.recast', 'Cast again within {t}', { t: `${fmtNum(Math.ceil(av.recastWindow ?? 0))} s` })} /> : null}
        {s.act !== undefined ? <span class="aslot__active" ref={actEl} aria-hidden="true" /> : null}
        {s.charges !== undefined ? <span class="aslot__charges num">{s.charges}</span> : null}
        <span class="aslot__key">{key(p.slot)}</span>
        {def && def.costKind !== 'none' && av.cost > 0 && s.learned ? <span class={`aslot__cost num ${s.noRes ? 'is-short' : ''}`}>{fmtInt(av.cost)}</span> : null}
      </button>
      {!spell ? (
        <span class="aslot__pips" aria-label={cv.t('hud.ability.rank', 'Rank {n} of {max}', { n: av.rank, max: av.maxRank })}>
          {Array.from({ length: av.maxRank }, (_, i) => <i class={i < av.rank ? 'is-on' : ''} />)}
        </span>
      ) : null}
    </div>
  );
}

/** the line under a slot's tooltip (HUD-5): how to put a point in now; a locked ultimate says the level it opens at
 *  (never "Level up an ability" while it cannot be learned); an unlearned basic ability says where your next point goes */
// (rendered in the tooltip layer, outside the HUD's context: everything it needs comes in as props)
function RankHint(p: { av: AbilityView; ult: boolean; levelKey: string; level: number; ultLevels: readonly number[] }): JSX.Element | null {
  const { cv } = useApp();
  const av = p.av;
  if (av.canLevel) return <p class="t-caption tipx__hint">{cv.t('hud.ability.level_up', 'Level up')} · <span class="keycap">Ctrl</span> + <span class="keycap">{p.levelKey}</span></p>;
  if (av.rank >= av.maxRank) return null;
  if (p.ult) {
    const at = p.ultLevels[av.rank];
    if (at !== undefined && p.level < at) return <p class="t-caption tipx__hint">{cv.t(av.rank <= 0 ? 'hud.ability.locked' : 'hud.ability.next_rank_at', 'Unlocks at level {n}', { n: at })}</p>;
    return null;
  }
  return av.rank <= 0 ? <p class="t-caption tipx__hint">{cv.t('hud.ability.unlearned', 'Not learned yet. Put your next skill point here.')}</p> : null;
}

// ── bars ─────────────────────────────────────────────────────────────────────────────────────────
function Bars(): JSX.Element | null {
  const { cv, state } = useApp();
  const { model } = useHud();
  useViewKey(() => `${model.me?.fighter ?? ''}`);
  const ticks = state.settings.value.gameplay.healthBarTicks;
  const trail = useRef<HTMLSpanElement>(null), fill = useRef<HTMLSpanElement>(null), shield = useRef<HTMLSpanElement>(null), tickEl = useRef<HTMLSpanElement>(null);
  const num = useRef<HTMLSpanElement>(null), max = useRef<HTMLSpanElement>(null), regen = useRef<HTMLSpanElement>(null);
  const resFill = useRef<HTMLSpanElement>(null), resRegen = useRef<HTMLSpanElement>(null), resBar = useRef<HTMLDivElement>(null);
  const last = useRef(1);
  useWriter(() => {
    const b = model.body, me = model.me;
    const alive = !!b && b.alive;
    const hp = Math.max(0, b?.hp ?? 0), maxHp = Math.max(1, b?.maxHp ?? 1), sh = b?.shield ?? 0;
    const denom = Math.max(maxHp, hp + sh);
    const fr = hp / denom;
    setW(fill.current, fr);
    const t = trail.current;
    if (t) { setStyle(t, 'transition', fr < last.current - 1e-4 ? 'width 450ms linear 150ms' : 'none'); setW(t, fr); }
    last.current = fr;
    setStyle(shield.current, 'left', `${(fr * 100).toFixed(2)}%`);
    setW(shield.current, sh / denom);
    const t100 = (100 / denom) * 100, t1000 = (1000 / denom) * 100;
    setVar(tickEl.current, '--t1', `${t100.toFixed(3)}%`);
    setVar(tickEl.current, '--t2', `${t1000.toFixed(3)}%`);
    setVar(tickEl.current, '--show1', t100 * 3.9 < 4 ? '0' : '1');
    put(num.current, fmtInt(hp));
    put(max.current, `/ ${fmtInt(maxHp)}`);
    put(regen.current, alive && hp < maxHp - 0.5 ? regenText(me?.stats.hpRegen) : '');
    if (b && b.maxRes > 0) {
      setW(resFill.current, b.res / b.maxRes);
      put(resRegen.current, alive && b.res < b.maxRes - 0.5 ? regenText(me?.stats.resRegen) : '');
    }
  });
  const me = model.me;
  const f = cv.fighter(me?.fighter);
  const res = cv.resource(f?.resource);
  const showRes = !!res && res.model !== 'none';
  const live = (): { hp: number; maxHp: number; shield: number; res: number; maxRes: number } => { const b = model.body; return { hp: b?.hp ?? 0, maxHp: b?.maxHp ?? 1, shield: b?.shield ?? 0, res: b?.res ?? 0, maxRes: b?.maxRes ?? 0 }; };
  const hpTip = useTip(() => { const v = live(); return <TipText text={`${cv.t('hud.hp', 'Health')} ${fmtInt(v.hp)} / ${fmtInt(v.maxHp)}`} sub={`${v.shield > 0 ? `${cv.t('hud.shield', 'Shield')} ${fmtInt(v.shield)} · ` : ''}${cv.t('stat.hpRegen.name', 'Health regeneration')} ${regenText(model.me?.stats.hpRegen) || '0'} / s`} />; }, { place: 'above' });
  const resTip = useTip(res ? () => { const v = live(); return <TipText text={`${res.name} ${fmtInt(v.res)} / ${fmtInt(v.maxRes)}`} sub={`${res.desc} ${cv.t('hud.regen_per_s', '{n} each second.', { n: regenText(model.me?.stats.resRegen) || '0' })}`} />; } : null, { place: 'above' });
  if (!me) return null;
  return (
    <div class="dbars" style={at(F.hp[0], F.hp[1], F.hp[2], F.res[1] + F.res[3] - F.hp[1])}>
      <div class="hpbar" {...hpTip}>
        <span class="hpbar__trail" ref={trail} />
        <span class="hpbar__fill" ref={fill} />
        <span class="hpbar__shield" ref={shield} />
        {ticks ? <span class="hpbar__ticks" ref={tickEl} /> : null}
        <span class="hpbar__num num"><span ref={num} /> <span class="quiet" ref={max} /></span>
        <span class="hpbar__regen num" ref={regen} />
      </div>
      {showRes ? (
        <div ref={resBar} class={`resbar resbar--${res!.model}`} style={{ '--res': res!.color } as CSSProperties} {...resTip}>
          <span class="resbar__fill" ref={resFill} />
        </div>
      ) : <div class="resbar resbar--none" />}
      {showRes ? <span class="resbar__regen num" ref={resRegen} style={{ '--res': res!.color } as CSSProperties} /> : null}
    </div>
  );
}

// ── the stats ledger (r12 m1) ────────────────────────────────────────────────────────────────────
// VALE's own reading of your numbers: four families, each a row — Strike (your basic attacks), Craft (your
// abilities), Guard (what you can take), Stride (how you move and how far you reach) — ten numbers in all
// (tenacity and reach included). It rises off the medallion like the level-up moment, between the frame's
// left end and your status row, its gnomon wedge pointing down at your face; never beside the portrait.
type StatKey = 'ad' | 'attackSpeed' | 'crit' | 'ap' | 'haste' | 'armor' | 'resist' | 'tenacity' | 'moveSpeed' | 'range';
interface StatDef { k: StatKey; fmt: (v: number) => string; glyph: JSX.Element }
type FamilyId = 'strike' | 'craft' | 'guard' | 'stride';
const pct = (v: number): string => `${fmtInt(v * 100)}%`;
const LEDGER: { id: FamilyId; mark: JSX.Element; stats: StatDef[] }[] = (() => {
  const S = { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const;
  const g = (d: JSX.Element): JSX.Element => <g {...S}>{d}</g>;
  // family marks in the bible's grammar: wedge = act (Strike), ring = state (Craft), plate = structure
  // (Guard), chevrons = travel (Stride)
  return [
    { id: 'strike', mark: <path d="M5 19L12 4l7 15-7-4z" fill="currentColor" />, stats: [
      { k: 'ad', fmt: fmtInt, glyph: g(<><path d="M5 19L17 7" stroke-width="2.2" /><path d="M14 4.5l5.5 5.5" /></>) },
      { k: 'attackSpeed', fmt: (v) => v.toFixed(2), glyph: g(<><path d="M4 18L12 10M10 20L18 12" /><path d="M14 4.5h5.5V10" /></>) },
      { k: 'crit', fmt: pct, glyph: g(<path d="M12 3l2 7 7 2-7 2-2 7-2-7-7-2 7-2z" />) },
    ] },
    { id: 'craft', mark: <circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="3" />, stats: [
      { k: 'ap', fmt: fmtInt, glyph: g(<><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="8.5" opacity="0.5" /></>) },
      { k: 'haste', fmt: fmtInt, glyph: g(<path d="M7 4h10L7 20h10" />) },
    ] },
    { id: 'guard', mark: <rect x="5" y="5" width="14" height="14" rx="1.5" fill="currentColor" />, stats: [
      { k: 'armor', fmt: fmtInt, glyph: g(<><rect x="5.5" y="5.5" width="13" height="13" rx="1.5" /><path d="M5.5 12h13" opacity="0.6" /></>) },
      { k: 'resist', fmt: fmtInt, glyph: g(<><path d="M12 4a8 8 0 1 0 0.01 0" /><path d="M8 12h8" opacity="0.6" /></>) },
      { k: 'tenacity', fmt: pct, glyph: g(<><path d="M18.5 8A7.5 7.5 0 1 0 19.5 12" /><path d="M19 3.5V8h-4.5" /></>) },
    ] },
    { id: 'stride', mark: <path d="M4 6l7 6-7 6M12 6l7 6-7 6" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" />, stats: [
      { k: 'moveSpeed', fmt: fmt1, glyph: g(<><path d="M4 8h8M6 12h10M4 16h8" /><path d="M16 6l4 6-4 6" /></>) },
      { k: 'range', fmt: fmt1, glyph: g(<><path d="M4 12h16" /><path d="M4 8v8M20 8v8" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /></>) },
    ] },
  ];
})();
const LEDGER_STATS: StatDef[] = LEDGER.flatMap((f) => f.stats);

function StatsLedger(): JSX.Element {
  const { cv } = useApp();
  const { model } = useHud();
  const els = useRef<(HTMLSpanElement | null)[]>([]);
  useWriter(() => {
    const st = model.me?.stats as unknown as Partial<Record<StatKey, number>> | undefined;
    if (!st) return;
    LEDGER_STATS.forEach((d, i) => put(els.current[i], d.fmt(st[d.k] ?? 0)));
  });
  // right edge just short of your status row (it starts over the first ability); the gnomon under the medallion
  const right = F.size[0] - F.abilities.a1[0] + 8;
  const gnomon = F.abilities.a1[0] - 8 - F.medallion.c[0];
  let n = 0;
  return (
    <div class="dledger" role="group" aria-label={cv.t('hud.stats.title', 'Stats')} style={{ right: `calc(${right} * var(--px))` }}>
      {LEDGER.map((f) => (
        <div class={`dledger__row dledger__row--${f.id}`} role="group" aria-label={cv.t(`hud.stats.${f.id}`, f.id)} key={f.id}>
          <FamilyCell id={f.id} mark={f.mark} name={cv.t(`hud.stats.${f.id}`, f.id)} tip={cv.t(`hud.stats.${f.id}_tip`, '')} />
          {f.stats.map((d) => <StatCell d={d} i={n++} els={els.current} name={cv.t(`stat.${d.k}.name`, d.k)} tip={cv.t(`stat.${d.k}.tip`, '')} key={d.k} />)}
        </div>
      ))}
      <span class="dledger__gnomon" aria-hidden="true" style={{ right: `calc(${gnomon} * var(--px))` }} />
    </div>
  );
}
function FamilyCell(p: { id: FamilyId; mark: JSX.Element; name: string; tip: string }): JSX.Element {
  const tip = useTip(() => <TipText text={p.name} sub={p.tip} />, { place: 'above' });
  return (
    <span class={`dledger__fam dledger__fam--${p.id}`} {...tip}>
      <svg viewBox="0 0 24 24" aria-hidden="true">{p.mark}</svg>{p.name}
    </span>
  );
}
function StatCell(p: { d: StatDef; i: number; els: (HTMLSpanElement | null)[]; name: string; tip: string }): JSX.Element {
  const tip = useTip(() => <TipText text={p.name} sub={p.tip} />, { place: 'above' });
  return (
    <span class="dledger__cell" {...tip} aria-label={p.name}>
      <svg viewBox="0 0 24 24" aria-hidden="true">{p.d.glyph}</svg>
      <span class="num" ref={(el) => { p.els[p.i] = el; }} />
    </span>
  );
}

// ── items + utility ──────────────────────────────────────────────────────────────────────────────
let dragFrom = -1;

function ItemSlot(p: { i: number }): JSX.Element | null {
  const { cv } = useApp();
  const { model, input, index, client, key, shopOpen } = useHud();
  const get = (): { id: string | null; cd: number; act: boolean; lock: string | null; canShop: boolean } => {
    const me = model.me, body = model.body;
    const id = me?.items[p.i] ?? null;
    const d = model.derived();
    const active = id ? index.itemActive(id) : undefined;
    return { id, cd: me?.itemCooldowns[p.i] ?? 0, act: !!active && d.active.has(active.id), lock: id && active && body && body.alive ? d.castLock : null, canShop: !!me?.canShop };
  };
  useViewKey(() => { const g = get(); return `${g.id ?? ''}|${g.cd > 0 ? 1 : 0}|${g.act ? 1 : 0}|${g.lock ?? ''}|${g.canShop ? 1 : 0}`; });
  const sweep = useRef<HTMLSpanElement>(null), secs = useRef<HTMLSpanElement>(null), el = useRef<HTMLButtonElement>(null);
  const max = useRef(1);
  useWriter(() => {
    const { cd } = get();
    if (cd > max.current) max.current = cd;
    if (cd <= 0) { max.current = 1; return; }
    setVar(sweep.current, '--e', clamp01(1 - cd / max.current).toFixed(4));
    const t = cdText(cd);
    put(secs.current, t);
    setCls(secs.current, 'is-long', t.length > 3);
  });
  const slot = `item${p.i + 1}` as SlotT;
  useSlotAnims(slot, el);
  const g = get();
  const it = cv.item(g.id);
  const G = F.items;
  const ix = G.x + (p.i % G.cols) * (G.size + G.gap), iy = G.y + Math.floor(p.i / G.cols) * (G.size + G.gap);
  const tip = useTip(it ? () => <ItemTip item={it} keyLabel={key(slot)} sell={g.canShop} /> : () => <TipText text={cv.t('hud.item.empty', 'Empty slot')} />, { place: 'above', wide: !!it });
  return (
    <button ref={el} type="button" class={`islot ${it ? '' : 'is-empty'} ${g.cd > 0 ? 'is-cd' : ''} ${g.act ? 'is-active' : ''} ${g.lock ? 'is-locked' : ''}`} {...tip} style={at(ix, iy, G.size, G.size)}
      aria-label={it ? it.name : cv.t('hud.item.empty', 'Empty slot')}
      onPointerDown={(e) => {
        e.preventDefault();
        if (e.button === 0) { dragFrom = g.id ? p.i : -1; if (it?.active) input.press(slot); }
        if (e.button === 2 && it && (shopOpen.value || model.me?.canShop)) client.send({ type: 'sell', slot: p.i });
      }}
      onPointerUp={(e) => { if (e.button === 0 && dragFrom >= 0 && dragFrom !== p.i) client.send({ type: 'swapItems', a: dragFrom, b: p.i }); dragFrom = -1; }}
      onContextMenu={(e) => e.preventDefault()}>
      {it ? <ItemGlyph item={it} src={cv.asset(it.icon)} /> : null}
      {g.cd > 0 ? <span class="aslot__cd" ref={sweep} /> : null}
      {g.cd > 0 ? <span class="islot__secs num" ref={secs} /> : null}
      {g.lock ? <span class="aslot__lock" aria-label={cv.t(`status.${g.lock}.name`, g.lock)}><StatusGlyph kind={g.lock} class="aslot__lockglyph" /></span> : null}
      {g.act ? <span class="aslot__active" aria-hidden="true" /> : null}
      <span class="islot__key">{key(slot)}</span>
    </button>
  );
}

function Utility(): JSX.Element | null {
  const { cv } = useApp();
  const { model, client, shopOpen, key, input } = useHud();
  useViewKey(() => { const me = model.me; return me ? `${me.canShop ? 1 : 0}|${me.recallProgress > 0 ? 1 : 0}` : ''; });
  const gold = useRef<HTMLSpanElement>(null);
  useWriter(() => { const me = model.me; if (me) put(gold.current, fmtInt(me.gold)); setCls(gold.current?.parentElement, 'is-shop', !!me?.canShop); });
  const me = model.me;
  const q = cv.queue(client.setup.queue);
  const rules = q ? cv.rulesOf(q) : cv.mode(client.setup.mode)?.rules;
  const canRecall = rules?.recall !== false;
  const gleamTip = useTip(() => <TipText text={cv.t('hud.gleam', 'Gleam')} sub={cv.t('hud.gleam_tip', '')} />, { place: 'above' });
  const recallTip = useTip(() => <TipText text={canRecall ? `${cv.t('hud.recall', 'Recall')} · ${key('recall')}` : cv.t('hud.no_recall', 'There is no recall in this mode.')} />, { place: 'above' });
  if (!me) return null;
  return (
    <>
      <button type="button" style={at(F.gleam[0], F.gleam[1], F.gleam[2], F.gleam[3])} class={`gleambtn ${me.canShop ? 'is-shop' : ''} ${shopOpen.value ? 'is-open' : ''}`} {...gleamTip}
        aria-label={`${cv.t('hud.gleam', 'Gleam')}. ${cv.t('hud.shop_open', 'Open the shop')}`}
        onClick={() => { shopOpen.value = !shopOpen.value; input.cancelAim(); }}>
        <GleamGlyph size={14} />
        <span class="num gleambtn__n" ref={gold} />
        <span class="gleambtn__key">{key('shop')}</span>
      </button>
      <button type="button" style={at(F.recall[0], F.recall[1], F.recall[2], F.recall[3])} class={`recallbtn ${canRecall ? '' : 'is-off'} ${me.recallProgress > 0 ? 'is-on' : ''}`} {...recallTip}
        aria-label={cv.t('hud.recall', 'Recall')} aria-disabled={canRecall ? undefined : 'true'}
        onClick={() => { if (canRecall) client.send({ type: 'recall' }); }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v10" /><path d="M7.5 9.5L12 14l4.5-4.5" /><path d="M5 19.5h14" /><path d="M7.5 17h9" opacity="0.6" /></svg>
      </button>
    </>
  );
}
