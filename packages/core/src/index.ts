/**
 * Shared vocabulary for the ePER formats.
 *
 * Everything that reads bytes goes through {@link ByteSource}, so the same
 * reader works over a local file, a mounted disc, or an HTTP server that
 * honours `Range`. Nothing in this package knows about any of those.
 */

/** A random-access run of bytes. The one primitive every reader needs. */
export interface ByteSource {
  /** Total length in bytes. */
  size(): Promise<number>;
  /**
   * Read `len` bytes at `pos`. Returning fewer bytes than asked for means
   * end-of-source; readers treat a short read as an error rather than
   * padding, so a truncated file cannot be mistaken for valid data.
   */
  read(pos: number, len: number): Promise<Uint8Array>;
}

/** The five brands ePER ships, keyed by `MAKES.MK_COD`. */
export type MakeCode = "F" | "L" | "R" | "T" | "C" | "E";

/**
 * The catalogue hierarchy, in ePER's own terms. `Make → Model → Catalogue →
 * Group → SubGroup → SubSubGroup → Table → Drawing → Part`, with cliches
 * hanging off individual parts.
 *
 * The Italian column prefixes in the database (`GRP`, `SGRP`, `SGS`, `DRW`,
 * `PRT`, `CAT`) are kept as-is: the data uses them as keys and renaming them
 * would add a layer to get wrong.
 */
export interface CatalogueRef {
  /** `CATALOGUES.CAT_COD` — two or three characters, e.g. `"13"`. */
  cat: string;
}

/** An image in the `data/images/*.res` shards, as `DRAWINGS.IMG_PATH` spells it. */
export interface ImageRef {
  /** Shard, the first two hex characters of the id, e.g. `"BA"`. */
  shard: string;
  /** Entry name inside the shard, e.g. `"BA061CCF4B1E35C4D1CD4DF5A6B37B1B.png"`. */
  entry: string;
}

/**
 * Split a `DRAWINGS.IMG_PATH` (`"BA/BA061CCF….png"`) into shard and entry.
 *
 * The shard is not derivable from the entry name alone in the general case —
 * it is whatever precedes the slash — so this reads the path rather than
 * recomputing it from the first two characters.
 */
export function parseImagePath(imgPath: string): ImageRef | undefined {
  const slash = imgPath.indexOf("/");
  if (slash <= 0 || slash === imgPath.length - 1) return undefined;
  return { shard: imgPath.slice(0, slash), entry: imgPath.slice(slash + 1) };
}
