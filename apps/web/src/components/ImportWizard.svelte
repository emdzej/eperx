<!--
  Building a tree from a disc, without leaving the browser.

  Four steps, because there are exactly two decisions to make: which folder the
  disc is, and — having been shown what is on it and what it will cost —
  whether to go ahead. The two in between are the machine's turn.

  The sizes shown are deliberately of two kinds. Drawings and chassis files are
  copied verbatim, so their size is known exactly; the catalogue's depends on
  how many rows survive the language filter, which cannot be known without
  doing the import. The second is labelled an estimate because it is one.
-->
<script lang="ts">
  import {
    fits,
    pickDisc,
    plannedBytes,
    resetWizard,
    startImport,
    wizard,
  } from "../lib/wizard.svelte";

  let { onImported }: { onImported?: () => void } = $props();

  const gb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(0)} MB`);

  const planned = $derived(plannedBytes());
  const room = $derived(fits());

  function toggleLanguage(code: string, on: boolean) {
    wizard.languages = on ? [...wizard.languages, code] : wizard.languages.filter((c) => c !== code);
  }

  type Component = "catalogue" | "accessories" | "images" | "chassis";

  /** The catalogue is not optional; there is no tree without it. */
  function included(key: Component): boolean {
    if (key === "catalogue") return true;
    if (key === "accessories") return wizard.accessories;
    if (key === "images") return wizard.images;
    return wizard.chassis;
  }

  function include(key: Component, on: boolean): void {
    if (key === "accessories") wizard.accessories = on;
    else if (key === "images") wizard.images = on;
    else if (key === "chassis") wizard.chassis = on;
  }

  const components = $derived(
    wizard.report
      ? ([
          ["catalogue", "Parts catalogue", wizard.report.sizes.catalogue, true, true],
          [
            "accessories",
            "Accessories (Mopar)",
            wizard.report.sizes.accessories,
            wizard.report.has.accessories,
            false,
          ],
          [
            "images",
            "Drawings",
            wizard.report.sizes.images,
            wizard.report.has.images,
            false,
          ],
          [
            "chassis",
            "Chassis and build records",
            wizard.report.sizes.chassis,
            wizard.report.has.chassis,
            false,
          ],
        ] as const)
      : [],
  );
</script>

<div class="flex flex-col gap-3">
  {#if wizard.step === "pick"}
<!-- What the section header does not already say: what to pick, and what
         it will demand of the machine. -->
    <p class="text-[11px] leading-relaxed text-faint">
      Pick the disc's root or its <span class="font-mono">data</span> folder. The catalogue is
      read into memory whole — 1.27&nbsp;GB on edition 83 — so this wants a desktop.
    </p>
    <button
      class="self-start rounded bg-accent px-3 py-1.5 text-xs font-medium text-flag-white
             transition-colors hover:bg-accent-muted disabled:opacity-50"
      disabled={wizard.busy}
      onclick={() => pickDisc()}
    >
      {wizard.busy ? "Reading the disc…" : "Choose the disc folder…"}
    </button>
  {/if}

  {#if wizard.step === "review" && wizard.report}
    <div class="flex items-baseline justify-between gap-2">
      <p class="text-xs text-foreground">
        <span class="font-medium">ePER {wizard.report.version}</span>
        <span class="text-faint"> release {wizard.report.release}</span>
      </p>
      <span class="font-mono text-[10px] text-faint">{wizard.sourceName}</span>
    </div>

    <div>
      <p class="mb-1 text-[10px] uppercase tracking-wide text-faint">Include</p>
      <div class="space-y-1">
        {#each components as [key, label, size, present, required] (key)}
          <label
            class="flex items-center gap-2 text-[11px] {present ? 'text-muted' : 'text-faint'}"
            title={present ? "" : "This disc does not carry it"}
          >
            <input
              type="checkbox"
              class="accent-accent"
              disabled={!present || required}
              checked={present && included(key)}
              onchange={(e) => include(key, e.currentTarget.checked)}
            />
            <span class="flex-1">{label}</span>
            <span class="font-mono text-[10px] text-faint">
              {present ? gb(size) : "absent"}
            </span>
          </label>
        {/each}
      </div>
    </div>

    {#if wizard.report.languages.length}
      <div>
        <p class="mb-1 text-[10px] uppercase tracking-wide text-faint">
          Languages
          <span class="normal-case tracking-normal">
            — the description tables are most of the catalogue's size
          </span>
        </p>
        <div class="grid max-h-40 grid-cols-2 gap-x-3 overflow-y-auto rounded border
                    border-divider p-1.5">
          {#each wizard.report.languages as lang (lang.code)}
            <label class="flex items-center gap-1.5 text-[11px] text-muted">
              <input
                type="checkbox"
                class="accent-accent"
                checked={wizard.languages.includes(lang.code)}
                onchange={(e) => toggleLanguage(lang.code, e.currentTarget.checked)}
              />
              <span class="min-w-0 flex-1 truncate" title={lang.name}>{lang.name}</span>
              <span class="shrink-0 font-mono text-[10px] text-faint">{lang.code}</span>
            </label>
          {/each}
        </div>
        {#if wizard.languages.length === 0}
          <p class="mt-1 text-[10px] text-warn">
            None ticked, which keeps every language — about two and a half times the rows.
          </p>
        {/if}
      </div>
    {/if}

    <div class="rounded border border-divider bg-base p-2 text-[11px]">
      <div class="flex justify-between">
        <span class="text-muted">Catalogue</span>
        <span class="font-mono text-faint">≈ {gb(planned.catalogue)}</span>
      </div>
      {#if planned.accessories}
        <div class="flex justify-between">
          <span class="text-muted">Accessories</span>
          <span class="font-mono text-faint">≈ {gb(planned.accessories)}</span>
        </div>
      {/if}
      <div class="flex justify-between">
        <span class="text-muted">Copied verbatim</span>
        <span class="font-mono text-faint">{gb(planned.exact)}</span>
      </div>
      <div class="mt-1 flex justify-between border-t border-rule pt-1 font-medium">
        <span class="text-foreground">Tree</span>
        <span class="font-mono text-foreground">≈ {gb(planned.total)}</span>
      </div>
      <p class="mt-1 text-[10px] leading-relaxed text-faint">
        The drawings and chassis files are exact — they are copied unchanged. The catalogue is an
        estimate: its size depends on how many rows survive the language filter, which is not
        knowable without doing the import.
      </p>
    </div>

    {#if room && room.short > 0}
      <p class="rounded border border-danger/40 bg-danger/10 px-2 py-1.5 text-[11px] text-danger">
        This will not fit. The browser will let this site store about
        <span class="font-mono">{gb(room.room)}</span> more, and the tree needs roughly
        <span class="font-mono">{gb(planned.total)}</span> — about
        <span class="font-mono">{gb(room.short)}</span> short. Untick the drawings, or keep fewer
        languages.
      </p>
    {:else if room}
      <p class="text-[10px] text-faint">
        Room to store <span class="font-mono">{gb(room.room)}</span>.
      </p>
    {/if}

    <div class="flex gap-2">
      <button
        class="rounded bg-accent px-3 py-1.5 text-xs font-medium text-flag-white
               transition-colors hover:bg-accent-muted disabled:opacity-50"
        disabled={wizard.busy}
        onclick={startImport}
      >
        Import
      </button>
      <button
        class="rounded border border-divider px-3 py-1.5 text-xs text-muted transition-colors
               hover:bg-elevated hover:text-foreground"
        onclick={resetWizard}
      >
        Choose a different folder
      </button>
    </div>
  {/if}

  {#if wizard.step === "running"}
    <p class="text-xs text-foreground">
      Importing <span class="font-mono text-[11px] text-faint">{wizard.sourceName}</span>
    </p>
    <div>
      <div class="flex justify-between text-[11px]">
        <span class="text-muted">{wizard.phase}</span>
        <span class="font-mono text-faint">{wizard.label}</span>
      </div>
      <div class="mt-1 h-1 overflow-hidden rounded bg-elevated">
        <div
          class="h-full bg-accent transition-all"
          style="width: {wizard.total ? Math.round((wizard.done / wizard.total) * 100) : 0}%"
        ></div>
      </div>
    </div>
    <p class="text-[10px] leading-relaxed text-faint">
      Reading the catalogue takes a couple of minutes and copying the drawings rather longer.
      Leaving this tab is fine — the work is in a worker — but closing it will abandon the
      import.
    </p>
  {/if}

  {#if wizard.step === "done" && wizard.result}
    <p class="text-xs text-foreground">Imported.</p>
    <ul class="space-y-0.5 font-mono text-[10px] text-faint">
      <li>{wizard.result.tables} tables, {wizard.result.rows.toLocaleString()} rows</li>
      <li>{wizard.result.indexes} indexes</li>
      {#if wizard.result.entries}
        <li>{wizard.result.entries.toLocaleString()} drawing entries indexed</li>
      {/if}
    </ul>
    <div class="flex gap-2">
      <button
        class="rounded bg-accent px-3 py-1.5 text-xs font-medium text-flag-white
               transition-colors hover:bg-accent-muted"
        onclick={() => {
          resetWizard();
          onImported?.();
        }}
      >
        Open it
      </button>
    </div>
  {/if}

  {#if wizard.error}
    <p class="rounded border border-danger/40 bg-danger/10 px-2 py-1.5 text-[11px] leading-relaxed
              text-danger">
      {wizard.error}
    </p>
    {#if wizard.step === "running"}
      <button
        class="self-start rounded border border-divider px-3 py-1.5 text-xs text-muted
               transition-colors hover:bg-elevated hover:text-foreground"
        onclick={resetWizard}
      >
        Start again
      </button>
    {/if}
  {/if}
</div>
