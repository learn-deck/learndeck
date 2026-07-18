# Node Implementation Instructions

Read the repository-level `/AGENTS.md` and root contracts before changing this
implementation.

## Commands

- Install exactly from the lockfile: `npm ci`
- Run the complete local and CI gate: `npm run verify`
- Format changed files: `npm run format`
- Remove TypeScript build outputs: `npm run clean`

The named format, lint, typecheck, build, architecture, unit, contract,
integration, acceptance, system, and documentation scripts are diagnostic
sub-gates. A handoff requires the complete gate.

## Boundaries

- Keep domain and application code free of Fastify, PostgreSQL, RabbitMQ,
  OpenTelemetry, and provider SDK imports.
- Do not share aggregates or persistence models through `packages/`.
- Treat the deterministic fake runner and trusted fixture as the canonical path.
- Do not expose arbitrary host-code execution as verification or sandboxing.
- Keep one future workspace and one future lockfile under `/node`; never add
  service-level lockfiles.
- Keep TypeScript in NodeNext ESM mode and preserve project references.
- A bounded-context application must not import another application directly.
