#!/usr/bin/env python3
r"""
Pre-build generators and lint for a forester forest. Repo-agnostic: it only
needs a forest config (forest.toml) and the tree directories that config
names, and it reads the same schema tables the forester fork validates:

    [forest.prefix."#"]        taxon = "Thing"
    [forest.tag.private]       behaviour = "hide"
    [forest.tag.must-preorder] page = true
    [forest.meta.date]         page = true
    [forest.publish]           tags = ["public"]

Subcommands (all take --config, default forest.toml):

  stubs   For every link/transclusion to an address that starts with a
          configured prefix but has no .tree file, write a stub tree
          (\title + \taxon) so the page exists and gets backlinks.
  tags    For every tag with `page = true` (and not hidden), write a tag
          page listing the trees carrying it, plus a `tags` index page. The
          page is titled with the tag, or `[forest.tag.<name>] title` if set
          (plain text; the compiler also uses it as the tag's label in page
          headers, unless `label` is set).
  taxa    For every taxon in use (except `[forest.taxon.<Name>] page =
          false`), write a taxon page listing the trees with that taxon,
          plus a `taxa` index. The compiler links each taxon to its page.
  dates   If `[forest.meta.date] page = true`, write a `timeline` page listing
          every \date{} of every non-hidden, published tree, oldest first. A tree's
          earliest date is its "first entry"; later ones are "return entries"
          (italic). The timestamp stands in place of the list marker.
  lint    Warn (loudly) about every non-hidden tree that links to or
          transcludes a tree carrying a `hide` tag. --strict exits non-zero.
  all     stubs + tags + taxa + dates + lint.

Directory masks: `[forest.directory."<path>"] tags = [...]` gives every tree
under <path> those tags here too, matching the compiler, so hide rules, tag
pages and the lint all see them.

Generated trees go to --out (default <first trees dir>/_generated), in a
subdirectory per generator that is wiped and recreated on every run; add it to .gitignore. Real trees always
win: nothing is generated for an address that already exists.

This is a regex-level scan of the tree sources, not a parse: links produced
by macros are not seen. Treat `lint` as a safety net, not a guarantee.
"""
import argparse
import datetime
import json
import os
import re
import shutil
import sys
import tomllib

OUT_DIRNAME = "_generated"

COMMENT = re.compile(r"(?<!\\)%.*$")
# (kind, pattern) -- group 1 is the addressed tree
REFS = [
    ("links to", re.compile(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]")),
    ("links to", re.compile(r"\]\(([^)\s]+)\)")),
    ("transcludes", re.compile(r"\\transclude\{([^}]+)\}")),
    ("credits", re.compile(r"\\(?:author|contributor)\{([^}]+)\}")),
    ("references", re.compile(r"\\ref\{([^}]+)\}")),
]
TAG = re.compile(r"\\tag\{([^}]*)\}")
TAXON = re.compile(r"\\taxon\{([^}]*)\}")
DATE = re.compile(r"\\date\{([^}]*)\}")
DATE_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MONTHS = [
    "January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December",
]
# Anything with a scheme or a path separator is not an internal address.
EXTERNAL = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:|[/\\]")


def load_config(path):
    with open(path, "rb") as f:
        raw = tomllib.load(f)
    forest = raw.get("forest", {})
    prefixes = {
        k: v.get("taxon", "")
        for k, v in forest.get("prefix", {}).items()
        if isinstance(v, dict)
    }
    tags = {k: v for k, v in forest.get("tag", {}).items() if isinstance(v, dict)}
    taxa = {k: v for k, v in forest.get("taxon", {}).items() if isinstance(v, dict)}
    directories = {
        k: list(v.get("tags", []))
        for k, v in forest.get("directory", {}).items()
        if isinstance(v, dict)
    }
    date_meta = forest.get("meta", {}).get("date", {})
    publish = forest.get("publish", {})
    return {
        "publish_tags": list(publish.get("tags", [])) if isinstance(publish, dict) else [],
        "date_page": isinstance(date_meta, dict) and date_meta.get("page") is True,
        "taxa": taxa,
        "directories": directories,
        "root": os.path.dirname(os.path.abspath(path)),
        "trees": forest.get("trees", ["trees"]),
        "prefixes": prefixes,
        "tags": tags,
    }


def scan_trees(cfg, exclude):
    """Yield (addr, path, lines) for every .tree file outside `exclude`."""
    exclude = os.path.abspath(exclude)
    for d in cfg["trees"]:
        base = os.path.join(cfg["root"], d)
        for dirpath, dirnames, filenames in os.walk(base):
            if os.path.abspath(dirpath) == exclude:
                dirnames[:] = []
                continue
            for fn in sorted(filenames):
                if fn.endswith(".tree"):
                    path = os.path.join(dirpath, fn)
                    with open(path, encoding="utf-8") as f:
                        yield fn[: -len(".tree")], path, f.read().splitlines()


class Tree:
    def __init__(self, addr, path, lines):
        self.addr = addr
        self.path = path
        self.refs = []  # (lineno, kind, target)
        self.tags = []
        self.taxon = None
        self.dates = []  # datetime, in source order
        for i, line in enumerate(lines, 1):
            line = COMMENT.sub("", line)
            for kind, pat in REFS:
                for m in pat.finditer(line):
                    target = m.group(1).strip()
                    if target and not EXTERNAL.search(target):
                        self.refs.append((i, kind, target))
            for m in TAG.finditer(line):
                self.tags.append(m.group(1).strip())
            for m in DATE.finditer(line):
                try:
                    self.dates.append(datetime.datetime.strptime(m.group(1).strip(), DATE_FORMAT))
                except ValueError:
                    print("warning: %s:%d: unparseable \\date{%s}" % (path, i, m.group(1)), file=sys.stderr)
            if self.taxon is None:
                m = TAXON.search(line)
                if m:
                    self.taxon = m.group(1).strip()


def apply_directory_masks(cfg, tree):
    for d, mask in cfg["directories"].items():
        base = os.path.normpath(os.path.join(cfg["root"], d)) + os.sep
        if os.path.abspath(tree.path).startswith(base):
            for tag in mask:
                if tag not in tree.tags:
                    tree.tags.append(tag)


def load_trees(cfg, out):
    trees = {t.addr: t for t in (Tree(*x) for x in scan_trees(cfg, out))}
    for t in trees.values():
        apply_directory_masks(cfg, t)
    return trees


def fresh_dir(out):
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out)


def write_tree(out, addr, body):
    with open(os.path.join(out, addr + ".tree"), "w", encoding="utf-8") as f:
        f.write(body)


def hidden_tags(cfg):
    return {t for t, r in cfg["tags"].items() if r.get("behaviour") == "hide"}


def unpublished(cfg, tree):
    """The compiler's rule: it gets no page, so generated pages must not list
    it either. With `[forest.publish] tags`, a tree is published only if it
    carries one of them. Otherwise (and a publish tag overrides this), its
    taxon has `unpublished = true` and its address is not in that taxon's
    `publish` list."""
    if any(t in cfg["publish_tags"] for t in tree.tags):
        return False
    if cfg["publish_tags"]:
        return True
    rule = cfg["taxa"].get(tree.taxon or "", {})
    return rule.get("unpublished") is True and tree.addr not in rule.get("publish", [])


def slug(name):
    s = re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").lower()
    return s or "tag"


def cmd_stubs(cfg, trees, out):
    created = []
    wanted = {}
    for t in trees.values():
        for lineno, _kind, target in t.refs:
            if target in trees or target[:1] not in cfg["prefixes"]:
                continue
            if len(target) < 2:
                continue
            wanted.setdefault(target, (t.path, lineno))
    for addr, (src, lineno) in sorted(wanted.items()):
        taxon = cfg["prefixes"][addr[0]]
        title = addr[1:]
        write_tree(out, addr, "\\title{%s}\n%s\n" % (title, "\\taxon{%s}" % taxon if taxon else ""))
        created.append({"addr": addr, "taxon": taxon, "first_seen": "%s:%d" % (src, lineno)})
        print("stub: %s (%s) <- %s:%d" % (addr, taxon or "no taxon", os.path.relpath(src, cfg["root"]), lineno))
    return created


def tag_title(cfg, tag):
    """The title of a tag's page: `[forest.tag.<name>] title`, else the tag.
    It is plain text (the compiler also shows it as the tag's label in page
    headers), so one that would be read as markup is ignored with a warning."""
    title = cfg["tags"].get(tag, {}).get("title")
    if title is None:
        return tag
    if not isinstance(title, str) or not title.strip() or re.search(r"[{}\\%]", title):
        print(
            "warning: ignoring title %r for tag %r (it must be non-empty plain text, without { } \\ %%)"
            % (title, tag),
            file=sys.stderr,
        )
        return tag
    return title.strip()


def cmd_tags(cfg, trees, out):
    hidden = hidden_tags(cfg)
    present = {tag for t in trees.values() for tag in t.tags}
    chosen = sorted(
        t for t, r in cfg["tags"].items()
        if r.get("page") is True and t not in hidden
    )
    created = []
    for tag in chosen:
        if tag not in present:
            print("warning: tag %r has page = true but no tree carries it" % tag, file=sys.stderr)
        if re.search(r"[{}\\]", tag):
            print("warning: skipping tag %r (contains markup characters)" % tag, file=sys.stderr)
            continue
        addr = "tag-" + slug(tag)
        if addr in trees:
            print("warning: %s exists as a real tree; not generating a page for tag %r" % (addr, tag), file=sys.stderr)
            continue
        write_tree(
            out, addr,
            "\\title{%s}\n\\taxon{Tag}\n\\query{\\datalog{?X -: {\\rel/has-tag ?X '{%s}}}}\n"
            % (tag_title(cfg, tag), tag),
        )
        created.append({"tag": tag, "addr": addr})
        print("tag page: %s" % addr)
    # Always generate the index (unless a real `tags` tree exists), so a
    # `[[tags]]` link never dangles when no tag has `page = true` yet.
    if "tags" not in trees:
        note = "" if created else (
            "\\p{No tag pages are configured. Set \\code{page = true} under "
            "\\code{[forest.tag.<name>]} in \\code{forest.toml}.}\n"
        )
        write_tree(
            out, "tags",
            "\\title{Tags}\n" + note
            + "\\query{\\datalog{?X -: {\\rel/has-taxon ?X '{Tag}}}}\n",
        )
        print("tags index: tags")
    return created


def cmd_taxa(cfg, trees, out, extra_taxa=()):
    hidden = hidden_tags(cfg)
    used = {
        t.taxon for t in trees.values()
        if t.taxon and not any(tag in hidden for tag in t.tags) and not unpublished(cfg, t)
    }
    used.update(extra_taxa)
    chosen = sorted(
        n for n in used
        if cfg["taxa"].get(n, {}).get("page", True) is not False
        and not re.search(r"[{}\\]", n)
    )
    created = []
    # Generated taxon pages carry the taxon "Taxon" themselves.
    if chosen and "Taxon" not in chosen and (
        cfg["taxa"].get("Taxon", {}).get("page", True) is not False
    ):
        chosen.append("Taxon")
    seen = {}
    for name in chosen:
        addr = "taxon-" + slug(name)
        if addr in seen:
            print("warning: taxa %r and %r both map to %s; skipping %r" % (seen[addr], name, addr, name), file=sys.stderr)
            continue
        seen[addr] = name
        if addr in trees:
            print("warning: %s exists as a real tree; not generating a page for taxon %r" % (addr, name), file=sys.stderr)
            continue
        write_tree(
            out, addr,
            "\\title{%s}\n\\taxon{Taxon}\n\\query{\\datalog{?X -: {\\rel/has-taxon ?X '{%s}}}}\n" % (name, name),
        )
        created.append({"taxon": name, "addr": addr})
        print("taxon page: %s" % addr)
    if created and "taxa" not in trees:
        write_tree(
            out, "taxa",
            "\\title{Taxa}\n\\query{\\datalog{?X -: {\\rel/has-taxon ?X '{Taxon}}}}\n",
        )
        print("taxa index: taxa")
    return created


def format_day(d):
    """`\\em{Tuesday}, 13th October 2026` (locale-independent)."""
    if 10 <= d.day % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(d.day % 10, "th")
    return "\\em{%s, %d%s %s %d}" % (WEEKDAYS[d.weekday()], d.day, suffix, MONTHS[d.month - 1], d.year)


def format_time(d):
    """`8:00AM`."""
    return "%d:%02d%s" % (d.hour % 12 or 12, d.minute, "AM" if d.hour < 12 else "PM")


def cmd_dates(cfg, trees, out):
    """Write the `timeline` page; returns [{addr, date, first}] oldest first."""
    if not cfg["date_page"]:
        return []
    if "timeline" in trees:
        print("warning: timeline exists as a real tree; not generating the date page", file=sys.stderr)
        return []
    hidden = hidden_tags(cfg)
    entries = []
    for t in trees.values():
        if any(tag in hidden for tag in t.tags) or unpublished(cfg, t) or not t.dates:
            continue
        first = min(t.dates)
        for d in t.dates:
            entries.append({"addr": t.addr, "date": d, "first": d == first})
    entries.sort(key=lambda e: (e["date"], e["addr"]))
    # One \subtree per (UTC) day, titled with the date. Each entry is a
    # collapsed <details>: the summary row is the time + link (the link goes
    # to the page, the rest of the row toggles), the body is the tree itself
    # transcluded without its own heading/metadata.
    days = []
    for e in entries:
        if not days or days[-1][0] != e["date"].date():
            days.append((e["date"].date(), []))
        link = "[[%s]]" % e["addr"]
        if not e["first"]:
            link = "\\em{%s}" % link
        days[-1][1].append(
            "    \\<html:li>{\\<html:details>{\n"
            "      \\<html:summary>{\\<html:time>[datetime]{%s}{%s} %s}\n"
            "      \\put\\transclude/heading{false}\n"
            "      \\put\\transclude/metadata{false}\n"
            "      \\transclude{%s}\n"
            "    }}"
            % (e["date"].strftime(DATE_FORMAT), format_time(e["date"]), link, e["addr"])
        )
    if days:
        subtrees = "\n".join(
            "\\subtree{\n  \\title{%s}\n  \\<html:ol>{\n%s\n  }\n}"
            % (format_day(day), "\n".join(items))
            for day, items in days
        )
        body = (
            "\\<html:style>{"
            ".timeline-days,.timeline-days ol{display:flex;flex-direction:column}"
            ".timeline-days ol{list-style:none;padding:0;margin:0}"
            ".timeline-days summary{cursor:pointer;border-radius:var(--radius)}"
            ".timeline-days summary:hover{background-color:rgba(0,100,255,.1)}"
            ".timeline-days time{display:inline-block;min-width:6em;font-variant-numeric:tabular-nums}"
            "#timeline-reverse:checked ~ .timeline-days,"
            "#timeline-reverse:checked ~ .timeline-days ol{flex-direction:column-reverse}"
            "}\n"
            "\\<html:input>[type]{checkbox}[id]{timeline-reverse}{}\n"
            "\\<html:label>[for]{timeline-reverse}{ Newest first}\n"
            "\\<html:div>[class]{timeline-days}{\n" + subtrees + "\n}\n"
        )
    else:
        body = "\\p{No trees have a \\code{\\\\date}.}\n"
    write_tree(out, "timeline", "\\title{Timeline}\n" + body)
    print("date page: timeline (%d entries)" % len(entries))
    return [
        {"addr": e["addr"], "date": e["date"].strftime(DATE_FORMAT), "first": e["first"]}
        for e in entries
    ]


def cmd_lint(cfg, trees):
    hidden = hidden_tags(cfg)
    hidden_trees = {
        a: [t for t in tr.tags if t in hidden] for a, tr in trees.items()
        if any(t in hidden for t in tr.tags)
    }
    findings = []
    for tr in trees.values():
        if tr.addr in hidden_trees:
            continue
        for lineno, kind, target in tr.refs:
            if target in hidden_trees:
                findings.append({
                    "from": os.path.relpath(tr.path, cfg["root"]),
                    "line": lineno,
                    "kind": kind,
                    "to": target,
                    "to_path": os.path.relpath(trees[target].path, cfg["root"]),
                    "tags": hidden_trees[target],
                })
    for f in findings:
        print(
            "WARNING: %s:%d %s hidden tree %s (%s, tag: %s) -- it will appear in the public output"
            % (f["from"], f["line"], f["kind"], f["to"], f["to_path"], ", ".join(f["tags"]))
        )
    return findings


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("command", choices=["stubs", "tags", "taxa", "dates", "lint", "all"])
    ap.add_argument("--config", default="forest.toml")
    ap.add_argument("--out", help="generated trees dir (default: <trees[0]>/_generated)")
    ap.add_argument("--strict", action="store_true", help="lint: exit 1 on any finding")
    ap.add_argument("--json", metavar="PATH", help="also write a machine-readable report")
    args = ap.parse_args(argv)

    cfg = load_config(args.config)
    out = os.path.abspath(args.out or os.path.join(cfg["root"], cfg["trees"][0], OUT_DIRNAME))
    report = {}
    # Each generator owns a subdirectory of `out`, so they can run separately.
    stubs_out, tags_out = os.path.join(out, "stubs"), os.path.join(out, "tags")
    taxa_out = os.path.join(out, "taxa")
    dates_out = os.path.join(out, "dates")
    if args.command in ("stubs", "all"):
        fresh_dir(stubs_out)
    if args.command in ("tags", "all"):
        fresh_dir(tags_out)
    if args.command in ("taxa", "all"):
        fresh_dir(taxa_out)
    if args.command in ("dates", "all"):
        fresh_dir(dates_out)
    trees = load_trees(cfg, out)
    if args.command in ("stubs", "all"):
        report["stubs"] = cmd_stubs(cfg, trees, stubs_out)
    if args.command in ("tags", "all"):
        report["tags"] = cmd_tags(cfg, trees, tags_out)
    if args.command in ("taxa", "all"):
        # Generated pages have taxa of their own: stubs, "Tag" and "Taxon".
        extra = {s["taxon"] for s in report.get("stubs", []) if s["taxon"]}
        if report.get("tags"):
            extra.add("Tag")
        report["taxa"] = cmd_taxa(cfg, trees, taxa_out, extra)
    if args.command in ("dates", "all"):
        report["dates"] = cmd_dates(cfg, trees, dates_out)
    status = 0
    if args.command in ("lint", "all"):
        report["lint"] = cmd_lint(cfg, trees)
        if report["lint"] and args.strict:
            status = 1
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)
    return status


if __name__ == "__main__":
    sys.exit(main())
