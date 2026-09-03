<script lang="ts">
  import EntryList from "./components/EntryList.svelte";
  import OpenShard from "./components/OpenShard.svelte";
  import ThemeToggle from "./components/ThemeToggle.svelte";
  import Wordmark from "./components/Wordmark.svelte";
  import { shard } from "./lib/shard.svelte";

  // The point of the whole exercise, stated as a number: what fraction of the
  // archive had to be transferred to show what is on screen.
  const fetchedShare = $derived(
    shard.totalBytes ? (shard.fetchedBytes / shard.totalBytes) * 100 : 0,
  );

  const kb = (n: number) => `${(n / 1024).toFixed(1)} kB`;
  const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;
</script>

<div class="flex h-full flex-col">
  <!-- Tricolor hairline: green / off-white / red, left to right. -->
  <div class="flex h-0.5 shrink-0">
    <div class="flex-1 bg-accent"></div>
    <div class="flex-1 bg-flag-white"></div>
    <div class="flex-1 bg-accent-alt"></div>
  </div>

  <header
    class="flex shrink-0 items-center gap-3 border-b border-divider bg-surface px-4 py-2"
  >
    <Wordmark />
    <span class="text-xs text-faint">ePER parts catalogue, client-side</span>
    <div class="flex-1"></div>
    {#if shard.name}
      <span class="font-mono text-xs text-muted">{shard.name}</span>
      <span class="text-xs text-faint">{mb(shard.totalBytes)}</span>
    {/if}
    <ThemeToggle />
  </header>

  <main class="flex min-h-0 flex-1">
    <aside class="flex w-96 shrink-0 flex-col border-r border-divider bg-surface">
      <div class="border-b border-divider p-3">
        <OpenShard />
      </div>
      <div class="min-h-0 flex-1">
        <EntryList />
      </div>
    </aside>

    <section class="flex min-w-0 flex-1 flex-col bg-base">
      {#if shard.error}
        <div
          class="m-4 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {shard.error}
        </div>
      {/if}

      <div class="flex min-h-0 flex-1 items-center justify-center p-4">
        {#if shard.imageUrl}
          <img
            src={shard.imageUrl}
            alt={shard.selected?.name ?? "drawing"}
            class="max-h-full max-w-full object-contain"
          />
        {:else if shard.busy}
          <p class="text-sm text-faint">Reading…</p>
        {:else}
          <div class="max-w-md space-y-3 text-center">
            <p class="text-sm text-muted">
              Open a drawing shard, then pick an entry.
            </p>
            <p class="text-xs text-faint">
              The shards are ePER's own <span class="font-mono">images/*.res</span> archives,
              unmodified. Every drawing in them is <em>stored</em> rather than deflated, so one
              ranged read returns the PNG — the archive is never downloaded.
            </p>
          </div>
        {/if}
      </div>

      {#if shard.selected}
        <footer
          class="grid shrink-0 grid-cols-4 gap-4 border-t border-divider bg-surface px-4 py-2
                 font-mono text-xs"
        >
          <div>
            <div class="text-faint">offset</div>
            <div class="text-foreground">{shard.selected.offset.toLocaleString()}</div>
          </div>
          <div>
            <div class="text-faint">length</div>
            <div class="text-foreground">{kb(shard.selected.length)}</div>
          </div>
          <div>
            <div class="text-faint">method</div>
            <div class={shard.selected.method === 0 ? "text-ok" : "text-warn"}>
              {shard.selected.method === 0 ? "stored" : "deflate"}
            </div>
          </div>
          <div>
            <div class="text-faint">transferred</div>
            <div class="text-accent">
              {kb(shard.fetchedBytes)}
              <span class="text-faint">({fetchedShare.toFixed(2)}%)</span>
            </div>
          </div>
        </footer>
      {/if}
    </section>
  </main>
</div>
