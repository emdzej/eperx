import { describe, expect, it } from "vitest";
import {
  criteriaIn,
  evaluatePattern,
  formatPattern,
  parsePattern,
  PatternError,
  resolveCriterion,
  resolvePattern,
  specificationFrom,
  Truth,
  vocabularyKey,
  type Specification,
} from "./pattern.js";

/**
 * The patterns quoted here are shapes taken from edition 83, written out by
 * hand. No fixture in this repository is copied out of a disc, and none of
 * these is a vehicle-specific claim — they exercise the grammar, not the data.
 */

const spec = (present: string[], absent: string[] = []): Specification => ({
  present: new Set(present),
  absent: new Set(absent),
});

describe("parsePattern", () => {
  it("reads + as AND and , as OR, with , binding loosest", () => {
    // The shape most of the corpus takes: a disjunction of conjunctions.
    expect(parsePattern("A+B,C+D")).toEqual({
      kind: "or",
      terms: [
        { kind: "and", terms: [crit("A"), crit("B")] },
        { kind: "and", terms: [crit("C"), crit("D")] },
      ],
    });
  });

  it("lets parentheses put an OR inside an AND", () => {
    expect(formatPattern(parsePattern("CC1.2+(CMBBZ,CMBBG)"))).toBe("CC1.2+(CMBBZ,CMBBG)");
  });

  it("negates a single token", () => {
    expect(parsePattern("!972")).toEqual({ kind: "not", term: crit("972") });
  });

  it("negates a parenthesised group", () => {
    // 965 patterns contain `!(`. Reading `!` as token-only negation drops the
    // negation on all of them, which inverts the answer for those drawings.
    const parsed = parsePattern("!(A,B)+C");
    expect(formatPattern(parsed)).toBe("!(A,B)+C");
    expect(evaluatePattern(parsed, spec(["C"], ["A", "B"]))).toBe(Truth.True);
    expect(evaluatePattern(parsed, spec(["A", "C"]))).toBe(Truth.False);
  });

  it("nests parentheses", () => {
    expect(formatPattern(parsePattern("A+(B,(C+D))"))).toBe("A+(B,C+D)");
  });

  it("keeps type-name punctuation out of the operator set", () => {
    // `A/T`, `C_LIN` and `@MOT` are real VMK_TYPE names, so `/`, `_` and `@`
    // must be token characters. `.` appears in codes like CC1.2.
    for (const token of ["A/TTRB", "C_LIN01", "@MOT1", "CC1.2"]) {
      expect(criteriaIn(parsePattern(token)).map((c) => c.token)).toEqual([token]);
    }
  });

  it("ignores whitespace, including the newlines patterns wrap on", () => {
    expect(formatPattern(parsePattern("A+\r\n B ,\nC"))).toBe("A+B,C");
  });

  it("records the ? suffix instead of dropping it", () => {
    // 3 MVS rows carry it and its meaning is unknown; silently discarding it
    // would turn an uncertain criterion into a confident one.
    const [criterion] = criteriaIn(parsePattern("511?"));
    expect(criterion).toEqual({ token: "511", uncertain: true });
  });

  it("tolerates stray + and , where a term should be", () => {
    // Measured: 117 patterns start with one, 134 end with one, 41 double up.
    expect(formatPattern(parsePattern("+@MOT1"))).toBe("@MOT1");
    expect(formatPattern(parsePattern("A+B+"))).toBe("A+B");
    expect(formatPattern(parsePattern("A++B"))).toBe("A+B");
  });

  it("drops an empty alternative rather than letting it mean anything", () => {
    // `A,,B` must not collapse to "matches everything" — that would put every
    // part on every car.
    const parsed = parsePattern("A,,B");
    expect(formatPattern(parsed)).toBe("A,B");
    expect(evaluatePattern(parsed, spec([], ["A", "B"]))).toBe(Truth.False);
  });

  it("treats an entirely empty pattern as no constraint", () => {
    for (const input of ["", "   ", "+", ","]) {
      expect(parsePattern(input)).toEqual({ kind: "any" });
      expect(evaluatePattern(parsePattern(input), spec([]))).toBe(Truth.True);
    }
  });

  it("refuses unbalanced parentheses instead of repairing them", () => {
    // 29 distinct TBD_VAL_FORMULA values are malformed this way. Closing them
    // for the vendor would be guessing which parts fit a car.
    expect(() => parsePattern("GS+(M1,M2,M3")).toThrow(PatternError);
    expect(() => parsePattern("M3,M4)")).toThrow(PatternError);
  });

  it("reads adjacency as an implicit AND", () => {
    // 149 TBD_VAL_FORMULA values leave the `+` out: `ECOCF4(AM47,AM55)`.
    expect(formatPattern(parsePattern("ECOCF4(AM47,AM55)"))).toBe("ECOCF4+(AM47,AM55)");
    expect(formatPattern(parsePattern("(LL1,LL2)KW66+320"))).toBe("(LL1,LL2)+KW66+320");
    expect(formatPattern(parsePattern("!007+!407(CC1.8,CC2.0)"))).toBe("!007+!407+(CC1.8,CC2.0)");
  });

  it("requires adjacency for implicit AND, so free text stays an error", () => {
    // All 147 occurrences are exactly adjacent; none is whitespace-separated.
    // Accepting whitespace as a separator would make the free-text rows in
    // MDF_ACT.PATTERN parse into criteria named NUOVA and CENTRALINA.
    expect(() => parsePattern("A (B,C)")).toThrow(PatternError);
    expect(() => parsePattern("(B,C) A")).toThrow(PatternError);
  });

  it("reads an adjacent negation as an implicit AND", () => {
    // 4 patterns take this shape. `140!(…)` is `140 AND NOT(…)`.
    expect(formatPattern(parsePattern("140!(CC1.4+VLE8)"))).toBe("140+!(CC1.4+VLE8)");
    expect(formatPattern(parsePattern("(CC1.4,CC1.3)!733"))).toBe("(CC1.4,CC1.3)+!733");
  });

  it("binds ! to its own atom, not across an implicit AND", () => {
    // `!407(X,Y)` is `(!407)+(X,Y)`, not `!(407+(X,Y))`. The two differ, and
    // 26 patterns have this shape.
    const parsed = parsePattern("!407(CC1.8,CC2.0)");
    expect(evaluatePattern(parsed, spec(["CC1.8"], ["407"]))).toBe(Truth.True);
    expect(evaluatePattern(parsed, spec(["407", "CC1.8"]))).toBe(Truth.False);
  });

  it("lets whitespace separate ! from what it negates", () => {
    // 13 patterns wrap a line between the `!` and its token — `!\r\n4TF` —
    // and 1 has `! 6EA`. Treating `!` as needing an adjacent token drops the
    // negation on all of them, which inverts those answers.
    expect(formatPattern(parsePattern("!211+!\r\n4TF"))).toBe("!211+!4TF");
    expect(formatPattern(parsePattern("A+! B"))).toBe("A+!B");
  });

  it("refuses a ! with nothing to negate", () => {
    // 9 distinct patterns are malformed this way. Dropping the stray `!`
    // would be inventing a term; keeping it would be inventing a negation.
    // A `!` before an operator or at the end: 3 patterns, all malformed.
    for (const input of ["+407+!+(LL1,LL2)", "129!+5DE", "A+!", "GSX+!52Y+!+!564"]) {
      expect(() => parsePattern(input)).toThrow(PatternError);
    }
  });

  it("refuses free text, which MDF_ACT.PATTERN sometimes holds", () => {
    // Two rows contain an Italian description rather than an expression, and
    // this is what catches them: whitespace is skipped *around* operators but
    // is not itself a separator, so two bare tokens side by side are an error
    // rather than criteria named NUOVA and CENTRALINA.
    expect(() => parsePattern("NUOVA CENTRALINA CONTROLLO MOTORE")).toThrow(PatternError);
  });
});

describe("resolveCriterion", () => {
  // The collision that makes naive tokenisation unsound: catalogue 4Y has
  // both CM and CMB as VMK_TYPE.
  const vocabulary = new Set([
    vocabularyKey("CMB", "BZ"),
    vocabularyKey("CM", "BZ2"),
    vocabularyKey("CC", "1.2"),
    vocabularyKey("011", ""),
  ]);

  it("prefers the longest type that yields an existing pair", () => {
    expect(resolveCriterion("CMBBZ", vocabulary)).toEqual({
      token: "CMBBZ",
      type: "CMB",
      code: "BZ",
    });
  });

  it("falls back to a shorter type when the longer pair does not exist", () => {
    // `CMBZ2` cannot be CMB+Z2 — that pair is not in the vocabulary — so it
    // has to be CM+BZ2. Splitting on the type alphabet alone would take CMB.
    expect(resolveCriterion("CMBZ2", vocabulary)).toEqual({
      token: "CMBZ2",
      type: "CM",
      code: "BZ2",
    });
  });

  it("resolves a bare equipment code as a type with no code", () => {
    expect(resolveCriterion("011", vocabulary)).toEqual({ token: "011", type: "011", code: "" });
  });

  it("leaves an unknown token unresolved rather than inventing a split", () => {
    // 0.21% of corpus tokens name a code the catalogue does not list. They
    // must stay unresolved so that evaluation reports Unknown.
    expect(resolveCriterion("ZZ999", vocabulary)).toEqual({ token: "ZZ999" });
  });

  it("resolves through a whole pattern", () => {
    const resolved = resolvePattern(parsePattern("CC1.2+(CMBBZ,ZZ9)"), vocabulary);
    expect(criteriaIn(resolved).map((c) => c.type)).toEqual(["CC", "CMB", undefined]);
  });
});

describe("evaluatePattern", () => {
  it("is true only when the specification says so", () => {
    const parsed = parsePattern("CC1.2+CMBBZ");
    expect(evaluatePattern(parsed, spec(["CC1.2", "CMBBZ"]))).toBe(Truth.True);
    expect(evaluatePattern(parsed, spec(["CC1.2"], ["CMBBZ"]))).toBe(Truth.False);
  });

  it("returns Unknown when the specification is silent", () => {
    // The whole reason for three-valued logic: a version's pattern does not
    // mention every criterion, and "not mentioned" is not "absent".
    expect(evaluatePattern(parsePattern("CC1.2"), spec([]))).toBe(Truth.Unknown);
  });

  it("stays decisive when one AND term is false", () => {
    // A part is definitely not applicable if any requirement is contradicted,
    // however many other terms are unknown. This is what keeps most answers
    // usable rather than a wall of "cannot tell".
    expect(evaluatePattern(parsePattern("A+B+C"), spec([], ["B"]))).toBe(Truth.False);
  });

  it("stays decisive when one OR term is true", () => {
    expect(evaluatePattern(parsePattern("A,B,C"), spec(["B"]))).toBe(Truth.True);
  });

  it("is Unknown for an OR with no true term and something unknown", () => {
    expect(evaluatePattern(parsePattern("A,B"), spec([], ["A"]))).toBe(Truth.Unknown);
  });

  it("inverts Unknown to Unknown, not to True", () => {
    // `!X` where X is unmentioned must not read as "X is absent, so this
    // fits". That mistake makes every unknown criterion satisfy its negation.
    expect(evaluatePattern(parsePattern("!X"), spec([]))).toBe(Truth.Unknown);
    expect(evaluatePattern(parsePattern("!X"), spec([], ["X"]))).toBe(Truth.True);
    expect(evaluatePattern(parsePattern("!X"), spec(["X"]))).toBe(Truth.False);
  });

  it("handles the worked example from the format doc", () => {
    // Drawing 33/101/1/20 v1 fits CC1.2+(CMBBZ,CMBBG); its callout 1 offers a
    // petrol head (CMBBZ) and an LPG head (CMBBG). The two must partition it.
    const drawing = parsePattern("CC1.2+(CMBBZ,CMBBG)");
    const petrolHead = parsePattern("CMBBZ");
    const lpgHead = parsePattern("CMBBG");

    const petrolCar = spec(["CC1.2", "CMBBZ"], ["CMBBG", "CMBDS"]);
    expect(evaluatePattern(drawing, petrolCar)).toBe(Truth.True);
    expect(evaluatePattern(petrolHead, petrolCar)).toBe(Truth.True);
    expect(evaluatePattern(lpgHead, petrolCar)).toBe(Truth.False);

    const dieselCar = spec(["CC1.3", "CMBDS"], ["CC1.2", "CMBBZ", "CMBBG"]);
    expect(evaluatePattern(drawing, dieselCar)).toBe(Truth.False);
  });
});

describe("specificationFrom", () => {
  it("reads an MVS pattern as present and absent sets", () => {
    const { present, absent, ignored } = specificationFrom(
      parsePattern("TC2V+CC1.4+KW88+!XAC+011+!108"),
    );
    expect([...present].sort()).toEqual(["011", "CC1.4", "KW88", "TC2V"]);
    expect([...absent].sort()).toEqual(["108", "XAC"]);
    expect(ignored).toBe(0);
  });

  it("reports a disjunction rather than flattening it into facts", () => {
    // A version that is "either A or B" is not a set of facts, and picking a
    // branch would fabricate a specification.
    const { present, ignored } = specificationFrom(parsePattern("A+(B,C)"));
    expect([...present]).toEqual(["A"]);
    expect(ignored).toBe(1);
  });

  it("distributes a double negation back to present", () => {
    expect([...specificationFrom(parsePattern("!!A")).present]).toEqual(["A"]);
  });
});

describe("formatPattern", () => {
  it("round-trips the shapes that occur in the corpus", () => {
    for (const input of [
      "CC1.2+(CMBBZ,CMBBG)",
      "CC1.3+CMBDS",
      "!972",
      "!(A,B)+C",
      "A+B,C+D",
      "!@MOT1+!40Q",
      "A/TTRB+C_LIN01",
      "511?",
    ]) {
      expect(formatPattern(parsePattern(input))).toBe(input);
    }
  });

  it("adds the parentheses an OR needs inside an AND", () => {
    expect(formatPattern(parsePattern("A+(B,C)"))).toBe("A+(B,C)");
  });
});

function crit(token: string) {
  return { kind: "criterion" as const, criterion: { token } };
}
