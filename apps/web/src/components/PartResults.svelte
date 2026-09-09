<!--
  What a part number answers.

  A column beside the drawing rather than a takeover of the whole view, which
  is what it used to be: a part number is a question *about* what is on screen,
  so throwing away the drawing and the rail to answer it lost the context that
  made the answer useful. Closing it returns the parts panel, so there is no
  mode to get stuck in.

  Split top and bottom rather than left and right, because this is one column
  now: the matches above, and what the chosen one fits below.
-->
<script lang="ts">
  import X from "@lucide/svelte/icons/x";
  import { browse, openUsage, selectPart } from "../lib/browse.svelte";
  import { i18n } from "../lib/i18n/index.svelte";

  let { onClose }: { onClose: () => void } = $props();

  const t = $derived(i18n.t);
</script>

<section class="flex min-h-0 min-w-0 flex-col border-l border-divider bg-surface">
  <header
    class="flex shrink-0 items-baseline gap-2 border-b border-divider px-3 py-1 text-[10px]
           uppercase tracking-wide text-faint"
  >
    <span>{t("search.title")}</span>
    <span class="font-mono normal-case tabular-nums">
      {t("search.results", { count: browse.parts.length })}
    </span>
    <div class="flex-1"></div>
    <button
      class="text-faint transition-colors hover:text-foreground"
      onclick={onClose}
      title={t("search.close")}
      aria-label={t("search.close")}
    >
      <X size={12} />
    </button>
  </header>

  <div class="min-h-0 flex-[2] overflow-y-auto">
    {#each browse.parts as part (part.code)}
      {@const chosen = browse.part?.code === part.code}
      <button
        class="w-full border-b border-rule px-3 py-1.5 text-left transition-colors
               hover:bg-elevated {chosen ? 'bg-elevated' : ''}"
        onclick={() => selectPart(part)}
      >
        <div class="font-mono text-xs {chosen ? 'text-accent' : 'text-foreground'}">
          {part.code}
        </div>
        <div class="truncate text-xs text-muted">{part.name ?? "—"}</div>
        {#if part.family}
          <div class="truncate text-[10px] text-faint">{part.family}</div>
        {/if}
      </button>
    {/each}
  </div>

  <div class="flex min-h-0 flex-[3] flex-col border-t border-divider">
    {#if browse.part}
      <div class="shrink-0 border-b border-divider px-3 py-2">
        <div class="font-mono text-sm text-foreground">{browse.part.code}</div>
        <div class="text-xs text-muted">{browse.part.name ?? "—"}</div>
        <div class="mt-1 flex gap-3 font-mono text-[10px] text-faint">
          {#if browse.part.unit}<span>{t("search.unit")} {browse.part.unit}</span>{/if}
          {#if browse.part.minimumQuantity}
            <span>{t("search.minimum")} {browse.part.minimumQuantity}</span>
          {/if}
          {#if browse.part.weight}<span>{browse.part.weight} g</span>{/if}
        </div>
      </div>
      <div
        class="shrink-0 border-b border-divider px-3 py-1 text-[10px] uppercase tracking-wide
               text-faint"
      >
        {t("search.usages", { count: browse.usages.length })}
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        {#each browse.usages as usage (`${usage.catalogue}-${usage.table}-${usage.variant}-${usage.reference}`)}
          <button
            class="flex w-full items-baseline gap-2 border-b border-rule px-3 py-1 text-left
                   text-xs text-muted transition-colors hover:bg-elevated"
            onclick={() => openUsage(usage)}
          >
            <span class="w-7 shrink-0 font-mono text-faint">{usage.catalogue}</span>
            <span class="min-w-0 flex-1 truncate">{usage.catalogueName}</span>
            <span class="shrink-0 font-mono text-[10px] text-faint">
              {usage.group}/{usage.subgroup} · {usage.table}
            </span>
          </button>
        {/each}
      </div>
    {:else}
      <p class="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-[11px]
                text-faint">
        {t("search.pickPart")}
      </p>
    {/if}
  </div>
</section>
