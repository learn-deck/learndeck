# ADR 0002: Use three bounded-context service boundaries

- Status: accepted
- Date: 2026-07-12

## Context

Mission definition, attempt execution, and independent verification have
different invariants. Splitting every noun into a service would add coordination
without creating meaningful ownership.

## Decision

Use three boundaries: Mission Control, Workshop, and Verification and Review.
Each owns its aggregates, persistence, and integration translators. Cross-context
communication uses versioned contracts, never shared domain entities or database
schemas.

## Consequences

The architecture demonstrates meaningful autonomy without a service per noun.
Some workflows become eventually consistent and require explicit process state,
idempotency, and operational visibility.
