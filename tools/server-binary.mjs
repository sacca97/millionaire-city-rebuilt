#!/usr/bin/env node
// Resolve the mcity-server binary path without assuming apps/server-rs/target.
//
// Cargo may put build artifacts elsewhere (CARGO_TARGET_DIR, or a `build.target-dir` in ~/.cargo/config.toml).
// `cargo metadata` reports the real target directory, so the Makefile, run.sh, the conformance suite, the client
// integration tests and the oracle harness all find the same binary.
//
// CLI: node tools/server-binary.mjs [--debug]   -> prints the path (does not check that it exists)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIR = path.join(ROOT, "apps", "server-rs");
const EXE = process.platform === "win32" ? "mcity-server.exe" : "mcity-server";

let cachedTarget;
/** Target directory cargo will use for apps/server-rs; falls back to the conventional one. */
export function targetDirectory() {
  if (cachedTarget) return cachedTarget;
  try {
    const out = execFileSync("cargo", ["metadata", "--format-version", "1", "--no-deps"], {
      cwd: SERVER_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const dir = JSON.parse(out).target_directory;
    if (typeof dir === "string" && dir.length > 0) cachedTarget = dir;
  } catch {
    // No cargo, or metadata failed: the conventional path is still the best guess.
  }
  cachedTarget ??= path.join(SERVER_DIR, "target");
  return cachedTarget;
}

/** Absolute path of the release (default) or debug binary. */
export function serverBinaryPath(profile = "release") {
  return path.join(targetDirectory(), profile, EXE);
}

/** Release binary if built, else debug; undefined when neither exists. */
export function existingServerBinary() {
  for (const profile of ["release", "debug"]) {
    const p = serverBinaryPath(profile);
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const debug = process.argv.includes("--debug");
  process.stdout.write(serverBinaryPath(debug ? "debug" : "release"));
}
