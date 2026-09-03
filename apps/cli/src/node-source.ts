import { closeSync, openSync, readSync, statSync } from "node:fs";
import type { ByteSource } from "@eperx/core";

/**
 * A {@link ByteSource} over a local file.
 *
 * Synchronous `readSync` on a held descriptor, because the callers are
 * import-time loops doing hundreds of thousands of small reads and the
 * async round trip dominates at that size.
 */
export class FileSource implements ByteSource {
  private readonly fd: number;
  private readonly bytes: number;

  constructor(path: string) {
    this.fd = openSync(path, "r");
    this.bytes = statSync(path).size;
  }

  async size(): Promise<number> {
    return this.bytes;
  }

  async read(pos: number, len: number): Promise<Uint8Array> {
    const out = new Uint8Array(len);
    const got = readSync(this.fd, out, 0, len, pos);
    return got === len ? out : out.subarray(0, got);
  }

  close(): void {
    closeSync(this.fd);
  }
}
