<!--
  Light, dark, or follow the machine.

  The icon shows the *current* state rather than the next one — a monitor for
  auto, because auto is "whatever that screen says" — and the label carries the
  detail, since three states cannot be read off one glyph.
-->
<script lang="ts">
  import Monitor from "@lucide/svelte/icons/monitor";
  import Moon from "@lucide/svelte/icons/moon";
  import Sun from "@lucide/svelte/icons/sun";
  import { i18n } from "../lib/i18n/index.svelte";
  import { theme } from "../lib/theme.svelte";

  const t = $derived(i18n.t);
  const label = $derived(t(`theme.${theme.choice}`));
</script>

<button
  class="rounded px-2 py-1 text-muted transition-colors hover:bg-elevated hover:text-foreground"
  title={`${label}. ${t("theme.change")}`}
  onclick={() => theme.cycle()}
>
  {#if theme.choice === "auto"}
    <Monitor size={15} />
  {:else if theme.choice === "light"}
    <Sun size={15} />
  {:else}
    <Moon size={15} />
  {/if}
  <span class="sr-only">{label}. {t("theme.change")}</span>
</button>
