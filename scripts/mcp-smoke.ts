import assert from "node:assert/strict"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { MongoMcpServer, type MongoAgentService } from "../src/main/mongo-mcp-server"

let activeMode: "read-only" | "read-write" = "read-only"
const fakeMongo = {
  getAccessMode: () => activeMode,
  agentListDatabases: async () => [{ name: "verified_database" }],
  agentListCollections: async () => [],
  agentFind: async () => [],
  agentAggregate: async () => [],
  agentCount: async () => 0,
  agentInsertOne: async () => ({ acknowledged: true }),
  agentUpdateOne: async () => ({ acknowledged: true }),
  agentDeleteOne: async () => ({ acknowledged: true }),
} satisfies MongoAgentService

const server = new MongoMcpServer(fakeMongo)
const endpoint = await server.start()
const client = new Client({ name: "mongo-pilot-smoke", version: "0.1.0" })
const transport = new StreamableHTTPClientTransport(new URL(endpoint.url), {
  requestInit: { headers: { Authorization: `Bearer ${endpoint.token}` } },
})

try {
  await client.connect(transport)
  const catalog = await client.listTools()
  assert.equal(catalog.tools.length, 8)

  server.setGrant({ connectionId: "connection-1", accessMode: "read-only" })
  const read = await client.callTool({ name: "list_databases", arguments: {} })
  assert.equal(read.isError, undefined)
  assert.match(JSON.stringify(read.content), /verified_database/)

  const write = await client.callTool({
    name: "insert_one",
    arguments: { database: "db", collection: "items", document: { status: "new" } },
  })
  assert.equal(write.isError, true)

  assert.throws(
    () => server.setGrant({ connectionId: "connection-1", accessMode: "read-write" }),
    /read-only connection/,
  )

  activeMode = "read-write"
  server.setGrant({ connectionId: "connection-1", accessMode: "read-only" })
  assert.equal((await client.callTool({ name: "list_databases", arguments: {} })).isError, undefined)
  const blockedWriteOnReadableConnection = await client.callTool({
    name: "insert_one",
    arguments: { database: "db", collection: "items", document: { status: "new" } },
  })
  assert.equal(blockedWriteOnReadableConnection.isError, true)

  server.setGrant({ connectionId: "connection-1", accessMode: "read-write" })
  assert.equal((await client.callTool({ name: "list_databases", arguments: {} })).isError, undefined)
  assert.equal((await client.callTool({
    name: "insert_one",
    arguments: { database: "db", collection: "items", document: { status: "new" } },
  })).isError, undefined)

  server.clearGrant()
  const ungranted = await client.callTool({ name: "list_databases", arguments: {} })
  assert.equal(ungranted.isError, true)

  const unauthorized = await fetch(endpoint.url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
  assert.equal(unauthorized.status, 401)
  console.log("MongoDB MCP bearer auth and read/read-write enforcement verified.")
} finally {
  await client.close()
  await server.stop()
}
