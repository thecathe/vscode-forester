const { execFile } = require("child_process");
const vscode = require("vscode");
const edits = require("./edits");

async function apply(compute) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const doc = editor.document;
  const text = doc.getText();
  const r = compute(text, doc.offsetAt(editor.selection.active));
  const range = new vscode.Range(doc.positionAt(r.start), doc.positionAt(r.end));
  if (!(await editor.edit((b) => b.replace(range, r.text)))) return;
  const pos = editor.document.positionAt(r.cursor);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos));
}

const setting = (key) => vscode.workspace.getConfiguration("forestEdit").get(key);

// Save the active tree (what the keybindings used to do via `runCommands`),
// so the scripts below see the buffer's latest contents.
async function saveActive() {
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.isDirty) await editor.document.save();
  return editor;
}

// Runs as a task (rather than a bare child process) so output lands in the
// shared task panel, as the old `Forester: Build Forest` task did.
async function build() {
  const editor = await saveActive();
  const folder =
    (editor && vscode.workspace.getWorkspaceFolder(editor.document.uri)) ||
    (vscode.workspace.workspaceFolders || [])[0];
  if (!folder) {
    vscode.window.showErrorMessage("Forester: no workspace folder to build.");
    return;
  }
  const task = new vscode.Task(
    { type: "forestEdit" },
    folder,
    "Build Forest",
    "forestEdit",
    new vscode.ShellExecution(setting("buildCommand"), [], { cwd: folder.uri.fsPath }),
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Shared,
    clear: true,
  };
  await vscode.tasks.executeTask(task);
}

// Rewrites the file on disk; VS Code reloads a clean buffer on its own.
async function touchDate() {
  const editor = await saveActive();
  if (!editor) return;
  execFile(setting("touchDateCommand"), [editor.document.uri.fsPath], (err, stdout, stderr) => {
    if (err) {
      vscode.window.showErrorMessage(`Forester: touch date failed: ${stderr || err.message}`);
    } else {
      vscode.window.setStatusBarMessage(stdout.trim(), 3000);
    }
  });
}

// Insert `text` at the cursor and leave the cursor after it.
async function insertAtCursor(editor, text) {
  const start = editor.document.offsetAt(editor.selection.active);
  if (!(await editor.edit((b) => b.replace(editor.selection, text)))) return;
  const pos = editor.document.positionAt(start + text.length);
  editor.selection = new vscode.Selection(pos, pos);
}

// `[[@]]` with the cursor after the `@`, for when the picker is overkill.
async function insertPersonLinkBlank() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const start = editor.document.offsetAt(editor.selection.active);
  if (!(await editor.edit((b) => b.replace(editor.selection, "[[@]]")))) return;
  const pos = editor.document.positionAt(start + "[[@".length);
  editor.selection = new vscode.Selection(pos, pos);
}

// Pick (or create) a person from trees/people/ and insert `[[@id]]`.
async function insertPersonLink() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const folder =
    vscode.workspace.getWorkspaceFolder(editor.document.uri) ||
    (vscode.workspace.workspaceFolders || [])[0];
  if (!folder) return;
  const peopleDir = vscode.Uri.joinPath(folder.uri, "trees", "people");
  let files = [];
  try {
    files = await vscode.workspace.fs.readDirectory(peopleDir);
  } catch (_) {
    // no people dir yet; creating a person will make it
  }
  const known = new Map(); // id (no @) -> title
  for (const [name] of files) {
    const m = /^@?(.+)\.tree$/.exec(name);
    if (!m) continue;
    let title = "";
    try {
      const raw = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(peopleDir, name));
      const t = /\\title\{([^}]*)\}/.exec(Buffer.from(raw).toString("utf8"));
      title = t ? t[1] : "";
    } catch (_) {}
    known.set(m[1], title);
  }

  const qp = vscode.window.createQuickPick();
  qp.title = "Link a person";
  qp.placeholder = "name (e.g. jpears); a new name creates trees/people/@<name>.tree";
  qp.matchOnDescription = true;
  const existing = [...known].map(([id, title]) => ({
    label: `@${id}`,
    description: title,
    id,
  }));
  const refresh = () => {
    const typed = qp.value.trim().replace(/^@/, "");
    const items = [...existing];
    if (typed && !known.has(typed)) {
      items.unshift({
        label: `$(add) Create @${typed}`,
        description: "new person",
        id: typed,
        create: true,
        alwaysShow: true,
      });
    }
    qp.items = items;
  };
  refresh();
  qp.onDidChangeValue(refresh);
  const pick = await new Promise((resolve) => {
    qp.onDidAccept(() => resolve(qp.selectedItems[0] || qp.activeItems[0]));
    qp.onDidHide(() => resolve(undefined));
    qp.show();
  });
  qp.dispose();
  if (!pick) return;

  if (pick.create) {
    const long = await vscode.window.showInputBox({
      title: `Full name for @${pick.id}`,
      prompt: "Used as \\title{} of the new person tree",
      validateInput: (v) => (v.trim() ? undefined : "A name is required"),
    });
    if (long === undefined) return;
    const author = vscode.workspace.getConfiguration("forestEdit").get("author");
    const date = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const body =
      `\\date{${date}}\n\\author{${author}}\n\\title{${long.trim()}}\n\\taxon{Person}\n`;
    await vscode.workspace.fs.createDirectory(peopleDir);
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(peopleDir, `@${pick.id}.tree`),
      Buffer.from(body, "utf8"),
    );
  }
  await insertAtCursor(editor, edits.personLink(pick.id));
}

// Quick Pick listing the Forester keybindings (generated from
// nix/keybindings.nix into cheatsheet.json). Esc dismisses; Enter runs the
// selected command in the editor that had focus.
const PRETTY = { "[Backslash]": "#", "'": "'" };
function prettyKey(key) {
  return key
    .split("+")
    .map((p) => PRETTY[p] || (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
    .join("+");
}

async function showCheatsheet(context) {
  let entries = [];
  try {
    const raw = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(context.extensionUri, "cheatsheet.json"),
    );
    entries = JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch (err) {
    vscode.window.showErrorMessage(`Forester: cannot read cheatsheet: ${err.message}`);
    return;
  }
  const items = [];
  let group;
  for (const e of entries) {
    if (e.group !== group) {
      group = e.group;
      items.push({ label: group, kind: vscode.QuickPickItemKind.Separator });
    }
    items.push({
      label: `${prettyKey(e.key).padEnd(18)} ${e.label}`,
      command: e.command,
    });
  }
  const pick = await vscode.window.showQuickPick(items, {
    title: "Forester keybindings",
    placeHolder: "filter; Enter runs the command, Esc closes",
    matchOnDescription: true,
  });
  if (pick && pick.command) await vscode.commands.executeCommand(pick.command);
}

function activate(context) {
  const reg = (id, fn) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, () => apply(fn)));
  context.subscriptions.push(
    vscode.commands.registerCommand("forestEdit.build", build),
    vscode.commands.registerCommand("forestEdit.touchDate", touchDate),
    vscode.commands.registerCommand("forestEdit.showCheatsheet", () => showCheatsheet(context)),
    vscode.commands.registerCommand("forestEdit.insertPersonLink", insertPersonLink),
    vscode.commands.registerCommand("forestEdit.insertPersonLinkBlank", insertPersonLinkBlank),
  );
  reg("forestEdit.insertLi", (t, c) => edits.insertLi(t, c, "inner"));
  reg("forestEdit.insertLiParent", (t, c) => edits.insertLi(t, c, "parent"));
  reg("forestEdit.insertLiOutermost", (t, c) => edits.insertLi(t, c, "outermost"));
  reg("forestEdit.insertLiRoot", (t, c) => edits.insertLi(t, c, "root"));
  reg("forestEdit.insertOl", (t, c) => edits.insertList(t, c, "ol"));
  reg("forestEdit.insertUl", (t, c) => edits.insertList(t, c, "ul"));
  reg("forestEdit.appendP", (t, c) => edits.appendP(t, c));
  reg("forestEdit.insertSubtree", (t, c) => edits.insertSubtree(t, c));
  reg("forestEdit.insertTag", (t) => edits.insertTag(t));
}

module.exports = { activate };
