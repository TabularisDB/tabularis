'use client';
import {useCallback, useState} from 'react';
import {createRealtimeClient, type SealedLiveQuery} from '@neon/realtime/client';
import {RealtimeProvider, useLiveQuery} from '@neon/realtime-react';
import {
    BookOpen,
    Search,
    Plus,
    LogOut,
    Folder,
    ArrowUpRight,
    FileText,
    Sparkles,
    Paperclip,
    Check,
    LoaderCircle,
    Trash2,
    X,
    Activity,
    Menu,
    ChevronDown,
} from 'lucide-react';
import {authClient} from '@/utils/authClient';
import type {Note, Project, Attachment} from '@/utils/types';

type User = {id: string; name: string; email: string};
interface Props {
    user: User;
    initialProjects: Project[];
    initialNotes: Note[];
    sealed: SealedLiveQuery<Note>;
    realtimeUrl: string;
}
async function api<T>(path: string, userId: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetch(`/api/workspace/${path}`, {
        method,
        headers: {
            'x-workspace-user': userId,
            ...(body instanceof FormData ? {} : {'Content-Type': 'application/json'}),
        },
        body:
            body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
    if (response.status === 401 || response.status === 409) {
        window.location.assign('/auth/sign-in');
        throw new Error('Your session changed. Sign in again.');
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The request failed');
    return result as T;
}
export function Workspace(props: Props) {
    const [client] = useState(() => createRealtimeClient({url: props.realtimeUrl}));
    return (
        <RealtimeProvider client={client}>
            <WorkspaceBody {...props} />
        </RealtimeProvider>
    );
}
function WorkspaceBody({user, initialProjects, initialNotes, sealed}: Props) {
    const [projects, setProjects] = useState(initialProjects);
    const [selected, setSelected] = useState(initialNotes[0]?.id || '');
    const [project, setProject] = useState('all');
    const [search, setSearch] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [newProject, setNewProject] = useState(false);
    const refreshQuery = useCallback(
        async () => (await api<{query: SealedLiveQuery<Note>}>('live', user.id, 'POST')).query,
        [user.id],
    );
    const {
        data,
        status,
        error: liveError,
        utils,
    } = useLiveQuery(sealed, {initialData: initialNotes, refreshQuery});
    const notes = data || initialNotes;
    const visible = notes.filter(
        (n) =>
            (project === 'all' || n.project_id === project) &&
            `${n.title} ${n.body}`.toLowerCase().includes(search.toLowerCase()),
    );
    const active = notes.find((n) => n.id === selected);
    async function addNote() {
        if (!projects.length) {
            setNewProject(true);
            return;
        }
        setBusy(true);
        setError('');
        try {
            const note = await api<Note & {txid: string}>('notes', user.id, 'POST', {
                title: 'Untitled note',
                body: '',
                project_id: project === 'all' ? projects[0].id : project,
            });
            await utils.awaitTxId(note.txid, 15000);
            setSelected(note.id);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not create note');
        } finally {
            setBusy(false);
        }
    }
    async function addProject(form: FormData) {
        setBusy(true);
        setError('');
        try {
            const p = await api<Project>('projects', user.id, 'POST', {
                name: String(form.get('name')),
                color: '#5577ca',
            });
            setProjects((current) =>
                current.some((x) => x.id === p.id) ? current : [...current, p],
            );
            setProject(p.id);
            setNewProject(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not create project');
        } finally {
            setBusy(false);
        }
    }
    return (
        <div className="workspace">
            <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
                <div className="sidebar-top">
                    <a className="brand" href="/workspace">
                        <span className="brand-mark">
                            <BookOpen size={20} />
                        </span>
                        Fieldnotes
                    </a>
                    <button
                        className="icon mobile-only"
                        aria-label="Close navigation"
                        onClick={() => setSidebarOpen(false)}
                    >
                        <X size={18} />
                    </button>
                </div>
                <div className="workspace-switch">
                    <span className="workspace-avatar">{user.name.slice(0, 1).toUpperCase()}</span>
                    <div>
                        <strong>{user.name.split(' ')[0]}’s workspace</strong>
                        <span>Personal workspace</span>
                    </div>
                    <ChevronDown size={14} />
                </div>
                <nav>
                    <button
                        className={project === 'all' ? 'nav-item active' : 'nav-item'}
                        onClick={() => {
                            setProject('all');
                            setSidebarOpen(false);
                        }}
                    >
                        <FileText size={17} />
                        All notes<span className="nav-count">{notes.length}</span>
                    </button>
                </nav>
                <div className="sidebar-label">
                    Projects
                    <button
                        className="icon"
                        aria-label="Create project"
                        onClick={() => setNewProject(true)}
                    >
                        <Plus size={16} />
                    </button>
                </div>
                <nav>
                    {projects.map((p) => (
                        <button
                            key={p.id}
                            className={project === p.id ? 'nav-item active' : 'nav-item'}
                            onClick={() => {
                                setProject(p.id);
                                setSidebarOpen(false);
                            }}
                        >
                            <span className="project-dot" style={{background: p.color}} />
                            {p.name}
                            <span className="nav-count">
                                {notes.filter((n) => n.project_id === p.id).length}
                            </span>
                        </button>
                    ))}
                </nav>
                <div className="sidebar-bottom">
                    <div className="lab-note">
                        <Activity size={19} />
                        <strong>A little live workspace</strong>
                        <p>
                            Your ideas, connected.
                            <br />
                            Built on Neon.
                        </p>
                        <a href="https://neon.com" target="_blank" rel="noreferrer">
                            Explore Neon <ArrowUpRight size={14} />
                        </a>
                    </div>
                    <div className="account">
                        <span className="user-avatar">{user.name.slice(0, 1).toUpperCase()}</span>
                        <div>
                            <strong>{user.name}</strong>
                            <span>{user.email}</span>
                        </div>
                        <button
                            className="icon"
                            aria-label="Sign out"
                            onClick={async () => {
                                await authClient.signOut();
                                window.location.assign('/auth/sign-in');
                            }}
                        >
                            <LogOut size={16} />
                        </button>
                    </div>
                </div>
            </aside>
            <main className="main-area">
                <header className="topbar">
                    <div className="breadcrumbs">
                        <button
                            className="icon mobile-only"
                            aria-label="Open navigation"
                            onClick={() => setSidebarOpen(true)}
                        >
                            <Menu size={18} />
                        </button>
                        <span>Workspace</span>
                        <span>/</span>
                        <strong>
                            {project === 'all'
                                ? 'All notes'
                                : projects.find((p) => p.id === project)?.name}
                        </strong>
                    </div>
                    <span
                        className={`live-pill ${status === 'error' ? 'live-error' : ''}`}
                        title={liveError?.message}
                    >
                        <span />
                        {status === 'error'
                            ? 'Live connection interrupted'
                            : status === 'live'
                              ? 'Live updates connected'
                              : 'Connecting live updates'}
                    </span>
                </header>
                <div className="page-heading">
                    <div>
                        <h1>
                            {project === 'all'
                                ? 'Your thinking, in one place.'
                                : projects.find((p) => p.id === project)?.name}
                        </h1>
                        <p>Notes, discoveries, and the beginnings of something good.</p>
                    </div>
                    <button className="primary" onClick={addNote} disabled={busy}>
                        {busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={17} />}
                        New note
                    </button>
                </div>
                {error && (
                    <div className="error banner" role="alert">
                        {error}
                        <button
                            className="icon"
                            aria-label="Dismiss error"
                            onClick={() => setError('')}
                        >
                            <X size={16} />
                        </button>
                    </div>
                )}
                {status === 'error' && (
                    <div role="alert" className="error banner">
                        Live updates stopped. Reload to reconnect.
                        <button onClick={() => window.location.reload()}>Reload</button>
                    </div>
                )}
                <div className="content-grid">
                    <section className="notes-panel">
                        <div className="search-field">
                            <Search size={16} />
                            <input
                                aria-label="Search notes"
                                placeholder="Search your notes..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                            <span>⌕</span>
                        </div>
                        <div className="list-heading">
                            <span>
                                {visible.length} {visible.length === 1 ? 'note' : 'notes'}
                            </span>
                            <span>Recently edited</span>
                        </div>
                        <div className="notes-list">
                            {visible.map((note) => (
                                <button
                                    key={note.id}
                                    className={`note-card ${selected === note.id ? 'selected' : ''}`}
                                    onClick={() => setSelected(note.id)}
                                >
                                    <div className="note-card-top">
                                        <FileText size={17} />
                                        <span>
                                            {new Date(note.updated_at).toLocaleDateString('en-GB', {
                                                month: 'short',
                                                day: 'numeric',
                                            })}
                                        </span>
                                    </div>
                                    <h2>{note.title}</h2>
                                    <p>{note.body || 'A blank page. Make it yours.'}</p>
                                    <div className="note-project">
                                        <span
                                            className="project-dot"
                                            style={{
                                                background: projects.find(
                                                    (p) => p.id === note.project_id,
                                                )?.color,
                                            }}
                                        />
                                        {projects.find((p) => p.id === note.project_id)?.name}
                                        {note.summary && <Sparkles size={13} />}
                                    </div>
                                </button>
                            ))}
                            {!visible.length && (
                                <div className="empty-list">
                                    <BookOpen size={28} />
                                    <h3>Space for a new idea.</h3>
                                    <p>
                                        {search
                                            ? 'Try another search.'
                                            : 'Create your first note in this project.'}
                                    </p>
                                    <button onClick={addNote}>Create a note</button>
                                </div>
                            )}
                        </div>
                        <div className="list-footer">
                            <LockGlyph />
                            Only you can see these notes
                        </div>
                    </section>
                    {active ? (
                        <NoteEditor
                            key={active.id}
                            note={active}
                            projects={projects}
                            userId={user.id}
                            awaitTxId={utils.awaitTxId}
                            onDelete={() => setSelected('')}
                        />
                    ) : (
                        <section className="editor empty-editor">
                            <BookOpen size={38} strokeWidth={1} />
                            <h2>A clear page. A fresh thought.</h2>
                            <p>Choose a note or start something new.</p>
                            <button className="primary" onClick={addNote}>
                                <Plus size={16} />
                                New note
                            </button>
                        </section>
                    )}
                </div>
                <footer className="workspace-footer">
                    <span>Fieldnotes</span>
                    <span>
                        Tabularis Neon Lab <span className="footer-dot" /> A working prototype
                    </span>
                </footer>
            </main>
            {newProject && (
                <div className="modal-backdrop">
                    <section
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="project-title"
                        className="project-dialog"
                    >
                        <button
                            className="icon dialog-close"
                            aria-label="Close dialog"
                            onClick={() => setNewProject(false)}
                        >
                            <X size={18} />
                        </button>
                        <Folder size={25} />
                        <h2 id="project-title">Make space for a project.</h2>
                        <p>Give related ideas a place to come together.</p>
                        <form action={addProject}>
                            <label>
                                Project name
                                <input
                                    name="name"
                                    autoFocus
                                    required
                                    maxLength={100}
                                    placeholder="e.g. Customer conversations"
                                />
                            </label>
                            <button className="primary" disabled={busy}>
                                Create project
                            </button>
                        </form>
                    </section>
                </div>
            )}
        </div>
    );
}
function LockGlyph() {
    return (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="3" y="7" width="10" height="7" rx="2" stroke="currentColor" />
            <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" />
        </svg>
    );
}
function NoteEditor({
    note,
    projects,
    userId,
    awaitTxId,
    onDelete,
}: {
    note: Note;
    projects: Project[];
    userId: string;
    awaitTxId: (txid: string, timeout: number) => Promise<void>;
    onDelete: () => void;
}) {
    const [title, setTitle] = useState(note.title);
    const [body, setBody] = useState(note.body);
    const [projectId, setProjectId] = useState(note.project_id);
    const [savedTitle, setSavedTitle] = useState(note.title);
    const [savedBody, setSavedBody] = useState(note.body);
    const [savedProject, setSavedProject] = useState(note.project_id);
    const [summary, setSummary] = useState(note.summary);
    const [files, setFiles] = useState<Attachment[] | null>(null);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [analysis, setAnalysis] = useState<{
        words: number;
        readingMinutes: number;
    } | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const dirty = title !== savedTitle || body !== savedBody || projectId !== savedProject;
    const [observedNote, setObservedNote] = useState(note);
    const [externalUpdate, setExternalUpdate] = useState<Note | null>(null);
    function loadVersion(version: Note) {
        setTitle(version.title);
        setBody(version.body);
        setProjectId(version.project_id);
        setSavedTitle(version.title);
        setSavedBody(version.body);
        setSavedProject(version.project_id);
        setSummary(version.summary);
        setAnalysis(null);
        setExternalUpdate(null);
    }
    // Reconcile new live props during render, without an effect that can erase a draft.
    if (note !== observedNote) {
        setObservedNote(note);
        const matchesSaved =
            note.title === savedTitle &&
            note.body === savedBody &&
            note.project_id === savedProject;
        const matchesDraft =
            note.title === title && note.body === body && note.project_id === projectId;
        if (matchesSaved) {
            setSummary(note.summary);
        } else if (matchesDraft) {
            // Our own committed save acknowledges the draft without remounting this editor.
            setSavedTitle(note.title);
            setSavedBody(note.body);
            setSavedProject(note.project_id);
            setSummary(note.summary);
            setExternalUpdate(null);
        } else if (dirty) {
            setExternalUpdate(note);
        } else {
            loadVersion(note);
        }
    }
    async function run(name: string, action: () => Promise<void>) {
        setBusy(name);
        setError('');
        try {
            await action();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'The action failed');
        } finally {
            setBusy('');
        }
    }
    async function save() {
        if (externalUpdate) throw new Error('Resolve the newer version before saving your edits.');
        setAnalysis(null);
        const result = await api<Note & {txid: string}>(`notes/${note.id}`, userId, 'PUT', {
            title,
            body,
            project_id: projectId,
        });
        await awaitTxId(result.txid, 15000);
        setSavedTitle(title);
        setSavedBody(body);
        setSavedProject(projectId);
        setSummary(result.summary);
    }
    return (
        <section className="editor">
            <div className="editor-toolbar">
                <div>
                    <FileText size={16} />
                    <select
                        aria-label="Note project"
                        value={projectId}
                        onChange={(e) => setProjectId(e.target.value)}
                    >
                        {projects.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="editor-actions">
                    <span className="save-status">
                        {dirty ? (
                            'Unsaved changes'
                        ) : (
                            <>
                                <Check size={13} />
                                Saved
                            </>
                        )}
                    </span>
                    <button
                        className="save-button"
                        disabled={!dirty || !!busy || !!externalUpdate}
                        onClick={() => run('save', save)}
                    >
                        {busy === 'save' ? <LoaderCircle className="spin" size={14} /> : null}
                        Save
                    </button>
                    <button
                        className="icon"
                        aria-label="Delete note"
                        onClick={() => setConfirmDelete(true)}
                    >
                        <Trash2 size={15} />
                    </button>
                </div>
            </div>
            {externalUpdate && (
                <div className="delete-confirm" role="status">
                    This note changed elsewhere. Your unsaved text is safe.
                    <button disabled={!!busy} onClick={() => loadVersion(externalUpdate)}>
                        Load latest version
                    </button>
                    <button
                        disabled={!!busy}
                        onClick={() => {
                            setSavedTitle(externalUpdate.title);
                            setSavedBody(externalUpdate.body);
                            setSavedProject(externalUpdate.project_id);
                            setExternalUpdate(null);
                        }}
                    >
                        Keep my edits
                    </button>
                </div>
            )}
            {confirmDelete && (
                <div className="delete-confirm">
                    Delete this note and its attachments?
                    <button
                        disabled={!!busy}
                        onClick={() =>
                            run('delete', async () => {
                                await api(`notes/${note.id}`, userId, 'DELETE');
                                onDelete();
                            })
                        }
                    >
                        Delete note
                    </button>
                    <button onClick={() => setConfirmDelete(false)}>Keep note</button>
                </div>
            )}
            {error && (
                <p className="error editor-error" role="alert">
                    {error}
                </p>
            )}
            <div className="editor-page">
                <div className="note-meta">
                    Created{' '}
                    {new Date(note.created_at).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                    })}
                </div>
                <input
                    className="note-title"
                    aria-label="Note title"
                    value={title}
                    maxLength={180}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Untitled note"
                />
                <textarea
                    className="note-body"
                    aria-label="Note body"
                    value={body}
                    maxLength={40000}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Start with a thought, a question, an observation..."
                />
                <div className="note-tools">
                    <button
                        disabled={!!busy || !!externalUpdate}
                        onClick={() =>
                            run('summary', async () => {
                                if (dirty) await save();
                                const result = await api<{summary: string}>(
                                    `notes/${note.id}/summary`,
                                    userId,
                                    'POST',
                                );
                                setSummary(result.summary);
                            })
                        }
                    >
                        {busy === 'summary' ? (
                            <LoaderCircle size={16} className="spin" />
                        ) : (
                            <Sparkles size={16} />
                        )}
                        Summarize note
                    </button>
                    <button
                        disabled={!!busy || !!externalUpdate}
                        onClick={() =>
                            run('analysis', async () => {
                                if (dirty) await save();
                                setAnalysis(await api(`notes/${note.id}/analyze`, userId, 'POST'));
                            })
                        }
                    >
                        {busy === 'analysis' ? (
                            <LoaderCircle size={16} className="spin" />
                        ) : (
                            <Activity size={16} />
                        )}
                        Reading insights
                    </button>
                </div>
                {summary && (
                    <div className="summary-box">
                        <div>
                            <Sparkles size={16} />
                            <strong>A little clarity</strong>
                            <span>AI summary</span>
                        </div>
                        <p>{summary}</p>
                    </div>
                )}
                {analysis && (
                    <div className="analysis-result">
                        <Activity size={15} />
                        {analysis.words} words · {analysis.readingMinutes} min read
                        <span>Analyzed by Neon Functions</span>
                    </div>
                )}
                <section className="attachments">
                    <div className="attachments-title">
                        <h3>
                            <Paperclip size={15} />
                            Source material
                        </h3>
                        <button
                            className="text-button"
                            onClick={() =>
                                run('files', async () =>
                                    setFiles(
                                        await api<Attachment[]>(
                                            `notes/${note.id}/attachments`,
                                            userId,
                                        ),
                                    ),
                                )
                            }
                            disabled={!!busy}
                        >
                            {files === null ? 'Show files' : 'Refresh'}
                        </button>
                    </div>
                    {files?.map((file) => (
                        <div className="attachment" key={file.id}>
                            <FileText size={17} />
                            <a href={`/api/workspace/attachments/${file.id}`} download>
                                {file.name}
                                <span>{(file.size / 1024).toFixed(1)} KB</span>
                            </a>
                            <button
                                className="icon"
                                aria-label={`Remove ${file.name}`}
                                disabled={!!busy}
                                onClick={() =>
                                    run('files', async () => {
                                        await api(`attachments/${file.id}`, userId, 'DELETE');
                                        setFiles(files.filter((f) => f.id !== file.id));
                                    })
                                }
                            >
                                <X size={14} />
                            </button>
                        </div>
                    ))}
                    <label className="upload-area">
                        <input
                            type="file"
                            aria-label="Attach a file"
                            disabled={!!busy}
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                run('upload', async () => {
                                    const form = new FormData();
                                    form.set('file', file);
                                    await api(`notes/${note.id}/attachments`, userId, 'POST', form);
                                    setFiles(
                                        await api<Attachment[]>(
                                            `notes/${note.id}/attachments`,
                                            userId,
                                        ),
                                    );
                                });
                                e.target.value = '';
                            }}
                        />
                        {busy === 'upload' ? (
                            <LoaderCircle className="spin" size={18} />
                        ) : (
                            <Paperclip size={18} />
                        )}
                        <span>
                            <strong>Attach a file</strong> or bring in a little context
                            <small>Private to your account · Up to 4 MB</small>
                        </span>
                        <Plus size={16} />
                    </label>
                </section>
            </div>
            <div className="editor-footer">
                <span>{body.trim().split(/\s+/).filter(Boolean).length} words</span>
                <span>Room to think.</span>
            </div>
        </section>
    );
}
