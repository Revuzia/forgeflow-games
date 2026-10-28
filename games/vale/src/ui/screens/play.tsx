// VALE UI — Play (client_hud §3.2): the Mode Dial, one queue card per queue of the chosen mode (by
// queue.order; custom and practice are quiet links under the cards), the party, and per queue kind the
// RIFT position preference (roles.json) or the quick-queue preset (fighter + role, QueueRequest.preset).
// Locked queues are dashed with the unlock path; ranked shows the tier emblem or the placement line.
// CTA: Find match — disabled, with its reason, while locked, during a lockout or until a preset fighter.
// The mode's painted card (ModeDef.card.art) is the subject in columns 7–12: every live mode's card is stacked there
// and the chosen one crossfades in as the gnomon swings, with the chosen queue's whole description and terms under it.
// Fit (client F6/F9): the mode's name sits in the dial's open hub (the gnomon only draws its outer face), the cards
// carry name, kind, description, the Candles line and the lock; the per-minute, first-win, bans and bots lines are the
// stage caption's. Below 820 px of height the cards turn into compact rows (no description: the stage has it), so the
// selected queue and Find match are on screen at 1280x720 without scrolling.

import type { JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { QueueDefT } from '../../contracts/catalog.ts';
import { useApp } from '../app_ctx.ts';
import { Button } from '../components/Button.tsx';
import { Currency } from '../components/Currency.tsx';
import { ClassMark } from '../components/FighterCard.tsx';
import { FighterGrid } from '../components/FighterGrid.tsx';
import { Icon, Wedge } from '../components/Glyphs.tsx';
import { ArtFrame } from '../components/Portrait.tsx';
import { ModeDial } from '../components/ModeDial.tsx';
import { Portrait } from '../components/Portrait.tsx';
import { RankEmblem } from '../components/RankEmblem.tsx';
import { Screen, Section } from '../components/Screen.tsx';
import { fmtInt, fmtWait } from '../format.ts';

const SIDE_KINDS: QueueDefT['kind'][] = ['custom', 'practice'];

export function PlayScreen(p: { params: Record<string, string> }): JSX.Element {
  const { cv, router, state, session, sound } = useApp();
  const profile = state.profile.value;
  const prefs = state.prefs.value;
  const live = cv.c.client.modeSlots.filter((s) => s.mode && s.status === 'live' && cv.mode(s.mode));
  const modeId = [p.params.mode, prefs.lastMode, live[0]?.mode].find((m) => m && live.some((s) => s.mode === m)) ?? null;
  const mode = cv.mode(modeId);
  const queues = modeId ? cv.queuesOf(modeId).filter((q) => !SIDE_KINDS.includes(q.kind)) : [];
  const locked = (q: QueueDefT): boolean => q.unlockLevel > profile.level;
  // "Play as <fighter>" (collection) prefers a queue that takes a fighter at queue time
  const presetQ = p.params.fighter ? queues.find((q) => cv.pickOf(q) === 'role_preset' && !locked(q))?.id : undefined;
  // a first visit lands on co-op (bots, no preset to fill in) so FIND MATCH works straight away
  const qId = [p.params.queue, presetQ, prefs.lastQueue].find((id) => id && queues.some((q) => q.id === id))
    ?? queues.find((q) => q.kind === 'coop' && !locked(q))?.id ?? queues.find((q) => !locked(q))?.id ?? queues[0]?.id;
  const queue = cv.queue(qId);
  const pick = queue ? cv.pickOf(queue) : null;
  const roles = mode?.roles ? cv.rolesOrdered() : [];
  const [primary, setPrimary] = useState<string>(prefs.roles?.[0] ?? '');
  const [secondary, setSecondary] = useState<string>(prefs.roles?.[1] ?? '');
  const [preset, setPreset] = useState<{ fighter?: string; role?: string }>(() => {
    // a quick-queue preset starts filled (the fighter asked for, else the first of the roster) and stays changeable
    const f = (cv.isPlayable(p.params.fighter) ? cv.fighter(p.params.fighter) : undefined) ?? cv.playable()[0];
    return f ? { fighter: f.id, role: f.role } : {};
  });
  const party = state.party.value;
  const partyBots = party.filter((m) => m.isBot).length;

  const chooseMode = (m: string): void => {
    state.setPrefs({ lastMode: m });
    router.setParams({ mode: m, queue: '' });
  };
  const chooseQueue = (q: QueueDefT): void => {
    if (q.id === qId) return;
    sound.play('tab');
    state.setPrefs({ lastQueue: q.id });
    router.setParams({ mode: modeId ?? '', queue: q.id });
  };

  // ── CTA state ─────────────────────────────────────────────────────────────────────────────────
  const lockLeft = state.lockoutLeft.value;
  let reason: string | null = null;
  if (!queue) reason = cv.t('play.choose_queue', 'Choose how to play');
  else if (locked(queue)) reason = cv.t('state.locked.queue', 'Reach level {level} to play {queue}.', { level: queue.unlockLevel, queue: queue.name });
  else if (lockLeft > 0) reason = cv.t('queue.lockout_banner', 'You can queue again in {t}.', { t: fmtWait(lockLeft) });
  else if (party.length > queue.partyMax) reason = cv.t('play.party_size', 'Party of up to {n}', { n: queue.partyMax });
  else if (pick === 'role_preset' && !preset.fighter) reason = cv.t('play.preset.missing', 'Pick a fighter to queue.');
  const find = (): void => {
    if (!queue || reason) return;
    const roleList: [string, string?] | undefined = roles.length && pick !== 'role_preset' && primary ? (secondary && secondary !== primary ? [primary, secondary] : [primary]) : undefined;
    if (roleList) state.setPrefs({ roles: [primary, secondary] });
    state.queueFor({
      queue: queue.id,
      ...(roleList ? { roles: roleList } : {}),
      ...(pick === 'role_preset' && preset.fighter ? { preset: { fighter: preset.fighter, ...(preset.role ? { role: preset.role } : {}), ...(profile.equipped[preset.fighter] ? { skin: profile.equipped[preset.fighter] } : {}) } } : {}),
    });
  };
  const side = modeId ? cv.queuesOf(modeId).filter((q) => SIDE_KINDS.includes(q.kind)) : [];
  const anySide = [...side, ...SIDE_KINDS.flatMap((k) => cv.queuesOfKind(k))].filter((q, i, a) => a.findIndex((x) => x.id === q.id) === i);
  const slot = cv.c.client.modeSlots.find((s) => s.mode === modeId);

  return (
    <Screen title={cv.t('play.title', 'Play')}
      stage={<PlayArt modeId={modeId} queue={queue} note={slot?.note} />}
      foot={reason ? <span class={`reason t-body-s ${lockLeft > 0 ? 'reason--warn' : ''}`}>{reason}</span> : queue ? <span class="t-body-s muted">{queue.bots.fill === 'none' ? cv.t('play.queue.bots_none', 'No bots.') : cv.t('queue.bots_note', 'Open seats are filled with bots.')}</span> : null}
      cta={<Button variant="chalk" size="l" wedge disabled={!!reason} reason={reason ?? undefined} onPress={find} cue="confirm">{cv.t('btn.find_match', 'Find match')}</Button>}>
      <div class="play">
        <div class="play__dialwrap stg">
          <ModeDial value={modeId} onChange={chooseMode} />
          {mode ? (
            <div class="play__mode" aria-live="polite">
              <h2 class="t-display-m">{mode.name}</h2>
              <p class="t-body-l">{mode.tagline}</p>
            </div>
          ) : null}
        </div>

        <Section title={cv.t('play.choose_queue', 'Choose how to play')}>
          <div class="qcards" role="radiogroup" aria-label={cv.t('play.choose_queue', 'Choose how to play')} data-arrownav="grid">
            {queues.map((q) => <QueueCard q={q} selected={q.id === qId} onPick={() => chooseQueue(q)} />)}
          </div>
          {anySide.length ? (
            <div class="play__links">
              {anySide.map((q) => (
                <Button variant="quiet" size="s" iconAfter="arrow" onPress={() => router.go(q.kind)}>
                  {q.kind === 'practice' ? cv.t('play.practice_card', 'Practice') : cv.t('play.custom_card', 'Custom game')}
                </Button>
              ))}
            </div>
          ) : null}
        </Section>

        {queue && pick === 'role_preset' ? (
          <PresetPanel queue={queue} value={preset} onChange={setPreset} roles={roles.map((r) => r.id)} />
        ) : queue && roles.length && !locked(queue) ? (
          <Section title={cv.t('play.roles.title', 'Your roles')} hint={cv.t('play.roles.hint', 'Pick the roles you want. You may be given either.')}>
            <RolePicker label={cv.t('play.roles.primary', 'Primary role')} value={primary} onChange={(v) => { setPrimary(v); if (v && v === secondary) setSecondary(''); }} />
            <RolePicker label={cv.t('play.roles.secondary', 'Secondary role')} value={secondary} onChange={setSecondary} exclude={primary} />
          </Section>
        ) : null}

        {queue ? (
          <Section title={cv.t('play.party', 'Party')} hint={queue.partyMax > 1 ? cv.t('play.party_hint', 'Fill open seats with bots, or play with the seats open.') : undefined}>
            <div class="party">
              {party.map((m) => (
                <span class={`party__m ${m.isBot ? 'is-bot' : ''}`}>
                  <Icon name={m.isBot ? 'bot' : 'user'} size={16} />
                  <span class="t-body-s">{m.name}</span>
                  {m.isBot ? <span class="chip chip--bot">{cv.t('party.bot', 'Bot')}</span> : <span class="chip chip--line">{cv.t('party.you', 'You')}</span>}
                </span>
              ))}
              {queue.partyMax > 1 && session.setPartyBots ? (
                <span class="stepper" role="group" aria-label={cv.t('play.party_bots', 'Bot allies')}>
                  <span class="t-label muted">{cv.t('play.party_bots', 'Bot allies')}</span>
                  <Button variant="icon" size="s" icon="minus" label={cv.t('party.remove_bot', 'Remove bot')} disabled={partyBots <= 0} reason={cv.t('state.empty.party', 'You are playing alone.')}
                    onPress={() => { session.setPartyBots!(partyBots - 1); state.refreshParty(); }} />
                  <span class="num stepper__n" aria-live="polite">{partyBots}</span>
                  <Button variant="icon" size="s" icon="plus" label={cv.t('party.add_bot', 'Add a bot')} disabled={party.length >= Math.min(5, queue.partyMax)}
                    reason={cv.t('play.party_size', 'Party of up to {n}', { n: queue.partyMax })}
                    onPress={() => { session.setPartyBots!(partyBots + 1); state.refreshParty(); sound.play('notify'); }} />
                </span>
              ) : <span class="chip chip--line">{cv.t('play.solo_only', 'Solo queue only')}</span>}
            </div>
          </Section>
        ) : null}
      </div>
    </Screen>
  );
}

/** a queue's terms as the player reads them: the Candles line first, then per-minute pay, first win, placement,
 *  bans and bots (the card shows the first; the stage caption shows them all for the chosen queue) */
function queueTerms(cv: ReturnType<typeof useApp>['cv'], q: QueueDefT): { reward: string; more: string[] } {
  const g = q.grants;
  const more: string[] = [];
  let reward: string;
  if (g.win === 0 && g.loss === 0) reward = cv.t('play.queue.reward_none', 'No rewards');
  else {
    reward = `${cv.t('play.queue.reward_win', 'Win: {n} Candles', { n: fmtInt(g.win) })} · ${cv.t('play.queue.reward_loss', 'Loss: {n} Candles', { n: fmtInt(g.loss) })}`;
    if (g.perMinute > 0) more.push(cv.t('play.queue.reward_note', 'Plus {n} Candles a minute, up to {cap} per match.', { n: fmtInt(g.perMinute), cap: fmtInt(g.cap) }));
    if (g.placement?.length) more.push(cv.t('play.queue.placement_note', 'Top five places earn extra Candles.'));
    more.push(cv.t('play.queue.first_win', 'First win of the day pays a bonus.'));
  }
  const bans = cv.pickOf(q) === 'draft' ? q.draft?.bansPerTeam ?? 0 : null;
  if (bans !== null) more.push(bans === 0 ? cv.t('play.queue.bans_none', 'No bans') : bans === 1 ? cv.t('play.queue.bans', '{n} ban per team', { n: bans }) : cv.t('play.queue.bans_plural', '{n} bans per team', { n: bans }));
  more.push(q.bots.fill === 'opponents_only' ? cv.t('play.queue.bots_opponents', 'Opponents are bots.') : q.bots.fill === 'none' ? cv.t('play.queue.bots_none', 'No bots.') : cv.t('play.queue.bots_fill', 'Open seats are filled with bots.'));
  return { reward, more };
}

function QueueCard(p: { q: QueueDefT; selected: boolean; onPick: () => void }): JSX.Element {
  const { cv, state, sound } = useApp();
  const profile = state.profile.value;
  const q = p.q;
  const cur = cv.earnedCurrency();
  const locked = q.unlockLevel > profile.level;
  const rec = q.ranked ? profile.ratings[q.ranked.ratingId] : undefined;
  const tier = cv.ratingTier(rec);
  const { reward } = queueTerms(cv, q);
  const lockText = locked ? cv.t('state.locked.queue', 'Reach level {level} to play {queue}.', { level: q.unlockLevel, queue: q.name }) : null;
  const rankLine = q.ranked ? (tier && rec ? `${tier.name} · ${cv.t('play.queue.ranked_rating', 'Rating {n}', { n: fmtInt(rec.rating) })}`
    : cv.t('play.queue.ranked_provisional', 'Your first {n} matches place you on the ladder.', { n: q.ranked.placementGames })) : null;
  return (
    <button type="button" role="radio" aria-checked={p.selected} data-nav=""
      class={`qcard plate ${p.selected ? 'is-selected plate--lit' : ''} ${locked ? 'is-locked' : ''}`}
      aria-label={`${q.name}. ${q.desc}${lockText ? ` ${lockText}` : ''}`} title={rankLine ?? undefined}
      onPointerEnter={() => sound.play('hover')} onClick={p.onPick}>
      {p.selected ? <span class="tick" aria-hidden="true" /> : null}
      <span class="qcard__head">
        <span class="t-h2 qcard__name">{q.name}</span>
        {q.ranked ? <RankEmblem tier={tier} provisional={!tier} size={28} /> : null}
        <span class={`chip ${q.kind === 'ranked' ? 'chip--line' : ''}`}>{cv.t(`play.queue.kind.${q.kind}`, q.kind)}</span>
      </span>
      <span class="t-body-s qcard__desc">{q.desc}</span>
      {lockText ? <span class="qcard__lock t-caption"><Icon name="lock" size={14} />{lockText}</span>
        : <span class={`t-caption ${cur && q.grants.win > 0 ? 'qcard__reward' : 'qcard__lines'}`}>{cur && q.grants.win > 0 ? <Currency id={cur.id} amount={q.grants.win} size="s" tick={false} /> : null}{reward}</span>}
    </button>
  );
}

/** columns 7–12: the chosen mode's painted card (every live mode stacked, the chosen one on: a 360 ms crossfade
 *  that enters from the right as the gnomon swings) and the chosen queue's description and terms */
function PlayArt(p: { modeId: string | null; queue: QueueDefT | undefined; note?: string }): JSX.Element {
  const { cv, state } = useApp();
  const live = cv.c.client.modeSlots.filter((s) => s.mode && s.status === 'live' && cv.mode(s.mode)).map((s) => cv.mode(s.mode)!);
  const q = p.queue;
  const terms = q ? queueTerms(cv, q) : null;
  const rec = q?.ranked ? state.profile.value.ratings[q.ranked.ratingId] : undefined;
  const tier = cv.ratingTier(rec);
  // the caption is as wide as the painted card above it (the card's width follows the stage's height)
  const root = useRef<HTMLDivElement>(null), frame = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const f = frame.current, r = root.current;
    if (!f || !r || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => r.style.setProperty('--artw', `${Math.round(f.getBoundingClientRect().width)}px`));
    ro.observe(f);
    return () => ro.disconnect();
  }, []);
  return (
    <div class="playart" ref={root}>
      <div class="playart__frame" ref={frame}>
        {live.map((m) => (
          <ArtFrame src={m.card.art} mark={cv.modeMark(m)} lanes={cv.laneCount(m)} alt={m.id === p.modeId ? m.name : ''}
            class={`playart__img ${m.id === p.modeId ? 'is-on' : ''}`} />
        ))}
      </div>
      {q && terms ? (
        <div class="playart__cap plate" aria-live="polite">
          <span class="playart__head"><span class="t-label">{q.name}</span>{p.note ? <span class="t-caption muted">{p.note}</span> : null}</span>
          <p class="t-body-s playart__desc">{q.desc}</p>
          {q.ranked ? <span class="t-caption playart__rank"><RankEmblem tier={tier} provisional={!tier} size={24} />{tier && rec ? `${tier.name} · ${cv.t('play.queue.ranked_rating', 'Rating {n}', { n: fmtInt(rec.rating) })}`
            : cv.t('play.queue.ranked_provisional', 'Your first {n} matches place you on the ladder.', { n: q.ranked.placementGames })}</span> : null}
          <ul class="playart__terms t-caption">
            <li>{terms.reward}</li>
            {terms.more.map((l) => <li>{l}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function RolePicker(p: { label: string; value: string; onChange: (v: string) => void; exclude?: string }): JSX.Element {
  const { cv, sound } = useApp();
  const roles = cv.rolesOrdered();
  return (
    <div class="rolepick">
      <span class="t-label rolepick__label">{p.label}</span>
      <div class="rolepick__opts" role="radiogroup" aria-label={p.label} data-arrownav="row">
        {[...roles.map((r) => ({ id: r.id, name: r.name, color: r.color, contract: r.contract })), { id: '', name: cv.t('play.roles.fill', 'Fill'), color: '', contract: '' }].map((r) => {
          const sel = p.value === r.id;
          const dis = !!r.id && r.id === p.exclude;
          return (
            <button type="button" role="radio" aria-checked={sel} aria-disabled={dis ? 'true' : undefined} data-nav=""
              class={`rolechip ${sel ? 'is-selected' : ''}`} title={dis ? cv.t('play.roles.primary', 'Primary role') : r.contract}
              onPointerDown={() => sound.play(dis ? 'error' : 'toggle')} onClick={() => { if (!dis) p.onChange(r.id); }}>
              {r.color ? <span class="roledot" style={{ background: r.color }} /> : <span class="roledot roledot--fill" />}
              <span class="t-label">{r.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PresetPanel(p: { queue: QueueDefT; value: { fighter?: string; role?: string }; onChange: (v: { fighter?: string; role?: string }) => void; roles: string[] }): JSX.Element {
  const { cv, overlay, sound, state } = useApp();
  const f = cv.fighter(p.value.fighter);
  const choose = (): void => {
    overlay.open({
      title: cv.t('play.preset.pick_fighter', 'Pick a fighter'), size: 'l',
      render: (close) => (
        <FighterGrid label={cv.t('play.preset.pick_fighter', 'Pick a fighter')} size="s" cols={6} compactFilters
          filter={undefined}
          card={(x) => ({ selected: x.id === p.value.fighter, cue: 'confirm', skin: state.profile.value.equipped[x.id],
            onPress: () => { p.onChange({ fighter: x.id, role: p.value.role ?? x.role }); sound.play('lockin'); close(); } })} />
      ),
    });
  };
  return (
    <Section title={cv.t('play.preset.title', 'Choose before you queue')} hint={cv.t('play.preset.hint', 'This queue has no draft. Choose your role and fighter now.')}>
      <div class="preset">
        <button type="button" class={`preset__fighter plate ${f ? 'is-selected' : 'is-empty'}`} onPointerDown={() => sound.play('click')} onClick={choose}
          aria-label={f ? `${cv.t('play.preset.fighter', 'Fighter')}: ${f.name}` : cv.t('play.preset.pick_fighter', 'Pick a fighter')}>
          {f ? <Portrait fighter={f} skin={state.profile.value.equipped[f.id]} size="m" /> : <span class="preset__empty"><Wedge size={20} /></span>}
          <span class="preset__text">
            <span class="t-label muted">{cv.t('play.preset.fighter', 'Fighter')}</span>
            <span class="t-h2">{f ? f.name : cv.t('play.preset.pick_fighter', 'Pick a fighter')}</span>
            {f ? <span class="t-caption muted"><ClassMark classId={f.class} withName /></span> : null}
          </span>
          <Icon name="chevron" class="preset__chev" />
        </button>
        {p.roles.length ? <RolePicker label={cv.t('play.roles.primary', 'Primary role')} value={p.value.role ?? ''} onChange={(v) => p.onChange({ ...p.value, role: v || undefined })} /> : null}
      </div>
    </Section>
  );
}
