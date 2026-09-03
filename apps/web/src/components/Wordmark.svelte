<script lang="ts">
  // The wordmark: `eper` in the foreground colour, `x` in Italian green.
  //
  // The `x` is the part that is not Fiat's — it marks the reimplementation,
  // the same way dialogysx does. Do not add a fourth span or restyle `eper`
  // in the tricolor; that would read as a Fiat mark rather than a project one.
  //
  // The empty script block is load-bearing: without `lang="ts"` on a file that
  // has no script at all, svelte-check cannot infer a component type and the
  // import resolves to `any`.
</script>

<span class="font-mono text-lg font-semibold tracking-tight">
  <span class="text-foreground">eper</span><span class="text-accent">x</span>
</span>
