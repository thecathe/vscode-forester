#!/bin/sh
# Always-on build step (skip with `build-forest --xml-only`): render a forester
# build's XML pages to HTML with the forest's own XSLT, so no browser has to.
#
#   forest-render-html.sh <output dir>
#
# Every tree is <dir>/<addr>/index.xml (styled by /default.xsl) plus an
# index.html that only redirects to it. Browsers are dropping XSLT (Chromium
# removes it from stable in November 2026), so this runs the same stylesheet
# here (xsltproc, XSLT 1.0) and writes the result over index.html: the same
# page, as plain HTML. index.xml stays, for anything that reads it.
#
# This mirrors the deployed site's `forest-html` step (scripts/forest-render-html.sh
# in thecathe/webserver, D40), so a local preview and production serve the same
# kind of page. Keep the two in step.
set -eu
dir=$1
xsl="$dir/default.xsl"
[ -f "$xsl" ] || { echo "no $xsl: not a forester build?" >&2; exit 1; }

count=$(find "$dir" -name index.xml | wc -l)
find "$dir" -name index.xml -print0 |
  xargs -0 -P "$(nproc)" -I{} sh -c 'xsltproc --nonet -o "$(dirname "$1")/index.html" "$2" "$1"' _ {} "$xsl"
echo "rendered $count pages to HTML"
