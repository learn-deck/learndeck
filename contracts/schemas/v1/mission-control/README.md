# Mission Control v1 schemas

Mission Control's exposed payloads are defined in the shared v1 message bundle
and OpenAPI document inventoried by [`../catalog.json`](../catalog.json).
Internal commands remain in the domain guide. HTTP reads are CQRS projections,
not the `Mission` aggregate or its persistence representation.
