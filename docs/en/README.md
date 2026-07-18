# PatchQuest domain guide

This is the normative, implementation-neutral guide to PatchQuest.

## Learn it in my clone

For the first-person, module-by-module course, I open PatchQuest with a local
coding agent and say **“Let's start.”** The portable guide and currently
available modules begin at [Learn PatchQuest with my local agent](../../course/en/README.md).

## Learn the domain

1. [Domain overview](domain/overview.md)
2. [Ubiquitous language](domain/ubiquitous-language.md)
3. [Bounded contexts](domain/bounded-contexts.md)
4. [Context map](domain/context-map.md)
5. [Mission-completion workflow](workflows/mission-completion.md)
6. [Canonical demo](workflows/canonical-demo.md)
7. [Failure catalog](workflows/failure-catalog.md)
8. [Gate-command registry and canonicalization](contracts/gate-command-registry.md)

## Architecture decisions

- [ADR 0001: independently authored origin](decisions/0001-independent-origin.md)
- [ADR 0002: three service boundaries](decisions/0002-three-service-boundaries.md)
- [ADR 0003: coding agents are adapters](decisions/0003-agent-as-adapter.md)
- [ADR 0004: process manager ownership](decisions/0004-process-manager-ownership.md)
- [ADR 0005: independent verification](decisions/0005-independent-verification.md)
- [ADR 0006: at-least-once delivery](decisions/0006-at-least-once-delivery.md)
- [ADR 0007: sandboxing is deferred](decisions/0007-sandbox-deferral.md)
- [ADR 0008: portable gate commands](decisions/0008-portable-gate-commands.md)

## Showcase design

Non-normative guidance for a possible course showcase page:
[showcase design guide](design/showcase.md) with a working single-file
[prototype](design/showcase-prototype.html). No application path is reserved
until executable UI work exists. The mandate is simple, visual, understandable
at first sight — read the guide before proposing any PatchQuest-facing UI.

## Operations

Operational runbooks will appear with executable infrastructure. The current
[operations index](operations/README.md) records that boundary explicitly.

PatchQuest borrows useful distinctions from A2A and MCP while making no protocol
compliance claim. OpenTelemetry traces and metrics explain execution but are not
domain state. See the [source boundaries](domain/overview.md#standards-boundary).
