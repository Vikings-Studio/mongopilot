import { ArrowClockwise, ChartBar, Lightning, Sparkle, WarningCircle } from "@phosphor-icons/react"
import type { FormEvent } from "react"
import type { VisualizationResult, VisualizationSeries, VisualizationValue } from "../../shared/types"

const chartColors = ["var(--color-accent)", "var(--color-bson-date)", "var(--color-warning)", "var(--color-bson-string)"]
const compactNumber = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 })
const detailedNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 })

function formatChartNumber(value: number, compact = false): string {
  if (!Number.isFinite(value)) return "--"
  const normalized = Object.is(value, -0) ? 0 : value
  return (compact ? compactNumber : detailedNumber).format(normalized)
}

function label(value: VisualizationValue | undefined): string {
  if (value === null || value === undefined) return "--"
  if (typeof value === "number") return formatChartNumber(value)
  return String(value)
}

function numberValue(value: VisualizationValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  return null
}

function withStableKeys<T>(items: T[], identify: (item: T) => string): Array<{ item: T; key: string }> {
  const occurrences = new Map<string, number>()
  return items.map((item) => {
    const identity = identify(item)
    const occurrence = occurrences.get(identity) ?? 0
    occurrences.set(identity, occurrence + 1)
    return { item, key: `${identity}:${occurrence}` }
  })
}

function pathForPoints(points: Array<{ x: number; y: number }>): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ")
}

function CartesianChart({ result }: { result: VisualizationResult }) {
  const { spec, rows } = result
  const keyedRows = withStableKeys(rows, (row) => JSON.stringify(row))
  const width = 800
  const height = 360
  const bounds = { left: 64, right: 24, top: 24, bottom: 52 }
  const plotWidth = width - bounds.left - bounds.right
  const plotHeight = height - bounds.top - bounds.bottom
  const values = rows.flatMap((row) => spec.series.map((series) => numberValue(row[series.field])).filter((value): value is number => value !== null))
  if (values.length === 0) {
    return <ChartEmpty message="The generated query returned no numeric values for the selected series." />
  }
  const minimum = Math.min(0, ...values)
  const maximum = Math.max(0, ...values)
  const span = maximum - minimum || 1
  const scaleY = (value: number) => bounds.top + ((maximum - value) / span) * plotHeight
  const baseline = scaleY(0)
  const slotWidth = plotWidth / Math.max(rows.length, 1)
  const visibleLabels = Math.min(rows.length, 8)
  const labelStep = Math.max(1, Math.ceil(rows.length / visibleLabels))
  const gridValues = Array.from({ length: 5 }, (_, index) => minimum + (span * index) / 4).reverse()

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${spec.title} ${spec.chartType} chart`} className="h-full min-h-72 w-full overflow-visible">
      {gridValues.map((value) => {
        const y = scaleY(value)
        return <g key={value}><line x1={bounds.left} x2={width - bounds.right} y1={y} y2={y} stroke="var(--color-line)" /><text x={bounds.left - 10} y={y + 4} textAnchor="end" fill="var(--color-faint)" fontSize="10" fontFamily="var(--font-mono)">{formatChartNumber(value, true)}</text></g>
      })}
      <line x1={bounds.left} x2={width - bounds.right} y1={baseline} y2={baseline} stroke="var(--color-line-strong)" />
      {keyedRows.map(({ item: row, key }, index) => {
        if (index % labelStep !== 0) return null
        const x = bounds.left + slotWidth * (index + 0.5)
        return <text key={key} x={x} y={height - 22} textAnchor="middle" fill="var(--color-faint)" fontSize="10" fontFamily="var(--font-mono)">{label(row[spec.categoryField]).slice(0, 16)}</text>
      })}
      {spec.chartType === "bar" && keyedRows.flatMap(({ item: row, key }, rowIndex) => spec.series.map((series, seriesIndex) => {
        const value = numberValue(row[series.field])
        if (value === null) return null
        const groupWidth = slotWidth * 0.72
        const barWidth = groupWidth / spec.series.length
        const x = bounds.left + slotWidth * rowIndex + (slotWidth - groupWidth) / 2 + barWidth * seriesIndex
        const y = value >= 0 ? scaleY(value) : baseline
        const barHeight = Math.max(1, Math.abs(scaleY(value) - baseline))
        return <rect key={`${key}:${series.field}`} x={x} y={y} width={Math.max(1, barWidth - 2)} height={barHeight} rx="2" fill={chartColors[seriesIndex]}><title>{`${label(row[spec.categoryField])}: ${series.label} ${formatChartNumber(value)}`}</title></rect>
      }))}
      {(spec.chartType === "line" || spec.chartType === "area") && spec.series.map((series, seriesIndex) => {
        const points = rows.map((row, index) => {
          const value = numberValue(row[series.field])
          return value === null ? null : { x: bounds.left + slotWidth * (index + 0.5), y: scaleY(value), value, category: label(row[spec.categoryField]) }
        }).filter((point): point is NonNullable<typeof point> => point !== null)
        const path = pathForPoints(points)
        const areaPath = points.length ? `${path} L${points.at(-1)?.x},${baseline} L${points[0]?.x},${baseline} Z` : ""
        return <g key={series.field}>{spec.chartType === "area" && <path d={areaPath} fill={chartColors[seriesIndex]} opacity="0.16" />}<path d={path} fill="none" stroke={chartColors[seriesIndex]} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />{points.map((point) => <circle key={`${series.field}:${point.x}:${point.y}`} cx={point.x} cy={point.y} r="3.5" fill="var(--color-panel)" stroke={chartColors[seriesIndex]} strokeWidth="2"><title>{`${point.category}: ${series.label} ${formatChartNumber(point.value)}`}</title></circle>)}</g>
      })}
      {spec.chartType === "scatter" && spec.series.flatMap((series, seriesIndex) => keyedRows.map(({ item: row, key }) => {
        const xValue = numberValue(row[spec.categoryField])
        const yValue = numberValue(row[series.field])
        if (xValue === null || yValue === null) return null
        const xValues = rows.map((item) => numberValue(item[spec.categoryField])).filter((value): value is number => value !== null)
        const xMin = Math.min(...xValues)
        const xSpan = Math.max(...xValues) - xMin || 1
        const x = bounds.left + ((xValue - xMin) / xSpan) * plotWidth
        return <circle key={`${series.field}:${key}`} cx={x} cy={scaleY(yValue)} r="5" fill={chartColors[seriesIndex]} opacity="0.85"><title>{`${formatChartNumber(xValue)}, ${series.label} ${formatChartNumber(yValue)}`}</title></circle>
      }))}
    </svg>
  )
}

function polarPoint(center: number, radius: number, angle: number): { x: number; y: number } {
  const radians = (angle - 90) * Math.PI / 180
  return { x: center + radius * Math.cos(radians), y: center + radius * Math.sin(radians) }
}

function PieChart({ result }: { result: VisualizationResult }) {
  const series = result.spec.series[0]
  if (!series) return <ChartEmpty message="The pie chart has no numeric series." />
  const slices = result.rows.map((row) => ({ name: label(row[result.spec.categoryField]), value: Math.max(0, numberValue(row[series.field]) ?? 0) })).filter((slice) => slice.value > 0)
  const keyedSlices = withStableKeys(slices, (slice) => `${slice.name}:${slice.value}`)
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)
  if (!total) return <ChartEmpty message="The generated query returned no positive values for this pie chart." />
  let angle = 0
  return (
    <div className="grid min-h-72 grid-cols-[minmax(260px,1fr)_minmax(180px,0.6fr)] items-center gap-6">
      <svg viewBox="0 0 360 360" role="img" aria-label={`${result.spec.title} pie chart`} className="mx-auto size-full max-h-80 max-w-80">
        {keyedSlices.map(({ item: slice, key }, index) => {
          const start = angle
          const sweep = slice.value / total * 360
          angle += sweep
          const startPoint = polarPoint(180, 145, start)
          const endPoint = polarPoint(180, 145, angle)
          const path = sweep >= 359.999 ? "M180,35 A145,145 0 1 1 179.99,35 Z" : `M180,180 L${startPoint.x},${startPoint.y} A145,145 0 ${sweep > 180 ? 1 : 0} 1 ${endPoint.x},${endPoint.y} Z`
          return <path key={key} d={path} fill={chartColors[index % chartColors.length]} stroke="var(--color-panel)" strokeWidth="2"><title>{`${slice.name}: ${formatChartNumber(slice.value)} (${formatChartNumber(slice.value / total * 100)}%)`}</title></path>
        })}
        <circle cx="180" cy="180" r="72" fill="var(--color-panel)" />
        <text x="180" y="176" textAnchor="middle" fill="var(--color-faint)" fontSize="11" fontFamily="var(--font-sans)">TOTAL</text>
        <text x="180" y="200" textAnchor="middle" fill="var(--color-ink)" fontSize="18" fontFamily="var(--font-mono)">{formatChartNumber(total, true)}</text>
      </svg>
      <div className="space-y-2">{keyedSlices.slice(0, 12).map(({ item: slice, key }, index) => <div key={key} className="flex items-center gap-2 text-xs"><span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: chartColors[index % chartColors.length] }} /><span className="min-w-0 flex-1 truncate text-muted">{slice.name}</span><span className="font-mono tabular-nums text-ink">{formatChartNumber(slice.value, true)}</span></div>)}</div>
    </div>
  )
}

function DataTable({ result }: { result: VisualizationResult }) {
  const columns = [result.spec.categoryField, ...result.spec.series.map((series) => series.field)]
  const rows = withStableKeys(result.rows, (row) => JSON.stringify(row))
  return <div className="scrollbar-thin overflow-auto rounded-md border border-line"><table className="w-full border-collapse text-left text-xs"><thead className="sticky top-0 bg-raised"><tr>{columns.map((column) => <th key={column} className="border-b border-line px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-faint">{column}</th>)}</tr></thead><tbody>{rows.map(({ item: row, key }) => <tr key={key} className="border-b border-line last:border-0">{columns.map((column) => <td key={column} className={`px-3 py-2 text-muted ${typeof row[column] === "number" ? "font-mono tabular-nums text-ink" : ""}`}>{label(row[column])}</td>)}</tr>)}</tbody></table></div>
}

function ChartEmpty({ message }: { message: string }) {
  return <div className="grid min-h-72 place-items-center rounded-md border border-dashed border-line"><div className="max-w-sm text-center"><WarningCircle size={28} className="mx-auto mb-3 text-warning" aria-hidden="true" /><p className="text-sm font-semibold">Cannot plot these results</p><p className="mt-1 text-xs leading-5 text-muted">{message}</p></div></div>
}

function Legend({ series }: { series: VisualizationSeries[] }) {
  return <div className="flex flex-wrap items-center gap-4">{series.map((item, index) => <span key={item.field} className="flex items-center gap-1.5 text-[11px] text-muted"><span className="size-2 rounded-sm" style={{ backgroundColor: chartColors[index] }} />{item.label}</span>)}</div>
}

export function VisualizationPanel({ prompt, result, loading, error, onPromptChange, onGenerate, onRefresh }: { prompt: string; result: VisualizationResult | null; loading: boolean; error: string; onPromptChange: (prompt: string) => void; onGenerate: () => void; onRefresh: () => void }) {
  function submit(event: FormEvent): void {
    event.preventDefault()
    onGenerate()
  }

  return (
    <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-auto">
      <form onSubmit={submit} className="border-b border-line bg-shell p-3">
        <label htmlFor="visualization-prompt" className="mb-2 flex items-center gap-2 text-xs font-medium"><Sparkle size={15} className="text-accent" weight="fill" aria-hidden="true" />Describe a visualization</label>
        <div className="flex items-end gap-2">
          <textarea id="visualization-prompt" value={prompt} onChange={(event) => onPromptChange(event.target.value)} rows={2} maxLength={4_000} placeholder="Show monthly revenue as a line chart, grouped by paidAt" className="min-h-20 min-w-0 flex-1 resize-y rounded-md border border-line-strong bg-canvas px-3 py-2 text-xs leading-5 text-ink placeholder:text-faint focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none" />
          <button type="submit" disabled={loading || !prompt.trim()} aria-busy={loading} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md bg-accent px-4 text-xs font-semibold text-canvas transition-[background-color,transform] duration-150 ease-product hover:bg-accent-strong active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-shell focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-muted"><Lightning size={14} weight="fill" aria-hidden="true" />{loading && !result ? "Creating" : "Generate"}</button>
          <button type="button" onClick={onRefresh} disabled={loading || !result} aria-busy={loading && Boolean(result)} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md border border-line-strong bg-panel px-3 text-xs font-medium text-muted hover:border-accent hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"><ArrowClockwise size={14} aria-hidden="true" />Refresh data</button>
        </div>
        <p className="mt-2 text-[11px] text-faint">Pilot creates a validated read-only aggregation. Refresh reruns it against current data without regenerating the chart.</p>
        {error && <div role="alert" className="mt-3 flex items-center justify-between gap-3 rounded border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"><span>{error}</span><button type="button" onClick={result ? onRefresh : onGenerate} className="shrink-0 rounded px-2 py-1 font-medium hover:bg-danger/10 focus-visible:ring-2 focus-visible:ring-danger focus-visible:outline-none">Try again</button></div>}
      </form>
      <div className="flex-1 p-4">
        {loading && !result ? <div role="status" aria-label="Creating visualization" className="space-y-3"><div className="h-16 animate-pulse rounded-md bg-panel" /><div className="h-80 animate-pulse rounded-md border border-line bg-panel" /></div> : result ? (
          <section className="rounded-lg border border-line bg-panel">
            <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-4 py-3"><div><div className="flex items-center gap-2"><ChartBar size={17} className="text-accent" aria-hidden="true" /><h2 className="text-sm font-semibold">{result.spec.title}</h2><span className="rounded bg-accent-soft px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent-strong">{result.spec.chartType}</span></div>{result.spec.description && <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">{result.spec.description}</p>}</div><div className="text-right font-mono text-[9px] uppercase tracking-wider text-faint"><p>{result.rows.length} rows · {result.durationMs} ms</p><p className="mt-1">Updated {new Date(result.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p></div></header>
            <div className="p-4">{result.spec.chartType !== "table" && <div className="mb-3"><Legend series={result.spec.series} /></div>}{result.spec.chartType === "pie" ? <PieChart result={result} /> : result.spec.chartType === "table" ? <DataTable result={result} /> : <CartesianChart result={result} />}</div>
            <details className="border-t border-line px-4 py-3"><summary className="cursor-pointer select-none font-mono text-[10px] uppercase tracking-wider text-faint focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">Generated pipeline</summary><pre className="scrollbar-thin mt-3 overflow-auto rounded-md bg-canvas p-3 font-mono text-[11px] leading-5 text-muted">{JSON.stringify(result.spec.pipeline, null, 2)}</pre></details>
          </section>
        ) : <div className="grid min-h-80 place-items-center rounded-lg border border-dashed border-line"><div className="max-w-md text-center"><Sparkle size={30} weight="duotone" className="mx-auto mb-3 text-accent" aria-hidden="true" /><h2 className="text-sm font-semibold">Ask Pilot to visualize this collection</h2><p className="mt-1 text-xs leading-5 text-muted">Describe the question, grouping, and chart you want. Pilot will inspect the collection, build a safe aggregation, and plot the result.</p></div></div>}
      </div>
    </div>
  )
}
