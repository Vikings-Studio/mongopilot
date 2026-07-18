# Changelog

All notable changes to Mongo Pilot are documented here.

## [Unreleased]

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
