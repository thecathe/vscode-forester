#!/usr/bin/env python3
r"""
Stamp a fresh `\date{...}` onto a tree, bound to a VS Code keybinding
(the `forestEdit.touchDate` command in extension/extension.js, bound in
nix/vscode-feature.nix) so editing a note can record when it was last
touched without losing the original `\date`.

Inserts directly below the last line in the leading `\date{...}` block (blank
lines and `% \date{...}` comments inside that block are skipped over, not
treated as the end of it) rather than replacing anything, since forester's
`dates` field is a list -- multiple `\date` lines are a revision history, not
a conflict. Format matches what forest-keeper itself writes on tree
creation: UTC, no fractional seconds, trailing `Z`.
"""
import datetime
import re
import sys

DATE_LINE = re.compile(r"^\\date\{.*\}\s*$")
# SKIPPABLE = re.compile(r"^\s*(%.*)?$")


def last_date_line_index(lines):
    last = None
    for i, line in enumerate(lines[:10]):
        if DATE_LINE.match(line):
            last = i
        else:
        # elif SKIPPABLE.match(line):
            continue
        # else:
            # break
    return last


def main():
    path = sys.argv[1]
    with open(path) as f:
        lines = f.readlines()

    idx = last_date_line_index(lines)
    if idx is None:
        # sys.exit(f"touch_date: no \\date{{...}} found near the top of {path}")
        idx = -1

    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    lines.insert(idx + 1, f"\\date{{{now}}}\n")

    with open(path, "w") as f:
        f.writelines(lines)
    print(f"{path}: added \\date{{{now}}}")


if __name__ == "__main__":
    main()
