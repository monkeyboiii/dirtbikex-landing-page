"""Verify every blank invite card produced by make_templates.py.

Always checks, for all kinds x locales:
  * dimensions / RGBA preserved
  * sentinel is a single solid square of the expected size
  * the group label is present (track_stewards / holeshot_crew) or absent (plain)
  * a real QR composited into the sentinel decodes back to the exact URL

With --src (the iOS card exports) it additionally checks that alpha is bit-identical
to the source card and that RGB changed only inside the two painted rectangles.

    python scripts/verify_templates.py [--src ~/cards]
    # needs pillow numpy segno opencv-python-headless
"""
from PIL import Image
import argparse
import glob
import numpy as np
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(ROOT)

KINDS = {"track_stewards": True, "holeshot_crew": True, "plain": False}   # expects a label?
LOCALES = ["en", "zh-CN", "zh-TW", "ja", "ko", "de", "it", "fr", "es", "ar", "da", "el",
           "fa-IR", "fi", "id", "nl", "pt", "tr-TR", "th", "vi", "sv"]
URL = "https://www.dirtbikex.com/s/i/zUAZu9wF3U?lang=auto"


def sentinel(rgb):
    m = (rgb[:, :, 0] == 255) & (rgb[:, :, 1] == 0) & (rgb[:, :, 2] == 255)
    ys, xs = np.where(m)
    return xs.min(), ys.min(), xs.max(), ys.max()


def qr_tile(url, size, border=1):
    import segno
    qr = segno.make(url, error='m')                 # ECC 'M' == QRCode.swift
    mat = np.array(qr.matrix, dtype=np.uint8)
    n = mat.shape[0]
    scale = size // (n + 2 * border)
    assert scale >= 4, f"{scale}px/module is too small to scan"
    tile = np.full((size, size, 3), 255, np.uint8)
    dark = np.kron(mat, np.ones((scale, scale), np.uint8)).astype(bool)
    off = (size - scale * (n + 2 * border)) // 2 + border * scale
    tile[off:off + n * scale, off:off + n * scale][dark] = 0
    return tile


def main():
    ap = argparse.ArgumentParser(description="Verify the blank invite cards.")
    ap.add_argument("--src", help="dir of the iOS card exports; enables alpha + stray-pixel checks")
    ap.add_argument("--templates", default=f"{REPO}/templates")
    args = ap.parse_args()

    import cv2
    det = cv2.QRCodeDetector()
    src_of = {}
    if args.src:
        srcs = sorted(glob.glob(f"{args.src}/IMG_*.PNG"), key=lambda p: int(os.path.basename(p)[4:8]))
        src_of = dict(zip(LOCALES, srcs))

    fails, checked = [], 0
    for kind, wants_label in KINDS.items():
        labelled = 0
        for loc in LOCALES:
            p = f"{args.templates}/{kind}/{loc}.png"
            if not os.path.exists(p):
                fails.append(f"{kind}/{loc}: missing"); continue
            im = Image.open(p)
            a = np.array(im)
            if im.mode != "RGBA" or a.shape[:2] != (1530, 900):
                fails.append(f"{kind}/{loc}: {im.mode} {a.shape}")
            rgb = a[:, :, :3].astype(int)

            x0, y0, x1, y1 = sentinel(rgb)
            S = x1 - x0 + 1
            if not (470 <= S <= 486) or abs((y1 - y0 + 1) - S) > 1:
                fails.append(f"{kind}/{loc}: sentinel {S}x{y1 - y0 + 1}")

            if loc in src_of:
                src = np.array(Image.open(src_of[loc]).convert("RGBA"))
                if not np.array_equal(src[:, :, 3], a[:, :, 3]):
                    fails.append(f"{kind}/{loc}: alpha changed")
                diff = (src[:, :, :3] != rgb).any(axis=2)
                allowed = np.zeros(diff.shape, bool)
                allowed[y0:y1 + 1, x0:x1 + 1] = True
                allowed[y0 - 120:y0 - 38, 170:731] = True
                stray = int((diff & ~allowed).sum())
                if stray:
                    fails.append(f"{kind}/{loc}: {stray}px changed outside the two rects")

            strip = rgb[y0 - 115:y0 - 45, 170:731]
            Y = 0.299 * strip[:, :, 0] + 0.587 * strip[:, :, 1] + 0.114 * strip[:, :, 2]
            ink = int((Y > 120).sum())
            if wants_label and ink < 500:
                fails.append(f"{kind}/{loc}: label missing (ink {ink})")
            if not wants_label and ink > 0:
                fails.append(f"{kind}/{loc}: plain should be empty (ink {ink})")
            labelled += 1 if ink else 0

            a[y0:y0 + S, x0:x0 + S, :3] = qr_tile(URL, S)
            a[y0:y0 + S, x0:x0 + S, 3] = 255
            card = Image.fromarray(a, "RGBA")
            flat = Image.new("RGB", card.size, "white"); flat.paste(card, mask=card.split()[3])
            txt, _, _ = det.detectAndDecode(np.array(flat))
            if txt != URL:
                fails.append(f"{kind}/{loc}: QR decoded {txt!r}")
            checked += 1
        print(f"{kind:<16} {len(LOCALES)} locales   labelled={labelled:<3} expected={len(LOCALES) if wants_label else 0}")

    print(f"\nchecked {checked} templates" + (" (with source comparison)" if src_of else " (no --src: skipped alpha/stray checks)"))
    print("ALL TEMPLATES PASS" if not fails else f"{len(fails)} FAILURES:")
    for f in fails[:30]:
        print("  -", f)
    raise SystemExit(1 if fails else 0)


if __name__ == "__main__":
    main()
