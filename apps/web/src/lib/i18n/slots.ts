/**
 * Markup inside a translated sentence.
 *
 * Plain functions in a plain module, deliberately: they are pure, and a
 * `.svelte.ts` module cannot be imported by a test without the Svelte compiler
 * in the way.
 *
 * Some sentences need a fragment of themselves styled — a catalogue name in
 * mono, a filename as code, a part number. The obvious alternative is to hand
 * the translator three pieces and hope they reassemble in their language's word
 * order, which for Polish they will not: `read from {source}` becomes
 * `odczytano z: {source}` and the styled piece moves.
 *
 * So the sentence stays whole in the JSON with its `{{placeholders}}`, and the
 * value passed for a styled placeholder is `slot(name)` — a sentinel that
 * survives interpolation and that `segments` then splits on. The sentinel is a
 * NUL, which cannot occur in a translation or in catalogue text.
 */
const MARK = "\u0000";

export function slot(name: string): string {
  return `${MARK}${name}${MARK}`;
}

export function segments(text: string): Array<{ text: string } | { slot: string }> {
  const out: Array<{ text: string } | { slot: string }> = [];
  // Parity decides: odd pieces sat between a pair of sentinels. Empty pieces
  // are skipped without consuming an index, so a slot at either end still
  // lands on the right side of the parity.
  for (const [at, piece] of text.split(MARK).entries()) {
    if (piece === "") continue;
    out.push(at % 2 === 1 ? { slot: piece } : { text: piece });
  }
  return out;
}
