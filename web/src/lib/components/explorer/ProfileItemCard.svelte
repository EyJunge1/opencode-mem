<script lang="ts">
  import Info from "@lucide/svelte/icons/info";
  import PenLine from "@lucide/svelte/icons/pen-line";
  import Target from "@lucide/svelte/icons/target";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Button from "$lib/components/ui/button.svelte";
  import WorkflowSteps from "$lib/components/ui/workflow-steps.svelte";
  import { useI18n } from "$lib/i18n/context.svelte";
  import { CARD_TITLE } from "$lib/memory-display";
  import {
    confidencePct,
    evidenceCount,
    evidenceTitle,
    type ProfileField,
  } from "$lib/profile-utils";
  import type { ProfileItem } from "$lib/types";
  import { cn } from "$lib/utils";

  type Props = {
    item: ProfileItem;
    type: ProfileField;
    variant?: "grid" | "workflow";
    onEdit: () => void;
    onDelete: () => void;
  };

  let { item, type: _type, variant = "grid", onEdit, onDelete }: Props = $props();

  const i18n = useI18n();
  const pct = $derived(confidencePct(item));
  const count = $derived(evidenceCount(item));
  const title = $derived(evidenceTitle(item));
</script>

<div class="space-y-2 rounded-xl border border-border bg-card px-3 py-3">
  <div class="flex items-center gap-2">
    <div class="flex min-w-0 flex-1 items-center gap-2">
      <h3 class={cn(CARD_TITLE, "min-w-0 truncate")}>
        {#if variant === "workflow"}
          {item.description || i18n.t("profile-workflows")}
        {:else}
          {item.category || "General"}
        {/if}
      </h3>
      <span
        class="inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-card px-2 text-[10px] font-medium tabular-nums text-foreground"
        title={`${pct}%`}
      >
        {pct}%
      </span>
    </div>
    <div class="flex shrink-0 items-center gap-1">
      <Button variant="ghost" size="icon-xs" title={i18n.t("btn-edit") || "Edit"} onclick={onEdit}>
        <PenLine class="size-3.5" />
      </Button>
      <Button
        variant="destructive"
        size="icon-xs"
        title={i18n.t("btn-delete") || "Delete"}
        onclick={onDelete}
      >
        <Trash2 class="size-3.5" />
      </Button>
    </div>
  </div>

  {#if variant !== "workflow"}
    <p class="text-sm">{item.description || ""}</p>
  {/if}

  {#if variant === "workflow" && item.steps?.length}
    <WorkflowSteps steps={item.steps} variant="chips" />
  {/if}

  {#if item.evidence || item.frequency || variant === "workflow"}
    <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        class="inline-flex items-center gap-1"
        title={i18n.t("label-evidence-tooltip", { count: item.frequency || 1 })}
      >
        <Target class="size-3" />
        {item.frequency || 1}
      </span>
      {#if count > 0}
        <span>·</span>
        <span class="inline-flex items-center gap-1" {title}>
          <Info class="size-3" />
          {count} evidence
        </span>
      {/if}
    </div>
  {/if}
</div>
