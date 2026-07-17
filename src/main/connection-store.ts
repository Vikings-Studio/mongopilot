import { randomUUID } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { mkdir } from "node:fs/promises"
import { safeStorage } from "electron"
import type { SaveConnectionInput, SavedConnection } from "../shared/types"

interface StoredConnection extends SavedConnection {
  encryptedUri: string
}

type PersistedConnection = Omit<StoredConnection, "accessMode"> & {
  accessMode: SavedConnection["accessMode"] | "write-only"
}

export class ConnectionStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<SavedConnection[]> {
    return (await this.read()).map(({ encryptedUri: _encryptedUri, ...connection }) => connection)
  }

  async save(input: SaveConnectionInput): Promise<SavedConnection> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure credential storage is unavailable on this system.")
    }

    const records = await this.read()
    const existing = input.id ? records.find((item) => item.id === input.id) : undefined
    const record: StoredConnection = {
      id: existing?.id ?? randomUUID(),
      name: input.name.trim(),
      host: this.hostFromUri(input.uri),
      accessMode: input.accessMode,
      favorite: input.favorite,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      lastConnectedAt: existing?.lastConnectedAt,
      encryptedUri: safeStorage.encryptString(input.uri).toString("base64"),
    }
    const next = existing
      ? records.map((item) => (item.id === existing.id ? record : item))
      : [...records, record]
    await this.write(next)
    const { encryptedUri: _encryptedUri, ...saved } = record
    return saved
  }

  async remove(id: string): Promise<void> {
    await this.write((await this.read()).filter((item) => item.id !== id))
  }

  async getUri(id: string): Promise<string> {
    const record = (await this.read()).find((item) => item.id === id)
    if (!record) throw new Error("Saved connection not found.")
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable.")
    return safeStorage.decryptString(Buffer.from(record.encryptedUri, "base64"))
  }

  async markConnected(id: string): Promise<SavedConnection> {
    const records = await this.read()
    const target = records.find((item) => item.id === id)
    if (!target) throw new Error("Saved connection not found.")
    target.lastConnectedAt = new Date().toISOString()
    await this.write(records)
    const { encryptedUri: _encryptedUri, ...connection } = target
    return connection
  }

  private hostFromUri(uri: string): string {
    const withoutProtocol = uri.replace(/^mongodb(?:\+srv)?:\/\//, "")
    const authority = withoutProtocol.split("/")[0] ?? "MongoDB deployment"
    return authority.includes("@") ? (authority.split("@").at(-1) ?? authority) : authority
  }

  private async read(): Promise<StoredConnection[]> {
    try {
      const records = JSON.parse(await readFile(this.filePath, "utf8")) as PersistedConnection[]
      return records.map((record) => ({
        ...record,
        accessMode: record.accessMode === "write-only" ? "read-write" : record.accessMode,
      }))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
      throw error
    }
  }

  private async write(records: StoredConnection[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(records, null, 2), { mode: 0o600 })
  }
}
