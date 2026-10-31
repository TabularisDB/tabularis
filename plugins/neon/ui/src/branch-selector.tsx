import type {SlotComponentProps} from '@tabularis/plugin-api';
import {BranchSelector} from './BranchSelector';
export default function NeonBranchSelector({context}: SlotComponentProps) {
    return context.driver === 'neon' && typeof context.connectionId === 'string' ? (
        <BranchSelector key={context.connectionId} connectionId={context.connectionId} />
    ) : null;
}
