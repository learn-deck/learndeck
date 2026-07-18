# Workshop v1 schemas

Workshop's exposed payloads are defined in the shared v1 message bundle and
OpenAPI document inventoried by [`../catalog.json`](../catalog.json). Internal
commands remain in the domain guide. Lease tokens are opaque HTTP credentials
and never appear in events or aggregate mementos; reads are projections, not the
`Attempt` aggregate. Exact lease-request redelivery uses a private confidential
response record, not a new public contract. Durable implementations must encrypt
and access-control that record and never log or publish its raw token.
The existing `workshop.revoke-attempt.v1` message is translated to Workshop's
private `RevokeAttempt` command; this does not extend the public v1 inventory.
