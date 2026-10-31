import {usePluginTranslation, usePluginWorkspace} from '@tabularis/plugin-api';
import {useBranches} from './hooks/useBranches';
import {styles} from './styles';

export function BranchSelector({connectionId}: {connectionId: string}) {
    const t = usePluginTranslation('neon');
    const branches = useBranches(connectionId);
    const {openWorkspace} = usePluginWorkspace('neon');
    const current = branches.context.data;
    const error =
        branches.action.error ??
        branches.context.error ??
        branches.listing.error ??
        branches.management.error;
    return (
        <div className="neon-branch-picker" data-connection-id={connectionId}>
            <style>{styles}</style>
            <span className="neon-branch-project">
                {branches.listing.data?.projectName ?? current?.projectId ?? 'Neon'}
            </span>
            <div className="neon-branch-picker-row">
                <select
                    aria-label={t('branches.switchBranch')}
                    value={current?.branchId ?? ''}
                    disabled={branches.pending || !branches.listing.data}
                    onChange={(event) => void branches.openBranch(event.target.value)}
                >
                    {!branches.listing.data && (
                        <option value={current?.branchId ?? ''}>
                            {current?.branchName ?? t('branches.title')}
                        </option>
                    )}
                    {branches.listing.data?.branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                            {branch.name}
                            {branch.isDefault ? ` (${t('branches.default')})` : ''}
                        </option>
                    ))}
                </select>
                <button
                    type="button"
                    title={t('branches.manage')}
                    aria-label={t('branches.manage')}
                    onClick={() =>
                        openWorkspace({
                            id: 'branches',
                            title: `Neon · ${t('branches.title')}`,
                            connectionId,
                        })
                    }
                >
                    <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        aria-hidden="true"
                    >
                        <circle cx="6" cy="5" r="3" />
                        <circle cx="18" cy="5" r="3" />
                        <circle cx="6" cy="19" r="3" />
                        <path d="M6 8v8M18 8a8 8 0 0 1-8 8H6" />
                    </svg>
                </button>
            </div>
            {branches.action.pending && <span role="status">{t('branches.opening')}</span>}
            {error && (
                <span className="neon-error" role="alert">
                    {error}
                </span>
            )}
        </div>
    );
}
