import {useId, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {TextCursorInput, X} from 'lucide-react';
import {Modal} from '@/components/ui/Modal';

interface SetCellsValueModalProps {
    isOpen: boolean;
    cellCount: number;
    onApply: (value: string) => void;
    onClose: () => void;
}

/** Asks for the value "Edit selection → Set to value…" writes into every selected cell. */
export function SetCellsValueModal({isOpen, cellCount, onApply, onClose}: SetCellsValueModalProps) {
    const {t} = useTranslation();
    const [value, setValue] = useState('');
    const titleId = useId();
    const inputId = useId();

    return (
        <Modal isOpen={isOpen} onClose={onClose} closeOnBackdrop>
            <form
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="bg-elevated border border-strong rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col"
                onSubmit={(event) => {
                    event.preventDefault();
                    onApply(value);
                }}
            >
                <div className="flex items-center justify-between p-4 border-b border-default bg-base">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-accent-primary/15 rounded-lg">
                            <TextCursorInput size={20} className="text-accent" />
                        </div>
                        <div>
                            <h2 id={titleId} className="text-lg font-semibold text-primary">
                                {t('dataGrid.setToValueTitle')}
                            </h2>
                            <p className="text-xs text-secondary">
                                {t('dataGrid.editSelectionCells', {count: cellCount})}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={t('common.close')}
                        className="text-secondary hover:text-primary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6 space-y-2">
                    <label htmlFor={inputId} className="text-xs uppercase font-bold text-muted">
                        {t('dataGrid.setToValueLabel')}
                    </label>
                    <input
                        id={inputId}
                        autoFocus
                        type="text"
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        className="w-full px-3 py-2 bg-base border border-strong rounded-lg text-primary font-mono text-sm focus:border-focus focus:outline-none"
                    />
                </div>
                <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="submit"
                        className="px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 text-inverse rounded-lg text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                        {t('dataGrid.setToValueApply')}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
