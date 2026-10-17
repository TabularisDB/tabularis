# EXPLAIN parser sandbox design

## Boundary

EXPLAIN parser bundles run in the same sandboxed `tabularis-plugin` iframe used
for UI extensions. Each parser module gets an isolated frame with
`sandbox="allow-scripts"`, a restrictive guest CSP (`connect-src 'none'`), and
no Tauri window or command bridge. The host transfers only raw plan text to a
parser and receives a structured-cloneable plan result. Parser metadata
(`engine`, `format`, optional `label`, and whether `sniff` is available) is the
only information returned when a bundle loads.

The frame receives no filesystem API, connection data, secrets, or generic
command proxy. Parser failures are returned as errors and remain isolated to
the current parse request.

## API and migration

Iframe messaging is asynchronous. `RegisteredExplainParser.parse` and `sniff`
may therefore return promises, and package helpers that dispatch to a parser
(`parseRawExplain`, `resolveExplainOutput`, `parseExplain`, `parseExplainFor`,
`detectFormat`, and `detectFormatFor`) are asynchronous. Callers must await
them.

Bundles continue to export `__tabularis_explain_parser__` as one parser or an
array. The bundle's external `@tabularis/explain` global exists only inside the
guest. The host no longer evaluates a bundle or receives parser functions.
Existing EXPLAIN plugins keep their descriptor shape; callers that depended on
synchronous parser helpers need the async migration above.

## Lifecycle

The plugin loader creates one hidden frame per declared module and shares that
frame among the module's declared formats. When the enabled-plugin set changes,
the host unregisters format wrappers, closes the message ports, and removes the
frames. A module load or parser error does not stop other plugins from loading.
