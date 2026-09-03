import type { ByteSource } from "@eperx/core";

/**
 * A {@link ByteSource} over HTTP `Range`.
 *
 * This is the whole architecture in one class: the drawing shards are served
 * as the vendor wrote them, and a stored ZIP entry is a byte range, so reading
 * one drawing out of a 19 MB archive is one request for a few tens of
 * kilobytes.
 *
 * A host that ignores `Range` answers `200` with the entire body. Accepting
 * that would mean slicing the right bytes out by luck and downloading
 * everything to do it, so the source rejects such a host on first contact
 * rather than reading the wrong bytes quietly.
 */
export class HttpSource implements ByteSource {
  private length?: number;

  constructor(readonly url: string) {}

  async size(): Promise<number> {
    if (this.length !== undefined) return this.length;

    const head = await fetch(this.url, { method: "HEAD" });
    if (!head.ok) throw new Error(`${this.url}: ${head.status} ${head.statusText}`);

    if (head.headers.get("accept-ranges") === "none") {
      throw new Error(`${this.url}: the server says it does not support Range requests`);
    }
    const length = head.headers.get("content-length");
    if (!length) throw new Error(`${this.url}: no Content-Length, so the size is unknown`);

    return (this.length = Number(length));
  }

  async read(pos: number, len: number): Promise<Uint8Array> {
    if (len === 0) return new Uint8Array(0);
    const response = await fetch(this.url, {
      headers: { Range: `bytes=${pos}-${pos + len - 1}` },
    });
    if (response.status === 200) {
      throw new Error(
        `${this.url}: the server ignored the Range header and sent the whole file. ` +
          `Serve the tree from a host that honours Range.`,
      );
    }
    if (response.status !== 206) {
      throw new Error(`${this.url}: ${response.status} ${response.statusText}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
}
