#!/usr/bin/env node
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { inflateRawSync } from "node:zlib";
import { basename, join } from "node:path";
import { DatabaseSync } from "./sqlite.js";
import { Command, Option } from "@commander-js/extra-typings";
import chalk from "chalk";
import MDBReader from "mdb-reader";
import { parseImagePath } from "@eperx/core";
import {
  callouts,
  catalogues,
  drawings,
  groups,
  languages,
  makes,
  modelGroups,
  replacements,
  searchParts,
  subgroups,
  whereUsed,
} from "@eperx/catalogue";
import { checkApplicability } from "./applicability.js";
import { lookupVehicle } from "./vin.js";
import { openCatalogue } from "./browse.js";
import { openDisc } from "./disc.js";
import { convertDatabase } from "./convert.js";
import { importImages } from "./images.js";
import { ACCESSORIES_INDEXES, CATALOGUE_INDEXES } from "./indexes.js";
import { F3Table } from "@eperx/ktd";
import { FileSource } from "./node-source.js";

const CATALOGUE_DB = "catalogue.sqlite";
const ACCESSORIES_DB = "accessories.sqlite";
const MANIFEST = "manifest.json";

const program = new Command("eperx")
  .description("ePER disc tooling — inspect the databases, build a tree the browser can read")
  .version("0.1.0");

program
  .command("disc")
  .description("report what an ePER disc carries")
  .argument("<disc>", "mounted disc, or its data directory")
  .action((path) => {
    const disc = openDisc(path);
    console.log(`${chalk.bold("ePER")} ${disc.version}  release ${disc.release}`);
    console.log(`  ${"data".padEnd(12)} ${disc.dataDir}`);
    for (const [key, value] of Object.entries(disc.files)) {
      console.log(`  ${key.padEnd(12)} ${value ?? chalk.dim("absent")}`);
    }
  });

program
  .command("tables")
  .description("list the tables in a disc's databases, with row counts")
  .argument("<disc>", "mounted disc, or its data directory")
  .addOption(
    new Option("-b, --database <which>", "which database to read")
      .choices(["spare-parts", "accessories"] as const)
      .default("spare-parts" as const),
  )
  .action((path, options) => {
    const disc = openDisc(path);
    const file =
      options.database === "accessories" ? disc.files.accessories : disc.files.spareParts;
    if (!file) throw new Error(`this disc has no ${options.database} database`);

    const reader = new MDBReader(readFileSync(file));
    let total = 0;
    for (const name of reader.getTableNames().sort()) {
      const table = reader.getTable(name);
      total += table.rowCount;
      const columns = table
        .getColumns()
        .map((c) => c.name)
        .join(", ");
      console.log(
        `${chalk.bold(name.padEnd(30))} ${String(table.rowCount).padStart(9)}  ${chalk.dim(columns)}`,
      );
    }
    console.log(`\n${reader.getTableNames().length} tables, ${total.toLocaleString()} rows`);
  });

program
  .command("import")
  .description("convert a disc into a static tree: SQLite catalogue plus the drawing shards")
  .argument("<disc>", "mounted disc, or its data directory")
  .requiredOption("-o, --out <dir>", "directory to write")
  .option(
    "-l, --languages <codes>",
    "comma-separated LNG_COD values to keep (default: all). " +
      "The description tables dominate the size, so this is the main lever.",
  )
  .option("--no-accessories", "skip the accessories (Mopar) database")
  .option("--no-images", "skip the drawing shards entirely")
  .option("--no-chassis", "skip the F3 chassis and build files (706 MB)")
  .option("--index-images-in-place", "index the shards where they are instead of copying 4.7 GB")
  .option(
    "--link",
    "symlink the drawing shards and chassis files instead of copying 5.7 GB; " +
      "the tree then needs the disc to stay mounted",
  )
  .option("-f, --force", "replace an existing tree")
  .option(
    "--page-size <bytes>",
    "SQLite page size; every browser read is one page (default 4096)",
    (value) => {
      const size = Number(value);
      if (!Number.isInteger(size) || size < 512 || size > 65536 || size & (size - 1)) {
        throw new Error(`page size must be a power of two between 512 and 65536, got ${value}`);
      }
      return size;
    },
  )
  .action(async (path, options) => {
    const disc = openDisc(path);
    const languages = options.languages?.split(",").map((s) => s.trim());
    mkdirSync(options.out, { recursive: true });

    if (!disc.files.spareParts) throw new Error("this disc has no spare-parts database");

    const started = Date.now();
    console.log(chalk.bold(`ePER ${disc.version}, release ${disc.release}`));
    if (languages) console.log(`languages: ${languages.join(", ")}`);

    const catalogue = join(options.out, CATALOGUE_DB);
    console.log(`\n${chalk.bold("catalogue")} → ${CATALOGUE_DB}`);
    const spare = convertDatabase({
      source: disc.files.spareParts,
      target: catalogue,
      indexes: CATALOGUE_INDEXES,
      languages,
      force: options.force,
      pageSize: options.pageSize,
      onProgress: progress,
    });
    process.stderr.write("\r\x1b[K");
    report(spare);

    let accessories;
    if (options.accessories && disc.files.accessories) {
      console.log(`\n${chalk.bold("accessories")} → ${ACCESSORIES_DB}`);
      accessories = convertDatabase({
        source: disc.files.accessories,
        target: join(options.out, ACCESSORIES_DB),
        indexes: ACCESSORIES_INDEXES,
        languages,
        force: options.force,
        pageSize: options.pageSize,
        onProgress: progress,
      });
      process.stderr.write("\r\x1b[K");
      report(accessories);
    }

    let images;
    if (options.images && disc.files.imagesDir) {
      const copying = !options.indexImagesInPlace;
      console.log(`\n${chalk.bold("drawings")} ${copying ? "→ images/" : "(indexed in place)"}`);
      images = await importImages({
        imagesDir: disc.files.imagesDir,
        targetDir: copying ? join(options.out, "images") : undefined,
        link: options.link,
        catalogue,
        onProgress: ({ shard, index, count }) => {
          process.stderr.write(`\r\x1b[K  ${shard}  ${index + 1}/${count}`);
        },
      });
      process.stderr.write("\r\x1b[K");
      console.log(
        `  ${images.shards} shards, ${images.entries.toLocaleString()} entries, ` +
          `${(images.bytes / 1e9).toFixed(2)} GB` +
          (images.deflated
            ? `, ${images.deflated.toLocaleString()} deflated (the L_* shards)`
            : ""),
      );
    }

    // The F3 files are copied verbatim, like the drawing shards: they are
    // already a blocked, indexed store that a browser can binary-search over
    // `Range`, so converting them would gain nothing.
    let chassis;
    if (options.chassis && (disc.files.chassis || disc.files.build)) {
      console.log(`\n${chalk.bold("chassis")} → chassis/`);
      mkdirSync(join(options.out, "chassis"), { recursive: true });
      chassis = {} as Record<string, string>;
      for (const [key, from] of [
        ["chassis", disc.files.chassis],
        ["build", disc.files.build],
      ] as const) {
        if (!from) continue;
        const name = basename(from);
        const to = join(options.out, "chassis", name);
        rmSync(to, { force: true });
        if (options.link) symlinkSync(from, to);
        else copyFileSync(from, to);
        chassis[key] = name;
        console.log(
          `  ${name}  ${(statSync(from).size / 1e6).toFixed(0)} MB` +
            (options.link ? chalk.dim(" (linked)") : ""),
        );
      }
    }

    writeFileSync(
      join(options.out, MANIFEST),
      JSON.stringify(
        {
          eper: { version: disc.version, release: disc.release },
          importedAt: new Date().toISOString(),
          languages: languages ?? "all",
          catalogue: { file: CATALOGUE_DB, tables: spare.tables.length, indexes: spare.indexes },
          accessories: accessories && {
            file: ACCESSORIES_DB,
            tables: accessories.tables.length,
          },
          images: images && {
            dir: options.indexImagesInPlace ? null : "images",
            shards: images.shards,
            entries: images.entries,
          },
          // Named in the manifest because the filenames carry the release
          // number, so a client cannot guess them.
          chassis: chassis && { dir: "chassis", files: chassis },
        },
        null,
        2,
      ) + "\n",
    );

    console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(0)}s → ${options.out}`);
  });

program
  .command("browse")
  .description("walk an imported catalogue — the same queries the web app makes")
  .requiredOption("-d, --data <dir>", "an imported tree")
  .option("-l, --language <code>", "LNG_COD", "3")
  .option("-c, --catalogue <cod>", "descend into one catalogue, e.g. 33")
  .option("-g, --group <n>", "descend into one group, e.g. 101")
  .option("-s, --subgroup <n>", "descend into one subgroup, and list its drawings")
  .action(async (options) => {
    const cat = openCatalogue(options.data, options.language);
    try {
      const langs = await languages(cat.rows);
      console.log(
        chalk.dim(`languages in this tree: ${langs.map((l) => `${l.code} ${l.name}`).join(", ")}`),
      );

      if (!options.catalogue) {
        for (const make of await makes(cat)) {
          console.log(
            `${chalk.bold(make.name.padEnd(12))} ${chalk.dim(`MK2_COD ${make.code}`)}  ` +
              `${make.catalogues} catalogues`,
          );
          for (const model of await modelGroups(cat, make.code)) {
            console.log(`  ${model.code.padEnd(6)} ${model.name}`);
          }
        }
        return;
      }

      if (!options.group) {
        console.log(chalk.bold(`\ngroups in catalogue ${options.catalogue}`));
        for (const group of await groups(cat, options.catalogue)) {
          console.log(
            `  ${String(group.code).padStart(4)}  ${(group.name ?? chalk.dim("(unnamed)")).padEnd(34)}` +
              ` ${chalk.dim(`${group.subgroups} subgroups`)}`,
          );
        }
        return;
      }

      if (!options.subgroup) {
        console.log(chalk.bold(`\nsubgroups in ${options.catalogue}/${options.group}`));
        for (const sub of await subgroups(cat, options.catalogue, Number(options.group))) {
          console.log(
            `  ${String(sub.code).padStart(4)}  ${(sub.name ?? chalk.dim("(unnamed)")).padEnd(34)}` +
              ` ${chalk.dim(`${sub.drawings} drawings`)}`,
          );
        }
        return;
      }

      const found = await drawings(
        cat,
        options.catalogue,
        Number(options.group),
        Number(options.subgroup),
      );
      for (const drawing of found) {
        console.log(
          `\n${chalk.bold(drawing.name ?? drawing.table)}  ` +
            chalk.dim(`${drawing.table} variant ${drawing.variant} rev ${drawing.revision}`),
        );
        // Patterns are shown in the "unverified" colour on purpose: the
        // grammar is characterised but not settled, so this is data the reader
        // must interpret, not an answer the tool is giving.
        if (drawing.pattern) console.log(`  pattern  ${chalk.yellow(drawing.pattern)}`);
        if (drawing.image) console.log(`  image    ${drawing.image}`);
        const items = await callouts(cat, drawing);
        for (const item of items) {
          const name = [item.name, item.qualifier].filter(Boolean).join(" ");
          console.log(
            `    ${String(item.reference).padStart(3)}.${item.sequence}  ` +
              `${item.part.padEnd(12)} ${chalk.dim(`x${item.quantity ?? "?"}`.padEnd(6))} ${name}` +
              (item.formula ? chalk.dim(`  [${item.formula}]`) : ""),
          );
        }
        if (!items.length) console.log(chalk.dim("    no callouts"));
      }
    } finally {
      cat.close();
    }
  });

program
  .command("part")
  .description("look up a part number: what it is, what it fits, what replaced it")
  .argument("<number>", "part number, or a prefix of one")
  .requiredOption("-d, --data <dir>", "an imported tree")
  .option("-l, --language <code>", "LNG_COD", "3")
  .action(async (number, options) => {
    const cat = openCatalogue(options.data, options.language);
    try {
      const found = await searchParts(cat, number);
      if (!found.length) {
        console.log(chalk.dim(`nothing starts with ${number}`));
        return;
      }
      for (const part of found.slice(0, 10)) {
        console.log(
          `${chalk.bold(part.code.padEnd(14))} ${(part.name ?? chalk.dim("(unnamed)")).padEnd(28)}` +
            chalk.dim(`${part.family ?? ""}`),
        );
      }
      if (found.length > 10) console.log(chalk.dim(`… and ${found.length - 10} more`));

      const exact = found.find((p) => p.code === number) ?? found[0]!;
      const supersessions = await replacements(cat, exact.code);
      if (supersessions.length) {
        console.log(chalk.bold(`\nreplacements for ${exact.code}`));
        for (const r of supersessions) {
          console.log(`  ${r.from} → ${r.to}  ${chalk.dim(r.date ?? "")}`);
        }
      }

      const usages = await whereUsed(cat, exact.code);
      console.log(chalk.bold(`\n${exact.code} appears on ${usages.length} drawings`));
      for (const use of usages.slice(0, 15)) {
        console.log(
          `  ${use.catalogue.padEnd(4)} ${use.catalogueName.padEnd(36)} ` +
            chalk.dim(`${use.group}/${use.subgroup}  ${use.table}  ref ${use.reference}`),
        );
      }
      if (usages.length > 15) console.log(chalk.dim(`  … and ${usages.length - 15} more`));
    } finally {
      cat.close();
    }
  });

program
  .command("applicability")
  .description("check the PATTERN grammar against the disc's own consistency")
  .requiredOption("-d, --data <dir>", "an imported tree")
  .option("-c, --catalogue <cod>", "one catalogue, e.g. 33 (default: all 223)")
  .option(
    "--close",
    "assume valued criteria types are single-valued, so choosing one value " +
      "excludes the others (see closeSpecification)",
  )
  .action((options) => {
    const db = new DatabaseSync(join(options.data, CATALOGUE_DB), { readOnly: true });
    const started = Date.now();
    try {
      const r = checkApplicability(db, {
        catalogue: options.catalogue,
        close: options.close,
      });
      const pct = (n: number, of: number) => (of ? `${((n / of) * 100).toFixed(2)}%` : "—");

      console.log(chalk.bold(`\n${r.catalogues} catalogue${r.catalogues === 1 ? "" : "s"}`));
      console.log(
        `  versions          ${r.versions.toLocaleString()} read, ` +
          `${r.versionsParsed.toLocaleString()} parsed ` +
          chalk.dim(`(${r.versionsWithDisjunction.toLocaleString()} had a disjunction ignored)`),
      );
      console.log(
        `  drawings          ${r.drawings.toLocaleString()} with a pattern, ` +
          `${r.drawingsParsed.toLocaleString()} parsed`,
      );
      console.log(chalk.bold("\n  reachability — can any version see this drawing?"));
      console.log(
        `    ${chalk.green("yes")}             ${r.reachable.toLocaleString().padStart(9)}  ${pct(r.reachable, r.drawingsParsed)}`,
      );
      console.log(
        `    ${chalk.yellow("undecided")}       ${r.onlyUndecided.toLocaleString().padStart(9)}  ${pct(r.onlyUndecided, r.drawingsParsed)}`,
      );
      console.log(
        `    ${chalk.red("no")}              ${r.unreachable.toLocaleString().padStart(9)}  ${pct(r.unreachable, r.drawingsParsed)}`,
      );
      console.log(
        chalk.bold("\n  alternatives — how many apply at once? (a characterisation, not a check)"),
      );
      console.log(
        `    exactly one     ${r.choicesSingle.toLocaleString().padStart(9)}  ${pct(r.choicesSingle, r.choices)}`,
      );
      console.log(
        `    several         ${r.choicesMultiple.toLocaleString().padStart(9)}  ${pct(r.choicesMultiple, r.choices)}` +
          chalk.dim("  → TBD_SEQ order decides"),
      );
      console.log(
        `    undecided       ${r.choicesUndecided.toLocaleString().padStart(9)}  ${pct(r.choicesUndecided, r.choices)}`,
      );

      if (r.parseFailures) {
        console.log(
          chalk.bold(`\n  ${r.parseFailures.toLocaleString()} patterns failed to parse`) +
            chalk.dim(` (showing ${r.parseErrors.length})`),
        );
        for (const e of r.parseErrors) {
          console.log(`    ${chalk.red(e.message.padEnd(24))} ${chalk.dim(e.pattern)}`);
        }
      }
      console.log(chalk.dim(`\n  ${((Date.now() - started) / 1000).toFixed(1)}s`));
    } finally {
      db.close();
    }
  });

program
  .command("vin")
  .description("look a vehicle up by VIN, or by model and chassis number")
  .argument("[vin]", "17-character VIN, e.g. ZLA84300003084515")
  .requiredOption("-D, --disc <disc>", "mounted disc, or its data directory")
  .requiredOption("-d, --data <dir>", "an imported tree (for the VIN table)")
  .option("-m, --model <cod>", "MOD_COD, when you have no VIN")
  .option("-c, --chassis <number>", "chassis number, when you have no VIN")
  .action(async (vin, options) => {
    const disc = openDisc(options.disc);
    const db = new DatabaseSync(join(options.data, CATALOGUE_DB), { readOnly: true });
    try {
      const found = await lookupVehicle(disc, db, {
        vin,
        model: options.model,
        chassis: options.chassis,
      });

      console.log(
        `${chalk.bold(vin ?? `${options.model}/${options.chassis}`)}  ` +
          chalk.dim(`chassis ${found.chassis}, models tried ${found.models.join(", ")}`),
      );

      if (!found.chassisRecord && !found.buildRecord) {
        console.log(chalk.yellow("\n  not on this disc"));
        for (const { model, chassis, beyond } of found.highest ?? []) {
          console.log(
            `    model ${model}: highest comparable chassis here is ${chassis}` +
              (beyond ? chalk.dim("  → this one is beyond it") : ""),
          );
        }
        console.log(
          chalk.dim("\n  A disc is a snapshot; vehicles built after it was pressed are absent."),
        );
        return;
      }

      if (found.chassisRecord) {
        console.log(chalk.bold("\n  chassis record (SP.CH)"));
        for (const [key, value] of Object.entries(found.chassisRecord)) {
          if (value) console.log(`    ${key.padEnd(14)} ${value}`);
        }
      }
      if (found.buildRecord) {
        console.log(chalk.bold("\n  build record (SP.RT)"));
        for (const [key, value] of Object.entries(found.buildRecord)) {
          if (!value) continue;
          // CARATT is the vehicle's own criteria expression, in the same
          // grammar as DRAWINGS.PATTERN — the point of the whole exercise.
          const shown = key === "CARATT" ? chalk.yellow(value) : value;
          console.log(`    ${key.padEnd(14)} ${shown}`);
        }
      }
    } finally {
      db.close();
    }
  });

program
  .command("f3")
  .description("inspect an F3 file: its header, and a block of rows")
  .argument("<file>", "SP.CH / SP.RT / SP.TR / SP.RTCHRY")
  .option("-b, --block <n>", "dump this block's rows", "0")
  .option("-n, --rows <n>", "how many rows to print", "5")
  .action(async (file, options) => {
    const source = new FileSource(file);
    try {
      const table = await F3Table.open(source);
      const h = table.header;
      console.log(
        `${chalk.bold(h.table)}  ${h.records.toLocaleString()} records, ` +
          `${h.recordsPerBlock} per block, ${(await table.blocks()).toLocaleString()} blocks`,
      );
      console.log(
        `  key      ${h.primaryKey.map((f) => `${f.name}(${f.length})`).join(" + ")}` +
          chalk.dim(`  = ${h.keyLength} bytes`),
      );
      if (h.secondaryKeys.length) {
        console.log(
          chalk.dim(
            `  also indexed by ${h.secondaryKeys
              .map((fields) => fields.map((f) => f.name).join("+"))
              .join(", ")} (not read)`,
          ),
        );
      }
      console.log(
        `  columns  ${h.columns
          .map((c) => `${c.name}${c.length ? `(${c.length})` : "(rest)"}`)
          .join(" ")}`,
      );

      const rows = await table.blockRows(Number(options.block));
      console.log(chalk.bold(`\n  block ${options.block}: ${rows.length} rows`));
      for (const row of rows.slice(0, Number(options.rows))) {
        console.log(
          "    " +
            Object.entries(row)
              .filter(([, value]) => value)
              .map(
                ([key, value]) => `${key}=${value.length > 60 ? `${value.slice(0, 60)}…` : value}`,
              )
              .join("  "),
        );
      }
    } finally {
      source.close();
    }
  });

program
  .command("image")
  .description("extract one drawing, by the IMG_PATH the catalogue gives")
  .argument("<img-path>", 'e.g. "BA/BA061CCF4B1E35C4D1CD4DF5A6B37B1B.png"')
  .requiredOption("-d, --data <dir>", "an imported tree, or a disc's data directory")
  .requiredOption("-o, --out <file>", "file to write")
  .option("--thumbnail", "fetch the .th.png beside it")
  .action(async (imgPath, options) => {
    const ref = parseImagePath(imgPath);
    if (!ref) throw new Error(`${imgPath} is not a shard/entry path`);
    const entry = options.thumbnail ? ref.entry.replace(/\.png$/i, ".th.png") : ref.entry;

    const db = new DatabaseSync(join(options.data, CATALOGUE_DB), { readOnly: true });
    const row = db
      .prepare("SELECT shard, offset, length, method, size FROM images WHERE entry = ?")
      .get(entry) as
      { shard: string; offset: number; length: number; method: number; size: number } | undefined;
    db.close();
    if (!row) throw new Error(`${entry} is not in the image index`);

    const shardPath = join(options.data, "images", `${row.shard}.res`);
    const source = new FileSource(shardPath);
    try {
      const bytes = await source.read(row.offset, row.length);
      if (bytes.length !== row.length) {
        throw new Error(`short read: wanted ${row.length} bytes, got ${bytes.length}`);
      }
      // Stored is the drawing path and needs nothing. Deflated only happens in
      // the L_* shards; `inflateRaw` is what a browser's DecompressionStream
      // does with "deflate-raw".
      const payload = row.method === 0 ? bytes : inflateRawSync(bytes);
      writeFileSync(options.out, payload);
      console.log(
        `${entry} → ${options.out} (${payload.length.toLocaleString()} bytes` +
          (row.method === 0 ? ", stored" : ", inflated") +
          ")",
      );
    } finally {
      source.close();
    }
  });

function progress(p: {
  table: string;
  rows: number;
  totalRows: number;
  tableIndex: number;
  tableCount: number;
}): void {
  process.stderr.write(
    `\r\x1b[K  [${p.tableIndex + 1}/${p.tableCount}] ${p.table} ` +
      `${p.rows.toLocaleString()}/${p.totalRows.toLocaleString()}`,
  );
}

function report(result: { tables: { rows: number; skipped: number }[]; indexes: number }): void {
  const rows = result.tables.reduce((n, t) => n + t.rows, 0);
  const skipped = result.tables.reduce((n, t) => n + t.skipped, 0);
  console.log(
    `  ${result.tables.length} tables, ${rows.toLocaleString()} rows, ` +
      `${result.indexes} indexes` +
      (skipped ? `, ${skipped.toLocaleString()} rows filtered out by language` : ""),
  );
}

program.parseAsync().catch((error: unknown) => {
  console.error(chalk.red(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
