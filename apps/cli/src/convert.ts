import { existsSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "./sqlite.js";
import MDBReader, { type Column, type ColumnType } from "mdb-reader";

/**
 * Convert one of ePER's Jet 4 databases into SQLite.
 *
 * Why convert at all, when the drawings are served straight out of the
 * vendor's own ZIPs: Jet addresses rows through its own B-tree index pages,
 * and reimplementing those to run over HTTP `Range` would be a second storage
 * engine to get wrong for no gain. SQLite is the same shape — a paged file
 * with sorted indexes — and a browser can already read it a page at a time.
 *
 * Table and column names are kept exactly as the disc spells them, Italian
 * abbreviations and all (`TBD_RIF`, `VMK_COD`, `SGRP_COD`). The data uses
 * them as keys; translating would add a layer to get wrong.
 */

/** SQLite page size. Fixed at 4 KB because every read over HTTP is one page. */
const PAGE_SIZE = 4096;

/** Rows per `getData` call. Bounded so a 1.6M-row table is not materialised. */
const CHUNK = 50_000;

/** Rows per transaction commit. */
const BATCH = 200_000;

export interface ConvertOptions {
  /** Path to the `.FCTLR` Jet database. */
  source: string;
  /** Path of the SQLite file to create. */
  target: string;
  /** Index definitions, keyed by table name. */
  indexes: Record<string, string[][]>;
  /**
   * Language codes to keep, as `LNG_COD` / `LangCode` spells them. Tables
   * without a language column are always imported whole. `undefined` keeps
   * every language.
   */
  languages?: string[];
  /** Replace an existing target instead of refusing to run. */
  force?: boolean;
  onProgress?: (event: ConvertProgress) => void;
}

export interface ConvertProgress {
  table: string;
  rows: number;
  totalRows: number;
  tableIndex: number;
  tableCount: number;
}

export interface ConvertResult {
  tables: { name: string; rows: number; skipped: number }[];
  indexes: number;
}

/** The two spellings of a language key across the two databases. */
const LANGUAGE_COLUMNS = ["LNG_COD", "LangCode"];

export function convertDatabase(options: ConvertOptions): ConvertResult {
  // Writing into an existing database fails on the first CREATE TABLE, which
  // reads as a mysterious mid-import crash rather than "you already have one".
  if (existsSync(options.target)) {
    if (!options.force) {
      throw new Error(`${options.target} already exists; pass --force to replace it`);
    }
    rmSync(options.target);
  }

  const reader = new MDBReader(readFileSync(options.source));
  const db = new DatabaseSync(options.target);

  // `page_size` must be set before anything is written. The rest are build-time
  // only: the file is read-only afterwards, so durability during the build
  // buys nothing and costs a great deal of time.
  db.exec(`PRAGMA page_size = ${PAGE_SIZE}`);
  db.exec("PRAGMA journal_mode = OFF");
  db.exec("PRAGMA synchronous = OFF");

  const names = reader.getTableNames().sort();
  const result: ConvertResult = { tables: [], indexes: 0 };

  names.forEach((name, tableIndex) => {
    const table = reader.getTable(name);
    const columns = table.getColumns();
    db.exec(createTableSql(name, columns));

    const languageColumn = columns.find((c) => LANGUAGE_COLUMNS.includes(c.name))?.name;
    const wanted = options.languages && languageColumn ? new Set(options.languages) : undefined;

    const insert = db.prepare(
      `INSERT INTO "${name}" (${columns.map((c) => `"${c.name}"`).join(", ")}) ` +
        `VALUES (${columns.map(() => "?").join(", ")})`,
    );

    let written = 0;
    let skipped = 0;
    let open = false;
    for (let offset = 0; offset < table.rowCount; offset += CHUNK) {
      const rows = table.getData({ rowOffset: offset, rowLimit: CHUNK });
      for (const row of rows) {
        if (wanted && !wanted.has(String(row[languageColumn!] ?? ""))) {
          skipped++;
          continue;
        }
        if (!open) {
          db.exec("BEGIN");
          open = true;
        }
        insert.run(...columns.map((c) => toSqlite(row[c.name])));
        written++;
        if (written % BATCH === 0) {
          db.exec("COMMIT");
          open = false;
        }
      }
      options.onProgress?.({
        table: name,
        rows: written,
        totalRows: table.rowCount,
        tableIndex,
        tableCount: names.length,
      });
    }
    if (open) db.exec("COMMIT");

    for (const cols of options.indexes[name] ?? []) {
      // A renamed column would otherwise produce a syntactically valid
      // `CREATE INDEX` against nothing useful, so it is checked.
      for (const col of cols) {
        if (!columns.some((c) => c.name === col)) {
          throw new Error(
            `index on ${name}(${cols.join(", ")}) names column ${col}, ` +
              `which this release does not have — update apps/cli/src/indexes.ts`,
          );
        }
      }
      const indexName = `ix_${name}_${cols.join("_")}`;
      db.exec(`CREATE INDEX "${indexName}" ON "${name}" (${cols.map((c) => `"${c}"`).join(", ")})`);
      result.indexes++;
    }

    result.tables.push({ name, rows: written, skipped });
  });

  db.exec("PRAGMA optimize");
  // Reclaims the space freed by a language filter and leaves the pages in
  // index order, which is what makes range reads sequential for a client.
  db.exec("VACUUM");
  db.close();
  return result;
}

function createTableSql(name: string, columns: Column[]): string {
  const defs = columns.map((c) => `  "${c.name}" ${sqliteType(c.type)}`).join(",\n");
  return `CREATE TABLE "${name}" (\n${defs}\n)`;
}

/**
 * Jet types collapse into SQLite's four storage classes.
 *
 * `numeric` and `currency` arrive from the reader as strings, so they map to
 * NUMERIC affinity rather than REAL: the one column that uses NUMERIC
 * (`MM_Products.IntFiatCode`) holds an integer code, and REAL would round it.
 */
function sqliteType(type: ColumnType): string {
  switch (type) {
    case "boolean":
    case "byte":
    case "integer":
    case "long":
    case "bigint":
      return "INTEGER";
    case "float":
    case "double":
    case "currency":
      return "REAL";
    case "numeric":
      return "NUMERIC";
    case "binary":
    case "ole":
    case "complex":
    case "repid":
      return "BLOB";
    default:
      // text, memo, datetime, datetimeextended — dates are stored as ISO 8601
      // strings, which sort correctly and survive a round trip through JSON.
      return "TEXT";
  }
}

function toSqlite(value: unknown): string | number | bigint | null | Uint8Array {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "string") {
    return value;
  }
  return String(value);
}
