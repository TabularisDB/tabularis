import type { ReactNode } from "react";
import type { TabularisClient } from "../api/client";
import { TabularisClientContext } from "./TabularisClientContext";

interface TabularisClientProviderProps {
  children: ReactNode;
  client: TabularisClient;
}

export function TabularisClientProvider({
  children,
  client,
}: TabularisClientProviderProps) {
  return (
    <TabularisClientContext.Provider value={client}>
      {children}
    </TabularisClientContext.Provider>
  );
}
