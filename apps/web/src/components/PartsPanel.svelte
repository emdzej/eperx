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
  import {
    browse,
    calloutKey,
    explainPattern,
  } from "../lib/browse.svelte";
  import { i18n } from "../lib/i18n/index.svelte";

  const t = $derived(i18n.t);

  /**
   * Filtering, and its one rule.
   *
   * A callout is hidden only when it **definitely** does not fit. "Unknown" is
   * always shown: declining to answer must not look like an answer, and hiding
   * on uncertainty would quietly lose real parts.
   */
  const filtering = $derived(browse.source !== undefined && browse.hideUnfit);
  const shown = $derived(
    filtering
      ? browse.callouts.filter((c) => browse.calloutFit.get(calloutKey(c)) !== "false")
      : browse.callouts,
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
            <th class="w-32 px-3 py-1 text-left font-normal">{t("parts.applies")}</th>
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
              <td class="whitespace-nowrap px-2 py-1 font-mono text-foreground">{item.part}</td>
              <td class="px-2 py-1 text-muted">
                {item.name ?? ""}
                {#if item.qualifier}<span class="text-faint">{item.qualifier}</span>{/if}
                {#if item.note}<span class="block text-[10px] text-faint">{item.note}</span>{/if}
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
            </tr>
          {:else}
            <tr>
              <td colspan="5" class="px-3 py-6 text-center text-[11px] text-faint">
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
