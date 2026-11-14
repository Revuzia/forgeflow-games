#!/usr/bin/env python3
"""Generate the 10 Gold-Shop card backs (xAI) → assets/ui/cb_*.jpg.
Ornate symmetrical arcane emblems, portrait (card) aspect, no text."""
import base64, io, json, os, sys, time, urllib.request, urllib.error

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, 'assets', 'ui')
CFG = r'C:\Users\TestRun\AppData\Roaming\Nomi\api_config.json'
LEDGER = r'C:\Users\TestRun\Claude Claw\state\usage\xai_image.jsonl'
_c = json.load(open(CFG, encoding='utf-8'))
KEY = (_c.get('xai') or _c.get('providers', {}).get('xai'))['api_key']

BASE = ('ornate symmetrical fantasy trading-card BACK design, a centered medallion emblem, '
        'intricate filigree border framing the whole card, dark rich background, mystical, '
        'highly detailed, perfectly symmetrical, no text, no letters, no words')
BACKS = {
    'cb_arcanite.jpg':   'a crystalline arcanite lattice medallion, teal and silver geometric crystal facets glowing softly. ' + BASE,
    'cb_runeforge.jpg':  'a runeforged dark-iron sigil ringed with glowing molten-orange runes. ' + BASE,
    'cb_emberleaf.jpg':  'a mandala of intertwined flame and living leaves, warm orange and emerald green. ' + BASE,
    'cb_tidewoven.jpg':  'woven flowing tide currents in knotwork, deep blue and teal with pearl highlights. ' + BASE,
    'cb_thornmail.jpg':  'a thorned bramble crest with dark roses, deep green and crimson. ' + BASE,
    'cb_gilded.jpg':     'a gilded royal sunburst sigil in gold filigree over deep royal purple. ' + BASE,
    'cb_astral.jpg':     'an astral constellation ward, a star-map medallion with cosmic runes, indigo and gold. ' + BASE,
    'cb_obsidian.jpg':   'an obsidian pact seal of black volcanic glass shot through with glowing red cracks. ' + BASE,
    'cb_aetherbound.jpg':'a dual-element aether seal split down the middle, one half radiant gold, one half violet shadow, fused at the seam. ' + BASE,
    'cb_prismatic.jpg':  'a prismatic crystal seal refracting an iridescent rainbow across faceted glass. ' + BASE,
}


def gen(fname, prompt):
    payload = json.dumps({'model': 'grok-imagine-image', 'prompt': prompt + ', portrait vertical composition',
                          'n': 1, 'response_format': 'b64_json'}).encode()
    req = urllib.request.Request('https://api.x.ai/v1/images/generations', method='POST',
                                 data=payload, headers={'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'})
    for attempt in range(1, 4):
        try:
            body = json.loads(urllib.request.urlopen(req, timeout=240).read().decode())
            raw = base64.b64decode(body['data'][0]['b64_json'])
            from PIL import Image
            im = Image.open(io.BytesIO(raw)).convert('RGB')
            w, h = im.size
            t = 768
            if max(w, h) > t:
                im = im.resize((round(w * t / h), t) if h >= w else (t, round(h * t / w)), Image.LANCZOS)
            dest = os.path.join(OUT, fname)
            im.save(dest, 'JPEG', quality=88, optimize=True)
            return {'file': fname, 'ok': True, 'size': im.size}
        except urllib.error.HTTPError as e:
            if e.code in (400, 401, 403):
                return {'file': fname, 'ok': False, 'fatal': e.code, 'err': e.read().decode('utf-8', 'replace')[:160]}
            time.sleep(2 * attempt)
        except Exception:
            time.sleep(2 * attempt)
    return {'file': fname, 'ok': False, 'err': 'retries exhausted'}


def main():
    os.makedirs(OUT, exist_ok=True)
    only = [a for a in sys.argv[1:] if not a.startswith('--')]
    force = '--force' in sys.argv
    done = 0
    for fname, prompt in BACKS.items():
        if only and fname not in only:
            continue
        if not force and os.path.exists(os.path.join(OUT, fname)):
            continue
        res = gen(fname, prompt)
        print(json.dumps(res), flush=True)
        if res.get('ok'):
            done += 1
    with open(LEDGER, 'a', encoding='utf-8') as f:
        f.write(json.dumps({'ts': time.strftime('%Y-%m-%dT%H:%M:%S'), 'date': time.strftime('%Y-%m-%d'),
                            'api': 'xai_image', 'n': done, 'cost': round(0.02 * done, 4),
                            'note': 'aetherbound gold-shop card backs'}) + '\n')
    print(f'DONE {done}', flush=True)


if __name__ == '__main__':
    main()
