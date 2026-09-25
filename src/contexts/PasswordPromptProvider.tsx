import { useCallback, useRef, useState } from "react";
import { PasswordPromptContext } from "./PasswordPromptContext";
import { ConnectionPasswordModal } from "../components/modals/ConnectionPasswordModal";
import type {
  PasswordPromptRequest,
  PasswordPromptResult,
} from "../utils/connectionPassword";

interface PendingPrompt extends PasswordPromptRequest {
  id: number;
  resolve: (result: PasswordPromptResult | null) => void;
}

/**
 * Asks for a new password when a server rejects the stored one. Prompts are
 * queued, so restoring several connections at startup shows them one at a
 * time.
 */
export const PasswordPromptProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [queue, setQueue] = useState<PendingPrompt[]>([]);
  const nextId = useRef(0);

  const requestPassword = useCallback(
    (request: PasswordPromptRequest) =>
      new Promise<PasswordPromptResult | null>((resolve) => {
        const id = nextId.current++;
        setQueue((prev) => [...prev, { ...request, id, resolve }]);
      }),
    [],
  );

  const current = queue[0];

  const settle = useCallback(
    (result: PasswordPromptResult | null) => {
      if (!current) return;
      current.resolve(result);
      setQueue((prev) => prev.filter((p) => p.id !== current.id));
    },
    [current],
  );

  const handleCancel = useCallback(() => settle(null), [settle]);

  return (
    <PasswordPromptContext.Provider value={{ requestPassword }}>
      {children}
      {current && (
        <ConnectionPasswordModal
          key={current.id}
          isOpen
          connectionName={current.connectionName}
          username={current.username}
          error={current.error}
          onSubmit={settle}
          onClose={handleCancel}
        />
      )}
    </PasswordPromptContext.Provider>
  );
};
