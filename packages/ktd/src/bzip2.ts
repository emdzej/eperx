import bz2 from "bz2";

/**
 * Decompress a bare bzip2 stream.
 *
 * `bz2` rather than `seek-bzip`: both are MIT and both decode a bare stream,
 * but `seek-bzip` builds its output with Node's `Buffer` and fails with
 * "Buffer is not defined" in a browser. Polyfilling a Node global into the
 * bundle just to read a vendor file would be the wrong trade — `bz2` takes and
 * returns plain `Uint8Array`. It is roughly 4× slower (97 ms against 26 ms for
 * an 820 kB block), which does not matter at one block per lookup.
 *
 * The awkwardness is that `bz2` ends with, in effect:
 *
 * ```js
 * if (typeof window !== "undefined") window.bz2 = exports;
 * else module.exports = exports;
 * ```
 *
 * so in a browser it exports **nothing** and assigns a global instead. A
 * bundler therefore hands back an empty module and `decompress` is nowhere to
 * be found — which presented as "bunzip is not a function" the first time.
 * Importing it for its side effect and then looking in both places covers
 * Node, a bundler, and whatever a future loader decides the default export is.
 */
type Decompress = (input: Uint8Array) => Uint8Array;

interface MaybeBz2 {
  decompress?: Decompress;
  default?: { decompress?: Decompress };
}

let cached: Decompress | undefined;

function find(): Decompress {
  if (cached) return cached;
  const candidates: (MaybeBz2 | undefined)[] = [
    bz2 as unknown as MaybeBz2,
    (globalThis as { bz2?: MaybeBz2 }).bz2,
  ];
  for (const candidate of candidates) {
    const fn = candidate?.decompress ?? candidate?.default?.decompress;
    if (typeof fn === "function") return (cached = fn);
  }
  throw new Error(
    "bz2 exposed no decompress(): it assigns `window.bz2` in a browser rather " +
      "than exporting, so the module must be imported for its side effect first",
  );
}

export function decompress(input: Uint8Array): Uint8Array {
  return find()(input);
}
