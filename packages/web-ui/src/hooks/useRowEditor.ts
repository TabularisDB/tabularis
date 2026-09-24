import { useState, useCallback, useEffect } from "react";

export interface UseRowEditorOptions {
  initialData: Record<string, unknown>;
  onChange?: (fieldName: string, value: unknown) => void;
}

export interface UseRowEditorReturn {
  editedData: Record<string, unknown>;
  updateField: (fieldName: string, value: unknown) => void;
}

/**
 * Hook to manage row editing state
 * Provides methods to update fields and applies changes immediately
 */
export function useRowEditor({
  initialData,
  onChange,
}: UseRowEditorOptions): UseRowEditorReturn {
  const [editedData, setEditedData] = useState<Record<string, unknown>>(initialData);

  // Reset edited data when initial data changes
  useEffect(() => {
    setEditedData(initialData);
  }, [initialData]);

  const updateField = useCallback((fieldName: string, value: unknown) => {
    setEditedData((prev) => {
      const newData = { ...prev, [fieldName]: value };
      return newData;
    });
    
    // Apply changes immediately
    if (onChange) {
      onChange(fieldName, value);
    }
  }, [onChange]);

  return {
    editedData,
    updateField,
  };
}
