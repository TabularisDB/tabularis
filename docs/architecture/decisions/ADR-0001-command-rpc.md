# ADR-0001: Preserve command semantics through versioned RPC

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

The desktop frontend invokes a large Tauri command surface. Modeling the same operations as individually designed REST resources would create a second public contract, duplicate transport code, and allow desktop and web behavior to drift. Many operations are commands, jobs, or queries that do not map naturally to resource-oriented CRUD.

## Decision

Expose browser-callable application operations through a versioned command RPC contract. Command names, request types, response types, authorization requirements, and errors are defined once and shared by both transports.

The initial HTTP shape is `POST /api/v1/rpc/{command}`. Responses use one success or error envelope and include a request ID on errors. Existing Tauri command names and payloads remain backward compatible while their business logic is extracted into shared Rust application services.

RPC dispatchers perform only transport duties: authentication, authorization, deserialization, validation at the transport boundary, service invocation, and response mapping. They must not contain copied business logic.

## Consequences

- Contract tests can exercise the same operation through Tauri and HTTP adapters.
- Existing commands can migrate incrementally without a big-bang API rewrite.
- RPC versioning and authorization metadata must be explicit.
- Resource caching and standard REST tooling are less automatic and must be added only where justified.

## Rejected alternatives

### Duplicate REST API

Rejected because hundreds of separately modeled endpoints would duplicate semantics and increase parity drift. Purpose-built non-RPC endpoints remain appropriate for health, session negotiation, uploads, downloads, events, static assets, and authentication.

### Expose Tauri IPC directly to browsers

Rejected because Tauri IPC is unavailable in a normal browser and does not provide the required network security boundary.

### GraphQL

Rejected because it adds a second schema and resolver model without removing the need to support command and job semantics.

### gRPC or gRPC-Web

Rejected for the initial implementation because it adds code generation and browser proxy complexity while the current JSON command payloads map directly to JSON RPC over HTTP.
