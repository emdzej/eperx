/**
 * Light, dark, or whatever the machine says.
 *
 * Three states rather than two, because "dark" and "not dark" cannot express
 * "follow the system" — and a desk that goes dark at dusk with the rest of the
 * OS is what most people expect without asking for it. eperx had two.
 *
 * The resolved value is written as Tailwind's `dark` class on the root element,
 * which is what the palette keys off. `auto` writes no class and instead
 * resolves the media query itself, so that the class always states what is
 * actually on screen — a `dark` class that meant "maybe" would be no use to
 * anything reading it.
 */
export type ThemeChoice = "auto" | "light" | "dark";

const KEY = "eperx.theme";
/** The three states, in the order the cycle and the settings list use. */
export const THEME_CHOICES: readonly ThemeChoice[] = ["auto", "light", "dark"];

const isChoice = (value: unknown): value is ThemeChoice =>
  typeof value === "string" && (THEME_CHOICES as string[]).includes(value);

/**
 * The stored choice.
 *
 * A value written by an earlier build is `"light"` or `"dark"`, both of which
 * are still valid choices, so nothing has to be migrated. Anything else — and
 * an empty store — means `auto`.
 */
function stored(): ThemeChoice {
  try {
    const raw = localStorage.getItem(KEY);
    return isChoice(raw) ? raw : "auto";
  } catch {
    // Private-mode Safari throws rather than returning null.
    return "auto";
  }
}

class Theme {
  choice = $state<ThemeChoice>("auto");
  /** What the system prefers, tracked so `auto` resolves without guessing. */
  private systemDark = $state(false);

  /** `light` or `dark` — never `auto`. What is actually on screen. */
  readonly resolved = $derived<"light" | "dark">(
    this.choice === "auto" ? (this.systemDark ? "dark" : "light") : this.choice,
  );

  constructor() {
    this.choice = stored();
    const query = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
    if (query) {
      this.systemDark = query.matches;
      // `auto` has to keep following the system *after* boot, or a machine that
      // switches at sunset stays light until the next reload.
      query.addEventListener("change", (event) => (this.systemDark = event.matches));
    }
    this.apply();
  }

  /** Advance auto → light → dark → auto. */
  cycle(): void {
    const at = THEME_CHOICES.indexOf(this.choice);
    this.set(THEME_CHOICES[(at + 1) % THEME_CHOICES.length]!);
  }

  set(choice: ThemeChoice): void {
    this.choice = choice;
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      // Storage blocked: the theme still applies, it just is not remembered.
    }
    this.apply();
  }

  private apply(): void {
    document.documentElement.classList.toggle("dark", this.resolved === "dark");
  }
}

export const theme = new Theme();
