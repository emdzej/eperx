/**
 * The picked folder, in IndexedDB.
 *
 * A `FileSystemDirectoryHandle` is structured-cloneable but not serialisable —
 * `JSON.stringify` turns it into `{}` without throwing — so it cannot live in
 * `localStorage` beside the rest of the settings.
 *
 * Extracted into its own module because there are now **two** readers: the
 * settings panel, which reopens the folder on a later visit, and the service
 * worker, which needs it to answer a read. The worker's copy of the mount is
 * in memory, and a service worker is ephemeral — the browser may stop and
 * restart it at any time, or replace it with a new version that claims the
 * page — at which point that memory is gone. Without a durable source the
 * worker then answered `404` for a page of `catalogue.sqlite`, and SQLite
 * reported `SQLITE_CORRUPT` on whatever query hit it next.
 *
 * One definition, therefore, rather than the same three strings written twice.
 */
const DB_NAME = "eperx";
const DB_VERSION = 1;
const STORE = "handles";
const HANDLE_KEY = "tree";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB.open failed"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return undefined;
  }
  try {
    return await new Promise<T | undefined>((resolve) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    });
  } finally {
    db.close();
  }
}

export async function putTreeHandle(handle: FileSystemDirectoryHandle | undefined): Promise<void> {
  if (!handle) {
    await withStore("readwrite", (s) => s.delete(HANDLE_KEY) as IDBRequest<undefined>);
    return;
  }
  await withStore("readwrite", (s) => s.put(handle, HANDLE_KEY) as IDBRequest<IDBValidKey>);
}

export async function readTreeHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  return withStore<FileSystemDirectoryHandle>("readonly", (s) => s.get(HANDLE_KEY));
}
