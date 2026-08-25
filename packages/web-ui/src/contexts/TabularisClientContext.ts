import { createContext } from "react";
import type { TabularisClient } from "../api/client";

export const TabularisClientContext = createContext<TabularisClient | null>(
  null,
);
