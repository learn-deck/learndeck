---
id: http
title: Make an API useful
goal: Translate one HTTP request into a use case without mixing transport, business rules, and persistence.
action: Create one command endpoint plus a status route. Map malformed transport input and known domain failures deliberately.
sources:
  - ./03-make-an-api-useful.md
  - ../../../references/source-index.md#http
questions:
  - id: http-diagnostic
    kind: diagnostic
    prompt: Why is a handler that holds business rules, SQL, and JSON formatting difficult to change or test?
    reference: ./03-make-an-api-useful.md
    rubric:
      - Identifies mixed responsibilities and multiple reasons for the handler to change.
      - Explains one testing or substitution cost created by the coupling.
  - id: http-exit
    kind: exit
    prompt: Trace one request from HTTP input to a domain decision and back. Where do malformed input and invariant violations stop?
    reference: ./03-make-an-api-useful.md
    rubric:
      - Traces a coherent transport-to-use-case-to-domain-to-response flow.
      - Stops malformed input at the HTTP boundary and a violated business invariant at the domain/application decision.
---

# 03 · Make an API useful

## Outcome

I can build one thin HTTP boundary that translates a request into a use-case
call and returns a deliberate success or problem response.

## Diagnostic question

Why is a route handler that contains business decisions, SQL queries, and JSON
formatting difficult to test and change independently?

## Build

> [!SCENARIO]
> `POST /bookings` can reject malformed JSON before it reaches the use case.
> The domain rejects a genuine double booking. These are different failures,
> so they deserve different messages and tests.

1. Choose one command endpoint for the use case from step 01.
2. In the HTTP adapter, parse and validate only transport-shaped input.
3. Translate the request to the application input, call the use case, and map
   known domain failures to stable responses.
4. Add a status/health route. If your project includes a tiny frontend, have it
   call or display that route; it is a visibility aid, not the course product.
5. If a guide is connected, ask it to check the documented Node.js development
   command. Run `npm run dev` yourself and record the route, command, and
   observed result; otherwise keep that record in the evidence form or in
   `NOTES.md` in your workspace.

Use the HTTP references in [the source index](../../../references/source-index.md#http)
to reason about resource semantics and problem responses.

## Exit question

Trace one request from HTTP input to domain decision and back to a response.
Where should a malformed JSON body stop, and where should a violated invariant
stop?

## Later review

Given a new error, decide whether it is a transport error, application decision,
or domain failure before choosing its HTTP response.

## Definition of done

Before answering, check that:

- One command endpoint and the status route are reachable with the documented development command.
- Malformed transport input stops at the HTTP boundary with a deliberate response.
- A double booking or other invariant failure produces a distinct stable response.
- You recorded the command, route, and observed results in your workspace or answer.

After you submit your answer, choose **Mark as self-reviewed and continue** if
you are working without a connected guide. Guide evaluation is optional, not
required; if a guide is connected, you may request feedback instead.
