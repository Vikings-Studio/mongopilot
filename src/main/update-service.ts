import { app, type BrowserWindow } from "electron"
import electronUpdater, { type ProgressInfo, type UpdateInfo } from "electron-updater"
import type { UpdateStatus } from "../shared/types"

const updateCheckIntervalMs = 4 * 60 * 60 * 1_000
const { autoUpdater } = electronUpdater

export class UpdateService {
  private readonly windows = new Set<BrowserWindow>()
  private readonly currentVersion = app.getVersion()
  private currentStatus: UpdateStatus = app.isPackaged
    ? { state: "idle", currentVersion: this.currentVersion }
    : { state: "disabled", currentVersion: this.currentVersion }
  private availableVersion: string | null = null
  private checksScheduled = false

  constructor() {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowDowngrade = false
    autoUpdater.allowPrerelease = false

    autoUpdater.on("checking-for-update", () => {
      this.setStatus({ state: "checking", currentVersion: this.currentVersion })
    })
    autoUpdater.on("update-available", (info: UpdateInfo) => {
      this.availableVersion = info.version
      this.setStatus({ state: "available", currentVersion: this.currentVersion, version: info.version })
    })
    autoUpdater.on("update-not-available", () => {
      this.availableVersion = null
      this.setStatus({ state: "not-available", currentVersion: this.currentVersion })
    })
    autoUpdater.on("download-progress", (progress: ProgressInfo) => {
      if (!this.availableVersion) return
      this.setStatus({
        state: "downloading",
        currentVersion: this.currentVersion,
        version: this.availableVersion,
        percent: Math.min(100, Math.max(0, progress.percent)),
      })
    })
    autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
      this.availableVersion = info.version
      this.setStatus({ state: "downloaded", currentVersion: this.currentVersion, version: info.version })
    })
    autoUpdater.on("error", (error: Error) => {
      this.setStatus({ state: "error", currentVersion: this.currentVersion, message: error.message })
    })
  }

  attachWindow(window: BrowserWindow): void {
    this.windows.add(window)
    window.on("closed", () => this.windows.delete(window))
    window.webContents.once("did-finish-load", () => {
      this.sendStatus(window)
      this.scheduleChecks()
    })
  }

  status(): UpdateStatus {
    return this.currentStatus
  }

  async check(): Promise<UpdateStatus> {
    if (!app.isPackaged) return this.currentStatus
    if (this.currentStatus.state === "checking" || this.currentStatus.state === "downloading") return this.currentStatus
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      this.setStatus({ state: "error", currentVersion: this.currentVersion, message: this.message(error) })
    }
    return this.currentStatus
  }

  async download(): Promise<UpdateStatus> {
    if (this.currentStatus.state !== "available") return this.currentStatus
    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      this.setStatus({ state: "error", currentVersion: this.currentVersion, message: this.message(error) })
    }
    return this.currentStatus
  }

  install(): void {
    if (this.currentStatus.state !== "downloaded") return
    autoUpdater.quitAndInstall(false, true)
  }

  private scheduleChecks(): void {
    if (this.checksScheduled || !app.isPackaged) return
    this.checksScheduled = true
    const initial = setTimeout(() => void this.check(), 5_000)
    const recurring = setInterval(() => void this.check(), updateCheckIntervalMs)
    initial.unref()
    recurring.unref()
  }

  private setStatus(status: UpdateStatus): void {
    this.currentStatus = status
    for (const window of this.windows) this.sendStatus(window)
  }

  private sendStatus(window: BrowserWindow): void {
    if (!window.isDestroyed()) window.webContents.send("updates:status-changed", this.currentStatus)
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : "The update operation failed."
  }
}
