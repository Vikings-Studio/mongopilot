import { randomBytes } from "node:crypto"
import { spawn, type ChildProcess } from "node:child_process"
import { join } from "node:path"
import { app } from "electron"
import { createOpencodeClient, type Config, type OpencodeClient } from "@opencode-ai/sdk/v2"
import type { CopilotModelsResult, CopilotPromptInput, CopilotReply, CopilotStatus, VisualizationGenerateInput, VisualizationSpec } from "../shared/types"
import type { MongoMcpServer } from "./mongo-mcp-server"
import { parseVisualizationReply } from "./visualization-spec"

const mongoReadTools = ["mongo_list_databases", "mongo_list_collections", "mongo_find", "mongo_aggregate", "mongo_count"] as const
const mongoWriteTools = ["mongo_insert_one", "mongo_update_one", "mongo_delete_one"] as const

export class OpencodeService {
  private client?: OpencodeClient
  private closeServer?: () => void
  private sessionId?: string
  private currentStatus: CopilotStatus = { state: "stopped" }
  private startPromise?: Promise<CopilotStatus>
  private promptInFlight = false

  constructor(private readonly mongoMcp: MongoMcpServer) {}

  status(): CopilotStatus {
    return this.currentStatus
  }

  async start(): Promise<CopilotStatus> {
    if (this.client) return this.currentStatus
    if (this.startPromise !== undefined) return this.startPromise
    this.startPromise = this.startServer()
    try {
      return await this.startPromise
    } finally {
      this.startPromise = undefined
    }
  }

  private async startServer(): Promise<CopilotStatus> {
    this.currentStatus = { state: "starting" }
    try {
      const username = "mongo-pilot"
      const password = randomBytes(32).toString("base64url")
      process.env.OPENCODE_SERVER_USERNAME = username
      process.env.OPENCODE_SERVER_PASSWORD = password
      const mongoMcp = await this.mongoMcp.start()
      const server = await this.launchServer({
          permission: {
            "*": "deny",
            question: "allow",
            webfetch: "ask",
            websearch: "ask",
          },
          mcp: {
            mongo: {
              type: "remote",
              url: mongoMcp.url,
              headers: { Authorization: `Bearer ${mongoMcp.token}` },
              oauth: false,
              enabled: true,
              timeout: 30_000,
            },
          },
      })
      this.client = createOpencodeClient({
        baseUrl: server.url,
        throwOnError: true,
        headers: {
          Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        },
      })
      this.closeServer = () => server.close()
      const health = await this.client.global.health()
      if (!health.data?.healthy) throw new Error("OpenCode server health check failed.")
      this.currentStatus = { state: "ready", version: health.data?.version }
    } catch (error) {
      this.closeServer?.()
      this.client = undefined
      this.closeServer = undefined
      this.currentStatus = { state: "error", message: this.message(error) }
    }
    return this.currentStatus
  }

  async stop(): Promise<CopilotStatus> {
    if (this.sessionId && this.client) {
      await this.client.session.abort({ sessionID: this.sessionId }).catch(() => undefined)
    }
    this.closeServer?.()
    this.client = undefined
    this.closeServer = undefined
    this.sessionId = undefined
    this.mongoMcp.clearGrant()
    await this.mongoMcp.stop()
    this.currentStatus = { state: "stopped" }
    return this.currentStatus
  }

  async models(): Promise<CopilotModelsResult> {
    if (!this.client) {
      const status = await this.start()
      if (status.state !== "ready") throw new Error(status.state === "error" ? status.message : "OpenCode is not ready.")
    }
    const client = this.client
    if (!client) throw new Error("OpenCode client is unavailable after startup.")
    const [providersResult, configResult] = await Promise.all([
      client.config.providers(),
      client.config.get(),
    ])
    const providerData = providersResult.data
    if (!providerData) throw new Error("OpenCode returned no model providers.")
    const models = providerData.providers
      .flatMap((provider) => Object.values(provider.models).map((model) => ({
        providerID: provider.id,
        modelID: model.id,
        providerName: provider.name,
        name: model.name,
        family: model.family,
        supportsTools: model.capabilities.toolcall,
        contextLimit: model.limit.context,
        status: model.status,
      })))
      .filter((model) => model.status !== "deprecated")
      .sort((left, right) => left.providerName.localeCompare(right.providerName) || left.name.localeCompare(right.name))

    const configuredModel = configResult.data?.model
    const separator = configuredModel?.indexOf("/") ?? -1
    const configuredDefault = configuredModel && separator > 0
      ? { providerID: configuredModel.slice(0, separator), modelID: configuredModel.slice(separator + 1) }
      : undefined
    const fallbackProvider = providerData.providers.find((provider) => {
      const modelID = providerData.default[provider.id]
      return Boolean(modelID && provider.models[modelID])
    })
    const fallbackModelID = fallbackProvider ? providerData.default[fallbackProvider.id] : undefined
    const defaultModel = configuredDefault ?? (fallbackProvider && fallbackModelID
      ? { providerID: fallbackProvider.id, modelID: fallbackModelID }
      : undefined)
    return { models, defaultModel }
  }

  async prompt(input: CopilotPromptInput): Promise<CopilotReply> {
    if (this.promptInFlight) throw new Error("Wait for the current Pilot request to finish.")
    if (!this.client) {
      const status = await this.start()
      if (status.state !== "ready") throw new Error(status.state === "error" ? status.message : "OpenCode is not ready.")
    }
    const client = this.client
    if (!client) throw new Error("OpenCode client is unavailable after startup.")
    if (!this.sessionId) {
      const created = await client.session.create({ title: "Mongo Pilot copilot" })
      if (!created.data) throw new Error("OpenCode did not create a session.")
      this.sessionId = created.data.id
    }
    const context = input.context
    const connectionId = context?.connectionId
    const mode = context?.agentAccessMode
    const hasMongoGrant = Boolean(connectionId && mode)
    const savedConnections = context?.availableConnections ?? []
    const savedConnectionContext = savedConnections.length
      ? `Saved connections available: ${savedConnections.map((connection) => `${connection.name} (${connection.host}, environment: ${connection.environment}, connection safety: ${connection.connectionAccessMode}, maximum agent access: ${connection.agentAccessMode}${connection.favorite ? ", favorite" : ""})`).join("; ")}.`
      : "There are no saved MongoDB connections."
    const system = [
      "You are the copilot inside Mongo Pilot, a MongoDB desktop application.",
      "Be concise and explicit about uncertainty.",
      hasMongoGrant
        ? "Use the mongo_* tools when the user asks you to inspect or change the active database. Never exceed the granted access mode."
        : `No live MongoDB connection is attached. Never claim that you ran a query or changed data. ${savedConnectionContext} You may answer questions about this saved connection metadata and should ask the user to select a connection before inspecting its data.`,
      hasMongoGrant && mode === "read-write" ? "Every write tool pauses for explicit user approval. After approval, continue the task and report the actual tool result. If approval is denied, say that the write was cancelled." : "",
      context?.agentAccessMode ? `The active agent access mode is ${context.agentAccessMode}. Respect it for every tool call.` : "",
      context?.connectionName ? `Active connection: ${context.connectionName}.` : "",
      context?.connectionHost ? `Active host: ${context.connectionHost}.` : "",
      context?.connectionEnvironment ? `Active environment label: ${context.connectionEnvironment}.` : "",
      context?.connectionAccessMode ? `Active connection safety mode: ${context.connectionAccessMode}.` : "",
      context?.database ? `Active database: ${context.database}.` : "",
      context?.collection ? `Active collection: ${context.collection}.` : "",
    ].filter(Boolean).join("\n")
    const tools = Object.fromEntries([
      ...mongoReadTools.map((tool) => [tool, hasMongoGrant] as const),
      ...mongoWriteTools.map((tool) => [tool, Boolean(hasMongoGrant && mode !== "read-only")] as const),
    ])
    this.promptInFlight = true
    try {
      if (connectionId && mode) this.mongoMcp.setGrant({ connectionId, accessMode: mode })
      const result = await client.session.prompt({
        sessionID: this.sessionId,
        system,
        tools,
        model: input.model,
        parts: [{ type: "text", text: input.text }],
      })
      const text = (result.data?.parts ?? [])
        .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join("\n")
      return { text: text || "OpenCode returned no text response.", sessionId: this.sessionId }
    } finally {
      this.mongoMcp.clearGrant()
      this.promptInFlight = false
    }
  }

  async generateVisualization(input: VisualizationGenerateInput): Promise<VisualizationSpec> {
    if (input.prompt.trim().length === 0) throw new Error("Describe the visualization you want.")
    if (input.prompt.length > 4_000) throw new Error("Visualization prompts must be 4,000 characters or shorter.")
    if (this.promptInFlight) throw new Error("Wait for the current Pilot request to finish.")
    if (!this.client) {
      const status = await this.start()
      if (status.state !== "ready") throw new Error(status.state === "error" ? status.message : "OpenCode is not ready.")
    }
    const client = this.client
    if (!client) throw new Error("OpenCode client is unavailable after startup.")
    const created = await client.session.create({ title: `Visualize ${input.database}.${input.collection}` })
    if (!created.data) throw new Error("OpenCode did not create a visualization session.")
    const system = [
      "You create safe, declarative MongoDB visualizations for Mongo Pilot.",
      `The active collection is ${input.database}.${input.collection}.`,
      "Use read-only mongo tools to inspect a small sample when needed. Never use or suggest writes.",
      "Return exactly one JSON object and no markdown or commentary.",
      'The object must have this shape: {"title":"...","description":"...","chartType":"bar|line|area|pie|scatter|table","pipeline":[...],"categoryField":"flatOutputField","series":[{"field":"flatNumericOutputField","label":"..."}]}.',
      "Use a read-only aggregation pipeline with at most 30 stages. Never use $out, $merge, $function, or server-side JavaScript.",
      "Project flat output fields. Convert plotted values to finite numbers. Return at most useful grouped data; Mongo Pilot applies a final limit of 100 rows.",
      "Use table only when the request cannot be represented honestly as a chart. Pie charts must have exactly one series. Other charts may have up to four series.",
    ].join("\n")
    const tools = Object.fromEntries([
      ...mongoReadTools.map((tool) => [tool, true] as const),
      ...mongoWriteTools.map((tool) => [tool, false] as const),
    ])
    this.promptInFlight = true
    try {
      this.mongoMcp.setGrant({ connectionId: input.connectionId, accessMode: "read-only" })
      const result = await client.session.prompt({
        sessionID: created.data.id,
        system,
        tools,
        model: input.model,
        parts: [{ type: "text", text: input.prompt.trim() }],
      })
      const text = (result.data?.parts ?? [])
        .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join("\n")
      return parseVisualizationReply(text)
    } finally {
      this.mongoMcp.clearGrant()
      this.promptInFlight = false
    }
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : "OpenCode failed to start."
  }

  private async launchServer(config: Config): Promise<{ url: string; close(): void }> {
    const executable = app.isPackaged
      ? join(
          process.resourcesPath,
          "opencode",
          process.platform === "win32" ? "opencode.exe" : process.platform === "darwin" ? `opencode-${process.arch}` : "opencode",
        )
      : join(app.getAppPath(), "node_modules", "opencode-ai", "bin", "opencode.exe")
    const processHandle = spawn(executable, ["serve", "--hostname=127.0.0.1", "--port=0"], {
      env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const url = await this.waitForServer(processHandle)
    return { url, close: () => processHandle.kill() }
  }

  private waitForServer(processHandle: ChildProcess): Promise<string> {
    return new Promise((resolve, reject) => {
      let output = ""
      let settled = false
      const timeout = setTimeout(() => fail(new Error(`OpenCode did not start within 30 seconds.${output.trim() ? `\n${output.trim()}` : ""}`)), 30_000)
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        processHandle.kill()
        reject(error)
      }
      const inspect = (chunk: Buffer) => {
        output += chunk.toString()
        const match = output.match(/opencode server listening on (https?:\/\/[^\s]+)/)
        if (!match || settled) return
        const url = match[1]
        if (!url) return
        settled = true
        clearTimeout(timeout)
        resolve(url)
      }
      processHandle.stdout?.on("data", inspect)
      processHandle.stderr?.on("data", inspect)
      processHandle.once("error", fail)
      processHandle.once("exit", (code) => fail(new Error(`OpenCode exited with code ${code}.${output.trim() ? `\n${output.trim()}` : ""}`)))
    })
  }
}
