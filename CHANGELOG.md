# Changelog

All notable changes to Mongo Pilot are documented here.

## [Unreleased]

## [0.2.8] - 2026-07-22

### Added

- Group OpenCode models by provider and expose each model's supported reasoning levels in the model picker.
- Persist the selected reasoning level and send it as the OpenCode prompt variant.

## [0.2.7] - 2026-07-22

### Changed

- Shorten the agent access badge from `Agent: Read / write` to `Read / write`.

## [0.2.6] - 2026-07-22

### Fixed

- Stop approved shell commands that exceed 30 seconds and require verification before retrying an outcome-ambiguous write.
- Preserve definitive MongoDB errors while reserving unknown-outcome warnings for network, operation-timeout, and write-concern failures.
- Keep approval errors visible across workspace tabs and contain keyboard focus inside the approval dialog.
- Centralize approval, write, and MCP timeout budgets and bound agent metadata reads.

## [0.2.5] - 2026-07-22

### Fixed

- Keep agent write approvals alive long enough to complete and acknowledge approval clicks before dismissing the dialog.
- Buffer approval requests until the renderer is ready and prevent duplicate or stale approval responses from suggesting unsafe retries.
- Bound approved MongoDB writes and align approval, operation, and MCP timeout budgets so stalled writes fail clearly instead of hanging.

## [0.2.4] - 2026-07-21

### Fixed

- Cache decrypted connection URIs only for the current app session so reconnecting, copying a URI, or opening the shell does not repeatedly ask for the same macOS Keychain permission.

## [0.2.3] - 2026-07-21

### Fixed

- Recover from a stopped or unreachable bundled OpenCode server instead of leaving Pilot prompts permanently stuck on `fetch failed`.
- Invalidate dead OpenCode sessions when the child process exits and restart the service on the next request.
- Serialize OpenCode and MongoDB MCP lifecycle changes so concurrent prompts, restarts, and shutdowns cannot overlap grants or child processes.

## [0.2.2] - 2026-07-21

### Added

- Add a visible refresh action that reruns the current document query without changing data.
- Make HTTP and HTTPS string values safely clickable in document views.
- Add a persistent toggle between database UTC and localized date-time display.

### Changed

- Hide MongoDB internal databases and collections from normal discovery, including replica-set oplog entries, to match Compass's default browsing behavior.

### Security

- Require a one-time, operation-specific user approval for document replacements and deletions, every shell command, and every agent insert, update, or deletion, even when the saved connection is in read/write mode.
- Resume or reject pending agent tool calls immediately after the user approves or cancels instead of leaving the agent waiting.

## [0.2.1] - 2026-07-19

### Fixed

- Restored packaged app startup by including the icon loaded during macOS initialization and relying on the signed bundle icon for the Dock.
- Removed the long pre-window stall by loading the embedded mongosh runtime only when the Shell tab is opened.
- Replaced the mixed x64 Electron and arm64 OpenCode macOS package with a universal binary for native Intel and Apple Silicon startup.

## [0.2.0] - 2026-07-18

### Added

- Embedded mongosh powered by MongoDB's official worker runtime.
- Multiline shell commands, session command history, tab completion, interruption, and bounded output.
- Environment markers for local, development, staging, production, and unlabeled connections.
- Instant connection safety switching between read-only and read/write modes.
- Persistent AI visualization definitions scoped to each connection, database, and collection.

### Changed

- Environment identity is represented by compact semantic color markers instead of text badges.
- Pilot receives the active environment and effective connection safety context.
- Existing connections migrate safely without changing their previous direct-write behavior.
- macOS releases now require Developer ID signing, hardened runtime entitlements, Apple notarization, stapling, and Gatekeeper verification before publication.

### Security

- Read-only connection safety is enforced in Electron's main process for direct and agent mutations.
- Shell sessions are unavailable in read-only mode and terminate immediately when that mode is enabled.
- Shell evaluation runs in a dedicated worker; connection strings remain in the main process and output is converted to bounded plain text before crossing IPC.

## [0.1.0] - 2026-07-16

### Added

- Initial Electron MongoDB workspace with encrypted connections, document browsing, aggregation pipelines, schema analysis, indexes, reports, OpenCode integration, and automatic releases.
