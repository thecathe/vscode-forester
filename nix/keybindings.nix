# The Forester keybindings, as data. Used twice (see ./vscode-feature.nix and
# ./packages.nix): as the VS Code keybindings, and, via `label`/`group`
# (entries without a `label` are left out), as the cheatsheet shown by
# forestEdit.showCheatsheet. Editing a bind here updates both.
let
  when = "editorTextFocus && resourceExtname == '.tree'";
  anywhere = "workbenchState != empty";
in [
  # Both of these save first, then run the wrapped script (see
  # ../extension/extension.js).
  {
    key = "ctrl+shift+d";
    command = "forestEdit.touchDate";
    inherit when;
    group = "Tools";
    label = "Touch \\date{} (saves first)";
  }
  {
    key = "ctrl+alt+r";
    command = "forestEdit.build";
    inherit when;
    group = "Tools";
    label = "Build forest (saves first)";
  }
  {
    key = "shift+alt+r";
    command = "forester.refreshTreeView";
    inherit when;
    group = "Tools";
    label = "Refresh tree view";
  }
  {
    key = "ctrl+alt+shift+r";
    command = "forester.restartLanguageServer";
    inherit when;
    group = "Tools";
    label = "Restart language server";
  }
  {
    key = "ctrl+alt+f";
    command = "forester.formatAllTrees";
    inherit when;
    group = "Tools";
    label = "Format all trees";
  }
  {
    key = "ctrl+alt+h";
    command = "forestEdit.showCheatsheet";
    inherit when;
    group = "Tools";
    label = "Show this cheatsheet";
  }
  # ctrl+t / ctrl+shift+t are not limited to .tree editors: a new tree can be
  # started from anywhere in the window (explorer, terminal via
  # commandsToSkipShell, ...). The `when` only requires an open folder; it
  # also keeps the chord distinct from the unbinds of the defaults, which
  # mkProfile's duplicate check compares by key + when.
  {
    key = "ctrl+t";
    command = "forester.newTreeUntitled";
    when = anywhere;
    group = "Trees";
    label = "New tree, no title prompt (anywhere)";
  }
  # Frees ctrl+shift+t (VS Code's "Reopen Closed Editor") for the titled
  # variant below.
  {
    key = "ctrl+shift+t";
    command = "-workbench.action.reopenClosedEditor";
  }
  {
    key = "ctrl+shift+t";
    command = "forester.newTree";
    when = anywhere;
    group = "Trees";
    label = "New tree, ask for title (anywhere)";
  }
  # forest-keeper binds Rename Tree to ctrl+r by default, which shadows VS Code's
  # "File: Open Recent..." in .tree editors. Unbind that (the `when` must match
  # the extension's own for the removal to apply) and move it to ctrl+shift+r,
  # which dots already frees from Refactor.
  {
    key = "ctrl+r";
    command = "-forester.renameTree";
    when = "editorTextFocus && resourceExtname == .tree";
  }
  {
    key = "ctrl+shift+r";
    command = "forester.renameTree";
    inherit when;
    group = "Trees";
    label = "Rename tree";
  }
  # Structural inserts (see ../extension). All leave the cursor between the
  # new braces. These shadow VS Code's Trigger Suggest (ctrl+i) and Toggle
  # Developer Tools (ctrl+shift+i) in .tree editors only.
  {
    key = "ctrl+i";
    command = "forestEdit.insertLi";
    inherit when;
    group = "Lists";
    label = "\\li{} after the current item, innermost \\ul/\\ol";
  }
  {
    key = "ctrl+shift+i";
    command = "forestEdit.insertLiParent";
    inherit when;
    group = "Lists";
    label = "\\li{} one list out from the innermost";
  }
  {
    key = "ctrl+alt+i";
    command = "forestEdit.insertLiOutermost";
    inherit when;
    group = "Lists";
    label = "\\li{} in the outermost list";
  }
  {
    key = "ctrl+shift+alt+i";
    command = "forestEdit.insertLiRoot";
    inherit when;
    group = "Lists";
    label = "\\li{} in a fresh \\ul{} at the end of the tree";
  }
  # Lists nest inside the current \li{}, else go after the cursor's line.
  # Shadow Open File (ctrl+o) and Cursor Undo (ctrl+u) in .tree editors only.
  {
    key = "ctrl+o";
    command = "forestEdit.insertOl";
    inherit when;
    group = "Lists";
    label = "New \\ol{\\li{}}";
  }
  {
    key = "ctrl+u";
    command = "forestEdit.insertUl";
    inherit when;
    group = "Lists";
    label = "New \\ul{\\li{}}";
  }
  {
    key = "ctrl+alt+u";
    command = "forestEdit.listToUl";
    inherit when;
    group = "Lists";
    label = "Convert the innermost \\ol{} to \\ul{}";
  }
  {
    key = "ctrl+alt+o";
    command = "forestEdit.listToOl";
    inherit when;
    group = "Lists";
    label = "Convert the innermost \\ul{} to \\ol{}";
  }
  {
    key = "ctrl+alt+t";
    command = "forestEdit.insertSubtree";
    inherit when;
    group = "Structure";
    label = "\\subtree{\\title{}} at the end of the enclosing subtree";
  }
  # Frees Quick Open; shadows the Command Palette in .tree editors (F1
  # still opens it).
  {
    key = "ctrl+shift+p";
    command = "forestEdit.appendP";
    inherit when;
    group = "Structure";
    label = "\\p{} at the end of the enclosing subtree";
  }
  # Person links: picker over trees/people/ (can create), and a bare [[@]].
  {
    key = "ctrl+'";
    command = "forestEdit.insertPersonLink";
    inherit when;
    group = "Links";
    label = "[[@person]] from trees/people (or create)";
  }
  {
    key = "ctrl+shift+'";
    command = "forestEdit.insertPersonLinkBlank";
    inherit when;
    group = "Links";
    label = "[[@]], cursor after the @";
  }
  # The UK `#` key is the physical Backslash key. "ctrl+#" is not a name
  # VS Code's keybinding parser knows, so that spelling never matched; the
  # scancode form is layout-independent. Shadows Split Editor in .tree
  # editors only. Ordered after ctrl+' because VS Code also maps this key
  # to the ' key code, and the later bind wins.
  {
    key = "ctrl+[Backslash]";
    command = "forestEdit.insertTag";
    inherit when;
    group = "Structure";
    label = "\\tag{} in the header";
  }
]
