# Rust server: performance and size

Goal: faster and leaner with no observable change. Responses stay byte-identical, the SQLite schema and the stored JSON text stay the
same (a DB file still works with the TS server). "Before" is the server as of the start of this work (`apps/server-rs` with the
default release profile), "after" is the current tree. Numbers come from `tools/bench/` on a shared, noisy 20-core machine, so the
tables show the **minimum over alternating repeats** (the machine's load otherwise swamps differences below ~2x); the CPU column
(`on-CPU time of all server threads per request`, from `/proc/<pid>/task/*/schedstat`) is the most stable one.

## Summary

| | before | after |
|---|---|---|
| write command (`update_item`), DB on NVMe, p50 | 14-19 ms | 8-10 ms (one fsync instead of 2-4) |
| write command, DB on tmpfs, p50 / CPU | 0.53 ms / 484 us | 0.38 ms / 339 us |
| `get_world` p50 / CPU (tmpfs) | 0.50 ms / 479 us | 0.29 ms / 274 us |
| cheap read (`get_game_config`) p50 / CPU | 0.23 ms / 231 us | 0.10 ms / 95 us |
| throughput, 4 clients (tmpfs; client-bound) | 2357 req/s | 3345 req/s |
| throughput, 4 clients (NVMe, mostly writes) | 88 req/s | 192 req/s |
| release binary | 11.54 MB | 7.98 MB |
| start-up (spawn to `/health`), release | 137-340 ms | 112-224 ms |
| start-up, debug build (RSA key generation) | 3.8-4.7 s | 0.1-0.2 s |
| peak RSS | 14-15 MB | 14-16 MB |
| `make` gates | | all green (see the end) |

(The p99 of single requests is dominated by scheduler noise on this machine; compare p50 and CPU.)

## What was measured first

* `perf record` on a `get_world` loop (before): ~70 % of the time in `malloc`/`free`, `serde_json` parse, `IndexMap` insert and
  `Value` drop. The save is parsed from SQLite JSON text several times per request: `ensure_default_user` ->
  `ensure_compatible_save` parses `universe` + `gameConfig` on **every** `/Game` call, and each handler parses its documents again.
* Writes on a real disk: 13-15 ms each. Every `set_document` / `set_session` is its own autocommit transaction and with
  `synchronous=FULL` (SQLite's default, also what better-sqlite3 uses in the TS server) each costs one fsync. `update_item` ends
  up with 2-4 commits. On tmpfs (`/tmp` here) the fsync is free, so a benchmark there hides the biggest cost; the tool takes
  `--dbdir` for a disk-backed directory.
* Start-up: two RSA-2048 key generations (localhost certificate, Facebook stand-in) run sequentially. In a debug build the
  `num-bigint-dig` code runs unoptimised: 3.8-4.7 s. In release ~0.1 s.
* The static rules data (`rules.rs`, timer rules, poll-mission rules, ...) is already loaded once through `OnceLock`: only the
  first request pays (a few ms). Nothing to do.

## Changes and their measured effect

1. **One SQLite transaction per `/Game` request** (`database.rs` `Batch`, used at the top of `game.rs::handle_game`).
   `BEGIN IMMEDIATE` ... `COMMIT` when the response has been built. It always commits (never rolls back), so a failing command
   keeps the writes before it, exactly as before; the response is sent only after the commit, so durability per request is the
   same as before (FULL). `VACUUM INTO` (backups) cannot run in a transaction, so `create_backup` commits, backs up and reopens
   it; `seed_fresh_save` uses a savepoint so it nests. NVMe: write commands 14-19 ms -> 8-10 ms, throughput 88 -> 192 req/s
   (the remaining time is the single fsync of the commit).
2. **Validated document cache with write-through** (`repository.rs` `DocCache`). Parsed documents are kept per `(user, tag)`.
   `set_document` writes the identical JSON text to SQLite and stores the value; every read first checks `PRAGMA data_version`,
   which changes whenever another connection or process commits to the file (TS server, `sqlite3` shell, the conformance
   seeding), and drops the cache when it moved. SQLite stays the source of truth: nothing is ever served that the file does not
   contain. The per-request save validation (`ensure_compatible_save`) no longer parses and now borrows instead of deep-cloning in
   `is_legacy_broken_universe`. Unit tests: `external_writes_invalidate_the_cache`, `set_document_writes_through_and_round_trips`.
   Effect (tmpfs CPU/request): reads 210-230 us -> 85-110 us, `get_world` 479 -> 274 us.
   Not cached on purpose: the time-dependent tutorial normalisation (`normalize_completed_tutorial_universe`) still runs on
   every request on a clone, because it depends on `now` (a house under construction rewrites `savedAt` on every request, so it
   persists a change every time); skipping it would change the stored data.
3. **`prepare_cached` for every hot statement** (users, sessions, meta, documents, `PRAGMA data_version`): statements are parsed
   once per connection. Part of the CPU drop above (not separable: a few us per statement).
4. **Release profile**: `opt-level=3`, `lto="fat"`, `codegen-units=1`, `strip=true`; `panic` stays `unwind`
   (`game.rs` turns a panicking command handler into the `offlineError` response with `catch_unwind`).

   | variant (same source) | size | CPU/request (update_item / get_world) |
   |---|---|---|
   | default release (lto off, 16 CGUs, unstripped) | 23.75 MB | 402 / 444 us |
   | **fat LTO, 1 CGU, strip (chosen)** | **7.98 MB** | **381 / 336 us** |
   | + `opt-level="s"` | 5.75 MB | 446 / 604 us (10-80 % slower) |
   | + `panic="abort"` | not built | rejected: breaks the per-command error fallback |

   The bulk of the size win is `strip` (symbols); LTO gives 5-25 % less CPU.
5. **Debug profile: dependencies optimised** (`[profile.dev.package."*"] opt-level = 3`): debug start-up 3.8-4.7 s ->
   0.1-0.2 s (RSA key generation), which also shortens every debug conformance run.
6. **TLS: the two key generations run in parallel** on blocking threads (`server_app.rs`) while the rest of start-up proceeds.
   Same certificates (same subjects, SANs, EKU, lifetime). Release start-up now ~110-150 ms in total.
7. **`encoding.rs`**: `escape_xml_attribute_value` is one pass instead of five chained `replace` (five allocations per string,
   hot in `sanitize_for_client_xml` over the whole world), and both escape and `sanitize_stored_string` return early when
   nothing needs changing. Output identical (same replacement order semantics).
8. **Opt-in `MCITY_SQLITE_SYNCHRONOUS=normal`** (off by default, `database.rs`). With WAL + `synchronous=NORMAL` there is no fsync
   per commit: write commands drop to 0.3-0.5 ms on NVMe (from 8-10 ms). The database cannot be corrupted; an OS crash or power
   cut can lose the last few commits (an application crash loses nothing). The default stays FULL like the TS server because
   that is a durability change; the desktop app can decide to set it.

## Tried and rejected

* **`block_in_place` / `spawn_blocking` / a dedicated game thread for `/Game`.** The handler runs inline on the worker (as
  before, the global async lock already serialises it). `block_in_place` measured 2-4x slower (thread hand-offs, plus glibc
  allocating the cached documents in one arena and freeing them in another); a dedicated thread was correct but 0.1 ms slower
  per request (reads 0.24 vs 0.13 ms p50) for no gain with one local player.
* **mimalloc as global allocator.** CPU/request 30-55 % lower (reads 57-80 us, `get_world` 182 us) but peak RSS 14 MB -> 38-44 MB
  and +0.2 MB binary. Not worth it for a lean desktop server; one line if the trade-off changes.
* **Caching the generated TLS certificate on disk.** The TS server regenerates on every start too, a stored private key would
  need expiry/rotation handling, and with parallel generation + release build the cost is ~0.1 s. Not worth the new state.
* **`opt-level="s"`**: 28 % smaller, 10-80 % slower. **`panic="abort"`**: not compatible with `catch_unwind` (above).
* glibc env tuning (`MALLOC_ARENA_MAX`, trim threshold): inconclusive within the machine noise; not needed after removing
  `block_in_place`.

## Correctness gates (final tree)

* `cargo build` and `cargo build --release`: zero warnings. `cargo test`: 57 + 1 passed (4 new).
* `MCITY_SERVER_CMD=<bin> npm run conformance -w @mcity/conformance` (then `MCITY_CONFORMANCE_RUST_ONLY=1` was needed; now all 209 run by default): 209/209 with the release and the
  debug binary. TS: `npm run conformance -w @mcity/server`: 200 passed + 9 skipped (TS untouched).
* Response and DB comparison (`tools/bench/diff.mjs`): the 117 oracle `cmds.jsonl` files (1146 `/Game` requests, snapshot taken
  at the end of the work) replayed through the before binary and the release and the debug binary: all 234 files (responses +
  final DB dump: schema SQL, users, session sync, every save document, meta) identical.
  Masked, because they genuinely differ between two runs of the same binary: the `<chk>` checksum (computed over the masked
  content), `savedAt`, `dailyRewardsNextRewardId`, `dailyRewardsLastGiven` (random pick), `npcRonaldTimeLeft`/`npcCindyTimeLeft`
  (countdowns), `time` next to `savedAt` (item countdown), any 13-digit ms stamp within [start-1 min, start+14 days], `users.created_at`.
* `make check`: passes (TS only, unaffected).

## How to rerun

```sh
export CARGO_TARGET_DIR=apps/server-rs/target-perf
cargo build --release --manifest-path apps/server-rs/Cargo.toml          # binary: $CARGO_TARGET_DIR/release/mcity-server

# one run: replay + per-command latency + throughput + start-up + RSS (ports PORT..PORT+2; temp DB per cmds.jsonl)
node tools/bench/replay.mjs --bin $CARGO_TARGET_DIR/release/mcity-server --port 33000 --out /tmp/bench-a \
     --dbdir ~/.cache/mcity-bench          # a disk-backed dir (not tmpfs) so the fsync cost counts
#   --files a/cmds.jsonl,b/cmds.jsonl  (default: tutorial-full, build-flow, flow-build-flow)   --rounds N  --clients N  --seconds N
#   --replay-only (responses + DB dump only)   --no-throughput   --only get_world,update_item

# before/after on a noisy machine: alternate the binaries, report the minimum over the repeats
BENCH_DBDIR=~/.cache/mcity-bench tools/bench/ab.sh /tmp/ab 3 before=/path/old-bin after=/path/new-bin
node tools/bench/table.mjs /tmp/ab before after

# byte-identity: replay the same requests through two binaries, diff responses and final DB contents
node tools/bench/replay.mjs --bin OLD --replay-only --files "$(ls tools/oracle/out/*/cmds.jsonl | paste -sd,)" --port 33000 --out /tmp/o
node tools/bench/replay.mjs --bin NEW --replay-only --files "$(ls tools/oracle/out/*/cmds.jsonl | paste -sd,)" --port 33000 --out /tmp/n
node tools/bench/diff.mjs /tmp/o /tmp/n
```

Notes: the oracle harness keeps appending to `tools/oracle/out/*/cmds.jsonl`; for a before/after diff run both binaries on the
same snapshot (copy the files first). Profiling: build with `CARGO_PROFILE_RELEASE_STRIP=false CARGO_PROFILE_RELEASE_DEBUG=1
RUSTFLAGS="-C force-frame-pointers=yes"` into a separate target dir and `perf record --call-graph fp -p <pid>`.
