import { contextBridge, ipcRenderer } from "electron"
import type { CopilotPromptInput, DocumentTargetInput, FindInput, MongoPilotApi, ReplaceDocumentInput, SaveConnectionInput } from "../shared/types"

const api: MongoPilotApi = {
  connections: {
    list: () => ipcRenderer.invoke("connections:list"),
    save: (input: SaveConnectionInput) => ipcRenderer.invoke("connections:save", input),
    remove: (id: string) => ipcRenderer.invoke("connections:remove", id),
    copyUri: (id: string) => ipcRenderer.invoke("connections:copyUri", id),
    connect: (id: string) => ipcRenderer.invoke("connections:connect", id),
    disconnect: (id: string) => ipcRenderer.invoke("connections:disconnect", id),
  },
  database: {
    listCollections: (connectionId: string, database: string) =>
      ipcRenderer.invoke("database:listCollections", connectionId, database),
    find: (input: FindInput) => ipcRenderer.invoke("database:find", input),
    replaceDocument: (input: ReplaceDocumentInput) => ipcRenderer.invoke("database:replaceDocument", input),
    deleteDocument: (input: DocumentTargetInput) => ipcRenderer.invoke("database:deleteDocument", input),
  },
  copilot: {
    status: () => ipcRenderer.invoke("copilot:status"),
    start: () => ipcRenderer.invoke("copilot:start"),
    stop: () => ipcRenderer.invoke("copilot:stop"),
    models: () => ipcRenderer.invoke("copilot:models"),
    prompt: (input: CopilotPromptInput) => ipcRenderer.invoke("copilot:prompt", input),
  },
}

contextBridge.exposeInMainWorld("mongoPilot", api)
