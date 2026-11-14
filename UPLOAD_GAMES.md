# Uploading games to forgeflowgames.com — the easy way

One tool, works the same on **any PC** (yours or a friend's). It uses a
Cloudflare **R2 API token** (no browser login that expires or misses R2
permission), uploads a game's files, updates the site database, and verifies the
game is actually live before saying "done."

## TL;DR (after one-time setup)
- **Double-click `upload-game.bat`** → pick a game (or "all") → it uploads + verifies.
- Or from a terminal in the repo folder: `python upload_game.py` (interactive),
  `python upload_game.py iron-tide` (one game), `python upload_game.py --all`.

The game shows up on **https://forgeflowgames.com** automatically afterward.

---

## One-time setup on a new PC (~5 min)

### 1. Prerequisites
- **Python 3** — https://www.python.org/downloads/ (tick "Add Python to PATH").
- **Node.js** (gives you `npx`/`wrangler`) — https://nodejs.org.
- The repo cloned locally (`git clone https://github.com/Revuzia/forgeflow-games.git`).

### 2. Create the Cloudflare R2 API token (do this once per account)
1. Go to **https://dash.cloudflare.com/profile/api-tokens**
2. **Create Token → Create Custom Token**
3. Permissions: **Account → Workers R2 Storage → Edit**
4. Account Resources: **Include → your account (isimcha85)**
5. **Create Token** and copy it.

### 3. Save the token
Run once and paste the token when asked (it's saved to `.secrets/`, which is
gitignored, so you're never asked again on that PC):
```
python upload_game.py --setup
```
You can also check everything is ready any time:
```
python upload_game.py --check
```
Expected:
```
  wrangler:    wrangler 4.x
  account id:  …ffc
  API token:   present (R2 Edit)
  games found: N -> iron-tide, ...
  ✓ Ready to upload.
```

---

## Using it
- **`upload-game.bat`** (double-click) — friendliest; lists games, you pick one or "all".
- **`python upload_game.py iron-tide`** — upload a specific game by folder name.
- **`python upload_game.py --all`** — push every game under `games/`.

After each upload it prints a live check (`index.html=200 thumbnail.png=200
content.json=200`) and the URL. If R2 ever fails it **does not** touch the site
database, so you never get a broken listing with a missing image/game.

## Where the token lives / precedence
Resolved in this order (first found wins):
1. `CLOUDFLARE_API_TOKEN` environment variable
2. `.secrets/cf_api_token.txt` in the repo (created by `--setup`, gitignored)
3. `api_config.json` → `providers.cloudflare.api_token` (this machine only)

Account id resolves the same way (`CLOUDFLARE_ACCOUNT_ID` →
`.secrets/cf_account_id.txt` → api_config `account_id_isimcha85`).

## Troubleshooting
- **"API token: MISSING"** → `python upload_game.py --setup`.
- **"wrangler: NOT FOUND"** → install Node.js, reopen the terminal.
- **R2 says 403 / 0 files uploaded** → the token lacks **R2 Edit** permission;
  recreate it with the permission in step 2 and run `--setup` again.
- **Game uploaded but image still old on the site** → CDN cache; hard-refresh
  (Ctrl+Shift+R) or wait a few minutes.
