<!--
  Group and subgroup, down the left.

  These stay as lists rather than becoming dropdowns: they are short — 20-odd
  groups and a dozen subgroups — and unlike the marque or the catalogue they
  are what you move around in while working, so seeing the neighbours matters.
-->
<script lang="ts">
  import { browse, selectGroup, selectSubgroup } from "../lib/browse.svelte";

  let filter = $state("");

  const groups = $derived(
    filter.trim()
      ? browse.groups.filter((group) =>
          (group.name ?? String(group.code)).toLowerCase().includes(filter.trim().toLowerCase()),
        )
      : browse.groups,
  );
</script>

<div class="flex min-h-0 w-60 shrink-0 flex-col border-r border-divider bg-surface">
  {#if browse.catalogue}
    <div class="shrink-0 border-b border-divider p-1.5">
      <input
        class="w-full rounded border border-divider bg-base px-2 py-1 text-[11px]
               outline-none focus:border-accent"
        bind:value={filter}
        placeholder="filter groups"
      />
    </div>
  {/if}

  <!-- Groups take the upper half, subgroups the lower, so both stay visible
       while moving between them. -->
  <div class="flex min-h-0 flex-1 flex-col">
    <div
      class="shrink-0 border-b border-divider px-2 py-1 text-[10px] uppercase tracking-wide
             text-faint"
    >
      Group
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      {#each groups as group (group.code)}
        <button
          class="flex w-full items-baseline gap-2 border-b border-rule px-2 py-1 text-left
                 text-xs transition-colors hover:bg-elevated {browse.group?.code === group.code
            ? 'bg-elevated font-medium text-accent'
            : 'text-muted'}"
          onclick={() => selectGroup(group)}
        >
          <span class="min-w-0 flex-1 truncate" title={group.name ?? ""}>
            {group.name ?? `(${group.code})`}
          </span>
          <span class="shrink-0 font-mono text-[10px] text-faint">{group.code}</span>
        </button>
      {:else}
        <p class="px-2 py-4 text-center text-[11px] text-faint">
          {browse.catalogue ? "No groups match." : "Pick a catalogue above."}
        </p>
      {/each}
    </div>

    <div
      class="shrink-0 border-y border-divider px-2 py-1 text-[10px] uppercase tracking-wide
             text-faint"
    >
      Subgroup
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      {#each browse.subgroups as subgroup (subgroup.code)}
        <button
          class="flex w-full items-baseline gap-2 border-b border-rule px-2 py-1 text-left
                 text-xs transition-colors hover:bg-elevated {browse.subgroup?.code ===
          subgroup.code
            ? 'bg-elevated font-medium text-accent'
            : 'text-muted'}"
          onclick={() => selectSubgroup(subgroup)}
        >
          <span class="min-w-0 flex-1 truncate" title={subgroup.name ?? ""}>
            {subgroup.name ?? `(${subgroup.code})`}
          </span>
          <span class="shrink-0 font-mono text-[10px] text-faint">{subgroup.drawings}</span>
        </button>
      {:else}
        <p class="px-2 py-4 text-center text-[11px] text-faint">
          {browse.group ? "No subgroups." : "Pick a group."}
        </p>
      {/each}
    </div>
  </div>
</div>
