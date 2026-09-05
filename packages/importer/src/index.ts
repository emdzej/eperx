/**
 * Turning an ePER disc into a tree a browser can read.
 *
 * The same code runs in the CLI and in a browser tab. What differs is only
 * how bytes move, and that is csfs's problem rather than ours: the importer
 * takes a `CsFileSystem` to read and a `WritableFileSystem` to write, and
 * `@emdzej/csfs-node`, `-fsa`, `-opfs` and `-http` supply them. `sql.ts` holds
 * the one thing csfs has no opinion about — the slice of SQLite this writes
 * through.
 */
export type { JetBuffer } from "./jet.js";
export type { OpenSqlWriter, SqlInput, SqlStatement, SqlWriter } from "./sql.js";
export { listShards, openDisc, type Disc, type DiscFiles } from "./disc.js";
export {
  convertDatabase,
  DEFAULT_PAGE_SIZE,
  finaliseDatabase,
  type ConvertOptions,
  type ConvertProgress,
  type ConvertResult,
} from "./convert.js";
export { importImages, type ImportImagesOptions, type ImportImagesResult } from "./images.js";
export { ACCESSORIES_INDEXES, CATALOGUE_INDEXES } from "./indexes.js";
export {
  ACCESSORIES_DB,
  CATALOGUE_DB,
  MANIFEST,
  buildManifest,
  type Manifest,
} from "./manifest.js";
