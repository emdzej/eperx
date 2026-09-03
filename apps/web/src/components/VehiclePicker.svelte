<script lang="ts">
  import {
    applyVin,
    browse,
    searchVersions,
    selectVersion,
    specificationLabel,
  } from "../lib/browse.svelte";
  import { hasChassisData, lookupVin, vin } from "../lib/vin.svelte";

  // A catalogue can hold 10,436 versions, so the version list is searchable
  // and capped rather than complete.
  let query = $state("");
  let vinQuery = $state("");
  let open = $state(false);
  let byVin = $state(false);
  let chassisAvailable = $state(false);

  $effect(() => {
    void hasChassisData().then((available) => (chassisAvailable = available));
  });

  async function search() {
    await searchVersions(query);
    open = true;
  }

  async function findVin() {
    await lookupVin(vinQuery);
    if (vin.buildRecord) {
      await applyVin();
      open = false;
    }
  }

  async function clear() {
    await selectVersion(undefined);
    open = false;
  }

  const chosen = $derived(specificationLabel());
</script>

<div class="flex min-h-0 w-64 shrink-0 flex-col border-l border-divider">
  <div
    class="flex shrink-0 items-baseline gap-2 border-b border-divider px-2 py-1 text-xs uppercase
           tracking-wide text-faint"
  >
    <span>Vehicle</span>
    {#if chosen}
      <button class="ml-auto normal-case text-accent hover:underline" onclick={clear}>
        clear
      </button>
    {/if}
  </div>

  {#if chosen && !open}
    <button
      class="border-b border-divider px-2 py-2 text-left transition-colors hover:bg-elevated"
      onclick={() => (open = true)}
    >
      <div class="font-mono text-[11px] text-accent">
        {browse.source === "vin" ? vin.query : browse.version?.sincom}
      </div>
      <div class="text-xs leading-snug text-foreground">{chosen}</div>
      <div class="mt-0.5 text-[10px] text-faint">
        {browse.source === "vin" ? "from this car's build record" : "from the version"}
      </div>
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
      Applicability is reconstructed, not read from ePER. A specification is
      closed per criteria type — one displacement, one fuel — so choosing a
      value excludes the alternatives.
      <strong class="font-normal text-muted">Check anything you rely on.</strong>
    </p>
  {:else}
    <div class="flex shrink-0 border-b border-divider text-xs">
      <button
        class="flex-1 px-2 py-1.5 transition-colors
               {byVin ? 'text-muted hover:bg-elevated' : 'bg-elevated text-accent'}"
        onclick={() => (byVin = false)}
      >
        By version
      </button>
      <button
        class="flex-1 px-2 py-1.5 transition-colors disabled:opacity-40
               {byVin ? 'bg-elevated text-accent' : 'text-muted hover:bg-elevated'}"
        disabled={!chassisAvailable}
        title={chassisAvailable ? "" : "This tree was imported without the chassis files"}
        onclick={() => (byVin = true)}
      >
        By VIN
      </button>
    </div>

    {#if byVin}
      <div class="flex shrink-0 gap-1 border-b border-divider px-2 py-1.5">
        <input
          class="min-w-0 flex-1 rounded border border-divider bg-base px-1.5 py-0.5 font-mono
                 text-[11px] uppercase outline-none focus:border-accent"
          bind:value={vinQuery}
          placeholder="ZFA31200000315929"
          maxlength="17"
          onkeydown={(e) => e.key === "Enter" && findVin()}
        />
        <button
          class="rounded px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-elevated
                 hover:text-foreground"
          disabled={vin.busy}
          onclick={findVin}
        >
          {vin.busy ? "…" : "Find"}
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {#if vin.error}
          <p class="text-[11px] leading-relaxed text-danger">{vin.error}</p>
        {:else if vin.highest.length}
          <p class="text-[11px] leading-relaxed text-warn">Not on this disc.</p>
          <ul class="mt-1 space-y-0.5 font-mono text-[10px] text-faint">
            {#each vin.highest as entry (entry.model)}
              <li>
                model {entry.model} reaches {entry.chassis}{#if entry.beyond}
                  <span class="text-muted">— this one is beyond it</span>{/if}
              </li>
            {/each}
          </ul>
          <p class="mt-2 text-[10px] leading-relaxed text-faint">
            A disc is a snapshot; vehicles built after it was pressed are absent.
          </p>
        {:else if vin.chassisRecord || vin.buildRecord}
          <dl class="space-y-1 text-[10px]">
            {#each Object.entries(vin.chassisRecord ?? {}).filter(([, v]) => v) as [key, value] (key)}
              <div class="flex gap-2">
                <dt class="w-20 shrink-0 text-faint">{key}</dt>
                <dd class="min-w-0 flex-1 break-all font-mono text-muted">{value}</dd>
              </div>
            {/each}
          </dl>
        {:else}
          <p class="text-[11px] leading-relaxed text-faint">
            A Fiat-group VIN carries the model type code and the chassis number, which is
            how ePER's own index is keyed. The 420 MB chassis file is read over
            <span class="font-mono">Range</span> — about fifteen 19-byte reads and one block.
          </p>
        {/if}
      </div>
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
            <div
              class="truncate text-[11px] leading-snug text-muted"
              title={version.description ?? ""}
            >
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
  {/if}
</div>
