<!--
  A filterable list for the rail.

  Group and subgroup are the same control twice, so it is written once. They
  stay lists rather than becoming dropdowns because they are short — 20-odd
  groups, a dozen subgroups — and unlike the marque or the catalogue they are
  what you move around in while working, so seeing the neighbours matters.

  The header carries a count, which is the cheap thing a rail can tell you
  before you read it: `GROUP 27` says how much there is to go through, and
  when a filter is active it says how much of it you are looking at.
-->
<script lang="ts">
  export interface ListItem {
    key: string;
    /** Shown in mono on the left. The catalogue's own number. */
    code: string;
    name: string;
    /** A second line, when the row has one — a subgroup's drawing count. */
    note?: string;
  }

  interface Props {
    label: string;
    items: ListItem[];
    selectedKey?: string;
    placeholder: string;
    /** Shown instead of the list when there is nothing to show yet. */
    emptyHint: string;
    /** Shown when a filter has excluded everything. */
    noMatch: string;
    onSelect: (item: ListItem) => void;
  }

  let { label, items, selectedKey, placeholder, emptyHint, noMatch, onSelect }: Props = $props();

  let filter = $state("");

  // A `$derived` rather than a side effect, which is what makes it feel live:
  // every keystroke recomputes it.
  const shown = $derived.by(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(query) || item.code.toLowerCase().includes(query),
    );
  });

  // The filter is per-list and meaningless against a different set, so it is
  // dropped when the items change underneath it — picking another catalogue
  // should not leave the group list filtered by a word from the last one.
  $effect(() => {
    void items;
    filter = "";
  });
</script>

<section class="flex min-h-0 flex-1 flex-col">
  <header
    class="flex shrink-0 items-baseline justify-between border-b border-divider px-2 py-1
           text-[10px] uppercase tracking-wide text-faint"
  >
    <span>{label}</span>
    {#if items.length}
      <span class="font-mono tabular-nums">
        {#if shown.length !== items.length}{shown.length}/{/if}{items.length}
      </span>
    {/if}
  </header>

  {#if items.length}
    <div class="shrink-0 border-b border-divider p-1.5">
      <input
        class="w-full rounded border border-divider bg-base px-2 py-1 text-[11px]
               outline-none focus:border-accent"
        bind:value={filter}
        {placeholder}
        aria-label={placeholder}
      />
    </div>
  {/if}

  <div class="min-h-0 flex-1 overflow-y-auto">
    {#each shown as item (item.key)}
      {@const selected = item.key === selectedKey}
      <button
        class="flex w-full items-baseline gap-2 border-b border-rule px-2 py-1 text-left
               text-xs transition-colors hover:bg-elevated {selected
          ? 'bg-elevated font-medium text-accent'
          : 'text-muted'}"
        onclick={() => onSelect(item)}
        aria-current={selected ? "true" : undefined}
      >
        <!-- The code first and in mono, because it is what the data and the
             drawings are keyed by, and it is what someone reads off a plate. -->
        <span
          class="w-8 shrink-0 font-mono tabular-nums {selected ? 'text-accent' : 'text-faint'}"
        >
          {item.code}
        </span>
        <span class="min-w-0 flex-1 truncate" title={item.name}>{item.name}</span>
        {#if item.note}
          <span class="shrink-0 font-mono text-[10px] text-faint">{item.note}</span>
        {/if}
      </button>
    {:else}
      <p class="px-2 py-4 text-center text-[11px] text-faint">
        {items.length ? noMatch : emptyHint}
      </p>
    {/each}
  </div>
</section>
