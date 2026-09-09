/**
 * Copy an imported tree into the origin private file system.
 *
 * Why anyone would: an OPFS tree survives a reload with no permission prompt
 * and no disc mounted, so the catalogue works fully offline. The cost is a
 * second copy of up to 6.4 GB, which is most of a typical quota — measured at
 * 7.5 GB here — so the size is checked before anything is written rather than
 * discovered when a write fails half way through.
 */
import { OPFS_NAMESPACE, opfsRoot } from "./opfs-namespace";

export interface Component {
  /** Path within the tree, e.g. `images`. Empty for files at the root. */
  dir: string;
  name: string;
  size: number;
}

export interface ImportPlan {
  components: Component[];
  bytes: number;
  /** Bytes the origin may store in total, and how many are already used. */
  quota: number;
  used: number;
  /** True when the plan does not fit in what is left. */
  tooLarge: boolean;
}

export interface ImportProgress {
  file: string;
  filesDone: number;
  files: number;
  bytesDone: number;
  bytes: number;
}

export const opfsImport = $state({
  busy: false,
  plan: undefined as ImportPlan | undefined,
  progress: undefined as ImportProgress | undefined,
  error: undefined as string | undefined,
  /** Set once a tree is present in OPFS. */
  present: false,
});

/**
 * Walk a picked directory and work out what importing it would cost.
 *
 * Only the files an imported tree is made of are considered — a stray 4 GB
 * ISO sitting beside `catalogue.sqlite` should not be copied into the browser
 * because it happened to be in the folder.
 */
export async function planImport(source: FileSystemDirectoryHandle): Promise<ImportPlan> {
  const components: Component[] = [];

  const consider = async (dir: FileSystemDirectoryHandle, path: string) => {
    for await (const [name, handle] of dir as unknown as AsyncIterable<
      [string, FileSystemHandle]
    >) {
      if (handle.kind === "directory") {
        if (path === "" && (name === "images" || name === "chassis")) {
          await consider(handle as FileSystemDirectoryHandle, name);
        }
        continue;
      }
      const wanted =
        path === ""
          ? name === "manifest.json" || name.endsWith(".sqlite")
          : path === "images"
            ? name.endsWith(".res")
            : true;
      if (!wanted) continue;
      const file = await (handle as FileSystemFileHandle).getFile();
      components.push({ dir: path, name, size: file.size });
    }
  };

  await consider(source, "");

  const bytes = components.reduce((n, c) => n + c.size, 0);
  const estimate = await navigator.storage.estimate();
  const quota = estimate.quota ?? 0;
  const used = estimate.usage ?? 0;

  return { components, bytes, quota, used, tooLarge: bytes > Math.max(0, quota - used) };
}

/**
 * Copy the planned files into OPFS.
 *
 * Streamed rather than buffered: `catalogue.sqlite` is 568 MB and a shard is
 * 19 MB, and reading either into memory to write it out again would be a
 * needless spike on a device that may not have the headroom.
 */
export async function runImport(
  source: FileSystemDirectoryHandle,
  plan: ImportPlan,
  onProgress?: (progress: ImportProgress) => void,
): Promise<void> {
  const root = await opfsRoot();
  let filesDone = 0;
  let bytesDone = 0;

  for (const component of plan.components) {
    const from = component.dir
      ? await (await source.getDirectoryHandle(component.dir)).getFileHandle(component.name)
      : await source.getFileHandle(component.name);

    const target = component.dir
      ? await root.getDirectoryHandle(component.dir, { create: true })
      : root;
    const to = await target.getFileHandle(component.name, { create: true });

    const writable = await to.createWritable();
    await (await from.getFile()).stream().pipeTo(writable);

    filesDone++;
    bytesDone += component.size;
    onProgress?.({
      file: component.dir ? `${component.dir}/${component.name}` : component.name,
      filesDone,
      files: plan.components.length,
      bytesDone,
      bytes: plan.bytes,
    });
  }
}

/** Is there already a tree in OPFS? */
export async function opfsHasTree(): Promise<boolean> {
  try {
    const root = await opfsRoot();
    await root.getFileHandle("catalogue.sqlite");
    return true;
  } catch {
    return false;
  }
}

/** What is in OPFS now, so the user can see it and clear it. */
export async function opfsContents(): Promise<Component[]> {
  const out: Component[] = [];
  const root = await opfsRoot();
  const walk = async (dir: FileSystemDirectoryHandle, path: string) => {
    for await (const [name, handle] of dir as unknown as AsyncIterable<
      [string, FileSystemHandle]
    >) {
      if (handle.kind === "directory") {
        await walk(handle as FileSystemDirectoryHandle, path ? `${path}/${name}` : name);
      } else {
        out.push({
          dir: path,
          name,
          size: (await (handle as FileSystemFileHandle).getFile()).size,
        });
      }
    }
  };
  await walk(root, "");
  return out;
}

/**
 * Delete the copy.
 *
 * The namespace directory itself, not a sweep of its contents — and
 * definitely not a sweep of the origin, which is what this did when eperx was
 * rooted there. A copy that cannot be removed is a few hundred megabytes of
 * quota with no way out but clearing all site data.
 */
export async function clearOpfs(): Promise<void> {
  const origin = await navigator.storage.getDirectory();
  try {
    await origin.removeEntry(OPFS_NAMESPACE, { recursive: true });
  } catch (cause) {
    // Already gone is success. Anything else is worth surfacing.
    if ((cause as DOMException)?.name !== "NotFoundError") throw cause;
  }
}
