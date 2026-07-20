const internalDatabases = new Set(["admin", "config", "local"])

export function isVisibleDatabase(name: string): boolean {
  return !internalDatabases.has(name)
}

export function isVisibleCollection(name: string): boolean {
  return name !== "oplog.rs" && !name.startsWith("system.")
}
