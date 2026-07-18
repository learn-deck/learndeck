# 05 · Prove behaviour

## Outcome

I can use tests to protect a business rule and a boundary without making the
test suite depend on a running production stack.

## Diagnostic question

What would a fast test of an invariant prove that a route-level test alone
might obscure?

## Build

1. Write one domain-level test for the invariant from step 01.
2. Write one use-case test using the in-memory adapter from step 02.
3. Add one HTTP boundary test for a deliberate input or error mapping.
4. Name the command that runs the suite in your language path and execute it.
5. Record test paths, command output summary, and what each test is allowed to
   prove. Do not label a passing test as proof of every production concern.

Use [Google's testing guidance](../../references/source-index.md#testing) for
test-value trade-offs, not as a mandated testing pyramid.

## Exit question

For each of your three tests, name the behaviour it proves and one thing it
does not prove. Why is a test double acceptable at the port boundary here?

## Later review

Given a slow flaky integration test, decide whether it belongs in a fast inner
loop, a boundary suite, or a separate environment check.
