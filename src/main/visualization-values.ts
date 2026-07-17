import type { VisualizationValue } from "../shared/types"
import { serializeBson } from "./bson-serialization"

interface BsonLike {
  _bsontype?: string
  toHexString?: () => string
  toString?: () => string
}

function finiteNumber(value: string): number | string {
  const number = Number(value)
  return Number.isFinite(number) ? number : value
}

export function normalizeVisualizationValue(value: unknown): VisualizationValue {
  if (value === null || value === undefined) return null
  if (typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value)
  if (typeof value === "bigint") return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString()
  if (value instanceof Date) return value.toISOString()

  if (typeof value === "object") {
    const bson = value as BsonLike
    if (bson._bsontype === "ObjectId" && bson.toHexString) return bson.toHexString()
    if (["Decimal128", "Double", "Int32", "Long"].includes(bson._bsontype ?? "") && bson.toString) {
      return finiteNumber(bson.toString())
    }
  }

  return JSON.stringify(serializeBson(value))
}
