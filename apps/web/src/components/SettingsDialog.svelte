<!--
  Settings, and the first-run prompt, which are the same thing.

  On a first visit nothing has been chosen, so this opens on the Data tab and
  cannot be dismissed — there is no app to return to until a source is picked.
  Afterwards it is reachable from the gear and closes like any dialog.

  Tabs, with one tab. The frame is here because settings accrete and moving a
  single panel into a tabbed shell later is a worse change than starting with
  the shell.
-->
<script lang="ts">
  import DataSettings from "./DataSettings.svelte";
  import InterfaceSettings from "./InterfaceSettings.svelte";
  import { i18n } from "../lib/i18n/index.svelte";

  let {
    onClose,
    firstRun = false,
  }: { onClose: () => void; firstRun?: boolean } = $props();

  type Tab = "data" | "interface";
  let tab = $state<Tab>("data");

  const t = $derived(i18n.t);

  // Labels are derived, not constant: a constant array would keep the
  // language it was built with when the interface language changes.
  const TABS = $derived<{ id: Tab; label: string }[]>([
    { id: "data", label: t("settings.tab.data") },
    { id: "interface", label: t("settings.tab.interface") },
  ]);

  function onKey(event: KeyboardEvent): void {
    // A first run has nothing behind it, so Escape would leave a blank page.
    if (event.key === "Escape" && !firstRun) onClose();
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="fixed inset-0 z-40 grid place-items-center bg-black/45 p-6"
  role="presentation"
  onclick={() => !firstRun && onClose()}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="max-h-full w-full max-w-2xl overflow-y-auto border border-divider border-l-[3px]
           border-l-accent bg-surface"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    aria-label={firstRun ? "Choose a data source" : "Settings"}
    onclick={(event) => event.stopPropagation()}
  >
    <header class="flex items-center border-b border-divider px-4 pb-2 pt-3">
      <div>
        <span class="text-[10px] uppercase tracking-wide text-faint">
          {firstRun ? "Welcome" : "Settings"}
        </span>
        <h2 class="text-sm font-medium text-foreground">
          {firstRun ? "Choose where the catalogue comes from" : "Settings"}
        </h2>
      </div>
      {#if !firstRun}
        <button
          class="ml-auto px-1.5 text-xl leading-none text-faint transition-colors
                 hover:text-danger"
          onclick={onClose}
          aria-label="Close"
        >
          ×
        </button>
      {/if}
    </header>

    {#if firstRun}
      <p class="border-b border-divider px-4 py-2 text-[11px] leading-relaxed text-muted">
        eperx ships without data. Point it at a tree produced by
        <span class="font-mono">eperx import</span> — this choice is remembered, so you
        will not be asked again.
      </p>
    {/if}

    <nav class="flex gap-1 border-b border-divider px-3 pt-2" aria-label={t("settings.sections")}>
      {#each TABS as entry (entry.id)}
        <button
          class="border-b-2 px-2 pb-1.5 text-xs transition-colors
                 {tab === entry.id
            ? 'border-accent text-accent'
            : 'border-transparent text-muted hover:text-foreground'}"
          onclick={() => (tab = entry.id)}
          aria-current={tab === entry.id ? "page" : undefined}
        >
          {entry.label}
        </button>
      {/each}
    </nav>

    <div class="p-4">
      {#if tab === "interface"}
        <InterfaceSettings />
      {:else if tab === "data"}
        <DataSettings onOpened={onClose} />
      {/if}
    </div>
  </div>
</div>
