import fs from "node:fs";
import path from "node:path";
import { expect } from "vitest";
import { sha256, type RawResponse } from "./http.js";

/**
 * Golden responses for the static / fixed routes, recorded from the TS server (the reference).
 *   CONF_RECORD=1 npm run conformance -w @mcity/conformance -- routes   re-records fixtures/routes.golden.json (the recorded bodies came from the TS reference server; re-record only for an intended behaviour change)
 * A golden entry is the status, a few response headers and the sha256 + length of the body.
 */
const FILE = path.resolve(__dirname, "../fixtures/routes.golden.json");
const HEADERS = ["content-type", "cache-control", "content-encoding", "vary", "content-security-policy", "referrer-policy", "x-content-type-options"];

export interface GoldenEntry {
  status: number;
  headers: Record<string, string>;
  sha256: string;
  length: number;
}

const recording = process.env.CONF_RECORD === "1";
const recorded: Record<string, GoldenEntry> = {};

function load(): Record<string, GoldenEntry> {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}

export function describeResponse(res: RawResponse, normalize?: (body: string) => string): GoldenEntry {
  const headers: Record<string, string> = {};
  for (const name of HEADERS) {
    const v = res.headers.get(name);
    if (v !== null) headers[name] = v;
  }
  const body = normalize ? Buffer.from(normalize(res.text)) : res.body;
  return { status: res.status, headers, sha256: sha256(body), length: body.length };
}

export function expectGolden(name: string, res: RawResponse, normalize?: (body: string) => string): void {
  const actual = describeResponse(res, normalize);
  if (recording) {
    recorded[name] = actual;
    return;
  }
  const golden = load()[name];
  expect(golden, `no golden entry "${name}" (record with CONF_RECORD=1 against the reference build)`).toBeTruthy();
  expect(actual, name).toEqual(golden);
}

/** Call from an afterAll in the routes test file when recording. */
export function flushGolden(): void {
  if (!recording) return;
  const merged = { ...load(), ...recorded };
  const sorted = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(FILE, JSON.stringify(sorted, null, 2) + "\n");
}
