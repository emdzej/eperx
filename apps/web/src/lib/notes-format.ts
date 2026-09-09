/**
 * Reading notes from anywhere.
 *
 * A plain module for the same reason as `csv.ts`: this is the part with the
 * edge cases, and a test should be able to import it without the Svelte
 * compiler in the way.
 */

export interface PartNote {
  partNumber: string;
  text: string;
  /** Milliseconds, stamped on write. Carried through export so a merge can pick. */
  updated: number;
}

/** Long enough for a real description, short enough not to become a document. */
export const NOTE_LIMIT = 500;

export const clean = (text: string): string => text.trim().slice(0, NOTE_LIMIT);

/**
 * Accept anything shaped like notes, from storage or from an imported file.
 *
 * Two shapes are read: the object eperx writes, and a plain
 * `{ "55189942": "text" }` map — because that is what someone will hand-write
 * or produce from a spreadsheet, and refusing it would be pedantry. Anything
 * else in the file is dropped rather than failing the whole import: a partial
 * restore beats none.
 */
export function normalise(input: unknown): Record<string, PartNote> {
  if (typeof input !== "object" || input === null) return {};
  const source =
    "notes" in input && typeof (input as { notes: unknown }).notes === "object"
      ? ((input as { notes: Record<string, unknown> }).notes ?? {})
      : (input as Record<string, unknown>);

  const out: Record<string, PartNote> = {};
  for (const [partNumber, value] of Object.entries(source)) {
    if (!partNumber) continue;
    const text = typeof value === "string" ? value : (value as PartNote)?.text;
    if (typeof text !== "string" || clean(text) === "") continue;
    const updated =
      typeof value === "object" && Number.isFinite((value as PartNote)?.updated)
        ? (value as PartNote).updated
        : 0;
    out[partNumber] = { partNumber, text: clean(text), updated };
  }
  return out;
}
