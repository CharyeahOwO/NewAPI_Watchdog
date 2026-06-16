import * as React from "react"
import { createPortal } from "react-dom"
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

type ComboboxPosition = {
  left: number
  top?: number
  bottom?: number
  minWidth: number
  maxHeight: number
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
  const [position, setPosition] = React.useState<ComboboxPosition | null>(null)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value)
  const normalizedQuery = query.trim().toLowerCase()
  const filtered = normalizedQuery
    ? options.filter((option) => `${option.label} ${option.value} ${option.description || ""}`.toLowerCase().includes(normalizedQuery))
    : options

  function updatePosition() {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const gap = 6
    const padding = 8
    const maxPanelHeight = 320
    const minComfortHeight = 180
    const below = Math.max(0, window.innerHeight - rect.bottom - gap - padding)
    const above = Math.max(0, rect.top - gap - padding)
    let placement = side
    if (side === "bottom" && below < minComfortHeight && above > below) placement = "top"
    if (side === "top" && above < minComfortHeight && below > above) placement = "bottom"
    const availableHeight = placement === "top" ? above : below
    const contentWidth = contentRef.current?.offsetWidth || rect.width
    const maxLeft = window.innerWidth - Math.min(contentWidth, window.innerWidth - padding * 2) - padding
    setPosition({
      left: Math.max(padding, Math.min(rect.left, maxLeft)),
      top: placement === "bottom" ? rect.bottom + gap : undefined,
      bottom: placement === "top" ? window.innerHeight - rect.top + gap : undefined,
      minWidth: rect.width,
      maxHeight: Math.max(48, Math.min(maxPanelHeight, availableHeight)),
    })
  }

  React.useEffect(() => {
    function closeOnOutside(event: MouseEvent) {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !contentRef.current?.contains(target)) {
        setOpen(false)
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", closeOnOutside)
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.removeEventListener("mousedown", closeOnOutside)
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [])

  React.useLayoutEffect(() => {
    if (!open) return
    updatePosition()
    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition, true)
    return () => {
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
    }
  }, [open, side])

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-xl border border-input bg-card px-3 text-left text-sm shadow-sm transition-colors",
          "hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20",
          !selected && "text-muted-foreground",
        )}
        onClick={() => {
          if (open) {
            setOpen(false)
          } else {
            updatePosition()
            setOpen(true)
          }
        }}
      >
        {trigger || (
          <>
            <span className="min-w-0 truncate">{selected?.label || placeholder}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 flex-none text-muted-foreground" />
          </>
        )}
      </button>

      {open && position ? createPortal(
        <div
          ref={contentRef}
          style={{
            left: position.left,
            top: position.top,
            bottom: position.bottom,
            minWidth: position.minWidth,
            maxWidth: "calc(100vw - 16px)",
            maxHeight: position.maxHeight,
          }}
          className={cn(
            "fixed z-50 overflow-hidden rounded-xl border bg-card shadow-xl shadow-black/10",
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
          <div className="overflow-auto p-1" style={{ maxHeight: searchable ? Math.max(48, position.maxHeight - 49) : position.maxHeight }}>
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
      , document.body) : null}
    </div>
  )
}
