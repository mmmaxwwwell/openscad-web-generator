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
          includeNDK = true;
          ndkVersions = [ "26.1.10909125" ];
          includeSources = false;
          includeSystemImages = false;
        };
        androidNdkPath = "${androidSdk.androidsdk}/libexec/android-sdk/ndk/26.1.10909125";
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
        packages.orcaslicer-deps = pkgs.callPackage ./nix/orcaslicer-deps.nix {};
        packages.orcaslicer-lib = pkgs.callPackage ./nix/orcaslicer-lib.nix {};
        packages.orcaslicer-wasm = pkgs.callPackage ./nix/orcaslicer-wasm.nix {};
        packages.orcaslicer-android-arm64 = pkgs.callPackage ./nix/orcaslicer-android.nix {
          androidNdk = androidNdkPath;
          androidAbi = "arm64-v8a";
        };
        packages.orcaslicer-android-arm32 = pkgs.callPackage ./nix/orcaslicer-android.nix {
          androidNdk = androidNdkPath;
          androidAbi = "armeabi-v7a";
        };

        packages.default = pkgs.buildNpmPackage rec {
          pname = "openscad-web-generator";
          version = "0.1.0";
          src = ./.;

          npmDepsHash = "sha256-bdV2QOLNFT2cX5XbULzes3pGjUeylSdWCPz4OdNV710=";

          # Pre-populate slicer WASM from Nix-built package (no network in sandbox)
          orcaslicerWasm = self.packages.${system}.orcaslicer-wasm;

          preBuild = ''
            mkdir -p public/wasm
            for f in ${orcaslicerWasm}/*; do
              cp "$f" public/wasm/
            done
          '';

          buildPhase = ''
            node scripts/build.mjs --skip-wasm --skip-slicer
          '';

          installPhase = ''
            mkdir -p $out
            cp -r dist/* $out/
          '';
        };
      }
    );
}
