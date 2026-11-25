# Millionaire City Rebuilt

Millionaire City Rebuilt is a fan-made local revival of the `0.501` Millionaire City Flash client. It is a TypeScript (Pixi.js) web client, a Rust game server with local SQLite saves, and a Tauri desktop app that bundles both. The original Flash game is not shipped; it is used only as a parity oracle (`tools/oracle`).

This project is not affiliated with Digital Chocolate, Ubisoft, or Facebook.

Current development status, verification results and known gaps: `docs/status.md`. Release notes: `docs/release-0.2.0.md`.

## Download And Play

For normal play, use a portable release for your operating system:

1. Download the latest `MillionaireCityRebuilt-*-portable-*-x64.zip` from GitHub Releases.
2. Extract the ZIP.
3. Run the included Millionaire City Rebuilt app.

No installer is required.

## Building

To build from source, install Node.js with npm and a Java runtime first. Node.js 20 and Java 21 are recommended.

1. Clone the repository:

```text
git clone https://github.com/wman810/millionaire-city-rebuilt.git
cd millionaire-city-rebuilt
```

2. Install dependencies:

```powershell
npm install
```

3. Prepare the private client copy:

```powershell
npm run prepare-client
```

For running the desktop client in development, run:

```powershell
npm run dev:desktop
```

For running only the local server in development (needs a Rust toolchain), run:

```powershell
npm run dev:server
```

## Browser Play

`make run` serves the client at `http://127.0.0.1:31803/` (saves in `~/mcity.sqlite`). Do not run it against the same save as the desktop app at the same time.

## Project Layout

- `apps/server-rs`: local game server in Rust (HTTP, HTTPS Facebook shim, SQLite persistence, launcher page, offline NPC friends); build with `make server`
- `tools/conformance`: black-box conformance suite for the server binary (`make conformance`)
- `apps/desktop`: Tauri 2 desktop app (system web view, game server embedded in-process); `src-tauri/` is the Rust shell
- `packages/shared`: protocol constants, types, and envelope helpers shared by both apps
- `assets`: recovered game cache served by the local server
- `tools/oracle`: parity harness around the ORIGINAL Flash client (its own Electron 10 + Pepper Flash in `tools/oracle/flash`; never shipped)
- `generated`: generated private SWF copy, SQLite save data, downloaded tools, release runtime files, and local backups

## Game art

`apps/client/public-opt/` (optimised WebP/audio/fonts, about 275 MB) is committed so a fresh checkout renders completely: `make install && make build && make run`
(`make build` uses it automatically). The full-size originals (`apps/client/public/`) are generated from the original SWF files by `tools/export_*.py`
and stay out of git. Art is derived from the original game's assets; see NOTICE.md.

## Desktop app

`make app-dev` (or `npm run dev:desktop`) runs the Tauri app from the repository; `make app` (or `npm run package`) builds the installer for this OS.
Details, save locations and CI: `apps/desktop/README.md`.
