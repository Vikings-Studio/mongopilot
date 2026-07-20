export type BsonDisplayKind = "id" | "date" | "number" | "binary" | "regex" | "special"
export type DateDisplayMode = "database" | "local"

export interface BsonDisplay {
  kind: BsonDisplayKind
  text: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => key in value)
}

function quote(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`
}

function formatDate(value: Date, mode: DateDisplayMode): string {
  return mode === "local" ? value.toLocaleString() : value.toISOString().replace(/Z$/, "+00:00")
}

function nestedDisplay(value: unknown, dateMode: DateDisplayMode): string {
  return getBsonDisplay(value, dateMode)?.text ?? JSON.stringify(value)
}

export function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

export function getBsonDisplay(value: unknown, dateMode: DateDisplayMode = "database"): BsonDisplay | null {
  if (!isRecord(value)) return null

  if (hasOnlyKeys(value, ["$oid"]) && typeof value.$oid === "string") {
    return { kind: "id", text: `ObjectId(${quote(value.$oid)})` }
  }

  if (hasOnlyKeys(value, ["$date"])) {
    const milliseconds = isRecord(value.$date) && typeof value.$date.$numberLong === "string"
      ? value.$date.$numberLong
      : null
    const date = typeof value.$date === "string" ? new Date(value.$date) : milliseconds === null ? null : new Date(Number(milliseconds))
    if (date && !Number.isNaN(date.valueOf())) {
      return { kind: "date", text: formatDate(date, dateMode) }
    }
    return { kind: "date", text: milliseconds === null ? "Invalid Date" : `Date(${quote(milliseconds)})` }
  }

  if (hasOnlyKeys(value, ["$numberInt"]) && typeof value.$numberInt === "string") {
    return { kind: "number", text: value.$numberInt }
  }
  if (hasOnlyKeys(value, ["$numberLong"]) && typeof value.$numberLong === "string") {
    return { kind: "number", text: `Long(${quote(value.$numberLong)})` }
  }
  if (hasOnlyKeys(value, ["$numberDouble"]) && typeof value.$numberDouble === "string") {
    const finite = Number(value.$numberDouble)
    return { kind: "number", text: Number.isFinite(finite) ? value.$numberDouble : `Double(${quote(value.$numberDouble)})` }
  }
  if (hasOnlyKeys(value, ["$numberDecimal"]) && typeof value.$numberDecimal === "string") {
    return { kind: "number", text: `Decimal128(${quote(value.$numberDecimal)})` }
  }

  if (hasOnlyKeys(value, ["$binary"]) && isRecord(value.$binary) && typeof value.$binary.base64 === "string" && typeof value.$binary.subType === "string") {
    return { kind: "binary", text: `Binary(${quote(value.$binary.base64)}, ${quote(value.$binary.subType)})` }
  }
  if (hasOnlyKeys(value, ["$timestamp"]) && isRecord(value.$timestamp) && typeof value.$timestamp.t === "number" && typeof value.$timestamp.i === "number") {
    return { kind: "date", text: `Timestamp({ t: ${value.$timestamp.t}, i: ${value.$timestamp.i} })` }
  }
  if (hasOnlyKeys(value, ["$regularExpression"]) && isRecord(value.$regularExpression) && typeof value.$regularExpression.pattern === "string" && typeof value.$regularExpression.options === "string") {
    const pattern = value.$regularExpression.pattern.replaceAll("/", "\\/")
    return { kind: "regex", text: `/${pattern}/${value.$regularExpression.options}` }
  }

  if (hasOnlyKeys(value, ["$minKey"]) && value.$minKey === 1) return { kind: "special", text: "MinKey()" }
  if (hasOnlyKeys(value, ["$maxKey"]) && value.$maxKey === 1) return { kind: "special", text: "MaxKey()" }
  if (hasOnlyKeys(value, ["$undefined"]) && value.$undefined === true) return { kind: "special", text: "undefined" }
  if (hasOnlyKeys(value, ["$symbol"]) && typeof value.$symbol === "string") return { kind: "special", text: `Symbol(${quote(value.$symbol)})` }

  const codeKeys = "$scope" in value ? ["$code", "$scope"] : ["$code"]
  if (hasOnlyKeys(value, codeKeys) && typeof value.$code === "string") {
    const scope = "$scope" in value ? `, ${JSON.stringify(value.$scope)}` : ""
    return { kind: "special", text: `Code(${quote(value.$code)}${scope})` }
  }

  const dbRefKeys = "$db" in value ? ["$ref", "$id", "$db"] : ["$ref", "$id"]
  if (hasOnlyKeys(value, dbRefKeys) && typeof value.$ref === "string") {
    const database = typeof value.$db === "string" ? `, ${quote(value.$db)}` : ""
    return { kind: "id", text: `DBRef(${quote(value.$ref)}, ${nestedDisplay(value.$id, dateMode)}${database})` }
  }

  return null
}
