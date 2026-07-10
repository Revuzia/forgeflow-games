#!/usr/bin/env python3
"""gen_char_tpose_art.py — xAI T-pose reference art for the 4 Dungeon Forge classes.

A clean front-facing T-POSE with fingers held together feeds Meshy image-to-3D so
the auto-rig gets a neutral skeleton (no shrug on retarget) and relaxed hands (no
splayed claw). ~$0.02/image. Output → assets/chars/_tpose_src/<class>_tpose.jpg,
which meshy_chars_img.py then turns into rigged, animated GLBs.
"""
import base64, io, json, os, sys, time, urllib.request, urllib.error

CFG = r'C:\Users\TestRun\AppData\Roaming\Nomi\api_config.json'
LEDGER = r'C:\Users\TestRun\Claude Claw\state\usage\xai_image.jsonl'
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'chars', '_tpose_src')
_c = json.load(open(CFG, encoding='utf-8'))
KEY = (_c.get('xai') or _c.get('providers', {}).get('xai'))['api_key']

# Strict T-pose + fingers-together is what makes the rig + hands come out clean.
COMMON = ("full-body video-game character reference sheet, entire figure from head to feet "
          "clearly visible, standing in a strict symmetrical T-POSE with BOTH ARMS extended "
          "straight out horizontally to the sides at shoulder height, hands open with fingers "
          "straight and held TOGETHER (fingers NOT spread apart), palms facing down, legs "
          "straight and slightly apart, feet flat on the ground, facing directly forward, "
          "perfectly symmetrical and centered, nothing held in the hands, isolated on a plain "
          "flat dark charcoal background, stylized fantasy game art, hand-painted textures, "
          "clean even studio lighting, ultra detailed, no text, no border, no watermark")

PROMPTS = {
    'knight':    ("A stylized fantasy dungeon knight in polished silver plate armor with gold trim "
                  "and a flowing deep-red cape, a knightly helm topped with a bright red crest plume. " + COMMON),
    'barbarian': ("A stylized muscular barbarian warrior, bare-chested with brown fur pauldrons, "
                  "leather cross straps and a fur kilt, braided brown beard and hair, fur boots. " + COMMON),
    'sorceress': ("A stylized fantasy sorceress wearing a TALL WIDE-BRIMMED POINTED PURPLE WITCH HAT "
                  "(a witch hat, NOT a hood), long hair visible beneath the hat, an elegant violet and "
                  "deep-purple robe with glowing arcane trim, dark leggings and heeled boots. " + COMMON),
    'rogue':     ("A stylized fantasy rogue in a dark forest-green hooded leather cloak, light leather "
                  "armor with belts, face half in shadow under the hood, brown boots. " + COMMON),
}


def gen(name, prompt):
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
            t = 1024
            if max(w, h) > t:
                im = im.resize((round(w * t / h), t) if h >= w else (t, round(h * t / w)), Image.LANCZOS)
            dest = os.path.join(OUT, f'{name}_tpose.jpg')
            im.save(dest, 'JPEG', quality=90, optimize=True)
            return {'class': name, 'ok': True, 'size': im.size, 'bytes': os.path.getsize(dest)}
        except urllib.error.HTTPError as e:
            msg = e.read().decode('utf-8', 'replace')[:200]
            if e.code in (400, 401, 403):
                return {'class': name, 'ok': False, 'fatal': e.code, 'err': msg}
            time.sleep(2 * attempt)
        except Exception as e:
            time.sleep(2 * attempt)
    return {'class': name, 'ok': False, 'err': 'retries exhausted'}


def main():
    os.makedirs(OUT, exist_ok=True)
    names = sys.argv[1:] or list(PROMPTS)
    done = 0
    for n in names:
        res = gen(n, PROMPTS[n])
        print(json.dumps(res), flush=True)
        if res.get('ok'):
            done += 1
    with open(LEDGER, 'a', encoding='utf-8') as f:
        f.write(json.dumps({'ts': time.strftime('%Y-%m-%dT%H:%M:%S'), 'date': time.strftime('%Y-%m-%d'),
                            'api': 'xai_image', 'n': done, 'cost': round(0.02 * done, 4),
                            'note': 'dungeon-forge T-pose character reference art'}) + '\n')
    print(f'DONE {done}/{len(names)} -> {os.path.abspath(OUT)}', flush=True)


if __name__ == '__main__':
    main()
