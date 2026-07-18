# ADR 0003: Treat coding agents as runner adapters

- Status: accepted
- Date: 2026-07-12

## Context

Providers, models, SDKs, and protocols change faster than mission and attempt
rules. Putting provider vocabulary in the domain would couple business behavior
to an integration choice.

## Decision

Workshop defines a provider-neutral runner port. The canonical adapter is a
deterministic fake. Real coding-agent, A2A, MCP, or provider adapters may be added
later, but SDK objects, credentials, model names, raw prompts, and tool payloads
remain outside the domain and root contracts.

## Consequences

Domain tests remain deterministic and offline. Adapters must translate their
external states into PatchQuest language and cannot claim protocol compliance
without dedicated conformance evidence.
