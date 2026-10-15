// Pure text -> edit computations, kept free of the vscode API so they can be
// unit-tested with plain node. Each function returns
// { start, end, text, cursor }: replace text[start,end) with `text`, then put
// the cursor at absolute offset `cursor` in the *new* document.

const HEADER = /^\s*(%\s*)?\\(date|author|title|taxon|meta|tag)\b/;

// Find every `\ul{...}`, `\ol{...}`, `\li{...}` and `\subtree{...}` /
// `\subtree[addr]{...}` as {kind, open, close} offsets of its braces. Skips escaped characters, `%`
// line comments and verbatim regions.
function scanSpans(text) {
  const spans = [];
  const stack = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") {
      if (text.startsWith("\\startverb", i)) {
        const e = text.indexOf("\\stopverb", i);
        i = e < 0 ? text.length : e + "\\stopverb".length;
        continue;
      }
      const verb = /^\\verb<\|/.exec(text.slice(i, i + 7));
      if (verb) {
        const e = text.indexOf("|>", i + 7);
        i = e < 0 ? text.length : e + 2;
        continue;
      }
      const blk = /^\\(ul|ol|li)\{/.exec(text.slice(i, i + 5));
      if (blk) {
        stack.push({ kind: blk[1], open: i + blk[0].length - 1 });
        i += blk[0].length;
        continue;
      }
      const sub = /^\\subtree(\[[^\]\n]*\])?\s*\{/.exec(text.slice(i, i + 200));
      if (sub) {
        stack.push({ kind: "subtree", open: i + sub[0].length - 1 });
        i += sub[0].length;
        continue;
      }
      i += 2; // escaped char (\{ \} \\ \%) or command name start
      continue;
    }
    if (c === "%") {
      const e = text.indexOf("\n", i);
      i = e < 0 ? text.length : e;
      continue;
    }
    if (c === "{") stack.push({ kind: null, open: i });
    else if (c === "}") {
      const top = stack.pop();
      if (top && top.kind) spans.push({ kind: top.kind, open: top.open, close: i });
    }
    i++;
  }
  return spans;
}

function lineStart(text, off) {
  return text.lastIndexOf("\n", off - 1) + 1;
}

function indentOf(text, off) {
  return /^[ \t]*/.exec(text.slice(lineStart(text, off)))[0];
}

const isList = (s) => s.kind === "ul" || s.kind === "ol";

// What encloses the cursor: the innermost `\subtree` (the scope that
// inserts respect, or null at the page root), the lists (`\ul` or `\ol`,
// which are treated alike) inside that scope, innermost first, and every
// `\li` in the page so callers can find the item a list entry lives in.
function contextAt(text, cursorOff) {
  const all = scanSpans(text);
  const around = all
    .filter((s) => s.open < cursorOff && cursorOff <= s.close)
    .sort((a, b) => a.close - a.open - (b.close - b.open));
  const scope = around.find((s) => s.kind === "subtree") || null;
  const inScope = (s) => !scope || s.open > scope.open;
  const uls = around.filter((s) => isList(s) && inScope(s));
  const lis = around.filter((s) => s.kind === "li" && inScope(s));
  return { scope, uls, lis, all };
}

// Append a block of `lines` (a "\0" marks where the cursor goes) as the last
// child of `scope`, or at the end of the page when `scope` is null. Child
// indentation follows the subtree's first existing child line, so both the
// compact `\subtree{\title{x}` + column-0 children style and indented
// subtrees are matched. `blankBefore` separates it from preceding children.
function appendBlock(text, scope, lines, blankBefore) {
  const finish = (str, start, end) => ({
    start,
    end,
    text: str.replace("\0", ""),
    cursor: start + str.indexOf("\0"),
  });
  if (!scope) {
    const sep =
      text.length === 0 || text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
    return finish(sep + lines.join("\n") + "\n", text.length, text.length);
  }
  const subIndent = indentOf(text, scope.open);
  const body = text.slice(scope.open, scope.close);
  const closeLineStart = lineStart(text, scope.close);
  const closeAlone =
    closeLineStart > scope.open && /^[ \t]*$/.test(text.slice(closeLineStart, scope.close));
  if (closeAlone) {
    const first = /\n([ \t]*)\S/.exec(body);
    const indent = first ? first[1] : subIndent + "  ";
    const hasChildren = first !== null;
    const before = text.slice(0, closeLineStart);
    const pre = blankBefore && hasChildren && !/\n\n$/.test(before) ? "\n" : "";
    const str = pre + lines.map((l) => indent + l).join("\n") + "\n";
    return finish(str, closeLineStart, closeLineStart);
  }
  // Closing brace shares a line with content: start a new line and move the
  // brace down.
  const indent = subIndent + "  ";
  const start = scope.open + body.replace(/\s+$/, "").length;
  const str = "\n" + lines.map((l) => indent + l).join("\n") + "\n" + subIndent;
  return finish(str, start, scope.close);
}

// New `\li{}` inside an enclosing list (`\ul` or `\ol`, treated alike),
// chosen by `level` among the lists inside the cursor's `\subtree` (or the
// whole page when not in one):
//   "inner"     the innermost list around the cursor
//   "parent"    one level out from the innermost
//   "outermost" the outermost list around the cursor
//   "root"      never an existing list: a fresh `\ul` at the end of the page
// The item goes at the nearest valid point after the cursor: right after the
// chosen list's item the cursor is in (whole item, nested lists included), or
// before the next item when the cursor sits between items, or at the end of
// the list when nothing follows. When there is no such list, a fresh
// `\ul{ \li{} }` is appended to the end of the subtree (or of the page).
function insertLi(text, cursorOff, level) {
  const { scope, uls, all } = contextAt(text, cursorOff);
  const fresh = (sc) => appendBlock(text, sc, ["\\ul{", "  \\li{\0}", "}"]);
  if (level === "root") return fresh(null);
  const ul =
    level === "outermost" ? uls[uls.length - 1] : level === "parent" ? uls[1] : uls[0];
  if (!ul) return fresh(scope);
  // Direct child items of `ul`, in document order.
  const items = all
    .filter((s) => s.kind === "li" && s.open > ul.open && s.close < ul.close)
    .filter(
      (li) =>
        !all.some((o) => isList(o) && o.open > ul.open && o.open < li.open && li.close < o.close),
    )
    .sort((x, y) => x.open - y.open);
  const here = items.find((li) => li.open < cursorOff && cursorOff <= li.close);
  const next = here ? null : items.find((li) => li.open >= cursorOff);
  const ulIndent = indentOf(text, ul.open);
  const child = /\n([ \t]*)\\li\{/.exec(text.slice(ul.open + 1, ul.close));
  const indent = child ? child[1] : ulIndent + "  ";
  const lead = "\\li{".length;
  if (here) {
    // After the whole item, on its own line.
    const at = here.close + 1;
    let eol = text.indexOf("\n", at);
    if (eol < 0) eol = text.length;
    const tail = text.slice(at, eol);
    const itemIndent = indentOf(text, here.open);
    if (/^\s*$/.test(tail)) {
      return {
        start: at,
        end: eol,
        text: `\n${itemIndent}\\li{}`,
        cursor: at + 1 + itemIndent.length + lead,
      };
    }
    const skip = /^[ \t]*/.exec(tail)[0].length;
    return {
      start: at,
      end: at + skip,
      text: `\n${itemIndent}\\li{}\n${itemIndent}`,
      cursor: at + 1 + itemIndent.length + lead,
    };
  }
  if (next) {
    const itemStart = next.open - "\\li".length; // `open` is the brace
    const ls = lineStart(text, itemStart);
    if (/^[ \t]*$/.test(text.slice(ls, itemStart))) {
      const ind = text.slice(ls, itemStart);
      return { start: ls, end: ls, text: `${ind}\\li{}\n`, cursor: ls + ind.length + lead };
    }
  }
  const body = text.slice(ul.open + 1, ul.close);
  const closeLineStart = lineStart(text, ul.close);
  const closeAlone =
    closeLineStart > ul.open && /^[ \t]*$/.test(text.slice(closeLineStart, ul.close));
  if (closeAlone) {
    return {
      start: closeLineStart,
      end: closeLineStart,
      text: `${indent}\\li{}\n`,
      cursor: closeLineStart + indent.length + lead,
    };
  }
  // List closed on the same line as content: put the new item on its own line
  // and move the brace down.
  const trimmedEnd = ul.open + 1 + body.replace(/\s+$/, "").length;
  return {
    start: trimmedEnd,
    end: ul.close,
    text: `\n${indent}\\li{}\n${ulIndent}`,
    cursor: trimmedEnd + 1 + indent.length + lead,
  };
}

// A fresh `\ol{ \li{} }` (or `\ul`, per `kind`), cursor inside the `\li{}`.
// Inside an item it is nested at the end of that item's content; elsewhere it
// goes on its own line after the cursor's line.
function insertList(text, cursorOff, kind) {
  const { lis } = contextAt(text, cursorOff);
  const lines = [`\\${kind}{`, "  \\li{\0}", "}"];
  if (lis[0]) return appendBlock(text, lis[0], lines);
  let eol = text.indexOf("\n", cursorOff);
  if (eol < 0) eol = text.length;
  const indent = indentOf(text, cursorOff);
  const str = `\n${indent}${lines.join(`\n${indent}`)}`;
  return {
    start: eol,
    end: eol,
    text: str.replace("\0", ""),
    cursor: eol + str.indexOf("\0"),
  };
}

// `[[@name]]`, accepting the name with or without its leading `@`.
function personLink(name) {
  return `[[@${name.trim().replace(/^@/, "")}]]`;
}

// `\p{}` at the end of the cursor's `\subtree`, or of the page.
function appendP(text, cursorOff) {
  return appendBlock(text, contextAt(text, cursorOff).scope, ["\\p{\0}"]);
}

// `\subtree{\title{}}` at the end of the cursor's `\subtree`, or of the page.
function insertSubtree(text, cursorOff) {
  return appendBlock(
    text,
    contextAt(text, cursorOff).scope,
    ["\\subtree{", "  \\title{\0}", "}"],
    true,
  );
}

// Insert `\tag{}` after the last line of the leading header block.
function insertTag(text) {
  const lines = text.split("\n");
  let offs = 0;
  let endOff = 0; // offset just past the last header line (incl. its \n)
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (HEADER.test(line)) {
      // Swallow continuation lines of an unbalanced header command.
      let depth = 0;
      let j = i;
      let consumed = 0;
      for (; j < lines.length; j++) {
        const l = lines[j];
        if (j === i && /^\s*%/.test(l)) {
          consumed += l.length + 1;
          break;
        }
        for (let k = 0; k < l.length; k++) {
          if (l[k] === "\\") k++;
          else if (l[k] === "{") depth++;
          else if (l[k] === "}") depth--;
        }
        consumed += l.length + 1;
        if (depth <= 0) break;
      }
      offs += consumed;
      endOff = Math.min(offs, text.length);
      i = j + 1;
      continue;
    }
    if (/^\s*$/.test(line) || /^\s*%/.test(line)) {
      offs += line.length + 1;
      i++;
      continue;
    }
    break;
  }
  const atEof = endOff >= text.length;
  const noHeader = endOff === 0;
  let prefix = "";
  if (!noHeader && atEof && !text.endsWith("\n")) prefix = "\n";
  const suffix = noHeader && text.length > 0 ? "\n" : "";
  const ins = `${prefix}\\tag{}\n${suffix}`;
  return {
    start: endOff,
    end: endOff,
    text: ins,
    cursor: endOff + prefix.length + "\\tag{".length,
  };
}

module.exports = {
  scanSpans,
  insertLi,
  insertList,
  personLink,
  appendP,
  insertSubtree,
  insertTag,
};
