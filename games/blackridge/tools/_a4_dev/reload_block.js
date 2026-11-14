  // --- keyframe evaluator ------------------------------------------------------
  // keys: [{ t, P:Vector3, Q:Quaternion }] sorted by t; smoothstep between keys.
  function evalKeys(keys, t, outP, outQ) {
    if (t <= keys[0].t) { outP.copy(keys[0].P); outQ.copy(keys[0].Q); return; }
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (t <= b.t) {
        const s = smoothstep((t - a.t) / Math.max(1e-6, b.t - a.t));
        outP.copy(a.P).lerp(b.P, s);
        outQ.copy(a.Q).slerp(b.Q, s);
        return;
      }
    }
    const l = keys[keys.length - 1];
    outP.copy(l.P); outQ.copy(l.Q);
  }
  const keyPool = [];
  function key(i, t, P, Q) {
    let k = keyPool[i];
    if (!k) { k = keyPool[i] = { t: 0, P: new THREE.Vector3(), Q: new THREE.Quaternion() }; }
    k.t = t; k.P.copy(P); k.Q.copy(Q);
    return k;
  }

  // Key hand poses for a weapon: authored in view.anim.hand (build frame), with generic
  // defaults derived from the magazine's own bounds so every weapon animates sensibly
  // out of the box and view.anim only has to correct what the eye disagrees with.
  const _handCache = new Map();
  function handKeys(group, anim, kind) {
    const id = group.userData.weaponId;
    const ck = id + ":" + kind;
    let c = _handCache.get(ck);
    if (c) return c;
    const parts = group.userData.parts || {};
    const H = anim.hand || {};
    const mag = parts.mag;
    // build-frame centre/size of the magazine (glTF (x,y,z) -> build (x,-z,y))
    const mc = mag ? [mag.center.x, -mag.center.z, mag.center.y] : [0, 0.12, -0.07];
    const ms = mag ? [mag.size.x, mag.size.z, mag.size.y] : [0.03, 0.08, 0.10];
    const bot = mc[2] - ms[2] / 2;
    const slide = anim.magDrop;
    const mk = (o) => ({ p: new THREE.Vector3(), q: new THREE.Quaternion(), pose: o });
    const defs = {
      mag: H.mag || { palm: [mc[0] - (ms[0] / 2 + 0.018), mc[1], mc[2] - 0.01],
                      fingers: [0.15, 1, 0.25], dir: [1, 0, 0] },
      pouch: H.pouch || { palm: [mc[0] - 0.12, mc[1] - 0.04, mc[2] - 0.20],
                          fingers: [0.35, 1, 0.55], dir: [0.55, 0, 1] },
      rack: H.rack || { palm: [0.0, -0.065, mc[2] + ms[2] / 2 + 0.07], fingers: [0.0, 1, 0.1], dir: [0, 0, -1] },
      port: H.port || { palm: [mc[0] - 0.01, mc[1], mc[2] - 0.02], fingers: [0.3, 1, 0.1], dir: [0, 0, 1] },
    };
    c = {};
    for (const k of Object.keys(defs)) {
      c[k] = mk(defs[k]);
      handPose(defs[k], c[k].p, c[k].q);
    }
    // the magazine pulled out: the same grip, `slide` lower
    const out = JSON.parse(JSON.stringify(defs.mag));
    out.palm[2] -= slide;
    c.magOut = mk(out);
    handPose(out, c.magOut.p, c.magOut.q);
    // the new magazine just below the well, before it is pushed home
    const below = JSON.parse(JSON.stringify(defs.mag));
    below.palm[2] -= slide * 0.75;
    c.magBelow = mk(below);
    handPose(below, c.magBelow.p, c.magBelow.q);
    // where the magazine's centre sits relative to the palm while it is held
    c.holdOff = new THREE.Vector3(mag ? mag.center.x : 0, mag ? mag.center.y : -0.07, mag ? mag.center.z : -0.12);
    const pm = palmOf(c.mag.p, c.mag.q, new THREE.Vector3());
    c.holdOff.sub(pm);
    c.drop = slide;
    _handCache.set(ck, c);
    return c;
  }
  function dropHandCache(id) { for (const k of [..._handCache.keys()]) if (k.startsWith(id + ":")) _handCache.delete(k); }

  // --- magazine reload (rifles, DMR, and the in-grip magazines of pistol/SMG) -------
  const _palm = new THREE.Vector3();
  function reloadMag(group, w, anim, parts, p, rw, kind) {
    const armL = parts.armL, mag = parts.mag;
    const C = handKeys(group, anim, kind);
    const empty = reloadEmpty;
    const rest = armL.restP, restQ = armL.restQ;
    // timeline (fractions of the sim's reload time; the sim commits at 0.65)
    //   0.00-0.16 hand to the magazine   0.16-0.28 pull it out   0.28-0.44 to the pouch
    //   0.44-0.58 new magazine up        0.58-0.66 push home     (empty) 0.68-0.92 rack
    const ks = [];
    let n = 0;
    ks[n] = key(n, 0.00, rest, restQ); n++;
    ks[n] = key(n, 0.16, C.mag.p, C.mag.q); n++;
    ks[n] = key(n, 0.28, C.magOut.p, C.magOut.q); n++;
    ks[n] = key(n, 0.44, C.pouch.p, C.pouch.q); n++;
    ks[n] = key(n, 0.58, C.magBelow.p, C.magBelow.q); n++;
    ks[n] = key(n, 0.65, C.mag.p, C.mag.q); n++;
    if (empty) {
      ks[n] = key(n, 0.70, C.mag.p, C.mag.q); n++;
      ks[n] = key(n, 0.78, C.rack.p, C.rack.q); n++;
      _p2.copy(C.rack.p); _p2.z += 0.075;            // racking stroke toward the stock
      ks[n] = key(n, 0.85, _p2, C.rack.q); n++;
      ks[n] = key(n, 0.91, C.rack.p, C.rack.q); n++;
      ks[n] = key(n, 1.00, rest, restQ); n++;
    } else {
      ks[n] = key(n, 0.72, C.mag.p, C.mag.q); n++;
      ks[n] = key(n, 0.90, rest, restQ); n++;
      ks[n] = key(n, 1.00, rest, restQ); n++;
    }
    keyPool.length = Math.max(keyPool.length, n);
    const keys = ks.slice(0, n);
    evalKeys(keys, p, _hp, _hq);
    armL.node.position.lerp(_hp, rw);
    armL.node.quaternion.slerp(_hq, rw);

    // gun cant + lift while the hands work
    const cant = ramp(p, 0.0, 0.16) * (1 - ramp(p, empty ? 0.90 : 0.84, 1.0));
    out.rx += anim.tilt[0] * DEG * cant * rw;
    out.ry += anim.tilt[1] * DEG * cant * rw;
    out.rz += anim.tilt[2] * DEG * cant * rw;
    out.py += 0.012 * cant * rw;
    out.pz += 0.02 * cant * rw;
    // seat jolt as the magazine goes home
    if (p > 0.62 && p < 0.70) {
      const j = Math.sin(Math.PI * (p - 0.62) / 0.08);
      out.py -= 0.010 * j * rw; out.rx -= 2.4 * DEG * j * rw;
    }

    // ---- the magazine node ------------------------------------------------------
    if (mag) {
      const mp = mag.node.position;
      mp.copy(mag.restP);
      mag.node.visible = true;
      const held = (p >= 0.16 && p < 0.30) || (p >= 0.44 && p < 0.66);
      if (held) {
        // carried by the hand: centre = palm + holdOff, relative to rest
        palmOf(_hp, _hq, _palm).add(C.holdOff);
        mp.copy(mag.restP).add(_v.copy(_palm).sub(mag.center));
        // hands are blended with weight rw; keep the magazine on the same blend
        mp.lerp(mag.restP, 1 - rw);
      } else if (p >= 0.30 && p < 0.44) {
        // released: falls away under gravity, then is gone
        const tf = (p - 0.30) / 0.14;
        const tt = tf * 0.5;  // seconds-ish
        palmOf(C.magOut.p, C.magOut.q, _palm).add(C.holdOff);
        mp.copy(mag.restP).add(_v.copy(_palm).sub(mag.center));
        mp.x += -0.06 * tf; mp.y += -4.0 * tt * tt * 2.0; mp.z += 0.04 * tf;
        mag.node.visible = tf < 0.62;
      }
    }
  }

  // --- shell-by-shell reload (pump shotgun) --------------------------------------
  function reloadShell(group, w, anim, parts, p, rw, wp, dt) {
    const armL = parts.armL, pump = parts.pump;
    const rl = (w && w.reload) || { startS: 0.55, perShellS: 0.42, endS: 0.35 };
    const dur = (wp && wp._reloadDur) || (w && w.reloadS) || 3.4;
    const tr = (dbg.reloadP != null ? p * dur : (wp && wp.stateT) || p * dur);
    const t = tr - rl.startS;
    const endAt = Math.max(rl.startS + 0.1, dur - rl.endS);
    const C = handKeys(group, anim, "shell");
    const rest = armL.restP, restQ = armL.restQ;

    const tIn = ramp(tr, 0.0, rl.startS);                  // tilt in + hand to the port
    const tOutEnd = ramp(tr, endAt, dur);                  // hand back to the forend
    let towardBand = 0, push = 0;
    if (t > 0 && tr < endAt) {
      const c = (t % rl.perShellS) / rl.perShellS;
      // 0..0.30 at the bandolier -> 0.30..0.62 up to the port -> push 0.62..0.80 -> settle
      towardBand = c < 0.30 ? 1 : 1 - ramp(c, 0.30, 0.62);
      push = c > 0.62 && c < 0.82 ? Math.sin(Math.PI * (c - 0.62) / 0.20) : 0;
    }
    const gunTilt = tIn * (1 - tOutEnd);
    out.rx += anim.tilt[0] * DEG * gunTilt * rw;
    out.ry += anim.tilt[1] * DEG * gunTilt * rw;
    out.rz += anim.tilt[2] * DEG * gunTilt * rw;
    out.py += 0.010 * gunTilt * rw;
    out.pz += 0.025 * gunTilt * rw;

    _hp.copy(rest); _hq.copy(restQ);
    _hp.lerp(C.port.p, tIn); _hq.slerp(C.port.q, tIn);
    if (t > 0 && tr < endAt) {
      _hp.copy(C.port.p).lerp(C.pouch.p, towardBand);
      _hq.copy(C.port.q).slerp(C.pouch.q, towardBand);
      _hp.y += 0.006 * push;           // glTF y = up
      _hp.z -= 0.016 * push;           // glTF -z = toward the muzzle
    }
    if (tOutEnd > 0) { _hp.lerp(rest, tOutEnd); _hq.slerp(restQ, tOutEnd); }
    armL.node.position.lerp(_hp, rw);
    armL.node.quaternion.slerp(_hq, rw);

    // closing rack: forend + hand stroke back and forward during the end phase
    if (pump && tr > endAt) {
      const re = (tr - endAt) / Math.max(1e-3, dur - endAt);
      const stroke = re < 0.5 ? ramp(re, 0, 0.5) : 1 - ramp(re, 0.5, 1.0);
      pump.node.position.z = pump.restP.z + 0.085 * stroke * rw;
      armL.node.position.z += 0.085 * stroke * rw;
    }
    void dt;
  }

