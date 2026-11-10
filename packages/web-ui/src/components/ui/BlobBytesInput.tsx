import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {BlobHexInput} from './BlobHexInput';
import {BlobTextInput} from './BlobTextInput';
import {blobValueToEditableText} from '@/utils/blob';

interface BlobBytesInputProps {
    value: unknown;
    onChange: (value: string) => void;
    placeholder?: string;
}

const MODE_BUTTON_CLASS =
    'px-2 py-1 text-xs rounded border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/**
 * Edits a small, complete BLOB in place. A BLOB the grid shows as text opens
 * as text, with hex one click away; any other BLOB is edited as hex.
 */
export const BlobBytesInput = ({value, onChange, placeholder}: BlobBytesInputProps) => {
    const {t} = useTranslation();
    const [showHex, setShowHex] = useState(false);
    const text = blobValueToEditableText(value);

    if (text === null) {
        return <BlobHexInput key={String(value)} value={value} onChange={onChange} />;
    }

    return (
        <div className="space-y-1">
            <div
                role="tablist"
                aria-label={t('blobInput.editAs')}
                className="inline-flex items-center gap-0.5 bg-surface-secondary border border-default rounded p-0.5"
            >
                {[false, true].map((hex) => (
                    <button
                        key={hex ? 'hex' : 'text'}
                        type="button"
                        role="tab"
                        aria-selected={showHex === hex}
                        onClick={() => setShowHex(hex)}
                        className={`${MODE_BUTTON_CLASS} ${
                            showHex === hex
                                ? 'bg-base text-primary border-strong'
                                : 'text-secondary hover:bg-surface-tertiary border-transparent'
                        }`}
                    >
                        {hex ? t('blobInput.hex') : t('blobInput.text')}
                    </button>
                ))}
            </div>
            {showHex ? (
                <BlobHexInput key={String(value)} value={value} onChange={onChange} />
            ) : (
                <BlobTextInput
                    key={String(value)}
                    value={value}
                    text={text}
                    onChange={onChange}
                    placeholder={placeholder}
                />
            )}
        </div>
    );
};
