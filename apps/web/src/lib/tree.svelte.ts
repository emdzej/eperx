import type { Catalogue, Rows, SqlValue } from "@eperx/catalogue";
import { languages, type Language } from "@eperx/catalogue";
import { createSQLiteHTTPPool, type SQLiteHTTPPool } from "sqlite-wasm-http";

/**
 * The connection to an imported tree.
 *
 * `catalogue.sqlite` is read over HTTP `Range` by SQLite itself, compiled to
 * WASM and running in a worker. Nothing is downloaded up front: a query walks
 * the B-tree by fetching the pages it needs, which for an indexed lookup is a
 * handful of 4 kB reads out of a 568 MB file.
 *
 * The pool picks its own backend — a shared-cache one where
 * `SharedArrayBuffer` is available, a synchronous one otherwise. The
 * synchronous fallback is why this works on a plain static host: the shared
 * variant needs `Cross-Origin-Opener-Policy` and
 * `Cross-Origin-Embedder-Policy` headers, and requiring those would undo the
 * whole point of serving the tree from anywhere.
 */
export interface TreeState {
  /** Base URL of the imported tree, e.g. `/data`. */
  base: string;
  pool?: SQLiteHTTPPool;
  catalogue?: Catalogue;
  languages: Language[];
  /** Which backend the pool chose, so the page can say. */
  backend?: "shared" | "sync";
  error?: string;
  connecting: boolean;
}

export const tree = $state<TreeState>({
  base: "/data",
  languages: [],
  connecting: false,
});

/**
 * Statements run, so the cost of a click is visible.
 *
 * Deliberately not bytes. SQLite fetches its pages from inside a worker, and
 * `performance.getEntriesByType("resource")` on the main thread cannot see
 * them — an earlier version of this counted that way and reported a confident
 * `0 kB` for every query. The page traffic is measured server-side instead;
 * the figures are in `docs/plan.md`.
 */
export const stats = $state({ queries: 0 });

/**
 * One worker-1 result message. Not a row.
 *
 * `pool.exec` is typed as returning `RowObject[]`, but what comes back is the
 * SQLite worker-1 protocol's *messages* — `{ type, columnNames, rowNumber,
 * row }` — with the row nested inside. Treating the envelope as the row gives
 * objects whose every column is `undefined`, which renders as a list of blank
 * entries rather than an error. Found by logging one.
 */
interface RowMessage<T> {
  row?: T;
}

function rowsFrom(pool: SQLiteHTTPPool): Rows {
  return {
    async all<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
      stats.queries++;
      const messages = (await pool.exec(sql, params, {
        rowMode: "object",
      })) as unknown as RowMessage<T>[];
      // The worker signals end-of-results with a message carrying no row.
      return messages.map((message) => message.row).filter((row): row is T => row !== undefined);
    },
  };
}

export async function connect(base: string, language?: string): Promise<void> {
  tree.connecting = true;
  tree.error = undefined;
  try {
    await disconnect();
    tree.base = base.replace(/\/$/, "");

    // `sync` is chosen deliberately, not fallen back into. The shared-cache
    // backend needs `SharedArrayBuffer`, which needs
    // `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers
    // on the origin — and requiring those of whoever hosts the tree would undo
    // the point of it being servable from anywhere. One worker cannot share a
    // cache with itself, so nothing is lost.
    const pool = await createSQLiteHTTPPool({
      workers: 1,
      httpOptions: { backendType: "sync", maxPageSize: 4096, cacheSize: 8192 },
    });
    await pool.open(`${tree.base}/catalogue.sqlite`);
    tree.pool = pool;
    tree.backend = pool.backendType;

    const rows = rowsFrom(pool);
    const available = await languages(rows);
    tree.languages = available;
    // A tree imported with `-l 3` carries one language; offering the other
    // nineteen would mean every label came back null.
    const chosen =
      language && available.some((l) => l.code === language)
        ? language
        : (available[0]?.code ?? "3");
    tree.catalogue = { rows, language: chosen };
  } catch (error) {
    tree.error = error instanceof Error ? error.message : String(error);
    tree.pool = undefined;
    tree.catalogue = undefined;
  } finally {
    tree.connecting = false;
  }
}

export function setLanguage(code: string): void {
  if (tree.catalogue) tree.catalogue = { ...tree.catalogue, language: code };
}

export async function disconnect(): Promise<void> {
  const pool = tree.pool;
  tree.pool = undefined;
  tree.catalogue = undefined;
  if (pool) await pool.close();
}
