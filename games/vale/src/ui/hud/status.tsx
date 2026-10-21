// VALE HUD — loss of control and status (r12 M4; STYLE_BIBLE "HUD density"). LoL is only the gauge here;
// every mark is VALE's own: chalk-and-ink chips, rings for time, the HARM wedge for harm.
//
//   StatusRow    a unit's buffs then debuffs (loss of control first): 26 px chips (22 on the target
//                plate), the icon of the record that applied it (ability, item, team buff) or the status
//                mark, an ink shadow sweeping clockwise from 12 o'clock as the time runs out, the stack
//                count bottom-right in Mono, an azure keyline for help and a HARM keyline + corner wedge
//                for harm (the wedge is the colour-free code). At most 12, then "+n" (its tooltip names
//                what it holds); an overflowing row drops help before harm (model.ts rowFit). Tooltip: name,
//                time left, stacks, what it does.
//   LocChip      over the Dial Bar while you have lost control: the mark, the word ("Stunned"), the
//                seconds and a draining bar. In over 70 ms, out over 200 ms.
//   Caption      a refused press, 1.2 s over the Dial Bar ("Kindle ready in 4 s", "Not enough Light",
//                "No valid target there"); a press while you cannot act (refused at the press, before
//                any aim) shakes the slot and pulses the LocChip instead — the chip already says why.
//   TargetPlate  docked on the minimap's frame (the map side, over the map): the unit you selected,
//                attacked or last hit with a fighter — round portrait in its relationship ring, level,
//                name, HP (relationship colour and end shape) over the resource, and its status row.
//   ScreenEdge   optional edge marks (Settings.access, both off by default): locFlash, a 150 ms HARM edge
//                vignette at 20 % and a HARM keyline round the screen when you lose control; damageFlash,
//                a 120 ms ink edge when a hit lands on you (≥ 2 % of your health, at most twice a second).
// Re-renders only on discrete changes; times and bars are written per sim tick (ctx.ts useWriter).

import type { CSSProperties, JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { EntityView } from '../../contracts/sim.ts';
import type { AbilityIndex } from '../../input/index.ts';
import { useApp } from '../app_ctx.ts';
import type { CatalogView } from '../catalog_view.ts';
import { Portrait } from '../components/Portrait.tsx';
import { TipText, useTip } from '../components/Tooltip.tsx';
import { fmt1, fmtInt } from '../format.ts';
import { cdText, put, REL_VAR, setCls, setStyle, setVar, setW, useHud, useViewKey, useWriter } from './ctx.ts';
import { AbilityGlyph, ItemGlyph, SideGlyph, StatusGlyph } from './glyphs.tsx';
import { CHIP_MAX, rowFit, type Chip, type HudModel, type Rel } from './model.ts';

// ── what a chip shows ────────────────────────────────────────────────────────────────────────────
interface ChipInfo { name: string; sub: string; art: JSX.Element }
const humanize = (id: string): string => id.replace(/^[a-z]+_/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function chipInfo(cv: CatalogView, index: AbilityIndex, ch: Chip): ChipInfo {
  if (ch.type === 'status') return { name: cv.t(`status.${ch.id}.name`, humanize(ch.id)), sub: cv.t(`status.${ch.id}.tip`, ''), art: <StatusGlyph kind={ch.id} class="schip__glyph" /> };
  if (ch.type === 'team') {
    const d = cv.c.teamBuffs.find((x) => x.id === ch.id);
    const src = cv.asset(d?.icon);
    return { name: d?.name ?? humanize(ch.id), sub: d?.desc ?? '', art: src ? <span class="schip__img"><img src={src} alt="" draggable={false} /></span> : <StatusGlyph kind="haste" class="schip__glyph" /> };
  }
  const a = index.get(ch.source);
  if (a) return { name: a.name, sub: '', art: <AbilityGlyph def={a} src={cv.asset(a.icon)} /> };
  const it = cv.item(ch.source);
  if (it) return { name: it.name, sub: '', art: <ItemGlyph item={it} src={cv.asset(it.icon)} /> };
  const boon = cv.boon(ch.source);
  if (boon) return { name: boon.name, sub: '', art: <StatusGlyph kind="haste" class="schip__glyph" /> };
  return { name: humanize(ch.id), sub: '', art: <AbilityGlyph def={undefined} src={null} /> };
}

/** the chip list of a unit right now (empty when it is gone or down) */
function chipsOf(model: HudModel, e: EntityView | undefined): { list: Chip[]; key: string } {
  return e && e.alive ? model.chips(e) : { list: [], key: '' };
}

// ── the row ──────────────────────────────────────────────────────────────────────────────────────
export function StatusRow(p: { of: () => EntityView | undefined; max?: number; size?: 'm' | 's'; class?: string; label: string }): JSX.Element | null {
  const { model } = useHud();
  useViewKey(() => chipsOf(model, p.of()).key);
  const { list } = chipsOf(model, p.of());
  if (!list.length) return null;
  const { shown, hidden } = rowFit(list, p.max ?? CHIP_MAX);
  return (
    <div class={`srow srow--${p.size ?? 'm'} ${p.class ?? ''}`} role="list" aria-label={p.label}>
      {shown.map((ch) => <ChipView key={ch.key} k={ch.key} of={p.of} />)}
      {hidden.length ? <MoreChip hidden={hidden} /> : null}
    </div>
  );
}

/** "+n": the chips the row has no room for (help first: harm keeps its place), named in its tooltip */
function MoreChip(p: { hidden: Chip[] }): JSX.Element {
  const { cv } = useApp();
  const { index } = useHud();
  const names = p.hidden.map((c) => chipInfo(cv, index, c).name);
  const tip = useTip(() => <TipText text={cv.t('hud.status.more', '{n} more', { n: p.hidden.length })} sub={names.join(' · ')} />, { place: 'above' });
  return <span class={`schip schip--more num ${p.hidden.some((c) => !c.good) ? 'is-bad' : ''}`} role="listitem" tabIndex={-1} aria-label={names.join(', ')} {...tip}>+{p.hidden.length}</span>;
}

function ChipView(p: { k: string; of: () => EntityView | undefined }): JSX.Element | null {
  const { cv } = useApp();
  const { model, index } = useHud();
  const el = useRef<HTMLSpanElement>(null);
  const find = (): Chip | undefined => chipsOf(model, p.of()).list.find((x) => x.key === p.k);
  useWriter(() => {
    const c = find();
    if (!c) return;
    const e = Number.isFinite(c.duration) && Number.isFinite(c.remaining) && c.duration > 0 ? 1 - c.remaining / c.duration : 0;
    setVar(el.current, '--e', Math.max(0, Math.min(1, e)).toFixed(3));
    setCls(el.current, 'is-ending', Number.isFinite(c.remaining) && c.remaining < 1.5 && c.duration > 3);
  });
  const tip = useTip(() => <ChipTip model={model} cv={cv} index={index} k={p.k} of={p.of} />, { place: 'above' });
  const ch = find();
  if (!ch) return null;
  const info = chipInfo(cv, index, ch);
  return (
    <span ref={el} class={`schip schip--${ch.type} ${ch.good ? 'is-good' : 'is-bad'}`} role="listitem" aria-label={info.name} tabIndex={-1} {...tip}>
      {info.art}
      <span class="schip__sweep" aria-hidden="true" />
      {ch.good ? null : <span class="schip__wedge" aria-hidden="true" />}
      {ch.stacks ? <span class="schip__n num">{ch.stacks}</span> : null}
    </span>
  );
}

/** the chip's tooltip: name, time left (live while shown), stacks, what it does. Rendered by the app's
 *  tooltip layer (outside the HUD context), so everything it needs comes in as props. */
function ChipTip(p: { model: HudModel; cv: CatalogView; index: AbilityIndex; k: string; of: () => EntityView | undefined }): JSX.Element {
  p.model.frame.value;
  const c = chipsOf(p.model, p.of()).list.find((x) => x.key === p.k);
  if (!c) return <TipText text="" />;
  const info = chipInfo(p.cv, p.index, c);
  const left = Number.isFinite(c.remaining) ? p.cv.t('hud.status.left', '{t} left', { t: `${c.remaining < 10 ? fmt1(c.remaining) : fmtInt(c.remaining)} s` }) : p.cv.t('hud.status.lasting', 'While it lasts');
  const kind = c.good ? p.cv.t('hud.status.buff', 'Help') : p.cv.t('hud.status.debuff', 'Harm');
  const stacks = c.stacks ? ` · ${p.cv.t('hud.status.stacks', '{n} stacks', { n: c.stacks })}` : '';
  return <TipText text={info.name} sub={`${kind} · ${left}${stacks}${info.sub ? ` — ${info.sub}` : ''}`} />;
}

// ── loss of control ──────────────────────────────────────────────────────────────────────────────
export function LocChip(): JSX.Element | null {
  const { cv, state } = useApp();
  const { model } = useHud();
  const kindNow = (): string => model.derived().loc?.kind ?? '';
  useViewKey(kindNow);
  const k = kindNow();
  const last = useRef('');
  const [leaving, setLeaving] = useState('');
  const bar = useRef<HTMLElement>(null);
  const secs = useRef<HTMLElement>(null);
  const chip = useRef<HTMLDivElement>(null);
  const pulse = model.locPulse.value;
  useEffect(() => {
    if (!pulse || !chip.current) return;
    // reduce motion: the same answer as a brightness flash, without the swell
    if (state.settings.peek().access.reduceMotion) chip.current.animate([{ filter: 'brightness(1.8)' }, { filter: 'brightness(1)' }], { duration: 200, easing: 'linear' });
    else chip.current.animate([{ transform: 'translate(-50%, 0) scale(1.08)', filter: 'brightness(1.7)' }, { transform: 'translate(-50%, 0) scale(1)', filter: 'brightness(1)' }], { duration: 200, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  }, [pulse]);
  useLayoutEffect(() => {
    if (k) { last.current = k; if (leaving) setLeaving(''); return undefined; }
    if (!last.current) return undefined;
    const was = last.current;
    last.current = '';
    setLeaving(was);
    const t = window.setTimeout(() => setLeaving(''), state.settings.peek().access.reduceMotion ? 120 : 200);
    return () => clearTimeout(t);
  }, [k]);
  useWriter(() => {
    const l = model.derived().loc;
    if (!l) return;
    setW(bar.current, l.remaining / Math.max(0.01, l.duration));
    put(secs.current, cdText(l.remaining));
  });
  const kind = k || leaving;
  if (!kind) return null;
  return (
    <div ref={chip} class={`locchip ${k ? '' : 'is-out'} locchip--${kind}`} role="status" aria-live="assertive">
      <StatusGlyph kind={kind} class="locchip__glyph" />
      <span class="locchip__word t-label">{cv.t(`status.${kind}.name`, humanize(kind))}</span>
      <span class="locchip__secs num" ref={secs} />
      <span class="locchip__track" aria-hidden="true"><i ref={bar} /></span>
    </div>
  );
}

// ── refused press caption ────────────────────────────────────────────────────────────────────────
export function Caption(): JSX.Element | null {
  const { model } = useHud();
  const c = model.caption.value;
  if (!c.n || !c.text) return null;
  return <div key={c.n} class={`hcap hcap--${c.tone}`} role="status" aria-live="polite"><span class="hcap__wedge" aria-hidden="true" />{c.text}</div>;
}

// ── target plate ─────────────────────────────────────────────────────────────────────────────────
export function TargetPlate(): JSX.Element | null {
  const { cv } = useApp();
  const { model } = useHud();
  const id = model.target.value;
  const get = (): EntityView | undefined => { const t = model.target.peek(); return t >= 0 ? model.view.entity(t) : undefined; };
  useViewKey(() => { const t = get(); return t ? `${t.id}|${t.level}|${t.alive ? 1 : 0}|${t.maxRes > 0 ? 1 : 0}|${t.shield > 0 ? 1 : 0}` : ''; });
  const hp = useRef<HTMLElement>(null), trail = useRef<HTMLElement>(null), sh = useRef<HTMLElement>(null), resEl = useRef<HTMLElement>(null), num = useRef<HTMLElement>(null);
  const lastF = useRef(1);
  useWriter(() => {
    const t = get();
    if (!t) return;
    const total = Math.max(t.maxHp, t.hp + t.shield, 1);
    const f = Math.max(0, t.hp) / total;
    setW(hp.current, f);
    setStyle(sh.current, 'left', `${(f * 100).toFixed(2)}%`);
    setW(sh.current, t.shield / total);
    const tr = trail.current;
    if (tr) { setStyle(tr, 'transition', f < lastF.current - 0.001 ? 'width 450ms linear 150ms' : 'none'); setW(tr, f); }
    lastF.current = f;
    if (t.maxRes > 0) setW(resEl.current, t.res / t.maxRes);
    put(num.current, `${fmtInt(Math.max(0, t.hp))} / ${fmtInt(t.maxHp)}`);
  });
  const e = id >= 0 ? model.view.entity(id) : undefined;
  if (!e || !e.alive) return null;
  const rel: Rel = model.relOfEntity(e);
  const pv = e.kind === 'fighter' && e.owner >= 0 ? model.view.players[e.owner] : undefined;
  const f = pv ? cv.fighter(pv.fighter) : undefined;
  const unit = e.kind !== 'fighter' ? model.unit(e.def) : undefined;
  const ffaSeat = model.ffa && pv && rel !== 'self' ? `var(--seat-${(pv.colorIndex % 10) + 1})` : null;
  const color = ffaSeat ?? REL_VAR[rel];
  const res = f ? cv.resource(f.resource) : undefined;
  const showRes = e.maxRes > 0 && !!res && res.model !== 'none';
  const name = pv ? pv.name : unit?.name ?? '';
  const sub = f ? f.name : '';
  return (
    <section class={`tplate tplate--${rel}`} style={{ '--c': color } as CSSProperties} aria-label={cv.t('hud.target', 'Target')}>
      <span class="tplate__face">
        {f ? <Portrait fighter={f} skin={pv?.skin} size="fill" round /> : (
          <span class={`tplate__mark tplate__mark--${e.kind}`}>{e.kind === 'structure' ? <SideGlyph team={e.team} size={22} /> : <i />}</span>
        )}
        {e.kind === 'fighter' || e.kind === 'monster' ? <span class="tplate__lvl num">{e.level}</span> : null}
      </span>
      <span class="tplate__body">
        <span class="tplate__name"><span class="t-label">{name}</span>{sub ? <span class="t-caption muted">{sub}</span> : null}</span>
        <span class={`tplate__hp tplate__hp--${rel}`}>
          <i class="tplate__trail" ref={trail} />
          <i class="tplate__fill" ref={hp} />
          <i class="tplate__shield" ref={sh} />
          <span class="tplate__num num" ref={num} />
        </span>
        {showRes ? <span class={`tplate__res resbar--${res!.model}`} style={{ '--res': res!.color } as CSSProperties}><i ref={resEl} /></span> : null}
        <StatusRow of={get} size="s" max={8} class="tplate__status" label={cv.t('hud.target_status', 'Target status')} />
      </span>
    </section>
  );
}

// ── optional screen-edge marks (r12 M4 §5; Settings.access.locFlash / damageFlash, both off by default) ──
const LOC_FLASH_MS = 150, LOC_FLASH_PEAK = 0.2, LOC_KEY_MS = 220;
const HURT_FLASH_MS = 120, HURT_MIN_GAP_MS = 500, HURT_MIN_FRAC = 0.02;
export function ScreenEdge(): JSX.Element | null {
  const { state } = useApp();
  const { model } = useHud();
  const acc = state.settings.value.access;
  const harm = useRef<HTMLDivElement>(null), key = useRef<HTMLDivElement>(null), ink = useRef<HTMLDivElement>(null);
  const last = useRef({ kind: '', rem: 0 });
  const hurtAt = useRef(-1e9);
  // locFlash: when a loss of control lands (a new one, or the same one again: its time jumps up)
  useWriter(() => {
    const d = model.derived();
    const kind = d.castLock ?? '';
    const rem = d.loc && d.loc.kind === kind ? d.loc.remaining : 0;
    const prev = last.current;
    const landed = kind !== '' && (kind !== prev.kind || rem > prev.rem + 0.25);
    last.current = { kind, rem };
    if (!landed || !acc.locFlash) return;
    // the vignette (20 %, which alone is faint over a bright ground) and a crisp HARM keyline that carries it
    harm.current?.animate([{ opacity: 0 }, { opacity: LOC_FLASH_PEAK, offset: 0.25 }, { opacity: 0 }], { duration: LOC_FLASH_MS, easing: 'linear' });
    key.current?.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }], { duration: LOC_KEY_MS, easing: 'linear' });
  });
  // damageFlash: a hit on you (≥ 2 % of your health), at most twice a second (bible: nothing above 2 Hz)
  useEffect(() => model.onHurt((amount) => {
    if (!state.settings.peek().access.damageFlash) return;
    const b = model.body, now = performance.now();
    if (!b || now - hurtAt.current < HURT_MIN_GAP_MS) return;
    const frac = amount / Math.max(1, b.maxHp);
    if (frac < HURT_MIN_FRAC) return;
    hurtAt.current = now;
    const peak = Math.min(0.5, 0.26 + frac * 1.5);
    ink.current?.animate([{ opacity: 0 }, { opacity: peak, offset: 0.3 }, { opacity: 0 }], { duration: HURT_FLASH_MS, easing: 'linear' });
  }), [model]);
  if (!acc.locFlash && !acc.damageFlash) return null;
  return (
    <>
      {acc.damageFlash ? <div ref={ink} class="hedge hedge--ink" aria-hidden="true" /> : null}
      {acc.locFlash ? <div ref={harm} class="hedge hedge--harm" aria-hidden="true" /> : null}
      {acc.locFlash ? <div ref={key} class="hedge hedge--key" aria-hidden="true" /> : null}
    </>
  );
}
