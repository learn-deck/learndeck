# 03 · Make an API useful

## Outcome

I can build one thin HTTP boundary that translates a request into a use-case
call and returns a deliberate success or problem response.

## Diagnostic question

Why is a route handler that contains business decisions, SQL queries, and JSON
formatting difficult to test and change independently?

## Build

1. Choose one command endpoint for the use case from step 01.
2. In the HTTP adapter, parse and validate only transport-shaped input.
3. Translate the request to the application input, call the use case, and map
   known domain failures to stable responses.
4. Add a status/health route. If your project includes a tiny frontend, have it
   call or display that route; it is a visibility aid, not the course product.
5. Ask the agent to suggest your language's development command. Run it
   yourself and record the route, command, and observed result.

Use the HTTP references in [the source index](../../references/source-index.md#http)
to reason about resource semantics and problem responses.

## Exit question

Trace one request from HTTP input to domain decision and back to a response.
Where should a malformed JSON body stop, and where should a violated invariant
stop?

## Later review

Given a new error, decide whether it is a transport error, application decision,
or domain failure before choosing its HTTP response.
