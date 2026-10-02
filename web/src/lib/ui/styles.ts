/** Shared Tailwind class fragments for the explorer chrome. */

export const ACTIVE_ACCENT = "bg-primary/15 text-primary";

export const HOVER_SURFACE = "hover:bg-surface-hover hover:text-foreground-bright";

export const ICON_WELL = `inline-flex items-center justify-center rounded-xl ${ACTIVE_ACCENT}`;

/** Dense icon inside inputs (search affordance). */
export const ICON_BTN_DENSE = "size-8 rounded-lg";

/** Text field shell (h-10 / rounded-xl / page bg). */
export const FIELD_INPUT =
  "w-full h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground-bright focus-ring";

export const SURFACE_CARD = "rounded-xl border border-border bg-card";

/** Sort/Filter toolbar control (Cleanup, Deduplicate, …). */
export const TOOLBAR_BTN =
  "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-2.5 text-sm text-foreground transition hover:bg-surface-hover hover:text-foreground-bright focus-ring disabled:pointer-events-none disabled:opacity-50";

/** Horizontal page gutter. */
export const PAGE_GUTTER = "px-[clamp(16px,3vw,40px)]";

/** Header row — compact `px-3 md:px-4`, not the page clamp. */
export const HEADER_GUTTER = "px-3 md:px-4";

/** Toolbar under the header line — same left/right rhythm as the page shell. */
export const PAGE_TOOLBAR = `flex flex-col gap-3 -mx-[clamp(16px,3vw,40px)] mb-4 ${PAGE_GUTTER} py-3`;

/** Page content shell — full-bleed, no max-width. */
export const PAGE_SHELL = "mx-auto w-full max-w-none flex-1 space-y-6 pt-3 pb-12 " + PAGE_GUTTER;

/** Inner spacing helper when not using BorderedPanel. */
export const PANEL = "rounded-xl border border-border bg-card p-4 space-y-3";
