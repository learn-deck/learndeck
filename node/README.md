# PatchQuest for Node.js

[Project overview](../README.md) · [Español](../docs/es/README.md)

This directory is reserved for the first implementation of the language-neutral
PatchQuest contracts. It will contain three applications—Mission Control,
Workshop, and Verification—and supporting packages that do not share aggregates
across contexts.

## Current status

The Node 24/npm 11 workspace and deterministic verification spine are active.
TypeScript 6 uses strict NodeNext ESM projects for each application and package.
Domain and service behavior intentionally starts in the next phase.

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

The architecture mutation suite enforces these dependency directions before
the corresponding production layers exist:

| Importing layer             | May import                               | Must not import                                                                                    |
| --------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Domain                      | Its own domain layer                     | Application, adapters, infrastructure, Fastify, PostgreSQL, RabbitMQ, OpenTelemetry, provider SDKs |
| Application                 | Its own application and domain layers    | Adapters, infrastructure, Fastify, PostgreSQL, RabbitMQ, OpenTelemetry, provider SDKs              |
| Adapters and infrastructure | Application and domain ports as required | Another bounded-context application                                                                |

At this foundation stage, the named unit, integration, acceptance, and system
commands prove that each verification level is wired into the gate. They do not
yet claim service-level behavior; those suites grow with the services.

The structure separates applications, narrowly scoped infrastructure
packages, trusted mission fixtures, test levels, and local platform assets. Root
contracts remain authoritative and technology-neutral.
