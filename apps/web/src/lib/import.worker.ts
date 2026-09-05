/// <reference lib="webworker" />
/**
 * A Worker, for two reasons that both matter.
 *
 * The SAH-pool VFS that SQLite writes through needs `createSyncAccessHandle`,
 * which exists only in workers. And an import reads a 1.27 GB database, writes
 * five million rows and copies 5 GB of shards — on the main thread the tab
 * would be frozen from start to finish.
 *
 * The picker stays on the main thread, because `showDirectoryPicker` needs a
 * user gesture. The handle it returns is posted here, which works because
 * `FileSystemDirectoryHandle` is structured-cloneable.
 *
 * One message per phase rather than one long call, so the wizard can show what
 * it found and ask before writing 6 GB.
 */
// First, so `Buffer` and `process` exist before mdb-reader's module graph is
// evaluated — not merely before it is called.
import "./node-shim";
import {
  buildManifest,
  CATALOGUE_DB,
  ACCESSORIES_DB,
  ACCESSORIES_INDEXES,
  CATALOGUE_INDEXES,
  convertDatabase,
  finaliseDatabase,
  importImages,
  MANIFEST,
  openDisc,
  type Disc,
  type JetBuffer,
} from "@eperx/importer";
import MDBReader from "mdb-reader";
import { Buffer } from "buffer";
import type { CsFile, CsFileSystem, WritableFileSystem } from "@emdzej/csfs-core";
import { fsaFileSystem } from "@emdzej/csfs-fsa";
import { opfsFileSystem } from "@emdzej/csfs-opfs";
import { clearImportPool, openWasmSqlWriter } from "./sql-writer";

/** Look at a disc and report what it holds, without writing anything. */
export interface ScanRequest {
  kind: "scan";
  source: FileSystemDirectoryHandle;
}

/** Carry out an import the user has seen a plan for. */
export interface RunRequest {
  kind: "run";
  source: FileSystemDirectoryHandle;
  /** `LNG_COD` values to keep, or `undefined` for all twenty. */
  languages?: string[];
  /** Include the drawing shards — 4.7 GB of them. */
  images: boolean;
  /** Include the F3 chassis and build files — 706 MB. */
  chassis: boolean;
  /** Include the accessories (Mopar) catalogue. */
  accessories: boolean;
  /** Stamped by the caller, so the worker does not invent a clock. */
  importedAt: string;
}

export type ImportRequest = ScanRequest | RunRequest;

/** What the wizard learns about a disc before committing to it. */
export interface DiscReport {
  version: string;
  release: string;
  /** Languages the catalogue carries, from its own `LANG` table. */
  languages: { code: string; name: string }[];
  has: { catalogue: boolean; accessories: boolean; images: boolean; chassis: boolean };
  /** Bytes each component would add to the tree. */
  sizes: { catalogue: number; accessories: number; images: number; chassis: number };
}

export type ImportResponse =
  | { kind: "scanned"; report: DiscReport }
  | { kind: "phase"; phase: string; detail?: string }
  | { kind: "progress"; done: number; total: number; label: string }
  | { kind: "finished"; tables: number; rows: number; indexes: number; entries: number }
  | { kind: "failed"; message: string };

const say = (message: ImportResponse) => self.postMessage(message);

self.onmessage = async (event: MessageEvent<ImportRequest>) => {
  try {
    if (event.data.kind === "scan") await scan(event.data);
    else await run(event.data);
  } catch (error) {
    say({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
  }
};

/**
 * A whole Jet database, as mdb-reader needs it.
 *
 * `Buffer.from(ArrayBuffer)` is a view, so this costs no second copy of the
 * 1.27 GB. The wrapper is not optional: mdb-reader reads Jet's pages with
 * `readUInt32LE` and friends, which a plain `Uint8Array` does not have — which
 * is what `JetBuffer` exists to catch at compile time.
 */
async function jetBytes(file: CsFile): Promise<JetBuffer> {
  return Buffer.from(await file.arrayBuffer()) as unknown as JetBuffer;
}

/** A file the disc promised, or an error naming it. */
async function must(fs: CsFileSystem, path: string): Promise<CsFile> {
  const file = await fs.file(path);
  if (!file) throw new Error(`${path} is missing from this disc`);
  return file;
}

/**
 * Size the components without reading them.
 *
 * Every figure comes from a listing, so this costs a directory walk rather
 * than a byte of I/O — which is what makes it reasonable to do before asking
 * the user whether to proceed.
 */
async function scan(request: ScanRequest): Promise<void> {
  const fs = fsaFileSystem(request.source);
  const disc = await openDisc(fs);

  const sizeOf = async (path?: string) => (path ? ((await fs.file(path))?.size ?? 0) : 0);
  const imagesBytes = disc.files.imagesDir ? await dirBytes(fs, disc.files.imagesDir) : 0;

  say({
    kind: "scanned",
    report: {
      version: disc.version,
      release: disc.release,
      // Read from the disc rather than hardcoded: which languages a release
      // ships is a property of the release.
      languages: await discLanguages(fs, disc),
      has: {
        catalogue: Boolean(disc.files.spareParts),
        accessories: Boolean(disc.files.accessories),
        images: Boolean(disc.files.imagesDir),
        chassis: Boolean(disc.files.chassis || disc.files.build),
      },
      sizes: {
        catalogue: await sizeOf(disc.files.spareParts),
        accessories: await sizeOf(disc.files.accessories),
        images: imagesBytes,
        chassis: (await sizeOf(disc.files.chassis)) + (await sizeOf(disc.files.build)),
      },
    },
  });
}

async function dirBytes(fs: CsFileSystem, dir: string): Promise<number> {
  const handle = await fs.directory(dir);
  if (!handle) return 0;
  // `entries()` carries sizes, so this is one listing rather than a stat per
  // shard — and there are 261 of them.
  return (await handle.entries()).reduce((n, e) => n + (e.kind === "file" ? e.size : 0), 0);
}

/**
 * The languages a disc offers, read from the disc.
 *
 * `LANG` lives inside a Jet database, and the accessories database is the one
 * to take it from: `AM.DB` is 279 MB against `SP.DB`'s 1.27 GB, and both carry
 * the same table. Which languages a release ships is a property of the
 * release, so guessing the list would be wrong the first time Fiat changed it
 * — and a hand-written guess was in fact wrong about six of the twenty on
 * edition 83.
 *
 * A disc with no accessories database gets an empty list, and the wizard then
 * offers "every language" without a breakdown rather than inventing one.
 */
async function discLanguages(
  fs: CsFileSystem,
  disc: Disc,
): Promise<{ code: string; name: string }[]> {
  if (!disc.files.accessories) return [];
  const file = await fs.file(disc.files.accessories);
  if (!file) return [];
  try {
    const reader = new MDBReader(
      (await jetBytes(file)) as ConstructorParameters<typeof MDBReader>[0],
    );
    const rows = reader.getTable("LANG").getData() as Record<string, unknown>[];
    return rows
      .map((row) => ({ code: String(row["LNG_COD"] ?? ""), name: String(row["LNG_DSC"] ?? "") }))
      .filter((row) => row.code)
      .sort((a, b) => a.code.localeCompare(b.code));
  } catch {
    // Unreadable, or a release that spells the table differently. The wizard
    // copes with an empty list; refusing the whole scan over it would not be
    // proportionate.
    return [];
  }
}

async function run(request: RunRequest): Promise<void> {
  const fs = fsaFileSystem(request.source);
  const target = await opfsFileSystem();
  const disc = await openDisc(fs);

  if (!disc.files.spareParts) throw new Error("this disc has no spare-parts database");

  // A previous run that was closed half way leaves databases in the pool, and
  // opening one again would append to it.
  await clearImportPool();

  say({ kind: "phase", phase: "catalogue", detail: CATALOGUE_DB });
  const catalogueWriter = await openWasmSqlWriter(CATALOGUE_DB);
  const spareFile = await must(fs, disc.files.spareParts);
  const spare = convertDatabase({
    bytes: await jetBytes(spareFile),
    writer: catalogueWriter,
    indexes: CATALOGUE_INDEXES,
    languages: request.languages,
    onProgress: ({ table, rows, totalRows, tableIndex, tableCount }) =>
      say({
        kind: "progress",
        done: tableIndex,
        total: tableCount,
        label: `${table} ${rows.toLocaleString()}/${totalRows.toLocaleString()}`,
      }),
  });

  let accessories;
  if (request.accessories && disc.files.accessories) {
    say({ kind: "phase", phase: "accessories", detail: ACCESSORIES_DB });
    const writer = await openWasmSqlWriter(ACCESSORIES_DB);
    {
      accessories = convertDatabase({
        bytes: await jetBytes(await must(fs, disc.files.accessories)),
        writer,
        indexes: ACCESSORIES_INDEXES,
        languages: request.languages,
        onProgress: ({ table, rows, tableIndex, tableCount }) =>
          say({
            kind: "progress",
            done: tableIndex,
            total: tableCount,
            label: `${table} ${rows.toLocaleString()}`,
          }),
      });
    }
    finaliseDatabase(writer);
    await place(target, ACCESSORIES_DB, writer);
  }

  let images;
  if (request.images && disc.files.imagesDir) {
    say({ kind: "phase", phase: "drawings", detail: "images/" });
    images = await importImages({
      sourceFs: fs,
      imagesDir: disc.files.imagesDir,
      // Copied, never linked: a browser has no symlinks, and OPFS is the only
      // place these bytes can live once the disc is unmounted.
      target: { fs: target, dir: "images" },
      writer: catalogueWriter,
      onProgress: ({ shard, index, count }) =>
        say({ kind: "progress", done: index + 1, total: count, label: `${shard}.res` }),
    });
  }

  if (request.chassis && (disc.files.chassis || disc.files.build)) {
    say({ kind: "phase", phase: "chassis", detail: "chassis/" });
    await target.makeDirectory("chassis");
  }
  const chassis: Record<string, string> = {};
  if (request.chassis) {
    const wanted = [
      ["chassis", disc.files.chassis],
      ["build", disc.files.build],
    ] as const;
    for (const [key, path] of wanted) {
      if (!path) continue;
      const file = await must(fs, path);
      say({ kind: "progress", done: 0, total: 1, label: file.name });
      // Streamed, so 420 MB never lands in memory.
      await target.write(`chassis/${file.name}`, file.stream());
      chassis[key] = file.name;
    }
  }

  // Last, because the drawing index went into the same database and both
  // ANALYZE and VACUUM have to see everything.
  say({ kind: "phase", phase: "settling", detail: "ANALYZE, VACUUM" });
  finaliseDatabase(catalogueWriter);
  await place(target, CATALOGUE_DB, catalogueWriter);

  await writeJson(
    target,
    MANIFEST,
    buildManifest({
      version: disc.version,
      release: disc.release,
      importedAt: request.importedAt,
      languages: request.languages,
      catalogue: { tables: spare.tables.length, indexes: spare.indexes },
      accessories: accessories && { tables: accessories.tables.length },
      images: images && { dir: "images", shards: images.shards, entries: images.entries },
      chassis: Object.keys(chassis).length ? chassis : undefined,
    }),
  );

  say({
    kind: "finished",
    tables: spare.tables.length,
    rows: spare.tables.reduce((sum, t) => sum + t.rows, 0),
    indexes: spare.indexes,
    entries: images?.entries ?? 0,
  });
}

/**
 * Move a finished database out of the pool and into the tree.
 *
 * The SAH pool stores its files under opaque names of its own, so a database
 * built there is not a file the service worker could serve. `finish` hands
 * back the bytes and they get written where a client will look for them.
 */
async function place(
  target: WritableFileSystem,
  name: string,
  writer: { finish(): Promise<Uint8Array | undefined> },
): Promise<void> {
  const bytes = await writer.finish();
  if (!bytes) throw new Error(`${name} produced no bytes to place`);
  await target.write(name, bytes);
}

/** Write JSON, since csfs writes bytes rather than text. */
async function writeJson(target: WritableFileSystem, path: string, value: unknown): Promise<void> {
  await target.write(path, new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`));
}
