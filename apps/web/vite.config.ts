import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig, type Plugin, type ViteDevServer, type PreviewServer } from "vite";

/**
 * Serve an imported tree (or a mounted disc's `data/`) at `/data`, honouring
 * `Range`.
 *
 * Point it at a directory with `EPERX_DATA`:
 *
 * ```sh
 * EPERX_DATA=./data pnpm dev
 * ```
 *
 * This exists because the tree lives outside the repo — on a mounted DVD or an
 * imported folder — and Vite's static handling is scoped to `server.fs.allow`
 * and will not follow a symlink out of it. It is development tooling only; in
 * production the tree is served by whatever static host holds it, which is the
 * entire deployment story.
 *
 * `Range` is not optional. Without it a client would have to download a 568 MB
 * database to read a few pages of it, so `HttpSource` refuses a host that
 * ignores the header — and a dev server that quietly answered `200` would hide
 * exactly the bug that check exists for.
 */
function dataTree(root: string | undefined): Plugin {
  // Both hooks: `vite preview` does not run `configureServer`, and preview is
  // the closest thing to how this is actually deployed — so it is the one most
  // worth being able to point at a real tree.
  return {
    name: "eperx:data-tree",
    configureServer: (server) => mount(server, root),
    configurePreviewServer: (server) => mount(server, root),
  };
}

function mount(server: ViteDevServer | PreviewServer, root: string | undefined): void {
  if (!root) return;
  const base = resolve(root);

  // `pnpm dev` runs Vite with `apps/web` as its working directory, so a
  // relative `EPERX_DATA` resolves against that and not the repo root. Getting
  // it wrong used to register the route anyway and 404 every request, which
  // surfaced in the browser as an unrelated-looking failure to open the tree.
  if (!existsSync(base) || !statSync(base).isDirectory()) {
    server.config.logger.warn(
      `  ⚠  EPERX_DATA=${root} is not a directory (looked in ${base}).\n` +
        `     Use an absolute path — Vite's working directory is apps/web.`,
    );
    return;
  }

  server.config.logger.info(`  ➜  Data:    /data → ${base}`);

  // Byte accounting, because the client cannot do it: SQLite fetches its pages
  // inside a worker and the main thread cannot see those resource timings.
  // Counting here is the only honest way to know what a query costs.
  // `EPERX_TRACE=1` prints a running total; `/__eperx-traffic` returns it.
  const served = new Map<string, { requests: number; bytes: number }>();
  const trace = process.env["EPERX_TRACE"] === "1";
  const count = (file: string, bytes: number): void => {
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

  server.middlewares.use("/data", (req: IncomingMessage, res: ServerResponse, next) => {
    // `normalize` collapses `..` before the prefix check, so a request cannot
    // climb out of the tree.
    const rel = normalize(decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/"));
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

    // A client asks HEAD first to learn the size. Falling through to the body
    // path here would try to stream 568 MB in answer to a HEAD.
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

    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
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
}

/**
 * Version and repository, read at build time and injected as string literals.
 *
 * `define` rather than importing `package.json`, so the manifest never reaches
 * the browser and the displayed version cannot drift from the one a release
 * tag names. The root manifest is the repo's version — the same thing a
 * GitHub release is cut from — not `apps/web`'s.
 */
const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
) as { version: string; repository?: { url?: string } };

const REPO_URL = (manifest.repository?.url ?? "https://github.com/emdzej/eperx").replace(
  /\.git$/,
  "",
);

export default defineConfig({
  /**
   * Where the app will be served from. Baked in at build time — a built
   * bundle cannot be relocated afterwards — so a custom domain (root) and the
   * default `<user>.github.io/<repo>/` need different builds. The Pages
   * workflow decides which from the presence of `public/CNAME`.
   */
  base: process.env["BASE_PATH"] ?? "/",

  define: {
    __APP_VERSION__: JSON.stringify(manifest.version),
    __REPO_URL__: JSON.stringify(REPO_URL),
  },

  plugins: [
    svelte(),
    dataTree(process.env["EPERX_DATA"]),
    /*
     * `injectManifest`, not `generateSW`.
     *
     * eperx's worker is written out by hand in `src/sw.ts` because it has a
     * second, older job: serving a picked folder or the origin private
     * filesystem to SQLite over `Range`. A generated worker with a
     * runtime-caching config could not be trusted next to that — see the note
     * at the top of `sw.ts`. All the plugin does here is hand it the list of
     * built shell files.
     */
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      // Registered by hand in `main.ts`, so a failure is visible in the
      // console rather than swallowed.
      injectRegister: null,
      registerType: "autoUpdate",
      injectManifest: {
        /*
         * The shell only — a tree is never a build artifact.
         *
         * `.wasm` is in the list deliberately, and it is most of the weight:
         * 3.6 MB of SQLite for reading and 864 kB for the importer. Without
         * them "offline" would mean the app launches and cannot read
         * anything, which is worse than no offline at all. So the install is
         * about 5.9 MB and eperx works with the network off, importer
         * included.
         */
        globPatterns: ["**/*.{js,css,html,png,svg,wasm,webmanifest}"],
        // Two of those files are over the default 2 MiB ceiling and would be
        // silently dropped from the precache.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        /*
         * A classic worker, not an ES module: module workers are still absent
         * from Firefox, and this one imports nothing, so the module format
         * costs that browser the whole feature and buys nothing.
         */
        rollupFormat: "iife",
      },
      manifest: {
        name: "eperx — Fiat group parts catalogue",
        short_name: "eperx",
        description:
          "The ePER parts catalogue for Fiat, Lancia, Alfa Romeo, Abarth, LCV and " +
          "Chrysler, read in the browser from your own disc. No backend.",
        /*
         * The interface's own colours, so the splash and the title bar are not
         * a different product to the app: Italian green as the accent and the
         * flag's off-white as the page, which is what the light palette is.
         */
        theme_color: "#008C45",
        background_color: "#F4F5F0",
        display: "standalone",
        orientation: "any",
        /*
         * Relative, both of them. A build served from `<user>.github.io/<repo>/`
         * needs a scope under that prefix, and an absolute `/` would claim the
         * whole origin and fail to install.
         */
        start_url: ".",
        scope: ".",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          // Android crops an icon to the launcher's shape; a maskable one is
          // drawn with the margin that survives it.
          {
            src: "icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      // Development serves the real files; a cached shell there means editing
      // one and being served the previous one.
      devOptions: { enabled: false },
    }),
  ],

  // Vite's dependency pre-bundler rewrites `sqlite-wasm-http` in dev and its
  // worker then loads as `?worker_file&type=classic`, which fails outright
  // ("Worker bootstrap failed"). Excluding it leaves the package's own module
  // graph intact, which is what its worker URLs are relative to.
  optimizeDeps: { exclude: ["sqlite-wasm-http"] },

  // SQLite's WASM worker code-splits, and Vite's default worker format
  // (`iife`) cannot express that — the build fails outright rather than
  // producing something broken. ES workers are supported everywhere that
  // supports WASM, so nothing is lost.
  worker: { format: "es" },

  // SQLite's WASM binary is 3.6 MB (1.75 MB gzipped) and every byte is needed
  // before the first query, so it must not be inlined into a JS chunk as
  // base64 — that would cost a third more bytes and block parsing. It dwarfs
  // the app's own 26 kB gzipped, and is the price of running real SQL in the
  // browser instead of shipping a backend.
  build: { assetsInlineLimit: 0 },
});
