import type { Rows } from "./rows.js";

export interface Language {
  code: string;
  name: string;
}

/**
 * The languages this tree actually carries.
 *
 * `LANG` lists all 20 that ePER supports, but `import` can filter, so a tree
 * may hold one. This asks the description tables what survived rather than
 * offering a language whose every label would come back null.
 */
export async function languages(rows: Rows): Promise<Language[]> {
  return rows.all<Language>(`
    SELECT l.LNG_COD AS code, l.LNG_DSC AS name
    FROM LANG l
    WHERE EXISTS (SELECT 1 FROM GROUPS_DSC g WHERE g.LNG_COD = l.LNG_COD)
    ORDER BY l.LNG_DSC
  `);
}
