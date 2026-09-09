<!--
  The second band: which vehicle, and what that does to everything below.

  Only shown once a vehicle is chosen, because until then there is nothing to
  say and an empty strip would be a band of chrome.

  Two shapes, because eperx has two ways to reach a car and they know different
  things. A **version** is a row of `MVS` — the sold specification — so it can
  offer its description, `SINCOM`, engine type and door count. A **VIN** reaches
  that individual car's record in `SP.CH`, which carries its own chassis number,
  engine number, build date and interior colour. The VIN is the better of the
  two when it is available: the criteria are the car's own rather than its
  model variant's, and the strip says which it is rather than leaving the
  reader to infer it.

  masax prints a report from this band. eperx does not, and should not: what it
  knows is the build record, not a spec sheet — there is no OPC to expand and
  no paint or trim code to print.
-->
<script lang="ts">
  import X from "@lucide/svelte/icons/x";
  import { browse, setHideUnfit, specificationLabel, selectVersion } from "../lib/browse.svelte";
  import { i18n } from "../lib/i18n/index.svelte";
  import { vin } from "../lib/vin.svelte";

  const t = $derived(i18n.t);
  const label = $derived(specificationLabel());

  /** `20070207` as the reader's own date; left alone if it is not eight digits. */
  function buildDate(raw: string | undefined): string | undefined {
    if (!raw || !/^\d{8}$/.test(raw)) return raw;
    const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    const at = new Date(`${iso}T00:00:00Z`);
    return Number.isNaN(at.getTime())
      ? raw
      : at.toLocaleDateString(i18n.locale, { timeZone: "UTC" });
  }

  /** Field, value pairs for whichever route was used. Empties dropped. */
  const facts = $derived.by<{ key: string; value: string }[]>(() => {
    const out: { key: string; value: string }[] = [];
    const push = (key: string, value: string | number | null | undefined) => {
      const text = value === null || value === undefined ? "" : String(value).trim();
      if (text) out.push({ key, value: text });
    };

    if (browse.source === "vin") {
      const record = vin.chassisRecord;
      push("strip.mvs", record?.["MVS"]);
      // The chassis as the disc spells it, leading zeros and all.
      push("strip.chassis", record?.["CHASSY"]);
      push("strip.engine", record?.["MOTOR"]);
      push("strip.built", buildDate(record?.["DATE"]));
      push("strip.interior", record?.["INT_COLOR"]);
      return out;
    }

    const version = browse.version;
    if (version) {
      push("strip.sincom", version.sincom);
      push("strip.engine", version.engine);
      push("strip.doors", version.doors);
    }
    return out;
  });
</script>

{#if label}
  <div
    class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-divider
           bg-elevated px-3 py-1 text-[11px]"
  >
    <!-- Which route, said plainly: the two are not equally good. -->
    <span
      class="flex shrink-0 items-center gap-1.5"
      title={browse.source === "vin" ? t("strip.fromVin") : t("strip.fromVersion")}
    >
      <span class="text-[10px] uppercase tracking-wide text-accent">
        {browse.source === "vin" ? t("strip.vin") : t("strip.version")}
      </span>
      <span class="max-w-[26rem] truncate font-medium text-foreground">{label}</span>
      <button
        class="text-faint transition-colors hover:text-danger"
        onclick={() => selectVersion(undefined)}
        title={t("strip.clear")}
        aria-label={t("strip.clear")}
      >
        <X size={12} />
      </button>
    </span>

    {#each facts as fact (fact.key)}
      <span class="flex shrink-0 items-baseline gap-1.5">
        <span class="text-[10px] uppercase tracking-wide text-faint">{t(fact.key)}</span>
        <span class="font-mono text-muted">{fact.value}</span>
      </span>
    {/each}

    <div class="flex-1"></div>

    <label
      class="flex shrink-0 cursor-pointer items-center gap-1.5 text-muted"
      title={t("strip.filterTitle")}
    >
      <input
        type="checkbox"
        class="accent-accent"
        checked={browse.hideUnfit}
        onchange={(e) => setHideUnfit(e.currentTarget.checked)}
      />
      {t("strip.filter")}
    </label>
  </div>
{/if}
