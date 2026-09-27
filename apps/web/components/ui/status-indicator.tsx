import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils/utils"

const statusIndicatorVariants = cva(
  "inline-flex items-center gap-1.5 text-xs font-medium",
  {
    variants: {
      tone: {
        primary: "text-primary",
        warning: "text-warning",
        success: "text-success",
        destructive: "text-destructive",
        neutral: "text-muted-foreground",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  }
)

const statusDotVariants = cva("size-1.5 shrink-0 rounded-full", {
  variants: {
    tone: {
      primary: "bg-primary",
      warning: "bg-warning",
      success: "bg-success",
      destructive: "bg-destructive",
      neutral: "bg-muted-foreground",
    },
  },
  defaultVariants: {
    tone: "neutral",
  },
})

function StatusIndicator({
  className,
  tone,
  children,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof statusIndicatorVariants>) {
  return (
    <span
      data-slot="status-indicator"
      className={cn(statusIndicatorVariants({ tone }), className)}
      {...props}
    >
      <span aria-hidden="true" className={statusDotVariants({ tone })} />
      {children}
    </span>
  )
}

export { StatusIndicator, statusIndicatorVariants }
