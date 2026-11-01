# Desktop app (Tauri 2)

A Tauri window (system web view: WebKitGTK / WebView2 / WKWebView) around our web client. The Rust game server (`apps/server-rs`, crate
`mcity-server`, built as a library; the standalone binary is a thin wrapper) is **embedded in the app process**: it starts on its own tokio
runtime thread, binds `127.0.0.1` on a free port (HTTP only: no TLS listener, no Facebook shim, no Flash client copy, see
`ServerConfig.embedded`) and the window navigates to it after a splash page. No Flash, no Electron, no second process.

Why embedded and not a sidecar: one process and one binary to sign and ship, no port or stdout plumbing, no orphan server if the app is killed,
and the server already was a self-contained crate. The server thread is isolated from the UI thread.

## Commands

```
npm ci                  # repo root, once (client toolchain)
make app-dev            # run from the repository (debug build; resources found via the repo root)
make app                # installer for this OS: apps/desktop/src-tauri/target/release/bundle/
npm --prefix apps/desktop run build -- --bundles deb      # pick bundle types (deb, rpm, appimage, nsis, msi, dmg, app)
```

`tauri build` first runs `scripts/prepare.mjs` (builds `@mcity/shared` and the client; uses `public-opt` when present, `OPT=0` disables).
Needs Node >= 22.12, Rust, and on Linux `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libssl-dev libxdo-dev patchelf`
(Fedora: `webkit2gtk4.1-devel gtk3-devel librsvg2-devel openssl-devel libxdo-devel`). Build on the OS and CPU you target; `.github/workflows/build-portable.yml`
(manual) builds Linux (deb, rpm, AppImage), Windows (NSIS) and macOS arm64/x64 (dmg). Not code-signed. Only Linux has been run by hand; Windows and macOS are untested.

## Files

- `src-tauri/src/main.rs`: window, single instance, embedded server start/stop, paths. `tauri.conf.json`: bundle config; resources `assets/` and `apps/client/dist` are copied into the bundle under `workspace/` (the layout the server expects as `MCITY_WORKSPACE_ROOT`).
- `ui/index.html`: splash and server-error page. `icons/`: generated from `assets/window-icon.png` (`npm run icons`).

## Behaviour

- **Saves** (unchanged from the Electron app, existing players keep them): `<config dir>/millionaire-city-app/data/mcity.sqlite` with config dir
  `~/.config` (Linux), `~/Library/Application Support` (macOS), `%APPDATA%` (Windows). Backups (`data/backups/`, written by the server on tutorial restart) and `desktop.log` live beside it.
  (The old tools/app README said `Millionaire City/`; the real folder was `millionaire-city-app`.)
- **Overrides**: `MCITY_USER_DATA_DIR` (replaces the folder above, use it for tests), `MCITY_DB_PATH`, `MCITY_WORKSPACE_ROOT`.
- SQLite `synchronous=NORMAL` is set by default (single player, docs/rust-server-performance.md).
- One instance only (a second launch focuses the running window). Default window 1280x800, no menu bar on Windows/Linux, default menu on macOS.
- Navigation away from the local server is blocked. A server start failure is shown in the window and logged to `desktop.log`.
- Not carried over (Flash-only): Pepper Flash, the original client's launcher page and View menu, the Facebook host mapping, the `npc-friends.js` page hook, the launch secret and health challenge. The server still serves those routes for `tools/oracle`.
