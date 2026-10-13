{
  pkgs,
  forester,
}: let
  inherit (pkgs) lib;

  # forest-keeper is pinned to an explicit marketplace version+hash, rather
  # than pkgs.nix-vscode-extensions...kaierikniermann.forest-keeper, which
  # always resolves to whatever version happens to be cached in that flake
  # input's daily-refreshed snapshot. The patches below target exact string
  # literals inside this version's *compiled* JS; an unpinned reference could
  # silently pick up a newer forest-keeper build on a future `nix flake update`
  # whose minified output no longer matches those literals, breaking the patch
  # without any obvious error. Bump the version/hash here deliberately when
  # actually upgrading, so that's a conscious, re-verified step.
  #
  # forest-keeper's compiled LTeX integration hardcodes the extension ID
  # "valentjn.vscode-ltex" (both in out/languageToolIntegration.js and the
  # bundled out/extension.js) to find-and-force-activate the LTeX companion,
  # bypassing that extension's own activationEvents entirely. We run
  # ltex-plus.vscode-ltex-plus instead (the actively maintained fork), so patch
  # forest-keeper's compiled JS to look for that ID instead, keeping the
  # enable-prompt, auto-trigger-on-open/save and "Check All Tree Files"
  # command working.
  #
  # forest-keeper's "New Tree" also insists on a non-empty prefix: with
  # forester.defaultPrefix = "" it prompts for one, and an empty answer or
  # Escape silently cancels, so there is no way to create an unprefixed tree
  # (`forester new --random` with no `--prefix`, as the CLI allows). Patch
  # three spots in out/extension.js so that an empty defaultPrefix means "no
  # prefix": return it without prompting, treat only `undefined` (a real
  # cancel) as an abort, and omit `--prefix` entirely when it is empty. It is
  # omitted rather than passed as "" because forester's id allocator treats
  # `Some ""` as a different namespace from the unprefixed trees, which would
  # skip its collision check against them. The minified identifiers (vC, i, y)
  # are specific to 0.4.17; --replace-fail makes a version bump fail loudly.
  #
  # The stock "New Tree" always asks for a title and refuses an empty one.
  # Add a second command, forester.newTreeUntitled, that runs the same flow
  # with the title prompt skipped (the tree gets \date and \author only), via
  # a `noTitle` option on createNewTree (qC) threaded through the command
  # wrapper (ag). forester.newTree itself is left as is, so the two can be
  # bound separately (see nix/vscode-feature.nix).
  forest-keeper =
    (pkgs.vscode-utils.buildVscodeMarketplaceExtension {
      mktplcRef = {
        publisher = "KaiErikNiermann";
        name = "forest-keeper";
        version = "0.4.17";
        hash = "sha256-VYdoEHWbSO2nABtCKEXuektljnxx32O/5IXvEImHDmU=";
      };
    }).overrideAttrs
    (old: {
      postPatch =
        (old.postPatch or "")
        + ''
          substituteInPlace out/languageToolIntegration.js out/extension.js \
            --replace-fail 'valentjn.vscode-ltex' 'ltex-plus.vscode-ltex-plus'

          substituteInPlace out/extension.js \
            --replace-fail 'defaultPrefix");if(e)return e;' 'defaultPrefix");if(e!==void 0)return e;' \
            --replace-fail 'await vC();if(!i)return;' 'await vC();if(i===void 0)return;' \
            --replace-fail '"--prefix",i,...y?' '...i?["--prefix",i]:[],...y?'

          substituteInPlace out/extension.js \
            --replace-fail 'let o=await MC({prompt:"Enter title for the new tree' 'let o=t.noTitle?{taxon:void 0,title:void 0}:await MC({prompt:"Enter title for the new tree' \
            --replace-fail 'async function ag(t,e){let n=await qC({destFolder:t,fromTemplate:e});' 'async function ag(t,e,u){let n=await qC({destFolder:t,fromTemplate:e,noTitle:u});' \
            --replace-fail '$.commands.registerCommand("forester.newTree",b=>ag(b,!1)),' '$.commands.registerCommand("forester.newTree",b=>ag(b,!1)),$.commands.registerCommand("forester.newTreeUntitled",b=>ag(b,!1,!0)),'

          # `forester new` prints the new tree's path on stdout, but also any
          # config warnings (e.g. "Uninterpreted config option:
          # forest.meta.date.page", which the fork reports for options only
          # read by scripts/forest_gen.py). forest-keeper used the whole of
          # stdout as the path and then failed to open the file it had just
          # created. Keep only the line that names a .tree file. The call is
          # `(await PC([...]))?.trim()`, so it is already a string here (no
          # `.then`); `?.` keeps the undefined-on-failure behaviour.
          substituteInPlace out/extension.js \
            --replace-fail ':[]]))?.trim();if(!x){' ':[]]))?.split(/\r?\n/).map(fe=>fe.trim()).filter(fe=>fe.endsWith(".tree")).pop();if(!x){'
        '';
    });

  # Local extension (../extension) for structural insertions that need
  # buffer-level brace matching and cursor placement, plus the build and
  # touch-date commands that wrap the scripts below.
  forester-edit = pkgs.vscode-utils.buildVscodeExtension {
    pname = "forester-edit";
    version = "0.2.0";
    # named "extension" because buildVscodeExtension expects that source root
    src = builtins.path {
      path = ../extension;
      name = "extension";
    };
    vscodeExtPublisher = "thecathe";
    vscodeExtName = "forester-edit";
    vscodeExtUniqueId = "thecathe.forester-edit";
  };

  python = pkgs.python3;

  scripts = pkgs.runCommand "vscode-forester-scripts" {} ''
    mkdir -p $out/share/vscode-forester
    cp -r ${../scripts} $out/share/vscode-forester/scripts
  '';
  scriptsDir = "${scripts}/share/vscode-forester/scripts";

  tex = pkgs.texliveSmall.withPackages (ps:
    with ps; [
      dvisvgm
      standalone
      tcolorbox
      pgf
      environ
      tikzfill
      pdfcol
      listings
      listingsutf8
      amsmath
    ]);

  serve-forest = pkgs.writeShellScriptBin "serve-forest" ''
    exec ${python}/bin/python3 -m http.server 1313 -d output
  '';

  touch-date = pkgs.writeShellScriptBin "touch-date" ''
    exec ${python}/bin/python3 ${scriptsDir}/touch_date.py "$@"
  '';

  # See scripts/embed_images.py and scripts/unpad_svgs.py for why these are
  # needed. embed_images always runs; unpad_svgs runs by default (pass --pad
  # to skip it) and is stripped out before forwarding arguments to `forester
  # build` since forester doesn't know it. Any breathing room an embedded
  # \tex{}{} artefact needs back is added deliberately via the \padded macro
  # rather than inherited from dvisvgm's margin.
  #
  # Self-contained: carries its own PATH (forester fork, python, texlive,
  # rsvg, imagemagick), so the editor can invoke it by store path without any
  # direnv/devShell having been loaded. Set VSCODE_FORESTER_SCRIPTS to a
  # checkout's scripts/ dir to run edited scripts without rebuilding.
  build-forest = pkgs.writeShellScriptBin "build-forest" ''
    set -euo pipefail
    export PATH="${lib.makeBinPath [python forester tex pkgs.coreutils pkgs.findutils]}:$PATH"
    # Let \includegraphics{foo.png} inside \tex{}{} card bodies resolve bare
    # filenames against the forest's own assets/ dir, since LaTeX compiles in
    # a throwaway temp directory with no knowledge of the forest's layout. The
    # trailing colon keeps the default TeX search paths too.
    export TEXINPUTS="$PWD/assets:''${TEXINPUTS:-}"
    unpad=true
    strict=()
    config=forest.toml
    args=()
    for arg in "$@"; do
      case "$arg" in
        --unpad) unpad=true ;;
        --pad) unpad=false ;;
        --strict-private) strict=(--strict) ;;
        *.toml) config="$arg"; args+=("$arg") ;;
        *) args+=("$arg") ;;
      esac
    done
    script() {
      if [ -n "''${VSCODE_FORESTER_SCRIPTS:-}" ] && [ -f "$VSCODE_FORESTER_SCRIPTS/$1" ]; then
        echo "$VSCODE_FORESTER_SCRIPTS/$1"
      else
        echo "${scriptsDir}/$1"
      fi
    }
    # Generate stub/tag pages into trees/_generated and warn about links to
    # hidden trees (see scripts/forest_gen.py). --strict-private makes any
    # such link fail the build.
    python3 "$(script forest_gen.py)" all --config "$config" "''${strict[@]}"
    forester build "''${args[@]}"
    find assets -maxdepth 1 -type f ! -name '.gitkeep' -exec cp -t output -- {} +
    cd output
    python3 "$(script embed_images.py)"
    if "$unpad"; then
      python3 "$(script unpad_svgs.py)" ${pkgs.librsvg}/bin/rsvg-convert ${pkgs.imagemagick}/bin/magick
    fi
  '';
in {
  inherit
    forest-keeper
    forester-edit
    scripts
    build-forest
    serve-forest
    touch-date
    tex
    python
    ;
}
