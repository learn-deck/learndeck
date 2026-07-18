# Security Policy

PatchQuest is an educational reference under active development and has no
released, supported version yet.

PatchQuest does not have a public remote yet, so it does not currently offer a
repository-hosted private reporting channel. Until a remote exists, contact the
repository owner through an existing private channel and ask where to send a
coordinated report. Do not open a public issue or put vulnerability details in
an issue merely because private reporting is unavailable.

When the GitHub remote is created, the owner will enable GitHub private
vulnerability reporting. Reporters should then use **Security → Privately
report a vulnerability**. If that feature is temporarily unavailable, ask the
owner privately for a reporting channel; a public issue remains inappropriate.

Include the affected component, impact, reproduction conditions, and any
suggested mitigation. Do not include real API keys, credentials, private
repository contents, raw prompts, or patch payloads.

## Security boundary

The canonical fixture is trusted and repository-owned. PatchQuest does not yet
provide a secure sandbox for arbitrary code. Never use its future verifier to
run untrusted submissions directly on a host machine. Sandbox support requires
a separate threat model and security review.

Provider integrations, if added, must remain behind adapters and must validate
inputs, minimize capabilities, redact sensitive telemetry, and require explicit
operator configuration.

The portable HTTP contract intentionally leaves mission creation and its four
CQRS read operations unauthenticated for the deterministic educational demo.
Those public projections must never contain credentials, prompts, patch
contents, or private verifier output. Approval, rejection, cancellation,
runner work, and dead-letter replay require bearer authentication and local
role authorization. Bearer authentication is provider-neutral: each
implementation owns credential validation and authorization policy, and no
specific issuer, token claims, or scopes are implied by the root contract.
