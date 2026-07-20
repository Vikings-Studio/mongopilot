import { contextBridge, ipcRenderer } from "electron"
import type { AggregateInput, CollectionReportInput, CollectionTargetInput, CopilotPromptInput, DocumentTargetInput, FindInput, MongoPilotApi, ReplaceDocumentInput, SaveConnectionInput, SchemaAnalysisInput, ShellCompletionInput, ShellEvaluateInput, ShellStartInput, UpdateConnectionSettingsInput, UpdateStatus, VisualizationGenerateInput, VisualizationRefreshInput, WriteApprovalRequest, WriteApprovalResponse } from "../shared/types"

const api: MongoPilotApi = {
  writeApprovals: {
    resolve: (response: WriteApprovalResponse) => ipcRenderer.send("write-approval:resolve", response),
    onRequest: (callback: (request: WriteApprovalRequest) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, request: WriteApprovalRequest) => callback(request)
      ipcRenderer.on("write-approval:requested", listener)
      return () => ipcRenderer.removeListener("write-approval:requested", listener)
    },
    onCancelled: (callback: (id: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, id: string) => callback(id)
      ipcRenderer.on("write-approval:cancelled", listener)
      return () => ipcRenderer.removeListener("write-approval:cancelled", listener)
    },
  },
  connections: {
    list: () => ipcRenderer.invoke("connections:list"),
    save: (input: SaveConnectionInput) => ipcRenderer.invoke("connections:save", input),
    updateSettings: (input: UpdateConnectionSettingsInput) => ipcRenderer.invoke("connections:updateSettings", input),
    remove: (id: string) => ipcRenderer.invoke("connections:remove", id),
    copyUri: (id: string) => ipcRenderer.invoke("connections:copyUri", id),
    connect: (id: string) => ipcRenderer.invoke("connections:connect", id),
    disconnect: (id: string) => ipcRenderer.invoke("connections:disconnect", id),
  },
  database: {
    listCollections: (connectionId: string, database: string) =>
      ipcRenderer.invoke("database:listCollections", connectionId, database),
    find: (input: FindInput) => ipcRenderer.invoke("database:find", input),
    aggregate: (input: AggregateInput) => ipcRenderer.invoke("database:aggregate", input),
    generateVisualization: (input: VisualizationGenerateInput) => ipcRenderer.invoke("database:generateVisualization", input),
    refreshVisualization: (input: VisualizationRefreshInput) => ipcRenderer.invoke("database:refreshVisualization", input),
    listIndexes: (input: CollectionTargetInput) => ipcRenderer.invoke("database:listIndexes", input),
    analyzeSchema: (input: SchemaAnalysisInput) => ipcRenderer.invoke("database:analyzeSchema", input),
    generateReport: (input: CollectionReportInput) => ipcRenderer.invoke("database:generateReport", input),
    replaceDocument: (input: ReplaceDocumentInput) => ipcRenderer.invoke("database:replaceDocument", input),
    deleteDocument: (input: DocumentTargetInput) => ipcRenderer.invoke("database:deleteDocument", input),
  },
  shell: {
    start: (input: ShellStartInput) => ipcRenderer.invoke("shell:start", input),
    evaluate: (input: ShellEvaluateInput) => ipcRenderer.invoke("shell:evaluate", input),
    complete: (input: ShellCompletionInput) => ipcRenderer.invoke("shell:complete", input),
    interrupt: (connectionId: string) => ipcRenderer.invoke("shell:interrupt", connectionId),
    close: (connectionId: string) => ipcRenderer.invoke("shell:close", connectionId),
  },
  copilot: {
    status: () => ipcRenderer.invoke("copilot:status"),
    start: () => ipcRenderer.invoke("copilot:start"),
    stop: () => ipcRenderer.invoke("copilot:stop"),
    models: () => ipcRenderer.invoke("copilot:models"),
    prompt: (input: CopilotPromptInput) => ipcRenderer.invoke("copilot:prompt", input),
  },
  updates: {
    status: () => ipcRenderer.invoke("updates:status"),
    check: () => ipcRenderer.invoke("updates:check"),
    download: () => ipcRenderer.invoke("updates:download"),
    install: () => ipcRenderer.invoke("updates:install"),
    onStatus: (callback: (status: UpdateStatus) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => callback(status)
      ipcRenderer.on("updates:status-changed", listener)
      return () => ipcRenderer.removeListener("updates:status-changed", listener)
    },
  },
}

contextBridge.exposeInMainWorld("mongoPilot", api)
