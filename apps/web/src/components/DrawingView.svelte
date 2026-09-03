<script lang="ts">
  import {
    browse,
    calloutKey,
    drawingKey,
    explainPattern,
    showDrawing,
  } from "../lib/browse.svelte";

  // A drawing or callout is hidden only when it *definitely* does not fit.
  // "Unknown" is always shown: declining to answer must not look like an
  // answer, and hiding on uncertainty would quietly lose real parts.
  const hidden = (verdict: string | undefined) =>
    browse.version !== undefined && browse.hideUnfit && verdict === "false";

  const visibleDrawings = $derived(
    browse.drawings.filter((d) => !hidden(browse.fit.get(drawingKey(d)))),
  );
  const visibleCallouts = $derived(
    browse.callouts.filter((c) => !hidden(browse.calloutFit.get(calloutKey(c)))),
  );

  const mark = (verdict: string | undefined) =>
    verdict === "true" ? "text-ok" : verdict === "false" ? "text-danger" : "text-warn";
  const label = (verdict: string | undefined) =>
    verdict === "true" ? "fits" : verdict === "false" ? "does not fit" : "not determined";
</script>

<div class="flex min-h-0 flex-1">
  <!-- Variant strip: one entry per DRAWINGS row for this subgroup. Each is a
       different applicability, which is why the pattern is shown beside it. -->
  {#if visibleDrawings.length > 1}
    <div class="flex w-56 shrink-0 flex-col border-r border-divider">
      <div
        class="shrink-0 border-b border-divider px-2 py-1 text-xs uppercase tracking-wide text-faint"
      >
        {visibleDrawings.length}{#if visibleDrawings.length !== browse.drawings.length}<span
            class="normal-case text-faint"> of {browse.drawings.length}</span
          >{/if} drawings
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        {#each visibleDrawings as drawing (`${drawing.table}-${drawing.variant}-${drawing.revision}`)}
          <button
            class="w-full border-b border-rule px-2 py-1.5 text-left transition-colors
                   hover:bg-elevated
                   {browse.drawing === drawing ? 'bg-elevated' : ''}"
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
                class="truncate font-mono text-[10px] {browse.version
                  ? mark(browse.fit.get(drawingKey(drawing)))
                  : 'text-warn'}"
                title={browse.version
                  ? `${label(browse.fit.get(drawingKey(drawing)))} — ${drawing.pattern}`
                  : drawing.pattern}
              >
                {drawing.pattern}
              </div>
            {/if}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <div class="flex min-w-0 flex-1 flex-col">
    <div class="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
      {#if browse.imageUrl}
        <img
          src={browse.imageUrl}
          alt={browse.drawing?.name ?? "drawing"}
          class="max-h-full max-w-full object-contain"
        />
      {:else if browse.drawing}
        <p class="text-xs text-faint">No image for this drawing.</p>
      {:else}
        <p class="text-xs text-faint">Pick a subgroup.</p>
      {/if}
    </div>

    {#if browse.drawing}
      <div class="shrink-0 border-t border-divider">
        {#if browse.drawing.pattern}
          <!-- Verbatim, and marked as such. The grammar is characterised but
               not verified, so eperx does not claim to have evaluated it. -->
          <div class="flex items-baseline gap-2 border-b border-rule px-3 py-1">
            <span class="text-xs uppercase tracking-wide text-faint">fits</span>
            <span
              class="font-mono text-xs {browse.version
                ? mark(browse.fit.get(drawingKey(browse.drawing)))
                : 'text-warn'}">{browse.drawing.pattern}</span
            >
            {#if browse.version}
              <span class="text-[10px] {mark(browse.fit.get(drawingKey(browse.drawing)))}">
                {label(browse.fit.get(drawingKey(browse.drawing)))}
              </span>
            {/if}
            <!-- The expression in words, so the reader can disagree with it
                 rather than having to trust it. -->
            <span class="min-w-0 flex-1 truncate text-[10px] text-faint">
              {explainPattern(browse.drawing.pattern)}
            </span>
          </div>
        {/if}
        <div class="max-h-56 overflow-auto">
          <table class="w-full min-w-[36rem] text-xs">
            <thead class="sticky top-0 bg-surface text-faint">
              <tr class="border-b border-divider">
                <th class="w-14 px-3 py-1 text-left font-normal">Ref</th>
                <th class="px-2 py-1 text-left font-normal">Part</th>
                <th class="px-2 py-1 text-left font-normal">Description</th>
                <th class="w-16 px-2 py-1 text-right font-normal">Qty</th>
                <th class="w-40 px-3 py-1 text-left font-normal">Fits</th>
              </tr>
            </thead>
            <tbody>
              {#each visibleCallouts as item (`${item.reference}-${item.sequence}-${item.part}`)}
                <tr class="border-b border-rule hover:bg-elevated">
                  <td class="px-3 py-1 font-mono text-accent">
                    {item.reference}{#if item.sequence > 1}<span class="text-faint"
                        >.{item.sequence}</span
                      >{/if}
                  </td>
                  <td class="px-2 py-1 font-mono text-foreground">{item.part}</td>
                  <td class="px-2 py-1 text-muted">
                    {item.name ?? ""}
                    {#if item.qualifier}<span class="text-faint">{item.qualifier}</span>{/if}
                  </td>
                  <td class="px-2 py-1 text-right font-mono text-muted">{item.quantity ?? ""}</td>
                  <td
                    class="px-3 py-1 font-mono {browse.version
                      ? mark(browse.calloutFit.get(calloutKey(item)))
                      : 'text-warn'}"
                    title={item.formula ? explainPattern(item.formula) : ""}
                  >
                    {item.formula ?? ""}
                  </td>
                </tr>
              {:else}
                <tr
                  ><td colspan="5" class="px-3 py-3 text-center text-faint"
                    >{browse.callouts.length
                      ? "Every callout is filtered out for this version."
                      : "No callouts."}</td
                  ></tr
                >
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  </div>
</div>
