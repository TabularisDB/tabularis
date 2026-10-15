import { useContext } from "react";
import { TabularisClientContext } from "../contexts/TabularisClientContext";

export function useTabularisClient() {
  const client = useContext(TabularisClientContext);

  if (!client) {
    throw new Error(
      "useTabularisClient must be used within TabularisClientProvider",
    );
  }

  return client;
}
