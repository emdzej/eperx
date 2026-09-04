import type { SourceFs } from "./fs.js";

/**
 * What an ePER disc looks like, and how to find the pieces on it.
 *
 * The data files carry the release number in their name
 * (`SP.DB.04147.FCTLR` on edition 83), so nothing may hardcode `04147`.
 * `data/runparam.ini` names every file the application opens and is the
 * disc's own statement of what it ships — it is read as a cross-check, and a
 * file it names but that is missing is reported rather than skipped.
 */
export interface Disc {
  /** Directory holding `runparam.ini`, relative to the source root. */
  dataDir: string;
  /** Release number as it appears in the filenames, e.g. `"04147"`. */
  release: string;
  /** `sw_version` from `runparam.ini`, e.g. `"8.3.0"`. */
  version: string;
  files: DiscFiles;
}

/**
 * Paths are relative to the source root, because a browser has no absolute
 * path to offer — see the note in `fs.ts`.
 */
export interface DiscFiles {
  /** Spare-parts catalogue, a Jet 4 database. */
  spareParts?: string;
  /** Accessories / Mopar catalogue, a Jet 4 database. */
  accessories?: string;
  /** Chassis and VIN data, in the F3 blocked format. */
  chassis?: string;
  /** Per-vehicle build records — options and characteristics as fitted. */
  build?: string;
  /** Per-vehicle part fitment, 120M rows. Not read yet. */
  fitment?: string;
  /** Price lists. Out of scope by decision — see docs/plan.md. */
  priceList?: string;
  /** Drawing shards: `images/*.res`, ordinary ZIPs of stored PNGs. */
  imagesDir?: string;
}

const NAME = /^(SP|AM)\.(DB|CH|PL|NA|IM|MP|TS|MS|RT|TR)\.(\d+)\.FCTLR$/;

/** Join relative path segments, tolerating a `""` root. */
function at(...parts: string[]): string {
  return parts.filter(Boolean).join("/");
}

/**
 * Identify a disc, or explain why it is not one.
 *
 * Accepts either the mount root or its `data` directory, because both are
 * things a person plausibly picks in a folder dialog.
 */
export async function openDisc(fs: SourceFs, root = ""): Promise<Disc> {
  const hasIni = async (dir: string) => Boolean(await fs.statFile(at(dir, "runparam.ini")));
  const dataDir = (await hasIni(root)) ? root : at(root, "data");

  if (!(await hasIni(dataDir))) {
    throw new Error(
      `${root || "that folder"} does not look like an ePER disc: no data/runparam.ini`,
    );
  }

  const ini = parseIni(await fs.readText(at(dataDir, "runparam.ini")));
  const version = ini["sw_version"] ?? "unknown";

  const releases = new Set<string>();
  const files: DiscFiles = {};
  for (const name of await fs.list(dataDir)) {
    const m = NAME.exec(name);
    if (!m) continue;
    const [, family, kind, release] = m as unknown as [string, string, string, string];
    releases.add(release);
    const path = at(dataDir, name);
    // The directory-valued entries (SP.IM, SP.MP, …) hold only `hold.me`
    // placeholders on a DVD, so only the regular files are of interest.
    if (!(await fs.statFile(path))) continue;
    if (family === "SP" && kind === "DB") files.spareParts = path;
    if (family === "AM" && kind === "DB") files.accessories = path;
    if (family === "SP" && kind === "CH") files.chassis = path;
    if (family === "SP" && kind === "RT") files.build = path;
    if (family === "SP" && kind === "TR") files.fitment = path;
    if (family === "SP" && kind === "PL") files.priceList = path;
  }

  // A directory, so `statFile` is the wrong probe: list it and see.
  const images = at(dataDir, "images");
  try {
    if ((await fs.list(images)).length) files.imagesDir = images;
  } catch {
    // No images directory. A catalogue-only disc still imports.
  }

  if (releases.size !== 1) {
    throw new Error(
      `expected one release number in ${dataDir || "the disc"}, ` +
        `found ${[...releases].join(", ") || "none"}`,
    );
  }

  return { dataDir, release: [...releases][0]!, version, files };
}

/** Every `*.res` shard in `data/images`, in name order. */
export async function listShards(fs: SourceFs, imagesDir: string): Promise<string[]> {
  return (await fs.list(imagesDir)).filter((n) => n.toLowerCase().endsWith(".res")).sort();
}

function parseIni(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq <= 0 || line.startsWith("#") || line.startsWith(";")) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}
