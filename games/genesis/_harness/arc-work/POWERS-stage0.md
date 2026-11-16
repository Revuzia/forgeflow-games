# POWERS-GROWTH stage 0: measured belief growth (spec v2, section 2.1 roads)

Measure only: no `src/**` change. Probe: `_harness/probes/powers-stage0.ts` (one run), `powers-stage0.sh` (driver),
`powers-stage0-tables.mjs` (aggregate). Raw per-run JSONL (per year rows + threshold days) was in
`_harness/scratch/powers1/*.jsonl`.

## What was run
- 4 scenarios x 4 behaviours x **4 seeds (1-4)**, 10 game years (120 days, a year = 12 days), planet `n = 20` (shrunk world).
  Cut from 6 seeds because a worker restart killed the first 6-seed run mid-way and budget was tight (the 6-seed partial v1 data
  gave the same picture and is not used).
- Scenarios: `default` = the sandbox world plus 60 plains-folk (bronze, settled), because the true default `barren` has no
  people to measure; `babel` (4 towns, 90 people); `shore` (one small stone-age band); `coldforge` ran but **all people died
  at n=20 (pop 0 in every run) so it is dropped**; it needs a larger planet.
- Behaviours: none; help (food, rain, heal, gift of bread, rotating); severe (lightning, ignite, hail, quake, wrath 0.3 default);
  mixed (alternate). Two acts per game day, both at the largest living town, through `applyNow` (the command path). Natural
  disasters left at the scenario default.
- Sampled once per game day; tables show seed means at year ends. `pop` = living. Faith/fear/trust are god 0.
- Roads (spec 2.1) are simulated in the probe from `A.faith/love/fear` with the hysteresis: believer = grown, faith >= 0.2999;
  trust road at love >= 0.50 and love >= fear, kept while love >= 0.50; fear road at fear >= 0.35 and fear > love, kept while
  fear >= 0.04; tie to trust. F v2 = believers + people on a road; S = F / (2 popMax), popMax is the grown ratchet (min 12,
  no 2%/year easing, so S is slightly low when pop falls). No pride/defiance/covenant modifiers.
- "gen" = worship generated, the sum of `settlement.worshipBy[0]` (never reduced by spending); "pool" = `planet.people.worship[0]`.
  The pool is almost never spent in these runs (default mode, miracles spend at most half their cost).
  `v1 F` (faith>=.30 + faith>=.55, children included) is in the threshold table.

## Tables (seed means)

### babel (4 seeds)

| god | yr | pop | faith>=.30 | >=.55 | fear>=.30 | >=.55 | trust>=.30 | >=.55 | faith&fear | faith&trust | believers (grown) | trust road | fear road | F v2 | S v2 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| none | 1 | 403 | 66 | 26 | 0 | 0 | 13 | 0 | 0 | 12 | 49 | 0 | 0 | 50 | 0.09 |
| none | 2 | 411 | 156 | 68 | 0 | 0 | 29 | 1 | 0 | 27 | 112 | 2 | 0 | 113 | 0.20 |
| none | 3 | 417 | 225 | 71 | 0 | 0 | 46 | 13 | 0 | 45 | 172 | 15 | 0 | 187 | 0.33 |
| none | 5 | 431 | 304 | 160 | 0 | 0 | 106 | 43 | 0 | 106 | 213 | 36 | 0 | 249 | 0.44 |
| none | 10 | 409 | 327 | 195 | 16 | 0 | 166 | 76 | 16 | 166 | 221 | 76 | 4 | 301 | 0.53 |
| help | 1 | 404 | 305 | 274 | 0 | 0 | 295 | 274 | 0 | 295 | 208 | 194 | 0 | 401 | 0.72 |
| help | 2 | 413 | 364 | 329 | 0 | 0 | 306 | 301 | 0 | 306 | 242 | 206 | 0 | 448 | 0.80 |
| help | 3 | 429 | 391 | 365 | 0 | 0 | 340 | 310 | 0 | 340 | 256 | 209 | 0 | 466 | 0.82 |
| help | 5 | 457 | 457 | 434 | 0 | 0 | 395 | 321 | 0 | 395 | 279 | 225 | 0 | 504 | 0.88 |
| help | 10 | 439 | 434 | 390 | 31 | 0 | 391 | 310 | 31 | 391 | 258 | 212 | 1 | 471 | 0.82 |
| severe | 1 | 382 | 328 | 284 | 312 | 227 | 37 | 0 | 311 | 35 | 232 | 0 | 217 | 449 | 0.80 |
| severe | 2 | 372 | 365 | 336 | 348 | 310 | 145 | 5 | 347 | 145 | 259 | 3 | 250 | 511 | 0.91 |
| severe | 3 | 360 | 357 | 345 | 346 | 330 | 176 | 27 | 346 | 173 | 250 | 6 | 244 | 500 | 0.89 |
| severe | 5 | 324 | 318 | 288 | 274 | 202 | 135 | 22 | 274 | 135 | 218 | 7 | 210 | 434 | 0.78 |
| severe | 10 | 256 | 248 | 234 | 186 | 136 | 158 | 72 | 186 | 158 | 169 | 25 | 130 | 323 | 0.58 |
| mixed | 1 | 398 | 351 | 205 | 187 | 70 | 286 | 199 | 187 | 284 | 240 | 144 | 46 | 429 | 0.77 |
| mixed | 2 | 396 | 359 | 319 | 229 | 117 | 321 | 250 | 228 | 312 | 246 | 153 | 59 | 458 | 0.82 |
| mixed | 3 | 400 | 354 | 323 | 231 | 163 | 322 | 261 | 231 | 322 | 240 | 141 | 76 | 457 | 0.82 |
| mixed | 5 | 405 | 386 | 348 | 255 | 209 | 367 | 320 | 255 | 367 | 254 | 164 | 64 | 481 | 0.86 |
| mixed | 10 | 381 | 376 | 349 | 206 | 157 | 332 | 242 | 206 | 332 | 235 | 100 | 102 | 437 | 0.78 |

Worship (gen = generated per year by all towns, pool = held at year end; per-town figure is per living town per game day):

| god | yr | gen/yr | gen/town/day | pool | shr | tmp |
|---|---|---|---|---|---|---|
| none | 1 | 871 | 18.2 | 871 | 4.0 | 4.0 |
| none | 2 | 2907 | 60.6 | 3778 | 4.0 | 4.0 |
| none | 3 | 5497 | 114.5 | 9275 | 4.0 | 4.0 |
| none | 5 | 6880 | 143.3 | 21294 | 4.0 | 4.0 |
| none | 10 | 8930 | 93.0 | 68125 | 7.8 | 4.3 |
| help | 1 | 4501 | 93.8 | 4374 | 4.0 | 4.0 |
| help | 2 | 11420 | 237.9 | 15659 | 4.0 | 4.0 |
| help | 3 | 16020 | 333.8 | 31544 | 4.0 | 4.0 |
| help | 5 | 19182 | 399.6 | 65621 | 4.0 | 4.0 |
| help | 10 | 21356 | 215.7 | 172717 | 7.5 | 5.5 |
| severe | 1 | 9751 | 203.1 | 9726 | 4.0 | 4.0 |
| severe | 2 | 34888 | 646.1 | 44584 | 4.0 | 4.0 |
| severe | 3 | 48839 | 814.0 | 93393 | 4.3 | 4.0 |
| severe | 5 | 44001 | 733.3 | 183855 | 4.3 | 4.0 |
| severe | 10 | 31510 | 318.3 | 352729 | 7.3 | 4.0 |
| mixed | 1 | 5976 | 124.5 | 5901 | 4.0 | 4.0 |
| mixed | 2 | 20013 | 392.4 | 25832 | 4.0 | 4.0 |
| mixed | 3 | 30870 | 605.3 | 56620 | 4.3 | 4.0 |
| mixed | 5 | 40641 | 752.6 | 133054 | 4.8 | 4.0 |
| mixed | 10 | 37629 | 392.0 | 327895 | 8.3 | 4.3 |

Day each v1 threshold is first crossed (median over seeds; plain F / with the share rules; "-" = never in 10 y; days, 12 = one year):

| god | F>=3 | F>=20 | F>=70 | F>=200 | rule3 | rule20 | rule70 | rule200 |
|---|---|---|---|---|---|---|---|---|
| none | 22 (4/4) | 22 (4/4) | 23 (4/4) | 43 (4/4) | 22 (4/4) | 22 (4/4) | 23 (4/4) | 43 (4/4) |
| help | 1 (4/4) | 1 (4/4) | 2 (4/4) | 4 (4/4) | 1 (4/4) | 1 (4/4) | 2 (4/4) | 4 (4/4) |
| severe | 1 (4/4) | 1 (4/4) | 1 (4/4) | 3 (4/4) | 1 (4/4) | 1 (4/4) | 1 (4/4) | 3 (4/4) |
| mixed | 1 (4/4) | 1 (4/4) | 1 (4/4) | 3 (4/4) | 1 (4/4) | 1 (4/4) | 1 (4/4) | 3 (4/4) |

### default (4 seeds)

| god | yr | pop | faith>=.30 | >=.55 | fear>=.30 | >=.55 | trust>=.30 | >=.55 | faith&fear | faith&trust | believers (grown) | trust road | fear road | F v2 | S v2 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| none | 1 | 67 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.00 |
| none | 2 | 70 | 14 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 11 | 0 | 0 | 11 | 0.12 |
| none | 3 | 72 | 13 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 12 | 0 | 0 | 12 | 0.12 |
| none | 5 | 80 | 36 | 1 | 0 | 0 | 2 | 1 | 0 | 2 | 25 | 1 | 0 | 26 | 0.27 |
| none | 10 | 80 | 66 | 46 | 5 | 0 | 47 | 24 | 5 | 46 | 39 | 21 | 2 | 61 | 0.61 |
| help | 1 | 67 | 67 | 67 | 0 | 0 | 67 | 67 | 0 | 67 | 47 | 47 | 0 | 93 | 0.99 |
| help | 2 | 69 | 69 | 69 | 0 | 0 | 69 | 69 | 0 | 69 | 47 | 47 | 0 | 93 | 0.97 |
| help | 3 | 72 | 72 | 72 | 0 | 0 | 72 | 71 | 0 | 72 | 47 | 47 | 0 | 94 | 0.98 |
| help | 5 | 80 | 80 | 80 | 0 | 0 | 80 | 80 | 0 | 80 | 47 | 47 | 0 | 93 | 0.96 |
| help | 10 | 83 | 83 | 83 | 0 | 0 | 82 | 82 | 0 | 82 | 46 | 46 | 0 | 91 | 0.91 |
| severe | 1 | 51 | 51 | 51 | 51 | 50 | 5 | 0 | 51 | 5 | 37 | 0 | 37 | 74 | 0.78 |
| severe | 2 | 39 | 39 | 39 | 39 | 39 | 2 | 0 | 39 | 2 | 28 | 0 | 28 | 56 | 0.60 |
| severe | 3 | 29 | 29 | 29 | 29 | 29 | 1 | 0 | 29 | 1 | 20 | 0 | 20 | 41 | 0.43 |
| severe | 5 | 15 | 15 | 15 | 15 | 15 | 0 | 0 | 15 | 0 | 10 | 0 | 10 | 21 | 0.22 |
| severe | 10 | 2 | 2 | 2 | 2 | 2 | 0 | 0 | 2 | 0 | 2 | 0 | 2 | 3 | 0.03 |
| mixed | 1 | 64 | 64 | 64 | 62 | 58 | 64 | 64 | 62 | 64 | 45 | 21 | 24 | 90 | 0.95 |
| mixed | 2 | 62 | 62 | 62 | 61 | 60 | 61 | 61 | 61 | 61 | 41 | 1 | 40 | 83 | 0.88 |
| mixed | 3 | 63 | 63 | 63 | 62 | 61 | 62 | 62 | 62 | 62 | 41 | 2 | 39 | 82 | 0.87 |
| mixed | 5 | 64 | 64 | 64 | 62 | 61 | 64 | 63 | 62 | 64 | 38 | 2 | 36 | 76 | 0.80 |
| mixed | 10 | 56 | 56 | 56 | 49 | 49 | 56 | 55 | 49 | 56 | 33 | 13 | 19 | 65 | 0.69 |

Worship (gen = generated per year by all towns, pool = held at year end; per-town figure is per living town per game day):

| god | yr | gen/yr | gen/town/day | pool | shr | tmp |
|---|---|---|---|---|---|---|
| none | 1 | 151 | 12.6 | 151 | 1.0 | 1.0 |
| none | 2 | 235 | 19.6 | 386 | 1.0 | 1.0 |
| none | 3 | 289 | 24.1 | 675 | 1.0 | 1.0 |
| none | 5 | 379 | 31.6 | 1369 | 1.0 | 1.0 |
| none | 10 | 2703 | 128.7 | 9534 | 1.5 | 1.0 |
| help | 1 | 2399 | 199.9 | 2272 | 1.0 | 1.0 |
| help | 2 | 3514 | 292.8 | 5651 | 1.0 | 1.0 |
| help | 3 | 3875 | 322.9 | 9390 | 1.0 | 1.0 |
| help | 5 | 4104 | 342.0 | 17314 | 1.0 | 1.0 |
| help | 10 | 5325 | 253.6 | 40085 | 1.5 | 1.3 |
| severe | 1 | 6409 | 534.0 | 6384 | 1.0 | 1.0 |
| severe | 2 | 5182 | 431.8 | 11536 | 1.0 | 1.0 |
| severe | 3 | 4865 | 405.4 | 16371 | 1.0 | 1.0 |
| severe | 5 | 2454 | 204.5 | 21941 | 1.0 | 1.0 |
| severe | 10 | 738 | 61.5 | 28362 | 1.0 | 1.0 |
| mixed | 1 | 6923 | 576.9 | 6849 | 1.0 | 1.0 |
| mixed | 2 | 12225 | 1018.7 | 18991 | 1.0 | 1.0 |
| mixed | 3 | 13077 | 1089.8 | 31986 | 1.0 | 1.0 |
| mixed | 5 | 11398 | 949.9 | 54532 | 1.0 | 1.0 |
| mixed | 10 | 10407 | 495.6 | 109029 | 1.3 | 1.0 |

Day each v1 threshold is first crossed (median over seeds; plain F / with the share rules; "-" = never in 10 y; days, 12 = one year):

| god | F>=3 | F>=20 | F>=70 | F>=200 | rule3 | rule20 | rule70 | rule200 |
|---|---|---|---|---|---|---|---|---|
| none | 50 (4/4) | 79 (4/4) | 114 (2/4) | - (0/4) | 50 (4/4) | 79 (4/4) | 111 (2/4) | 116 (2/4) |
| help | 1 (4/4) | 1 (4/4) | 2 (4/4) | - (0/4) | 1 (4/4) | 1 (4/4) | 2 (4/4) | 2 (4/4) |
| severe | 1 (4/4) | 1 (4/4) | 2 (4/4) | - (0/4) | 1 (4/4) | 1 (4/4) | 1 (4/4) | 2 (4/4) |
| mixed | 1 (4/4) | 1 (4/4) | 1 (4/4) | - (0/4) | 1 (4/4) | 1 (4/4) | 1 (4/4) | 1 (4/4) |

### shore (4 seeds)

| god | yr | pop | faith>=.30 | >=.55 | fear>=.30 | >=.55 | trust>=.30 | >=.55 | faith&fear | faith&trust | believers (grown) | trust road | fear road | F v2 | S v2 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| none | 1 | 33 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.00 |
| none | 2 | 35 | 8 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 6 | 0 | 0 | 6 | 0.12 |
| none | 3 | 35 | 6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 5 | 0.11 |
| none | 5 | 38 | 7 | 6 | 6 | 5 | 0 | 0 | 6 | 0 | 6 | 0 | 5 | 11 | 0.22 |
| none | 10 | 37 | 25 | 18 | 0 | 0 | 13 | 2 | 0 | 13 | 18 | 2 | 2 | 22 | 0.43 |
| help | 1 | 33 | 33 | 33 | 0 | 0 | 33 | 33 | 0 | 33 | 23 | 23 | 0 | 46 | 0.99 |
| help | 2 | 36 | 36 | 36 | 0 | 0 | 35 | 35 | 0 | 35 | 23 | 23 | 0 | 47 | 0.99 |
| help | 3 | 37 | 37 | 37 | 0 | 0 | 37 | 37 | 0 | 37 | 24 | 24 | 0 | 47 | 1.00 |
| help | 5 | 40 | 40 | 40 | 0 | 0 | 40 | 40 | 0 | 40 | 24 | 24 | 0 | 48 | 0.99 |
| help | 10 | 41 | 41 | 41 | 0 | 0 | 41 | 39 | 0 | 41 | 24 | 23 | 0 | 47 | 0.94 |
| severe | 1 | 21 | 21 | 21 | 21 | 21 | 0 | 0 | 21 | 0 | 16 | 0 | 16 | 32 | 0.68 |
| severe | 2 | 12 | 12 | 12 | 12 | 12 | 0 | 0 | 12 | 0 | 8 | 0 | 8 | 17 | 0.36 |
| severe | 3 | 5 | 5 | 5 | 5 | 5 | 0 | 0 | 5 | 0 | 4 | 0 | 4 | 8 | 0.16 |
| severe | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0.01 |
| severe | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.00 |
| mixed | 1 | 26 | 26 | 26 | 25 | 24 | 26 | 26 | 25 | 26 | 19 | 7 | 12 | 38 | 0.83 |
| mixed | 2 | 22 | 22 | 22 | 21 | 21 | 22 | 22 | 21 | 22 | 16 | 1 | 15 | 32 | 0.71 |
| mixed | 3 | 19 | 19 | 19 | 19 | 19 | 19 | 19 | 19 | 19 | 14 | 0 | 13 | 27 | 0.60 |
| mixed | 5 | 14 | 14 | 14 | 14 | 14 | 14 | 14 | 14 | 14 | 9 | 0 | 9 | 18 | 0.39 |
| mixed | 10 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 3 | 0 | 3 | 7 | 0.14 |

Worship (gen = generated per year by all towns, pool = held at year end; per-town figure is per living town per game day):

| god | yr | gen/yr | gen/town/day | pool | shr | tmp |
|---|---|---|---|---|---|---|
| none | 1 | 62 | 5.2 | 62 | 0.5 | 0.0 |
| none | 2 | 61 | 5.1 | 123 | 0.8 | 0.0 |
| none | 3 | 38 | 3.1 | 161 | 0.8 | 0.0 |
| none | 5 | 372 | 31.0 | 553 | 1.0 | 0.0 |
| none | 10 | 1118 | 62.1 | 4915 | 1.3 | 0.0 |
| help | 1 | 861 | 71.7 | 741 | 1.0 | 0.0 |
| help | 2 | 1458 | 121.5 | 2064 | 1.0 | 0.0 |
| help | 3 | 1655 | 137.9 | 3583 | 1.0 | 0.0 |
| help | 5 | 1852 | 154.4 | 6936 | 1.0 | 0.0 |
| help | 10 | 2062 | 98.2 | 16905 | 1.5 | 0.0 |
| severe | 1 | 1310 | 109.1 | 1285 | 0.0 | 0.0 |
| severe | 2 | 883 | 73.6 | 2138 | 0.0 | 0.0 |
| severe | 3 | 325 | 27.1 | 2433 | 0.0 | 0.0 |
| severe | 5 | 51 | 4.3 | 2604 | 0.0 | 0.0 |
| severe | 10 | 0 | 0.0 | 2635 | 0.0 | 0.0 |
| mixed | 1 | 1651 | 137.6 | 1579 | 0.0 | 0.0 |
| mixed | 2 | 1975 | 164.6 | 3471 | 0.0 | 0.0 |
| mixed | 3 | 1556 | 129.7 | 4945 | 0.0 | 0.0 |
| mixed | 5 | 1386 | 115.5 | 7706 | 0.3 | 0.0 |
| mixed | 10 | 493 | 41.1 | 11506 | 0.3 | 0.0 |

Day each v1 threshold is first crossed (median over seeds; plain F / with the share rules; "-" = never in 10 y; days, 12 = one year):

| god | F>=3 | F>=20 | F>=70 | F>=200 | rule3 | rule20 | rule70 | rule200 |
|---|---|---|---|---|---|---|---|---|
| none | 94 (4/4) | 96 (3/4) | - (0/4) | - (0/4) | 94 (4/4) | 91 (3/4) | 57 (1/4) | - (0/4) |
| help | 2 (4/4) | 2 (4/4) | - (0/4) | - (0/4) | 2 (4/4) | 2 (4/4) | 2 (4/4) | - (0/4) |
| severe | 1 (4/4) | 1 (4/4) | - (0/4) | - (0/4) | 1 (4/4) | 1 (4/4) | 2 (4/4) | - (0/4) |
| mixed | 1 (4/4) | 1 (4/4) | - (0/4) | - (0/4) | 1 (4/4) | 1 (4/4) | 2 (4/4) | - (0/4) |





(`rule` columns apply the spec's S rules; the plain `F` columns use F alone. `(k/4)` = seeds that crossed it. These use the v1
F of faith>=.30 plus faith>=.55 over everybody, children included. Hold days are not applied. Days are game days; 12 = 1 year.)

## Reading

**Pace.** With no acts at all the people are not at zero: `babel` (a bronze-age, fully built world) reaches F >= 3/20/70/200 on
days 22/22/23/43 on its own, and has 301 F (v2) and 76 on the road of trust by year 10. `default` (spawned folk) reaches F >= 3 on day
50, F >= 20 on day 79, F >= 70 on day 114 in 2/4 seeds, and about 61 v2 F at year 10; `shore` F >= 3 on day 94 and about 22 F at year 10
(faith 0.30 for 25 of 37). So the sim already makes believers from nothing; "Unknown" does not last a year in any world with people.
Any act, kind or severe, crosses 3, 20 and 70 inside **1 to 2 game days** (and F >= 200 on days 2-4 in `babel`). Faith reaches 0.55 for
nearly the whole town in the first day. This is 10 to 20 times faster than the spec's pace targets (Whispered by day 3, Known between
day 12 and 36, Worshipped between year 6 and 15). At two acts a day on a town, v1 numbers are gone in a day, not a year. The sim's faith
gain per witnessed act (+0.15 help, +0.25 sign, +0.15 to +0.20 harm, plus a 0.6 x trust seed for spawned folk) is large against the 0.30 line.
Worship is `Unknown` only until the first act. To meet the pace targets `reach.scale`/the thresholds have to be several times larger,
or the line must be higher, or acts per day far fewer than 2 (the targets assume one witnessed act per day, which is what was tried at
two).

**Two roads grow at similar speed in faith, but not in what they leave behind.** Faith >= 0.30 and F are about the same for help and severe
from day 1 (help 401 v2 F vs severe 449 at `babel` year 1; 93 vs 74 in `default`). On the roads: help puts people on the trust road
(babel: 194 of 208 believers at year 1, 212 at year 10; default 47, shore 23: essentially every grown person), severe puts them on the fear road
(babel: 217 at year 1, 130 at year 10; default 37; shore 16). Mixed splits (babel 144 trust / 46 fear at year 1, 100 / 102 at year 10, so the
fear share grows with time; default 21/24 then 13/19). Faith & fear overlap is total under severe, faith & trust under help;
under mixed both (faith&fear 187 of 351 faith>=.30 in babel at year 1). Fear >= 0.30 never exists without acts, at most 16 of 409 in
babel at year 10 from natural disasters. Trust (love) alone rises slowly without acts: 166 >= .30 and 76 >= .55 at babel year 10.

**Severe kills the people.** Two harmful acts a day at the largest town (default wrath 0.3, "survivable") took `default` from 67 to 51 in
one year, 15 in five and 2 in ten; `shore` from 33 to 0 within five years; `babel` from 403 to 256. So the fear road at this rate is
not sustainable in small worlds: population falls faster than belief ever matters, S falls with it, and `shore` ends with F = 0. Mixed
also shrinks small worlds (shore 33 to 5 in 10 y). Help only grows pop (default 67 to 83). In `babel`, severe peaks at F 511 in year 2 and falls to 323 by year 10, while help holds 448 to 504 and ends at 471.
Fear is not decaying fast under steady provocation: fear >= .55 stays 136 to 330 of 256 to 360 people. With no one hit, fear decays as spec'd.
The roads are close in rate and the fear road is only more costly in lives, not slower.

**Worship pool.** Generated worship is large and scales with towns, population and acts. `gen/town/day`: default none 13 at year 1 (31 at yr 5, 129
at yr 10), help 200 then 340 then 254, severe 534 then 205 then 62 (pop collapse), mixed 577 / 950 / 496. `babel` (4 towns):
none 18 / 143 / 93 per town-day, help 94 / 400 / 216, severe 203 / 733 / 318, mixed 125 / 753 / 392. `shore` (one hamlet): none 5 to 62, help 72 to 154.
Per year, all towns: `babel` none 0.9k (yr 1) to 8.9k (yr 10); help 4.5k to 21k; severe 9.8k to 44k (yr 5); `default` help 2.4k to 5.3k;
`shore` help 0.9k to 2.1k. The pool is not spent (default mode), so it ends enormous: babel help 173k, severe 353k, default help 40k, shore
help 17k. Shrines and temples: `babel` starts with 4 shrines and 4 temples and rises to about 8 and 5 by year 10; `default` 1 and 1 to 1.5 and 1;
`shore` 0 to 1.5 shrines, no temples. A spent worship pool at 1 to 8k a year per town-world would be spent very fast by the costs in
`powers.json` (disasters 80 / 400); the numbers say the pool is not the limit at these rates, and that the generation per person per day is
about 0.3 to 2 and rises with acts (severe/mixed generate 2 to 3x the none/help rate in the first years; this is because fear plus love
steers worship to god 0, `love + 0.5 fear > 0.05`).

**Today's daily worship gathering of a town** (generation per living town per game day, seed means, from the tables): about 5 to 14 in the
first year with no acts, rising to 60 to 130 by year 10 as faith builds; 70 to 200 per day with help acts; 110 to 580 per day under severe or
mixed (default), peaks of 730 to 950 per town-day in year 5. This is a per-town figure of 0 to ~1000 and no daily cap exists today; the
spec's "daily measure per town" (section 3.6) would clip severe and mixed to the calm-town level, which is 5 to 3x lower than what is measured.

**Surprises / caveats.**
1. Faith never lags: no run showed "faith never passing 0.30" when any act is made; only the act-free `default`/`shore` runs are slow.
2. A world with `none` still builds belief; `Unknown` is a day-1 state only for a person-free world.
3. Severe at 2 acts/day is lethal at n=20; the severe numbers for `default` and `shore` are partly the story of a dying town. A kinder
   severe script (1 act per 2 days, or acts away from the houses) would be needed to test the fear road past year 3.
4. Newly spawned people (`default`) start with faith 0 from the `freshen` rule when bound; this probe ran on today's code (trust and fear inherited), so the
   very quick day-1 numbers include inherited faith for spawned folk (hence F >= 20 on day 1 for `default`; `babel`/`shore` people are placed with their seeds).
5. `coldforge` at `n = 20` loses everyone: do not use it for stage-1 probes at that size.
6. Not measured: the 2% popMax easing, pride/defiance modifiers, child flag effects beyond excluding children, per-tick (not daily) witnessing at Unknown.
