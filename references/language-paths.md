# Language paths and dependency checks

The agent checks the selected path after the learner confirms a workspace. It
does not install packages or start a server. A missing tool is a clear setup
blocker, not a reason to silently change language.

## Node.js + TypeScript

Read-only checks:

```sh
node --version
npm --version
test -f package.json && npm pkg get scripts
```

If `package.json` exists, inspect whether it declares a `dev` and `test`
script. After the learner has created or confirmed the project, suggest one of:

```sh
npm run dev
npm test
```

If dependencies are missing, explain whether `npm install` or `npm ci` is
appropriate and wait for approval. Use `npm ci` only when a committed lockfile
already exists in the learner's workspace.

Suggested structure:

```text
<workspace>/
  src/domain/
  src/application/
  src/ports/
  src/adapters/http/
  src/adapters/persistence/
  test/
```

## Go

Read-only checks:

```sh
go version
go env GOMOD
test -f go.mod && go env GOPATH
```

After the learner has created or confirmed the module, suggest:

```sh
go run ./cmd/api
go test ./...
```

If module dependencies are required, explain `go mod tidy` or `go mod download`
and wait for approval. Do not create a module outside the confirmed workspace.

Suggested structure:

```text
<workspace>/
  cmd/api/
  internal/domain/
  internal/application/
  internal/ports/
  internal/adapters/http/
  internal/adapters/persistence/
```

## Bun + TypeScript

Read-only checks:

```sh
bun --version
test -f package.json && bun pm ls
```

After the learner has created or confirmed the project, suggest:

```sh
bun run dev
bun test
```

If packages are missing, explain `bun install` and wait for approval. Do not
assume Bun is a drop-in replacement for every Node native dependency.

Suggested structure:

```text
<workspace>/
  src/domain/
  src/application/
  src/ports/
  src/adapters/http/
  src/adapters/persistence/
  test/
```

## Development server rule

The server is the learner's project, not PatchQuest. After dependencies are
checked, the agent suggests the relevant command and asks the learner to run
it. It records the command and observed address/result through PatchQuest MCP
only after the learner reports it. A health/status route is enough initially; a
tiny frontend is optional and exists only to make backend behaviour visible.
