import {
  evaluatePattern,
  parsePattern,
  PatternError,
  specificationFrom,
  Truth,
  vocabularyKey,
  type Pattern,
  type Specification,
} from "@eperx/catalogue";
import type { Database } from "./sqlite.js";

/**
 * Check the applicability grammar against the disc's own data.
 *
 * There is no external answer key for "which parts fit which car", so the
 * grammar is checked against the data's own internal consistency instead.
 *
 * **Reachability.** `MVS` lists every sold version of a vehicle, and each
 * version's pattern is a specification of it. A drawing whose pattern no
 * version satisfies is a diagram nobody could ever be shown — dead data. A
 * few are plausible; many would mean the evaluator is wrong. This is the sound
 * check of the two, and a rise in the unreachable count is a regression.
 *
 * **Alternatives.** Where one callout offers several parts each carrying a
 * different `TBD_VAL_FORMULA`, how often does exactly one apply to a given
 * version? This is reported as a characterisation, *not* as a check, because
 * strict exclusivity turns out not to be a property of the data:
 * `10002-010` callout 1 offers ten alternatives including `CC1.3+LL1` and
 * `CC1.3+TT4X4`, and a 1.3 with that trim and four-wheel drive satisfies
 * both.
 *
 * What resolves it is almost certainly order: **84,897 of the 84,902
 * multi-formula callouts give every row a distinct `TBD_SEQ`**, so the
 * sequence looks like a priority and the first matching alternative wins.
 * That reading is inferred from the shape of the data, not proven, and it is
 * on the undecoded list until something confirms it.
 *
 * Several rows under one callout with *no* formula are a different thing
 * entirely — parts fitted together, not a choice. 104,752 callouts look like
 * that, and they are skipped here.
 */

export interface ApplicabilityReport {
  catalogues: number;
  /** `MVS` rows read, and how many gave a usable specification. */
  versions: number;
  versionsParsed: number;
  /** `MVS` patterns whose top level was not a plain conjunction. */
  versionsWithDisjunction: number;

  drawings: number;
  drawingsParsed: number;
  /** Drawings reachable by at least one version. */
  reachable: number;
  /** Drawings no version satisfies, but some version leaves undecided. */
  onlyUndecided: number;
  /** Drawings every version definitely excludes. */
  unreachable: number;

  /** Callouts offering more than one alternative part. */
  choices: number;
  /** Choices where every applicable version picks exactly one alternative. */
  choicesSingle: number;
  /** Choices where some version matches two or more — resolved by TBD_SEQ. */
  choicesMultiple: number;
  /** Choices no version decides either way. */
  choicesUndecided: number;

  /** Every pattern that failed to parse, across all four columns. */
  parseFailures: number;
  /** A sample of them, for the operator to look at. */
  parseErrors: { pattern: string; message: string }[];
}

interface Version {
  spec: Specification;
}

/** Every `(VMK_TYPE, VMK_COD)` pair a catalogue knows, for tokenisation. */
function loadVocabulary(db: Database, catalogue: string): Set<string> {
  const vocabulary = new Set<string>();
  // `CAT_VAL` is not keyed by language, so it survives an import filtered to
  // one language; `VMK_DSC` is included because it carries pairs `CAT_VAL`
  // does not, and the two agree on count for a single language.
  for (const sql of [
    "SELECT VMK_TYPE t, VMK_COD c FROM CAT_VAL WHERE CAT_COD = ?",
    "SELECT DISTINCT VMK_TYPE t, VMK_COD c FROM VMK_DSC WHERE CAT_COD = ?",
  ]) {
    for (const row of db.prepare(sql).all(catalogue) as { t: string; c: string | null }[]) {
      vocabulary.add(vocabularyKey(row.t, row.c ?? ""));
    }
  }
  return vocabulary;
}

export function checkApplicability(
  db: Database,
  options: { catalogue?: string; maxErrors?: number } = {},
): ApplicabilityReport {
  const report: ApplicabilityReport = {
    catalogues: 0,
    versions: 0,
    versionsParsed: 0,
    versionsWithDisjunction: 0,
    drawings: 0,
    drawingsParsed: 0,
    reachable: 0,
    onlyUndecided: 0,
    unreachable: 0,
    choices: 0,
    choicesSingle: 0,
    choicesMultiple: 0,
    choicesUndecided: 0,
    parseFailures: 0,
    parseErrors: [],
  };
  const maxErrors = options.maxErrors ?? 20;

  const note = (pattern: string, error: unknown): void => {
    report.parseFailures++;
    if (report.parseErrors.length < maxErrors) {
      report.parseErrors.push({
        pattern: pattern.length > 90 ? `${pattern.slice(0, 90)}…` : pattern,
        message: error instanceof PatternError ? error.message.split(" at ")[0]! : String(error),
      });
    }
  };

  const catalogues = options.catalogue
    ? [options.catalogue]
    : (
        db.prepare("SELECT CAT_COD c FROM CATALOGUES ORDER BY CAT_COD").all() as { c: string }[]
      ).map((r) => r.c);

  for (const catalogue of catalogues) {
    report.catalogues++;
    loadVocabulary(db, catalogue); // resolved for its own sake; evaluation is by token

    const versions: Version[] = [];
    const mvs = db
      .prepare(
        "SELECT PATTERN p FROM MVS WHERE CAT_COD = ? AND PATTERN IS NOT NULL AND PATTERN<>''",
      )
      .all(catalogue) as { p: string }[];
    report.versions += mvs.length;
    for (const row of mvs) {
      try {
        const { present, absent, ignored } = specificationFrom(parsePattern(row.p));
        if (ignored) report.versionsWithDisjunction++;
        versions.push({ spec: { present, absent } });
        report.versionsParsed++;
      } catch (error) {
        note(row.p, error);
      }
    }
    if (versions.length === 0) continue;

    const drawings = db
      .prepare(
        `SELECT TABLE_COD t, VARIANTE v, REVISIONE r, PATTERN p
         FROM DRAWINGS WHERE CAT_COD = ? AND PATTERN IS NOT NULL AND PATTERN <> ''`,
      )
      .all(catalogue) as { t: string; v: number; r: number; p: string }[];

    for (const drawing of drawings) {
      report.drawings++;
      let parsed: Pattern;
      try {
        parsed = parsePattern(drawing.p);
        report.drawingsParsed++;
      } catch (error) {
        note(drawing.p, error);
        continue;
      }

      let best: Truth = Truth.False;
      const fitting: Specification[] = [];
      for (const version of versions) {
        const value = evaluatePattern(parsed, version.spec);
        if (value === Truth.True) {
          best = Truth.True;
          fitting.push(version.spec);
        } else if (value === Truth.Unknown && best === Truth.False) {
          best = Truth.Unknown;
        }
      }
      if (best === Truth.True) report.reachable++;
      else if (best === Truth.Unknown) report.onlyUndecided++;
      else report.unreachable++;

      // Alternatives are only examined against versions that actually see
      // this drawing — a version the drawing does not apply to says nothing
      // about how its alternatives behave.
      if (fitting.length === 0) continue;
      const callouts = db
        .prepare(
          `SELECT TBD_RIF ref, TBD_VAL_FORMULA f
           FROM TBDATA
           WHERE CAT_COD = ? AND TABLE_COD = ? AND VARIANTE = ? AND REVISIONE = ?
             AND TBD_VAL_FORMULA IS NOT NULL AND TBD_VAL_FORMULA <> ''`,
        )
        .all(catalogue, drawing.t, drawing.v, drawing.r) as { ref: number; f: string }[];

      const byRef = new Map<number, Set<string>>();
      for (const row of callouts) {
        const set = byRef.get(row.ref) ?? new Set<string>();
        set.add(row.f);
        byRef.set(row.ref, set);
      }

      for (const formulas of byRef.values()) {
        if (formulas.size < 2) continue;
        report.choices++;
        const parsedFormulas: Pattern[] = [];
        let ok = true;
        for (const formula of formulas) {
          try {
            parsedFormulas.push(parsePattern(formula));
          } catch (error) {
            note(formula, error);
            ok = false;
          }
        }
        if (!ok) continue;

        let sawExactlyOne = false;
        let sawOverlap = false;
        for (const spec of fitting) {
          const trueCount = parsedFormulas.filter(
            (f) => evaluatePattern(f, spec) === Truth.True,
          ).length;
          if (trueCount > 1) sawOverlap = true;
          else if (trueCount === 1) sawExactlyOne = true;
        }
        if (sawOverlap) report.choicesMultiple++;
        else if (sawExactlyOne) report.choicesSingle++;
        else report.choicesUndecided++;
      }
    }
  }

  return report;
}
