"""Verifier analysis (orch1 W1-C r1) of _tmp_vfy_w1c_r1_fight.mjs output: pumping and priority in a BRIDGE 5v5 teamfight.
    ../../.venv/bin/python _harness/_tmp_vfy_w1c_r1_fight_an.py <dir with trace.json, fight*.wav>
Writes <dir>/analysis.json and <dir>/fight<k>_spec.png."""
import json, sys, os, wave
import numpy as np

D = sys.argv[1]
R = json.load(open(os.path.join(D, 'trace.json')))
C = R['cols']; B = np.array(R['blocks'], dtype=float); sr = R['rate']; blk = 4096 / sr
col = {n: B[:, i] for i, n in enumerate(C)}
ct = col['ct']
LU = lambda ms: -0.691 + 10 * np.log10(np.maximum(ms, 1e-20))
def mov(x, n): k = np.ones(n) / n; return np.convolve(x, k, mode='same')
ST, MO = 35, 5    # 3 s, ~0.43 s
polls = np.array([[p[0], p[2], p[3], p[4]] for p in R['polls']], dtype=float)
def fight_mask(foes=3, allies=2):
    m = np.zeros(len(ct), bool)
    for pct_, alive, f, a in polls:
        if alive and f >= foes and a >= allies: m |= (ct >= pct_ - 1.0) & (ct <= pct_ + 1.0)
    return m
FM = fight_mask(); FM4 = fight_mask(4, 3)
sfxPre = col['busPre'] + col['threatPre'] + col['prioPre']
sfxPost = col['bgPost'] + col['threatPost'] + col['prioPost']
bgPost = col['bgPost'] + col['threatPost']
def stats(x, m):
    v = x[m]; v = v[np.isfinite(v)]
    if not len(v): return None
    return dict(p5=round(float(np.percentile(v, 5)), 2), p50=round(float(np.percentile(v, 50)), 2), p95=round(float(np.percentile(v, 95)), 2), std=round(float(np.std(v)), 2), min=round(float(v.min()), 2), max=round(float(v.max()), 2))
def segs(m):
    d = np.diff(np.concatenate([[0], m.astype(int), [0]])); return list(zip(np.where(d == 1)[0], np.where(d == -1)[0]))
def modband(x, m, lo=0.3, hi=3.0):
    """RMS (dB) of the gain trace's component between lo and hi Hz, over each contiguous fight segment >= 8 s."""
    out = []
    for a, b in segs(m):
        if (b - a) * blk < 8: continue
        y = x[a:b] - np.mean(x[a:b]); F = np.fft.rfft(y * np.hanning(len(y))); f = np.fft.rfftfreq(len(y), blk)
        F[(f < lo) | (f > hi)] = 0; out.append(float(np.sqrt(np.mean(np.fft.irfft(F, len(y)) ** 2))) * 1.63)   # hann gain
    return round(float(np.max(out)), 2) if out else None, round(float(np.median(out)), 2) if out else None
def pumps(g, m, depth=3.0, within=3.0):
    """a cut of >= depth dB that comes back >= depth dB within `within` s, counted inside fight blocks; per minute."""
    n = 0; w = int(within / blk); i = 0; idx = np.where(m)[0]; s = set(idx.tolist())
    while i < len(g) - 1:
        if i in s:
            j0 = i; lo = g[i]; jl = i
            for j in range(i, min(len(g), i + w)):
                if g[j] < lo: lo, jl = g[j], j
            if g[i] - lo >= depth:
                back = [k for k in range(jl, min(len(g), jl + w)) if g[k] - lo >= depth]
                if back: n += 1; i = back[0]; continue
        i += 1
    mins = m.sum() * blk / 60
    return n, round(n / mins, 2) if mins > 0 else None
rep = {'queue': R['queue'], 'seed': R['seed'], 'you': R.get('you'), 'trimDb': R.get('trimDb'), 'blocks': int(len(ct)),
       'fightSeconds': round(float(FM.sum() * blk), 1), 'fight4v4Seconds': round(float(FM4.sum() * blk), 1), 'caps': R['caps'], 'err': R['err']}
lev, prio, lim, duck = col['levDb'], col['prioDb'], col['limiterRedDb'], col['fightDuckDb']
outST, outMO = LU(mov(col['out'], ST)), LU(mov(col['out'], MO))
rep['gainReduction'] = {
    'bgDbFight': stats(lev, FM), 'prioDbFight': stats(prio, FM), 'bgDbAll': stats(lev, np.ones(len(ct), bool)),
    'bgAtFloorPctFight': round(float(100 * np.mean(lev[FM] <= -7.9)), 1) if FM.any() else None,
    'bgRate95DbPerS': round(float(np.percentile(np.abs(np.diff(lev))[FM[1:]] / blk, 95)), 2) if FM.any() else None,
    'bgRateMaxDbPerS': round(float(np.max(np.abs(np.diff(lev))[FM[1:]] / blk)), 2) if FM.any() else None,
    'bgMod03to3HzRmsDb_max_median': modband(lev, FM), 'prioMod03to3HzRmsDb_max_median': modband(prio, FM),
    'bgPumpCycles3dB3s_n_perMin': pumps(lev, FM), 'prioPumpCycles3dB3s_n_perMin': pumps(prio, FM),
    'bgPumpCycles2dB2s_n_perMin': pumps(lev, FM, 2.0, 2.0),
    'longCutDbEnd': round(float(col['longCutDb'][-1]), 2),
    'limiterRedDbFight': stats(lim, FM), 'limiterRedDbAll': stats(lim, np.ones(len(ct), bool)),
    'limiterMod03to3HzRmsDb_max_median': modband(lim, FM), 'fightDuckDbFight': stats(duck, FM),
}
# short-term / momentary loudness variance: the output, the sfx before vs after the leveller
def lustat(x, m, n):
    y = LU(mov(x, n)); return stats(y, m & (y > -60))
rep['loudness'] = {
    'outShortTermFight': lustat(col['out'], FM, ST), 'outMomentaryFight': lustat(col['out'], FM, MO),
    'sfxPreShortTermFight': lustat(sfxPre, FM, ST), 'sfxPostShortTermFight': lustat(sfxPost, FM, ST),
    'sfxPreMomentaryFight': lustat(sfxPre, FM, MO), 'sfxPostMomentaryFight': lustat(sfxPost, FM, MO),
    'outShortTermAll': lustat(col['out'], np.ones(len(ct), bool), ST),
    'musicMomentaryFight': lustat(col['music'], FM, MO), 'musicMomentaryAll': lustat(col['music'], np.ones(len(ct), bool), MO),
}
# the background "breathing": the momentary bg level after the leveller minus before it, high-passed (> 0.3 Hz)
bgPreMo, bgPostMo = LU(mov(col['busPre'] + col['threatPre'], MO)), LU(mov(bgPost, MO))
applied = bgPostMo - bgPreMo
rep['bgAppliedGainMomentary'] = {'fight': stats(applied, FM & (bgPreMo > -60)), 'mod03to3HzRmsDb': modband(np.nan_to_num(applied), FM & (bgPreMo > -60))}
# priority: share and lead over the background, in fight blocks; the stage-2 vs stage-1 relative lift
pMo, bMo = LU(mov(col['prioPost'], MO)), LU(mov(bgPost, MO))
live = FM & (pMo > -60) & (bMo > -60)
rep['priority'] = {
    'prioSharePctFight': round(float(100 * col['prioPost'][FM].sum() / max(1e-30, sfxPost[FM].sum())), 1) if FM.any() else None,
    'prioSharePctFightPre': round(float(100 * col['prioPre'][FM].sum() / max(1e-30, sfxPre[FM].sum())), 1) if FM.any() else None,
    'prioOverBgMomentaryLUFight': stats(pMo - bMo, live),
    'relativeLiftDb(prio-bg)Fight': stats(prio - lev, FM),
    'prioCutMoreThanBgBlocks': int(np.sum((prio < lev - 0.05) & FM)),
}
# per-cue: own autos and incoming threats in fight windows, the momentary priority path vs background at the play
plays = R.get('plays') or []
me = (R.get('you') or {}).get('fighter') or ''
def at(t): return int(np.clip(np.searchsorted(ct, t + 0.15), 0, len(ct) - 1))
def cue_rows(pred):
    rows = []
    for p in plays:
        t, cid, you, onyou, aware, res = p
        if res not in ('ok', 'played') or not pred(cid, you, onyou, aware): continue
        i = at(t)
        if not FM[i]: continue
        rows.append(float(pMo[i] - bMo[i]) if np.isfinite(pMo[i] - bMo[i]) else None)
    rows = [r for r in rows if r is not None]
    if not rows: return {'n': 0}
    a = np.array(rows); return {'n': len(rows), 'prioOverBgLU_p10': round(float(np.percentile(a, 10)), 2), 'p50': round(float(np.median(a)), 2), 'fracGe0': round(float(np.mean(a >= 0)), 3)}
rep['cuesInFight'] = {
    'ownAutoHit': cue_rows(lambda c, y, o, a: y and ('attack_hit' in c or 'attack_swing' in c)),
    'ownKit': cue_rows(lambda c, y, o, a: y and c.startswith('f_')),
    'onYou': cue_rows(lambda c, y, o, a: o),
    'enemyWindup': cue_rows(lambda c, y, o, a: c == 'm_enemy_windup'),
    'awareNotYou': cue_rows(lambda c, y, o, a: a and not o and not y),
}
cnt = {}
for p in plays: cnt[p[5]] = cnt.get(p[5], 0) + 1
rep['playResults'] = cnt
# WAVs: envelope modulation of the final output in the fight, and a spectrogram picture
try:
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
except Exception:
    plt = None
rep['wav'] = []
for k, cap in enumerate(R['caps']):
    f = cap['wav']
    if not os.path.exists(f): f = os.path.join(D, os.path.basename(f))
    w = wave.open(f); n = w.getnframes(); x = np.frombuffer(w.readframes(n), np.int16).reshape(-1, 2).astype(float) / 32767; w.close()
    m = x.mean(1); peak = float(20 * np.log10(np.max(np.abs(x)) + 1e-12))
    hop = int(0.05 * sr); fr = np.array([np.sqrt(np.mean(m[i:i + hop] ** 2)) for i in range(0, len(m) - hop, hop)])
    db = 20 * np.log10(fr + 1e-9)
    clip = int(np.sum(np.abs(x) > 0.999))
    row = {'wav': os.path.relpath(f), 'seconds': round(len(m) / sr, 1), 'peakDbfs': round(peak, 2), 'clippedSamples': clip, 'rms50msDb': {'p10': round(float(np.percentile(db, 10)), 1), 'p50': round(float(np.percentile(db, 50)), 1), 'p90': round(float(np.percentile(db, 90)), 1)}}
    if plt:
        fig, ax = plt.subplots(3, 1, figsize=(14, 9), sharex=False)
        ax[0].specgram(m, NFFT=2048, Fs=sr, noverlap=1536, cmap='magma', vmin=-120); ax[0].set_ylim(0, 12000); ax[0].set_title(f'{os.path.basename(f)} output spectrogram')
        ax[1].plot(np.arange(len(db)) * 0.05, db, lw=0.6); ax[1].set_ylabel('RMS 50 ms dBFS')
        c0 = cap.get('wavCt0') or ct[0]; sel = (ct >= c0) & (ct <= c0 + len(m) / sr)
        ax[2].plot(ct[sel] - c0, lev[sel], label='bg leveller dB'); ax[2].plot(ct[sel] - c0, prio[sel], label='prio dB'); ax[2].plot(ct[sel] - c0, -lim[sel] if np.median(lim) >= 0 else lim[sel], label='limiter red dB'); ax[2].plot(ct[sel] - c0, duck[sel], label='fight duck dB'); ax[2].legend(); ax[2].set_xlabel('s')
        png = os.path.join(D, f'fight{k}_spec.png'); fig.tight_layout(); fig.savefig(png, dpi=70); plt.close(fig); row['png'] = os.path.relpath(png)
    if not plt:
        from PIL import Image, ImageDraw
        N, H = 2048, 512
        frames = range(0, len(m) - N, H); win = np.hanning(N)
        S = np.array([np.abs(np.fft.rfft(m[i:i + N] * win)) for i in frames]).T
        f = np.fft.rfftfreq(N, 1 / sr); S = S[f <= 12000][::-1]
        S = 20 * np.log10(S + 1e-9); S = np.clip((S - (S.max() - 90)) / 90, 0, 1)
        img = Image.fromarray((S * 255).astype(np.uint8)).resize((1400, 300))
        c0 = cap.get('wavCt0') or ct[0]; sel = (ct >= c0) & (ct <= c0 + len(m) / sr)
        strip = Image.new('L', (1400, 260), 255); dr = ImageDraw.Draw(strip)
        ts = ct[sel] - c0; T = len(m) / sr
        for ser, sh in ((lev[sel], 0), (prio[sel], 0), (db[:], 1)):
            pass
        def line(xs, ys, lo, hi, y0, y1):
            pts = [(int(1399 * xv / T), int(y1 - (y1 - y0) * (np.clip(yv, lo, hi) - lo) / (hi - lo))) for xv, yv in zip(xs, ys)]
            if len(pts) > 1: dr.line(pts, fill=0, width=1)
        line(np.arange(len(db)) * 0.05, db, -50, 0, 5, 125)       # output RMS 50 ms, -50..0 dBFS
        line(ts, lev[sel], -9, 0, 135, 195)                       # bg leveller gain, -9..0 dB
        line(ts, prio[sel], -9, 0, 200, 255)                      # prio gain, -9..0 dB
        full = Image.new('L', (1400, 560), 255); full.paste(img, (0, 0)); full.paste(strip, (0, 300))
        png = os.path.join(D, f'fight{k}_spec.png'); full.save(png); row['png'] = os.path.relpath(png)
    rep['wav'].append(row)
json.dump(rep, open(os.path.join(D, 'analysis.json'), 'w'), indent=1)
print(json.dumps(rep, indent=1))
