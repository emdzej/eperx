<!--
  The drawing, and the variants of it.

  Slimmer than it was: the callout list has moved out to its own column
  (`PartsPanel`), because a callout list is read *against* the image and the
  two belong side by side rather than stacked with the table clipped.

  What stays is the diagram, its variants as a tab strip, and one footer line
  naming what is on screen.
-->
<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import Copy from "@lucide/svelte/icons/copy";
  import Maximize2 from "@lucide/svelte/icons/maximize-2";
  import Minimize2 from "@lucide/svelte/icons/minimize-2";
  import {
    browse,
    drawingKey,
    explainPattern,
    hiddenByFilter,
    showDrawing,
  } from "../lib/browse.svelte";
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

  /**
   * Drag to pan, once the drawing is bigger than its frame.
   *
   * `overflow-auto` gives scrollbars and nothing else, and a scrollbar is not
   * how anyone moves around a drawing — you push the paper. So the pointer
   * drags the scroll offsets directly.
   *
   * `setPointerCapture` is what makes it survive the pointer leaving the
   * element mid-drag, which happens constantly when you fling it; without it
   * the drag sticks and the diagram keeps following the mouse.
   */
  let frame = $state<HTMLDivElement | undefined>();
  let dragging = $state(false);
  let from = { x: 0, y: 0, left: 0, top: 0 };

  function grab(event: PointerEvent) {
    if (!actual || !frame) return;
    // Primary button only: a middle-click drag is the browser's own scroll.
    if (event.button !== 0) return;
    dragging = true;
    from = { x: event.clientX, y: event.clientY, left: frame.scrollLeft, top: frame.scrollTop };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function drag(event: PointerEvent) {
    if (!dragging || !frame) return;
    frame.scrollLeft = from.left - (event.clientX - from.x);
    frame.scrollTop = from.top - (event.clientY - from.y);
  }

  function release(event: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  }

  /**
   * The variants to offer, which always includes the one on screen.
   *
   * `hiddenByFilter` is the shared rule — only a definite non-fit is hidden.
   * The exception is the drawing currently displayed: it can be one the filter
   * would exclude, because a where-used jump lands on a specific drawing and
   * that is an explicit request. Leaving it out of the strip was how a diagram
   * came to be shown with no tab selected and nothing to say why, so it keeps
   * its tab and its `✗`.
   */
  const shown = $derived(
    browse.drawings.filter(
      (d) => d === browse.drawing || !hiddenByFilter(browse.fit.get(drawingKey(d))),
    ),
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
  <!--
    The variants as tabs across the top, not a column down the side.

    A subgroup can hold several `DRAWINGS` rows for the same table, each a
    different applicability, and choosing between them is part of reading the
    drawing. As a list it cost twelve rems of width permanently — for three or
    four entries — and that width belongs to the diagram.

    The strip **wraps**; it does not scroll. A cropped tab is a drawing you
    cannot see the name of and might not know is there, and these names run
    long — `ENGINE INLET SCREW ANCHOR AND TIE RODS` — so they get two lines and
    a fixed width, which also keeps the rows tidy instead of ragged.

    The name **and** the variant, because the name alone is not enough and that
    is the common case: a subgroup's five rows are routinely all called
    `SEMI-COMPLETE ENGINE`, differing only in which engine they apply to.
  -->
  {#if shown.length > 1}
    <div
      class="flex shrink-0 flex-wrap items-stretch gap-px border-b border-divider bg-surface"
      role="tablist"
      aria-label={t("drawing.variants", { count: browse.drawings.length })}
    >
      {#each shown as drawing (drawingKey(drawing))}
        {@const verdict = browse.fit.get(drawingKey(drawing))}
        {@const current = browse.drawing === drawing}
        <button
          class="flex w-[13.5rem] shrink-0 items-start gap-1.5 border-b-2 px-2 py-1 text-left
                 text-[11px] leading-snug transition-colors hover:bg-elevated {current
            ? 'border-accent bg-elevated font-medium text-accent'
            : 'border-transparent text-muted'}"
          role="tab"
          aria-selected={current}
          onclick={() => showDrawing(drawing)}
          title={[
            drawing.name ?? drawing.table,
            `${drawing.table} · v${drawing.variant}`,
            drawing.pattern ?? "",
            browse.source && drawing.pattern ? verdictLabel(verdict) : "",
          ]
            .filter(Boolean)
            .join(" — ")}
        >
          {#if browse.source && drawing.pattern}
            <span class="shrink-0 {mark(verdict)}">{glyph(verdict)}</span>
          {/if}
          <span class="line-clamp-2 min-w-0 flex-1">{drawing.name ?? drawing.table}</span>
          <span class="shrink-0 font-mono text-[10px] {current ? 'text-accent' : 'text-faint'}">
            v{drawing.variant}
          </span>
        </button>
      {/each}
      {#if shown.length !== browse.drawings.length}
        <span
          class="flex shrink-0 items-center px-2 font-mono text-[10px] tabular-nums text-faint"
          title={t("strip.filterTitle")}
        >
          {t("drawing.variantsOf", { shown: shown.length, total: browse.drawings.length })}
        </span>
      {/if}
    </div>
  {/if}

  <!--
    A frame that does not move, holding a viewport that does.

    The two buttons used to live *inside* the scroller, so panning a zoomed
    drawing carried them off the screen with it. They belong to the frame, not
    to the paper.
  -->
  <div class="relative flex min-h-0 min-w-0 flex-1">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      bind:this={frame}
      class="flex min-h-0 min-w-0 flex-1 overflow-auto p-3 {actual
        ? 'items-start justify-start'
        : 'items-center justify-center'} {actual
        ? dragging
          ? 'cursor-grabbing select-none'
          : 'cursor-grab'
        : ''}"
      onpointerdown={grab}
      onpointermove={drag}
      onpointerup={release}
      onpointercancel={release}
    >
      {#if browse.imageUrl}
        <!-- `draggable=false`: otherwise the browser starts its own image drag
             and the pan never begins. -->
        <img
          src={browse.imageUrl}
          alt={browse.drawing?.name ?? "drawing"}
          draggable="false"
          class={actual ? "max-w-none" : "max-h-full max-w-full object-contain"}
        />
      {:else if browse.drawing}
        <p class="text-xs text-faint">{t("drawing.none")}</p>
      {:else}
        <p class="text-xs text-faint">{t("drawing.pickSubgroup")}</p>
      {/if}
    </div>

    {#if browse.imageUrl}
      <!-- `pointer-events-none` on the strip and `auto` on the buttons, so the
           gap between them still belongs to the scroller underneath and can be
           dragged. -->
      <div class="pointer-events-none absolute right-3 top-3 z-10 flex gap-1">
        <button
          class="pointer-events-auto rounded border border-divider bg-surface/90 p-1 text-muted
                 backdrop-blur transition-colors hover:bg-elevated hover:text-foreground"
          onclick={copyDrawing}
          title={copied ? t("drawing.copied") : t("drawing.copy")}
          aria-label={t("drawing.copy")}
        >
          {#if copied}<Check size={13} />{:else}<Copy size={13} />{/if}
        </button>
        <button
          class="pointer-events-auto rounded border border-divider bg-surface/90 p-1 text-muted
                 backdrop-blur transition-colors hover:bg-elevated hover:text-foreground"
          onclick={() => (actual = !actual)}
          title={actual ? t("drawing.shrink") : t("drawing.expand")}
          aria-label={actual ? t("drawing.shrink") : t("drawing.expand")}
        >
          {#if actual}<Minimize2 size={13} />{:else}<Maximize2 size={13} />{/if}
        </button>
      </div>
    {/if}
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
        <span
          class="min-w-0 flex-1 truncate text-faint"
          title={explainPattern(browse.drawing.pattern)}
        >
          {explainPattern(browse.drawing.pattern)}
        </span>
      {/if}
    </footer>
  {/if}
</div>
