import { useContext } from "react";
import { QueryHistoryContext } from "../contexts/QueryHistoryContext";

export const useQueryHistory = () => {
  const context = useContext(QueryHistoryContext);
  if (context === undefined) {
    throw new Error(
      "useQueryHistory must be used within a QueryHistoryProvider",
    );
  }
  return context;
};
