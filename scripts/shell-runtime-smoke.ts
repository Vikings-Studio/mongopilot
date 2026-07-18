import assert from "node:assert/strict"
import { createRequire } from "node:module"

interface RuntimeResult {
  printable: unknown
}

interface Runtime {
  evaluate(code: string): Promise<RuntimeResult>
  getShellPrompt(): Promise<string>
  terminate(): Promise<void>
  waitForRuntimeToBeReady(): Promise<void>
}

interface RuntimeConstructor {
  new(uri: string, driverOptions: Record<string, never>, cliOptions: { nodb: boolean }): Runtime
}

const require = createRequire(import.meta.url)
const WebWorker = require("web-worker") as unknown
if (typeof Reflect.get(globalThis, "Worker") !== "function") Object.defineProperty(globalThis, "Worker", { configurable: true, value: WebWorker })
const { WorkerRuntime } = require("@mongosh/node-runtime-worker-thread") as { WorkerRuntime: RuntimeConstructor }
const runtime = new WorkerRuntime("mongodb://127.0.0.1:1", {}, { nodb: true })

try {
  await runtime.waitForRuntimeToBeReady()
  const result = await runtime.evaluate("1 + 1")
  assert.equal(result.printable, 2)
  assert.match(await runtime.getShellPrompt(), /^test>/)
  console.log("Official mongosh worker startup, evaluation, and prompt verified.")
} finally {
  await runtime.terminate()
}
