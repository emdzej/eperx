<!--
  The answer: the parts on this drawing.

  Its own column rather than a strip under the diagram, which is where it used
  to be. A callout list is read *against* the drawing — you find `20961P` on
  the image and want to know what it is — so the two belong side by side at the
  same height, not stacked with the table clipped to 14rem.

  Two things the old strip did not do, both borrowed from masax and both about
  honesty. The header says how many rows there are and how many are being
  shown; and when rows are hidden the footer says so in a sentence, because a
  filtered table that looks complete is worse than one that admits it is not.
-->
<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import Copy from "@lucide/svelte/icons/copy";
  import ShoppingCart from "@lucide/svelte/icons/shopping-cart";
  import StickyNote from "@lucide/svelte/icons/sticky-note";
  import { browse, calloutKey, explainPattern, hiddenByFilter } from "../lib/browse.svelte";
  import { bin } from "../lib/bin.svelte";
  import { copyText } from "../lib/clipboard";
  import { i18n } from "../lib/i18n/index.svelte";
  import { notes } from "../lib/notes.svelte";
  import { specificationLabel } from "../lib/browse.svelte";

  let { onNote }: { onNote: (partNumber: string, name?: string) => void } = $props();

  const t = $derived(i18n.t);

  /** Which cell was just copied, so the tick lands on that one and not all. */
  let copied = $state("");

  async function copy(key: string, value: string) {
    copied = (await copyText(value)) ? key : "";
    if (copied) setTimeout(() => (copied = ""), 1200);
  }

  /**
   * Add a callout to the bin, with where it was found.
   *
   * The provenance is recorded at the moment of adding rather than looked up
   * later: a pick list is acted on away from the screen, and "which drawing
   * was this?" is the question it has to answer on its own.
   */
  function addToBin(item: { reference: number; part: string; name: string | null; quantity: string | null }) {
    const quantity = Number(item.quantity);
    bin.add({
      partNumber: item.part,
      reference: String(item.reference),
      name: item.name ?? undefined,
      // A callout's quantity is what the drawing calls for; a non-numeric or
      // absent one means "one of them" rather than none.
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      catalogue: browse.catalogue?.code,
      catalogueName: browse.catalogue?.name,
      group: browse.drawing ? `${browse.drawing.group}/${browse.drawing.subgroup}` : undefined,
      drawing: browse.drawing ? `${browse.drawing.table} v${browse.drawing.variant}` : undefined,
      vehicle: specificationLabel(),
    });
  }

  // `hiddenByFilter` is the shared rule: only a definite non-fit is hidden,
  // because declining to answer must not look like an answer.
  const shown = $derived(
    browse.callouts.filter((c) => !hiddenByFilter(browse.calloutFit.get(calloutKey(c)))),
  );
  const hiddenCount = $derived(browse.callouts.length - shown.length);

  const mark = (verdict: string | undefined) =>
    verdict === "true" ? "text-ok" : verdict === "false" ? "text-danger" : "text-warn";
  const verdictLabel = (verdict: string | undefined) =>
    verdict === "true"
      ? t("parts.fits")
      : verdict === "false"
        ? t("parts.unfit")
        : t("parts.unknown");
  // A glyph as well as a colour. "does not fit" and "not determined" are red
  // and amber, hard to tell apart at this size and impossible for a reader who
  // cannot see the difference at all — and that distinction is the whole point
  // of three-valued logic.
  const glyph = (verdict: string | undefined) =>
    verdict === "true" ? "✓" : verdict === "false" ? "✗" : "?";
</script>

<section class="flex min-h-0 min-w-0 flex-col border-l border-divider bg-surface">
  <header
    class="flex shrink-0 items-baseline gap-2 border-b border-divider px-3 py-1
           text-[10px] uppercase tracking-wide text-faint"
  >
    <span>{t("parts.title")}</span>
    <div class="flex-1"></div>
    {#if browse.callouts.length}
      <span class="font-mono normal-case tabular-nums">
        {t("parts.rows", { shown: shown.length, total: browse.callouts.length, count: browse.callouts.length })}
      </span>
    {/if}
  </header>

  {#if browse.drawing}
    <div class="min-h-0 flex-1 overflow-auto">
      <table class="w-full text-xs">
        <thead class="sticky top-0 z-10 bg-surface text-faint">
          <tr class="border-b border-divider">
            <th class="w-12 px-3 py-1 text-left font-normal">{t("parts.ref")}</th>
            <th class="px-2 py-1 text-left font-normal">{t("parts.part")}</th>
            <th class="px-2 py-1 text-left font-normal">{t("parts.description")}</th>
            <th class="w-12 px-2 py-1 text-right font-normal">{t("parts.quantity")}</th>
            <th class="w-24 px-2 py-1 text-left font-normal">{t("parts.applies")}</th>
            <th class="w-20 px-2 py-1"><span class="sr-only">{t("bin.title")}</span></th>
          </tr>
        </thead>
        <tbody>
          {#each shown as item (calloutKey(item))}
            {@const verdict = browse.calloutFit.get(calloutKey(item))}
            <tr class="border-b border-rule align-top hover:bg-elevated">
              <td class="px-3 py-1 font-mono text-accent">
                {item.reference}{#if item.sequence > 1}<span class="text-faint"
                    >.{item.sequence}</span
                  >{/if}
              </td>
              <td class="whitespace-nowrap px-2 py-1 font-mono text-foreground">
                {item.part}
                {#if bin.has(item.part)}
                  <span
                    class="ml-1 font-mono text-[10px] text-accent"
                    title={t("bin.inBin", { count: bin.quantityOf(item.part) })}
                  >
                    ×{bin.quantityOf(item.part)}
                  </span>
                {/if}
              </td>
              <td class="px-2 py-1 text-muted">
                {item.name ?? ""}
                {#if item.qualifier}<span class="text-faint">{item.qualifier}</span>{/if}
                {#if item.note}<span class="block text-[10px] text-faint">{item.note}</span>{/if}
                <!-- Shown, not hidden behind the icon. A note is knowledge the
                     catalogue does not have; making it hoverable would be
                     hiding the most useful line on the row. -->
                {#if notes.get(item.part)}
                  <span class="block text-[10px] italic text-accent">{notes.get(item.part)}</span>
                {/if}
              </td>
              <td class="px-2 py-1 text-right font-mono text-muted">{item.quantity ?? ""}</td>
              <td
                class="px-3 py-1 font-mono {browse.source ? mark(verdict) : 'text-warn'}"
                title={[
                  browse.source ? verdictLabel(verdict) : "",
                  item.formula ? explainPattern(item.formula) : "",
                ]
                  .filter(Boolean)
                  .join(" — ")}
              >
                {#if browse.source}<span class="mr-1">{glyph(verdict)}</span>{/if}<span
                  class="break-all">{item.formula ?? ""}</span
                >
              </td>
              <!--
                The actions, on the row rather than behind a menu: each is one
                click on the thing it acts on, and a parts desk does all three
                constantly.
              -->
              <td class="whitespace-nowrap px-2 py-1 text-right">
                <button
                  class="rounded p-0.5 text-faint transition-colors hover:bg-elevated
                         hover:text-accent"
                  onclick={() => addToBin(item)}
                  title={t("bin.add", { part: item.part })}
                  aria-label={t("bin.add", { part: item.part })}
                >
                  <ShoppingCart size={12} />
                </button>
                <button
                  class="rounded p-0.5 transition-colors hover:bg-elevated hover:text-foreground
                         {notes.get(item.part) ? 'text-accent' : 'text-faint'}"
                  onclick={() => onNote(item.part, item.name ?? undefined)}
                  title={notes.get(item.part) ?? t("note.edit")}
                  aria-label={t("note.edit")}
                >
                  <StickyNote size={12} />
                </button>
                <button
                  class="rounded p-0.5 text-faint transition-colors hover:bg-elevated
                         hover:text-foreground"
                  onclick={() => copy(`p-${calloutKey(item)}`, item.part)}
                  title={t("parts.copyPart")}
                  aria-label={t("parts.copyPart")}
                >
                  {#if copied === `p-${calloutKey(item)}`}
                    <Check size={12} />
                  {:else}
                    <Copy size={12} />
                  {/if}
                </button>
                <button
                  class="rounded p-0.5 text-faint transition-colors hover:bg-elevated
                         hover:text-foreground"
                  onclick={() =>
                    copy(
                      `n-${calloutKey(item)}`,
                      [item.name, item.qualifier].filter(Boolean).join(" "),
                    )}
                  title={t("parts.copyName")}
                  aria-label={t("parts.copyName")}
                >
                  {#if copied === `n-${calloutKey(item)}`}
                    <Check size={12} />
                  {:else}
                    <span class="font-mono text-[9px]">Aa</span>
                  {/if}
                </button>
              </td>
            </tr>
          {:else}
            <tr>
              <td colspan="6" class="px-3 py-6 text-center text-[11px] text-faint">
                {browse.callouts.length ? t("parts.allFiltered") : t("parts.noCallouts")}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if hiddenCount > 0}
      <!--
        Said in words, not just implied by a count. A table that has quietly
        dropped rows the vehicle cannot have is the one place this interface
        could mislead someone into ordering the wrong part.
      -->
      <footer
        class="flex shrink-0 items-center gap-1.5 border-t border-divider px-3 py-1
               text-[10px] text-faint"
      >
        {t("parts.hidden", { count: hiddenCount })}
      </footer>
    {/if}
  {:else}
    <p class="flex min-h-0 flex-1 items-center justify-center px-3 text-center text-[11px]
              text-faint">
      {t("parts.empty")}
    </p>
  {/if}
</section>
