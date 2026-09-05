import type { CsFile } from "@emdzej/csfs-core";
import { decompress as bunzip } from "./bzip2.js";
import { F3Type, readHeader, readReferenceTables, type F3Field, type F3Header } from "./header.js";

/** One row, keyed by column name. Every value is ASCII, trimmed. */
export type F3Row = Record<string, string>;

/** One entry of the sparse primary index. */
interface IndexEntry {
  /** The **highest** key in this block. Verified against every first block. */
  key: string;
  start: number;
  end: number;
}

const ascii = new TextDecoder("ascii");

/**
 * A readable F3 table.
 *
 * The index is a sorted, fixed-width array, so it is **binary-searched over
 * ranged reads** rather than downloaded: `SP.CH`'s index is 20,712 entries of
 * 19 bytes — 393 kB — and a lookup touches about fifteen 19-byte slices of it.
 * With one block read after that, a chassis lookup against a 420 MB file costs
 * roughly 20 kB.
 */
export interface F3Options {
  /**
   * How to decompress a block. Defaults to bzip2.
   *
   * A seam, not a feature: it lets the index, prefix-detection and record
   * unpacking be tested against a synthetic file without needing a bzip2
   * *compressor*, which no dependency here provides.
   */
  decompress?: (input: Uint8Array) => Uint8Array;
}

export class F3Table {
  private indexCount?: number;
  private prefixSize?: 1 | 2;
  private references: Uint8Array[][] = [];
  private decompress: (input: Uint8Array) => Uint8Array = bunzip;

  private constructor(
    private readonly file: CsFile,
    readonly header: F3Header,
  ) {}

  static async open(file: CsFile, options: F3Options = {}): Promise<F3Table> {
    const header = await readHeader(file);
    const table = new F3Table(file, header);
    if (options.decompress) table.decompress = options.decompress;
    table.references = await readReferenceTables(file, header);
    return table;
  }

  /** Number of blocks, read from the front of the index. */
  async blocks(): Promise<number> {
    if (this.indexCount === undefined) {
      const head = await this.file
        .slice(this.header.primaryIndex, this.header.primaryIndex + 4)
        .bytes();
      this.indexCount = new DataView(head.buffer, head.byteOffset, 4).getUint32(0, true);
    }
    return this.indexCount;
  }

  private get entrySize(): number {
    return this.header.keyLength + 8;
  }

  private async entry(n: number): Promise<IndexEntry> {
    const at = this.header.primaryIndex + 4 + n * this.entrySize;
    const buf = await this.file.slice(at, at + this.entrySize).bytes();
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    return {
      key: ascii.decode(buf.subarray(0, this.header.keyLength)),
      start: dv.getUint32(this.header.keyLength, true),
      end: dv.getUint32(this.header.keyLength + 4, true),
    };
  }

  /**
   * The block that could hold `key`: the first whose key is `>= key`.
   *
   * Sound because each entry records the *highest* key in its block, which was
   * checked against the first block of all four files — the last record's key
   * equals the index entry exactly.
   */
  private async findBlock(key: string): Promise<IndexEntry | undefined> {
    const count = await this.blocks();
    let low = 0;
    let high = count - 1;
    let found: IndexEntry | undefined;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const entry = await this.entry(mid);
      if (entry.key >= key) {
        found = entry;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return found;
  }

  /**
   * Read and decompress one block into its rows.
   *
   * The block is a bare bzip2 stream. Blocks hold `recordsPerBlock` records —
   * 1,000, or 2,000 for `SP.CH` — so a decompressed block runs from 40 kB to
   * 820 kB.
   */
  private async readBlock(entry: IndexEntry): Promise<F3Row[]> {
    const compressed = await this.file.slice(entry.start, entry.end).bytes();
    if (compressed.length !== entry.end - entry.start) {
      throw new Error(`short read of block at ${entry.start}`);
    }
    const block = this.decompress(compressed);
    const prefix = this.prefixSize ?? this.detectPrefixSize(block, entry);
    return this.parseRecords(block, prefix);
  }

  /**
   * Work out whether record lengths are stored in one byte or two.
   *
   * This is **not** derivable from the header, and it differs per file: 1 for
   * `SP.CH`, 2 for `SP.RT`, `SP.TR` and `SP.RTCHRY`. Nor can it be settled by
   * checking that records tile the block — a two-byte length below 256 has a
   * zero high byte, which a one-byte reader consumes as the first content
   * byte, and the records then tile just as neatly one byte out of step.
   * `SP.TR` reads that way and produced a `MODELLO` of `"\0" + "10"`.
   *
   * What does settle it is the index's own promise: the last record in a block
   * has the key the index recorded for it. A wrong prefix shifts every field
   * and that equality fails.
   */
  private detectPrefixSize(block: Uint8Array, entry: IndexEntry): 1 | 2 {
    for (const candidate of [1, 2] as const) {
      try {
        const rows = this.parseRecords(block, candidate);
        const last = rows[rows.length - 1];
        if (last && this.keyOf(last) === entry.key) {
          return (this.prefixSize = candidate);
        }
      } catch {
        // A wrong guess usually fails to tile the block at all.
      }
    }
    throw new Error(
      `cannot tell whether record lengths are 1 or 2 bytes in ${this.header.table}: ` +
        `neither reading reproduces the index key ${JSON.stringify(entry.key)}`,
    );
  }

  private parseRecords(block: Uint8Array, prefix: 1 | 2): F3Row[] {
    const rows: F3Row[] = [];
    let at = 0;
    while (at < block.length) {
      const total = prefix === 1 ? block[at]! : block[at]! | (block[at + 1]! << 8);
      if (total <= prefix || at + total > block.length) {
        throw new Error(`record at ${at} claims ${total} bytes`);
      }
      rows.push(this.unpack(block.subarray(at + prefix, at + total)));
      at += total;
    }
    return rows;
  }

  /**
   * Expand a packed record into named values.
   *
   * A reference column stores a uint16 index; the value comes from the
   * reference table. A string column stores its bytes inline. A column with
   * `length === 0` runs to the end of the record, which is how `SP.CH.VIN`,
   * `SP.RT.CARATT` and `SP.RTCHRY.PATTERN` hold variable-length text.
   */
  private unpack(record: Uint8Array): F3Row {
    const size = record.length + this.header.referenceExpansion;
    const out = new Uint8Array(size);
    let reference = 0;

    for (const [i, column] of this.header.columns.entries()) {
      const packedAt = this.header.packedOffsets[i]!;
      if (column.type === F3Type.Reference) {
        const dv = new DataView(record.buffer, record.byteOffset, record.byteLength);
        const table = this.references[reference++];
        const value = table?.[dv.getUint16(packedAt, true)];
        if (value) out.set(value.subarray(0, column.length), column.start);
      } else {
        const width = column.length || size - column.start;
        out.set(record.subarray(packedAt, packedAt + width), column.start);
      }
    }

    const row: F3Row = {};
    for (const column of this.header.columns) {
      const width = column.length || size - column.start;
      row[column.name] = ascii.decode(out.subarray(column.start, column.start + width)).trim();
    }
    return row;
  }

  /** A row's primary key, as the index spells it. */
  keyOf(row: F3Row): string {
    // The key fields index the *unpacked* record, and a row is keyed by column
    // name, so the two are re-joined here rather than sliced from a buffer:
    // `SP.CH`'s key field `MODEL` is the first 3 bytes of the `MVS` column.
    return this.header.primaryKey.map((field) => this.slice(row, field)).join("");
  }

  private slice(row: F3Row, field: F3Field): string {
    for (const column of this.header.columns) {
      const width = column.length || Infinity;
      if (field.start >= column.start && field.start < column.start + width) {
        const value = row[column.name] ?? "";
        const from = field.start - column.start;
        return value.slice(from, from + field.length).padEnd(field.length, " ");
      }
    }
    return "".padEnd(field.length, " ");
  }

  /**
   * Every row whose key starts with `prefix`.
   *
   * One block read: the store is sorted, so a key's rows are contiguous, and a
   * prefix that spans a block boundary would need the next block too — that
   * has not been needed by any lookup so far and is reported rather than
   * silently truncating the answer.
   */
  async lookup(prefix: string): Promise<F3Row[]> {
    const entry = await this.findBlock(prefix.padEnd(this.header.keyLength, " "));
    if (!entry) return [];
    const rows = await this.readBlock(entry);
    const matches = rows.filter((row) => this.keyOf(row).startsWith(prefix));
    if (matches.length && this.keyOf(rows[rows.length - 1]!).startsWith(prefix)) {
      // The run reaches the end of the block, so it may continue in the next
      // one. Say so rather than return a partial answer as if it were whole.
      const count = await this.blocks();
      const index = await this.indexOf(entry, count);
      if (index !== undefined && index + 1 < count) {
        const next = await this.entry(index + 1);
        const more = (await this.readBlock(next)).filter((row) =>
          this.keyOf(row).startsWith(prefix),
        );
        matches.push(...more);
      }
    }
    return matches;
  }

  private async indexOf(entry: IndexEntry, count: number): Promise<number | undefined> {
    let low = 0;
    let high = count - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const candidate = await this.entry(mid);
      if (candidate.start === entry.start) return mid;
      if (candidate.key < entry.key) low = mid + 1;
      else high = mid - 1;
    }
    return undefined;
  }

  /**
   * The highest key present under `prefix`, or `undefined` if there is none.
   *
   * Used to tell "this vehicle is not in this release" apart from "this
   * vehicle is newer than this release". A disc is a snapshot: edition 83
   * stops at chassis `J168572` for the Fiat 500, so a later car is absent for
   * a reason worth reporting rather than a flat "not found".
   *
   * The index alone is not enough. It records each block's *highest* key, so
   * the last key under a prefix is usually inside a block whose own maximum is
   * already past the prefix — a run ending at `1010000400` sits in a block
   * indexed `1500000100`. Scanning index keys therefore understates the
   * answer, which a test caught. So the block that would *contain* the end of
   * the run is read and its rows examined, with the index-key scan kept as the
   * fallback for when that block turns out to hold none.
   */
  async highestKeyUnder(prefix: string): Promise<string | undefined> {
    // `\uffff` sorts above any byte the store uses, so this lands on the
    // block holding the end of the run.
    const entry = await this.findBlock(prefix + "\uffff".repeat(this.header.keyLength));
    if (entry) {
      const matching = (await this.readBlock(entry))
        .map((row) => this.keyOf(row))
        .filter((key) => key.startsWith(prefix));
      const last = matching[matching.length - 1];
      if (last) return last;
    }

    const count = await this.blocks();
    let low = 0;
    let high = count - 1;
    let best: string | undefined;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const candidate = await this.entry(mid);
      if (candidate.key.slice(0, prefix.length) <= prefix) {
        if (candidate.key.startsWith(prefix)) best = candidate.key;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return best;
  }

  /** Rows of one block, by index position. For inspection, not lookup. */
  async blockRows(n: number): Promise<F3Row[]> {
    return this.readBlock(await this.entry(n));
  }
}
