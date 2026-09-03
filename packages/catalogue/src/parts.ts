import type { Catalogue } from "./rows.js";

/** A part, as the master table holds it. */
export interface Part {
  code: string;
  name: string | null;
  family: string | null;
  /** `PRT_MIN_QTY` — the smallest orderable quantity. */
  minimumQuantity: number | null;
  /** Grams, per `PRT_WEIGHT`. Unverified. */
  weight: number | null;
  unit: string | null;
}

/** One place a part appears. */
export interface Usage {
  catalogue: string;
  catalogueName: string;
  group: number;
  subgroup: number;
  subSubgroup: number;
  table: string;
  variant: number;
  revision: number;
  reference: number;
}

/** A superseded or superseding part number. */
export interface Replacement {
  from: string;
  to: string;
  date: string | null;
  /** `RPL_MOLT` / `RPL_DIV` — quantity multiplier and divisor. */
  multiply: number | null;
  divide: number | null;
}

/**
 * The half-open key range that a prefix covers, for a BINARY collation.
 *
 * Used instead of `LIKE 'prefix%'`, which **cannot use an index**: SQLite's
 * default `case_sensitive_like` is off, so `LIKE` is case-insensitive and no
 * BINARY index applies. The planner reports `SCAN p` and reads all 1,415,102
 * rows of `PARTS` — over HTTP that measured **786 requests and 126 MB** for
 * one part-number search. The range form plans as
 * `SEARCH p USING COVERING INDEX ix_PARTS_PRT_COD` instead.
 *
 * Incrementing the final character is exact here because every part number on
 * the disc is ASCII: 0 of 1,415,102 contain a lowercase letter, and the 11
 * that are not alphanumeric use `"`, `|` and `>`. Nothing is near the top of
 * the code-point range, so there is no carry to handle.
 */
export function prefixRange(prefix: string): [string, string] {
  const last = prefix.charCodeAt(prefix.length - 1);
  if (last >= 0xffff) {
    throw new Error(`cannot bound a prefix ending at U+${last.toString(16)}`);
  }
  return [prefix, prefix.slice(0, -1) + String.fromCharCode(last + 1)];
}

/**
 * Find a part by number.
 *
 * Prefix match, because part numbers are quoted with and without leading
 * zeroes and users type what is stamped on the part. The query is upper-cased
 * because the stored numbers are — see {@link prefixRange}.
 */
export async function searchParts(
  { rows, language }: Catalogue,
  query: string,
  limit = 50,
): Promise<Part[]> {
  const trimmed = query.trim().toUpperCase();
  if (!trimmed) return [];
  const [from, to] = prefixRange(trimmed);
  return rows.all<Part>(
    `
    SELECT
      p.PRT_COD      AS code,
      cd.CDS_DSC     AS name,
      fd.FAM_DSC     AS family,
      p.PRT_MIN_QTY  AS minimumQuantity,
      p.PRT_WEIGHT   AS weight,
      um.UM_DSC      AS unit
    FROM PARTS p
    LEFT JOIN CODES_DSC  cd ON cd.CDS_COD = p.CDS_COD     AND cd.LNG_COD = ?
    LEFT JOIN FAM_DSC    fd ON fd.FAM_COD = p.PRT_FAM_COD AND fd.LNG_COD = ?
    LEFT JOIN UN_OF_MEAS um ON um.UM_COD  = p.UM_COD
    WHERE p.PRT_COD >= ? AND p.PRT_COD < ?
    ORDER BY LENGTH(p.PRT_COD), p.PRT_COD
    LIMIT ?
  `,
    [language, language, from, to, limit],
  );
}

/**
 * Every drawing that shows a part.
 *
 * This is the query that makes a parts catalogue useful in reverse: you have a
 * number off an old part and want to know what it fits.
 */
export async function whereUsed({ rows }: Catalogue, part: string, limit = 200): Promise<Usage[]> {
  return rows.all<Usage>(
    `
    SELECT DISTINCT
      t.CAT_COD   AS catalogue,
      c.CAT_DSC   AS catalogueName,
      t.GRP_COD   AS "group",
      t.SGRP_COD  AS subgroup,
      t.SGS_COD   AS subSubgroup,
      t.TABLE_COD AS "table",
      t.VARIANTE  AS variant,
      t.REVISIONE AS revision,
      t.TBD_RIF   AS reference
    FROM TBDATA t
    JOIN CATALOGUES c ON c.CAT_COD = t.CAT_COD
    WHERE t.PRT_COD = ?
    ORDER BY c.CAT_SORT_KEY, t.GRP_COD, t.SGRP_COD
    LIMIT ?
  `,
    [part, limit],
  );
}

/**
 * Supersessions, in both directions.
 *
 * `RPLNT` is directional (`PRT_COD` → `RPL_COD`), and a user holding an old
 * number wants the forward chain while a user holding a new one wants to know
 * what it replaces. Both are returned and labelled by the `from`/`to` columns.
 */
export async function replacements({ rows }: Catalogue, part: string): Promise<Replacement[]> {
  return rows.all<Replacement>(
    `
    SELECT PRT_COD AS "from", RPL_COD AS "to", RPL_DATE AS date,
           RPL_MOLT AS multiply, RPL_DIV AS divide
    FROM RPLNT WHERE PRT_COD = ?
    UNION
    SELECT PRT_COD AS "from", RPL_COD AS "to", RPL_DATE AS date,
           RPL_MOLT AS multiply, RPL_DIV AS divide
    FROM RPLNT WHERE RPL_COD = ?
    ORDER BY date
  `,
    [part, part],
  );
}
