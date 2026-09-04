<!--
  Marque, model, catalogue and vehicle, across the top.

  Four searchable dropdowns rather than four columns of a cascade. The cascade
  showed the whole path at once, which was honest but cost 960px of width — and
  the drawing is the thing anyone came to look at. A catalogue also carries up
  to 223 entries and a vehicle up to 10,436 versions, which a column cannot
  present but a search can.

  Group and subgroup stay as lists, on the left: they are short, and they are
  what you move around in.
-->
<script lang="ts">
  import Combobox from "./Combobox.svelte";
  import VehicleSelect from "./VehicleSelect.svelte";
  import {
    browse,
    selectCatalogue,
    selectMake,
    selectModelGroup,
  } from "../lib/browse.svelte";

  const makes = $derived(
    browse.makes.map((make) => ({
      id: make.code,
      label: make.name,
      hint: String(make.catalogues),
    })),
  );

  const models = $derived(
    browse.modelGroups.map((model) => ({
      id: model.code,
      label: model.name,
      hint: String(model.catalogues),
    })),
  );

  const catalogues = $derived(
    browse.catalogues.map((entry) => ({
      id: entry.code,
      label: entry.name,
      hint: entry.code,
    })),
  );

  function pickMake(code: string) {
    const make = browse.makes.find((m) => m.code === code);
    if (make) void selectMake(make);
  }

  function pickModel(code: string) {
    const model = browse.modelGroups.find((m) => m.code === code);
    if (model) void selectModelGroup(model);
  }

  function pickCatalogue(code: string) {
    const entry = browse.catalogues.find((c) => c.code === code);
    if (entry) void selectCatalogue(entry);
  }
</script>

<div class="flex shrink-0 items-center gap-2 border-b border-divider bg-surface px-3 py-1.5">
  <Combobox
    label="Make"
    items={makes}
    value={browse.make?.code}
    width="11rem"
    onpick={pickMake}
  />
  <Combobox
    label="Model"
    items={models}
    value={browse.modelGroup?.code}
    width="13rem"
    disabled={!browse.make}
    onpick={pickModel}
  />
  <Combobox
    label="Catalogue"
    items={catalogues}
    value={browse.catalogue?.code}
    width="20rem"
    disabled={!browse.modelGroup}
    onpick={pickCatalogue}
  />

  <span class="h-5 w-px shrink-0 bg-divider" aria-hidden="true"></span>

  <VehicleSelect />
</div>
