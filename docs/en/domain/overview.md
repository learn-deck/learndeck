# Domain overview

PatchQuest coordinates bounded delegated work. A human defines a coding mission
against an immutable starting revision, explicit allowed scope, requested runner
capabilities, an attempt budget, and executable acceptance gates. A runner may
lease an attempt and submit an artifact. A separate verifier evaluates that exact
artifact. A human remains responsible for final completion approval.

The system is split into three bounded contexts because these responsibilities
have different rules and rates of change:

- **Mission Control** owns what success means and the mission lifecycle.
- **Workshop** owns how an authorized attempt is leased and performed.
- **Verification and Review** owns independent evidence and recommendations.

The central consistency problem is not “run an AI model.” It is preserving the
identity of the mission revision, starting revision, gate set, artifact, verdict,
and approval through retries and asynchronous delivery.

## Trust and security boundary

The canonical runner is deterministic and uses a trusted repository-owned
fixture. Provider credentials, SDK types, prompts, model names, and trace payloads
do not belong in the domain model. The initial verifier never offers arbitrary
host-code execution. A secure sandbox is separate work with its own threat model.

## Standards boundary

PatchQuest uses provider-neutral concepts informed by:

- [A2A key concepts](https://a2a-protocol.org/latest/topics/key-concepts/) for
  distinguishing work status, messages, and artifacts;
- [MCP architecture](https://modelcontextprotocol.io/specification/latest/architecture)
  for schema-defined boundaries and explicit consent and validation concerns;
- [OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/)
  for observable traces and spans;
- [GitHub guidance for coding agents](https://docs.github.com/en/copilot/tutorials/cloud-agent/get-the-best-results)
  for exact build, test, and validation instructions.

PatchQuest v1 does not claim A2A or MCP compliance. Optional adapters may
implement protocols later without changing the core language.
