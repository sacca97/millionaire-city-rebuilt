# Oracle harness (original Flash client)

`node tools/oracle/run.mjs <scenario>` (scenarios/*.mjs: fresh-boot, post-tutorial, shop-houses, build-house, hold).

Each run: starts an isolated server (tsx, temp sqlite, ports 31833/31834/31835), launches
`loader.cjs` (Electron 10 + Pepper Flash, no-sandbox, FB shim redirect) under `xvfb-run -a` 1280x800,
control HTTP on 31836 (/shot /mouse /key /eval /quit; input via sendInputEvent, screenshots via capturePage),
and writes numbered PNGs + `<label>.saves.json` (all save_documents rows) to `out/<scenario>/`.
Only process groups it started are killed. Game loads in ~45 s (wait with `o.waitGame()`).
Page is 760x600 SWF centred in a scrolling launcher page; use `o.scroll`, `o.clickSwf`.
Seeds: `seedPostTutorial` sets profile.tutorialEnd=1, bossGenre=1. Post-tutorial: dismiss Daily Prizes
(447,528 then 651,673). `hold` idles for manual curl driving. Known coords: shop button (870,662),
buy-plots (815,662), Bungalow buy (507,558). A house needs a 2x2 plot (4 plot clicks).
Contract/rent steps are real-time timers; not yet scripted.
