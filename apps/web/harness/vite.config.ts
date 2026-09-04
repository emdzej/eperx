import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import base from "../vite.config";

/**
 * Builds the import harness on its own, so none of it reaches the app.
 *
 * It inherits the app's config for the parts that are load-bearing —
 * `worker: { format: "es" }` above all, without which the SQLite worker cannot
 * code-split and the build fails.
 */
export default defineConfig({
  ...base,
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/",
  plugins: [],
  build: {
    ...(typeof base === "object" && "build" in base ? base.build : {}),
    outDir: fileURLToPath(new URL("../dist-harness", import.meta.url)),
    emptyOutDir: true,
  },
});
