/**
 * The tree's own description of itself.
 *
 * A client reads this first and decides what it can offer from what it finds:
 * the chassis filenames carry the release number, so a VIN lookup cannot guess
 * them, and `linked` decides whether the tree can be opened as a folder at
 * all. Keeping the shape here means the CLI and the in-browser wizard cannot
 * drift into writing two different manifests.
 */

/** Names fixed by convention, so a client can find them without being told. */
export const CATALOGUE_DB = "catalogue.sqlite";
export const ACCESSORIES_DB = "accessories.sqlite";
export const MANIFEST = "manifest.json";

export interface Manifest {
  eper: { version: string; release: string };
  /** ISO 8601. Passed in rather than read from a clock, so this stays pure. */
  importedAt: string;
  /** `LNG_COD` values kept, or `"all"`. */
  languages: string[] | "all";
  catalogue?: { file: string; tables: number; indexes: number };
  accessories?: { file: string; tables: number };
  /** `dir` is `null` when the shards were indexed where they lie. */
  images?: { dir: string | null; shards: number; entries: number };
  /**
   * Named because the filenames carry the release number, so a client cannot
   * guess them.
   */
  chassis?: { dir: string; files: Record<string, string> };
  /**
   * The big files are symlinks rather than bytes.
   *
   * Recorded because it decides which sources can read this tree: a browser
   * reading a folder the user picked will not follow a symlink out of that
   * folder, so a linked tree is HTTP-only. The client says so up front rather
   * than letting every drawing 404.
   */
  linked?: true;
}

export interface ManifestInput {
  version: string;
  release: string;
  importedAt: string;
  languages?: string[];
  catalogue?: { tables: number; indexes: number };
  accessories?: { tables: number };
  images?: { dir: string | null; shards: number; entries: number };
  chassis?: Record<string, string>;
  linked?: boolean;
}

export function buildManifest(input: ManifestInput): Manifest {
  return {
    eper: { version: input.version, release: input.release },
    importedAt: input.importedAt,
    languages: input.languages ?? "all",
    catalogue: input.catalogue && { file: CATALOGUE_DB, ...input.catalogue },
    accessories: input.accessories && { file: ACCESSORIES_DB, ...input.accessories },
    images: input.images,
    chassis: input.chassis && { dir: "chassis", files: input.chassis },
    linked: input.linked ? true : undefined,
  };
}
