import assert from "node:assert/strict"
import { Decimal128, Long, ObjectId } from "mongodb"
import { parseVisualizationReply, parseVisualizationSpec } from "../src/main/visualization-spec"
import { normalizeVisualizationValue } from "../src/main/visualization-values"

const spec = parseVisualizationReply(`Here is the result:
\`\`\`json
{
  "title": "Orders by status",
  "description": "Current order distribution.",
  "chartType": "bar",
  "pipeline": [{ "$group": { "_id": "$status", "status": { "$first": "$status" }, "count": { "$sum": 1 } } }],
  "categoryField": "status",
  "series": [{ "field": "count", "label": "Orders" }]
}
\`\`\``)

assert.equal(spec.chartType, "bar")
assert.equal(spec.series[0]?.field, "count")
assert.throws(() => parseVisualizationSpec({ ...spec, chartType: "pie", series: [...spec.series, { field: "other", label: "Other" }] }), /exactly one series/)
assert.throws(() => parseVisualizationSpec({ ...spec, pipeline: [{ $merge: "archive" }] }), /cannot use \$out or \$merge/)
assert.throws(() => parseVisualizationSpec({ ...spec, pipeline: [{ $project: { value: { $function: { body: "return 1", args: [], lang: "js" } } } }] }), /server-side JavaScript/)
assert.throws(() => parseVisualizationReply("not json"), /did not return/)

assert.equal(normalizeVisualizationValue(new ObjectId("507f1f77bcf86cd799439011")), "507f1f77bcf86cd799439011")
assert.equal(normalizeVisualizationValue(Decimal128.fromString("12.5")), 12.5)
assert.equal(normalizeVisualizationValue(Long.fromNumber(42)), 42)
assert.equal(normalizeVisualizationValue(new Date("2026-01-02T03:04:05.000Z")), "2026-01-02T03:04:05.000Z")
assert.equal(normalizeVisualizationValue(Number.POSITIVE_INFINITY), "Infinity")

console.log("Visualization specs verified for AI parsing, safety limits, and BSON chart values.")
