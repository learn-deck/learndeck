# 02 · Draw the hexagon

## Outcome

I can keep domain rules independent of frameworks and connect them through
application use cases, ports, and adapters.

## Diagnostic question

If a domain object imports a PostgreSQL client to save itself, what dependency
direction has been reversed? What makes that costly to change or test?

## Build

1. Draw four named areas for your workspace: domain, application, ports, and
   adapters. Record the chosen paths before creating files.
2. Move or create one use case that receives an input and invokes a domain
   operation.
3. Define a repository or clock port owned by the application/domain boundary.
   It should describe the capability needed, not a vendor API.
4. Implement one in-memory adapter behind that port and wire it at the outer
   application composition point.
5. Confirm that the inner code has no imports of the web framework, SQL driver,
   or environment package.

Use the original [Ports and Adapters article](../../references/source-index.md#hexagonal)
for the direction, not as a folder-name ritual.

## Exit question

For one dependency in your project, name the caller, the port owner, and the
adapter. Why should the port be shaped by the inside need rather than the
database's API?

## Later review

Classify each as a port or adapter: `TaskRepository`, PostgreSQL query client,
system clock, and Fastify handler.
