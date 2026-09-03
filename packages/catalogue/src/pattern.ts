/**
 * The applicability grammar — ePER's `PATTERN` expressions.
 *
 * **This decides which parts fit which vehicle.** A wrong answer here puts a
 * part on a car it does not fit, and nothing in a green test run says so. The
 * code is therefore built to say "I do not know" rather than to guess: see
 * {@link Truth} and the three-valued logic below.
 *
 * Patterns appear on `DRAWINGS.PATTERN`, `MVS.PATTERN`, `MDF_ACT.PATTERN` and
 * `TBDATA.TBD_VAL_FORMULA`. The grammar was established by surveying all
 * 152,758 distinct (source, catalogue, pattern) triples on edition 83; every
 * count quoted in these comments comes from that survey, and
 * `docs/data-format.md` §5 records the method.
 *
 * ```
 * pattern      := alternatives
 * alternatives := conjunction ("," conjunction)*     -- OR,  loosest
 * conjunction  := term ("+" term)*                   -- AND
 * term         := "!"* atom                          -- NOT
 * atom         := "(" alternatives ")" | token
 * token        := [^+,()!\s]+                        -- a criterion
 * ```
 *
 * Adjacent atoms are an implicit AND: `ECOCF4(AM47,AM55)` means
 * `ECOCF4+(AM47,AM55)`. `!` binds to its own atom, so `!407(CC1.8,CC2.0)`
 * reads as `(!407)+(CC1.8,CC2.0)` and not as `!(407+(…))`. 26 patterns have
 * that shape, and the two readings differ — the precedence chosen here is the
 * conventional one for a prefix operator, but it is a choice, and it is on the
 * undecoded list in `docs/data-format.md` §8.
 *
 * Whitespace is skipped *around* operators and tokens, because patterns wrap
 * across lines — 14,907 of them contain a newline. It is deliberately **not**
 * a separator: two bare tokens side by side are a parse error. That is what
 * rejects the 2 `MDF_ACT.PATTERN` rows holding free-text Italian rather than
 * reading them as criteria named `NUOVA` and `CENTRALINA`.
 */

/** A criterion reference: a `VMK_TYPE` and, usually, a `VMK_COD`. */
export interface Criterion {
  /** As written in the pattern, e.g. `"CC1.2"`. */
  token: string;
  /** `VMK_TYPE`, e.g. `"CC"`. Undefined when the token did not resolve. */
  type?: string;
  /** `VMK_COD`, e.g. `"1.2"`. Empty string for a bare equipment code. */
  code?: string;
  /**
   * The `?` suffix, seen on 3 `MVS` rows out of 36,332 and nowhere else.
   * **Meaning unknown.** Preserved rather than dropped so that it cannot be
   * silently read as plain truth.
   */
  uncertain?: boolean;
}

export type Pattern =
  | { kind: "criterion"; criterion: Criterion }
  | { kind: "and"; terms: Pattern[] }
  | { kind: "or"; terms: Pattern[] }
  | { kind: "not"; term: Pattern }
  /** An empty pattern constrains nothing, the same as a NULL column. */
  | { kind: "any" };

export class PatternError extends Error {
  constructor(
    message: string,
    readonly pattern: string,
    readonly at: number,
  ) {
    super(`${message} at ${at} in ${JSON.stringify(pattern)}`);
    this.name = "PatternError";
  }
}

/**
 * Parse a pattern into an AST.
 *
 * Throws on malformed input rather than repairing it. 29 distinct
 * `TBD_VAL_FORMULA` values (40 rows of 532,178) have unbalanced parentheses —
 * `GS+(M1,M2,M3` with nothing closing it — and there is no way to close them
 * that is not a guess about which parts fit a car.
 *
 * What *is* tolerated, because it has an unambiguous reading: stray `+` and
 * `,` where a term should be. 117 patterns start with one, 134 end with one,
 * and 41 have two in a row. An empty conjunct constrains nothing and is
 * dropped; an alternative that is entirely empty is dropped too rather than
 * treated as true, because `A,,B` must not come to mean "anything".
 */
export function parsePattern(input: string): Pattern {
  let at = 0;

  const skipSpace = (): void => {
    while (at < input.length && /\s/.test(input[at]!)) at++;
  };

  const parseAlternatives = (): Pattern => {
    const terms: Pattern[] = [];
    for (;;) {
      const term = parseConjunction();
      if (term.kind !== "any") terms.push(term);
      skipSpace();
      if (input[at] === ",") {
        at++;
        continue;
      }
      break;
    }
    if (terms.length === 0) return { kind: "any" };
    return terms.length === 1 ? terms[0]! : { kind: "or", terms };
  };

  const parseConjunction = (): Pattern => {
    const terms: Pattern[] = [];
    for (;;) {
      skipSpace();
      if (at >= input.length || input[at] === "," || input[at] === ")") break;
      if (input[at] === "+") {
        at++;
        continue;
      }
      terms.push(parseTerm());

      // Implicit AND: two atoms written adjacently with no operator between
      // them. `ECOCF4(AM47,AM55)` and `(LL1,LL2)KW66+320` are conjunctions
      // with the `+` left out, and reading them any other way is incoherent —
      // `!007+!407(CC1.8,CC2.0)` is otherwise a conjunction chain throughout.
      //
      // Checked *before* skipping whitespace, and deliberately so. All 147
      // occurrences are exactly adjacent and none is whitespace-separated, so
      // requiring adjacency keeps `NUOVA CENTRALINA` a parse error instead of
      // two criteria. It occurs only in `TBD_VAL_FORMULA` (149 of 110,933
      // distinct, across 53 catalogues) and never in `DRAWINGS`, `MVS` or
      // `MDF_ACT`, so the drawing-level path does not depend on it.
      // `!` counts as the start of an adjacent atom too — `140!(CC1.4+VLE8)`
      // is `140+!(CC1.4+VLE8)`. That fixes 4 patterns and leaves the 3 where
      // `!` precedes an operator (`129!+5DE`) as the errors they are.
      const adjacent = input[at];
      if (adjacent !== undefined && (adjacent === "(" || !/[+,()\s]/.test(adjacent))) {
        continue;
      }

      skipSpace();
      if (input[at] === "+") {
        at++;
        continue;
      }
      break;
    }
    if (terms.length === 0) return { kind: "any" };
    return terms.length === 1 ? terms[0]! : { kind: "and", terms };
  };

  const parseTerm = (): Pattern => {
    skipSpace();
    if (input[at] === "!") {
      at++;
      // `!` applies to an atom, and that atom may be a group: 965 patterns
      // contain `!(`. Reading it as token-only negation silently drops the
      // negation on every one of them.
      return { kind: "not", term: parseTerm() };
    }
    if (input[at] === "(") {
      const open = at++;
      const inner = parseAlternatives();
      skipSpace();
      if (input[at] !== ")") throw new PatternError("unclosed '('", input, open);
      at++;
      return inner;
    }
    return { kind: "criterion", criterion: parseToken() };
  };

  const parseToken = (): Criterion => {
    const start = at;
    while (at < input.length && !/[+,()!\s]/.test(input[at]!)) at++;
    if (at === start) throw new PatternError("expected a criterion", input, start);
    let token = input.slice(start, at);
    let uncertain = false;
    if (token.endsWith("?")) {
      token = token.slice(0, -1);
      uncertain = true;
    }
    return uncertain ? { token, uncertain } : { token };
  };

  const parsed = parseAlternatives();
  skipSpace();
  if (at < input.length) throw new PatternError(`unexpected ${input[at]!}`, input, at);
  return parsed;
}

/**
 * A catalogue's criteria vocabulary: which `(VMK_TYPE, VMK_COD)` pairs exist.
 *
 * Needed because a token concatenates the two with **no separator** —
 * `CMBBZ` is `CMB` + `BZ` — and the type names are not prefix-free. Catalogue
 * `4Y` has both `CM` and `CMB`; `12` and `13` have `G` and `GSS`; five have
 * `C_LIN` and `COLINT`. Splitting on the type alphabet alone is unsound.
 *
 * Resolving against the actual pairs *is* sound here, and that is a
 * measurement rather than a hope: across all 4,241,952 token occurrences in
 * the corpus, **0 split more than one way**. 8,893 of them (0.21%) do not
 * resolve at all — a code a pattern names but the catalogue's vocabulary does
 * not list — and those stay unresolved, which makes them `Unknown` when
 * evaluated rather than quietly false.
 */
export type Vocabulary = ReadonlySet<string>;

/** Key a `(type, code)` pair for a {@link Vocabulary}. */
export function vocabularyKey(type: string, code: string): string {
  return `${type} ${code}`;
}

/**
 * Split a token into `(VMK_TYPE, VMK_COD)` using a catalogue's vocabulary.
 *
 * Longest type first, so that where both `CM` and `CMB` exist the pair that
 * actually exists wins rather than the shorter prefix.
 */
export function resolveCriterion(token: string, vocabulary: Vocabulary): Criterion {
  for (let i = token.length; i > 0; i--) {
    const type = token.slice(0, i);
    const code = token.slice(i);
    if (vocabulary.has(vocabularyKey(type, code))) return { token, type, code };
  }
  return { token };
}

/** Resolve every criterion in a parsed pattern against a vocabulary. */
export function resolvePattern(pattern: Pattern, vocabulary: Vocabulary): Pattern {
  switch (pattern.kind) {
    case "criterion": {
      const resolved = resolveCriterion(pattern.criterion.token, vocabulary);
      return {
        kind: "criterion",
        criterion: pattern.criterion.uncertain ? { ...resolved, uncertain: true } : resolved,
      };
    }
    case "and":
      return { kind: "and", terms: pattern.terms.map((t) => resolvePattern(t, vocabulary)) };
    case "or":
      return { kind: "or", terms: pattern.terms.map((t) => resolvePattern(t, vocabulary)) };
    case "not":
      return { kind: "not", term: resolvePattern(pattern.term, vocabulary) };
    case "any":
      return pattern;
  }
}

/**
 * Three-valued truth, because two-valued would be a lie.
 *
 * A vehicle's specification does not mention every criterion in its
 * catalogue, and 0.21% of pattern tokens name a code the vocabulary does not
 * contain. In both cases the honest answer is that it is not known whether the
 * part fits, and a caller can then decline to show it rather than show it
 * wrongly.
 */
export const Truth = { True: "true", False: "false", Unknown: "unknown" } as const;
export type Truth = (typeof Truth)[keyof typeof Truth];

/** What is known about one vehicle: which criteria hold, and which do not. */
export interface Specification {
  present: ReadonlySet<string>;
  absent: ReadonlySet<string>;
}

/**
 * Evaluate a pattern against a specification, in Kleene three-valued logic.
 *
 * `AND` is false if any term is false, true only if every term is true, and
 * unknown otherwise; `OR` is the mirror. That ordering is what keeps most
 * answers decisive: a pattern with one false term is definitely not
 * applicable however many of its other terms are unknown.
 */
export function evaluatePattern(pattern: Pattern, spec: Specification): Truth {
  switch (pattern.kind) {
    case "any":
      return Truth.True;
    case "criterion": {
      const { token } = pattern.criterion;
      if (spec.present.has(token)) return Truth.True;
      if (spec.absent.has(token)) return Truth.False;
      return Truth.Unknown;
    }
    case "not": {
      const inner = evaluatePattern(pattern.term, spec);
      if (inner === Truth.True) return Truth.False;
      if (inner === Truth.False) return Truth.True;
      return Truth.Unknown;
    }
    case "and": {
      let unknown = false;
      for (const term of pattern.terms) {
        const value = evaluatePattern(term, spec);
        if (value === Truth.False) return Truth.False;
        if (value === Truth.Unknown) unknown = true;
      }
      return unknown ? Truth.Unknown : Truth.True;
    }
    case "or": {
      let unknown = false;
      for (const term of pattern.terms) {
        const value = evaluatePattern(term, spec);
        if (value === Truth.True) return Truth.True;
        if (value === Truth.Unknown) unknown = true;
      }
      return unknown ? Truth.Unknown : Truth.False;
    }
  }
}

/**
 * Read an `MVS.PATTERN` as a vehicle specification.
 *
 * An `MVS` row is one sold version of a vehicle, and its pattern is a flat
 * conjunction listing what that version has and — with `!` — what it does
 * not: `TC2V+CC1.4+KW88+CMBBZ+!XAC+011+!108+…`, typically 50 to 150 tokens. So
 * it is a *specification*, where a drawing's pattern is a *query* over one.
 *
 * Only top-level conjuncts are read. A disjunction inside an `MVS` pattern
 * would describe a version that is two things at once, which cannot be turned
 * into a set of facts, so it is reported through `ignored` rather than
 * flattened into something that looks complete.
 */
export function specificationFrom(pattern: Pattern): Specification & { ignored: number } {
  const present = new Set<string>();
  const absent = new Set<string>();
  let ignored = 0;

  const walk = (node: Pattern, negated: boolean): void => {
    switch (node.kind) {
      case "criterion":
        (negated ? absent : present).add(node.criterion.token);
        return;
      case "not":
        walk(node.term, !negated);
        return;
      case "and":
        // Negating a conjunction distributes into a disjunction, which is not
        // a set of facts. Count it rather than pick one branch.
        if (negated) ignored++;
        else for (const term of node.terms) walk(term, false);
        return;
      case "or":
        ignored++;
        return;
      case "any":
        return;
    }
  };

  walk(pattern, false);
  return { present, absent, ignored };
}

/** Render an AST back to pattern syntax, for round-trip tests and display. */
export function formatPattern(pattern: Pattern): string {
  switch (pattern.kind) {
    case "any":
      return "";
    case "criterion":
      return pattern.criterion.token + (pattern.criterion.uncertain ? "?" : "");
    case "not": {
      const inner = formatPattern(pattern.term);
      return pattern.term.kind === "criterion" ? `!${inner}` : `!(${inner})`;
    }
    case "and":
      return pattern.terms
        .map((t) => (t.kind === "or" ? `(${formatPattern(t)})` : formatPattern(t)))
        .join("+");
    case "or":
      return pattern.terms.map(formatPattern).join(",");
  }
}

/** Every criterion a pattern mentions, in order of appearance. */
export function criteriaIn(pattern: Pattern): Criterion[] {
  const out: Criterion[] = [];
  const walk = (node: Pattern): void => {
    if (node.kind === "criterion") out.push(node.criterion);
    else if (node.kind === "not") walk(node.term);
    else if (node.kind === "and" || node.kind === "or") node.terms.forEach(walk);
  };
  walk(pattern);
  return out;
}
