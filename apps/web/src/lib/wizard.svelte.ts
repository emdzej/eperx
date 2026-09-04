import type { DiscReport, ImportRequest, ImportResponse } from "./import.worker";
import { capabilities } from "./mount";

/**
 * Importing a disc from inside the browser.
 *
 * The work is all in the worker (see `import.worker.ts`); this is the state
 * the wizard renders and the messages that drive it. Four steps, because there
 * are exactly two moments where the user has to decide something: which folder
 * the disc is, and — having been told what is on it and what it will cost —
 * whether to go ahead.
 */
export type WizardStep = "pick" | "review" | "running" | "done";

export interface ImportSummary {
  tables: number;
  rows: number;
  indexes: number;
  entries: number;
}

export const wizard = $state({
  step: "pick" as WizardStep,
  /** The picked folder. Held because the run needs it after the scan. */
  source: undefined as FileSystemDirectoryHandle | undefined,
  sourceName: "",
  report: undefined as DiscReport | undefined,

  /** `LNG_COD` values to keep. Empty means every language on the disc. */
  languages: [] as string[],
  images: true,
  chassis: true,
  accessories: true,

  phase: "",
  label: "",
  done: 0,
  total: 0,

  result: undefined as ImportSummary | undefined,
  busy: false,
  error: undefined as string | undefined,

  /** What the origin may store, and what it already has. */
  quota: undefined as { available: number; used: number } | undefined,
});

let worker: Worker | undefined;

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./import.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<ImportResponse>) => receive(event.data);
  worker.onerror = (event) => {
    wizard.error = event.message || "the import worker failed to start";
    wizard.busy = false;
  };
  return worker;
}

function send(request: ImportRequest): void {
  ensureWorker().postMessage(request);
}

function receive(message: ImportResponse): void {
  switch (message.kind) {
    case "scanned":
      wizard.report = message.report;
      // Default to the language the browser is already in, if the disc has
      // it — importing all twenty costs about two and a half times the rows
      // for descriptions nobody in this session will read.
      wizard.languages = defaultLanguages(message.report);
      wizard.accessories = message.report.has.accessories;
      wizard.images = message.report.has.images;
      wizard.chassis = message.report.has.chassis;
      wizard.step = "review";
      wizard.busy = false;
      break;
    case "phase":
      wizard.phase = message.phase;
      wizard.label = message.detail ?? "";
      wizard.done = 0;
      wizard.total = 0;
      break;
    case "progress":
      wizard.done = message.done;
      wizard.total = message.total;
      wizard.label = message.label;
      break;
    case "finished":
      wizard.result = {
        tables: message.tables,
        rows: message.rows,
        indexes: message.indexes,
        entries: message.entries,
      };
      wizard.step = "done";
      wizard.busy = false;
      break;
    case "failed":
      wizard.error = message.message;
      wizard.busy = false;
      break;
  }
}

/**
 * Which languages to tick by default.
 *
 * The browser's own language if the disc carries it, English as the fallback,
 * and failing both the first the disc offers — never nothing, because an empty
 * set means "all twenty" and that is not a default anyone would choose.
 */
function defaultLanguages(report: DiscReport): string[] {
  if (!report.languages.length) return [];
  const spoken = navigator.language.slice(0, 2).toLowerCase();
  const byName = report.languages.find((l) => l.name.toLowerCase().includes(NAMES[spoken] ?? "\0"));
  const english = report.languages.find((l) => l.code === "3");
  return [(byName ?? english ?? report.languages[0]!).code];
}

/** Enough of a mapping to recognise the common cases in `LNG_DSC`. */
const NAMES: Record<string, string> = {
  it: "italian",
  fr: "french",
  es: "spanish",
  en: "english",
  de: "german",
  pt: "portug",
  pl: "polish",
  nl: "dutch",
  da: "danish",
  cs: "czech",
  el: "greek",
  hu: "hungarian",
  ja: "japanese",
  zh: "chinese",
  sk: "slovak",
  ru: "russian",
  ro: "romanian",
  sr: "serbian",
  tr: "turkish",
  sv: "swedish",
};

/** Ask for a folder, then look at it. Both need the same user gesture. */
export async function pickDisc(): Promise<void> {
  const picker = (
    globalThis as {
      showDirectoryPicker?: (options?: {
        mode?: "read";
        id?: string;
      }) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;
  if (!picker) {
    wizard.error =
      "This browser cannot open a folder. Chromium-based browsers can; " +
      "otherwise import with the `eperx` CLI and serve the tree over HTTP.";
    return;
  }

  wizard.error = undefined;
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await picker({ mode: "read", id: "eperx-disc" });
  } catch {
    // The user closed the dialog. Not an error worth reporting back.
    return;
  }

  wizard.source = handle;
  wizard.sourceName = handle.name;
  wizard.busy = true;
  wizard.quota = (await capabilities()).quota;
  send({ kind: "scan", source: handle });
}

export function startImport(): void {
  if (!wizard.source) return;
  wizard.error = undefined;
  wizard.busy = true;
  wizard.step = "running";
  wizard.phase = "starting";
  send({
    kind: "run",
    source: wizard.source,
    // Empty means every language, which is what the importer expects too.
    languages: wizard.languages.length ? [...wizard.languages] : undefined,
    images: wizard.images,
    chassis: wizard.chassis,
    accessories: wizard.accessories,
    // Stamped here so the worker holds no clock of its own.
    importedAt: new Date().toISOString(),
  });
}

/** Throw the worker away, so a second import starts from a clean pool. */
export function resetWizard(): void {
  worker?.terminate();
  worker = undefined;
  Object.assign(wizard, {
    step: "pick",
    source: undefined,
    sourceName: "",
    report: undefined,
    languages: [],
    images: true,
    chassis: true,
    accessories: true,
    phase: "",
    label: "",
    done: 0,
    total: 0,
    result: undefined,
    busy: false,
    error: undefined,
  });
}

/**
 * What the tree will take up, as well as it can be known before building it.
 *
 * The drawings and chassis files are **exact**: they are copied verbatim, so
 * their size on the disc is their size in the tree. The catalogue is an
 * estimate, and has to be — its size depends on how many rows survive the
 * language filter, and counting those means reading the whole 1.27 GB
 * database, which is the import itself.
 *
 * The model comes from edition 83, measured: `SP.DB` holds 8,534,325 rows, of
 * which 3,453,955 are in per-language description tables and 5,080,370 are
 * not, and keeping one language of twenty produced 5,253,068 rows in 568 MB.
 * So bytes per row is taken from that and applied to the rows a given
 * selection would keep. It is labelled an estimate in the UI because it is
 * one.
 */
const MEASURED = {
  perLanguageRows: 3_453_955,
  sharedRows: 5_080_370,
  languageCount: 20,
  bytesPerRow: 568_000_000 / 5_253_068,
};

export interface Planned {
  /** Estimated, from the row model above. */
  catalogue: number;
  /** Estimated the same way, scaled by how much smaller `AM.DB` is. */
  accessories: number;
  /** Known exactly: the drawings and chassis files are copied unchanged. */
  exact: number;
  total: number;
}

export function plannedBytes(): Planned {
  const report = wizard.report;
  if (!report) return { catalogue: 0, accessories: 0, exact: 0, total: 0 };

  const available = report.languages.length || MEASURED.languageCount;
  const kept = wizard.languages.length || available;
  const share = Math.min(1, kept / available);
  const rows = MEASURED.sharedRows + MEASURED.perLanguageRows * share;
  const catalogue = rows * MEASURED.bytesPerRow;

  // The accessories database scales with languages the same way, so it rides
  // on the same model rather than a second one — reduced by how much smaller
  // it is on disc.
  const accessories =
    wizard.accessories && report.has.accessories
      ? catalogue * (report.sizes.accessories / Math.max(1, report.sizes.catalogue))
      : 0;

  const exact =
    (wizard.images ? report.sizes.images : 0) + (wizard.chassis ? report.sizes.chassis : 0);
  return { catalogue, accessories, exact, total: catalogue + accessories + exact };
}

/** Whether the plan fits what the origin is allowed to store. */
export function fits(): { room: number; short: number } | undefined {
  if (!wizard.quota) return undefined;
  const room = wizard.quota.available - wizard.quota.used;
  const short = plannedBytes().total - room;
  return { room, short };
}
