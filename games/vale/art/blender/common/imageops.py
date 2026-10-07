"""numpy image helpers that run inside Blender's own Python (no Pillow on Windows builds).

Arrays are float32 (H, W, 4), rows TOP-DOWN, values in display space (0..1) as saved PNGs are.
I/O goes through bpy.data.images, so PNG/JPEG decoding uses Blender's own codecs.
Denoising uses ffmpeg (`nlmeans`) when it is on PATH; otherwise renders are left as they are.
"""
from __future__ import annotations

import os
import shutil
import subprocess

import bpy
import numpy as np

from . import scene


def load(path: str) -> np.ndarray:
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = "Non-Color"            # raw display values, no conversion
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)[::-1].copy()


def save(arr: np.ndarray, path: str, fmt: str = "PNG", quality: int = 92, alpha: bool = True) -> str:
    scene.ensure_dir(os.path.dirname(path))
    h, w = arr.shape[:2]
    if arr.shape[2] == 3:
        arr = np.concatenate([arr, np.ones((h, w, 1), np.float32)], axis=2)
    img = bpy.data.images.new("_io", w, h, alpha=alpha, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(np.clip(arr[::-1], 0, 1).astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = fmt
    img.alpha_mode = "STRAIGHT"
    sc = bpy.context.scene
    st = sc.render.image_settings
    old = (st.file_format, st.color_mode, st.quality, st.compression)
    st.file_format = fmt
    st.color_mode = "RGBA" if (alpha and fmt == "PNG") else "RGB"
    st.quality = quality
    st.compression = 90
    img.save(filepath=path, quality=quality)
    st.file_format, st.color_mode, st.quality, st.compression = old
    bpy.data.images.remove(img)
    return path


def resize(arr: np.ndarray, w: int, h: int) -> np.ndarray:
    """Area-average downscale (integer factors) or bilinear resize."""
    H, W = arr.shape[:2]
    if W % w == 0 and H % h == 0 and W >= w:
        fx, fy = W // w, H // h
        return arr.reshape(h, fy, w, fx, arr.shape[2]).mean(axis=(1, 3))
    ys = np.linspace(0, H - 1, h)
    xs = np.linspace(0, W - 1, w)
    y0 = np.floor(ys).astype(int)
    x0 = np.floor(xs).astype(int)
    y1 = np.minimum(y0 + 1, H - 1)
    x1 = np.minimum(x0 + 1, W - 1)
    fy = (ys - y0)[:, None, None]
    fx = (xs - x0)[None, :, None]
    a = arr[y0][:, x0] * (1 - fx) + arr[y0][:, x1] * fx
    b = arr[y1][:, x0] * (1 - fx) + arr[y1][:, x1] * fx
    return a * (1 - fy) + b * fy


def premul_resize(arr: np.ndarray, w: int, h: int) -> np.ndarray:
    """Resize RGBA without dark fringes (premultiply, resize, un-premultiply)."""
    a = arr[..., 3:4]
    pm = np.concatenate([arr[..., :3] * a, a], axis=2)
    r = resize(pm, w, h)
    al = np.maximum(r[..., 3:4], 1e-6)
    return np.concatenate([np.where(r[..., 3:4] > 1e-6, r[..., :3] / al, 0), r[..., 3:4]], axis=2)


def over(fg: np.ndarray, bg: np.ndarray) -> np.ndarray:
    a = fg[..., 3:4]
    rgb = fg[..., :3] * a + bg[..., :3] * (1 - a)
    return np.concatenate([rgb, np.ones_like(a)], axis=2)


def value_noise(w: int, h: int, cells: int, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    g = rng.random((cells + 1, cells + 1)).astype(np.float32)
    ys = np.linspace(0, cells, h, dtype=np.float32)
    xs = np.linspace(0, cells, w, dtype=np.float32)
    y0 = np.minimum(np.floor(ys).astype(int), cells - 1)
    x0 = np.minimum(np.floor(xs).astype(int), cells - 1)
    fy = ys - y0
    fx = xs - x0
    fy = (fy * fy * (3 - 2 * fy))[:, None]
    fx = (fx * fx * (3 - 2 * fx))[None, :]
    a = g[y0][:, x0] * (1 - fx) + g[y0][:, x0 + 1] * fx
    b = g[y0 + 1][:, x0] * (1 - fx) + g[y0 + 1][:, x0 + 1] * fx
    return a * (1 - fy) + b * fy


def painted_backdrop(w: int, h: int, primary: str, secondary: str, seed: int = 7, glow=(0.5, 0.42),
                     glow_size: float = 0.55) -> np.ndarray:
    """Painted gradient backdrop from the fighter's card palette: dark vignette of `primary`,
    a soft `secondary` glow behind the subject, low-frequency brush blotches and a fine canvas tooth."""
    p = np.array(scene.hex_srgb(primary), np.float32)
    s = np.array(scene.hex_srgb(secondary), np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    nx, ny = xx / w, yy / h
    asp = w / h
    d = np.sqrt(((nx - glow[0]) * asp) ** 2 + (ny - glow[1]) ** 2)
    base = p[None, None, :] * (1.15 - 0.75 * np.clip(d / 1.1, 0, 1) ** 1.3)[..., None]
    g = np.exp(-(d / glow_size) ** 2 * 2.2)[..., None]
    col = base * (1 - 0.55 * g) + (s * 0.85 + p * 0.25)[None, None, :] * 0.55 * g
    blot = value_noise(w, h, 5, seed) * 0.6 + value_noise(w, h, 13, seed + 1) * 0.4
    strokes = value_noise(w, h // 4 + 1, 9, seed + 2)
    strokes = resize(strokes[..., None], w, h)[..., 0]
    col = col * (0.88 + 0.22 * blot[..., None]) * (0.95 + 0.08 * strokes[..., None])
    tooth = value_noise(w, h, max(8, w // 6), seed + 3)
    col = col * (0.97 + 0.05 * tooth[..., None])
    vig = 1 - 0.35 * np.clip((np.sqrt(((nx - 0.5) * asp) ** 2 + (ny - 0.5) ** 2) - 0.35) / 0.6, 0, 1) ** 1.5
    col = col * vig[..., None]
    return np.concatenate([np.clip(col, 0, 1), np.ones((h, w, 1), np.float32)], axis=2)


def ffmpeg() -> str | None:
    return shutil.which("ffmpeg") or shutil.which("ffmpeg.exe")


def denoise(path: str, strength: float = 2.5) -> bool:
    """In-place ffmpeg nlmeans on RGB; the original alpha is kept. Returns False without ffmpeg."""
    ff = ffmpeg()
    if not ff:
        scene.log("denoise: ffmpeg not found - render kept as is (raise samples instead)")
        return False
    tmp = path + ".dn.png"
    r = subprocess.run([ff, "-y", "-loglevel", "error", "-i", path, "-vf",
                        f"format=gbrp,nlmeans=s={strength}:p=7:r=15,format=rgb24", tmp], capture_output=True)
    if r.returncode != 0 or not os.path.isfile(tmp):
        scene.log(f"denoise failed: {r.stderr[-300:]}")
        return False
    src = load(path)
    dn = load(tmp)
    os.remove(tmp)
    dn[..., 3] = src[..., 3]
    save(dn, path)
    return True


def label(path: str, texts: list) -> bool:
    """Draw small labels [(x, y, text)] with ffmpeg drawtext (skipped when unavailable)."""
    ff = ffmpeg()
    if not ff or not texts:
        return False
    def esc(t):
        return t.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’")
    chain = ",".join(f"drawtext=text='{esc(t)}':x={x}:y={y}:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=4"
                     for x, y, t in texts)
    tmp = path + ".lb.png"
    r = subprocess.run([ff, "-y", "-loglevel", "error", "-i", path, "-vf", chain, tmp], capture_output=True)
    if r.returncode == 0 and os.path.isfile(tmp):
        os.replace(tmp, path)
        return True
    return False


def grid(cells: list, cols: int, pad: int = 4, bg=(0.11, 0.12, 0.14)) -> np.ndarray:
    h, w = cells[0].shape[:2]
    rows = (len(cells) + cols - 1) // cols
    out = np.ones((rows * h + (rows + 1) * pad, cols * w + (cols + 1) * pad, 4), np.float32)
    out[..., :3] = np.array(bg, np.float32)
    for i, c in enumerate(cells):
        r, k = divmod(i, cols)
        y, x = pad + r * (h + pad), pad + k * (w + pad)
        out[y:y + h, x:x + w] = over(c, out[y:y + h, x:x + w]) if c.shape[2] == 4 else c
    return out
