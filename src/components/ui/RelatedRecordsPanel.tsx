import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  X,
  ExternalLink,
  RefreshCw,
  AlertCircle,
  GripHorizontal,
} from 'lucide-react';
import { MiniResultGrid } from './MiniResultGrid';
import { useReferencedRecord } from '../../hooks/useReferencedRecord';
import type { ForeignKey } from '../../types/editor';

interface RelatedRecordsPanelProps {
  activeFkQuery: {
    fk: ForeignKey;
    value: unknown;
    sourceColumnType?: string;
  };
  connectionId: string;
  driver?: string | null;
  schema?: string | null;
  onClose: () => void;
  onNavigateToTab: (fk: ForeignKey, value: unknown) => void;
}

export function RelatedRecordsPanel({
  activeFkQuery,
  connectionId,
  driver,
  schema,
  onClose,
  onNavigateToTab,
}: RelatedRecordsPanelProps) {
  const { fk, value, sourceColumnType } = activeFkQuery;

  const { result, error, isLoading, loadRecord } = useReferencedRecord({
    connectionId,
    fk,
    value,
    driver,
    schema,
    sourceColumnType,
  });

  // Resize State
  const [height, setHeight] = useState<number>(260);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      // In bottom panel, moving mouse UP (smaller clientY) increases panel height
      const newHeight = window.innerHeight - e.clientY;
      // Constraint to safe limits (120px to 80% of screen height)
      setHeight(Math.max(120, Math.min(newHeight, window.innerHeight * 0.8)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Format value for display in the header
  const formattedValue = value === null ? 'NULL' : String(value);

  return (
    <div
      ref={panelRef}
      id="fk-related-panel"
      className="relative flex flex-col border-t border-strong bg-elevated text-primary shadow-2xl select-none select-none transition-shadow"
      style={{ height: `${height}px` }}
    >
      {/* Resizing Drag Handle */}
      <div
        onMouseDown={handleMouseDown}
        className="group absolute top-0 left-0 right-0 h-1.5 cursor-row-resize z-50 border-t-2 border-transparent hover:border-accent-primary active:border-accent-primary transition-colors flex items-center justify-center"
        title="Drag to resize panel"
      >
        <GripHorizontal
          size={14}
          className="opacity-0 group-hover:opacity-100 group-active:opacity-100 text-accent-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-opacity duration-150"
        />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-strong select-none bg-overlay/50 backdrop-blur-sm grow-0 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-secondary uppercase tracking-wider">
            Related Record
          </span>
          <span
            className="text-xs px-2 py-0.5 rounded bg-surface-tertiary/40 border border-strong font-mono truncate text-accent-info max-w-[200px]"
            title={fk.ref_table}
          >
            {fk.ref_table}
          </span>
          <span className="text-xs text-muted font-medium select-none shrink-0">
            ({fk.ref_column} = {formattedValue})
          </span>
        </div>

        {/* Toolbar actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Refresh Action */}
          <button
            type="button"
            onClick={loadRecord}
            className="p-1 rounded text-muted hover:text-primary hover:bg-surface-secondary transition-all disabled:opacity-40"
            title="Refresh related record"
            disabled={isLoading}
          >
            <RefreshCw
              size={14}
              className={isLoading ? 'animate-spin text-accent-primary' : ''}
            />
          </button>

          {/* Open in Full Tab Action */}
          <button
            type="button"
            onClick={() => onNavigateToTab(fk, value)}
            className="p-1 rounded text-muted hover:text-primary hover:bg-surface-secondary transition-all"
            title="Open referenced table in new tab"
          >
            <ExternalLink size={14} />
          </button>

          <div className="h-4 w-[1px] bg-strong mx-1" />

          {/* Close Action */}
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-muted hover:text-accent-error hover:bg-accent-error/10 transition-all"
            title="Close panel"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Body Content */}
      <div className="flex-1 min-h-0 overflow-hidden relative bg-base/30">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center text-muted gap-2.5">
            <RefreshCw size={18} className="animate-spin text-accent-primary" />
            <span className="text-sm font-medium animate-pulse">
              Fetching related records...
            </span>
          </div>
        ) : error ? (
          <div className="h-full flex flex-col items-center justify-center p-4 text-center">
            <AlertCircle
              size={32}
              className="text-accent-error mb-2 animate-bounce"
            />
            <span className="text-sm font-medium text-primary mb-1">
              Failed to load referenced record
            </span>
            <span className="text-xs text-muted font-mono max-w-md bg-accent-error/5 border border-accent-error/20 rounded p-2 overflow-auto max-h-[80px] custom-scrollbar">
              {error}
            </span>
          </div>
        ) : result ? (
          <MiniResultGrid
            columns={result.columns}
            rows={result.rows}
            loading={false}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-muted text-sm italic">
            No related records found.
          </div>
        )}
      </div>
    </div>
  );
}
