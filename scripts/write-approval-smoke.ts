import assert from "node:assert/strict"
import type { WriteApprovalRequest } from "../src/shared/types"
import { WriteApprovalBroker, type WriteApprovalInput, writeApprovalPreview } from "../src/main/write-approval-broker"

const input: WriteApprovalInput = {
  connectionId: "connection-1",
  source: "agent",
  title: "Approve agent update",
  description: "Update one document.",
  destructive: false,
}

const approvedBroker = new WriteApprovalBroker()
let approvedRequest: WriteApprovalRequest | undefined
const approved = approvedBroker.request(input, (request) => { approvedRequest = request })
assert.ok(approvedRequest)
approvedBroker.resolve({ id: approvedRequest.id, approved: true })
await approved

const deniedBroker = new WriteApprovalBroker()
let deniedRequest: WriteApprovalRequest | undefined
const denied = deniedBroker.request(input, (request) => { deniedRequest = request })
assert.ok(deniedRequest)
deniedBroker.resolve({ id: deniedRequest.id, approved: false })
await assert.rejects(denied, /cancelled by the user/)

const concurrentBroker = new WriteApprovalBroker()
const pending = concurrentBroker.request(input, () => undefined)
assert.throws(() => concurrentBroker.request(input, () => undefined), /already waiting for approval/)
concurrentBroker.cancel()
await assert.rejects(pending, /approval was cancelled/)

const scopedBroker = new WriteApprovalBroker()
let scopedRequest: WriteApprovalRequest | undefined
const scopedPending = scopedBroker.request({ ...input, scope: "request-a" }, (request) => { scopedRequest = request })
assert.equal(scopedBroker.cancel("agent", "request-b"), undefined)
assert.ok(scopedRequest)
assert.equal(scopedBroker.cancel("agent", "request-a"), scopedRequest.id)
await assert.rejects(scopedPending, /approval was cancelled/)

const longPreview = `${"a".repeat(5_000)}UPDATE${"z".repeat(5_000)}`
const preview = writeApprovalPreview(longPreview)
assert.match(preview, /^a+/)
assert.match(preview, /characters omitted; full payload will execute/)
assert.match(preview, /z+$/)

let expiredId = ""
let expiringRequest: WriteApprovalRequest | undefined
const expiringBroker = new WriteApprovalBroker(5, (id) => { expiredId = id })
await assert.rejects(expiringBroker.request(input, (request) => { expiringRequest = request }), /approval expired/)
assert.ok(expiringRequest)
assert.equal(expiredId, expiringRequest.id)

console.log("Write approval resume, denial, expiry, preview, cancellation, and concurrency behavior verified.")
