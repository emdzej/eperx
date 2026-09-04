<!--
  Which vehicle, so that applicability can be decided.

  A dropdown over the sold versions, plus a VIN lookup behind a small button —
  a VIN needs a form and a form does not belong inside a listbox. Once a
  vehicle is chosen the control collapses to a chip naming it, with the filter
  toggle beside it, because that is the state you spend time in.

  A VIN is better than a version when it is available: `SP.RT` holds that
  individual car's build record, so the criteria are the car's own rather than
  its model variant's.
-->
<script lang="ts">
  import Combobox from "./Combobox.svelte";
  import {
    applyVin,
    browse,
    searchVersions,
    selectVersion,
    specificationLabel,
  } from "../lib/browse.svelte";
  import { hasChassisData, lookupVin, vin } from "../lib/vin.svelte";

  let vinOpen = $state(false);
  let vinQuery = $state("");
  let chassisAvailable = $state(false);
  let panelEl = $state<HTMLDivElement | undefined>();

  $effect(() => {
    void hasChassisData().then((available) => (chassisAvailable = available));
  });

  const chosen = $derived(specificationLabel());

  const versions = $derived(
    browse.versions.map((version) => ({
      id: version.sincom ?? `${version.model}${version.version}${version.series}`,
      label: version.description ?? version.sincom ?? "—",
      subtitle: version.sincom ?? undefined,
    })),
  );

  function pickVersion(id: string) {
    const version = browse.versions.find(
      (v) => (v.sincom ?? `${v.model}${v.version}${v.series}`) === id,
    );
    if (version) void selectVersion(version);
  }

  async function findVin() {
    await lookupVin(vinQuery);
    if (vin.buildRecord) {
      await applyVin();
      vinOpen = false;
    }
  }

  // Close the VIN panel on an outside click, only while it is open.
  $effect(() => {
    if (!vinOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && !panelEl?.contains(target)) vinOpen = false;
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  });
</script>

<div class="relative flex min-w-0 items-center gap-2" bind:this={panelEl}>
  {#if chosen}
    <span
      class="flex min-w-0 items-center gap-2 rounded border border-accent/40 bg-accent/10 px-2
             py-1"
      title={browse.source === "vin" ? "From this car's build record" : "From the version"}
    >
      <span class="shrink-0 text-[10px] uppercase tracking-wide text-accent">
        {browse.source === "vin" ? "VIN" : "Version"}
      </span>
      <span class="min-w-0 max-w-[22rem] truncate text-xs text-foreground">{chosen}</span>
      <button
        class="shrink-0 text-faint transition-colors hover:text-danger"
        onclick={() => selectVersion(undefined)}
        aria-label="Clear the chosen vehicle"
        title="Clear"
      >
        ×
      </button>
    </span>

    <label class="flex shrink-0 items-center gap-1 text-[11px] text-muted" title="Hide drawings and parts this vehicle definitely cannot have">
      <input type="checkbox" bind:checked={browse.hideUnfit} class="accent-accent" />
      filter
    </label>
  {:else}
    <Combobox
      label="Vehicle"
      items={versions}
      value={undefined}
      placeholder={browse.catalogue ? "any" : "pick a catalogue"}
      width="18rem"
      disabled={!browse.catalogue}
      onsearch={(query) => void searchVersions(query)}
      onpick={pickVersion}
    />

    <button
      class="shrink-0 rounded border border-divider px-2 py-1 text-[11px] text-muted
             transition-colors hover:bg-elevated hover:text-foreground disabled:opacity-40"
      disabled={!chassisAvailable || !browse.catalogue}
      title={chassisAvailable
        ? "Look the vehicle up by VIN"
        : "This tree was imported without the chassis files"}
      onclick={() => (vinOpen = !vinOpen)}
    >
      VIN
    </button>
  {/if}

  {#if vinOpen}
    <div
      class="absolute right-0 top-full z-30 mt-1 w-80 rounded border border-divider bg-surface
             p-3 shadow-xl"
    >
      <div class="flex gap-1">
        <input
          class="min-w-0 flex-1 rounded border border-divider bg-base px-2 py-1 font-mono
                 text-[11px] uppercase outline-none focus:border-accent"
          bind:value={vinQuery}
          placeholder="ZFA31200000315929"
          maxlength="17"
          onkeydown={(e) => e.key === "Enter" && findVin()}
        />
        <button
          class="rounded bg-accent px-2 py-1 text-[11px] font-medium text-flag-white
                 transition-colors hover:bg-accent-muted disabled:opacity-50"
          disabled={vin.busy}
          onclick={findVin}
        >
          {vin.busy ? "…" : "Find"}
        </button>
      </div>

      <div class="mt-2">
        {#if vin.error}
          <p class="text-[11px] leading-relaxed text-danger">{vin.error}</p>
        {:else if vin.highest.length}
          <p class="text-[11px] text-warn">Not on this disc.</p>
          <ul class="mt-1 space-y-0.5 font-mono text-[10px] text-faint">
            {#each vin.highest as entry (entry.model)}
              <li>
                model {entry.model} reaches {entry.chassis}{#if entry.beyond}
                  <span class="text-muted"> — this one is beyond it</span>{/if}
              </li>
            {/each}
          </ul>
          <p class="mt-2 text-[10px] leading-relaxed text-faint">
            A disc is a snapshot; vehicles built after it was pressed are absent.
          </p>
        {:else}
          <p class="text-[10px] leading-relaxed text-faint">
            A Fiat-group VIN carries the model type code and the chassis number, which is how
            ePER's own index is keyed. The 420 MB chassis file is read over
            <span class="font-mono">Range</span> — about fifteen small reads and one block.
          </p>
        {/if}
      </div>
    </div>
  {/if}
</div>
