/** Mirrors the version 1 native driver protocol in routine_debug.rs. */
export interface DebugTarget {
    database: string;
    schema: string;
    name: string;
    routine_type: string;
    identity_args: string;
}
export interface DebugArgument {
    position: number;
    value: unknown;
}
export interface DebugBreakpoint {
    source_id: string;
    line: number;
}
export type DebugCommand =
    | {action: 'preview'; target: DebugTarget; arguments: DebugArgument[]}
    | {action: 'start'; preview_id: string; session_id: string}
    | {action: 'stop' | 'continue' | 'read_stack' | 'status'; session_id: string}
    | {action: 'step'; session_id: string; mode: 'into' | 'over' | 'out'}
    | {action: 'set_breakpoints'; session_id: string; breakpoints: DebugBreakpoint[]}
    | {action: 'read_variables'; session_id: string; frame_id: string; names: string[]};
export type DebugRead<T> =
    | {state: 'available'; value: T}
    | {state: 'partial' | 'stale'; value: T; reason: string}
    | {state: 'unavailable'; reason: string};
export interface DebugSource {
    source_id: string;
    text: string;
}
export interface DebugLocation {
    source_id: string;
    line: number;
}
export interface DebugFrame {
    frame_id: string;
    name: string;
    location: DebugRead<DebugLocation>;
}
export interface DebugVariable {
    name: string;
    data_type: string;
    value: DebugRead<unknown>;
}
export interface DebugSnapshot {
    session_id: string;
    revision: number;
    execution: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'unknown';
    transaction: 'open' | 'committed' | 'rolled_back' | 'unknown';
    resources: 'held' | 'released' | 'unknown';
    source: DebugRead<DebugSource>;
    stop: DebugRead<DebugLocation>;
    stack: DebugRead<DebugFrame[]>;
    variables: DebugRead<DebugVariable[]>;
    outputs: DebugRead<DebugVariable[]>;
    breakpoints: DebugRead<DebugBreakpoint[]>;
    error: string | null;
}
export type DebugResponse =
    | {
          kind: 'preview';
          version: 1;
          preview_id: string;
          target: DebugTarget;
          arguments: DebugArgument[];
          source: DebugRead<DebugSource>;
          warnings: string[];
      }
    | {kind: 'session'; version: 1; session: DebugSnapshot};
