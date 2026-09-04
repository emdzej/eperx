import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { ByteSource } from "@eperx/core";
import type {
  JetBuffer,
  SourceFile,
  SourceFs,
  SqlStatement,
  SqlWriter,
  TargetFs,
} from "@eperx/importer";
import { DatabaseSync } from "./sqlite.js";
import { FileSource } from "./node-source.js";

/**
 * The importer's filesystem, over real files.
 *
 * Everything here is a thin wrapper: the interesting decisions live in
 * `@eperx/importer`, and this exists so those decisions do not have to know
 * whether they are running in Node or in a tab. The browser counterpart is
 * `apps/web/src/lib/browser-fs.ts`.
 *
 * Paths arriving from the importer are relative and `/`-separated; they get
 * joined onto a root here. Nothing above this layer knows where the root is.
 */

class NodeSourceFile implements SourceFile {
  readonly name: string;
  readonly size: number;
  readonly nativePath: string;
  private handle?: FileSource;

  constructor(path: string) {
    this.nativePath = path;
    this.name = path.split(/[\\/]/).pop() ?? path;
    this.size = statSync(path).size;
  }

  async bytes(): Promise<JetBuffer> {
    // A Node `Buffer` already has the `readUInt32LE` family mdb-reader needs,
    // so this satisfies `JetBuffer` without wrapping. The browser has to work
    // for it — see `apps/web/src/lib/browser-fs.ts`.
    return readFileSync(this.nativePath);
  }

  source(): ByteSource {
    // Opened lazily and kept, because `indexShard` does hundreds of small
    // reads per shard and reopening for each would dominate.
    this.handle ??= new FileSource(this.nativePath);
    return this.handle;
  }

  close(): void {
    this.handle?.close();
    this.handle = undefined;
  }
}

export class NodeSourceFs implements SourceFs {
  constructor(private readonly root: string) {}

  private at(path: string): string {
    return path ? join(this.root, path) : this.root;
  }

  async list(dir: string): Promise<string[]> {
    return readdirSync(this.at(dir));
  }

  async statFile(path: string): Promise<{ size: number } | undefined> {
    const full = this.at(path);
    if (!existsSync(full)) return undefined;
    const stat = statSync(full);
    return stat.isFile() ? { size: stat.size } : undefined;
  }

  async open(path: string): Promise<SourceFile> {
    return new NodeSourceFile(this.at(path));
  }

  async readText(path: string): Promise<string> {
    return readFileSync(this.at(path), "latin1");
  }
}

export class NodeTargetFs implements TargetFs {
  constructor(private readonly root: string) {}

  private at(path: string): string {
    return path ? join(this.root, path) : this.root;
  }

  async mkdir(dir: string): Promise<void> {
    mkdirSync(this.at(dir), { recursive: true });
  }

  async exists(path: string): Promise<boolean> {
    return existsSync(this.at(path));
  }

  async remove(path: string): Promise<void> {
    rmSync(this.at(path), { force: true });
  }

  async copy(from: SourceFile, to: string): Promise<void> {
    if (!from.nativePath) throw new Error(`${from.name} has no path to copy from`);
    copyFileSync(from.nativePath, this.at(to));
  }

  async link(from: SourceFile, to: string): Promise<void> {
    if (!from.nativePath) throw new Error(`${from.name} has no path to link to`);
    // Absolute, so the link survives the tree being moved. A relative link
    // into a mounted disc breaks the moment either end shifts.
    const target = isAbsolute(from.nativePath) ? from.nativePath : resolve(from.nativePath);
    symlinkSync(target, this.at(to));
  }

  async writeText(path: string, text: string): Promise<void> {
    writeFileSync(this.at(path), text);
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    writeFileSync(this.at(path), bytes);
  }
}

/**
 * A {@link SqlWriter} over `node:sqlite`.
 *
 * `finish` returns `undefined`: the database was written where it was asked
 * to, so there are no bytes for the caller to place. The browser writer is
 * the one that has to hand them back.
 */
export function openNodeSqlWriter(path: string): SqlWriter {
  const db = new DatabaseSync(path);
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql): SqlStatement => {
      const stmt = db.prepare(sql);
      return {
        run: (values) => void stmt.run(...values),
        // `node:sqlite` finalises with the database; nothing to do per
        // statement, and the interface exists for the WASM writer's sake.
        finalize: () => {},
      };
    },
    finish: async () => {
      db.close();
      return undefined;
    },
  };
}
