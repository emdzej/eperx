import type { Catalogue } from "./rows.js";

/**
 * Walking down `Make → model group → catalogue → group → subgroup → drawing`.
 *
 * Column names are the disc's own throughout. The queries look verbose because
 * every label is a join to a per-language description table — that is how ePER
 * stores them, not a choice made here.
 */

export interface Make {
  /** `MK2_COD` — the marque, and the key everything below keys off. */
  code: string;
  name: string;
  /** `MK_COD` — the parent brand ABARTH and LCV are billed under. */
  parent: string;
  catalogues: number;
}

export interface ModelGroup {
  code: string;
  name: string;
  catalogues: number;
}

export interface CatalogueEntry {
  code: string;
  name: string;
  /** `MAP_NAME` — the graphical group selector, absent for some catalogues. */
  map: string | null;
}

export interface Group {
  code: number;
  name: string | null;
  subgroups: number;
}

export interface Subgroup {
  code: number;
  name: string | null;
  drawings: number;
}

/**
 * The marques that actually have catalogues.
 *
 * `CATALOGUES` carries two make columns and they mean different things.
 * `MK2_COD` is the **marque** and is what everything below keys off;
 * `MK_COD` is the parent brand it is billed under. Measured on edition 83,
 * the pairs are:
 *
 * ```
 * MK_COD  MK2_COD  MAKES.MK_DSC  catalogues
 * F       F        FIAT          104
 * R       R        ALFAROMEO      48
 * L       L        LANCIA         41
 * F       T        LCV            25   ← Fiat Professional, billed as FIAT
 * F       C        ABARTH          5   ← also billed as FIAT
 * ```
 *
 * So the join to `MAKES` is on **`MK2_COD`**. Joining on `MK_COD` — which
 * looks like the obvious pairing of same-named columns — labels LCV and
 * ABARTH as "FIAT" and produces three identical rows in the make list. That
 * is how this was found.
 *
 * `MAKES` has a sixth row, `E` CHRYSLER, with no catalogues on this disc.
 * Counting through `CATALOGUES` rather than listing `MAKES` keeps it out,
 * along with any other branch that leads nowhere.
 */
export async function makes({ rows }: Catalogue): Promise<Make[]> {
  return rows.all<Make>(`
    SELECT
      c.MK2_COD                       AS code,
      COALESCE(mk.MK_DSC, c.MK2_COD)  AS name,
      MIN(c.MK_COD)                   AS parent,
      COUNT(*)                        AS catalogues
    FROM CATALOGUES c
    LEFT JOIN MAKES mk ON mk.MK_COD = c.MK2_COD
    GROUP BY c.MK2_COD
    ORDER BY catalogues DESC, name
  `);
}

export async function modelGroups({ rows }: Catalogue, make: string): Promise<ModelGroup[]> {
  return rows.all<ModelGroup>(
    `
    SELECT g.CMG_COD AS code, g.CMG_DSC AS name, COUNT(c.CAT_COD) AS catalogues
    FROM COMM_MODGRP g
    JOIN CATALOGUES c ON c.MK2_COD = g.MK2_COD AND c.CMG_COD = g.CMG_COD
    WHERE g.MK2_COD = ?
    GROUP BY g.CMG_COD
    ORDER BY g.CMG_SORT_KEY, g.CMG_DSC
  `,
    [make],
  );
}

export async function catalogues(
  { rows }: Catalogue,
  make: string,
  modelGroup: string,
): Promise<CatalogueEntry[]> {
  return rows.all<CatalogueEntry>(
    `
    SELECT CAT_COD AS code, CAT_DSC AS name, MAP_NAME AS map
    FROM CATALOGUES
    WHERE MK2_COD = ? AND CMG_COD = ?
    ORDER BY CAT_SORT_KEY, CAT_DSC
  `,
    [make, modelGroup],
  );
}

/**
 * The groups in a catalogue.
 *
 * `GROUPS.GRP_COD` is TEXT and `GROUPS_DSC.GRP_COD` is INTEGER, so the join
 * needs the cast. Without it SQLite compares `'101'` to `101`, matches
 * nothing, and every group comes back unnamed — which looks like missing
 * translations rather than a bug.
 */
export async function groups({ rows, language }: Catalogue, catalogue: string): Promise<Group[]> {
  return rows.all<Group>(
    `
    SELECT
      CAST(g.GRP_COD AS INTEGER) AS code,
      d.GRP_DSC                  AS name,
      (SELECT COUNT(*) FROM SUBGROUPS_BY_CAT s
        WHERE s.CAT_COD = g.CAT_COD AND s.GRP_COD = CAST(g.GRP_COD AS INTEGER)) AS subgroups
    FROM GROUPS g
    LEFT JOIN GROUPS_DSC d
      ON d.GRP_COD = CAST(g.GRP_COD AS INTEGER) AND d.LNG_COD = ?
    WHERE g.CAT_COD = ?
    ORDER BY code
  `,
    [language, catalogue],
  );
}

export async function subgroups(
  { rows, language }: Catalogue,
  catalogue: string,
  group: number,
): Promise<Subgroup[]> {
  return rows.all<Subgroup>(
    `
    SELECT
      s.SGRP_COD AS code,
      d.SGRP_DSC AS name,
      (SELECT COUNT(*) FROM DRAWINGS w
        WHERE w.CAT_COD = s.CAT_COD AND w.GRP_COD = s.GRP_COD
          AND w.SGRP_COD = s.SGRP_COD) AS drawings
    FROM SUBGROUPS_BY_CAT s
    LEFT JOIN SUBGROUPS_DSC d
      ON d.GRP_COD = s.GRP_COD AND d.SGRP_COD = s.SGRP_COD AND d.LNG_COD = ?
    WHERE s.CAT_COD = ? AND s.GRP_COD = ?
    ORDER BY s.SGRP_COD
  `,
    [language, catalogue, group],
  );
}
