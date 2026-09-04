/**
 * Where you were, so a reload does not start you at the top of a 223-entry
 * catalogue list again.
 *
 * Only the four choices above the group tree are kept — marque, model group,
 * catalogue, vehicle. Deliberately not the group, subgroup or drawing: those
 * are what you move around in, and restoring a specific diagram would put the
 * app in a state the user did not ask to return to. Walking back down two
 * short lists is cheap; re-finding a catalogue among 223 is not.
 *
 * Codes rather than objects, because a tree can be re-imported or a different
 * release mounted, and a stale row rendered from `localStorage` would be a
 * selection that does not exist. Every code is looked up in freshly loaded
 * data on restore, and one that no longer resolves simply stops the restore
 * there.
 *
 * Separate from `settings.ts`, which remembers *where the data comes from*.
 * That has to survive a change of catalogue; this does not.
 */

const KEY = "eperx.selection";

/**
 * A vehicle, in whichever of the two ways it was chosen.
 *
 * A VIN is stored as the VIN, not as the specification it resolved to: the
 * build record is the disc's answer and re-deriving it costs about 20 kB,
 * whereas a stored specification would go stale against a re-import without
 * any way to notice.
 */
export type SavedVehicle =
  | {
      kind: "version";
      /** `SINCOM`, when the version has one. */
      sincom?: string;
      /** The `MVS` key, for versions with no `SINCOM` to search by. */
      model: string;
      version: string;
      series: string;
    }
  | { kind: "vin"; vin: string };

export interface SavedSelection {
  make?: string;
  modelGroup?: string;
  catalogue?: string;
  vehicle?: SavedVehicle;
  /** Whether definite non-fits were being hidden. */
  hideUnfit?: boolean;
}

export function readSelection(): SavedSelection | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as SavedSelection;
    // Anything could be in `localStorage`, including a shape from an older
    // build, so the one field the restore depends on is checked.
    return typeof parsed === "object" && parsed ? parsed : undefined;
  } catch {
    // Malformed, or storage refused. Starting fresh is the right answer.
    return undefined;
  }
}

export function writeSelection(selection: SavedSelection): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(selection));
  } catch {
    // Private browsing, or the quota. Not remembering is not a failure worth
    // interrupting anyone over.
  }
}

export function clearSelection(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // As above.
  }
}
