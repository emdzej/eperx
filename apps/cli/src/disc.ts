import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

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
  /** Directory holding `runparam.ini`, i.e. `<mount>/data`. */
  dataDir: string;
  /** Release number as it appears in the filenames, e.g. `"04147"`. */
  release: string;
  /** `sw_version` from `runparam.ini`, e.g. `"8.3.0"`. */
  version: string;
  files: DiscFiles;
}

export interface DiscFiles {
  /** Spare-parts catalogue, a Jet 4 database. */
  spareParts?: string;
  /** Accessories / Mopar catalogue, a Jet 4 database. */
  accessories?: string;
  /** Chassis and VIN data, in the F3 blocked format. */
  chassis?: string;
  /** Price lists. Out of scope by decision — see docs/plan.md. */
  priceList?: string;
  /** Drawing shards: `images/*.res`, ordinary ZIPs of stored PNGs. */
  imagesDir?: string;
}

const NAME = /^(SP|AM)\.(DB|CH|PL|NA|IM|MP|TS|MS|RT|TR)\.(\d+)\.FCTLR$/;

export function openDisc(root: string): Disc {
  const dataDir = existsSync(join(root, "runparam.ini")) ? root : join(root, "data");
  const runparam = join(dataDir, "runparam.ini");
  if (!existsSync(runparam)) {
    throw new Error(`${root} does not look like an ePER disc: no data/runparam.ini`);
  }

  const ini = parseIni(readFileSync(runparam, "latin1"));
  const version = ini["sw_version"] ?? "unknown";

  const releases = new Set<string>();
  const files: DiscFiles = {};
  for (const name of readdirSync(dataDir)) {
    const m = NAME.exec(name);
    if (!m) continue;
    const [, family, kind, release] = m as unknown as [string, string, string, string];
    releases.add(release);
    const path = join(dataDir, name);
    // The directory-valued entries (SP.IM, SP.MP, …) hold only `hold.me`
    // placeholders on a DVD, so only the regular files are of interest.
    if (!statSync(path).isFile()) continue;
    if (family === "SP" && kind === "DB") files.spareParts = path;
    if (family === "AM" && kind === "DB") files.accessories = path;
    if (family === "SP" && kind === "CH") files.chassis = path;
    if (family === "SP" && kind === "PL") files.priceList = path;
  }

  const images = join(dataDir, "images");
  if (existsSync(images)) files.imagesDir = images;

  if (releases.size !== 1) {
    throw new Error(
      `expected one release number in ${dataDir}, found ${[...releases].join(", ") || "none"}`,
    );
  }

  return { dataDir, release: [...releases][0]!, version, files };
}

/** Every `*.res` shard in `data/images`, in name order. */
export function listShards(imagesDir: string): string[] {
  return readdirSync(imagesDir)
    .filter((n) => n.toLowerCase().endsWith(".res"))
    .sort();
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
