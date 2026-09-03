<script lang="ts">
  import { browse, searchVersions, selectVersion } from "../lib/browse.svelte";

  // A catalogue can hold 10,436 versions, so the list is searchable and
  // capped rather than complete.
  let query = $state("");
  let open = $state(false);

  async function search() {
    await searchVersions(query);
    open = true;
  }

  async function clear() {
    await selectVersion(undefined);
    open = false;
  }
</script>

<div class="flex min-h-0 w-64 shrink-0 flex-col border-l border-divider">
  <div
    class="flex shrink-0 items-baseline gap-2 border-b border-divider px-2 py-1 text-xs uppercase
           tracking-wide text-faint"
  >
    <span>Vehicle</span>
    {#if browse.version}
      <button class="ml-auto normal-case text-accent hover:underline" onclick={clear}>
        clear
      </button>
    {/if}
  </div>

  {#if browse.version && !open}
    <button
      class="border-b border-divider px-2 py-2 text-left transition-colors hover:bg-elevated"
      onclick={() => (open = true)}
    >
      <div class="font-mono text-[11px] text-accent">{browse.version.sincom}</div>
      <div class="text-xs leading-snug text-foreground">{browse.version.description}</div>
      {#if browse.version.engine}
        <div class="mt-0.5 font-mono text-[10px] text-faint">engine {browse.version.engine}</div>
      {/if}
    </button>

    <label class="flex items-center gap-2 border-b border-divider px-2 py-1.5 text-xs text-muted">
      <input type="checkbox" bind:checked={browse.hideUnfit} class="accent-accent" />
      hide what does not fit
    </label>

    <!-- The reading being used, stated on screen. Choosing one value for a
         criteria type is taken to exclude the others; that is an inference,
         and it is the difference between a usable filter and everything
         reading "cannot tell". -->
    <p class="px-2 py-2 text-[10px] leading-relaxed text-faint">
      Applicability is reconstructed, not read from ePER. A version's
      specification is closed per criteria type — one displacement, one fuel —
      so choosing a value excludes the alternatives.
      <strong class="font-normal text-muted">Check anything you rely on.</strong>
    </p>
  {:else}
    <div class="flex shrink-0 gap-1 border-b border-divider px-2 py-1.5">
      <input
        class="min-w-0 flex-1 rounded border border-divider bg-base px-1.5 py-0.5 text-xs
               outline-none focus:border-accent"
        bind:value={query}
        placeholder="version or SINCOM"
        onkeydown={(e) => e.key === "Enter" && search()}
      />
      <button
        class="rounded px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-elevated
               hover:text-foreground"
        onclick={search}
      >
        Find
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      {#each browse.versions as version (version.sincom ?? `${version.model}${version.version}`)}
        <button
          class="w-full border-b border-rule px-2 py-1 text-left transition-colors
                 hover:bg-elevated"
          onclick={() => {
            selectVersion(version);
            open = false;
          }}
        >
          <div class="truncate text-[11px] leading-snug text-muted" title={version.description ?? ""}>
            {version.description ?? version.sincom}
          </div>
          <div class="font-mono text-[10px] text-faint">{version.sincom}</div>
        </button>
      {:else}
        <p class="px-2 py-4 text-center text-[11px] text-faint">
          {browse.catalogue ? "No versions match." : "Pick a catalogue first."}
        </p>
      {/each}
    </div>

    {#if browse.versions.length >= 200}
      <div class="shrink-0 border-t border-divider px-2 py-1 text-[10px] text-faint">
        first 200 — narrow the search
      </div>
    {/if}
  {/if}
</div>
