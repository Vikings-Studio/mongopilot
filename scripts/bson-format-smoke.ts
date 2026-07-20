import assert from "node:assert/strict"
import { Decimal128, Int32, Long, ObjectId } from "mongodb"
import { parseSerializedDocument, serializeBson, serializeMongoDocument, stringifyCanonicalExtendedJson, stringifyMongoDocument } from "../src/main/bson-serialization"
import { getBsonDisplay, isWebUrl } from "../src/renderer/src/bson-format"

const cases: Array<[unknown, string]> = [
  [{ $oid: "507f1f77bcf86cd799439011" }, "ObjectId('507f1f77bcf86cd799439011')"],
  [{ $date: { $numberLong: "1609459200000" } }, "2021-01-01T00:00:00.000+00:00"],
  [{ $date: "2021-01-01T00:00:00.000Z" }, "2021-01-01T00:00:00.000+00:00"],
  [{ $numberInt: "42" }, "42"],
  [{ $numberLong: "9007199254740993" }, "Long('9007199254740993')"],
  [{ $numberDouble: "Infinity" }, "Double('Infinity')"],
  [{ $numberDecimal: "12.34" }, "Decimal128('12.34')"],
  [{ $binary: { base64: "aGk=", subType: "00" } }, "Binary('aGk=', '00')"],
  [{ $timestamp: { t: 1, i: 2 } }, "Timestamp({ t: 1, i: 2 })"],
  [{ $regularExpression: { pattern: "a/b", options: "i" } }, "/a\\/b/i"],
  [{ $minKey: 1 }, "MinKey()"],
  [{ $maxKey: 1 }, "MaxKey()"],
  [{ $code: "x", $scope: { a: { $numberInt: "1" } } }, "Code('x', {\"a\":{\"$numberInt\":\"1\"}})"],
  [{ $ref: "things", $id: { $oid: "507f1f77bcf86cd799439011" }, $db: "app" }, "DBRef('things', ObjectId('507f1f77bcf86cd799439011'), 'app')"],
]

for (const [input, expected] of cases) assert.equal(getBsonDisplay(input)?.text, expected)
assert.equal(getBsonDisplay({ $oid: "value", other: true }), null)
assert.equal(getBsonDisplay({ $date: { $numberLong: "1609459200000" } }, "local")?.text, new Date(1609459200000).toLocaleString())
assert.equal(isWebUrl("https://www.mongodb.com/docs/"), true)
assert.equal(isWebUrl("http://localhost:3000/path"), true)
assert.equal(isWebUrl("javascript:alert(1)"), false)
assert.equal(isWebUrl("not a URL"), false)

const objectId = "507f1f77bcf86cd799439011"
const serializedDocument = serializeBson({
  _id: new ObjectId(objectId),
  createdAt: new Date("2021-01-01T00:00:00.000Z"),
  count: new Int32(42),
  large: Long.fromString("9007199254740993"),
  price: Decimal128.fromString("12.34"),
})
assert.deepEqual(serializedDocument, {
  _id: { $oid: objectId },
  createdAt: { $date: { $numberLong: "1609459200000" } },
  count: { $numberInt: "42" },
  large: { $numberLong: "9007199254740993" },
  price: { $numberDecimal: "12.34" },
})
assert.doesNotMatch(JSON.stringify(serializedDocument), /"buffer"/)
assert.equal(stringifyCanonicalExtendedJson(new ObjectId(objectId)), `{"$oid":"${objectId}"}`)

const sourceAwareDocument = serializeMongoDocument({
  _id: new ObjectId(objectId),
  nested: { value: "preserved" },
})
assert.deepEqual(sourceAwareDocument, {
  _id: { $oid: objectId },
  nested: { value: "preserved" },
})
assert.doesNotMatch(JSON.stringify(sourceAwareDocument), /"buffer"/)

const crossRuntimeObjectId = {
  _bsontype: "ObjectId",
  buffer: Array.from({ length: 12 }, (_value, index) => index),
  toHexString: () => objectId,
}
const crossRuntimeDocument = serializeMongoDocument({ _id: crossRuntimeObjectId, status: "active" })
assert.deepEqual(crossRuntimeDocument, { _id: { $oid: objectId }, status: "active" })
assert.doesNotMatch(JSON.stringify(crossRuntimeDocument), /"buffer"/)

const transportDocument = stringifyMongoDocument({
  _id: new ObjectId(objectId),
  updatedAt: new Date("2026-04-05T11:09:21.627Z"),
})
assert.equal(typeof transportDocument, "string")
const parsedTransport = parseSerializedDocument(transportDocument)
assert.deepEqual(parsedTransport, {
  _id: { $oid: objectId },
  updatedAt: { $date: { $numberLong: "1775387361627" } },
})
if (parsedTransport === null || typeof parsedTransport !== "object" || Array.isArray(parsedTransport)) throw new Error("Transport document was not an object.")
assert.equal(getBsonDisplay(parsedTransport._id)?.text, `ObjectId('${objectId}')`)
assert.equal(getBsonDisplay(parsedTransport.updatedAt)?.text, "2026-04-05T11:09:21.627+00:00")

console.log(`BSON display formatting and driver serialization verified for ${cases.length} canonical types.`)
