import type { ReactNode } from 'react';
import { useConnectionLayout } from '../hooks/useConnectionLayout';
import { ConnectionLayoutContext } from './ConnectionLayoutContext';

export const ConnectionLayoutProvider = ({ children }: { children: ReactNode }) => {
  const layout = useConnectionLayout();
  return (
    <ConnectionLayoutContext.Provider value={layout}>
      {children}
    </ConnectionLayoutContext.Provider>
  );
};
