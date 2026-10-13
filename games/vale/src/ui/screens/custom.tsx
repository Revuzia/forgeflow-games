// VALE UI — Custom lobby (client_hud §3.12): mode (any live mode), its map, one row per seat (teams ×
// perTeam from the ModeDef; FFA modes give every seat its own hour-mark): You / Bot / Open, bot
// difficulty, a fixed fighter or Random. Exactly one seat is yours; Start is disabled with "Put yourself
// in a seat to start." until it is. Custom games earn nothing and say so. Open seats are filled with bots.

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { CustomLobbyConfig } from '../../contracts/session.ts';
import { useApp } from '../app_ctx.ts';
import { Button } from '../components/Button.tsx';
import { Screen } from '../components/Screen.tsx';
import { SeatMark, seatOf, SideMark } from '../components/Seat.tsx';
import { Segmented, Select, type Option } from '../components/Select.tsx';
import { EmptyState } from '../components/States.tsx';

type Seat = CustomLobbyConfig['seats'][number];

function layout(teams: number, perTeam: number, ffa: boolean): Seat[] {
  const seats: Seat[] = [];
  for (let t = 0; t < teams; t++) for (let k = 0; k < perTeam; k++) seats.push({ team: ffa ? seats.length : t, kind: seats.length === 0 ? 'you' : 'bot', difficulty: 'adept' });
  return seats;
}

export function CustomScreen(): JSX.Element {
  const { cv, router, state } = useApp();
  const q = cv.queuesOfKind('custom')[0];
  const live = cv.c.client.modeSlots.filter((s) => s.mode && s.status === 'live').map((s) => cv.mode(s.mode)!).filter(Boolean);
  const [modeId, setModeId] = useState(live.find((m) => m.id === q?.mode)?.id ?? live[0]?.id ?? '');
  const mode = cv.mode(modeId);
  const ffa = cv.isFfa(mode);
  const [seats, setSeats] = useState<Seat[]>(() => (mode ? layout(mode.teams, mode.perTeam, ffa) : []));
  if (!q || !mode) return <Screen title={cv.t('custom.title', 'Custom game')}><EmptyState text={cv.t('state.error.generic', 'Something went wrong. Try again.')} action={{ label: cv.t('common.back', 'Back'), run: () => router.back() }} /></Screen>;
  const pickMode = (id: string): void => {
    const m = cv.mode(id);
    if (!m) return;
    setModeId(id);
    setSeats(layout(m.teams, m.perTeam, cv.isFfa(m)));
  };
  const setSeat = (i: number, patch: Partial<Seat>): void => {
    setSeats((cur) => cur.map((s, j) => {
      if (j === i) return { ...s, ...patch };
      if (patch.kind === 'you' && s.kind === 'you') return { ...s, kind: 'bot' };
      return s;
    }));
  };
  const hasYou = seats.some((s) => s.kind === 'you');
  const kindOpts: Option<Seat['kind']>[] = [
    { value: 'you', label: cv.t('custom.seat_you', 'You') }, { value: 'bot', label: cv.t('custom.seat_bot', 'Bot') }, { value: 'open', label: cv.t('custom.seat_open', 'Open') },
  ];
  const diffOpts: Option<NonNullable<Seat['difficulty']>>[] = (['novice', 'adept', 'veteran'] as const).map((d) => ({ value: d, label: cv.t(`custom.difficulty_${d}`, d) }));
  const fighterOpts: Option<string>[] = [{ value: '', label: cv.t('custom.fighter_random', 'Random') }, ...cv.fighters().map((f) => ({ value: f.id, label: f.name }))];
  const start = (): void => {
    if (!hasYou) return;
    const cfg: CustomLobbyConfig = {
      mode: mode.id, map: mode.map,
      seats: seats.map((s) => ({ team: s.team, kind: s.kind, ...(s.kind !== 'you' ? { difficulty: s.difficulty ?? 'adept' } : {}), ...(s.fighter ? { fighter: s.fighter } : {}) })),
    };
    state.queueFor({ queue: q.id, custom: cfg });
  };
  const teams = [...new Set(seats.map((s) => (ffa ? 0 : s.team)))];
  return (
    <Screen title={cv.t('custom.title', 'Custom game')} layout="wide"
      foot={<span class={`t-body-s ${hasYou ? 'muted' : 'reason reason--warn'}`}>{hasYou ? cv.t('custom.no_rewards', 'No rewards are given in custom games.') : cv.t('custom.need_seat', 'Put yourself in a seat to start.')}</span>}
      cta={<Button variant="chalk" size="l" wedge disabled={!hasYou} reason={cv.t('custom.need_seat', 'Put yourself in a seat to start.')} onPress={start}>{cv.t('btn.start_custom', 'Start game')}</Button>}>
      <p class="t-body muted stg">{cv.t('custom.hint', 'Set the mode, the seats and the bots yourself.')}</p>
      <div class="row custom__top stg">
        <span class="t-label">{cv.t('custom.mode', 'Mode')}</span>
        <Segmented label={cv.t('custom.mode', 'Mode')} value={modeId} options={live.map((m) => ({ value: m.id, label: m.name }))} onChange={pickMode} />
        <span class="t-label">{cv.t('custom.map', 'Map')}</span>
        <span class="chip chip--line">{cv.map(mode.map)?.name}</span>
      </div>
      <div class={`custom__teams ${ffa ? 'is-ffa' : ''}`}>
        {teams.map((t) => (
          <section class="custom__team plate pad stg" aria-label={ffa ? mode.name : cv.t('custom.team', 'Team {n}', { n: t + 1 })}>
            {!ffa ? <h2 class="t-label custom__teamhead"><SideMark team={t} withName />{cv.t('custom.team', 'Team {n}', { n: t + 1 })}</h2> : null}
            {seats.map((s, i) => ((ffa || s.team === t) ? (
              <div class={`cseat ${s.kind === 'you' ? 'is-you' : ''}`}>
                <span class="cseat__n t-caption">{ffa ? <SeatMark seat={seatOf(i)} you={s.kind === 'you'} size={14} /> : null}{cv.t('custom.seat', 'Seat {n}', { n: i + 1 })}</span>
                <Segmented size="s" label={cv.t('custom.seat', 'Seat {n}', { n: i + 1 })} value={s.kind} options={kindOpts} onChange={(k) => setSeat(i, { kind: k })} />
                <Select label={cv.t('custom.difficulty', 'Bot difficulty')} value={s.difficulty ?? 'adept'} options={diffOpts} onChange={(d) => setSeat(i, { difficulty: d })}
                  disabled={s.kind === 'you' ? cv.t('custom.seat_you', 'You') : undefined} class="cseat__sel" />
                <Select label={cv.t('custom.fighter', 'Fighter')} value={s.fighter ?? ''} options={fighterOpts} onChange={(f) => setSeat(i, { fighter: f || undefined })} class="cseat__sel" />
              </div>
            ) : null))}
          </section>
        ))}
      </div>
    </Screen>
  );
}
