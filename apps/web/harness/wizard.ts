/**
 * Renders the import wizard's later steps with a known report.
 *
 * The picker cannot be automated, so `review`, `running` and `done` are
 * otherwise only reachable by hand. Driving `wizard` directly is enough,
 * because those three steps are pure functions of it — and it lets the size
 * estimate and the quota warning be checked against numbers chosen to make
 * the answer predictable.
 */
import { mount } from "svelte";
import ImportWizard from "../src/components/ImportWizard.svelte";
import { wizard } from "../src/lib/wizard.svelte";
import "../src/app.css";

const params = new URLSearchParams(location.search);

Object.assign(wizard, {
  step: params.get("step") ?? "review",
  sourceName: "ePER ed.83",
  report: {
    version: "8.3.0",
    release: "04147",
    // All twenty, exactly as edition 83's `LANG` table spells them — four
    // would make the language share 1/4 instead of 1/20 and the estimate
    // meaningless to check.
    languages: [
      ["0", "Italiano (Italian)"],
      ["1", "Français (French)"],
      ["2", "Español (Spanish)"],
      ["3", "English"],
      ["4", "Deutsch (German)"],
      ["5", "Português"],
      ["6", "Polski (Polish)"],
      ["7", "Dutch (Nederlands)"],
      ["9", "Danish (Dansk)"],
      ["B", "Cesky (Czech)"],
      ["D", "Ellinika' (Greek)"],
      ["H", "Magyar (Hungarian)"],
      ["J", "Japanese"],
      ["K", "Chinese"],
      ["L", "Slovenský (Slovak)"],
      ["N", "Russky (Russian)"],
      ["R", "Română (Romanian)"],
      ["S", "Srpski (Serbian)"],
      ["T", "Türkçe (Turkish)"],
      ["V", "Svenska (Swedish)"],
    ].map(([code, name]) => ({ code: code!, name: name! })),
    has: { catalogue: true, accessories: true, images: true, chassis: true },
    // Edition 83's real figures, so the estimate can be judged against what an
    // actual import produced.
    sizes: {
      catalogue: 1_331_000_000,
      accessories: 279_000_000,
      images: 4_700_000_000,
      chassis: 706_000_000,
    },
  },
  languages: params.getAll("lang").length ? params.getAll("lang") : ["3"],
  images: params.get("images") !== "0",
  chassis: params.get("chassis") !== "0",
  accessories: params.get("accessories") !== "0",
  quota: { available: Number(params.get("quota") ?? 20_000_000_000), used: 0 },
  phase: "catalogue",
  label: "PARTS 1,415,102/1,415,102",
  done: 21,
  total: 55,
  result: { tables: 55, rows: 5_253_068, indexes: 41, entries: 228_226 },
  error: params.get("error") ?? undefined,
});

mount(ImportWizard, { target: document.getElementById("app")! });

// What the page is claiming, so a test can assert on numbers rather than pixels.
(window as unknown as { __text: string }).__text = "";
setTimeout(() => {
  (window as unknown as { __text: string }).__text = document.body.innerText;
  (window as unknown as { __ready: boolean }).__ready = true;
}, 300);
