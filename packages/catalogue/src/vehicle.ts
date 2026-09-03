import type { Catalogue } from "./rows.js";
import { parsePattern, specificationFrom, vocabularyKey, type Specification } from "./pattern.js";

/**
 * Vehicle versions, and the criteria vocabulary needed to read a pattern.
 *
 * A catalogue covers every version of a model that was sold, and which parts
 * apply depends on *which* version. `MVS` is that list — 36,332 rows over 223
 * catalogues, averaging 163 each but reaching 10,436 for the widest — and each
 * row's `PATTERN` is a specification of one version.
 */

/** One sold version of a vehicle. */
export interface Version {
  /** `SINCOM` — the 12-character version code, e.g. `319162001000`. */
  sincom: string | null;
  /** `MVS_DSC`, e.g. `BN. 1.3JTD.L4-TREKKING-4X2 5P.GS.5M-I/CE`. */
  description: string | null;
  model: string;
  version: string;
  series: string;
  /** `MVS_ENGINE_TYPE`, e.g. `199A3000`. */
  engine: string | null;
  doors: number | null;
  /** The version's own `PATTERN`, from which its specification is read. */
  pattern: string | null;
}

/**
 * The versions in a catalogue.
 *
 * `search` matches the description or the SINCOM code, because with up to
 * 10,436 versions in one catalogue a flat list is not usable.
 */
export async function versions(
  { rows }: Catalogue,
  catalogue: string,
  options: { search?: string; limit?: number } = {},
): Promise<Version[]> {
  const search = options.search?.trim().toUpperCase();
  const like = search ? `%${search}%` : null;
  return rows.all<Version>(
    `
    SELECT
      SINCOM          AS sincom,
      MVS_DSC         AS description,
      MOD_COD         AS model,
      MVS_VERSION     AS version,
      MVS_SERIE       AS series,
      MVS_ENGINE_TYPE AS engine,
      MVS_DOORS_NUM   AS doors,
      PATTERN         AS pattern
    FROM MVS
    WHERE CAT_COD = ?
      AND (? IS NULL OR UPPER(MVS_DSC) LIKE ? OR UPPER(SINCOM) LIKE ?)
    ORDER BY MVS_DSC, SINCOM
    LIMIT ?
  `,
    [catalogue, like, like, like, options.limit ?? 200],
  );
}

/**
 * The `(VMK_TYPE, VMK_COD)` pairs a catalogue knows, keyed for tokenisation.
 *
 * Both tables are read: `CAT_VAL` is not keyed by language, so it survives an
 * import filtered to one language, and `VMK_DSC` is where the descriptions
 * live. A tokeniser that misses a pair silently mis-splits a criterion, so
 * this errs towards a larger vocabulary.
 */
export async function criteriaVocabulary(
  { rows }: Catalogue,
  catalogue: string,
): Promise<Set<string>> {
  const found = await rows.all<{ type: string; code: string | null }>(
    `
    SELECT VMK_TYPE AS type, VMK_COD AS code FROM CAT_VAL WHERE CAT_COD = ?
    UNION
    SELECT VMK_TYPE AS type, VMK_COD AS code FROM VMK_DSC WHERE CAT_COD = ?
  `,
    [catalogue, catalogue],
  );
  return new Set(found.map((row) => vocabularyKey(row.type, row.code ?? "")));
}

/** What a criterion means, in the reader's language. */
export interface CriterionMeaning {
  type: string;
  code: string;
  /** `CARAT_DSC.VMK_DSC`, e.g. `FUEL`. */
  typeName: string | null;
  /** `VMK_DSC.VMK_DSC`, e.g. `PETROL`. */
  codeName: string | null;
}

/**
 * Descriptions for a catalogue's criteria, keyed by the token as a pattern
 * writes it.
 *
 * This is what turns `CC1.2+(CMBBZ,CMBBG)` into something a person can check:
 * *displacement 8V.LE 69HP, and fuel petrol or fuel gasoline/LPG*. Showing the
 * raw expression alone asks the reader to trust it; showing what it says lets
 * them disagree.
 */
export async function criteriaMeanings(
  { rows, language }: Catalogue,
  catalogue: string,
): Promise<Map<string, CriterionMeaning>> {
  const found = await rows.all<CriterionMeaning>(
    `
    SELECT
      v.VMK_TYPE AS type,
      v.VMK_COD  AS code,
      c.VMK_DSC  AS typeName,
      v.VMK_DSC  AS codeName
    FROM VMK_DSC v
    LEFT JOIN CARAT_DSC c
      ON c.CAT_COD = v.CAT_COD AND c.VMK_TYPE = v.VMK_TYPE AND c.LNG_COD = v.LNG_COD
    WHERE v.CAT_COD = ? AND v.LNG_COD = ?
  `,
    [catalogue, language],
  );
  const byToken = new Map<string, CriterionMeaning>();
  for (const meaning of found) {
    byToken.set(`${meaning.type}${meaning.code ?? ""}`, meaning);
  }
  return byToken;
}

/**
 * Read a version's specification from its pattern.
 *
 * Returns `undefined` when the version has no pattern or its pattern does not
 * parse — a version whose specification is unknown must not silently become an
 * empty one, because an empty specification makes every criterion `Unknown`
 * and every drawing look possible.
 */
export function specificationOf(version: Version): Specification | undefined {
  if (!version.pattern) return undefined;
  try {
    const { present, absent } = specificationFrom(parsePattern(version.pattern));
    return { present, absent };
  } catch {
    return undefined;
  }
}
