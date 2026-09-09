/**
 * The CSV, and what an imported notes file may look like.
 *
 * Both have edge cases that are silent when wrong. A part description is
 * `SCREWS, STUD BOLTS, NUTS, ETC.`, so a CSV that quotes conditionally
 * produces a file that opens *and* has its columns shifted — no error, just a
 * pick list that says the wrong thing. And a notes import that only accepted
 * eperx's own shape would reject the hand-written map someone actually sends.
 */
import { describe, expect, it } from "vitest";
import type { BinEntry } from "./bin.svelte";
import { toCsv } from "./csv";
import { normalise, NOTE_LIMIT } from "./notes-format";

const entry = (over: Partial<BinEntry> = {}): BinEntry => ({
  partNumber: "55189942",
  reference: "12",
  name: "PLUG",
  quantity: 2,
  catalogue: "33",
  catalogueName: "NUOVA PANDA",
  group: "100/0",
  drawing: "10000-010 v1",
  vehicle: undefined,
  added: 0,
  ...over,
});

describe("the bin as CSV", () => {
  it("quotes every field, so a comma in a description cannot shift a column", () => {
    const csv = toCsv([entry({ name: "SCREWS, STUD BOLTS, NUTS, ETC." })], ["a"]);
    const body = csv.split("\r\n")[1]!;
    expect(body).toContain('"SCREWS, STUD BOLTS, NUTS, ETC."');
    // Nine fields, whatever their contents: the commas inside the description
    // are inside quotes, so a naive split on `","` still finds nine.
    expect(body.split('","').length).toBe(9);
  });

  it("doubles an embedded quote, as RFC 4180 says", () => {
    const csv = toCsv([entry({ name: 'PLUG 1/2"' })], ["a"]);
    expect(csv).toContain('"PLUG 1/2"""');
  });

  it("ends every line with CRLF, including the last", () => {
    const csv = toCsv([entry(), entry({ partNumber: "71752826" })], ["a"]);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(3);
  });

  it("carries a note into its own column", () => {
    const csv = toCsv([entry()], ["a"], (part) =>
      part === "55189942" ? "M14, copper washer" : undefined,
    );
    expect(csv).toContain('"M14, copper washer"');
  });

  it("writes an empty field rather than the word undefined", () => {
    const csv = toCsv([entry({ name: undefined, vehicle: undefined })], ["a"]);
    expect(csv).not.toContain("undefined");
  });
});

describe("reading a notes file", () => {
  it("accepts the shape eperx writes", () => {
    const read = normalise({
      kind: "eperx.notes",
      version: 1,
      notes: { "55189942": { partNumber: "55189942", text: "M14", updated: 42 } },
    });
    expect(read).toEqual({ "55189942": { partNumber: "55189942", text: "M14", updated: 42 } });
  });

  it("accepts a bare part-to-text map, which is what a person writes", () => {
    const read = normalise({ "55189942": "M14, copper washer" });
    expect(read["55189942"]).toEqual({
      partNumber: "55189942",
      text: "M14, copper washer",
      // No timestamp to be had, and 0 is what makes it lose a merge against
      // anything local rather than silently winning.
      updated: 0,
    });
  });

  it("drops what it cannot read instead of failing the file", () => {
    const read = normalise({ good: "kept", bad: 42, alsoBad: null, "": "no key" });
    expect(Object.keys(read)).toEqual(["good"]);
  });

  it("drops a note that is only whitespace", () => {
    expect(normalise({ a: "   " })).toEqual({});
  });

  it("caps a note at the limit rather than storing a document", () => {
    const long = "x".repeat(NOTE_LIMIT + 50);
    expect(normalise({ a: long })["a"]!.text).toHaveLength(NOTE_LIMIT);
  });

  it("returns nothing for something that is not an object", () => {
    expect(normalise(null)).toEqual({});
    expect(normalise("notes")).toEqual({});
    expect(normalise(7)).toEqual({});
  });
});
