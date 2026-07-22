export type AgentAccessMode = "read-only" | "read-write"
export type ConnectionAccessMode = "read-only" | "read-write"
export type ConnectionEnvironment = "unlabeled" | "local" | "development" | "staging" | "production"

export interface SavedConnection {
  id: string
  name: string
  host: string
  environment: ConnectionEnvironment
  connectionAccessMode: ConnectionAccessMode
  agentAccessMode: AgentAccessMode
  favorite: boolean
  createdAt: string
  lastConnectedAt?: string
}

export interface SaveConnectionInput {
  id?: string
  name: string
  uri: string
  environment: ConnectionEnvironment
  connectionAccessMode: ConnectionAccessMode
  agentAccessMode: AgentAccessMode
  favorite: boolean
}

export interface UpdateConnectionSettingsInput {
  id: string
  environment: ConnectionEnvironment
  connectionAccessMode: ConnectionAccessMode
}

export interface ShellStartInput {
  connectionId: string
  database: string
}

export interface ShellEvaluateInput {
  connectionId: string
  code: string
}

export interface ShellResult {
  output: string[]
  prompt: string
  clearRequested: boolean
}

export interface ShellCompletionInput {
  connectionId: string
  code: string
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

export interface CollectionTargetInput {
  connectionId: string
  database: string
  collection: string
}

export interface CollectionIndexInfo {
  name: string
  keys: Array<{ field: string; direction: string }>
  unique: boolean
  sparse: boolean
  hidden: boolean
  expireAfterSeconds?: number
  partialFilterExpression?: unknown
}

export interface SchemaAnalysisInput extends CollectionTargetInput {
  sampleSize: number
}

export interface SchemaFieldInfo {
  path: string
  presentCount: number
  types: Array<{ name: string; count: number }>
}

export interface SchemaAnalysisResult {
  fields: SchemaFieldInfo[]
  sampleCount: number
  durationMs: number
}

export interface AggregateInput extends CollectionTargetInput {
  pipeline: string
  limit: number
}

export interface AggregateResult {
  documents: Array<{ id: string; document: string }>
  durationMs: number
}

export type VisualizationChartType = "bar" | "line" | "area" | "pie" | "scatter" | "table"

export interface VisualizationSeries {
  field: string
  label: string
}

export interface VisualizationSpec {
  title: string
  description: string
  chartType: VisualizationChartType
  pipeline: Array<Record<string, unknown>>
  categoryField: string
  series: VisualizationSeries[]
}

export interface VisualizationGenerateInput extends CollectionTargetInput {
  prompt: string
  model?: {
    providerID: string
    modelID: string
  }
}

export interface VisualizationRefreshInput extends CollectionTargetInput {
  spec: VisualizationSpec
}

export type VisualizationValue = string | number | boolean | null

export interface VisualizationResult {
  spec: VisualizationSpec
  rows: Array<Record<string, VisualizationValue>>
  durationMs: number
  generatedAt: string
}

export interface CollectionReportInput extends CollectionTargetInput {
  sampleSize: number
}

export interface CollectionReportResult {
  documentCount: number
  schema: SchemaAnalysisResult
  indexes: CollectionIndexInfo[]
  durationMs: number
  generatedAt: string
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
    document: string
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

export type WriteApprovalSource = "document" | "shell" | "agent"

export interface WriteApprovalRequest {
  id: string
  connectionId: string
  source: WriteApprovalSource
  title: string
  description: string
  preview?: string
  destructive: boolean
}

export interface WriteApprovalResponse {
  id: string
  approved: boolean
}

export const shellExecutionTimeoutMarker = "[SHELL_EXECUTION_TIMEOUT] "

export type CopilotStatus =
  | { state: "stopped" }
  | { state: "starting" }
  | { state: "ready"; version?: string }
  | { state: "error"; message: string }

export interface CopilotPromptInput {
  text: string
  variant?: string
  model?: {
    providerID: string
    modelID: string
  }
  context?: {
    connectionId?: string
    connectionName?: string
    connectionHost?: string
    connectionEnvironment?: ConnectionEnvironment
    connectionAccessMode?: ConnectionAccessMode
    database?: string
    collection?: string
    agentAccessMode?: AgentAccessMode
    availableConnections?: Array<{
      name: string
      host: string
      environment: ConnectionEnvironment
      connectionAccessMode: ConnectionAccessMode
      agentAccessMode: AgentAccessMode
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
  reasoningLevels: string[]
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

export type UpdateStatus =
  | { state: "disabled"; currentVersion: string }
  | { state: "idle"; currentVersion: string }
  | { state: "checking"; currentVersion: string }
  | { state: "not-available"; currentVersion: string }
  | { state: "available"; currentVersion: string; version: string }
  | { state: "downloading"; currentVersion: string; version: string; percent: number }
  | { state: "downloaded"; currentVersion: string; version: string }
  | { state: "error"; currentVersion: string; message: string }

export interface MongoPilotApi {
  writeApprovals: {
    resolve(response: WriteApprovalResponse): Promise<boolean>
    onRequest(listener: (request: WriteApprovalRequest) => void): () => void
    onCancelled(listener: (id: string) => void): () => void
  }
  connections: {
    list(): Promise<SavedConnection[]>
    save(input: SaveConnectionInput): Promise<SavedConnection>
    updateSettings(input: UpdateConnectionSettingsInput): Promise<SavedConnection>
    remove(id: string): Promise<void>
    copyUri(id: string): Promise<void>
    connect(id: string): Promise<ConnectionResult>
    disconnect(id: string): Promise<void>
  }
  database: {
    listCollections(connectionId: string, database: string): Promise<CollectionInfo[]>
    find(input: FindInput): Promise<FindResult>
    aggregate(input: AggregateInput): Promise<AggregateResult>
    generateVisualization(input: VisualizationGenerateInput): Promise<VisualizationResult>
    refreshVisualization(input: VisualizationRefreshInput): Promise<VisualizationResult>
    listIndexes(input: CollectionTargetInput): Promise<CollectionIndexInfo[]>
    analyzeSchema(input: SchemaAnalysisInput): Promise<SchemaAnalysisResult>
    generateReport(input: CollectionReportInput): Promise<CollectionReportResult>
    replaceDocument(input: ReplaceDocumentInput): Promise<void>
    deleteDocument(input: DocumentTargetInput): Promise<void>
  }
  shell: {
    start(input: ShellStartInput): Promise<{ prompt: string }>
    evaluate(input: ShellEvaluateInput): Promise<ShellResult>
    complete(input: ShellCompletionInput): Promise<string[]>
    interrupt(connectionId: string): Promise<boolean>
    close(connectionId: string): Promise<void>
  }
  copilot: {
    status(): Promise<CopilotStatus>
    start(): Promise<CopilotStatus>
    stop(): Promise<CopilotStatus>
    models(): Promise<CopilotModelsResult>
    prompt(input: CopilotPromptInput): Promise<CopilotReply>
  }
  updates: {
    status(): Promise<UpdateStatus>
    check(): Promise<UpdateStatus>
    download(): Promise<UpdateStatus>
    install(): Promise<void>
    onStatus(listener: (status: UpdateStatus) => void): () => void
  }
}
