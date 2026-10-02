<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import X from "@lucide/svelte/icons/x";
  import Badge from "$lib/components/ui/badge.svelte";
  import { GAP_TIGHT, ICON_SM, ICON_XS } from "$lib/ui/styles";
  import { cn } from "$lib/utils";

  type Props = {
    value?: string[];
    /** Existing tags offered when opening the + picker. */
    suggestions?: string[];
    placeholder?: string;
    addLabel?: string;
    disabled?: boolean;
    class?: string;
    onChange?: (tags: string[]) => void;
  };

  let {
    value = [],
    suggestions = [],
    placeholder = "New tag…",
    addLabel = "Add tag",
    disabled = false,
    class: className,
    onChange,
  }: Props = $props();

  let drafting = $state(false);
  let draft = $state("");
  let inputEl: HTMLInputElement | undefined = $state();
  let root: HTMLDivElement | undefined = $state();

  const tags = $derived(value.map((t) => t.trim()).filter(Boolean));
  const selectedSet = $derived(new Set(tags.map((t) => t.toLowerCase())));
  const needle = $derived(draft.trim().toLowerCase());
  const available = $derived(
    [...new Set(suggestions.map((t) => t.trim()).filter(Boolean))]
      .filter((tag) => !selectedSet.has(tag.toLowerCase()))
      .filter((tag) => !needle || tag.toLowerCase().includes(needle))
      .sort((a, b) => a.localeCompare(b))
  );

  function commit(next: string[]) {
    const unique = [...new Set(next.map((t) => t.trim()).filter(Boolean))];
    onChange?.(unique);
  }

  function startAdd() {
    if (disabled) return;
    drafting = true;
    draft = "";
    queueMicrotask(() => inputEl?.focus());
  }

  function cancelAdd() {
    drafting = false;
    draft = "";
  }

  function addTag(raw = draft) {
    const next = raw.trim().toLowerCase();
    if (!next) {
      cancelAdd();
      return;
    }
    if (!tags.some((t) => t.toLowerCase() === next)) {
      commit([...tags, next]);
    }
    cancelAdd();
  }

  function pickSuggestion(tag: string) {
    addTag(tag);
  }

  function removeTag(tag: string) {
    if (disabled) return;
    commit(tags.filter((t) => t !== tag));
  }

  function onDraftKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      addTag();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelAdd();
    }
  }

  $effect(() => {
    if (!drafting) return;
    const onPointer = (event: PointerEvent) => {
      if (root && !root.contains(event.target as Node)) cancelAdd();
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  });
</script>

<div class={cn("relative flex flex-wrap items-center", GAP_TIGHT, className)} bind:this={root}>
  {#each tags as tag (tag)}
    <Badge variant="outline" class="gap-1 font-normal">
      {tag}
      {#if !disabled}
        <button
          type="button"
          class={cn(
            "inline-flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground",
            ICON_SM
          )}
          aria-label={`Remove ${tag}`}
          onclick={() => removeTag(tag)}
        >
          <X class={ICON_XS} />
        </button>
      {/if}
    </Badge>
  {/each}

  {#if drafting}
    <div class="relative">
      <input
        bind:this={inputEl}
        bind:value={draft}
        class="h-5 w-28 min-w-0 rounded-lg border border-border bg-card px-2 text-xs text-foreground-bright outline-none focus-visible:border-primary"
        {placeholder}
        aria-label={placeholder}
        {disabled}
        onkeydown={onDraftKeydown}
      />
      {#if available.length > 0}
        <div
          class="absolute start-0 top-[calc(100%+0.25rem)] z-50 max-h-40 min-w-36 overflow-y-auto rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-lg [scrollbar-width:thin]"
          role="listbox"
          aria-label={addLabel}
        >
          {#each available as suggestion (suggestion)}
            <button
              type="button"
              role="option"
              class="flex w-full px-2 py-1 text-left text-xs hover:bg-surface-hover"
              onclick={() => pickSuggestion(suggestion)}
            >
              {suggestion}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <button
      type="button"
      class={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition hover:border-primary/50 hover:text-primary",
        disabled && "pointer-events-none opacity-50"
      )}
      title={addLabel}
      aria-label={addLabel}
      {disabled}
      onclick={startAdd}
    >
      <Plus class={ICON_XS} />
    </button>
  {/if}
</div>
