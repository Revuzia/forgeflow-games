"""VALE grade library (pure numpy; runs in plain python3 and inside Blender's Python).

The game's post order (STYLE_BIBLE "Grade", tokens.json grade.passOrder):
    linear HDR -> N8AO -> bloom -> Khronos PBR Neutral tone map (exposure 1.0) -> sRGB encode
    -> LUT3D vale_grade_01 (33³, display-referred sRGB in, sRGB out) -> vignette -> overlay -> SMAA

This module holds every piece the art lane needs to reproduce that chain offline:
    neutral_tonemap(linear)            Khronos PBR Neutral (the exact reference GLSL, vectorised)
    srgb_encode / srgb_decode          IEC 61966-2-1 transfer
    grade_fn(rgb, spec)                the analytic vale_grade_01 (what make_lut.py samples)
    make_lut(spec, n) / write_cube / read_cube / apply_lut(img, lut, 'trilinear'|'tetrahedral')
    hex_to_rgb, rgb_to_lab, delta_e2000, rgb_to_hsv / hsv_to_rgb, OKLab / OKLCH
    display(linear, lut=None)          linear scene -> tone mapped -> (graded) display sRGB

Arrays are float (..., 3) in [0, 1] unless noted. No Pillow, no colour libraries.
"""
from __future__ import annotations

import math

import numpy as np

# ── transfer functions ─────────────────────────────────────────────────────────────────────────


def srgb_encode(x):
    x = np.clip(np.asarray(x, dtype=np.float64), 0.0, None)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def srgb_decode(x):
    x = np.asarray(x, dtype=np.float64)
    return np.where(x <= 0.04045, x / 12.92, np.power((x + 0.055) / 1.055, 2.4))


def hex_to_rgb(h: str) -> np.ndarray:
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])


def rgb_to_hex(rgb) -> str:
    r, g, b = (int(round(float(np.clip(c, 0, 1)) * 255)) for c in rgb)
    return f"#{r:02X}{g:02X}{b:02X}"


# ── Khronos PBR Neutral (https://github.com/KhronosGroup/ToneMapping/tree/main/PBR_Neutral) ─────


def neutral_tonemap(color):
    """Khronos PBR Neutral, linear in -> linear display out (three.js NeutralToneMapping)."""
    c = np.array(color, dtype=np.float64, copy=True)
    start_compression = 0.8 - 0.04
    desaturation = 0.15
    x = c.min(axis=-1, keepdims=True)
    offset = np.where(x < 0.08, x - 6.25 * x * x, 0.04)
    c = c - offset
    peak = c.max(axis=-1, keepdims=True)
    d = 1.0 - start_compression
    new_peak = 1.0 - d * d / (peak + d - start_compression)
    comp = c * (new_peak / np.maximum(peak, 1e-9))
    g = 1.0 - 1.0 / (desaturation * (peak - new_peak) + 1.0)
    comp = comp * (1.0 - g) + new_peak * g
    return np.where(peak < start_compression, c, comp)


def display(linear, lut=None, exposure: float = 1.0, method: str = "trilinear"):
    """Scene-linear RGB -> Neutral tone map -> sRGB display (-> vale_grade_01 when `lut`)."""
    d = srgb_encode(np.clip(neutral_tonemap(np.asarray(linear) * exposure), 0, 1))
    if lut is not None:
        d = apply_lut(d, lut, method)
    return np.clip(d, 0, 1)


# ── HSV ──────────────────────────────────────────────────────────────────────────────────────────


def rgb_to_hsv(rgb):
    rgb = np.asarray(rgb, dtype=np.float64)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(-1)
    mn = rgb.min(-1)
    d = mx - mn
    h = np.zeros_like(mx)
    nz = d > 1e-12
    rc = np.where(nz, (mx - r) / np.where(nz, d, 1), 0)
    gc = np.where(nz, (mx - g) / np.where(nz, d, 1), 0)
    bc = np.where(nz, (mx - b) / np.where(nz, d, 1), 0)
    h = np.where(r == mx, bc - gc, np.where(g == mx, 2.0 + rc - bc, 4.0 + gc - rc))
    h = np.where(nz, (h / 6.0) % 1.0, 0.0)
    s = np.where(mx > 1e-12, d / np.where(mx > 1e-12, mx, 1), 0.0)
    return np.stack([h * 360.0, s, mx], -1)


def hsv_to_rgb(hsv):
    hsv = np.asarray(hsv, dtype=np.float64)
    h = (hsv[..., 0] % 360.0) / 60.0
    s, v = hsv[..., 1], hsv[..., 2]
    i = np.floor(h).astype(int) % 6
    f = h - np.floor(h)
    p = v * (1 - s)
    q = v * (1 - s * f)
    t = v * (1 - s * (1 - f))
    choices = [np.stack(c, -1) for c in ((v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q))]
    out = np.zeros(hsv.shape, dtype=np.float64)
    for k in range(6):
        out = np.where((i == k)[..., None], choices[k], out)
    return out


# ── CIELAB / CIEDE2000 (D65, sRGB) ───────────────────────────────────────────────────────────────
_M_RGB_XYZ = np.array([[0.4124564, 0.3575761, 0.1804375],
                       [0.2126729, 0.7151522, 0.0721750],
                       [0.0193339, 0.1191920, 0.9503041]])
_WHITE = np.array([0.95047, 1.0, 1.08883])


def rgb_to_lab(rgb):
    """display sRGB (0..1) -> CIELAB D65."""
    xyz = srgb_decode(np.clip(rgb, 0, 1)) @ _M_RGB_XYZ.T / _WHITE
    f = np.where(xyz > (6 / 29) ** 3, np.cbrt(xyz), xyz / (3 * (6 / 29) ** 2) + 4 / 29)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def lstar(rgb):
    return rgb_to_lab(rgb)[..., 0]


def delta_e2000(lab1, lab2):
    L1, a1, b1 = lab1[..., 0], lab1[..., 1], lab1[..., 2]
    L2, a2, b2 = lab2[..., 0], lab2[..., 1], lab2[..., 2]
    C1, C2 = np.hypot(a1, b1), np.hypot(a2, b2)
    Cb = (C1 + C2) / 2
    G = 0.5 * (1 - np.sqrt(Cb ** 7 / (Cb ** 7 + 25.0 ** 7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p = np.degrees(np.arctan2(b1, a1p)) % 360
    h2p = np.degrees(np.arctan2(b2, a2p)) % 360
    dLp = L2 - L1
    dCp = C2p - C1p
    dhp = h2p - h1p
    dhp = np.where(C1p * C2p == 0, 0, np.where(dhp > 180, dhp - 360, np.where(dhp < -180, dhp + 360, dhp)))
    dHp = 2 * np.sqrt(C1p * C2p) * np.sin(np.radians(dhp / 2))
    Lbp = (L1 + L2) / 2
    Cbp = (C1p + C2p) / 2
    hs = h1p + h2p
    hbp = np.where(C1p * C2p == 0, hs, np.where(np.abs(h1p - h2p) <= 180, hs / 2,
                                                np.where(hs < 360, (hs + 360) / 2, (hs - 360) / 2)))
    T = (1 - 0.17 * np.cos(np.radians(hbp - 30)) + 0.24 * np.cos(np.radians(2 * hbp))
         + 0.32 * np.cos(np.radians(3 * hbp + 6)) - 0.20 * np.cos(np.radians(4 * hbp - 63)))
    dth = 30 * np.exp(-(((hbp - 275) / 25) ** 2))
    Rc = 2 * np.sqrt(Cbp ** 7 / (Cbp ** 7 + 25.0 ** 7))
    Sl = 1 + 0.015 * (Lbp - 50) ** 2 / np.sqrt(20 + (Lbp - 50) ** 2)
    Sc = 1 + 0.045 * Cbp
    Sh = 1 + 0.015 * Cbp * T
    Rt = -np.sin(np.radians(2 * dth)) * Rc
    return np.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh))


# ── OKLab ────────────────────────────────────────────────────────────────────────────────────────


def rgb_to_oklab(rgb):
    lin = srgb_decode(np.clip(rgb, 0, None))
    M1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929],
                   [0.2119034982, 0.6806995451, 0.1073969566],
                   [0.0883024619, 0.2817188376, 0.6299787005]])
    lms = np.cbrt(lin @ M1.T)
    M2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468],
                   [1.9779984951, -2.4285922050, 0.4505937099],
                   [0.0259040371, 0.7827717662, -0.8086757660]])
    return lms @ M2.T


def oklab_to_rgb(lab):
    M2i = np.array([[1.0, 0.3963377774, 0.2158037573],
                    [1.0, -0.1055613458, -0.0638541728],
                    [1.0, -0.0894841775, -1.2914855480]])
    lms = (lab @ M2i.T) ** 3
    M1i = np.array([[4.0767416621, -3.3077115913, 0.2309699292],
                    [-1.2684380046, 2.6097574011, -0.3413193965],
                    [-0.0041960863, -0.7034186147, 1.7076147010]])
    return srgb_encode(np.clip(lms @ M1i.T, 0, None))


# ── the grade ───────────────────────────────────────────────────────────────────────────────────


def _smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _luma(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def _hue_weight(h, lo, hi, feather):
    """1 inside [lo, hi] degrees, smooth falloff over `feather` degrees outside (wraps at 360)."""
    def dist_out(h):
        c = (lo + hi) / 2.0
        half = (hi - lo) / 2.0
        d = np.abs(((h - c + 180.0) % 360.0) - 180.0)
        return np.maximum(0.0, d - half)
    return 1.0 - _smoothstep(0.0, feather, dist_out(h))


def accent_protect(rgb, spec: dict):
    """Weight (0..1) of 'accent-like' pixels: bright AND saturated (emissive readability colours,
    team tints, seat colours at their working brightness). The chroma ops fade out under it so
    accents keep their hue (bible: 'value < 0.85 only, so accents keep their hue')."""
    pr = spec.get("protect", {"value": [0.80, 0.85], "sat": [0.25, 0.40]})
    hsv = rgb_to_hsv(rgb)
    return _smoothstep(pr["value"][0], pr["value"][1], hsv[..., 2]) * _smoothstep(pr["sat"][0], pr["sat"][1], hsv[..., 1])


def grade_fn(rgb, spec: dict):
    """Analytic vale_grade_01 on display sRGB (..., 3) -> display sRGB. `spec` = make_lut.SPEC
    (tokens.json grade.lut.ops + the accent protection the bible text asks for)."""
    x = np.clip(np.asarray(rgb, dtype=np.float64), 0, 1)
    prot = accent_protect(x, spec)          # measured on the input, so a graded accent stays an accent
    for op in spec["ops"]:
        k = op["op"]
        if k == "lift":
            lift = np.array(op["rgb"])
            x = lift + x * (1.0 - lift)
        elif k == "gamma":
            x = np.power(np.clip(x, 0, None), 1.0 / np.array(op["rgb"]))
        elif k == "gain":
            x = x * np.array(op["rgb"])
        elif k == "contrast":
            a, p = op["amount"], op["pivot"]
            if op.get("softToeShoulder", True):
                # S-curve with slope `a` at the pivot that keeps 0 -> 0 and 1 -> 1 (no clipping)
                xc = np.clip(x, 0, 1)
                x = xc + (a - 1.0) * (xc - p) * xc * (1 - xc) / (p * (1 - p))
            else:
                x = p + (x - p) * a
            x = np.clip(x, 0, 1)
        elif k == "satByLuma":
            y = _luma(x)
            f = op.get("featherLuma", 0.05)
            bands = op["bands"]
            # piecewise-constant multiplier with feathered steps between bands
            m = np.full(y.shape, bands[0][2])
            for (lo, hi, kk), nxt in zip(bands[:-1], bands[1:]):
                m = m + (nxt[2] - m) * _smoothstep(hi - f / 2, hi + f / 2, y)
            m = 1.0 + (m - 1.0) * (1.0 - prot)
            x = y[..., None] + (x - y[..., None]) * m[..., None]
        elif k == "hueSat":
            hsv = rgb_to_hsv(np.clip(x, 0, 1))
            mul = np.ones(hsv.shape[:-1])
            for b in op["bands"]:
                w = _hue_weight(hsv[..., 0], b["hue"][0], b["hue"][1], op.get("featherDeg", 8))
                if b.get("onlyIfValueBelow") is not None:
                    vb = b["onlyIfValueBelow"]
                    w = w * (1.0 - _smoothstep(vb - 0.05, vb, hsv[..., 2]))
                w = w * (1.0 - prot)
                mul = mul * (1.0 + (b["sat"] - 1.0) * w)
            hsv[..., 1] = np.clip(hsv[..., 1] * mul, 0, 1)
            x = hsv_to_rgb(hsv)
        elif k == "hueShift":
            hsv = rgb_to_hsv(np.clip(x, 0, 1))
            w = _hue_weight(hsv[..., 0], op["hue"][0], op["hue"][1], op.get("featherDeg", 8)) * (1.0 - prot)
            w = w * _smoothstep(0.02, 0.10, hsv[..., 1])           # greys have no hue to shift
            hsv[..., 0] = (hsv[..., 0] + op["deg"] * w) % 360.0
            x = hsv_to_rgb(hsv)
        elif k == "gamutSoftClip":
            lab = rgb_to_oklab(np.clip(x, 0, 1))
            C = np.hypot(lab[..., 1], lab[..., 2])
            knee, mx = op["kneeChroma"], op["maxChroma"]
            span = mx - knee
            Cn = np.where(C > knee, knee + span * np.tanh((C - knee) / span), C)
            Cn = C + (Cn - C) * (1.0 - prot)
            s = np.where(C > 1e-9, Cn / np.maximum(C, 1e-9), 1.0)
            lab[..., 1] *= s
            lab[..., 2] *= s
            x = oklab_to_rgb(lab)
        else:
            raise ValueError(f"unknown grade op {k!r}")
        x = np.clip(x, 0, 1)
    return x


# ── LUT files ───────────────────────────────────────────────────────────────────────────────────


def lut_grid(n: int):
    """(n, n, n, 3) input grid indexed [b, g, r] (the .cube order: red changes fastest)."""
    v = np.linspace(0.0, 1.0, n)
    b, g, r = np.meshgrid(v, v, v, indexing="ij")
    return np.stack([r, g, b], -1)


def make_lut(spec: dict, n: int = 33):
    return grade_fn(lut_grid(n), spec)


def write_cube(path: str, lut, title: str, comments=()) -> None:
    n = lut.shape[0]
    with open(path, "w", encoding="ascii", newline="\n") as f:
        for c in comments:
            f.write(f"# {c}\n")
        f.write(f'TITLE "{title}"\n')
        f.write(f"LUT_3D_SIZE {n}\n")
        f.write("DOMAIN_MIN 0.0 0.0 0.0\n")
        f.write("DOMAIN_MAX 1.0 1.0 1.0\n")
        for row in lut.reshape(-1, 3):
            f.write(f"{row[0]:.6f} {row[1]:.6f} {row[2]:.6f}\n")


def read_cube(path: str):
    n = None
    data = []
    with open(path, encoding="ascii") as f:
        for line in f:
            t = line.strip()
            if not t or t.startswith("#") or t.startswith("TITLE") or t.startswith("DOMAIN"):
                continue
            if t.startswith("LUT_3D_SIZE"):
                n = int(t.split()[1])
                continue
            data.append([float(v) for v in t.split()])
    return np.array(data, dtype=np.float64).reshape(n, n, n, 3)


def apply_lut(img, lut, method: str = "trilinear"):
    """Apply a [b, g, r]-indexed LUT to display sRGB (..., 3)."""
    n = lut.shape[0]
    x = np.clip(np.asarray(img, dtype=np.float64), 0, 1) * (n - 1)
    i0 = np.minimum(np.floor(x).astype(int), n - 2)
    f = x - i0
    r0, g0, b0 = i0[..., 0], i0[..., 1], i0[..., 2]
    fr, fg, fb = f[..., 0:1], f[..., 1:2], f[..., 2:3]

    def L(dr, dg, db):
        return lut[b0 + db, g0 + dg, r0 + dr]

    if method == "trilinear":
        c00 = L(0, 0, 0) * (1 - fr) + L(1, 0, 0) * fr
        c10 = L(0, 1, 0) * (1 - fr) + L(1, 1, 0) * fr
        c01 = L(0, 0, 1) * (1 - fr) + L(1, 0, 1) * fr
        c11 = L(0, 1, 1) * (1 - fr) + L(1, 1, 1) * fr
        c0 = c00 * (1 - fg) + c10 * fg
        c1 = c01 * (1 - fg) + c11 * fg
        return c0 * (1 - fb) + c1 * fb
    # tetrahedral (what LUT3DEffect uses on high/ultra)
    c000, c111 = L(0, 0, 0), L(1, 1, 1)
    out = np.zeros(x.shape)
    fr1, fg1, fb1 = fr[..., 0], fg[..., 0], fb[..., 0]
    cases = [
        ((fr1 >= fg1) & (fg1 >= fb1), (1, 0, 0), (1, 1, 0), fr, fg, fb),
        ((fr1 >= fb1) & (fb1 > fg1), (1, 0, 0), (1, 0, 1), fr, fb, fg),
        ((fb1 > fr1) & (fr1 >= fg1), (0, 0, 1), (1, 0, 1), fb, fr, fg),
        ((fg1 > fr1) & (fr1 >= fb1), (0, 1, 0), (1, 1, 0), fg, fr, fb),
        ((fg1 >= fb1) & (fb1 > fr1), (0, 1, 0), (0, 1, 1), fg, fb, fr),
        ((fb1 > fg1) & (fg1 > fr1), (0, 0, 1), (0, 1, 1), fb, fg, fr),
    ]
    done = np.zeros(fr1.shape, bool)
    for m, a, b, t1, t2, t3 in cases:
        m = m & ~done
        ca, cb = L(*a), L(*b)
        v = c000 * (1 - t1) + ca * (t1 - t2) + cb * (t2 - t3) + c111 * t3
        out = np.where(m[..., None], v, out)
        done |= m
    return out


# ── minimal PNG I/O (zlib only; Blender's Windows Python ships without Pillow) ────────────────────
def save_png(path: str, img) -> str:
    import struct
    import zlib
    a = np.clip(np.asarray(img, dtype=np.float64), 0, 1)
    if a.ndim == 2:
        a = np.repeat(a[..., None], 3, -1)
    h, w, c = a.shape
    data = (a * 255 + 0.5).astype(np.uint8)
    raw = b"".join(b"\x00" + data[y].tobytes() for y in range(h))

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    ct = {3: 2, 4: 6}[c]
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, ct, 0, 0, 0)) + \
        chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    return path


def load_png(path: str):
    """8-bit, non-interlaced PNG (grey, RGB, RGBA) -> float (H, W, C) in 0..1, rows top-down.
    Uses Pillow when present (fast); the pure-python fallback is slow for big Paeth-filtered files."""
    try:
        from PIL import Image
        return np.asarray(Image.open(path)).astype(np.float64) / 255.0
    except ImportError:
        pass
    import struct
    import zlib
    with open(path, "rb") as f:
        b = f.read()
    assert b[:8] == b"\x89PNG\r\n\x1a\n", path
    pos, idat = 8, b""
    while pos < len(b):
        n, t = struct.unpack(">I4s", b[pos:pos + 8])
        d = b[pos + 8:pos + 8 + n]
        if t == b"IHDR":
            w, h, depth, ct, _, _, inter = struct.unpack(">IIBBBBB", d)
        elif t == b"IDAT":
            idat += d
        pos += 12 + n
    assert depth == 8 and inter == 0, f"{path}: only 8-bit non-interlaced PNG"
    c = {0: 1, 2: 3, 4: 2, 6: 4}[ct]
    raw = np.frombuffer(zlib.decompress(idat), np.uint8)
    stride = w * c
    out = np.zeros((h, stride), np.int32)
    prev = np.zeros(stride, np.int32)
    for y in range(h):
        ft = raw[y * (stride + 1)]
        line = raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)].astype(np.int32)
        if ft == 0:
            cur = line
        elif ft == 2:
            cur = (line + prev) & 255
        else:
            cur = np.zeros(stride, np.int32)
            for i in range(stride):
                left = cur[i - c] if i >= c else 0
                up = prev[i]
                ul = prev[i - c] if i >= c else 0
                if ft == 1:
                    v = left
                elif ft == 3:
                    v = (left + up) >> 1
                else:
                    p = left + up - ul
                    pa, pb, pc = abs(p - left), abs(p - up), abs(p - ul)
                    v = left if (pa <= pb and pa <= pc) else (up if pb <= pc else ul)
                cur[i] = (line[i] + v) & 255
        out[y] = cur
        prev = cur
    return out.reshape(h, w, c).astype(np.float64) / 255.0
