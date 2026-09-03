/**
 * The one thing the domain needs from a database: run a statement, get rows.
 *
 * Async, because the browser reads SQLite over HTTP `Range` through a worker
 * and Node reads it synchronously through `node:sqlite`. Nothing in this
 * package knows which it got, so every query here is exercised by the CLI
 * against a local file *and* by the web app over the network.
 */
export type SqlValue = string | number | null;

export interface Rows {
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
}

/**
 * A catalogue, in one language.
 *
 * The language is bound once rather than passed to every call: every
 * user-visible string on the disc lives in a per-language description table,
 * so `LNG_COD` is a parameter of essentially every query and threading it
 * through by hand is how one gets forgotten.
 */
export interface Catalogue {
  rows: Rows;
  /** `LNG_COD` from the `LANG` table — `3` is English, `0` Italian. */
  language: string;
}
