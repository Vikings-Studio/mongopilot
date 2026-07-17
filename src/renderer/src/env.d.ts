import type { MongoPilotApi } from "../../shared/types"

declare global {
  interface Window {
    mongoPilot: MongoPilotApi
  }
}
