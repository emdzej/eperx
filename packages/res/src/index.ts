import type { CsFile } from "@emdzej/csfs-core";
import { readCentralDirectory, resolvePayload, type ZipPayload } from "./zip.js";

export { DEFLATED, readCentralDirectory, resolvePayload, STORED } from "./zip.js";
export type { ZipEntry, ZipPayload } from "./zip.js";

/**
 * `DRAWINGS.IMG_PATH` names an image as `"BA/BA061CCF….png"`: the part before
 * the slash is the shard file (`BA.res`) and the rest is the entry within it.
 *
 * ePER's own configuration spells this out — `ImageMapServlet.ImagePath` points
 * at `data/images/` with `DivideByFirstFolder=true`.
 */
export const SHARD_SUFFIX = ".res";

/** Thumbnails live beside their full image under a `.th.png` name. */
export function thumbnailName(entry: string): string {
  return entry.replace(/\.png$/i, ".th.png");
}

/**
 * Index one shard: every stored entry resolved to its exact payload range.
 *
 * Reading the local headers costs one small read per entry, which is why this
 * runs at import time and the result is stored. A browser then needs a single
 * `Range` request per image and no central-directory fetch at all.
 */
export async function indexShard(file: CsFile): Promise<ZipPayload[]> {
  const entries = await readCentralDirectory(file);
  const out: ZipPayload[] = [];
  for (const entry of entries) out.push(await resolvePayload(file, entry));
  return out;
}
