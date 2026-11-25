{
  description = "koutube - YouTube embed fixer (standalone Node edition)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (pkgs:
        let
          # node:sqlite needs Node >= 22.5; track the newest LTS in nixpkgs.
          nodejs = pkgs.nodejs_24;
          # Only files the build needs (keeps the derivation from rebuilding on README edits etc.).
          src = pkgs.lib.fileset.toSource {
            root = ./.;
            fileset = pkgs.lib.fileset.unions [
              ./package.json
              ./package-lock.json
              ./tsconfig.json
              ./schema.sql
              ./src
            ];
          };
        in
        rec {
          koutube = pkgs.buildNpmPackage {
            pname = "koutube";
            version = "1.0.0";
            inherit src nodejs;

            # Update with `nix build` after changing package-lock.json: set to
            # pkgs.lib.fakeHash, build, and copy the "got:" hash.
            npmDepsHash = "sha256-WZK/ExY/7FNFHegMyfWT6LLbclv+7d1qapAzQQu3JVc=";

            # puppeteer's postinstall would download a Chromium that cannot run
            # on NixOS; the wrapper points it at nixpkgs' chromium instead.
            env.PUPPETEER_SKIP_DOWNLOAD = "1";

            nativeBuildInputs = [ pkgs.makeWrapper ];

            # `npm run build` (tsc -> dist/) is the default buildPhase.
            # npm pack would drop the gitignored dist/, so install by hand.
            dontNpmInstall = true;
            installPhase = ''
              runHook preInstall

              # Drop devDependencies (typescript, tsx, @types/*).
              npm prune --omit=dev --no-audit --no-fund

              app=$out/lib/koutube
              mkdir -p $app $out/bin
              cp -r dist node_modules package.json schema.sql $app/

              # schema.sql is read from process.cwd() (src/db.ts), and the
              # store is read-only, so the wrapper cd's into $app and moves the
              # writable state to DATA_DIR (default: $XDG_STATE_HOME/koutube).
              cat > $out/bin/koutube <<WRAPPER
              #!${pkgs.runtimeShell}
              : "\''${DATA_DIR:=\''${XDG_STATE_HOME:-\$HOME/.local/state}/koutube}"
              export DATA_DIR
              : "\''${PUPPETEER_EXECUTABLE_PATH:=${pkgs.lib.getExe pkgs.chromium}}"
              export PUPPETEER_EXECUTABLE_PATH
              cd $app
              exec ${pkgs.lib.getExe nodejs} dist/server.js "\$@"
              WRAPPER
              chmod +x $out/bin/koutube

              # Maintenance commands (same cwd/DATA_DIR handling).
              for cmd in init-db db-maintenance; do
                sed "s|dist/server.js|dist/$cmd.js|" $out/bin/koutube > $out/bin/koutube-$cmd
                chmod +x $out/bin/koutube-$cmd
              done

              runHook postInstall
            '';

            meta = {
              description = "YouTube embed fixer for Discord and other messengers (standalone Node edition)";
              license = pkgs.lib.licenses.gpl3Only;
              mainProgram = "koutube";
              platforms = systems;
            };
          };
          default = koutube;
        });

      apps = forAllSystems (pkgs: {
        default = {
          type = "app";
          program = "${self.packages.${pkgs.stdenv.hostPlatform.system}.koutube}/bin/koutube";
          meta.description = "Run the koutube server";
        };
      });

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.nodejs_24 pkgs.chromium ];
          # Puppeteer must not download its own (non-NixOS-compatible) Chromium.
          PUPPETEER_SKIP_DOWNLOAD = "1";
          PUPPETEER_EXECUTABLE_PATH = pkgs.lib.getExe pkgs.chromium;
        };
      });

      formatter = forAllSystems (pkgs: pkgs.nixpkgs-fmt);
    };
}
