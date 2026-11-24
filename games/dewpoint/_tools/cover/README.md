# Store cover

`thumbnail.png` is composed from two close-ups captured from the real game, so it can be regenerated when the art changes.
Needs Chrome (or Edge) installed. `_tools` is withheld from the CDN by `pipeline/deploy_game.py`.

    node cover.mjs   "<path to chrome.exe>" "<path to games/dewpoint>" "<shots dir>"     # stages and captures the hero shots (cover-shots.json)
    node compose.mjs "<path to chrome.exe>" "<shots dir>" "<path to games/dewpoint>/thumbnail.png" a

Then deploy with `python pipeline/deploy_game.py --game-dir games/dewpoint --slug dewpoint` (the thumbnail URL is cache-busted by its hash).
