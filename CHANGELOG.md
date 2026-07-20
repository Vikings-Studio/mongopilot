# Changelog

All notable changes to Mongo Pilot are documented here.

## [Unreleased]

## [0.2.2] - 2026-07-19

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
