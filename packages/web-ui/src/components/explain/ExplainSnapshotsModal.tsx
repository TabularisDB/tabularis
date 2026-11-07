import {memo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {type ExplainSnapshot, formatCost, formatTime} from '@tabularis/explain';
import {Camera, Pin, PinOff, Trash2, X, Split, Calendar, Database} from 'lucide-react';
import clsx from 'clsx';

interface ExplainSnapshotsModalProps {
    isOpen: boolean;
    onClose: () => void;
    snapshots: ExplainSnapshot[];
    currentBaselineId: string | null;
    onSelectBaseline: (snapshot: ExplainSnapshot) => void;
    onDeleteSnapshot: (id: string) => void;
    onTogglePinSnapshot: (id: string) => void;
    onSaveCurrent: (name: string) => void;
    canSaveCurrent: boolean;
}

export const ExplainSnapshotsModal = memo(
    ({
        isOpen,
        onClose,
        snapshots,
        currentBaselineId,
        onSelectBaseline,
        onDeleteSnapshot,
        onTogglePinSnapshot,
        onSaveCurrent,
        canSaveCurrent,
    }: ExplainSnapshotsModalProps) => {
        const {t} = useTranslation();
        const [newSnapshotName, setNewSnapshotName] = useState('');

        if (!isOpen) return null;

        const handleSave = (e: React.FormEvent) => {
            e.preventDefault();
            if (!canSaveCurrent) return;
            onSaveCurrent(newSnapshotName);
            setNewSnapshotName('');
        };

        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden text-xs">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-default bg-base/40">
                        <div className="flex items-center gap-2">
                            <Camera size={16} className="text-accent" />
                            <h2 className="font-semibold text-primary text-sm">
                                {t(
                                    'editor.visualExplain.snapshotsTitle',
                                    'Plan Snapshots & Baselines',
                                )}
                            </h2>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-1 rounded text-secondary hover:text-primary hover:bg-surface-secondary"
                            title={t('common.close', 'Close')}
                        >
                            <X size={16} />
                        </button>
                    </div>

                    {/* Save Current Snapshot Form */}
                    {canSaveCurrent && (
                        <form
                            onSubmit={handleSave}
                            className="flex gap-2 p-4 border-b border-default bg-surface/30"
                        >
                            <input
                                type="text"
                                value={newSnapshotName}
                                onChange={(e) => setNewSnapshotName(e.target.value)}
                                placeholder={t(
                                    'editor.visualExplain.snapshotNamePlaceholder',
                                    'Enter snapshot name (e.g. Before index)...',
                                )}
                                className="flex-1 px-3 py-1.5 rounded bg-base border border-default text-primary placeholder:text-muted focus:outline-none focus:border-focus text-xs"
                            />
                            <button
                                type="submit"
                                className="px-3 py-1.5 rounded bg-accent-primary hover:bg-accent-primary/90 text-inverse font-medium transition-colors"
                            >
                                {t('editor.visualExplain.saveSnapshot', 'Save Snapshot')}
                            </button>
                        </form>
                    )}

                    {/* Snapshots List */}
                    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
                        {snapshots.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 text-muted gap-2">
                                <Camera size={28} className="opacity-40" />
                                <span>
                                    {t(
                                        'editor.visualExplain.noSnapshots',
                                        'No plan snapshots saved yet.',
                                    )}
                                </span>
                            </div>
                        ) : (
                            snapshots.map((snap) => {
                                const isBaseline = currentBaselineId === snap.id;
                                return (
                                    <div
                                        key={snap.id}
                                        className={clsx(
                                            'flex items-center justify-between gap-3 p-3 rounded-lg border transition-all',
                                            isBaseline
                                                ? 'bg-accent-primary/10 border-accent-primary'
                                                : 'bg-base/60 border-default hover:border-strong',
                                        )}
                                    >
                                        <div className="flex flex-col min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="font-semibold text-primary truncate">
                                                    {snap.name}
                                                </span>
                                                {isBaseline && (
                                                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-accent-primary text-inverse font-medium">
                                                        {t(
                                                            'editor.visualExplain.activeBaseline',
                                                            'Active Baseline',
                                                        )}
                                                    </span>
                                                )}
                                                {snap.isPinned && (
                                                    <Pin
                                                        size={12}
                                                        className="text-accent shrink-0"
                                                    />
                                                )}
                                            </div>

                                            <div className="flex items-center gap-3 text-muted text-[11px] mt-1">
                                                <span className="flex items-center gap-1">
                                                    <Calendar size={11} />
                                                    {new Date(snap.createdAt).toLocaleDateString()}
                                                </span>
                                                {snap.context?.engine && (
                                                    <span className="flex items-center gap-1 font-mono uppercase">
                                                        <Database size={11} />
                                                        {snap.context.engine}
                                                    </span>
                                                )}
                                                {snap.totalCost != null && (
                                                    <span>
                                                        {t('editor.visualExplain.cost')}:{' '}
                                                        {formatCost(snap.totalCost)}
                                                    </span>
                                                )}
                                                {snap.executionTimeMs != null && (
                                                    <span>
                                                        {t('editor.visualExplain.time')}:{' '}
                                                        {formatTime(snap.executionTimeMs)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <button
                                                type="button"
                                                onClick={() => onSelectBaseline(snap)}
                                                className={clsx(
                                                    'flex items-center gap-1 px-2.5 py-1 rounded border transition-colors text-xs font-medium',
                                                    isBaseline
                                                        ? 'bg-accent-primary text-inverse border-accent-primary'
                                                        : 'bg-surface hover:bg-surface-secondary text-primary border-default',
                                                )}
                                            >
                                                <Split size={12} />
                                                <span>
                                                    {isBaseline
                                                        ? t(
                                                              'editor.visualExplain.isBaseline',
                                                              'Selected',
                                                          )
                                                        : t(
                                                              'editor.visualExplain.setAsBaseline',
                                                              'Compare',
                                                          )}
                                                </span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => onTogglePinSnapshot(snap.id)}
                                                className="p-1 rounded text-secondary hover:text-primary hover:bg-surface-secondary"
                                                title={
                                                    snap.isPinned
                                                        ? t(
                                                              'editor.visualExplain.unpinSnapshot',
                                                              'Unpin',
                                                          )
                                                        : t(
                                                              'editor.visualExplain.pinSnapshot',
                                                              'Pin',
                                                          )
                                                }
                                            >
                                                {snap.isPinned ? (
                                                    <PinOff size={14} />
                                                ) : (
                                                    <Pin size={14} />
                                                )}
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => onDeleteSnapshot(snap.id)}
                                                className="p-1 rounded text-secondary hover:text-accent-error hover:bg-surface-secondary"
                                                title={t('common.delete', 'Delete')}
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>
        );
    },
);
