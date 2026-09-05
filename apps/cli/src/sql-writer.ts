import type { SqlStatement, SqlWriter } from "@eperx/importer";
import { DatabaseSync } from "./sqlite.js";

/**
 * A {@link SqlWriter} over `node:sqlite`.
 *
 * All that is left of what used to be `node-fs.ts`: reading and writing files
 * is csfs's job now (`@emdzej/csfs-node`), and SQLite is the one thing it has
 * no opinion about.
 *
 * `finish` returns `undefined` because the database was written where it was
 * asked to. The browser writer is the one that has to hand bytes back, since
 * the SAH-pool VFS stores its files under names of its own.
 */
export function openNodeSqlWriter(path: string): SqlWriter {
  const db = new DatabaseSync(path);
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql): SqlStatement => {
      const stmt = db.prepare(sql);
      return {
        run: (values) => void stmt.run(...values),
        // `node:sqlite` finalises with the database; nothing to do per
        // statement, and the interface exists for the WASM writer's sake.
        finalize: () => {},
      };
    },
    finish: async () => {
      db.close();
      return undefined;
    },
  };
}
