import * as React from "react"
import { Check, ChevronsUpDown, Search } from "lucide-react"

import { cn } from "@/lib/utils"

export type ComboboxOption = {
  value: string
  label: string
  description?: string
}

type ComboboxProps = {
  value?: string
  onValueChange: (value: string) => void
  options: ComboboxOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  className?: string
  contentClassName?: string
  trigger?: React.ReactNode
  ariaLabel?: string
  side?: "top" | "bottom"
  searchable?: boolean
}

export function Combobox({
  value,
  onValueChange,
  options,
  placeholder = "选择",
  searchPlaceholder = "搜索选项",
  emptyText = "没有匹配项",
  className,
  contentClassName,
  trigger,
  ariaLabel,
  side = "bottom",
  searchable = true,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const rootRef = React.useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value)
  const normalizedQuery = query.trim().toLowerCase()
  const filtered = normalizedQuery
    ? options.filter((option) => `${option.label} ${option.value} ${option.description || ""}`.toLowerCase().includes(normalizedQuery))
    : options

  React.useEffect(() => {
    function closeOnOutside(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", closeOnOutside)
    return () => document.removeEventListener("mousedown", closeOnOutside)
  }, [])

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-xl border border-input bg-card px-3 text-left text-sm shadow-sm transition-colors",
          "hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20",
          !selected && "text-muted-foreground",
        )}
        onClick={() => setOpen((current) => !current)}
      >
        {trigger || (
          <>
            <span className="min-w-0 truncate">{selected?.label || placeholder}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 flex-none text-muted-foreground" />
          </>
        )}
      </button>

      {open ? (
        <div
          className={cn(
            "absolute left-0 z-50 min-w-full overflow-hidden rounded-xl border bg-card shadow-xl shadow-black/10",
            side === "top" ? "bottom-[calc(100%+0.35rem)]" : "top-[calc(100%+0.35rem)]",
            contentClassName,
          )}
        >
          {searchable ? (
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                autoFocus
              />
            </div>
          ) : null}
          <div className="max-h-64 overflow-auto p-1">
            {filtered.length ? (
              filtered.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                    option.value === value ? "bg-foreground text-background" : "hover:bg-muted",
                  )}
                  onClick={() => {
                    onValueChange(option.value)
                    setOpen(false)
                    setQuery("")
                  }}
                >
                  <Check className={cn("h-4 w-4 flex-none", option.value === value ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 flex-1">
                    <span className="block whitespace-nowrap">{option.label}</span>
                    {option.description ? <span className="block whitespace-nowrap text-xs opacity-70">{option.description}</span> : null}
                  </span>
                </button>
              ))
            ) : (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyText}</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
