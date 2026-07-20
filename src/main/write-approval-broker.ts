import { randomUUID } from "node:crypto"
import type { WriteApprovalRequest, WriteApprovalResponse, WriteApprovalSource } from "../shared/types"

export interface WriteApprovalInput {
  scope?: string
  connectionId: string
  source: WriteApprovalSource
  title: string
  description: string
  preview?: string
  destructive: boolean
}

interface PendingApproval {
  id: string
  source: WriteApprovalSource
  scope?: string
  resolve(): void
  reject(error: Error): void
  timeout: ReturnType<typeof setTimeout>
}

export class WriteApprovalBroker {
  private pending?: PendingApproval

  constructor(
    private readonly timeoutMs = 25_000,
    private readonly onExpired: (id: string) => void = () => undefined,
  ) {}

  request(input: WriteApprovalInput, send: (request: WriteApprovalRequest) => void): Promise<void> {
    if (this.pending) throw new Error("Another database write is already waiting for approval.")
    const { scope, ...visibleInput } = input
    const request: WriteApprovalRequest = { id: randomUUID(), ...visibleInput }
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending = undefined
        this.onExpired(request.id)
        reject(new Error("Database write approval expired."))
      }, this.timeoutMs)
      this.pending = { id: request.id, source: request.source, scope, resolve, reject, timeout }
      try {
        send(request)
      } catch (error) {
        clearTimeout(timeout)
        this.pending = undefined
        reject(error instanceof Error ? error : new Error("Could not display database write approval."))
      }
    })
  }

  resolve(response: WriteApprovalResponse): void {
    const pending = this.pending
    if (!pending || pending.id !== response.id) return
    clearTimeout(pending.timeout)
    this.pending = undefined
    if (response.approved) pending.resolve()
    else pending.reject(new Error("Database write was cancelled by the user."))
  }

  cancel(source?: WriteApprovalSource, scope?: string): string | undefined {
    const pending = this.pending
    if (!pending || (source && pending.source !== source) || (scope && pending.scope !== scope)) return undefined
    clearTimeout(pending.timeout)
    this.pending = undefined
    pending.reject(new Error("Database write approval was cancelled."))
    return pending.id
  }
}

export function writeApprovalPreview(value: string, limit = 8_000): string {
  if (value.length <= limit) return value
  const retained = Math.floor((limit - 80) / 2)
  const omitted = value.length - retained * 2
  return `${value.slice(0, retained)}\n\n... ${omitted} characters omitted; full payload will execute ...\n\n${value.slice(-retained)}`
}
