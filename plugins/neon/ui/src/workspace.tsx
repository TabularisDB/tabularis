import type {SlotComponentProps} from '@tabularis/plugin-api';
import {NeonPanel} from './NeonPanel';

export default function NeonWorkspace({context}: SlotComponentProps) {
  if (context.workspaceId !== 'services' || context.driver !== 'neon') return null;
  return <NeonPanel
    connectionId={typeof context.connectionId === 'string' ? context.connectionId : null}
    connectionName={typeof context.connectionName === 'string' ? context.connectionName : undefined}
  />;
}
