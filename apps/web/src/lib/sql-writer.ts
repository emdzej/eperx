import sqlite3InitModule, { type SAHPoolUtil } from "@sqlite.org/sqlite-wasm";
import type { SqlInput, SqlStatement, SqlWriter } from "@eperx/importer";

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
