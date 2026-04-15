import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Network } from 'lucide-react';
import { Modal } from '../ui/Modal';

interface ExplainSelectionModalProps {
  isOpen: boolean;
  queries: { query: string; index: number }[];
  onSelect: (query: string) => void;
  onClose: () => void;
}

const ExplainSelectionContent = ({
  queries,
  onSelect,
  onClose,
}: Omit<ExplainSelectionModalProps, 'isOpen'>) => {
  const { t } = useTranslation();
  const [focusedIndex, setFocusedIndex] = useState(0);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    itemRefs.current[focusedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + 1, queries.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onSelect(queries[focusedIndex].query);
      } else {
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= 9 && num <= queries.length) {
          e.preventDefault();
          onSelect(queries[num - 1].query);
        }
      }
    },
    [queries, focusedIndex, onSelect],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="bg-elevated border border-default rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-default">
        <div>
          <h3 className="text-base font-semibold text-white">
            {t('editor.explainSelection.title')}
          </h3>
          <p className="text-xs text-muted mt-0.5">
            {t('editor.explainSelection.queriesFound', {
              count: queries.length,
            })}
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
      <div className="flex-1 overflow-y-auto py-2 px-3">
        {queries.map((entry, i) => {
          const isFocused = focusedIndex === i;
          return (
            <div
              key={entry.index}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              onMouseEnter={() => setFocusedIndex(i)}
              onClick={() => onSelect(entry.query)}
              className={`group flex items-start gap-3 px-3 py-2.5 rounded-lg mb-1 cursor-pointer transition-all ${
                isFocused
                  ? 'bg-surface-secondary border border-transparent'
                  : 'border border-transparent hover:bg-surface-secondary/60'
              }`}
            >
              {/* Index badge */}
              <span
                className={`w-5 h-5 mt-0.5 shrink-0 flex items-center justify-center rounded text-[11px] font-bold tabular-nums ${
                  isFocused ? 'text-green-400' : 'text-muted'
                }`}
              >
                {entry.index}
              </span>

              {/* SQL */}
              <div className="flex-1 min-w-0">
                <pre className="text-[13px] font-mono text-secondary leading-relaxed overflow-hidden whitespace-pre-wrap break-all line-clamp-3 group-hover:text-primary transition-colors">
                  {entry.query}
                </pre>
              </div>

              {/* Inline explain button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(entry.query);
                }}
                className="mt-0.5 shrink-0 p-1.5 rounded-md text-muted opacity-0 group-hover:opacity-100 hover:bg-green-500/20 hover:text-green-400 transition-all"
                title={t('editor.explainSelection.explainSingle')}
              >
                <Network size={13} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-default bg-elevated/50">
        <div className="flex items-center gap-3 text-[10px] text-muted/70">
          <span>
            <kbd className="px-1 py-0.5 rounded bg-surface-secondary text-muted text-[9px] font-mono">
              Enter
            </kbd>{' '}
            {t('editor.explainSelection.explainFocused')}
          </span>
          <span>
            <kbd className="px-1 py-0.5 rounded bg-surface-secondary text-muted text-[9px] font-mono">
              1-9
            </kbd>{' '}
            {t('editor.explainSelection.explainNth')}
          </span>
          <span>
            <kbd className="px-1 py-0.5 rounded bg-surface-secondary text-muted text-[9px] font-mono">
              Esc
            </kbd>{' '}
            {t('editor.explainSelection.cancel')}
          </span>
        </div>
      </div>
    </div>
  );
};

export const ExplainSelectionModal = ({
  isOpen,
  queries,
  onSelect,
  onClose,
}: ExplainSelectionModalProps) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      {isOpen && (
        <ExplainSelectionContent
          key={queries.map((e) => e.query).join('\n')}
          queries={queries}
          onSelect={onSelect}
          onClose={onClose}
        />
      )}
    </Modal>
  );
};
