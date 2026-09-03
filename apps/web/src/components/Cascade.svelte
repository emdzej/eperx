<script lang="ts">
  import VehiclePicker from "./VehiclePicker.svelte";
  import {
    browse,
    selectCatalogue,
    selectGroup,
    selectMake,
    selectModelGroup,
    selectSubgroup,
  } from "../lib/browse.svelte";

  // One column per level. Each shows what the level above selected, so the
  // path is always visible rather than collapsed into a breadcrumb.
  const levels = $derived([
    {
      title: "Make",
      items: browse.makes.map((m) => ({
        key: m.code,
        label: m.name,
        hint: `${m.catalogues}`,
        active: browse.make?.code === m.code,
        pick: () => selectMake(m),
      })),
    },
    {
      title: "Model",
      items: browse.modelGroups.map((m) => ({
        key: m.code,
        label: m.name,
        hint: `${m.catalogues}`,
        active: browse.modelGroup?.code === m.code,
        pick: () => selectModelGroup(m),
      })),
    },
    {
      title: "Catalogue",
      items: browse.catalogues.map((c) => ({
        key: c.code,
        label: c.name,
        hint: c.code,
        active: browse.catalogue?.code === c.code,
        pick: () => selectCatalogue(c),
      })),
    },
    {
      title: "Group",
      items: browse.groups.map((g) => ({
        key: String(g.code),
        label: g.name ?? `(${g.code})`,
        hint: String(g.code),
        active: browse.group?.code === g.code,
        pick: () => selectGroup(g),
      })),
    },
    {
      title: "Subgroup",
      items: browse.subgroups.map((s) => ({
        key: String(s.code),
        label: s.name ?? `(${s.code})`,
        hint: `${s.drawings}`,
        active: browse.subgroup?.code === s.code,
        pick: () => selectSubgroup(s),
      })),
    },
  ]);
</script>

<!-- Five levels is inherently wide, so the cascade sits across the top and
     scrolls sideways if it must, rather than squeezing the drawing into a
     strip. ePER's own UI puts its selectors above the diagram too. -->
<div class="flex min-h-0 flex-1">
  <div class="flex min-h-0 flex-1 divide-x divide-divider overflow-x-auto">
  {#each levels as level (level.title)}
    <div class="flex min-h-0 w-44 shrink-0 flex-col">
      <div
        class="shrink-0 border-b border-divider px-2 py-1 text-xs uppercase tracking-wide text-faint"
      >
        {level.title}
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        {#each level.items as item (item.key)}
          <button
            class="flex w-full items-baseline gap-2 border-b border-rule px-2 py-1 text-left
                   text-xs transition-colors hover:bg-elevated
                   {item.active ? 'bg-elevated font-medium text-accent' : 'text-muted'}"
            onclick={item.pick}
          >
            <span class="min-w-0 flex-1 truncate" title={item.label}>{item.label}</span>
            <span class="shrink-0 font-mono text-faint">{item.hint}</span>
          </button>
        {/each}
      </div>
    </div>
    {/each}
  </div>
  <VehiclePicker />
</div>
