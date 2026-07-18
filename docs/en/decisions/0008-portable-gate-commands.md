# ADR 0008: Canonicalize gates and resolve commands through a registry

- Status: accepted
- Date: 2026-07-12

## Context

A digest is not portable unless every stack hashes identical bytes. Executing a
mission-supplied command would also couple the root contract to one toolchain
and create a command-injection boundary.

## Decision

Contract v1 canonicalizes the complete acceptance-gate array with the procedure
in `docs/en/contracts/gate-command-registry.md`: validate, sort by `gateId`,
serialize with RFC 8785, and SHA-256 hash the canonical UTF-8 bytes.

Each gate's `commandId` is a closed portable registry key. A stack resolves it
to trusted local verifier code and publishes that mapping in its own
documentation. Mission input never contains executable text and cannot replace
the mapping.

## Consequences

All stacks derive the same gate-set identity and implement the same semantic
checks while retaining freedom to choose appropriate local tools. Adding or
changing a registry command is a contract-versioning decision. Implementations
must test canonicalization vectors and reject unknown commands before opening a
mission.
