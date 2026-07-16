# Mongo Pilot

Mongo Pilot is an Electron desktop workspace for MongoDB with an embedded OpenCode copilot. This repository currently contains the first UI and architecture pass.

## Current Scope

- Save MongoDB connection strings encrypted through Electron `safeStorage`
- Connect with the official MongoDB Node.js driver
- List databases and collections
- Load collections automatically with bounded, paginated `find` queries
- Persist page-size and Extended JSON sort defaults per collection
- Enforce read and read/write access modes in the Electron main process
- Start a bundled OpenCode loopback server through `@opencode-ai/sdk/v2`
- Create OpenCode sessions and send workspace-aware prompts
- Expose authenticated MongoDB MCP tools to OpenCode based on the selected agent access mode
- Permit only read tools in read mode and both read and bounded mutation tools in read/write mode
- Provide documents, aggregations, schema, indexes, and reports workspaces for live connections

The first agent tool set includes database and collection discovery, bounded finds, bounded aggregations, counts, and single-document inserts, updates, and deletes. Bulk mutations and report generation are not implemented yet.

## Development

```bash
npm install
npm run dev
```

If the host environment sets `ELECTRON_RUN_AS_NODE=1`, launch with:

```bash
env -u ELECTRON_RUN_AS_NODE npm run dev
```

Build checks:

```bash
npm run typecheck
npm run build
```

## Security Boundaries

- The renderer has no Node.js integration and receives only explicit IPC methods.
- Connection URIs are never returned to the renderer after saving.
- Access modes are application safeguards, not replacements for MongoDB roles.
- OpenCode tools default to denied; web access requires approval.
- MongoDB MCP requests require an app-generated bearer token and a short-lived active connection grant.
- Agent permissions are enforced both in OpenCode tool exposure and inside each MongoDB operation.
- Decrypted MongoDB connection strings remain inside the Electron main process and are never sent to OpenCode or the MCP server.
- OpenCode agents are not sandboxes. Use OS/container isolation for untrusted workloads.

## Documentation Sources

- [OpenCode SDK](https://opencode.ai/docs/sdk/)
- [OpenCode server](https://opencode.ai/docs/server/)
- [OpenCode permissions](https://opencode.ai/docs/permissions/)
- [OpenCode security policy](https://github.com/anomalyco/opencode/blob/v1.18.2/SECURITY.md)
- [MongoDB Compass connections](https://www.mongodb.com/docs/compass/current/connect/connections/)
- [MongoDB connection strings](https://www.mongodb.com/docs/manual/reference/connection-string/)
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
