// Writes layout.js: a sample road network plus the original tile indices (computed with the game's own tile logic).
// Run: npx tsx tools/road-compare/gen-layout.mts
import fs from "node:fs";
import { computeTileIndices, tilesetIndex } from "../../apps/client/src/terrain";

const cols = 26, rows = 14;
const road = new Set<number>();
const put = (x: number, y: number) => road.add(y * cols + x);
for (let x = 1; x <= 24; x += 1) put(x, 3);            // main street
for (let x = 4; x <= 20; x += 1) put(x, 10);           // lower street
for (let y = 3; y <= 10; y += 1) { put(4, y); put(20, y); } // two avenues (loop corners)
for (let y = 3; y <= 7; y += 1) put(12, y);            // T branch
for (let y = 0; y <= 3; y += 1) put(8, y);             // stub going up
for (let x = 22; x <= 24; x += 1) put(x, 7);           // short spur
for (let y = 3; y <= 7; y += 1) put(24, y);            // bend
for (let y = 0; y <= 8; y += 1) put(16, y);            // four-way crossing with the main street
const data = computeTileIndices({ cols, rows, terrain: new Set<number>(), road });
const indices = Array.from(data, (v) => tilesetIndex(v));
const roads = [...road].map((i) => [i % cols, Math.floor(i / cols)]);
fs.writeFileSync(new URL("./layout.js", import.meta.url), `window.LAYOUT = ${JSON.stringify({ cols, rows, indices, roads })};\n`);
console.log("layout.js", roads.length, "road tiles");
