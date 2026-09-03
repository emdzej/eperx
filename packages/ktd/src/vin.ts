/**
 * Reading a Fiat-group VIN well enough to find the vehicle.
 *
 * The F3 files are keyed by **model plus chassis number**, not by VIN, and
 * `SP.CH`'s VIN column is empty on older records. But a Fiat-group VIN
 * contains both parts, which is why `SP.DB` carries a `VIN` table at all:
 *
 * ```
 * Z L A 8 4 3 0 0 0 0 3 0 8 4 5 1 5
 * └─┬─┘ └─┬─┘ └───────┬─────────┘
 *  WMI   type code    chassis number, right-aligned
 * ```
 *
 * `VIN(VIN_COD, MOD_COD)` maps the three-character type code to a model —
 * `843` to `101` — and the key is then that model followed by the chassis
 * number. Verified against a real record: `ZLA84300003084515` gives `843` and
 * `3084515`, and `SP.RT` holds `MOD_TEL = 1013084515` with `TELAIO = 3084515`.
 *
 * A type code can name several models (`312` names four), so a lookup tries
 * each and keeps what the store actually has.
 *
 * **This is not a general VIN decoder.** It carries no check-digit
 * validation, no year or plant decoding, and no knowledge of any
 * manufacturer's scheme but this one. It extracts the two fields ePER's own
 * index is built on, and nothing else.
 */

export interface VinParts {
  /** Characters 4–6: the `VIN_COD` in `SP.DB`'s `VIN` table. */
  typeCode: string;
  /** The trailing digits, with leading zeroes stripped. */
  chassis: string;
  /** The World Manufacturer Identifier, characters 1–3. Informational. */
  wmi: string;
}

/** Fiat-group VINs are 17 characters. Anything shorter is not one. */
const VIN_LENGTH = 17;

/**
 * Split a VIN into the pieces the F3 index needs.
 *
 * Returns `undefined` rather than guessing at a string that is not a VIN of
 * this shape — a wrong split would look up a real chassis belonging to a
 * different car.
 */
export function typeCodeFromVin(vin: string): VinParts | undefined {
  const clean = vin.trim().toUpperCase();
  if (clean.length !== VIN_LENGTH) return undefined;
  if (!/^[A-Z0-9]+$/.test(clean)) return undefined;

  const typeCode = clean.slice(3, 6);
  // The chassis number is right-aligned in the remainder and zero-padded.
  const chassis = clean.slice(6).replace(/^0+/, "");
  if (!typeCode || !chassis) return undefined;

  return { wmi: clean.slice(0, 3), typeCode, chassis };
}

/**
 * The chassis number as an F3 key component, padded to `width`.
 *
 * `SP.CH` keys on 8 digits and `SP.RT` on 7 — openPER pads to those widths at
 * each call site, and the widths are also what the two headers declare.
 * A chassis longer than `width` is truncated from the left, which is what
 * openPER does for `SP.RT` and is why a 8-digit chassis still finds its
 * 7-digit build record.
 */
export function chassisFromVin(chassis: string, width: number): string {
  return chassis.length > width
    ? chassis.slice(chassis.length - width)
    : chassis.padStart(width, "0");
}
