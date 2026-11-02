#!/bin/sh
# CHROMIUM-XSLT-STOPGAP: delete this file on Forester 6.0 (see `render-forest-html`
# in nix/packages.nix, which runs it).
#
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

# Self-disabling: a forester that writes HTML itself leaves no index.xml, so
# there is nothing to do (and no stylesheet is needed).
count=$(find "$dir" -name index.xml | wc -l)
if [ "$count" -eq 0 ]; then
  echo "no index.xml under $dir: nothing to render (forester already wrote HTML?)"
  exit 0
fi
[ -f "$xsl" ] || { echo "no $xsl: not a forester build?" >&2; exit 1; }

# Where each tree leads, for the links of a deck (theme/links.xsl): <dir>/leads-to.xml, one <to> for each tree that has a
# \meta{redirect} or \meta{external}, made by the theme's leads-to-index.xsl, run over one tree's page at a time. A deck
# that read the pages it links to itself would hold them all in memory (libxslt keeps every document it loads until the
# page is done), and several decks are rendered at once below. A theme without that stylesheet gets no file (and no stale
# one), and its stylesheet reads the pages instead.
lead="$dir/leads-to-index.xsl"
rm -f "$dir/leads-to.xml"
if [ -f "$lead" ]; then
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  find "$dir" -name index.xml -print0 |
    xargs -0 -P "$(nproc)" -I{} sh -c 'xsltproc --nonet -o "$3/$(basename "$(dirname "$1")")" "$2" "$1"' _ {} "$lead" "$tmp"
  {
    echo '<leads-to>'
    find "$tmp" -type f -print0 | sort -z | xargs -0 -r cat
    echo '</leads-to>'
  } > "$dir/leads-to.xml"
fi

find "$dir" -name index.xml -print0 |
  xargs -0 -P "$(nproc)" -I{} sh -c 'xsltproc --nonet -o "$(dirname "$1")/index.html" "$2" "$1"' _ {} "$xsl"
echo "rendered $count pages to HTML"
