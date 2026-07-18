import { createRequire } from "node:module"
import { inspect, stripVTControlCharacters } from "node:util"
import { MongoClient, type Document, type Filter, type Sort, type UpdateFilter } from "mongodb"
import type { AgentAccessMode, AggregateInput, AggregateResult, CollectionIndexInfo, CollectionInfo, CollectionReportInput, CollectionReportResult, CollectionTargetInput, DatabaseInfo, DocumentTargetInput, FindInput, FindResult, ReplaceDocumentInput, SavedConnection, SchemaAnalysisInput, SchemaAnalysisResult, ShellCompletionInput, ShellEvaluateInput, ShellResult, ShellStartInput, UpdateConnectionSettingsInput, VisualizationResult, VisualizationSpec } from "../shared/types"
import { parseAggregationPipeline } from "./aggregation-pipeline"
import { parseExtendedJson, serializeBson, serializeBsonArray, stringifyCanonicalExtendedJson, stringifyMongoDocument } from "./bson-serialization"
import type { ConnectionStore } from "./connection-store"
import { analyzeDocuments } from "./schema-analysis"
import { parseVisualizationSpec } from "./visualization-spec"
import { normalizeVisualizationValue } from "./visualization-values"

interface ActiveConnection {
  client: MongoClient
  connection: SavedConnection
}

interface MongoshEvaluationResult {
  printable: unknown
}

interface MongoshCompletion {
  completion: string
}

interface MongoshRuntime {
  evaluate(code: string): Promise<MongoshEvaluationResult>
  getCompletions(code: string): Promise<MongoshCompletion[]>
  getShellPrompt(): Promise<string>
  setEvaluationListener(listener: {
    onPrint?: (results: MongoshEvaluationResult[]) => void
    onClearCommand?: () => void
  }): unknown
  interrupt(): Promise<boolean>
  terminate(): Promise<void>
  waitForRuntimeToBeReady(): Promise<void>
}

interface MongoshRuntimeConstructor {
  new(uri: string, driverOptions: Record<string, never>): MongoshRuntime
}

interface ShellSession {
  runtime: MongoshRuntime
  printed: string[]
  printedLength: number
  outputTruncated: boolean
  clearRequested: boolean
}

const require = createRequire(import.meta.url)
const WebWorker = require("web-worker") as unknown
if (typeof Reflect.get(globalThis, "Worker") !== "function") Object.defineProperty(globalThis, "Worker", { configurable: true, value: WebWorker })
const { WorkerRuntime } = require("@mongosh/node-runtime-worker-thread") as { WorkerRuntime: MongoshRuntimeConstructor }
const shellInputLimit = 256 * 1024
const shellOutputLimit = 512 * 1024

export class MongoService {
  private readonly active = new Map<string, ActiveConnection>()
  private readonly shells = new Map<string, ShellSession>()

  constructor(private readonly store: ConnectionStore) {}

  async connect(id: string): Promise<{ connection: SavedConnection; databases: DatabaseInfo[] }> {
    await this.disconnect(id)
    const uri = await this.store.getUri(id)
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 })
    await client.connect()
    const connection = await this.store.markConnected(id)
    this.active.set(id, { client, connection })
    let databases: DatabaseInfo[]
    try {
      databases = await this.listDatabases(id)
    } catch (error) {
      const databaseName = client.options.dbName
      if (!databaseName) {
        await this.disconnect(id)
        throw error
      }
      databases = [{ name: databaseName }]
    }
    return { connection, databases }
  }

  async disconnect(id: string): Promise<void> {
    await this.closeShell(id)
    const existing = this.active.get(id)
    if (existing) await existing.client.close()
    this.active.delete(id)
  }

  async disconnectAll(): Promise<void> {
    await Promise.all([...this.active.keys()].map((id) => this.disconnect(id)))
  }

  async updateConnectionSettings(input: UpdateConnectionSettingsInput): Promise<SavedConnection> {
    const connection = await this.store.updateSettings(input)
    const active = this.active.get(input.id)
    if (active) active.connection = connection
    if (connection.connectionAccessMode === "read-only") await this.closeShell(input.id)
    return connection
  }

  async startShell(input: ShellStartInput): Promise<{ prompt: string }> {
    this.requireWrite(input.connectionId)
    let session = this.shells.get(input.connectionId)
    if (!session) {
      const runtime = new WorkerRuntime(await this.store.getUri(input.connectionId), {})
      session = { runtime, printed: [], printedLength: 0, outputTruncated: false, clearRequested: false }
      runtime.setEvaluationListener({
        onPrint: (results) => {
          if (!session) return
          for (const result of results) this.captureShellPrint(session, result.printable)
        },
        onClearCommand: () => {
          if (session) session.clearRequested = true
        },
      })
      this.shells.set(input.connectionId, session)
      try {
        await runtime.waitForRuntimeToBeReady()
      } catch (error) {
        this.shells.delete(input.connectionId)
        await runtime.terminate()
        throw error
      }
    }
    if (input.database.trim()) {
      await session.runtime.evaluate(`use(${JSON.stringify(input.database)})`)
      session.printed = []
      session.printedLength = 0
      session.outputTruncated = false
      session.clearRequested = false
    }
    return { prompt: await session.runtime.getShellPrompt() }
  }

  async evaluateShell(input: ShellEvaluateInput): Promise<ShellResult> {
    this.requireWrite(input.connectionId)
    if (!input.code.trim()) throw new Error("Enter a mongosh command.")
    if (input.code.length > shellInputLimit) throw new Error("Shell input must be smaller than 256 KB.")
    const session = this.requireShell(input.connectionId)
    session.printed = []
    session.printedLength = 0
    session.outputTruncated = false
    session.clearRequested = false
    const result = await session.runtime.evaluate(input.code)
    const output = [...session.printed]
    if (session.outputTruncated) output.push("[Output truncated at 512 KB]")
    if (result.printable !== undefined) output.push(this.formatShellValue(result.printable))
    return {
      output: this.boundShellOutput(output),
      prompt: await session.runtime.getShellPrompt(),
      clearRequested: session.clearRequested,
    }
  }

  async completeShell(input: ShellCompletionInput): Promise<string[]> {
    this.requireWrite(input.connectionId)
    if (input.code.length > shellInputLimit) throw new Error("Shell input must be smaller than 256 KB.")
    const completions = await this.requireShell(input.connectionId).runtime.getCompletions(input.code)
    return completions.slice(0, 100).map(({ completion }) => completion)
  }

  async interruptShell(connectionId: string): Promise<boolean> {
    this.requireWrite(connectionId)
    return this.requireShell(connectionId).runtime.interrupt()
  }

  async closeShell(connectionId: string): Promise<void> {
    const session = this.shells.get(connectionId)
    this.shells.delete(connectionId)
    if (session) await session.runtime.terminate()
  }

  async listCollections(connectionId: string, database: string): Promise<CollectionInfo[]> {
    const active = this.requireRead(connectionId)
    const collections = await active.client.db(database).listCollections({}, { nameOnly: true }).toArray()
    return collections.map(({ name, type }) => ({ name, type: type ?? "collection" }))
  }

  async find(input: FindInput): Promise<FindResult> {
    const active = this.requireRead(input.connectionId)
    if (!input.database.trim() || !input.collection.trim()) throw new Error("Database and collection are required.")
    if (input.filter.length > 65_536 || input.sort.length > 65_536) throw new Error("Filter and sort input must be smaller than 64 KB.")
    const filter = input.filter.trim() ? parseExtendedJson(input.filter) : {}
    if (!filter || Array.isArray(filter) || typeof filter !== "object") {
      throw new Error("Filter must be a JSON object.")
    }
    const sort = input.sort.trim() ? parseExtendedJson(input.sort) : {}
    if (!sort || Array.isArray(sort) || typeof sort !== "object") {
      throw new Error("Sort must be a JSON object.")
    }
    for (const direction of Object.values(sort)) {
      if (direction !== 1 && direction !== -1 && direction !== "asc" && direction !== "desc" && direction !== "ascending" && direction !== "descending") {
        throw new Error('Sort directions must be 1, -1, "asc", or "desc".')
      }
    }
    const started = performance.now()
    const collection = active.client.db(input.database).collection(input.collection)
    const limit = Math.min(Math.max(input.limit, 1), 100)
    const cursor = collection
      .find(filter as Record<string, unknown>, { maxTimeMS: 30_000, promoteValues: false })
      .sort(sort as Sort)
      .skip(Math.max(input.skip, 0))
      .limit(limit)
      .batchSize(limit)
    if (Object.keys(sort).length > 0) cursor.allowDiskUse(true)
    const [documents, total] = await Promise.all([
      cursor.toArray(),
      collection.countDocuments(filter as Record<string, unknown>, { maxTimeMS: 30_000 }),
    ])
    return {
      documents: documents.map((document) => ({
        id: stringifyCanonicalExtendedJson(document._id),
        document: stringifyMongoDocument(document),
      })),
      total,
      durationMs: Math.round(performance.now() - started),
    }
  }

  async listIndexes(input: CollectionTargetInput): Promise<CollectionIndexInfo[]> {
    const active = this.requireRead(input.connectionId)
    const indexes = await active.client.db(input.database).collection(input.collection).listIndexes({ maxTimeMS: 30_000 }).toArray()
    return indexes.map((index) => ({
      name: index.name ?? "Unnamed index",
      keys: Object.entries(index.key).map(([field, direction]) => ({ field, direction: String(direction) })),
      unique: index.unique === true,
      sparse: index.sparse === true,
      hidden: index.hidden === true,
      ...(typeof index.expireAfterSeconds === "number" ? { expireAfterSeconds: index.expireAfterSeconds } : {}),
      ...(index.partialFilterExpression ? { partialFilterExpression: serializeBson(index.partialFilterExpression) } : {}),
    }))
  }

  async aggregate(input: AggregateInput): Promise<AggregateResult> {
    const active = this.requireRead(input.connectionId)
    const pipeline = parseAggregationPipeline(input.pipeline)
    const limit = Math.min(Math.max(Math.trunc(input.limit), 1), 100)
    const started = performance.now()
    const documents = await active.client.db(input.database).collection(input.collection)
      .aggregate([...pipeline, { $limit: limit }], { allowDiskUse: true, maxTimeMS: 30_000, promoteValues: false })
      .batchSize(limit)
      .toArray()
    return {
      documents: documents.map((document, index) => ({ id: `aggregate-result-${index}`, document: stringifyMongoDocument(document) })),
      durationMs: Math.round(performance.now() - started),
    }
  }

  async runVisualization(input: CollectionTargetInput & { spec: VisualizationSpec }): Promise<VisualizationResult> {
    const active = this.requireRead(input.connectionId)
    const spec = parseVisualizationSpec(input.spec)
    const pipeline = parseAggregationPipeline(JSON.stringify(spec.pipeline))
    const started = performance.now()
    const documents = await active.client.db(input.database).collection(input.collection)
      .aggregate([...pipeline, { $limit: 100 }], { allowDiskUse: true, maxTimeMS: 30_000, promoteValues: false })
      .batchSize(100)
      .toArray()
    return {
      spec,
      rows: documents.map((document) => Object.fromEntries(
        Object.entries(document).map(([key, value]) => [key, normalizeVisualizationValue(value)]),
      )),
      durationMs: Math.round(performance.now() - started),
      generatedAt: new Date().toISOString(),
    }
  }

  async analyzeSchema(input: SchemaAnalysisInput): Promise<SchemaAnalysisResult> {
    const active = this.requireRead(input.connectionId)
    const sampleSize = Math.min(Math.max(Math.trunc(input.sampleSize), 1), 1_000)
    const started = performance.now()
    const documents = await active.client.db(input.database).collection(input.collection)
      .find({}, { maxTimeMS: 30_000, promoteValues: false })
      .limit(sampleSize)
      .batchSize(Math.min(sampleSize, 100))
      .toArray()
    return analyzeDocuments(documents, Math.round(performance.now() - started))
  }

  async generateReport(input: CollectionReportInput): Promise<CollectionReportResult> {
    const active = this.requireRead(input.connectionId)
    const started = performance.now()
    const [documentCount, schema, indexes] = await Promise.all([
      active.client.db(input.database).collection(input.collection).countDocuments({}, { maxTimeMS: 30_000 }),
      this.analyzeSchema(input),
      this.listIndexes(input),
    ])
    return {
      documentCount,
      schema,
      indexes,
      durationMs: Math.round(performance.now() - started),
      generatedAt: new Date().toISOString(),
    }
  }

  async replaceDocument(input: ReplaceDocumentInput): Promise<void> {
    const active = this.requireWrite(input.connectionId)
    if (input.document.length > 10 * 1024 * 1024) throw new Error("Document must be smaller than 10 MB.")
    const id = parseExtendedJson(input.id)
    const document = parseExtendedJson(input.document)
    if (!document || Array.isArray(document) || typeof document !== "object") throw new Error("Document must be a JSON object.")
    const replacement = { ...(document as Document), _id: id }
    const result = await active.client.db(input.database).collection(input.collection).replaceOne({ _id: id } as Filter<Document>, replacement)
    if (result.matchedCount === 0) throw new Error("Document no longer exists.")
  }

  async deleteDocument(input: DocumentTargetInput): Promise<void> {
    const active = this.requireWrite(input.connectionId)
    const id = parseExtendedJson(input.id)
    const result = await active.client.db(input.database).collection(input.collection).deleteOne({ _id: id } as Filter<Document>)
    if (result.deletedCount === 0) throw new Error("Document no longer exists.")
  }

  getAgentAccessMode(connectionId: string): AgentAccessMode {
    const { connection } = this.requireActive(connectionId)
    return connection.connectionAccessMode === "read-only" ? "read-only" : connection.agentAccessMode
  }

  async agentListDatabases(connectionId: string): Promise<DatabaseInfo[]> {
    return this.listDatabases(connectionId)
  }

  async agentListCollections(connectionId: string, database: string): Promise<CollectionInfo[]> {
    return this.listCollections(connectionId, database)
  }

  async agentFind(connectionId: string, database: string, collection: string, filter: Document, limit: number): Promise<unknown[]> {
    const active = this.requireRead(connectionId)
    const documents = await active.client.db(database).collection(collection).find(filter, { promoteValues: false }).limit(Math.min(Math.max(limit, 1), 100)).toArray()
    return serializeBsonArray(documents)
  }

  async agentAggregate(connectionId: string, database: string, collection: string, pipeline: Document[], limit: number): Promise<unknown[]> {
    const active = this.requireRead(connectionId)
    if (pipeline.some((stage) => "$out" in stage || "$merge" in stage)) {
      throw new Error("Agent aggregation pipelines cannot use $out or $merge. Use an explicit write tool instead.")
    }
    const boundedPipeline = [...pipeline, { $limit: Math.min(Math.max(limit, 1), 100) }]
    const documents = await active.client.db(database).collection(collection).aggregate(boundedPipeline, { maxTimeMS: 30_000, promoteValues: false }).toArray()
    return serializeBsonArray(documents)
  }

  async agentCount(connectionId: string, database: string, collection: string, filter: Document): Promise<number> {
    const active = this.requireRead(connectionId)
    return active.client.db(database).collection(collection).countDocuments(filter, { maxTimeMS: 30_000 })
  }

  async agentInsertOne(connectionId: string, database: string, collection: string, document: Document): Promise<unknown> {
    const active = this.requireAgentWrite(connectionId)
    const result = await active.client.db(database).collection(collection).insertOne(document)
    return serializeBson({ acknowledged: result.acknowledged, insertedId: result.insertedId })
  }

  async agentUpdateOne(connectionId: string, database: string, collection: string, filter: Filter<Document>, update: UpdateFilter<Document>): Promise<unknown> {
    const active = this.requireAgentWrite(connectionId)
    if (Object.keys(filter).length === 0) throw new Error("Agent updates require a non-empty filter.")
    const result = await active.client.db(database).collection(collection).updateOne(filter, update)
    return { acknowledged: result.acknowledged, matchedCount: result.matchedCount, modifiedCount: result.modifiedCount }
  }

  async agentDeleteOne(connectionId: string, database: string, collection: string, filter: Filter<Document>): Promise<unknown> {
    const active = this.requireAgentWrite(connectionId)
    if (Object.keys(filter).length === 0) throw new Error("Agent deletes require a non-empty filter.")
    const result = await active.client.db(database).collection(collection).deleteOne(filter)
    return { acknowledged: result.acknowledged, deletedCount: result.deletedCount }
  }

  private async listDatabases(connectionId: string): Promise<DatabaseInfo[]> {
    const active = this.requireRead(connectionId)
    const result = await active.client.db("admin").admin().listDatabases()
    return result.databases.map(({ name, sizeOnDisk, empty }) => ({ name, sizeOnDisk, empty }))
  }

  private requireRead(id: string): ActiveConnection {
    return this.requireActive(id)
  }

  private requireAgentWrite(id: string): ActiveConnection {
    const active = this.requireWrite(id)
    if (active.connection.agentAccessMode === "read-only") {
      throw new Error("This connection only grants read access to the agent.")
    }
    return active
  }

  private requireWrite(id: string): ActiveConnection {
    const active = this.requireActive(id)
    if (active.connection.connectionAccessMode === "read-only") {
      throw new Error("This connection is locked to read-only mode in Mongo Pilot.")
    }
    return active
  }

  private requireShell(id: string): ShellSession {
    const session = this.shells.get(id)
    if (!session) throw new Error("Open the shell before running a command.")
    return session
  }

  private formatShellValue(value: unknown): string {
    const formatted = typeof value === "string"
      ? value
      : inspect(value, { colors: false, depth: 12, maxArrayLength: 1_000, maxStringLength: shellOutputLimit, breakLength: 100 })
    return stripVTControlCharacters(formatted)
  }

  private captureShellPrint(session: ShellSession, value: unknown): void {
    if (session.outputTruncated) return
    const formatted = this.formatShellValue(value)
    const remaining = shellOutputLimit - session.printedLength
    if (remaining <= 0) {
      session.outputTruncated = true
      return
    }
    session.printed.push(formatted.slice(0, remaining))
    session.printedLength += Math.min(formatted.length, remaining)
    if (formatted.length > remaining) session.outputTruncated = true
  }

  private boundShellOutput(output: string[]): string[] {
    let remaining = shellOutputLimit
    let total = 0
    const bounded: string[] = []
    for (const value of output) {
      total += value.length
      if (remaining <= 0) break
      const next = value.slice(0, remaining)
      bounded.push(next)
      remaining -= next.length
    }
    if (total > shellOutputLimit || output.length > bounded.length) bounded.push("[Output truncated at 512 KB]")
    return bounded
  }

  private requireActive(id: string): ActiveConnection {
    const active = this.active.get(id)
    if (!active) throw new Error("Connect to this deployment first.")
    return active
  }

}
