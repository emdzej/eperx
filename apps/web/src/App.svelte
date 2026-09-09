<script lang="ts">
  import About from "./components/About.svelte";
  import NoteEditor from "./components/NoteEditor.svelte";
  import PartsBin from "./components/PartsBin.svelte";
  import DrawingView from "./components/DrawingView.svelte";
  import PartResults from "./components/PartResults.svelte";
  import PartsPanel from "./components/PartsPanel.svelte";
  import SearchList, { type ListItem } from "./components/SearchList.svelte";
  import SettingsDialog from "./components/SettingsDialog.svelte";
  import SpecStrip from "./components/SpecStrip.svelte";
  import Toolbar from "./components/Toolbar.svelte";
  import { bin } from "./lib/bin.svelte";
  import { i18n } from "./lib/i18n/index.svelte";
  import {
    browse,
    loadMakes,
    restoreSelection,
    runSearch,
    selectGroup,
    selectSubgroup,
  } from "./lib/browse.svelte";
  import { hasManifest, mount } from "./lib/mount";
  import { readSettings } from "./lib/settings";
  import { connect, setLanguage, stats, tree } from "./lib/tree.svelte";

  let aboutOpen = $state(false);
  /** The part whose note is being written, if any. */
  let noteFor = $state<{ partNumber: string; name?: string } | undefined>(undefined);
  let settingsOpen = $state(false);
  /** Nothing chosen yet, so the settings panel opens as an unclosable prompt. */
  let firstRun = $state(false);
  let resuming = $state(true);
  let resumeError = $state<string | undefined>(undefined);
  let warningDismissed = $state(false);

  const t = $derived(i18n.t);

  /*
   * Search results appear over the parts column, not instead of the whole
   * view. They used to replace it, which threw away the drawing and the rail
   * you were working in; a part number is a question *about* what is on
   * screen, so the answer belongs beside it.
   */
  const showingParts = $derived(browse.parts.length > 0);

  const groupItems = $derived(
    browse.groups.map(
      (group): ListItem => ({
        key: String(group.code),
        code: String(group.code),
        name: group.name ?? "—",
      }),
    ),
  );

  const subgroupItems = $derived(
    browse.subgroups.map(
      (subgroup): ListItem => ({
        key: String(subgroup.code),
        code: String(subgroup.code),
        name: subgroup.name ?? "—",
        note: String(subgroup.drawings),
      }),
    ),
  );

  /**
   * Reopen whatever was chosen last time, or ask.
   *
   * A remote or OPFS source needs no permission and reopens silently. A folder
   * may need a click — browsers grant directory access per session — so that
   * case opens the panel rather than failing, and the panel offers the button.
   */
  $effect(() => {
    void resume();
  });

  async function resume() {
    try {
      const resumable = await readSettings();
      if (resumable.permission === "missing" && !resumable.settings.savedAt) {
        firstRun = true;
        settingsOpen = true;
        return;
      }
      if (resumable.settings.kind === "directory" && resumable.permission !== "granted") {
        settingsOpen = true;
        return;
      }

      const base = await mount(resumable.settings.kind, {
        base: resumable.settings.base,
        handle: resumable.handle,
      });
      if (!(await hasManifest(base))) {
        throw new Error("the saved source no longer holds a catalogue");
      }
      await connect(base, { kind: resumable.settings.kind, handle: resumable.handle });
      if (tree.catalogue) {
        await loadMakes();
        // Back to where they were, if this tree still has it.
        await restoreSelection();
      }
    } catch (error) {
      resumeError = error instanceof Error ? error.message : String(error);
      settingsOpen = true;
    } finally {
      resuming = false;
    }
  }

  async function search(query: string) {
    if (query.trim()) await runSearch(query);
    else browse.parts = [];
  }

  async function changeLanguage(code: string) {
    setLanguage(code);
    // Every label came from a per-language join, so the whole tree is stale —
    // including the objects behind the current selection, which is why this
    // re-resolves it rather than leaving the old rows on screen.
    await loadMakes();
    await restoreSelection();
  }

  const kb = (n: number) => `${(n / 1024).toFixed(0)} kB`;
</script>

<div class="flex h-full flex-col">
  <!-- Tricolor hairline: green / off-white / red, left to right. -->
  <div class="flex h-0.5 shrink-0">
    <div class="flex-1 bg-accent"></div>
    <div class="flex-1 bg-flag-white"></div>
    <div class="flex-1 bg-accent-alt"></div>
  </div>

  <Toolbar
    onAbout={() => (aboutOpen = true)}
    onSettings={() => (settingsOpen = true)}
    onSearch={(q) => void search(q)}
    onBin={() => (bin.open = true)}
  />

  {#if !tree.catalogue}
    <main class="flex min-h-0 flex-1 items-center justify-center">
      {#if resuming}
        <p class="text-xs text-faint">{t("app.opening")}</p>
      {:else if resumeError}
        <div class="max-w-md space-y-2 text-center">
          <p class="text-xs text-danger">{resumeError}</p>
          <button
            class="rounded border border-divider px-3 py-1 text-xs text-foreground
                   transition-colors hover:bg-elevated"
            onclick={() => (settingsOpen = true)}
          >
            {t("app.chooseSource")}
          </button>
        </div>
      {:else if !settingsOpen}
        <div class="space-y-2 text-center">
          <p class="text-xs text-faint">{t("app.tagline")}</p>
          <button
            class="rounded border border-divider px-3 py-1 text-xs text-foreground
                   transition-colors hover:bg-elevated"
            onclick={() => (settingsOpen = true)}
          >
            {t("app.chooseSource")}
          </button>
        </div>
      {/if}
    </main>
  {:else}
    <SpecStrip />

    <!-- Part of the tree is unreadable — dismissible, and shown once rather
         than on every drawing that fails, because the cause is the tree and
         not the drawing. -->
    {#if tree.warning && !warningDismissed}
      <div
        class="flex shrink-0 items-start gap-2 border-b border-warn/40 bg-warn/10 px-3 py-1.5
               text-[11px] leading-relaxed text-warn"
      >
        <span class="shrink-0" aria-hidden="true">!</span>
        <p class="min-w-0 flex-1">{tree.warning}</p>
        <button
          class="shrink-0 text-warn/70 transition-colors hover:text-warn"
          onclick={() => (warningDismissed = true)}
          aria-label={t("footer.dismiss")}
          title={t("footer.dismiss")}
        >
          &times;
        </button>
      </div>
    {/if}

    <!--
      Three columns: the tree on the left, the drawing in the middle, the parts
      on the right. The drawing takes the larger share of what is left because
      it is what anyone came to look at, and the parts table needs a floor wide
      enough for its five columns.
    -->
    <main class="grid min-h-0 flex-1" style="grid-template-columns: 15rem minmax(0, 1.1fr) minmax(26rem, 1fr)">
      <aside class="flex min-h-0 flex-col border-r border-divider bg-surface">
        <SearchList
          label={t("rail.group")}
          items={groupItems}
          selectedKey={browse.group === undefined ? undefined : String(browse.group.code)}
          placeholder={t("rail.filterGroups")}
          emptyHint={t("rail.chooseCatalogue")}
          noMatch={t("rail.noGroups")}
          onSelect={(item) => {
            const group = browse.groups.find((g) => String(g.code) === item.key);
            if (group) void selectGroup(group);
          }}
        />
        <div class="border-t border-divider"></div>
        <SearchList
          label={t("rail.subgroup")}
          items={subgroupItems}
          selectedKey={browse.subgroup === undefined ? undefined : String(browse.subgroup.code)}
          placeholder={t("rail.filterSubgroups")}
          emptyHint={t("rail.chooseGroup")}
          noMatch={t("rail.noSubgroups")}
          onSelect={(item) => {
            const subgroup = browse.subgroups.find((sg) => String(sg.code) === item.key);
            if (subgroup) void selectSubgroup(subgroup);
          }}
        />
      </aside>

      <DrawingView />

      <!-- The search answer sits over this column rather than over the page,
           so the drawing and the rail stay where they were. -->
      {#if showingParts}
        <PartResults onClose={() => (browse.parts = [])} />
      {:else}
        <PartsPanel onNote={(partNumber, name) => (noteFor = { partNumber, name })} />
      {/if}
    </main>

    <footer
      class="flex shrink-0 items-center gap-4 border-t border-divider bg-surface px-3 py-1
             font-mono text-[10px]"
    >
      {#if browse.error}
        <span class="text-danger">{browse.error}</span>
      {:else if browse.busy}
        <span class="text-faint">…</span>
      {:else if browse.drawing}
        <span class="text-muted">
          {browse.catalogue?.code}/{browse.drawing.group}/{browse.drawing.subgroup}
          · {browse.drawing.table} v{browse.drawing.variant}
        </span>
      {/if}
      <div class="flex-1"></div>
      <span class="text-faint" title={t("toolbar.readingFrom")}>{tree.kind}</span>
      <!-- Query count, not bytes: SQLite fetches its pages from inside a
           worker, whose resource timings the main thread cannot see, so a byte
           figure here would be a plausible-looking zero. The image is read by
           our own code, so that one is real. -->
      <span class="text-faint" title={t("footer.queries")}>{stats.queries} q</span>
      {#if browse.imageBytes}
        <span class="text-accent" title={t("footer.drawingBytes")}>{kb(browse.imageBytes)}</span>
      {/if}
    </footer>
  {/if}

  {#if aboutOpen}
    <About onClose={() => (aboutOpen = false)} />
  {/if}

  {#if bin.open}
    <PartsBin onClose={() => (bin.open = false)} />
  {/if}

  <!--
    Keyed on the part number, so opening a note for a different part remounts
    the editor. Without the key Svelte reuses the component and the textarea
    keeps the previous part's text — which reads as a saved note that is not.
  -->
  {#if noteFor}
    {#key noteFor.partNumber}
      <NoteEditor
        partNumber={noteFor.partNumber}
        name={noteFor.name}
        onClose={() => (noteFor = undefined)}
      />
    {/key}
  {/if}

  {#if settingsOpen}
    <SettingsDialog
      {firstRun}
      onClose={() => {
        settingsOpen = false;
        firstRun = false;
        resumeError = undefined;
      }}
    />
  {/if}
</div>
