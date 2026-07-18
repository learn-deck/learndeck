# Contributing

PatchQuest welcomes focused improvements to its domain model, contracts,
documentation, tests, and implementations.

Before proposing a change:

1. Read [the English documentation index](docs/en/README.md) and the relevant
   architecture decision records.
2. Keep root concepts and contracts implementation-neutral.
3. Use the ubiquitous language consistently; explain any new domain term.
4. Preserve backward compatibility for released `v1` contracts, or introduce a
   new version.
5. Update English documentation first. Spanish changes require human review and
   must preserve technical identifiers exactly.

Use Node 24 and npm 11. Before proposing a change, run:

```sh
cd node
npm ci
npm run verify
```

Do not add generated build output, service-level lockfiles, provider
credentials, raw prompts, patches, or sensitive tool output.

By contributing, you agree that your contribution is licensed under Apache-2.0.
