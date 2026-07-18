# ADR 0001: Create PatchQuest as a fresh, independently authored project

- Status: accepted
- Date: 2026-07-12

## Context

Earlier courses contain useful teaching lessons, but importing their files,
package metadata, configuration, or history would blur provenance and constrain
the new domain. This ADR documents an engineering provenance decision rather
than making a legal characterization.

## Decision

Create PatchQuest in a new directory with independently authored language,
contracts, documentation, tests, configuration, and eventual Git history.
Earlier material may inform which distributed-systems failure modes deserve
teaching, but no earlier file or mechanically noun-swapped implementation is
copied. Do not connect, fork, synchronize, or import an earlier repository.

Before fresh Git initialization and again before the first release:

1. inventory PatchQuest files and confirm there is no nested `.git`, inherited
   lockfile, package metadata, or remote configuration;
2. search for earlier course domain names and recognizable source fragments;
3. compare candidate files or hashes when a similarity needs investigation;
4. record any external technical source used for a design choice in the
   relevant ADR or documentation; and
5. resolve unexplained matches before publication.

These checks are evidence of the authorship process, not a guarantee that common
architectural terms or independently written patterns will be unique.

## Consequences

The initial pace is slower because foundations are written deliberately. In
return, provenance is reviewable, licensing is coherent, the domain stands on
its own, and future stacks share a neutral contract rather than inherited code.
