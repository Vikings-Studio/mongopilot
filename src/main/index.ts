import { join } from "node:path"
import { app, BrowserWindow, clipboard, ipcMain, shell } from "electron"
import icon from "../../resources/icon.png?asset"
import type { DocumentTargetInput, FindInput, ReplaceDocumentInput, SaveConnectionInput } from "../shared/types"
import { ConnectionStore } from "./connection-store"
import { MongoService } from "./mongo-service"
import { MongoMcpServer } from "./mongo-mcp-server"
import { OpencodeService } from "./opencode-service"

let mongo: MongoService
let copilot: OpencodeService
const minimumWindowSize = { width: 1100, height: 720 }

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: minimumWindowSize.width,
    minHeight: minimumWindowSize.height,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    show: false,
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
}

function registerIpc(store: ConnectionStore): void {
  ipcMain.handle("connections:list", () => store.list())
  ipcMain.handle("connections:save", (_event, input: SaveConnectionInput) => store.save(input))
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
  ipcMain.handle("database:replaceDocument", (_event, input: ReplaceDocumentInput) => mongo.replaceDocument(input))
  ipcMain.handle("database:deleteDocument", (_event, input: DocumentTargetInput) => mongo.deleteDocument(input))
  ipcMain.handle("copilot:status", () => copilot.status())
  ipcMain.handle("copilot:start", () => copilot.start())
  ipcMain.handle("copilot:stop", () => copilot.stop())
  ipcMain.handle("copilot:models", () => copilot.models())
  ipcMain.handle("copilot:prompt", (_event, input) => copilot.prompt(input))
}

void app.whenReady().then(() => {
  app.setAppUserModelId("com.mongopilot.desktop")
  if (process.platform === "darwin") app.dock?.setIcon(icon)
  app.on("browser-window-created", (_event, window) => {
    window.setMinimumSize(minimumWindowSize.width, minimumWindowSize.height)
    window.setResizable(true)
  })
  const store = new ConnectionStore(join(app.getPath("userData"), "connections.json"))
  mongo = new MongoService(store)
  copilot = new OpencodeService(new MongoMcpServer(mongo))
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
  if (process.platform !== "darwin") app.quit()
})
