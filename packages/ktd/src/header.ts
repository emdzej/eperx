import type { ByteSource } from "@eperx/core";

/**
 * The F3 ("KTD") header, as `SP.CH`, `SP.RT`, `SP.TR` and `SP.RTCHRY` write it.
 *
 * A blocked, sorted, bzip2-compressed store with a sparse index — ePER's own
 * format, and the only one on the disc that is not Access or ZIP. It holds the
 * per-vehicle data: 41,422,723 chassis records in `SP.CH`, 10,486,480 build
 * records in `SP.RT` and 120,134,472 fitment rows in `SP.TR`.
 *
 * The layout is documented by
 * [openPER](https://github.com/CReynolds/openPER)'s `KtdReader`, which is MIT
 * licensed; every field below was then read out of all four files on edition
 * 83 to confirm it. `docs/data-format.md` §4 records what each file holds.
 *
 * ```
 *  0   2   "F3"
 *  2   4   record count
 *  6   2   records per block
 *  8  20   reference table positions (5 × uint32, 0 = unused)
 * 28   4   primary index position
 * 32  12   secondary index positions (3 × uint32)
 * 44  20   table name, NUL-padded ASCII
 * 64   1   primary key field count
 * 65  ..   primary key fields (23 bytes each)
 *      1   secondary index count
 *          per index: 1 byte field count, then its fields
 *      1   column count
 *     ..   columns (23 bytes each)
 * ```
 */

const MAGIC = "F3";

/** Bytes per field descriptor: 20 name + type + start + length. */
const FIELD_SIZE = 23;

/** Enough to cover the longest header seen: `SP.RT`, with 21 columns. */
const HEADER_PROBE = 8192;

export const F3Type = {
  /** Value sits inline in the packed record, `length` bytes wide. */
  String: 1,
  /** Packed record holds a uint16 index into a reference table. */
  Reference: 0,
} as const;

export interface F3Field {
  name: string;
  type: number;
  /** Offset in the **unpacked** record. */
  start: number;
  /** Width in the unpacked record. `0` means "to the end of the record". */
  length: number;
}

export interface F3Header {
  table: string;
  records: number;
  recordsPerBlock: number;
  referenceTables: number[];
  primaryIndex: number;
  secondaryIndexes: number[];
  /**
   * Fields making up the primary key. Their `start`/`length` index the
   * unpacked record, so the key is those slices concatenated — which is why
   * `SP.CH`'s key field `MODEL` is the first 3 bytes of its `MVS` column.
   */
  primaryKey: F3Field[];
  /** Field names of each secondary index. Not read: no lookup needs them. */
  secondaryKeys: F3Field[][];
  columns: F3Field[];
  /** Total width of the primary key in bytes. */
  keyLength: number;
  /** Offset of each column within the *packed* record. */
  packedOffsets: number[];
  /** Bytes a reference column adds when unpacked, summed. */
  referenceExpansion: number;
  /** True when a column has `length === 0`, so records vary in size. */
  variableLength: boolean;
}

export async function readHeader(source: ByteSource): Promise<F3Header> {
  const buf = await source.read(0, HEADER_PROBE);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const ascii = new TextDecoder("ascii");

  const magic = ascii.decode(buf.subarray(0, 2));
  if (magic !== MAGIC) {
    throw new Error(`not an F3 file: magic was ${JSON.stringify(magic)}`);
  }

  const fixed = (at: number): string => ascii.decode(buf.subarray(at, at + 20)).split("\0")[0]!;

  const readFields = (at: number, count: number): [F3Field[], number] => {
    const fields: F3Field[] = [];
    for (let i = 0; i < count; i++) {
      fields.push({
        name: fixed(at),
        type: buf[at + 20]!,
        start: buf[at + 21]!,
        length: buf[at + 22]!,
      });
      at += FIELD_SIZE;
    }
    return [fields, at];
  };

  let at = 64;
  const [primaryKey, afterPrimary] = readFields(at + 1, buf[at]!);
  at = afterPrimary;

  const secondaryKeys: F3Field[][] = [];
  const secondaryCount = buf[at]!;
  at += 1;
  for (let i = 0; i < secondaryCount; i++) {
    const [fields, next] = readFields(at + 1, buf[at]!);
    secondaryKeys.push(fields);
    at = next;
  }

  const [columns] = readFields(at + 1, buf[at]!);

  // A packed record stores a reference as 2 bytes and a string as its full
  // width, so the packed offsets differ from the unpacked `start` values.
  const packedOffsets: number[] = [];
  let packed = 0;
  let referenceExpansion = 0;
  for (const column of columns) {
    packedOffsets.push(packed);
    if (column.type === F3Type.Reference) {
      packed += 2;
      referenceExpansion += column.length - 2;
    } else if (column.type === F3Type.String) {
      packed += column.length;
    } else {
      throw new Error(`column ${column.name} has unknown type ${column.type}`);
    }
  }

  return {
    table: fixed(44),
    records: dv.getUint32(2, true),
    recordsPerBlock: dv.getUint16(6, true),
    referenceTables: [0, 1, 2, 3, 4]
      .map((i) => dv.getUint32(8 + i * 4, true))
      .filter((position) => position !== 0),
    primaryIndex: dv.getUint32(28, true),
    secondaryIndexes: [0, 1, 2]
      .map((i) => dv.getUint32(32 + i * 4, true))
      .filter((position) => position !== 0),
    primaryKey,
    secondaryKeys,
    columns,
    keyLength: primaryKey.reduce((n, field) => n + field.length, 0),
    packedOffsets,
    referenceExpansion,
    variableLength: columns.some((column) => column.length === 0),
  };
}

/**
 * Reference tables: a shared pool of repeated values.
 *
 * Only `SP.CH` has one, holding 11,033 distinct `MVS` codes — sensible, given
 * 41 million records share a few thousand vehicle versions.
 *
 * ```
 * uint32 count
 * uint32 width
 * count × bytes[width]
 * ```
 */
export async function readReferenceTables(
  source: ByteSource,
  header: F3Header,
): Promise<Uint8Array[][]> {
  const tables: Uint8Array[][] = [];
  for (const position of header.referenceTables) {
    const head = await source.read(position, 8);
    const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const count = dv.getUint32(0, true);
    const width = dv.getUint32(4, true);
    const body = await source.read(position + 8, count * width);
    const entries: Uint8Array[] = [];
    for (let i = 0; i < count; i++) entries.push(body.subarray(i * width, (i + 1) * width));
    tables.push(entries);
  }
  return tables;
}
