"use client"

import * as React from "react"

import { cn } from "@/lib/utils/utils"

type TabsContextValue = {
  value: string
  setValue: (value: string) => void
  baseId: string
}

const TabsContext = React.createContext<TabsContextValue | null>(null)

function useTabsContext() {
  const context = React.useContext(TabsContext)
  if (!context) {
    throw new Error("Tabs components must be used within Tabs")
  }
  return context
}

function Tabs({
  value: valueProp,
  defaultValue = "",
  onValueChange,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
}) {
  const baseId = React.useId()
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue)
  const value = valueProp ?? uncontrolled

  const setValue = React.useCallback(
    (next: string) => {
      if (valueProp === undefined) {
        setUncontrolled(next)
      }
      onValueChange?.(next)
    },
    [onValueChange, valueProp]
  )

  return (
    <TabsContext.Provider value={{ value, setValue, baseId }}>
      <div data-slot="tabs" className={cn(className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  )
}

function TabsList({
  className,
  onKeyDown,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      role="tablist"
      data-slot="tabs-list"
      className={cn("inline-flex items-center gap-1 rounded-lg bg-muted p-1", className)}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (event.defaultPrevented) return
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return

        const tabs = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')
        )
        const current = tabs.findIndex((tab) => tab === document.activeElement)
        if (current < 0 || tabs.length === 0) return

        event.preventDefault()
        const offset = event.key === "ArrowRight" ? 1 : -1
        const next = tabs[(current + offset + tabs.length) % tabs.length]
        next.focus()
        next.click()
      }}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  value,
  onClick,
  ...props
}: React.ComponentProps<"button"> & { value: string }) {
  const { value: selected, setValue, baseId } = useTabsContext()
  const active = selected === value

  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${value}`}
      aria-selected={active}
      aria-controls={`${baseId}-panel-${value}`}
      tabIndex={active ? 0 : -1}
      data-slot="tabs-trigger"
      data-state={active ? "active" : "inactive"}
      className={cn(
        "rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground outline-none transition-colors focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        active && "bg-background text-foreground shadow-[var(--shadow-card)]",
        className
      )}
      {...props}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) {
          setValue(value)
        }
      }}
    />
  )
}

function TabsContent({
  className,
  value,
  ...props
}: React.ComponentProps<"div"> & { value: string }) {
  const { value: selected, baseId } = useTabsContext()
  if (selected !== value) return null

  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-tab-${value}`}
      data-slot="tabs-content"
      className={cn(className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
