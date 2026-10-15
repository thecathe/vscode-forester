# The VS Code side of the setup, as a `{extensions, settings, keybindings}`
# attrset (the shape home-manager profile "features" use). `packages` is the
# result of ./packages.nix for the target system.
{packages}: {
  extensions = [
    packages.forest-keeper
    packages.forester-edit
  ];

  settings = {
    # Let the new-tree keybinds fire while the integrated terminal has focus.
    "terminal.integrated.commandsToSkipShell" = [
      "forester.newTree"
      "forester.newTreeUntitled"
    ];
    "forester.completion.showID" = true;
    "forester.config" = ""; # should be edited per workspace, instead of globally
    # No global author: new trees get theirs from `[forest.new] author` in each
    # project's forest.toml (written by the forester fork's `forester new`).
    # forest-keeper only falls back to forester.create.author when no \author
    # is present, so leaving it unset avoids a stray, differently-spelled one.
    "forester.create.openNewTreeMode" = "active";
    "forester.create.random" = true;
    "forester.decorations.enabled" = true;
    "forester.defaultPrefix" = "";
    "forester.defaultTemplate" = "(No template)";
    "forester.formatter.autoScanMacros" = true;
    "forester.formatter.ignoredCommands" = ["meta" "taxon"];
    "forester.graphView.excludedNodes" = [
      "basic-macros"
    ];
    "forester.hover.latex.enabled" = true;
    "forester.hover.latex.preambleMacro" = "";
    "forester.hover.latex.texInputs" = [];
    "forester.hover.latex.useProjectPreamble" = true;
    "forester.inlayHints.paramNames.enabled" = false;
    "forester.inlayHints.tagClosures.enabled" = true;
    "forester.inlayHints.tagClosures.tags" = [
      "ol"
      "ul"
      "li"
      "p"
      "subtree"
      "##"
      "tex"
      "texmath"
      "solution"
    ];
    "forester.languageTool.enable" = false;
    "forester.languageTool.javaOpts" = "";
    "forester.languageTool.language" = "en";
    "forester.path" = "forester";
    "forester.taxonCustomization" = {};
    # forester-edit's build / touch-date commands, pinned to self-contained
    # store paths so they work without a direnv/devShell having been loaded.
    "forestEdit.buildCommand" = "${packages.build-forest}/bin/build-forest";
    "forestEdit.touchDateCommand" = "${packages.touch-date}/bin/touch-date";
    # forest-keeper registers two definition providers for the same link (its
    # own client-side one, plus the bundled Langium language server's, which
    # deliberately points at a different location "so Peek shows meaningful
    # content") - two locations for one symbol is what makes VS Code default
    # to the Peek overlay on Ctrl+click instead of jumping straight there.
    "editor.gotoLocation.multipleDefinitions" = "goto";
    "editor.definitionLinkOpensInPeek" = false; # already VS Code's default; explicit for clarity
    "[forester]" = {
      "editor.wordWrap" = "on";
      "editor.tabSize" = 2;
      "editor.wordBasedSuggestions" = "off";
      "editor.formatOnSave" = false;
      "editor.formatOnPaste" = false;
      "editor.defaultFormatter" = "KaiErikNiermann.forest-keeper";
      # forest-keeper's language-configuration.json treats every "{"..."}" pair as a
      # folding region (not just block macros), so VS Code's minimap region-header
      # feature renders each macro name (e.g. \meta, \p) as an oversized header in
      # the minimap, clipped by the tiny per-line height. Suppress it for .tree files.
      "editor.minimap.showRegionSectionHeaders" = false;
    };
  };

  # Defined in ./keybindings.nix, which also feeds the in-editor cheatsheet.
  # `label`/`group` are for the cheatsheet only and stripped here, so
  # keybindings.json stays plain.
  keybindings =
    map (kb: builtins.removeAttrs kb ["label" "group"]) (import ./keybindings.nix);
}
