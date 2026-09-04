/**
 * Turning an ePER disc into a tree a browser can read.
 *
 * The same code runs in the CLI and in a browser tab. What differs is only
 * how bytes move — see `fs.ts` for the filesystem the importer talks to and
 * `sql.ts` for the slice of SQLite it writes through.
 */
export type { SourceFile, SourceFs, TargetFs } from "./fs.js";
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
