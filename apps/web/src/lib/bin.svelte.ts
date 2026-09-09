/**
 * The parts bin: what you have decided to order.
 *
 * Persisted, because it is the one piece of state with real work in it. A
 * catalogue is three clicks and a VIN is a few seconds of typing; a bin
 * assembled across a dozen drawings is not, and losing it to a reload would be
 * the worst thing this interface could do.
 *
 * Keyed by **part number**, not by callout reference. The same number appears
 * under different references on different drawings — a bolt is a bolt — and
 * someone adding it twice means "two of them", not "two lines that happen to
 * match". Adding an existing number therefore raises its quantity and keeps
 * the first line's provenance, since that is where the part was actually found.
 */

export interface BinEntry {
  partNumber: string;
  /** `TBD_RIF`, the number printed on the drawing it was added from. */
  reference: string;
  name?: string;
  quantity: number;
  /** Where it came from, for a pick list that has to be acted on. */
  catalogue?: string;
  catalogueName?: string;
  /** `group/subgroup`, as the footer spells it. */
  group?: string;
  /** `TABLE_COD` and its variant. */
  drawing?: string;
  /** The vehicle in the toolbar when it was added, if any. */
  vehicle?: string;
  /** Insertion order, so the list does not reshuffle as quantities change. */
  added: number;
}

/** What a caller hands over; the bin fills in the rest. */
export type BinAddition = Omit<BinEntry, "added">;

const KEY = "eperx.bin";
/** A pick list is tens of lines. A cap stops a stuck loop filling storage. */
const LIMIT = 500;

const clamp = (n: number): number => Math.max(1, Math.min(9999, Math.round(n)));

function stored(): BinEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Validated rather than trusted: this is user-editable storage, and a
    // quantity of `"3"` or `NaN` would reach the CSV and the printed list.
    return parsed
      .filter(
        (e): e is BinEntry =>
          typeof e === "object" &&
          e !== null &&
          typeof (e as BinEntry).partNumber === "string" &&
          (e as BinEntry).partNumber !== "" &&
          Number.isFinite((e as BinEntry).quantity),
      )
      .map((e, at) => ({ ...e, quantity: clamp(e.quantity), added: e.added ?? at }))
      .slice(0, LIMIT);
  } catch {
    // Malformed, or storage blocked. Starting empty beats refusing to start.
    return [];
  }
}

class Bin {
  entries = $state<BinEntry[]>([]);
  open = $state(false);

  /** Lines in the bin. */
  readonly count = $derived(this.entries.length);
  /** Pieces in the bin, which is the number that matters when ordering. */
  readonly pieces = $derived(this.entries.reduce((sum, e) => sum + e.quantity, 0));

  constructor() {
    this.entries = stored();
  }

  has(partNumber: string): boolean {
    return this.entries.some((e) => e.partNumber === partNumber);
  }

  quantityOf(partNumber: string): number {
    return this.entries.find((e) => e.partNumber === partNumber)?.quantity ?? 0;
  }

  /** Add, or raise the quantity of a number already in the bin. */
  add(addition: BinAddition): void {
    const at = this.entries.findIndex((e) => e.partNumber === addition.partNumber);
    if (at >= 0) {
      const existing = this.entries[at]!;
      this.entries[at] = { ...existing, quantity: clamp(existing.quantity + addition.quantity) };
    } else {
      if (this.entries.length >= LIMIT) return;
      const added = this.entries.reduce((max, e) => Math.max(max, e.added), -1) + 1;
      this.entries = [...this.entries, { ...addition, quantity: clamp(addition.quantity), added }];
    }
    this.save();
  }

  setQuantity(partNumber: string, quantity: number): void {
    this.entries = this.entries.map((e) =>
      e.partNumber === partNumber ? { ...e, quantity: clamp(quantity) } : e,
    );
    this.save();
  }

  remove(partNumber: string): void {
    this.entries = this.entries.filter((e) => e.partNumber !== partNumber);
    this.save();
  }

  clear(): void {
    this.entries = [];
    this.save();
  }

  /** Replace the lot — used by an import. */
  replace(entries: BinEntry[]): void {
    this.entries = entries.slice(0, LIMIT).map((e, at) => ({
      ...e,
      quantity: clamp(e.quantity),
      added: e.added ?? at,
    }));
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.entries));
    } catch {
      // Storage full or blocked: the bin still works for this session.
    }
  }
}

export const bin = new Bin();
