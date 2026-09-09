<!--
  The drawing, and the variants of it.

  Slimmer than it was: the callout list has moved out to its own column
  (`PartsPanel`), because a callout list is read *against* the image and the
  two belong side by side rather than stacked with the table clipped.

  What stays is the diagram, the variant strip, and one footer line naming what
  is on screen. A subgroup can hold several `DRAWINGS` rows for the same table
  — each a different applicability — and choosing between them is part of
  reading the drawing, so that strip sits with the image and not with the parts.
-->
<script lang="ts">
  import { browse, drawingKey, explainPattern, showDrawing } from "../lib/browse.svelte";
  import { i18n } from "../lib/i18n/index.svelte";

  const t = $derived(i18n.t);

  // A drawing is hidden only when it *definitely* does not fit. "Unknown" is
  // always shown; see the note in `PartsPanel`.
  const filtering = $derived(browse.source !== undefined && browse.hideUnfit);
  const shown = $derived(
    filtering
      ? browse.drawings.filter((d) => browse.fit.get(drawingKey(d)) !== "false")
      : browse.drawings,
  );

  const mark = (verdict: string | undefined) =>
    verdict === "true" ? "text-ok" : verdict === "false" ? "text-danger" : "text-warn";
  const verdictLabel = (verdict: string | undefined) =>
    verdict === "true"
      ? t("parts.fits")
      : verdict === "false"
        ? t("parts.unfit")
        : t("parts.unknown");
  const glyph = (verdict: string | undefined) =>
    verdict === "true" ? "✓" : verdict === "false" ? "✗" : "?";
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col">
  <div class="flex min-h-0 flex-1">
    {#if shown.length > 1}
      <div class="flex w-48 shrink-0 flex-col border-r border-divider">
        <header
          class="flex shrink-0 items-baseline gap-1 border-b border-divider px-2 py-1
                 text-[10px] uppercase tracking-wide text-faint"
        >
          <span>{t("drawing.variants", { count: browse.drawings.length })}</span>
          {#if shown.length !== browse.drawings.length}
            <span class="font-mono normal-case tabular-nums">
              {t("drawing.variantsOf", { shown: shown.length, total: browse.drawings.length })}
            </span>
          {/if}
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto">
          {#each shown as drawing (drawingKey(drawing))}
            {@const verdict = browse.fit.get(drawingKey(drawing))}
            <button
              class="w-full border-b border-rule px-2 py-1.5 text-left transition-colors
                     hover:bg-elevated {browse.drawing === drawing ? 'bg-elevated' : ''}"
              onclick={() => showDrawing(drawing)}
            >
              <div
                class="truncate text-xs {browse.drawing === drawing
                  ? 'text-accent'
                  : 'text-muted'}"
              >
                {drawing.name ?? drawing.table}
              </div>
              <div class="truncate font-mono text-[10px] text-faint">
                {drawing.table} · v{drawing.variant}
              </div>
              {#if drawing.pattern}
                <div
                  class="truncate font-mono text-[10px] {browse.source
                    ? mark(verdict)
                    : 'text-warn'}"
                  title={browse.source
                    ? `${verdictLabel(verdict)} — ${drawing.pattern}`
                    : drawing.pattern}
                >
                  {#if browse.source}{glyph(verdict)}
                  {/if}{drawing.pattern}
                </div>
              {/if}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <div class="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-auto p-3">
      {#if browse.imageUrl}
        <img
          src={browse.imageUrl}
          alt={browse.drawing?.name ?? "drawing"}
          class="max-h-full max-w-full object-contain"
        />
      {:else if browse.drawing}
        <p class="text-xs text-faint">{t("drawing.none")}</p>
      {:else}
        <p class="text-xs text-faint">{t("drawing.pickSubgroup")}</p>
      {/if}
    </div>
  </div>

  {#if browse.drawing}
    <!--
      What is on screen, named. The pattern is shown verbatim and marked as
      such: the grammar is characterised but never checked against a real car,
      so eperx shows the expression as well as its verdict and puts it in words
      — the reader can then disagree with it rather than having to trust it.
    -->
    <footer
      class="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t border-divider
             bg-surface px-3 py-1 text-[10px]"
    >
      <span class="font-mono text-muted">{browse.drawing.table}</span>
      <span class="font-mono text-faint">v{browse.drawing.variant}</span>
      {#if browse.drawing.name}
        <span class="text-muted">{browse.drawing.name}</span>
      {/if}
      {#if browse.drawing.pattern}
        {@const verdict = browse.fit.get(drawingKey(browse.drawing))}
        <span class="uppercase tracking-wide text-faint">{t("drawing.fits")}</span>
        <span class="font-mono {browse.source ? mark(verdict) : 'text-warn'}">
          {#if browse.source}{glyph(verdict)} {/if}{browse.drawing.pattern}
        </span>
        <span class="min-w-0 flex-1 truncate text-faint" title={explainPattern(browse.drawing.pattern)}>
          {explainPattern(browse.drawing.pattern)}
        </span>
      {/if}
    </footer>
  {/if}
</div>
