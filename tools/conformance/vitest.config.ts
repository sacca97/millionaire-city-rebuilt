import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: path.resolve(__dirname),
  test: {
    include: ["**/*.test.ts"],
    globalSetup: ["./lib/globalSetup.ts"],
    testTimeout: 90_000,
    hookTimeout: 90_000,
    // Each test file starts its own server(s) on ports 32200-32399 (3 ports per server); keep the pool small enough
    // for the port range and for slow machines.
    maxWorkers: Number(process.env.CONF_WORKERS ?? 6),
    minWorkers: 1,
    // The server logs a line per request; keep the vitest output readable.
    silent: true,
    reporters: ["default"]
  }
});
