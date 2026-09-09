<!--
  Writing down what the catalogue does not know.

  Small and modal on purpose: a note is a sentence, not a document, and the
  length cap says so. It opens with the text selected so overwriting is one
  gesture, and Escape leaves without saving — the two things someone editing a
  field expects.
-->
<script lang="ts">
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { i18n } from "../lib/i18n/index.svelte";
  import { NOTE_LIMIT, notes } from "../lib/notes.svelte";

  interface Props {
    partNumber: string;
    name?: string;
    onClose: () => void;
  }

  let { partNumber, name, onClose }: Props = $props();

  const t = $derived(i18n.t);

  /*
   * Seeded once, from the note this editor was opened for.
   *
   * `$state` captures only the initial value, which is correct *because* the
   * caller keys this component on the part number — opening a note for a
   * different part remounts rather than reusing, so the field cannot show the
   * previous part's text. Without that key it would.
   */
  // svelte-ignore state_referenced_locally
  let text = $state(notes.get(partNumber) ?? "");
  let field = $state<HTMLTextAreaElement | undefined>();

  const remaining = $derived(NOTE_LIMIT - text.length);

  $effect(() => {
    field?.focus();
    field?.select();
  });

  function save() {
    notes.set(partNumber, text);
    onClose();
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === "Escape") onClose();
    // Ctrl/Cmd-Enter saves, because Enter has to make a new line in a note.
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) save();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="fixed inset-0 z-50 grid place-items-center bg-black/45 p-6"
  role="presentation"
  onclick={onClose}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="w-full max-w-md border border-divider border-l-[3px] border-l-accent bg-surface"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    aria-label={t("note.title", { part: partNumber })}
    onclick={(event) => event.stopPropagation()}
    onkeydown={onKey}
  >
    <header class="border-b border-divider px-4 pb-2 pt-3">
      <h2 class="font-mono text-sm text-foreground">{partNumber}</h2>
      {#if name}<p class="text-[11px] text-muted">{name}</p>{/if}
    </header>

    <div class="p-4">
      <textarea
        bind:this={field}
        bind:value={text}
        class="h-28 w-full resize-none rounded border border-divider bg-base px-2 py-1.5
               text-xs leading-relaxed outline-none focus:border-accent"
        placeholder={t("note.placeholder")}
        maxlength={NOTE_LIMIT}
        aria-label={t("note.title", { part: partNumber })}
      ></textarea>
      <p class="mt-1 text-right text-[10px] text-faint">
        {t("note.remaining", { count: remaining })}
      </p>
    </div>

    <footer class="flex items-center gap-2 border-t border-divider px-4 py-2">
      <button
        class="rounded bg-accent px-3 py-1 text-xs font-medium text-flag-white
               transition-colors hover:bg-accent-muted"
        onclick={save}
      >
        {t("note.save")}
      </button>
      <button
        class="rounded border border-divider px-3 py-1 text-xs text-muted transition-colors
               hover:bg-elevated hover:text-foreground"
        onclick={onClose}
      >
        {t("note.cancel")}
      </button>
      <div class="flex-1"></div>
      {#if notes.get(partNumber)}
        <button
          class="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-faint
                 transition-colors hover:text-danger"
          onclick={() => {
            notes.remove(partNumber);
            onClose();
          }}
        >
          <Trash2 size={13} /> {t("note.remove")}
        </button>
      {/if}
    </footer>
  </div>
</div>
