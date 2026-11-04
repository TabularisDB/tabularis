import {useId, useState} from 'react';
import {
    PluginSelect,
    PluginResourceList,
    usePluginTranslation,
    usePluginWorkspace,
} from '@tabularis/plugin-api';
import {useNeonManagement} from './hooks/useNeonManagement';
import {useAuthRead} from './hooks/useAuthRead';
import {useTask} from './hooks/useTask';
import {PanelSection} from './components/PanelSection';
import type {AuthUserDetails, AuthUsersPage} from './types/authManagement';

const authStyles = `
.neon-auth {min-width:0;max-width:1100px;margin:0 auto}
.neon-auth-search {display:flex;gap:8px;align-items:end;margin-bottom:12px}
.neon-auth-search > label {flex:1;min-width:0}
.neon-auth-search .neon-field-label {margin-top:0}
.neon-auth-pagination {display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px;flex-wrap:wrap}
.neon-auth-pagination p {margin:0;font-size:12px;color:var(--text-muted)}
.neon-auth-metadata {display:grid;grid-template-columns:130px minmax(0,1fr);gap:12px 16px;margin:0 0 20px;font-size:12px}
.neon-auth-metadata dt {color:var(--text-muted)}
.neon-auth-metadata dd {margin:0;overflow-wrap:anywhere}
.neon-auth-danger {padding-top:16px;margin-top:24px;border-top:1px solid var(--border-default)}
.neon-auth-sessions {list-style:none;margin:0;padding:0}
.neon-auth-sessions li {padding:10px 0;border-bottom:1px solid var(--border-default);font-size:12px;line-height:1.7}
.neon-auth-sessions code {display:block;overflow-wrap:anywhere;color:var(--text-secondary)}
.neon-auth .neon-confirmation strong {display:block;overflow-wrap:anywhere;margin-bottom:6px}
`;

export function AuthManager({connectionId, userId}: {connectionId: string; userId?: string}) {
    return (
        <div className="neon-auth">
            <style>{authStyles}</style>
            {userId ? (
                <AuthUserView
                    key={`${connectionId}:${userId}`}
                    connectionId={connectionId}
                    userId={userId}
                />
            ) : (
                <AuthUserList key={connectionId} connectionId={connectionId} />
            )}
        </div>
    );
}

function ManagementAccess({management}: {management: ReturnType<typeof useNeonManagement>}) {
    const t = usePluginTranslation('neon');
    if (management.scope) return null;
    return (
        <div className="neon-feedback">
            <p className="neon-description">{t('authManager.accountRequired')}</p>
            {management.error && (
                <p role="alert" className="neon-error">
                    {management.error}
                </p>
            )}
            <div className="neon-row">
                <button
                    type="button"
                    className="neon-button"
                    disabled={management.pending}
                    onClick={management.connectAccount}
                >
                    {t('authManager.connectAccount')}
                </button>
                <button
                    type="button"
                    className="neon-button neon-button-quiet"
                    disabled={management.pending}
                    onClick={management.reload}
                >
                    {t('authManager.retry')}
                </button>
            </div>
        </div>
    );
}

function AuthUserList({connectionId}: {connectionId: string}) {
    const t = usePluginTranslation('neon');
    const {openWorkspace} = usePluginWorkspace('neon');
    const [searchDraft, setSearchDraft] = useState('');
    const [search, setSearch] = useState('');
    const [offset, setOffset] = useState(0);
    const [showCreate, setShowCreate] = useState(false);
    const pageSize = 25;
    const read = useAuthRead<AuthUsersPage>(connectionId, 'neon_auth_users_page', {
        search,
        offset,
        limit: pageSize,
    });
    const page = read.data;
    const from = page?.users.length ? offset + 1 : 0;
    const to = offset + (page?.users.length ?? 0);
    const id = useId();
    return (
        <>
            <PanelSection
                title={t('authManager.users')}
                hint={t('authManager.description')}
                actions={
                    <>
                        <button
                            type="button"
                            className="neon-button"
                            disabled={read.pending}
                            onClick={read.reload}
                        >
                            {t('authManager.refresh')}
                        </button>
                        <button
                            type="button"
                            className="neon-button neon-button-primary"
                            aria-expanded={showCreate}
                            onClick={() => setShowCreate((value) => !value)}
                        >
                            {t('authManager.addUser')}
                        </button>
                    </>
                }
            >
                {showCreate && (
                    <CreateUser
                        connectionId={connectionId}
                        onCreated={() => {
                            setOffset(0);
                            read.reload();
                        }}
                    />
                )}
                <form
                    className="neon-auth-search"
                    onSubmit={(event) => {
                        event.preventDefault();
                        setOffset(0);
                        setSearch(searchDraft.trim());
                    }}
                >
                    <label htmlFor={`${id}-search`}>
                        <span className="neon-field-label">{t('authManager.search')}</span>
                        <input
                            id={`${id}-search`}
                            className="neon-field"
                            type="search"
                            value={searchDraft}
                            maxLength={200}
                            onChange={(event) => setSearchDraft(event.target.value)}
                        />
                    </label>
                    <button type="submit" className="neon-button" disabled={read.pending}>
                        {t('authManager.searchAction')}
                    </button>
                </form>
                {read.pending && (
                    <p role="status" className="neon-hint neon-pending">
                        {t('authManager.loading')}
                    </p>
                )}
                {read.error && (
                    <p role="alert" className="neon-feedback neon-error">
                        {read.error}
                    </p>
                )}
                {page && (
                    <>
                        <PluginResourceList
                            label={t('authManager.users')}
                            emptyMessage={t('authManager.noUsers')}
                            items={page.users.map((user) => ({
                                id: user.id,
                                title: user.name || user.email,
                                subtitle: user.email,
                                status: user.role ?? t('authManager.roleUnknown'),
                            }))}
                            onOpen={(userId) => {
                                const user = page.users.find((item) => item.id === userId);
                                if (user)
                                    openWorkspace({
                                        id: `auth-user:${encodeURIComponent(user.id)}`,
                                        title: `Neon · ${user.email}`,
                                        connectionId,
                                    });
                            }}
                        />
                        <div className="neon-auth-pagination">
                            <p>{t('authManager.pagination', {from, to, total: page.total})}</p>
                            <div className="neon-inline-actions">
                                <button
                                    type="button"
                                    className="neon-button"
                                    disabled={read.pending || offset === 0}
                                    onClick={() =>
                                        setOffset((value) => Math.max(0, value - pageSize))
                                    }
                                >
                                    {t('authManager.previous')}
                                </button>
                                <button
                                    type="button"
                                    className="neon-button"
                                    disabled={read.pending || offset + pageSize >= page.total}
                                    onClick={() => setOffset((value) => value + pageSize)}
                                >
                                    {t('authManager.next')}
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </PanelSection>
        </>
    );
}

function CreateUser({connectionId, onCreated}: {connectionId: string; onCreated: () => void}) {
    const t = usePluginTranslation('neon');
    const management = useNeonManagement(connectionId);
    const task = useTask<{id: string}>();
    const id = useId();
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [created, setCreated] = useState(false);
    const pending = task.pending || management.pending;
    return (
        <PanelSection title={t('authManager.createUser')} hint={t('authManager.createHint')}>
            {!management.scope && <ManagementAccess management={management} />}
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    if (!management.scope || pending) return;
                    void task
                        .run(() =>
                            management.call<{id: string}>('account_auth_create_user', {
                                email: email.trim(),
                                name: name.trim(),
                            }),
                        )
                        .then((result) => {
                            if (result) {
                                setEmail('');
                                setName('');
                                setCreated(true);
                                onCreated();
                            }
                        });
                }}
            >
                <div className="neon-columns">
                    <div>
                        <label className="neon-field-label" htmlFor={`${id}-name`}>
                            {t('authManager.name')}
                        </label>
                        <input
                            id={`${id}-name`}
                            className="neon-field"
                            value={name}
                            maxLength={200}
                            required
                            disabled={pending || !management.scope}
                            onChange={(event) => {
                                setName(event.target.value);
                                setCreated(false);
                            }}
                        />
                    </div>
                    <div>
                        <label className="neon-field-label" htmlFor={`${id}-email`}>
                            {t('authManager.email')}
                        </label>
                        <input
                            id={`${id}-email`}
                            className="neon-field"
                            type="email"
                            value={email}
                            maxLength={320}
                            required
                            disabled={pending || !management.scope}
                            onChange={(event) => {
                                setEmail(event.target.value);
                                setCreated(false);
                            }}
                        />
                    </div>
                </div>
                <div className="neon-row">
                    <button
                        type="submit"
                        className="neon-button neon-button-primary"
                        disabled={pending || !management.scope || !name.trim() || !email.trim()}
                    >
                        {t('authManager.createUser')}
                    </button>
                </div>
            </form>
            {task.pending && (
                <p role="status" className="neon-hint neon-pending">
                    {t('authManager.saving')}
                </p>
            )}
            {task.error && (
                <p role="alert" className="neon-feedback neon-error">
                    {task.error}
                </p>
            )}
            {created && (
                <p role="status" className="neon-success">
                    {t('authManager.userCreated')}
                </p>
            )}
        </PanelSection>
    );
}

function AuthUserView({connectionId, userId}: {connectionId: string; userId: string}) {
    const t = usePluginTranslation('neon');
    const id = useId();
    const {openWorkspace} = usePluginWorkspace('neon');
    const backToUsers = () =>
        openWorkspace({id: 'users', title: `Neon · ${t('tabs.users')}`, connectionId});
    const read = useAuthRead<AuthUserDetails>(connectionId, 'neon_auth_user_details', {userId});
    const management = useNeonManagement(connectionId);
    const action = useTask<{kind: 'role' | 'delete'}>();
    const [roleDraft, setRoleDraft] = useState<'user' | 'admin' | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleted, setDeleted] = useState(false);
    const user = read.data?.user;
    const role = roleDraft ?? (user?.role === 'admin' ? 'admin' : 'user');
    const pending = action.pending || read.pending || management.pending;
    if (deleted)
        return (
            <div>
                <p role="status" className="neon-success">
                    {t('authManager.userDeleted')}
                </p>
                <button type="button" className="neon-button" onClick={backToUsers}>
                    {t('authManager.backToUsers')}
                </button>
            </div>
        );
    return (
        <>
            <div className="neon-toolbar">
                <button
                    type="button"
                    className="neon-button neon-button-quiet"
                    onClick={backToUsers}
                >
                    {t('authManager.backToUsers')}
                </button>
                <p className="neon-description neon-grow">{t('authManager.userDetails')}</p>
                <button
                    type="button"
                    className="neon-button"
                    disabled={pending}
                    onClick={read.reload}
                >
                    {t('authManager.refresh')}
                </button>
            </div>
            {read.pending && (
                <p role="status" className="neon-hint neon-pending">
                    {t('authManager.loading')}
                </p>
            )}
            {read.error && (
                <p role="alert" className="neon-feedback neon-error">
                    {read.error}
                </p>
            )}
            {user && (
                <>
                    <PanelSection
                        title={user.name || user.email}
                        hint={t('authManager.profileReadOnly')}
                    >
                        <dl className="neon-auth-metadata">
                            <dt>{t('authManager.userId')}</dt>
                            <dd>
                                <code>{user.id}</code>
                            </dd>
                            <dt>{t('authManager.name')}</dt>
                            <dd>{user.name || '—'}</dd>
                            <dt>{t('authManager.email')}</dt>
                            <dd>{user.email}</dd>
                            <dt>{t('authManager.verified')}</dt>
                            <dd>{t(user.emailVerified ? 'authManager.yes' : 'authManager.no')}</dd>
                            <dt>{t('authManager.created')}</dt>
                            <dd>{user.createdAt}</dd>
                            <dt>{t('authManager.role')}</dt>
                            <dd>{user.role ?? t('authManager.roleUnknown')}</dd>
                        </dl>
                        {!management.scope && <ManagementAccess management={management} />}
                        <label className="neon-field-label" htmlFor={`${id}-role`}>
                            {t('authManager.role')}
                        </label>
                        <PluginSelect
                            id={`${id}-role`}
                            value={role}
                            disabled={pending || !management.scope}
                            onChange={(value) => setRoleDraft(value === 'admin' ? 'admin' : 'user')}
                            options={[
                                {value: 'user', label: t('authManager.userRole')},
                                {value: 'admin', label: t('authManager.adminRole')},
                            ]}
                        />
                        <div className="neon-row">
                            <button
                                type="button"
                                className="neon-button"
                                disabled={pending || !management.scope || role === user.role}
                                onClick={() => {
                                    void action
                                        .run(async () => {
                                            await management.call('account_auth_set_role', {
                                                userId,
                                                role,
                                            });
                                            return {kind: 'role' as const};
                                        })
                                        .then((result) => {
                                            if (result) {
                                                setRoleDraft(null);
                                                read.reload();
                                            }
                                        });
                                }}
                            >
                                {t('authManager.saveRole')}
                            </button>
                        </div>
                        {action.data?.kind === 'role' && (
                            <p role="status" className="neon-success">
                                {t('authManager.roleSaved')}
                            </p>
                        )}
                    </PanelSection>
                    <PanelSection
                        title={t('authManager.sessions')}
                        hint={t('authManager.sessionsReadOnly')}
                    >
                        {read.data && read.data.sessions.length > 0 ? (
                            <ul className="neon-auth-sessions">
                                {read.data.sessions.map((session) => (
                                    <li key={session.id}>
                                        <code>{session.id}</code>
                                        <span>
                                            {t('authManager.sessionDates', {
                                                created: session.createdAt,
                                                expires: session.expiresAt,
                                            })}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="neon-hint">{t('authManager.noSessions')}</p>
                        )}
                    </PanelSection>
                    <div className="neon-auth-danger">
                        <button
                            type="button"
                            className="neon-button neon-button-danger"
                            disabled={pending || !management.scope}
                            onClick={() => setConfirmDelete(true)}
                        >
                            {t('authManager.deleteUser')}
                        </button>
                        {confirmDelete && (
                            <div className="neon-confirmation">
                                <strong>{user.email}</strong>
                                <p>{t('authManager.deleteConfirm')}</p>
                                <div className="neon-inline-actions">
                                    <button
                                        type="button"
                                        className="neon-button"
                                        disabled={pending}
                                        onClick={() => setConfirmDelete(false)}
                                    >
                                        {t('authManager.cancel')}
                                    </button>
                                    <button
                                        type="button"
                                        className="neon-button neon-button-danger"
                                        disabled={pending || !management.scope}
                                        onClick={() => {
                                            void action
                                                .run(async () => {
                                                    await management.call(
                                                        'account_auth_delete_user',
                                                        {userId},
                                                    );
                                                    return {kind: 'delete' as const};
                                                })
                                                .then((result) => {
                                                    if (result) {
                                                        setDeleted(true);
                                                        setConfirmDelete(false);
                                                    }
                                                });
                                        }}
                                    >
                                        {t('authManager.confirmDelete')}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}
            {action.pending && (
                <p role="status" className="neon-hint neon-pending">
                    {t('authManager.saving')}
                </p>
            )}
            {action.error && (
                <p role="alert" className="neon-feedback neon-error">
                    {action.error}
                </p>
            )}
        </>
    );
}
