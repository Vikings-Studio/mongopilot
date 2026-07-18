# Releasing Mongo Pilot

Pushes to `main` and pull requests run CI. Version tags build and publish one release for macOS, Windows, and Linux. The release workflow blocks all publishing unless the macOS artifact can be signed with a Developer ID Application certificate and notarized by Apple.

## Apple prerequisites

1. Enroll the Vikings Studio team in the Apple Developer Program.
2. Create a `Developer ID Application` certificate from the Apple Developer portal.
3. Install the certificate and private key in Keychain Access, then export both as a password-protected `.p12` file.
4. In App Store Connect, create a team API key that can submit software for notarization. Download its `AuthKey_<KEY_ID>.p8` file and record the key ID and issuer ID.

Do not commit the certificate, private key, API key, passwords, or their encoded values.

## GitHub Actions secrets

Configure these repository secrets:

| Secret | Value |
| --- | --- |
| `MACOS_CERTIFICATE` | Base64-encoded Developer ID Application `.p12` file |
| `MACOS_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12` file |
| `APPLE_API_KEY_BASE64` | Base64-encoded App Store Connect `.p8` API key |
| `APPLE_API_KEY_ID` | App Store Connect API key ID |
| `APPLE_API_ISSUER` | App Store Connect issuer UUID |

Example setup from macOS:

```bash
base64 -i DeveloperIDApplication.p12 | gh secret set MACOS_CERTIFICATE
gh secret set MACOS_CERTIFICATE_PASSWORD
base64 -i AuthKey_KEYID.p8 | gh secret set APPLE_API_KEY_BASE64
gh secret set APPLE_API_KEY_ID
gh secret set APPLE_API_ISSUER
```

Interactive secret commands prevent sensitive values from entering shell history. Verify names and update timestamps with `gh secret list`; GitHub never returns secret values.

## Release process

1. Update the exact version in `package.json` and `package-lock.json`.
2. Move user-facing changes from `## [Unreleased]` to a dated `## [x.y.z] - YYYY-MM-DD` section in `CHANGELOG.md`.
3. Run `npm run build`, all smoke tests, `npm audit --omit=dev`, and at least one local packaging target.
4. Push the reviewed commit to `main`.
5. After CI passes, create and push the matching version tag, for example `git tag v0.2.0 && git push origin v0.2.0`.
6. Confirm the macOS job passes `codesign`, Gatekeeper, and stapled notarization checks before the release job publishes artifacts.
7. Verify `SHA256SUMS.txt` and updater manifests are attached to the GitHub release.

The local build may remain unsigned for development. A GitHub release must never publish an unsigned macOS artifact.
