import { tv, type VariantProps } from "tailwind-variants";

/** Explorer button styles. */
export const buttonVariants = tv({
  base: "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap text-sm font-medium transition outline-none select-none focus-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  variants: {
    variant: {
      default: "rounded-xl bg-primary px-4 font-semibold text-primary-foreground hover:opacity-90",
      outline:
        "rounded-lg border border-border bg-card text-foreground transition hover:bg-surface-hover hover:text-foreground-bright",
      secondary:
        "rounded-lg border border-border bg-card font-semibold text-foreground transition hover:bg-surface-hover hover:text-foreground-bright",
      ghost: "rounded-lg text-muted-foreground hover:bg-surface-hover hover:text-foreground-bright",
      destructive:
        "rounded-xl border border-destructive/30 bg-destructive/10 font-semibold text-destructive hover:bg-destructive/20",
      link: "rounded-lg text-primary underline-offset-4 hover:underline",
    },
    size: {
      default: "h-9 px-2.5",
      xs: "h-7 gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
      sm: "h-9 gap-1.5 px-2.5",
      lg: "h-10 gap-2 px-4 rounded-xl",
      icon: "size-9 rounded-lg",
      "icon-xs": "size-7 rounded-lg [&_svg:not([class*='size-'])]:size-3",
      "icon-sm": "size-9 rounded-lg",
      "icon-lg": "size-10 rounded-xl",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;
