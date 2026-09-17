import type { CsFileSystem } from "@emdzej/csfs-core";
import { fsaFileSystem } from "@emdzej/csfs-fsa";
import { httpFileSystem } from "@emdzej/csfs-http";
import { opfsFileSystem } from "@emdzej/csfs-opfs";
import { OPFS_NAMESPACE } from "./opfs-namespace";
import type { MountKind } from "./mount";

/**
 * The tree's bytes, whichever of the three places it is in.
 *
 * eperx used to have one of these per source — `HttpSource` over `fetch` with
 * `Range`, and a service worker so a picked folder could answer the same way.
 * csfs is that idea as a library, so all three are now one call and the
 * readers above (`@eperx/res`, `@eperx/ktd`) take a `CsFile` without caring
 * which.
 *
 * **The service worker has not gone away, and this does not replace it.** It
 * exists for `catalogue.sqlite` alone: `sqlite-wasm-http` wants a URL, and
 * SQLite's VFS reads are synchronous, which no folder handle can answer. So
 * SQL still goes through the shim while the drawings and chassis files come
 * through here — and in a picked folder that is now a direct read rather than
 * a round trip through a worker.
 *
 * One thing to know about the HTTP backend: **it needs a manifest.** A static
 * host cannot list a directory, so a served tree carries `csfs-manifest.json`
 * describing itself. `eperx import` writes one. The other two backends can
 * list for themselves and need nothing.
 */
export async function dataFileSystem(
  kind: MountKind,
  options: { base?: string; handle?: FileSystemDirectoryHandle } = {},
): Promise<CsFileSystem> {
  if (kind === "remote") {
    const base = options.base ?? "/data";
    // `ranges: "require"` rather than csfs 0.2.0's new `"auto"` default, which
    // reads the whole file and slices it locally once a host has shown it
    // ignores `Range`. That is the right default for a library and the wrong
    // one here, for two reasons.
    //
    // It cannot rescue eperx anyway: `catalogue.sqlite` is read by
    // `sqlite-wasm-http`, which needs real `206`s and has no fallback. So on
    // such a host SQL fails whatever csfs does, and the tree is unreadable.
    //
    // And the fallback is not cheap at this file size. Measured against a
    // served tree, one 53 kB drawing out of a 19.6 MB shard: **0.1 MB over five
    // ranged requests, against 78.4 MB without** — the same five reads, four of
    // them pulling the whole shard, because a 19.6 MB body does not fit the
    // 16 MiB whole-file cache. Failing on connect is the kinder answer.
    //
    // It costs nothing when the host is fine: `"require"` and `"auto"` make the
    // identical five requests against a host that honours `Range`.
    return httpFileSystem(base.replace(/\/$/, ""), { ranges: "require" });
  }

  if (kind === "directory") {
    if (!options.handle) throw new Error("no folder was given to read the tree from");
    return fsaFileSystem(options.handle);
  }

  // Namespaced, and the service worker walks into the same directory — see
  // `opfs-namespace.ts` for why every reader has to agree about this.
  return opfsFileSystem({ namespace: OPFS_NAMESPACE });
}

/**
 * A file that has to be there, or an error naming it.
 *
 * csfs returns `null` for absence rather than throwing, which is right — the
 * question "is it there" should not need a `try`. But a tree that promised a
 * shard in its `images` index and cannot produce it is broken, and saying
 * which file is missing is more use than a null dereference.
 */
export async function required(fs: CsFileSystem, path: string) {
  const file = await fs.file(path);
  if (!file) throw new Error(`${path} is not readable from this tree`);
  return file;
}
