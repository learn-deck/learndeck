# PatchQuest for Node.js

[Project overview](../README.md) · [Español](../docs/es/README.md)

This directory is reserved for the first implementation of the language-neutral
PatchQuest contracts. It will contain three applications—Mission Control,
Workshop, and Verification—and supporting packages that do not share aggregates
across contexts.

## Current status

The Node 24/npm 11 workspace and deterministic verification spine are active.
TypeScript 6 uses strict NodeNext ESM projects for each application and package.
Phase 4A implements Mission Control's independently authored `Mission`
aggregate, immutable work contract, exact completion binding, bounded human
decisions, restart-safe `MissionCompletionProcess` state, versioned persistence
mementos, application-owned ports, and closed integration translators. The
shared contracts package exports only the three command and twelve event DTO
unions. Mementos make a future durable adapter possible; they are not a database
or delivery guarantee. Workshop and Verification and Review domain internals
remain for the next Phase 4 slices; no database, broker, Fastify, provider SDK,
or other infrastructure is present.

```sh
nvm use
npm ci
npm run verify
```

`npm run verify` is the complete local and CI gate. It first checks repository
policy, then formatting, linting, project-reference builds, dependency
direction, all test levels, OpenAPI and AsyncAPI semantics, JSON Schema
validation, contract/catalog parity, scenario references and captures, gate-set
hashes, and local documentation links.

### npm 11 lockfile workaround

`@csstools/css-parser-algorithms` and `@csstools/css-tokenizer` are intentionally
listed as exact direct dev dependencies even though PatchQuest does not import
them. With npm 11.6.1, leaving these optional peers purely transitive through
the contract toolchain produced versionless nested package records under
`@asamuzakjp/css-color`; a standard `npm ci` then failed with `Invalid Version`.
The direct `4.0.0` pins force complete root package records and make a freshly
generated lockfile reproducible. Remove the pins only after a newer pinned npm
version regenerates the lock without nested versionless records and two clean,
standard `npm ci` runs preserve its hash.

The architecture mutation suite enforces these dependency directions and keeps
the shared contracts package free of aggregates and persistence models:

| Importing layer             | May import                                                                                                                         | Must not import                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Domain                      | Relative domain modules, contracts DTOs, `node:crypto`; `node:util/types` only in `json-topology.ts` for trap-free proxy detection | Application, adapters, infrastructure, Fastify, PostgreSQL, RabbitMQ, OpenTelemetry, provider SDKs |
| Application                 | Relative application/domain modules, contracts, `node:crypto`                                                                      | Adapters, infrastructure, Fastify, PostgreSQL, RabbitMQ, OpenTelemetry, provider SDKs              |
| Adapters and infrastructure | Application and domain ports as required                                                                                           | Another bounded-context application                                                                |

For domain and application source, a relative specifier is resolved as a
TypeScript file or directory index from the importing file and must remain in
the current bounded context's allowed source layers. Relative spelling cannot
escape through `node_modules`, repository scripts, another application, or a
non-contract shared package. The production mutation suite also rejects direct,
computed, destructured, and aliased access to host globals, network clients, and
code-execution capabilities while permitting genuinely local bindings and
ordinary property names.

The Mission and process state-machine tests now prove retry-cycle isolation,
first-wins verification outcomes, direct causation, payload-aware idempotency,
crash/reload continuation, every reachable persistence-state matrix, invalid
memento mutation rejection, late dispatch acknowledgements, cancellation/abort
ordering, and root-schema parity plus deep immutability for every emitted Phase
4A command and event. Process mementos include a normalized append-only
transition audit, a lifetime outgoing-message identity registry, and durable
verification-dispatch and acknowledgement registries. Rehydration starts from
the complete immutable seed inside the audit and accepts it only when the full
reconstructed canonical projection, fingerprints, histories, and transition
facts match. The audit digest chain detects partial inconsistency at this
trusted storage boundary; it is not cryptographic proof against a party able to
rewrite the entire store. Contract-valid
optional abort evidence/detail and recommendation reasons survive the boundary
exactly. Phase 4A exports the canonical normalization/fingerprint functions and
declares the inbox/unit-of-work interfaces only. A Phase 5 adapter must classify
normalized `(messageId, fingerprint)` pairs before processing and record them
only after business state and outgoing intent are accepted in its real
transaction; no runtime atomicity is claimed yet.

The normalization and runtime-contract boundary accepts only faithful JSON
topology: ordinary `Object.prototype` objects with exact own enumerable data
properties, and dense ordinary arrays with own indices. It rejects inherited,
accessor-backed, symbolic, non-enumerable, sparse, custom-prototype, cyclic, and
non-JSON values, including non-finite numbers and negative zero. Object and
array proxies are rejected through Node's trap-free `node:util/types.isProxy`
introspection before prototype, key, descriptor, or value traversal; this exact
import is the sole domain-layer exception beyond `node:crypto`. Canonicalization
uses inspected data-descriptor values rather than ordinary property reads.
Frozen ordinary JSON remains valid. The canonical fingerprint is therefore
total only over this accepted topology; invalid inputs are rejected instead of
being silently normalized into a colliding representation.

Integration, acceptance, and system commands still prove the repository and
contract spine rather than a running service; those suites grow when adapters
and infrastructure are implemented.

The structure separates applications, narrowly scoped infrastructure
packages, trusted mission fixtures, test levels, and local platform assets. Root
contracts remain authoritative and technology-neutral.
