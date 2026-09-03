<script lang="ts">
  import { selectEntry, shard } from "../lib/shard.svelte";

  let filter = $state("");
  // Thumbnails double the list and are rarely what you want to look at.
  let hideThumbnails = $state(true);

  const visible = $derived(
    shard.entries.filter(
      (e) =>
        (!hideThumbnails || !e.name.toLowerCase().includes(".th.")) &&
        e.name.toLowerCase().includes(filter.toLowerCase()),
    ),
  );
</script>

<div class="flex min-h-0 flex-col">
  <div class="flex items-center gap-2 border-b border-divider px-3 py-2">
    <input
      class="min-w-0 flex-1 rounded border border-divider bg-base px-2 py-1 font-mono text-xs
             outline-none focus:border-accent"
      bind:value={filter}
      placeholder="filter entries"
    />
    <label class="flex shrink-0 items-center gap-1 text-xs text-muted">
      <input type="checkbox" bind:checked={hideThumbnails} class="accent-accent" />
      full only
    </label>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto">
    {#each visible as entry (entry.name)}
      <button
        class="flex w-full items-baseline gap-2 border-b border-rule px-3 py-1.5 text-left
               font-mono text-xs transition-colors hover:bg-elevated
               {shard.selected?.name === entry.name ? 'bg-elevated text-accent' : 'text-muted'}"
        onclick={() => selectEntry(entry)}
      >
        <span class="min-w-0 flex-1 truncate">{entry.name}</span>
        <span class="shrink-0 text-faint">{(entry.size / 1024).toFixed(0)} kB</span>
        {#if entry.method !== 0}
          <span class="shrink-0 text-warn" title="deflated, not stored">z</span>
        {/if}
      </button>
    {:else}
      <p class="px-3 py-6 text-center text-xs text-faint">
        {shard.entries.length ? "Nothing matches that filter." : "No shard open."}
      </p>
    {/each}
  </div>

  <div class="border-t border-divider px-3 py-1.5 text-xs text-faint">
    {visible.length.toLocaleString()} of {shard.entries.length.toLocaleString()} entries
  </div>
</div>
