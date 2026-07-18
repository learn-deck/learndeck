# Security boundary

LearnDeck is a local course runner. Its browser server binds only to
`127.0.0.1`; the MCP integration uses local stdio. It stores selected workspace
paths, learner answers, feedback, and progress in an ignored SQLite database.

Do not enter credentials, production data, private URLs, customer code, or
secrets into the course UI or its progress database. Do not expose the local
server on a network interface without first adding authentication and a threat
model.

MCP tools intentionally cannot execute learner code, install dependencies, or
read arbitrary workspace files. They record learner-reported evidence and
agent-provided feedback only. Agent hosts should show tool calls and require
their normal approval controls for writes.

The standalone app may detect Claude Code or Cursor from their local command,
application, or MCP configuration signals. It returns only connection status to
the browser. A Connect click can add the `learndeck` MCP entry to that host's
user configuration; it does not read credentials, alter other MCP entries, or
launch the host application.
