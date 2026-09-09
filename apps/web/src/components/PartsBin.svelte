<!--
  The pick list.

  A dialog rather than a fourth column: assembling a bin is done across many
  drawings, but reading it back is a separate act — you stop looking things up
  and start ordering. Giving it permanent screen space would cost the drawing
  width for something consulted at the end.

  It carries its own provenance because a pick list is acted on away from the
  screen: "which drawing was this?" has to be answerable from the paper.
-->
<script lang="ts">
  import Printer from "@lucide/svelte/icons/printer";
  import Download from "@lucide/svelte/icons/download";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import X from "@lucide/svelte/icons/x";
  import { bin, download, toCsv } from "../lib/bin.svelte";
  import { i18n } from "../lib/i18n/index.svelte";
  import { notes } from "../lib/notes.svelte";

  let { onClose }: { onClose: () => void } = $props();

  const t = $derived(i18n.t);

  function onKey(event: KeyboardEvent) {
    if (event.key === "Escape") onClose();
  }

  function exportCsv() {
    const headers = [
      t("bin.part"),
      t("parts.ref"),
      t("bin.name"),
      t("bin.quantity"),
      t("toolbar.catalogue"),
      t("rail.group"),
      t("drawing.fits"),
      t("toolbar.vehicle"),
      t("bin.note"),
    ];
    // A BOM here and nowhere else: it is what makes Excel read a UTF-8 CSV as
    // UTF-8 rather than the system code page.
    download(t("bin.file"), toCsv(bin.entries, headers, (n) => notes.get(n)), { bom: true });
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="fixed inset-0 z-40 grid place-items-center bg-black/45 p-6"
  role="presentation"
  onclick={onClose}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="flex max-h-full w-full max-w-3xl flex-col border border-divider border-l-[3px]
           border-l-accent bg-surface"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    aria-label={t("bin.title")}
    onclick={(event) => event.stopPropagation()}
  >
    <header class="flex shrink-0 items-baseline gap-2 border-b border-divider px-4 pb-2 pt-3">
      <h2 class="text-sm font-medium text-foreground">{t("bin.title")}</h2>
      <span class="font-mono text-[10px] text-faint">
        {t("bin.lines", { count: bin.count })} · {t("bin.pieces", { count: bin.pieces })}
      </span>
      <div class="flex-1"></div>
      <button
        class="text-faint transition-colors hover:text-foreground"
        onclick={onClose}
        title={t("bin.close")}
        aria-label={t("bin.close")}
      >
        <X size={14} />
      </button>
    </header>

    {#if bin.count === 0}
      <p class="px-4 py-10 text-center text-[11px] text-faint">{t("bin.empty")}</p>
    {:else}
      <div class="min-h-0 flex-1 overflow-auto">
        <table class="w-full text-xs">
          <thead class="sticky top-0 bg-surface text-faint">
            <tr class="border-b border-divider">
              <th class="px-3 py-1 text-left font-normal">{t("bin.part")}</th>
              <th class="px-2 py-1 text-left font-normal">{t("bin.name")}</th>
              <th class="px-2 py-1 text-left font-normal">{t("bin.from")}</th>
              <th class="w-16 px-2 py-1 text-right font-normal">{t("bin.quantity")}</th>
              <th class="w-8 px-2 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {#each bin.entries as entry (entry.partNumber)}
              <tr class="border-b border-rule align-top">
                <td class="whitespace-nowrap px-3 py-1 font-mono text-foreground">
                  {entry.partNumber}
                </td>
                <td class="px-2 py-1 text-muted">
                  {entry.name ?? "—"}
                  {#if notes.get(entry.partNumber)}
                    <span class="block text-[10px] italic text-accent">
                      {notes.get(entry.partNumber)}
                    </span>
                  {/if}
                </td>
                <td class="px-2 py-1 font-mono text-[10px] text-faint">
                  {entry.catalogueName ?? entry.catalogue ?? "—"}
                  {#if entry.group}<span class="block">{entry.group} · {entry.drawing}</span>{/if}
                  {#if entry.vehicle}<span class="block text-accent">{entry.vehicle}</span>{/if}
                </td>
                <td class="px-2 py-1 text-right">
                  <input
                    class="w-12 rounded border border-divider bg-base px-1 py-0.5 text-right
                           font-mono text-xs outline-none focus:border-accent"
                    type="number"
                    min="1"
                    max="9999"
                    value={entry.quantity}
                    aria-label={t("bin.quantity")}
                    onchange={(e) =>
                      bin.setQuantity(entry.partNumber, Number(e.currentTarget.value))}
                  />
                </td>
                <td class="px-2 py-1 text-right">
                  <button
                    class="rounded p-0.5 text-faint transition-colors hover:text-danger"
                    onclick={() => bin.remove(entry.partNumber)}
                    title={t("bin.remove")}
                    aria-label={t("bin.remove")}
                  >
                    <X size={12} />
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <footer class="flex shrink-0 items-center gap-2 border-t border-divider px-4 py-2">
        <button
          class="flex items-center gap-1.5 rounded bg-accent px-3 py-1 text-xs font-medium
                 text-flag-white transition-colors hover:bg-accent-muted"
          onclick={exportCsv}
        >
          <Download size={13} /> {t("bin.csv")}
        </button>
        <button
          class="flex items-center gap-1.5 rounded border border-divider px-3 py-1 text-xs
                 text-muted transition-colors hover:bg-elevated hover:text-foreground"
          onclick={() => window.print()}
        >
          <Printer size={13} /> {t("bin.print")}
        </button>
        <div class="flex-1"></div>
        <button
          class="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-faint
                 transition-colors hover:text-danger"
          onclick={() => bin.clear()}
        >
          <Trash2 size={13} /> {t("bin.clear")}
        </button>
      </footer>
    {/if}
  </div>
</div>
