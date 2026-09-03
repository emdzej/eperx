import { chassisFromVin, F3Table, typeCodeFromVin, type F3Row } from "@eperx/ktd";
import {
  closeSpecification,
  parsePattern,
  specificationFrom,
  type Specification,
} from "@eperx/catalogue";
import { HttpSource } from "./http-source";
import { tree } from "./tree.svelte";

/**
 * Look a vehicle up by VIN, in the browser.
 *
 * The F3 files are served exactly as the disc wrote them, and their index is a
 * sorted fixed-width array — so it is binary-searched over ranged reads rather
 * than downloaded. A lookup against the 420 MB `SP.CH` costs about fifteen
 * 19-byte reads plus one compressed block.
 *
 * What it buys is better than the version picker: `SP.RT.CARATT` is *this
 * car's* characteristics, so the closed-world inference the version path needs
 * can be dropped entirely.
 */
export interface VinState {
  query: string;
  busy: boolean;
  error?: string;
  /** Models the type code could name, tried in order. */
  models: string[];
  chassis?: string;
  chassisRecord?: F3Row;
  buildRecord?: F3Row;
  model?: string;
  /**
   * When nothing matched: the highest chassis each candidate model has *in
   * the same series as the query*. Chassis numbers roll from digits into
   * letters and those runs do not compare as one ordered space, so the
   * comparison is scoped to keys sharing the query's leading character.
   */
  highest: { model: string; chassis: string; beyond: boolean }[];
}

export const vin = $state<VinState>({
  query: "",
  busy: false,
  models: [],
  highest: [],
});

/** Where the tree's F3 files live, from the manifest. */
interface ChassisManifest {
  dir: string;
  files: { chassis?: string; build?: string };
}

let manifest: ChassisManifest | undefined | null;

async function chassisManifest(): Promise<ChassisManifest | undefined> {
  if (manifest !== undefined) return manifest ?? undefined;
  try {
    const response = await fetch(`${tree.base}/manifest.json`);
    const body = (await response.json()) as { chassis?: ChassisManifest };
    manifest = body.chassis ?? null;
  } catch {
    manifest = null;
  }
  return manifest ?? undefined;
}

/** True when this tree was imported with the chassis files. */
export async function hasChassisData(): Promise<boolean> {
  return (await chassisManifest()) !== undefined;
}

export async function lookupVin(query: string): Promise<void> {
  vin.busy = true;
  vin.error = undefined;
  vin.models = [];
  vin.highest = [];
  vin.chassisRecord = undefined;
  vin.buildRecord = undefined;
  vin.model = undefined;
  vin.query = query;

  try {
    const parts = typeCodeFromVin(query);
    if (!parts) throw new Error("That is not a 17-character Fiat-group VIN.");
    vin.chassis = parts.chassis;

    const where = await chassisManifest();
    if (!where) {
      throw new Error(
        "This tree has no chassis data — re-import without --no-chassis to include it.",
      );
    }
    if (!tree.catalogue) throw new Error("No catalogue open.");

    // The type code names the model, from SP.DB's own VIN table.
    const models = await tree.catalogue.rows.all<{ model: string }>(
      "SELECT MOD_COD AS model FROM VIN WHERE VIN_COD = ? ORDER BY MOD_COD",
      [parts.typeCode],
    );
    vin.models = models.map((row) => row.model);
    if (vin.models.length === 0) {
      throw new Error(`VIN type code ${parts.typeCode} is not in this release's VIN table.`);
    }

    if (where.files.chassis) {
      const table = await F3Table.open(
        new HttpSource(`${tree.base}/${where.dir}/${where.files.chassis}`),
      );
      const width = table.header.primaryKey.at(-1)?.length ?? 8;
      for (const model of vin.models) {
        const rows = await table.lookup(model + chassisFromVin(parts.chassis, width));
        if (rows.length) {
          vin.chassisRecord = rows[0];
          vin.model = model;
          break;
        }
      }
      if (!vin.chassisRecord) {
        // Distinguish "newer than this release" from "absent" — a disc is a
        // snapshot, and that is the likeliest reason a real VIN is missing.
        const padded = chassisFromVin(parts.chassis, width);
        for (const model of vin.models) {
          const scoped = await table.highestKeyUnder(model + padded.slice(0, 1));
          const key = scoped ?? (await table.highestKeyUnder(model));
          if (!key) continue;
          const highest = key.slice(model.length).trim();
          vin.highest.push({
            model,
            chassis: highest,
            beyond: scoped !== undefined && padded > highest,
          });
        }
      }
    }

    if (where.files.build) {
      const table = await F3Table.open(
        new HttpSource(`${tree.base}/${where.dir}/${where.files.build}`),
      );
      const width = table.header.keyLength - 3;
      for (const model of vin.model ? [vin.model] : vin.models) {
        const rows = await table.lookup(model + chassisFromVin(parts.chassis, width));
        if (rows.length) {
          vin.buildRecord = rows[0];
          vin.model ??= model;
          break;
        }
      }
    }
  } catch (error) {
    vin.error = error instanceof Error ? error.message : String(error);
  } finally {
    vin.busy = false;
  }
}

/**
 * The specification of the vehicle just looked up.
 *
 * `CARATT` is a conjunction of that car's own criteria, written with an
 * explicit `|` between type and code (`CMB|DS`) which the parser normalises to
 * the form drawing patterns use (`CMBDS`).
 *
 * It is still closed per criteria type. `CARATT` lists what the car *has* and
 * negates nothing, so without closing it every drawing for another engine
 * would read "not determined" — the same problem the version path has, for the
 * same reason.
 */
export function vinSpecification(vocabulary: ReadonlySet<string>): Specification | undefined {
  const caratt = vin.buildRecord?.["CARATT"];
  if (!caratt) return undefined;
  try {
    const { present, absent } = specificationFrom(parsePattern(caratt));
    return closeSpecification({ present, absent }, vocabulary);
  } catch {
    return undefined;
  }
}

/** A one-line description of the vehicle, for the picker. */
export function vinSummary(): string | undefined {
  const build = vin.buildRecord;
  const chassisRecord = vin.chassisRecord;
  if (!build && !chassisRecord) return undefined;
  const parts = [
    build?.["MODELLO"] && build["VERSIONE"]
      ? `${build["MODELLO"]}/${build["VERSIONE"]}`
      : undefined,
    chassisRecord?.["MVS"],
    chassisRecord?.["DATE"] ? formatDate(chassisRecord["DATE"]) : undefined,
    chassisRecord?.["MOTOR"] ? `engine ${chassisRecord["MOTOR"]}` : undefined,
  ].filter(Boolean);
  return parts.join(" · ");
}

/** `SP.CH.DATE` is `YYYYMMDD`. */
function formatDate(value: string): string {
  return /^\d{8}$/.test(value)
    ? `${value.slice(6, 8)}.${value.slice(4, 6)}.${value.slice(0, 4)}`
    : value;
}
