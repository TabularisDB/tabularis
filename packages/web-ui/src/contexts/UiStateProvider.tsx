import { useEffect, type ReactNode } from "react";
import { useTabularisClient } from "../hooks/useTabularisClient";
import { uiStateStore, type UiStateStore } from "../utils/uiStateStore";

interface UiStateProviderProps {
  children: ReactNode;
  /** Tests inject an isolated store. */
  store?: UiStateStore;
}

/** Connects the shared UI state store to the active backend client. */
export function UiStateProvider({ children, store = uiStateStore }: UiStateProviderProps) {
  const client = useTabularisClient();

  useEffect(() => {
    const detach = store.attach(client);
    const flush = () => store.flush();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      detach();
    };
  }, [client, store]);

  return <>{children}</>;
}
