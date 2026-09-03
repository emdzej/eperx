<script lang="ts">
  import { HttpSource } from "../lib/http-source";
  import { FileByteSource } from "../lib/local-source";
  import { openShard, shard } from "../lib/shard.svelte";

  // Where an imported tree is served from. `images/` under it holds the
  // shards exactly as the disc wrote them.
  let base = $state("/data/images");
  let name = $state("2E");

  async function openOverHttp() {
    const file = `${name}.res`;
    await openShard(file, new HttpSource(`${base.replace(/\/$/, "")}/${file}`));
  }

  function openLocal(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file) void openShard(file.name, new FileByteSource(file));
  }
</script>

<div class="space-y-3">
  <div>
    <div class="mb-1 text-xs uppercase tracking-wide text-faint">Over HTTP Range</div>
    <div class="flex gap-2">
      <input
        class="min-w-0 flex-1 rounded border border-divider bg-base px-2 py-1 font-mono text-sm
               outline-none focus:border-accent"
        bind:value={base}
        placeholder="/data/images"
      />
      <input
        class="w-16 rounded border border-divider bg-base px-2 py-1 text-center font-mono text-sm
               outline-none focus:border-accent"
        bind:value={name}
        placeholder="2E"
      />
      <button
        class="rounded bg-accent px-3 py-1 text-sm font-medium text-flag-white
               transition-colors hover:bg-accent-muted disabled:opacity-50"
        disabled={shard.busy}
        onclick={openOverHttp}
      >
        Open
      </button>
    </div>
    <p class="mt-1 text-xs text-faint">
      Shard <span class="font-mono">00</span>–<span class="font-mono">FF</span>, or one of the
      <span class="font-mono">L_*</span> archives.
    </p>
  </div>

  <div>
    <div class="mb-1 text-xs uppercase tracking-wide text-faint">Or from disc</div>
    <input
      type="file"
      accept=".res"
      class="w-full text-xs text-muted file:mr-2 file:rounded file:border-0 file:bg-elevated
             file:px-3 file:py-1 file:text-sm file:text-foreground hover:file:bg-divider"
      onchange={openLocal}
    />
    <p class="mt-1 text-xs text-faint">
      <span class="font-mono">Blob.slice()</span> is the same primitive as a Range request, so
      a shard read from disc behaves identically.
    </p>
  </div>
</div>
