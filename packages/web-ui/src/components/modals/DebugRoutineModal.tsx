import {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ThemeDialog} from '@/components/ui/ThemeDialog';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import {useProductionGuard} from '@/hooks/useProductionGuard';
import type {RoutineInfo} from '@/contexts/DatabaseContext';
import type {DebugCommand, DebugRead, DebugResponse} from '@/types/routineDebug';
import {isCallParameter, isOutputOnly, type RoutineParameterInfo} from '@/utils/routineCall';

interface Props {
    connectionId: string;
    routine: RoutineInfo;
    schema: string;
    database: string;
    onClose: () => void;
}

export const DebugRoutineModal = ({connectionId, routine, schema, database, onClose}: Props) => {
    const client = useTabularisClient();
    const {t} = useTranslation();
    const guardProductionWrite = useProductionGuard();
    const [parameters, setParameters] = useState<RoutineParameterInfo[] | null>(null);
    const [values, setValues] = useState<Record<number, string | null>>({});
    const [response, setResponse] = useState<DebugResponse | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [hasStarted, setHasStarted] = useState(false);
    const [watch, setWatch] = useState('');
    const started = useRef(false);
    const sessionId = useRef<string | null>(null);
    const pending = useRef(0);
    const snapshot = response?.kind === 'session' ? response.session : null;
    const paused = snapshot?.execution === 'paused';
    const released = snapshot?.resources === 'released';
    const source = response?.kind === 'preview' ? response.source : snapshot?.source;
    const stop = snapshot?.stop;
    const buttonClass =
        'px-3 py-2 rounded-lg bg-surface-secondary text-primary disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

    useEffect(() => {
        let active = true;
        client
            .call('get_routine_parameters', {
                connectionId,
                routineName: routine.name,
                schema,
                database,
                ...(routine.identity_args != null ? {identityArgs: routine.identity_args} : {}),
            })
            .then((result) => {
                if (active)
                    setParameters(result.filter((p) => isCallParameter(p) && !isOutputOnly(p)));
            })
            .catch((err: unknown) => {
                if (active) setError(String(err));
            });
        return () => {
            active = false;
        };
    }, [client, connectionId, routine.name, routine.identity_args, schema, database]);

    useEffect(
        () => () => {
            const id = sessionId.current;
            sessionId.current = null;
            if (id)
                void client
                    .call('routine_debug', {
                        connectionId,
                        version: 1,
                        command: {action: 'stop', session_id: id},
                    })
                    .catch((err: unknown) =>
                        console.error(
                            'Routine debugger cleanup could not confirm resource release:',
                            err,
                        ),
                    );
        },
        [client, connectionId],
    );

    const send = async (command: DebugCommand) => {
        pending.current += 1;
        setBusy(true);
        setError('');
        try {
            const next = await client.call('routine_debug', {connectionId, version: 1, command});
            if (next.kind === 'preview') sessionId.current = next.preview_id;
            if (next.kind === 'session' && next.session.resources === 'released')
                sessionId.current = null;
            setResponse((previous) =>
                previous?.kind === 'session' &&
                next.kind === 'session' &&
                previous.session.revision > next.session.revision
                    ? previous
                    : next,
            );
            return next;
        } catch (err) {
            setError(`${t('routineDebug.uncertain')} ${String(err)}`);
        } finally {
            pending.current -= 1;
            setBusy(pending.current > 0);
        }
    };

    const close = () => {
        if (sessionId.current && started.current && !released) {
            void send({action: 'stop', session_id: sessionId.current}).then((next) => {
                if (next?.kind === 'session' && next.session.resources === 'released') onClose();
            });
            return;
        }
        onClose();
    };

    const read = <T,>(value: DebugRead<T> | undefined) => {
        if (!value) return t('routineDebug.unavailable');
        return `${t(`routineDebug.${value.state}`)}${'reason' in value ? `: ${value.reason}` : ''}\n${'value' in value ? JSON.stringify(value.value, null, 2) : ''}`;
    };

    return (
        <ThemeDialog
            isOpen
            onClose={close}
            widthClass="w-[1000px]"
            title={`${t('routineDebug.title')}: ${schema}.${routine.name} (${routine.identity_args ?? ''})`}
        >
            <div className="p-6 space-y-4 overflow-y-auto text-primary">
                <p className="text-sm text-secondary">{t('routineDebug.warning')}</p>
                <p className="font-mono text-sm">
                    {database} / {schema} / {routine.name} / {routine.routine_type} /{' '}
                    {routine.identity_args ?? ''}
                </p>
                {!response && (
                    <>
                        {parameters?.map((parameter) => (
                            <div key={parameter.ordinal_position} className="text-sm">
                                <label className="block">
                                    {parameter.name} ({parameter.mode} {parameter.data_type})
                                    <input
                                        value={values[parameter.ordinal_position] ?? ''}
                                        disabled={values[parameter.ordinal_position] === null}
                                        onChange={(event) =>
                                            setValues({
                                                ...values,
                                                [parameter.ordinal_position]: event.target.value,
                                            })
                                        }
                                        className="w-full px-3 py-2 bg-base border border-strong rounded-lg text-primary focus:border-focus"
                                    />
                                </label>
                                <label className="flex gap-2">
                                    <input
                                        type="checkbox"
                                        checked={values[parameter.ordinal_position] === null}
                                        onChange={(event) =>
                                            setValues({
                                                ...values,
                                                [parameter.ordinal_position]: event.target.checked
                                                    ? null
                                                    : '',
                                            })
                                        }
                                    />
                                    NULL
                                </label>
                            </div>
                        ))}
                        <button
                            className={buttonClass}
                            disabled={busy || parameters === null}
                            onClick={() =>
                                void send({
                                    action: 'preview',
                                    target: {
                                        database,
                                        schema,
                                        name: routine.name,
                                        routine_type: routine.routine_type,
                                        identity_args: routine.identity_args ?? '',
                                    },
                                    arguments: (parameters ?? []).map((p) => ({
                                        position: p.ordinal_position,
                                        value:
                                            values[p.ordinal_position] ??
                                            (values[p.ordinal_position] === null ? null : ''),
                                    })),
                                })
                            }
                        >
                            {t('routineDebug.preview')}
                        </button>
                    </>
                )}
                {response?.kind === 'preview' && (
                    <>
                        <pre className="font-mono whitespace-pre-wrap">
                            {JSON.stringify(response.arguments, null, 2)}
                        </pre>
                        {response.warnings.map((warning, index) => (
                            <p key={index} className="text-accent-warning">
                                {warning}
                            </p>
                        ))}
                        <button
                            className={buttonClass}
                            disabled={busy || hasStarted}
                            onClick={async () => {
                                if (
                                    !sessionId.current ||
                                    started.current ||
                                    !(await guardProductionWrite(connectionId))
                                )
                                    return;
                                if (!sessionId.current || started.current) return;
                                started.current = true;
                                setHasStarted(true);
                                await send({
                                    action: 'start',
                                    preview_id: sessionId.current,
                                    session_id: sessionId.current,
                                });
                            }}
                        >
                            {t('routineDebug.start')}
                        </button>
                    </>
                )}
                {hasStarted && !released && (
                    <div className="flex flex-wrap gap-2">
                        <button
                            className={buttonClass}
                            disabled={busy || !paused}
                            onClick={async () => {
                                if (sessionId.current && (await guardProductionWrite(connectionId)))
                                    await send({action: 'continue', session_id: sessionId.current});
                            }}
                        >
                            {t('routineDebug.continue')}
                        </button>
                        {(['into', 'over', 'out'] as const).map((mode) => (
                            <button
                                key={mode}
                                className={buttonClass}
                                disabled={busy || !paused}
                                onClick={async () => {
                                    if (
                                        sessionId.current &&
                                        (await guardProductionWrite(connectionId))
                                    )
                                        await send({
                                            action: 'step',
                                            session_id: sessionId.current,
                                            mode,
                                        });
                                }}
                            >
                                {t(`routineDebug.${mode}`)}
                            </button>
                        ))}
                        <button
                            className={buttonClass}
                            disabled={busy}
                            onClick={() => {
                                if (sessionId.current)
                                    void send({action: 'status', session_id: sessionId.current});
                            }}
                        >
                            {t('routineDebug.status')}
                        </button>
                        <button
                            className={buttonClass}
                            onClick={() => {
                                if (sessionId.current)
                                    void send({action: 'stop', session_id: sessionId.current});
                            }}
                        >
                            {t('routineDebug.stop')}
                        </button>
                    </div>
                )}
                {error && (
                    <p role="alert" className="text-accent-error">
                        {error}
                    </p>
                )}
                {error && hasStarted && !released && (
                    <button className={buttonClass} onClick={onClose}>
                        {t('routineDebug.closeUnconfirmed')}
                    </button>
                )}
                {busy && <p role="status">{t('routineDebug.stale')}</p>}
                {snapshot && (
                    <p role="status">
                        {t('routineDebug.execution')}: {t(`routineDebug.${snapshot.execution}`)} ·{' '}
                        {t('routineDebug.transaction')}: {t(`routineDebug.${snapshot.transaction}`)}{' '}
                        · {t('routineDebug.resources')}: {t(`routineDebug.${snapshot.resources}`)}
                    </p>
                )}
                {snapshot?.error && (
                    <p role="alert" className="text-accent-error">
                        {snapshot.error}
                    </p>
                )}
                {source && (
                    <section aria-label={t('routineDebug.source')}>
                        <h3>
                            {t('routineDebug.source')} ({t(`routineDebug.${source.state}`)})
                        </h3>
                        {'reason' in source && <p>{source.reason}</p>}
                        {'value' in source && (
                            <pre className="font-mono text-sm overflow-auto">
                                {source.value.text.split('\n').map((line, index) => {
                                    const lineNumber = index + 1;
                                    const current =
                                        stop &&
                                        'value' in stop &&
                                        stop.value.source_id === source.value.source_id &&
                                        stop.value.line === lineNumber;
                                    const breakpoints =
                                        snapshot?.breakpoints && 'value' in snapshot.breakpoints
                                            ? snapshot.breakpoints.value
                                            : [];
                                    const marked = breakpoints.some(
                                        (bp) =>
                                            bp.source_id === source.value.source_id &&
                                            bp.line === lineNumber,
                                    );
                                    return (
                                        <span
                                            key={index}
                                            className={`block ${current ? 'bg-accent-primary/15' : ''}`}
                                        >
                                            <button
                                                disabled={!paused || busy || !sessionId.current}
                                                aria-label={t('routineDebug.breakpoint', {
                                                    line: lineNumber,
                                                })}
                                                aria-pressed={marked}
                                                className={`${buttonClass} py-0`}
                                                onClick={() => {
                                                    if (sessionId.current)
                                                        void send({
                                                            action: 'set_breakpoints',
                                                            session_id: sessionId.current,
                                                            breakpoints: marked
                                                                ? breakpoints.filter(
                                                                      (bp) =>
                                                                          !(
                                                                              bp.source_id ===
                                                                                  source.value
                                                                                      .source_id &&
                                                                              bp.line === lineNumber
                                                                          ),
                                                                  )
                                                                : [
                                                                      ...breakpoints,
                                                                      {
                                                                          source_id:
                                                                              source.value
                                                                                  .source_id,
                                                                          line: lineNumber,
                                                                      },
                                                                  ],
                                                        });
                                                }}
                                            >
                                                {current ? '→' : marked ? '●' : ' '} {lineNumber}
                                            </button>{' '}
                                            {line}
                                        </span>
                                    );
                                })}
                            </pre>
                        )}
                    </section>
                )}
                {snapshot && (
                    <>
                        <h3>{t('routineDebug.stack')}</h3>
                        <pre className="whitespace-pre-wrap font-mono text-sm">
                            {read(snapshot.stack)}
                        </pre>
                        <button
                            className={buttonClass}
                            disabled={!paused || busy}
                            onClick={() => {
                                if (sessionId.current)
                                    void send({
                                        action: 'read_stack',
                                        session_id: sessionId.current,
                                    });
                            }}
                        >
                            {t('routineDebug.stack')}
                        </button>
                        <label className="block">
                            {t('routineDebug.watches')}
                            <input
                                value={watch}
                                onChange={(e) => setWatch(e.target.value)}
                                className="w-full px-3 py-2 bg-base border border-strong rounded-lg focus:border-focus"
                            />
                        </label>
                        {'value' in snapshot.stack &&
                            snapshot.stack.value.map((frame) => (
                                <button
                                    key={frame.frame_id}
                                    className={buttonClass}
                                    disabled={!paused || busy}
                                    onClick={async () => {
                                        if (
                                            sessionId.current &&
                                            (await guardProductionWrite(connectionId))
                                        )
                                            await send({
                                                action: 'read_variables',
                                                session_id: sessionId.current,
                                                frame_id: frame.frame_id,
                                                names: watch
                                                    .split(',')
                                                    .map((s) => s.trim())
                                                    .filter(Boolean),
                                            });
                                    }}
                                >
                                    {t('routineDebug.variables')}: {frame.name}
                                </button>
                            ))}
                        <h3>{t('routineDebug.variables')}</h3>
                        <pre className="whitespace-pre-wrap font-mono text-sm">
                            {read(snapshot.variables)}
                        </pre>
                        <h3>{t('routineDebug.outputs')}</h3>
                        <pre className="whitespace-pre-wrap font-mono text-sm">
                            {read(snapshot.outputs)}
                        </pre>
                    </>
                )}
            </div>
        </ThemeDialog>
    );
};
