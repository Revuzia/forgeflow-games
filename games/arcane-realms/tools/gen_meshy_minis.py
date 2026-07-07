#!/usr/bin/env python3
"""Generate 3D minis for Arcane Realms cards via Meshy Image-to-3D (meshy-6, textured).

Reads card art from assets/art/{id}.jpg, submits all tasks, polls to completion,
downloads GLBs to assets/minis/mini_{id}.glb, and reports EXACT credit spend by
diffing the account balance before/after. Retries within a task are free on the
Premium plan, so failures are auto-re-rolled up to RETRY_MAX times.

Usage: python tools/gen_meshy_minis.py id1 id2 id3 ...
"""
import base64, json, os, sys, time, urllib.request, urllib.error

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(HERE, 'assets', 'art')
OUT = os.path.join(HERE, 'assets', 'minis')
LEDGER = r'C:\Users\TestRun\Claude Claw\state\usage\meshy_3d.jsonl'
API = 'https://api.meshy.ai/openapi/v1'
CFG = r'C:\Users\TestRun\AppData\Roaming\Nomi\api_config.json'
RETRY_MAX = 3        # free re-rolls on a FAILED task before giving up
POLL_EVERY = 8       # seconds
POLL_TIMEOUT = 600   # seconds per task

KEY = json.load(open(CFG, encoding='utf-8'))['meshy']['api_key']
HDR = {'Authorization': 'Bearer ' + KEY}


def req(method, url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    h = dict(HDR)
    if data:
        h['Content-Type'] = 'application/json'
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    with urllib.request.urlopen(r, timeout=60) as resp:
        return json.load(resp)


def balance():
    return req('GET', f'{API}/balance')['balance']


def submit(card_id):
    p = os.path.join(ART, f'{card_id}.jpg')
    b64 = base64.b64encode(open(p, 'rb').read()).decode()
    body = {
        'image_url': f'data:image/jpeg;base64,{b64}',
        'ai_model': 'meshy-6',
        'should_texture': True,
        'enable_pbr': False,
        'topology': 'triangle',
        'target_polycount': 24000,
    }
    return req('POST', f'{API}/image-to-3d', body)['result']


def poll(task_id):
    t0 = time.time()
    while time.time() - t0 < POLL_TIMEOUT:
        task = req('GET', f'{API}/image-to-3d/{task_id}')
        st = task['status']
        if st in ('SUCCEEDED', 'FAILED', 'CANCELED'):
            return task
        time.sleep(POLL_EVERY)
    return {'status': 'TIMEOUT'}


def download(url, dest):
    r = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(r, timeout=120) as resp, open(dest, 'wb') as f:
        f.write(resp.read())
    return os.path.getsize(dest)


def ledger(row):
    os.makedirs(os.path.dirname(LEDGER), exist_ok=True)
    with open(LEDGER, 'a', encoding='utf-8') as f:
        f.write(json.dumps(row) + '\n')


def main():
    ids = sys.argv[1:]
    if not ids:
        print('usage: gen_meshy_minis.py id1 id2 ...'); sys.exit(1)
    os.makedirs(OUT, exist_ok=True)

    bal_before = balance()
    print(f'[balance] before = {bal_before} credits', flush=True)

    results = {}
    for cid in ids:
        attempt = 0
        while attempt <= RETRY_MAX:
            attempt += 1
            tid = submit(cid)
            print(f'[{cid}] submitted attempt {attempt} -> {tid}', flush=True)
            task = poll(tid)
            st = task['status']
            print(f'[{cid}] {st}', flush=True)
            if st == 'SUCCEEDED':
                glb = task.get('model_urls', {}).get('glb')
                dest = os.path.join(OUT, f'mini_{cid}.glb')
                size = download(glb, dest) if glb else 0
                results[cid] = {'status': 'SUCCEEDED', 'task_id': tid,
                                'glb_bytes': size, 'attempts': attempt}
                print(f'[{cid}] downloaded {size} bytes -> mini_{cid}.glb', flush=True)
                break
            else:
                print(f'[{cid}] retrying (free)...', flush=True)
        else:
            results[cid] = {'status': 'GAVE_UP', 'attempts': attempt}

    bal_after = balance()
    spent = bal_before - bal_after
    ok = [c for c, r in results.items() if r['status'] == 'SUCCEEDED']
    print('\n===== SUMMARY =====', flush=True)
    print(f'succeeded: {len(ok)}/{len(ids)}  ->  {", ".join(ok)}', flush=True)
    print(f'[balance] after = {bal_after} credits', flush=True)
    print(f'TOTAL CREDITS SPENT = {spent}  (avg {spent/max(len(ok),1):.1f}/model)', flush=True)

    ledger({'ts': time.strftime('%Y-%m-%dT%H:%M:%S'), 'game': 'arcane-realms',
            'batch': ids, 'results': results,
            'balance_before': bal_before, 'balance_after': bal_after,
            'credits_spent': spent})
    print(f'[ledger] appended to {LEDGER}', flush=True)


if __name__ == '__main__':
    main()
