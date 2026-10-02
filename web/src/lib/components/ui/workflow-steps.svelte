<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";

  type Props = {
    steps: string[];
    variant?: "chips" | "inline";
  };

  let { steps, variant = "chips" }: Props = $props();
</script>

{#if steps.length}
  {#if variant === "chips"}
    <div class="flex flex-wrap items-center gap-1.5">
      {#each steps as step, i (i)}
        <div class="contents">
          <div class="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-xs">
            <span class="text-muted-foreground tabular-nums">{i + 1}</span>
            <span>{step}</span>
          </div>
          {#if i < steps.length - 1}
            <ArrowRight class="size-3 text-muted-foreground" />
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <div class="flex flex-wrap gap-1 text-xs text-muted-foreground">
      {#each steps as step, i (i)}
        <span class="contents">
          <span>{i + 1}. {step}</span>
          {#if i < steps.length - 1}
            <ArrowRight class="size-3 inline" />
          {/if}
        </span>
      {/each}
    </div>
  {/if}
{/if}
