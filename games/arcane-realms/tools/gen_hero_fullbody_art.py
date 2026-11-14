#!/usr/bin/env python3
"""Generate FULL-BODY hero character art (xAI) for the 3D hero pipeline.
The old hero_{realm}.jpg were bust portraits -> Meshy made busts. These are
head-to-toe standing figures on a plain background so Meshy segments a full
body. Output: assets/heroes/src/hero_{realm}_full.jpg (portrait, ~1024 tall)."""
import base64, io, json, os, sys, time, urllib.request, urllib.error

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, 'assets', 'heroes', 'src')
CFG = r'C:\Users\TestRun\AppData\Roaming\Nomi\api_config.json'
LEDGER = r'C:\Users\TestRun\Claude Claw\state\usage\xai_image.jsonl'
_c = json.load(open(CFG, encoding='utf-8'))
KEY = (_c.get('xai') or _c.get('providers', {}).get('xai'))['api_key']

# plain dark background + full figure + feet visible => clean full-body Meshy model
COMMON = ("full-body character, entire figure head to feet visible, standing "
          "heroic A-pose, feet on ground, symmetrical, centered, isolated on a "
          "plain flat dark charcoal background, video-game hero reference, "
          "painterly, dramatic rim light, ultra detailed, no text, no border")
PROMPTS = {
    'ember':  f"A towering fire warlord in molten blackened plate armor cracked with glowing lava veins, "
              f"burning cape, twin ember gauntlets, fierce horned helm. {COMMON}",
    'tide':   f"A serene frost archmage in flowing layered teal and silver robes, tall crystalline staff, "
              f"long silver hair, ice-blue aura, ornate collar. {COMMON}",
    'grove':  f"A graceful nature druid queen fused with living wood and vines, antlered crown, "
              f"leaf-woven emerald gown, glowing green sigils, barefoot on roots. {COMMON}",
    'dawn':   f"A radiant paladin light-warden in ornate golden filigree armor, feathered halo wings, "
              f"holy longsword of light, white and gold tabard. {COMMON}",
    'grave':  f"A gaunt lich necromancer in tattered black and violet burial robes, skeletal crowned face, "
              f"floating soul wisps, bone staff, spectral purple glow. {COMMON}",
    'neutral':f"An arcane archon scholar in star-woven indigo robes threaded with constellations, "
              f"floating spellbook, ornate horned circlet, cosmic violet aura. {COMMON}",
}


def gen(realm, prompt):
    payload = json.dumps({'model': 'grok-imagine-image', 'prompt': prompt,
                          'n': 1, 'response_format': 'b64_json'}).encode()
    req = urllib.request.Request('https://api.x.ai/v1/images/generations', method='POST',
                                 data=payload, headers={'Authorization': 'Bearer ' + KEY,
                                                        'Content-Type': 'application/json'})
    for attempt in range(1, 4):
        try:
            body = json.loads(urllib.request.urlopen(req, timeout=240).read().decode())
            raw = base64.b64decode(body['data'][0]['b64_json'])
            from PIL import Image
            im = Image.open(io.BytesIO(raw)).convert('RGB')
            w, h = im.size
            t = 1024  # keep tall detail for a full figure
            if max(w, h) > t:
                im = im.resize((round(w * t / h), t) if h >= w else (t, round(h * t / w)), Image.LANCZOS)
            dest = os.path.join(OUT, f'hero_{realm}_full.jpg')
            im.save(dest, 'JPEG', quality=90, optimize=True)
            return {'realm': realm, 'ok': True, 'size': im.size, 'bytes': os.path.getsize(dest)}
        except urllib.error.HTTPError as e:
            msg = e.read().decode('utf-8', 'replace')[:200]
            if e.code in (400, 401, 403):
                return {'realm': realm, 'ok': False, 'fatal': e.code, 'err': msg}
            time.sleep(2 * attempt)
        except Exception as e:
            time.sleep(2 * attempt)
    return {'realm': realm, 'ok': False, 'err': 'retries exhausted'}


def main():
    os.makedirs(OUT, exist_ok=True)
    realms = sys.argv[1:] or list(PROMPTS)
    done = 0
    for r in realms:
        res = gen(r, PROMPTS[r])
        print(json.dumps(res), flush=True)
        if res.get('ok'):
            done += 1
    with open(LEDGER, 'a', encoding='utf-8') as f:
        f.write(json.dumps({'ts': time.strftime('%Y-%m-%dT%H:%M:%S'), 'date': time.strftime('%Y-%m-%d'),
                            'api': 'xai_image', 'n': done, 'cost': round(0.02 * done, 4),
                            'note': 'arcane-realms full-body hero art'}) + '\n')
    print(f'DONE {done}/{len(realms)}', flush=True)


if __name__ == '__main__':
    main()
