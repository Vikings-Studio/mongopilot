import {
  ArrowLeft,
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
  DownloadSimple,
  DotsThree,
  FolderSimple,
  Funnel,
  HardDrives,
  Key,
  Lightning,
  Lock,
  LockOpen,
  MagnifyingGlass,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  Robot,
  ShieldCheck,
  Sparkle,
  Star,
  Trash,
  X,
} from "@phosphor-icons/react"
import { type FormEvent, useDeferredValue, useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type {
  AgentAccessMode,
  AggregateResult,
  CollectionInfo,
  CollectionIndexInfo,
  CollectionReportResult,
  ConnectionAccessMode,
  ConnectionEnvironment,
  CopilotModel,
  CopilotStatus,
  DatabaseInfo,
  FindResult,
  SavedConnection,
  SaveConnectionInput,
  SchemaAnalysisResult,
  UpdateStatus,
  VisualizationResult,
  VisualizationSpec,
  WriteApprovalRequest,
} from "../../shared/types"
import { getBsonDisplay, isWebUrl, type BsonDisplayKind, type DateDisplayMode } from "./bson-format"
import { CustomSelect } from "./CustomSelect"
import { ShellPanel } from "./ShellPanel"
import { VisualizationPanel } from "./VisualizationPanel"
import { readSavedVisualization, saveVisualization } from "./visualization-storage"
import { WriteApprovalDialog } from "./WriteApprovalDialog"

type Message = { id: string; role: "assistant" | "user"; text: string }
type CollectionPreferences = { sort: string; pageSize: number }
type CollectionTab = "Documents" | "Aggregations" | "Schema" | "Indexes" | "Reports" | "Visualizations" | "Shell"

const pageSizes = [10, 20, 50, 100] as const
const schemaSampleSizes = [50, 100, 250, 500, 1_000] as const
const environmentOptions: Array<{ value: ConnectionEnvironment; label: string }> = [
  { value: "unlabeled", label: "Unlabeled" },
  { value: "local", label: "Local" },
  { value: "development", label: "Development" },
  { value: "staging", label: "Staging" },
  { value: "production", label: "Production" },
]
const integerFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })
const sortPresets = [
  { label: "Natural order", value: "{}" },
  { label: "Newest ObjectId", value: '{"_id":-1}' },
  { label: "Oldest ObjectId", value: '{"_id":1}' },
  { label: "Recently updated", value: '{"updatedAt":-1}' },
  { label: "Recently created", value: '{"createdAt":-1}' },
] as const
const defaultAggregationPipeline = `[
  { "$limit": 20 }
]`

function createMessage(role: Message["role"], text: string): Message {
  return { id: crypto.randomUUID(), role, text }
}

function readPreferredModel(): { providerID: string; modelID: string } | undefined {
  const stored = localStorage.getItem("mongo-pilot:copilot-model")
  const separator = stored?.indexOf("/") ?? -1
  if (!stored || separator <= 0 || separator === stored.length - 1) return undefined
  return { providerID: stored.slice(0, separator), modelID: stored.slice(separator + 1) }
}

function formatReasoningLevel(level: string): string {
  if (level.toLocaleLowerCase() === "xhigh") return "Extra high"
  return level.replaceAll(/[_-]+/g, " ").replace(/^./, (character) => character.toLocaleUpperCase())
}

function modelKey(model: Pick<CopilotModel, "providerID" | "modelID">): string {
  return `${model.providerID}/${model.modelID}`
}

function readReasoningLevel(model: CopilotModel | undefined): string | undefined {
  if (!model) return undefined
  try {
    const stored = JSON.parse(localStorage.getItem("mongo-pilot:copilot-reasoning") ?? "null") as { model?: string; level?: string } | null
    return stored?.model === modelKey(model) && stored.level && model.reasoningLevels.includes(stored.level) ? stored.level : undefined
  } catch {
    return undefined
  }
}
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
  position,
  value,
  min,
  max,
  direction,
  onResize,
}: {
  label: string
  position: number | string
  value: number
  min: number
  max: number
  direction: 1 | -1
  onResize: (value: number) => void
}) {
  const drag = useRef<{ pointerId: number; startX: number; startValue: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  function finishDrag(event: React.PointerEvent<HTMLHRElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    drag.current = null
    setDragging(false)
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
  }

  return (
    <hr
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      style={{ left: position }}
      onPointerDown={(event) => {
        event.preventDefault()
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startValue: value }
        setDragging(true)
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
      onLostPointerCapture={() => {
        drag.current = null
        setDragging(false)
        document.body.style.cursor = ""
        document.body.style.userSelect = ""
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
        event.preventDefault()
        const boundaryDelta = event.key === "ArrowRight" ? 12 : -12
        onResize(clamp(value + boundaryDelta * direction, min, max))
      }}
      className={`group absolute inset-y-0 z-40 m-0 w-3 -translate-x-1/2 cursor-col-resize touch-none border-0 focus-visible:outline-none before:absolute before:left-1/2 before:top-1/2 before:z-10 before:h-10 before:w-1 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:border before:border-line-strong before:bg-raised before:opacity-45 before:transition-[border-color,background-color,opacity] before:duration-150 after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-line after:transition-[width,background-color] after:duration-150 hover:before:border-accent hover:before:bg-accent-soft hover:before:opacity-100 hover:after:w-0.5 hover:after:bg-accent focus-visible:before:border-accent focus-visible:before:bg-accent-soft focus-visible:before:opacity-100 focus-visible:after:w-0.5 focus-visible:after:bg-accent ${dragging ? "before:border-accent before:bg-accent-soft before:opacity-100 after:w-0.5 after:bg-accent" : ""}`}
    />
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

function AgentAccessBadge({ mode }: { mode: AgentAccessMode }) {
  const label = mode === "read-only" ? "AGENT: READ" : "AGENT: READ / WRITE"
  return (
    <span className="rounded-sm border border-line bg-canvas px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-muted">
      {label}
    </span>
  )
}

function EnvironmentMarker({ environment }: { environment: ConnectionEnvironment }) {
  const label = environmentOptions.find((option) => option.value === environment)?.label ?? "Unlabeled"
  const color = environment === "production"
    ? "border-danger bg-danger"
    : environment === "staging"
      ? "border-warning bg-warning"
      : environment === "development"
        ? "border-bson-number bg-bson-number"
        : environment === "local"
          ? "border-accent bg-accent"
          : "border-line-strong bg-line-strong"
  return <span role="img" title={label} aria-label={`${label} environment`} className={`inline-block size-2.5 shrink-0 rounded-full border ${color}`} />
}

function UpdateControl({ status, onAction }: { status: UpdateStatus | null; onAction: () => void }) {
  const state = status?.state
  const disabled = state === "checking" || state === "downloading" || state === "disabled"
  const label = (() => {
    if (!status) return "Updates"
    switch (status.state) {
      case "disabled": return `v${status.currentVersion} development`
      case "idle": return "Check for updates"
      case "checking": return "Checking..."
      case "not-available": return `v${status.currentVersion} up to date`
      case "available": return `Download v${status.version}`
      case "downloading": return `Downloading ${Math.round(status.percent)}%`
      case "downloaded": return "Restart to update"
      case "error": return "Retry update"
    }
  })()
  const title = status?.state === "error" ? status.message : label

  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onAction}
      className="flex h-7 max-w-44 items-center gap-1.5 rounded border border-line bg-canvas px-2 font-mono text-[9px] text-muted transition-[border-color,background-color,color] duration-150 hover:border-line-strong hover:text-ink focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none disabled:cursor-default disabled:opacity-70"
    >
      {state === "available" || state === "downloading"
        ? <DownloadSimple size={12} className="shrink-0 text-accent" aria-hidden="true" />
        : <ArrowClockwise size={12} className={`shrink-0 text-accent ${state === "checking" ? "animate-spin" : ""}`} aria-hidden="true" />}
      <span className="truncate">{label}</span>
    </button>
  )
}

function JsonPrimitive({ value }: { value: unknown }) {
  if (value === null) return <span className="text-faint">null</span>
  if (typeof value === "string" && isWebUrl(value)) return <span className="break-all text-bson-string">&quot;<a href={value} target="_blank" rel="noreferrer" className="rounded underline decoration-current/50 underline-offset-2 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">{value}</a>&quot;</span>
  if (typeof value === "string") return <span className="break-all text-bson-string">{JSON.stringify(value)}</span>
  if (typeof value === "boolean") return <span className="text-bson-number">{String(value)}</span>
  return <span className="text-bson-number">{String(value)}</span>
}

const bsonTextColor: Record<BsonDisplayKind, string> = {
  id: "text-bson-id",
  date: "text-bson-date",
  number: "text-bson-number",
  binary: "text-muted",
  regex: "text-accent",
  special: "text-muted",
}

function documentKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)
}

function JsonValue({ value, path, dateMode }: { value: unknown; path: string; dateMode: DateDisplayMode }) {
  const [expanded, setExpanded] = useState(false)
  const bson = getBsonDisplay(value, dateMode)
  if (bson) return <span className={`break-all ${bsonTextColor[bson.kind]}`}>{bson.text}</span>
  const isArray = Array.isArray(value)
  const isObject = value !== null && typeof value === "object" && !isArray
  if (!isArray && !isObject) return <JsonPrimitive value={value} />

  const entries = isArray
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>)
  const summary = isArray
    ? `Array (${entries.length})`
    : "Object"

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
              <span className="font-semibold text-muted">{isArray ? key : documentKey(key)}: </span>
              <JsonValue value={child} path={`${path}.${key}`} dateMode={dateMode} />
            </span>
          ))}
        </span>
      )}
    </span>
  )
}

function JsonDocument({ document, dateMode = "database" }: { document: unknown; dateMode?: DateDisplayMode }) {
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    return <JsonValue value={document} path="document" dateMode={dateMode} />
  }
  return (
    <div className="min-w-0 font-mono text-xs leading-6">
      {Object.entries(document as Record<string, unknown>).map(([key, value]) => (
        <div key={key} className="min-h-6">
          <span className="font-semibold text-muted">{documentKey(key)}: </span>
          <JsonValue value={value} path={key} dateMode={dateMode} />
        </div>
      ))}
    </div>
  )
}

function parseTransportDocument(document: string): unknown {
  try {
    return JSON.parse(document) as unknown
  } catch {
    return document
  }
}

function prettyTransportDocument(document: string): string {
  const parsed = parseTransportDocument(document)
  return typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2)
}

function desktopOperationError(reason: unknown, fallback: string): string {
  const message = reason instanceof Error ? reason.message : String(reason)
  if (message.includes("No handler registered")) {
    return "Mongo Pilot was updated while its desktop process was still running. Fully quit and reopen Mongo Pilot, then try again."
  }
  return reason instanceof Error ? reason.message : fallback
}

function SchemaPanel({
  analysis,
  loading,
  error,
  sampleSize,
  onSampleSizeChange,
  onRefresh,
}: {
  analysis: SchemaAnalysisResult | null
  loading: boolean
  error: string
  sampleSize: number
  onSampleSizeChange: (sampleSize: number) => void
  onRefresh: () => void
}) {
  return (
    <>
      <div className="flex h-10 items-center gap-2 border-b border-line px-3">
        <IconButton label="Refresh schema analysis" onClick={onRefresh}><ArrowClockwise size={15} aria-hidden="true" /></IconButton>
        <div className="mx-1 h-4 border-l border-line" />
        <label htmlFor="schema-sample-size" className="font-mono text-[9px] uppercase tracking-wider text-faint">Sample</label>
        <CustomSelect id="schema-sample-size" ariaLabel="Schema sample size" value={sampleSize} disabled={loading} options={schemaSampleSizes.map((size) => ({ value: size, label: integerFormatter.format(size) }))} onChange={onSampleSizeChange} className="w-20" buttonClassName="h-7 font-mono text-[10px] tabular-nums" />
        {analysis && <span className="ml-auto font-mono text-[9px] tabular-nums text-faint">{integerFormatter.format(analysis.sampleCount)} SAMPLED · {integerFormatter.format(analysis.durationMs)} MS</span>}
      </div>
      <div className="scrollbar-thin flex-1 overflow-auto p-3">
        {loading ? (
          <div role="status" aria-label="Analyzing schema" className="space-y-2">{[0, 1, 2, 3, 4].map((item) => <div key={item} className="h-10 animate-pulse rounded border border-line bg-panel" />)}</div>
        ) : error ? (
          <div role="alert" className="rounded-md border border-danger/30 bg-danger/10 p-4 text-xs text-danger">{error}</div>
        ) : analysis?.fields.length ? (
          <div className="overflow-hidden rounded-md border border-line bg-panel">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-raised text-[10px] uppercase tracking-wider text-muted">
                <tr><th className="px-3 py-2 font-medium">Field path</th><th className="px-3 py-2 font-medium">BSON types</th><th className="px-3 py-2 text-right font-medium">Presence</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {analysis.fields.map((field) => {
                  const percent = analysis.sampleCount > 0 ? Math.round((field.presentCount / analysis.sampleCount) * 100) : 0
                  return (
                    <tr key={field.path} className="hover:bg-raised/50">
                      <td className="px-3 py-2 font-mono text-ink">{field.path}</td>
                      <td className="px-3 py-2"><div className="flex flex-wrap gap-1">{field.types.map((type) => <span key={type.name} className="rounded border border-line bg-canvas px-1.5 py-0.5 font-mono text-[10px] text-accent-strong">{type.name}{field.types.length > 1 ? ` ${integerFormatter.format(type.count)}` : ""}</span>)}</div></td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-muted"><span className="text-ink">{percent}%</span> · {integerFormatter.format(field.presentCount)}/{integerFormatter.format(analysis.sampleCount)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center rounded-lg border border-dashed border-line"><div className="max-w-sm text-center"><Code size={28} className="mx-auto mb-3 text-faint" aria-hidden="true" /><h3 className="text-sm font-semibold">No schema fields found</h3><p className="mt-1 text-xs leading-5 text-muted">The sampled collection contains no documents or visible fields.</p></div></div>
        )}
      </div>
    </>
  )
}

function IndexesPanel({ indexes, loading, error, onRefresh }: { indexes: CollectionIndexInfo[]; loading: boolean; error: string; onRefresh: () => void }) {
  return (
    <>
      <div className="flex h-10 items-center border-b border-line px-3">
        <IconButton label="Refresh indexes" onClick={onRefresh}><ArrowClockwise size={15} aria-hidden="true" /></IconButton>
        <span className="ml-auto font-mono text-[9px] tabular-nums text-faint">{integerFormatter.format(indexes.length)} INDEX{indexes.length === 1 ? "" : "ES"}</span>
      </div>
      <div className="scrollbar-thin flex-1 overflow-auto p-3">
        {loading ? (
          <div role="status" aria-label="Loading indexes" className="space-y-2">{[0, 1, 2].map((item) => <div key={item} className="h-20 animate-pulse rounded border border-line bg-panel" />)}</div>
        ) : error ? (
          <div role="alert" className="rounded-md border border-danger/30 bg-danger/10 p-4 text-xs text-danger">{error}</div>
        ) : indexes.length ? (
          <div className="space-y-2">
            {indexes.map((index) => (
              <article key={index.name} className="rounded-md border border-line bg-panel p-4">
                <div className="flex items-start gap-3">
                  <div className="grid size-8 shrink-0 place-items-center rounded bg-accent-soft text-accent"><Key size={15} aria-hidden="true" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="font-mono text-xs font-medium text-ink">{index.name}</h3>{index.unique && <span className="rounded border border-accent/30 px-1.5 py-0.5 font-mono text-[9px] text-accent">UNIQUE</span>}{index.sparse && <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[9px] text-muted">SPARSE</span>}{index.hidden && <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[9px] text-muted">HIDDEN</span>}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">{index.keys.map((key) => <span key={key.field} className="rounded bg-canvas px-2 py-1 font-mono text-[10px] text-muted"><span className="text-ink">{key.field}</span>: {key.direction}</span>)}</div>
                    {typeof index.expireAfterSeconds === "number" && <p className="mt-2 font-mono text-[10px] tabular-nums text-warning">TTL {integerFormatter.format(index.expireAfterSeconds)} seconds</p>}
                    {index.partialFilterExpression !== undefined && <pre className="scrollbar-thin mt-2 overflow-x-auto rounded bg-canvas p-2 font-mono text-[10px] leading-4 text-muted">{JSON.stringify(index.partialFilterExpression, null, 2)}</pre>}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center rounded-lg border border-dashed border-line"><div className="max-w-sm text-center"><Key size={28} className="mx-auto mb-3 text-faint" aria-hidden="true" /><h3 className="text-sm font-semibold">No indexes found</h3><p className="mt-1 text-xs leading-5 text-muted">MongoDB returned no index definitions for this collection.</p></div></div>
        )}
      </div>
    </>
  )
}

function AggregationsPanel({
  pipeline,
  limit,
  result,
  dateMode,
  loading,
  error,
  onPipelineChange,
  onLimitChange,
  onRun,
}: {
  pipeline: string
  limit: number
  result: AggregateResult | null
  dateMode: DateDisplayMode
  loading: boolean
  error: string
  onPipelineChange: (pipeline: string) => void
  onLimitChange: (limit: number) => void
  onRun: () => void
}) {
  return (
    <>
      <form onSubmit={(event) => { event.preventDefault(); onRun() }} className="border-b border-line bg-shell p-3">
        <div className="rounded-md border border-line-strong bg-canvas focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
          <div className="flex h-8 items-center border-b border-line px-3 font-mono text-[10px] uppercase tracking-wider text-faint"><BracketsCurly size={13} className="mr-2" aria-hidden="true" />Extended JSON pipeline</div>
          <label htmlFor="aggregation-pipeline" className="sr-only">Aggregation pipeline</label>
          <textarea id="aggregation-pipeline" value={pipeline} onChange={(event) => onPipelineChange(event.target.value)} spellCheck={false} rows={8} className="scrollbar-thin block w-full resize-y bg-transparent px-3 py-2 font-mono text-xs leading-5 text-ink focus:outline-none" />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <label htmlFor="aggregation-limit" className="font-mono text-[9px] uppercase tracking-wider text-faint">Max results</label>
          <CustomSelect id="aggregation-limit" ariaLabel="Maximum aggregation results" value={limit} disabled={loading} options={pageSizes.map((size) => ({ value: size, label: integerFormatter.format(size) }))} onChange={onLimitChange} className="w-20" buttonClassName="h-8 font-mono text-[10px] tabular-nums" />
          <button type="submit" disabled={loading} className="ml-auto flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-xs font-semibold text-canvas hover:bg-accent-strong focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-shell focus-visible:outline-none disabled:cursor-wait disabled:opacity-60"><Lightning size={14} weight="fill" aria-hidden="true" />{loading ? "Running..." : "Run pipeline"}</button>
        </div>
        {error && <div role="alert" className="mt-2 rounded border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}
      </form>
      <div className="flex h-10 items-center border-b border-line px-3 font-mono text-[9px] tabular-nums text-faint">
        {result ? `${integerFormatter.format(result.documents.length)} RESULT${result.documents.length === 1 ? "" : "S"} · ${integerFormatter.format(result.durationMs)} MS` : "NOT RUN"}
      </div>
      <div className="scrollbar-thin flex-1 overflow-auto p-3">
        {loading ? (
          <div role="status" aria-label="Running aggregation" className="space-y-2">{[0, 1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse rounded border border-line bg-panel" />)}</div>
        ) : result?.documents.length ? (
          <div className="divide-y divide-line overflow-hidden rounded-md border border-line bg-panel">
            {result.documents.map((row, index) => (
              <article key={row.id} className="grid grid-cols-[36px_minmax(0,1fr)] text-xs">
                <div className="border-r border-line bg-shell py-3 text-center font-mono tabular-nums text-faint">{String(index + 1).padStart(2, "0")}</div>
                <div className="scrollbar-thin min-w-0 overflow-x-auto px-4 py-3"><JsonDocument document={parseTransportDocument(row.document)} dateMode={dateMode} /></div>
              </article>
            ))}
          </div>
        ) : result ? (
          <div className="grid min-h-52 place-items-center rounded-lg border border-dashed border-line"><div className="max-w-sm text-center"><MagnifyingGlass size={28} className="mx-auto mb-3 text-faint" aria-hidden="true" /><h3 className="text-sm font-semibold">No aggregation results</h3><p className="mt-1 text-xs leading-5 text-muted">The pipeline completed successfully without returning documents.</p></div></div>
        ) : (
          <div className="grid min-h-52 place-items-center rounded-lg border border-dashed border-line"><div className="max-w-sm text-center"><BracketsCurly size={28} className="mx-auto mb-3 text-faint" aria-hidden="true" /><h3 className="text-sm font-semibold">Run an aggregation</h3><p className="mt-1 text-xs leading-5 text-muted">Enter an Extended JSON pipeline. Output is capped and write stages are blocked.</p></div></div>
        )}
      </div>
    </>
  )
}

function ReportsPanel({ report, loading, error, sampleSize, onSampleSizeChange, onGenerate }: { report: CollectionReportResult | null; loading: boolean; error: string; sampleSize: number; onSampleSizeChange: (sampleSize: number) => void; onGenerate: () => void }) {
  const mixedTypeFields = report?.schema.fields.filter((field) => field.types.length > 1) ?? []
  const optionalFields = report?.schema.fields.filter((field) => field.presentCount < report.schema.sampleCount) ?? []
  const uniqueIndexes = report?.indexes.filter((index) => index.unique).length ?? 0
  const ttlIndexes = report?.indexes.filter((index) => index.expireAfterSeconds !== undefined).length ?? 0
  return (
    <>
      <div className="flex h-10 items-center gap-2 border-b border-line px-3">
        <IconButton label="Generate collection report" onClick={onGenerate}><ArrowClockwise size={15} aria-hidden="true" /></IconButton>
        <div className="mx-1 h-4 border-l border-line" />
        <label htmlFor="report-sample-size" className="font-mono text-[9px] uppercase tracking-wider text-faint">Schema sample</label>
        <CustomSelect id="report-sample-size" ariaLabel="Report schema sample size" value={sampleSize} disabled={loading} options={schemaSampleSizes.map((size) => ({ value: size, label: integerFormatter.format(size) }))} onChange={onSampleSizeChange} className="w-20" buttonClassName="h-7 font-mono text-[10px] tabular-nums" />
        {report && <span className="ml-auto font-mono text-[9px] tabular-nums text-faint">GENERATED {new Date(report.generatedAt).toLocaleString()} · {integerFormatter.format(report.durationMs)} MS</span>}
      </div>
      <div className="scrollbar-thin flex-1 overflow-auto p-3">
        {loading ? (
          <div role="status" aria-label="Generating report" className="grid grid-cols-2 gap-2">{[0, 1, 2, 3].map((item) => <div key={item} className="h-24 animate-pulse rounded border border-line bg-panel" />)}</div>
        ) : error ? (
          <div role="alert" className="rounded-md border border-danger/30 bg-danger/10 p-4 text-xs text-danger">{error}</div>
        ) : report ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
              {[{ label: "Documents", value: report.documentCount }, { label: "Sampled fields", value: report.schema.fields.length }, { label: "Mixed-type fields", value: mixedTypeFields.length }, { label: "Indexes", value: report.indexes.length }].map((metric) => (
                <div key={metric.label} className="rounded-md border border-line bg-panel p-4"><p className="font-mono text-[9px] uppercase tracking-wider text-faint">{metric.label}</p><p className="mt-2 font-mono text-xl font-semibold tabular-nums text-ink">{integerFormatter.format(metric.value)}</p></div>
              ))}
            </div>
            <section className="rounded-md border border-line bg-panel p-4"><h3 className="text-xs font-semibold">Schema findings</h3><div className="mt-3 grid gap-3 md:grid-cols-2"><div><p className="font-mono text-[9px] uppercase tracking-wider text-faint">Mixed BSON types</p>{mixedTypeFields.length ? <div className="mt-2 flex flex-wrap gap-1">{mixedTypeFields.map((field) => <span key={field.path} className="rounded border border-warning/30 bg-warning/10 px-2 py-1 font-mono text-[10px] text-warning">{field.path}: {field.types.map((type) => type.name).join(" / ")}</span>)}</div> : <p className="mt-2 text-xs text-muted">No mixed-type fields were found in the sample.</p>}</div><div><p className="font-mono text-[9px] uppercase tracking-wider text-faint">Optional fields</p><p className="mt-2 font-mono text-xs tabular-nums text-muted">{integerFormatter.format(optionalFields.length)} of {integerFormatter.format(report.schema.fields.length)} sampled paths are not present in every sampled document.</p></div></div></section>
            <section className="rounded-md border border-line bg-panel p-4"><h3 className="text-xs font-semibold">Index summary</h3><div className="mt-3 flex flex-wrap gap-2 font-mono text-[10px] text-muted"><span className="rounded bg-canvas px-2 py-1"><span className="tabular-nums text-ink">{integerFormatter.format(report.indexes.length)}</span> total</span><span className="rounded bg-canvas px-2 py-1"><span className="tabular-nums text-ink">{integerFormatter.format(uniqueIndexes)}</span> unique</span><span className="rounded bg-canvas px-2 py-1"><span className="tabular-nums text-ink">{integerFormatter.format(ttlIndexes)}</span> TTL</span></div></section>
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center rounded-lg border border-dashed border-line"><div className="max-w-sm text-center"><Code size={28} className="mx-auto mb-3 text-faint" aria-hidden="true" /><h3 className="text-sm font-semibold">Generate a collection report</h3><p className="mt-1 text-xs leading-5 text-muted">Build a live summary from document counts, a bounded schema sample, and index metadata.</p><button type="button" onClick={onGenerate} className="mt-4 h-9 rounded-md bg-accent px-4 text-xs font-semibold text-canvas hover:bg-accent-strong focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">Generate report</button></div></div>
        )}
      </div>
    </>
  )
}

function ConnectionDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (connection: SavedConnection) => void }) {
  const [name, setName] = useState("")
  const [uri, setUri] = useState("")
  const [environment, setEnvironment] = useState<ConnectionEnvironment>("unlabeled")
  const [connectionAccessMode, setConnectionAccessMode] = useState<ConnectionAccessMode>("read-only")
  const [agentAccessMode, setAgentAccessMode] = useState<AgentAccessMode>("read-only")
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
      if (!window.mongoPilot) throw new Error("Connection storage is available in the Mongo Pilot desktop app.")
      const input: SaveConnectionInput = { name: name.trim() || "MongoDB deployment", uri, environment, connectionAccessMode, agentAccessMode, favorite }
      onSaved(await window.mongoPilot.connections.save(input))
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this connection.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-canvas/80 p-4 backdrop-blur-sm">
      <button type="button" aria-label="Close connection dialog" onClick={onClose} className="absolute inset-0 cursor-default focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent focus-visible:outline-none" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-title"
        className="scrollbar-thin relative z-10 max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-xl border border-line-strong bg-panel shadow-2xl shadow-canvas/60"
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
          <div className="space-y-2">
            <label htmlFor="connection-environment" className="block text-xs font-medium">Environment label</label>
            <CustomSelect id="connection-environment" ariaLabel="Connection environment" value={environment} options={environmentOptions} onChange={setEnvironment} className="w-full" buttonClassName="h-11 px-3 text-sm" menuClassName="w-full" />
            <p className="text-xs text-muted">Shown throughout the workspace to make production and non-production connections easy to distinguish.</p>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium">Connection safety</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["read-only", "read-write"] as const).map((mode) => (
                <label key={mode} className={`flex min-h-20 cursor-pointer flex-col justify-between rounded-md border p-3 transition-[border-color,background-color] duration-150 ease-product ${connectionAccessMode === mode ? "border-accent bg-accent-soft" : "border-line bg-canvas hover:border-line-strong"}`}>
                  <input className="sr-only" type="radio" name="connection-access-mode" value={mode} checked={connectionAccessMode === mode} onChange={() => setConnectionAccessMode(mode)} />
                  {mode === "read-only" ? <Lock size={18} className={connectionAccessMode === mode ? "text-accent" : "text-muted"} aria-hidden="true" /> : <LockOpen size={18} className={connectionAccessMode === mode ? "text-accent" : "text-muted"} aria-hidden="true" />}
                  <span className="text-xs font-medium capitalize">{mode.replace("-", " ")}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted">Mongo Pilot blocks its write paths in read-only mode. For server-enforced protection, connect with a MongoDB user assigned the read role.</p>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium">Agent access</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["read-only", "read-write"] as const).map((mode) => (
                <label key={mode} className={`flex min-h-20 cursor-pointer flex-col justify-between rounded-md border p-3 transition-[border-color,background-color] duration-150 ease-product ${agentAccessMode === mode ? "border-accent bg-accent-soft" : "border-line bg-canvas hover:border-line-strong"}`}>
                  <input className="sr-only" type="radio" name="agent-access-mode" value={mode} checked={agentAccessMode === mode} onChange={() => setAgentAccessMode(mode)} />
                  <ShieldCheck size={18} className={agentAccessMode === mode ? "text-accent" : "text-muted"} aria-hidden="true" />
                  <span className="text-xs font-medium capitalize">{mode.replace("-", " ")}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted">This independently limits Pilot. The agent cannot write while connection safety is read only.</p>
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
    connectionEnvironment?: ConnectionEnvironment
    connectionAccessMode?: ConnectionAccessMode
    database: string
    collection: string
    agentAccessMode: AgentAccessMode
    availableConnections: Array<{ name: string; host: string; environment: ConnectionEnvironment; connectionAccessMode: ConnectionAccessMode; agentAccessMode: AgentAccessMode; favorite: boolean }>
  }
  canWrite: boolean
  onModeChange: (mode: AgentAccessMode) => void
}) {
  const [messages, setMessages] = useState<Message[]>(() => [
    createMessage("assistant", "I can draft filters, aggregation pipelines, schema checks, and report plans. Connect a deployment and I can use MongoDB tools within its agent access mode."),
  ])
  const [prompt, setPrompt] = useState("")
  const [sending, setSending] = useState(false)
  const [localStatus, setLocalStatus] = useState(status)
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [modelQuery, setModelQuery] = useState("")
  const [models, setModels] = useState<CopilotModel[]>([])
  const [selectedModel, setSelectedModel] = useState<CopilotModel | null>(null)
  const [selectedReasoningLevel, setSelectedReasoningLevel] = useState<string | undefined>()
  const [expandedReasoningModel, setExpandedReasoningModel] = useState<string | null>(null)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState(false)
  const [modelLoadAttempt, setModelLoadAttempt] = useState(0)
  const modelSearchRef = useRef<HTMLInputElement>(null)
  const modelTriggerRef = useRef<HTMLButtonElement>(null)
  const modelOptionsRef = useRef<HTMLDivElement>(null)
  const deferredModelQuery = useDeferredValue(modelQuery)
  const normalizedModelQuery = deferredModelQuery.trim().toLocaleLowerCase()
  const filteredModels = normalizedModelQuery
    ? models.filter((model) => [model.name, model.providerName, model.providerID, model.modelID, model.family]
      .some((value) => value?.toLocaleLowerCase().includes(normalizedModelQuery)))
    : models
  const groupedModels = [...filteredModels.reduce((groups, model) => {
    const group = groups.get(model.providerID)
    if (group) group.models.push(model)
    else groups.set(model.providerID, { providerID: model.providerID, providerName: model.providerName, models: [model] })
    return groups
  }, new Map<string, { providerID: string; providerName: string; models: CopilotModel[] }>()).values()]

  useEffect(() => setLocalStatus(status), [status])
  useEffect(() => {
    if (!modelMenuOpen) return
    const frame = window.requestAnimationFrame(() => modelSearchRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [modelMenuOpen])
  useEffect(() => {
    if (status.state !== "ready" || !window.mongoPilot || typeof window.mongoPilot.copilot.models !== "function") return
    let cancelled = false
    setModelsLoading(true)
    setModelsError(false)
    if (modelLoadAttempt > 0) setModels([])
    void window.mongoPilot.copilot.models()
      .then((result) => {
        if (cancelled) return
        setModels(result.models)
        const stored = localStorage.getItem("mongo-pilot:copilot-model")
        const preferred = stored
          ? result.models.find((model) => `${model.providerID}/${model.modelID}` === stored)
          : undefined
        const configuredDefault = result.defaultModel
        const defaultModel = configuredDefault
          ? result.models.find((model) => model.providerID === configuredDefault.providerID && model.modelID === configuredDefault.modelID)
          : undefined
        const nextModel = preferred ?? defaultModel ?? result.models.find((model) => model.supportsTools) ?? result.models[0]
        setSelectedModel(nextModel ?? null)
        setSelectedReasoningLevel(readReasoningLevel(nextModel))
      })
      .catch(() => {
        if (!cancelled) {
          setModels([])
          setModelsError(true)
        }
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [status.state, modelLoadAttempt])

  function chooseModel(model: CopilotModel, reasoningLevel?: string): void {
    setSelectedModel(model)
    setSelectedReasoningLevel(reasoningLevel)
    localStorage.setItem("mongo-pilot:copilot-model", modelKey(model))
    if (reasoningLevel) {
      localStorage.setItem("mongo-pilot:copilot-reasoning", JSON.stringify({ model: modelKey(model), level: reasoningLevel }))
    } else {
      localStorage.removeItem("mongo-pilot:copilot-reasoning")
    }
    setExpandedReasoningModel(null)
    setModelMenuOpen(false)
    setModelQuery("")
    window.requestAnimationFrame(() => modelTriggerRef.current?.focus())
  }

  function closeModelMenu(focusTrigger: boolean): void {
    setExpandedReasoningModel(null)
    setModelMenuOpen(false)
    setModelQuery("")
    if (focusTrigger) window.requestAnimationFrame(() => modelTriggerRef.current?.focus())
  }

  async function send(event: FormEvent) {
    event.preventDefault()
    const text = prompt.trim()
    if (!text || sending) return
    setMessages((current) => [...current, createMessage("user", text)])
    setPrompt("")
    setSending(true)
    try {
      if (!window.mongoPilot) throw new Error("OpenCode is available in the Mongo Pilot desktop app.")
      if (localStatus.state !== "ready") setLocalStatus(await window.mongoPilot.copilot.start())
      const reply = await window.mongoPilot.copilot.prompt({
        text,
        context,
        model: selectedModel ? { providerID: selectedModel.providerID, modelID: selectedModel.modelID } : undefined,
        variant: selectedReasoningLevel,
      })
      setMessages((current) => [...current, createMessage("assistant", reply.text)])
      if (window.mongoPilot) setLocalStatus(await window.mongoPilot.copilot.status())
    } catch (reason) {
      setMessages((current) => [...current, createMessage("assistant", `Request failed: ${reason instanceof Error ? reason.message : "Unknown error."}`)])
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
              OpenCode {localStatus.state} · {context.connectionId ? `tools scoped to ${context.agentAccessMode}` : `${context.availableConnections.length} available`}
            </p>
          </div>
          <AgentAccessBadge mode={context.agentAccessMode} />
        </div>
      </div>
      <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto p-3" aria-live="polite">
        {messages.map((message) => (
          <article key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start pl-1 pr-4"}`}>
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
            <fieldset
              className="relative m-0 min-w-0 border-0 p-0"
              onKeyDown={(event) => {
                if (event.key === "Escape" && modelMenuOpen) {
                  event.preventDefault()
                  event.stopPropagation()
                  closeModelMenu(true)
                }
              }}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  closeModelMenu(false)
                }
              }}
            >
              <legend className="sr-only">Model selection</legend>
              <button
                type="button"
                ref={modelTriggerRef}
                aria-haspopup="dialog"
                aria-expanded={modelMenuOpen}
                onClick={() => {
                  if (modelMenuOpen) setModelQuery("")
                  setExpandedReasoningModel(null)
                  setModelMenuOpen(!modelMenuOpen)
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    closeModelMenu(true)
                  }
                }}
                className="flex h-7 max-w-36 items-center gap-1.5 rounded border border-line bg-canvas px-2 text-[10px] font-medium text-muted transition-[border-color,background-color,color] duration-150 ease-product hover:border-line-strong hover:text-ink focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none"
              >
                <Robot size={12} className="shrink-0 text-accent" aria-hidden="true" />
                <span className="truncate">{modelsLoading ? "Loading models" : selectedModel ? `${selectedModel.name}${selectedReasoningLevel ? ` · ${formatReasoningLevel(selectedReasoningLevel)}` : ""}` : "Choose model"}</span>
                <CaretDown size={10} className="shrink-0" aria-hidden="true" />
              </button>
              {modelMenuOpen && (
                <div role="dialog" aria-label="Choose OpenCode model" className="absolute bottom-full left-0 z-10 mb-2 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-line-strong bg-raised shadow-xl shadow-canvas/50">
                  <div className="border-b border-line p-2">
                    <label htmlFor="model-search" className="sr-only">Search models</label>
                    <div className="flex h-9 items-center gap-2 rounded-md border border-line bg-canvas px-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
                      <MagnifyingGlass size={13} className="shrink-0 text-faint" aria-hidden="true" />
                      <input
                        id="model-search"
                        ref={modelSearchRef}
                        type="search"
                        autoComplete="off"
                        value={modelQuery}
                        onChange={(event) => setModelQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.preventDefault()
                          if (event.key === "ArrowDown") {
                            event.preventDefault()
                            modelOptionsRef.current?.querySelector<HTMLButtonElement>("button")?.focus()
                          }
                          if (event.key === "Escape") {
                            event.preventDefault()
                            closeModelMenu(true)
                          }
                        }}
                        placeholder="Search models..."
                        className="min-w-0 flex-1 bg-transparent text-[11px] text-ink placeholder:text-faint focus:outline-none"
                      />
                    </div>
                  </div>
                  <div ref={modelOptionsRef} className="scrollbar-thin max-h-64 overflow-y-auto p-1">
                    {groupedModels.map((group, groupIndex) => (
                      <fieldset key={group.providerID} className="m-0 min-w-0 border-0 p-0">
                        <legend className="sticky top-0 z-[1] block w-full bg-raised px-2 pb-1 pt-2 font-mono text-[10px] uppercase tracking-wider text-faint">{group.providerName}</legend>
                        {group.models.map((model, modelIndex) => {
                          const key = modelKey(model)
                          const selected = selectedModel?.providerID === model.providerID && selectedModel.modelID === model.modelID
                          const reasoningExpanded = expandedReasoningModel === key
                          const reasoningId = `reasoning-${groupIndex}-${modelIndex}`
                          return (
                            <fieldset
                              key={key}
                              onPointerEnter={(event) => event.pointerType === "mouse" && model.reasoningLevels.length > 0 && setExpandedReasoningModel(key)}
                              onPointerLeave={(event) => {
                                if (!event.currentTarget.contains(document.activeElement)) setExpandedReasoningModel((current) => current === key ? null : current)
                              }}
                              onBlur={(event) => {
                                if (!event.currentTarget.contains(event.relatedTarget)) setExpandedReasoningModel((current) => current === key ? null : current)
                              }}
                              className="m-0 min-w-0 rounded border-0 p-0 hover:bg-panel focus-within:bg-panel"
                            >
                              <legend className="sr-only">{model.name} options</legend>
                              <div className="flex items-center">
                                <button
                                  type="button"
                                  aria-pressed={selected}
                                  title={`${model.name} (${model.modelID})`}
                                  onFocus={() => model.reasoningLevels.length > 0 && setExpandedReasoningModel(key)}
                                  onClick={() => chooseModel(model)}
                                  className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded px-2 text-left focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                                >
                                  <Check size={12} className={`shrink-0 ${selected ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[11px] font-medium text-ink">{model.name}</span>
                                    <span className="block truncate font-mono text-[10px] text-faint">{model.modelID}</span>
                                  </span>
                                  {!model.supportsTools && <span className="shrink-0 rounded border border-line px-1 font-mono text-[9px] text-faint">NO TOOLS</span>}
                                </button>
                                {model.reasoningLevels.length > 0 && <button type="button" aria-expanded={reasoningExpanded} aria-controls={reasoningId} aria-label={`Choose ${model.name} reasoning level`} onClick={() => setExpandedReasoningModel((current) => current === key ? null : key)} className="grid size-10 shrink-0 place-items-center rounded text-faint hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"><CaretRight size={11} className={`transition-transform motion-reduce:transition-none ${reasoningExpanded ? "rotate-90" : ""}`} aria-hidden="true" /></button>}
                              </div>
                              {model.reasoningLevels.length > 0 && (
                                <fieldset id={reasoningId} className={`mx-2 mb-1 flex-wrap gap-1 border-0 border-t border-line py-2 pl-5 ${reasoningExpanded ? "flex" : "hidden"}`}>
                                  <legend className="sr-only">{model.name} reasoning level</legend>
                                  <button type="button" aria-pressed={selected && selectedReasoningLevel === undefined} onClick={() => chooseModel(model)} className={`min-h-10 rounded border px-2 text-[10px] font-medium focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${selected && selectedReasoningLevel === undefined ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:border-line-strong hover:text-ink"}`}>Default</button>
                                  {model.reasoningLevels.map((level) => {
                                    const levelSelected = selected && selectedReasoningLevel === level
                                    return <button key={level} type="button" aria-pressed={levelSelected} onClick={() => chooseModel(model, level)} className={`min-h-10 rounded border px-2 text-[10px] font-medium focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${levelSelected ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:border-line-strong hover:text-ink"}`}>{formatReasoningLevel(level)}</button>
                                  })}
                                </fieldset>
                              )}
                            </fieldset>
                          )
                        })}
                      </fieldset>
                    ))}
                    {modelsLoading && <p aria-live="polite" className="px-3 py-6 text-center text-[11px] text-faint">Loading models...</p>}
                    {!modelsLoading && modelsError && <div role="alert" className="flex flex-col items-center gap-2 px-3 py-5 text-center"><p className="text-[11px] text-faint">Could not load models.</p><button type="button" onClick={() => setModelLoadAttempt((attempt) => attempt + 1)} className="min-h-10 rounded border border-line px-3 text-[10px] font-medium text-muted hover:border-line-strong hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">Try again</button></div>}
                    {!modelsLoading && !modelsError && models.length === 0 && <p className="px-3 py-6 text-center text-[11px] text-faint">No models available</p>}
                    {!modelsLoading && models.length > 0 && filteredModels.length === 0 && <p className="px-3 py-6 text-center text-[11px] text-faint">No models match "{deferredModelQuery.trim()}"</p>}
                  </div>
                </div>
              )}
            </fieldset>
            <fieldset
              className="relative m-0 border-0 p-0"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setModeMenuOpen(false)
              }}
            >
              <legend className="sr-only">Agent access mode</legend>
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
                {context.agentAccessMode === "read-only" ? "Read" : "Read / write"}
                <CaretDown size={10} aria-hidden="true" />
              </button>
              {modeMenuOpen && (
                <div role="menu" aria-label="Agent mode" className="absolute bottom-full left-0 z-10 mb-2 w-40 overflow-hidden rounded-md border border-line-strong bg-raised p-1 shadow-xl shadow-canvas/50">
                  <button type="button" role="menuitemradio" aria-checked={context.agentAccessMode === "read-only"} onClick={() => { onModeChange("read-only"); setModeMenuOpen(false) }} className="flex min-h-9 w-full items-center gap-2 rounded px-2 text-left text-[11px] text-muted hover:bg-panel hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">
                    <Check size={12} className={context.agentAccessMode === "read-only" ? "opacity-100" : "opacity-0"} aria-hidden="true" /> Read
                  </button>
                  <button type="button" role="menuitemradio" aria-checked={context.agentAccessMode === "read-write"} disabled={!canWrite} onClick={() => { onModeChange("read-write"); setModeMenuOpen(false) }} className="flex min-h-9 w-full items-center gap-2 rounded px-2 text-left text-[11px] text-muted hover:bg-panel hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40">
                    <Check size={12} className={context.agentAccessMode === "read-write" ? "opacity-100" : "opacity-0"} aria-hidden="true" /> Read / write
                  </button>
                </div>
              )}
            </fieldset>
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
  const [activeCollectionTab, setActiveCollectionTab] = useState<CollectionTab>("Documents")
  const [schemaAnalysis, setSchemaAnalysis] = useState<SchemaAnalysisResult | null>(null)
  const [schemaSampleSize, setSchemaSampleSize] = useState(100)
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [schemaError, setSchemaError] = useState("")
  const [indexes, setIndexes] = useState<CollectionIndexInfo[]>([])
  const [indexesLoaded, setIndexesLoaded] = useState(false)
  const [indexesLoading, setIndexesLoading] = useState(false)
  const [indexesError, setIndexesError] = useState("")
  const [aggregationPipeline, setAggregationPipeline] = useState(defaultAggregationPipeline)
  const [aggregationLimit, setAggregationLimit] = useState(20)
  const [aggregationResult, setAggregationResult] = useState<AggregateResult | null>(null)
  const [aggregationLoading, setAggregationLoading] = useState(false)
  const [aggregationError, setAggregationError] = useState("")
  const [report, setReport] = useState<CollectionReportResult | null>(null)
  const [reportSampleSize, setReportSampleSize] = useState(250)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState("")
  const [visualizationPrompt, setVisualizationPrompt] = useState("")
  const [visualizationSpec, setVisualizationSpec] = useState<VisualizationSpec | null>(null)
  const [visualizationResult, setVisualizationResult] = useState<VisualizationResult | null>(null)
  const [visualizationLoading, setVisualizationLoading] = useState(false)
  const [visualizationError, setVisualizationError] = useState("")
  const [editingDocumentId, setEditingDocumentId] = useState<string | null>(null)
  const [editDocumentText, setEditDocumentText] = useState("")
  const [copiedDocumentId, setCopiedDocumentId] = useState<string | null>(null)
  const [mutatingDocumentId, setMutatingDocumentId] = useState<string | null>(null)
  const [writeApproval, setWriteApproval] = useState<WriteApprovalRequest | null>(null)
  const [resolvingWriteApprovalId, setResolvingWriteApprovalId] = useState<string | null>(null)
  const [writeApprovalNotice, setWriteApprovalNotice] = useState("")
  const [dateDisplayMode, setDateDisplayMode] = useState<DateDisplayMode>(() => localStorage.getItem("mongo-pilot:date-display") === "local" ? "local" : "database")
  const [connectionMenuId, setConnectionMenuId] = useState<string | null>(null)
  const [connectingConnectionId, setConnectingConnectionId] = useState<string | null>(null)
  const [disconnectingConnection, setDisconnectingConnection] = useState(false)
  const [pendingRemoveConnection, setPendingRemoveConnection] = useState<SavedConnection | null>(null)
  const [removingConnectionId, setRemovingConnectionId] = useState<string | null>(null)
  const [connectionNotice, setConnectionNotice] = useState<{ message: string; error: boolean } | null>(null)
  const [copilotStatus, setCopilotStatus] = useState<CopilotStatus>({ state: "starting" })
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [agentMode, setAgentMode] = useState<AgentAccessMode>("read-only")
  const [panelWidths, setPanelWidths] = useState(() => ({ left: readPanelWidth("left"), right: readPanelWidth("right") }))
  const removeCancelRef = useRef<HTMLButtonElement>(null)
  const collectionTargetRef = useRef("")
  const resolvingWriteApprovalRef = useRef<string | null>(null)
  const writeApprovalRequestIdRef = useRef<string | null>(null)

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
    if (!window.mongoPilot) return
    const unsubscribe = window.mongoPilot.updates.onStatus(setUpdateStatus)
    void window.mongoPilot.updates.status().then(setUpdateStatus).catch((reason: unknown) => {
      setUpdateStatus({ state: "error", currentVersion: "unknown", message: reason instanceof Error ? reason.message : "Could not load update status." })
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!window.mongoPilot) return
    const unsubscribeRequest = window.mongoPilot.writeApprovals.onRequest((request) => {
      writeApprovalRequestIdRef.current = request.id
      resolvingWriteApprovalRef.current = null
      setResolvingWriteApprovalId(null)
      setWriteApprovalNotice("")
      setWriteApproval(request)
    })
    const unsubscribeCancelled = window.mongoPilot.writeApprovals.onCancelled((id) => {
      setWriteApproval((current) => current?.id === id ? null : current)
      if (writeApprovalRequestIdRef.current === id) {
        writeApprovalRequestIdRef.current = null
        setWriteApprovalNotice("The write request expired or was cancelled. Nothing was approved. Retry the request if it is still needed.")
      }
      if (resolvingWriteApprovalRef.current === id) resolvingWriteApprovalRef.current = null
      setResolvingWriteApprovalId((current) => current === id ? null : current)
    })
    return () => {
      unsubscribeRequest()
      unsubscribeCancelled()
    }
  }, [])

  useEffect(() => {
    if (!pendingRemoveConnection || removingConnectionId) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      setPendingRemoveConnection(null)
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [pendingRemoveConnection, removingConnectionId])

  useEffect(() => {
    if (!pendingRemoveConnection) return
    const frame = window.requestAnimationFrame(() => removeCancelRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [pendingRemoveConnection])

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

  async function handleUpdateAction(): Promise<void> {
    if (!updateStatus || !window.mongoPilot) return
    try {
      if (updateStatus.state === "downloaded") {
        await window.mongoPilot.updates.install()
        return
      }
      const next = updateStatus.state === "available"
        ? await window.mongoPilot.updates.download()
        : await window.mongoPilot.updates.check()
      setUpdateStatus(next)
    } catch (reason) {
      setUpdateStatus({
        state: "error",
        currentVersion: updateStatus.currentVersion,
        message: reason instanceof Error ? reason.message : "The update operation failed.",
      })
    }
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
    setActiveCollectionTab("Documents")
    setSchemaAnalysis(null)
    setSchemaLoading(false)
    setSchemaError("")
    setIndexes([])
    setIndexesLoaded(false)
    setIndexesLoading(false)
    setIndexesError("")
    setAggregationResult(null)
    setAggregationLoading(false)
    setAggregationError("")
    setReport(null)
    setReportLoading(false)
    setReportError("")
    setVisualizationPrompt("")
    setVisualizationSpec(null)
    setVisualizationResult(null)
    setVisualizationLoading(false)
    setVisualizationError("")
    collectionTargetRef.current = ""
    setTotal(0)
    setPage(1)
    setEditingDocumentId(null)
    setAgentMode("read-only")
    setConnectionMenuId(null)
  }

  async function disconnectActiveConnection(): Promise<void> {
    if (!activeConnection || !window.mongoPilot || disconnectingConnection) return
    setDisconnectingConnection(true)
    try {
      await window.mongoPilot.connections.disconnect(activeConnection.id)
      const connectionName = activeConnection.name
      clearWorkspace()
      showConnectionNotice(`Disconnected from ${connectionName}.`)
    } catch (reason) {
      showConnectionNotice(reason instanceof Error ? reason.message : "Could not disconnect this connection.", true)
    } finally {
      setDisconnectingConnection(false)
    }
  }

  async function copyConnectionString(connection: SavedConnection): Promise<void> {
    setConnectionMenuId(null)
    try {
      if (!window.mongoPilot) throw new Error("Connection actions are available in the Mongo Pilot desktop app.")
      await window.mongoPilot.connections.copyUri(connection.id)
      showConnectionNotice(`Copied ${connection.name} connection string.`)
    } catch (reason) {
      showConnectionNotice(reason instanceof Error ? reason.message : "Could not copy the connection string.", true)
    }
  }

  async function updateConnectionSettings(
    connection: SavedConnection,
    next: { environment?: ConnectionEnvironment; connectionAccessMode?: ConnectionAccessMode },
  ): Promise<void> {
    if (!window.mongoPilot) return
    const environment = next.environment ?? connection.environment
    const connectionAccessMode = next.connectionAccessMode ?? connection.connectionAccessMode
    try {
      const updated = await window.mongoPilot.connections.updateSettings({ id: connection.id, environment, connectionAccessMode })
      setConnections((current) => current.map((item) => item.id === updated.id ? updated : item))
      if (activeConnection?.id === updated.id) {
        setActiveConnection(updated)
        if (updated.connectionAccessMode === "read-only") {
          setAgentMode("read-only")
          setEditingDocumentId(null)
        }
      }
      const message = next.environment
        ? `${updated.name} is labeled ${environmentOptions.find((option) => option.value === environment)?.label ?? environment}.`
        : `${updated.name} is now ${connectionAccessMode === "read-only" ? "read only" : "read / write"}.`
      showConnectionNotice(message)
    } catch (reason) {
      showConnectionNotice(reason instanceof Error ? reason.message : "Could not update connection settings.", true)
    }
  }

  async function removeConnection(connection: SavedConnection): Promise<void> {
    setRemovingConnectionId(connection.id)
    try {
      if (!window.mongoPilot) throw new Error("Connection actions are available in the Mongo Pilot desktop app.")
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
    if (connectingConnectionId) return
    setConnectionMenuId(null)
    setConnectingConnectionId(connection.id)
    setError("")
    try {
      if (!window.mongoPilot) throw new Error("Connections are available in the Mongo Pilot desktop app.")
      const result = await window.mongoPilot.connections.connect(connection.id)
      setActiveConnection(result.connection)
      setAgentMode(result.connection.agentAccessMode)
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
    } finally {
      setConnectingConnectionId(null)
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
        setActiveCollectionTab("Documents")
        setSchemaAnalysis(null)
        setSchemaLoading(false)
        setSchemaError("")
        setIndexes([])
        setIndexesLoaded(false)
        setIndexesLoading(false)
        setIndexesError("")
        setAggregationResult(null)
        setAggregationLoading(false)
        setAggregationError("")
        setReport(null)
        setReportLoading(false)
        setReportError("")
        setVisualizationPrompt("")
        setVisualizationSpec(null)
        setVisualizationResult(null)
        setVisualizationLoading(false)
        setVisualizationError("")
        collectionTargetRef.current = ""
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
    const savedVisualization = readSavedVisualization(localStorage, { connectionId, database, collection })
    collectionTargetRef.current = `${connectionId}:${database}:${collection}`
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
    setActiveCollectionTab("Documents")
    setSchemaAnalysis(null)
    setSchemaLoading(false)
    setSchemaError("")
    setIndexes([])
    setIndexesLoaded(false)
    setIndexesLoading(false)
    setIndexesError("")
    setAggregationResult(null)
    setAggregationLoading(false)
    setAggregationError("")
    setReport(null)
    setReportLoading(false)
    setReportError("")
    setVisualizationPrompt(savedVisualization?.prompt ?? "")
    setVisualizationSpec(savedVisualization?.spec ?? null)
    setVisualizationResult(null)
    setVisualizationLoading(false)
    setVisualizationError("")
    setEditingDocumentId(null)
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

  async function loadSchema(sampleSize = schemaSampleSize): Promise<void> {
    if (!activeConnection || !selectedDatabase || !selectedCollection || !window.mongoPilot) return
    const target = `${activeConnection.id}:${selectedDatabase}:${selectedCollection}`
    setSchemaLoading(true)
    setSchemaError("")
    try {
      const result = await window.mongoPilot.database.analyzeSchema({
        connectionId: activeConnection.id,
        database: selectedDatabase,
        collection: selectedCollection,
        sampleSize,
      })
      if (collectionTargetRef.current === target) setSchemaAnalysis(result)
    } catch (reason) {
      if (collectionTargetRef.current === target) setSchemaError(desktopOperationError(reason, "Could not analyze this collection schema."))
    } finally {
      if (collectionTargetRef.current === target) setSchemaLoading(false)
    }
  }

  async function loadIndexes(): Promise<void> {
    if (!activeConnection || !selectedDatabase || !selectedCollection || !window.mongoPilot) return
    const target = `${activeConnection.id}:${selectedDatabase}:${selectedCollection}`
    setIndexesLoading(true)
    setIndexesError("")
    try {
      const result = await window.mongoPilot.database.listIndexes({
        connectionId: activeConnection.id,
        database: selectedDatabase,
        collection: selectedCollection,
      })
      if (collectionTargetRef.current === target) {
        setIndexes(result)
        setIndexesLoaded(true)
      }
    } catch (reason) {
      if (collectionTargetRef.current === target) setIndexesError(desktopOperationError(reason, "Could not load collection indexes."))
    } finally {
      if (collectionTargetRef.current === target) setIndexesLoading(false)
    }
  }

  async function runAggregation(): Promise<void> {
    if (!activeConnection || !selectedDatabase || !selectedCollection || !window.mongoPilot) return
    const target = `${activeConnection.id}:${selectedDatabase}:${selectedCollection}`
    setAggregationLoading(true)
    setAggregationError("")
    try {
      const result = await window.mongoPilot.database.aggregate({
        connectionId: activeConnection.id,
        database: selectedDatabase,
        collection: selectedCollection,
        pipeline: aggregationPipeline,
        limit: aggregationLimit,
      })
      if (collectionTargetRef.current === target) setAggregationResult(result)
    } catch (reason) {
      if (collectionTargetRef.current === target) setAggregationError(desktopOperationError(reason, "Could not run this aggregation pipeline."))
    } finally {
      if (collectionTargetRef.current === target) setAggregationLoading(false)
    }
  }

  async function generateReport(sampleSize = reportSampleSize): Promise<void> {
    if (!activeConnection || !selectedDatabase || !selectedCollection || !window.mongoPilot) return
    const target = `${activeConnection.id}:${selectedDatabase}:${selectedCollection}`
    setReportLoading(true)
    setReportError("")
    try {
      const result = await window.mongoPilot.database.generateReport({
        connectionId: activeConnection.id,
        database: selectedDatabase,
        collection: selectedCollection,
        sampleSize,
      })
      if (collectionTargetRef.current === target) setReport(result)
    } catch (reason) {
      if (collectionTargetRef.current === target) setReportError(desktopOperationError(reason, "Could not generate this collection report."))
    } finally {
      if (collectionTargetRef.current === target) setReportLoading(false)
    }
  }

  async function generateVisualization(): Promise<void> {
    if (!activeConnection || !selectedDatabase || !selectedCollection || !window.mongoPilot || !visualizationPrompt.trim()) return
    const target = `${activeConnection.id}:${selectedDatabase}:${selectedCollection}`
    setVisualizationLoading(true)
    setVisualizationError("")
    setVisualizationResult(null)
    try {
      const result = await window.mongoPilot.database.generateVisualization({
        connectionId: activeConnection.id,
        database: selectedDatabase,
        collection: selectedCollection,
        prompt: visualizationPrompt.trim(),
        model: readPreferredModel(),
      })
      if (collectionTargetRef.current === target) {
        setVisualizationSpec(result.spec)
        setVisualizationResult(result)
        saveVisualization(localStorage, {
          connectionId: activeConnection.id,
          database: selectedDatabase,
          collection: selectedCollection,
        }, { prompt: visualizationPrompt.trim(), spec: result.spec })
      }
    } catch (reason) {
      if (collectionTargetRef.current === target) setVisualizationError(desktopOperationError(reason, "Could not create this visualization."))
    } finally {
      if (collectionTargetRef.current === target) setVisualizationLoading(false)
    }
  }

  async function refreshVisualization(spec = visualizationSpec): Promise<void> {
    if (!activeConnection || !selectedDatabase || !selectedCollection || !window.mongoPilot || !spec) return
    const target = `${activeConnection.id}:${selectedDatabase}:${selectedCollection}`
    setVisualizationLoading(true)
    setVisualizationError("")
    try {
      const result = await window.mongoPilot.database.refreshVisualization({
        connectionId: activeConnection.id,
        database: selectedDatabase,
        collection: selectedCollection,
        spec,
      })
      if (collectionTargetRef.current === target) setVisualizationResult(result)
    } catch (reason) {
      if (collectionTargetRef.current === target) setVisualizationError(desktopOperationError(reason, "Could not refresh this visualization."))
    } finally {
      if (collectionTargetRef.current === target) setVisualizationLoading(false)
    }
  }

  function selectCollectionTab(tab: CollectionTab): void {
    setActiveCollectionTab(tab)
    if (tab === "Schema" && !schemaAnalysis && !schemaLoading) void loadSchema()
    if (tab === "Indexes" && !indexesLoaded && !indexesLoading) void loadIndexes()
    if (tab === "Reports" && !report && !reportLoading) void generateReport()
    if (tab === "Visualizations" && visualizationSpec && !visualizationResult && !visualizationLoading) void refreshVisualization(visualizationSpec)
  }

  async function copyDocument(id: string, document: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(prettyTransportDocument(document))
      setCopiedDocumentId(id)
      window.setTimeout(() => setCopiedDocumentId((current) => current === id ? null : current), 1_500)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not copy this document.")
    }
  }

  function editDocument(id: string, document: string): void {
    setError("")
    setEditingDocumentId(id)
    setEditDocumentText(prettyTransportDocument(document))
  }

  async function saveDocument(id: string): Promise<void> {
    if (!activeConnection || !selectedDatabase || !selectedCollection || !window.mongoPilot) return
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
    setError("")
    void deleteDocument(id)
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
      const nextPage = documents.length === 1 && page > 1 ? page - 1 : page
      await runQuery({ page: nextPage })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete this document.")
    } finally {
      setMutatingDocumentId(null)
    }
  }

  async function resolveWriteApproval(approved: boolean): Promise<void> {
    if (!writeApproval || !window.mongoPilot || resolvingWriteApprovalRef.current !== null) return
    const requestId = writeApproval.id
    resolvingWriteApprovalRef.current = requestId
    setResolvingWriteApprovalId(requestId)
    try {
      const accepted = await window.mongoPilot.writeApprovals.resolve({ id: requestId, approved })
      if (!accepted) setWriteApprovalNotice("This write approval expired or was cancelled before Mongo Pilot received it. Nothing was approved; retry only if the write is still needed.")
      if (writeApprovalRequestIdRef.current === requestId) writeApprovalRequestIdRef.current = null
      setWriteApproval((current) => current?.id === requestId ? null : current)
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : "Mongo Pilot could not confirm this write approval."
      setWriteApprovalNotice(`Approval acknowledgement failed and its status is unknown. Verify the target data before retrying. ${detail}`)
      if (writeApprovalRequestIdRef.current === requestId) writeApprovalRequestIdRef.current = null
      setWriteApproval((current) => current?.id === requestId ? null : current)
    } finally {
      if (resolvingWriteApprovalRef.current === requestId) resolvingWriteApprovalRef.current = null
      setResolvingWriteApprovalId((current) => current === requestId ? null : current)
    }
  }

  function changeDateDisplayMode(mode: DateDisplayMode): void {
    setDateDisplayMode(mode)
    localStorage.setItem("mongo-pilot:date-display", mode)
  }

  function preferenceKey(connectionId: string, database: string, collection: string): string {
    return `mongo-pilot:collection:${connectionId}:${database}:${collection}`
  }

  function readCollectionPreferences(connectionId: string, database: string, collection: string): CollectionPreferences {
    try {
      const stored = JSON.parse(localStorage.getItem(preferenceKey(connectionId, database, collection)) ?? "null") as Partial<CollectionPreferences> | null
      const candidatePageSize = stored?.pageSize
      const storedPageSize = typeof candidatePageSize === "number" && pageSizes.some((size) => size === candidatePageSize) ? candidatePageSize : 20
      return { sort: typeof stored?.sort === "string" ? stored.sort : "{}", pageSize: storedPageSize }
    } catch {
      return { sort: "{}", pageSize: 20 }
    }
  }

  function saveCollectionPreferences(connectionId: string, database: string, collection: string, preferences: CollectionPreferences): void {
    localStorage.setItem(preferenceKey(connectionId, database, collection), JSON.stringify(preferences))
  }

  const effectiveAgentMode: AgentAccessMode = activeConnection?.connectionAccessMode === "read-only" ? "read-only" : agentMode
  const context = {
    connectionId: activeConnection?.id,
    connectionName: activeConnection?.name ?? "No active connection",
    connectionHost: activeConnection?.host,
    connectionEnvironment: activeConnection?.environment,
    connectionAccessMode: activeConnection?.connectionAccessMode,
    database: activeConnection ? selectedDatabase : "",
    collection: activeConnection ? selectedCollection : "",
    agentAccessMode: effectiveAgentMode,
    availableConnections: connections.map(({ name, host, environment, connectionAccessMode, agentAccessMode, favorite }) => ({ name, host, environment, connectionAccessMode, agentAccessMode, favorite })),
  }
  const activeSortPreset = sortPresets.some((preset) => preset.value === sort) ? sort : "custom"

  return (
    <main className="grid h-[100dvh] min-h-[720px] min-w-[1100px] grid-rows-[40px_minmax(0,1fr)] overflow-hidden bg-canvas text-ink">
      <header className="title-drag grid items-center border-b border-line bg-shell" style={{ gridTemplateColumns: workspaceColumns }}>
        <div className="truncate pl-20 text-xs font-semibold tracking-tight max-md:pl-3">Mongo Pilot <span className="ml-1 font-mono text-[9px] font-normal uppercase tracking-widest text-faint max-md:hidden">alpha</span></div>
        <div className="h-full border-x border-line max-lg:border-r-0" />
        <div className="flex items-center justify-between px-3 max-lg:hidden">
          <span className="flex items-center gap-2 text-xs font-semibold"><Sparkle size={14} weight="fill" className="text-accent" aria-hidden="true" /> Pilot</span>
          <div className="flex min-w-0 items-center gap-2">
            <UpdateControl status={updateStatus} onAction={() => void handleUpdateAction()} />
            <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted"><span className={`size-1.5 rounded-full ${copilotStatus.state === "ready" ? "bg-accent" : "bg-line-strong"}`} />{copilotStatus.state}</span>
          </div>
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
              <fieldset
                key={connection.id}
                className={`group relative m-0 min-w-0 border-0 p-0 ${connectionMenuId === connection.id ? "z-40" : ""}`}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setConnectionMenuId(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setConnectionMenuId(null)
                }}
              >
                <legend className="sr-only">{connection.name} connection</legend>
                <button type="button" disabled={connectingConnectionId !== null} aria-busy={connectingConnectionId === connection.id} onClick={() => void connect(connection)} className={`flex min-h-14 w-full items-center gap-2.5 border-l-2 py-1.5 pl-3 pr-11 text-left text-xs transition-[background-color,border-color,opacity] duration-150 ease-product focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent focus-visible:outline-none disabled:cursor-wait disabled:opacity-60 ${activeConnection?.id === connection.id ? "border-accent bg-accent-soft" : "border-transparent hover:bg-panel"}`}>
                  <HardDrives size={17} className="shrink-0 text-muted" aria-hidden="true" />
                  <span className="min-w-0 flex-1 max-md:hidden"><span className="flex items-center gap-1.5 truncate font-medium"><EnvironmentMarker environment={connection.environment} />{connection.favorite && <Star size={11} weight="fill" className="text-warning" aria-label="Favorite" />}{connection.name}</span><span className={`block truncate font-mono text-[10px] ${activeConnection?.id === connection.id ? "text-muted" : "text-faint"}`}>{connectingConnectionId === connection.id ? "Connecting..." : connection.host}{connection.connectionAccessMode === "read-only" ? " · locked" : ""}</span></span>
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
              </fieldset>
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
              <div className="flex min-w-0 items-center gap-2 text-xs">
                <button type="button" disabled={disconnectingConnection} onClick={() => void disconnectActiveConnection()} className="flex h-8 shrink-0 items-center gap-1.5 rounded px-2 text-muted hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-wait disabled:opacity-60"><ArrowLeft size={13} aria-hidden="true" />Connections</button>
                <div className="h-4 border-l border-line" />
                <span className="truncate text-muted">{activeConnection.name}</span>{selectedDatabase && <><CaretRight size={11} className="text-faint" aria-hidden="true" /><span className="truncate font-medium">{selectedDatabase}{selectedCollection ? `.${selectedCollection}` : ""}</span></>}
              </div>
            ) : (
              <span className="text-xs font-medium">MongoDB workspace</span>
            )}
            {activeConnection && (
              <div className="ml-auto flex items-center gap-2">
                <CustomSelect ariaLabel={`Connection environment: ${environmentOptions.find((option) => option.value === activeConnection.environment)?.label ?? "Unlabeled"}`} value={activeConnection.environment} options={environmentOptions} selectedContent={<EnvironmentMarker environment={activeConnection.environment} />} onChange={(environment) => void updateConnectionSettings(activeConnection, { environment })} align="end" className="w-12" buttonClassName="h-10 px-2" menuClassName="w-40" />
                <CustomSelect ariaLabel="Connection safety" value={activeConnection.connectionAccessMode} options={[{ value: "read-only" as const, label: "Read only" }, { value: "read-write" as const, label: "Read / write" }]} onChange={(connectionAccessMode) => void updateConnectionSettings(activeConnection, { connectionAccessMode })} align="end" className="w-28" buttonClassName="h-10 px-2 font-mono text-[9px] uppercase" menuClassName="w-36" />
                <AgentAccessBadge mode={context.agentAccessMode} />
              </div>
            )}
          </header>
          {!activeConnection ? (
            <div className="grid flex-1 place-items-center p-8">
              <div className="max-w-sm text-center">
                <Database size={30} weight="duotone" className="mx-auto mb-4 text-accent" aria-hidden="true" />
                <h1 className="text-lg font-semibold tracking-tight">Connect to MongoDB</h1>
                <p className="mt-2 text-xs leading-5 text-muted">{connections.length ? "Select a saved connection from the sidebar, or add another deployment." : "Add a MongoDB connection string to browse databases, collections, and documents."}</p>
                {error && <div role="alert" className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-left text-xs leading-5 text-danger">{error}</div>}
                <button type="button" onClick={() => setShowConnectionDialog(true)} className="mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-xs font-semibold text-canvas transition-[background-color,transform] duration-150 ease-product hover:bg-accent-strong active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas focus-visible:outline-none"><Plus size={14} aria-hidden="true" />New connection</button>
              </div>
            </div>
          ) : (
            <>
              <nav aria-label="Collection views" className="scrollbar-thin flex h-11 shrink-0 items-end gap-5 overflow-x-auto border-b border-line px-4">
                {(["Documents", "Aggregations", "Schema", "Indexes", "Reports", "Visualizations", "Shell"] as const).map((tab) => (
                  <button key={tab} type="button" disabled={tab === "Shell" ? !selectedDatabase : !selectedCollection} onClick={() => selectCollectionTab(tab)} className={`h-11 shrink-0 border-b-2 text-xs font-medium transition-[border-color,color] duration-150 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${activeCollectionTab === tab ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}>{tab}</button>
                ))}
              </nav>
              {writeApprovalNotice && <div role="alert" className="flex items-center justify-between border-b border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"><span>{writeApprovalNotice}</span><button type="button" onClick={() => setWriteApprovalNotice("")} className="min-h-10 rounded px-3 font-medium focus-visible:ring-2 focus-visible:ring-danger focus-visible:outline-none">Dismiss</button></div>}
              {activeCollectionTab === "Documents" ? <>
              <div className="border-b border-line bg-shell p-3">
                <div className="grid grid-cols-[minmax(0,2fr)_minmax(140px,1fr)_auto] items-start gap-2">
                  <div className="min-w-0 flex-1 rounded-md border border-line-strong bg-canvas focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
                    <div className="flex h-8 items-center border-b border-line px-3 font-mono text-[10px] uppercase tracking-wider text-faint"><Funnel size={13} className="mr-2" aria-hidden="true" />Filter</div>
                    <label htmlFor="filter" className="sr-only">MongoDB document filter</label>
                    <textarea id="filter" value={filter} onChange={(event) => setFilter(event.target.value)} spellCheck={false} rows={2} className="block w-full resize-none bg-transparent px-3 py-2 font-mono text-xs leading-5 text-ink focus:outline-none" />
                  </div>
                  <div className="min-w-0 rounded-md border border-line-strong bg-canvas focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
                    <div className="flex h-8 items-center gap-2 border-b border-line px-3 font-mono text-[10px] uppercase tracking-wider text-faint">
                      <span>Sort</span>
                      <label htmlFor="sort-preset" className="sr-only">Sort preset</label>
                      <CustomSelect id="sort-preset" ariaLabel="Sort preset" value={activeSortPreset} options={[...(activeSortPreset === "custom" ? [{ value: "custom", label: "Custom" }] : []), ...sortPresets]} onChange={(value) => { if (value !== "custom") setSort(value) }} align="end" className="ml-auto w-40" buttonClassName="h-7 border-0 bg-transparent px-1 text-right font-sans text-[10px] normal-case tracking-normal" menuClassName="w-44" />
                    </div>
                    <label htmlFor="sort" className="sr-only">MongoDB document sort</label>
                    <textarea id="sort" value={sort} onChange={(event) => setSort(event.target.value)} spellCheck={false} rows={2} className="block w-full resize-none bg-transparent px-3 py-2 font-mono text-xs leading-5 text-ink focus:outline-none" />
                  </div>
                  <button type="button" onClick={() => void runQuery({ page: 1 })} disabled={querying || !selectedDatabase || !selectedCollection} aria-busy={querying} className="flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-xs font-semibold text-canvas transition-[background-color,transform] duration-150 ease-product hover:bg-accent-strong active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-shell focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-muted"><Lightning size={14} weight="fill" aria-hidden="true" />{querying ? "Running" : "Run"}</button>
                </div>
                {error && <div role="alert" className="mt-2 flex items-center justify-between rounded border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"><span>{error}</span><button type="button" onClick={() => setError("")} className="rounded p-1 focus-visible:ring-2 focus-visible:ring-danger focus-visible:outline-none" aria-label="Dismiss error"><X size={14} /></button></div>}
              </div>
              <div className="flex h-10 items-center border-b border-line px-3">
                {selectedCollection && <button type="button" onClick={() => void runQuery()} disabled={querying} aria-busy={querying} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-canvas px-2.5 text-xs font-medium text-muted hover:border-line-strong hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-wait disabled:opacity-50"><ArrowClockwise size={14} className={querying ? "animate-spin" : ""} aria-hidden="true" />Refresh</button>}
                <div className="mx-2 h-4 border-l border-line" />
                <span className="flex h-8 items-center gap-1.5 rounded bg-raised px-2.5 text-xs text-ink"><BracketsCurly size={14} aria-hidden="true" />JSON</span>
                <div className="ml-auto flex items-center gap-2">
                  <label htmlFor="date-display" className="font-mono text-[9px] uppercase tracking-wider text-faint">Dates</label>
                  <CustomSelect id="date-display" ariaLabel="Date display format" value={dateDisplayMode} options={[{ value: "database", label: "Database UTC" }, { value: "local", label: "Local time" }]} onChange={changeDateDisplayMode} align="end" className="w-28" buttonClassName="h-7 font-mono text-[9px]" />
                  <label htmlFor="page-size" className="font-mono text-[9px] uppercase tracking-wider text-faint">Rows</label>
                  <CustomSelect id="page-size" ariaLabel="Rows per page" value={pageSize} disabled={querying || !selectedCollection} options={pageSizes.map((size) => ({ value: size, label: String(size) }))} onChange={(nextPageSize) => void runQuery({ page: 1, pageSize: nextPageSize })} align="end" className="w-16" buttonClassName="h-7 font-mono text-[10px] tabular-nums" />
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
                  <div role="status" className="space-y-2" aria-label="Loading documents">{[0, 1, 2, 3].map((item) => <div key={item} className="h-24 animate-pulse rounded-md border border-line bg-panel" />)}</div>
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
                          <div className="scrollbar-thin min-w-0 overflow-x-auto px-4 py-3 pr-28"><JsonDocument document={parseTransportDocument(row.document)} dateMode={dateDisplayMode} /></div>
                        )}
                        {editingDocumentId !== row.id && (
                          <div className="absolute right-2 top-2 flex items-center gap-1 rounded-md border border-line bg-panel p-1 opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                            <button type="button" aria-label="Copy document" title="Copy" onClick={() => void copyDocument(row.id, row.document)} className="grid size-7 place-items-center rounded text-muted hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">
                              {copiedDocumentId === row.id ? <Check size={13} weight="bold" aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                            </button>
                            <button type="button" aria-label="Edit document" title={activeConnection.connectionAccessMode === "read-only" ? "Connection is read only" : "Edit"} disabled={mutatingDocumentId === row.id || activeConnection.connectionAccessMode === "read-only"} onClick={() => editDocument(row.id, row.document)} className="grid size-7 place-items-center rounded text-muted hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-35">
                              <PencilSimple size={13} aria-hidden="true" />
                            </button>
                            <button type="button" aria-label="Delete document" title={activeConnection.connectionAccessMode === "read-only" ? "Connection is read only" : "Delete"} disabled={mutatingDocumentId === row.id || activeConnection.connectionAccessMode === "read-only"} onClick={() => requestDeleteDocument(row.id)} className="grid size-7 place-items-center rounded text-muted hover:bg-danger/15 hover:text-danger focus-visible:ring-2 focus-visible:ring-danger focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-35">
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
              </> : activeCollectionTab === "Aggregations" ? (
                <AggregationsPanel
                  pipeline={aggregationPipeline}
                  limit={aggregationLimit}
                  result={aggregationResult}
                  dateMode={dateDisplayMode}
                  loading={aggregationLoading}
                  error={aggregationError}
                  onPipelineChange={setAggregationPipeline}
                  onLimitChange={setAggregationLimit}
                  onRun={() => void runAggregation()}
                />
              ) : activeCollectionTab === "Schema" ? (
                <SchemaPanel
                  analysis={schemaAnalysis}
                  loading={schemaLoading}
                  error={schemaError}
                  sampleSize={schemaSampleSize}
                  onSampleSizeChange={(sampleSize) => {
                    setSchemaSampleSize(sampleSize)
                    setSchemaAnalysis(null)
                    void loadSchema(sampleSize)
                  }}
                  onRefresh={() => void loadSchema()}
                />
              ) : activeCollectionTab === "Indexes" ? (
                <IndexesPanel indexes={indexes} loading={indexesLoading} error={indexesError} onRefresh={() => void loadIndexes()} />
              ) : activeCollectionTab === "Reports" ? (
                 <ReportsPanel
                  report={report}
                  loading={reportLoading}
                  error={reportError}
                  sampleSize={reportSampleSize}
                  onSampleSizeChange={(sampleSize) => {
                    setReportSampleSize(sampleSize)
                    setReport(null)
                    void generateReport(sampleSize)
                  }}
                   onGenerate={() => void generateReport()}
                 />
              ) : activeCollectionTab === "Visualizations" ? (
                <VisualizationPanel
                  prompt={visualizationPrompt}
                  result={visualizationResult}
                  loading={visualizationLoading}
                  error={visualizationError}
                  canRefresh={visualizationSpec !== null}
                  onPromptChange={setVisualizationPrompt}
                  onGenerate={() => void generateVisualization()}
                  onRefresh={() => void refreshVisualization()}
                />
              ) : (
                <ShellPanel connectionId={activeConnection.id} database={selectedDatabase} accessMode={activeConnection.connectionAccessMode} />
              )}
            </>
          )}
        </section>

        <CopilotPanel
          status={copilotStatus}
          context={context}
          canWrite={activeConnection?.connectionAccessMode === "read-write" && activeConnection.agentAccessMode === "read-write"}
          onModeChange={setAgentMode}
        />
        <PanelResizeHandle
          label="Resize connections panel"
          position={panelWidths.left}
          value={panelWidths.left}
          min={panelLimits.left.min}
          max={leftPanelMax}
          direction={1}
          onResize={(value) => setPanelWidths((current) => ({ ...current, left: value }))}
        />
        <PanelResizeHandle
          label="Resize copilot panel"
          position={`calc(100% - ${panelWidths.right}px)`}
          value={panelWidths.right}
          min={panelLimits.right.min}
          max={rightPanelMax}
          direction={-1}
          onResize={(value) => setPanelWidths((current) => ({ ...current, right: value }))}
        />
      </div>
      {showConnectionDialog && <ConnectionDialog
        onClose={() => setShowConnectionDialog(false)}
        onSaved={async (connection) => {
          setConnections((current) => [...current, connection])
          await connect(connection)
        }}
      />}
      {writeApproval && <WriteApprovalDialog request={writeApproval} resolving={resolvingWriteApprovalId === writeApproval.id} onResolve={(approved) => void resolveWriteApproval(approved)} />}
      {pendingRemoveConnection && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-6 backdrop-blur-sm">
          <button type="button" aria-label="Cancel connection removal" disabled={removingConnectionId !== null} onClick={() => setPendingRemoveConnection(null)} className="absolute inset-0 cursor-default focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-danger focus-visible:outline-none disabled:cursor-wait" />
          <section role="alertdialog" aria-modal="true" aria-labelledby="remove-connection-title" aria-describedby="remove-connection-description" className="relative z-10 w-full max-w-md rounded-lg border border-line-strong bg-panel p-5 shadow-2xl">
            <h2 id="remove-connection-title" className="text-base font-semibold">Remove saved connection?</h2>
            <p id="remove-connection-description" className="mt-2 text-xs leading-5 text-muted">This removes <span className="font-medium text-ink">{pendingRemoveConnection.name}</span> and its encrypted connection string from Mongo Pilot. It does not delete the MongoDB deployment or its data.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button ref={removeCancelRef} type="button" disabled={removingConnectionId !== null} onClick={() => setPendingRemoveConnection(null)} className="h-10 rounded-md border border-line px-4 text-xs font-medium text-muted hover:border-line-strong hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-50">Cancel</button>
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
