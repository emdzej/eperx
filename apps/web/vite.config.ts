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
        createReadStream(path, { start, end }).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [svelte(), dataTree(process.env["EPERX_DATA"])],
});
