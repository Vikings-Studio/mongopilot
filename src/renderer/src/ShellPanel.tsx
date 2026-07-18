import { ArrowClockwise, Broom, PaperPlaneTilt, Stop, TerminalWindow } from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"
import type { ConnectionAccessMode } from "../../shared/types"

type ShellEntry = { id: string; kind: "input" | "output" | "error"; text: string; prompt?: string }
type ShellPhase = "blocked" | "starting" | "ready" | "error"
type ShellViewState = { entries: ShellEntry[]; history: string[] }

const shellViewStates = new Map<string, ShellViewState>()

function createEntry(kind: ShellEntry["kind"], text: string, prompt?: string): ShellEntry {
  return { id: crypto.randomUUID(), kind, text, prompt }
}

function boundEntries(entries: ShellEntry[]): ShellEntry[] {
  const bounded: ShellEntry[] = []
  let size = 0
  for (let index = entries.length - 1; index >= 0 && bounded.length < 300; index -= 1) {
    const entry = entries[index]
    if (!entry) continue
    if (size + entry.text.length > 2 * 1024 * 1024) break
    bounded.unshift(entry)
    size += entry.text.length
  }
  return bounded
}

export function ShellPanel({ connectionId, database, accessMode }: { connectionId: string; database: string; accessMode: ConnectionAccessMode }) {
  const saved = shellViewStates.get(connectionId)
  const [entries, setEntries] = useState<ShellEntry[]>(saved?.entries ?? [])
  const [history, setHistory] = useState<string[]>(saved?.history ?? [])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [input, setInput] = useState("")
  const [prompt, setPrompt] = useState(`${database || "test"}>`)
  const [phase, setPhase] = useState<ShellPhase>(accessMode === "read-only" ? "blocked" : "starting")
  const [running, setRunning] = useState(false)
  const [error, setError] = useState("")
  const [retryKey, setRetryKey] = useState(0)
  const outputRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    shellViewStates.set(connectionId, { entries: boundEntries(entries), history })
  }, [connectionId, entries, history])

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight })
  })

  useEffect(() => {
    if (accessMode === "read-only") {
      setPhase("blocked")
      setRunning(false)
      setError("")
      return
    }
    if (!window.mongoPilot) {
      setPhase("error")
      setError("The embedded shell is available in the Mongo Pilot desktop app.")
      return
    }
    let current = true
    setPhase("starting")
    setError("")
    void window.mongoPilot.shell.start({ connectionId, database }).then((result) => {
      if (!current) return
      setPrompt(result.prompt)
      setPhase("ready")
      window.requestAnimationFrame(() => inputRef.current?.focus())
    }).catch((reason: unknown) => {
      if (!current) return
      setPhase("error")
      setError(reason instanceof Error ? reason.message : retryKey > 0 ? "Could not restart mongosh." : "Could not start mongosh.")
    })
    return () => { current = false }
  }, [accessMode, connectionId, database, retryKey])

  async function run(): Promise<void> {
    const code = input.trim()
    if (!code || running || phase !== "ready" || !window.mongoPilot) return
    const commandEntry = createEntry("input", code, prompt)
    setEntries((current) => boundEntries([...current, commandEntry]))
    setHistory((current) => [code, ...current.filter((item) => item !== code)].slice(0, 100))
    setHistoryIndex(-1)
    setInput("")
    setRunning(true)
    setError("")
    try {
      const result = await window.mongoPilot.shell.evaluate({ connectionId, code })
      setPrompt(result.prompt)
      setEntries((current) => boundEntries([
        ...(result.clearRequested ? [] : current),
        ...result.output.filter(Boolean).map((text) => createEntry("output", text)),
      ]))
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "The shell command failed."
      setEntries((current) => boundEntries([...current, createEntry("error", message)]))
      setError(message)
    } finally {
      setRunning(false)
      window.requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  async function complete(): Promise<void> {
    if (!input.trim() || running || phase !== "ready" || !window.mongoPilot) return
    try {
      const completions = await window.mongoPilot.shell.complete({ connectionId, code: input })
      if (completions.length === 1 && completions[0]) {
        setInput(completions[0])
        return
      }
      if (completions.length > 1) {
        setEntries((current) => boundEntries([...current, createEntry("output", completions.slice(0, 30).join("\n"))]))
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load completions.")
    }
  }

  async function interrupt(): Promise<void> {
    if (!window.mongoPilot || !running) return
    try {
      await window.mongoPilot.shell.interrupt(connectionId)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not interrupt this command.")
    }
  }

  function recallHistory(direction: 1 | -1): void {
    if (history.length === 0) return
    const nextIndex = Math.min(Math.max(historyIndex + direction, -1), history.length - 1)
    setHistoryIndex(nextIndex)
    setInput(nextIndex < 0 ? "" : (history[nextIndex] ?? ""))
  }

  if (phase === "blocked") {
    return (
      <div className="grid flex-1 place-items-center p-6">
        <div className="max-w-md rounded-lg border border-warning/30 bg-warning/10 p-5 text-center">
          <TerminalWindow size={28} className="mx-auto text-warning" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-semibold">Shell disabled in read-only mode</h2>
          <p className="mt-1 text-xs leading-5 text-muted">mongosh can execute arbitrary JavaScript and write commands. Switch connection safety to Read / write to open it.</p>
        </div>
      </div>
    )
  }

  return (
    <section aria-label="Embedded MongoDB shell" className="flex min-h-0 flex-1 flex-col bg-canvas">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-shell px-3">
        <TerminalWindow size={15} className="text-accent" aria-hidden="true" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted">mongosh</span>
        <span className="font-mono text-[10px] text-faint">{database}</span>
        <div className="ml-auto flex items-center gap-1">
          <span role="status" className="mr-2 font-mono text-[9px] uppercase tracking-wider text-faint">{phase === "starting" ? "Starting" : phase === "error" ? "Error" : running ? "Running" : "Ready"}</span>
          <button type="button" onClick={() => setEntries([])} aria-label="Clear shell output" title="Clear output" className="grid size-10 place-items-center rounded text-muted hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"><Broom size={14} aria-hidden="true" /></button>
          <button type="button" onClick={() => void interrupt()} disabled={!running} aria-label="Interrupt command" title="Interrupt command" className="grid size-10 place-items-center rounded text-muted hover:bg-danger/10 hover:text-danger focus-visible:ring-2 focus-visible:ring-danger focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-30"><Stop size={14} weight="fill" aria-hidden="true" /></button>
        </div>
      </header>
      <div ref={outputRef} role="log" aria-live="polite" className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-4 font-mono text-xs leading-5">
        {phase === "starting" ? (
          <div className="flex items-center gap-2 text-muted"><ArrowClockwise size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Starting isolated mongosh runtime...</div>
        ) : entries.length === 0 ? (
          <div className="max-w-lg text-muted"><p className="text-ink">MongoDB shell ready.</p><p className="mt-1 text-faint">Run <code className="text-accent">db.getCollectionNames()</code>, use Shift+Enter for multiple lines, Tab to complete, and Arrow Up/Down for history.</p></div>
        ) : entries.map((entry) => (
          <div key={entry.id} className={`mb-3 whitespace-pre-wrap break-words ${entry.kind === "error" ? "text-danger" : entry.kind === "input" ? "text-ink" : "text-muted"}`}>
            {entry.kind === "input" && <span className="mr-2 select-none text-accent">{entry.prompt ?? prompt}</span>}
            {entry.text}
          </div>
        ))}
      </div>
      {error && <div role="alert" className="flex items-center justify-between border-t border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"><span>{error}</span><button type="button" onClick={() => { if (phase === "error") setRetryKey((current) => current + 1); else setError("") }} className="min-h-10 rounded px-3 font-medium focus-visible:ring-2 focus-visible:ring-danger focus-visible:outline-none">{phase === "error" ? "Retry" : "Dismiss"}</button></div>}
      <div className="border-t border-line bg-shell p-3">
        <div className="flex items-end gap-2 rounded-md border border-line-strong bg-canvas p-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
          <span className="mb-2 shrink-0 font-mono text-xs text-accent">{prompt}</span>
          <label htmlFor="shell-input" className="sr-only">mongosh command</label>
          <textarea
            ref={inputRef}
            id="shell-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                void run()
              } else if (event.key === "Tab") {
                event.preventDefault()
                void complete()
              } else if (event.key === "ArrowUp" && !input.includes("\n")) {
                event.preventDefault()
                recallHistory(1)
              } else if (event.key === "ArrowDown" && !input.includes("\n")) {
                event.preventDefault()
                recallHistory(-1)
              } else if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "l") {
                event.preventDefault()
                setEntries([])
              }
            }}
            disabled={phase !== "ready" || running}
            rows={Math.min(Math.max(input.split("\n").length, 1), 8)}
            spellCheck={false}
            autoComplete="off"
            placeholder={phase === "error" ? "Shell unavailable" : "db.collection.findOne()"}
            className="scrollbar-thin max-h-48 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 font-mono text-xs leading-5 text-ink placeholder:text-faint focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button type="button" onClick={() => void run()} disabled={!input.trim() || running || phase !== "ready"} aria-label="Run shell command" className="grid size-10 shrink-0 place-items-center rounded-md bg-accent text-canvas hover:bg-accent-strong active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-muted"><PaperPlaneTilt size={15} weight="fill" aria-hidden="true" /></button>
        </div>
      </div>
    </section>
  )
}
