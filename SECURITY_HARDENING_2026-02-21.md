# Security Hardening Report and Implementation Plan (2026-02-21)

## Findings

### High
1. Insecure transport is currently possible.
- `src/transport.ts` derives `ws://` from `http://` server URLs.
- Pair/session-token traffic can traverse plaintext networks if misconfigured.

2. Session token exposure risk via URL logging.
- Session token is sent as a query param (`?token=...`) for websocket bootstrap.
- Full connection URL is logged to stdout.

3. Remote-driven local execution remains a sensitive trust boundary.
- Server-provided args influence local CLI invocation and directory creation.
- A compromised control plane/token could steer harmful local actions.

### Medium
4. Local config file permissions are not explicitly hardened.
- `master.key` is chmod’d to owner-only, but config file permissions are not forced.

5. At-rest secret encryption key is co-located with encrypted data.
- AEAD is implemented correctly, but key and ciphertext in same profile dir reduce protection against local account compromise.

### Low/Process
6. No lint gate is configured.
- `package.json` currently sets `lint` to a placeholder.

## Implementation Plan

### Phase 1 (Implement now)
1. Enforce secure transport defaults.
- Reject non-localhost `http://` server URLs unless explicitly overridden by env.
- Preserve localhost usability for development.

2. Remove token leakage from logs.
- Redact token-bearing websocket URLs in logs (log only origin/path).

3. Add local execution path guardrails.
- Introduce optional allowed-root policy for working directory creation and process cwd.
- Block startup when requested paths are outside configured roots.

4. Harden local config permissions.
- Apply owner-only permissions to client config file after save.

### Phase 2 (Next)
1. Add explicit local policy mode for risky args.
- Optional denylist for dangerous argument combinations.
- Optional interactive confirmation hook for high-risk actions.

2. Add OS keychain integration.
- Prefer native secure credential storage for refresh token where available.

### Phase 3 (Operational)
1. Add lint/security static checks.
- Real lint script and CI enforcement.
2. Expand tests around transport security and directory guardrails.
