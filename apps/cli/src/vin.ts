import { chassisFromVin, F3Table, typeCodeFromVin, type F3Row } from "@eperx/ktd";
import type { SourceFs } from "@eperx/importer";
import type { Database } from "./sqlite.js";
import type { Disc } from "@eperx/importer";

/**
 * Resolve a VIN, or a model and chassis number, to a vehicle.
 *
 * Two files answer between them. `SP.CH` gives the version (`MVS`), engine
 * number, build date and interior colour for a chassis. `SP.RT` gives the
 * build record for that individual car — including `CODOPT`, the options
 * actually fitted, and `CARATT`, its characteristics. Those last two are
 * criteria codes in the same grammar as `DRAWINGS.PATTERN`, so a chassis
 * number yields a specification of *this car* rather than of its version.
 */

export interface VehicleLookup {
  /** `VIN_COD` → `MOD_COD` candidates tried, in order. */
  models: string[];
  chassis: string;
  chassisRecord?: F3Row;
  buildRecord?: F3Row;
  /** Which model actually matched. */
  model?: string;
  /**
   * When nothing matched: for each candidate model, the highest chassis on
   * this disc *in the same series as the query*, so "newer than this release"
   * reads differently from "absent".
   *
   * Series matters. Chassis numbers roll from digits into letters — `J161921`,
   * `O0336215` — and those runs do not compare as one ordered space, so the
   * highest chassis overall says nothing about whether a given one is beyond
   * the disc. The comparison is scoped to keys sharing the query's leading
   * character instead.
   */
  highest?: { model: string; chassis: string; beyond: boolean }[];
}

/** Models a VIN's type code could belong to, from `SP.DB`'s `VIN` table. */
export function modelsForTypeCode(db: Database, typeCode: string): string[] {
  return (
    db.prepare("SELECT MOD_COD m FROM VIN WHERE VIN_COD = ? ORDER BY MOD_COD").all(typeCode) as {
      m: string;
    }[]
  ).map((row) => row.m);
}

export async function lookupVehicle(
  fs: SourceFs,
  disc: Disc,
  db: Database,
  input: { vin?: string; model?: string; chassis?: string },
): Promise<VehicleLookup> {
  let models: string[];
  let chassis: string;

  if (input.vin) {
    const parts = typeCodeFromVin(input.vin);
    if (!parts) {
      throw new Error(
        `${input.vin} is not a 17-character Fiat-group VIN; pass --model and --chassis instead`,
      );
    }
    chassis = parts.chassis;
    models = modelsForTypeCode(db, parts.typeCode);
    if (models.length === 0) {
      throw new Error(
        `VIN type code ${parts.typeCode} is not in this release's VIN table, ` +
          `so its model is unknown`,
      );
    }
  } else {
    if (!input.model || !input.chassis) {
      throw new Error("pass either a VIN, or both --model and --chassis");
    }
    models = [input.model];
    chassis = input.chassis.replace(/^0+/, "");
  }

  const result: VehicleLookup = { models, chassis };

  if (disc.files.chassis) {
    const file = await fs.open(disc.files.chassis);
    try {
      const table = await F3Table.open(file.source());
      const width = table.header.primaryKey.at(-1)?.length ?? 8;
      for (const model of models) {
        const rows = await table.lookup(model + chassisFromVin(chassis, width));
        if (rows.length) {
          result.chassisRecord = rows[0];
          result.model = model;
          break;
        }
      }
      if (!result.chassisRecord) {
        result.highest = [];
        const padded = chassisFromVin(chassis, width);
        for (const model of models) {
          const scoped = await table.highestKeyUnder(model + padded.slice(0, 1));
          const key = scoped ?? (await table.highestKeyUnder(model));
          if (!key) continue;
          const highest = key.slice(model.length).trim();
          result.highest.push({
            model,
            chassis: highest,
            // Only a claim when the two are in the same series, which is what
            // scoping the search to a shared leading character buys.
            beyond: scoped !== undefined && padded > highest,
          });
        }
      }
    } finally {
      file.close();
    }
  }

  // `SP.RT` keys on a 7-digit chassis where `SP.CH` uses 8, so the same
  // vehicle needs a differently padded key in each.
  if (disc.files.build) {
    const file = await fs.open(disc.files.build);
    try {
      const table = await F3Table.open(file.source());
      const width = table.header.keyLength - 3;
      for (const model of result.model ? [result.model] : models) {
        const rows = await table.lookup(model + chassisFromVin(chassis, width));
        if (rows.length) {
          result.buildRecord = rows[0];
          result.model ??= model;
          break;
        }
      }
    } finally {
      file.close();
    }
  }

  return result;
}
