import type { ByteSource } from "@eperx/core";
import { readCentralDirectory, resolvePayload, STORED, type ZipPayload } from "@eperx/res";

/**
 * The opened shard, as module-level rune state.
 *
 * Components `import { shard }` and read the proxy directly — the same shape
 * the sibling `uci` project uses, and the reason there are no stores here.
 */
export interface ShardState {
  name: string;
  source?: ByteSource;
  /** Bytes in the archive, so the saving from not downloading it is visible. */
  totalBytes: number;
  entries: ZipPayload[];
  /** Bytes actually fetched so far, across every read. */
  fetchedBytes: number;
  selected?: ZipPayload;
  /** Object URL for the selected entry, or `undefined` while loading. */
  imageUrl?: string;
  error?: string;
  busy: boolean;
}

export const shard = $state<ShardState>({
  name: "",
  totalBytes: 0,
  entries: [],
  fetchedBytes: 0,
  busy: false,
});

/** Wrap a source so every read is counted, for the byte tally in the UI. */
function counting(source: ByteSource): ByteSource {
  return {
    size: () => source.size(),
    read: async (pos, len) => {
      const bytes = await source.read(pos, len);
      shard.fetchedBytes += bytes.length;
      return bytes;
    },
  };
}

export async function openShard(name: string, source: ByteSource): Promise<void> {
  shard.busy = true;
  shard.error = undefined;
  revoke();
  shard.entries = [];
  shard.selected = undefined;
  shard.fetchedBytes = 0;
  shard.name = name;

  try {
    const counted = counting(source);
    shard.source = counted;
    shard.totalBytes = await counted.size();
    // Reading the central directory is two ranged reads regardless of how big
    // the archive is: the tail to find the EOCD, then the directory itself.
    const directory = await readCentralDirectory(counted);
    shard.entries = await Promise.all(directory.map((entry) => resolvePayload(counted, entry)));
  } catch (error) {
    shard.error = error instanceof Error ? error.message : String(error);
    shard.source = undefined;
  } finally {
    shard.busy = false;
  }
}

export async function selectEntry(entry: ZipPayload): Promise<void> {
  if (!shard.source) return;
  shard.busy = true;
  shard.error = undefined;
  shard.selected = entry;
  revoke();

  try {
    const bytes = await shard.source.read(entry.offset, entry.length);
    if (bytes.length !== entry.length) {
      throw new Error(`short read: wanted ${entry.length} bytes, got ${bytes.length}`);
    }
    // A drawing is stored, so its bytes are the PNG and this is a no-op path.
    // The L_* shards mix in deflated entries; `deflate-raw` is what a ZIP
    // holds, not `deflate`, and getting that wrong yields a decode error.
    const payload = entry.method === STORED ? bytes : await inflateRaw(bytes);
    shard.imageUrl = URL.createObjectURL(new Blob([payload as BlobPart]));
  } catch (error) {
    shard.error = error instanceof Error ? error.message : String(error);
    shard.imageUrl = undefined;
  } finally {
    shard.busy = false;
  }
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function revoke(): void {
  if (shard.imageUrl) URL.revokeObjectURL(shard.imageUrl);
  shard.imageUrl = undefined;
}
