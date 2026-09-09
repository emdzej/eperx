/**
 * A subdirectory of our own inside the origin private file system.
 *
 * The OPFS is shared by everything on the origin, so a consumer rooted at `/`
 * can see — and delete — another one's files. eperx used to be rooted there,
 * which meant "discard the copy" was a promise about the whole origin, and it
 * shared that root with the SQLite SAH pool's own directory.
 *
 * Namespaced so that discarding means ours and nothing else. **Every** reader
 * and writer has to agree about this, including the service worker, which is
 * why it is one constant in a plain module rather than a literal in six.
 */
export const OPFS_NAMESPACE = "eperx";

/**
 * The namespaced root, created if absent.
 *
 * Raw OPFS rather than csfs here: the callers of this are the ones that need a
 * `FileSystemDirectoryHandle` itself — the service worker resolving a path,
 * and the code that removes the directory wholesale.
 */
export async function opfsRoot(): Promise<FileSystemDirectoryHandle> {
  const origin = await navigator.storage.getDirectory();
  return origin.getDirectoryHandle(OPFS_NAMESPACE, { create: true });
}
