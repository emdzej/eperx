import { bin, type BinEntry } from "./bin.svelte";
import { normalise, notes, type PartNote } from "./notes.svelte";

/**
 * Everything the user typed, in one file.
 *
 * masax exports notes as JSON and the bin as CSV, which covers the two things
 * worth keeping. This is a superset: one backup carrying the bin, the notes,
 * the interface language, the theme and where you were, because the reason
 * notes are worth backing up applies to all of it — **none of it can be
 * re-derived from a disc.** Everything else in eperx can.
 *
 * Deliberately *not* included: the data source. A saved folder is a
 * `FileSystemDirectoryHandle` in IndexedDB, which cannot be serialised and
 * would be meaningless on another machine anyway; and a hosted URL restored
 * silently from a file someone else wrote is not a thing this should do. The
 * `?data=` parameter is the way to hand a source to a colleague.
 *
 * A notes-only file still imports, because that is what a colleague will send
 * — `normalise` accepts both this shape and a bare `{ "55189942": "text" }`
 * map.
 */

export const BACKUP_KIND = "eperx.backup";
export const BACKUP_VERSION = 1;

export interface Backup {
  kind: typeof BACKUP_KIND;
  version: number;
  /** ISO 8601, stamped by the caller so this module holds no clock. */
  exportedAt: string;
  bin?: BinEntry[];
  notes?: Record<string, PartNote>;
  /** Small preferences, restored only when present. */
  preferences?: {
    locale?: string;
    theme?: string;
    /** Where the user was: the same shape `selection.ts` writes. */
    selection?: unknown;
  };
}

/** What an import actually did, so the panel can say rather than imply. */
export interface ImportReport {
  notes: { added: number; updated: number; kept: number };
  bin: number;
  preferences: boolean;
}

/**
 * Read a preference back out of `localStorage`.
 *
 * The backup goes through storage rather than through the stores themselves:
 * `theme` and `locale` each own their key and their parsing, and a second
 * reader of the same value is a second thing to keep in step.
 */
function readRaw(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked. The import still applied whatever it could.
  }
}

export function buildBackup(exportedAt: string): Backup {
  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt,
    bin: bin.entries,
    notes: notes.snapshot(),
    preferences: {
      locale: readRaw("eperx.locale"),
      theme: readRaw("eperx.theme"),
      selection: safeParse(readRaw("eperx.selection")),
    },
  };
}

function safeParse(raw: string | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function toJson(backup: Backup): string {
  return JSON.stringify(backup, null, 2);
}

/**
 * Apply a backup, taking whatever of it makes sense.
 *
 * Notes are **merged**, newest wins, so importing a colleague's file does not
 * discard your own. The bin is **replaced**, because a pick list is a single
 * document rather than an accumulation — merging two would silently double
 * quantities, which on a parts order is the expensive mistake.
 *
 * Anything unreadable is skipped rather than failing the whole import: a
 * partial restore beats none, and the report says what happened.
 */
export function applyBackup(input: unknown): ImportReport {
  const report: ImportReport = {
    notes: { added: 0, updated: 0, kept: 0 },
    bin: 0,
    preferences: false,
  };
  if (typeof input !== "object" || input === null) return report;
  const backup = input as Partial<Backup>;

  // `normalise` reads this file's shape *and* a bare part→text map, which is
  // what makes a hand-written or notes-only file work.
  const incoming = normalise(backup.notes ?? input);
  if (Object.keys(incoming).length) report.notes = notes.merge(incoming);

  if (Array.isArray(backup.bin)) {
    const entries = backup.bin.filter(
      (e): e is BinEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as BinEntry).partNumber === "string" &&
        (e as BinEntry).partNumber !== "" &&
        Number.isFinite((e as BinEntry).quantity),
    );
    if (entries.length) {
      bin.replace(entries);
      report.bin = entries.length;
    }
  }

  const preferences = backup.preferences;
  if (preferences && typeof preferences === "object") {
    // Written to storage rather than applied live: each store reads its own
    // key on construction, so a reload is what puts these into effect — and
    // saying so is better than half-applying them now.
    if (typeof preferences.locale === "string") writeRaw("eperx.locale", preferences.locale);
    if (typeof preferences.theme === "string") writeRaw("eperx.theme", preferences.theme);
    if (preferences.selection !== undefined) {
      writeRaw("eperx.selection", JSON.stringify(preferences.selection));
    }
    report.preferences =
      typeof preferences.locale === "string" ||
      typeof preferences.theme === "string" ||
      preferences.selection !== undefined;
  }

  return report;
}
