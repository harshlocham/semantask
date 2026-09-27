import * as React from "react"

import { cn } from "@/lib/utils/utils"

function EmptyState({
  title,
  description,
  action,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center",
        className
      )}
      {...props}
    >
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action}
    </div>
  )
}

export { EmptyState }
