import { Buffer } from "buffer";

/**
 * The two Node globals `mdb-reader` and its dependencies expect.
 *
 * **Import this first.** ES module bodies run in import order, and both of
 * these are referenced while modules are being *evaluated*, not just when
 * they are called — so a module that assigns them has to appear above the one
 * that needs them. Assigning from the worker's own body is too late.
 *
 * `Buffer`, because mdb-reader's browser build calls `Buffer.alloc`,
 * `Buffer.concat` and `Buffer.from` as globals, and reads Jet's pages with
 * `readUInt32LE` and friends — so raw bytes from a `File` are not enough. See
 * `JetBuffer` in `@eperx/importer` for the type that turns that into a compile
 * error rather than a page fault.
 *
 * `process`, because mdb-reader pulls in `create-hash` and `browserify-aes`
 * for *encrypted* databases, and those reach `readable-stream`, which touches
 * `process.nextTick` at module scope. ePER's databases are not encrypted, so
 * that code never runs — but it is evaluated, and evaluation is enough to
 * throw. Hence a minimal stand-in rather than a full polyfill: enough for the
 * module graph to load, and no pretence of being Node.
 */
interface NodeProcess {
  env: Record<string, string | undefined>;
  argv: string[];
  /** `readable-stream` slices this at module scope, so it must be a string. */
  version: string;
  versions: Record<string, string>;
  platform: string;
  browser: boolean;
  nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) => void;
  emitWarning: () => void;
  cwd: () => string;
}

const target = globalThis as { Buffer?: typeof Buffer; process?: NodeProcess };

target.Buffer ??= Buffer;
target.process ??= {
  env: {},
  argv: [],
  // Not empty: `readable-stream` does `process.version.slice(...)` while being
  // evaluated, and `undefined.slice` is what an earlier, thinner shim died on.
  version: "v22.0.0",
  versions: {},
  platform: "browser",
  browser: true,
  // `queueMicrotask` is the closest a browser comes, and matches `nextTick`'s
  // "before the next task" ordering.
  nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)),
  emitWarning: () => {},
  cwd: () => "/",
};
