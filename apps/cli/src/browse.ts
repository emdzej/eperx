import { join } from "node:path";
import type { Catalogue, Rows, SqlValue } from "@eperx/catalogue";
import { DatabaseSync } from "./sqlite.js";

/**
 * A {@link Rows} over `node:sqlite`.
 *
 * The point of this adapter is that `@eperx/catalogue` runs unchanged in the
 * CLI and in the browser. Every query the web app makes can therefore be
 * exercised here, against a local file, without a browser — which is the only
 * practical way to check the SQL is right.
 */
export function openCatalogue(dataDir: string, language: string): Catalogue & { close(): void } {
  const db = new DatabaseSync(join(dataDir, "catalogue.sqlite"), { readOnly: true });
  const rows: Rows = {
    async all<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
      return db.prepare(sql).all(...params) as T[];
    },
  };
  return { rows, language, close: () => db.close() };
}
