import type { ByteSource } from "@eperx/core";

/**
 * A {@link ByteSource} over a `File` the user picked.
 *
 * `Blob.slice()` is the same primitive as an HTTP `Range` request — it hands
 * back a view without reading the rest — so a shard opened from disc behaves
 * exactly like one served over the network, and nothing above this layer has
 * to know which it got.
 */
export class FileByteSource implements ByteSource {
  constructor(private readonly file: File) {}

  async size(): Promise<number> {
    return this.file.size;
  }

  async read(pos: number, len: number): Promise<Uint8Array> {
    const slice = this.file.slice(pos, pos + len);
    return new Uint8Array(await slice.arrayBuffer());
  }
}
