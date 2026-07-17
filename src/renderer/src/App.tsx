import {
  ArrowClockwise,
  BracketsCurly,
  CaretDown,
  CaretLeft,
  CaretRight,
  Check,
  CirclesThreePlus,
  Code,
  Copy,
  Database,
  DotsThree,
  FolderSimple,
  Funnel,
  HardDrives,
  Lightning,
  MagnifyingGlass,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  Robot,
  ShieldCheck,
  SidebarSimple,
  Sparkle,
  Star,
  Trash,
  X,
} from "@phosphor-icons/react"
import { FormEvent, useDeferredValue, useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type {
  AccessMode,
  CollectionInfo,
  CopilotModel,
  CopilotStatus,
  DatabaseInfo,
  FindResult,
  SavedConnection,
  SaveConnectionInput,
} from "../../shared/types"
import { getBsonDisplay, type BsonDisplayKind } from "./bson-format"

type Message = { role: "assistant" | "user"; text: string }
type CollectionPreferences = { sort: string; pageSize: number }

const pageSizes = [10, 20, 50, 100] as const
const panelLimits = {
  left: { min: 180, max: 420, initial: 240 },
  right: { min: 260, max: 560, initial: 320 },
  centerMin: 480,
} as const

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function readPanelWidth(key: "left" | "right"): number {
  const limits = panelLimits[key]
  const stored = Number(localStorage.getItem(`mongo-pilot:panel-width:${key}`))
  return Number.isFinite(stored) && stored > 0 ? clamp(stored, limits.min, limits.max) : limits.initial
}

function PanelResizeHandle({
  label,
  value,
  min,
  max,
  direction,
  onResize,
}: {
  label: string
  value: number
  min: number
  max: number
  direction: 1 | -1
  onResize: (value: number) => void
}) {
  const drag = useRef<{ pointerId: number; startX: number; startValue: number } | null>(null)

  function finishDrag(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    drag.current = null
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
  }

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={(event) => {
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startValue: value }
        event.currentTarget.setPointerCapture(event.pointerId)
        document.body.style.cursor = "col-resize"
        document.body.style.userSelect = "none"
      }}
      onPointerMove={(event) => {
        if (!drag.current || drag.current.pointerId !== event.pointerId) return
        onResize(clamp(drag.current.startValue + (event.clientX - drag.current.startX) * direction, min, max))
      }}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
        event.preventDefault()
        const boundaryDelta = event.key === "ArrowRight" ? 12 : -12
        onResize(clamp(value + boundaryDelta * direction, min, max))
      }}
      className="group absolute inset-y-0 z-30 w-2 -translate-x-1/2 cursor-col-resize touch-none focus-visible:outline-none"
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line transition-[width,background-color] duration-150 group-hover:w-0.5 group-hover:bg-accent group-focus-visible:w-0.5 group-focus-visible:bg-accent" />
    </div>
  )
}

function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="markdown-message">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

function IconButton({ label, children, onClick }: { label: string; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-10 shrink-0 place-items-center rounded-md text-muted transition-[background-color,color,transform] duration-150 ease-product hover:bg-raised hover:text-ink active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
    >
      {children}
    </button>
  )
}

function AccessBadge({ mode }: { mode: AccessMode }) {
  const label = mode === "read-only" ? "READ" : "READ / WRITE"
  return (
    <span className="rounded-sm border border-line bg-canvas px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-muted">
      {label}
    </span>
  )
}

function JsonPrimitive({ value }: { value: unknown }) {
  if (value === null) return <span className="text-faint">null</span>
  if (typeof value === "string") return <span className="break-all text-muted">{JSON.stringify(value)}</span>
  if (typeof value === "boolean") return <span className="text-warning">{String(value)}</span>
  return <span className="text-ink">{String(value)}</span>
}

const bsonTextColor: Record<BsonDisplayKind, string> = {
  id: "text-danger",
  date: "text-accent-strong",
  number: "text-warning",
  binary: "text-muted",
  regex: "text-accent",
  special: "text-muted",
}

function JsonValue({ value, path }: { value: unknown; path: string }) {
  const [expanded, setExpanded] = useState(false)
  const bson = getBsonDisplay(value)
  if (bson) return <span className={`break-all ${bsonTextColor[bson.kind]}`}>{bson.text}</span>
  const isArray = Array.isArray(value)
  const isObject = value !== null && typeof value === "object" && !isArray
  if (!isArray && !isObject) return <JsonPrimitive value={value} />

  const entries = isArray
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>)
  const summary = isArray
    ? `[${entries.length} item${entries.length === 1 ? "" : "s"}]`
    : `{${entries.length} key${entries.length === 1 ? "" : "s"}}`

  return (
    <span className="inline-block min-w-0 align-top">
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${path}`}
        onClick={() => setExpanded((open) => !open)}
        className="inline-flex min-h-6 items-center gap-1 rounded px-1 text-left text-faint hover:bg-raised hover:text-muted focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
      >
        {expanded ? <CaretDown size={11} aria-hidden="true" /> : <CaretRight size={11} aria-hidden="true" />}
        <span>{summary}</span>
      </button>
      {expanded && (
        <span className="mt-1 block border-l border-line pl-4">
          {entries.map(([key, child]) => (
            <span key={`${path}.${key}`} className="block min-h-6 leading-6">
              <span className="text-faint">{isArray ? key : JSON.stringify(key)}: </span>
              <JsonValue value={child} path={`${path}.${key}`} />
            </span>
          ))}
        </span>
      )}
    </span>
  )
}

function JsonDocument({ document }: { document: unknown }) {
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    return <JsonValue value={document} path="document" />
  }
  return (
    <div className="min-w-0 font-mono text-xs leading-6">
      {Object.entries(document as Record<string, unknown>).map(([key, value]) => (
        <div key={key} className="min-h-6">
          <span className="text-faint">{JSON.stringify(key)}: </span>
          <JsonValue value={value} path={key} />
        </div>
      ))}
    </div>
  )
}

function ConnectionDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (connection: SavedConnection) => void }) {
  const [name, setName] = useState("")
  const [uri, setUri] = useState("")
  const [accessMode, setAccessMode] = useState<AccessMode>("read-only")
  const [favorite, setFavorite] = useState(false)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [onClose])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!uri.trim()) {
      setError("Enter a connection string.")
      return
    }
    setSaving(true)
    setError("")
    try {
      if (!window.mongoPilot) throw new Error("Connection storage is available in the Electron app.")
      const input: SaveConnectionInput = { name: name.trim() || "MongoDB deployment", uri, accessMode, favorite }
      onSaved(await window.mongoPilot.connections.save(input))
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this connection.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-canvas/80 p-4 backdrop-blur-sm" role="presentation" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-title"
        className="w-full max-w-xl overflow-hidden rounded-xl border border-line-strong bg-panel shadow-2xl shadow-canvas/60"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between border-b border-line px-6 py-5">
          <div>
            <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-accent">New deployment</p>
            <h2 id="connection-title" className="text-xl font-semibold tracking-tight">Connect MongoDB</h2>
          </div>
          <IconButton label="Close connection dialog" onClick={onClose}><X size={18} aria-hidden="true" /></IconButton>
        </header>
        <form onSubmit={submit} className="space-y-5 p-6">
          <div className="space-y-2">
            <label htmlFor="connection-name" className="block text-xs font-medium">Connection name</label>
            <input
              id="connection-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="My MongoDB"
              className="h-11 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm placeholder:text-faint focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="connection-uri" className="block text-xs font-medium">Connection string <span className="text-danger">*</span></label>
            <input
              id="connection-uri"
              type="text"
              value={uri}
              onChange={(event) => setUri(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "connection-error" : "connection-hint"}
              placeholder="mongodb+srv://user:password@cluster.example.net"
              className="h-11 w-full rounded-md border border-line-strong bg-canvas px-3 font-mono text-sm placeholder:font-sans placeholder:text-faint focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none"
            />
            <p id="connection-hint" className="text-xs text-muted">Any connection string accepted by the MongoDB driver is supported. Credentials are encrypted with your operating system keychain.</p>
            {error && <p id="connection-error" role="alert" className="text-sm text-danger">{error}</p>}
          </div>
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium">Agent access</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["read-only", "read-write"] as const).map((mode) => (
                <label key={mode} className={`flex min-h-20 cursor-pointer flex-col justify-between rounded-md border p-3 transition-[border-color,background-color] duration-150 ease-product ${accessMode === mode ? "border-accent bg-accent-soft" : "border-line bg-canvas hover:border-line-strong"}`}>
                  <input className="sr-only" type="radio" name="access-mode" value={mode} checked={accessMode === mode} onChange={() => setAccessMode(mode)} />
                  <ShieldCheck size={18} className={accessMode === mode ? "text-accent" : "text-muted"} aria-hidden="true" />
                  <span className="text-xs font-medium capitalize">{mode.replace("-", " ")}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted">Pilot only receives MongoDB tools allowed by this mode. Every operation is checked again in the desktop process; MongoDB roles remain authoritative.</p>
          </fieldset>
          <label className="flex min-h-10 cursor-pointer items-center gap-3 text-xs text-muted">
            <input type="checkbox" checked={favorite} onChange={(event) => setFavorite(event.target.checked)} className="size-4 accent-accent" />
            Pin this connection to the top
          </label>
          <footer className="flex justify-end gap-2 border-t border-line pt-5">
            <button type="button" onClick={onClose} className="h-10 rounded-md px-4 text-sm font-medium text-muted transition-[background-color,color] duration-150 ease-product hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">Cancel</button>
            <button type="submit" disabled={saving} aria-busy={saving} className="h-10 rounded-md bg-accent px-4 text-sm font-semibold text-canvas transition-[background-color,transform] duration-150 ease-product hover:bg-accent-strong active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel focus-visible:outline-none disabled:cursor-wait disabled:opacity-60">
              {saving ? "Encrypting..." : "Save connection"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}

function CopilotPanel({
  status,
  context,
  canWrite,
  onModeChange,
}: {
  status: CopilotStatus
  context: {
    connectionId?: string
    connectionName: string
    connectionHost?: string
    database: string
    collection: string
    accessMode: AccessMode
    availableConnections: Array<{ name: string; host: string; accessMode: AccessMode; favorite: boolean }>
  }
  canWrite: boolean
  onModeChange: (mode: AccessMode) => void
}) {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", text: "I can draft filters, aggregation pipelines, schema checks, and report plans. Connect a deployment and I can use MongoDB tools within its agent access mode." },
  ])
  const [prompt, setPrompt] = useState("")
  const [sending, setSending] = useState(false)
  const [localStatus, setLocalStatus] = useState(status)
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [modelQuery, setModelQuery] = useState("")
  const [models, setModels] = useState<CopilotModel[]>([])
  const [selectedModel, setSelectedModel] = useState<CopilotModel | null>(null)
  const [modelsLoading, setModelsLoading] = useState(false)
  const deferredModelQuery = useDeferredValue(modelQuery)
  const normalizedModelQuery = deferredModelQuery.trim().toLocaleLowerCase()
  const filteredModels = normalizedModelQuery
    ? models.filter((model) => [model.name, model.providerName, model.providerID, model.modelID, model.family]
      .some((value) => value?.toLocaleLowerCase().includes(normalizedModelQuery)))
    : models

  useEffect(() => setLocalStatus(status), [status])
  useEffect(() => {
    if (status.state !== "ready" || !window.mongoPilot || typeof window.mongoPilot.copilot.models !== "function") return
    let cancelled = false
    setModelsLoading(true)
    void window.mongoPilot.copilot.models()
      .then((result) => {
        if (cancelled) return
        setModels(result.models)
        const stored = localStorage.getItem("mongo-pilot:copilot-model")
        const preferred = stored
          ? result.models.find((model) => `${model.providerID}/${model.modelID}` === stored)
          : undefined
        const defaultModel = result.defaultModel
          ? result.models.find((model) => model.providerID === result.defaultModel!.providerID && model.modelID === result.defaultModel!.modelID)
          : undefined
        setSelectedModel(preferred ?? defaultModel ?? result.models.find((model) => model.supportsTools) ?? result.models[0] ?? null)
      })
      .catch(() => {
        if (!cancelled) setModels([])
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [status.state])

  async function send(event: FormEvent) {
    event.preventDefault()
    const text = prompt.trim()
    if (!text || sending) return
    setMessages((current) => [...current, { role: "user", text }])
    setPrompt("")
    setSending(true)
    try {
      if (!window.mongoPilot) throw new Error("OpenCode is available in the Electron app.")
      if (localStatus.state !== "ready") setLocalStatus(await window.mongoPilot.copilot.start())
      const reply = await window.mongoPilot.copilot.prompt({
        text,
        context,
        model: selectedModel ? { providerID: selectedModel.providerID, modelID: selectedModel.modelID } : undefined,
      })
      setMessages((current) => [...current, { role: "assistant", text: reply.text }])
      if (window.mongoPilot) setLocalStatus(await window.mongoPilot.copilot.status())
    } catch (reason) {
      setMessages((current) => [...current, { role: "assistant", text: `Request failed: ${reason instanceof Error ? reason.message : "Unknown error."}` }])
      setLocalStatus(await window.mongoPilot.copilot.status())
    } finally {
      setSending(false)
    }
  }

  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-l border-line bg-shell max-lg:hidden">
      <div className="border-b border-line bg-panel px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-mono text-xs text-ink">{context.connectionId ? `${context.database}.${context.collection}` : "Saved connections"}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
              <span className={`size-1.5 rounded-full ${localStatus.state === "ready" ? "bg-accent" : localStatus.state === "error" ? "bg-danger" : "bg-warning"}`} />
              OpenCode {localStatus.state} · {context.connectionId ? `tools scoped to ${context.accessMode}` : `${context.availableConnections.length} available`}
            </p>
          </div>
          <AccessBadge mode={context.accessMode} />
        </div>
      </div>
      <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto p-3" aria-live="polite">
        {messages.map((message, index) => (
          <article key={`${message.role}-${index}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start pl-1 pr-4"}`}>
            <div className={message.role === "user" ? "max-w-[88%] rounded-lg bg-raised px-3 py-2.5" : "min-w-0 max-w-full"}>
              <MarkdownMessage text={message.text} />
            </div>
          </article>
        ))}
        {sending && (
          <div className="flex items-center gap-2 pl-1 text-xs text-muted"><span className="size-1.5 rounded-full bg-accent" /><span>Working<span className="cursor-blink">_</span></span></div>
        )}
      </div>
      <form onSubmit={send} className="border-t border-line p-3">
        <label htmlFor="pilot-prompt" className="sr-only">Ask Pilot</label>
        <div className="rounded-lg border border-line-strong bg-panel">
          <div className="flex min-h-8 items-center gap-2 border-b border-line px-3 font-mono text-[10px] text-muted">
            <HardDrives size={13} className="shrink-0 text-accent" aria-hidden="true" />
            <span className="truncate">
              {context.connectionId
                ? `${context.connectionName} · ${context.connectionHost} · ${context.database}.${context.collection}`
                : `${context.availableConnections.length} saved connection${context.availableConnections.length === 1 ? "" : "s"} available`}
            </span>
          </div>
          <textarea
            id="pilot-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
            rows={3}
            placeholder="Ask about your MongoDB data..."
            className="w-full resize-none bg-transparent px-3 pt-3 text-xs leading-5 placeholder:text-faint focus:outline-none"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <div
              className="relative min-w-0"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setModelMenuOpen(false)
                  setModelQuery("")
                }
              }}
            >
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={modelMenuOpen}
                onClick={() => {
                  if (modelMenuOpen) setModelQuery("")
                  setModelMenuOpen(!modelMenuOpen)
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setModelMenuOpen(false)
                    setModelQuery("")
                  }
                }}
                className="flex h-7 max-w-36 items-center gap-1.5 rounded border border-line bg-canvas px-2 text-[10px] font-medium text-muted transition-[border-color,background-color,color] duration-150 ease-product hover:border-line-strong hover:text-ink focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none"
              >
                <Robot size={12} className="shrink-0 text-accent" aria-hidden="true" />
                <span className="truncate">{modelsLoading ? "Loading models" : selectedModel?.name ?? "Choose model"}</span>
                <CaretDown size={10} className="shrink-0" aria-hidden="true" />
              </button>
              {modelMenuOpen && (
                <div className="absolute bottom-full left-0 z-10 mb-2 w-72 overflow-hidden rounded-md border border-line-strong bg-raised shadow-xl shadow-canvas/50">
                  <div className="border-b border-line p-2">
                    <label htmlFor="model-search" className="sr-only">Search models</label>
                    <div className="flex h-9 items-center gap-2 rounded-md border border-line bg-canvas px-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
                      <MagnifyingGlass size={13} className="shrink-0 text-faint" aria-hidden="true" />
                      <input
                        id="model-search"
                        type="search"
                        autoFocus
                        autoComplete="off"
                        value={modelQuery}
                        onChange={(event) => setModelQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.preventDefault()
                          if (event.key === "Escape") {
                            event.preventDefault()
                            setModelMenuOpen(false)
                            setModelQuery("")
                          }
                        }}
                        placeholder="Search models..."
                        className="min-w-0 flex-1 bg-transparent text-[11px] text-ink placeholder:text-faint focus:outline-none"
                      />
                    </div>
                  </div>
                  <div role="listbox" aria-label="OpenCode model" className="scrollbar-thin max-h-64 overflow-y-auto p-1">
                    {filteredModels.map((model) => {
                      const selected = selectedModel?.providerID === model.providerID && selectedModel.modelID === model.modelID
                      return (
                        <button
                          key={`${model.providerID}/${model.modelID}`}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => {
                            setSelectedModel(model)
                            localStorage.setItem("mongo-pilot:copilot-model", `${model.providerID}/${model.modelID}`)
                            setModelMenuOpen(false)
                            setModelQuery("")
                          }}
                          className="flex min-h-11 w-full items-center gap-2 rounded px-2 text-left hover:bg-panel focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                        >
                          <Check size={12} className={`shrink-0 ${selected ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[11px] font-medium text-ink">{model.name}</span>
                            <span className="block truncate font-mono text-[9px] text-faint">{model.providerName} · {model.modelID}</span>
                          </span>
                          {!model.supportsTools && <span className="shrink-0 rounded border border-line px-1 font-mono text-[8px] text-faint">NO TOOLS</span>}
                        </button>
                      )
                    })}
                    {!modelsLoading && models.length === 0 && <p className="px-3 py-6 text-center text-[11px] text-faint">No models available</p>}
                    {!modelsLoading && models.length > 0 && filteredModels.length === 0 && <p className="px-3 py-6 text-center text-[11px] text-faint">No models match "{deferredModelQuery.trim()}"</p>}
                  </div>
                </div>
              )}
            </div>
            <div
              className="relative"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setModeMenuOpen(false)
              }}
            >
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={modeMenuOpen}
                onClick={() => setModeMenuOpen((open) => !open)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setModeMenuOpen(false)
                }}
                className="flex h-7 items-center gap-1.5 rounded border border-line bg-canvas px-2 text-[10px] font-medium text-muted transition-[border-color,background-color,color] duration-150 ease-product hover:border-line-strong hover:text-ink focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none"
              >
                <ShieldCheck size={12} className="text-accent" aria-hidden="true" />
                Agent: {context.accessMode === "read-only" ? "Read" : "Read / write"}
                <CaretDown size={10} aria-hidden="true" />
              </button>
              {modeMenuOpen && (
                <div role="menu" aria-label="Agent mode" className="absolute bottom-full left-0 z-10 mb-2 w-40 overflow-hidden rounded-md border border-line-strong bg-raised p-1 shadow-xl shadow-canvas/50">
                  <button type="button" role="menuitemradio" aria-checked={context.accessMode === "read-only"} onClick={() => { onModeChange("read-only"); setModeMenuOpen(false) }} className="flex min-h-9 w-full items-center gap-2 rounded px-2 text-left text-[11px] text-muted hover:bg-panel hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">
                    <Check size={12} className={context.accessMode === "read-only" ? "opacity-100" : "opacity-0"} aria-hidden="true" /> Read
                  </button>
                  <button type="button" role="menuitemradio" aria-checked={context.accessMode === "read-write"} disabled={!canWrite} onClick={() => { onModeChange("read-write"); setModeMenuOpen(false) }} className="flex min-h-9 w-full items-center gap-2 rounded px-2 text-left text-[11px] text-muted hover:bg-panel hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40">
                    <Check size={12} className={context.accessMode === "read-write" ? "opacity-100" : "opacity-0"} aria-hidden="true" /> Read / write
                  </button>
                </div>
              )}
            </div>
            <button type="submit" disabled={!prompt.trim() || sending} aria-label="Send prompt" className="ml-auto grid size-9 shrink-0 place-items-center rounded-md bg-accent text-canvas transition-[background-color,transform] duration-150 ease-product hover:bg-accent-strong active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel focus-visible:outline-none disabled:bg-line-strong disabled:text-muted">
              <PaperPlaneTilt size={16} weight="fill" aria-hidden="true" />
            </button>
          </div>
        </div>
        <p className="mt-2 text-center text-[11px] text-faint">Review generated queries before running them.</p>
      </form>
    </aside>
  )
}

export default function App() {
  const [connections, setConnections] = useState<SavedConnection[]>([])
  const [activeConnection, setActiveConnection] = useState<SavedConnection | null>(null)
  const [databases, setDatabases] = useState<DatabaseInfo[]>([])
  const [collections, setCollections] = useState<CollectionInfo[]>([])
  const [selectedDatabase, setSelectedDatabase] = useState("")
  const [selectedCollection, setSelectedCollection] = useState("")
  const [documents, setDocuments] = useState<FindResult["documents"]>([])
  const [filter, setFilter] = useState("{}")
  const [sort, setSort] = useState("{}")
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [showConnectionDialog, setShowConnectionDialog] = useState(false)
  const [querying, setQuerying] = useState(false)
  const [error, setError] = useState("")
  const [duration, setDuration] = useState<number | null>(null)
  const [queryRan, setQueryRan] = useState(false)
  const [editingDocumentId, setEditingDocumentId] = useState<string | null>(null)
  const [editDocumentText, setEditDocumentText] = useState("")
  const [copiedDocumentId, setCopiedDocumentId] = useState<string | null>(null)
  const [mutatingDocumentId, setMutatingDocumentId] = useState<string | null>(null)
  const [pendingDeleteDocumentId, setPendingDeleteDocumentId] = useState<string | null>(null)
  const [connectionMenuId, setConnectionMenuId] = useState<string | null>(null)
  const [pendingRemoveConnection, setPendingRemoveConnection] = useState<SavedConnection | null>(null)
  const [removingConnectionId, setRemovingConnectionId] = useState<string | null>(null)
  const [connectionNotice, setConnectionNotice] = useState<{ message: string; error: boolean } | null>(null)
  const [copilotStatus, setCopilotStatus] = useState<CopilotStatus>({ state: "starting" })
  const [agentMode, setAgentMode] = useState<AccessMode>("read-only")
  const [panelWidths, setPanelWidths] = useState(() => ({ left: readPanelWidth("left"), right: readPanelWidth("right") }))

  const leftPanelMax = Math.max(
    panelLimits.left.min,
    Math.min(panelLimits.left.max, window.innerWidth - panelWidths.right - panelLimits.centerMin),
  )
  const rightPanelMax = Math.max(
    panelLimits.right.min,
    Math.min(panelLimits.right.max, window.innerWidth - panelWidths.left - panelLimits.centerMin),
  )
  const workspaceColumns = `${panelWidths.left}px minmax(${panelLimits.centerMin}px, 1fr) ${panelWidths.right}px`

  useEffect(() => {
    if (!window.mongoPilot) return
    void window.mongoPilot.connections.list().then(setConnections).catch((reason) => setError(String(reason)))
    void window.mongoPilot.copilot.start().then(setCopilotStatus).catch((reason) => {
      setCopilotStatus({ state: "error", message: reason instanceof Error ? reason.message : "OpenCode failed to start." })
    })
  }, [])

  useEffect(() => {
    if ((!pendingDeleteDocumentId && !pendingRemoveConnection) || mutatingDocumentId || removingConnectionId) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      setPendingDeleteDocumentId(null)
      setPendingRemoveConnection(null)
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [pendingDeleteDocumentId, pendingRemoveConnection, mutatingDocumentId, removingConnectionId])

  useEffect(() => {
    localStorage.setItem("mongo-pilot:panel-width:left", String(Math.round(panelWidths.left)))
    localStorage.setItem("mongo-pilot:panel-width:right", String(Math.round(panelWidths.right)))
  }, [panelWidths])

  useEffect(() => {
    const fitPanelsToWindow = () => {
      setPanelWidths((current) => {
        const available = Math.max(
          panelLimits.left.min + panelLimits.right.min,
          window.innerWidth - panelLimits.centerMin,
        )
        let left = current.left
        let right = current.right
        let overflow = left + right - available
        if (overflow <= 0) return current
        const rightReduction = Math.min(overflow, right - panelLimits.right.min)
        right -= rightReduction
        overflow -= rightReduction
        left -= Math.min(overflow, left - panelLimits.left.min)
        return { left, right }
      })
    }
    window.addEventListener("resize", fitPanelsToWindow)
    fitPanelsToWindow()
    return () => window.removeEventListener("resize", fitPanelsToWindow)
  }, [])

  function showConnectionNotice(message: string, error = false): void {
    setConnectionNotice({ message, error })
    window.setTimeout(() => {
      setConnectionNotice((current) => current?.message === message ? null : current)
    }, 2_500)
  }

  function clearWorkspace(): void {
    setActiveConnection(null)
    setDatabases([])
    setCollections([])
    setSelectedDatabase("")
    setSelectedCollection("")
    setDocuments([])
    setDuration(null)
    setQueryRan(false)
    setTotal(0)
    setPage(1)
    setEditingDocumentId(null)
    setPendingDeleteDocumentId(null)
    setAgentMode("read-only")
  }

  async function copyConnectionString(connection: SavedConnection): Promise<void> {
    setConnectionMenuId(null)
    try {
      if (!window.mongoPilot) throw new Error("Connection actions are available in the Electron app.")
      await window.mongoPilot.connections.copyUri(connection.id)
      showConnectionNotice(`Copied ${connection.name} connection string.`)
    } catch (reason) {
      showConnectionNotice(reason instanceof Error ? reason.message : "Could not copy the connection string.", true)
    }
  }

  async function removeConnection(connection: SavedConnection): Promise<void> {
    setRemovingConnectionId(connection.id)
    try {
      if (!window.mongoPilot) throw new Error("Connection actions are available in the Electron app.")
      await window.mongoPilot.connections.remove(connection.id)
      setConnections((current) => current.filter((item) => item.id !== connection.id))
      if (activeConnection?.id === connection.id) clearWorkspace()
      setPendingRemoveConnection(null)
      showConnectionNotice(`Removed ${connection.name}.`)
    } catch (reason) {
      showConnectionNotice(reason instanceof Error ? reason.message : "Could not remove the connection.", true)
    } finally {
      setRemovingConnectionId(null)
    }
  }

  async function connect(connection: SavedConnection) {
    setConnectionMenuId(null)
    setError("")
    try {
      if (!window.mongoPilot) throw new Error("Connections are available in the Electron app.")
      const result = await window.mongoPilot.connections.connect(connection.id)
      setActiveConnection(result.connection)
      setAgentMode("read-only")
      setDatabases(result.databases)
      setDocuments([])
      setDuration(null)
      setQueryRan(false)
      setTotal(0)
      setPage(1)
      const first = result.databases[0]?.name
      if (first) await selectDatabase(connection.id, first)
      else {
        setCollections([])
        setSelectedDatabase("")
        setSelectedCollection("")
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Connection failed.")
    }
  }

  async function selectDatabase(connectionId: string, name: string) {
    setSelectedDatabase(name)
    if (!window.mongoPilot) return
    setError("")
    try {
      const next = await window.mongoPilot.database.listCollections(connectionId, name)
      setCollections(next)
      const firstCollection = next[0]?.name
      if (firstCollection) await selectCollection(connectionId, name, firstCollection)
      else {
        setSelectedCollection("")
        setDocuments([])
        setDuration(null)
        setQueryRan(false)
        setTotal(0)
        setPage(1)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load collections.")
    }
  }

  async function selectCollection(connectionId: string, database: string, collection: string) {
    const preferences = readCollectionPreferences(connectionId, database, collection)
    setSelectedDatabase(database)
    setSelectedCollection(collection)
    setFilter("{}")
    setSort(preferences.sort)
    setPageSize(preferences.pageSize)
    setPage(1)
    setTotal(0)
    setDocuments([])
    setQueryRan(false)
    setEditingDocumentId(null)
    setPendingDeleteDocumentId(null)
    await runQuery({ connectionId, database, collection, filter: "{}", sort: preferences.sort, pageSize: preferences.pageSize, page: 1 })
  }

  async function runQuery(options: Partial<{ connectionId: string; database: string; collection: string; filter: string; sort: string; pageSize: number; page: number }> = {}) {
    const connectionId = options.connectionId ?? activeConnection?.id
    if (!connectionId) return
    if (!window.mongoPilot) return
    const database = options.database ?? selectedDatabase
    const collection = options.collection ?? selectedCollection
    const nextFilter = options.filter ?? filter
    const nextSort = options.sort ?? sort
    const nextPageSize = options.pageSize ?? pageSize
    const nextPage = options.page ?? page
    if (!database || !collection) return
    setQuerying(true)
    setError("")
    try {
      const result = await window.mongoPilot.database.find({
        connectionId,
        database,
        collection,
        filter: nextFilter,
        sort: nextSort,
        skip: (nextPage - 1) * nextPageSize,
        limit: nextPageSize,
      })
      setDocuments(result.documents)
      setEditingDocumentId(null)
      setTotal(result.total)
      setDuration(result.durationMs)
      setQueryRan(true)
      setPage(nextPage)
      setPageSize(nextPageSize)
      setSort(nextSort)
      saveCollectionPreferences(connectionId, database, collection, { sort: nextSort, pageSize: nextPageSize })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Query failed.")
    } finally {
      setQuerying(false)
    }
  }

  async function copyDocument(id: string, document: unknown): Promise<void> {
    try {
      await navigator.clipboard.writeText(JSON.stringify(document, null, 2))
      setCopiedDocumentId(id)
      window.setTimeout(() => setCopiedDocumentId((current) => current === id ? null : current), 1_500)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not copy this document.")
    }
  }

  function editDocument(id: string, document: unknown): void {
    if (activeConnection?.accessMode !== "read-write") {
      setError("This connection is read-only. Reconnect with read/write access to edit documents.")
      return
    }
    setError("")
    setEditingDocumentId(id)
    setEditDocumentText(JSON.stringify(document, null, 2))
  }

  async function saveDocument(id: string): Promise<void> {
    if (!activeConnection || !selectedDatabase || !selectedCollection || !window.mongoPilot) return
    if (activeConnection.accessMode !== "read-write") {
      setError("This connection is read-only. Reconnect with read/write access to save documents.")
      return
    }
    setMutatingDocumentId(id)
    setError("")
    try {
      await window.mongoPilot.database.replaceDocument({
        connectionId: activeConnection.id,
        database: selectedDatabase,
        collection: selectedCollection,
        id,
        document: editDocumentText,
      })
      setEditingDocumentId(null)
      await runQuery()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update this document.")
    } finally {
      setMutatingDocumentId(null)
    }
  }

  function requestDeleteDocument(id: string): void {
    if (activeConnection?.accessMode !== "read-write") {
      setError("This connection is read-only. Reconnect with read/write access to delete documents.")
      return
    }
    setError("")
    setPendingDeleteDocumentId(id)
  }

  async function deleteDocument(id: string): Promise<void> {
    if (!activeConnection || !selectedDatabase || !selectedCollection || !window.mongoPilot) return
    setMutatingDocumentId(id)
    setError("")
    try {
      await window.mongoPilot.database.deleteDocument({
        connectionId: activeConnection.id,
        database: selectedDatabase,
        collection: selectedCollection,
        id,
      })
      setPendingDeleteDocumentId(null)
      const nextPage = documents.length === 1 && page > 1 ? page - 1 : page
      await runQuery({ page: nextPage })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete this document.")
    } finally {
      setMutatingDocumentId(null)
    }
  }

  function preferenceKey(connectionId: string, database: string, collection: string): string {
    return `mongo-pilot:collection:${connectionId}:${database}:${collection}`
  }

  function readCollectionPreferences(connectionId: string, database: string, collection: string): CollectionPreferences {
    try {
      const stored = JSON.parse(localStorage.getItem(preferenceKey(connectionId, database, collection)) ?? "null") as Partial<CollectionPreferences> | null
      const storedPageSize = pageSizes.includes(stored?.pageSize as (typeof pageSizes)[number]) ? stored!.pageSize! : 20
      return { sort: typeof stored?.sort === "string" ? stored.sort : "{}", pageSize: storedPageSize }
    } catch {
      return { sort: "{}", pageSize: 20 }
    }
  }

  function saveCollectionPreferences(connectionId: string, database: string, collection: string, preferences: CollectionPreferences): void {
    localStorage.setItem(preferenceKey(connectionId, database, collection), JSON.stringify(preferences))
  }

  const context = {
    connectionId: activeConnection?.id,
    connectionName: activeConnection?.name ?? "No active connection",
    connectionHost: activeConnection?.host,
    database: activeConnection ? selectedDatabase : "",
    collection: activeConnection ? selectedCollection : "",
    accessMode: agentMode,
    availableConnections: connections.map(({ name, host, accessMode, favorite }) => ({ name, host, accessMode, favorite })),
  }

  return (
    <main className="grid h-[100dvh] min-h-[720px] min-w-[1100px] grid-rows-[40px_minmax(0,1fr)] overflow-hidden bg-canvas text-ink">
      <header className="title-drag grid items-center border-b border-line bg-shell" style={{ gridTemplateColumns: workspaceColumns }}>
        <div className="truncate pl-20 text-xs font-semibold tracking-tight max-md:pl-3">Mongo Pilot <span className="ml-1 font-mono text-[9px] font-normal uppercase tracking-widest text-faint max-md:hidden">alpha</span></div>
        <div className="h-full border-x border-line max-lg:border-r-0" />
        <div className="flex items-center justify-between px-3 max-lg:hidden">
          <span className="flex items-center gap-2 text-xs font-semibold"><Sparkle size={14} weight="fill" className="text-accent" aria-hidden="true" /> Pilot</span>
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted"><span className={`size-1.5 rounded-full ${copilotStatus.state === "ready" ? "bg-accent" : "bg-line-strong"}`} />{copilotStatus.state}</span>
        </div>
      </header>

      <div className="relative grid min-h-0" style={{ gridTemplateColumns: workspaceColumns }}>
        <aside className="flex min-h-0 flex-col border-r border-line bg-shell">
          <div className="flex h-12 items-center justify-between border-b border-line px-3 max-md:justify-center">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted max-md:hidden">Connections</h2>
            <IconButton label="Add connection" onClick={() => setShowConnectionDialog(true)}><Plus size={16} aria-hidden="true" /></IconButton>
          </div>
          <div className="scrollbar-thin flex-1 overflow-y-auto py-2">
            {connections.length === 0 && (
              <div className="px-4 py-6 text-center max-md:hidden">
                <HardDrives size={20} className="mx-auto mb-2 text-faint" aria-hidden="true" />
                <p className="text-[11px] text-muted">No saved connections</p>
              </div>
            )}
            {[...connections].sort((a, b) => Number(b.favorite) - Number(a.favorite)).map((connection) => (
              <div
                key={connection.id}
                className={`group relative ${connectionMenuId === connection.id ? "z-40" : ""}`}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setConnectionMenuId(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setConnectionMenuId(null)
                }}
              >
                <button type="button" onClick={() => void connect(connection)} className={`flex min-h-11 w-full items-center gap-2.5 border-l-2 py-1 pl-3 pr-11 text-left text-xs transition-[background-color,border-color] duration-150 ease-product focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent focus-visible:outline-none ${activeConnection?.id === connection.id ? "border-accent bg-accent-soft" : "border-transparent hover:bg-panel"}`}>
                  <HardDrives size={17} className="shrink-0 text-muted" aria-hidden="true" />
                  <span className="min-w-0 flex-1 max-md:hidden"><span className="flex items-center gap-1.5 truncate font-medium">{connection.favorite && <Star size={11} weight="fill" className="text-warning" aria-label="Favorite" />}{connection.name}</span><span className={`block truncate font-mono text-[10px] ${activeConnection?.id === connection.id ? "text-muted" : "text-faint"}`}>{connection.host}</span></span>
                </button>
                <button
                  type="button"
                  aria-label={`Actions for ${connection.name}`}
                  aria-haspopup="menu"
                  aria-expanded={connectionMenuId === connection.id}
                  onClick={() => setConnectionMenuId((current) => current === connection.id ? null : connection.id)}
                  className={`absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded text-muted transition-[background-color,color,opacity] duration-150 hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${connectionMenuId === connection.id ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}
                >
                  <DotsThree size={17} weight="bold" aria-hidden="true" />
                </button>
                {connectionMenuId === connection.id && (
                  <div role="menu" aria-label={`${connection.name} actions`} className="absolute right-2 top-10 z-50 w-52 rounded-md border border-line-strong bg-raised p-1 shadow-xl shadow-canvas/60">
                    <button type="button" role="menuitem" onClick={() => void copyConnectionString(connection)} className="flex min-h-10 w-full items-center gap-2 rounded px-2 text-left text-[11px] text-muted hover:bg-panel hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">
                      <Copy size={14} aria-hidden="true" />Copy connection string
                    </button>
                    <button type="button" role="menuitem" onClick={() => { setConnectionMenuId(null); setPendingRemoveConnection(connection) }} className="flex min-h-10 w-full items-center gap-2 rounded px-2 text-left text-[11px] text-danger hover:bg-danger/10 focus-visible:ring-2 focus-visible:ring-danger focus-visible:outline-none">
                      <Trash size={14} aria-hidden="true" />Remove connection
                    </button>
                  </div>
                )}
              </div>
            ))}
            {activeConnection && (
              <>
                <div className="mx-3 my-3 border-t border-line max-md:mx-2" />
                <div className="px-3 max-md:hidden">
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-faint">{selectedDatabase || "Databases"}</p>
                  {databases.map((database) => (
                    <div key={database.name}>
                      <button type="button" onClick={() => void selectDatabase(activeConnection.id, database.name)} className="flex min-h-9 w-full items-center gap-2 rounded px-1 text-left text-[11px] text-muted transition-[background-color,color] duration-150 ease-product hover:bg-panel hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">
                        {database.name === selectedDatabase ? <CaretDown size={12} aria-hidden="true" /> : <CaretRight size={12} aria-hidden="true" />}<FolderSimple size={14} aria-hidden="true" /><span className="truncate">{database.name}</span>
                      </button>
                      {database.name === selectedDatabase && collections.map((collection) => (
                        <button key={collection.name} type="button" onClick={() => void selectCollection(activeConnection.id, database.name, collection.name)} className={`ml-6 flex min-h-8 w-[calc(100%-1.5rem)] items-center gap-2 rounded px-2 text-left text-[11px] focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${selectedCollection === collection.name ? "bg-raised text-ink" : "text-faint hover:text-muted"}`}>
                          <CirclesThreePlus size={13} aria-hidden="true" /><span className="truncate">{collection.name}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                  {databases.length === 0 && <p className="px-1 py-3 text-[11px] leading-5 text-faint">No databases are visible to this connection.</p>}
                </div>
              </>
            )}
          </div>
          <div className="border-t border-line p-2">
            <button type="button" onClick={() => setShowConnectionDialog(true)} className="flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-line text-xs font-medium text-muted transition-[border-color,background-color,color] duration-150 ease-product hover:border-line-strong hover:bg-panel hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"><Plus size={14} aria-hidden="true" /><span className="max-md:hidden">New connection</span></button>
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col bg-canvas">
          <header className="flex h-12 items-center gap-3 border-b border-line px-4">
            {activeConnection ? (
              <div className="flex min-w-0 items-center gap-2 text-xs"><span className="truncate text-muted">{activeConnection.name}</span>{selectedDatabase && <><CaretRight size={11} className="text-faint" aria-hidden="true" /><span className="truncate font-medium">{selectedDatabase}{selectedCollection ? `.${selectedCollection}` : ""}</span></>}</div>
            ) : (
              <span className="text-xs font-medium">MongoDB workspace</span>
            )}
            {activeConnection && <div className="ml-auto"><AccessBadge mode={context.accessMode} /></div>}
          </header>
          {!activeConnection ? (
            <div className="grid flex-1 place-items-center p-8">
              <div className="max-w-sm text-center">
                <Database size={30} weight="duotone" className="mx-auto mb-4 text-accent" aria-hidden="true" />
                <h1 className="text-lg font-semibold tracking-tight">Connect to MongoDB</h1>
                <p className="mt-2 text-xs leading-5 text-muted">{connections.length ? "Select a saved connection from the sidebar, or add another deployment." : "Add a MongoDB connection string to browse databases, collections, and documents."}</p>
                <button type="button" onClick={() => setShowConnectionDialog(true)} className="mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-xs font-semibold text-canvas transition-[background-color,transform] duration-150 ease-product hover:bg-accent-strong active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas focus-visible:outline-none"><Plus size={14} aria-hidden="true" />New connection</button>
              </div>
            </div>
          ) : (
            <>
              <div className="border-b border-line bg-shell p-3">
                <div className="grid grid-cols-[minmax(0,2fr)_minmax(140px,1fr)_auto] items-start gap-2">
                  <div className="min-w-0 flex-1 rounded-md border border-line-strong bg-canvas focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
                    <div className="flex h-8 items-center border-b border-line px-3 font-mono text-[10px] uppercase tracking-wider text-faint"><Funnel size={13} className="mr-2" aria-hidden="true" />Filter</div>
                    <label htmlFor="filter" className="sr-only">MongoDB document filter</label>
                    <textarea id="filter" value={filter} onChange={(event) => setFilter(event.target.value)} spellCheck={false} rows={2} className="block w-full resize-none bg-transparent px-3 py-2 font-mono text-xs leading-5 text-ink focus:outline-none" />
                  </div>
                  <div className="min-w-0 rounded-md border border-line-strong bg-canvas focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
                    <div className="flex h-8 items-center border-b border-line px-3 font-mono text-[10px] uppercase tracking-wider text-faint">Sort</div>
                    <label htmlFor="sort" className="sr-only">MongoDB document sort</label>
                    <textarea id="sort" value={sort} onChange={(event) => setSort(event.target.value)} spellCheck={false} rows={2} className="block w-full resize-none bg-transparent px-3 py-2 font-mono text-xs leading-5 text-ink focus:outline-none" />
                  </div>
                  <button type="button" onClick={() => void runQuery({ page: 1 })} disabled={querying || !selectedDatabase || !selectedCollection} aria-busy={querying} className="flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-xs font-semibold text-canvas transition-[background-color,transform] duration-150 ease-product hover:bg-accent-strong active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-shell focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-muted"><Lightning size={14} weight="fill" aria-hidden="true" />{querying ? "Running" : "Run"}</button>
                </div>
                {error && <div role="alert" className="mt-2 flex items-center justify-between rounded border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"><span>{error}</span><button type="button" onClick={() => setError("")} className="rounded p-1 focus-visible:ring-2 focus-visible:ring-danger focus-visible:outline-none" aria-label="Dismiss error"><X size={14} /></button></div>}
              </div>
              <div className="flex h-10 items-center border-b border-line px-3">
                {selectedCollection && <IconButton label="Refresh documents" onClick={() => void runQuery()}><ArrowClockwise size={15} aria-hidden="true" /></IconButton>}
                <div className="mx-2 h-4 border-l border-line" />
                <span className="flex h-8 items-center gap-1.5 rounded bg-raised px-2.5 text-xs text-ink"><BracketsCurly size={14} aria-hidden="true" />JSON</span>
                <div className="ml-auto flex items-center gap-2">
                  <label htmlFor="page-size" className="font-mono text-[9px] uppercase tracking-wider text-faint">Rows</label>
                  <select
                    id="page-size"
                    value={pageSize}
                    onChange={(event) => {
                      const nextPageSize = Number(event.target.value)
                      void runQuery({ page: 1, pageSize: nextPageSize })
                    }}
                    disabled={querying || !selectedCollection}
                    className="h-7 rounded border border-line bg-canvas px-1.5 font-mono text-[10px] text-muted focus-visible:border-accent focus-visible:outline-none"
                  >
                    {pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}
                  </select>
                  <div className="flex items-center gap-1">
                    <button type="button" aria-label="Previous page" onClick={() => void runQuery({ page: page - 1 })} disabled={querying || page <= 1} className="grid size-7 place-items-center rounded text-muted hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-30"><CaretLeft size={12} aria-hidden="true" /></button>
                    <span className="min-w-16 text-center font-mono text-[10px] text-faint">{queryRan ? `${page} / ${Math.max(1, Math.ceil(total / pageSize))}` : "- / -"}</span>
                    <button type="button" aria-label="Next page" onClick={() => void runQuery({ page: page + 1 })} disabled={querying || !queryRan || page * pageSize >= total} className="grid size-7 place-items-center rounded text-muted hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-30"><CaretRight size={12} aria-hidden="true" /></button>
                  </div>
                  <p className="font-mono text-[9px] text-faint">{queryRan ? `${total} TOTAL${duration !== null ? ` · ${duration} MS` : ""}` : "NOT RUN"}</p>
                </div>
              </div>
              <div className="scrollbar-thin flex-1 overflow-auto p-3">
                {querying ? (
                  <div className="space-y-2" aria-label="Loading documents">{[0, 1, 2, 3].map((item) => <div key={item} className="h-24 animate-pulse rounded-md border border-line bg-panel" />)}</div>
                ) : documents.length ? (
                  <div className="divide-y divide-line overflow-hidden rounded-md border border-line bg-panel">
                    {documents.map((row, index) => (
                      <article key={row.id} className="group relative grid grid-cols-[36px_minmax(0,1fr)] text-xs">
                        <div className="border-r border-line bg-shell py-3 text-center font-mono text-faint">{String((page - 1) * pageSize + index + 1).padStart(2, "0")}</div>
                        {editingDocumentId === row.id ? (
                          <div className="min-w-0 p-3">
                            <label htmlFor={`document-editor-${index}`} className="sr-only">Edit document</label>
                            <textarea
                              id={`document-editor-${index}`}
                              value={editDocumentText}
                              onChange={(event) => setEditDocumentText(event.target.value)}
                              spellCheck={false}
                              rows={12}
                              className="scrollbar-thin w-full resize-y rounded-md border border-line-strong bg-canvas p-3 font-mono text-xs leading-5 text-ink focus-visible:border-accent focus-visible:outline-none"
                            />
                            <div className="mt-2 flex justify-end gap-2">
                              <button type="button" onClick={() => setEditingDocumentId(null)} className="inline-flex h-9 items-center gap-1.5 rounded px-3 text-xs font-medium text-muted hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"><X size={14} aria-hidden="true" />Cancel</button>
                              <button type="button" disabled={mutatingDocumentId === row.id} onClick={() => void saveDocument(row.id)} className="inline-flex h-9 items-center gap-1.5 rounded bg-accent px-3 text-xs font-semibold text-canvas hover:bg-accent-strong focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-wait disabled:opacity-50"><Check size={14} weight="bold" aria-hidden="true" />{mutatingDocumentId === row.id ? "Saving..." : "Save changes"}</button>
                            </div>
                          </div>
                        ) : (
                          <div className="scrollbar-thin min-w-0 overflow-x-auto px-4 py-3 pr-28"><JsonDocument document={row.document} /></div>
                        )}
                        {editingDocumentId !== row.id && (
                          <div className="absolute right-2 top-2 flex items-center gap-1 rounded-md border border-line bg-panel p-1 opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                            <button type="button" aria-label="Copy document" title="Copy" onClick={() => void copyDocument(row.id, row.document)} className="grid size-7 place-items-center rounded text-muted hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">
                              {copiedDocumentId === row.id ? <Check size={13} weight="bold" aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                            </button>
                            <button type="button" aria-label="Edit document" title={activeConnection?.accessMode === "read-only" ? "Requires a read/write connection" : "Edit"} disabled={mutatingDocumentId === row.id} onClick={() => editDocument(row.id, row.document)} className="grid size-7 place-items-center rounded text-muted hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-wait disabled:opacity-35">
                              <PencilSimple size={13} aria-hidden="true" />
                            </button>
                            <button type="button" aria-label="Delete document" title={activeConnection?.accessMode === "read-only" ? "Requires a read/write connection" : "Delete"} disabled={mutatingDocumentId === row.id} onClick={() => requestDeleteDocument(row.id)} className="grid size-7 place-items-center rounded text-muted hover:bg-danger/15 hover:text-danger focus-visible:ring-2 focus-visible:ring-danger focus-visible:outline-none disabled:cursor-wait disabled:opacity-35">
                              <Trash size={13} aria-hidden="true" />
                            </button>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                ) : queryRan ? (
                  <div className="grid min-h-64 place-items-center rounded-lg border border-dashed border-line">
                    <div className="max-w-sm text-center"><MagnifyingGlass size={28} className="mx-auto mb-3 text-faint" aria-hidden="true" /><h3 className="text-sm font-semibold">No matching documents</h3><p className="mt-1 text-xs leading-5 text-muted">The query completed successfully and returned no documents.</p></div>
                  </div>
                ) : (
                  <div className="grid min-h-64 place-items-center rounded-lg border border-dashed border-line">
                    <div className="max-w-sm text-center"><Code size={28} className="mx-auto mb-3 text-faint" aria-hidden="true" /><h3 className="text-sm font-semibold">No query results yet</h3><p className="mt-1 text-xs leading-5 text-muted">{selectedCollection ? "Loading the selected collection." : "Select a collection from the sidebar to begin."}</p></div>
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        <CopilotPanel
          status={copilotStatus}
          context={context}
          canWrite={activeConnection?.accessMode === "read-write"}
          onModeChange={setAgentMode}
        />
        <div style={{ left: panelWidths.left }} className="absolute inset-y-0 z-30">
          <PanelResizeHandle
            label="Resize connections panel"
            value={panelWidths.left}
            min={panelLimits.left.min}
            max={leftPanelMax}
            direction={1}
            onResize={(value) => setPanelWidths((current) => ({ ...current, left: value }))}
          />
        </div>
        <div style={{ left: `calc(100% - ${panelWidths.right}px)` }} className="absolute inset-y-0 z-30">
          <PanelResizeHandle
            label="Resize copilot panel"
            value={panelWidths.right}
            min={panelLimits.right.min}
            max={rightPanelMax}
            direction={-1}
            onResize={(value) => setPanelWidths((current) => ({ ...current, right: value }))}
          />
        </div>
      </div>
      {showConnectionDialog && <ConnectionDialog
        onClose={() => setShowConnectionDialog(false)}
        onSaved={async (connection) => {
          setConnections((current) => [...current, connection])
          await connect(connection)
        }}
      />}
      {pendingDeleteDocumentId && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-6 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && mutatingDocumentId === null) setPendingDeleteDocumentId(null)
          }}
        >
          <section role="alertdialog" aria-modal="true" aria-labelledby="delete-document-title" aria-describedby="delete-document-description" className="w-full max-w-md rounded-lg border border-line-strong bg-panel p-5 shadow-2xl">
            <h2 id="delete-document-title" className="text-base font-semibold">Delete document?</h2>
            <p id="delete-document-description" className="mt-2 text-xs leading-5 text-muted">This permanently deletes the document from <span className="font-mono text-ink">{selectedDatabase}.{selectedCollection}</span>. This action cannot be undone.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" autoFocus disabled={mutatingDocumentId !== null} onClick={() => setPendingDeleteDocumentId(null)} className="h-10 rounded-md border border-line px-4 text-xs font-medium text-muted hover:border-line-strong hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-50">Cancel</button>
              <button type="button" disabled={mutatingDocumentId !== null} onClick={() => void deleteDocument(pendingDeleteDocumentId)} className="inline-flex h-10 items-center gap-2 rounded-md bg-danger px-4 text-xs font-semibold text-canvas hover:brightness-110 focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2 focus-visible:ring-offset-panel focus-visible:outline-none disabled:cursor-wait disabled:opacity-50"><Trash size={14} aria-hidden="true" />{mutatingDocumentId !== null ? "Deleting..." : "Delete document"}</button>
            </div>
          </section>
        </div>
      )}
      {pendingRemoveConnection && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-6 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && removingConnectionId === null) setPendingRemoveConnection(null)
          }}
        >
          <section role="alertdialog" aria-modal="true" aria-labelledby="remove-connection-title" aria-describedby="remove-connection-description" className="w-full max-w-md rounded-lg border border-line-strong bg-panel p-5 shadow-2xl">
            <h2 id="remove-connection-title" className="text-base font-semibold">Remove saved connection?</h2>
            <p id="remove-connection-description" className="mt-2 text-xs leading-5 text-muted">This removes <span className="font-medium text-ink">{pendingRemoveConnection.name}</span> and its encrypted connection string from Mongo Pilot. It does not delete the MongoDB deployment or its data.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" autoFocus disabled={removingConnectionId !== null} onClick={() => setPendingRemoveConnection(null)} className="h-10 rounded-md border border-line px-4 text-xs font-medium text-muted hover:border-line-strong hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-50">Cancel</button>
              <button type="button" disabled={removingConnectionId !== null} onClick={() => void removeConnection(pendingRemoveConnection)} className="inline-flex h-10 items-center gap-2 rounded-md bg-danger px-4 text-xs font-semibold text-canvas hover:brightness-110 focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2 focus-visible:ring-offset-panel focus-visible:outline-none disabled:cursor-wait disabled:opacity-50"><Trash size={14} aria-hidden="true" />{removingConnectionId !== null ? "Removing..." : "Remove connection"}</button>
            </div>
          </section>
        </div>
      )}
      {connectionNotice && (
        <div role={connectionNotice.error ? "alert" : "status"} className={`fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-md border px-3 py-2 text-xs shadow-xl ${connectionNotice.error ? "border-danger/40 bg-panel text-danger" : "border-line-strong bg-raised text-ink"}`}>
          {connectionNotice.message}
        </div>
      )}
    </main>
  )
}
