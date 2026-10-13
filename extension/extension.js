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

function activate(context) {
  const reg = (id, fn) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, () => apply(fn)));
  context.subscriptions.push(
    vscode.commands.registerCommand("forestEdit.build", build),
    vscode.commands.registerCommand("forestEdit.touchDate", touchDate),
  );
  reg("forestEdit.insertLi", (t, c) => edits.insertLi(t, c, "inner"));
  reg("forestEdit.insertLiParent", (t, c) => edits.insertLi(t, c, "parent"));
  reg("forestEdit.insertLiOutermost", (t, c) => edits.insertLi(t, c, "outermost"));
  reg("forestEdit.insertLiRoot", (t, c) => edits.insertLi(t, c, "root"));
  reg("forestEdit.appendP", (t, c) => edits.appendP(t, c));
  reg("forestEdit.insertSubtree", (t, c) => edits.insertSubtree(t, c));
  reg("forestEdit.insertTag", (t) => edits.insertTag(t));
}

module.exports = { activate };
