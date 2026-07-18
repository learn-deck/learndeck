# Canonical demo: shipping quote

The fixture mission is:

> Implement `calculateShippingQuote` without modifying files outside
> `src/shipping/**`.

The fixture repository and fake runner are deterministic, trusted inputs. The
demo is not an arbitrary-code sandbox.

## Mission contract

- Objective: implement the shipping-quote behavior described by fixture tests.
- Starting revision: an immutable fixture revision.
- Allowed scope: `src/shipping/**` only.
- Requested capability: edit the trusted fixture.
- Attempt budget: positive and bounded; Phase 2 acceptance fixtures will define
  the exact value used by each scenario.
- Mandatory gates: allowed-path policy, lint, typecheck, and tests.

## Canonical happy path

1. Create and open the mission with immutable gates.
2. The fake runner leases attempt one for 60 seconds and records a heartbeat.
   The heartbeat and renewal are one transition, moving expiry to 60 seconds
   after the authoritative heartbeat time.
3. Before the lease expires, the runner submits a valid patch and content
   digest, ending attempt one with `ARTIFACT_SUBMITTED`.
4. An independent verifier runs all mandatory checks on that exact artifact and
   publishes a passing verdict.
5. `CompletionReview` binds the verdict and evidence, then publishes an
   `APPROVE` recommendation.
6. Mission Control records a separate human approval referencing the exact
   completion review, recommendation, mission revision, artifact digest,
   gate-set digest, verification run, and evidence-bundle digest.
7. One correlation ID connects the completed path across all three contexts.

## Independent failure probes

These are planned independent probes, not additional steps in the happy-path
attempt. Phase 2 will define each probe's exact fixture state and attempt budget:

- **Forbidden path:** submit an artifact that also modifies a forbidden path;
  Workshop accepts and publishes the syntactically valid artifact and ends the
  attempt as `ARTIFACT_SUBMITTED`. The later trusted `check-allowed-scope` gate
  produces a failed verdict and Completion Review issues `REQUEST_REVISION`.
  Phase 4B's executable behavioral seam proves the Workshop half only; Phase 4C
  domain/application work is in progress, while live verification execution is
  deferred to a Phase 6 adapter.
- **Lease expiry:** let a leased attempt reach `now >= expiresAt` without
  submission; stale ownership is rejected and a new attempt is authorized only
  when budget remains.
- **Duplicate submission:** after one successful submission, repeat the same
  attempt ID and digest; return the recorded result with no second effect.
- **Poison event:** inject the designated invalid integration fixture; it reaches
  a dead-letter queue and is replayed only through the idempotent, audited
  `replayDeadLetter` operator operation.

The [failure catalog](failure-catalog.md) specifies the intended isolated
behaviors; Phase 2 will turn them into exact acceptance fixtures and required
starting conditions.

Once implemented, the demo can demonstrate the workflow and defined failure
behavior; it will not claim production adoption, autonomous performance, A2A
compliance, or MCP compliance.
