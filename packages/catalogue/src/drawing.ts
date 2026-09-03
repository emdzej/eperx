import type { Catalogue } from "./rows.js";

/** A parts diagram: one image, one callout list, one applicability pattern. */
export interface Drawing {
  catalogue: string;
  group: number;
  subgroup: number;
  subSubgroup: number;
  /** `DRW_NUM` — display order among the variants of a table. */
  number: number;
  /** `TABLE_COD` — the identity the callouts join on. */
  table: string;
  /** `VARIANTE` — which variant of that table this is. */
  variant: number;
  revision: number;
  name: string | null;
  /** `IMG_PATH`, as `"BA/BA061CCF….png"`. */
  image: string | null;
  /**
   * The applicability expression. **Not interpreted** — see
   * `docs/data-format.md` §5. Shown to the user verbatim, because a wrong
   * reading of it is worse than no reading.
   */
  pattern: string | null;
  modification: string | null;
}

/** One numbered item on a drawing. */
export interface Callout {
  /** `TBD_RIF` — the number printed on the image. */
  reference: number;
  /** `TBD_SEQ` — several parts can share one reference. */
  sequence: number;
  part: string;
  /** `CODES_DSC.CDS_DSC`, e.g. `PLUG`. The part's actual name. */
  name: string | null;
  /** `DESC_AGG_DSC.DSC`, e.g. `DIAM 14`. Qualifies the name. */
  qualifier: string | null;
  quantity: string | null;
  note: string | null;
  /** `TBD_VAL_FORMULA` — per-callout applicability. Uninterpreted, as above. */
  formula: string | null;
}

/** A resolved byte range in a `.res` shard. */
export interface ImageLocation {
  shard: string;
  offset: number;
  /** Bytes on disc; the compressed length when `method` is 8. */
  length: number;
  /** 0 stored, 8 raw deflate. Drawings are always 0. */
  method: number;
  size: number;
}

export async function drawings(
  { rows, language }: Catalogue,
  catalogue: string,
  group: number,
  subgroup: number,
): Promise<Drawing[]> {
  return rows.all<Drawing>(
    `
    SELECT
      d.CAT_COD       AS catalogue,
      d.GRP_COD       AS "group",
      d.SGRP_COD      AS subgroup,
      d.SGS_COD       AS subSubgroup,
      d.DRW_NUM       AS number,
      d.TABLE_COD     AS "table",
      d.VARIANTE      AS variant,
      d.REVISIONE     AS revision,
      td.DSC          AS name,
      d.IMG_PATH      AS image,
      d.PATTERN       AS pattern,
      d.MODIF         AS modification
    FROM DRAWINGS d
    LEFT JOIN TABLES_DSC td ON td.COD = d.TABLE_DSC_COD AND td.LNG_COD = ?
    WHERE d.CAT_COD = ? AND d.GRP_COD = ? AND d.SGRP_COD = ?
    ORDER BY d.SGS_COD, d.DRW_NUM
  `,
    [language, catalogue, group, subgroup],
  );
}

/**
 * The callouts on a drawing.
 *
 * Joined on `(CAT_COD, TABLE_COD, VARIANTE, REVISIONE)`. **Not on `DRW_NUM`** —
 * both tables have that column, which makes the wrong join look right, and it
 * returns nothing because `TBDATA.DRW_NUM` is 0 on these rows. This is the
 * single most important line in the package.
 */
export async function callouts(
  { rows, language }: Catalogue,
  drawing: Pick<Drawing, "catalogue" | "table" | "variant" | "revision">,
): Promise<Callout[]> {
  return rows.all<Callout>(
    `
    SELECT
      t.TBD_RIF         AS reference,
      t.TBD_SEQ         AS sequence,
      t.PRT_COD         AS part,
      cd.CDS_DSC        AS name,
      ag.DSC            AS qualifier,
      t.TBD_QTY         AS quantity,
      nt.NTS_DSC        AS note,
      t.TBD_VAL_FORMULA AS formula
    FROM TBDATA t
    LEFT JOIN CODES_DSC    cd ON cd.CDS_COD = t.CDS_COD     AND cd.LNG_COD = ?
    LEFT JOIN DESC_AGG_DSC ag ON ag.COD     = t.TBD_AGG_DSC AND ag.LNG_COD = ?
    LEFT JOIN NOTES_DSC    nt ON nt.NTS_COD = t.NTS_COD     AND nt.LNG_COD = ?
    WHERE t.CAT_COD = ? AND t.TABLE_COD = ? AND t.VARIANTE = ? AND t.REVISIONE = ?
    ORDER BY t.TBD_RIF, t.TBD_SEQ
  `,
    [
      language,
      language,
      language,
      drawing.catalogue,
      drawing.table,
      drawing.variant,
      drawing.revision,
    ],
  );
}

/**
 * Where an image's bytes are.
 *
 * The lookup key is the entry name, not the whole `IMG_PATH`: the shard comes
 * back from the index, so a caller cannot get it wrong by reconstructing it.
 */
export async function imageLocation(
  { rows }: Catalogue,
  entry: string,
): Promise<ImageLocation | undefined> {
  const found = await rows.all<ImageLocation>(
    `SELECT shard, offset, length, method, size FROM images WHERE entry = ?`,
    [entry],
  );
  return found[0];
}
