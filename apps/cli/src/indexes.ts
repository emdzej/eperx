/**
 * The indexes eperx builds on the converted catalogue.
 *
 * These are *our* indexes, chosen for the query paths the browser actually
 * walks, not a copy of whatever Jet happened to carry. The source database
 * does have its own — `APPLICABILITY` alone is indexed five ways — but they
 * were chosen for ePER's screens, and reproducing them would be cargo cult.
 *
 * Every column named here is checked against the real schema during import.
 * A release that renames a column fails the import instead of silently
 * building a useless index.
 */
export const CATALOGUE_INDEXES: Record<string, string[][]> = {
  // Walking down the hierarchy: make → model group → catalogue → group →
  // subgroup → drawing.
  CATALOGUES: [["MK2_COD", "CMG_COD"], ["CAT_COD"]],
  COMM_MODGRP: [["MK2_COD", "CMG_COD"]],
  GROUPS: [["CAT_COD", "GRP_COD"]],
  GROUPS_DSC: [["LNG_COD", "GRP_COD"]],
  SUBGROUPS_BY_CAT: [["CAT_COD", "GRP_COD", "SGRP_COD"]],
  SUBGROUPS_DSC: [["LNG_COD", "GRP_COD", "SGRP_COD"]],
  DRAWINGS: [
    ["CAT_COD", "GRP_COD", "SGRP_COD", "SGS_COD"],
    ["CAT_COD", "TABLE_COD"],
  ],

  // A drawing's callout list joins on (CAT_COD, TABLE_COD, VARIANTE,
  // REVISIONE) — *not* on DRW_NUM. `DRAWINGS.DRW_NUM` numbers the variants of
  // a table for display; `TBDATA.DRW_NUM` is 0 on the rows that belong to
  // them. Indexing by DRW_NUM produced an index that matched nothing, which
  // is how this was found.
  TBDATA: [["CAT_COD", "TABLE_COD", "VARIANTE", "REVISIONE"], ["PRT_COD"]],
  PARTS: [["PRT_COD"]],
  APPLICABILITY: [["PRT_COD"], ["CAT_COD", "GRP_COD", "SGRP_COD"]],
  KIT: [["CAT_COD", "TABLE_COD", "VARIANTE", "REVISIONE"], ["PRT_COD"]],

  // Cliches — a part decomposed into its own diagram, often shared between
  // vehicles.
  CLICHE: [["CLH_COD"], ["CPLX_PRT_COD"]],
  CPXDATA: [["CLH_COD", "CPD_NUM"], ["PRT_COD"]],

  // Vehicle versions and the criteria vocabulary the PATTERN grammar refers to.
  MVS: [["CAT_COD"], ["SINCOM"]],
  CAT_VAL: [["CAT_COD", "VMK_TYPE"]],
  VMK_DSC: [["CAT_COD", "VMK_TYPE", "VMK_COD", "LNG_COD"]],
  CARAT_DSC: [["CAT_COD", "LNG_COD"]],
  MDF_ACT: [["CAT_COD", "MDF_COD"]],
  TRANCHE: [["CAT_COD"]],

  // Everything user-visible is a join to a per-language description table.
  TABLES_DSC: [["LNG_COD", "COD"]],
  DESC_AGG_DSC: [["LNG_COD", "COD"]],
  MODIF_DSC: [["CAT_COD", "MDF_COD", "LNG_COD"]],
  NOTES_DSC: [["NTS_COD", "LNG_COD"]],
  CODES_DSC: [["LNG_COD", "CDS_COD"]],
  FAM_DSC: [["FAM_COD", "LNG_COD"]],
  COLOURS_DSC: [["CAT_COD", "COL_COD", "LNG_COD"]],

  // Superseded and reconditioned part numbers.
  RPLNT: [["PRT_COD"], ["RPL_COD"]],
  RPLNT_GRP: [["RPL_GRPNUM", "LNG_COD"]],
  REC_PARTS: [["RCP_COD"]],

  // The clickable group / subgroup maps.
  MAP_GRP: [["MAP_NAME", "GRP_COD"]],
  MAP_SGRP: [["MAP_NAME", "GRP_COD", "SGRP_COD"]],
  MAP_VET: [["CAT_COD", "GRP_COD"]],
};

/** Indexes for the accessories database, whose tables are named differently. */
export const ACCESSORIES_INDEXES: Record<string, string[][]> = {
  MM_Products: [["Code"], ["FiatCode"], ["TechnicalFamily"]],
  MM_ProductDescriptions: [["ProductId", "LangCode"]],
  MM_ProductAttributes: [["ProductId"]],
  MM_ProductVehicles: [["ProductId"], ["VehicleId"]],
  MM_ProductImages: [["Code"]],
  MM_VehiclePark: [["VehicleId"], ["Brand", "Model"]],
  MM_CrossReference: [["Code"], ["CRCode"]],
  PARTS: [["PRT_COD"]],
};
