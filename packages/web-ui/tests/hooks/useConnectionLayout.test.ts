import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useConnectionLayout } from '../../src/hooks/useConnectionLayout';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

function splitOf(...ids: string[]) {
  const { result } = renderHook(() => useConnectionLayout());

  act(() => {
    ids.forEach((id) => result.current.toggleSelection(id, true));
  });
  act(() => {
    result.current.activateSplit('vertical');
  });

  return result;
}

describe('useConnectionLayout', () => {
  it('should focus the first surviving panel when the focused connection leaves a live split', () => {
    const result = splitOf('conn-a', 'conn-b', 'conn-c');
    expect(result.current.explorerConnectionId).toBe('conn-a');

    act(() => {
      result.current.removeConnectionFromSplit('conn-a');
    });

    // A null focus here would resolve the command palette to the root scope,
    // whose editor navigation is dead while the split renders.
    expect(result.current.splitView?.connectionIds).toHaveLength(2);
    expect(result.current.explorerConnectionId).not.toBeNull();
    expect(result.current.splitView?.connectionIds).toContain(
      result.current.explorerConnectionId,
    );
  });

  it('should keep the focus when another connection leaves the split', () => {
    const result = splitOf('conn-a', 'conn-b', 'conn-c');

    act(() => {
      result.current.removeConnectionFromSplit('conn-b');
    });

    expect(result.current.explorerConnectionId).toBe('conn-a');
  });

  it('should clear the focus when the split collapses below two panels', () => {
    const result = splitOf('conn-a', 'conn-b');

    act(() => {
      result.current.removeConnectionFromSplit('conn-a');
    });

    expect(result.current.splitView).toBeNull();
    expect(result.current.isSplitVisible).toBe(false);
    expect(result.current.explorerConnectionId).toBeNull();
  });
});
