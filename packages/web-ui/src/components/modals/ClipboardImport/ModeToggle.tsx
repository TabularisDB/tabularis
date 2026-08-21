import { Plus, ArrowDownToLine } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type ImportMode = 'create' | 'append';

interface ModeToggleProps {
  value: ImportMode;
  onChange: (mode: ImportMode) => void;
}

export function ModeToggle({ value, onChange }: ModeToggleProps) {
  const { t } = useTranslation();
  const items: { id: ImportMode; icon: typeof Plus; title: string; hint: string }[] = [
    {
      id: 'create',
      icon: Plus,
      title: t('clipboardImport.createNew'),
      hint: t('clipboardImport.modeCreateHint'),
    },
    {
      id: 'append',
      icon: ArrowDownToLine,
      title: t('clipboardImport.appendTo'),
      hint: t('clipboardImport.modeAppendHint'),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map(({ id, icon: Icon, title, hint }) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`group relative flex flex-col items-start gap-1 p-3 rounded-lg border text-left transition-all ${
              active
                ? 'border-indigo-500/60 bg-indigo-500/10 shadow-[0_0_0_1px_rgba(99,102,241,0.15)]'
                : 'border-default bg-base/50 hover:bg-base hover:border-strong'
            }`}
          >
            <div className="flex items-center gap-2 w-full">
              <div
                className={`p-1.5 rounded-md transition-colors ${
                  active
                    ? 'bg-indigo-500/20 text-indigo-300'
                    : 'bg-surface-secondary/50 text-muted group-hover:text-secondary'
                }`}
              >
                <Icon size={14} />
              </div>
              <span
                className={`text-sm font-semibold transition-colors ${
                  active ? 'text-primary' : 'text-secondary'
                }`}
              >
                {title}
              </span>
            </div>
            <span className="text-[11px] text-muted leading-snug">{hint}</span>
          </button>
        );
      })}
    </div>
  );
}
