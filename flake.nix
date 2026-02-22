{
  description = "OpenSCAD Web Parameter Editor — static SPA";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = [
            pkgs.nodejs_22
            pkgs.nodePackages.npm
          ];
        };

        packages.default = pkgs.buildNpmPackage {
          pname = "openscad-web-generator";
          version = "0.1.0";
          src = ./.;

          npmDepsHash = "";  # Must be filled after first npm install

          buildPhase = ''
            node scripts/build.mjs
          '';

          installPhase = ''
            mkdir -p $out
            cp -r dist/* $out/
          '';
        };
      }
    );
}
