{
  description = "OpenSCAD Web Parameter Editor — static SPA";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
          config.android_sdk.accept_license = true;
        };
        androidSdk = pkgs.androidenv.composeAndroidPackages {
          buildToolsVersions = [ "34.0.0" "35.0.0" ];
          platformVersions = [ "35" ];
          includeEmulator = false;
          includeNDK = false;
          includeSources = false;
          includeSystemImages = false;
        };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = [
            pkgs.nodejs_22
            pkgs.nodePackages.npm
            pkgs.gnumake
            pkgs.gradle
            pkgs.jdk17
            pkgs.android-tools
          ];

          JAVA_HOME = "${pkgs.jdk17}";
          ANDROID_HOME = "${androidSdk.androidsdk}/libexec/android-sdk";
        };

        packages.openscad-wasm = pkgs.callPackage ./nix/openscad-wasm.nix {};

        packages.default = pkgs.buildNpmPackage {
          pname = "openscad-web-generator";
          version = "0.1.0";
          src = ./.;

          npmDepsHash = "sha256-bdV2QOLNFT2cX5XbULzes3pGjUeylSdWCPz4OdNV710=";

          buildPhase = ''
            node scripts/build.mjs --skip-wasm
          '';

          installPhase = ''
            mkdir -p $out
            cp -r dist/* $out/
          '';
        };
      }
    );
}
