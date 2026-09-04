<script lang="ts">
  import About from "./components/About.svelte";
  import DrawingView from "./components/DrawingView.svelte";
  import GroupTree from "./components/GroupTree.svelte";
  import PartResults from "./components/PartResults.svelte";
  import SelectorBar from "./components/SelectorBar.svelte";
  import SettingsDialog from "./components/SettingsDialog.svelte";
  import ThemeToggle from "./components/ThemeToggle.svelte";
  import { browse, loadMakes, runSearch } from "./lib/browse.svelte";
  import { hasManifest, mount } from "./lib/mount";
  import { readSettings } from "./lib/settings";
  import { connect, setLanguage, stats, tree } from "./lib/tree.svelte";

  let query = $state("");
  let aboutOpen = $state(false);
  let settingsOpen = $state(false);
  /** Nothing chosen yet, so the settings panel opens as an unclosable prompt. */
  let firstRun = $state(false);
  let resuming = $state(true);
  let resumeError = $state<string | undefined>(undefined);

  // Part results take over the main pane while there are any; clearing the
  // box returns to the drawing, so there is no mode to get stuck in.
  const showingParts = $derived(browse.parts.length > 0);

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
      await connect(base, { kind: resumable.settings.kind });
      if (tree.catalogue) await loadMakes();
    } catch (error) {
      resumeError = error instanceof Error ? error.message : String(error);
      settingsOpen = true;
    } finally {
      resuming = false;
    }
  }

  async function search() {
    if (query.trim()) await runSearch(query);
    else browse.parts = [];
  }

  async function changeLanguage(code: string) {
    setLanguage(code);
    // Every label came from a per-language join, so the whole tree is stale.
    await loadMakes();
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

  <header class="flex shrink-0 items-center gap-2 border-b border-divider bg-surface px-4 py-2">
    <!--
      Wordmark, version, repository. The version is a build-time literal from
      the root manifest rather than a runtime read, so what is shown cannot
      disagree with the tag a release is cut from.
    -->
    <button
      class="font-mono text-lg font-semibold tracking-tight"
      onclick={() => (aboutOpen = true)}
      title="About eperx"
      aria-haspopup="dialog"
      aria-label="About eperx"
    >
      <span class="text-foreground">eper</span><span class="text-accent">x</span>
    </button>

    <a
      class="shrink-0 font-mono text-[10px] tabular-nums text-faint no-underline
             transition-colors hover:text-foreground"
      href={`${__REPO_URL__}/releases/tag/${__APP_VERSION__}`}
      target="_blank"
      rel="noopener noreferrer"
      title="Release notes"
    >
      {__APP_VERSION__}
    </a>

    <a
      class="flex shrink-0 items-center text-faint transition-colors hover:text-foreground"
      href={__REPO_URL__}
      target="_blank"
      rel="noopener noreferrer"
      title="Source on GitHub"
      aria-label="Source on GitHub"
    >
      <!-- GitHub's own mark, inlined so it takes currentColor and needs no fetch. -->
      <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
        <path
          d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
        />
      </svg>
    </a>

    <div class="flex-1"></div>

    {#if tree.catalogue}
      <input
        class="w-56 rounded border border-divider bg-base px-2 py-1 font-mono text-xs
               outline-none focus:border-accent"
        bind:value={query}
        placeholder="part number"
        onkeydown={(e) => e.key === "Enter" && search()}
      />
      <button
        class="rounded px-2 py-1 text-xs text-muted transition-colors hover:bg-elevated
               hover:text-foreground"
        onclick={search}
      >
        Search
      </button>

      {#if tree.languages.length > 1}
        <select
          class="rounded border border-divider bg-base px-1 py-1 text-xs text-muted
                 outline-none focus:border-accent"
          value={tree.catalogue.language}
          onchange={(e) => changeLanguage(e.currentTarget.value)}
        >
          {#each tree.languages as language (language.code)}
            <option value={language.code}>{language.name}</option>
          {/each}
        </select>
      {/if}
    {/if}

    <button
      class="rounded px-2 py-1 text-muted transition-colors hover:bg-elevated
             hover:text-foreground"
      onclick={() => (settingsOpen = true)}
      title="Settings"
      aria-haspopup="dialog"
      aria-label="Settings"
    >
      <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
        <path
          d="M9.4 1H6.6l-.3 1.9a5 5 0 0 0-1.2.7l-1.8-.7-1.4 2.4 1.5 1.2a5 5 0 0 0 0 1.4L1.9 9.1l1.4 2.4 1.8-.7c.37.3.78.53 1.2.7L6.6 15h2.8l.3-1.9a5 5 0 0 0 1.2-.7l1.8.7 1.4-2.4-1.5-1.2a5 5 0 0 0 0-1.4l1.5-1.2-1.4-2.4-1.8.7a5 5 0 0 0-1.2-.7L9.4 1ZM8 10.2a2.2 2.2 0 1 1 0-4.4 2.2 2.2 0 0 1 0 4.4Z"
        />
      </svg>
    </button>

    <ThemeToggle />
  </header>

  {#if !tree.catalogue}
    <main class="flex min-h-0 flex-1 items-center justify-center">
      {#if resuming}
        <p class="text-xs text-faint">Opening the saved source…</p>
      {:else if resumeError}
        <div class="max-w-md space-y-2 text-center">
          <p class="text-xs text-danger">{resumeError}</p>
          <button
            class="rounded border border-divider px-3 py-1 text-xs text-foreground
                   transition-colors hover:bg-elevated"
            onclick={() => (settingsOpen = true)}
          >
            Choose a source
          </button>
        </div>
      {:else if !settingsOpen}
        <button
          class="rounded border border-divider px-3 py-1 text-xs text-foreground
                 transition-colors hover:bg-elevated"
          onclick={() => (settingsOpen = true)}
        >
          Choose a source
        </button>
      {/if}
    </main>
  {:else}
    <main class="flex min-h-0 flex-1 flex-col">
      <!-- Marque, model, catalogue and vehicle across the top; group and
           subgroup down the left. The drawing gets everything else, which is
           the point — it is what anyone came to look at. -->
      <SelectorBar />

      {#if showingParts}
        <div class="flex min-h-0 flex-1"><PartResults /></div>
      {:else}
        <div class="flex min-h-0 flex-1">
          <GroupTree />
          <DrawingView />
        </div>
      {/if}

      <footer
        class="flex shrink-0 items-center gap-4 border-t border-divider bg-surface px-4 py-1
               font-mono text-[11px]"
      >
        {#if browse.error}
          <span class="text-danger">{browse.error}</span>
        {:else if browse.busy}
          <span class="text-faint">reading…</span>
        {:else if browse.drawing}
          <span class="text-muted">
            {browse.catalogue?.code}/{browse.drawing.group}/{browse.drawing.subgroup}
            · {browse.drawing.table} v{browse.drawing.variant}
          </span>
        {/if}
        <div class="flex-1"></div>
        <span class="text-faint" title="Where the catalogue is being read from">
          {tree.kind}
        </span>
        <!-- Query count, not bytes: SQLite fetches its pages from inside a
             worker, whose resource timings the main thread cannot see, so a
             byte figure here would be a plausible-looking zero. The image is
             read by our own code, so that one is real. -->
        <span class="text-faint" title="SQL statements run against the tree">
          {stats.queries} queries
        </span>
        {#if browse.imageBytes}
          <span class="text-accent" title="The drawing itself, one ranged read">
            img {kb(browse.imageBytes)}
          </span>
        {/if}
      </footer>
    </main>
  {/if}

  {#if aboutOpen}
    <About onClose={() => (aboutOpen = false)} />
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
