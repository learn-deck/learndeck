# Gate-command registry

This document is normative for PatchQuest contract version 1. Acceptance-gate
`commandId` values are portable registry keys. They are not shell fragments,
package-manager scripts, file paths, or provider tool names. A stack MUST map
each key to trusted code installed with that stack; mission input cannot alter
the mapping.

## Gate-set canonicalization

The `gateSetDigest` identifies the complete immutable `acceptanceGates` value.
Every producer and consumer derives it with the same algorithm:

1. Validate every gate against `AcceptanceGate` and reject duplicate `gateId`
   values.
2. Sort the gates by ascending `gateId`. Identifiers are ASCII by schema, so
   byte order and Unicode code-point order agree.
3. Preserve every field exactly. Do not trim strings, add defaults, rewrite
   numbers, or sort any nested array.
4. Serialize the sorted array with the JSON Canonicalization Scheme (RFC 8785).
5. SHA-256 hash the canonical UTF-8 bytes and encode the 32-byte result as 64
   lowercase hexadecimal characters.
6. Represent the result as `{ "algorithm": "sha256", "value": "..." }`.

For the current integer-only v1 gate model, maintainers can reproduce a fixture
digest with `jq -jSc 'sort_by(.gateId)' gates.json | shasum -a 256`. The `-j`
flag keeps the hashed bytes newline-free. This `jq` pipeline matches the current
fixture subset but is not a general RFC 8785 implementation; production
implementations still use an RFC 8785 serializer.

Mission opening MUST reject a supplied digest that differs from this result.
Commands, events, projections, artifact submissions, verification bindings,
completion reviews, and human decisions carry the same digest; no context may
silently recalculate a different gate set.

## Version 1 commands

| `commandId`           | Required input and result semantics                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `check-allowed-scope` | Compare the artifact's normalized relative `changedPaths` with the mission's `allowedScope.pathPatterns`. Reject absolute paths and traversal before matching. Pass only when every changed path is allowed. |
| `check-lint`          | Run the stack's documented deterministic lint profile against the workspace formed from the bound starting revision and exact artifact. Pass only on a zero result.                                          |
| `check-typecheck`     | Run the stack's documented static type verification profile against that same bound workspace. Pass only on a zero result.                                                                                   |
| `check-tests`         | Run the stack's documented deterministic test profile against that same bound workspace. Pass only when the profile completes successfully.                                                                  |

All commands enforce the gate's `timeoutSeconds` and `evidenceLimitBytes`.
Timeout is a failed gate result, not an aborted run. A run is aborted only when
verification cannot obtain a gate result because its execution infrastructure
is unavailable or the mission is cancelled. Implementations may use different
tools, but their stack documentation MUST publish the trusted mapping and
produce the same contract-level check result and bounded evidence fields.
