# Millionaire City: two modernization options

Status: proposal for review; implementation has not started.

## Objective

Keep the recovered Millionaire City 0.501 experience playable and make it easier to improve. Compare two routes:

1. Run the existing Flash client in Ruffle and replace the legacy desktop runtime.
2. Rebuild the game client in Godot, initially using the existing local server.

The first route prioritizes preservation and lower implementation effort. The second prioritizes a native game and control over future development. A native Ruffle executable would still run the original SWF through emulation; a Godot client would replace that client.

## What we already have

The repository contains:

- The recovered `assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/Dollars.swf`, supporting SWFs, images, and XML rules.
- A TypeScript/Express server in `apps/server`, with command handlers and SQLite persistence.
- An Electron 10.4.7 desktop launcher with Pepper Flash in `apps/desktop`.
- Selected ActionScript patches in `client-patch-sources`.
- A JPEXS preparation script in `apps/server/src/scripts/prepareClient.ts` that produces a modified SWF.
- Shared protocol helpers in `packages/shared`. Responses contain XML envelopes with JSON command data; saves also use legacy structures.

These are a working preservation foundation, not a complete original development project. No verified complete newer official source release or client archive was identified during the initial research. Neither option depends on finding one.

The existing implementation must be treated as a reference to inspect, not proof that every original mechanic is correct. Some behavior resides in ActionScript and may not exist in the replacement server.

## Shared preparation

Before either prototype:

1. Record a baseline session in the existing app: load a city, move the camera, select a building, place a house, start a contract, collect rent, save, and reopen.
2. Use a separate database selected through `MCITY_DB_PATH`. Copy a database only after shutting down its server, or use SQLite's backup mechanism so WAL contents are included. Never run both clients against the same save during comparisons.
3. Inventory the files needed for that session, including dynamically loaded SWFs and missing-asset fallbacks.
4. Trace the commands, save fields, coordinates, timers, and client-side calculations involved in this loop.
5. Capture screenshots and expected state changes so both prototypes have the same acceptance criteria.

Deliverable: a short baseline report and an isolated sample save. Do not start broad asset conversion or a backend redesign at this stage.

## Option A: Ruffle modernization

### Proposed architecture

Existing patched SWF and assets → Ruffle → existing local server → existing SQLite save.

Start with a browser prototype using Ruffle's web runtime. Keep the current launcher available while evaluating compatibility. After the prototype works, choose between a current Electron wrapper and Ruffle's desktop player based on actual integration needs. The server must still be started, stopped, and packaged with the game.

### Milestones

**A1 — Load and diagnose**

- Add an isolated experimental launcher that embeds Ruffle and loads the prepared SWF.
- Reproduce required FlashVars and JavaScript/ActionScript callbacks.
- Check local requests, asset URL resolution, HTTPS certificates, cross-origin behavior, and Facebook replacements.
- Record missing APIs and errors, distinguishing emulator gaps from server or launcher problems.

Deliverable: the city loads, or a reproducible blocker report identifying the unsupported behavior.

**A2 — Complete the baseline loop**

- Exercise camera movement, zoom, input, menus, placement, contracts, rent, and persistence.
- Check dynamically loaded artwork, text, sound, animation, and timing.
- Compare the same city and actions with the legacy runtime.
- Measure startup, frame responsiveness, and memory on a representative populated city.

Deliverable: a compatibility matrix showing working, partially working, and blocked features, with exact reproduction steps.

**A3 — Package a replacement runtime**

Proceed only if core gameplay works and remaining fixes are bounded.

- Package the chosen maintained runtime with the local server.
- Preserve server readiness checks, process cleanup, local request restrictions, and save location behavior.
- Verify portable builds on the desktop platforms we intend to support.
- Remove the Pepper Flash dependency from the new build after equivalent behavior is demonstrated.

Deliverable: a playable packaged build and a documented way to return to the preservation build.

### Decision criteria and risks

Continue if the baseline loop works, saves survive restart, and remaining issues can be fixed through a small number of documented changes.

Stop or defer if core gameplay requires substantial emulator development, widespread ActionScript rewrites, or remains visibly slower or incorrect on representative cities. Set a short investigation budget before A1; a suggested initial budget is 3–5 working days, not a promise of delivery.

Main risks: incomplete ActionScript 3 API support, dynamic SWF loading, browser integration differences, and visual or timing discrepancies. Moving to Ruffle does not automatically make the original client easy to extend.

## Option B: native Godot rebuild

### Proposed architecture

Godot client → existing local command server → existing SQLite save.

Extract only the artwork needed for the first playable loop. Use the XML definitions as data and the ActionScript/client behavior as references. Keep backend rules and persistence in their current location initially.

A Godot client cannot import the TypeScript backend directly. It must communicate with it, and a packaged prototype must launch or bundle that backend. Removing Node.js and HTTP would be a later migration, with separate justification and save compatibility work.

### Milestones

**B1 — Prove assets and city loading**

- Extract representative terrain, road, house, commerce, and decoration artwork using JPEXS.
- Inspect symbol variants, anchors, dimensions, layers, and animation dependencies. Some assets may require sprite sheets or manual reconstruction.
- Create a small Godot project that reads an isolated city through the existing server.
- Implement the actual coordinate transform and draw order from the reference client, including buildings with different footprints.
- Add camera movement, zoom, and selection.

Deliverable: a native executable showing a saved city with correctly placed representative buildings and responsive navigation. Document unsupported assets explicitly.

**B2 — Complete one gameplay loop**

- Build a minimal currency display and catalog with a few representative items.
- Implement placement previews, occupied-tile checks, construction, contracts, and rent collection.
- Trace which calculations the existing Flash client performs and port only those required for this loop.
- Use existing server commands where practical. If their legacy format becomes a concrete obstacle, add a small adapter around existing handlers instead of duplicating game rules.
- Save and reopen the city; compare money, building state, and timers with the baseline.

Deliverable: a native prototype that loads, places a house, starts a contract, collects rent, and persists the resulting state.

**B3 — Expand feature coverage**

Only after B2 proves the approach:

- Inventory remaining mechanics and dependencies, then implement them in an order agreed from player priorities.
- Cover roads, commerce, decorations, expansion, levels, missions, collections, neighbors, and tutorials as required by that inventory.
- Add remaining animation, sound, UI, and accessibility behavior.
- Establish save migration and import behavior before changing stored structures.

Deliverable: a feature matrix and successive playable builds. Matching the entire archived client is a substantial project; the prototype does not establish its full cost.

**B4 — Package and improve**

- Package for the first chosen desktop platform, then expand platform coverage.
- Handle backend startup, shutdown, save location, and backups in the native app.
- Improve UI scaling, controls, and performance based on observed problems.
- Consider mobile support and a fully embedded simulation only after the desktop version is stable.

### Decision criteria and risks

Continue if representative artwork can be converted faithfully, the saved city renders correctly, and one full gameplay loop uses the existing persistence without divergent results.

Reassess if asset conversion requires extensive manual work, crucial mechanics cannot be recovered, or server reuse offers less benefit than expected. Use B1 and B2 to estimate the remaining work; do not commit to full parity before this evidence exists.

Main risks: Flash timeline artwork and effects are not ordinary image files; client logic may contain undocumented rules; legacy saves may be difficult to map; and a polished UI and complete feature coverage take much longer than a rendering demo.

## Comparison

| Criterion | Ruffle | Godot |
| --- | --- | --- |
| Reuse of original interface and logic | Very high if compatible | Must be recreated |
| Expected initial effort | Lower, with compatibility uncertainty | Higher, with reconstruction uncertainty |
| Control over UI and gameplay changes | Limited by old client and patching | High once implemented |
| Native game implementation | SWF runs through emulation | New native game client |
| Existing server/save reuse | Intended with minimal changes | Intended, requires protocol integration |
| Main early question | Does this client actually work in Ruffle? | Can we reproduce assets and one complete loop? |
| Full feature parity | Potentially early if compatible | Gradual and substantial |

## Recommended sequence

Run the shared preparation, then a bounded Ruffle investigation. If it works, it provides a useful preservation release while we assess the native prototype. If it fails, retain the blocker report and move to Godot without building a custom emulator fork.

Godot remains the recommended long-term direction if the priority is a native game we can improve freely. Ruffle is the recommended first investigation because it can establish whether a much smaller change meets the immediate playability goal.

Do not develop both full implementations simultaneously. Complete their small feasibility milestones, compare the evidence, then choose where to invest.

## Questions for Claude's review

Please inspect the repository and challenge this plan before implementing anything:

1. Which Flash APIs, dynamic loading behavior, or callbacks are likely to block Ruffle? Identify exact classes and call sites where possible.
2. Does the existing server own enough gameplay logic for a Godot client, or which calculations still reside in ActionScript?
3. Are representative assets readily extractable, and what anchors, animations, or symbol variants would need conversion?
4. Can Godot use the existing protocol and save structures with a small amount of integration code? Identify any concrete reason to add an adapter.
5. Are the milestones and acceptance criteria sufficient to protect saves and expose the major risks early?
6. Which route do you recommend given the evidence, and what is the smallest useful first implementation?

Return findings with repository file references, distinguish verified facts from assumptions, and propose plan corrections. Do not assume Ruffle compatibility, lossless asset extraction, complete backend mechanics, or complete newer official sources exist.

## Revision: leaving Flash entirely (review findings)

Repository review corrected several plan assumptions:

- The "SQLite save" is JSON documents keyed by tag in `save_documents` (`apps/server/src/database.ts`), mirroring XML as string-typed trees with packed and ASCII-encoded fields.
- The server records client-reported state. It has no placement/footprint validation, and income math is probably computed in the Flash client. Neighbors are hardcoded NPCs, and login is unauthenticated.
- `prepareClient.ts` needs Java and FFDec 26.0.0.
- Likely Ruffle blockers: `MouseWheelEnabler.as` JS injection via `ExternalInterface.call`, the `Server.as` ExternalInterface callbacks, `Security.allowInsecureDomain("*")`, and the self-signed HTTPS crossdomain flow. All untested.
- Tests are a single integration file (`apps/server/test/server.test.ts`).

If the goal is to leave Flash, Ruffle is only a bridge. The route is a client rewrite (Option B) with these changes:

1. **Decompile first (L0).** Decompile `Dollars.swf` with FFDec and write a spec of the baseline loop (tile transform, draw order, placement, contracts, rent, save fields). Output stays under gitignored `decompiled/`.
2. **Asset pipeline (L1).** A script exports item SWFs to sprites plus a JSON file of anchors/offsets/frames, run locally. Original assets are not redistributable (`NOTICE.md`).
3. **Shared rules (L2).** Put placement and income rules in a shared module used by client and server, verified against the Flash build.
4. **Golden-save diffs.** Compare save documents before/after each baseline action between the legacy client and the new one. The Flash build stays as the oracle.
5. **Engine decision deferred until after L0/L1.** Leaning TypeScript (shares `packages/shared` and the rules module); Godot if native export and mobile matter more.

## References and ownership

- Preservation repository: https://github.com/wman810/millionaire-city-rebuilt
- Ruffle compatibility: https://ruffle.rs/compatibility
- JPEXS extraction and editing tools: https://github.com/jindrapetrik/jpexs-decompiler
- Godot export documentation: https://docs.godotengine.org/en/stable/tutorials/export/index.html
- Local ownership notice: `NOTICE.md`. The revival's MIT license does not cover original game assets or third-party runtime files. This plan does not establish permission to redistribute those materials.

Compatibility and extraction remain hypotheses until the proposed prototypes are exercised. No new prototype or implementation validation has been performed for this planning document.
