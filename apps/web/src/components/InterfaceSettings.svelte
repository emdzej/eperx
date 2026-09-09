<!--
  How eperx itself looks and speaks.

  Deliberately separate from the Data tab, and from the language dropdown in
  the toolbar. Those two choose *the catalogue's* language, which is a property
  of the tree and limited to whatever it was imported with; this chooses
  eperx's own words, which are always available in both. A Polish-speaking
  desk reading an English-only tree is the normal case.
-->
<script lang="ts">
  import Download from "@lucide/svelte/icons/download";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Upload from "@lucide/svelte/icons/upload";
  import { applyBackup, buildBackup, toJson } from "../lib/backup";
  import { download } from "../lib/csv";
  import { i18n, LOCALE_CHOICES, type LocaleChoice } from "../lib/i18n/index.svelte";
  import { notes } from "../lib/notes.svelte";
  import { theme, THEME_CHOICES, type ThemeChoice } from "../lib/theme.svelte";

  const t = $derived(i18n.t);

  /** What the last import did, or why it did nothing. */
  let report = $state("");

  function exportBackup() {
    // No BOM: it is what makes `JSON.parse` reject a file, and this one has to
    // be readable back. See `download` in `lib/bin.svelte.ts`.
    download(t("backup.file"), toJson(buildBackup(new Date().toISOString())), {
      type: "application/json",
    });
  }

  async function importBackup(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Cleared so choosing the same file twice fires `change` again.
    input.value = "";
    if (!file) return;
    try {
      const applied = applyBackup(JSON.parse(await file.text()));
      const touched =
        applied.notes.added + applied.notes.updated + applied.notes.kept + applied.bin;
      if (!touched && !applied.preferences) {
        report = t("backup.importFailed");
        return;
      }
      report =
        t("backup.imported", { ...applied.notes, bin: applied.bin }) +
        (applied.preferences ? ` ${t("backup.importedPrefs")}` : "");
    } catch {
      report = t("backup.importFailed");
    }
  }
</script>

<div class="space-y-4">
  <section>
    <h3 class="text-xs font-medium text-foreground">{t("settings.interfaceLanguage")}</h3>
    <p class="mt-0.5 text-[11px] leading-relaxed text-faint">
      {t("settings.interfaceLanguageNote")}
    </p>
    <div class="mt-2 flex gap-1">
      {#each LOCALE_CHOICES as choice (choice)}
        <button
          class="rounded border px-2 py-1 text-xs transition-colors {i18n.choice === choice
            ? 'border-accent bg-accent/10 text-accent'
            : 'border-divider text-muted hover:bg-elevated hover:text-foreground'}"
          onclick={() => void i18n.set(choice as LocaleChoice)}
          aria-pressed={i18n.choice === choice}
        >
          {t(`language.${choice}`)}
        </button>
      {/each}
    </div>
  </section>

  <section>
    <h3 class="text-xs font-medium text-foreground">{t("settings.theme")}</h3>
    <p class="mt-0.5 text-[11px] leading-relaxed text-faint">{t("settings.themeNote")}</p>
    <div class="mt-2 flex gap-1">
      {#each THEME_CHOICES as choice (choice)}
        <button
          class="rounded border px-2 py-1 text-xs transition-colors {theme.choice === choice
            ? 'border-accent bg-accent/10 text-accent'
            : 'border-divider text-muted hover:bg-elevated hover:text-foreground'}"
          onclick={() => theme.set(choice as ThemeChoice)}
          aria-pressed={theme.choice === choice}
        >
          {t(`theme.${choice}`)}
        </button>
      {/each}
    </div>
  </section>

  <section class="border-t border-divider pt-4">
    <h3 class="text-xs font-medium text-foreground">{t("backup.title")}</h3>
    <p class="mt-0.5 text-[11px] leading-relaxed text-faint">{t("backup.note")}</p>
    <div class="mt-2 flex flex-wrap items-center gap-2">
      <button
        class="flex items-center gap-1.5 rounded border border-divider px-2 py-1 text-xs
               text-muted transition-colors hover:bg-elevated hover:text-foreground"
        onclick={exportBackup}
      >
        <Download size={13} /> {t("backup.export")}
      </button>
      <!-- A label wrapping a hidden input: a file picker cannot be opened
           programmatically, so the button has to *be* the input. -->
      <label
        class="flex cursor-pointer items-center gap-1.5 rounded border border-divider px-2 py-1
               text-xs text-muted transition-colors hover:bg-elevated hover:text-foreground"
      >
        <Upload size={13} /> {t("backup.import")}
        <input
          class="hidden"
          type="file"
          accept="application/json,.json"
          onchange={importBackup}
        />
      </label>
      {#if notes.count > 0}
        <div class="flex-1"></div>
        <button
          class="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-faint
                 transition-colors hover:text-danger"
          onclick={() => notes.clear()}
        >
          <Trash2 size={13} /> {t("backup.clearNotes")} ({t("note.count", {
            count: notes.count,
          })})
        </button>
      {/if}
    </div>
    <p class="mt-1.5 text-[10px] leading-relaxed text-faint">{t("backup.sourceNote")}</p>
    {#if report}<p class="mt-1.5 text-[11px] text-accent">{report}</p>{/if}
  </section>
</div>
