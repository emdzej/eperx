<script lang="ts">
  import { browse, showDrawing } from "../lib/browse.svelte";
</script>

<div class="flex min-h-0 flex-1">
  <!-- Variant strip: one entry per DRAWINGS row for this subgroup. Each is a
       different applicability, which is why the pattern is shown beside it. -->
  {#if browse.drawings.length > 1}
    <div class="flex w-56 shrink-0 flex-col border-r border-divider">
      <div
        class="shrink-0 border-b border-divider px-2 py-1 text-xs uppercase tracking-wide text-faint"
      >
        {browse.drawings.length} drawings
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        {#each browse.drawings as drawing (`${drawing.table}-${drawing.variant}-${drawing.revision}`)}
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
              <div class="truncate font-mono text-[10px] text-warn" title={drawing.pattern}>
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
            <span class="font-mono text-xs text-warn">{browse.drawing.pattern}</span>
            <span class="text-[10px] text-faint">uninterpreted</span>
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
              {#each browse.callouts as item (`${item.reference}-${item.sequence}-${item.part}`)}
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
                  <td class="px-3 py-1 font-mono text-warn">{item.formula ?? ""}</td>
                </tr>
              {:else}
                <tr><td colspan="5" class="px-3 py-3 text-center text-faint">No callouts.</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  </div>
</div>
