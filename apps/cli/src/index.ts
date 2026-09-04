#!/usr/bin/env node
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
import { serve } from "./serve.js";
import { lookupVehicle } from "./vin.js";
import { openCatalogue } from "./browse.js";
import {
  ACCESSORIES_DB,
  ACCESSORIES_INDEXES,
  buildManifest,
  CATALOGUE_DB,
  CATALOGUE_INDEXES,
  convertDatabase,
  finaliseDatabase,
  importImages,
  MANIFEST,
  openDisc,
} from "@eperx/importer";
import { NodeSourceFs, NodeTargetFs, openNodeSqlWriter } from "./node-fs.js";
import { F3Table } from "@eperx/ktd";
import { FileSource } from "./node-source.js";

const program = new Command("eperx")
  .description("ePER disc tooling — inspect the databases, build a tree the browser can read")
  .version("0.1.0");

program
  .command("disc")
  .description("report what an ePER disc carries")
  .argument("<disc>", "mounted disc, or its data directory")
  .action(async (path) => {
    const disc = await openDisc(new NodeSourceFs(path));
    console.log(`${chalk.bold("ePER")} ${disc.version}  release ${disc.release}`);
    console.log(`  ${"data".padEnd(12)} ${join(path, disc.dataDir)}`);
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
  .action(async (path, options) => {
    const sourceFs = new NodeSourceFs(path);
    const disc = await openDisc(sourceFs);
    const file =
      options.database === "accessories" ? disc.files.accessories : disc.files.spareParts;
    if (!file) throw new Error(`this disc has no ${options.database} database`);

    const handle = await sourceFs.open(file);
    const reader = new MDBReader(
      (await handle.bytes()) as ConstructorParameters<typeof MDBReader>[0],
    );
    handle.close();
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
    const sourceFs = new NodeSourceFs(path);
    const disc = await openDisc(sourceFs);
    const languages = options.languages?.split(",").map((s) => s.trim());
    mkdirSync(options.out, { recursive: true });
    const targetFs = new NodeTargetFs(options.out);

    if (!disc.files.spareParts) throw new Error("this disc has no spare-parts database");

    const started = Date.now();
    console.log(chalk.bold(`ePER ${disc.version}, release ${disc.release}`));
    if (languages) console.log(`languages: ${languages.join(", ")}`);

    // Writing into an existing database fails on the first CREATE TABLE, which
    // reads as a mysterious mid-import crash rather than "you already have
    // one". Checked here rather than in the importer, because whether a target
    // may be clobbered is a matter for whoever owns the target.
    const replaceable = (name: string) => {
      const full = join(options.out, name);
      if (!existsSync(full)) return full;
      if (!options.force) {
        throw new Error(`${full} already exists; pass --force to replace it`);
      }
      rmSync(full);
      return full;
    };

    console.log(`\n${chalk.bold("catalogue")} → ${CATALOGUE_DB}`);
    const catalogueWriter = openNodeSqlWriter(replaceable(CATALOGUE_DB));
    const spareFile = await sourceFs.open(disc.files.spareParts);
    let spare;
    try {
      spare = convertDatabase({
        bytes: await spareFile.bytes(),
        writer: catalogueWriter,
        indexes: CATALOGUE_INDEXES,
        languages,
        pageSize: options.pageSize,
        onProgress: progress,
      });
    } finally {
      spareFile.close();
    }
    process.stderr.write("\r\x1b[K");
    report(spare);

    let accessories;
    if (options.accessories && disc.files.accessories) {
      console.log(`\n${chalk.bold("accessories")} → ${ACCESSORIES_DB}`);
      const writer = openNodeSqlWriter(replaceable(ACCESSORIES_DB));
      const file = await sourceFs.open(disc.files.accessories);
      try {
        accessories = convertDatabase({
          bytes: await file.bytes(),
          writer,
          indexes: ACCESSORIES_INDEXES,
          languages,
          pageSize: options.pageSize,
          onProgress: progress,
        });
      } finally {
        file.close();
      }
      finaliseDatabase(writer);
      await writer.finish();
      process.stderr.write("\r\x1b[K");
      report(accessories);
    }

    let images;
    if (options.images && disc.files.imagesDir) {
      const copying = !options.indexImagesInPlace;
      console.log(`\n${chalk.bold("drawings")} ${copying ? "→ images/" : "(indexed in place)"}`);
      images = await importImages({
        sourceFs,
        imagesDir: disc.files.imagesDir,
        target: copying
          ? { fs: targetFs, dir: "images", mode: options.link ? "link" : "copy" }
          : undefined,
        writer: catalogueWriter,
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
      await targetFs.mkdir("chassis");
      chassis = {} as Record<string, string>;
      for (const [key, from] of [
        ["chassis", disc.files.chassis],
        ["build", disc.files.build],
      ] as const) {
        if (!from) continue;
        const file = await sourceFs.open(from);
        try {
          const to = `chassis/${file.name}`;
          await targetFs.remove(to);
          if (options.link) await targetFs.link(file, to);
          else await targetFs.copy(file, to);
          chassis[key] = file.name;
          console.log(
            `  ${file.name}  ${(file.size / 1e6).toFixed(0)} MB` +
              (options.link ? chalk.dim(" (linked)") : ""),
          );
        } finally {
          file.close();
        }
      }
    }

    // Last, because the drawing index went into the same file and both
    // ANALYZE and VACUUM have to see everything.
    finaliseDatabase(catalogueWriter);
    await catalogueWriter.finish();

    await targetFs.writeText(
      MANIFEST,
      JSON.stringify(
        buildManifest({
          version: disc.version,
          release: disc.release,
          importedAt: new Date().toISOString(),
          languages,
          catalogue: { tables: spare.tables.length, indexes: spare.indexes },
          accessories: accessories && { tables: accessories.tables.length },
          images: images && {
            dir: options.indexImagesInPlace ? null : "images",
            shards: images.shards,
            entries: images.entries,
          },
          chassis,
          linked: options.link,
        }),
        null,
        2,
      ) + "\n",
    );

    console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(0)}s → ${options.out}`);

    if (options.link) {
      console.log(
        chalk.yellow("\nnote: ") +
          "the shards and chassis files are symlinks, so this tree is servable\n" +
          "      over HTTP but cannot be opened as a folder — browsers refuse to\n" +
          "      follow a link out of the directory you grant. Re-run without\n" +
          "      --link for a tree that works from a folder or browser storage.",
      );
    }
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
    const discFs = new NodeSourceFs(options.disc);
    const disc = await openDisc(discFs);
    const db = new DatabaseSync(join(options.data, CATALOGUE_DB), { readOnly: true });
    try {
      const found = await lookupVehicle(discFs, disc, db, {
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
  .command("serve")
  .description("serve an imported tree over HTTP with Range support")
  .requiredOption("-d, --data <dir>", "an imported tree")
  .option("-p, --port <n>", "port", (v) => Number(v), 8998)
  .option("--host <host>", "interface to bind", "127.0.0.1")
  .option("-v, --verbose", "log every request")
  .option(
    "--spa",
    "serve index.html for extensionless paths — for hosting the built client, " + "not a data tree",
  )
  .action(async (options) => {
    const serving = await serve({
      root: options.data,
      port: options.port,
      host: options.host,
      verbose: options.verbose,
      spa: options.spa,
    });
    console.log(`${chalk.bold("eperx")} serving ${options.data}`);
    console.log(`  ${serving.url}`);
    console.log(chalk.dim(`  Range supported, CORS open. Ctrl-C to stop.`));

    // A running count, so it is obvious the client is reading pages rather
    // than downloading files.
    const timer = setInterval(() => {
      const { requests, bytes } = serving.stats();
      if (requests) {
        process.stderr.write(`\r\x1b[K  ${requests} requests, ${(bytes / 1e6).toFixed(1)} MB sent`);
      }
    }, 1000);

    const stop = () => {
      clearInterval(timer);
      const { requests, bytes } = serving.stats();
      process.stderr.write("\r\x1b[K");
      console.log(`\n${requests} requests, ${(bytes / 1e6).toFixed(1)} MB sent`);
      void serving.close().then(() => process.exit(0));
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
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
