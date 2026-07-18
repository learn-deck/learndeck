# PatchQuest: an Agent Workshop

English · [Español](docs/es/README.md)

PatchQuest is a technology-neutral reference for learning domain-driven design,
hexagonal architecture, and reliable microservices through a current agentic
workflow.

## Clone it. Open your agent. Say “Let's start.”

PatchQuest is designed as a first-person, repository-native course. After
cloning it, open the repository with a coding agent that reads `AGENTS.md` and
local Agent Skills, then say:

> Let's start.

The local [`learn-patchquest`](.agents/skills/learn-patchquest/SKILL.md) guide
takes you through one visual, hands-on module at a time. You inspect the real
contracts, make bounded changes, retrieve and self-evaluate what you learned,
run the real verification gates, and resume from an ignored local progress
record with scheduled reviews. Start with
[my guided learning path](course/en/README.md).

A human opens a coding mission. A runner leases an attempt and submits a patch.
An independent verifier checks that exact artifact. A human decides whether the
verified result completes the mission.

The design makes the difficult parts visible: immutable acceptance gates,
renewable leases, bounded retries, idempotent submission, independent
verification, human approval, and end-to-end audit history.

## Start here

- [Learn with your local agent](course/en/README.md)
- [Domain guide](docs/en/README.md)
- [Canonical shipping-quote mission](docs/en/workflows/canonical-demo.md)
- [Context map](docs/en/domain/context-map.md)
- [Language-neutral contracts](contracts/README.md)
- [Node implementation status](node/README.md)

The root is implementation-neutral. `node/` will become the first complete
implementation; future stacks must satisfy the same root contracts and
acceptance scenarios.

## Current status

PatchQuest has a contract-first foundation and an executable Node verification
spine. The English domain model, architecture, decisions, contract inventory,
and sixteen deterministic acceptance scenarios are available. Phase 4A makes
the shared TypeScript v1 transport boundary and Mission Control's Mission and
completion-process behavior executable and offline-tested. Phase 4B likewise
makes Workshop's `Attempt`/`RunnerLease`, strict boundaries, versioned memento,
ports, transactional use-case ordering, and four-event factory executable and
offline-tested, including aggregate-owned event provenance, confidential
lease-response replay interfaces, and the behavioral seam where Workshop
accepts an out-of-scope artifact for later independent verification. This is
domain and application behavior, not an HTTP service or durable delivery claim.
Verification and Review—including execution of `check-allowed-scope`—remains the
separate planned Phase 4C slice; encrypted durable replay storage and other
adapters are not implemented, and this is not a public release.

PatchQuest is a fresh, independently authored project. No earlier course files,
package metadata, configuration, or Git history are imported. Earlier courses
are used only to identify lessons worth teaching; the provenance checks are
recorded in [ADR 0001](docs/en/decisions/0001-independent-origin.md).

## Principles

- Domain language is provider-neutral; coding agents are adapters.
- Producing, verifying, and approving work are separate responsibilities.
- At-least-once delivery is expected, so handlers are idempotent.
- Traces explain behavior but never determine domain truth.
- The default demo uses trusted, repository-owned fixtures, not arbitrary host
  code execution.

## License

Code is licensed under [Apache License 2.0](LICENSE). Documentation is currently
distributed under the same repository license.
