# ADR 0007: Defer arbitrary-code sandboxing

- Status: accepted
- Date: 2026-07-12

## Context

Executing an untrusted patch is a security boundary involving isolation,
capability control, resource limits, network policy, secrets, artifact handling,
and incident response. A child process or container alone is not a sufficient
security claim.

## Decision

The first canonical demo verifies only trusted, repository-owned fixtures with a
deterministic runner. It exposes no path for arbitrary submissions to execute on
the host. A real sandbox is a separate phase requiring a threat model, security
review, and executable isolation tests.

## Consequences

The educational workflow can be built safely without implying a capability it
does not provide. Real external-agent demonstrations remain opt-in until the
sandbox boundary is designed and verified.
