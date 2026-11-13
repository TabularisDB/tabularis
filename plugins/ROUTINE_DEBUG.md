# Routine debugger protocol v1

Host-side protocol for [#1411](https://github.com/TabularisDB/tabularis/issues/1411).
The native Oracle implementation is maintained in
[tabularis-oracle-plugin](https://github.com/TabularisDB/tabularis-oracle-plugin).
The paired Oracle change implements this RPC with dedicated DBMS_DEBUG target
and controller sessions. Older plugin releases omit the capability and remain
unsupported.

## Capability and wire format

Declare `capabilities.routine_debug: 1` only when every operation below works.
Omitted/unknown versions hide the debugger. This is independent of
`routine_management`, with no SQL fallback.

The optional `routine_debug` plugin RPC receives `{params, version:1, command}`.
`params` is resolved `ConnectionParams`. Desktop and web frontend requests use
`{connectionId, version:1, command}`; only the application resolves credentials
and native preview identities. Previews/sessions are scoped to browser owner
and connection. Rust types in `src-tauri/src/routine_debug.rs` define the wire
format; `packages/web-ui/src/types/routineDebug.ts` mirrors it.

| Action | Fields besides `action` | Behaviour |
| --- | --- | --- |
| `preview` | `target`, `arguments` | Read catalog/source only. Allocate no execution resources. |
| `start` | `preview_id`, `session_id` | Execute once, deduplicated by session ID. Stop at entry for breakpoint installation. |
| `continue` | `session_id` | Continue once to the next stop, completion or running snapshot. |
| `step` | `session_id`, `mode` | `into`, `over`, `out`. |
| `set_breakpoints` | `session_id`, `breakpoints` | Replace full set of `{source_id,line}`; lines are one-based. Return confirmed native breakpoints and rejection/partial reasons. |
| `read_stack` | `session_id` | Read frames with IDs scoped to this stop. |
| `read_variables` | `session_id`, `frame_id`, `names` | Read named variables only. Reject assignments, calls and expressions. |
| `status` | `session_id` | Observe only; never resume, restart or reconnect the target. |
| `stop` | `session_id` | Idempotently cancel target execution and release resources. For a never-started preview, the host sends its native preview ID to discard saved preview state without execution. |

`target` contains `database`, `schema`, `name`, `routine_type` and opaque
`identity_args`. Empty identity is valid only for unambiguous routines.
Arguments are `{position,value}` with unique one-based positions and bound
JSON values, never SQL expressions. Validate modes, types and overload against
the catalog. Revalidate the saved preview/source identity before start.
Variable reads accept at most 128 names, each non-blank and at most 128 UTF-8
bytes. An empty list requests the driver's default variable set; identifier
syntax is validated by the native driver without evaluating expressions.

Preview returns `{kind:"preview",version:1,preview_id,target,arguments,source,warnings}`.
All other actions return `{kind:"session",version:1,session:DebugSnapshot}`.
Snapshot revisions increase monotonically. Execution, transaction and resource
states are independent: completed does not imply committed or released.
Unobservable outcomes remain unknown. Source, stop, stack, variables, outputs
and breakpoints each carry available/partial/stale/unavailable states and reasons.
OUT/return values must be surfaced. Old values cannot remain available while
the target runs. `source_id` must identify immutable source; frame IDs expire
at the next stop.

## Safety and lifetime

- Opening/previewing never executes code. Explicit start explains engine
  semantics, missing debug information/privileges and possible external effects.
- Never automatically grant privileges, recompile routines or create persistent
  helper objects. Do not claim stop undoes committed or external effects.
- Use dedicated target/controller connections, never cached autocommit/query
  sessions. Native calls need bounded timeouts and responsive stop handling.
  The host limits operations to 30 seconds and stop/cleanup to five seconds;
  long-running native execution must return a running snapshot for polling.
  Handle `$/cancelRequest` and concurrent stop without restarting execution.
- The host records start before awaiting the plugin. Lost replies never cause
  automatic reruns. The plugin must also deduplicate session IDs.
- The host reserves preview capacity before the native call and discards unused
  native previews on close, expiry and disconnect. A native preview must have a
  bounded lifetime even if its response is lost or the host exits.
- Transport loss leaves the identity available for status/stop, with unknown
  outcomes. Stop must interrupt execution; detaching can let the routine run.
- Read-only drivers reject operations except status/stop. Production execution
  and inspection retain the write confirmation gate.
- Disconnect/session expiry request cleanup and log unconfirmed release. The
  plugin must release on process EOF/shutdown and implement an abandoned-session
  lease because the host can crash before stop.

## Oracle validation

Oracle's [DBMS_DEBUG](https://docs.oracle.com/en/database/oracle/oracle-database/19/arpls/DBMS_DEBUG.html)
uses separate target/controller sessions. It is deprecated by Oracle; support
requires that this native API and the necessary privileges remain available.
The plugin processes debugger RPCs on workers so stop/cancellation can interrupt
a running native call, and never uses its ordinary autocommit cache as a target.

The plugin's `tests/live_debugger.rs` extends its existing CI Oracle Free setup,
records Oracle/Instant Client versions, and checks:

1. A supported precompiled routine: inputs, OUT/return values, breakpoint,
   stepping, stack and variables.
2. An exception: execution failure, transaction outcome and resource release
   checked independently.
3. Stop, concurrent cancellation, process EOF and failed start: no rerun and
   no abandoned target/control sessions.
4. Missing privileges/debug information, unsupported types
   and changed source: no automatic DDL or privilege grants.

Passing fake-driver tests is not evidence of Oracle support.

### Recorded native integration

The [companion Oracle PR #26](https://github.com/TabularisDB/tabularis-oracle-plugin/pull/26)
at commit `b3d37a8c78e306bf345c3ee67ef08a1620822ba8` passed the
[live Oracle integration job](https://github.com/lejyfps/tabularis-oracle-plugin/actions/runs/42633512836/job/129215569679)
on November 9, 2026. The job ran the stdio plugin against Oracle AI Database
26ai Free `23.26.3.0.0`, using Instant Client `23.26.2.0.0`; the live test was
executed with `ORACLE_TEST_HOST` set. It confirmed the cases above, including
an entry stop before the routine's INSERT, numeric OUT/function return values,
all three step modes, rollback of uncommitted changes and release of both
target/controller sessions.

This evidence covers standalone procedures/functions with supported scalar
numeric/character arguments. Packaged overloads and composite/date parameters
remain unsupported; other Oracle versions require their own validation.
