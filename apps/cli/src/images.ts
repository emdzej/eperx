import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { DatabaseSync } from "./sqlite.js";
import { indexShard, SHARD_SUFFIX } from "@eperx/res";
import { listShards } from "./disc.js";
import { FileSource } from "./node-source.js";

/**
 * Import the drawing shards.
 *
 * The shards are **copied, not converted**. Every entry in the 256 hex-named
 * shards is stored rather than deflated, so the bytes of a `.png` entry are
 * already a valid PNG: a browser fetches one with a single `Range` request
 * against the vendor's own file. Re-packing 4.7 GB of images would gain
 * nothing and would put a transcoding step between the disc and what the user
 * sees.
 *
 * The five `L_*` shards mix in deflated entries, so the index records each
 * entry's method. A drawing never needs inflating; a fabric swatch might.
 *
 * What does get built is an index. Resolving an entry to its payload needs
 * its local header read, and doing that in the browser would cost an extra
 * round trip per image; doing it once here costs one row per entry.
 */

export interface ImportImagesOptions {
  /** `<mount>/data/images`. */
  imagesDir: string;
  /** Directory to copy the shards into, or `undefined` to index in place. */
  targetDir?: string;
  /** Catalogue database to write the `images` table into. */
  catalogue: string;
  onProgress?: (event: { shard: string; index: number; count: number; entries: number }) => void;
}

export interface ImportImagesResult {
  shards: number;
  entries: number;
  bytes: number;
  /** Entries that are deflated rather than stored — all in the `L_*` shards. */
  deflated: number;
}

export async function importImages(options: ImportImagesOptions): Promise<ImportImagesResult> {
  const shards = listShards(options.imagesDir);
  if (options.targetDir) mkdirSync(options.targetDir, { recursive: true });

  const db = new DatabaseSync(options.catalogue);
  db.exec("PRAGMA journal_mode = OFF");
  db.exec("PRAGMA synchronous = OFF");
  // `entry` is the whole lookup key: `DRAWINGS.IMG_PATH` gives the shard too,
  // but the entry name already begins with the shard, and thumbnails share it.
  db.exec(`
    CREATE TABLE IF NOT EXISTS images (
      entry  TEXT PRIMARY KEY,
      shard  TEXT NOT NULL,
      offset INTEGER NOT NULL,
      length INTEGER NOT NULL,   -- bytes on disc
      method INTEGER NOT NULL,   -- 0 stored, 8 raw deflate
      size   INTEGER NOT NULL    -- bytes after inflating
    ) WITHOUT ROWID
  `);
  const insert = db.prepare("INSERT OR REPLACE INTO images VALUES (?, ?, ?, ?, ?, ?)");

  const result: ImportImagesResult = { shards: 0, entries: 0, bytes: 0, deflated: 0 };

  for (const [index, name] of shards.entries()) {
    const from = join(options.imagesDir, name);
    const shard = basename(name, SHARD_SUFFIX);
    const source = new FileSource(from);
    let entries;
    try {
      entries = await indexShard(source);
    } finally {
      source.close();
    }

    db.exec("BEGIN");
    for (const entry of entries) {
      insert.run(entry.name, shard, entry.offset, entry.length, entry.method, entry.size);
    }
    db.exec("COMMIT");

    if (options.targetDir) copyFileSync(from, join(options.targetDir, name));

    result.shards++;
    result.entries += entries.length;
    result.deflated += entries.filter((e) => e.method !== 0).length;
    result.bytes += statSync(from).size;
    options.onProgress?.({ shard, index, count: shards.length, entries: entries.length });
  }

  db.exec("PRAGMA optimize");
  db.close();
  return result;
}
