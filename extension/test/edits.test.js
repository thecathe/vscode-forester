const test = require("node:test");
const assert = require("node:assert");
const e = require("../edits");

// Apply `fn(text, cursor)` to `src`, where `|` marks the cursor. Returns the
// new document with `|` marking the resulting cursor.
function run(src, fn) {
  const c = src.indexOf("|");
  const text = src.replace("|", "");
  const r = fn(text, c);
  const out = text.slice(0, r.start) + r.text + text.slice(r.end);
  return out.slice(0, r.cursor) + "|" + out.slice(r.cursor);
}
const li = (level) => (t, c) => e.insertLi(t, c, level);

test("li goes right after the current item, not at the end of the list", () => {
  assert.strictEqual(
    run("\\ul{\n  \\li{a|}\n  \\li{b}\n}\n", li("inner")),
    "\\ul{\n  \\li{a}\n  \\li{|}\n  \\li{b}\n}\n",
  );
});

test("works inside \\ol like \\ul", () => {
  assert.strictEqual(
    run("\\ol{\n  \\li{a|}\n  \\li{b}\n}\n", li("inner")),
    "\\ol{\n  \\li{a}\n  \\li{|}\n  \\li{b}\n}\n",
  );
});

test("nested lists are skipped: new item follows the whole outer item", () => {
  assert.strictEqual(
    run("\\ul{\n  \\li{a \\ol{\n    \\li{n}\n  }|}\n  \\li{b}\n}\n", li("inner")),
    "\\ul{\n  \\li{a \\ol{\n    \\li{n}\n  }}\n  \\li{|}\n  \\li{b}\n}\n",
  );
});

test("inner level inside a nested list stays in the nested list", () => {
  assert.strictEqual(
    run("\\ul{\n  \\li{a \\ol{\n    \\li{n|}\n  }}\n}\n", li("inner")),
    "\\ul{\n  \\li{a \\ol{\n    \\li{n}\n    \\li{|}\n  }}\n}\n",
  );
});

test("cursor between items inserts before the next item", () => {
  assert.strictEqual(
    run("\\ul{\n  \\li{a}\n|\n  \\li{b}\n}\n", li("inner")),
    "\\ul{\n  \\li{a}\n\n  \\li{|}\n  \\li{b}\n}\n",
  );
});

test("cursor after the last item appends at the end of the list", () => {
  assert.strictEqual(
    run("\\ul{\n  \\li{a}\n|}\n", li("inner")),
    "\\ul{\n  \\li{a}\n  \\li{|}\n}\n",
  );
});

test("no enclosing list makes a fresh \\ul at the end of the page", () => {
  assert.strictEqual(
    run("\\p{x|}\n", li("inner")),
    "\\p{x}\n\n\\ul{\n  \\li{|}\n}\n",
  );
});

test("insertList nests inside the current item", () => {
  assert.strictEqual(
    run("\\ul{\n  \\li{a|}\n}\n", (t, c) => e.insertList(t, c, "ol")),
    "\\ul{\n  \\li{a\n    \\ol{\n      \\li{|}\n    }\n  }\n}\n",
  );
});

test("insertList outside an item goes after the cursor's line", () => {
  assert.strictEqual(
    run("\\p{hi|}\n", (t, c) => e.insertList(t, c, "ol")),
    "\\p{hi}\n\\ol{\n  \\li{|}\n}\n",
  );
});

test("personLink normalises a leading @", () => {
  assert.strictEqual(e.personLink(" @bob "), "[[@bob]]");
  assert.strictEqual(e.personLink("bob"), "[[@bob]]");
});
