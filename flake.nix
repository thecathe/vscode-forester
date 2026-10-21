{
  description = "VS Code + tooling setup for Forester, built around the ocaml-forester fork";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
    forester.url = "github:thecathe/ocaml-forester/redirect-meta";
    systems.url = "github:nix-systems/default";
  };

  outputs = {
    nixpkgs,
    systems,
    forester,
    ...
  }: let
    eachSystem = nixpkgs.lib.genAttrs (import systems);

    mkPackages = pkgs:
      import ./nix/packages.nix {
        inherit pkgs;
        forester = forester.packages.${pkgs.stdenv.hostPlatform.system}.default;
      };

    mkDevShell = pkgs: let
      p = mkPackages pkgs;
    in
      pkgs.mkShell {
        nativeBuildInputs = [pkgs.git];
        buildInputs = [
          p.python
          forester.packages.${pkgs.stdenv.hostPlatform.system}.default
          p.tex
          p.serve-forest
          p.build-forest
          p.touch-date
        ];
      };
  in {
    packages = eachSystem (system: let
      p = mkPackages nixpkgs.legacyPackages.${system};
    in {
      inherit (p) forest-keeper forester-edit scripts build-forest serve-forest touch-date;
      # CHROMIUM-XSLT-STOPGAP: drop this export on Forester 6.0.
      inherit (p) render-forest-html;
      default = p.build-forest;
    });

    devShells = eachSystem (system: {
      default = mkDevShell nixpkgs.legacyPackages.${system};
    });

    lib = {
      inherit mkPackages mkDevShell;
      # `{extensions, settings, keybindings}` for a home-manager VS Code
      # profile; pass the consuming configuration's own `pkgs`.
      vscodeFeature = pkgs: import ./nix/vscode-feature.nix {packages = mkPackages pkgs;};
    };
  };
}
