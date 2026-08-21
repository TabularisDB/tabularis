import { useMemo, useState } from "react";
import {
  blobHexToWireFormat,
  blobValueToEditableHex,
  extractBlobMetadata,
} from "../../utils/blob";

interface BlobHexInputProps {
  value: unknown;
  onChange: (value: string) => void;
  className?: string;
}

export const BlobHexInput = ({
  value,
  onChange,
  className = "",
}: BlobHexInputProps) => {
  const initialHex = blobValueToEditableHex(value) ?? "";
  const mimeType = extractBlobMetadata(value)?.mimeType;
  const [hexValue, setHexValue] = useState(initialHex);
  const wireValue = useMemo(
    () => blobHexToWireFormat(hexValue, mimeType),
    [hexValue, mimeType],
  );
  const isValid = wireValue !== null;

  const commit = () => {
    if (!wireValue) {
      setHexValue(initialHex);
      return;
    }
    if (wireValue !== value) {
      onChange(wireValue);
    }
  };

  return (
    <textarea
      value={hexValue}
      onChange={(event) => setHexValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
      placeholder="00 FF"
      spellCheck={false}
      aria-invalid={!isValid}
      className={`w-full min-h-24 px-3 py-2 bg-base border rounded-lg text-primary font-mono text-sm resize-y focus:outline-none ${
        isValid ? "border-strong focus:border-blue-500" : "border-red-500"
      } ${className}`}
    />
  );
};
