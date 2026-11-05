#!/usr/bin/env python3
"""
Turn an AI-generated character on a flat chroma background into a clean,
transparent cutout.

    python3 scripts/chroma.py public/avatars/raw/duck.png public/avatars/1.webp

- samples the background colour from the image corners
- soft key (keeps anti-aliased edges)
- despill (removes the background colour bleeding onto edges)
- crops to the character, pads to a square, resizes to 512x512
"""

import sys
import os
from PIL import Image, ImageFilter

SIZE = 512
PAD = 0.06  # 6% breathing room around the character


def corner_colour(img):
    w, h = img.size
    s = max(4, min(w, h) // 24)
    pts = [
        (0, 0),
        (w - s, 0),
        (0, h - s),
        (w - s, h - s),
    ]
    r = g = b = n = 0
    px = img.load()
    for x0, y0 in pts:
        for y in range(y0, y0 + s):
            for x in range(x0, x0 + s):
                p = px[x, y]
                r += p[0]
                g += p[1]
                b += p[2]
                n += 1
    return (r // n, g // n, b // n)


def main(src, dst):
    img = Image.open(src).convert("RGB")
    px = img.load()
    w, h = img.size
    bg = corner_colour(img)
    print(f"background sampled: {bg}")

    out = Image.new("RGBA", (w, h))
    op = out.load()

    # distance thresholds
    t0, t1 = 70.0, 150.0

    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            dr, dg, db = r - bg[0], g - bg[1], b - bg[2]
            d = (dr * dr + dg * dg + db * db) ** 0.5

            if d <= t0:
                a = 0.0
            elif d >= t1:
                a = 1.0
            else:
                a = (d - t0) / (t1 - t0)

            if a <= 0.002:
                op[x, y] = (r, g, b, 0)
                continue

            # despill: remove what is left of the background contribution
            rr = (r - bg[0] * (1 - a)) / a
            gg = (g - bg[1] * (1 - a)) / a
            bb = (b - bg[2] * (1 - a)) / a
            op[x, y] = (
                max(0, min(255, int(rr))),
                max(0, min(255, int(gg))),
                max(0, min(255, int(bb))),
                int(255 * a),
            )

    # soften the alpha edge a touch
    alpha = out.getchannel("A").filter(ImageFilter.GaussianBlur(0.6))
    out.putalpha(alpha)

    box = out.getbbox()
    if box:
        out = out.crop(box)

    # square canvas with padding
    cw, ch = out.size
    side = int(max(cw, ch) * (1 + PAD * 2))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(out, ((side - cw) // 2, (side - ch) // 2), out)
    canvas = canvas.resize((SIZE, SIZE), Image.LANCZOS)

    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    if dst.lower().endswith(".webp"):
        canvas.save(dst, "WEBP", quality=92, method=6)
    else:
        canvas.save(dst, "PNG")
    print(f"wrote {dst} ({SIZE}x{SIZE})")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("usage: chroma.py <input> <output>")
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
