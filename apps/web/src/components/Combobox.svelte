<script
  lang="ts"
  generics="T extends { id: string; label: string; subtitle?: string; hint?: string }"
>
  /**
   * Single-select with type-ahead. Adapted from the sibling `uci` project,
   * which is where eperx's theme comes from, so the two behave alike.
   *
   * Keyboard model:
   *   ArrowDown (closed) → open
   *   ArrowUp / ArrowDown (open) → move the highlight
   *   Enter → pick, Escape → close without picking, Tab → close and move on
   *
   * Filtering is a `$derived` rather than a side effect, which is what makes
   * it feel live: every keystroke recomputes it.
   *
   * `onsearch` exists for lists too long to hold: a catalogue can carry 10,436
   * vehicle versions, so those are fetched per query instead of loaded and
   * filtered here. When it is given, local filtering is skipped — the caller's
   * results are already the answer, and filtering them again would hide rows
   * the server matched on a field this component cannot see.
   */
  interface Props {
    items: T[];
    value: string | undefined;
    placeholder?: string;
    disabled?: boolean;
    /** Short label before the value, e.g. `Make`. */
    label?: string;
    width?: string;
    /** Fetch matches for a query instead of filtering `items` locally. */
    onsearch?: (query: string) => void;
    onpick: (id: string) => void;
  }

  let {
    items,
    value,
    placeholder = "—",
    disabled = false,
    label,
    width,
    onsearch,
    onpick,
  }: Props = $props();

  let open = $state(false);
  let query = $state("");
  let highlighted = $state(0);
  let triggerEl = $state<HTMLButtonElement | undefined>();
  let popupEl = $state<HTMLDivElement | undefined>();
  let searchEl = $state<HTMLInputElement | undefined>();

  const current = $derived(items.find((item) => item.id === value));
  const filtered = $derived.by(() => {
    if (onsearch) return items;
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) || (item.subtitle ?? "").toLowerCase().includes(q),
    );
  });

  // Snap the highlight back into range when the list shrinks under it.
  $effect(() => {
    if (highlighted >= filtered.length) highlighted = Math.max(0, filtered.length - 1);
  });

  // Debounced, because a remote search fires per keystroke otherwise.
  $effect(() => {
    if (!onsearch || !open) return;
    const q = query;
    const timer = setTimeout(() => onsearch(q), 180);
    return () => clearTimeout(timer);
  });

  function openPopup(): void {
    if (disabled) return;
    open = true;
    query = "";
    highlighted = Math.max(
      0,
      value ? items.findIndex((item) => item.id === value) : 0,
    );
    // After the next paint, so the popup is in the DOM. `requestAnimationFrame`
    // rather than `setTimeout(0)`, which races Svelte's render queue.
    requestAnimationFrame(() => searchEl?.focus());
  }

  function closePopup(restoreFocus = true): void {
    open = false;
    query = "";
    if (restoreFocus) triggerEl?.focus();
  }

  function pick(item: T): void {
    onpick(item.id);
    closePopup();
  }

  function onTriggerKeydown(event: KeyboardEvent): void {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPopup();
    }
  }

  function onSearchKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      closePopup();
    } else if (event.key === "Tab") {
      closePopup(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      highlighted = Math.min(filtered.length - 1, highlighted + 1);
      scrollIntoView();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      highlighted = Math.max(0, highlighted - 1);
      scrollIntoView();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = filtered[highlighted];
      if (item) pick(item);
    }
  }

  function scrollIntoView(): void {
    requestAnimationFrame(() => {
      popupEl
        ?.querySelector<HTMLElement>('[data-highlighted="true"]')
        ?.scrollIntoView({ block: "nearest" });
    });
  }

  // Listen only while the popup is open, rather than keeping a global handler.
  $effect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerEl?.contains(target) || popupEl?.contains(target)) return;
      closePopup(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  });
</script>

<div class="relative" style={width ? `width: ${width}` : undefined}>
  <button
    bind:this={triggerEl}
    type="button"
    class="flex w-full items-center justify-between gap-2 rounded border border-divider bg-base
           px-2 py-1 text-xs transition-colors hover:border-rule focus:border-accent
           focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
    aria-haspopup="listbox"
    aria-expanded={open}
    {disabled}
    onclick={() => (open ? closePopup() : openPopup())}
    onkeydown={onTriggerKeydown}
  >
    <span class="flex min-w-0 items-baseline gap-1.5">
      {#if label}
        <span class="shrink-0 text-[10px] uppercase tracking-wide text-faint">{label}</span>
      {/if}
      <span class="truncate {current ? 'text-foreground' : 'italic text-faint'}">
        {current?.label ?? placeholder}
      </span>
    </span>
    <span class="shrink-0 text-faint" aria-hidden="true">▾</span>
  </button>

  {#if open}
    <div
      bind:this={popupEl}
      role="listbox"
      aria-label={label}
      class="absolute left-0 top-full z-30 mt-1 flex max-h-96 w-full min-w-[16rem] flex-col
             overflow-hidden rounded border border-divider bg-surface shadow-xl"
    >
      <div class="border-b border-divider p-1.5">
        <input
          bind:this={searchEl}
          bind:value={query}
          type="text"
          class="w-full rounded border border-divider bg-base px-2 py-1 text-xs
                 focus:border-accent focus:outline-none"
          placeholder="Search…"
          onkeydown={onSearchKeydown}
        />
      </div>
      <div class="flex-1 overflow-auto">
        {#each filtered as item, i (item.id)}
          {@const selected = item.id === value}
          <button
            type="button"
            role="option"
            aria-selected={selected}
            data-highlighted={i === highlighted}
            class="flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left text-xs
                   transition-colors {i === highlighted ? 'bg-elevated' : ''} {selected
              ? 'text-accent'
              : 'text-foreground'} hover:bg-elevated"
            onmouseenter={() => (highlighted = i)}
            onclick={() => pick(item)}
          >
            <span class="min-w-0 flex-1">
              <span class="block truncate {selected ? 'font-semibold' : ''}">{item.label}</span>
              {#if item.subtitle}
                <span class="mt-0.5 block truncate font-mono text-[10px] text-faint">
                  {item.subtitle}
                </span>
              {/if}
            </span>
            {#if item.hint}
              <span class="shrink-0 font-mono text-[10px] text-faint">{item.hint}</span>
            {/if}
          </button>
        {:else}
          <p class="p-3 text-center text-[11px] text-faint">No matches</p>
        {/each}
      </div>
    </div>
  {/if}
</div>
