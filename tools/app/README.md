# Desktop bundle (Electron)

Packs the TypeScript rewrite as a double-click app: Electron window + bundled game server (esbuild bundle run by a bundled Node
runtime, so `better-sqlite3` needs no Electron rebuild) + the client (optimised assets when `apps/client/public-opt` exists).
Saves go to the OS user-data folder (`~/.config/Millionaire City/data/mcity.sqlite` on Linux, `server.log` beside it).

Build on the OS you target (native module + Node runtime are per platform), Node 20+:

```
npm ci                     # repo root (once)
cd tools/app && npm install
node build.mjs --pack      # -> tools/app/release/MillionaireCity-<version>-<os>-<arch>.zip
```

`node build.mjs` alone only stages `tools/app/stage` (run `stage/runtime/node/node stage/apps/server/dist/main.js` to test the server).
Linux: the unpacked app is `release/linux-unpacked/millionaire-city-app` (use `--no-sandbox` if the chrome sandbox is not set up).
Not code-signed: macOS needs right-click > Open on first start, Windows SmartScreen shows a warning.
