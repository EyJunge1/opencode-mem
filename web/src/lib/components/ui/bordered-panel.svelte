<script lang="ts">
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";
  import { ICON_SM, STACK } from "$lib/ui/styles";

  type Props = {
    title: string;
    class?: string;
    collapsible?: boolean;
    defaultOpen?: boolean;
    leading?: Snippet;
    trailing?: Snippet;
    action?: Snippet;
    children?: Snippet;
  };

  let {
    title,
    class: className,
    collapsible = false,
    defaultOpen = true,
    leading,
    trailing,
    action,
    children,
  }: Props = $props();

  let open = $state(defaultOpen);

  function toggle() {
    if (!collapsible) return;
    open = !open;
  }
</script>

<section class={cn("min-w-0", className)}>
  <div
    class={cn(
      "rounded-xl border border-border bg-card px-4 py-4 [--floating-label-bg:var(--card)]",
      STACK
    )}
  >
    {#if collapsible}
      <button
        type="button"
        class="flex w-full items-center gap-2 min-w-0 text-start"
        aria-expanded={open}
        onclick={toggle}
      >
        {#if leading}
          {@render leading()}
        {/if}
        <h2 class="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-foreground-bright">
          {title}
        </h2>
        {#if trailing}
          {@render trailing()}
        {/if}
        {#if action}
          <div class="shrink-0" onclick={(e) => e.stopPropagation()}>
            {@render action()}
          </div>
        {/if}
        <ChevronDown
          class={cn(
            ICON_SM,
            "shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
    {:else}
      <div class="flex items-center gap-2 min-w-0">
        {#if leading}
          {@render leading()}
        {/if}
        <h2 class="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-foreground-bright">
          {title}
        </h2>
        {#if trailing}
          {@render trailing()}
        {/if}
        {#if action}
          <div class="ms-auto shrink-0">{@render action()}</div>
        {/if}
      </div>
    {/if}
    {#if !collapsible || open}
      {@render children?.()}
    {/if}
  </div>
</section>
