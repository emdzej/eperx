import { Buffer } from "buffer";
import sqlite3InitModule, { type SAHPoolUtil } from "@sqlite.org/sqlite-wasm";
import type { ByteSource } from "@eperx/core";
import type {
  JetBuffer,
  SourceFile,
  SourceFs,
  SqlInput,
  SqlStatement,
  SqlWriter,
  TargetFs,
} from "@eperx/importer";

/**
 * The importer's filesystem, over what a browser tab actually has: a folder
 * the user picked, and the origin private file system.
 *
 * The Node counterpart is `apps/cli/src/node-fs.ts`. Neither knows anything
 * about ePER — the format knowledge is all in `@eperx/importer`, and these
 * two exist so it does not have to care where it is running.
 *
 * **This module must run in a Worker.** `createSyncAccessHandle()` is the only
 * way to write OPFS without buffering a file whole, and it exists only in
 * workers. The import would freeze the tab anyway.
 */

/** Read in 8 MiB slices, so a 420 MB chassis file never lands in memory whole. */
const COPY_CHUNK = 8 * 1024 * 1024;

/**
 * Narrow a chunk for `FileSystemWritableFileStream.write`.
 *
 * It refuses a `Uint8Array` whose backing buffer *might* be a
 * `SharedArrayBuffer`, and an unparameterised `Uint8Array` might be. Ours
 * never is: this origin has no `SharedArrayBuffer` at all, which is the very
 * fact that forces the SAH-pool VFS further down this file.
 */
function chunk(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes as Uint8Array<ArrayBuffer>;
}

class BrowserSourceFile implements SourceFile {
  readonly name: string;
  readonly size: number;

  constructor(private readonly file: File) {
    this.name = file.name;
    this.size = file.size;
  }

  async bytes(): Promise<JetBuffer> {
    // `Buffer.from(ArrayBuffer)` is a *view*, not a copy, which is what makes
    // a 1.27 GB `SP.DB` survivable: measured peak is barely above the file.
    // The wrapper is not optional — mdb-reader reads Jet's pages with
    // `readUInt32LE`, which a plain `Uint8Array` does not have.
    return Buffer.from(await this.file.arrayBuffer()) as unknown as JetBuffer;
  }

  source(): ByteSource {
    const file = this.file;
    return {
      async size() {
        return file.size;
      },
      async read(pos, len) {
        const slice = file.slice(pos, pos + len);
        return new Uint8Array(await slice.arrayBuffer());
      },
    };
  }

  close(): void {
    // A `File` holds no descriptor of ours; the handle it came from is the
    // user's to revoke.
  }
}

/** Split a relative, `/`-separated importer path. */
function segments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

export class BrowserSourceFs implements SourceFs {
  constructor(private readonly root: FileSystemDirectoryHandle) {}

  private async dir(path: string): Promise<FileSystemDirectoryHandle> {
    let handle = this.root;
    for (const name of segments(path)) handle = await handle.getDirectoryHandle(name);
    return handle;
  }

  private async fileHandle(path: string): Promise<FileSystemFileHandle> {
    const parts = segments(path);
    const name = parts.pop();
    if (!name) throw new Error(`${path} names no file`);
    let handle = this.root;
    for (const part of parts) handle = await handle.getDirectoryHandle(part);
    return handle.getFileHandle(name);
  }

  async list(dir: string): Promise<string[]> {
    const handle = await this.dir(dir);
    const names: string[] = [];
    // `keys()` is an async iterator; there is no length to ask for first.
    for await (const name of handle.keys()) names.push(name);
    return names;
  }

  async statFile(path: string): Promise<{ size: number } | undefined> {
    try {
      const file = await (await this.fileHandle(path)).getFile();
      return { size: file.size };
    } catch {
      // Absent, a directory, or — for a `--link` tree — a symlink the browser
      // refuses to follow out of the folder it was granted. All three are
      // "not a file I can read", which is all the caller needs.
      return undefined;
    }
  }

  async open(path: string): Promise<SourceFile> {
    return new BrowserSourceFile(await (await this.fileHandle(path)).getFile());
  }

  async readText(path: string): Promise<string> {
    const file = await (await this.fileHandle(path)).getFile();
    // Latin-1, matching the Node side: `runparam.ini` is a Windows-era INI and
    // a stray high byte must not become U+FFFD.
    return new TextDecoder("latin1").decode(await file.arrayBuffer());
  }
}

export class BrowserTargetFs implements TargetFs {
  constructor(private readonly root: FileSystemDirectoryHandle) {}

  private async dir(path: string, create = false): Promise<FileSystemDirectoryHandle> {
    let handle = this.root;
    for (const name of segments(path)) handle = await handle.getDirectoryHandle(name, { create });
    return handle;
  }

  private async parentOf(
    path: string,
    create = false,
  ): Promise<[FileSystemDirectoryHandle, string]> {
    const parts = segments(path);
    const name = parts.pop();
    if (!name) throw new Error(`${path} names no file`);
    return [await this.dir(parts.join("/"), create), name];
  }

  async mkdir(dir: string): Promise<void> {
    await this.dir(dir, true);
  }

  async exists(path: string): Promise<boolean> {
    try {
      const [parent, name] = await this.parentOf(path);
      await parent.getFileHandle(name);
      return true;
    } catch {
      return false;
    }
  }

  async remove(path: string): Promise<void> {
    try {
      const [parent, name] = await this.parentOf(path);
      await parent.removeEntry(name);
    } catch {
      // Already absent, which is what was wanted.
    }
  }

  /**
   * Copy through ranged reads rather than the source's own stream.
   *
   * `SourceFile.source()` is the one reading primitive both environments
   * share, so writing the copy this way keeps it out of the source
   * implementations — and it means a 420 MB file moves 8 MiB at a time
   * instead of being materialised.
   */
  async copy(from: SourceFile, to: string): Promise<void> {
    const source = from.source();
    const writable = await this.write(to);
    try {
      for (let at = 0; at < from.size; at += COPY_CHUNK) {
        const want = Math.min(COPY_CHUNK, from.size - at);
        const slice = await source.read(at, want);
        if (slice.length !== want) {
          throw new Error(`short read of ${from.name} at ${at}: ${slice.length} of ${want}`);
        }
        await writable.write(chunk(slice));
      }
    } catch (error) {
      // Abort rather than close, so a half-written shard does not survive as
      // a plausible-looking file the client would then fail to parse.
      await writable.abort().catch(() => {});
      throw error;
    }
    await writable.close();
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.writeBytes(path, new TextEncoder().encode(text));
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    const writable = await this.write(path);
    try {
      await writable.write(chunk(bytes));
    } catch (error) {
      await writable.abort().catch(() => {});
      throw error;
    }
    await writable.close();
  }

  /**
   * A truncating writable stream.
   *
   * `createWritable` rather than `createSyncAccessHandle`: it streams, it is
   * typed, and it works on the main thread as well as in a worker — the sync
   * handle buys nothing here, and the SAH pool that does need one keeps that
   * to itself.
   */
  private async write(path: string): Promise<FileSystemWritableFileStream> {
    const [parent, name] = await this.parentOf(path, true);
    const handle = await parent.getFileHandle(name, { create: true });
    return handle.createWritable();
  }
}

/**
 * SQLite, compiled to WASM, writing into the SAH-pool VFS.
 *
 * The pool is not a preference. The ordinary `opfs` VFS needs
 * `SharedArrayBuffer`, which needs `Cross-Origin-Opener-Policy` and
 * `Cross-Origin-Embedder-Policy` on the origin — and requiring those of
 * whoever hosts eperx would undo the point of it being servable from
 * anywhere. Confirmed by asking: with no such headers, `sqlite3_js_vfs_list()`
 * offers `unix-none`, `memdb` and `kvvfs`, and no `opfs`. The SAH pool
 * installs regardless, and measured 141,995 inserts per second.
 *
 * The cost is that the pool stores its files under opaque names of its own, so
 * a finished database has to be lifted out with `exportFile` and written to
 * the tree as a real OPFS file — which is what {@link SqlWriter.finish}
 * returns bytes for. The pool's copy is then unlinked, so the tree is not
 * stored twice.
 */
interface Pool {
  util: SAHPoolUtil;
  /** Whether this build binds `BigInt` rather than throwing on it. */
  bigInt: boolean;
}

let installing: Promise<Pool> | undefined;

function pool(): Promise<Pool> {
  installing ??= (async () => {
    const sqlite3 = await sqlite3InitModule();
    const util = await sqlite3.installOpfsSAHPoolVfs({
      name: "eperx-import",
      // Two databases plus room for whatever VACUUM wants. Measured: VACUUM
      // needed no extra slot, but capacity is cheap and running out mid-import
      // is not.
      initialCapacity: 8,
    });
    return { util, bigInt: Boolean(sqlite3.config.bigIntEnabled) };
  })();
  return installing;
}

/** Bytes the pool is holding, from an import that did not finish. */
export async function clearImportPool(): Promise<void> {
  const { util } = await pool();
  for (const name of util.getFileNames()) util.unlink(name);
}

export async function openWasmSqlWriter(name: string): Promise<SqlWriter> {
  const { util, bigInt } = await pool();
  const path = `/${name}`;
  // An abandoned import leaves its database behind, and opening it again would
  // append to it — every CREATE TABLE failing on the second run.
  try {
    util.unlink(path);
  } catch {
    // Nothing there, which is the normal case.
  }

  const db = new util.OpfsSAHPoolDb(path);

  return {
    exec: (sql) => void db.exec(sql),
    prepare: (sql): SqlStatement => {
      const stmt = db.prepare(sql);
      return {
        run: (values) => {
          stmt.bind(values.map((v) => bind(v, bigInt)));
          stmt.step();
          stmt.reset();
        },
        // Unlike `node:sqlite`, an unfinalised statement here keeps the
        // database busy and VACUUM would fail on it.
        finalize: () => void stmt.finalize(),
      };
    },
    finish: async () => {
      db.close();
      const bytes = await util.exportFile(path);
      // Freed only after the bytes are in hand, so a failure to export leaves
      // the database recoverable rather than gone.
      util.unlink(path);
      return bytes;
    },
  };
}

/**
 * Narrow a value to what sqlite-wasm binds.
 *
 * `bigint` is the awkward one: Jet has bigint columns, and a build without
 * BigInt support throws on them rather than coercing. Values that far out of
 * range do not appear in this data, so falling back to `Number` loses nothing
 * real and cannot fail the import.
 */
function bind(value: SqlInput, bigInt: boolean): SqlInput {
  if (typeof value === "bigint" && !bigInt) return Number(value);
  return value;
}
