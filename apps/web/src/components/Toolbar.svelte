<!--
  The top band: which car, and the chrome.

  Four labelled field groups in the order the work happens — marque, model
  group, catalogue, then the vehicle within it — followed by the VIN, which is
  the other way to reach the same answer. eperx's hierarchy is a level deeper
  than a Mitsubishi catalogue's, so there are four fields where masax has two;
  the labelled-group pattern is what keeps that legible at this density.

  The VIN is an input with a button beside it rather than a popover. It used to
  be behind one, which hid the single most useful thing you can do here: a VIN
  reaches that individual car's build record, so its criteria are the car's own
  rather than its model variant's.

  The tools are pushed to the far right, away from the fields: they are chrome,
  not part of identifying a car, and the eye should skip them while working.
-->
<script lang="ts">
  import Cog from "@lucide/svelte/icons/cog";
  import Search from "@lucide/svelte/icons/search";
  import ShoppingCart from "@lucide/svelte/icons/shopping-cart";
  import { bin } from "../lib/bin.svelte";
  import Combobox from "./Combobox.svelte";
  import ThemeToggle from "./ThemeToggle.svelte";
  import GithubMark from "./GithubMark.svelte";
  import {
    browse,
    searchVersions,
    selectCatalogue,
    selectMake,
    selectModelGroup,
    selectVersion,
  } from "../lib/browse.svelte";
  import { i18n } from "../lib/i18n/index.svelte";
  import { hasChassisData, lookupVin, vin } from "../lib/vin.svelte";
  import { applyVin } from "../lib/browse.svelte";
  import { setLanguage, tree } from "../lib/tree.svelte";

  interface Props {
    onAbout: () => void;
    onSettings: () => void;
    onSearch: (query: string) => void;
    onBin: () => void;
  }

  let { onAbout, onSettings, onSearch, onBin }: Props = $props();

  const t = $derived(i18n.t);

  let vinQuery = $state("");
  let partQuery = $state("");
  let chassisAvailable = $state(false);

  /*
   * Re-asked whenever the tree changes, not once on mount.
   *
   * `tree.base` is read *before* the await so the effect actually depends on
   * it — a read after one is not tracked, which is how this came to answer
   * from the placeholder base and never ask again.
   */
  $effect(() => {
    void tree.base;
    void tree.catalogue;
    void hasChassisData().then((available) => (chassisAvailable = available));
  });

  const makes = $derived(
    browse.makes.map((make) => ({
      id: make.code,
      label: make.name,
      hint: String(make.catalogues),
    })),
  );

  const models = $derived(
    browse.modelGroups.map((model) => ({
      id: model.code,
      label: model.name,
      hint: String(model.catalogues),
    })),
  );

  const catalogues = $derived(
    browse.catalogues.map((entry) => ({
      id: entry.code,
      label: entry.name,
      hint: entry.code,
    })),
  );

  const versions = $derived(
    browse.versions.map((version) => ({
      id: version.sincom ?? `${version.model}${version.version}${version.series}`,
      label: version.description ?? version.sincom ?? "—",
      subtitle: version.sincom ?? undefined,
    })),
  );

  const chosenVersion = $derived(
    browse.source === "version" && browse.version
      ? (browse.version.sincom ??
          `${browse.version.model}${browse.version.version}${browse.version.series}`)
      : undefined,
  );

  function pickVersion(id: string) {
    const version = browse.versions.find(
      (v) => (v.sincom ?? `${v.model}${v.version}${v.series}`) === id,
    );
    if (version) void selectVersion(version);
  }

  async function findVin() {
    if (!vinQuery.trim()) return;
    await lookupVin(vinQuery);
    if (vin.buildRecord) await applyVin();
  }
</script>

<header
  class="flex shrink-0 items-end gap-3 border-b border-divider bg-surface px-3 py-1.5"
>
  <!--
    Wordmark, version, repository. The version is a build-time literal from the
    root manifest rather than a runtime read, so what is shown cannot disagree
    with the tag a release is cut from.
  -->
  <div class="flex shrink-0 items-baseline gap-1.5 pb-0.5">
    <button
      class="font-mono text-base font-semibold tracking-tight"
      onclick={onAbout}
      title={t("toolbar.about")}
      aria-haspopup="dialog"
      aria-label={t("toolbar.about")}
    >
      <span class="text-foreground">eper</span><span class="text-accent">x</span>
    </button>
    <a
      class="font-mono text-[10px] tabular-nums text-faint no-underline transition-colors
             hover:text-foreground"
      href={`${__REPO_URL__}/releases/tag/${__APP_VERSION__}`}
      target="_blank"
      rel="noopener noreferrer"
      title={t("toolbar.release", { version: __APP_VERSION__ })}
    >
      {__APP_VERSION__}
    </a>
    <a
      class="flex items-center text-faint transition-colors hover:text-foreground"
      href={__REPO_URL__}
      target="_blank"
      rel="noopener noreferrer"
      title={t("toolbar.repo")}
      aria-label={t("toolbar.repo")}
    >
      <GithubMark size={13} />
    </a>
  </div>

  {#if tree.catalogue}
    <div class="flex min-w-0 flex-col gap-0.5">
      <span class="text-[10px] uppercase tracking-wide text-faint">{t("toolbar.make")}</span>
      <Combobox
        items={makes}
        value={browse.make?.code}
        width="9rem"
        placeholder={t("toolbar.choose")}
        onpick={(code) => {
          const make = browse.makes.find((m) => m.code === code);
          if (make) void selectMake(make);
        }}
      />
    </div>

    <div class="flex min-w-0 flex-col gap-0.5">
      <span class="text-[10px] uppercase tracking-wide text-faint">{t("toolbar.model")}</span>
      <Combobox
        items={models}
        value={browse.modelGroup?.code}
        width="11rem"
        disabled={!browse.make}
        placeholder={t("toolbar.choose")}
        onpick={(code) => {
          const model = browse.modelGroups.find((m) => m.code === code);
          if (model) void selectModelGroup(model);
        }}
      />
    </div>

    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span class="text-[10px] uppercase tracking-wide text-faint">{t("toolbar.catalogue")}</span>
      <Combobox
        items={catalogues}
        value={browse.catalogue?.code}
        disabled={!browse.modelGroup}
        placeholder={t("toolbar.choose")}
        onpick={(code) => {
          const entry = browse.catalogues.find((c) => c.code === code);
          if (entry) void selectCatalogue(entry);
        }}
      />
    </div>

    <div class="flex min-w-0 flex-col gap-0.5">
      <span class="text-[10px] uppercase tracking-wide text-faint">{t("toolbar.vehicle")}</span>
      <Combobox
        items={versions}
        value={chosenVersion}
        width="15rem"
        disabled={!browse.catalogue}
        placeholder={browse.catalogue ? t("toolbar.any") : t("toolbar.pickCatalogue")}
        onsearch={(query) => void searchVersions(query)}
        onpick={pickVersion}
      />
    </div>

    <!--
      The VIN, beside the version rather than behind a button: it is the better
      of the two when it is available, so hiding it was the wrong default.
    -->
    <div class="flex shrink-0 flex-col gap-0.5">
      <span class="text-[10px] uppercase tracking-wide text-faint">{t("toolbar.vin")}</span>
      <div class="flex">
        <input
          class="w-40 rounded-l border border-divider bg-base px-2 py-1 font-mono text-[11px]
                 uppercase outline-none focus:border-accent disabled:opacity-40"
          bind:value={vinQuery}
          placeholder={t("toolbar.vinPlaceholder")}
          maxlength="17"
          spellcheck="false"
          autocomplete="off"
          disabled={!chassisAvailable || !browse.catalogue}
          title={chassisAvailable ? t("vin.title") : t("vin.unavailable")}
          onkeydown={(e) => e.key === "Enter" && findVin()}
        />
        <button
          class="rounded-r border border-l-0 border-accent bg-accent px-2 py-1 text-[11px]
                 font-medium text-flag-white transition-colors hover:bg-accent-muted
                 disabled:border-divider disabled:bg-transparent disabled:text-faint"
          onclick={findVin}
          disabled={vin.busy || !chassisAvailable || !vinQuery.trim()}
        >
          {vin.busy ? "…" : t("toolbar.decode")}
        </button>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-1 pb-0.5">
      <div class="flex">
        <input
          class="w-36 rounded-l border border-divider bg-base px-2 py-1 font-mono text-[11px]
                 outline-none focus:border-accent"
          bind:value={partQuery}
          placeholder={t("toolbar.searchPlaceholder")}
          aria-label={t("toolbar.search")}
          onkeydown={(e) => e.key === "Enter" && onSearch(partQuery)}
        />
        <button
          class="rounded-r border border-l-0 border-divider px-2 py-1 text-muted
                 transition-colors hover:bg-elevated hover:text-foreground"
          onclick={() => onSearch(partQuery)}
          title={t("toolbar.search")}
          aria-label={t("toolbar.search")}
        >
          <Search size={13} />
        </button>
      </div>

      {#if tree.languages.length > 1}
        <select
          class="rounded border border-divider bg-base px-1 py-1 text-[11px] text-muted
                 outline-none focus:border-accent"
          value={tree.catalogue.language}
          onchange={(e) => setLanguage(e.currentTarget.value)}
          title={t("toolbar.language")}
          aria-label={t("toolbar.language")}
        >
          {#each tree.languages as language (language.code)}
            <option value={language.code}>{language.name}</option>
          {/each}
        </select>
      {/if}
    </div>
  {:else}
    <div class="flex-1"></div>
  {/if}

  <div class="flex shrink-0 items-center gap-0.5 pb-0.5">
    <!--
      The count is the point of having the bin in the bar: a bin you have
      forgotten about is worse than no bin. It reads as a number rather than a
      dot, because "how many lines" is the thing being tracked.
    -->
    <button
      class="relative rounded px-2 py-1 transition-colors hover:bg-elevated
             hover:text-foreground {bin.count > 0 ? 'text-accent' : 'text-muted'}"
      onclick={onBin}
      title={t("bin.open")}
      aria-label={t("bin.open")}
    >
      <ShoppingCart size={15} />
      {#if bin.count > 0}
        <span
          class="absolute -right-0.5 -top-0.5 rounded-full bg-accent px-1 font-mono text-[9px]
                 leading-tight text-flag-white"
        >
          {bin.count}
        </span>
      {/if}
      <span class="sr-only">{t("bin.inBin", { count: bin.count })}</span>
    </button>
    <ThemeToggle />
    <button
      class="rounded px-2 py-1 text-muted transition-colors hover:bg-elevated
             hover:text-foreground"
      onclick={onSettings}
      title={t("toolbar.settings")}
      aria-haspopup="dialog"
      aria-label={t("toolbar.settings")}
    >
      <Cog size={15} />
    </button>
  </div>
</header>
