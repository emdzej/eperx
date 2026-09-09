/**
 * Interface language.
 *
 * This is **not** the catalogue's language. The disc carries its own text in
 * twenty languages through the `*_DSC` tables, chosen with the dropdown in the
 * toolbar and set at import time by `-l`; this is the language of eperx's own
 * words. Keeping them apart matters because they are genuinely independent: a
 * Polish-speaking parts desk reading an English-only tree is the normal case,
 * since importing all twenty languages costs about two and a half times the
 * rows.
 *
 * i18next is here for one reason worth stating: **Polish plurals**. This
 * interface counts things — drawings, callouts, catalogues, rows, requests —
 * and Polish needs one/few/many where English needs one/other. `3 rysunki` and
 * `5 rysunków` are different words, and 12–14 go back to *many* while 22–24
 * return to *few*. That is `Intl.PluralRules` territory, which i18next wraps;
 * a hand-rolled `n === 1 ? a : b` is wrong for most Polish numbers.
 *
 * i18next is not reactive, so `languageChanged` bumps a rune and `t` is read
 * through it. Without that the strings change in the instance and nothing
 * re-renders.
 */
import i18next, { type TFunction } from "i18next";
import en from "./en.json";
import pl from "./pl.json";

export const LOCALES = ["en", "pl"] as const;
export type Locale = (typeof LOCALES)[number];
/** `auto` follows the browser and keeps following it. */
export type LocaleChoice = "auto" | Locale;

export const LOCALE_CHOICES = ["auto", ...LOCALES] as const;

const KEY = "eperx.locale";
const FALLBACK: Locale = "en";

const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);

/**
 * What the browser asks for, as one of ours.
 *
 * `navigator.languages` is in preference order and its entries are tags like
 * `pl-PL`, so each is cut at the subtag. A user whose first choice is
 * unsupported but whose second is Polish gets Polish rather than the fallback.
 */
function fromBrowser(): Locale {
  const asked = globalThis.navigator?.languages ?? [];
  for (const tag of asked) {
    const base = tag.toLowerCase().split("-")[0];
    if (isLocale(base)) return base;
  }
  return FALLBACK;
}

function stored(): LocaleChoice {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === "auto" || isLocale(raw) ? raw : "auto";
  } catch {
    // Private-mode Safari throws rather than returning null.
    return "auto";
  }
}

function initial(): Locale {
  const choice = stored();
  return choice === "auto" ? fromBrowser() : choice;
}

// Not awaited: with the resources inline there is no backend to wait for and
// i18next initialises synchronously. A top-level await here would make this
// module async and force every importer to become async with it.
i18next.init({
  lng: initial(),
  fallbackLng: FALLBACK,
  resources: { en: { translation: en }, pl: { translation: pl } },
  interpolation: {
    // Svelte escapes on output already, and i18next's own escaping would
    // double-encode a quote in a part name.
    escapeValue: false,
  },
  returnNull: false,
  // A missing key renders as its own dotted path, which is how a typo reaches
  // the screen as literal `toolbar.settings`. `i18n.test.ts` walks every static
  // `t("...")` call in the client and fails if the key is absent, which is a
  // better guarantee than any runtime fallback.
  parseMissingKeyHandler: (key) => key,
});

class I18n {
  choice = $state<LocaleChoice>("auto");
  /** Bumped on every language change; `t` depends on it. */
  private version = $state(0);
  private browser = $state<Locale>(FALLBACK);

  /** The language actually in use — never `auto`. */
  readonly locale = $derived<Locale>(this.choice === "auto" ? this.browser : this.choice);

  /**
   * Translate. Reading `version` is what makes a component re-render on a
   * language change, so it is read deliberately rather than by accident.
   */
  readonly t = $derived.by<TFunction>(() => {
    void this.version;
    return i18next.t.bind(i18next) as TFunction;
  });

  constructor() {
    this.choice = stored();
    this.browser = fromBrowser();
    i18next.on("languageChanged", () => {
      this.version += 1;
      document.documentElement.lang = i18next.resolvedLanguage ?? FALLBACK;
    });
    document.documentElement.lang = i18next.resolvedLanguage ?? FALLBACK;
  }

  async set(choice: LocaleChoice): Promise<void> {
    this.choice = choice;
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      // Storage blocked: the language still applies, it just is not remembered.
    }
    await i18next.changeLanguage(choice === "auto" ? this.browser : choice);
  }
}

export const i18n = new I18n();

// Re-exported so a component has one place to import i18n from.
export { segments, slot } from "./slots.js";
