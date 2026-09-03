<script lang="ts">
  import { browse, openUsage, selectPart } from "../lib/browse.svelte";
</script>

<div class="flex min-h-0 flex-1 divide-x divide-divider">
  <div class="flex min-h-0 w-80 shrink-0 flex-col">
    <div
      class="shrink-0 border-b border-divider px-3 py-1 text-xs uppercase tracking-wide text-faint"
    >
      {browse.parts.length} parts
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      {#each browse.parts as part (part.code)}
        <button
          class="w-full border-b border-rule px-3 py-1.5 text-left transition-colors
                 hover:bg-elevated {browse.part?.code === part.code ? 'bg-elevated' : ''}"
          onclick={() => selectPart(part)}
        >
          <div
            class="font-mono text-xs {browse.part?.code === part.code
              ? 'text-accent'
              : 'text-foreground'}"
          >
            {part.code}
          </div>
          <div class="truncate text-xs text-muted">{part.name ?? "—"}</div>
          {#if part.family}
            <div class="truncate text-[10px] text-faint">{part.family}</div>
          {/if}
        </button>
      {/each}
    </div>
  </div>

  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    {#if browse.part}
      <div class="shrink-0 border-b border-divider px-3 py-2">
        <div class="font-mono text-sm text-foreground">{browse.part.code}</div>
        <div class="text-xs text-muted">{browse.part.name ?? "—"}</div>
        <div class="mt-1 flex gap-4 font-mono text-[10px] text-faint">
          {#if browse.part.unit}<span>unit {browse.part.unit}</span>{/if}
          {#if browse.part.minimumQuantity}<span>min {browse.part.minimumQuantity}</span>{/if}
          {#if browse.part.weight}<span>{browse.part.weight} g</span>{/if}
        </div>
      </div>
      <div
        class="shrink-0 border-b border-divider px-3 py-1 text-xs uppercase tracking-wide text-faint"
      >
        appears on {browse.usages.length} drawings
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        {#each browse.usages as usage (`${usage.catalogue}-${usage.table}-${usage.variant}-${usage.reference}`)}
          <button
            class="flex w-full items-baseline gap-2 border-b border-rule px-3 py-1 text-left
                   text-xs text-muted transition-colors hover:bg-elevated"
            onclick={() => openUsage(usage)}
          >
            <span class="w-8 shrink-0 font-mono text-faint">{usage.catalogue}</span>
            <span class="min-w-0 flex-1 truncate">{usage.catalogueName}</span>
            <span class="shrink-0 font-mono text-faint">
              {usage.group}/{usage.subgroup} · {usage.table} · ref {usage.reference}
            </span>
          </button>
        {/each}
      </div>
    {:else}
      <p class="p-6 text-center text-xs text-faint">
        Pick a part to see every drawing it appears on.
      </p>
    {/if}
  </div>
</div>
