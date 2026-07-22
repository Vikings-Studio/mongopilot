import { randomBytes } from "node:crypto"
import { spawn, type ChildProcess } from "node:child_process"
import { join } from "node:path"
import { app } from "electron"
import { createOpencodeClient, type Config, type OpencodeClient } from "@opencode-ai/sdk/v2"
import type { CopilotModelsResult, CopilotPromptInput, CopilotReply, CopilotStatus, VisualizationGenerateInput, VisualizationSpec } from "../shared/types"
import type { MongoMcpServer } from "./mongo-mcp-server"
import { parseVisualizationReply } from "./visualization-spec"
import { writeMcpTimeoutMs } from "./write-timeouts"

const mongoReadTools = ["mongo_list_databases", "mongo_list_collections", "mongo_find", "mongo_aggregate", "mongo_count"] as const
const mongoWriteTools = ["mongo_insert_one", "mongo_update_one", "mongo_delete_one"] as const

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export class OpencodeService {
  private client?: OpencodeClient
  private closeServer?: () => void
  private serverProcess?: ChildProcess
  private sessionId?: string
  private currentStatus: CopilotStatus = { state: "stopped" }
  private startPromise?: Promise<CopilotStatus>
  private startPromiseVersion?: number
  private stopPromise?: Promise<CopilotStatus>
  private promptInFlight = false
  private lifecycleVersion = 0
  private startingProcess?: ChildProcess

  constructor(private readonly mongoMcp: MongoMcpServer) {}

  status(): CopilotStatus {
    return this.currentStatus
  }

  start(): Promise<CopilotStatus> {
    const lifecycleVersion = this.lifecycleVersion
    if (this.startPromise !== undefined && this.startPromiseVersion === lifecycleVersion) return this.startPromise
    const pendingStop = this.stopPromise
    const promise = (async () => {
      await pendingStop
      if (lifecycleVersion !== this.lifecycleVersion) return this.currentStatus
      if (this.client) {
        const healthy = await withTimeout(
          this.client.global.health(),
          3_000,
          "OpenCode health check timed out.",
        ).then((result) => result.data?.healthy === true).catch(() => false)
        if (lifecycleVersion !== this.lifecycleVersion) return this.currentStatus
        if (healthy) return this.currentStatus
        const staleProcess = this.serverProcess
        this.lifecycleVersion += 1
        const replacementVersion = this.lifecycleVersion
        this.startPromiseVersion = replacementVersion
        this.mongoMcp.clearGrant()
        this.invalidateServer("OpenCode stopped responding and will restart.")
        if (staleProcess) {
          this.startingProcess = staleProcess
          await this.terminateProcess(staleProcess)
          if (this.startingProcess === staleProcess) this.startingProcess = undefined
        }
        return await this.startServer(replacementVersion)
      }
      return await this.startServer(lifecycleVersion)
    })()
    this.startPromise = promise
    this.startPromiseVersion = lifecycleVersion
    const clearStart = () => {
      if (this.startPromise === promise) {
        this.startPromise = undefined
        this.startPromiseVersion = undefined
      }
    }
    void promise.then(clearStart, clearStart)
    return promise
  }

  private async startServer(lifecycleVersion: number): Promise<CopilotStatus> {
    let server: { url: string; processHandle: ChildProcess; close(): void } | undefined
    this.currentStatus = { state: "starting" }
    try {
      const lingeringProcess = this.startingProcess
      if (lingeringProcess) {
        await this.terminateProcess(lingeringProcess)
        if (this.startingProcess === lingeringProcess) this.startingProcess = undefined
      }
      const username = "mongo-pilot"
      const password = randomBytes(32).toString("base64url")
      process.env.OPENCODE_SERVER_USERNAME = username
      process.env.OPENCODE_SERVER_PASSWORD = password
      const mongoMcp = await this.mongoMcp.start()
      if (lifecycleVersion !== this.lifecycleVersion) return this.currentStatus
      server = await this.launchServer({
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
              timeout: writeMcpTimeoutMs,
            },
          },
      }, lifecycleVersion)
      if (lifecycleVersion !== this.lifecycleVersion) {
        await this.terminateProcess(server.processHandle)
        return this.currentStatus
      }
      const client = createOpencodeClient({
        baseUrl: server.url,
        throwOnError: true,
        headers: {
          Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        },
      })
      const activeServer = server
      this.client = client
      this.closeServer = () => activeServer.close()
      this.serverProcess = activeServer.processHandle
      activeServer.processHandle.once("exit", (code) => {
        if (this.serverProcess !== activeServer.processHandle) return
        this.lifecycleVersion += 1
        this.mongoMcp.clearGrant()
        this.client = undefined
        this.closeServer = undefined
        this.serverProcess = undefined
        if (this.startingProcess === activeServer.processHandle) this.startingProcess = undefined
        this.sessionId = undefined
        this.currentStatus = { state: "error", message: `OpenCode exited${code === null ? "" : ` with code ${code}`}. It will restart on the next request.` }
      })
      const health = await withTimeout(client.global.health(), 5_000, "OpenCode startup health check timed out.")
      if (!health.data?.healthy) throw new Error("OpenCode server health check failed.")
      if (lifecycleVersion !== this.lifecycleVersion) {
        await this.terminateProcess(server.processHandle)
        return this.currentStatus
      }
      if (this.startingProcess === activeServer.processHandle) this.startingProcess = undefined
      this.currentStatus = { state: "ready", version: health.data?.version }
    } catch (error) {
      if (server) {
        if (this.serverProcess === server.processHandle) {
          this.client = undefined
          this.closeServer = undefined
          this.serverProcess = undefined
        }
        await this.terminateProcess(server.processHandle)
        if (this.startingProcess === server.processHandle) this.startingProcess = undefined
      }
      if (lifecycleVersion !== this.lifecycleVersion) return this.currentStatus
      this.invalidateServer(this.message(error))
      await this.mongoMcp.stop()
      this.currentStatus = { state: "error", message: this.message(error) }
    }
    return this.currentStatus
  }

  stop(): Promise<CopilotStatus> {
    if (this.stopPromise !== undefined) return this.stopPromise
    const promise = this.stopServer()
    this.stopPromise = promise
    const clearStop = () => {
      if (this.stopPromise === promise) this.stopPromise = undefined
    }
    void promise.then(clearStop, clearStop)
    return promise
  }

  private async stopServer(): Promise<CopilotStatus> {
    this.lifecycleVersion += 1
    const client = this.client
    const sessionId = this.sessionId
    const closeServer = this.closeServer
    const startingProcess = this.startingProcess
    const serverProcess = this.serverProcess
    this.client = undefined
    this.sessionId = undefined
    this.serverProcess = undefined
    this.closeServer = undefined
    this.startingProcess = startingProcess ?? serverProcess
    this.mongoMcp.clearGrant()
    if (sessionId && client) {
      await withTimeout(client.session.abort({ sessionID: sessionId }), 1_000, "OpenCode session abort timed out.").catch(() => undefined)
    }
    closeServer?.()
    await Promise.all([
      startingProcess ? this.terminateProcess(startingProcess) : undefined,
      serverProcess && serverProcess !== startingProcess ? this.terminateProcess(serverProcess) : undefined,
    ])
    if (this.startingProcess === startingProcess || this.startingProcess === serverProcess) this.startingProcess = undefined
    await this.mongoMcp.stop()
    this.currentStatus = { state: "stopped" }
    return this.currentStatus
  }

  async models(): Promise<CopilotModelsResult> {
    const status = await this.start()
    if (status.state !== "ready") throw new Error(status.state === "error" ? status.message : "OpenCode is not ready.")
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
        reasoningLevels: model.capabilities.reasoning ? Object.keys(model.variants ?? {}) : [],
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
    this.promptInFlight = true
    try {
      return await this.executePrompt(input)
    } finally {
      this.mongoMcp.clearGrant()
      this.promptInFlight = false
    }
  }

  private async executePrompt(input: CopilotPromptInput): Promise<CopilotReply> {
    const status = await this.start()
    if (status.state !== "ready") throw new Error(status.state === "error" ? status.message : "OpenCode is not ready.")
    const lifecycleVersion = this.lifecycleVersion
    const client = this.client
    if (!client) throw new Error("OpenCode client is unavailable after startup.")
    if (!this.sessionId) {
      const created = await client.session.create({ title: "Mongo Pilot copilot" })
      this.assertActiveRequest(lifecycleVersion)
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
    if (connectionId && mode) this.mongoMcp.setGrant({ connectionId, accessMode: mode })
    this.assertActiveRequest(lifecycleVersion)
    const result = await client.session.prompt({
      sessionID: this.sessionId,
      system,
      tools,
      model: input.model,
      variant: input.variant,
      parts: [{ type: "text", text: input.text }],
    })
    this.assertActiveRequest(lifecycleVersion)
    const text = (result.data?.parts ?? [])
      .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("\n")
    return { text: text || "OpenCode returned no text response.", sessionId: this.sessionId }
  }

  async generateVisualization(input: VisualizationGenerateInput): Promise<VisualizationSpec> {
    if (input.prompt.trim().length === 0) throw new Error("Describe the visualization you want.")
    if (input.prompt.length > 4_000) throw new Error("Visualization prompts must be 4,000 characters or shorter.")
    if (this.promptInFlight) throw new Error("Wait for the current Pilot request to finish.")
    this.promptInFlight = true
    try {
      return await this.executeVisualization(input)
    } finally {
      this.mongoMcp.clearGrant()
      this.promptInFlight = false
    }
  }

  private async executeVisualization(input: VisualizationGenerateInput): Promise<VisualizationSpec> {
    const status = await this.start()
    if (status.state !== "ready") throw new Error(status.state === "error" ? status.message : "OpenCode is not ready.")
    const lifecycleVersion = this.lifecycleVersion
    const client = this.client
    if (!client) throw new Error("OpenCode client is unavailable after startup.")
    const created = await client.session.create({ title: `Visualize ${input.database}.${input.collection}` })
    this.assertActiveRequest(lifecycleVersion)
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
    this.mongoMcp.setGrant({ connectionId: input.connectionId, accessMode: "read-only" })
    this.assertActiveRequest(lifecycleVersion)
    const result = await client.session.prompt({
      sessionID: created.data.id,
      system,
      tools,
      model: input.model,
      parts: [{ type: "text", text: input.prompt.trim() }],
    })
    this.assertActiveRequest(lifecycleVersion)
    const text = (result.data?.parts ?? [])
      .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("\n")
    return parseVisualizationReply(text)
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : "OpenCode failed to start."
  }

  private assertActiveRequest(lifecycleVersion: number): void {
    if (lifecycleVersion !== this.lifecycleVersion) throw new Error("Pilot request was cancelled because OpenCode stopped.")
  }

  private invalidateServer(message: string): void {
    const closeServer = this.closeServer
    this.serverProcess = undefined
    this.closeServer = undefined
    this.client = undefined
    this.sessionId = undefined
    closeServer?.()
    this.currentStatus = { state: "error", message }
  }

  private async launchServer(config: Config, lifecycleVersion: number): Promise<{ url: string; processHandle: ChildProcess; close(): void }> {
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
    if (lifecycleVersion !== this.lifecycleVersion) {
      await this.terminateProcess(processHandle)
      if (this.startingProcess === processHandle) this.startingProcess = undefined
      throw new Error("OpenCode startup was cancelled.")
    }
    this.startingProcess = processHandle
    let url: string
    try {
      url = await this.waitForServer(processHandle)
    } catch (error) {
      await this.terminateProcess(processHandle)
      if (this.startingProcess === processHandle) this.startingProcess = undefined
      throw error
    }
    if (lifecycleVersion !== this.lifecycleVersion) {
      processHandle.kill()
      throw new Error("OpenCode startup was cancelled.")
    }
    return { url, processHandle, close: () => processHandle.kill() }
  }

  private async terminateProcess(processHandle: ChildProcess): Promise<void> {
    if (processHandle.exitCode !== null || processHandle.signalCode !== null) return
    const exited = new Promise<void>((resolve) => processHandle.once("exit", () => resolve()))
    const signaled = processHandle.kill()
    if (!signaled && processHandle.exitCode === null && processHandle.signalCode === null) {
      throw new Error("OpenCode could not be stopped.")
    }
    const stopped = await Promise.race([
      exited.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000)),
    ])
    if (stopped || processHandle.exitCode !== null || processHandle.signalCode !== null) return
    const killed = processHandle.kill("SIGKILL")
    if (!killed && processHandle.exitCode === null && processHandle.signalCode === null) {
      throw new Error("OpenCode could not be force-stopped.")
    }
    const forceStopped = await Promise.race([
      exited.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000)),
    ])
    if (!forceStopped && processHandle.exitCode === null && processHandle.signalCode === null) {
      throw new Error("OpenCode did not exit after SIGKILL.")
    }
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
