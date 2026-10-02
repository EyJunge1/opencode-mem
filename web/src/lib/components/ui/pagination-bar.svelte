<script lang="ts">
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Button from "$lib/components/ui/button.svelte";
  import type { PageSlice } from "$lib/pagination";

  type Props = {
    mode?: "pages" | "prev-next";
    page?: PageSlice<unknown>;
    pageSize?: number;
    currentPage?: number;
    totalPages?: number;
    pageInfo?: string;
    onPageChange?: (page: number) => void;
    onDelta?: (delta: number) => void;
  };

  let {
    mode = "pages",
    page,
    pageSize = 20,
    currentPage = 1,
    totalPages = 1,
    pageInfo = "",
    onPageChange,
    onDelta,
  }: Props = $props();

  const hasPrev = $derived(currentPage > 1);
  const hasNext = $derived(currentPage < totalPages);
</script>

{#if mode === "prev-next"}
  <div class="flex items-center gap-2">
    <Button variant="outline" size="icon-xs" disabled={!hasPrev} onclick={() => onDelta?.(-1)}>
      <ChevronLeft class="size-3.5" />
    </Button>
    <span class="text-xs text-muted-foreground tabular-nums">{pageInfo}</span>
    <Button variant="outline" size="icon-xs" disabled={!hasNext} onclick={() => onDelta?.(1)}>
      <ChevronRight class="size-3.5" />
    </Button>
  </div>
{:else if page && page.total > pageSize}
  <div class="flex flex-wrap items-center gap-1.5 pt-2">
    <span class="text-xs text-muted-foreground mr-2">
      {page.start + 1}-{Math.min(page.start + pageSize, page.total)} / {page.total}
    </span>
    {#each Array.from({ length: page.totalPages }, (_, i) => i + 1) as p (p)}
      <Button
        size="xs"
        variant={p === page.page ? "default" : "outline"}
        onclick={() => onPageChange?.(p)}
      >
        {p}
      </Button>
    {/each}
  </div>
{/if}
