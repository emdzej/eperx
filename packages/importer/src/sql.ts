/**
 * The slice of SQLite the importer needs, so it can write through `node:sqlite`
 * or through `sqlite-wasm` without knowing which.
 *
 * Deliberately tiny. The importer only ever creates tables, inserts rows,
 * builds indexes and commits — it never queries — so widening this to
 * something resembling a database driver would be inventing requirements.
 *
 * The two implementations differ in one way worth knowing about. `node:sqlite`
 * writes the file directly. `sqlite-wasm` in a browser has to write through
 * the SAH-pool VFS, which stores files under opaque names, so the browser
 * implementation builds there and then lifts the finished bytes out with
 * `exportFile` — which is why {@link SqlWriter.finish} exists at all.
 */

/** What a prepared statement will accept. */
export type SqlInput = string | number | bigint | null | Uint8Array;

export interface SqlStatement {
  run(values: SqlInput[]): void;
  finalize(): void;
}

export interface SqlWriter {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  /**
   * Close the database and hand back its bytes, if the caller has to place
   * them itself.
   *
   * `undefined` means the writer already wrote where it was asked to, which
   * is the Node case. A `Uint8Array` means the bytes need writing to the
   * target — the browser case, because the SAH-pool VFS owns its own storage.
   */
  finish(): Promise<Uint8Array | undefined>;
}

/** Opens a writer for a database at `path` inside the target tree. */
export type OpenSqlWriter = (path: string) => Promise<SqlWriter>;
