import { CaretDown, Check } from "@phosphor-icons/react"
import type { ReactNode } from "react"
import { useEffect, useId, useRef, useState } from "react"

export interface CustomSelectOption<T extends string | number> {
  value: T
  label: string
}

export function CustomSelect<T extends string | number>({
  id,
  value,
  options,
  disabled = false,
  ariaLabel,
  align = "start",
  className = "",
  buttonClassName = "",
  menuClassName = "",
  selectedContent,
  onChange,
}: {
  id?: string
  value: T
  options: readonly CustomSelectOption<T>[]
  disabled?: boolean
  ariaLabel: string
  align?: "start" | "end"
  className?: string
  buttonClassName?: string
  menuClassName?: string
  selectedContent?: ReactNode
  onChange: (value: T) => void
}) {
  const generatedId = useId()
  const listboxId = `${id ?? generatedId}-listbox`
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const pendingFocusRef = useRef<number | null>(null)
  const searchRef = useRef("")
  const searchTimerRef = useRef<number | null>(null)
  const [open, setOpen] = useState(false)
  const selectedIndex = Math.max(0, options.findIndex((option) => Object.is(option.value, value)))

  useEffect(() => {
    if (!open) return
    const focusIndex = pendingFocusRef.current ?? selectedIndex
    pendingFocusRef.current = null
    const frame = window.requestAnimationFrame(() => optionRefs.current[focusIndex]?.focus())
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener("pointerdown", closeOnOutsidePointer)
    }
  }, [open, selectedIndex])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  useEffect(() => () => {
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current)
  }, [])

  function focusOption(index: number): void {
    const bounded = (index + options.length) % options.length
    optionRefs.current[bounded]?.focus()
  }

  function closeAndFocusTrigger(): void {
    setOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  function select(option: CustomSelectOption<T>): void {
    onChange(option.value)
    closeAndFocusTrigger()
  }

  function focusByTypeahead(key: string): void {
    searchRef.current += key.toLocaleLowerCase()
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current)
    searchTimerRef.current = window.setTimeout(() => {
      searchRef.current = ""
      searchTimerRef.current = null
    }, 600)
    const match = options.findIndex((option) => option.label.toLocaleLowerCase().startsWith(searchRef.current))
    if (match < 0) return
    if (open) focusOption(match)
    else {
      pendingFocusRef.current = match
      setOpen(true)
    }
  }

  const selected = options[selectedIndex]
  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        onClick={() => {
          if (!open) pendingFocusRef.current = selectedIndex
          setOpen((current) => !current)
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault()
            pendingFocusRef.current = selectedIndex
            setOpen(true)
          } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault()
            pendingFocusRef.current = event.key === "Home" ? 0 : options.length - 1
            setOpen(true)
          } else if (event.key === "Escape") {
            setOpen(false)
          } else if (event.key.length === 1 && event.key !== " ") {
            focusByTypeahead(event.key)
          }
        }}
        className={`flex w-full items-center justify-between gap-2 rounded border border-line bg-canvas px-2 text-left text-muted transition-[border-color,background-color,color] duration-150 ease-product hover:border-line-strong hover:text-ink focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${buttonClassName}`}
      >
        <span className="truncate">{selectedContent ?? selected?.label ?? String(value)}</span>
        <CaretDown size={10} className={`shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div id={listboxId} role="listbox" aria-label={ariaLabel} className={`absolute z-50 mt-1 min-w-full overflow-hidden rounded-md border border-line-strong bg-raised p-1 shadow-xl shadow-canvas/60 ${align === "end" ? "right-0" : "left-0"} ${menuClassName}`}>
          {options.map((option, index) => {
            const selectedOption = Object.is(option.value, value)
            return (
              <button
                key={String(option.value)}
                ref={(element) => { optionRefs.current[index] = element }}
                type="button"
                role="option"
                aria-selected={selectedOption}
                onClick={() => select(option)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault()
                    focusOption(index + 1)
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault()
                    focusOption(index - 1)
                  } else if (event.key === "Home" || event.key === "End") {
                    event.preventDefault()
                    focusOption(event.key === "Home" ? 0 : options.length - 1)
                  } else if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    select(option)
                  } else if (event.key === "Escape") {
                    event.preventDefault()
                    closeAndFocusTrigger()
                  } else if (event.key === "Tab") {
                    setOpen(false)
                  } else if (event.key.length === 1) {
                    focusByTypeahead(event.key)
                  }
                }}
                className="flex min-h-10 w-full items-center gap-2 rounded px-2 text-left text-[11px] text-muted hover:bg-panel hover:text-ink focus-visible:bg-panel focus-visible:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                <Check size={12} className={`shrink-0 text-accent ${selectedOption ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
                <span className="whitespace-nowrap">{option.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
