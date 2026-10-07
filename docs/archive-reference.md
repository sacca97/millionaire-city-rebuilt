# Recovered archive (reference material)

`archive-recovery-2026-10-06/` (untracked, supplied separately; see its README.md and BACKEND_FINDINGS.md) holds reconstructions from `millionaire-city.zip`:

- `java/`: 277 Java sources of the ORIGINAL backend (Vineflower). Authoritative references for server behaviour: `dollars/Server.java` (command dispatch), `dollars/GamePlay.java` (money, missions, plots, collectibles, item states), `dollars/SecurityNormal.java` (validation and economy), `dollars/Rules.java` (A/B variant lookup), `dollars/Config.java`, `com/dchoc/dollar/servlet/GameServlet.java` (version check, checksum).
- `actionscript/`: 585-file decompile of the archived client (differs from the 0.501 decompile only in a TextIDs constant).
- `localization/`: CSV exports of 44 localization workbooks (132 sheets); `recovered-xfl/`: entries from 21 FLA authoring projects; `data/`: original configuration row (rules, default worlds, rewards, settings), command inventory, SQL references.

Caveats from the recovery notes: decompiled sources are reconstructions (not verified compilable); the SQL config row, the archived CDN XML and the 0.501 XML are three distinct datasets, so do not overwrite the 0.501 rules with the others; concrete DB migrations are missing.

Use it to replace inferred behaviour with ported behaviour, citing Java file:line in comments.
