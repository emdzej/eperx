<!--
  What this program is, and what it is not answerable for.

  Reached from the wordmark, which is where people look. Four things, in the
  order someone opening it needs them: what eperx does, whose data it reads,
  what it owes upstream, and the disclaimer — last but styled loudest, because
  a parts catalogue that is wrong looks exactly like one that is right, and a
  reader who skips everything else should not miss that.

  Not a credits screen. The openPER attribution is here because using its
  work obliges it, not as decoration.
-->
<script lang="ts">
  let { onClose }: { onClose: () => void } = $props();

  const DOCS = `${__REPO_URL__}/blob/main/docs/data-format.md`;

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="fixed inset-0 z-40 grid place-items-center bg-black/45 p-6"
  role="presentation"
  onclick={onClose}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="max-h-full w-full max-w-xl overflow-y-auto border border-divider border-l-[3px]
           border-l-accent bg-surface"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    aria-label="About eperx"
    onclick={(event) => event.stopPropagation()}
  >
    <header class="flex items-center px-4 pb-2 pt-3">
      <span class="text-[10px] uppercase tracking-wide text-faint">About</span>
      <button
        class="ml-auto px-1.5 text-xl leading-none text-faint transition-colors hover:text-danger"
        onclick={onClose}
        aria-label="Close"
      >
        ×
      </button>
    </header>

    <div class="px-4 pb-4">
      <!-- The wordmark repeated at reading size, so the dialog names itself. -->
      <p class="mb-3 flex items-baseline gap-2">
        <span class="font-mono text-lg font-semibold tracking-tight">
          <span class="text-foreground">eper</span><span class="text-accent">x</span>
        </span>
        <span class="font-mono text-[11px] tabular-nums text-faint">{__APP_VERSION__}</span>
      </p>

      <p class="mb-2.5 text-xs leading-relaxed text-muted">
        A parts catalogue for the Fiat group — Fiat, Lancia, Alfa Romeo, Abarth, LCV,
        Chrysler — reimplementing <strong class="font-normal text-foreground">ePER 8.3</strong>
        in the browser. It reads the original data directly: the drawings come out of the
        vendor's own archives untouched, and the catalogue is queried a few kilobytes at a
        time. There is no server.
      </p>

      <p class="mb-2.5 text-xs leading-relaxed text-muted">
        Nothing leaves your machine. The tree is read from wherever you point it — a
        static host, a folder, or this browser's own storage — and no part number,
        VIN or query is sent anywhere.
      </p>

      <p class="mb-2.5 text-xs leading-relaxed text-muted">
        The catalogue data is Fiat's. It is not ours, is not included here, and is not
        redistributed. The formats were worked out by reading a disc; the reference is in
        the repository. Prior art:
        <a
          class="text-accent hover:underline"
          href="https://github.com/CReynolds/openPER"
          target="_blank"
          rel="noopener noreferrer">openPER</a
        >, whose schema notes and chassis-format reader this build uses under its MIT
        licence.
      </p>

      <div class="mt-3.5 flex flex-wrap items-center gap-2">
        <a
          class="border border-accent bg-accent px-2.5 py-1 text-[11px] font-semibold
                 text-flag-white no-underline transition-colors hover:bg-accent-muted"
          href={DOCS}
          target="_blank"
          rel="noopener noreferrer"
        >
          Format reference
        </a>
        <a
          class="border border-divider px-2.5 py-1 text-[11px] no-underline text-muted
                 transition-colors hover:border-accent hover:text-foreground"
          href={__REPO_URL__}
          target="_blank"
          rel="noopener noreferrer">Source</a
        >
        <a
          class="border border-divider px-2.5 py-1 text-[11px] no-underline text-muted
                 transition-colors hover:border-accent hover:text-foreground"
          href={`${__REPO_URL__}/issues`}
          target="_blank"
          rel="noopener noreferrer">Report a problem</a
        >
      </div>

      <!--
        The one thing worth reading if nothing else is, so it gets the red edge
        the app reserves for consequences.
      -->
      <div class="mt-4 border-t border-divider border-l-2 border-l-danger pl-3 pt-3">
        <h2 class="mb-1.5 text-xs font-bold text-foreground">Check before you buy</h2>
        <p class="mb-2.5 text-[11px] leading-relaxed text-foreground">
          Which parts fit which vehicle is <strong class="font-bold">reconstructed</strong>,
          not read from ePER. The applicability grammar was worked out from the data and is
          validated only against the data's own consistency — never against a real
          vehicle. A wrong answer here looks exactly like a right one.
        </p>
        <p class="mb-0 text-[11px] leading-relaxed text-foreground">
          Provided <strong class="font-bold">as is, without warranty of any kind</strong>.
          Verify anything you rely on against another source before ordering a part or
          working on a car.
        </p>
      </div>
    </div>
  </div>
</div>
