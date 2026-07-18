# Workshop v1 schemas

Workshop's exposed payloads are defined in the shared v1 message bundle and
OpenAPI document inventoried by [`../catalog.json`](../catalog.json). Internal
commands remain in the domain guide. Lease tokens are opaque HTTP credentials
and never appear in events; reads are projections, not the `Attempt` aggregate.
