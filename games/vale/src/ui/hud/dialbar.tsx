// VALE HUD — the Dial Bar (STYLE_BIBLE HUD density: bottom centre, 640 × 132 at 1080p; client_hud §4.2):
// portrait with the level ring (XP as a linear shadow sweep), the passive badge and the skill-point
// dot; abilities 64 px, ultimate 76, battle spells 48, each with its key chip, rank pips (hour-ticks),
// cost (HARM when you cannot pay), an ink cooldown shadow sweeping clockwise from 12 o'clock with the
// seconds in Mono 22/700, a 120 ms glint when ready, a chalk "+" to level, a recast ring, charges and
// the silence bar; HP over the resource row (Noonwhite double frame, the damage trail 150 ms hold /
// 450 ms out, the hatched Dawnglass shield, ticks every 100 / 1,000 HP); items 3 × 2 with their
// cooldowns; Gleam in Mono with the shop key, and recall. Down: the bar dims to 60 % and a respawn
// ring replaces the level ring.

import type { CSSProperties, JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import type { SlotT } from '../../contracts/catalog.ts';
import type { AbilityView, EntityView, PlayerView } from '../../contracts/sim.ts';
import type { AbilityCore } from '../../input/index.ts';
import { reachOf } from '../../input/index.ts';
import { useApp } from '../app_ctx.ts';
import { Portrait } from '../components/Portrait.tsx';
import { AbilityTip, TipText, useTip } from '../components/Tooltip.tsx';
import { fmtInt, fmtNum } from '../format.ts';
import { cdText, useHud } from './ctx.ts';
import { AbilityGlyph, GleamGlyph, ItemGlyph } from './glyphs.tsx';
import { ItemTip } from './itemtip.tsx';

const ABILITY_SLOTS: SlotT[] = ['a1', 'a2', 'a3', 'ult'];
const SPELL_SLOTS: SlotT[] = ['spell1', 'spell2'];

export function DialBar(): JSX.Element | null {
  const { model } = useHud();
  model.frame.value;
  const me = model.me;
  const body = model.body;
  if (!me) return null;
  const dead = !body || !body.alive;
  return (
    <section class={`dbar plate ${dead ? 'is-dead' : ''}`} aria-label="Dial Bar">
      <DialPortrait me={me} body={body} />
      <div class="dbar__mid">
        <div class="dbar__abilities">
          {ABILITY_SLOTS.map((s) => <AbilitySlot slot={s} me={me} body={body} />)}
          <span class="dbar__sep" aria-hidden="true" />
          {SPELL_SLOTS.map((s) => <AbilitySlot slot={s} me={me} body={body} />)}
        </div>
        <Bars me={me} body={body} />
      </div>
      <div class="dbar__right">
        <div class="dbar__items">{[0, 1, 2, 3, 4, 5].map((i) => <ItemSlot i={i} me={me} />)}</div>
        <Utility me={me} />
      </div>
    </section>
  );
}

// ── portrait ─────────────────────────────────────────────────────────────────────────────────────
function DialPortrait(p: { me: PlayerView; body: EntityView | undefined }): JSX.Element {
  const { cv } = useApp();
  const { model, client } = useHud();
  model.frame.value;   // live view objects keep their identity across ticks: re-render per tick
  const f = cv.fighter(p.me.fighter);
  const passive = f?.kit.passive;
  const level = p.body?.level ?? 1;
  const xp = p.me.xpToNext > 0 ? Math.max(0, Math.min(1, p.me.xp / p.me.xpToNext)) : 1;
  const dead = !p.body || !p.body.alive;
  const respawnMax = useRef(1);
  if (dead && p.me.respawnIn > respawnMax.current) respawnMax.current = p.me.respawnIn;
  if (!dead) respawnMax.current = 1;
  const recall = p.me.recallProgress;
  const ring = dead ? 1 - p.me.respawnIn / Math.max(1, respawnMax.current) : recall > 0 ? recall : xp;
  const C = 2 * Math.PI * 46;
  const flash = useRef<HTMLDivElement>(null);
  const lv = model.levelUp.value;
  useEffect(() => {
    if (!lv.n || !flash.current) return;
    flash.current.animate([{ opacity: 0.95, transform: 'scale(0.86)' }, { opacity: 0, transform: 'scale(1.32)' }], { duration: 720, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  }, [lv.n]);
  const tip = useTip(passive ? () => <AbilityTip record={{ ...passive, cooldown: 0 }} kind={cv.t('hud.passive', 'Passive')} /> : null, { place: 'above' });
  const lives = p.me.lives;
  const rules = cv.mode(client.setup.mode)?.rules;
  return (
    <div class="dport">
      <div class={`dport__face ${recall > 0 ? 'is-recall' : ''}`}>
        <svg class="dport__ring" viewBox="-50 -50 100 100" aria-hidden="true">
          <circle r="46" class="dport__track" />
          <circle r="46" class={`dport__arc ${dead ? 'is-respawn' : recall > 0 ? 'is-recall' : ''}`} transform="rotate(-90)"
            style={{ strokeDasharray: `${C * ring} ${C}` }} />
          <path d="M0 -50 L3.4 -41 L0 -43.5 L-3.4 -41 Z" class="dport__gnomon" />
        </svg>
        <Portrait fighter={f} skin={p.me.skin} size="fill" round class="dport__img" />
        <div ref={flash} class="dport__flash" aria-hidden="true" />
        {dead ? <span class="dport__respawn num">{Math.ceil(p.me.respawnIn)}</span> : null}
        <span class="dport__level num" title={cv.t('hud.xp', '{xp} / {next} XP', { xp: fmtInt(p.me.xp), next: fmtInt(p.me.xpToNext) })}>{level}</span>
        {p.me.skillPoints > 0 ? <span class="dport__sp" title={cv.t('hud.skill_points', '{n} points to spend', { n: p.me.skillPoints })} /> : null}
        {passive ? <span class="dport__passive" tabIndex={0} {...tip} aria-label={passive.name}><svg viewBox="0 0 24 24"><path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z" fill="currentColor" /></svg></span> : null}
      </div>
      {lives !== undefined && rules?.end.lives ? (
        <div class="dport__lives" title={cv.t('fray.lives_n', '{n} lives', { n: lives })}>
          {Array.from({ length: rules.end.lives }, (_, i) => <i class={i < lives ? 'is-on' : ''} />)}
        </div>
      ) : null}
    </div>
  );
}

// ── abilities ────────────────────────────────────────────────────────────────────────────────────
function AbilitySlot(p: { slot: SlotT; me: PlayerView; body: EntityView | undefined }): JSX.Element | null {
  const { cv } = useApp();
  const { model, input, index, key } = useHud();
  model.frame.value;
  const av: AbilityView | undefined = p.me.abilities.find((a) => a.slot === p.slot);
  const def: AbilityCore | undefined = index.get(av?.id);
  const el = useRef<HTMLButtonElement>(null);
  const prevCd = useRef(0);
  const glint = useRef<HTMLSpanElement>(null);
  const spell = p.slot === 'spell1' || p.slot === 'spell2';
  const ult = p.slot === 'ult';
  const f = cv.fighter(p.me.fighter);
  const res = cv.resource(f?.resource);
  const cd = av?.cooldown ?? 0;
  const cdMax = Math.max(av?.cooldownMax ?? 0, cd, 0.001);
  const recast = (av?.recastWindow ?? 0) > 0;
  const charges = av?.maxCharges && av.maxCharges > 1 ? av.charges ?? 0 : undefined;
  const onCd = cd > 0 && !recast && !(charges !== undefined && charges > 0);
  const learned = (av?.rank ?? 0) > 0;
  const noRes = !!def && def.costKind === 'res' && (av?.cost ?? 0) > (p.body?.res ?? 0) + 1e-6 && learned;
  const silenced = !spell && !!p.body?.statuses.some((s) => s.kind === 'silence');
  const aiming = input.aiming.value?.slot === p.slot;

  // the ready glint (tokens: 120 ms) when a cooldown ends
  useLayoutEffect(() => {
    if (prevCd.current > 0.05 && cd <= 0 && glint.current) {
      glint.current.animate([{ opacity: 0.9, transform: 'translateX(-60%) skewX(-30deg)' }, { opacity: 0, transform: 'translateX(160%) skewX(-30deg)' }], { duration: 360, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
      el.current?.animate([{ boxShadow: '0 0 0 2px rgba(237,230,214,0.9)' }, { boxShadow: '0 0 0 2px rgba(237,230,214,0)' }], { duration: 240 });
    }
    prevCd.current = cd;
  }, [cd]);
  // a refused press shakes the slot; a cast pulses it
  const dn = model.denied.value;
  useEffect(() => {
    if (!dn.n || dn.slot !== p.slot || !el.current) return;
    el.current.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' }], { duration: 220 });
  }, [dn.n]);
  const pr = model.pressed.value;
  useEffect(() => {
    if (!pr.n || pr.slot !== p.slot || !el.current) return;
    el.current.animate([{ transform: 'translateY(2px) scale(0.96)', filter: 'brightness(1.5)' }, { transform: 'translateY(0) scale(1)', filter: 'brightness(1)' }], { duration: 200, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  }, [pr.n]);

  const tip = useTip(def ? () => (
    <div class="tipx tipx--ability">
      <AbilityTip record={{ ...def, targeting: { ...def.targeting, range: reachOf(def) } }} keyLabel={key(p.slot)} kind={`${cv.t(`hud.slot.${p.slot}`, p.slot)}${av && !spell ? ` · ${cv.t('hud.ability.rank', 'Rank {n} of {max}', { n: av.rank, max: av.maxRank })}` : ''}`} resourceName={res?.name} />
      {av?.canLevel ? <p class="t-caption tipx__hint">{cv.t('hud.ability.level_up', 'Level up')} · <span class="keycap">Ctrl</span> + <span class="keycap">{key(p.slot)}</span></p> : null}
      {!learned && !spell ? <p class="t-caption tipx__hint">{cv.t('hud.skill_point', 'Level up an ability')}</p> : null}
    </div>
  ) : null, { place: 'above', wide: true });

  if (!av) return <span class={`aslot aslot--${ult ? 'ult' : spell ? 'spell' : 'basic'} is-empty`} />;
  const elapsed = onCd ? Math.max(0, Math.min(1, 1 - cd / cdMax)) : 1;
  const cls = ['aslot', `aslot--${ult ? 'ult' : spell ? 'spell' : 'basic'}`, onCd ? 'is-cd' : 'is-ready', noRes ? 'is-nores' : '', !learned && !spell ? 'is-unlearned' : '', aiming ? 'is-aiming' : '', silenced ? 'is-silenced' : '', recast ? 'is-recast' : ''].join(' ');
  return (
    <div class="aslot__wrap">
      {av.canLevel ? (
        <button type="button" class="aslot__lvl" aria-label={`${cv.t('hud.ability.level_up', 'Level up')} ${def?.name ?? ''}`}
          onPointerDown={(e) => { e.stopPropagation(); }} onClick={() => input.levelUp(p.slot as 'a1')}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
        </button>
      ) : null}
      <button ref={el} type="button" class={cls} {...tip} aria-label={def?.name ?? p.slot}
        onPointerDown={(e) => { if (e.button === 0) { e.preventDefault(); input.press(p.slot); } }}>
        <AbilityGlyph def={def} src={cv.asset(def?.icon)} palette={f ? [f.palette.primary, f.palette.secondary] : undefined} ult={ult} spell={spell} />
        <span class="aslot__glint" ref={glint} aria-hidden="true" />
        {onCd ? <span class="aslot__cd" style={{ '--e': elapsed.toFixed(4) } as CSSProperties} aria-hidden="true" /> : null}
        {onCd ? <span class="aslot__secs num">{cdText(cd)}</span> : null}
        {silenced ? <span class="aslot__silence" aria-label={cv.t('hud.ability.silenced', 'Silenced')} /> : null}
        {recast ? <span class="aslot__recast" title={cv.t('hud.ability.recast', 'Cast again within {t}', { t: `${fmtNum(Math.ceil(av.recastWindow ?? 0))} s` })} /> : null}
        {charges !== undefined ? <span class="aslot__charges num">{charges}</span> : null}
        <span class="aslot__key">{key(p.slot)}</span>
        {def && def.costKind !== 'none' && av.cost > 0 && learned ? <span class={`aslot__cost num ${noRes ? 'is-short' : ''}`}>{fmtInt(av.cost)}</span> : null}
      </button>
      {!spell ? (
        <span class="aslot__pips" aria-label={cv.t('hud.ability.rank', 'Rank {n} of {max}', { n: av.rank, max: av.maxRank })}>
          {Array.from({ length: av.maxRank }, (_, i) => <i class={i < av.rank ? 'is-on' : ''} />)}
        </span>
      ) : null}
    </div>
  );
}

// ── bars ─────────────────────────────────────────────────────────────────────────────────────────
function Bars(p: { me: PlayerView; body: EntityView | undefined }): JSX.Element {
  const { cv, state } = useApp();
  useHud().model.frame.value;
  const b = p.body;
  const hp = b?.hp ?? 0, maxHp = Math.max(1, b?.maxHp ?? 1), shield = b?.shield ?? 0;
  const denom = Math.max(maxHp, hp + shield);
  const hpPct = (hp / denom) * 100, shPct = (shield / denom) * 100;
  const trail = useRef<HTMLSpanElement>(null);
  const last = useRef(hpPct);
  useLayoutEffect(() => {
    const t = trail.current;
    if (!t) return;
    if (hpPct < last.current - 0.01) {
      t.style.transition = 'width 450ms linear 150ms';
    } else t.style.transition = 'none';
    t.style.width = `${hpPct}%`;
    last.current = hpPct;
  }, [hpPct]);
  const ticks = state.settings.value.gameplay.healthBarTicks;
  const f = cv.fighter(p.me.fighter);
  const res = cv.resource(f?.resource);
  const showRes = !!res && res.model !== 'none';
  const resPct = b && b.maxRes > 0 ? (b.res / b.maxRes) * 100 : 0;
  const tick100 = (100 / denom) * 100, tick1000 = (1000 / denom) * 100;
  const hpTip = useTip(() => <TipText text={`${cv.t('hud.hp', 'Health')} ${fmtInt(hp)} / ${fmtInt(maxHp)}`} sub={shield > 0 ? `${cv.t('hud.shield', 'Shield')} ${fmtInt(shield)}` : undefined} />, { place: 'above' });
  const resTip = useTip(res ? () => <TipText text={`${res.name} ${fmtInt(b?.res ?? 0)} / ${fmtInt(b?.maxRes ?? 0)}`} sub={res.desc} /> : null, { place: 'above' });
  return (
    <div class="dbars">
      <div class="hpbar" {...hpTip}>
        <span class="hpbar__trail" ref={trail} />
        <span class="hpbar__fill" style={{ width: `${hpPct}%` }} />
        {shield > 0 ? <span class="hpbar__shield" style={{ left: `${hpPct}%`, width: `${shPct}%` }} /> : null}
        {ticks ? <span class="hpbar__ticks" style={{ '--t1': `${tick100}%`, '--t2': `${tick1000}%`, '--show1': tick100 * 3.9 < 4 ? '0' : '1' } as CSSProperties} /> : null}
        <span class="hpbar__num num">{fmtInt(hp)} <span class="quiet">/ {fmtInt(maxHp)}</span></span>
      </div>
      {showRes ? (
        <div class={`resbar resbar--${res!.model}`} style={{ '--res': res!.color } as CSSProperties} {...resTip}>
          <span class="resbar__fill" style={{ width: `${resPct}%` }} />
        </div>
      ) : <div class="resbar resbar--none" />}
    </div>
  );
}

// ── items + utility ──────────────────────────────────────────────────────────────────────────────
let dragFrom = -1;

function ItemSlot(p: { i: number; me: PlayerView }): JSX.Element {
  const { cv } = useApp();
  const { input, client, key, shopOpen } = useHud();
  useHud().model.frame.value;
  const id = p.me.items[p.i] ?? null;
  const it = cv.item(id);
  const cd = p.me.itemCooldowns[p.i] ?? 0;
  const max = useRef(1);
  if (cd > max.current) max.current = cd;
  if (cd <= 0) max.current = 1;
  const slot = `item${p.i + 1}` as SlotT;
  const tip = useTip(it ? () => <ItemTip item={it} keyLabel={key(slot)} sell={p.me.canShop} /> : () => <TipText text={cv.t('hud.item.empty', 'Empty slot')} />, { place: 'above', wide: !!it });
  return (
    <button type="button" class={`islot ${it ? '' : 'is-empty'} ${cd > 0 ? 'is-cd' : ''}`} {...tip}
      aria-label={it ? it.name : cv.t('hud.item.empty', 'Empty slot')}
      onPointerDown={(e) => {
        e.preventDefault();
        if (e.button === 0) { dragFrom = id ? p.i : -1; if (it?.active) input.press(slot); }
        if (e.button === 2 && it && (shopOpen.value || p.me.canShop)) client.send({ type: 'sell', slot: p.i });
      }}
      onPointerUp={(e) => { if (e.button === 0 && dragFrom >= 0 && dragFrom !== p.i) client.send({ type: 'swapItems', a: dragFrom, b: p.i }); dragFrom = -1; }}
      onContextMenu={(e) => e.preventDefault()}>
      {it ? <ItemGlyph item={it} src={cv.asset(it.icon)} /> : null}
      {cd > 0 ? <span class="aslot__cd" style={{ '--e': Math.max(0, 1 - cd / max.current).toFixed(4) } as CSSProperties} /> : null}
      {cd > 0 ? <span class="islot__secs num">{cdText(cd)}</span> : null}
      <span class="islot__key">{key(slot)}</span>
    </button>
  );
}

function Utility(p: { me: PlayerView }): JSX.Element {
  const { cv } = useApp();
  const { client, shopOpen, key, input } = useHud();
  useHud().model.frame.value;
  const q = cv.queue(client.setup.queue);
  const rules = q ? cv.rulesOf(q) : cv.mode(client.setup.mode)?.rules;
  const canRecall = rules?.recall !== false;
  const gleamTip = useTip(() => <TipText text={cv.t('hud.gleam', 'Gleam')} sub={cv.t('hud.gleam_tip', '')} />, { place: 'above' });
  const recallTip = useTip(() => <TipText text={canRecall ? `${cv.t('hud.recall', 'Recall')} · ${key('recall')}` : cv.t('hud.no_recall', 'There is no recall in this mode.')} />, { place: 'above' });
  return (
    <div class="dbar__util">
      <button type="button" class={`gleambtn ${p.me.canShop ? 'is-shop' : ''} ${shopOpen.value ? 'is-open' : ''}`} {...gleamTip}
        aria-label={`${cv.t('hud.gleam', 'Gleam')} ${fmtInt(p.me.gold)}. ${cv.t('hud.shop_open', 'Open the shop')}`}
        onClick={() => { shopOpen.value = !shopOpen.value; input.cancelAim(); }}>
        <GleamGlyph size={14} />
        <span class="num gleambtn__n">{fmtInt(p.me.gold)}</span>
        <span class="gleambtn__key">{key('shop')}</span>
      </button>
      <button type="button" class={`recallbtn ${canRecall ? '' : 'is-off'} ${p.me.recallProgress > 0 ? 'is-on' : ''}`} {...recallTip}
        aria-label={cv.t('hud.recall', 'Recall')} aria-disabled={canRecall ? undefined : 'true'}
        onClick={() => { if (canRecall) client.send({ type: 'recall' }); }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v10" /><path d="M7.5 9.5L12 14l4.5-4.5" /><path d="M5 19.5h14" /><path d="M7.5 17h9" opacity="0.6" /></svg>
      </button>
    </div>
  );
}
