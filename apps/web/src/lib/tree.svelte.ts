import type { Catalogue, Rows, SqlValue } from "@eperx/catalogue";
import { languages, type Language } from "@eperx/catalogue";
import { createSQLiteHTTPPool, type SQLiteHTTPPool } from "sqlite-wasm-http";
import type { CsFileSystem } from "@emdzej/csfs-core";
import { dataFileSystem } from "./filesystem";
import { verifyTree, type MountKind } from "./mount";

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
  /**
   * Base URL the tree is read through.
   *
   * `/data` for a remote host, or `/__eperx/directory` / `/__eperx/opfs` for a
   * local one — the service worker makes those answer `Range` requests too,
   * so nothing downstream knows the difference. See `lib/mount.ts`.
   */
  base: string;
  /** Where the bytes are coming from, for the UI to say. */
  kind: MountKind;
  /**
   * The tree's files — drawings and chassis records.
   *
   * Separate from `base` because they answer different needs: `base` is a URL
   * for SQLite's sake, this is a filesystem for everything else. In a picked
   * folder they are genuinely different paths to the same bytes, and only SQL
   * has to go the long way round.
   */
  fs?: CsFileSystem;
  pool?: SQLiteHTTPPool;
  catalogue?: Catalogue;
  languages: Language[];
  /** Which backend the pool chose, so the page can say. */
  backend?: "shared" | "sync";
  error?: string;
  /**
   * The tree connected, but part of it is unreadable — a linked tree opened
   * from a folder, typically. Separate from `error` because the catalogue
   * still works and browsing it is still worth doing.
   */
  warning?: string;
  connecting: boolean;
}

export const tree = $state<TreeState>({
  base: "/data",
  kind: "remote",
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

/**
 * Open a tree at an already-mounted base URL.
 *
 * Mounting is separate (`lib/mount.ts`) because it is what differs between a
 * remote host, a picked folder and OPFS; everything from here on is identical
 * for all three.
 */
export async function connect(
  base: string,
  options: {
    kind?: MountKind;
    language?: string;
    /** Needed for a picked folder, which csfs reads directly. */
    handle?: FileSystemDirectoryHandle;
  } = {},
): Promise<void> {
  tree.connecting = true;
  tree.error = undefined;
  tree.warning = undefined;
  try {
    await disconnect();
    tree.base = base.replace(/\/$/, "");
    tree.kind = options.kind ?? "remote";
    tree.fs = await dataFileSystem(tree.kind, { base: tree.base, handle: options.handle });
    const language = options.language;

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

    // After the catalogue opens, not before: this checks the parts of the tree
    // the catalogue does not cover, and a failure here is a warning rather
    // than a reason to abandon a connection that otherwise works.
    tree.warning = await verifyTree(tree.base, tree.kind);
  } catch (error) {
    tree.error = error instanceof Error ? error.message : String(error);
    tree.pool = undefined;
    tree.catalogue = undefined;
    tree.fs = undefined;
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
  tree.fs = undefined;
  if (pool) await pool.close();
}
