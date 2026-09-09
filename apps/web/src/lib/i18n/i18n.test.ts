/**
 * The translations, checked structurally.
 *
 * Three failure modes here are silent, and all three are cheap to assert.
 *
 * A key present in English and missing in Polish falls back to English, so the
 * interface half-translates and nothing complains. A key used in a component
 * and present in neither renders as its own dotted path — `toolbar.settings`
 * on screen where a word should be. And a counted string missing its Polish
 * `_few` or `_many` renders the wrong word for most numbers: `5 wiersze`
 * instead of `5 wierszy`, which only a Polish reader would catch.
 */
import { describe, expect, it } from "vitest";
import i18next from "i18next";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import en from "./en.json";
import pl from "./pl.json";
import { segments, slot } from "./slots.js";

type Tree = { [key: string]: string | Tree };

/** Every leaf, as a dotted path. */
function leaves(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [path] : leaves(value, path);
  });
}

function at(tree: Tree, path: string): string | undefined {
  const value = path.split(".").reduce<string | Tree | undefined>((node, key) => {
    return node && typeof node !== "string" ? node[key] : undefined;
  }, tree);
  return typeof value === "string" ? value : undefined;
}

/** i18next's plural suffixes, stripped so a counted key compares as one name. */
const PLURAL = /_(zero|one|two|few|many|other)$/;
const base = (path: string) => path.replace(PLURAL, "");

const enLeaves = leaves(en as Tree);
const plLeaves = leaves(pl as Tree);

describe("the catalogues agree", () => {
  it("has the same keys in both, ignoring plural suffixes", () => {
    const enBase = new Set(enLeaves.map(base));
    const plBase = new Set(plLeaves.map(base));
    const missingFromPl = [...enBase].filter((k) => !plBase.has(k)).sort();
    const extraInPl = [...plBase].filter((k) => !enBase.has(k)).sort();
    expect({ missingFromPl, extraInPl }).toEqual({ missingFromPl: [], extraInPl: [] });
  });

  it("gives every counted string its Polish forms", () => {
    // English needs one/other; Polish needs one/few/many. A key that has
    // `_one` in English is counted, so Polish must carry all three.
    const counted = new Set(enLeaves.filter((k) => PLURAL.test(k)).map(base));
    const missing: string[] = [];
    for (const key of [...counted].sort()) {
      for (const form of ["one", "few", "many"]) {
        if (!plLeaves.includes(`${key}_${form}`)) missing.push(`${key}_${form}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("keeps the same interpolation placeholders in both", () => {
    const holders = (text: string) => [...text.matchAll(/\{\{(\w+)/g)].map((m) => m[1]!).sort();
    const differences: Record<string, { en: string[]; pl: string[] }> = {};
    for (const key of enLeaves) {
      const english = at(en as Tree, key);
      // A Polish plural form has no English counterpart to compare against.
      const polish = at(pl as Tree, key) ?? at(pl as Tree, `${base(key)}_many`);
      if (english === undefined || polish === undefined) continue;
      const a = holders(english);
      const b = holders(polish);
      if (a.join() !== b.join()) differences[key] = { en: a, pl: b };
    }
    expect(differences).toEqual({});
  });
});

/** Every source file in the client, so the walk below cannot miss one. */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(svelte|ts)$/.test(name) && !name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

describe("every key the client asks for exists", () => {
  it('resolves every static t("…") call', () => {
    const root = join(import.meta.dirname, "..", "..");
    const used = new Map<string, string>();
    for (const path of sources(root)) {
      const text = readFileSync(path, "utf8");
      /*
       * Only static calls. `t(variable)` cannot be checked here and is rare
       * enough that the few there are get a comment saying why.
       *
       * The key must be word segments joined by single dots. A looser
       * `[\w.]+` also matches the `t("...")` written inside a doc comment
       * explaining this very mechanism, which is how this test first failed.
       */
      for (const m of text.matchAll(/\bt\(\s*"(\w+(?:\.\w+)*)"/g)) {
        used.set(m[1]!, path.slice(root.length + 1));
      }
    }

    const enBase = new Set(enLeaves.map(base));
    const missing = [...used]
      .filter(([key]) => !enBase.has(key))
      .map(([key, where]) => `${key} (${where})`)
      .sort();
    expect(missing).toEqual([]);
    // A guard against the walk silently matching nothing — a refactor that
    // renamed `t` would otherwise make this test vacuously pass.
    expect(used.size).toBeGreaterThan(0);
  });
});

describe("slots", () => {
  it("splits a sentence around a styled fragment", () => {
    i18next.init({
      lng: "en",
      resources: { en: { translation: { s: "read from {{source}} now" } } },
      interpolation: { escapeValue: false },
    });
    const text = i18next.t("s", { source: slot("source") });
    expect(segments(text)).toEqual([{ text: "read from " }, { slot: "source" }, { text: " now" }]);
  });

  it("handles a slot at either end", () => {
    expect(segments(`${slot("a")}tail`)).toEqual([{ slot: "a" }, { text: "tail" }]);
    expect(segments(`head${slot("b")}`)).toEqual([{ text: "head" }, { slot: "b" }]);
  });
});
