<!--
  How eperx itself looks and speaks.

  Deliberately separate from the Data tab, and from the language dropdown in
  the toolbar. Those two choose *the catalogue's* language, which is a property
  of the tree and limited to whatever it was imported with; this chooses
  eperx's own words, which are always available in both. A Polish-speaking
  desk reading an English-only tree is the normal case.
-->
<script lang="ts">
  import { i18n, LOCALE_CHOICES, type LocaleChoice } from "../lib/i18n/index.svelte";
  import { theme, THEME_CHOICES, type ThemeChoice } from "../lib/theme.svelte";

  const t = $derived(i18n.t);
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
</div>
