# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

Single source for the Forester + VS Code setup built around the `ocaml-forester`
fork: the `forest-keeper` patch pin, the local `forester-edit` extension
(structural inserts, build, touch-date), the helper scripts, the dev shell, and
the keybindings/settings. Consumed by `dots` (home-manager VS Code profile, via
`lib.vscodeFeature`) and by the `forest` project (dev shell).

## Layout

- `flake.nix` — outputs: `packages`, `devShells`, `lib.{vscodeFeature,mkDevShell,mkPackages}`.
- `nix/packages.nix` — forest-keeper pin + patches, forester-edit, scripts, `build-forest`/`serve-forest`/`touch-date`.
- `nix/vscode-feature.nix` — settings and keybindings (user-scoped; VS Code has no workspace keybindings).
- `extension/` — the `forester-edit` VS Code extension (plain JS, no build step).
- `scripts/` — python helpers run by `build-forest` / `touch-date`. Set `VSCODE_FORESTER_SCRIPTS=<checkout>/scripts`
  to run edited copies without rebuilding.

## Git integration

Integrate finished branches into `main` with a local `git merge --no-ff <branch>`
(no PR, no squash). Do not push unless explicitly asked.
