/**
 * Runs a real import, with no directory picker involved.
 *
 * `showDirectoryPicker` needs a user gesture and cannot be automated, which
 * would leave the whole in-browser import unverifiable. The way round it:
 * OPFS directories are `FileSystemDirectoryHandle`s too, and that is the only
 * thing `BrowserSourceFs` requires. So a disc is staged into OPFS over HTTP
 * and the real worker is pointed at it — every layer below the picker is the
 * shipping code.
 *
 * Not part of the app build. `harness/vite.config.ts` builds it on its own.
 */
import type { ImportResponse } from "../src/lib/import.worker";

const out = document.getElementById("out")!;
const lines: string[] = [];
const log = (line: string) => {
  lines.push(line);
  out.textContent = lines.join("\n");
  (window as unknown as { __lines: string[] }).__lines = lines;
};

interface Plan {
  /** Where the synthetic disc is served from. */
  base: string;
  /** Files to stage, as `path within the disc` → `url path`. */
  files: Record<string, string>;
  languages?: string[];
  images: boolean;
  chassis: boolean;
  accessories: boolean;
}

async function stage(plan: Plan): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  // A previous run's tree and staged disc would both be in the way.
  for await (const name of root.keys()) {
    await root.removeEntry(name, { recursive: true }).catch(() => {});
  }
  const disc = await root.getDirectoryHandle("__disc", { create: true });

  for (const [path, url] of Object.entries(plan.files)) {
    const parts = path.split("/");
    const name = parts.pop()!;
    let dir = disc;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });

    const response = await fetch(`${plan.base}${url}`);
    if (!response.ok) throw new Error(`${url} → ${response.status}`);
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await response.body!.pipeTo(writable);
    const size = (await (await handle.getFile()).size).toLocaleString();
    log(`staged ${path}  ${size} bytes`);
  }
  return disc;
}

async function main(): Promise<void> {
  const plan = (window as unknown as { __plan: Plan }).__plan;
  const disc = await stage(plan);

  const worker = new Worker(new URL("../src/lib/import.worker.ts", import.meta.url), {
    type: "module",
  });

  const done = new Promise<void>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<ImportResponse>) => {
      const m = event.data;
      if (m.kind === "scanned") {
        log(
          `scanned: ePER ${m.report.version} release ${m.report.release}; ` +
            `languages ${m.report.languages.length}; ` +
            `has ${Object.entries(m.report.has)
              .filter(([, v]) => v)
              .map(([k]) => k)
              .join(",")}`,
        );
        log(`  languages: ${m.report.languages.map((l) => l.code).join(" ")}`);
      } else if (m.kind === "phase") {
        log(`phase: ${m.phase} ${m.detail ?? ""}`);
      } else if (m.kind === "progress") {
        // Too chatty to keep; the last one per phase is enough to prove motion.
        lines[lines.length - 1] = lines[lines.length - 1]!.startsWith("  …")
          ? `  … ${m.label} (${m.done}/${m.total})`
          : lines[lines.length - 1]!;
        if (!lines[lines.length - 1]!.startsWith("  …"))
          log(`  … ${m.label} (${m.done}/${m.total})`);
        out.textContent = lines.join("\n");
      } else if (m.kind === "finished") {
        log(
          `finished: ${m.tables} tables, ${m.rows.toLocaleString()} rows, ` +
            `${m.indexes} indexes, ${m.entries.toLocaleString()} image entries`,
        );
        resolve();
      } else if (m.kind === "failed") {
        log(`FAILED: ${m.message}`);
        reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      log(`WORKER ERROR: ${e.message}`);
      reject(new Error(e.message));
    };
  });

  worker.postMessage({ kind: "scan", source: disc });
  // Give the scan a moment to report before the run overwrites the log.
  await new Promise((r) => setTimeout(r, 1500));
  worker.postMessage({
    kind: "run",
    source: disc,
    languages: plan.languages,
    images: plan.images,
    chassis: plan.chassis,
    accessories: plan.accessories,
    importedAt: "2026-01-01T00:00:00.000Z",
  });

  await done;
  await verify();
}

/** What ended up in OPFS, checked the way a client would read it. */
async function verify(): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const names: string[] = [];
  for await (const name of root.keys()) names.push(name);
  log(`tree holds: ${names.sort().join(", ")}`);

  const manifest = JSON.parse(
    await (await (await root.getFileHandle("manifest.json")).getFile()).text(),
  );
  log(`manifest: ${JSON.stringify(manifest)}`);

  const db = await (await root.getFileHandle("catalogue.sqlite")).getFile();
  const head = new Uint8Array(await db.slice(0, 20).arrayBuffer());
  log(
    `catalogue.sqlite: ${db.size.toLocaleString()} bytes, ` +
      `header "${new TextDecoder().decode(head.subarray(0, 15))}", ` +
      `page size ${(head[16]! << 8) | head[17]!}`,
  );

  if (names.includes("images")) {
    const images = await root.getDirectoryHandle("images");
    const shards: string[] = [];
    for await (const name of images.keys()) shards.push(name);
    const first = await (await images.getFileHandle(shards[0]!)).getFile();
    log(`images/: ${shards.length} shard(s), ${shards[0]} is ${first.size.toLocaleString()} bytes`);
  }
}

main()
  .then(() => {
    log("OK");
    (window as unknown as { __done: boolean }).__done = true;
  })
  .catch((error) => {
    log(`ERROR: ${error?.stack ?? error}`);
    (window as unknown as { __done: boolean; __error: string }).__done = true;
    (window as unknown as { __error: string }).__error = String(error);
  });
