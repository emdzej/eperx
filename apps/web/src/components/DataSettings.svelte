<!--
  Choosing where the catalogue comes from.

  One panel, two homes: the Data tab of the settings dialog, and the popup on a
  first visit when nothing has been chosen yet. Identical either way, so there
  is one place to get it right.
-->
<script lang="ts">
  import { loadMakes } from "../lib/browse.svelte";
  import {
    capabilities,
    hasManifest,
    mount,
    pickDirectory,
    type Capabilities,
    type MountKind,
  } from "../lib/mount";
  import {
    clearOpfs,
    opfsContents,
    opfsHasTree,
    opfsImport,
    planImport,
    runImport,
  } from "../lib/opfs.svelte";
  import { clearSettings, readSettings, requestAccess, saveSettings } from "../lib/settings";
  import { connect, disconnect, tree } from "../lib/tree.svelte";

  let { onOpened }: { onOpened?: () => void } = $props();

  let base = $state("http://127.0.0.1:8998");
  let can = $state<Capabilities | undefined>(undefined);
  let opfsReady = $state(false);
  let opfsSize = $state(0);
  let source = $state<FileSystemDirectoryHandle | undefined>(undefined);
  let busy = $state(false);
  let error = $state<string | undefined>(undefined);

  /** A folder remembered from a previous visit, and whether it needs a click. */
  let saved = $state<
    { name: string; handle?: FileSystemDirectoryHandle; needsClick: boolean } | undefined
  >(undefined);

  $effect(() => {
    void capabilities().then((c) => (can = c));
    void refreshOpfs();
    void refreshSaved();
  });

  async function refreshOpfs() {
    opfsReady = await opfsHasTree();
    opfsSize = opfsReady ? (await opfsContents()).reduce((n, c) => n + c.size, 0) : 0;
  }

  async function refreshSaved() {
    const resumable = await readSettings();
    if (resumable.settings.kind === "remote" && resumable.settings.base) {
      base = resumable.settings.base;
    }
    saved =
      resumable.settings.kind === "directory" && resumable.handle
        ? {
            name: resumable.settings.directoryName ?? resumable.handle.name,
            handle: resumable.handle,
            needsClick: resumable.permission !== "granted",
          }
        : undefined;
  }

  // Scaled, because the same formatter shows a 130-byte manifest and a 568 MB
  // database. Fixed at MB, the manifest read "0 MB", which looks like a bug.
  const size = (n: number) => {
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(0)} kB`;
    return `${n} B`;
  };

  async function open(
    kind: MountKind,
    options: { handle?: FileSystemDirectoryHandle; remember?: boolean } = {},
  ) {
    busy = true;
    error = undefined;
    try {
      const at = await mount(kind, { base, handle: options.handle });
      if (!(await hasManifest(at))) {
        throw new Error(
          `No manifest.json with a catalogue at ${at}. ` +
            "Point this at a folder produced by `eperx import`.",
        );
      }
      await connect(at, { kind });
      if (tree.catalogue) await loadMakes();

      if (options.remember !== false) {
        await saveSettings(
          {
            kind,
            base: kind === "remote" ? base : undefined,
            directoryName: options.handle?.name,
          },
          options.handle,
        );
        await refreshSaved();
      }
      onOpened?.();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      busy = false;
    }
  }

  async function chooseDirectory() {
    try {
      await open("directory", { handle: await pickDirectory() });
    } catch (caught) {
      // An abandoned picker throws AbortError; that is not worth reporting.
      if ((caught as { name?: string }).name !== "AbortError") {
        error = caught instanceof Error ? caught.message : String(caught);
      }
    }
  }

  /** Reopen the remembered folder, asking for permission if it has lapsed. */
  async function reopenSaved() {
    if (!saved?.handle) return;
    busy = true;
    error = undefined;
    try {
      if (saved.needsClick && !(await requestAccess(saved.handle))) {
        error = "Permission for that folder was refused.";
        return;
      }
      await open("directory", { handle: saved.handle });
    } finally {
      busy = false;
    }
  }

  async function forgetDirectory() {
    await clearSettings();
    await disconnect();
    saved = undefined;
    await refreshSaved();
  }

  async function planFromDirectory() {
    try {
      const handle = await pickDirectory();
      source = handle;
      opfsImport.busy = true;
      opfsImport.plan = await planImport(handle);
    } catch (caught) {
      if ((caught as { name?: string }).name !== "AbortError") {
        error = caught instanceof Error ? caught.message : String(caught);
      }
    } finally {
      opfsImport.busy = false;
    }
  }

  async function doImport() {
    if (!source || !opfsImport.plan) return;
    opfsImport.busy = true;
    error = undefined;
    try {
      await runImport(source, opfsImport.plan, (progress) => (opfsImport.progress = progress));
      opfsImport.plan = undefined;
      opfsImport.progress = undefined;
      await refreshOpfs();
      await open("opfs");
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      opfsImport.busy = false;
    }
  }

  async function discardOpfs() {
    opfsImport.busy = true;
    try {
      await clearOpfs();
      await refreshOpfs();
    } finally {
      opfsImport.busy = false;
    }
  }
</script>

<div class="space-y-4">
  {#if error}
    <div class="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
      {error}
    </div>
  {/if}

  <!-- 1. Remote -->
  <section class="rounded border border-divider">
    <header class="border-b border-divider px-3 py-2">
      <h3 class="text-xs font-medium text-foreground">Over HTTP</h3>
      <p class="mt-0.5 text-[11px] text-faint">
        Any static host that honours <span class="font-mono">Range</span> —
        <span class="font-mono">eperx serve</span>, or a URL. Nothing is stored in the
        browser.
      </p>
    </header>
    <div class="flex gap-2 p-3">
      <input
        class="min-w-0 flex-1 rounded border border-divider bg-base px-2 py-1 font-mono text-xs
               outline-none focus:border-accent"
        bind:value={base}
        placeholder="http://127.0.0.1:8998"
        onkeydown={(e) => e.key === "Enter" && open("remote")}
      />
      <button
        class="rounded bg-accent px-3 py-1 text-xs font-medium text-flag-white
               transition-colors hover:bg-accent-muted disabled:opacity-50"
        disabled={busy || tree.connecting}
        onclick={() => open("remote")}
      >
        {busy || tree.connecting ? "Opening…" : "Open"}
      </button>
    </div>
  </section>

  <!-- 2. A local folder, read in place -->
  <section class="rounded border border-divider">
    <header class="border-b border-divider px-3 py-2">
      <h3 class="text-xs font-medium text-foreground">A folder on this machine</h3>
      <p class="mt-0.5 text-[11px] leading-relaxed text-faint">
        Read in place — <strong class="font-normal text-muted">nothing is copied</strong>. A
        service worker answers the reads, so the drawings and chassis files stay where they
        are.
      </p>
    </header>
    <div class="space-y-2 p-3">
      {#if can && !can.directoryPicker}
        <p class="text-[11px] leading-relaxed text-warn">
          This browser cannot open a folder — <span class="font-mono">showDirectoryPicker</span>
          is Chromium-only. Use HTTP instead.
        </p>
      {:else}
        {#if saved}
          <div class="flex items-center gap-2">
            <button
              class="rounded bg-accent px-3 py-1 text-xs font-medium text-flag-white
                     transition-colors hover:bg-accent-muted disabled:opacity-50"
              disabled={busy}
              onclick={reopenSaved}
            >
              {saved.needsClick ? "Allow and open" : "Open"}
            </button>
            <span class="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
              {saved.name}
            </span>
            <button
              class="text-[11px] text-muted transition-colors hover:text-danger disabled:opacity-50"
              disabled={busy}
              onclick={forgetDirectory}
            >
              Forget
            </button>
          </div>
          {#if saved.needsClick}
            <p class="text-[10px] leading-relaxed text-faint">
              The folder is remembered but its read permission lapsed — browsers grant it
              per session, so reopening needs one click.
            </p>
          {/if}
        {/if}
        <button
          class="rounded border border-divider px-3 py-1 text-xs text-foreground
                 transition-colors hover:bg-elevated disabled:opacity-50"
          disabled={busy}
          onclick={chooseDirectory}
        >
          {saved ? "Choose a different folder…" : "Choose folder…"}
        </button>
      {/if}
    </div>
  </section>

  <!-- 3. Copied into the browser -->
  <section class="rounded border border-divider">
    <header class="border-b border-divider px-3 py-2">
      <h3 class="text-xs font-medium text-foreground">Stored in this browser</h3>
      <p class="mt-0.5 text-[11px] leading-relaxed text-faint">
        Copied into the origin private file system, so it opens with no folder permission
        and no disc mounted. Costs a second copy of whatever you import.
      </p>
    </header>
    <div class="space-y-3 p-3">
      {#if opfsReady && !opfsImport.plan}
        <div class="flex items-center gap-3">
          <button
            class="rounded bg-accent px-3 py-1 text-xs font-medium text-flag-white
                   transition-colors hover:bg-accent-muted disabled:opacity-50"
            disabled={busy}
            onclick={() => open("opfs")}
          >
            Open
          </button>
          <span class="text-[11px] text-faint">{size(opfsSize)} stored</span>
          <div class="flex-1"></div>
          <button
            class="text-[11px] text-muted transition-colors hover:text-danger disabled:opacity-50"
            disabled={opfsImport.busy}
            onclick={discardOpfs}
          >
            Discard
          </button>
        </div>
      {/if}

      {#if opfsImport.progress}
        {@const p = opfsImport.progress}
        <div>
          <div class="flex items-baseline justify-between text-[11px]">
            <span class="truncate font-mono text-muted">{p.file}</span>
            <span class="shrink-0 text-faint">
              {p.filesDone}/{p.files} · {size(p.bytesDone)} of {size(p.bytes)}
            </span>
          </div>
          <div class="mt-1 h-1 overflow-hidden rounded bg-elevated">
            <div
              class="h-full bg-accent transition-all"
              style="width: {(p.bytesDone / Math.max(1, p.bytes)) * 100}%"
            ></div>
          </div>
        </div>
      {:else if opfsImport.plan}
        {@const plan = opfsImport.plan}
        <div class="space-y-2">
          <table class="w-full text-[11px]">
            <tbody>
              {#each plan.components.slice(0, 6) as component (component.dir + component.name)}
                <tr>
                  <td class="py-0.5 font-mono text-muted">
                    {component.dir ? `${component.dir}/` : ""}{component.name}
                  </td>
                  <td class="py-0.5 text-right font-mono text-faint">{size(component.size)}</td>
                </tr>
              {/each}
              {#if plan.components.length > 6}
                <tr>
                  <td class="py-0.5 text-faint" colspan="2">
                    … and {plan.components.length - 6} more
                  </td>
                </tr>
              {/if}
            </tbody>
          </table>

          <p class="text-[11px] leading-relaxed {plan.tooLarge ? 'text-danger' : 'text-muted'}">
            {plan.components.length} files, {size(plan.bytes)}. Quota is {size(plan.quota)}
            with {size(plan.quota - plan.used)} free.
            {#if plan.tooLarge}
              <strong class="font-normal">This will not fit.</strong> Import a folder without
              the drawings, or free space.
            {:else if plan.bytes > (plan.quota - plan.used) * 0.8}
              This will use most of what is available.
            {/if}
          </p>

          <div class="flex gap-2">
            <button
              class="rounded bg-accent px-3 py-1 text-xs font-medium text-flag-white
                     transition-colors hover:bg-accent-muted disabled:opacity-50"
              disabled={opfsImport.busy || plan.tooLarge}
              onclick={doImport}
            >
              Import {size(plan.bytes)}
            </button>
            <button
              class="rounded px-3 py-1 text-xs text-muted transition-colors hover:bg-elevated"
              onclick={() => (opfsImport.plan = undefined)}
            >
              Cancel
            </button>
          </div>
        </div>
      {:else if can?.directoryPicker}
        <button
          class="rounded border border-divider px-3 py-1 text-xs text-foreground
                 transition-colors hover:bg-elevated disabled:opacity-50"
          disabled={opfsImport.busy || busy}
          onclick={planFromDirectory}
        >
          {opfsImport.busy
            ? "Reading folder…"
            : opfsReady
              ? "Replace with a folder…"
              : "Import a folder…"}
        </button>
      {:else if !opfsReady}
        <p class="text-[11px] text-warn">
          Importing needs a folder picker, which this browser does not have.
        </p>
      {/if}
    </div>
  </section>

  {#if can}
    <p class="text-[10px] leading-relaxed text-faint">
      {can.serviceWorker
        ? "Service workers available"
        : "No service workers — local sources unavailable"}.
      {can.directoryPicker ? "Folder picker available" : "No folder picker"}.
      {#if can.quota}
        Browser storage: {size(can.quota.used)} of {size(can.quota.available)} used.
      {/if}
    </p>
  {/if}
</div>
