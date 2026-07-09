"""Build the blank invite cards in templates/<kind>/<locale>.png.

Input is the set of 21 localized cards exported from the iOS `InviteShareCard`
(900x1530, ordered as `CuratedLanguage` minus `system`). For each card two
rectangles are repainted -- a one-time offline step, so the Worker never has to
render text:

  * description strip -- the baked custom message is erased with the flat card
    background, then replaced by the kind's Discourse group label. `plain` gets
    no label (left empty).
  * QR tile -- the baked sample QR is replaced by a solid MAGENTA sentinel;
    `worker/_lib/qrCard.ts` finds it by colour and paints the real QR in.

The sentinel must be *derived* at runtime, never hardcoded: its X is constant but
its Y shifts up to 22px between locales, because script line-heights change the
headline's height and push everything below it.

Geometry (card is 300x510pt, exported @3x):
  * The QR tile is 546x546 (qrSize 158pt + 2*12pt padding) and carries a soft grey
    gradient at its top/bottom edges -- a `lum>235` threshold under-measures it, so
    detect the tile with `lum>150` row/column counts instead.
  * The QR *frame* is the tile inset by the 36px padding. Do not derive it from the
    dark-module bbox: CoreImage's QR has a 1-module quiet-zone border, so the modules
    stop ~13px short of the frame.
  * The card background contains pure-black pixels, and everything outside the rounded
    corners is RGBA(0,0,0,0) -- so "black == module" needs both an opaque-alpha mask
    and a tile-first restriction.

Labels are English for every locale: they name a Discourse group, mirroring the
original card, whose description was verbatim English throughout.

    python scripts/make_templates.py --src ~/cards      # needs pillow numpy fonttools brotli
    python scripts/verify_templates.py --src ~/cards
"""
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont
import argparse
import glob
import numpy as np
import os
import tempfile

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(ROOT)
WOFF2 = f"{REPO}/public/fonts/geist-variable.woff2"

MAGENTA = (255, 0, 255)
PAD_QR = 2            # swallow antialiased module edges
PAD_DESC = 8          # swallow antialiased text edges
DESC_X0, DESC_X1 = 170, 730
CENTRE_X = 450
FONT_PX = 39          # == .footnote (13pt) @3x; calibrated against the original ink
FONT_WEIGHT = 500     # == .weight(.medium)
BASELINE_FROM_TOP = 28
TEXT_RGB = (222, 222, 222)   # == white @ 0.88 opacity; matches the measured peak of 221

# kind -> Discourse group full_name, baked in (None => leave the strip empty)
KINDS = {
    "track_stewards": "Track Steward",
    "holeshot_crew":  "Holeshot Crew",
    "plain":          None,
}

# Worker locale spelling, so `template/<kind>/<locale>.png` resolves directly.
LOCALES = ["en", "zh-CN", "zh-TW", "ja", "ko", "de", "it", "fr", "es", "ar", "da", "el",
           "fa-IR", "fi", "id", "nl", "pt", "tr-TR", "th", "vi", "sv"]


def load_font():
    """Geist ships as a variable woff2; FreeType needs a plain TTF."""
    f = TTFont(WOFF2)
    f.flavor = None
    tmp = os.path.join(tempfile.mkdtemp(), "geist.ttf")
    f.save(tmp)
    font = ImageFont.truetype(tmp, FONT_PX)
    font.set_variation_by_axes([FONT_WEIGHT])
    return font


def lum(a):
    return 0.299 * a[:, :, 0] + 0.587 * a[:, :, 1] + 0.114 * a[:, :, 2]


def analyse(arr):
    """Return (sentinel_rect, desc_erase_rect, text_top, bg_colour) for one card."""
    rgb = arr[:, :, :3].astype(np.int32)
    Y = lum(rgb)

    bright = Y > 150
    rowc = bright[700:1340].sum(axis=1)
    trows = np.where(rowc > 300)[0]
    assert len(trows), "no tile rows"
    ty0, ty1 = 700 + trows.min(), 700 + trows.max()
    colc = bright[ty0:ty1 + 1].sum(axis=0)
    tcols = np.where(colc > 300)[0]
    tx0, tx1 = tcols.min(), tcols.max()
    tw, th = tx1 - tx0 + 1, ty1 - ty0 + 1
    assert abs(tw - th) <= 6 and 535 <= tw <= 555, f"tile not ~546 square: {tw}x{th}"

    INSET = 34                     # 36px padding minus a 2px antialias margin
    qx0, qy0, qx1, qy1 = tx0 + INSET, ty0 + INSET, tx1 - INSET, ty1 - INSET
    assert 470 <= qx1 - qx0 + 1 <= 486, f"QR frame {qx1 - qx0 + 1}"

    inner = np.zeros(Y.shape, bool)
    inner[ty0 + 30:ty1 - 29, tx0 + 30:tx1 - 29] = True
    mys, mxs = np.where((Y < 100) & inner)
    assert mxs.min() >= qx0 and mxs.max() <= qx1 and mys.min() >= qy0 and mys.max() <= qy1, \
        "dark modules escape the QR frame"

    top = max(0, ty0 - 150)
    dband = Y[top:ty0 - 6, :] > 140
    nz = np.where(dband.sum(axis=1) > 0)[0]
    assert len(nz), "no description text found"
    groups, start = [], nz[0]
    for i in range(1, len(nz)):
        if nz[i] != nz[i - 1] + 1:
            groups.append((start, nz[i - 1])); start = nz[i]
    groups.append((start, nz[-1]))
    g0, g1 = groups[-1]
    dy0, dy1 = top + g0, top + g1
    head_y1 = top + groups[-2][1] if len(groups) >= 2 else 0

    dry0, dry1 = dy0 - PAD_DESC, dy1 + PAD_DESC
    assert dry1 < ty0 - 4, "desc rect collides with tile"
    assert dry0 > head_y1 + 2, "desc rect collides with headline"

    band = np.concatenate([rgb[dry0:dry1 + 1, 40:160], rgb[dry0:dry1 + 1, 740:860]], axis=1)
    bg = tuple(int(round(v)) for v in band.reshape(-1, 3).mean(axis=0))

    return (qx0 - PAD_QR, qy0 - PAD_QR, qx1 + PAD_QR, qy1 + PAD_QR), (dry0, dry1), dy0, bg


def main():
    ap = argparse.ArgumentParser(description="Build blank invite cards from the iOS card exports.")
    ap.add_argument("--src", required=True, help="dir holding the 21 exported cards (IMG_*.PNG)")
    ap.add_argument("--out", default=f"{REPO}/templates")
    args = ap.parse_args()

    font = load_font()
    files = sorted(glob.glob(f"{args.src}/IMG_*.PNG"), key=lambda p: int(os.path.basename(p)[4:8]))
    assert len(files) == len(LOCALES), f"expected {len(LOCALES)} cards in {args.src}, found {len(files)}"
    for kind in KINDS:
        os.makedirs(f"{args.out}/{kind}", exist_ok=True)

    print(f"{'loc':<7}{'sentinel (x0,y0,x1,y1)':<30}{'desc strip':<14}{'baseline':<10}{'bg'}")
    for f, loc in zip(files, LOCALES):
        base = np.array(Image.open(f).convert("RGBA"))
        (sx0, sy0, sx1, sy1), (dry0, dry1), dy0, bg = analyse(base)
        baseline = dy0 + BASELINE_FROM_TOP

        for kind, label in KINDS.items():
            arr = base.copy()
            arr[dry0:dry1 + 1, DESC_X0:DESC_X1 + 1, :3] = bg
            arr[sy0:sy1 + 1, sx0:sx1 + 1, :3] = MAGENTA
            arr[sy0:sy1 + 1, sx0:sx1 + 1, 3] = 255
            im = Image.fromarray(arr, "RGBA")
            if label:
                ImageDraw.Draw(im).text((CENTRE_X, baseline), label, font=font,
                                        fill=TEXT_RGB + (255,), anchor="ms")
            im.save(f"{args.out}/{kind}/{loc}.png", optimize=True, compress_level=9)

        print(f"{loc:<7}{f'{sx0},{sy0},{sx1},{sy1}':<30}{f'{dry0}..{dry1}':<14}{baseline:<10}{bg}")

    print(f"\nwrote {len(LOCALES)} x {len(KINDS)} = {len(LOCALES) * len(KINDS)} templates -> {args.out}/<kind>/")


if __name__ == "__main__":
    main()
