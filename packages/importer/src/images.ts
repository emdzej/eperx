import type { CsFile, CsFileSystem, WritableFileSystem } from "@emdzej/csfs-core";
import { indexShard, SHARD_SUFFIX } from "@eperx/res";
import { listShards } from "./disc.js";
import type { SqlWriter } from "./sql.js";

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
  sourceFs: CsFileSystem;
  /** `<disc>/data/images`, relative to the source root. */
  imagesDir: string;
  /**
   * Where the shards go, or `undefined` to index them where they are.
   *
   * Indexing in place records byte ranges into files the tree does not
   * contain, which only makes sense when something else will serve the disc.
   */
  target?: {
    fs: WritableFileSystem;
    dir: string;
    /**
     * How a shard gets there. Defaults to streaming its bytes.
     *
     * The CLI overrides this for `--link`, which csfs has no concept of
     * because no browser does — a symlink is a fact about a real filesystem,
     * and only the Node backend is on one.
     */
    place?: (file: CsFile, to: string) => Promise<void>;
  };
  /** The catalogue database, to write the `images` table into. */
  writer: SqlWriter;
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
  const shards = await listShards(options.sourceFs, options.imagesDir);
  if (options.target) await options.target.fs.makeDirectory(options.target.dir);

  const db = options.writer;
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
    const shard = name.slice(0, name.length - SHARD_SUFFIX.length);
    const path = `${options.imagesDir}/${name}`;
    const file = await options.sourceFs.file(path);
    if (!file) throw new Error(`${path} disappeared while indexing`);
    {
      const entries = await indexShard(file);

      db.exec("BEGIN");
      for (const entry of entries) {
        insert.run([entry.name, shard, entry.offset, entry.length, entry.method, entry.size]);
      }
      db.exec("COMMIT");

      if (options.target) {
        const to = `${options.target.dir}/${name}`;
        const place =
          options.target.place ??
          // Streamed, so a 19 MB shard is never held whole.
          ((from, at) => options.target!.fs.write(at, from.stream()));
        await place(file, to);
      }
      result.shards++;
      result.entries += entries.length;
      result.deflated += entries.filter((e) => e.method !== 0).length;
      result.bytes += file.size;
      options.onProgress?.({ shard, index, count: shards.length, entries: entries.length });
    }
  }

  insert.finalize();
  return result;
}
