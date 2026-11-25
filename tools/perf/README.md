# Headless client soak

`soak.mjs` starts the real Rust server on a temporary save, seeds it post-tutorial with today's daily reward already
given, loads the built client in **headless** Chromium and samples JS heap, DOM node count and scene size. It never
creates a visible window, so it does not take focus from the desktop.

```bash
make build                                  # apps/client/dist must exist
node tools/perf/soak.mjs --minutes 5        # writes /tmp/mcity-soak.json
node tools/perf/soak.mjs --minutes 1 --interval 5 --out /tmp/soak.json
```

Dependencies: `npm ci` (better-sqlite3) and `npm --prefix tools/oracle ci` (playwright-core). Chromium comes from
Playwright's cache (`~/.cache/ms-playwright`); set `CHROME` if a different executable is needed. The script exits
non-zero when the client never reaches `window.__mcity`; heap growth is reported, not asserted.
