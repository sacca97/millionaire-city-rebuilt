# Desktop app (Electron)

Packs the TypeScript rewrite as a double-click app: Electron window + the bundled game server (esbuild bundle run by a bundled Node
runtime, so `better-sqlite3` needs no Electron rebuild) + the client with the optimised art from `apps/client/public-opt`.
Saves go to the OS user-data folder (`~/Library/Application Support/Millionaire City/data/mcity.sqlite` on macOS,
`~/.config/Millionaire City/data/` on Linux, `%APPDATA%` on Windows; `server.log` sits beside it).

Needs Node >= 22.12. Build on the OS **and CPU architecture** you target (the SQLite native module and the Node runtime are per
platform; the build refuses to cross-build). Rebuild `node_modules` and `tools/app/stage` on each machine, never copy them.

```
npm ci                       # repo root, once
npm run dev:desktop          # stage + start the app in Electron (development)
npm run package:mac          # native macOS zip (also package:mac:arm64 / package:mac:x64)
npm run package:linux        # Linux x64 zip
npm run package:win          # Windows x64 zip
```

The zip lands in `tools/app/release/`. Under the hood: `node tools/app/build.mjs [--pack] [electron-builder args]`.

- **Electron** 44.7.0, **electron-builder** 26.15.3 (pinned in `tools/app/package.json`). `ensure-electron.cjs` downloads the Electron
  runtime when `npm ci --ignore-scripts` or a blocked network skipped it.
- **macOS:** Homebrew's `node` is a launcher around `libnode.dylib` and crashes when copied alone, so the build downloads the official
  standalone Node of the same version into `tools/app/.cache`. Use a native ARM64 Node on Apple Silicon.
- After staging, the build starts the bundled Node, checks its CPU architecture and opens an in-memory SQLite database; it stops if any of
  that fails. A server that dies at runtime is reported with its exit code or termination signal.
- The app is not code-signed: macOS needs right-click > Open on first start, Windows SmartScreen shows a warning.
- CI: `.github/workflows/build-portable.yml` (manual) builds Windows, Linux, macOS Apple Silicon and macOS Intel packages.
