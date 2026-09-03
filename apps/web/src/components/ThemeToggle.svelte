<script lang="ts">
  let dark = $state(document.documentElement.classList.contains("dark"));

  function toggle() {
    dark = !dark;
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("eperx.theme", dark ? "dark" : "light");
    } catch {
      // A browser with storage blocked still gets the toggle, just not the memory.
    }
  }
</script>

<button
  class="rounded px-2 py-1 text-muted transition-colors hover:bg-elevated hover:text-foreground"
  title={dark ? "Switch to light" : "Switch to dark"}
  onclick={toggle}
>
  ◐
</button>
