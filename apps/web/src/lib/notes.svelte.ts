/**
 * Notes on part numbers.
 *
 * `55189942` is `PLUG` in the catalogue, which does not tell you it is the
 * M14 one with the copper washer. That knowledge comes from having had the
 * part in your hand, the disc has nowhere to put it, and it is exactly what
 * you want the next time the number comes up.
 *
 * Keyed by part number rather than by callout reference, and deliberately not
 * scoped to a catalogue or a drawing: a bolt is the same bolt on every drawing
 * it appears on, and a note that only showed up where it was written would be
 * worth much less.
 *
 * These are the user's own words, and the only copy of them is this browser's
 * `localStorage` — which a cleared cache takes with it. Hence import and
 * export: the notes are worth backing up in a way nothing else in eperx is,
 * because everything else can be re-derived from a disc.
 *
 * The shapes it will accept live in `notes-format.ts`, a plain module, so a
 * test can reach them without the Svelte compiler in the way.
 */
import { clean, normalise, NOTE_LIMIT, type PartNote } from "./notes-format";

export { normalise, NOTE_LIMIT, type PartNote };

const KEY = "eperx.notes";

function stored(): Record<string, PartNote> {
  try {
    const raw = localStorage.getItem(KEY);
    // Through `normalise` rather than trusted: this is user-editable storage,
    // and it reads the same shapes an imported file may carry.
    return raw ? normalise(JSON.parse(raw)) : {};
  } catch {
    // Malformed, or storage blocked. Starting empty beats refusing to start.
    return {};
  }
}

class Notes {
  private map = $state<Record<string, PartNote>>({});

  readonly count = $derived(Object.keys(this.map).length);
  /** Newest first, which is the order someone reviewing them wants. */
  readonly all = $derived(
    Object.values(this.map).sort(
      (a, b) => b.updated - a.updated || a.partNumber.localeCompare(b.partNumber),
    ),
  );

  constructor() {
    this.map = stored();
  }

  get(partNumber: string | undefined): string | undefined {
    return partNumber ? this.map[partNumber]?.text : undefined;
  }

  /** Write a note, or remove it when the text is emptied. */
  set(partNumber: string, text: string, now = Date.now()): void {
    const value = clean(text);
    if (value === "") {
      this.remove(partNumber);
      return;
    }
    this.map = { ...this.map, [partNumber]: { partNumber, text: value, updated: now } };
    this.save();
  }

  remove(partNumber: string): void {
    if (!(partNumber in this.map)) return;
    const next = { ...this.map };
    delete next[partNumber];
    this.map = next;
    this.save();
  }

  clear(): void {
    this.map = {};
    this.save();
  }

  /**
   * Merge an imported set in, newest wins.
   *
   * Merge rather than replace: importing a colleague's notes should not
   * discard your own. Where both have a note for one number the later
   * `updated` wins, and an imported note with no timestamp loses to anything
   * local — it cannot be shown to be newer, so it is not assumed to be.
   */
  merge(incoming: Record<string, PartNote>): { added: number; updated: number; kept: number } {
    let added = 0;
    let changed = 0;
    let kept = 0;
    const next = { ...this.map };
    for (const [partNumber, note] of Object.entries(incoming)) {
      const mine = next[partNumber];
      if (!mine) {
        next[partNumber] = note;
        added++;
      } else if (note.updated > mine.updated) {
        next[partNumber] = note;
        changed++;
      } else {
        kept++;
      }
    }
    this.map = next;
    this.save();
    return { added, updated: changed, kept };
  }

  /** The notes alone, for the backup payload. */
  snapshot(): Record<string, PartNote> {
    return { ...this.map };
  }

  /** The export payload: self-describing, so a file found later explains itself. */
  toJson(): string {
    return JSON.stringify({ kind: "eperx.notes", version: 1, notes: this.map }, null, 2);
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.map));
    } catch {
      // Storage full or blocked: the notes still work for this session.
    }
  }
}

export const notes = new Notes();
