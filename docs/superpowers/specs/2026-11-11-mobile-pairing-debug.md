# Mobile pairing persistence and debug transport

## Context

The Tauri 2 mobile client pairs with the desktop gateway through native Rust requests, holds host and token only in memory, and requires HTTPS. The desktop gateway currently serves HTTP on port 47700. The user wants pairing to survive app restart, actual session API failures fixed, and local HTTP testing on MuMu and LAN devices. This is test-only; do not publish a Release.

## Scope and security boundary

- Preserve the existing four-command native API for pairing, sessions, timeline and disconnect; add a connection-status/restore command only if the UI cannot otherwise distinguish a restored connection. Never expose token to JS or load remote UI in the WebView.
- Android stores host and token together as an authenticated encrypted payload using a non-exportable Android Keystore AES-GCM key. Store only ciphertext/IV in an atomic file under Android `noBackupFilesDir`, which excludes it from backup/device transfer. Save before reporting a successful pair. Restore on app start, validate host/token, and verify against the gateway before presenting connected state; invalidated key/corrupt data/401 returns to pairing and removes saved data. Offline/network errors preserve saved credentials and show a retry state. Disconnect deletes saved credentials before returning to pairing; server-side device revocation remains a separate operation.
- iOS does not use Android persistence or plaintext fallback. Provide a Keychain backend with ThisDeviceOnly semantics before enabling equivalent iOS persistence; if unavailable, iOS stays memory-only and documents this limitation.
- Production/release builds accept only HTTPS root origins with TLS verification and no redirects. Android debug builds may additionally accept literal `10.0.2.2` and RFC1918 IPv4 addresses on HTTP, with explicit host:port; no public domains, arbitrary DNS hostnames, or loopback over HTTP. Enable cleartext at Android application level for debug only. Pairing codes and tokens sent over debug HTTP can be observed on that network; developer must use trusted local networks and rotate/revoke test devices after use.
- Keep desktop gateway binding as-is (`0.0.0.0:47700` currently); no automatic firewall changes. MuMu host reachability is tested with `192.168.10.145:47700` and, where available, `10.0.2.2:47700`.

## Session behavior

The current mobile request paths and body match desktop handlers. Diagnose actual installed gateway status/response during an authenticated connection before changing protocol. Distinguish an invalid `/pair` code (401) from a revoked API token (401); the former retains host/code retry UI. Existing response validation rejects an entire timeline for a provider role outside four hardcoded values although the server emits arbitrary role strings; accept string roles and display a neutral fallback, while still rejecting malformed objects. Only alter list schema if a captured real response proves a mismatch. Avoid logging token, pairing code, or session contents.

## Verification

Start with failing unit tests for pairing-401, role fallback, host-policy debug/release boundaries, persistence restore/revoke/offline/disconnect; then implement. Run mobile frontend tests, Rust tests, TypeScript check, Android build for x86_64 debug and install on MuMu via ADB. Verify network reachability, successful pairing, session list and timeline, cold app restart restoring credentials, wrong code retry, offline preservation, disconnect removal, and release HTTPS-only policy via tests/build configuration. If installed desktop v0.9.0 differs from source, report the exact incompatibility and test against an appropriate gateway without silently overwriting the installed app. No Release, tag, or store distribution.
