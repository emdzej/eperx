import type { ByteSource } from "@eperx/core";
import type { JetBuffer } from "./jet.js";

/**
 * The filesystem the importer talks to, so the same import runs in Node and
 * in a browser tab.
 *
 * The reason this abstraction exists rather than two importers: the import is
 * where all the format knowledge lives — which files a disc carries, which
 * columns get indexed, that a `.res` shard is a ZIP whose stored entries need
 * no inflating. Duplicating that for the browser would mean two places to fix
 * every time the disc surprises us. What actually differs between the two
 * environments is only how bytes are read and written, which is this file.
 *
 * **Every path here is relative, `/`-separated, and rooted at the disc (for a
 * source) or the tree (for a target).** Nothing in the importer sees an
 * absolute path, because a browser has none to see: a directory the user
 * picked is a handle, not a location. The Node implementations join paths
 * against a root; the browser implementations walk directory handles.
 */

/** One file open for reading. */
export interface SourceFile {
  /** Base name, as the disc spells it. */
  readonly name: string;
  readonly size: number;
  /**
   * The whole file as bytes.
   *
   * Only the Jet databases need this — `mdb-reader` takes the entire database
   * as one buffer, because Jet's own page index lives inside it. It is 1.27 GB
   * for `SP.DB`, and measured peak memory is barely above that, since the
   * reader is a view over the buffer rather than a copy.
   */
  bytes(): Promise<JetBuffer>;
  /** Ranged reads, for the formats that are already byte-addressable. */
  source(): ByteSource;
  /**
   * Where this file lives, when that is a meaningful question.
   *
   * Set by the Node implementation and absent in the browser. The only caller
   * is `--link`, which needs a real path to point a symlink at; everything
   * else goes through `bytes()` or `source()`.
   */
  readonly nativePath?: string;
  close(): void;
}

/** Reading a disc. */
export interface SourceFs {
  /** Entry names directly under `dir`, unsorted. `""` is the root. */
  list(dir: string): Promise<string[]>;
  /** Size of a file, or `undefined` if it is absent or is a directory. */
  statFile(path: string): Promise<{ size: number } | undefined>;
  open(path: string): Promise<SourceFile>;
  /**
   * Read a whole file as text.
   *
   * Latin-1 rather than UTF-8: `runparam.ini` is a Windows-era INI and a
   * stray high byte in it must not become a replacement character.
   */
  readText(path: string): Promise<string>;
}

/** Writing a tree. */
export interface TargetFs {
  /** Create a directory and any missing parents. */
  mkdir(dir: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Remove a file, succeeding if it was not there. */
  remove(path: string): Promise<void>;
  /** Copy a source file in, streaming rather than buffering it. */
  copy(from: SourceFile, to: string): Promise<void>;
  /**
   * Point at a source file instead of copying it.
   *
   * Optional, and only Node has it. A tree built this way is servable over
   * HTTP but **cannot be opened as a folder**: browsers refuse to follow a
   * symlink out of the directory they were granted. See the note in
   * `AGENTS.md`.
   */
  link?(from: SourceFile, to: string): Promise<void>;
  writeText(path: string, text: string): Promise<void>;
  /** Write bytes as a whole file. Used for the converted databases. */
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
}
