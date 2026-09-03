#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { join } from "node:path";
import { DatabaseSync } from "./sqlite.js";
import { Command, Option } from "@commander-js/extra-typings";
import chalk from "chalk";
import MDBReader from "mdb-reader";
import { parseImagePath } from "@eperx/core";
import { openDisc } from "./disc.js";
import { convertDatabase } from "./convert.js";
import { importImages } from "./images.js";
import { ACCESSORIES_INDEXES, CATALOGUE_INDEXES } from "./indexes.js";
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
  .option("--index-images-in-place", "index the shards where they are instead of copying 4.7 GB")
  .option("-f, --force", "replace an existing tree")
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
        },
        null,
        2,
      ) + "\n",
    );

    console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(0)}s → ${options.out}`);
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
