# Architecture and backend source index

These references anchor the course's questions. They are not a required reading
pile: read only the source relevant to the current step.

## DDD

- Eric Evans, *Domain-Driven Design Reference* (free reference):
  <https://www.domainlanguage.com/ddd/reference/>.
- Vaughn Vernon, *Effective Aggregate Design*:
  <https://www.dddcommunity.org/library/vernon_2011/>.

Use these to discuss ubiquitous language, invariants, aggregate boundaries, and
the distinction between a model decision and a persistence detail.

## Hexagonal

- Alistair Cockburn, *Hexagonal Architecture*:
  <https://alistair.cockburn.us/hexagonal-architecture/>.
- Robert C. Martin, *The Clean Architecture*:
  <https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html>.

Use these to reason about dependency direction and ports/adapters. Folder names
are secondary; the dependency direction is the point.

## HTTP

- IETF, *HTTP Semantics* (RFC 9110): <https://www.rfc-editor.org/rfc/rfc9110>.
- IETF, *Problem Details for HTTP APIs* (RFC 9457):
  <https://www.rfc-editor.org/rfc/rfc9457>.

Use these for deliberate request/response boundaries and problem responses.

## Persistence

- Martin Fowler, *Repository*: <https://martinfowler.com/eaaCatalog/repository.html>.
- Martin Fowler, *Unit of Work*: <https://martinfowler.com/eaaCatalog/unitOfWork.html>.

Use these to talk about persistence capabilities, mapping, and transaction
boundaries—without making a database model the domain model.

## Testing

- Google Testing Blog, *Just Say No to More End-to-End Tests*:
  <https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html>.
- Kent Beck, *Test Driven Development: By Example* (book):
  <https://www.oreilly.com/library/view/test-driven-development/0321146530/>.

Use these as trade-off references for fast feedback and boundary confidence; no
single test-pyramid shape is mandatory.

## Reliability

- AWS, *Retries and backoff with jitter*:
  <https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/>.
- Chris Richardson, *Transactional Outbox pattern*:
  <https://microservices.io/patterns/data/transactional-outbox.html>.

Use these to reason about transient failures, duplicate delivery, idempotency,
and the limits of retries. Do not claim exactly-once delivery without evidence.

## Observability and operations

- OpenTelemetry, *What is OpenTelemetry?*:
  <https://opentelemetry.io/docs/what-is-opentelemetry/>.
- The Twelve-Factor App: <https://12factor.net/>.

Use these to choose useful signals, protect sensitive values, and document the
minimum needed to run a service.
