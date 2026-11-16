# Live build snapshot, 2026-11-16

An exact copy of what https://forgeflow-games-cdn.isimcha85.workers.dev/squish-keeper/ served on 2026-11-16 14:18 UTC
(entry `assets/index-EDiFfg-N.js`). It was downloaded from the CDN, not built from this branch.

Why it is here: the source that produced this build is not on GitHub (it is on the owner's PC), so this copy is the only
rollback. To restore the site to exactly this state, deploy this folder as the game directory:
`python pipeline/deploy_game.py --game-dir games/wobblehoard/_live_snapshot/2026-11-16 --slug squish-keeper --no-portal`.

What it has that this branch does not (found by comparing text in the bundles): the redesigned UI kit and tool dock, 17 trophies
saved under `wobblehoard:v1:ach`, the ForgeFlow account bridge (`forgeflow:whoami`, `forgeflow:identity`, `forgeflow:achievement`),
and newer Cut tool messages. Save keys shared with this branch: `wobblehoard:v1:profile`, `wobblehoard:v1:settings`.

Do not edit these files. `SHA256SUMS` lists their hashes.
