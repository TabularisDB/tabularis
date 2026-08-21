import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Play, Check, ListChecks } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { statementLabel } from '../../utils/sql';

interface QuerySelectionModalProps {
  isOpen: boolean;
  queries: string[];
  onSelect: (query: string) => void;
  onRunAll: (queries: string[]) => void;
  onRunSelected: (queries: string[]) => void;
  onClose: () => void;
}

const QuerySelectionContent = ({ queries, onSelect, onRunAll, onRunSelected, onClose }: Omit<QuerySelectionModalProps, 'isOpen'>) => {
  const { t } = useTranslation();
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    itemRefs.current[focusedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex]);

  const toggleSelection = useCallback((index: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedIndices(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIndices(prev =>
      prev.size === queries.length ? new Set() : new Set(queries.map((_, i) => i))
    );
  }, [queries]);

  const handleRunSelected = useCallback(() => {
    if (selectedIndices.size === 0) return;
    const selected = queries.filter((_, i) => selectedIndices.has(i));
    onRunSelected(selected);
  }, [queries, selectedIndices, onRunSelected]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex(prev => Math.min(prev + 1, queries.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      onSelect(queries[focusedIndex]);
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onRunAll(queries);
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      handleRunSelected();
    } else if (e.key === ' ') {
      e.preventDefault();
      toggleSelection(focusedIndex);
    } else {
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 9 && num <= queries.length) {
        e.preventDefault();
        onSelect(queries[num - 1]);
      }
    }
  }, [queries, focusedIndex, onSelect, onRunAll, handleRunSelected, toggleSelection]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const allSelected = selectedIndices.size === queries.length;
  const hasSelection = selectedIndices.size > 0;

  return (
    <div className="bg-elevated border border-default rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-default">
        <div>
          <h3 className="text-base font-semibold text-white">{t('editor.querySelection.title')}</h3>
          <p className="text-xs text-muted mt-0.5">
            {t('editor.querySelection.queriesFound', { count: queries.length })}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-muted hover:text-white transition-colors p-1 rounded hover:bg-surface-secondary"
        >
          <X size={18} />
        </button>
      </div>

      {/* Query list */}
      <div ref={listRef} className="flex-1 overflow-y-auto py-2 px-3">
        {queries.map((q, i) => {
          const isSelected = selectedIndices.has(i);
          const isFocused = focusedIndex === i;
          return (
            <div
              key={i}
              ref={el => { itemRefs.current[i] = el; }}
              onMouseEnter={() => setFocusedIndex(i)}
              className={`group flex items-start gap-3 px-3 py-2.5 rounded-lg mb-1 cursor-pointer transition-all ${
                isSelected
                  ? 'bg-blue-500/10 border border-blue-500/40'
                  : isFocused
                    ? 'bg-surface-secondary border border-transparent'
                    : 'border border-transparent hover:bg-surface-secondary/60'
              }`}
            >
              {/* Checkbox area */}
              <button
                onClick={(e) => toggleSelection(i, e)}
                className={`w-[22px] h-[22px] mt-0.5 shrink-0 rounded-md border-2 flex items-center justify-center transition-all ${
                  isSelected
                    ? 'bg-blue-500 border-blue-500 text-white scale-100'
                    : 'border-strong/60 text-transparent hover:border-blue-400 group-hover:border-blue-400/60'
                }`}
              >
                <Check size={13} strokeWidth={3} />
              </button>

              {/* Index badge */}
              <span className={`w-5 h-5 mt-0.5 shrink-0 flex items-center justify-center rounded text-[11px] font-bold tabular-nums ${
                isFocused || isSelected ? 'text-blue-400' : 'text-muted'
              }`}>
                {i + 1}
              </span>

              {/* SQL + run-single on click */}
              <div className="flex-1 min-w-0" onClick={() => onSelect(q)}>
                <pre className="text-[13px] font-mono text-secondary leading-relaxed overflow-hidden whitespace-pre-wrap break-all line-clamp-3 group-hover:text-primary transition-colors">
                  {statementLabel(q)}
                </pre>
              </div>

              {/* Inline run button — visible on hover */}
              <button
                onClick={(e) => { e.stopPropagation(); onSelect(q); }}
                className="mt-0.5 shrink-0 p-1.5 rounded-md text-muted opacity-0 group-hover:opacity-100 hover:bg-blue-500/20 hover:text-blue-400 transition-all"
                title={t('editor.querySelection.runSingle')}
              >
                <Play size={13} fill="currentColor" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-default bg-elevated/50">
        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onRunAll(queries)}
            className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            <Play size={12} fill="currentColor" />
            {t('editor.querySelection.runAll')}
          </button>

          <button
            onClick={handleRunSelected}
            disabled={!hasSelection}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ListChecks size={13} />
            {t('editor.querySelection.runSelected', { count: selectedIndices.size })}
          </button>

          <button
            onClick={toggleAll}
            className="ml-auto text-[11px] text-muted hover:text-secondary transition-colors px-2 py-1.5 rounded-md hover:bg-surface-secondary"
          >
            {allSelected ? t('editor.querySelection.deselectAll') : t('editor.querySelection.selectAll')}
          </button>
        </div>

        {/* Keyboard hints */}
        <div className="flex items-center gap-3 mt-2.5 text-[10px] text-muted/70">
          <span><kbd className="px-1 py-0.5 rounded bg-surface-secondary text-muted text-[9px] font-mono">Enter</kbd> run focused</span>
          <span><kbd className="px-1 py-0.5 rounded bg-surface-secondary text-muted text-[9px] font-mono">Space</kbd> toggle select</span>
          <span><kbd className="px-1 py-0.5 rounded bg-surface-secondary text-muted text-[9px] font-mono">Ctrl+Enter</kbd> run all</span>
          <span><kbd className="px-1 py-0.5 rounded bg-surface-secondary text-muted text-[9px] font-mono">1-9</kbd> run Nth</span>
          <span><kbd className="px-1 py-0.5 rounded bg-surface-secondary text-muted text-[9px] font-mono">Esc</kbd> cancel</span>
        </div>
      </div>
    </div>
  );
};

export const QuerySelectionModal = ({ isOpen, queries, onSelect, onRunAll, onRunSelected, onClose }: QuerySelectionModalProps) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      {isOpen && (
        <QuerySelectionContent
          key={queries.join('\n')}
          queries={queries}
          onSelect={onSelect}
          onRunAll={onRunAll}
          onRunSelected={onRunSelected}
          onClose={onClose}
        />
      )}
    </Modal>
  );
};
