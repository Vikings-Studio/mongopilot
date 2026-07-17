export type AccessMode = "read-only" | "read-write"

export interface SavedConnection {
  id: string
  name: string
  host: string
  accessMode: AccessMode
  favorite: boolean
  createdAt: string
  lastConnectedAt?: string
}

export interface SaveConnectionInput {
  id?: string
  name: string
  uri: string
  accessMode: AccessMode
  favorite: boolean
}

export interface ConnectionResult {
  connection: SavedConnection
  databases: DatabaseInfo[]
}

export interface DatabaseInfo {
  name: string
  sizeOnDisk?: number
  empty?: boolean
}

export interface CollectionInfo {
  name: string
  type: string
}

export interface FindInput {
  connectionId: string
  database: string
  collection: string
  filter: string
  sort: string
  skip: number
  limit: number
}

export interface FindResult {
  documents: Array<{
    id: string
    document: unknown
  }>
  total: number
  durationMs: number
}

export interface DocumentTargetInput {
  connectionId: string
  database: string
  collection: string
  id: string
}

export interface ReplaceDocumentInput extends DocumentTargetInput {
  document: string
}

export type CopilotStatus =
  | { state: "stopped" }
  | { state: "starting" }
  | { state: "ready"; version?: string }
  | { state: "error"; message: string }

export interface CopilotPromptInput {
  text: string
  model?: {
    providerID: string
    modelID: string
  }
  context?: {
    connectionId?: string
    connectionName?: string
    connectionHost?: string
    database?: string
    collection?: string
    accessMode?: AccessMode
    availableConnections?: Array<{
      name: string
      host: string
      accessMode: AccessMode
      favorite: boolean
    }>
  }
}

export interface CopilotReply {
  text: string
  sessionId: string
}

export interface CopilotModel {
  providerID: string
  modelID: string
  providerName: string
  name: string
  family?: string
  supportsTools: boolean
  contextLimit: number
  status: "alpha" | "beta" | "deprecated" | "active"
}

export interface CopilotModelsResult {
  models: CopilotModel[]
  defaultModel?: {
    providerID: string
    modelID: string
  }
}

export interface MongoPilotApi {
  connections: {
    list(): Promise<SavedConnection[]>
    save(input: SaveConnectionInput): Promise<SavedConnection>
    remove(id: string): Promise<void>
    copyUri(id: string): Promise<void>
    connect(id: string): Promise<ConnectionResult>
    disconnect(id: string): Promise<void>
  }
  database: {
    listCollections(connectionId: string, database: string): Promise<CollectionInfo[]>
    find(input: FindInput): Promise<FindResult>
    replaceDocument(input: ReplaceDocumentInput): Promise<void>
    deleteDocument(input: DocumentTargetInput): Promise<void>
  }
  copilot: {
    status(): Promise<CopilotStatus>
    start(): Promise<CopilotStatus>
    stop(): Promise<CopilotStatus>
    models(): Promise<CopilotModelsResult>
    prompt(input: CopilotPromptInput): Promise<CopilotReply>
  }
}
