import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { RowEditorPanel } from '../../../src/components/ui/RowEditorPanel';
import { useDatabase } from '../../../src/hooks/useDatabase';
import { renderWithSlotProbe } from '../../fixtures/pluginSlotProbe';
import {
  getPluginProbeFrames,
  getPluginProbeFrameModules,
  pluginSlotProbeContexts,
  resetPluginSlotProbe,
} from '../../fixtures/pluginSlotProbeTransport';

vi.mock('../../../src/plugins/sandbox/connectFrame', async () => {
  const actual = await vi.importActual<typeof import('../../../src/plugins/sandbox/connectFrame')>(
    '../../../src/plugins/sandbox/connectFrame',
  );
  const transport = await import('../../fixtures/pluginSlotProbeTransport');
  return { ...actual, connectFrame: transport.connectFrameMock };
});

vi.mock('../../../src/hooks/useDatabase', () => ({ useDatabase: vi.fn() }));

const row = { id: 7 };
const props = {
  onClose: vi.fn(), rowData: row, rowIndex: 0, isInsertion: false,
  columns: [{ name: 'id', type: 'integer' }], onChange: vi.fn(),
  connectionId: 'pg-pane', tableName: 'users', schema: 'tenant', database: 'shop',
};
const slots = ['row-editor-sidebar.header.actions', 'row-editor-sidebar.field.after'] as const;

function setDatabase(activeDriver: string, includeTarget = true) {
  vi.mocked(useDatabase).mockReturnValue({
    activeDriver,
    activeConnectionId: 'mysql-pane',
    connectionDataMap: includeTarget ? { 'pg-pane': { driver: 'postgres' } } : {},
  } as ReturnType<typeof useDatabase>);
}

describe('RowEditorPanel plugin context', () => {
  beforeEach(() => { vi.clearAllMocks(); resetPluginSlotProbe(); setDatabase('mysql'); });

  const contextsFor = (driver: unknown) => pluginSlotProbeContexts.filter((context) => context.driver === driver);

  it('renders PostgreSQL plugins for the row connection while MySQL is globally active', async () => {
    await renderWithSlotProbe(<RowEditorPanel {...props} />, [...slots]);
    await waitFor(() => expect(contextsFor('postgres').length).toBeGreaterThanOrEqual(2));
    const probes = contextsFor('postgres');
    for (const probe of probes) {
      expect(probe).toMatchObject({
        driver: 'postgres', connectionId: 'pg-pane', schema: 'tenant',
        tableName: 'users', database: 'shop', rowData: row, rowIndex: 0, isInsertion: false,
      });
    }
    expect(contextsFor('mysql')).toHaveLength(0);
    const frames = getPluginProbeFrames();
    expect(getPluginProbeFrameModules()).toEqual(expect.arrayContaining(['postgres.js', 'unfiltered.js']));
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((frame) => frame.getAttribute('sandbox') === 'allow-scripts')).toBe(true);
  });

  it('keeps the row connection context when global focus changes', async () => {
    const { rerender } = await renderWithSlotProbe(<RowEditorPanel {...props} />, [...slots]);
    await waitFor(() => expect(contextsFor('postgres').length).toBeGreaterThanOrEqual(2));
    setDatabase('sqlite');
    rerender(<RowEditorPanel {...props} />);
    expect(contextsFor('postgres').length).toBeGreaterThanOrEqual(2);
    expect(contextsFor('mysql')).toHaveLength(0);
    expect(getPluginProbeFrameModules()).toEqual(expect.arrayContaining(['postgres.js', 'unfiltered.js']));
  });

  it('hides driver-filtered plugins when the row connection disappears', async () => {
    const { rerender } = await renderWithSlotProbe(<RowEditorPanel {...props} />, [...slots]);
    await waitFor(() => expect(contextsFor('postgres').length).toBeGreaterThanOrEqual(2));
    setDatabase('mysql', false);
    rerender(<RowEditorPanel {...props} />);
    await waitFor(() => {
      const modules = getPluginProbeFrameModules();
      expect(modules).toEqual(['unfiltered.js', 'unfiltered.js']);
    });
  });

  it('does not borrow the active driver when the row has no connection', async () => {
    await renderWithSlotProbe(<RowEditorPanel {...props} connectionId={null} />, [...slots]);
    await waitFor(() => expect(contextsFor(null).length).toBeGreaterThanOrEqual(2));
    const probes = contextsFor(null);
    for (const probe of probes) {
      expect(probe).toMatchObject({ driver: null, connectionId: null });
    }
    expect(getPluginProbeFrameModules()).toEqual(['unfiltered.js', 'unfiltered.js']);
  });
});
