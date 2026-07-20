import { ShieldWarning, Trash } from "@phosphor-icons/react"
import { useEffect, useRef } from "react"
import type { WriteApprovalRequest } from "../../shared/types"

interface WriteApprovalDialogProps {
  request: WriteApprovalRequest
  onResolve(approved: boolean): void
}

export function WriteApprovalDialog({ request, onResolve }: WriteApprovalDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => cancelRef.current?.focus())
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onResolve(false)
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener("keydown", closeOnEscape)
    }
  }, [onResolve])

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-6 backdrop-blur-sm">
      <button type="button" aria-label="Cancel database write" onClick={() => onResolve(false)} className="absolute inset-0 cursor-default focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-danger focus-visible:outline-none" />
      <section role="alertdialog" aria-modal="true" aria-labelledby="write-approval-title" aria-describedby="write-approval-description" className="relative z-10 w-full max-w-lg rounded-lg border border-line-strong bg-panel p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className={`grid size-9 shrink-0 place-items-center rounded-md ${request.destructive ? "bg-danger/15 text-danger" : "bg-warning/15 text-warning"}`}>
            {request.destructive ? <Trash size={18} aria-hidden="true" /> : <ShieldWarning size={18} aria-hidden="true" />}
          </div>
          <div className="min-w-0">
            <p className="font-mono text-[9px] uppercase tracking-wider text-faint">{request.source} write request</p>
            <h2 id="write-approval-title" className="mt-1 text-base font-semibold text-ink">{request.title}</h2>
            <p id="write-approval-description" className="mt-2 text-xs leading-5 text-muted">{request.description}</p>
          </div>
        </div>
        {request.preview && <pre className="scrollbar-thin mt-4 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-canvas p-3 font-mono text-[11px] leading-5 text-muted">{request.preview}</pre>}
        <p className="mt-3 text-[11px] leading-4 text-faint">Read/write mode enables this request but never approves it automatically.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={() => onResolve(false)} className="h-10 rounded-md border border-line px-4 text-xs font-medium text-muted hover:border-line-strong hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">Cancel</button>
          <button type="button" onClick={() => onResolve(true)} className={`h-10 rounded-md px-4 text-xs font-semibold text-canvas focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-panel focus-visible:outline-none ${request.destructive ? "bg-danger hover:brightness-110 focus-visible:ring-danger" : "bg-accent hover:bg-accent-strong focus-visible:ring-accent"}`}>
            {request.destructive ? "Approve destructive write" : "Approve once"}
          </button>
        </div>
      </section>
    </div>
  )
}
