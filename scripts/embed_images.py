#!/usr/bin/env python3
"""
Always-on build step: inline any raster image a generated SVG references
by plain filename (i.e. a `\\Image{...}` card) as a base64 `data:` URI,
replacing the external reference.

This exists because a browser refuses to let an SVG loaded via `<img src>`
fetch anything it references internally -- the same security boundary
behind CORS-for-images / "tainted canvas": an image resource isn't allowed
to make further requests of its own, so the referenced bitmap never loads
even though the file exists (only a direct navigation to the SVG's own URL
is unrestricted, which is why it worked there and nowhere else). A `data:`
URI isn't a further request at all, so that restriction doesn't apply, and
the SVG displays correctly wherever it's embedded.

dvisvgm never embeds a referenced bitmap itself -- confirmed empirically
across its default driver, --embed-bitmaps, the dvips driver, and even
pre-wrapping the bitmap in its own embedding SVG -- so this is done as a
direct text substitution on its output instead.

Only SVGs that reference a file actually found alongside them are touched;
an `xlink:href` that isn't a plain existing filename (an SVG-internal
`#id` reference, say) is left exactly as it was.
"""
import base64
import glob
import mimetypes
import os
import re

HREF = re.compile(r"xlink:href='([^':]+)'")  # excludes already-data: hrefs


def embed(svg_path):
    content = open(svg_path).read()

    def replace(m):
        filename = m.group(1)
        if not os.path.isfile(filename):
            return m.group(0)
        mime, _ = mimetypes.guess_type(filename)
        data = base64.b64encode(open(filename, "rb").read()).decode("ascii")
        return f"xlink:href='data:{mime};base64,{data}'"

    new_content = HREF.sub(replace, content)
    if new_content != content:
        open(svg_path, "w").write(new_content)
        print(f"{svg_path}: embedded referenced image(s)")


def main():
    for svg_path in sorted(glob.glob("*.svg")):
        embed(svg_path)


if __name__ == "__main__":
    main()
