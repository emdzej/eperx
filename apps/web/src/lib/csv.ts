import type { BinEntry } from "./bin.svelte";

/**
 * The bin as CSV, and handing a file to the browser.
 *
 * A plain module, deliberately: these are pure (or nearly so), and a
 * `.svelte.ts` module cannot be imported by a test without the Svelte compiler
 * in the way. The quoting and the BOM are exactly the parts worth testing.
 */

/**
 * Every field is quoted, always.
 *
 * A part description is `SCREWS, STUD BOLTS, NUTS, ETC.` — commas are the norm
 * here, not the exception — and quoting unconditionally is shorter than
 * deciding per field and impossible to get wrong. Doubling an embedded quote
 * is the RFC 4180 escape.
 *
 * CRLF line endings, also from the RFC, because that is what spreadsheet
 * software on Windows expects and a parts desk is a Windows desk.
 */
export function toCsv(
  entries: readonly BinEntry[],
  headers: readonly string[],
  note: (partNumber: string) => string | undefined = () => undefined,
): string {
  const cell = (value: string | number | undefined) =>
    `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = entries.map((e) =>
    [
      e.partNumber,
      e.reference,
      e.name,
      e.quantity,
      e.catalogueName ?? e.catalogue,
      e.group,
      e.drawing,
      e.vehicle,
      note(e.partNumber),
    ]
      .map(cell)
      .join(","),
  );
  return [headers.map(cell).join(","), ...rows].join("\r\n") + "\r\n";
}

/**
 * Hand a file to the browser as a download.
 *
 * A `data:` URL would be simpler, is capped at a couple of megabytes in some
 * browsers and silently ignored for downloads in others; an object URL is the
 * reliable route. It is revoked on the next task rather than immediately —
 * Safari has not started the download by the time the click handler returns.
 *
 * `bom` is opt-in and must stay that way. A leading BOM is what makes Excel
 * read a UTF-8 CSV as UTF-8 rather than the system code page, and it is also
 * what makes `JSON.parse` reject a file outright — so the CSV asks for one and
 * the JSON backup must not.
 */
export function download(
  name: string,
  text: string,
  { type = "text/csv;charset=utf-8", bom = false }: { type?: string; bom?: boolean } = {},
): void {
  const blob = new Blob(bom ? ["﻿", text] : [text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
