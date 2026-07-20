import assert from "node:assert/strict"
import { isVisibleCollection, isVisibleDatabase } from "../src/main/namespace-visibility"

assert.deepEqual(
  ["admin", "config", "local", "makemydemo", "localization"].filter(isVisibleDatabase),
  ["makemydemo", "localization"],
)

assert.deepEqual(
  ["oplog.rs", "system.profile", "system.views", "system.buckets.metrics", "users", "orders"].filter(isVisibleCollection),
  ["users", "orders"],
)

console.log("Compass-style internal database and collection filtering verified.")
