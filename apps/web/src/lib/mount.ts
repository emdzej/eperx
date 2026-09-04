/**
 * Where a tree's bytes come from.
 *
 * Three sources, one transport. Everything above this reads HTTP with `Range`
 * requests, and a service worker makes local files look like that — see
 * `public/sw.js` for why that indirection is not optional.
 *
 * - `remote` — a static host. No worker involved.
 * - `directory` — a folder the user picked. Nothing is copied.
 * - `opfs` — a folder previously imported into the origin private file
 *   system, so it survives a reload with no permission prompt.
 */
export type MountKind = "remote" | "directory" | "opfs";

/**
 * The path prefix the worker claims, under whatever base the app is served
 * from. `sw.js` derives the same value from its own registration scope, so the
 * two agree without either hardcoding an origin-root path — which would break
 * every deploy that is not at a domain root.
 */
const PREFIX = `${import.meta.env.BASE_URL}__eperx`.replace(/\/{2,}/g, "/");

export interface Capabilities {
  /** Service workers, without which neither local mode can work. */
  serviceWorker: boolean;
  /** `showDirectoryPicker`, currently Chromium-only. */
  directoryPicker: boolean;
  /** The origin private file system. */
  opfs: boolean;
  /** Bytes the origin may store, and how many it already uses. */
  quota?: { available: number; used: number };
}

export async function capabilities(): Promise<Capabilities> {
  const result: Capabilities = {
    serviceWorker: "serviceWorker" in navigator,
    directoryPicker:
      typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function",
    opfs: typeof navigator.storage?.getDirectory === "function",
  };
  if (result.opfs && navigator.storage.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      result.quota = { available: estimate.quota ?? 0, used: estimate.usage ?? 0 };
    } catch {
      // An origin may refuse to estimate; the modes still work without it.
    }
  }
  return result;
}

let registration: ServiceWorkerRegistration | undefined;

/**
 * Register the worker and wait until it controls this page.
 *
 * Both waits matter. A freshly installed worker does not control the page that
 * registered it until it activates and claims clients, and a fetch issued
 * before that goes to the network — which for `/__eperx/...` means a 404 that
 * looks like a missing file rather than a worker that is not ready yet.
 */
export async function ensureWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    throw new Error("This browser has no service workers, so local data cannot be served.");
  }

  registration ??= await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
    scope: import.meta.env.BASE_URL,
  });
  await registration.update().catch(() => {
    // An update check failing is not a reason to refuse to run.
  });

  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("the service worker did not take control within 10s")),
        10_000,
      );
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}

/**
 * Hand a mount to the worker and wait for it to acknowledge.
 *
 * The acknowledgement is the point: posting a handle and immediately fetching
 * races the worker's message queue, and losing that race reads as a missing
 * file.
 */
async function postMount(mount: MountKind, handle?: FileSystemDirectoryHandle): Promise<void> {
  const controller = navigator.serviceWorker.controller;
  if (!controller) throw new Error("no service worker is controlling this page");

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`mounting ${mount} timed out`)), 10_000);
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "mounted" && event.data.mount === mount) {
        clearTimeout(timer);
        navigator.serviceWorker.removeEventListener("message", onMessage);
        resolve();
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    controller.postMessage({ type: "mount", mount, handle });
  });
}

/** Ask the user for a folder. Chromium only. */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle> {
  const picker = (
    globalThis as {
      showDirectoryPicker?: (options?: {
        mode?: "read" | "readwrite";
        id?: string;
      }) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;
  if (!picker) {
    throw new Error(
      "This browser cannot open a folder. Chromium-based browsers can; " +
        "otherwise serve the tree over HTTP.",
    );
  }
  // `id` makes the picker reopen where it was last used.
  return picker({ mode: "read", id: "eperx-tree" });
}

/**
 * Mount a source and return the base URL to read it through.
 *
 * `remote` needs no worker at all, which keeps the plain HTTP case free of
 * service-worker lifecycle entirely — including in browsers that have none.
 */
export async function mount(
  kind: MountKind,
  options: { base?: string; handle?: FileSystemDirectoryHandle } = {},
): Promise<string> {
  if (kind === "remote") return (options.base ?? "/data").replace(/\/$/, "");

  await ensureWorker();
  await postMount(kind, options.handle);
  return `${PREFIX}/${kind}`;
}

/** What an imported tree says about itself. */
interface Manifest {
  catalogue?: { file?: string };
  images?: { dir?: string | null };
  chassis?: { dir?: string; files?: Record<string, string> };
  /** `eperx import --link` symlinked the big files instead of copying them. */
  linked?: boolean;
}

async function readManifest(base: string): Promise<Manifest | undefined> {
  try {
    const response = await fetch(`${base}/manifest.json`);
    if (!response.ok) return undefined;
    return (await response.json()) as Manifest;
  } catch {
    return undefined;
  }
}

/** Does a mount look like an imported tree? */
export async function hasManifest(base: string): Promise<boolean> {
  const manifest = await readManifest(base);
  return Boolean(manifest?.catalogue);
}

/**
 * Check that the files the manifest promises can actually be read.
 *
 * This exists because of one specific, silent failure. `eperx import --link`
 * symlinks the drawing shards and chassis files rather than copying 5.7 GB,
 * and a symlink is invisible to the File System Access API when it points out
 * of the directory the user granted — the browser blocks that as a sandbox
 * escape. `catalogue.sqlite` is a real file, so the tree mounts, the marque
 * list fills in, and browsing works right up until the first drawing or VIN
 * lookup answers `404`. Which reads as a bug in eperx, not as a tree that
 * cannot be opened this way.
 *
 * Returns a message to show, or `undefined` if the tree is sound. Deliberately
 * a warning and not an error: the catalogue and the parts lists genuinely do
 * work, so refusing to connect would take away more than it protects.
 */
export async function verifyTree(base: string, kind: MountKind): Promise<string | undefined> {
  // A remote host serves whatever its filesystem resolves, links included.
  if (kind === "remote") return undefined;

  const manifest = await readManifest(base);
  if (!manifest) return undefined;

  // Probe one shard and the chassis files rather than all 261: a linked tree
  // links every one of them, so the first is representative.
  const probes: { path: string; what: string }[] = [];
  if (manifest.images?.dir)
    probes.push({ path: `${manifest.images.dir}/00.res`, what: "drawings" });
  for (const name of Object.values(manifest.chassis?.files ?? {})) {
    probes.push({ path: `${manifest.chassis?.dir ?? "chassis"}/${name}`, what: "VIN lookup" });
  }
  if (!probes.length) return undefined;

  const unreadable = new Set<string>();
  await Promise.all(
    probes.map(async ({ path, what }) => {
      try {
        const response = await fetch(`${base}/${encodeURI(path)}`, { method: "HEAD" });
        if (!response.ok) unreadable.add(what);
      } catch {
        unreadable.add(what);
      }
    }),
  );
  if (!unreadable.size) return undefined;

  const missing = [...unreadable].join(" and ");
  return manifest.linked
    ? `This tree was imported with \`--link\`, so its big files are symlinks into the ` +
        `disc. A browser will not follow a link out of the folder you granted, so ` +
        `${missing} will not load. Serve the tree over HTTP instead, or re-import ` +
        `it without \`--link\`.`
    : `The catalogue opened, but ${missing} could not be read from this tree. If it was ` +
        `imported with \`--link\` the big files are symlinks, which a browser cannot ` +
        `follow out of the folder you granted — serve it over HTTP instead.`;
}
