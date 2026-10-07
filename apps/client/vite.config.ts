import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const server = process.env.MCITY_SERVER ?? "http://127.0.0.1:31803";
const here = fileURLToPath(new URL(".", import.meta.url));
// MCITY_OPT=1: use the optimised asset tree built by tools/optimize_assets.py (public-opt) instead of public.
// MCITY_NO_PUBLIC=1: skip copying assets (fast code-only builds).
const publicDir = process.env.MCITY_NO_PUBLIC ? false : path.join(here, process.env.MCITY_OPT ? "public-opt" : "public");

/** Optimised art keeps its original `X.png` URLs for gui/ground; answer them from `X.webp` when the PNG is absent. */
function webpFallback(dir: string | false): Plugin {
  const mw = (req: { url?: string }, _res: unknown, next: () => void) => {
    const u = req.url ?? "";
    const q = u.indexOf("?");
    const p = q < 0 ? u : u.slice(0, q);
    if (dir && p.endsWith(".png") && /^\/(gui|ground|sprites)\//.test(p)) {
      const rel = decodeURIComponent(p);
      if (!fs.existsSync(path.join(dir, rel)) && fs.existsSync(path.join(dir, rel.slice(0, -4) + ".webp"))) {
        req.url = p.slice(0, -4) + ".webp" + (q < 0 ? "" : u.slice(q));
      }
    }
    next();
  };
  return {
    name: "mcity-webp-fallback",
    configureServer: (s) => void s.middlewares.use(mw),
    configurePreviewServer: (s) => void s.middlewares.use(mw)
  };
}

/** Write .br/.gz next to every text asset in the build output (served by apps/server/src/clientStatic.ts). */
function precompress(): Plugin {
  const TEXT = /\.(js|css|json|html|svg|txt|xml|mjs)$/;
  let out = "";
  return {
    name: "mcity-precompress",
    apply: "build",
    configResolved: (c) => void (out = path.resolve(c.root, c.build.outDir)),
    closeBundle() {
      const walk = (d: string) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p);
          else if (TEXT.test(e.name)) {
            const buf = fs.readFileSync(p);
            if (buf.length < 512) continue;
            fs.writeFileSync(p + ".gz", zlib.gzipSync(buf, { level: 9 }));
            fs.writeFileSync(p + ".br", zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }));
          }
        }
      };
      walk(out);
    }
  };
}

export default defineConfig({
  publicDir,
  plugins: [webpFallback(publicDir), precompress()],
  resolve: {
    alias: [
      { find: "@mcity/rules", replacement: fileURLToPath(new URL("../../packages/rules/src/index.ts", import.meta.url)) },
      // ship only the latin subsets of the web fonts (EN texts only; other scripts fall back to system fonts)
      { find: /^@fontsource\/([^/]+)\/(\d+)\.css$/, replacement: "@fontsource/$1/latin-$2.css" }
    ]
  },
  build: {
    chunkSizeWarningLimit: 900, // the pixi vendor chunk is ~0.5-0.8 MB by itself
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/pixi.js") || id.includes("node_modules/@pixi")) return "pixi";
          return undefined;
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/Game": server,
      "/mcity": server
    }
  }
});
