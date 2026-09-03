import type { ByteSource } from "@eperx/core";

/**
 * Just enough ZIP to read ePER's drawing shards.
 *
 * `data/images/*.res` are ordinary ZIP archives. Across all 261 shards on
 * edition 83, **every entry in the 256 hex-named shards is stored, not
 * deflated** — 219,253 entries, method 0 throughout. That is the property the
 * parts-drawing path rests on: the bytes of a `.png` entry are the bytes of
 * the PNG, so one HTTP `Range` request against the vendor's own file returns a
 * usable image with no decompression and no conversion.
 *
 * The five `L_*` shards are different. They carry auxiliary imagery — model
 * photographs, fabric swatches, promotional art — and 8,973 of their entries
 * are deflated, alongside `Thumbs.db` files and one stray `.pptx` that the
 * vendor packed by accident. So the method is recorded per entry rather than
 * assumed: a reader on the drawing path never inflates anything, and a reader
 * that wanders into `L_EPERTESSUTI` finds out from the data instead of from a
 * corrupt image.
 *
 * A general-purpose ZIP library would work locally but not here: this has to
 * run in a browser over `read(pos, len)`, reading a few hundred bytes out of a
 * 19 MB archive without downloading it.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

const EOCD_SIZE = 22;
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;

/** ZIP compression method 0: payload is the file. */
export const STORED = 0;
/** ZIP compression method 8: raw DEFLATE, as `DecompressionStream` eats it. */
export const DEFLATED = 8;

export interface ZipEntry {
  name: string;
  /** {@link STORED} for every drawing; {@link DEFLATED} occurs in `L_*`. */
  method: number;
  /** Bytes on disc. */
  compressedSize: number;
  /** Bytes after inflating. */
  size: number;
  /** Offset of this entry's *local header*, not of its data. */
  localHeaderOffset: number;
}

/** An entry resolved to the exact byte range its payload occupies. */
export interface ZipPayload {
  name: string;
  offset: number;
  /** Bytes on disc. For a deflated entry this is the compressed length. */
  length: number;
  /** {@link STORED} or {@link DEFLATED}. */
  method: number;
  /** Bytes after inflating. Equal to `length` when stored. */
  size: number;
}

/**
 * Read the central directory.
 *
 * The end-of-central-directory record sits at the end of the file behind a
 * comment of unknown length, so it has to be found by scanning backwards. The
 * comment can be 64 KB, but ePER's shards carry none — so the tail is probed
 * small first and only widened if that misses. Always reading the worst case
 * would cost 64 KB per shard opened, which is most of the traffic for a client
 * that then fetches a 25 KB drawing.
 */
const EOCD_PROBES = [1024, EOCD_SIZE + 0xffff];

export async function readCentralDirectory(source: ByteSource): Promise<ZipEntry[]> {
  const size = await source.size();

  let tail: Uint8Array | undefined;
  let dv: DataView | undefined;
  let eocd = -1;
  let lastProbe = 0;
  for (const want of EOCD_PROBES) {
    const probe = Math.min(size, want);
    if (probe <= lastProbe) break; // the file is smaller than the next probe
    lastProbe = probe;
    tail = await source.read(size - probe, probe);
    dv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    for (let at = tail.length - EOCD_SIZE; at >= 0; at--) {
      if (dv.getUint32(at, true) === EOCD_SIGNATURE) {
        eocd = at;
        break;
      }
    }
    if (eocd !== -1) break;
  }
  if (eocd === -1 || !dv) {
    throw new Error("not a ZIP archive: no end-of-central-directory record");
  }

  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff || count === 0xffff) {
    // No shard needs Zip64 — the largest is 19 MB with 878 entries — so rather
    // than ship an untested Zip64 path this refuses to guess.
    throw new Error("Zip64 archive; not implemented (no ePER shard needs it)");
  }

  const cd = await source.read(cdOffset, cdSize);
  const cdv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const utf8 = new TextDecoder();

  const entries: ZipEntry[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    if (cdv.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      throw new Error(`central directory entry ${i} has a bad signature`);
    }
    const nameLen = cdv.getUint16(at + 28, true);
    const extraLen = cdv.getUint16(at + 30, true);
    const commentLen = cdv.getUint16(at + 32, true);
    entries.push({
      name: utf8.decode(cd.subarray(at + CENTRAL_HEADER_SIZE, at + CENTRAL_HEADER_SIZE + nameLen)),
      method: cdv.getUint16(at + 10, true),
      compressedSize: cdv.getUint32(at + 20, true),
      size: cdv.getUint32(at + 24, true),
      localHeaderOffset: cdv.getUint32(at + 42, true),
    });
    at += CENTRAL_HEADER_SIZE + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Resolve an entry to the byte range of its payload.
 *
 * The local header has to be read: its extra field may differ in length from
 * the central directory's, so the data offset cannot be computed from the
 * central directory alone. Getting this wrong yields a PNG shifted by a few
 * bytes, which fails to decode rather than rendering something plausible —
 * but only for a reader that checks, so this reads.
 */
export async function resolvePayload(source: ByteSource, entry: ZipEntry): Promise<ZipPayload> {
  if (entry.method !== STORED && entry.method !== DEFLATED) {
    throw new Error(
      `entry ${entry.name} uses compression method ${entry.method}; ` +
        `only stored (0) and deflated (8) occur in ePER's shards`,
    );
  }
  const header = await source.read(entry.localHeaderOffset, LOCAL_HEADER_SIZE);
  const hv = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (hv.getUint32(0, true) !== LOCAL_SIGNATURE) {
    throw new Error(`entry ${entry.name} has no local header at ${entry.localHeaderOffset}`);
  }
  const nameLen = hv.getUint16(26, true);
  const extraLen = hv.getUint16(28, true);
  return {
    name: entry.name,
    offset: entry.localHeaderOffset + LOCAL_HEADER_SIZE + nameLen + extraLen,
    length: entry.compressedSize,
    method: entry.method,
    size: entry.size,
  };
}
