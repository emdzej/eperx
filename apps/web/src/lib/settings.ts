import type { MountKind } from "./mount";
import { putTreeHandle, readTreeHandle } from "./tree-handle";

/**
 * What the app remembers between visits.
 *
 * Two stores, because the two things stored are not alike:
 *
 * - **`localStorage`** holds the choice — which source, and the URL if it is a
 *   remote one. Small, synchronous, readable before the first paint.
 * - **IndexedDB** holds the directory handle. A `FileSystemDirectoryHandle`
 *   cannot go in `localStorage`: it is not JSON, and `JSON.stringify` turns it
 *   into `{}` — a silent loss that reads as "the folder was forgotten". It
 *   *is* structured-cloneable, which is what IndexedDB stores.
 *
 * Reopening a saved folder has a catch worth knowing: the handle survives, but
 * the **permission may not**. Chrome grants directory read access for the
 * session, so on a later visit `queryPermission` can come back `prompt`, and
 * re-granting needs a user gesture. So a saved folder cannot always be opened
 * without a click — {@link readSettings} reports which case it is rather than
 * failing at the first read.
 */

const KEY = "eperx.data";

export interface DataSettings {
  kind: MountKind;
  /** For `remote`: the base URL. */
  base?: string;
  /** Display name of the saved folder, so it can be named before it is opened. */
  directoryName?: string;
  savedAt?: string;
}

/** What a saved setting can be resumed with. */
export interface Resumable {
  settings: DataSettings;
  /** Present for `directory`, when the handle survived. */
  handle?: FileSystemDirectoryHandle;
  /**
   * Whether it can be opened without asking the user first.
   *
   * `granted` — go ahead. `prompt` — the handle is there but needs a click.
   * `denied` — the user said no. `missing` — nothing to resume.
   */
  permission: "granted" | "prompt" | "denied" | "missing";
}

/** Remember a choice. The handle is only stored for `directory`. */
export async function saveSettings(
  settings: DataSettings,
  handle?: FileSystemDirectoryHandle,
): Promise<void> {
  localStorage.setItem(
    KEY,
    JSON.stringify({ ...settings, savedAt: new Date().toISOString() } satisfies DataSettings),
  );
  if (settings.kind === "directory") await putTreeHandle(handle);
}

/** Forget everything, including the folder handle. */
export async function clearSettings(): Promise<void> {
  localStorage.removeItem(KEY);
  await putTreeHandle(undefined);
}

/** The stored choice, without touching IndexedDB. */
export function storedSettings(): DataSettings | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as DataSettings;
    return parsed.kind ? parsed : undefined;
  } catch {
    // A corrupt entry should not stop the app opening; it just means asking.
    return undefined;
  }
}

/**
 * What can be resumed, and whether it needs a click first.
 *
 * `queryPermission` is used rather than `requestPermission`: asking outright
 * from startup code either throws for want of a user gesture or throws up a
 * prompt nobody invited. Reporting `prompt` lets the UI offer a button
 * instead.
 */
export async function readSettings(): Promise<Resumable> {
  const settings = storedSettings();
  if (!settings) {
    return { settings: { kind: "remote" }, permission: "missing" };
  }

  if (settings.kind !== "directory") {
    // Remote and OPFS need no permission at all.
    return { settings, permission: "granted" };
  }

  let handle: FileSystemDirectoryHandle | undefined;
  try {
    handle = await readTreeHandle();
  } catch {
    handle = undefined;
  }
  if (!handle) return { settings, permission: "missing" };

  const queryable = handle as FileSystemDirectoryHandle & {
    queryPermission?: (options: { mode: "read" }) => Promise<PermissionState>;
  };
  if (!queryable.queryPermission) return { settings, handle, permission: "prompt" };

  const state = await queryable.queryPermission({ mode: "read" });
  return {
    settings,
    handle,
    permission: state === "granted" ? "granted" : state === "denied" ? "denied" : "prompt",
  };
}

/**
 * Ask for permission on a saved folder. Must be called from a click.
 *
 * Chrome throws `SecurityError` without a user gesture, which is why this is
 * separate from {@link readSettings} rather than folded into it.
 */
export async function requestAccess(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const requestable = handle as FileSystemDirectoryHandle & {
    requestPermission?: (options: { mode: "read" }) => Promise<PermissionState>;
  };
  if (!requestable.requestPermission) return true;
  return (await requestable.requestPermission({ mode: "read" })) === "granted";
}
