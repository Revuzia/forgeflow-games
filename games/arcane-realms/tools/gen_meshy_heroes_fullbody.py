#!/usr/bin/env python3
"""Full-body hero 3D pipeline: assets/heroes/src/hero_{realm}_full.jpg
-> Meshy image-to-3d -> raw GLB (state/meshy_raw) -> gltf-transform optimize
-> assets/heroes/hero_{realm}.glb. Heroes are prominent, so optimize gentler
than minis (1024 tex, simplify 0.2). Reports exact credit spend + ledgers."""
import base64, json, os, subprocess, sys, time, urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(HERE, 'assets', 'heroes', 'src')
OUT = os.path.join(HERE, 'assets', 'heroes')
RAW = r'C:\Users\TestRun\Claude Claw\state\meshy_raw\arcane-realms'
LEDGER = r'C:\Users\TestRun\Claude Claw\state\usage\meshy_3d.jsonl'
API = 'https://api.meshy.ai/openapi/v1'
CFG = r'C:\Users\TestRun\AppData\Roaming\Nomi\api_config.json'
KEY = json.load(open(CFG, encoding='utf-8'))['meshy']['api_key']
HDR = {'Authorization': 'Bearer ' + KEY}


def req(method, url, body=None, tries=6):
    data = json.dumps(body).encode() if body is not None else None
    h = dict(HDR)
    if data:
        h['Content-Type'] = 'application/json'
    last = None
    for a in range(1, tries + 1):
        try:
            r = urllib.request.Request(url, data=data, headers=h, method=method)
            with urllib.request.urlopen(r, timeout=90) as resp:
                return json.load(resp)
        except Exception as e:
            last = e
            time.sleep(2 * a)
    raise last


def download(url, dest, tries=6):
    for a in range(1, tries + 1):
        try:
            r = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(r, timeout=180) as resp, open(dest, 'wb') as f:
                f.write(resp.read())
            return os.path.getsize(dest)
        except Exception:
            time.sleep(3 * a)
    return 0


def optimize(raw_path, out_path):
    # gentler than minis: keep face/silhouette detail on a full figure
    cmd = ['npx', '@gltf-transform/cli@latest', 'optimize', raw_path, out_path,
           '--compress', 'quantize', '--texture-size', '1024',
           '--texture-compress', 'webp', '--weld', 'true',
           '--simplify', 'true', '--simplify-ratio', '0.2', '--simplify-error', '0.004']
    p = subprocess.run(cmd, capture_output=True, text=True, shell=True, timeout=300)
    return p.returncode == 0 and os.path.exists(out_path)


def main():
    realms = sys.argv[1:] or ['ember', 'tide', 'grove', 'dawn', 'grave', 'neutral']
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(RAW, exist_ok=True)
    bal0 = req('GET', f'{API}/balance')['balance']
    print(f'[balance] before = {bal0}', flush=True)
    results = {}
    for realm in realms:
        src = os.path.join(SRC, f'hero_{realm}_full.jpg')
        if not os.path.exists(src):
            results[realm] = {'status': 'NO_SRC'}
            print(f'[{realm}] missing src {src}', flush=True)
            continue
        b64 = base64.b64encode(open(src, 'rb').read()).decode()
        body = {'image_url': f'data:image/jpeg;base64,{b64}', 'ai_model': 'meshy-6',
                'should_texture': True, 'enable_pbr': False, 'topology': 'triangle',
                'target_polycount': 30000}
        ok = False
        for attempt in range(1, 4):
            tid = req('POST', f'{API}/image-to-3d', body)['result']
            print(f'[{realm}] attempt {attempt} -> {tid}', flush=True)
            t0, task = time.time(), None
            while time.time() - t0 < 600:
                task = req('GET', f'{API}/image-to-3d/{tid}')
                if task['status'] in ('SUCCEEDED', 'FAILED', 'CANCELED'):
                    break
                time.sleep(8)
            if task and task['status'] == 'SUCCEEDED':
                url = task.get('model_urls', {}).get('glb')
                raw_dest = os.path.join(RAW, f'hero_{realm}_full.glb')
                sz = download(url, raw_dest)
                print(f'[{realm}] raw {sz} bytes -> optimizing', flush=True)
                out_dest = os.path.join(OUT, f'hero_{realm}.glb')
                if optimize(raw_dest, out_dest):
                    osz = os.path.getsize(out_dest)
                    results[realm] = {'status': 'SUCCEEDED', 'raw': sz, 'opt': osz}
                    print(f'[{realm}] OPT {osz} bytes  ({osz/1e6:.2f} MB)', flush=True)
                    ok = True
                else:
                    results[realm] = {'status': 'OPT_FAILED', 'raw': sz}
                    print(f'[{realm}] optimize FAILED (raw kept)', flush=True)
                    ok = True  # don't burn more credits; raw exists
                break
            print(f'[{realm}] {task and task["status"]}, retry (free)...', flush=True)
        if not ok:
            results[realm] = {'status': 'GAVE_UP'}
    bal1 = req('GET', f'{API}/balance')['balance']
    good = [r for r, v in results.items() if v['status'] == 'SUCCEEDED']
    print(f'\n===== SUMMARY =====\nok {len(good)}/{len(realms)}: {", ".join(good)}', flush=True)
    print(f'[balance] after = {bal1}  SPENT = {bal0 - bal1}', flush=True)
    with open(LEDGER, 'a', encoding='utf-8') as f:
        f.write(json.dumps({'ts': time.strftime('%Y-%m-%dT%H:%M:%S'), 'game': 'arcane-realms',
                            'batch': 'heroes-fullbody', 'realms': realms, 'results': results,
                            'balance_before': bal0, 'balance_after': bal1,
                            'credits_spent': bal0 - bal1}) + '\n')
    print('DONE', flush=True)


if __name__ == '__main__':
    main()
