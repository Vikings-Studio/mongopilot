import { BSON, ObjectId, type Document } from "mongodb"

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function objectIdHex(value: unknown): string | null {
  if (value instanceof ObjectId) return value.toHexString()
  if (!isRecord(value) || value._bsontype !== "ObjectId" || typeof value.toHexString !== "function") return null
  const hex = value.toHexString.call(value)
  return typeof hex === "string" && /^[0-9a-f]{24}$/i.test(hex) ? hex.toLowerCase() : null
}

export function parseExtendedJson(text: string): unknown {
  return BSON.EJSON.parse(text)
}

export function stringifyCanonicalExtendedJson(value: unknown): string {
  const objectId = objectIdHex(value)
  if (objectId) return JSON.stringify({ $oid: objectId })
  return BSON.EJSON.stringify(value, { relaxed: false })
}

export function serializeBson(value: unknown): unknown {
  return JSON.parse(stringifyCanonicalExtendedJson(value)) as unknown
}

export function serializeBsonArray(values: readonly unknown[]): unknown[] {
  const serialized = serializeBson(values)
  if (!Array.isArray(serialized)) throw new Error("BSON array serialization returned an invalid result.")
  return serialized
}

export function serializeMongoDocument(document: Document): unknown {
  return JSON.parse(stringifyMongoDocument(document)) as unknown
}

export function stringifyMongoDocument(document: Document): string {
  const objectId = objectIdHex(document._id)
  const source = objectId ? { ...document, _id: { $oid: objectId } } : document
  const serialized = stringifyCanonicalExtendedJson(source)
  const parsed = JSON.parse(serialized) as unknown
  if (!isRecord(parsed) || !objectId) return serialized
  return JSON.stringify({ ...parsed, _id: { $oid: objectId } })
}

export function parseSerializedDocument(document: string): unknown {
  return JSON.parse(document) as unknown
}

export function prettySerializedDocument(document: string): string {
  return JSON.stringify(parseSerializedDocument(document), null, 2)
}
