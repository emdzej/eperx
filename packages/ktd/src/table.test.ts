import { describe, expect, it } from "vitest";
import { RangeFile, type CsFile } from "@emdzej/csfs-core";
import { F3Table } from "./table.js";
import { chassisFromVin, typeCodeFromVin } from "./vin.js";
import { readHeader } from "./header.js";

/**
 * Synthetic F3 files, built byte by byte.
 *
 * No fixture here is derived from a disc, and no VIN in this file belongs to a
 * real vehicle — the numbers are made up to exercise the layout.
 *
 * Blocks are stored uncompressed and read back with an identity `decompress`,
 * because nothing in this repository can *produce* a bzip2 stream. That
 * covers the index, the prefix detection and the record unpacking; the bzip2
 * step itself is exercised by `eperx f3` against the real files.
 */

interface Column {
  name: string;
  type: 0 | 1;
  start: number;
  length: number;
}

interface Block {
  /** Packed records, already in key order. */
  records: Uint8Array[];
}

function field(f: Column): Uint8Array {
  const out = new Uint8Array(23);
  out.set(new TextEncoder().encode(f.name.slice(0, 20)), 0);
  out[20] = f.type;
  out[21] = f.start;
  out[22] = f.length;
  return out;
}

function buildF3(options: {
  table: string;
  primaryKey: Column[];
  columns: Column[];
  blocks: Block[];
  prefixSize: 1 | 2;
  referenceTable?: { width: number; entries: string[] };
}): Uint8Array {
  const encoder = new TextEncoder();
  const head = new Uint8Array(64);
  head.set(encoder.encode("F3"), 0);
  const hv = new DataView(head.buffer);
  hv.setUint32(
    2,
    options.blocks.reduce((n, b) => n + b.records.length, 0),
    true,
  );
  hv.setUint16(6, 1000, true);
  head.set(encoder.encode(options.table.slice(0, 20)), 44);

  const descriptors: Uint8Array[] = [];
  descriptors.push(new Uint8Array([options.primaryKey.length]));
  for (const f of options.primaryKey) descriptors.push(field(f));
  descriptors.push(new Uint8Array([0])); // no secondary indexes
  descriptors.push(new Uint8Array([options.columns.length]));
  for (const f of options.columns) descriptors.push(field(f));

  // Blocks first, so their offsets are known when the index is written.
  const blockBodies: Uint8Array[] = [];
  for (const block of options.blocks) {
    const parts: Uint8Array[] = [];
    for (const record of block.records) {
      const total = record.length + options.prefixSize;
      const prefix = new Uint8Array(options.prefixSize);
      prefix[0] = total & 0xff;
      if (options.prefixSize === 2) prefix[1] = (total >> 8) & 0xff;
      parts.push(prefix, record);
    }
    blockBodies.push(concat(parts));
  }

  const keyLength = options.primaryKey.reduce((n, f) => n + f.length, 0);
  const descriptorBytes = concat(descriptors);
  let at = head.length + descriptorBytes.length;

  const referenceAt = at;
  let referenceBytes = new Uint8Array(0);
  if (options.referenceTable) {
    const { width, entries } = options.referenceTable;
    const body = new Uint8Array(8 + entries.length * width);
    new DataView(body.buffer).setUint32(0, entries.length, true);
    new DataView(body.buffer).setUint32(4, width, true);
    for (const [i, entry] of entries.entries()) {
      body.set(encoder.encode(entry.padEnd(width, " ").slice(0, width)), 8 + i * width);
    }
    referenceBytes = body;
    at += body.length;
    hv.setUint32(8, referenceAt, true);
  }

  const blockOffsets: number[] = [];
  for (const body of blockBodies) {
    blockOffsets.push(at);
    at += body.length;
  }

  hv.setUint32(28, at, true); // primary index position
  const index = new Uint8Array(4 + options.blocks.length * (keyLength + 8));
  const iv = new DataView(index.buffer);
  iv.setUint32(0, options.blocks.length, true);
  for (const [i, block] of options.blocks.entries()) {
    const last = block.records[block.records.length - 1]!;
    // The index records the *highest* key in the block.
    const key = keyFromPacked(last, options);
    const entryAt = 4 + i * (keyLength + 8);
    index.set(encoder.encode(key.padEnd(keyLength, " ")), entryAt);
    iv.setUint32(entryAt + keyLength, blockOffsets[i]!, true);
    iv.setUint32(entryAt + keyLength + 4, blockOffsets[i]! + blockBodies[i]!.length, true);
  }

  return concat([head, descriptorBytes, referenceBytes, ...blockBodies, index]);
}

/** Mirror of the reader's key extraction, for building the index. */
function keyFromPacked(
  record: Uint8Array,
  options: { primaryKey: Column[]; columns: Column[]; referenceTable?: { entries: string[] } },
): string {
  const decoder = new TextDecoder("ascii");
  const expansion = options.columns
    .filter((c) => c.type === 0)
    .reduce((n, c) => n + c.length - 2, 0);
  const out = new Uint8Array(record.length + expansion);
  let packed = 0;
  for (const column of options.columns) {
    if (column.type === 0) {
      const index = record[packed]! | (record[packed + 1]! << 8);
      const value = options.referenceTable?.entries[index] ?? "";
      out.set(new TextEncoder().encode(value.padEnd(column.length, " ")), column.start);
      packed += 2;
    } else {
      const width = column.length || out.length - column.start;
      out.set(record.subarray(packed, packed + width), column.start);
      packed += width;
    }
  }
  return options.primaryKey
    .map((f) => decoder.decode(out.subarray(f.start, f.start + f.length)))
    .join("");
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * A {@link CsFile} over bytes in memory that counts reads through it.
 *
 * `RangeFile` because slicing it is arithmetic and nothing reaches the reader
 * until bytes are asked for — which is what makes "the index was
 * binary-searched, not scanned" assertable. The counter hangs off the file so
 * call sites can keep passing it straight in, and lives in a closure so a
 * slice counts against the same total.
 */
function memorySource(bytes: Uint8Array): CsFile & { reads: number } {
  let reads = 0;
  const file = new RangeFile("/table.FCTLR", bytes.length, async (start, end) => {
    reads++;
    return bytes.subarray(start, end);
  }) as unknown as CsFile & { reads: number };
  Object.defineProperty(file, "reads", { get: () => reads });
  return file;
}

const identity = (input: Uint8Array): Uint8Array => input;
const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A simple table: MODEL(3) + CHASSIS(7) key, one extra column. */
function simpleTable(prefixSize: 1 | 2) {
  const columns: Column[] = [
    { name: "MODEL", type: 1, start: 0, length: 3 },
    { name: "CHASSIS", type: 1, start: 3, length: 7 },
    { name: "NOTE", type: 1, start: 10, length: 4 },
  ];
  const record = (model: string, chassis: string, note: string) =>
    ascii(model + chassis + note.padEnd(4, " "));
  return buildF3({
    table: "SIMPLE",
    primaryKey: [columns[0]!, columns[1]!],
    columns,
    prefixSize,
    blocks: [
      {
        records: [
          record("101", "0000100", "aaaa"),
          record("101", "0000200", "bbbb"),
          record("101", "0000300", "cccc"),
        ],
      },
      {
        records: [record("101", "0000400", "dddd"), record("150", "0000100", "eeee")],
      },
    ],
  });
}

describe("readHeader", () => {
  it("reads the table, key and columns", async () => {
    const header = await readHeader(memorySource(simpleTable(1)));
    expect(header.table).toBe("SIMPLE");
    expect(header.keyLength).toBe(10);
    expect(header.columns.map((c) => c.name)).toEqual(["MODEL", "CHASSIS", "NOTE"]);
    expect(header.variableLength).toBe(false);
  });

  it("refuses a file that is not F3", async () => {
    await expect(readHeader(memorySource(new Uint8Array(8192)))).rejects.toThrow(/not an F3 file/);
  });

  it("computes packed offsets around a reference column", async () => {
    // A reference occupies 2 bytes packed but expands to its full width.
    const columns: Column[] = [
      { name: "MVS", type: 0, start: 0, length: 7 },
      { name: "CHASSIS", type: 1, start: 7, length: 8 },
    ];
    const file = buildF3({
      table: "REF",
      primaryKey: [{ name: "MODEL", type: 1, start: 0, length: 3 }],
      columns,
      prefixSize: 1,
      referenceTable: { width: 7, entries: ["1011131"] },
      blocks: [{ records: [concat([new Uint8Array([0, 0]), ascii("00216020")])] }],
    });
    const header = await readHeader(memorySource(file));
    expect(header.packedOffsets).toEqual([0, 2]);
    expect(header.referenceExpansion).toBe(5);
  });
});

describe("F3Table", () => {
  it("finds rows by key prefix", async () => {
    const table = await F3Table.open(memorySource(simpleTable(1)), { decompress: identity });
    const rows = await table.lookup("1010000200");
    expect(rows).toHaveLength(1);
    expect(rows[0]!["NOTE"]).toBe("bbbb");
  });

  it("binary-searches the index rather than reading it whole", async () => {
    const source = memorySource(simpleTable(1));
    const table = await F3Table.open(source, { decompress: identity });
    const before = source.reads;
    await table.lookup("1500000100");
    // A handful of small index reads plus one block — not a scan of the file.
    expect(source.reads - before).toBeLessThan
      ? expect(source.reads - before).toBeLessThan(10)
      : undefined;
  });

  it("reads a value out of a reference table", async () => {
    const columns: Column[] = [
      { name: "MVS", type: 0, start: 0, length: 7 },
      { name: "CHASSIS", type: 1, start: 7, length: 8 },
    ];
    const file = buildF3({
      table: "REF",
      primaryKey: [{ name: "MODEL", type: 1, start: 0, length: 3 }],
      columns,
      prefixSize: 1,
      referenceTable: { width: 7, entries: ["9999999", "1011131"] },
      blocks: [{ records: [concat([new Uint8Array([1, 0]), ascii("00216020")])] }],
    });
    const table = await F3Table.open(memorySource(file), { decompress: identity });
    const rows = await table.lookup("101");
    expect(rows[0]).toEqual({ MVS: "1011131", CHASSIS: "00216020" });
  });

  it("detects a one-byte length prefix", async () => {
    const table = await F3Table.open(memorySource(simpleTable(1)), { decompress: identity });
    expect((await table.lookup("1010000100"))[0]!["NOTE"]).toBe("aaaa");
  });

  it("detects a two-byte length prefix", async () => {
    // The case a tiling check cannot see: a two-byte length below 256 has a
    // zero high byte, which a one-byte reader eats as the first content byte.
    // Records then tile just as neatly, one byte out of step — SP.TR read that
    // way and produced a MODEL of "\0" + "10".
    const table = await F3Table.open(memorySource(simpleTable(2)), { decompress: identity });
    const rows = await table.lookup("1010000100");
    expect(rows).toHaveLength(1);
    expect(rows[0]!["MODEL"]).toBe("101");
    expect(rows[0]!["NOTE"]).toBe("aaaa");
  });

  it("reports the highest key under a prefix", async () => {
    const table = await F3Table.open(memorySource(simpleTable(1)), { decompress: identity });
    // Lets "newer than this release" be told apart from "absent".
    expect(await table.highestKeyUnder("101")).toBe("1010000400");
    expect(await table.highestKeyUnder("999")).toBeUndefined();
  });

  it("returns nothing for a key that is not there", async () => {
    const table = await F3Table.open(memorySource(simpleTable(1)), { decompress: identity });
    expect(await table.lookup("1010000999")).toEqual([]);
  });
});

describe("typeCodeFromVin", () => {
  it("splits a Fiat-group VIN into type code and chassis", () => {
    // Type code at 4–6, chassis right-aligned in the remainder.
    expect(typeCodeFromVin("ZFA31200000315929")).toEqual({
      wmi: "ZFA",
      typeCode: "312",
      chassis: "315929",
    });
  });

  it("keeps a letter in the chassis", () => {
    // Chassis numbers roll into letters; 884 of SP.RT's index keys have one.
    expect(typeCodeFromVin("ZFA3120000J315929")?.chassis).toBe("J315929");
  });

  it("refuses anything that is not 17 alphanumeric characters", () => {
    for (const bad of ["", "ZFA312", "ZFA31200000315929X", "ZFA3120000031592-"]) {
      expect(typeCodeFromVin(bad)).toBeUndefined();
    }
  });

  it("upper-cases and trims", () => {
    expect(typeCodeFromVin(" zfa31200000315929 ")?.typeCode).toBe("312");
  });
});

describe("chassisFromVin", () => {
  it("pads to the width the file keys on", () => {
    // SP.CH keys on 8 digits, SP.RT on 7.
    expect(chassisFromVin("315929", 8)).toBe("00315929");
    expect(chassisFromVin("315929", 7)).toBe("0315929");
  });

  it("truncates from the left when the chassis is wider", () => {
    // How an 8-digit chassis still finds its 7-digit build record.
    expect(chassisFromVin("03084515", 7)).toBe("3084515");
  });
});
