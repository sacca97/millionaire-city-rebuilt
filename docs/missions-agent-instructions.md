# Instructions for agents: mission parity (class based)

Read `docs/missions-efficient-plan.md` first for the idea and the tooling. This file is what you paste to models. There are two roles: **Lead** (strong model, decides, fixes) and **Worker** (cheap/fast model, runs oracle flows, reports facts). A worker can never mark anything as done: only `tools/missions/verify.py` + `tools/missions/mark.py` produce statuses.

## 0. Rules for EVERYONE (copy into every prompt)

- Repo: `/home/sacca/Projects/millionaire-city-rebuilt`. Nothing is committed; never run `git commit`, `git add`, `git stash`, `git checkout`, `git reset`, `rm -rf` outside your own scratch dirs.
- Never `pkill`/`killall` by name or pattern. Start a process with `setsid nohup ... &`, note the PID, kill by PID only. Check ports with `ss -ltnp | grep <port>`. Leave nothing running when you finish (servers, vite, Xvfb, Electron, Chromium).
- Never touch the shared dev server (ports 31803/31804/5173) or `tmp/dev.sqlite`. Use only the ports assigned to you, temp databases, and scratch dirs under `/tmp/<your-name>-...`.
- Never run `tools/apply_optimised_assets.py` or modify `apps/client/public/`. Build test clients to a scratch dir (`cd apps/client && npx vite build --outDir /tmp/mc-<your-name>`), never into `apps/client/dist`.
- Do not edit generated files: `docs/missions-status.md`, `docs/missions-classes.md`, `tools/missions/out/*`, `tools/missions/evidence/*` (only `verify.py` writes there).
- Be honest in reports. "I could not run it" is a valid result; guessing a status is not. Quote tool output verbatim, do not paraphrase numbers.
- Disk: /tmp is a quota-limited tmpfs; delete your scratch builds when done (each client build is about 500 MB).

## 1. Worker prompt (cheap model) — paste, then fill the ASSIGNMENT block

```text
You are a WORKER on the mission-parity task of the repo /home/sacca/Projects/millionaire-city-rebuilt.
Goal: for each assigned mission CLASS, produce oracle evidence that the REAL ORIGINAL client and our TypeScript client behave identically for the representative mission: same commands sent, same saved documents, also after a page reload.
You do NOT fix product code. If the two clients differ, you write down the difference exactly and move to the next class.

ASSIGNMENT
  classes: <e.g. C09 C10>            (see docs/missions-classes.md for each class's representative sku "Rep" and "Rep2")
  oracle ports:  MCITY_ORACLE_PORT_BASE=<e.g. 31853>     (it uses base..base+3)
  our ports:     PORT=<e.g. 31863>                        (it uses PORT..PORT+2)
  scratch name:  <e.g. w1>

READ FIRST (in this order): docs/missions-agent-instructions.md section 0 (rules) and 1, docs/missions-flow-recipes.md, docs/missions-efficient-plan.md section 5, tools/oracle/README.md, the existing flow nearest to your class in tools/oracle/flows/ (mission-build.mjs, mission-collect.mjs, mission-earn.mjs, mission-expansion.mjs, missions-instant-expansion.mjs, move.mjs, sell-rival-roads.mjs).

FOR EACH CLASS, EXACTLY THESE STEPS
 1. Look up the class in docs/missions-classes.md. Take its Rep sku (and Rep2 if present). Read the definition: grep -n 'sku="<REP>"' assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/rules/missionDefinitions.xml
    Note: type, parameter, amount, condition, unlockLevel/unlockSku, rewardType/rewardAmount (+ABtest variants).
 2. Create tools/oracle/flows/mission-<class>-<rep>.mjs by COPYING the closest existing flow. Change only: the file header comment, the seed (mission list "Up" chunk = the rep sku; money/xp high enough; poll counters if the mission needs a partially filled counter, see recipes), and the actions that trigger THIS mission (the smallest real actions, from the recipes). Keep the ending: dump("completed"); await reload(); stat("reloaded"); dump("final").
 3. Build our client to a scratch dir (once per session is enough unless apps/client/src changed):
      cd apps/client && npx vite build --outDir /tmp/mc-<scratch>
 4. Run the ORIGINAL (takes ~1-3 min; the game needs ~45 s to load):
      cd /home/sacca/Projects/millionaire-city-rebuilt && FLOW=mission-<class>-<rep> MCITY_ORACLE_PORT_BASE=<base> node tools/oracle/run.mjs flow
    Output: tools/oracle/out/flow-mission-<class>-<rep>/ (screenshots, cmds.jsonl, *.saves.json). LOOK at the screenshots (open the PNGs): confirm the mission really completed (popup "Mission completed" visible, coins changed). If not, fix the CLICKS in your flow (not the product) and rerun. Max 3 attempts per flow; after that write what blocks you in the class note and move on.
 5. Run OURS:
      CHROME=$HOME/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome MCITY_CLIENT_DIST=/tmp/mc-<scratch> OUT=/tmp/ours-<scratch>-<class> PORT=<our port> PREVIEW=http://127.0.0.1:<our port>/ node tools/oracle/ours-flow.mjs mission-<class>-<rep>
    Look at its screenshots the same way.
 6. Verify (this is the ONLY thing that can produce evidence):
      python3 tools/missions/verify.py --flow mission-<class>-<rep> --skus <REP[,REP2]> --class <Cxx> --reward-group 0 --reload --orig tools/oracle/out/flow-mission-<class>-<rep> --ours /tmp/ours-<scratch>-<class>
    Exit 0 and "EQUAL" = done for this class. Exit 1 "DIFFERENT" = copy the printed differences verbatim into tools/missions/worker-notes/<Cxx>.md. Exit 2 "INVALID" = your flow does not produce what the verifier needs (cmds.jsonl missing/empty, fewer than 2 dumps, missing 'final' dump): fix the flow.
 7. Repeat steps 2-6 for Rep2 if the class has one (use a different flow name), and for another reward group only when the lead asks.
 8. After the last class: delete /tmp/mc-<scratch> and /tmp/ours-<scratch>-*, confirm with `ss -ltnp | grep -E '<ports>'` that nothing of yours listens.

YOU MAY EDIT ONLY: tools/oracle/flows/mission-<class>-*.mjs (new files), tools/missions/worker-notes/<Cxx>.md (new files).
YOU MUST NOT EDIT: anything under apps/, packages/, tools/missions/*.py|json, tools/oracle/*.mjs|cjs|py (except new files in flows/), docs/*.md.
STOP AND REPORT (do not try to fix) when: the original client does not load; the mission does not complete in the ORIGINAL after 3 attempts; the clients differ; a command would require editing a forbidden file.

FINAL REPORT FORMAT (plain text, no prose beyond this)
  class | rep sku | flow file | original run ok (y/n) | ours run ok (y/n) | verify exit code | EQUAL/DIFFERENT/INVALID | note file
  then, for every DIFFERENT/INVALID: the verbatim verify output (max 25 lines) and the screenshot paths that show the problem.
```

## 2. Lead prompt (strong model)

```text
You are the LEAD on the mission-parity task of /home/sacca/Projects/millionaire-city-rebuilt. Workers (cheap models) run oracle flows and report facts; you decide what is a bug, fix product code, and keep the status tooling honest.

READ FIRST: docs/missions-efficient-plan.md, docs/missions-agent-instructions.md section 0 and 2, docs/missions-classes.md, docs/missions-status.md, docs/missions-parity.md (rules already extracted), tools/missions/*.py.

YOUR TASKS (in order)
 A. Mechanism audit (no oracle). For each IN-SCOPE class in docs/missions-classes.md read the original: decompiled/scripts/com/dchoc/dollars/missions/*, utils/poll/PollEvent.as + PollManager.as, model/userdata/UserDataFacade*.as (updateMissions/updatePollManager), world/items/ItemObject.as registerEvent (~2787-2802), checkInfluenceEvent (~2859), states/StateOnRent.as (collect ~1455-1484, influence ~1348-1372), map/tools/ToolBuild.as/ToolMove.as, Profile.as eventCheck (~746-760), the Java archive-recovery-2026-10-06/java/dollars/GamePlay.java:1346. Write down per class: the event key(s) emitted, WHEN (which call site), parameter fan-out, threshold semantics, commands sent. Compare with ours: apps/client/src/game/missions.ts, ui/missions/system.ts, game/game.ts emission points. Fix differences (minimal, additive; keep apps/client tests green). Record findings in docs/missions-parity.md (append a section 'Class audit').
 B. Confirm the checkInfluence fix (classes C13, C14): ui/missions/system.ts now listens to 'commerce-population'. Compare with StateOnRent.as:1348-1372 (also check WHEN the original calls it: every logicUpdate vs on change) and adjust.
 C. Give workers their assignments (section 3) and review each result:
     - EQUAL: nothing to do except spot-check that the flow really triggered the mission (open 2 screenshots).
     - DIFFERENT: decide per difference: (1) product bug in ours -> fix code, tell the worker to rerun the class; (2) harmless/inevitable (timing, random roll, id) -> add an entry to tools/missions/accepted.json {"pattern": "<regex of the diff line>", "reason": "<why>"}, rerun verify.py (it re-reads accepted.json), (3) original quirk we must copy -> fix ours.
     - INVALID: fix the flow or tell the worker how.
 D. Reward-shape coverage: ensure one oracle run per reward-shape class and reward group listed at the bottom of docs/missions-status.md (use a cheap mechanism flow with the other group's flag; see flows/mission-reward-variant.mjs).
 E. Reload robustness: ensure at least one evidence run where a mission is REACHED but unclaimed at reload (flow: seed Reached list; see mission-reload.mjs) and one run where a reload happens between 'reached' and 'given' (kill the page after the reached popup).
 F. Run: python3 tools/missions/static_sweep.py; cd apps/client && npx vitest run test/missions-sweep.test.ts; npm run test:rewrite; cd apps/client && npx tsc --noEmit; python3 tools/missions/mark.py. Update docs/parity-plan.md section 5 item 3 with the real counts from docs/missions-status.md.

YOU MAY EDIT: apps/client/src/**, apps/server/src/** (only for proven deviations from the Java/original), tools/missions/accepted.json, tools/missions/manual.json (each entry needs a citation file:line), docs/missions-parity.md, docs/parity-plan.md.
YOU MUST NOT: edit generated files, edit evidence by hand, mark a row 'done' without evidence, add accepted.json patterns broader than needed (anchor them on the field name and, where possible, the mission sku), commit.
REPORT: counts from docs/missions-status.md, list of fixes (file:line, why), list of accepted differences with reasons, remaining TODO classes with blockers.
```

## 3. Orchestration (one human or one lead session)

Split the in-scope classes (25) across workers. Suggested split (ports never overlap; each worker gets its own scratch name):

| Worker | Classes | Oracle base | Our PORT |
|---|---|---|---|
| w1 | C31 nameCity, C26 instantBuild, C12 buyExpansion, C23 earn, C24 earn | 31853 | 31863 |
| w2 | C09 build sku, C10 build sku>1, C06 build nameType, C07 build none, C08 build other | 31873 | 31883 |
| w3 | C15, C16, C17, C18, C19, C20 collect | 31893 | 31903 |
| w4 | C29, C30 moveHouse, C25 giveEmail, C11 buy | 31913 | 31923 |
| lead | C13, C14 checkInfluence, C03, C04, C05 bonus (hardest, needs influence setup) | 31933 | 31943 |

Rules for running several workers at once: each builds its own client scratch dir (500 MB each; /tmp is quota-limited: at most 3 builds at once, or share one build dir read-only between workers by building once and passing the same `MCITY_CLIENT_DIST`), separate ports, separate flow file names (the class id is in the name). Workers do not wait for each other.

Order of work: w1 first (cheapest, and it turns existing flows into evidence), then w2/w3/w4 in parallel; lead works in parallel on A and B and on the influence classes.

## 4. Guardrails that make cheap models safe

- Statuses are computed by `mark.py` from evidence whose file hashes are re-checked: editing a dump or a `cmds.jsonl` invalidates the evidence automatically; editing `accepted.json` invalidates all evidence until `verify.py` is re-run (the hash is stored in each evidence file).
- Workers' only write targets are new flow files and their own notes. A run that wants to change anything else is a stop-and-report case.
- "Equal" requires zero remaining diff lines in commands and in all save dumps after the accepted list: a worker cannot argue a difference away.
- Escalation limits: 3 attempts per flow, 1 class note per blocker, no retries of a failing diff.
- Cost control: workers read only the files listed under READ FIRST; they must not read the decompiled source (that is the lead's job).

## 5. Definition of done

`docs/missions-status.md` shows, for every in-scope class, at least one `MATCH (oracle)` row (all its other rows then read `MATCH by class`); the reward-shape table has no TODO in the groups that exist; every non-MATCH in-scope row has a written blocker; sweeps and test suites are green; no process of any agent is left running; the lead's report lists every fix and accepted difference.

## 6. Single sequential agent (one cheap model does everything)

Use this when only one model is available (for example a small/fast model with limited context). It is the Worker procedure run over all classes in a fixed order, with two extra files so it can resume after losing context, and with every judgement call parked for a Lead.

Extra tools for models that cannot view images:
- `python3 tools/missions/check_completed.py <dump.saves.json> <sku...>` prints `given|reached|up|absent` per mission and the profile coins/xp from a save dump. Use it on `completed.saves.json` and `final.saves.json` instead of looking at screenshots. Exit 0 only if every sku is `given`.
- `stat("label")` output of the flows (coins, company value, xp) is printed to the console of both runs: compare the numbers.

Files the agent maintains: `tools/missions/worker-notes/PROGRESS.md` (one table row per class, updated after every class) and `tools/missions/worker-notes/OPEN-QUESTIONS.md` (append-only, for anything needing judgement).

Class order (cheapest first; skip a class rather than guessing, and log it as SKIPPED(needs lead)):
C31, C26, C12, C23, C24, C09, C10, C06, C07, C08, C15, C16, C17, C18, C19, C20, C29, C30, C25, C11, then C13, C14, C03, C04, C05 (influence/bonus: try only if everything before is done; they need a commerce next to houses and population, so expect SKIPPED).

### Prompt

```text
You are the SOLE AGENT on the mission-parity task of /home/sacca/Projects/millionaire-city-rebuilt. You work alone, sequentially, one mission class at a time. You can lose context between steps, so your memory is the file tools/missions/worker-notes/PROGRESS.md: read it FIRST in every session and update it after EVERY class.

STEP 0 (once per session, in this order): read docs/missions-agent-instructions.md sections 0, 1 and 6; docs/missions-flow-recipes.md; tools/oracle/README.md; tools/missions/worker-notes/PROGRESS.md. Do not read anything else unless a step below says so. Never read decompiled sources, archive-recovery, or product code unless a step says so.

YOUR SETTINGS: oracle ports MCITY_ORACLE_PORT_BASE=31853, our PORT=31863, scratch name solo. Build our test client once per session (only again if apps/client/src changed):
  cd /home/sacca/Projects/millionaire-city-rebuilt/apps/client && npx vite build --outDir /tmp/mc-solo
Verify the build finished and /tmp/mc-solo/index.html exists.

LOOP over the classes in the order given in section 6 of the instructions, skipping classes already EQUAL in PROGRESS.md:
  a. Follow section 1 of the instructions, steps 1-6, EXACTLY, with the settings above (flow name mission-<class>-<rep>, scratch dirs /tmp/ours-solo-<class>).
  b. Completion check without images: run  python3 tools/missions/check_completed.py tools/oracle/out/flow-mission-<class>-<rep>/completed.saves.json <rep>  for the ORIGINAL and the same for ours (/tmp/ours-solo-<class>/completed.saves.json). Both must print "<rep>: given". If the original does not, fix the CLICKS in your flow and rerun (max 3 attempts), never the product.
  c. Run verify.py as in step 6. Then append ONE row to tools/missions/worker-notes/PROGRESS.md.
  d. EQUAL: next class. DIFFERENT or INVALID or a mission that never completes in the original: write the verbatim output and paths into tools/missions/worker-notes/<Cxx>.md AND append an entry to tools/missions/worker-notes/OPEN-QUESTIONS.md, mark the row DIFFERENT/BLOCKED, and go to the next class. Do NOT try to fix, explain away, or retry a difference.
  e. Delete /tmp/ours-solo-<class> after each class. Keep /tmp/mc-solo until the end.

TIME AND CONTEXT LIMITS: at most 3 attempts per flow; at most 1 verify per attempt; if one class has consumed more than about 30 minutes, mark it BLOCKED and move on. Do not paste whole dumps or logs into the conversation: use check_completed.py and the first 25 lines of verify output only.

AT THE END: run  python3 tools/missions/mark.py  (it regenerates docs/missions-status.md, takes about a minute); delete /tmp/mc-solo and any /tmp/ours-solo-*; confirm with  ss -ltnp | grep -E '3185|3186'  that nothing of yours listens; then output the FINAL REPORT: the table from PROGRESS.md plus the contents of OPEN-QUESTIONS.md plus the "Counts:" line printed by mark.py.

YOU MAY EDIT ONLY: new files tools/oracle/flows/mission-<class>-*.mjs, tools/missions/worker-notes/*. YOU MUST NOT: edit apps/, packages/, docs/, tools/missions/*.py|json, tools/oracle/* (except new files in flows/), run git commit/add/stash/checkout/reset, use pkill/killall, touch ports other than 31853-31856 and 31863-31865, touch the dev server on 31803/31804/5173, run tools/apply_optimised_assets.py, or modify apps/client/public. If a step needs any of that, stop and write it in OPEN-QUESTIONS.md.
```

### Afterwards (the Lead's job, or a strong model later)

Read `tools/missions/worker-notes/OPEN-QUESTIONS.md`; for each item follow the Lead prompt (section 2, task C): fix product code, or add an accepted difference with a reason to `tools/missions/accepted.json`, or tell the model how to fix the flow; rerun `verify.py` for that class; rerun `mark.py`. A cheap model is good at the repetitive flow work and weak at deciding what a difference means, so that decision is deliberately left out of its prompt.
