import { join } from "node:path"
import { app, BrowserWindow, clipboard, ipcMain, shell } from "electron"
import icon from "../../resources/icon.png?asset"
import type { AggregateInput, CollectionReportInput, CollectionTargetInput, DocumentTargetInput, FindInput, ReplaceDocumentInput, SaveConnectionInput, SchemaAnalysisInput, ShellCompletionInput, ShellEvaluateInput, ShellStartInput, UpdateConnectionSettingsInput, VisualizationGenerateInput, VisualizationRefreshInput } from "../shared/types"
import { ConnectionStore } from "./connection-store"
import { MongoService } from "./mongo-service"
import { MongoMcpServer } from "./mongo-mcp-server"
import { OpencodeService } from "./opencode-service"
import { UpdateService } from "./update-service"

let mongo: MongoService
let copilot: OpencodeService
let updates: UpdateService
const applicationName = "Mongo Pilot"
const applicationDescription = "A MongoDB desktop workspace with an embedded OpenCode copilot."
const applicationAuthor = "Vikings Studio"
const applicationWebsite = "https://github.com/Vikings-Studio/mongopilot"
const minimumWindowSize = { width: 1100, height: 720 }
const userDataPath = join(app.getPath("appData"), "mongo-pilot")

app.setPath("userData", userDataPath)
process.title = applicationName

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: minimumWindowSize.width,
    minHeight: minimumWindowSize.height,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    show: false,
    title: applicationName,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0a0d0a",
    icon,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  window.on("ready-to-show", () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url)
    return { action: "deny" }
  })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, "../renderer/index.html"))
  updates.attachWindow(window)
  return window
}

function registerIpc(store: ConnectionStore): void {
  ipcMain.handle("connections:list", () => store.list())
  ipcMain.handle("connections:save", (_event, input: SaveConnectionInput) => store.save(input))
  ipcMain.handle("connections:updateSettings", (_event, input: UpdateConnectionSettingsInput) => mongo.updateConnectionSettings(input))
  ipcMain.handle("connections:remove", async (_event, id: string) => {
    await mongo.disconnect(id)
    await store.remove(id)
  })
  ipcMain.handle("connections:copyUri", async (_event, id: string) => {
    clipboard.writeText(await store.getUri(id))
  })
  ipcMain.handle("connections:connect", (_event, id: string) => mongo.connect(id))
  ipcMain.handle("connections:disconnect", (_event, id: string) => mongo.disconnect(id))
  ipcMain.handle("database:listCollections", (_event, id: string, database: string) => mongo.listCollections(id, database))
  ipcMain.handle("database:find", (_event, input: FindInput) => mongo.find(input))
  ipcMain.handle("database:aggregate", (_event, input: AggregateInput) => mongo.aggregate(input))
  ipcMain.handle("database:generateVisualization", async (_event, input: VisualizationGenerateInput) => {
    const spec = await copilot.generateVisualization(input)
    return mongo.runVisualization({ ...input, spec })
  })
  ipcMain.handle("database:refreshVisualization", (_event, input: VisualizationRefreshInput) => mongo.runVisualization(input))
  ipcMain.handle("database:listIndexes", (_event, input: CollectionTargetInput) => mongo.listIndexes(input))
  ipcMain.handle("database:analyzeSchema", (_event, input: SchemaAnalysisInput) => mongo.analyzeSchema(input))
  ipcMain.handle("database:generateReport", (_event, input: CollectionReportInput) => mongo.generateReport(input))
  ipcMain.handle("database:replaceDocument", (_event, input: ReplaceDocumentInput) => mongo.replaceDocument(input))
  ipcMain.handle("database:deleteDocument", (_event, input: DocumentTargetInput) => mongo.deleteDocument(input))
  ipcMain.handle("shell:start", (_event, input: ShellStartInput) => mongo.startShell(input))
  ipcMain.handle("shell:evaluate", (_event, input: ShellEvaluateInput) => mongo.evaluateShell(input))
  ipcMain.handle("shell:complete", (_event, input: ShellCompletionInput) => mongo.completeShell(input))
  ipcMain.handle("shell:interrupt", (_event, connectionId: string) => mongo.interruptShell(connectionId))
  ipcMain.handle("shell:close", (_event, connectionId: string) => mongo.closeShell(connectionId))
  ipcMain.handle("copilot:status", () => copilot.status())
  ipcMain.handle("copilot:start", () => copilot.start())
  ipcMain.handle("copilot:stop", () => copilot.stop())
  ipcMain.handle("copilot:models", () => copilot.models())
  ipcMain.handle("copilot:prompt", (_event, input) => copilot.prompt(input))
  ipcMain.handle("updates:status", () => updates.status())
  ipcMain.handle("updates:check", () => updates.check())
  ipcMain.handle("updates:download", () => updates.download())
  ipcMain.handle("updates:install", () => updates.install())
}

void app.whenReady().then(() => {
  app.setAppUserModelId("com.mongopilot.desktop")
  app.setAboutPanelOptions({
    applicationName,
    applicationVersion: app.getVersion(),
    copyright: `Copyright © ${new Date().getFullYear()} ${applicationAuthor}`,
    credits: `${applicationDescription}\n\nBuilt by ${applicationAuthor}.`,
    authors: [applicationAuthor],
    website: applicationWebsite,
    iconPath: icon,
  })
  app.on("browser-window-created", (_event, window) => {
    window.setMinimumSize(minimumWindowSize.width, minimumWindowSize.height)
    window.setResizable(true)
  })
  const store = new ConnectionStore(join(app.getPath("userData"), "connections.json"))
  mongo = new MongoService(store)
  copilot = new OpencodeService(new MongoMcpServer(mongo))
  updates = new UpdateService()
  registerIpc(store)
  createWindow()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("before-quit", () => {
  void mongo?.disconnectAll()
  void copilot.stop()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" || !app.isPackaged) app.quit()
})
