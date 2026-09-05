import { describe, expect, it } from "vitest";
import { RangeFile, type CsFile } from "@emdzej/csfs-core";
import { DEFLATED, readCentralDirectory, resolvePayload, STORED } from "./zip.js";

/**
 * Synthetic archives, built byte by byte.
 *
 * No fixture in this repository is derived from a disc. These are hand-built
 * so the awkward cases can be forced — in particular a local extra field of a
 * different length from the central one, which is the only thing that proves
 * the payload offset is read rather than computed.
 */
interface Entry {
  name: string;
  data: Uint8Array;
  method?: number;
  /** Extra field written into the *local* header. */
  localExtra?: number;
  /** Extra field written into the *central directory* header. */
  centralExtra?: number;
  /** Declared uncompressed size; defaults to `data.length`. */
  size?: number;
}

function buildZip(entries: Entry[], comment = ""): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const localExtra = entry.localExtra ?? 0;
    const method = entry.method ?? STORED;
    const size = entry.size ?? entry.data.length;

    const local = new Uint8Array(30 + name.length + localExtra);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, entry.data.length, true); // compressed size
    lv.setUint32(22, size, true); // uncompressed size
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, localExtra, true);
    local.set(name, 30);
    parts.push(local, entry.data);

    const centralExtra = entry.centralExtra ?? 0;
    const cd = new Uint8Array(46 + name.length + centralExtra);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, entry.data.length, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, centralExtra, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    central.push(cd);

    offset += local.length + entry.data.length;
  }

  const cdBytes = concat(central);
  const commentBytes = encoder.encode(comment);
  const eocd = new Uint8Array(22 + commentBytes.length);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdBytes.length, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, commentBytes.length, true);
  eocd.set(commentBytes, 22);

  return concat([...parts, cdBytes, eocd]);
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
 * A {@link CsFile} over bytes in memory that counts what is read through it.
 *
 * `RangeFile` is csfs's helper for a store that can answer "bytes m to n" and
 * has no `Blob` — which is exactly what a counting fake wants, because slicing
 * it is pure arithmetic and nothing reaches the reader until bytes are
 * actually asked for. That is what makes "it did not download the archive"
 * assertable.
 *
 * The counters hang off the returned file rather than being returned beside
 * it, so every call site can keep passing it straight in. They live in a
 * closure, so a slice of this file counts against the same totals.
 */
function memorySource(bytes: Uint8Array): CsFile & { bytesRead: number } {
  let bytesRead = 0;
  const file = new RangeFile("/archive.res", bytes.length, async (start, end) => {
    const slice = bytes.subarray(start, end);
    bytesRead += slice.length;
    return slice;
  }) as unknown as CsFile & { bytesRead: number };
  Object.defineProperty(file, "bytesRead", { get: () => bytesRead });
  return file;
}

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);

describe("readCentralDirectory", () => {
  it("reads names, methods and sizes", async () => {
    const zip = buildZip([
      { name: "AA/AA01.png", data: png },
      { name: "AA/AA01.th.png", data: png.subarray(0, 5) },
    ]);
    const entries = await readCentralDirectory(memorySource(zip));

    expect(entries.map((e) => e.name)).toEqual(["AA/AA01.png", "AA/AA01.th.png"]);
    expect(entries[0]!.method).toBe(STORED);
    expect(entries[0]!.size).toBe(png.length);
    expect(entries[1]!.size).toBe(5);
  });

  it("finds the record behind a trailing comment", async () => {
    const zip = buildZip([{ name: "a.png", data: png }], "packed by something");
    const entries = await readCentralDirectory(memorySource(zip));
    expect(entries).toHaveLength(1);
  });

  it("rejects a file that is not a ZIP", async () => {
    const notZip = new Uint8Array(200).fill(0x41);
    await expect(readCentralDirectory(memorySource(notZip))).rejects.toThrow(
      /no end-of-central-directory/,
    );
  });
});

describe("resolvePayload", () => {
  it("takes the data offset from the local header, not the central one", async () => {
    // The whole point: 8 bytes of local extra against 2 of central extra. A
    // reader that trusted the central directory's extra length would be off by
    // six bytes and hand back something that is not a PNG.
    const zip = buildZip([{ name: "AA/AA01.png", data: png, localExtra: 8, centralExtra: 2 }]);
    const source = memorySource(zip);
    const [entry] = await readCentralDirectory(source);
    const payload = await resolvePayload(source, entry!);

    expect(payload.offset).toBe(30 + "AA/AA01.png".length + 8);
    const bytes = await source.slice(payload.offset, payload.offset + payload.length).bytes();
    expect([...bytes]).toEqual([...png]);
  });

  it("reads far less than the archive", async () => {
    // A shard is ~19 MB; the padding here stands in for that. Opening it and
    // pulling one entry must not touch the bulk of the file.
    const filler = { name: "big.png", data: new Uint8Array(64 * 1024) };
    const zip = buildZip([filler, { name: "AA/AA01.png", data: png }]);
    const source = memorySource(zip);
    const entries = await readCentralDirectory(source);
    const payload = await resolvePayload(source, entries[1]!);
    await source.slice(payload.offset, payload.offset + payload.length).bytes();

    expect(source.bytesRead).toBeLessThan(zip.length / 4);
  });

  it("carries the compression method and inflated size through", async () => {
    const zip = buildZip([{ name: "L_X/photo.jpg", data: png, method: DEFLATED, size: 4096 }]);
    const source = memorySource(zip);
    const [entry] = await readCentralDirectory(source);
    const payload = await resolvePayload(source, entry!);

    expect(payload.method).toBe(DEFLATED);
    expect(payload.length).toBe(png.length); // on disc
    expect(payload.size).toBe(4096); // after inflating
  });

  it("refuses a compression method it does not know", async () => {
    // Bzip2. Returning bytes here would produce a corrupt image rather than
    // an error, which is the failure mode this repo will not accept.
    const zip = buildZip([{ name: "weird.png", data: png, method: 12 }]);
    const source = memorySource(zip);
    const [entry] = await readCentralDirectory(source);

    await expect(resolvePayload(source, entry!)).rejects.toThrow(/method 12/);
  });

  it("refuses an entry whose local header is missing", async () => {
    const zip = buildZip([{ name: "a.png", data: png }]);
    const source = memorySource(zip);
    const [entry] = await readCentralDirectory(source);

    await expect(resolvePayload(source, { ...entry!, localHeaderOffset: 4 })).rejects.toThrow(
      /no local header/,
    );
  });
});
