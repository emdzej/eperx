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
  import Check from "@lucide/svelte/icons/check";
  import Copy from "@lucide/svelte/icons/copy";
  import Maximize2 from "@lucide/svelte/icons/maximize-2";
  import Minimize2 from "@lucide/svelte/icons/minimize-2";
  import { browse, drawingKey, explainPattern, showDrawing } from "../lib/browse.svelte";
  import { blobFromUrl, copyImage } from "../lib/clipboard";
  import { i18n } from "../lib/i18n/index.svelte";

  const t = $derived(i18n.t);

  /** Cleared on a timer, so the tick is feedback rather than a new state. */
  let copied = $state(false);
  /** Full-bleed: the diagram at its own size, scrollable, no letterboxing. */
  let actual = $state(false);

  async function copyDrawing() {
    if (!browse.imageUrl) return;
    // The factory is passed unawaited — Safari needs the promise created
    // inside the gesture. See `lib/clipboard.ts`.
    copied = await copyImage(blobFromUrl(browse.imageUrl));
    if (copied) setTimeout(() => (copied = false), 1500);
  }

  // A new drawing is a new thing to look at, so the zoom does not carry over.
  $effect(() => {
    void browse.drawing;
    actual = false;
  });

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

    <div
      class="relative flex min-h-0 min-w-0 flex-1 overflow-auto p-3 {actual
        ? 'items-start justify-start'
        : 'items-center justify-center'}"
    >
      {#if browse.imageUrl}
        <!--
          The two buttons sit on the drawing rather than in a toolbar, because
          they act on it and there is nowhere else they would obviously belong.
        -->
        <div class="absolute right-3 top-3 z-10 flex gap-1">
          <button
            class="rounded border border-divider bg-surface/90 p-1 text-muted backdrop-blur
                   transition-colors hover:bg-elevated hover:text-foreground"
            onclick={copyDrawing}
            title={copied ? t("drawing.copied") : t("drawing.copy")}
            aria-label={t("drawing.copy")}
          >
            {#if copied}<Check size={13} />{:else}<Copy size={13} />{/if}
          </button>
          <button
            class="rounded border border-divider bg-surface/90 p-1 text-muted backdrop-blur
                   transition-colors hover:bg-elevated hover:text-foreground"
            onclick={() => (actual = !actual)}
            title={actual ? t("drawing.shrink") : t("drawing.expand")}
            aria-label={actual ? t("drawing.shrink") : t("drawing.expand")}
          >
            {#if actual}<Minimize2 size={13} />{:else}<Maximize2 size={13} />{/if}
          </button>
        </div>
        <img
          src={browse.imageUrl}
          alt={browse.drawing?.name ?? "drawing"}
          class={actual ? "max-w-none" : "max-h-full max-w-full object-contain"}
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
