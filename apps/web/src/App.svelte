<script lang="ts">
  import Cascade from "./components/Cascade.svelte";
  import Connect from "./components/Connect.svelte";
  import DrawingView from "./components/DrawingView.svelte";
  import PartResults from "./components/PartResults.svelte";
  import ThemeToggle from "./components/ThemeToggle.svelte";
  import Wordmark from "./components/Wordmark.svelte";
  import { browse, loadMakes, runSearch } from "./lib/browse.svelte";
  import { setLanguage, stats, tree } from "./lib/tree.svelte";

  let query = $state("");

  // Part results take over the main pane while there are any; clearing the
  // box returns to the drawing, so there is no mode to get stuck in.
  const showingParts = $derived(browse.parts.length > 0);

  async function search() {
    if (query.trim()) await runSearch(query);
    else browse.parts = [];
  }

  async function changeLanguage(code: string) {
    setLanguage(code);
    // Every label came from a per-language join, so the whole tree is stale.
    await loadMakes();
  }

  const kb = (n: number) => `${(n / 1024).toFixed(0)} kB`;
</script>

<div class="flex h-full flex-col">
  <!-- Tricolor hairline: green / off-white / red, left to right. -->
  <div class="flex h-0.5 shrink-0">
    <div class="flex-1 bg-accent"></div>
    <div class="flex-1 bg-flag-white"></div>
    <div class="flex-1 bg-accent-alt"></div>
  </div>

  <header class="flex shrink-0 items-center gap-3 border-b border-divider bg-surface px-4 py-2">
    <Wordmark />
    <span class="hidden text-xs text-faint sm:inline">ePER parts catalogue, client-side</span>

    {#if tree.catalogue}
      <div class="flex-1"></div>
      <input
        class="w-56 rounded border border-divider bg-base px-2 py-1 font-mono text-xs
               outline-none focus:border-accent"
        bind:value={query}
        placeholder="part number"
        onkeydown={(e) => e.key === "Enter" && search()}
      />
      <button
        class="rounded px-2 py-1 text-xs text-muted transition-colors hover:bg-elevated
               hover:text-foreground"
        onclick={search}
      >
        Search
      </button>

      {#if tree.languages.length > 1}
        <select
          class="rounded border border-divider bg-base px-1 py-1 text-xs text-muted
                 outline-none focus:border-accent"
          value={tree.catalogue.language}
          onchange={(e) => changeLanguage(e.currentTarget.value)}
        >
          {#each tree.languages as language (language.code)}
            <option value={language.code}>{language.name}</option>
          {/each}
        </select>
      {/if}
    {:else}
      <div class="flex-1"></div>
    {/if}
    <ThemeToggle />
  </header>

  {#if !tree.catalogue}
    <main class="min-h-0 flex-1"><Connect /></main>
  {:else}
    <main class="flex min-h-0 flex-1 flex-col">
      {#if showingParts}
        <div class="flex min-h-0 flex-1"><PartResults /></div>
      {:else}
        <!-- Selectors across the top, diagram below. The cascade is five
             levels wide and would otherwise leave the drawing a sliver. -->
        <div class="flex h-64 shrink-0 border-b border-divider bg-surface">
          <Cascade />
        </div>
        <div class="flex min-h-0 flex-1"><DrawingView /></div>
      {/if}

      <footer
        class="flex shrink-0 items-center gap-4 border-t border-divider bg-surface px-4 py-1
               font-mono text-[11px]"
      >
        {#if browse.error}
          <span class="text-danger">{browse.error}</span>
        {:else if browse.busy}
          <span class="text-faint">reading…</span>
        {:else if browse.drawing}
          <span class="text-muted">
            {browse.catalogue?.code}/{browse.drawing.group}/{browse.drawing.subgroup}
            · {browse.drawing.table} v{browse.drawing.variant}
          </span>
        {/if}
        <div class="flex-1"></div>
        <span class="text-faint">{tree.backend} backend</span>
        <!-- Query count, not bytes: SQLite fetches its pages from inside a
             worker, whose resource timings the main thread cannot see, so a
             byte figure here would be a plausible-looking zero. The image is
             read by our own code, so that one is real. -->
        <span class="text-faint" title="SQL statements run against the tree">
          {stats.queries} queries
        </span>
        {#if browse.imageBytes}
          <span class="text-accent" title="The drawing itself, one ranged read">
            img {kb(browse.imageBytes)}
          </span>
        {/if}
      </footer>
    </main>
  {/if}
</div>
