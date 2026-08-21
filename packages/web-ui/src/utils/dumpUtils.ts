// Utilities for database dump and export operations

export const validateDumpOptions = (
  includeStructure: boolean,
  includeData: boolean,
  selectedTables: Set<string>
): { isValid: boolean; errorKey?: string } => {
  if (!includeStructure && !includeData) {
    return { isValid: false, errorKey: "dump.errorNoOption" };
  }
  if (selectedTables.size === 0) {
    return { isValid: false, errorKey: "dump.errorNoTables" };
  }
  return { isValid: true };
};

export const toggleTableSelection = (
  currentSelection: Set<string>,
  table: string
): Set<string> => {
  const newSet = new Set(currentSelection);
  if (newSet.has(table)) {
    newSet.delete(table);
  } else {
    newSet.add(table);
  }
  return newSet;
};

export const selectAllTables = (
  currentSelection: Set<string>,
  allTables: string[]
): Set<string> => {
  if (currentSelection.size === allTables.length) {
    return new Set();
  }
  return new Set(allTables);
};
