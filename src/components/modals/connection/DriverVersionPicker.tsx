import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CatalogueDriver, EngineGroup } from '../../../utils/connectionCatalogue';

interface DriverVersionPickerProps {
  group: EngineGroup;
  onChoose: (driver: CatalogueDriver, version: string) => void;
  onBack: () => void;
}

export function DriverVersionPicker({ group, onChoose, onBack }: DriverVersionPickerProps) {
  const { t } = useTranslation();
  const [selectedSlug, setSelectedSlug] = useState(group.drivers[0]?.slug ?? '');
  const selected = group.drivers.find((d) => d.slug === selectedSlug) ?? group.drivers[0];

  return (
    <div className="flex flex-col gap-3 p-4">
      <button
        type="button"
        onClick={onBack}
        className="flex cursor-pointer items-center gap-1 self-start text-xs text-muted hover:text-primary"
      >
        ← {t('connectionCatalogue.backToCatalogue', { defaultValue: 'Back to catalogue' })}
      </button>
      <p className="text-sm text-secondary">
        {t('connectionCatalogue.pickDriver', {
          name: group.displayName,
          defaultValue: 'Multiple drivers connect to {{name}}. Pick one:',
        })}
      </p>
      <ul className="flex flex-col gap-2">
        {group.drivers.map((d) => (
          <li key={d.slug}>
            <button
              type="button"
              onClick={() => {
                setSelectedSlug(d.slug);
              }}
              className={
                'flex w-full cursor-pointer items-center justify-between rounded-md border px-3 py-2 text-left transition-colors ' +
                (d.slug === selectedSlug ? 'border-blue-500 bg-blue-500/10' : 'border-default hover:border-blue-500/40')
              }
            >
              <span className="flex items-center gap-2">
                <span className="font-medium text-primary">{d.name}</span>
                {d.verified && (
                  <span className="text-[10px] text-blue-400">
                    ✓ {t('connectionCatalogue.verified', { defaultValue: 'Verified' })}
                  </span>
                )}
                {d.installed && (
                  <span className="text-[10px] text-emerald-400">
                    ● {t('connectionCatalogue.installed', { defaultValue: 'Installed' })}
                  </span>
                )}
              </span>
              <span className="text-xs text-muted">
                {d.downloads != null ? `${d.downloads} ↓ · ` : ''}v{d.latestVersion}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted">
          {t('connectionCatalogue.latestVersion', {
            version: selected?.latestVersion ?? '',
            defaultValue: 'Latest v{{version}}',
          })}
        </span>
        <button
          type="button"
          onClick={() => selected && onChoose(selected, selected.latestVersion)}
          className="ml-auto cursor-pointer rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
        >
          {t('connectionCatalogue.continue', { defaultValue: 'Continue' })}
        </button>
      </div>
    </div>
  );
}
