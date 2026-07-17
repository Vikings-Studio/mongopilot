import { EJSON } from "bson"
import { MongoClient, type Document, type Filter, type Sort, type UpdateFilter } from "mongodb"
import type { AccessMode, CollectionInfo, DatabaseInfo, DocumentTargetInput, FindInput, FindResult, ReplaceDocumentInput, SavedConnection } from "../shared/types"
import type { ConnectionStore } from "./connection-store"

interface ActiveConnection {
  client: MongoClient
  connection: SavedConnection
}

export class MongoService {
  private readonly active = new Map<string, ActiveConnection>()

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
    const existing = this.active.get(id)
    if (existing) await existing.client.close()
    this.active.delete(id)
  }

  async disconnectAll(): Promise<void> {
    await Promise.all([...this.active.keys()].map((id) => this.disconnect(id)))
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
    const filter = input.filter.trim() ? EJSON.parse(input.filter) : {}
    if (!filter || Array.isArray(filter) || typeof filter !== "object") {
      throw new Error("Filter must be a JSON object.")
    }
    const sort = input.sort.trim() ? EJSON.parse(input.sort) : {}
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
      .find(filter as Record<string, unknown>, { maxTimeMS: 30_000 })
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
        id: EJSON.stringify(document._id, { relaxed: false }),
        document: this.serialize(document),
      })),
      total,
      durationMs: Math.round(performance.now() - started),
    }
  }

  async replaceDocument(input: ReplaceDocumentInput): Promise<void> {
    const active = this.requireWrite(input.connectionId)
    if (input.document.length > 10 * 1024 * 1024) throw new Error("Document must be smaller than 10 MB.")
    const id = EJSON.parse(input.id)
    const document = EJSON.parse(input.document)
    if (!document || Array.isArray(document) || typeof document !== "object") throw new Error("Document must be a JSON object.")
    const replacement = { ...(document as Document), _id: id }
    const result = await active.client.db(input.database).collection(input.collection).replaceOne({ _id: id } as Filter<Document>, replacement)
    if (result.matchedCount === 0) throw new Error("Document no longer exists.")
  }

  async deleteDocument(input: DocumentTargetInput): Promise<void> {
    const active = this.requireWrite(input.connectionId)
    const id = EJSON.parse(input.id)
    const result = await active.client.db(input.database).collection(input.collection).deleteOne({ _id: id } as Filter<Document>)
    if (result.deletedCount === 0) throw new Error("Document no longer exists.")
  }

  getAccessMode(connectionId: string): AccessMode {
    return this.requireActive(connectionId).connection.accessMode
  }

  async agentListDatabases(connectionId: string): Promise<DatabaseInfo[]> {
    return this.listDatabases(connectionId)
  }

  async agentListCollections(connectionId: string, database: string): Promise<CollectionInfo[]> {
    return this.listCollections(connectionId, database)
  }

  async agentFind(connectionId: string, database: string, collection: string, filter: Document, limit: number): Promise<unknown[]> {
    const active = this.requireRead(connectionId)
    const documents = await active.client.db(database).collection(collection).find(filter).limit(Math.min(Math.max(limit, 1), 100)).toArray()
    return this.serialize(documents) as unknown[]
  }

  async agentAggregate(connectionId: string, database: string, collection: string, pipeline: Document[], limit: number): Promise<unknown[]> {
    const active = this.requireRead(connectionId)
    if (pipeline.some((stage) => "$out" in stage || "$merge" in stage)) {
      throw new Error("Agent aggregation pipelines cannot use $out or $merge. Use an explicit write tool instead.")
    }
    const boundedPipeline = [...pipeline, { $limit: Math.min(Math.max(limit, 1), 100) }]
    const documents = await active.client.db(database).collection(collection).aggregate(boundedPipeline, { maxTimeMS: 30_000 }).toArray()
    return this.serialize(documents) as unknown[]
  }

  async agentCount(connectionId: string, database: string, collection: string, filter: Document): Promise<number> {
    const active = this.requireRead(connectionId)
    return active.client.db(database).collection(collection).countDocuments(filter, { maxTimeMS: 30_000 })
  }

  async agentInsertOne(connectionId: string, database: string, collection: string, document: Document): Promise<unknown> {
    const active = this.requireWrite(connectionId)
    const result = await active.client.db(database).collection(collection).insertOne(document)
    return this.serialize({ acknowledged: result.acknowledged, insertedId: result.insertedId })
  }

  async agentUpdateOne(connectionId: string, database: string, collection: string, filter: Filter<Document>, update: UpdateFilter<Document>): Promise<unknown> {
    const active = this.requireWrite(connectionId)
    if (Object.keys(filter).length === 0) throw new Error("Agent updates require a non-empty filter.")
    const result = await active.client.db(database).collection(collection).updateOne(filter, update)
    return { acknowledged: result.acknowledged, matchedCount: result.matchedCount, modifiedCount: result.modifiedCount }
  }

  async agentDeleteOne(connectionId: string, database: string, collection: string, filter: Filter<Document>): Promise<unknown> {
    const active = this.requireWrite(connectionId)
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

  private requireWrite(id: string): ActiveConnection {
    const active = this.requireActive(id)
    if (active.connection.accessMode === "read-only") {
      throw new Error("This connection is in read-only mode. Write operations are blocked by Mongo Pilot.")
    }
    return active
  }

  private requireActive(id: string): ActiveConnection {
    const active = this.active.get(id)
    if (!active) throw new Error("Connect to this deployment first.")
    return active
  }

  private serialize(value: unknown): unknown {
    return JSON.parse(EJSON.stringify(value, { relaxed: false })) as unknown
  }
}
