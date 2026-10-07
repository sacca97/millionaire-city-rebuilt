# TypeScript client: development

The rewrite lives in `apps/client` (Vite + PixiJS v8). It talks to the existing server through the original protocol (`POST /Game`, XML envelope with CDATA JSON), so saves stay compatible with the Flash client.

## One-time asset generation (local only, gitignored)

Original art is extracted from the archived SWFs with FFDec, which `apps/server`'s `prepare-client` script also downloads:

```text
# FFDec 26.0.0 -> generated/tools/ffdec-26.0.0/ffdec.jar (see docs/client-logic-spec.md for the download URL)
python3 tools/export_all_items.py        # apps/client/public/sprites (needs Java + Python with Pillow)
python3 tools/export_framerates.py       # sprite frame rates
python3 tools/fix_old_grass.py           # recolour old olive grass baked into item sprites to the 0.501 ground colour (skips dirs already marked .grass_fixed; --force to redo; run after export_all_items/export_hq)
python3 tools/export_gui.py              # apps/client/public/gui  (HUD, popups)
python3 tools/export_sounds.py           # apps/client/public/audio
```

Decompile the original client for reference (read-only, gitignored `decompiled/`):

```text
java -jar generated/tools/ffdec-26.0.0/ffdec.jar -export script decompiled assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/Dollars.swf
```

## Running

```text
npm ci
npm run build -w @mcity/shared
MCITY_DB_PATH=tmp/dev.sqlite npm run dev -w @mcity/server   # game server, http://127.0.0.1:31803
npm run dev -w @mcity/client                                  # http://127.0.0.1:5173 (proxies /Game and /mcity)
```

Tests: `cd apps/client && npx vitest run`; typecheck: `npx tsc --noEmit`.

## Layout

- `src/net` protocol, command builders (`commands.ts`) and the batching queue (`session.ts`).
- `src/model` save parsing and rule-data loading; `packages/rules` holds ported game rules.
- `src/game` core loop: `game.ts` (Game controller + events), `tools.ts` (tool state machine), `simulation.ts` (timers), `rules.ts` (XP/contracts/economy), `world.ts` (occupancy), expansions, placement, traffic.
- `src/debug/panel.ts` developer panel (backtick key): coins/level, build/auto-place, tools, sign contract, collect all, x1..x1000 clock.
- `src/view` Pixi rendering (city, items, traffic), `src/terrain.ts` ground autotiling.
- `src/gui` layout reader for the original GUI art, `src/audio` sound.
- Reference docs: `docs/client-logic-spec.md`, `docs/feature-inventory.md`, `docs/gui-assets.md`.
