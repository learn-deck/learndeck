# Context map

Mission Control is upstream for mission requirements and explicitly orchestrates
mission completion. Its process manager directs Workshop to create or revoke an
attempt and directs Verification and Review to start verification. The recipient
context remains authoritative for its aggregates and publishes outcomes without
importing the Mission aggregate. `CompletionReview` publishes a recommendation
for an exact verification result. Mission Control then records a separate human
decision and alone may complete the mission.

```mermaid
flowchart LR
    Human[Human operator] -->|defines mission; decides approve or reject| MC[Mission Control]
    MC -->|commands: create attempt; revoke attempt| W[Workshop]
    W -->|events: attempt state; submitted artifact| MC
    MC -->|command: start verification with exact identities| VR[Verification and Review]
    VR -->|events: verdict; review recommendation| MC
```

Cross-context communication uses versioned integration contracts. Imperative
commands have one intended recipient; past-tense events publish facts. Each
context translates both into its own model. No context imports another context's
aggregate, persistence schema, or framework type.

The editable, language-neutral diagram source is
[`docs/architecture/context-map.mmd`](../../architecture/context-map.mmd).
