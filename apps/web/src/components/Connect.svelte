<script lang="ts">
  import { loadMakes } from "../lib/browse.svelte";
  import { connect, tree } from "../lib/tree.svelte";

  let base = $state("/data");

  async function open() {
    await connect(base);
    if (tree.catalogue) await loadMakes();
  }
</script>

<div class="flex h-full items-center justify-center">
  <div class="w-[30rem] space-y-4">
    <div>
      <h1 class="text-sm font-medium text-foreground">Open an imported tree</h1>
      <p class="mt-1 text-xs text-muted">
        A directory holding <span class="font-mono">catalogue.sqlite</span> and
        <span class="font-mono">images/</span>, produced by
        <span class="font-mono">eperx import</span>. It is read in place over HTTP
        <span class="font-mono">Range</span> — the 568 MB database is never downloaded.
      </p>
    </div>

    <div class="flex gap-2">
      <input
        class="min-w-0 flex-1 rounded border border-divider bg-base px-2 py-1 font-mono text-sm
               outline-none focus:border-accent"
        bind:value={base}
        placeholder="/data"
        onkeydown={(e) => e.key === "Enter" && open()}
      />
      <button
        class="rounded bg-accent px-4 py-1 text-sm font-medium text-flag-white
               transition-colors hover:bg-accent-muted disabled:opacity-50"
        disabled={tree.connecting}
        onclick={open}
      >
        {tree.connecting ? "Opening…" : "Open"}
      </button>
    </div>

    {#if tree.error}
      <div class="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
        {tree.error}
      </div>
    {/if}

    <p class="text-[11px] text-faint">
      The host must honour <span class="font-mono">Range</span>; a server that answers
      <span class="font-mono">200</span> with the whole file is rejected rather than read
      wrongly. For development, <span class="font-mono">EPERX_DATA=… pnpm dev</span> serves a
      tree at <span class="font-mono">/data</span>.
    </p>
  </div>
</div>
