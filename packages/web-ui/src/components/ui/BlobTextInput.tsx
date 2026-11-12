import {useState} from 'react';
import {blobTextToWireFormat, extractBlobMetadata} from '@/utils/blob';

interface BlobTextInputProps {
    value: unknown;
    text: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
}

/** Edits a BLOB that holds UTF-8 text, saving the text back as UTF-8 bytes. */
export const BlobTextInput = ({
    value,
    text,
    onChange,
    placeholder,
    className = '',
}: BlobTextInputProps) => {
    const mimeType = extractBlobMetadata(value)?.mimeType;
    const [draft, setDraft] = useState(text);

    const commit = () => {
        if (draft === text) return;
        onChange(blobTextToWireFormat(draft, mimeType));
    };

    return (
        <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.currentTarget.blur();
                }
            }}
            placeholder={placeholder}
            spellCheck={false}
            className={`w-full min-h-24 px-3 py-2 bg-base border border-strong rounded-lg text-primary font-mono text-sm resize-y focus:outline-none focus:border-focus ${className}`}
        />
    );
};
