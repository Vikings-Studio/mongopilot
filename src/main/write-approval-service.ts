import { BrowserWindow } from "electron"
import type { WriteApprovalResponse } from "../shared/types"
import { WriteApprovalBroker, type WriteApprovalInput } from "./write-approval-broker"

export class WriteApprovalService {
  private readonly broker = new WriteApprovalBroker(25_000, (id) => this.notifyCancelled(id))

  request(input: WriteApprovalInput): Promise<void> {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!window || window.isDestroyed()) throw new Error("Database writes require an open Mongo Pilot window for approval.")
    const close = () => this.broker.cancel()
    const rendererGone = () => this.broker.cancel()
    const navigation = () => this.broker.cancel()
    const approval = this.broker.request(input, (request) => window.webContents.send("write-approval:requested", request))
    window.once("closed", close)
    window.webContents.once("render-process-gone", rendererGone)
    window.webContents.once("did-start-navigation", navigation)
    return approval.finally(() => {
      window.removeListener("closed", close)
      if (!window.isDestroyed()) {
        window.webContents.removeListener("render-process-gone", rendererGone)
        window.webContents.removeListener("did-start-navigation", navigation)
      }
    })
  }

  resolve(response: WriteApprovalResponse): void {
    this.broker.resolve(response)
  }

  cancel(): void {
    const id = this.broker.cancel()
    if (id) this.notifyCancelled(id)
  }

  cancelAgentRequest(scope?: string): void {
    const id = this.broker.cancel("agent", scope)
    if (id) this.notifyCancelled(id)
  }

  private notifyCancelled(id: string): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send("write-approval:cancelled", id)
    }
  }
}
