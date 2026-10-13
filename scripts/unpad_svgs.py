#!/usr/bin/env python3
"""
Opt-in build step (enabled via `build-forest --unpad`): removes the
universal, content-independent blank margin that every \\tex{}{} SVG
forester generates carries in its viewBox.

That margin comes from the DVI format's own 1-inch reference-point
convention, combined with dvisvgm's `--bbox=papersize` mode (hardcoded by
forester, not configurable), and shows up as a large blank gap -- mostly on
the left -- around every rendered \\tex{}{} image, regardless of content.
This measures each SVG's real ink extent with a disposable rsvg-convert
render and rewrites the viewBox/width/height to match, with a small safety
pad kept around the trimmed ink.
"""
import glob
import os
import re
import subprocess
import sys

RSVG, MAGICK = sys.argv[1], sys.argv[2]

RENDER_ZOOM = 4    # oversample factor used only to measure crop geometry
CROP_PAD_PT = 1.5  # safety margin (points) kept around the trimmed ink

SVG_HEADER = re.compile(
    r"<svg[^>]*\bwidth='([\d.]+)pt' height='([\d.]+)pt'"
    r"[^>]*\bviewBox='(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)'"
)


def trim_geometry(png_path):
    out = subprocess.run(
        [MAGICK, png_path, "-trim", "-format", "%wx%h%O", "info:"],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    m = re.search(r"(\d+)x(\d+)\+(\d+)\+(\d+)", out)
    if not m:
        raise RuntimeError(f"couldn't parse trim geometry for {png_path}: {out!r}")
    return tuple(map(int, m.groups()))  # w, h, x, y


def unpad(svg_path):
    content = open(svg_path).read()
    m = SVG_HEADER.search(content)
    if not m:
        return
    w_attr, h_attr, min_x, min_y, vw, vh = map(float, m.groups())
    zoom = w_attr / vw

    probe_png = svg_path + ".crop-probe.png"
    subprocess.run([RSVG, "--zoom", str(RENDER_ZOOM), "-o", probe_png, svg_path], check=True)
    px_w, px_h = map(int, subprocess.run(
        [MAGICK, "identify", "-format", "%w %h", probe_png],
        check=True, capture_output=True, text=True,
    ).stdout.split())
    scale_x, scale_y = px_w / vw, px_h / vh
    tw, th, tx, ty = trim_geometry(probe_png)
    os.remove(probe_png)

    new_min_x = min_x + tx / scale_x - CROP_PAD_PT
    new_min_y = min_y + ty / scale_y - CROP_PAD_PT
    new_vw = tw / scale_x + 2 * CROP_PAD_PT
    new_vh = th / scale_y + 2 * CROP_PAD_PT
    new_w, new_h = new_vw * zoom, new_vh * zoom

    new_header = (
        f"<svg version='1.1' xmlns='http://www.w3.org/2000/svg' "
        f"xmlns:xlink='http://www.w3.org/1999/xlink' "
        f"width='{new_w:.6f}pt' height='{new_h:.6f}pt' "
        f"viewBox='{new_min_x:.6f} {new_min_y:.6f} {new_vw:.6f} {new_vh:.6f}'"
    )
    open(svg_path, "w").write(content.replace(m.group(0), new_header, 1))


def main():
    for svg_path in sorted(glob.glob("*.svg")):
        unpad(svg_path)


if __name__ == "__main__":
    main()
