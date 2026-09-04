/**
 * What `mdb-reader` will accept: a Node `Buffer`, or the `buffer` package's
 * polyfill of one.
 *
 * Deliberately **not** `Uint8Array`. The reader walks Jet's pages with
 * `readUInt32LE`, `readUInt16LE`, `readDoubleLE` and friends, none of which
 * exist on a plain `Uint8Array` — so passing raw bytes from a `File`
 * type-checks happily and then dies at the first page read. Naming the methods
 * here makes that a compile error at the call site instead, which is where it
 * can be fixed. The browser caller wraps its bytes with `Buffer.from`.
 */
export type JetBuffer = Uint8Array & {
  readUInt8(offset: number): number;
  readUInt16LE(offset: number): number;
  readUInt32LE(offset: number): number;
};
