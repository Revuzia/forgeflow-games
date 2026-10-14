"""UI cues (bus `ui`): glass and wood. Short, in key (D Dorian; the purchase fanfare's bright D-F#-A-C#
is the token's one exception), dry or in a small wooden room, and never shrill: the 2-5 kHz band is
kept soft on everything that repeats (hover, ticks, slider). Loudness: max momentary -24..-20 LUFS per
tokens.audio.loudness.uiMomentaryLUFS; the hover is set by peak (tokens.audio.ui.hover.peakDbfs -32
at the output = -20 dBFS asset after gain 0.45, ui bus 0.7 and master 0.8); the queue pop is -14.
"""
from __future__ import annotations

from cuelib import cue
from synth import sfx as S
from synth import fx
from synth.core import hz

from .kit import (Layers, R, at_len, bell, breath, drum, esc, finish, glass, harp, lp, mono, rev, room, shimmer,
                  spread, tink)

UI_TICK = (0.02, 0.12)      # QA duration windows (s)
UI_SHORT = (0.03, 0.30)
UI_CHIME = (0.15, 0.60)
UI_MOMENT = (0.5, 2.6)
UITICK = dict(tail_floor_db=-50.0)                       # mastering profiles (cuelib.CueSpec kwargs)
UICHIME = dict(tail_floor_db=-54.0, fade_out=0.03)
UIMOMENT = dict(tail_floor_db=-56.0, fade_out=0.05)


@cue('ui_hover', 'ui', ('pk', -20.0), UI_TICK, tail_floor_db=-54)
def ui_hover(v: int):
    """A quiet dawnglass tink on E6 (tokens: 40 ms): soft 2 ms attack, faint partials, nothing to tire of."""
    L = Layers(0.08)
    L.add(tink(hz('E6'), 0.06, 0.045, bright=0.22, attack=0.002), 0.0, peak_db=0)
    L.add(tink(hz('E5'), 0.05, 0.03, bright=0.0, attack=0.003), 0.0, peak_db=-20)
    return finish(spread(mono(L.out()), 0.25), hp_hz=400)


@cue('ui_hover_fighter', 'ui', ('pk', -19.0), UI_TICK, tail_floor_db=-54)
def ui_hover_fighter(v: int):
    """Fighter-portrait hover: a warmer B5 glass tink with a soft wooden touch under it (the card)."""
    r = R('ui_hover_fighter')
    L = Layers(0.1)
    L.add(tink(hz('B5'), 0.08, 0.065, bright=0.3, attack=0.002), 0.0, peak_db=0)
    L.add(tink(hz('E6'), 0.05, 0.035, bright=0.1, attack=0.002), 0.011, peak_db=-11)
    L.add(lp(esc('tock', 0.5, seed='hf'), 2400), 0.0, peak_db=-16)
    return finish(spread(mono(L.out()), 0.3), hp_hz=250, eq=[('peak', 3200, -3, 0.8)])


@cue('ui_click', 'ui', ('m', -23.0), UI_SHORT, **UITICK)
def ui_click(v: int):
    """Pointer-down: the escapement tick (2.5 kHz burst into 850/1900 Hz wood) over a small wooden thock."""
    r = R('ui_click')
    L = Layers(0.1)
    L.add(at_len(esc('tick', 0.9, seed='click'), 0.07), 0.0, peak_db=0)
    L.add(S.knock(r, 330, 0.035, 4, 'wood'), 0.0, peak_db=-7)
    x = room(L.out(), 'wood', wet=0.07)
    return finish(x, hp_hz=180, eq=[('peak', 2800, -2.5, 0.9), ('high', 8000, -4)])


@cue('ui_confirm', 'ui', ('m', -21.0), UI_CHIME, **UICHIME)
def ui_confirm(v: int):
    """Confirm: A5 then E6 on dawnglass, a rising fifth 65 ms apart, with the press tick under it."""
    L = Layers(0.45)
    L.add(glass('A5', 0.36, 0.85, decay=0.1, bright=0.7, seed='cf1'), 0.0, peak_db=0)
    L.add(glass('E6', 0.34, 0.8, decay=0.085, bright=0.6, seed='cf2'), 0.065, peak_db=-1)
    L.add(at_len(esc('tick', 0.7, seed='cf'), 0.05), 0.0, peak_db=-13)
    x = room(L.out(), 'wood', wet=0.12)
    return finish(x, hp_hz=300, eq=[('peak', 3400, -2, 0.8)])


@cue('ui_back', 'ui', ('m', -22.0), UI_CHIME, **UICHIME)
def ui_back(v: int):
    """Back / cancel: the confirm turned over, E6 falling to A5, a little darker and drier."""
    L = Layers(0.4)
    L.add(glass('E6', 0.3, 0.75, decay=0.07, bright=0.5, seed='bk1'), 0.0, peak_db=-1)
    L.add(glass('A5', 0.32, 0.75, decay=0.085, bright=0.45, seed='bk2'), 0.06, peak_db=0)
    L.add(at_len(esc('tock', 0.7, seed='bk'), 0.05), 0.0, peak_db=-13)
    x = room(L.out(), 'wood', wet=0.09)
    return finish(x, hp_hz=260, lp_hz=8000, eq=[('peak', 3400, -2, 0.8)])


@cue('ui_error', 'ui', ('m', -21.0), UI_SHORT, **UICHIME)
def ui_error(v: int):
    """Not allowed: a muffled clay double-thud on D3, the second a touch softer. No highs at all."""
    r = R('ui_error')
    L = Layers(0.3)
    for i, (t, g) in enumerate(((0.0, 0), (0.095, -2.5))):
        L.add(S.knock(r, hz('D3'), 0.08, 5, 'clay'), t, peak_db=g)
        L.add(S.thump(0.12, 230, 140, 0.012, 0.06, 1.6), t, peak_db=g - 5)
    x = room(L.out(), 'wood', wet=0.06)
    return finish(x, hp_hz=70, lp_hz=2200)


@cue('ui_tab', 'ui', ('m', -23.0), UI_SHORT, **UICHIME)
def ui_tab(v: int):
    """Tab change: a damped dial-harp B4 (wood and string) with a soft tock where the finger lands."""
    L = Layers(0.3)
    L.add(harp('B4', 0.3, 0.75, bright=0.5, damp_at=0.13, seed='tab'), 0.0, peak_db=0)
    L.add(at_len(esc('tock', 0.6, seed='tab'), 0.05), 0.0, peak_db=-12)
    return finish(L.out(), hp_hz=140, eq=[('peak', 3000, -2, 0.8)])


@cue('ui_toggle', 'ui', ('m', -23.0), UI_SHORT, **UITICK)
def ui_toggle(v: int):
    """Toggle: a two-part wooden latch (tick, then a lower tock 28 ms later) with a glint of D6."""
    L = Layers(0.15)
    L.add(at_len(esc('tick', 0.8, seed='tg1'), 0.05), 0.0, peak_db=0)
    L.add(at_len(esc('tock', 0.8, seed='tg2', res=(700.0, 1600.0)), 0.07), 0.028, peak_db=-2)
    L.add(tink(hz('D6'), 0.07, 0.05, bright=0.2), 0.028, peak_db=-17)
    return finish(room(L.out(), 'wood', wet=0.06), hp_hz=200, eq=[('peak', 2800, -2.5, 0.9), ('high', 8000, -4)])


@cue('ui_slider', 'ui', ('pk', -9.0), UI_TICK, **UITICK)
def ui_slider(v: int):
    """Slider detent (fires every step): a tiny wooden detent ringing 700/1400 Hz with a D6 glass grain,
    30 ms and dull-topped, so a fast drag is a soft ratchet rather than a buzz. Set by peak: a 30 ms tick
    has no meaningful 400 ms loudness."""
    L = Layers(0.05)
    L.add(at_len(esc('tick', 0.8, seed='sl', res=(700.0, 1400.0), band=1800.0, q=2.5), 0.03, fout=0.012), 0.0, peak_db=0)
    L.add(tink(hz('D6'), 0.03, 0.02, bright=0.1), 0.0, peak_db=-8)
    return finish(L.out(), hp_hz=400, lp_hz=4500)


@cue('ui_queue_search', 'ui', ('m', -23.0), (0.6, 1.6), **UIMOMENT)
def ui_queue_search(v: int):
    """Searching (repeats every 8 s): a clock tick-tock, then a soft D5 glass sounding out into the
    room with a slow ping-pong echo, like a lamp swept across the dark."""
    L = Layers(1.2)
    L.add(at_len(esc('tick', 0.6, seed='qs1'), 0.05), 0.0, peak_db=-8)
    L.add(at_len(esc('tock', 0.6, seed='qs2'), 0.05), 0.16, peak_db=-9)
    L.add(glass('D5', 1.0, 0.55, decay=0.32, bright=0.55, seed='qs'), 0.30, peak_db=0)
    L.add(shimmer('A5', 0.7, 0.4, decay=0.4, index=1.6, seed='qs'), 0.30, peak_db=-15)
    x = fx.stereo_delay(L.out(), 0.21, 0.29, feedback=0.3, cross=0.9, damp_hz=3500, mix=0.28, tail_s=0.9)
    x = room(x, 'glass', wet=0.1)
    return finish(x, hp_hz=220, eq=[('peak', 3200, -2, 0.8)])


@cue('ui_queue_pop', 'ui', ('m', -14.0), (1.2, 2.8), **UIMOMENT)
def ui_queue_pop(v: int):
    """Match found (the loudest UI moment, tokens: +6 LU over UI): A4-E5-A5 on the hourbell, 120 ms
    apart, over a stone-kicked frame drum, the last bell lit with glass."""
    L = Layers(2.4)
    L.add(drum('D2', 0.9, 'doum', seed='qp', dur=0.9, t60=0.5), 0.0, peak_db=-7)
    for i, (note, t, g) in enumerate((('A4', 0.0, -1.5), ('E5', 0.12, -1.0), ('A5', 0.24, 0.0))):
        L.add(bell(note, 2.2, 0.85 + 0.05 * i, decay=0.32, bright=0.9 + 0.1 * i, seed=f'qp{i}'), t, peak_db=g)
    L.add(glass('A6', 1.0, 0.6, decay=0.25, bright=0.6, seed='qp'), 0.24, peak_db=-11)
    x = room(L.out(), 'hall', wet=0.16)
    return finish(x, hp_hz=40, eq=[('peak', 3000, -1.5, 0.7)])


@cue('ui_accept', 'ui', ('m', -20.0), (0.4, 1.3), **UIMOMENT)
def ui_accept(v: int):
    """Accept the match: a firm D5+A5 glass dyad over a soft D4 bell, the press tock, a shimmer lift."""
    L = Layers(1.0)
    L.add(at_len(esc('tock', 0.8, seed='ac'), 0.06), 0.0, peak_db=-9)
    L.add(glass('D5', 0.9, 0.85, decay=0.25, bright=0.75, seed='ac1'), 0.0, peak_db=0)
    L.add(glass('A5', 0.9, 0.8, decay=0.22, bright=0.7, seed='ac2'), 0.0, peak_db=-2)
    L.add(bell('D4', 1.0, 0.6, decay=0.15, seed='ac'), 0.0, peak_db=-10)
    L.add(shimmer('A6', 0.6, 0.5, decay=0.35, index=2.0, seed='ac'), 0.07, peak_db=-16)
    return finish(room(L.out(), 'glass', wet=0.12), hp_hz=90, eq=[('peak', 3300, -2, 0.8)])


@cue('ui_lockin', 'ui', ('m', -20.0), (0.8, 2.2), **UIMOMENT)
def ui_lockin(v: int):
    """Lock in (tokens: D5 over a D3 bell): bell and glass struck together over a frame-drum doum,
    the escapement's lower tock as the latch. Committed, warm, final."""
    L = Layers(1.8)
    L.add(at_len(esc('tock', 0.9, seed='li'), 0.06), 0.0, peak_db=-9)
    L.add(bell('D3', 1.9, 0.85, decay=0.22, seed='li'), 0.0, peak_db=-1)
    L.add(glass('D5', 1.6, 0.9, decay=0.4, bright=0.8, seed='li'), 0.008, peak_db=0)
    L.add(drum('D2', 0.75, 'doum', seed='li', dur=0.7, t60=0.4), 0.0, peak_db=-9)
    return finish(room(L.out(), 'plate', wet=0.14), hp_hz=40, eq=[('peak', 3200, -2, 0.8)])


@cue('ui_ban', 'ui', ('m', -20.0), (0.5, 1.4), **UIMOMENT)
def ui_ban(v: int):
    """Ban: an ink stroke crossing the card (a breath swept down) onto a clay thud and a damped F3+B3
    bell tritone, the darkest interval the mode owns."""
    r = R('ui_ban')
    L = Layers(1.0)
    L.add(breath(0.18, 3200, 600, shape='breath', q=2.2, seed='ban', peak_at=0.05), 0.0, peak_db=-6)
    L.add(S.knock(r, hz('D3'), 0.09, 5, 'clay'), 0.05, peak_db=-3)
    L.add(S.thump(0.25, 180, 70, 0.02, 0.15, 2.0), 0.05, peak_db=-5)
    L.add(bell('F3', 1.0, 0.8, decay=0.12, bright=0.6, seed='ban1'), 0.05, peak_db=0)
    L.add(bell('B3', 1.0, 0.7, decay=0.12, bright=0.6, seed='ban2'), 0.05, peak_db=-3)
    return finish(room(L.out(), 'small', wet=0.12), hp_hz=50, lp_hz=7000)


@cue('ui_shop_buy', 'ui', ('m', -21.0), UI_CHIME, **UICHIME)
def ui_shop_buy(v: int):
    """Buy an item: two small glass clinks (G5, D6) like coins of light, the item tocking into its slot."""
    r = R('ui_shop_buy')
    L = Layers(0.45)
    L.add(glass('G5', 0.4, 0.85, decay=0.12, bright=0.75, seed='sb1'), 0.0, peak_db=0)
    L.add(glass('D6', 0.36, 0.8, decay=0.1, bright=0.65, seed='sb2'), 0.042, peak_db=-2)
    L.add(at_len(esc('tock', 0.8, seed='sb'), 0.06), 0.075, peak_db=-9)
    L.add(S.sparkle(r, 0.25, 3, 93, 100, t60=0.08), 0.06, peak_db=-19)
    return finish(room(L.out(), 'wood', wet=0.1), hp_hz=200, eq=[('peak', 3300, -2.5, 0.8)])


@cue('ui_shop_sell', 'ui', ('m', -22.0), UI_CHIME, **UICHIME)
def ui_shop_sell(v: int):
    """Sell: the buy clink turned over (D6 falling to G5), softer, with the item breathing out."""
    L = Layers(0.4)
    L.add(at_len(esc('tick', 0.7, seed='ss'), 0.05), 0.0, peak_db=-11)
    L.add(glass('D6', 0.3, 0.7, decay=0.09, bright=0.55, seed='ss1'), 0.0, peak_db=-1)
    L.add(glass('G5', 0.34, 0.7, decay=0.11, bright=0.5, seed='ss2'), 0.05, peak_db=0)
    L.add(breath(0.16, 2600, 900, shape='breath', q=1.6, seed='ss', peak_at=0.04, vel=0.5), 0.02, peak_db=-15)
    return finish(room(L.out(), 'wood', wet=0.08), hp_hz=220, lp_hz=9000, eq=[('peak', 3300, -2.5, 0.8)])


@cue('ui_shop_undo', 'ui', ('m', -23.0), UI_SHORT, **UICHIME)
def ui_shop_undo(v: int):
    """Undo: a glass note run backwards (time rewinding) closing on a wooden tock."""
    L = Layers(0.3)
    g = glass('A5', 0.1, 0.8, decay=0.1, bright=0.6, seed='su')
    L.add(rev(g, 0.008), 0.0, peak_db=-2)
    L.add(at_len(esc('tock', 0.8, seed='su'), 0.06), 0.095, peak_db=0)
    L.add(tink(hz('E5'), 0.08, 0.06, bright=0.2), 0.097, peak_db=-12)
    return finish(L.out(), hp_hz=220, eq=[('peak', 3200, -2.5, 0.8)])


@cue('ui_currency_tick', 'ui', ('m', -24.0), UI_TICK, **UITICK)
def ui_currency_tick(v: int):
    """Gleam counting up (rapid repeats): a tiny A6 glass grain, 1 ms attack, partials barely there."""
    x = tink(hz('A6'), 0.045, 0.03, bright=0.15, attack=0.001)
    return finish(spread(x, 0.2), hp_hz=600, eq=[('peak', 3500, -3, 0.8)])


@cue('ui_equip', 'ui', ('m', -21.0), (0.25, 0.7), **UICHIME)
def ui_equip(v: int):
    """Equip: a short cloth swish settling into a wooden knock, a soft G5+D6 glass chord on top."""
    r = R('ui_equip')
    L = Layers(0.6)
    L.add(S.whoosh(r, 0.11, 900, 2200, q=1.1, peak_at=0.7), 0.0, peak_db=-12)
    L.add(S.knock(r, 420, 0.05, 5, 'wood'), 0.09, peak_db=-3)
    L.add(drum('D3', 0.4, 'ghost', seed='eq', dur=0.3, t60=0.2), 0.09, peak_db=-12)
    L.add(glass('G5', 0.5, 0.75, decay=0.16, bright=0.6, seed='eq1'), 0.095, peak_db=0)
    L.add(glass('D6', 0.45, 0.65, decay=0.14, bright=0.55, seed='eq2'), 0.105, peak_db=-4)
    return finish(room(L.out(), 'wood', wet=0.1), hp_hz=120, eq=[('peak', 3300, -2, 0.8)])


@cue('ui_purchase', 'ui', ('m', -20.0), (0.8, 2.0), **UIMOMENT)
def ui_purchase(v: int):
    """Store purchase (tokens: FM shimmer arpeggio D-F#-A-C#): bright, quick, a sparkle trail and a plate."""
    r = R('ui_purchase')
    L = Layers(1.6)
    L.add(drum('D3', 0.5, 'ghost', seed='pu', dur=0.4, t60=0.25), 0.0, peak_db=-14)
    for i, note in enumerate(('D5', 'F#5', 'A5', 'C#6')):
        L.add(shimmer(note, 1.2, 0.75, decay=0.75 - 0.08 * i, index=1.6, seed=f'pu{i}'), 0.07 * i, peak_db=-1 + 0.3 * i, pan=-0.3 + 0.2 * i)
    L.add(glass('D6', 1.2, 0.7, decay=0.35, bright=0.6, seed='pu'), 0.21, peak_db=-7)
    L.add(glass('D5', 1.2, 0.6, decay=0.4, bright=0.5, seed='pub'), 0.0, peak_db=-8)
    L.add(S.sparkle(r, 0.6, 10, 86, 100, t60=0.14, rise=True, pcs=(2, 6, 9, 1)), 0.18, peak_db=-18)
    return finish(room(L.out(), 'plate', wet=0.2), hp_hz=120, eq=[('peak', 3300, -4, 0.7)])


@cue('ui_reward_reveal', 'ui', ('m', -20.0), (1.0, 2.4), **UIMOMENT)
def ui_reward_reveal(v: int):
    """Reward panel reveal: a glass chord drawn in backwards (lands with the panel's 240 ms delay), then
    the same D5-A5-E6 struck forward with a falling sparkle."""
    r = R('ui_reward_reveal')
    L = Layers(2.0)
    chord = Layers(0.4)
    for i, note in enumerate(('D5', 'A5', 'E6')):
        chord.add(glass(note, 0.4, 0.7, decay=0.3, seed=f'rr{i}'), 0.0, peak_db=-2 * i)
    L.add(rev(chord.out(), 0.02), 0.0, peak_db=-6)
    L.add(breath(0.32, 700, 3000, shape='swell', q=1.4, seed='rr', vel=0.6), 0.04, peak_db=-16)
    for i, note in enumerate(('D5', 'A5', 'E6')):
        L.add(glass(note, 1.6, 0.85, decay=0.45, bright=0.8, seed=f'rf{i}'), 0.36 + 0.012 * i, peak_db=-1.5 * i, pan=(-0.25, 0.25, 0.0)[i])
    L.add(S.sparkle(r, 0.9, 12, 84, 100, t60=0.18, decay_level=1.5), 0.38, peak_db=-14)
    return finish(room(L.out(), 'hall', wet=0.12), hp_hz=150, eq=[('peak', 3300, -2, 0.8)])


@cue('ui_level_account', 'ui', ('m', -20.0), (1.2, 2.8), **UIMOMENT)
def ui_level_account(v: int):
    """Account level up: a D4 bell and a frame drum under a fast A4-E5-B5-F#6 glass climb (the motif's
    bright ending), a sparkle shower and the hall."""
    r = R('ui_level_account')
    L = Layers(2.4)
    L.add(drum('D2', 0.8, 'doum', seed='la', dur=0.8, t60=0.45), 0.0, peak_db=-8)
    L.add(bell('D4', 2.2, 0.8, decay=0.3, seed='la'), 0.0, peak_db=-3)
    for i, note in enumerate(('A4', 'E5', 'B5', 'F#6')):
        L.add(glass(note, 1.6, 0.75 + 0.05 * i, decay=0.4, bright=0.75, seed=f'la{i}'), 0.08 * i, peak_db=-2 + 0.5 * i, pan=-0.3 + 0.2 * i)
    L.add(shimmer('F#6', 1.2, 0.5, decay=0.6, index=2.0, seed='la'), 0.24, peak_db=-12)
    L.add(S.sparkle(r, 1.1, 16, 86, 102, t60=0.2, decay_level=1.2, pcs=(2, 4, 6, 9, 11, 1)), 0.3, peak_db=-14)
    return finish(room(L.out(), 'hall', wet=0.16), hp_hz=40, eq=[('peak', 3300, -2, 0.8)])


@cue('ui_notify', 'ui', ('m', -22.0), UI_CHIME, **UICHIME)
def ui_notify(v: int):
    """Notification / toast: a gentle double knock on E6 glass over a warm E5 harp, polite and brief."""
    L = Layers(0.5)
    L.add(harp('E5', 0.4, 0.6, bright=0.4, damp_at=0.25, seed='nt'), 0.0, peak_db=-7)
    L.add(glass('E6', 0.3, 0.75, decay=0.08, bright=0.5, seed='nt1'), 0.0, peak_db=0)
    L.add(glass('E6', 0.3, 0.6, decay=0.08, bright=0.45, seed='nt2'), 0.11, peak_db=-4)
    return finish(room(L.out(), 'wood', wet=0.1), hp_hz=200, eq=[('peak', 3300, -2.5, 0.8)])

