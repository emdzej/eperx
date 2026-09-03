import { createReadStream, statSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, type Plugin } from "vite";

/**
 * Serve an imported tree (or a mounted disc's `data/`) at `/data`, honouring
 * `Range`.
 *
 * Point it at a directory with `EPERX_DATA`:
 *
 * ```sh
 * EPERX_DATA="/Volumes/ePER ed.83/data" pnpm dev
 * ```
 *
 * This exists because the tree lives outside the repo — on a mounted DVD or
 * an imported folder — and Vite's static handling is scoped to `server.fs.allow`
 * and does not follow a symlink out of it. It is dev-only; in production the
 * tree is served by whatever static host holds it, which is the entire
 * deployment story.
 *
 * `Range` is not optional here. Without it the client would have to download a
 * 19 MB archive to read one 25 KB drawing, so the client refuses a host that
 * ignores the header — and a dev server that quietly answered `200` would hide
 * exactly the bug this is meant to exercise.
 */
function dataTree(root: string | undefined): Plugin {
  return {
    name: "eperx:data-tree",
    configureServer(server) {
      if (!root) return;
      const base = resolve(root);
      server.config.logger.info(`  ➜  Data:    /data → ${base}`);

      // Byte accounting, because the client cannot do it: SQLite fetches its
      // pages inside a worker and the main thread cannot see those resource
      // timings. Counting here is the only honest way to know what a query
      // actually costs. `EPERX_TRACE=1` prints a running total.
      const served = new Map<string, { requests: number; bytes: number }>();
      const trace = process.env["EPERX_TRACE"] === "1";
      const count = (file: string, bytes: number) => {
        const row = served.get(file) ?? { requests: 0, bytes: 0 };
        row.requests++;
        row.bytes += bytes;
        served.set(file, row);
        if (trace) {
          server.config.logger.info(
            `  ${file}  ${row.requests} reqs  ${(row.bytes / 1024).toFixed(1)} kB`,
          );
        }
      };
      server.middlewares.use("/__eperx-traffic", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(Object.fromEntries(served)));
      });

      server.middlewares.use("/data", (req, res, next) => {
        // `normalize` collapses `..` before the prefix check, so a request
        // cannot climb out of the tree.
        const rel = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]!));
        const path = join(base, rel);
        if (!path.startsWith(base)) {
          res.statusCode = 403;
          res.end("outside the data tree");
          return;
        }

        let size: number;
        try {
          const stat = statSync(path);
          if (!stat.isFile()) return next();
          size = stat.size;
        } catch {
          return next();
        }

        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Type", "application/octet-stream");

        // A client asks HEAD first to learn the size. Falling through to the
        // body path here would try to stream 536 MB in answer to a HEAD.
        if (req.method === "HEAD") {
          res.setHeader("Content-Length", size);
          res.end();
          return;
        }

        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
        if (!match) {
          res.setHeader("Content-Length", size);
          createReadStream(path).pipe(res);
          return;
        }

        const [, rawStart, rawEnd] = match as unknown as [string, string, string];
        const start = rawStart ? Number(rawStart) : 0;
        const end = rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1;
        if (start > end || start >= size) {
          res.statusCode = 416;
          res.setHeader("Content-Range", `bytes */${size}`);
          res.end();
          return;
        }

        res.statusCode = 206;
        res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
        res.setHeader("Content-Length", end - start + 1);
        count(rel.replace(/^\//, ""), end - start + 1);
        createReadStream(path, { start, end }).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [svelte(), dataTree(process.env["EPERX_DATA"])],

  // SQLite's WASM worker code-splits, and Vite's default worker format
  // (`iife`) cannot express that — the build fails outright rather than
  // producing something broken. ES workers are supported everywhere that
  // supports WASM, so there is nothing lost.
  worker: { format: "es" },

  // Vite's dependency pre-bundler rewrites `sqlite-wasm-http` in dev and its
  // worker then loads as `?worker_file&type=classic`, which fails outright
  // ("Worker bootstrap failed"). Excluding it leaves the package's own module
  // graph intact, which is what its worker URLs are relative to. Production
  // builds are unaffected; this is a dev-server-only problem.
  optimizeDeps: { exclude: ["sqlite-wasm-http"] },

  // SQLite's WASM binary is 3.6 MB (1.75 MB gzipped) and every byte is needed
  // before the first query, so it must not be inlined into a JS chunk as
  // base64 — that would cost a third more bytes and block parsing. It dwarfs
  // the app's own 26 kB gzipped, and is the price of running real SQL in the
  // browser instead of shipping a backend.
  build: { assetsInlineLimit: 0 },
});
