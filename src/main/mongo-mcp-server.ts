import { randomBytes } from "node:crypto"
import type { Server } from "node:http"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import express from "express"
import { z } from "zod"
import type { AccessMode } from "../shared/types"
import type { MongoService } from "./mongo-service"

interface AgentGrant {
  connectionId: string
  accessMode: AccessMode
}

const documentSchema = z.record(z.unknown())

export type MongoAgentService = Pick<MongoService,
  | "getAccessMode"
  | "agentListDatabases"
  | "agentListCollections"
  | "agentFind"
  | "agentAggregate"
  | "agentCount"
  | "agentInsertOne"
  | "agentUpdateOne"
  | "agentDeleteOne"
>

export class MongoMcpServer {
  private readonly token = randomBytes(32).toString("base64url")
  private listener?: Server
  private grant?: AgentGrant
  private url?: string

  constructor(private readonly mongo: MongoAgentService) {}

  async start(): Promise<{ url: string; token: string }> {
    if (this.url) return { url: this.url, token: this.token }
    const app = createMcpExpressApp({ host: "127.0.0.1" })
    app.use(express.json({ limit: "1mb" }))
    app.post("/mcp", async (request, response) => {
      if (request.headers.authorization !== `Bearer ${this.token}`) {
        response.sendStatus(401)
        return
      }
      const server = this.createServer()
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      response.on("close", () => {
        void transport.close()
        void server.close()
      })
      await server.connect(transport)
      await transport.handleRequest(request, response, request.body)
    })
    app.get("/mcp", (_request, response) => response.sendStatus(405))
    app.delete("/mcp", (_request, response) => response.sendStatus(405))
    this.listener = await new Promise<Server>((resolve, reject) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener))
      listener.once("error", reject)
    })
    const address = this.listener.address()
    if (!address || typeof address === "string") throw new Error("MongoDB MCP server did not bind to a TCP port.")
    this.url = `http://127.0.0.1:${address.port}/mcp`
    return { url: this.url, token: this.token }
  }

  setGrant(grant: AgentGrant): void {
    const actualMode = this.mongo.getAccessMode(grant.connectionId)
    if (grant.accessMode === "read-write" && actualMode === "read-only") {
      throw new Error("A read-only connection cannot grant read/write agent access.")
    }
    this.grant = Object.freeze({ ...grant })
  }

  clearGrant(): void {
    this.grant = undefined
  }

  async stop(): Promise<void> {
    this.clearGrant()
    const listener = this.listener
    if (listener) await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()))
    this.listener = undefined
    this.url = undefined
  }

  private createServer(): McpServer {
    const server = new McpServer({ name: "mongo-pilot", version: "0.1.0" })
    server.registerTool("list_databases", { description: "List databases on the authorized MongoDB connection." }, async () =>
      this.result(await this.mongo.agentListDatabases(this.requireRead().connectionId)))
    server.registerTool("list_collections", {
      description: "List collections in a database on the authorized MongoDB connection.",
      inputSchema: { database: z.string().min(1) },
    }, async ({ database }) => this.result(await this.mongo.agentListCollections(this.requireRead().connectionId, database)))
    server.registerTool("find", {
      description: "Find up to 100 documents in an authorized MongoDB collection.",
      inputSchema: { database: z.string().min(1), collection: z.string().min(1), filter: documentSchema.default({}), limit: z.number().int().min(1).max(100).default(20) },
    }, async ({ database, collection, filter, limit }) => this.result(await this.mongo.agentFind(this.requireRead().connectionId, database, collection, filter, limit)))
    server.registerTool("aggregate", {
      description: "Run a read-only aggregation pipeline and return up to 100 results.",
      inputSchema: { database: z.string().min(1), collection: z.string().min(1), pipeline: z.array(documentSchema).max(30), limit: z.number().int().min(1).max(100).default(20) },
    }, async ({ database, collection, pipeline, limit }) => this.result(await this.mongo.agentAggregate(this.requireRead().connectionId, database, collection, pipeline, limit)))
    server.registerTool("count", {
      description: "Count documents matching a filter in an authorized MongoDB collection.",
      inputSchema: { database: z.string().min(1), collection: z.string().min(1), filter: documentSchema.default({}) },
    }, async ({ database, collection, filter }) => this.result({ count: await this.mongo.agentCount(this.requireRead().connectionId, database, collection, filter) }))
    server.registerTool("insert_one", {
      description: "Insert one document into an authorized MongoDB collection.",
      inputSchema: { database: z.string().min(1), collection: z.string().min(1), document: documentSchema },
    }, async ({ database, collection, document }) => this.result(await this.mongo.agentInsertOne(this.requireWrite().connectionId, database, collection, document)))
    server.registerTool("update_one", {
      description: "Update one document matching a non-empty filter in an authorized MongoDB collection.",
      inputSchema: { database: z.string().min(1), collection: z.string().min(1), filter: documentSchema.refine((value) => Object.keys(value).length > 0), update: documentSchema },
    }, async ({ database, collection, filter, update }) => this.result(await this.mongo.agentUpdateOne(this.requireWrite().connectionId, database, collection, filter, update)))
    server.registerTool("delete_one", {
      description: "Delete one document matching a non-empty filter in an authorized MongoDB collection.",
      inputSchema: { database: z.string().min(1), collection: z.string().min(1), filter: documentSchema.refine((value) => Object.keys(value).length > 0) },
    }, async ({ database, collection, filter }) => this.result(await this.mongo.agentDeleteOne(this.requireWrite().connectionId, database, collection, filter)))
    return server
  }

  private requireRead(): AgentGrant {
    return this.requireGrant()
  }

  private requireWrite(): AgentGrant {
    const grant = this.requireGrant()
    if (grant.accessMode === "read-only") throw new Error("The active agent is not permitted to write MongoDB data.")
    return grant
  }

  private requireGrant(): AgentGrant {
    if (!this.grant) throw new Error("No active Mongo Pilot agent grant.")
    return this.grant
  }

  private result(value: unknown) {
    return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] }
  }
}
